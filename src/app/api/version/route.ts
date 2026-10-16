import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The release currently live, so an installed app can tell it is out of date. */
export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
