import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { POST as postActivity } from "@/app/api/activities/route";
import { POST as postSleepState } from "@/app/api/sleep-state/route";
import {
  DIAPER_DETAILS, feedDetails, firstBaby, innerRequest, MAX_FEED_ML, MIN_FEED_ML,
  NO_STORE, relay, watchConfig, watchStatus,
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
    if (body.action === "sleep" || body.action === "wake") {
      result = await relay(await postSleepState(innerRequest(request, "/api/sleep-state", config, {
        babyId: baby.id,
        action: body.action,
        at: now,
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
        startedAt: now,
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
        startedAt: now,
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
    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch (error) {
    console.error("Watch action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
