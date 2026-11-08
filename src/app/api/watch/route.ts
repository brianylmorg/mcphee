import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { POST as postActivity, DELETE as deleteActivity } from "@/app/api/activities/route";
import { POST as postSleepState } from "@/app/api/sleep-state/route";
import { isSleepUndoToken } from "@/lib/sleep-transition";
import {
  DIAPER_DETAILS, feedDetails, firstBaby, innerRequest, MAX_FEED_ML, MIN_FEED_ML,
  NO_STORE, parseWatchUndo, relay, sleepUndoString, watchConfig, watchStatus,
} from "@/lib/watch-api";

// Garmin watch companion. The watch cannot hold the household cookie, so it
// sends a bearer token configured in Vercel env vars. Every write is handed
// to the existing activity / sleep-state handlers so their validation, milk
// bank checks and childcare guard stay the single source of truth.

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = watchConfig(request);
  if (config instanceof NextResponse) return config;
  try {
    const status = await watchStatus(createDB(), config.householdId);
    if (!status) return NextResponse.json({ error: "No baby in household" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    console.error("Watch status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  const config = watchConfig(request);
  if (config instanceof NextResponse) return config;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  try {
    const db = createDB();
    const baby = await firstBaby(db, config.householdId);
    if (!baby) return NextResponse.json({ error: "No baby in household" }, { status: 404, headers: NO_STORE });

    let result: Awaited<ReturnType<typeof relay>>;
    const now = Date.now();
    const minutesAgo = body.minutesAgo === undefined ? 0 : body.minutesAgo;
    if ((body.action === "sleep" || body.action === "wake" || body.action === "feed" || body.action === "diaper")
      && (typeof minutesAgo !== "number" || ![0, 5, 15, 30].includes(minutesAgo))) {
      return NextResponse.json({ error: "minutesAgo must be 0, 5, 15 or 30" }, { status: 400, headers: NO_STORE });
    }
    const at = now - (typeof minutesAgo === "number" ? minutesAgo : 0) * 60_000;
    if (body.action === "undo") {
      const undo = parseWatchUndo(body.undo);
      if (!undo) return NextResponse.json({ error: "Invalid undo token" }, { status: 400, headers: NO_STORE });
      if ("activityId" in undo) {
        const eligible = await db.execute({
          sql: `SELECT id FROM activities WHERE id = ? AND baby_id = ?
                AND type IN ('bottlefeed', 'diaper') AND created_at >= ? AND created_at <= ?`,
          args: [undo.activityId, baby.id, now - 10 * 60_000, now],
        });
        if (eligible.rows.length === 0) {
          result = { ok: false, status: 409, error: "Entry is no longer available to undo", code: "UNDO_EXPIRED" };
        } else {
          result = await relay(await deleteActivity(innerRequest(
            request, `/api/activities?id=${encodeURIComponent(undo.activityId)}`, config, undefined, "DELETE",
          )));
        }
      } else {
        result = await relay(await postSleepState(innerRequest(request, "/api/sleep-state", config, {
          babyId: baby.id, action: "undo", undoToken: undo.undoToken,
        })));
      }
    } else if (body.action === "sleep" || body.action === "wake") {
      result = await relay(await postSleepState(innerRequest(request, "/api/sleep-state", config, {
        babyId: baby.id,
        action: body.action,
        at,
      })));
    } else if (body.action === "feed") {
      const milkType = body.milkType === "formula" ? "formula" : body.milkType === "breastmilk" ? "breastmilk" : null;
      const amount = Number(body.amount);
      if (!milkType) return NextResponse.json({ error: "milkType must be breastmilk or formula" }, { status: 400, headers: NO_STORE });
      if (!Number.isInteger(amount) || amount < MIN_FEED_ML || amount > MAX_FEED_ML) {
        return NextResponse.json({ error: `amount must be ${MIN_FEED_ML}-${MAX_FEED_ML} ml` }, { status: 400, headers: NO_STORE });
      }
      result = await relay(await postActivity(innerRequest(request, "/api/activities", config, {
        babyId: baby.id,
        type: "bottlefeed",
        startedAt: at,
        details: feedDetails(milkType, amount),
      })));
    } else if (body.action === "diaper") {
      const kind = body.kind;
      if (kind !== "pee" && kind !== "poo" && kind !== "both") {
        return NextResponse.json({ error: "kind must be pee, poo or both" }, { status: 400, headers: NO_STORE });
      }
      result = await relay(await postActivity(innerRequest(request, "/api/activities", config, {
        babyId: baby.id,
        type: "diaper",
        startedAt: at,
        details: { ...DIAPER_DETAILS[kind] },
      })));
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: NO_STORE });
    }

    // The write is already committed (or refused) here. A failed status read
    // must not turn a saved entry into "Not saved", or a retry would duplicate it.
    let status: Awaited<ReturnType<typeof watchStatus>> = null;
    try {
      status = await watchStatus(db, config.householdId);
    } catch (error) {
      console.error("Watch status refresh error:", error);
    }
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code, status }, { status: result.status, headers: NO_STORE });
    }
    const undo = body.action === "sleep" || body.action === "wake"
      ? (isSleepUndoToken(result.data.undoToken) ? sleepUndoString(result.data.undoToken) : undefined)
      : body.action === "feed" || body.action === "diaper" ? `a:${result.data.id}` : undefined;
    return NextResponse.json({ ok: true, status, undo }, { headers: NO_STORE });
  } catch (error) {
    console.error("Watch action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
