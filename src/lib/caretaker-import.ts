import { validateActivityInput } from "./activity-input";
import {
  CARETAKER_IMPORT_LOW_CONFIDENCE,
  type CaretakerActivityDraft,
  type CaretakerImportIssue,
  type CaretakerImportRow,
  type CaretakerOcrLine,
  type CaretakerOriginClassification,
} from "./caretaker-import-contract";

type Section = "milk" | "diaper" | "nap" | "solids" | null;
type ParsedGroup = {
  lines: CaretakerOcrLine[];
  draft: CaretakerActivityDraft;
  issues: CaretakerImportIssue[];
};

const TIME_RE = /\b(\d{1,2})\s*[:.]\s*(\d{2})\s*([ap])\s*\.?\s*m\.?\b/i;
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;

export function isRealDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function singaporeTimestamp(dateKey: string, sourceTime: string): number | null {
  if (!isRealDateKey(dateKey)) return null;
  const match = TIME_RE.exec(sourceTime);
  if (!match) return null;
  const sourceHour = Number(match[1]);
  const minute = Number(match[2]);
  if (sourceHour < 1 || sourceHour > 12 || minute < 0 || minute > 59) return null;
  let hour = sourceHour % 12;
  if (match[3].toLowerCase() === "p") hour += 12;
  const timestamp = Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function singaporeDateKey(timestamp = Date.now()): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp + SINGAPORE_OFFSET_MS).toISOString().slice(0, 10);
}

function issue(code: CaretakerImportIssue["code"], message: string, blocking = true): CaretakerImportIssue {
  return { code, message, blocking };
}

