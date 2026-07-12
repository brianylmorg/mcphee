import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { babyBelongsToHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

type ImportRowInput = {
  sourceRef?: string;
  confidence?: number;
  type: string;
  startedAt: number;
  endedAt?: number | null;
  details?: Record<string, unknown>;
  note?: string;
  rawText?: string;
};

const VALID_TYPES = new Set(["bottlefeed", "breastfeed", "pump", "diaper", "vomit", "sleep"]);

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function validateKey(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return searchParams.get("key") === process.env.MIGRATION_KEY;
}

function isValidRow(row: unknown): row is ImportRowInput {
  if (!row || typeof row !== "object") return false;
  const r = row as Partial<ImportRowInput>;
  return (
    typeof r.type === "string" &&
    VALID_TYPES.has(r.type) &&
    typeof r.startedAt === "number" &&
    Number.isFinite(r.startedAt) &&
    (r.endedAt == null || (typeof r.endedAt === "number" && Number.isFinite(r.endedAt))) &&
    (r.details == null || typeof r.details === "object")
  );
}

async function findDuplicateActivity(
  db: ReturnType<typeof createDB>,
  babyId: string,
  row: ImportRowInput
): Promise<string | null> {
  // ponytail: one-minute fuzzy match is enough for paper import review; tighten if real duplicates become messy.
  const result = await db.execute({
    sql: `SELECT id FROM activities
          WHERE baby_id = ? AND type = ? AND ABS(started_at - ?) <= 60000
          LIMIT 1`,
    args: [babyId, row.type, row.startedAt],
  });

  if (result.rows.length === 0) return null;
  return String((result.rows[0] as unknown as { id: string }).id);
}

export async function GET(request: NextRequest) {
  if (!validateKey(request)) return unauthorized();

  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const householdId = searchParams.get("householdId");
    const db = createDB();

    if (batchId) {
      const batch = await db.execute({
        sql: "SELECT * FROM paper_log_import_batches WHERE id = ?",
        args: [batchId],
      });
      const rows = await db.execute({
        sql: "SELECT * FROM paper_log_import_rows WHERE batch_id = ? ORDER BY row_index ASC",
        args: [batchId],
      });
      return NextResponse.json({ batch: batch.rows[0] ?? null, rows: rows.rows });
    }

    const batches = await db.execute({
      sql: `SELECT b.*, baby.name AS baby_name,
                   COUNT(r.id) AS row_count,
                   SUM(CASE WHEN r.status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate_count,
                   SUM(CASE WHEN r.status = 'committed' THEN 1 ELSE 0 END) AS committed_count
            FROM paper_log_import_batches b
            JOIN babies baby ON baby.id = b.baby_id
            LEFT JOIN paper_log_import_rows r ON r.batch_id = b.id
            WHERE (? IS NULL OR b.household_id = ?)
            GROUP BY b.id
            ORDER BY b.created_at DESC`,
      args: [householdId, householdId],
    });

    return NextResponse.json({ batches: batches.rows });
  } catch (error) {
    console.error("Import paper log GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!validateKey(request)) return unauthorized();

  try {
    const body = await request.json();
    const action = body.action ?? "stage";
    const db = createDB();

    if (action === "stage") {
      const { householdId, babyId, rows, sourceNote, createdBy } = body as {
        householdId?: string;
        babyId?: string;
        rows?: unknown[];
        sourceNote?: string;
        createdBy?: string;
      };

      if (!householdId || !babyId || !Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: "householdId, babyId, and rows are required" }, { status: 400 });
      }

      const babyOk = await babyBelongsToHousehold(db, babyId, householdId);
      if (!babyOk) {
        return NextResponse.json({ error: "Baby not found" }, { status: 404 });
      }

      const invalidAt = rows.findIndex((row) => !isValidRow(row));
      if (invalidAt >= 0) {
        return NextResponse.json({ error: `Invalid row at index ${invalidAt}` }, { status: 400 });
      }

      const batchId = generateId();
      const now = Date.now();
      await db.execute({
        sql: `INSERT INTO paper_log_import_batches (id, household_id, baby_id, status, source_note, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [batchId, householdId, babyId, "staged", sourceNote ?? null, now, createdBy ?? null],
      });

      let duplicateCount = 0;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index] as ImportRowInput;
        const duplicateActivityId = await findDuplicateActivity(db, babyId, row);
        if (duplicateActivityId) duplicateCount++;

        await db.execute({
          sql: `INSERT INTO paper_log_import_rows (
                  id, batch_id, row_index, status, source_ref, confidence, type, started_at, ended_at,
                  details, note, raw_text, duplicate_activity_id, imported_activity_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            generateId(),
            batchId,
            index,
            duplicateActivityId ? "duplicate" : "staged",
            row.sourceRef ?? null,
            row.confidence ?? null,
            row.type,
            row.startedAt,
            row.endedAt ?? null,
            JSON.stringify(row.details ?? {}),
            row.note ?? null,
            row.rawText ?? null,
            duplicateActivityId,
            null,
            now,
          ],
        });
      }

      return NextResponse.json({ batchId, rowCount: rows.length, duplicateCount });
    }

    if (action === "commit") {
      const { batchId, createdBy } = body as { batchId?: string; createdBy?: string };
      if (!batchId) {
        return NextResponse.json({ error: "batchId is required" }, { status: 400 });
      }

      const batchResult = await db.execute({
        sql: "SELECT * FROM paper_log_import_batches WHERE id = ? AND status = 'staged'",
        args: [batchId],
      });
      if (batchResult.rows.length === 0) {
        return NextResponse.json({ error: "Staged batch not found" }, { status: 404 });
      }

      const batch = batchResult.rows[0] as unknown as { baby_id: string };
      const rows = await db.execute({
        sql: `SELECT * FROM paper_log_import_rows
              WHERE batch_id = ? AND status = 'staged'
              ORDER BY row_index ASC`,
        args: [batchId],
      });

      const now = Date.now();
      let committedCount = 0;
      for (const row of rows.rows as unknown as Array<{
        id: string;
        type: string;
        started_at: number;
        ended_at: number | null;
        details: string | null;
      }>) {
        const activityId = generateId();
        await db.execute({
          sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            activityId,
            batch.baby_id,
            row.type,
            row.started_at,
            row.ended_at,
            row.details ?? "{}",
            now,
            createdBy ?? "paper import",
          ],
        });
        await db.execute({
          sql: "UPDATE paper_log_import_rows SET status = 'committed', imported_activity_id = ? WHERE id = ?",
          args: [activityId, row.id],
        });
        committedCount++;
      }

      await db.execute({
        sql: "UPDATE paper_log_import_batches SET status = 'committed' WHERE id = ?",
        args: [batchId],
      });

      return NextResponse.json({ batchId, committedCount });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Import paper log POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
