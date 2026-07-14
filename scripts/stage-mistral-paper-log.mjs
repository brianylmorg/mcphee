#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_INPUT = "/home/cluser/.openclaw/workspace/mcphee-imports/mistral-review.csv";
const DEFAULT_OUT = "/home/cluser/.openclaw/workspace/mcphee-imports/staged/mistral-paper-log-stage.json";
const DEFAULT_SUMMARY = "/home/cluser/.openclaw/workspace/mcphee-imports/staged/mistral-paper-log-stage-summary.md";
const DEFAULT_TZ_OFFSET = "+08:00";

const CONFIRMED_REVIEW_ROWS = new Map([
  ["2026-06-09|feed|1800|7", "B confirmed one 1800 feed: 70ml breastmilk + 30ml formula"],
  ["2026-06-09|feed|1920|8", "B confirmed import 30ml only; ignore thrown 50ml and OCR trailing 70ml"],
  ["2026-06-18|feed|0730|3", "B confirmed use 0730; 45ml breastmilk + 30ml formula"],
]);

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}

function asInt(value) {
  if (value == null || value === "") return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function sourceKey(row) {
  return `${row.date}|${row.section}|${row.time}|${row.row_no}`;
}

function sourceRef(row) {
  return `mistral:${row.date}:${row.section}:${row.time}:row${row.row_no}:batch${row.batch}:page${row.pageIndex}`;
}

function timestampMs(date, time, tzOffset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time)) {
    throw new Error(`Invalid date/time: ${date} ${time}`);
  }
  const hh = time.slice(0, 2);
  const mm = time.slice(2, 4);
  const value = Date.parse(`${date}T${hh}:${mm}:00${tzOffset}`);
  if (!Number.isFinite(value)) throw new Error(`Invalid timestamp: ${date} ${time} ${tzOffset}`);
  return value;
}

function includeReason(row) {
  if (row.needs_review === "False") return "clean_post_fix";
  return CONFIRMED_REVIEW_ROWS.get(sourceKey(row)) ?? null;
}

function feedActivities(row, startedAt, reason) {
  const breastmilkMl = asInt(row.breastmilk_ml);
  const formulaMl = asInt(row.formula_ml);
  const latchMinutes = asInt(row.latch_minutes);
  const rows = [];

  if (breastmilkMl != null) {
    rows.push({
      sourceRef: `${sourceRef(row)}:breastmilk`,
      confidence: row.needs_review === "False" ? 100 : 90,
      type: "bottlefeed",
      startedAt,
      details: { amount: breastmilkMl, milkType: "breastmilk" },
      note: reason,
      rawText: row.raw_row,
    });
  }
  if (formulaMl != null) {
    rows.push({
      sourceRef: `${sourceRef(row)}:formula`,
      confidence: row.needs_review === "False" ? 100 : 90,
      type: "bottlefeed",
      startedAt,
      details: { amount: formulaMl, milkType: "formula" },
      note: reason,
      rawText: row.raw_row,
    });
  }
  if (latchMinutes != null) {
    rows.push({
      sourceRef: `${sourceRef(row)}:latch`,
      confidence: row.needs_review === "False" ? 100 : 90,
      type: "breastfeed",
      startedAt,
      endedAt: startedAt + latchMinutes * 60_000,
      details: { side: "unknown", minutes: latchMinutes },
      note: reason,
      rawText: row.raw_row,
    });
  }
  return rows;
}

function diaperActivities(row, startedAt, reason) {
  const peeText = row.pee_text.trim();
  const poopText = row.poop_text.trim();
  if (!peeText && !poopText) return [];
  const details = {
    peeSize: peeText ? "M" : "no",
    poop: poopText ? "M" : "no",
    peeText: peeText || null,
    poopText: poopText || null,
  };
  return [{
    sourceRef: `${sourceRef(row)}:diaper`,
    confidence: row.needs_review === "False" ? 100 : 90,
    type: "diaper",
    startedAt,
    details,
    note: reason,
    rawText: row.raw_row,
  }];
}

function duplicateKey(activity) {
  const d = activity.details ?? {};
  const discriminator = activity.type === "bottlefeed" ? `${d.milkType}:${d.amount}` : JSON.stringify(d);
  return `${activity.startedAt}|${activity.type}|${discriminator}`;
}