function normalizeText(value: string): string {
  return value.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function sectionFor(text: string): Section | undefined {
  if (/past\s+milk\s+feeds?/i.test(text)) return "milk";
  if (/past\s+diaper\s+changes?/i.test(text)) return "diaper";
  if (/past\s+nap\s+times?/i.test(text)) return "nap";
  if (/past\s+solid|solid\s*\/\s*pending|solid\s+foods?/i.test(text)) return "solids";
  if (/pending\s+updates?/i.test(text)) return "solids";
  return undefined;
}

function isMetadata(text: string): boolean {
  return /\b(?:added|edited)\s*:?\s*by\b/i.test(text);
}

function isKnownDecorationOrTitle(text: string): boolean {
  const title = normalizeText(text).toLowerCase();
  return /^(?:milk|a wik|a solid|solid|& diaper|diaper|z{1,2}|© nap|nap)$/.test(title);
}

function groupOrigin(lines: CaretakerOcrLine[]): CaretakerOriginClassification {
  if (lines.some((line) => line.origin.classification === "household")) return "household";
  if (lines.some((line) => line.origin.classification === "uncertain")) return "uncertain";
  return "caretaker";
}

function groupIssues(lines: CaretakerOcrLine[]): CaretakerImportIssue[] {
  const issues: CaretakerImportIssue[] = [];
  const confidence = Math.min(...lines.map((line) => line.confidence));
  const origin = groupOrigin(lines);
  if (confidence < CARETAKER_IMPORT_LOW_CONFIDENCE) {
    issues.push(issue("LOW_CONFIDENCE", "OCR confidence is low; confirm or correct this entry."));
  }
  if (origin === "household") {
    issues.push(issue("SOURCE_HOUSEHOLD", "Household entry (blue) — excluded."));
  } else if (origin === "uncertain") {
    issues.push(issue("ORIGIN_UNCERTAIN", "Source colour is uncertain; resolve the origin or exclude this entry."));
  }
  return issues;
}

function draftIssues(draft: CaretakerActivityDraft, babyId = "candidate", now = Date.now()): CaretakerImportIssue[] {
  const issues: CaretakerImportIssue[] = [];
  const validation = validateActivityInput({
    babyId,
    type: draft.type,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    details: draft.details,
  }, now);
  if (validation) issues.push(issue("INVALID_DETAILS", validation));
  if (draft.startedAt > now + FUTURE_CLOCK_SKEW_MS) {
    issues.push(issue("INVALID_TIME", "Activity time cannot be in the future."));
  }

  if (draft.type === "bottlefeed") {
    const milkType = draft.details.milkType;
    const amount = Number(draft.details.amount);
    if ((milkType !== "breastmilk" && milkType !== "formula") || !Number.isFinite(amount) || amount <= 0) {
      issues.push(issue("INVALID_DETAILS", "A consumed amount and explicit milk type are required."));
    }
  } else if (draft.type === "diaper") {
    const peeUnits = Number(draft.details.peeUnits);
    const wet = peeUnits > 0;
    const poo = ["yes", "M", "L"].includes(String(draft.details.poop));
    if (!Number.isInteger(peeUnits) || peeUnits < 0 || peeUnits > 5
        || !["no", "yes", "M", "L"].includes(String(draft.details.poop))) {
      issues.push(issue("INVALID_DETAILS", "Pee units must be a whole number from 0 to 5 and poo contents must be specified."));
    }
    if (!wet && !poo) issues.push(issue("INVALID_DETAILS", "The source must explicitly show wet or poo."));
  } else if (draft.type === "sleep" && draft.endedAt == null) {
    issues.push(issue("MISSING_END", "Nap end time is missing; correct it or exclude this entry."));
  } else if (draft.type === "sleep" && draft.endedAt! <= draft.startedAt) {
    issues.push(issue("INVALID_TIME", "Nap end time must be after its start."));
  }
  return dedupeIssues(issues);
}

function dedupeIssues(issues: CaretakerImportIssue[]): CaretakerImportIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTimedGroups(
  lines: CaretakerOcrLine[],
  dateKey: string,
  section: Exclude<Section, "nap" | null>,
): ParsedGroup[] {
  const chunks: CaretakerOcrLine[][] = [];
  let current: CaretakerOcrLine[] = [];
  const contains = (items: CaretakerOcrLine[], pattern: RegExp) => items.some((item) => pattern.test(item.text));
  const repeatsActivityFact = (items: CaretakerOcrLine[], next: CaretakerOcrLine) => {
    if (section === "milk") {
      return (/\b\d+(?:\.\d+)?\s*m\s*l\b/i.test(next.text) && contains(items, /\b\d+(?:\.\d+)?\s*m\s*l\b/i))
        || (/breast\s*milk|\bformula\b/i.test(next.text) && contains(items, /breast\s*milk|\bformula\b/i));
    }
    if (section === "diaper") {
      return (/\bwet\b/i.test(next.text) && contains(items, /\bwet\b/i))
        || (/\b(?:poo|poop|bowel\s+movement)\b/i.test(next.text)
          && contains(items, /\b(?:poo|poop|bowel\s+movement)\b/i));
    }
    return false;
  };
  for (const line of lines) {
    if ((TIME_RE.test(line.text) || repeatsActivityFact(current, line)) && current.length > 0) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(current);

  const results: ParsedGroup[] = [];
  for (const chunk of chunks) {
    const text = chunk.map((line) => line.text).join(" ");
    const startedAt = singaporeTimestamp(dateKey, text);
    const common = groupIssues(chunk);
    if (startedAt == null) {
      common.push(issue("MISSING_TIME", "Activity time is missing; correct it or exclude this entry."));
    }
    const activityStart = startedAt ?? Date.parse(`${dateKey}T00:00:00+08:00`);

    if (section === "milk") {
      const amountMatches = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*m\s*l\b/gi)];
      const amountMatch = amountMatches[0];
      const milkTypeMatches = text.match(/breast\s*milk|\bformula\b/gi) ?? [];
      const milkType = /breast\s*milk/i.test(text)
        ? "breastmilk"
        : /\bformula\b/i.test(text)
          ? "formula"
          : null;
      const draft: CaretakerActivityDraft = {
        type: "bottlefeed",
        startedAt: activityStart,
        endedAt: null,
        details: {
          ...(milkType ? { milkType } : {}),
          ...(amountMatch ? { amount: Number(amountMatch[1]) } : {}),
        },
        note: null,
      };
      if (amountMatches.length > 1 || milkTypeMatches.length > 1) {
        common.push(issue("UNSUPPORTED_LAYOUT", "Multiple feed values were read together; correct or exclude this entry."));
      }
      results.push({ lines: chunk, draft, issues: dedupeIssues([...common, ...draftIssues(draft)]) });
    } else if (section === "diaper") {
      const wet = /\bwet\b/i.test(text);
      const poo = /\b(?:poo|poop|bowel\s+movement)\b/i.test(text)
        && !/\b(?:no|not|without)\s+(?:poo|poop|bowel\s+movement)\b/i.test(text);
      const draft: CaretakerActivityDraft = {
        type: "diaper",
        startedAt: activityStart,
        endedAt: null,
        details: {
          peeUnits: wet ? "3" : "0",
          peeUnitsSource: wet ? "McPhee default from source Wet" : undefined,
          poop: poo ? "yes" : "no",
        },
        note: null,
      };
      const wetMatches = text.match(/\bwet\b/gi) ?? [];
      const pooMatches = text.match(/\b(?:poo|poop|bowel\s+movement)\b/gi) ?? [];
      if (wetMatches.length > 1 || pooMatches.length > 1) {
        common.push(issue("UNSUPPORTED_LAYOUT", "Multiple diaper values were read together; correct or exclude this entry."));
      }
      results.push({ lines: chunk, draft, issues: dedupeIssues([...common, ...draftIssues(draft)]) });
    } else {
      const entryText = normalizeText(text.replace(TIME_RE, "").replace(/^[\s:\-]+/, ""));
      if (!entryText || /pending\s+updates?/i.test(entryText)) continue;
      const draft: CaretakerActivityDraft = {
        type: "note",
        startedAt: activityStart,
        endedAt: null,
        details: { notes: `Solids: ${entryText}` },
        note: null,
      };
      results.push({ lines: chunk, draft, issues: dedupeIssues([...common, ...draftIssues(draft)]) });
    }
  }
  return results;
}

