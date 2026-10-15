import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { applyCaretakerImportSchema, isCaretakerImportSchemaReady, purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import {
  CARETAKER_IMPORT_MAX_JSON_BYTES,
  CARETAKER_IMPORT_MAX_REQUEST_BYTES,
  type CaretakerOcrLine,
} from "@/lib/caretaker-import-contract";
import { GET as getImport } from "./route";
import { POST as stageImport } from "./stage/route";
import { PATCH as reviewImport } from "./review/route";
import { POST as commitImport } from "./commit/route";
import { GET as getSource } from "./source/route";
import { GET as getLegacyImport } from "../admin/import-paper-log/route";
import { DELETE as deleteActivity } from "../activities/route";
import { hasPaperLogImportSourceKind } from "@/db/caretaker-import-schema";

const NOW = Date.parse("2026-10-14T18:00:00+08:00");
const at = (time: string) => Date.parse(`2026-10-14T${time}:00+08:00`);

async function createBaseSchema(client: Client) {
  for (const sql of [
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, baby_id TEXT NOT NULL, status TEXT NOT NULL, source_note TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, row_index INTEGER NOT NULL, status TEXT NOT NULL, source_ref TEXT, confidence INTEGER, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT, imported_activity_id TEXT, created_at INTEGER NOT NULL)",
  ]) await client.execute(sql);
  await client.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "ABC123", NOW] },
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-2", "XYZ789", NOW] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent One", NOW] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-2", "house-2", "Parent Two", NOW] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby One", NOW] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-2", "house-2", "Baby Two", NOW] },
    { sql: "INSERT INTO activities VALUES (?, ?, 'pump', ?, NULL, ?, ?, ?)", args: ["pump-1", "baby-1", at("06:00"), JSON.stringify({ amount: 500 }), at("06:00"), "Parent One"] },
  ], "write");
}

function line(id: string, y: number, text: string, origin: "caretaker" | "household" | "uncertain" = "caretaker", confidence = 0.98): CaretakerOcrLine {
  return {
    id, text, confidence,
    bounds: { x: 10, y, width: 250, height: 24 },
    origin: { classification: origin, confidence: 0.95, blueRatio: origin === "household" ? 0.8 : 0 },
  };
}

function milkLines(amount = 130, time = "9:00 a.m.", options: { blue?: boolean; low?: boolean } = {}) {
  const origin = options.blue ? "household" as const : "caretaker" as const;
  return [
    line("heading", 0, "Past Milk Feeds"),
    line("time", 10, time, origin),
    line("amount", 20, `${amount} ml`, origin, options.low ? 0.6 : 0.98),
    line("type", 30, "Breast Milk", origin),
  ];
}

function multiMilkLines() {
  return [
    line("heading", 0, "Past Milk Feeds"),
    line("time-1", 10, "12:00 p.m."), line("amount-1", 20, "130 ml", "caretaker", 0.65), line("type-1", 30, "Breast Milk"),
    line("time-2", 40, "4:55 a.m.", "household"), line("amount-2", 50, "120 ml", "household"), line("type-2", 60, "Breast Milk", "household"),
  ];
}

function duplicateWithinUploadLines() {
  return [
    line("heading", 0, "Past Milk Feeds"),
    line("time-1", 10, "10:00 a.m."), line("amount-1", 20, "80 ml"), line("type-1", 30, "Formula"),
    line("time-2", 40, "10:00 a.m."), line("amount-2", 50, "80 ml"), line("type-2", 60, "Formula"),
  ];
}

function overlappingNapLines() {
  return [
    line("heading", 0, "Past Nap Times"),
    line("end-time-1", 10, "12:40 p.m."), line("end-1", 20, "Nap End"),
    line("start-time-1", 30, "10:10 a.m."), line("start-1", 40, "Nap Start"),
    line("end-2", 50, "Nap End"),
    line("start-time-2", 60, "12:15 p.m."), line("start-2", 70, "Nap Start"),
  ];
}

function napLines() {
  return [
    line("heading", 0, "Past Nap Times"),
    line("end-time", 10, "3:00 p.m."), line("end", 20, "- Nap End"),
    line("start-time", 30, "2:00 p.m."), line("start", 40, "- Nap Start"),
  ];
}

