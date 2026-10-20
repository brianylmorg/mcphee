import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";
import { normalizeActivityCreators } from "@/lib/activity-creators";
import { bottleVolumes, parseActivityDetails, pumpAmount } from "@/lib/milk-volumes";
import { replayMilkLedger, type MilkLedgerActivity } from "@/lib/milk-bank-ledger";
import { selectRecentMilkFeeds, type RecentMilkFeedActivity } from "@/lib/recent-milk-feeds";
import { caretakerSleepCoverageFromAudit } from "@/lib/caretaker-sleep-audit";
import { isCaretakerImportSchemaReady } from "@/db/caretaker-import-schema";
import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import { isDashboardVersionSchemaReady } from "@/db/dashboard-version-schema";
import { loadChildcareModeState } from "@/lib/childcare-mode-server";

const sgtDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const runtime = "nodejs";

const RECENT_ACTIVITY_LIMIT = 50;
// Upper bound on how long an unchanged answer is reused, even if every input
// looks static: a safety net for time-dependent output nobody has listed yet.
const TAG_MAX_AGE_MS = 60 * 60 * 1000;
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "local").slice(0, 12);

type DashboardTag = {
  householdHash: string;
  dataVersion: string;
  sgtDate: string;
  validUntil: number;
};

function householdHash(householdId: string): string {
  return createHash("sha256").update(householdId).digest("hex").slice(0, 16);
}

function formatTag(tag: DashboardTag): string {
  return `"dv1.${BUILD_ID}.${tag.householdHash}.${tag.dataVersion}.${tag.sgtDate}.${tag.validUntil}"`;
}

// The tag says the client's copy is current while the data version, SGT day,
// household and deploy all match, and until the earliest moment the answer
// would change on its own (a future-dated entry going live, a packet expiring).
function clientCopyIsCurrent(ifNoneMatch: string | null, current: Omit<DashboardTag, "validUntil">, nowMs: number): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const match = /^(?:W\/)?"dv1\.([^.]+)\.([0-9a-f]{16})\.([^.]+)\.(\d{4}-\d{2}-\d{2})\.(\d+)"$/.exec(candidate.trim());
    return match != null
      && match[1] === BUILD_ID
      && match[2] === current.householdHash
      && match[3] === current.dataVersion
      && match[4] === current.sgtDate
      && nowMs < Number(match[5]);
  });
}

/** Counter bumped by triggers on every dashboard input, plus SQLite's schema version. Null before the migration. */
async function readDataVersion(db: ReturnType<typeof createDB>): Promise<string | null> {
  try {
    const result = await db.execute(
      "SELECT version, (SELECT schema_version FROM pragma_schema_version) AS schema_version FROM dashboard_version WHERE id = 1",
    );
    const row = result.rows[0];
    return row ? `${Number(row.version)}-${Number(row.schema_version)}` : null;
  } catch {
    return null;
  }
}