type NapEndpoint = { kind: "start" | "end"; at: number | null; lines: CaretakerOcrLine[] };

function parseNapGroups(lines: CaretakerOcrLine[], dateKey: string): ParsedGroup[] {
  const endpoints: NapEndpoint[] = [];
  let pendingTime: CaretakerOcrLine | null = null;
  for (const line of lines) {
    const kind = /nap\s*start/i.test(line.text)
      ? "start"
      : /nap\s*end/i.test(line.text)
        ? "end"
        : null;
    const hasTime = TIME_RE.test(line.text);
    if (kind) {
      const endpointLines = pendingTime && pendingTime !== line ? [pendingTime, line] : [line];
      endpoints.push({ kind, at: singaporeTimestamp(dateKey, endpointLines.map((item) => item.text).join(" ")), lines: endpointLines });
      pendingTime = null;
    } else if (hasTime) {
      pendingTime = line;
    }
  }

  const results: ParsedGroup[] = [];
  for (let index = 0; index < endpoints.length;) {
    const first = endpoints[index];
    const second = endpoints[index + 1];
    let start = first.kind === "start" ? first : second?.kind === "start" ? second : null;
    let end = first.kind === "end" ? first : second?.kind === "end" ? second : null;
    let consumed = 1;
    if (second && first.kind !== second.kind) consumed = 2;
    else if (first.kind === "end") start = null;
    else end = null;
    index += consumed;

    const sourceLines = [...(first.lines ?? []), ...(consumed === 2 ? second.lines : [])];
    const fallbackStart = Date.parse(`${dateKey}T00:00:00+08:00`);
    const draft: CaretakerActivityDraft = {
      type: "sleep",
      startedAt: start?.at ?? fallbackStart,
      endedAt: end?.at ?? null,
      details: {},
      note: null,
    };
    const issues = groupIssues(sourceLines);
    if (!start?.at) issues.push(issue("MISSING_TIME", "Nap start time is missing; correct it or exclude this entry."));
    if (!end?.at) issues.push(issue("MISSING_END", "Nap end time is missing; correct it or exclude this entry."));
    issues.push(...draftIssues(draft));
    results.push({ lines: sourceLines, draft, issues: dedupeIssues(issues) });
  }
  return results;
}

function addNapOverlapIssues(groups: ParsedGroup[]): void {
  const sleeps = groups.filter((group) => group.draft.type === "sleep" && groupOrigin(group.lines) !== "household");
  for (let left = 0; left < sleeps.length; left++) {
    for (let right = left + 1; right < sleeps.length; right++) {
      const a = sleeps[left].draft;
      const b = sleeps[right].draft;
      const aEnd = a.endedAt ?? Number.MAX_SAFE_INTEGER;
      const bEnd = b.endedAt ?? Number.MAX_SAFE_INTEGER;
      if (a.startedAt < bEnd && b.startedAt < aEnd) {
        const overlapIssue = issue("NAP_OVERLAP", "This nap overlaps another included nap; correct or exclude one entry.");
        sleeps[left].issues = dedupeIssues([...sleeps[left].issues, overlapIssue]);
        sleeps[right].issues = dedupeIssues([...sleeps[right].issues, overlapIssue]);
      }
    }
  }
}