function imageBytes(suffix = 0) {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, suffix]);
}

function request(
  path: string,
  init: RequestInit = {},
  options: { household?: string; user?: string; origin?: string | null } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mcphee_hh=${options.household ?? "house-1"}; mcphee_user=${options.user ?? "user-1"}`);
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://localhost");
  const { signal, ...rest } = init;
  return new NextRequest(`http://localhost${path}`, { ...rest, ...(signal ? { signal } : {}), headers });
}

function stageRequest(
  lines: CaretakerOcrLine[],
  requestId: string,
  suffix: number,
  options: {
    date?: string;
    babyId?: string;
    household?: string;
    user?: string;
    origin?: string | null;
    paddingBytes?: number;
    declaredContentLength?: string;
  } = {},
) {
  const form = new FormData();
  form.set("babyId", options.babyId ?? "baby-1");
  form.set("date", options.date ?? "2026-10-14");
  form.set("requestId", requestId);
  form.set("lines", JSON.stringify(lines));
  form.set("image", new File([imageBytes(suffix)], "synthetic.png", { type: "image/png" }));
  if (options.paddingBytes) form.set("padding", "x".repeat(options.paddingBytes));
  return request("/api/caretaker-import/stage", {
    method: "POST",
    body: form,
    ...(options.declaredContentLength ? { headers: { "content-length": options.declaredContentLength } } : {}),
  }, options);
}

function jsonRequest(path: string, method: string, body: unknown, options = {}) {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, options);
}

