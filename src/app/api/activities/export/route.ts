import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold } from "@/lib/db/household";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";
import { normalizeActivityCreators } from "@/lib/activity-creators";

export const runtime = "nodejs";

type ActivityRow = Record<string, unknown>;

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[,"\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function parseDetails(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const sgtExportFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatSgt(timestamp: unknown): string {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "";
  const parts = sgtExportFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return part("year") + "-" + part("month") + "-" + part("day") + " " + part("hour") + ":" + part("minute") + ":" + part("second") + " SGT";
}

function activityLabel(type: unknown): string {
  if (type === "bottlefeed") return "Bottlefeed";
  if (type === "breastfeed") return "Breastfeed";
  if (type === "diaper") return "Diaper";
  if (type === "vomit") return "Vomit";
  if (type === "pump") return "Pump";
  if (type === "bankadjust") return "Bank adjustment";
  if (typeof type === "string" && type.length > 0) return type.charAt(0).toUpperCase() + type.slice(1);
  return "";
}

function milkTypeLabel(value: unknown): string {
  if (value === "formula") return "Formula";
  if (value === "breastmilk") return "Breast milk";
  return "";
}

function sideLabel(value: unknown): string {
  if (value === "L") return "Left side";
  if (value === "R") return "Right side";
  if (value === "both") return "Both sides";
  return typeof value === "string" ? value : "";
}

function numericMl(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function amountCalculation(details: Record<string, unknown>): string {
  if (Array.isArray(details.feeds)) {
    const values = details.feeds.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const feed = item as Record<string, unknown>;
      const expression = typeof feed.amountExpression === "string" ? feed.amountExpression.trim() : "";
      if (!expression) return [];
      const label = details.feeds && Array.isArray(details.feeds) && details.feeds.length > 1
        ? milkTypeLabel(feed.milkType) + ": "
        : "";
      return [label + expression + " ml"];
    });
    if (values.length > 0) return values.join(" | ");
  }

  return typeof details.amountExpression === "string" && details.amountExpression.trim()
    ? details.amountExpression.trim() + " ml"
    : "";
}

function peeUnitsLabel(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  if (/^[1-5]$/.test(raw)) return raw + " unit" + (raw === "1" ? "" : "s");
  if (raw === "M") return "3 units";
  if (raw === "L") return "5 units";
  return "";
}

function displayFields(type: unknown, details: Record<string, unknown>) {
  if (type === "bottlefeed") {
    let breastmilkAmount = 0;
    let formulaAmount = 0;
    if (Array.isArray(details.feeds)) {
      details.feeds.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const feed = item as Record<string, unknown>;
        const amount = numericMl(feed.amount);
        if (feed.milkType === "formula") formulaAmount += amount;
        else if (feed.milkType === "breastmilk") breastmilkAmount += amount;
      });
    } else {
      const amount = numericMl(details.amount);
      breastmilkAmount = numericMl(details.breastmilkAmount);
      formulaAmount = numericMl(details.formulaAmount);
      if (breastmilkAmount === 0 && formulaAmount === 0 && amount > 0) {
        if (details.milkType === "formula") formulaAmount = amount;
        else breastmilkAmount = amount;
      }
    }

    const quantityParts = [
      breastmilkAmount > 0 ? "Breast milk " + breastmilkAmount + " ml" : "",
      formulaAmount > 0 ? "Formula " + formulaAmount + " ml" : "",
    ].filter(Boolean);
    return {
      activity: "Bottlefeed",
      subcategory: breastmilkAmount > 0 && formulaAmount > 0 ? "Breast milk + formula" : breastmilkAmount > 0 ? "Breast milk" : formulaAmount > 0 ? "Formula" : milkTypeLabel(details.milkType),
      quantity: quantityParts.join(" | "),
    };
  }

  if (type === "breastfeed") {
    return { activity: "Breastfeed", subcategory: sideLabel(details.side), quantity: "" };
  }

  if (type === "pump") {
    const amount = details.amount != null && details.amount !== "" ? Number(details.amount) : null;
    return {
      activity: "Pump",
      subcategory: sideLabel(details.side),
      quantity: amount != null && Number.isFinite(amount) ? String(amount) + " ml" : "",
    };
  }

  if (type === "diaper") {
    const peeUnits = peeUnitsLabel(details.peeUnits ?? details.peeSize);
    const poopSize = details.poop === "M" || details.poop === "L" ? String(details.poop) : "";
    const hasPee = Boolean(peeUnits);
    const hasPoop = Boolean(poopSize);
    return {
      activity: "Diaper",
      subcategory: hasPee && hasPoop ? "Pee + poop" : hasPee ? "Pee" : hasPoop ? "Poop" : "Diaper change",
      quantity: [hasPee ? peeUnits : "", hasPoop ? "poop " + poopSize : ""].filter(Boolean).join(" | "),
    };
  }

  if (type === "vomit") {
    const labels: Record<string, string> = {
      projectile: "Projectile",
      "dribble-milk": "Dribble milk",
      "dribble-beancurd": "Dribble beancurd",
    };
    return { activity: "Vomit", subcategory: labels[String(details.vomitType)] || "", quantity: "" };
  }

  if (type === "bankadjust") {
    const amount = Number(details.amount);
    const target = Number(details.targetBankMl);
    return {
      activity: "Bank adjustment",
      subcategory: Number.isFinite(target) ? "Reconciled to " + target + " ml" : "",
      quantity: Number.isFinite(amount) && amount !== 0 ? (amount > 0 ? "+" : "") + amount + " ml" : "",
    };
  }

  if (type === "temperature") {
    const methods: Record<string, string> = {
      armpit: "Armpit", ear: "Ear", oral: "Oral", rectal: "Rectal", forehead: "Forehead", other: "Other",
    };
    const celsius = Number(details.celsius);
    return {
      activity: "Temperature",
      subcategory: methods[String(details.method)] || "",
      quantity: Number.isFinite(celsius) ? celsius + " °C" : "",
    };
  }

  return { activity: activityLabel(type), subcategory: "", quantity: "" };
}

