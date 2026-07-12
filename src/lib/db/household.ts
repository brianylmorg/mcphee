import { NextResponse } from "next/server";
import { createDB } from "@/db";

type DB = ReturnType<typeof createDB>;

export async function babyBelongsToHousehold(
  db: DB,
  babyId: string | null | undefined,
  householdId: string
): Promise<boolean> {
  if (!babyId) return false;

  const result = await db.execute({
    sql: "SELECT id FROM babies WHERE id = ? AND household_id = ? LIMIT 1",
    args: [babyId, householdId],
  });

  return result.rows.length > 0;
}

export async function requireBabyInHousehold(
  db: DB,
  babyId: string | null | undefined,
  householdId: string
): Promise<NextResponse | null> {
  const ok = await babyBelongsToHousehold(db, babyId, householdId);
  if (ok) return null;

  return NextResponse.json({ error: "Baby not found" }, { status: 404 });
}

export async function userNameForHousehold(
  db: DB,
  userId: string | null | undefined,
  householdId: string
): Promise<string | null> {
  if (!userId) return null;

  const result = await db.execute({
    sql: "SELECT name FROM users WHERE id = ? AND household_id = ? LIMIT 1",
    args: [userId, householdId],
  });

  if (result.rows.length === 0) return null;
  return (result.rows[0] as unknown as { name: string }).name;
}