test("caretaker import is household-bound, reviewed, replay-safe, ledger-safe, and purges private source", async () => {
  const originalNow = Date.now;
  Date.now = () => NOW;
  const dbPath = `/tmp/mcphee-caretaker-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  try {
    await createBaseSchema(client);
    const unavailable = await getImport(request("/api/caretaker-import?batchId=missing", { method: "GET" }));
    assert.equal(unavailable.status, 200);
    assert.equal((await unavailable.json()).schemaReady, false);
    assert.equal(await isCaretakerImportSchemaReady(client), false, "GET never migrates");

    await applyCaretakerImportSchema(client);
    await applyCaretakerImportSchema(client);
    assert.equal(await isCaretakerImportSchemaReady(client), true);

    const csrf = await stageImport(stageRequest(multiMilkLines(), "stage-csrf-0001", 1, { origin: "https://evil.example" }));
    assert.equal(csrf.status, 403);
    const missingOrigin = await stageImport(stageRequest(multiMilkLines(), "stage-csrf-0002", 1, { origin: null }));
    assert.equal(missingOrigin.status, 403);
    const wrongMember = await stageImport(stageRequest(multiMilkLines(), "stage-member-001", 1, { user: "user-2" }));
    assert.equal(wrongMember.status, 401);
    const foreignBaby = await stageImport(stageRequest(multiMilkLines(), "stage-foreign-01", 2, { babyId: "baby-2" }));
    assert.equal(foreignBaby.status, 404);
    const futureDate = await stageImport(stageRequest(milkLines(), "stage-futuredate", 2, { date: "2026-10-15" }));
    assert.equal(futureDate.status, 400);
    const oversized = await stageImport(stageRequest(milkLines(), "stage-oversized", 2, {
      paddingBytes: CARETAKER_IMPORT_MAX_REQUEST_BYTES,
      declaredContentLength: "1",
    }));
    assert.equal(oversized.status, 413, "the streamed body limit does not trust a missing or false Content-Length");

    const stagedResponse = await stageImport(stageRequest(multiMilkLines(), "stage-main-0001", 3));
    assert.equal(stagedResponse.status, 200);
    const staged = await stagedResponse.json();
    const batchId = String(staged.batch.id);
    assert.equal(staged.idempotent, false);
    assert.equal(staged.rows.length, 2);
    const grey = staged.rows.find((row: { origin: string }) => row.origin === "caretaker");
    const blue = staged.rows.find((row: { origin: string }) => row.origin === "household");
    assert.equal(grey.status, "needs_review");
    assert.equal(blue.status, "blue_excluded");

    const foreignReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId, expectedRevision: 1, rows: [],
    }, { household: "house-2", user: "user-2" }));
    assert.equal(foreignReview.status, 404);
    const foreignCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, requestId: "commit-foreign01", expectedRevision: 1,
    }, { household: "house-2", user: "user-2" }));
    assert.equal(foreignCommit.status, 404);

    const replayStage = await stageImport(stageRequest(multiMilkLines(), "stage-main-0001", 3));
    assert.equal(replayStage.status, 200);
    const replayStageBody = await replayStage.json();
    assert.equal(replayStageBody.idempotent, true);
    assert.equal(replayStageBody.batch.expiresAt, staged.batch.expiresAt, "retry does not reset retention");
    const dateConflict = await stageImport(stageRequest(multiMilkLines(), "stage-otherdate", 3, { date: "2026-10-13" }));
    assert.equal(dateConflict.status, 409);
    assert.equal((await dateConflict.json()).code, "SCREENSHOT_DATE_CONFLICT");

    const crossUploadDuplicate = await stageImport(stageRequest(milkLines(130, "12:00 p.m."), "stage-crossdup", 10));
    assert.equal(crossUploadDuplicate.status, 200);
    assert.equal((await crossUploadDuplicate.json()).rows[0].status, "duplicate", "overlapping staged screenshots deduplicate");
    const withinUploadDuplicate = await stageImport(stageRequest(duplicateWithinUploadLines(), "stage-withindup", 11));
    assert.equal(withinUploadDuplicate.status, 200);
    assert.deepEqual(
      (await withinUploadDuplicate.json()).rows.map((row: { status: string }) => row.status),
      ["staged", "duplicate"],
      "rows within one screenshot deduplicate",
    );

    const foreignRead = await getImport(request(`/api/caretaker-import?batchId=${batchId}`, {}, { household: "house-2", user: "user-2" }));
    assert.equal(foreignRead.status, 404);
    const source = await getSource(request(`/api/caretaker-import/source?batchId=${batchId}`));
    assert.equal(source.status, 200);
    assert.deepEqual(new Uint8Array(await source.arrayBuffer()), imageBytes(3));

    const blueOverride = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId, expectedRevision: 1,
      rows: [{ id: grey.id, action: "include", confirmLowConfidence: true }, { id: blue.id, action: "include" }],
    }));
    assert.equal(blueOverride.status, 409);
    assert.equal((await blueOverride.json()).code, "BLUE_ENTRY_LOCKED");

    const oversizedReview = await reviewImport(request("/api/caretaker-import/review", {
      method: "PATCH",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: JSON.stringify({ batchId, expectedRevision: 1, rows: [], padding: "x".repeat(CARETAKER_IMPORT_MAX_JSON_BYTES) }),
    }));
    assert.equal(oversizedReview.status, 413, "review JSON is stream-bounded even with a false Content-Length");

    const oversizedCommit = await commitImport(request("/api/caretaker-import/commit", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: JSON.stringify({ batchId, expectedRevision: 1, requestId: "commit-oversized", padding: "x".repeat(CARETAKER_IMPORT_MAX_JSON_BYTES) }),
    }));
    assert.equal(oversizedCommit.status, 413, "commit JSON is stream-bounded even with a false Content-Length");

    const unconfirmed = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId, expectedRevision: 1,
      rows: [{ id: grey.id, action: "include" }, { id: blue.id, action: "exclude" }],
    }));
    assert.equal(unconfirmed.status, 200);
    const unconfirmedBody = await unconfirmed.json();
    assert.equal(unconfirmedBody.batch.revision, 2);
    assert.equal(unconfirmedBody.rows.find((row: { id: string }) => row.id === grey.id).status, "needs_review");
    const premature = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, requestId: "commit-main-0001", expectedRevision: 2,
    }));
    assert.equal(premature.status, 409);
    assert.equal((await premature.json()).code, "REVIEW_INCOMPLETE");

    const confirmed = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId, expectedRevision: 2,
      rows: [{ id: grey.id, action: "include", confirmLowConfidence: true }, { id: blue.id, action: "exclude" }],
    }));
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).rows.find((row: { id: string }) => row.id === grey.id).status, "reviewed");

    const committedResponse = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, requestId: "commit-main-0001", expectedRevision: 3,
    }));
    assert.equal(committedResponse.status, 200);
    const committed = await committedResponse.json();
    assert.equal(committed.committedCount, 1);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'bottlefeed'")).rows[0].n), 1);
    assert.equal(JSON.parse(String((await client.execute("SELECT details FROM activities WHERE type = 'bottlefeed'")).rows[0].details)).amount, 130);
    const replayCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, requestId: "commit-main-0001", expectedRevision: 3,
    }));
    assert.equal(replayCommit.status, 200);
    assert.equal((await replayCommit.json()).idempotent, true);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'bottlefeed'")).rows[0].n), 1);

    const duplicate = await stageImport(stageRequest(milkLines(130, "12:00 p.m."), "stage-duplicate", 4));
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).rows[0].status, "duplicate");
    const conflict = await stageImport(stageRequest(milkLines(150, "12:00 p.m."), "stage-conflict1", 5));
    assert.equal(conflict.status, 200);
    const conflictBody = await conflict.json();
    assert.equal(conflictBody.rows[0].status, "conflict");
    const correctedConflict = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: conflictBody.batch.id, expectedRevision: 1,
      rows: [{ id: conflictBody.rows[0].id, action: "include", startedAt: at("12:02") }],
    }));
    assert.equal(correctedConflict.status, 200);
    assert.equal((await correctedConflict.json()).rows[0].status, "reviewed", "a material correction clears the near-time conflict");

    const uncertainLines = milkLines(40, "1:00 p.m.").map((item) => ({
      ...item,
      origin: { classification: "uncertain" as const, confidence: 0.2, evidence: "grayscale" },
    }));
    const uncertainStage = await stageImport(stageRequest(uncertainLines, "stage-uncertain", 7));
    const uncertainBody = await uncertainStage.json();
    const invalidResolvedOrigin = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: uncertainBody.batch.id, expectedRevision: 1,
      rows: [{ id: uncertainBody.rows[0].id, action: "include", resolvedOrigin: "not-a-real-origin" }],
    }));
    assert.equal(invalidResolvedOrigin.status, 400);
    assert.equal((await invalidResolvedOrigin.json()).code, "INVALID_REVIEW_ROW");
    const oversizedDetails = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: uncertainBody.batch.id, expectedRevision: 1,
      rows: [{
        id: uncertainBody.rows[0].id,
        action: "include",
        resolvedOrigin: "caretaker",
        details: { nested: { too: { deeply: { for: { review: true } } } } },
      }],
    }));
    assert.equal(oversizedDetails.status, 400);
    assert.equal((await oversizedDetails.json()).code, "INVALID_REVIEW_ROW");
    const unresolvedOrigin = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: uncertainBody.batch.id, expectedRevision: 1,
      rows: [{ id: uncertainBody.rows[0].id, action: "include" }],
    }));
    assert.equal(unresolvedOrigin.status, 400);
    assert.equal((await unresolvedOrigin.json()).code, "ORIGIN_REQUIRED");
    const resolvedOrigin = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: uncertainBody.batch.id, expectedRevision: 1,
      rows: [{ id: uncertainBody.rows[0].id, action: "include", resolvedOrigin: "caretaker" }],
    }));
    assert.equal(resolvedOrigin.status, 200);
    assert.equal((await resolvedOrigin.json()).rows[0].status, "reviewed");

    const futureTimeStage = await stageImport(stageRequest(milkLines(40, "5:00 p.m."), "stage-futuretime", 14));
    const futureTimeBody = await futureTimeStage.json();
    const futureTimeReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: futureTimeBody.batch.id, expectedRevision: 1,
      rows: [{ id: futureTimeBody.rows[0].id, action: "include", startedAt: at("23:00") }],
    }));
    assert.equal(futureTimeReview.status, 200);
    const futureReviewedRow = (await futureTimeReview.json()).rows[0];
    assert.equal(futureReviewedRow.status, "needs_review");
    assert.ok(futureReviewedRow.issues.some((item: { code: string }) => item.code === "INVALID_TIME"));

    const overlappingNapStage = await stageImport(stageRequest(overlappingNapLines(), "stage-nap-exclude", 12));
    assert.equal(overlappingNapStage.status, 200);
    const overlappingNapBody = await overlappingNapStage.json();
    assert.equal(overlappingNapBody.rows.length, 2);
    assert.ok(overlappingNapBody.rows.every((row: { issues: Array<{ code: string }> }) => row.issues.some((item) => item.code === "NAP_OVERLAP")));
    const clearedNapReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: overlappingNapBody.batch.id, expectedRevision: 1,
      rows: [
        { id: overlappingNapBody.rows[0].id, action: "include" },
        { id: overlappingNapBody.rows[1].id, action: "exclude" },
      ],
    }));
    assert.equal(clearedNapReview.status, 200);
    const clearedNapRows = (await clearedNapReview.json()).rows;
    assert.equal(clearedNapRows[0].status, "reviewed");
    assert.equal(clearedNapRows[0].issues.some((item: { code: string }) => item.code === "NAP_OVERLAP"), false);
    assert.equal(clearedNapRows[1].status, "skipped");

    const napStage = await stageImport(stageRequest(napLines(), "stage-napcheck", 8));
    const napBody = await napStage.json();
    const napReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: napBody.batch.id, expectedRevision: 1,
      rows: [{ id: napBody.rows[0].id, action: "include" }],
    }));
    assert.equal(napReview.status, 200);
    await client.execute({
      sql: "INSERT INTO activities VALUES (?, ?, 'sleep', ?, ?, '{}', ?, ?)",
      args: ["concurrent-sleep", "baby-1", at("14:30"), at("15:30"), NOW, "Parent One"],
    });
    const napCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId: napBody.batch.id, requestId: "commit-napcheck", expectedRevision: 2,
    }));
    assert.equal(napCommit.status, 409);
    assert.equal((await napCommit.json()).code, "NAP_OVERLAP", "sleep overlap is rechecked inside commit transaction");
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM activities WHERE type = 'sleep' AND id != ?", args: ["concurrent-sleep"] })).rows[0].n), 0);

    const historicalStockStage = await stageImport(stageRequest(milkLines(450, "7:00 a.m."), "stage-history-stock", 9));
    const historicalStockBody = await historicalStockStage.json();
    const historicalStockReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: historicalStockBody.batch.id, expectedRevision: 1,
      rows: [{ id: historicalStockBody.rows[0].id, action: "include" }],
    }));
    assert.equal(historicalStockReview.status, 200);
    const beforeHistoricalStockCommit = Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n);
    const historicalStockCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId: historicalStockBody.batch.id, requestId: "commit-history-stock", expectedRevision: 2,
    }));
    assert.equal(historicalStockCommit.status, 400);
    assert.equal((await historicalStockCommit.json()).code, "INSUFFICIENT_BREASTMILK");
    assert.equal(
      Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n),
      beforeHistoricalStockCommit,
      "historical import cannot steal stock from a later persisted feed",
    );
    assert.equal(
      String((await client.execute({ sql: "SELECT status FROM paper_log_import_batches WHERE id = ?", args: [historicalStockBody.batch.id] })).rows[0].status),
      "staged",
    );

    const insufficientStage = await stageImport(stageRequest(milkLines(600, "2:00 p.m."), "stage-shortfall", 6));
    const insufficientBody = await insufficientStage.json();
    const insufficientBatchId = insufficientBody.batch.id;
    const insufficientRow = insufficientBody.rows[0];
    const insufficientReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: insufficientBatchId, expectedRevision: 1,
      rows: [{ id: insufficientRow.id, action: "include" }],
    }));
    assert.equal(insufficientReview.status, 200);
    const beforeFailedCommit = Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n);
    const insufficientCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId: insufficientBatchId, requestId: "commit-shortfall", expectedRevision: 2,
    }));
    assert.equal(insufficientCommit.status, 400);
    assert.equal((await insufficientCommit.json()).code, "INSUFFICIENT_BREASTMILK");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), beforeFailedCommit, "transaction rolls back all activities");
    assert.equal(String((await client.execute({ sql: "SELECT status FROM paper_log_import_batches WHERE id = ?", args: [insufficientBatchId] })).rows[0].status), "staged");

    const expiringStage = await stageImport(stageRequest(milkLines(30, "3:30 p.m."), "stage-expiring", 13));
    assert.equal(expiringStage.status, 200);
    const expiringBody = await expiringStage.json();
    const originalExpiry = Number(expiringBody.batch.expiresAt);
    await client.execute({
      sql: "UPDATE paper_log_import_batches SET expires_at = ? WHERE id = ?",
      args: [NOW - 1, expiringBody.batch.id],
    });
    const expiredReplay = await stageImport(stageRequest(milkLines(30, "3:30 p.m."), "stage-expired-replay", 13));
    assert.equal(expiredReplay.status, 410);
    assert.equal((await expiredReplay.json()).code, "IMPORT_EXPIRED");
    const expiredDateConflict = await stageImport(stageRequest(milkLines(30, "3:30 p.m."), "stage-expired-date", 13, { date: "2026-10-13" }));
    assert.equal(expiredDateConflict.status, 409);
    assert.equal((await expiredDateConflict.json()).code, "SCREENSHOT_DATE_CONFLICT");
    const expiredStored = (await client.execute({
      sql: "SELECT expires_at, COUNT(*) OVER () AS matching_count FROM paper_log_import_batches WHERE household_id = ? AND baby_id = ? AND source_hash = ?",
      args: ["house-1", "baby-1", String((await client.execute({ sql: "SELECT source_hash FROM paper_log_import_batches WHERE id = ?", args: [expiringBody.batch.id] })).rows[0].source_hash)],
    })).rows;
    assert.equal(expiredStored.length, 1, "source hash remains unique after expiry");
    assert.equal(Number(expiredStored[0].expires_at), NOW - 1);
    assert.notEqual(originalExpiry, Number(expiredStored[0].expires_at), "the test fixture expiry was changed without creating a replacement batch");

    await client.execute({ sql: "UPDATE paper_log_import_batches SET expires_at = ? WHERE id = ?", args: [NOW - 1, batchId] });
    const purge = await purgeExpiredCaretakerImports(client, NOW, NOW);
    assert.ok(purge.purgedBatches >= 1);
    const purged = (await client.execute({ sql: "SELECT source_image, draft_metadata, audit_metadata, source_hash FROM paper_log_import_batches WHERE id = ?", args: [batchId] })).rows[0];
    assert.equal(purged.source_image, null);
    assert.equal(purged.draft_metadata, null);
    assert.equal(typeof purged.source_hash, "string");
    assert.equal(String(purged.audit_metadata).includes("130 ml"), false, "retained audit has no OCR text");
    const retainedAudit = JSON.parse(String(purged.audit_metadata));
    assert.equal(typeof retainedAudit.rows[0].canonicalHash, "string");
    assert.equal(retainedAudit.rows[0].origin, "caretaker");
    assert.equal(typeof retainedAudit.rows[0].confidence, "number");
    assert.equal(typeof retainedAudit.rows[0].importedActivityId, "string");
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM paper_log_import_rows WHERE batch_id = ?", args: [batchId] })).rows[0].n), 0);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'bottlefeed'")).rows[0].n), 1, "purge retains committed activities");
  } finally {
    client.close();
    Date.now = originalNow;
  }
});

test("review requires explicit correction of missing times and unsupported source layouts", async () => {
  const originalNow = Date.now;
  const previousUrl = process.env.TURSO_DATABASE_URL;
  const previousToken = process.env.TURSO_AUTH_TOKEN;
  Date.now = () => NOW;
  process.env.TURSO_DATABASE_URL = `file:/tmp/mcphee-caretaker-source-review-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  try {
    await createBaseSchema(client);
    await applyCaretakerImportSchema(client);
    for (const [index, source] of [
      [line("heading", 0, "Past Milk Feeds"), line("amount", 10, "80 ml"), line("type", 20, "Formula")],
      [line("heading", 0, "Past Milk Feeds"), line("fused", 10, "10:00 a.m. 100 ml Formula 150 ml Formula")],
      [line("cropped", 10, "9:00 a.m. 80 ml Formula")],
    ].entries()) {
      const response = await stageImport(stageRequest(source, `source-review-${index}`, 90 + index));
      assert.equal(response.status, 200);
      const staged = await response.json();
      const batchId = staged.batch.id;
      const rowId = staged.rows[0].id;
      const issueCode = index === 0 ? "MISSING_TIME" : "UNSUPPORTED_LAYOUT";
      const save = (expectedRevision: number, changes = {}) => reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
        batchId, expectedRevision, rows: [{ id: rowId, action: "include", confirmLowConfidence: true, ...changes }],
      }));
      const unchanged = await save(1, index === 2 ? { note: staged.rows[0].draft.details.notes } : {});
      assert.equal(unchanged.status, 200);
      const unchangedBody = await unchanged.json();
      assert.equal(unchangedBody.rows[0].status, "needs_review");
      assert.ok(unchangedBody.rows[0].issues.some((issue: { code: string }) => issue.code === issueCode));
      const blocked = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
        batchId, expectedRevision: 2, requestId: `source-commit-${index}`,
      }));
      assert.equal(blocked.status, 409, "confirmation alone cannot clear unresolved source facts");
      const corrected = await save(2, index === 0 ? { startedAt: at("11:00") }
        : index === 1 ? { details: { milkType: "formula", amount: 150 } }
          : { type: "bottlefeed", details: { milkType: "formula", amount: 80 }, note: null });
      assert.equal(corrected.status, 200);
      assert.equal((await corrected.json()).rows[0].status, "reviewed");
      const savedAgain = await save(3);
      assert.equal((await savedAgain.json()).rows[0].status, "reviewed", "a saved correction remains valid on later review");
    }
    const diaperLines = [line("heading", 0, "Past diaper changes"), line("wet", 10, "11:25 a.m. Change Needed, Wet")];
    const diaperStage = await stageImport(stageRequest(diaperLines, "diaper-repeat-stage", 96));
    const diaper = await diaperStage.json();
    const invalidDiaper = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: diaper.batch.id, expectedRevision: 1,
      rows: [{ id: diaper.rows[0].id, action: "include", details: { peeUnits: 99, poop: "no" } }],
    }));
    assert.equal((await invalidDiaper.json()).rows[0].status, "needs_review");
    const diaperReview = await reviewImport(jsonRequest("/api/caretaker-import/review", "PATCH", {
      batchId: diaper.batch.id, expectedRevision: 2,
      rows: [{ id: diaper.rows[0].id, action: "include", details: { ...diaper.rows[0].draft.details, peeUnits: 3 } }],
    }));
    assert.equal(diaperReview.status, 200);
    const diaperCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId: diaper.batch.id, expectedRevision: 3, requestId: "diaper-repeat-commit",
    }));
    assert.equal(diaperCommit.status, 200);
    const repeatedDiaper = await stageImport(stageRequest(diaperLines, "diaper-repeat-second", 97));
    assert.equal(repeatedDiaper.status, 200);
    assert.equal((await repeatedDiaper.json()).rows[0].status, "duplicate", "reviewed numeric pee units remain exact duplicates in overlapping screenshots");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'bottlefeed'")).rows[0].n), 0);
  } finally {
    client.close();
    Date.now = originalNow;
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
  }
});