function safeFilename(value: unknown): string {
  const name = String(value || "baby").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return name || "baby";
}

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = createDB();
    const { searchParams } = new URL(request.url);
    const babyId = searchParams.get("babyId");
    if (!babyId) {
      return NextResponse.json({ error: "babyId is required" }, { status: 400 });
    }

    const babyError = await requireBabyInHousehold(db, babyId, householdId);
    if (babyError) return babyError;

    const [result, users] = await db.batch([
      {
        sql: "SELECT a.*, b.name as baby_name FROM activities a JOIN babies b ON a.baby_id = b.id WHERE b.household_id = ? AND a.baby_id = ? ORDER BY a.started_at ASC, a.created_at ASC",
        args: [householdId, babyId],
      },
      { sql: "SELECT name FROM users WHERE household_id = ?", args: [householdId] },
    ], "read");
    const activityRows = normalizeActivityCreators(
      result.rows as unknown as Array<ActivityRow & { created_by?: unknown }>,
      users.rows as unknown as Array<{ name?: unknown }>,
    );

    const headers = [
      "baby_name",
      "activity_id",
      "activity_type",
      "activity",
      "subcategory",
      "quantity",
      "notes",
      "amount_calculation",
      "breastmilk_library_deduction_ml",
      "started_at_sgt",
      "started_at_epoch_ms",
      "ended_at_sgt",
      "ended_at_epoch_ms",
      "entered_by",
      "milk_type",
      "amount_ml",
      "breastmilk_amount_ml",
      "formula_amount_ml",
      "side",
      "pee_units",
      "poop_size",
      "vomit_type",
      "temperature_celsius",
      "temperature_method",
      "raw_details",
    ];

    const rows = activityRows.map((row: ActivityRow) => {
      const details = parseDetails(row.details);
      const display = displayFields(row.type, details);
      return [
        row.baby_name,
        row.id,
        row.type,
        display.activity,
        display.subcategory,
        display.quantity,
        details.notes,
        amountCalculation(details),
        row.type === "bottlefeed" ? bottleBreastmilkLibraryDeduction(details) : "",
        formatSgt(row.started_at),
        row.started_at,
        formatSgt(row.ended_at),
        row.ended_at,
        row.created_by,
        milkTypeLabel(details.milkType),
        details.amount,
        details.breastmilkAmount,
        details.formulaAmount,
        sideLabel(details.side),
        peeUnitsLabel(details.peeUnits ?? details.peeSize),
        details.poop,
        details.vomitType,
        details.celsius,
        details.method,
        JSON.stringify(details),
      ].map(csvCell).join(",");
    });

    const babyName = activityRows[0]?.baby_name ?? "baby";
    const csv = [headers.map(csvCell).join(","), ...rows].join("\n") + "\n";

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"" + safeFilename(babyName) + "-activity-history.csv\"",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Activity export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