function increment(map, key, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

const input = resolve(argValue("--input", DEFAULT_INPUT));
const out = resolve(argValue("--out", DEFAULT_OUT));
const summaryPath = resolve(argValue("--summary", DEFAULT_SUMMARY));
const tzOffset = argValue("--tz-offset", DEFAULT_TZ_OFFSET);

const sourceRows = parseCsv(await readFile(input, "utf8"));
const activities = [];
const excluded = [];
const includedSourceRows = [];
const skippedIncludedRows = [];

for (const row of sourceRows) {
  const reason = includeReason(row);
  if (!reason) {
    excluded.push({ key: sourceKey(row), date: row.date, section: row.section, needsReview: row.needs_review, reason: row.reason });
    continue;
  }

  const startedAt = timestampMs(row.date, row.time, tzOffset);
  const converted = row.section === "feed"
    ? feedActivities(row, startedAt, reason)
    : row.section === "diaper"
      ? diaperActivities(row, startedAt, reason)
      : [];

  if (converted.length === 0) {
    skippedIncludedRows.push({ key: sourceKey(row), date: row.date, section: row.section, reason: "included source row produced no importable activity" });
    continue;
  }
  includedSourceRows.push(row);
  activities.push(...converted);
}

const seen = new Map();
const duplicateStageKeys = [];
for (const activity of activities) {
  const key = duplicateKey(activity);
  if (seen.has(key)) duplicateStageKeys.push({ key, firstSourceRef: seen.get(key), duplicateSourceRef: activity.sourceRef });
  else seen.set(key, activity.sourceRef);
}

const rowsByDate = {};
const rowsBySection = {};
const activitiesByDate = {};
const activitiesByType = {};
for (const row of includedSourceRows) {
  increment(rowsByDate, row.date);
  increment(rowsBySection, row.section);
}
for (const activity of activities) {
  const date = activity.sourceRef.split(":")[1];
  increment(activitiesByDate, date);
  increment(activitiesByType, activity.type);
}

const artifact = {
  generatedAt: new Date().toISOString(),
  source: input,
  timezoneOffset: tzOffset,
  policy: {
    include: "needs_review=False post-fix rows plus hard-coded B-confirmed review corrections only",
    exclude: "all unreviewed needs_review=True rows",
    dbWrites: false,
  },
  confirmedReviewRows: Object.fromEntries(CONFIRMED_REVIEW_ROWS),
  summary: {
    sourceRows: sourceRows.length,
    cleanSourceRows: sourceRows.filter((row) => row.needs_review === "False").length,
    reviewSourceRows: sourceRows.filter((row) => row.needs_review === "True").length,
    includedSourceRows: includedSourceRows.length,
    confirmedReviewSourceRows: includedSourceRows.filter((row) => row.needs_review === "True").length,
    excludedReviewRows: excluded.filter((row) => row.needsReview === "True").length,
    skippedIncludedRows: skippedIncludedRows.length,
    stagedActivities: activities.length,
    duplicateStageKeys: duplicateStageKeys.length,
    rowsBySection,
    activitiesByType,
    rowsByDate,
    activitiesByDate,
  },
  duplicateStageKeys,
  skippedIncludedRows,
  excludedReviewRows: excluded.filter((row) => row.needsReview === "True"),
  rows: activities,
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`);

const summary = `# Mistral paper-log staging dry run\n\nGenerated: ${artifact.generatedAt}\nSource: ${input}\nTimezone offset: ${tzOffset}\n\n## Gate policy\n\n- Include only post-fix \`needs_review=False\` rows plus hard-coded B-confirmed correction rows.\n- Exclude every other \`needs_review=True\` row.\n- This script performs no DB/network writes; it only emits dry-run artifacts.\n\n## Counts\n\n- Source rows: ${artifact.summary.sourceRows}\n- Clean source rows: ${artifact.summary.cleanSourceRows}\n- Review source rows: ${artifact.summary.reviewSourceRows}\n- Included source rows: ${artifact.summary.includedSourceRows}\n- Confirmed review rows included: ${artifact.summary.confirmedReviewSourceRows}\n- Unreviewed review rows excluded: ${artifact.summary.excludedReviewRows}\n- Staged API activity rows: ${artifact.summary.stagedActivities}\n- Duplicate stage keys: ${artifact.summary.duplicateStageKeys}\n\n## Included source rows by section\n\n${Object.entries(rowsBySection).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Staged activities by type\n\n${Object.entries(activitiesByType).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Duplicate-key handling\n\nDuplicate stage keys use \`startedAt|type|milkType:amount\` for bottle feeds and \`startedAt|type|details\` for diapers. They are reported but not collapsed, because same-time breastmilk/formula split rows are intentional and the existing API handles DB duplicate detection against already-imported activities during staging.\n\nDuplicate stage keys found: ${duplicateStageKeys.length}\n\n## API body shape\n\nUse \`.rows\` from ${out} as the \`rows\` array for \`POST /api/admin/import-paper-log?action=stage\`.\n\nDry-run regenerate command:\n\n\`node scripts/stage-mistral-paper-log.mjs --input ${input} --out ${out} --summary ${summaryPath}\`\n\nStage command template, when B is ready to write staging rows:

\`node -e 'const fs=require("fs"); const stage=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify({action:"stage", householdId:process.env.HOUSEHOLD_ID, babyId:process.env.BABY_ID, sourceNote:"Mistral paper-log gated import", createdBy:"Agrippa", rows:stage.rows}))' ${out} | curl -sS -X POST "$MCPHEE_BASE_URL/api/admin/import-paper-log?key=$MIGRATION_KEY" -H 'content-type: application/json' --data-binary @-\`

Commit command template, after reviewing staged rows in McPhee and marking rows reviewed:\n\n\`curl -sS -X POST "$MCPHEE_BASE_URL/api/admin/import-paper-log?key=$MIGRATION_KEY" -H 'content-type: application/json' --data '{"action":"commit","batchId":"'$BATCH_ID'","createdBy":"Agrippa","confirmation":"I reviewed these rows against the source paper logs"}'\`\n`;

await writeFile(summaryPath, summary);
console.log(JSON.stringify({ out, summary: summaryPath, counts: artifact.summary }, null, 2));
