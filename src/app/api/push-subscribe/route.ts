import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { subscription, label } = body;
    const db = createDB();

    const existing = await db.execute({
      sql: "SELECT id FROM push_subscriptions WHERE household_id = ? AND endpoint = ?",
      args: [householdId, subscription.endpoint],
    });

    if (existing.rows.length > 0) {
      await db.execute({
        sql: "UPDATE push_subscriptions SET p256dh = ?, auth = ?, label = ? WHERE id = ?",
        args: [
          subscription.keys.p256dh,
          subscription.keys.auth,
          label || null,
          (existing.rows[0] as unknown as { id: string }).id,
        ],
      });
      return NextResponse.json({ updated: true });
    }

    const id = generateId();
    await db.execute({
      sql: "INSERT INTO push_subscriptions (id, household_id, endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, householdId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, label || null],
    });

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Push subscribe error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get("endpoint");
    const db = createDB();

    await db.execute({
      sql: "DELETE FROM push_subscriptions WHERE household_id = ? AND endpoint = ?",
      args: [householdId, endpoint],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Push unsubscribe error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