export function parseCaretakerOcrLines(lines: CaretakerOcrLine[], dateKey: string): CaretakerImportRow[] {
  if (!isRealDateKey(dateKey)) throw new Error("Invalid Singapore activity date");
  const ordered = [...lines]
    .map((line) => ({ ...line, text: normalizeText(line.text) }))
    .filter((line) => line.text && !isMetadata(line.text) && !isKnownDecorationOrTitle(line.text))
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

  const bySection: Record<Exclude<Section, null>, CaretakerOcrLine[]> = {
    milk: [],
    diaper: [],
    nap: [],
    solids: [],
  };
  let section: Section = null;
  const unassigned: CaretakerOcrLine[] = [];
  for (const line of ordered) {
    const heading = sectionFor(line.text);
    if (heading !== undefined) {
      section = heading;
      continue;
    }
    if (section) bySection[section].push(line);
    else unassigned.push(line);
  }

  const groups = [
    ...parseTimedGroups(bySection.milk, dateKey, "milk"),
    ...parseTimedGroups(bySection.diaper, dateKey, "diaper"),
    ...parseNapGroups(bySection.nap, dateKey),
    ...parseTimedGroups(bySection.solids, dateKey, "solids"),
  ];
  if (unassigned.length > 0) {
    const sourceStart = singaporeTimestamp(dateKey, unassigned.map((line) => line.text).join(" "));
    const fallbackStart = sourceStart ?? Date.parse(`${dateKey}T00:00:00+08:00`);
    groups.push({
      lines: unassigned,
      draft: {
        type: "note",
        startedAt: fallbackStart,
        endedAt: null,
        details: { notes: unassigned.map((line) => line.text).join(" ") },
        note: null,
      },
      issues: dedupeIssues([
        ...groupIssues(unassigned),
        ...(sourceStart == null ? [issue("MISSING_TIME", "Activity time is missing; correct it or exclude this entry.")] : []),
        issue("UNSUPPORTED_LAYOUT", "Some source text is outside a recognized activity section; correct or exclude it."),
      ]),
    });
  }
  addNapOverlapIssues(groups);

  return groups.map((group, rowIndex) => {
    const origin = groupOrigin(group.lines);
    const confidence = Math.min(...group.lines.map((line) => line.confidence));
    const blocking = group.issues.some((entry) => entry.blocking);
    return {
      id: "",
      rowIndex,
      status: origin === "household" ? "blue_excluded" : blocking ? "needs_review" : "staged",
      sourceLineIds: group.lines.map((line) => line.id),
      sourceText: group.lines.map((line) => line.text).join("\n"),
      confidence,
      origin,
      originEvidence: group.lines.map((line) => line.origin),
      draft: group.draft,
      issues: group.issues,
      exclusionReason: origin === "household" ? "Household entry (blue) — excluded" : null,
      duplicateActivityId: null,
      conflictActivityId: null,
      canInclude: origin !== "household" && !blocking,
      lowConfidenceConfirmed: false,
    } satisfies CaretakerImportRow;
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

export function canonicalCaretakerActivity(draft: CaretakerActivityDraft): string {
  const details = { ...draft.details };
  // Review controls and ordinary logging can encode the same quantity as a
  // string or number. Source-default labels are audit data, not diaper content.
  delete details.peeUnitsSource;
  for (const key of ["amount", "peeUnits"]) {
    const value = details[key];
    if ((typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
        && Number.isFinite(Number(value))) details[key] = Number(value);
  }
  const note = draft.note ?? (typeof details.notes === "string" ? details.notes : null);
  if (details.notes === note) delete details.notes;
  return JSON.stringify(stableValue({
    type: draft.type,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    details,
    note,
  }));
}

export function compareCaretakerActivities(
  left: CaretakerActivityDraft,
  right: CaretakerActivityDraft,
): "exact" | "conflict" | "none" {
  if (left.type !== right.type) return "none";
  const distance = Math.abs(left.startedAt - right.startedAt);
  if (distance > 60_000) return "none";
  if (left.startedAt === right.startedAt && canonicalCaretakerActivity(left) === canonicalCaretakerActivity(right)) {
    return "exact";
  }
  return "conflict";
}

export function validateCaretakerDraft(
  draft: CaretakerActivityDraft,
  babyId: string,
  now = Date.now(),
  expectedDateKey?: string,
): CaretakerImportIssue[] {
  const issues = draftIssues(draft, babyId, now);
  if (expectedDateKey && singaporeDateKey(draft.startedAt) !== expectedDateKey) {
    issues.push(issue("INVALID_TIME", "Activity start time must be on the screenshot's selected Singapore date."));
  }
  return dedupeIssues(issues);
}

export function findNapOverlaps(drafts: CaretakerActivityDraft[]): Set<number> {
  const overlaps = new Set<number>();
  for (let left = 0; left < drafts.length; left++) {
    if (drafts[left].type !== "sleep") continue;
    for (let right = left + 1; right < drafts.length; right++) {
      if (drafts[right].type !== "sleep") continue;
      const leftEnd = drafts[left].endedAt ?? Number.MAX_SAFE_INTEGER;
      const rightEnd = drafts[right].endedAt ?? Number.MAX_SAFE_INTEGER;
      if (drafts[left].startedAt < rightEnd && drafts[right].startedAt < leftEnd) {
        overlaps.add(left);
        overlaps.add(right);
      }
    }
  }
  return overlaps;
}