test("review rejects invalid origin, oversized details and future or changed-date activities; legacy paths stay isolated", async () => {
  const originalNow = Date.now;
  const previousUrl = process.env.TURSO_DATABASE_URL;
  const previousToken = process.env.TURSO_AUTH_TOKEN;
  const previousMigrationKey = process.env.MIGRATION_KEY;
  Date.now = () => NOW;
  process.env.TURSO_DATABASE_URL = `file:/tmp/mcphee-caretaker-boundaries-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.MIGRATION_KEY = "synthetic-caretaker-admin-key";
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  try {
    await createBaseSchema(client);
    await applyCaretakerImportSchema(client);
    const futureDate = await stageImport(stageRequest(milkLines(), "stage-future-date", 80, { date: "2026-10-15" }));
    assert.equal(futureDate.status, 400, "future Singapore dates cannot stage milk whose deduction would be delayed");

    const uncertainLines = milkLines(90, "11:00 a.m.").map(row => ({
      ...row,
      origin: { ...row.origin, classification: "uncertain" as const },
    }));
    const stagedResponse = await stageImport(stageRequest(uncertainLines, "stage-boundaries", 81));
    assert.equal(stagedResponse.status, 200);
    const staged = await stagedResponse.json();
    const batchId = staged.batch.id;
    const rowId = staged.rows[0].id;
    const review = (changes: Record<string, unknown>, expectedRevision = 1) => reviewImport(jsonRequest(
      "/api/caretaker-import/review", "PATCH", {
        batchId, expectedRevision,
        rows: [{ id: rowId, action: "include", resolvedOrigin: "caretaker", ...changes }],
      },
    ));

    assert.equal((await review({ resolvedOrigin: "invalid-origin" })).status, 400);
    assert.equal((await review({ details: { nested: { a: { b: { c: { d: { e: 1 } } } } } } })).status, 400);
    assert.equal((await review({ details: { milkType: "breastmilk", amount: 90, notes: "x".repeat(501) } })).status, 400);
    const oversized = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, expectedRevision: 1, requestId: "commit-large-body", padding: "x".repeat(128 * 1024),
    }));
    assert.equal(oversized.status, 413, "actual JSON body is bounded even without a content-length header");

    const changedDate = await review({ startedAt: Date.parse("2026-10-13T11:00:00+08:00") });
    assert.equal(changedDate.status, 200);
    const changedDateBody = await changedDate.json();
    assert.ok(changedDateBody.rows[0].issues.some((item: { code: string }) => item.code === "INVALID_TIME"));
    const changedDateCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, expectedRevision: 2, requestId: "commit-changed-date",
    }));
    assert.equal(changedDateCommit.status, 409);

    const futureTime = await review({ startedAt: at("23:00") }, 2);
    assert.equal(futureTime.status, 200);
    const futureTimeBody = await futureTime.json();
    assert.ok(futureTimeBody.rows[0].issues.some((item: { code: string }) => item.code === "INVALID_TIME"));
    const futureTimeCommit = await commitImport(jsonRequest("/api/caretaker-import/commit", "POST", {
      batchId, expectedRevision: 3, requestId: "commit-future-time",
    }));
    assert.equal(futureTimeCommit.status, 409);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'bottlefeed'")).rows[0].n), 0);

    await client.execute("DROP INDEX idx_caretaker_import_expiry");
    assert.equal(await isCaretakerImportSchemaReady(client), false);
    const legacy = await getLegacyImport(request(`/api/admin/import-paper-log?key=synthetic-caretaker-admin-key&batchId=${batchId}`));
    assert.equal(legacy.status, 200);
    assert.deepEqual(await legacy.json(), { batch: null, rows: [] }, "partial schema cannot expose private caretaker rows through the legacy importer");
    await assert.rejects(hasPaperLogImportSourceKind({ execute: async () => { throw new Error("synthetic schema inspection failure"); } }), /synthetic schema inspection failure/);
    await applyCaretakerImportSchema(client);

    await client.execute({
      sql: "INSERT INTO activities VALUES (?, ?, 'diaper', ?, NULL, ?, ?, ?)",
      args: ["referenced-diaper", "baby-1", at("10:00"), JSON.stringify({ peeUnits: 3, poop: "no" }), NOW, "Parent One"],
    });
    await client.execute({ sql: "UPDATE paper_log_import_rows SET conflict_activity_id = ? WHERE id = ?", args: ["referenced-diaper", rowId] });
    const deleted = await deleteActivity(request("/api/activities?id=referenced-diaper", { method: "DELETE" }));
    assert.equal(deleted.status, 200);
    assert.equal((await client.execute({ sql: "SELECT conflict_activity_id FROM paper_log_import_rows WHERE id = ?", args: [rowId] })).rows[0].conflict_activity_id, null);
  } finally {
    client.close();
    Date.now = originalNow;
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previousToken;
    if (previousMigrationKey === undefined) delete process.env.MIGRATION_KEY; else process.env.MIGRATION_KEY = previousMigrationKey;
  }
});
