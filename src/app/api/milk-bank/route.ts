import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { parseMilkBankCommand } from "@/lib/milk-bank-command";
import {
  MilkLedgerError,
  previewAvailableUse,
  replayMilkLedger,
  replayMilkLedgerEdit,
  type MilkLedgerActivity,
} from "@/lib/milk-bank-ledger";
import { parseActivityDetails } from "@/lib/milk-volumes";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

const LEDGER_TYPES = ["pump", "bottlefeed", "bankadjust", "bankfreeze", "bankthaw", "bankdiscard"] as const;
const TRANSFER_TYPES = new Set(["bankfreeze", "bankthaw", "bankdiscard"]);

type Executor = {
  execute: (statement: { sql: string; args: Array<string | number> }) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

async function loadLedger(executor: Executor, householdId: string): Promise<MilkLedgerActivity[]> {
  const result = await executor.execute({
    sql: `SELECT a.id, a.type, a.started_at, a.created_at, a.details
          FROM activities a JOIN babies b ON b.id = a.baby_id
          WHERE b.household_id = ?
            AND a.type IN (${LEDGER_TYPES.map(() => "?").join(", ")})
          ORDER BY a.started_at ASC, a.created_at ASC, a.id ASC`,
    args: [householdId, ...LEDGER_TYPES],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    startedAt: Number(row.started_at),
    createdAt: Number(row.created_at),
    details: parseActivityDetails(row.details),
  }));
}

function serializeState(events: MilkLedgerActivity[], now = Date.now()) {
  return replayMilkLedger(events, now, new Set(events.map((event) => event.id)));
}

function ledgerErrorResponse(error: unknown) {
  if (error instanceof MilkLedgerError) {
    const status = error.code === "INSUFFICIENT_AVAILABLE" ? 400 : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const events = await loadLedger(createDB() as unknown as Executor, householdId);
    return NextResponse.json(serializeState(events));
  } catch (error) {
    const response = ledgerErrorResponse(error);
    if (response) return response;
    console.error("Milk bank read error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  let command: ReturnType<typeof parseMilkBankCommand>;
  try {
    body = await request.json();
    if (typeof body.babyId !== "string" || !body.babyId) throw new Error("babyId is required");
    command = parseMilkBankCommand(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }

  const db = createDB();
  const babyError = await requireBabyInHousehold(db, body.babyId as string, householdId);
  if (babyError) return babyError;
  const createdBy = await userNameForHousehold(db, request.cookies.get("mcphee_user")?.value, householdId);
  const tx = await db.transaction("write");
  try {
    const events = await loadLedger(tx as unknown as Executor, householdId);
    const id = generateId();
    let type: "bankfreeze" | "bankthaw" | "bankdiscard";
    let details: Record<string, unknown>;

    if (command.action === "freeze") {
      const preview = previewAvailableUse(events, command.amountMl, command.at);
      if (preview.expiredMl > 0 && !command.confirmExpired) {
        await tx.rollback();
        return NextResponse.json({
          error: `This freeze would use ${preview.expiredMl} ml of expired Available milk. Confirm to continue.`,
          code: "EXPIRED_CONFIRMATION_REQUIRED",
          expiredMl: preview.expiredMl,
        }, { status: 409 });
      }
      type = "bankfreeze";
      details = { amount: command.amountMl, source: "available" };
    } else if (command.action === "addPacket") {
      type = "bankfreeze";
      details = { amount: command.amountMl, source: "reconcile" };
    } else {
      const state = serializeState(events, command.at);
      const packet = state.frozenPackets.find((item) => item.id === command.packetId);
      if (!packet) throw new MilkLedgerError("PACKET_NOT_FOUND", "Frozen packet is no longer available");
      type = command.action === "thaw" ? "bankthaw" : "bankdiscard";
      details = { packetId: packet.id, amount: packet.amountMl };
    }

    const candidate: MilkLedgerActivity = {
      id,
      type,
      startedAt: command.at,
      createdAt: Date.now(),
      details,
    };
    const state = serializeState([...events, candidate]);
    await tx.execute({
      sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      args: [id, body.babyId as string, type, command.at, JSON.stringify(details), candidate.createdAt!, createdBy],
    });
    await tx.commit();
    return NextResponse.json({ id, ...state });
  } catch (error) {
    try { await tx.rollback(); } catch {}
    const response = ledgerErrorResponse(error);
    if (response) return response;
    console.error("Milk bank write error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    tx.close();
  }
}

export async function PUT(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const amountMl = Number(body.amountMl);
  const at = Number(body.at);
  if (!id || !Number.isFinite(amountMl) || amountMl <= 0 || !Number.isFinite(at) || at <= 0 || at > Date.now() + 120_000) {
    return NextResponse.json({ error: "A valid transfer, positive amount, and timestamp are required" }, { status: 400 });
  }

  const db = createDB();
  const tx = await db.transaction("write");
  try {
    const owned = await tx.execute({
      sql: `SELECT a.type, a.details FROM activities a JOIN babies b ON b.id = a.baby_id
            WHERE a.id = ? AND b.household_id = ? LIMIT 1`,
      args: [id, householdId],
    });
    const row = owned.rows[0];
    if (!row || !TRANSFER_TYPES.has(String(row.type))) {
      await tx.rollback();
      return NextResponse.json({ error: "Bank transfer not found" }, { status: 404 });
    }
    const events = await loadLedger(tx as unknown as Executor, householdId);
    const details = { ...parseActivityDetails(row.details), amount: Math.round(amountMl * 100) / 100 };
    const state = replayMilkLedgerEdit(events, id, { amountMl: Math.round(amountMl * 100) / 100, at });
    await tx.execute({
      sql: `UPDATE activities SET started_at = ?, details = ?
            WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [at, JSON.stringify(details), id, householdId],
    });
    await tx.commit();
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    try { await tx.rollback(); } catch {}
    const response = ledgerErrorResponse(error);
    if (response) return response;
    console.error("Milk bank edit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    tx.close();
  }
}

export async function DELETE(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Packet ID required" }, { status: 400 });

  const db = createDB();
  const tx = await db.transaction("write");
  try {
    const owned = await tx.execute({
      sql: `SELECT a.type FROM activities a JOIN babies b ON b.id = a.baby_id
            WHERE a.id = ? AND b.household_id = ? LIMIT 1`,
      args: [id, householdId],
    });
    if (String(owned.rows[0]?.type ?? "") !== "bankfreeze") {
      await tx.rollback();
      return NextResponse.json({ error: "Frozen packet not found" }, { status: 404 });
    }
    const events = await loadLedger(tx as unknown as Executor, householdId);
    const state = serializeState(events.filter((event) => event.id !== id));
    await tx.execute({
      sql: `DELETE FROM activities WHERE id = ?
            AND baby_id IN (SELECT id FROM babies WHERE household_id = ?) AND type = 'bankfreeze'`,
      args: [id, householdId],
    });
    await tx.commit();
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    try { await tx.rollback(); } catch {}
    const response = ledgerErrorResponse(error);
    if (response) return response;
    console.error("Milk bank packet removal error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    tx.close();
  }
}
