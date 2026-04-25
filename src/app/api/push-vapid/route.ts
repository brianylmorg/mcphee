import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json(
      { error: "VAPID_PUBLIC_KEY not set. Add it to your environment variables and redeploy." },
      { status: 503 }
    );
  }
  return NextResponse.json({ publicKey });
}
