import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { userNameForHousehold } from "@/lib/db/household";
import {
  HISTORICAL_MEDICATION_DOSE_MAX_LENGTH,
  parseHistoricalMedicationDetails,
} from "@/lib/historical-medication";

export const runtime = "nodejs";

class HistoricalMedicationApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function requiredText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value) throw new HistoricalMedicationApiError(400, `${key} is required`);
  return value;
}

function expectedRevision(body: Record<string, unknown>): number {
  const value = Number(body.expectedRevision);
  if (!Number.isInteger(value) || value < 1) {
    throw new HistoricalMedicationApiError(400, "expectedRevision is required");
  }
  return value;
}

function apiError(error: unknown) {
  if (error instanceof HistoricalMedicationApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Historical medication API error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

async function requestBody(request: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HistoricalMedicationApiError(400, "Valid JSON object required");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HistoricalMedicationApiError(400, "JSON object required");
  }
  return body as Record<string, unknown>;
}

export async function PUT(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await requestBody(request);
    const babyId = requiredText(body, "babyId");
    const activityId = requiredText(body, "id");
    const revision = expectedRevision(body);
    const givenAt = Number(body.givenAt);
    if (!Number.isFinite(givenAt) || givenAt <= 0) {
      throw new HistoricalMedicationApiError(400, "givenAt must be a timestamp");
    }
    if (givenAt > Date.now()) {
      throw new HistoricalMedicationApiError(400, "givenAt cannot be in the future");
    }
    if (typeof body.doseText !== "string") {
      throw new HistoricalMedicationApiError(400, "doseText is required");
    }

    const db = createDB();
    const tx = await db.transaction("write");
    try {
      const result = await tx.execute({
        sql: `SELECT a.details
              FROM activities a JOIN babies b ON b.id = a.baby_id
              WHERE a.id = ? AND a.baby_id = ? AND a.type = 'medication'
                AND b.household_id = ? LIMIT 1`,
        args: [activityId, babyId, householdId],
      });
      const row = result.rows[0];
      if (!row) throw new HistoricalMedicationApiError(404, "Historical medication activity not found");
      const storedDetails = String(row.details ?? "");
      const details = parseHistoricalMedicationDetails(storedDetails);
      if (!details || details.historicalMedication.deletedAt != null) {
        throw new HistoricalMedicationApiError(404, "Historical medication activity not found");
      }
      if (details.historicalMedication.revision !== revision) {
        throw new HistoricalMedicationApiError(409, "Historical medication activity changed on another device");
      }

      const trimmedDose = body.doseText.trim();
      if (details.historicalMedication.eventKind === "procedure") {
        if (trimmedDose) throw new HistoricalMedicationApiError(400, "Procedures do not have a medication dose");
      } else if (!trimmedDose || trimmedDose.length > HISTORICAL_MEDICATION_DOSE_MAX_LENGTH) {
        throw new HistoricalMedicationApiError(
          400,
          `doseText must be between 1 and ${HISTORICAL_MEDICATION_DOSE_MAX_LENGTH} characters`,
        );
      }

      const nextRevision = revision + 1;
      const nextDetails = JSON.stringify({
        ...details,
        doseText: details.historicalMedication.eventKind === "procedure" ? "" : trimmedDose,
        historicalMedication: {
          ...details.historicalMedication,
          revision: nextRevision,
        },
      });
      const update = await tx.execute({
        sql: `UPDATE activities SET started_at = ?, details = ?
              WHERE id = ? AND baby_id = ? AND type = 'medication' AND details = ?`,
        args: [givenAt, nextDetails, activityId, babyId, storedDetails],
      });
      if ((update.rowsAffected ?? 0) !== 1) {
        throw new HistoricalMedicationApiError(409, "Historical medication activity changed on another device");
      }
      await tx.commit();
      return NextResponse.json({ ok: true, id: activityId, revision: nextRevision });
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    } finally {
      tx.close();
    }
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await requestBody(request);
    const babyId = requiredText(body, "babyId");
    const activityId = requiredText(body, "id");
    const revision = expectedRevision(body);
    const db = createDB();
    const deletedBy = await userNameForHousehold(
      db,
      request.cookies.get("mcphee_user")?.value,
      householdId,
    );
    const tx = await db.transaction("write");
    try {
      const result = await tx.execute({
        sql: `SELECT a.details
              FROM activities a JOIN babies b ON b.id = a.baby_id
              WHERE a.id = ? AND a.baby_id = ? AND a.type = 'medication'
                AND b.household_id = ? LIMIT 1`,
        args: [activityId, babyId, householdId],
      });
      const row = result.rows[0];
      if (!row) throw new HistoricalMedicationApiError(404, "Historical medication activity not found");
      const storedDetails = String(row.details ?? "");
      const details = parseHistoricalMedicationDetails(storedDetails);
      if (!details || details.historicalMedication.deletedAt != null) {
        throw new HistoricalMedicationApiError(404, "Historical medication activity not found");
      }
      if (details.historicalMedication.revision !== revision) {
        throw new HistoricalMedicationApiError(409, "Historical medication activity changed on another device");
      }

      const nextRevision = revision + 1;
      const nextDetails = JSON.stringify({
        ...details,
        historicalMedication: {
          ...details.historicalMedication,
          revision: nextRevision,
          deletedAt: Date.now(),
          deletedBy,
        },
      });
      const update = await tx.execute({
        sql: `UPDATE activities SET details = ?
              WHERE id = ? AND baby_id = ? AND type = 'medication' AND details = ?`,
        args: [nextDetails, activityId, babyId, storedDetails],
      });
      if ((update.rowsAffected ?? 0) !== 1) {
        throw new HistoricalMedicationApiError(409, "Historical medication activity changed on another device");
      }
      await tx.commit();
      return NextResponse.json({ ok: true, id: activityId, revision: nextRevision });
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    } finally {
      tx.close();
    }
  } catch (error) {
    return apiError(error);
  }
}
