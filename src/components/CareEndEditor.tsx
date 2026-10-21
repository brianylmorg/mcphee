"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

export type CareEndSaveResult = { session: ChildcareSessionSummary } | { error: string };

/** "HH:MM" Singapore time for an instant. */
function sgTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** "YYYY-MM-DD" Singapore date for an instant. */
function sgDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type CareEndValidation = { ok: true; checkedOutAt: number } | { ok: false; message: string };

/**
 * A corrected check-out is a Singapore time on the check-in day, after check-in
 * and not later than now. Overlaps and imported naps are checked by the server.
 */
export function validateCareEnd(checkedInAt: number, time: string, now = Date.now()): CareEndValidation {
  if (!/^\d{2}:\d{2}$/.test(time)) return { ok: false, message: "Enter the check-out time." };
  const checkedOutAt = Date.parse(`${sgDate(checkedInAt)}T${time}:00+08:00`);
  if (!Number.isFinite(checkedOutAt)) return { ok: false, message: "Enter the check-out time." };
  if (checkedOutAt <= checkedInAt) {
    return { ok: false, message: `Check-out must be after check-in (${sgTime(checkedInAt)}).` };
  }
  if (checkedOutAt > now + 60 * 1000) return { ok: false, message: "Check-out can't be later than now." };
  return { ok: true, checkedOutAt };
}

/**
 * The recorded check-out of a closed childcare stay, with an inline editor to
 * correct it. The check-in time is kept; the parent persists the change.
 */
export default function CareEndEditor({
  session,
  disabled = false,
  disabledReason,
  onSave,
}: {
  session: ChildcareSessionSummary & { checkedOutAt: number };
  disabled?: boolean;
  /** Shown instead of the editor while editing isn't possible (e.g. unsaved review edits). */
  disabledReason?: string;
  onSave: (checkedOutAt: number) => Promise<CareEndSaveResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = () => {
    setValue(sgTime(session.checkedOutAt));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    const validation = validateCareEnd(session.checkedInAt, value);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    if (validation.checkedOutAt === session.checkedOutAt) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(validation.checkedOutAt).catch(() => ({ error: "Could not save the check-out time. Try again." }));
    setSaving(false);
    if ("error" in result) setError(result.error);
    else setEditing(false);
  };

  if (!editing) {
    return (
      <div className="mt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-muted">Care end <span className="font-semibold tabular-nums text-warm-brown">{sgTime(session.checkedOutAt)}</span> · From check-out</p>
          <button
            type="button"
            onClick={open}
            disabled={disabled || Boolean(disabledReason)}
            aria-label="Edit check-out time"
            className="hit-44 inline-flex min-h-8 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-semibold text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-45"
          >
            <Pencil aria-hidden="true" className="h-3 w-3" />
            Edit
          </button>
        </div>
        {disabledReason && <p className="mt-1 text-xs text-muted">{disabledReason}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <label className="block text-sm font-semibold">Check-out time (Singapore)
        <input
          type="time"
          required
          autoFocus
          value={value}
          disabled={saving}
          onChange={event => { setValue(event.target.value); setError(null); }}
          className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-accent-strong/45"
        />
      </label>
      <p className="mt-1 text-xs text-muted">Changes the check-out time for this stay. Check-in stays at {sgTime(session.checkedInAt)}.</p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => { void save(); }} disabled={saving || value === ""} className="min-h-11 rounded-xl bg-terracotta-dark px-4 text-sm font-semibold text-on-accent disabled:opacity-45">
          {saving ? "Saving…" : "Save check-out"}
        </button>
        <button type="button" onClick={() => { setEditing(false); setError(null); }} disabled={saving} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-warm-brown disabled:opacity-45">
          Cancel
        </button>
      </div>
    </div>
  );
}
