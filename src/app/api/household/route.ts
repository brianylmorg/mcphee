import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId, generateInviteCode } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = createDB();

    const result = await db.execute({
      sql: "SELECT * FROM households WHERE id = ?",
      args: [householdId],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const household = result.rows[0];
    return NextResponse.json({
      id: household.id,
      inviteCode: household.invite_code,
      createdAt: household.created_at,
    });
  } catch (error) {
    console.error("Get household error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = createDB();

    if (body.action === "create") {
      const householdId = generateId();
      const inviteCode = generateInviteCode();

      await db.execute({
        sql: "INSERT INTO households (id, invite_code, created_at) VALUES (?, ?, ?)",
        args: [householdId, inviteCode, Date.now()],
      });

      const babyId = generateId();
      await db.execute({
        sql: "INSERT INTO babies (id, household_id, name, birth_date, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [babyId, householdId, body.name || "Baby", body.birthDate || null, Date.now()],
      });

      const response = NextResponse.json({
        householdId,
        inviteCode,
        babyId,
      });

      response.cookies.set("mcphee_hh", householdId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });

      return response;
    }

    if (body.action === "join") {
      const { inviteCode } = body;

      const result = await db.execute({
        sql: "SELECT id FROM households WHERE invite_code = ?",
        args: [inviteCode],
      });

      const rows = result.rows as unknown as { id: string }[];
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Invalid invite code" },
          { status: 401 }
        );
      }

      const householdId = rows[0].id;

      const response = NextResponse.json({ householdId });

      response.cookies.set("mcphee_hh", householdId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });

      return response;
    }

    if (body.action === "leave") {
      const response = NextResponse.json({ success: true });
      response.cookies.set("mcphee_hh", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      response.cookies.set("mcphee_user", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Household API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
