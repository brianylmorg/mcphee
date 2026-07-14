import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { householdExists } from "@/lib/db/household";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

// GET /api/users/me - get current user
export async function GET(request: NextRequest) {
  const userId = request.cookies.get("mcphee_user")?.value;
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!userId || !householdId) {
    return NextResponse.json({ user: null });
  }

  try {
    const db = createDB();
    const result = await db.execute({
      sql: "SELECT * FROM users WHERE id = ? AND household_id = ?",
      args: [userId, householdId],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ user: null });
    }

    const user = result.rows[0];
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        householdId: user.household_id,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/users - create or join user in household
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = createDB();

    // Get household from cookie
    const householdId = request.cookies.get("mcphee_hh")?.value;
    if (!householdId) {
      return NextResponse.json({ error: "No household found" }, { status: 401 });
    }

    if (!(await householdExists(db, householdId))) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    // If user already exists with this household cookie, return existing
    if (body.action === "get-or-create") {
      const existingUserId = request.cookies.get("mcphee_user")?.value;
      if (existingUserId) {
        const existing = await db.execute({
          sql: "SELECT * FROM users WHERE id = ? AND household_id = ?",
          args: [existingUserId, householdId],
        });
        if (existing.rows.length > 0) {
          return NextResponse.json({ user: existing.rows[0] });
        }
      }

      // Create new user
      if (!body.name) {
        return NextResponse.json({ error: "Name required" }, { status: 400 });
      }

      const newUserId = generateId();
      await db.execute({
        sql: "INSERT INTO users (id, household_id, name, created_at) VALUES (?, ?, ?, ?)",
        args: [newUserId, householdId, body.name, Date.now()],
      });

      const response = NextResponse.json({ id: newUserId, name: body.name, householdId });
      response.cookies.set("mcphee_user", newUserId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("User API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const userId = request.cookies.get("mcphee_user")?.value;
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!userId || !householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const db = createDB();

    const result = await db.execute({
      sql: "UPDATE users SET name = ? WHERE id = ? AND household_id = ?",
      args: [body.name.trim(), userId, householdId],
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}