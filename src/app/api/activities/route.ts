import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";

export const runtime = "nodejs";

const VALID_TYPES = new Set(["bottlefeed", "breastfeed", "pump", "diaper", "vomit", "sleep"]);

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateActivityInput(body: Record<string, unknown>) {
  if (typeof body.babyId !== "string" || !body.babyId) return "babyId is required";
  if (typeof body.type !== "string" || !VALID_TYPES.has(body.type)) return "Invalid activity type";
  if (!isValidTimestamp(body.startedAt)) return "startedAt must be a timestamp";
  if (body.endedAt != null && !isValidTimestamp(body.endedAt)) return "endedAt must be a timestamp";
  if (body.endedAt != null && Number(body.endedAt) < Number(body.startedAt)) {
    return "endedAt must be after startedAt";
  }
  if (body.details != null && (typeof body.details !== "object" || Array.isArray(body.details))) {
    return "details must be an object";
  }
  return null;
}

type MilkVolumes = { breastmilkMl: number; formulaMl: number };
type DB = ReturnType<typeof createDB>;

function parseDetails(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numericMl(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function bottleVolumes(details: Record<string, unknown>): MilkVolumes {
  const feeds = details.feeds;
  if (Array.isArray(feeds)) {
    return feeds.reduce<MilkVolumes>((total, item) => {
      if (!item || typeof item !== "object") return total;
      const feed = item as Record<string, unknown>;
      const amount = numericMl(feed.amount);
      if (feed.milkType === "formula") total.formulaMl += amount;
      else if (feed.milkType === "breastmilk") total.breastmilkMl += amount;
      return total;
    }, { breastmilkMl: 0, formulaMl: 0 });
  }

  const amount = numericMl(details.amount);
  const breastmilkAmount = numericMl(details.breastmilkAmount);
  const formulaAmount = numericMl(details.formulaAmount);
  if (breastmilkAmount || formulaAmount) {
    return {
      breastmilkMl: breastmilkAmount || (details.milkType === "breastmilk" ? amount : 0),
      formulaMl: formulaAmount || (details.milkType === "formula" ? amount : 0),
    };
  }

  if (details.milkType === "formula") return { breastmilkMl: 0, formulaMl: amount };
  return { breastmilkMl: amount, formulaMl: 0 };
}

function pumpAmount(details: Record<string, unknown>): number {
  return numericMl(details.amount);
}

async function breastmilkLibraryForBaby(db: DB, babyId: string, householdId: string, excludeActivityId?: string): Promise<number> {
  let sql = `SELECT a.id, a.type, a.details, a.started_at, a.created_at FROM activities a
             WHERE a.baby_id = ?
               AND a.baby_id IN (SELECT id FROM babies WHERE household_id = ?)
               AND a.type IN (?, ?)`;
  const args: Array<string | number> = [babyId, householdId, "pump", "bottlefeed"];
  if (excludeActivityId) {
    sql += " AND a.id != ?";
    args.push(excludeActivityId);
  }
  sql += " ORDER BY a.started_at ASC, a.created_at ASC";

  const result = await db.execute({ sql, args });
  const walletMl = result.rows.reduce((balance, row) => {
    const typedRow = row as unknown as { type: string; details: string | null };
    const details = parseDetails(typedRow.details);
    if (typedRow.type === "pump") {
      return balance + pumpAmount(details);
    }
    if (typedRow.type === "bottlefeed") {
      return Math.max(0, balance - bottleBreastmilkLibraryDeduction(details));
    }
    return balance;
  }, 0);

  return Math.max(0, walletMl);
}

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ activities: [] });
  }

  try {
    const db = createDB();
    const { searchParams } = new URL(request.url);
    const babyId = searchParams.get("babyId");
    const type = searchParams.get("type");
    const date = searchParams.get("date");
    const requestedLimit = Number(searchParams.get("limit") || "50");
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
      : 50;

    if (type && !VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid activity type" }, { status: 400 });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    let sql = `
      SELECT a.*, b.name as baby_name
      FROM activities a
      JOIN babies b ON a.baby_id = b.id
      WHERE b.household_id = ?
    `;
    const args: Array<string | number> = [householdId];

    if (babyId) {
      sql += " AND a.baby_id = ?";
      args.push(babyId);
    }
    if (type) {
      sql += " AND a.type = ?";
      args.push(type);
    }
    if (date) {
      const dayStart = Date.parse(date + "T00:00:00+08:00");
      if (!Number.isFinite(dayStart)) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
      sql += " AND a.started_at >= ? AND a.started_at < ?";
      args.push(dayStart, dayStart + 24 * 60 * 60 * 1000);
    }

    sql += " ORDER BY a.started_at DESC LIMIT ?";
    args.push(limit);

    const result = await db.execute({ sql, args });
    return NextResponse.json({ activities: result.rows });
  } catch (error) {
    console.error("Activities API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

    const db = createDB();
    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    if (body.type === "bottlefeed") {
      const requestedBreastmilkMl = bottleBreastmilkLibraryDeduction(parseDetails(body.details));
      const availableBreastmilkMl = await breastmilkLibraryForBaby(db, body.babyId, householdId);
      if (requestedBreastmilkMl > availableBreastmilkMl) {
        return NextResponse.json(
          { error: "Breastmilk amount exceeds available breastmilk library" },
          { status: 400 }
        );
      }
    }

    const activityId = generateId();
    const createdBy = await userNameForHousehold(db, body.userId, householdId);

    await db.execute({
      sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        activityId,
        body.babyId,
        body.type,
        body.startedAt,
        body.endedAt || null,
        JSON.stringify(body.details || {}),
        Date.now(),
        createdBy,
      ],
    });

    return NextResponse.json({ id: activityId });
  } catch (error) {
    console.error("Create activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Activity ID required" }, { status: 400 });
    }

    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

    const db = createDB();

    // Fetch existing activity to merge details and verify household ownership.
    const existing = await db.execute({
      sql: "SELECT details FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)",
      args: [body.id, householdId],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    let mergedDetails = {};
    const existingDetails = (existing.rows[0] as unknown as { details: string | null }).details;
    if (existingDetails) {
      try {
        mergedDetails = JSON.parse(existingDetails);
      } catch {}
    }

    // Merge new details on top of existing
    mergedDetails = { ...mergedDetails, ...body.details };

    if (body.type === "bottlefeed") {
      const requestedBreastmilkMl = bottleBreastmilkLibraryDeduction(parseDetails(mergedDetails));
      const availableBreastmilkMl = await breastmilkLibraryForBaby(db, body.babyId, householdId, body.id);
      if (requestedBreastmilkMl > availableBreastmilkMl) {
        return NextResponse.json(
          { error: "Breastmilk amount exceeds available breastmilk library" },
          { status: 400 }
        );
      }
    }

    await db.execute({
      sql: `UPDATE activities SET 
            type = ?,
            started_at = ?,
            ended_at = ?,
            details = ?
            WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [
        body.type,
        body.startedAt,
        body.endedAt ?? null,
        JSON.stringify(mergedDetails),
        body.id,
        householdId,
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get("id");
    if (!activityId) {
      return NextResponse.json({ error: "Activity ID required" }, { status: 400 });
    }

    const db = createDB();

    const result = await db.execute({
      sql: `DELETE FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [activityId, householdId],
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