const NO_STORE = { "Cache-Control": "private, no-store" };
// Vercel's edge drops If-None-Match on the way to functions, so the client
// sends its tag in this header too, and "unchanged" is a 204 rather than a 304.
const DASHBOARD_TAG_HEADER = "X-Dashboard-Tag";

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({
      babies: [],
      activities: [],
      household: null,
      timers: [],
      measurement: null,
    });
  }

  try {
    const db = createDB();
    const now = new Date();
    const sgtParts = sgtDateFormatter.formatToParts(now);
    const sgtPart = (type: string) => sgtParts.find((part) => part.type === type)?.value ?? "00";
    const sgtDate = [sgtPart("year"), sgtPart("month"), sgtPart("day")].join("-");
    const dayStart = Date.parse(sgtDate + "T00:00:00+08:00");
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const nowMs = now.getTime();

    // Read the version before any data, so a write landing mid-request leaves
    // an older tag on newer data: the next poll then refetches, never the reverse.
    const dataVersion = await readDataVersion(db);
    let tagBase = dataVersion == null ? null : { householdHash: householdHash(householdId), dataVersion, sgtDate };
    const clientTag = request.headers.get(DASHBOARD_TAG_HEADER);
    const ifNoneMatch = request.headers.get("if-none-match");
    if (tagBase && clientCopyIsCurrent(clientTag, tagBase, nowMs)) {
      return new NextResponse(null, { status: 204, headers: { ...NO_STORE, [DASHBOARD_TAG_HEADER]: clientTag!.trim() } });
    }
    if (tagBase && clientCopyIsCurrent(ifNoneMatch, tagBase, nowMs)) {
      return new NextResponse(null, {
        status: 304,
        headers: { ...NO_STORE, ETag: ifNoneMatch!.split(",")[0].trim() },
      });
    }

    // Only hand out a tag while every trigger exists. A table rebuild in some
    // future migration would drop its triggers; it also changes schema_version,
    // so held tags stop matching, and from then on clients get full answers
    // every poll (correct, just not cheap) until the triggers are restored.
    if (tagBase && !await isDashboardVersionSchemaReady(db)) {
      console.error("Dashboard version triggers missing; serving untagged responses");
      tagBase = null;
    }

    const caretakerColumnsPresent = await isCaretakerImportSchemaReady(db);
    const babies = await db.execute({
      sql: "SELECT * FROM babies WHERE household_id = ?",
      args: [householdId],
    });
    const babyRows = babies.rows as unknown as Array<{ id: unknown; name: unknown }>;

    // One indexed, ordered read per baby (LIMIT 50 each) instead of sorting the
    // household's whole history; merged below into the same top 50.
    const recentActivityQueries = babyRows.map((baby) => ({
      sql: `SELECT a.*, b.name as baby_name
            FROM activities a
            JOIN babies b ON b.id = a.baby_id
            WHERE a.baby_id = ?
              AND a.type NOT IN ('bankfreeze', 'bankthaw', 'bankdiscard')
            ORDER BY a.started_at DESC, a.created_at DESC LIMIT ${RECENT_ACTIVITY_LIMIT}`,
      args: [baby.id as string],
    }));

    const [household, timers, measurements, dailyMilk, pumpedLedger, users, sleepActivities, caretakerSleepAudits, ...recentActivityResults] = await db.batch([
      {
        sql: "SELECT * FROM households WHERE id = ?",
        args: [householdId],
      },
      {
        sql: `SELECT t.*, b.name as baby_name
              FROM active_timers t
              JOIN babies b ON t.baby_id = b.id
              WHERE b.household_id = ?`,
        args: [householdId],
      },
      {
        sql: `SELECT m.* FROM measurements m
              JOIN babies b ON m.baby_id = b.id
              WHERE b.household_id = ? AND m.weight_g IS NOT NULL
              ORDER BY m.measured_at DESC, m.created_at DESC LIMIT 1`,
        args: [householdId],
      },
      {
        sql: `SELECT a.type, a.details FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type IN (?, ?)
                AND a.started_at >= ?
                AND a.started_at < ?`,
        args: [householdId, "bottlefeed", "pump", dayStart, dayEnd],
      },
      {
        sql: `SELECT a.id, a.baby_id, a.type, a.details, a.started_at, a.created_at FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type IN (?, ?, ?, ?, ?, ?)
              ORDER BY a.started_at ASC, a.created_at ASC`,
        args: [householdId, "bottlefeed", "pump", "bankadjust", "bankfreeze", "bankthaw", "bankdiscard"],
      },
      {
        sql: "SELECT name FROM users WHERE household_id = ?",
        args: [householdId],
      },
      {
        sql: `SELECT a.id, a.baby_id, a.started_at, a.ended_at
              FROM activities a JOIN babies b ON b.id = a.baby_id
              WHERE b.household_id = ? AND a.type = 'sleep'
              ORDER BY (a.ended_at IS NULL) DESC, COALESCE(a.ended_at, a.started_at) DESC`,
        args: [householdId],
      },
      {
        sql: caretakerColumnsPresent ? `SELECT baby_id, audit_metadata
              FROM paper_log_import_batches
              WHERE household_id = ? AND source_kind = 'caretaker_screenshot'
                AND status = 'committed' AND audit_metadata IS NOT NULL
              ORDER BY committed_at ASC` : "SELECT NULL AS baby_id, NULL AS audit_metadata WHERE 0",
        args: caretakerColumnsPresent ? [householdId] : [],
      },
      ...recentActivityQueries,
    ], "read");
    const recentActivities = recentActivityResults
      .flatMap((result) => result.rows as unknown as Array<Record<string, unknown> & { created_by?: unknown }>)
      .sort((left, right) =>
        Number(right.started_at) - Number(left.started_at) || Number(right.created_at) - Number(left.created_at))
      .slice(0, RECENT_ACTIVITY_LIMIT);

    const householdRow = household.rows[0];
    const selectedBabyId = babies.rows[0]?.id;
    const childcareMode = selectedBabyId
      ? await loadChildcareModeState(db, householdId, String(selectedBabyId))
      : { schemaReady: await isChildcareModeSchemaReady(db), activeSession: null, pendingSessions: [] };
    const recentMilkFeeds = selectRecentMilkFeeds(
      pumpedLedger.rows as unknown as RecentMilkFeedActivity[],
      selectedBabyId,
      now.getTime(),
      3,
    );
    const dailyMilkTotals = dailyMilk.rows.reduce((total, row) => {
      const typedRow = row as unknown as { type: string; details: string | null; started_at?: number };
      const details = parseActivityDetails(typedRow.details);
      if (typedRow.type === "pump") {
        total.pumpedMl += pumpAmount(details);
        return total;
      }

      const volumes = bottleVolumes(details);
      total.breastmilkMl += volumes.breastmilkMl;
      total.formulaMl += volumes.formulaMl;
      return total;
    }, { breastmilkMl: 0, formulaMl: 0, pumpedMl: 0 });
    const dailyMilkMl = dailyMilkTotals.breastmilkMl + dailyMilkTotals.formulaMl;

    const ledgerEvents: MilkLedgerActivity[] = pumpedLedger.rows.map((row) => {
      const typedRow = row as unknown as { id: string; type: string; details: string | null; started_at?: number; created_at?: number };
      return {
        id: String(typedRow.id),
        type: String(typedRow.type),
        startedAt: Number(typedRow.started_at),
        createdAt: Number(typedRow.created_at),
        details: parseActivityDetails(typedRow.details),
      };
    });
    const bankState = replayMilkLedger(ledgerEvents, now.getTime(), new Set(ledgerEvents.map((event) => event.id)));
    const pumpEvents = ledgerEvents.filter((event) => event.type === "pump");
    const latestPump = pumpEvents[pumpEvents.length - 1];
    const totalPumpedMl = pumpEvents.reduce((sum, event) => sum + pumpAmount(event.details), 0);
    const breastmilkConsumedMl = ledgerEvents
      .filter((event) => event.type === "bottlefeed")
      .reduce((sum, event) => sum + bottleBreastmilkLibraryDeduction(event.details), 0);
    const pumpedMilkBatches = bankState.availableBatches.map((batch) => ({
      id: batch.id,
      addedAt: batch.addedAt,
      pumpedAt: batch.addedAt,
      amountMl: batch.amountMl,
      remainingMl: batch.remainingMl,
      isAdjustment: batch.source === "adjustment",
      source: batch.source,
    }));
    // Earliest moment this answer changes with no new write: SGT midnight, a
    // future-dated ledger entry (bank and recent feeds skip those) going live,
    // or a frozen packet passing its expiry.
    const validUntil = Math.min(
      dayEnd,
      nowMs + TAG_MAX_AGE_MS,
      ...ledgerEvents.map((event) => event.startedAt).filter((at) => at > nowMs),
      ...bankState.frozenPackets.map((packet) => packet.expiresAt).filter((at) => at > nowMs),
    );
    const latestWeightG = Number((measurements.rows[0] as { weight_g?: unknown } | undefined)?.weight_g);
    const expectedMilkMl = Number.isFinite(latestWeightG)
      ? Math.round((latestWeightG / 1000) * 150)
      : null;

    return NextResponse.json({
      babies: babies.rows,
      activities: normalizeActivityCreators(
        recentActivities,
        users.rows as unknown as Array<{ name?: unknown }>,
      ),
      household: householdRow
        ? {
            id: householdRow.id,
            inviteCode: householdRow.invite_code,
            createdAt: householdRow.created_at,
          }
        : null,
      childcareMode,
      timers: timers.rows,
      sleepActivities: sleepActivities.rows,
      sleepCoverages: caretakerSleepAudits.rows.flatMap((row) => {
        const coverage = caretakerSleepCoverageFromAudit(row.audit_metadata);
        return coverage ? [{ baby_id: String(row.baby_id), ...coverage }] : [];
      }),
      measurement: measurements.rows[0] ?? null,
      dailyMilk: {
        date: sgtDate,
        totalMl: dailyMilkMl,
        breastmilkMl: dailyMilkTotals.breastmilkMl,
        formulaMl: dailyMilkTotals.formulaMl,
        pumpedMl: dailyMilkTotals.pumpedMl,
        expectedMl: expectedMilkMl,
      },
      recentMilkFeeds,
      pumpedMilk: {
        walletMl: bankState.availableMl,
        availableMl: bankState.availableMl,
        frozenMl: bankState.frozenMl,
        frozenPackets: bankState.frozenPackets,
        bankHistory: bankState.history,
        totalPumpedMl,
        breastmilkConsumedMl,
        lastPumpMl: latestPump ? pumpAmount(latestPump.details) : 0,
        lastPumpAt: latestPump?.startedAt ?? null,
        batches: pumpedMilkBatches,
      },
    }, {
      headers: tagBase
        ? { ...NO_STORE, ETag: formatTag({ ...tagBase, validUntil }), [DASHBOARD_TAG_HEADER]: formatTag({ ...tagBase, validUntil }) }
        : NO_STORE,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
