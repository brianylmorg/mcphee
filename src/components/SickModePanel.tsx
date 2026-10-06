"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Droplets, Plus, Thermometer, Trash2, X } from "lucide-react";
import { formatElapsedSince } from "@/lib/elapsed-time";
import { formatDate, formatTime } from "@/lib/utils";
import type { SickDose, SickMedication, SickModeResponse } from "@/lib/sick-mode";

type MedicationDraft = {
  key: string;
  name: string;
  doseText: string;
  asNeeded: boolean;
  minIntervalHours: string;
  maxIntervalHours: string;
};

type Props = {
  babyId: string;
  data: SickModeResponse | null;
  isStale?: boolean;
  onRefresh: () => Promise<void> | void;
};

const EMPTY_MEDICATION = (): MedicationDraft => ({
  key: Math.random().toString(36).slice(2),
  name: "",
  doseText: "",
  asNeeded: true,
  minIntervalHours: "",
  maxIntervalHours: "",
});

function sgtDateTimeInput(timestamp = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function parseSgtDateTime(value: string): number | null {
  const timestamp = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function numericOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function mutateSickMode(payload: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch("/api/sick-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "Could not update sick mode.");
    Object.assign(error, { status: response.status, code: data.code });
    throw error;
  }
  return { ok: true, data };
}

export function isSickModeConflict(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 409 && candidate.code === code;
}

export function buildMedicationUpdatePayload({
  babyId,
  episodeId,
  medicationId,
  expectedRevision,
  draft,
}: {
  babyId: string;
  episodeId: string;
  medicationId: string;
  expectedRevision: number;
  draft: MedicationDraft;
}): Record<string, unknown> {
  return {
    action: "updateMedication",
    babyId,
    episodeId,
    medicationId,
    expectedRevision,
    name: draft.name.trim(),
    doseText: draft.doseText.trim(),
    asNeeded: draft.asNeeded,
    minIntervalHours: numericOrUndefined(draft.minIntervalHours),
    maxIntervalHours: numericOrUndefined(draft.maxIntervalHours),
  };
}

function MedicationFields({
  draft,
  onChange,
  onRemove,
  suggestions,
  removable,
}: {
  draft: MedicationDraft;
  onChange: (draft: MedicationDraft) => void;
  onRemove?: () => void;
  suggestions: string[];
  removable?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-warm-brown-light">
          Medication name
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            list={`sick-medication-suggestions-${draft.key}`}
            placeholder="e.g. Paracetamol"
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-warm-brown outline-none focus:border-accent-strong"
          />
        </label>
        {removable && onRemove && (
          <button type="button" onClick={onRemove} aria-label="Remove medication" className="mt-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-danger">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <label className="mt-3 block text-xs font-medium text-warm-brown-light">
        Prescribed dose
        <input
          value={draft.doseText}
          onChange={(event) => onChange({ ...draft, doseText: event.target.value })}
          placeholder="e.g. 3.5ml"
          className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-warm-brown outline-none focus:border-accent-strong"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-warm-brown-light">
          Earliest interval (hours)
          <input type="number" min="0" step="0.5" inputMode="decimal" value={draft.minIntervalHours} onChange={(event) => onChange({ ...draft, minIntervalHours: event.target.value })} placeholder="4" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base tabular-nums text-warm-brown outline-none focus:border-accent-strong" />
        </label>
        <label className="text-xs font-medium text-warm-brown-light">
          Latest interval (hours)
          <input type="number" min="0" step="0.5" inputMode="decimal" value={draft.maxIntervalHours} onChange={(event) => onChange({ ...draft, maxIntervalHours: event.target.value })} placeholder="6" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base tabular-nums text-warm-brown outline-none focus:border-accent-strong" />
        </label>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-warm-brown">
        <input type="checkbox" checked={draft.asNeeded} onChange={(event) => onChange({ ...draft, asNeeded: event.target.checked })} className="h-5 w-5 rounded border-border text-terracotta-dark" />
        As needed
      </label>
      <datalist id={`sick-medication-suggestions-${draft.key}`}>
        {suggestions.map((name) => <option key={name} value={name} />)}
      </datalist>
    </div>
  );
}

function DoseHistory({
  babyId,
  episodeId,
  medication,
  busy,
  onBusy,
  onChanged,
}: {
  babyId: string;
  episodeId: string;
  medication: SickMedication;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [givenAt, setGivenAt] = useState(() => sgtDateTimeInput());
  const [doseText, setDoseText] = useState(medication.doseText);
  const [editingMedication, setEditingMedication] = useState(false);
  const [medicationEditRevision, setMedicationEditRevision] = useState(medication.revision);
  const [medicationDraft, setMedicationDraft] = useState<MedicationDraft>(() => ({
    key: medication.id,
    name: medication.name,
    doseText: medication.doseText,
    asNeeded: medication.asNeeded,
    minIntervalHours: medication.minIntervalHours == null ? "" : String(medication.minIntervalHours),
    maxIntervalHours: medication.maxIntervalHours == null ? "" : String(medication.maxIntervalHours),
  }));
  const requestAttemptRef = useRef<{ signature: string; id: string; expectedLatestDoseId: string | null } | null>(null);
  const doses = Array.isArray(medication.doses) ? medication.doses : [];

  useEffect(() => {
    if (editingMedication) return;
    setMedicationDraft({
      key: medication.id,
      name: medication.name,
      doseText: medication.doseText,
      asNeeded: medication.asNeeded,
      minIntervalHours: medication.minIntervalHours == null ? "" : String(medication.minIntervalHours),
      maxIntervalHours: medication.maxIntervalHours == null ? "" : String(medication.maxIntervalHours),
    });
    setMedicationEditRevision(medication.revision);
  }, [editingMedication, medication.asNeeded, medication.doseText, medication.id, medication.maxIntervalHours, medication.minIntervalHours, medication.name, medication.revision]);

  const reportError = async (error: unknown) => {
    await onChanged();
    const status = (error as { status?: number }).status;
    alert(status === 409
      ? "This medication changed on another device. The latest details have been loaded."
      : error instanceof Error ? error.message : "Could not update the dose.");
  };

  const submitDose = async () => {
    const timestamp = parseSgtDateTime(givenAt);
    if (timestamp == null || !doseText.trim() || busy) return;
    const signature = `${timestamp}:${doseText.trim()}`;
    if (requestAttemptRef.current?.signature !== signature) {
      requestAttemptRef.current = { signature, id: crypto.randomUUID(), expectedLatestDoseId: medication.latestDose?.id ?? null };
    }
    onBusy(true);
    try {
      await mutateSickMode({
        action: "logDose",
        babyId,
        episodeId,
        medicationId: medication.id,
        givenAt: timestamp,
        doseText: doseText.trim(),
        requestId: requestAttemptRef.current.id,
        expectedLatestDoseId: requestAttemptRef.current.expectedLatestDoseId,
      });
      setGivenAt(sgtDateTimeInput());
      setDoseText(medication.doseText);
      requestAttemptRef.current = null;
      await onChanged();
    } catch (error) {
      if (isSickModeConflict(error, "STALE_MEDICATION_HISTORY")) {
        requestAttemptRef.current = null;
      }
      await reportError(error);
    } finally {
      onBusy(false);
    }
  };

  const saveDose = async (dose: SickDose, nextTime: string, nextText: string, expectedRevision: number) => {
    const timestamp = parseSgtDateTime(nextTime);
    if (timestamp == null || !nextText.trim() || busy) return;
    onBusy(true);
    try {
      await mutateSickMode({ action: "updateDose", babyId, episodeId, medicationId: medication.id, doseId: dose.id, expectedRevision, givenAt: timestamp, doseText: nextText.trim() });
      setEditingId(null);
      await onChanged();
    } catch (error) {
      if (isSickModeConflict(error, "STALE_DOSE")) {
        setEditingId(null);
      }
      await reportError(error);
    } finally {
      onBusy(false);
    }
  };

  const deleteDose = async (dose: SickDose) => {
    if (busy || !confirm("Delete this recorded dose?")) return;
    onBusy(true);
    try {
      await mutateSickMode({ action: "deleteDose", babyId, episodeId, medicationId: medication.id, doseId: dose.id, expectedRevision: dose.revision });
      await onChanged();
    } catch (error) {
      await reportError(error);
    } finally {
      onBusy(false);
    }
  };

  const updateMedication = async () => {
    if (!medicationDraft.name.trim() || !medicationDraft.doseText.trim() || busy) return;
    onBusy(true);
    try {
      await mutateSickMode(buildMedicationUpdatePayload({
        babyId,
        episodeId,
        medicationId: medication.id,
        expectedRevision: medicationEditRevision,
        draft: medicationDraft,
      }));
      setEditingMedication(false);
      setDoseText(medicationDraft.doseText.trim());
      await onChanged();
    } catch (error) {
      if (isSickModeConflict(error, "STALE_MEDICATION")) {
        setEditingMedication(false);
      }
      await reportError(error);
    } finally {
      onBusy(false);
    }
  };

  const beginMedicationEdit = () => {
    setMedicationDraft({
      key: medication.id,
      name: medication.name,
      doseText: medication.doseText,
      asNeeded: medication.asNeeded,
      minIntervalHours: medication.minIntervalHours == null ? "" : String(medication.minIntervalHours),
      maxIntervalHours: medication.maxIntervalHours == null ? "" : String(medication.maxIntervalHours),
    });
    setMedicationEditRevision(medication.revision);
    setEditingMedication(true);
  };

  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs leading-relaxed text-muted">
          Prescribed dose: {medication.doseText}
          {medication.minIntervalHours != null && medication.maxIntervalHours != null
            ? ` · Entered interval ${medication.minIntervalHours}–${medication.maxIntervalHours}h`
            : medication.minIntervalHours != null ? ` · Entered interval ${medication.minIntervalHours}h` : ""}
        </p>
        <button type="button" disabled={busy} onClick={() => editingMedication ? setEditingMedication(false) : beginMedicationEdit()} className="min-h-11 shrink-0 px-2 text-xs font-semibold text-accent-strong disabled:opacity-50">{editingMedication ? "Cancel edit" : "Edit medication"}</button>
      </div>
      {editingMedication && (
        <div className="mt-2 rounded-lg bg-cream/60 p-2">
          <MedicationFields draft={medicationDraft} onChange={setMedicationDraft} suggestions={[]} />
          <button type="button" onClick={updateMedication} disabled={busy || !medicationDraft.name.trim() || !medicationDraft.doseText.trim()} className="mt-2 min-h-11 rounded-lg bg-terracotta-dark px-4 text-sm font-semibold text-white disabled:opacity-50">Save medication</button>
        </div>
      )}
      {medication.latestDose && medication.minIntervalHours != null && (
        <p className="mt-1 text-xs text-muted">
          Entered next window: {formatTime(medication.latestDose.givenAt + medication.minIntervalHours * 60 * 60 * 1000)}
          {medication.maxIntervalHours != null ? `–${formatTime(medication.latestDose.givenAt + medication.maxIntervalHours * 60 * 60 * 1000)}` : ""}. This is not a safe-to-dose recommendation.
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-medium text-warm-brown-light">Time given<input aria-label={`Time ${medication.name} was given`} type="datetime-local" value={givenAt} onChange={(event) => setGivenAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm text-warm-brown" /></label>
        <label className="text-xs font-medium text-warm-brown-light">Actual dose<input aria-label={`Dose of ${medication.name} given`} value={doseText} onChange={(event) => setDoseText(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-warm-brown" /></label>
        <button type="button" disabled={busy || !doseText.trim()} onClick={submitDose} className="min-h-11 self-end rounded-lg bg-terracotta-dark px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Log</button>
      </div>
      {doses.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Dose history</p>
          {doses.map((dose) => (
            <DoseHistoryRow key={dose.id} dose={dose} editing={editingId === dose.id} disabled={busy} onEdit={() => setEditingId(dose.id)} onCancel={() => setEditingId(null)} onSave={(time, text, expectedRevision) => saveDose(dose, time, text, expectedRevision)} onDelete={() => deleteDose(dose)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DoseHistoryRow({ dose, editing, disabled, onEdit, onCancel, onSave, onDelete }: { dose: SickDose; editing: boolean; disabled: boolean; onEdit: () => void; onCancel: () => void; onSave: (time: string, text: string, expectedRevision: number) => void; onDelete: () => void }) {
  const [time, setTime] = useState(() => sgtDateTimeInput(dose.givenAt));
  const [text, setText] = useState(dose.doseText);
  const [editRevision, setEditRevision] = useState(dose.revision);

  useEffect(() => {
    if (editing) return;
    setTime(sgtDateTimeInput(dose.givenAt));
    setText(dose.doseText);
    setEditRevision(dose.revision);
  }, [dose.givenAt, dose.doseText, dose.revision, editing]);

  const beginEdit = () => {
    setTime(sgtDateTimeInput(dose.givenAt));
    setText(dose.doseText);
    setEditRevision(dose.revision);
    onEdit();
  };

  if (editing) {
    return (
      <div className="rounded-lg bg-cream/70 p-2">
        <div className="grid gap-2 sm:grid-cols-2"><input aria-label="Edit dose time" type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} className="min-h-11 rounded-lg border border-border bg-surface px-2 py-2 text-sm" /><input aria-label="Edit dose amount" value={text} onChange={(event) => setText(event.target.value)} className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm" /></div>
        <div className="mt-2 flex gap-2"><button type="button" disabled={disabled} onClick={() => onSave(time, text, editRevision)} className="min-h-11 rounded-lg bg-terracotta-dark px-3 text-sm font-semibold text-white">Save</button><button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold text-warm-brown">Cancel</button></div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-cream/70 px-3 py-1.5">
      <p className="min-w-0 flex-1 text-xs text-warm-brown"><span className="font-semibold tabular-nums">{formatDate(dose.givenAt)} · {formatTime(dose.givenAt)}</span> · {dose.doseText}{dose.givenBy && <span className="block break-words text-muted">Given by {dose.givenBy}</span>}</p>
      <button type="button" disabled={disabled} onClick={beginEdit} className="min-h-11 px-2 text-xs font-semibold text-accent-strong disabled:opacity-50">Edit</button>
      <button type="button" disabled={disabled} onClick={onDelete} aria-label="Delete recorded dose" className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-danger disabled:opacity-50"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
    </div>
  );
}

function MedicationRow({ babyId, episodeId, medication, now, busy, onBusy, onChanged }: { babyId: string; episodeId: string; medication: SickMedication; now: number; busy: boolean; onBusy: (busy: boolean) => void; onChanged: () => Promise<void> | void }) {
  const latest = medication.latestDose;
  return (
    <details className="group border-b border-border/70 last:border-b-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="min-w-0 break-words text-xs font-medium leading-snug text-warm-brown">{medication.name}</span>
            {medication.asNeeded && <span className="whitespace-nowrap rounded-full bg-terracotta/10 px-1.5 py-0.5 text-[9px] font-semibold text-accent-strong">As needed</span>}
          </div>
          <p aria-label={latest ? `Last given ${formatTime(latest.givenAt)}, ${formatElapsedSince(latest.givenAt, now)}` : "No doses logged"} className="justify-self-end whitespace-nowrap text-[11px] text-muted">
            {latest ? <span className="font-semibold tabular-nums text-warm-brown">{formatTime(latest.givenAt).replace(/ hrs$/, "")} · {formatElapsedSince(latest.givenAt, now)}</span> : "No doses logged"}
          </p>
        </div>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <DoseHistory babyId={babyId} episodeId={episodeId} medication={medication} busy={busy} onBusy={onBusy} onChanged={onChanged} />
    </details>
  );
}

function EpisodeArchive({ babyId, data }: { babyId: string; data: SickModeResponse }) {
  const archived = data.episodes.filter((episode) => episode.endedAt != null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState<SickModeResponse | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (archived.length === 0) return null;

  const toggleEpisode = async (episodeId: string) => {
    if (selectedId === episodeId) {
      setSelectedId(null);
      setSelectedData(null);
      setError(null);
      return;
    }
    setSelectedId(episodeId);
    setSelectedData(null);
    setError(null);
    setLoadingId(episodeId);
    try {
      const response = await fetch(`/api/sick-mode?babyId=${encodeURIComponent(babyId)}&episodeId=${encodeURIComponent(episodeId)}`, { cache: "no-store" });
      const next = await response.json().catch(() => null) as SickModeResponse | null;
      if (!response.ok || !next) throw new Error(next?.error || "Could not load this episode.");
      setSelectedData(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this episode.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <details className="mt-4 border-t border-border/70 pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-warm-brown [&::-webkit-details-marker]:hidden">
        Past sick-mode episodes
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted" />
      </summary>
      <div className="divide-y divide-border/60">
        {archived.map((episode) => (
          <div key={episode.id} className="py-1 text-xs leading-relaxed text-muted">
            <button type="button" aria-expanded={selectedId === episode.id} onClick={() => void toggleEpisode(episode.id)} className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left">
              <span><span className="font-semibold tabular-nums text-warm-brown">{formatDate(episode.startedAt)} · {formatTime(episode.startedAt)}</span><span className="block">Ended {episode.endedAt == null ? "—" : `${formatDate(episode.endedAt)} · ${formatTime(episode.endedAt)}`}</span></span>
              <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${selectedId === episode.id ? "rotate-180" : ""}`} />
            </button>
            {selectedId === episode.id && (
              <div className="pb-3 pl-3">
                <p>Usual daily intake used: {episode.baselineDailyMl} ml · {episode.baselineKind === "manual" ? "manual" : `${episode.baselineAvailableDayCount}/7 logged days`}</p>
                {loadingId === episode.id && <p className="mt-2">Loading medication history…</p>}
                {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
                {selectedData?.archivedEpisode?.id === episode.id && (
                  selectedData.archivedMedications.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {selectedData.archivedMedications.map((medication) => (
                        <div key={medication.id} className="rounded-lg bg-cream/70 p-2">
                          <p className="break-words font-semibold text-warm-brown">{medication.name}{medication.asNeeded ? " · As needed" : ""}</p>
                          <p>Prescribed dose: {medication.doseText}</p>
                          {medication.doses.length > 0 ? medication.doses.map((dose) => (
                            <p key={dose.id} className="mt-1 tabular-nums">{formatDate(dose.givenAt)} · {formatTime(dose.givenAt)} · {dose.doseText}{dose.givenBy ? ` · ${dose.givenBy}` : ""}</p>
                          )) : <p className="mt-1">No doses logged</p>}
                        </div>
                      ))}
                    </div>
                  ) : <p className="mt-2">No medications recorded for this episode.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

export default function SickModePanel({ babyId, data, isStale = false, onRefresh }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [showStart, setShowStart] = useState(false);
  const [showAddMedication, setShowAddMedication] = useState(false);
  const [startedAtInput, setStartedAtInput] = useState(() => sgtDateTimeInput());
  const [preview, setPreview] = useState(data?.baselinePreview ?? null);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [manualBaseline, setManualBaseline] = useState("");
  const [medicationDrafts, setMedicationDrafts] = useState<MedicationDraft[]>([EMPTY_MEDICATION()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 30_000);
    const refresh = () => document.visibilityState === "visible" && tick();
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  const suggestions = useMemo(() => Array.isArray(data?.medicationSuggestions) ? data.medicationSuggestions : [], [data?.medicationSuggestions]);
  const activeEpisode = data?.activeEpisode ?? null;

  const fetchPreview = async (input = startedAtInput) => {
    const startedAt = parseSgtDateTime(input);
    if (startedAt == null) return;
    try {
      const response = await fetch(`/api/sick-mode?babyId=${encodeURIComponent(babyId)}&startedAt=${startedAt}`, { cache: "no-store" });
      const next = await response.json() as SickModeResponse;
      if (response.ok && next.schemaReady) setPreview(next.baselinePreview);
    } catch {
      // The start form remains editable offline; submission will fail closed.
    }
  };

  useEffect(() => {
    if (!showStart || activeEpisode) return;
    const timer = window.setTimeout(() => void fetchPreview(), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStart, startedAtInput, activeEpisode?.id]);

  const reportMutationError = async (error: unknown) => {
    await onRefresh();
    const status = (error as { status?: number }).status;
    alert(status === 409 ? "Sick mode changed on another device. The latest details have been loaded." : error instanceof Error ? error.message : "Could not update sick mode.");
  };

  const startSickMode = async () => {
    const startedAt = parseSgtDateTime(startedAtInput);
    const validMedications = medicationDrafts.filter((draft) => draft.name.trim() || draft.doseText.trim());
    if (startedAt == null || busy) return;
    if (validMedications.some((draft) => !draft.name.trim() || !draft.doseText.trim())) {
      alert("Each medication needs a name and prescribed dose.");
      return;
    }
    if (preview?.requiresIncompleteConfirmation && !confirmIncomplete && !manualBaseline.trim()) {
      alert("Confirm the incomplete baseline or enter a manual usual daily amount.");
      return;
    }
    setBusy(true);
    try {
      const start = await mutateSickMode({ action: "start", babyId, startedAt, confirmIncomplete, ...(manualBaseline.trim() ? { manualBaselineMl: Number(manualBaseline) } : {}) });
      const episodeId = String(start.data.episodeId ?? start.data.id ?? "");
      if (!episodeId) throw new Error("Sick mode started, but its medication setup could not be linked. Refresh and add medications from the active episode.");
      const pending = [...validMedications];
      try {
        for (const medication of validMedications) {
          await mutateSickMode({ action: "addMedication", babyId, episodeId, name: medication.name.trim(), doseText: medication.doseText.trim(), asNeeded: medication.asNeeded, minIntervalHours: numericOrUndefined(medication.minIntervalHours), maxIntervalHours: numericOrUndefined(medication.maxIntervalHours) });
          pending.shift();
        }
      } catch (error) {
        setMedicationDrafts(pending.length > 0 ? pending : [EMPTY_MEDICATION()]);
        setShowAddMedication(true);
        throw error;
      }
      setShowStart(false);
      setMedicationDrafts([EMPTY_MEDICATION()]);
      await onRefresh();
    } catch (error) {
      await reportMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  const endSickMode = async () => {
    if (!activeEpisode || busy || !confirm("End this sick-mode episode? Its history will be preserved.")) return;
    setBusy(true);
    try {
      await mutateSickMode({ action: "end", babyId, episodeId: activeEpisode.id });
      await onRefresh();
    } catch (error) {
      await reportMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  const addMedication = async () => {
    const drafts = medicationDrafts.filter((draft) => draft.name.trim() || draft.doseText.trim());
    if (!activeEpisode || drafts.length === 0 || drafts.some((draft) => !draft.name.trim() || !draft.doseText.trim()) || busy) return;
    setBusy(true);
    try {
      const pending = [...drafts];
      try {
        for (const draft of drafts) {
          await mutateSickMode({ action: "addMedication", babyId, episodeId: activeEpisode.id, name: draft.name.trim(), doseText: draft.doseText.trim(), asNeeded: draft.asNeeded, minIntervalHours: numericOrUndefined(draft.minIntervalHours), maxIntervalHours: numericOrUndefined(draft.maxIntervalHours) });
          pending.shift();
        }
      } catch (error) {
        setMedicationDrafts(pending.length > 0 ? pending : [EMPTY_MEDICATION()]);
        throw error;
      }
      setMedicationDrafts([EMPTY_MEDICATION()]);
      setShowAddMedication(false);
      await onRefresh();
    } catch (error) {
      await reportMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    if (!isStale) return null;
    return (
      <section className="rounded-lg border border-warning/30 bg-surface p-4 shadow-sm" aria-label="Sick mode could not load">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-warm-brown">Sick mode</h2><p className="mt-0.5 text-xs text-warning">Couldn’t load sick-mode details. The rest of the dashboard is still available.</p></div><button type="button" onClick={() => void onRefresh()} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm font-semibold text-warm-brown">Retry</button></div>
      </section>
    );
  }

  if (!data.schemaReady) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm" aria-label="Sick mode unavailable">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-warm-brown">Sick mode</h2><p className="mt-0.5 text-xs text-muted">Database setup is required before sick mode can be started.</p></div><button type="button" disabled className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm font-semibold text-muted opacity-60">Start</button></div>
      </section>
    );
  }

  if (!activeEpisode) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm" aria-labelledby="sick-mode-heading">
        {isStale && <p role="status" className="mb-3 rounded-lg border border-warning/30 bg-amber-50 px-3 py-2 text-xs text-warning">Couldn’t refresh sick mode. Details may be out of date; actions are paused until it reconnects.</p>}
        <div className="flex items-center justify-between gap-3">
          <div><h2 id="sick-mode-heading" className="text-base font-semibold text-warm-brown">Sick mode</h2><p className="mt-0.5 text-xs text-muted">Track fever, medication, feeds and pee in one place.</p></div>
          <button type="button" disabled={isStale} onClick={() => setShowStart((value) => !value)} aria-expanded={showStart} className="min-h-11 shrink-0 rounded-lg border border-terracotta/30 bg-terracotta/10 px-3 py-2 text-sm font-semibold text-accent-strong disabled:opacity-50">{showStart ? "Cancel" : "Start"}</button>
        </div>
        {showStart && (
          <div className="mt-4 border-t border-border pt-4">
            <label className="block text-xs font-medium text-warm-brown-light">Sick mode started<input type="datetime-local" value={startedAtInput} onChange={(event) => setStartedAtInput(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-warm-brown" /></label>
            <div className="mt-3 rounded-lg bg-cream/70 p-3 text-xs leading-relaxed text-muted">
              <p className="font-semibold text-warm-brown">Usual daily intake: {preview?.medianDailyMl != null ? `${preview.medianDailyMl} ml` : "Not enough history"}</p>
              <p className="mt-1">Based on {preview?.availableDayCount ?? 0} of 7 completed days before activation. Unlogged days are not counted as zero.</p>
              {preview?.requiresIncompleteConfirmation && (
                <label className="mt-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmIncomplete} onChange={(event) => setConfirmIncomplete(event.target.checked)} className="h-5 w-5 rounded border-border" />Use this incomplete baseline</label>
              )}
              {(preview?.requiresManualBaseline || preview?.requiresIncompleteConfirmation) && (
                <label className="mt-2 block font-medium text-warm-brown-light">Or set usual daily intake manually<input type="number" min="1" inputMode="numeric" value={manualBaseline} onChange={(event) => setManualBaseline(event.target.value)} placeholder="ml per full day" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-warm-brown" /></label>
              )}
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold text-warm-brown">Medications</p><button type="button" onClick={() => setMedicationDrafts((items) => [...items, EMPTY_MEDICATION()])} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold text-accent-strong"><Plus aria-hidden="true" className="h-4 w-4" />Add another</button></div>
              {medicationDrafts.map((draft, index) => <MedicationFields key={draft.key} draft={draft} suggestions={suggestions} removable={medicationDrafts.length > 1} onChange={(next) => setMedicationDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => setMedicationDrafts((items) => items.filter((_, itemIndex) => itemIndex !== index))} />)}
            </div>
            <button type="button" onClick={startSickMode} disabled={busy} className="mt-4 min-h-12 w-full rounded-lg bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Starting…" : "Start sick mode"}</button>
          </div>
        )}
        <EpisodeArchive babyId={babyId} data={data} />
      </section>
    );
  }

  const summary = data.summary;
  const temperature = summary?.latestTemperature ?? null;
  const temperatureElapsed = temperature ? formatElapsedSince(temperature.measuredAt, now) : null;
  const temperatureOverdue = temperature ? now - temperature.measuredAt > 60 * 60 * 1000 : false;
  const latestDiapers = summary?.latestDiapers ?? [];

  return (
    <section className="rounded-lg border border-terracotta/30 bg-surface p-4 shadow-sm" aria-labelledby="sick-mode-heading">
      {isStale && <p role="status" className="mb-3 rounded-lg border border-warning/30 bg-amber-50 px-3 py-2 text-xs text-warning">Couldn’t refresh sick mode. Details may be out of date; actions are paused until it reconnects.</p>}
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-strong">Sick mode active</p><h2 id="sick-mode-heading" className="mt-0.5 text-lg font-semibold text-warm-brown">Health check-in</h2><p className="mt-0.5 text-xs text-muted">Since {formatDate(activeEpisode.startedAt)} · {formatTime(activeEpisode.startedAt)}</p></div>
        <button type="button" onClick={endSickMode} disabled={busy || isStale} className="min-h-11 shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-warm-brown disabled:opacity-50">End mode</button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-cream/70 p-3">
          <div className="flex items-center gap-2"><Thermometer aria-hidden="true" className="h-4 w-4 text-accent-strong" /><p className="text-sm font-semibold text-warm-brown">Temperature</p></div>
          {temperature ? <><p className="mt-2 text-lg font-semibold tabular-nums text-warm-brown">{temperature.celsius} °C</p><p className={`mt-0.5 text-xs tabular-nums ${temperatureOverdue ? "font-semibold text-danger" : "text-muted"}`}>Last measured {temperatureElapsed}{temperatureOverdue ? " · Overdue" : ""}</p>{temperature.method && <p className="mt-0.5 text-xs capitalize text-muted">{temperature.method}</p>}</> : <p className="mt-2 text-xs font-medium text-danger">No temperature recorded</p>}
        </div>
        <div className="rounded-lg bg-cream/70 p-3">
          <div className="flex items-center gap-2"><Droplets aria-hidden="true" className="h-4 w-4 text-info" /><p className="text-sm font-semibold text-warm-brown">Pee logged today</p></div>
          <p className="mt-2 text-sm tabular-nums text-warm-brown">{summary?.peeUnitsToday ?? 0} units · {summary?.wetDiaperCountToday ?? 0} wet diapers</p>
          <p className="mt-0.5 text-xs text-muted">{summary?.lastWetAt ? `Last wet diaper logged ${formatElapsedSince(summary.lastWetAt, now)}` : "No wet diaper logged today"}</p>
        </div>
      </div>

      <div className="mt-4 border-t border-border/70 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Latest diapers</p>
        {latestDiapers.length > 0 ? <div className="mt-1.5 divide-y divide-border/60">{latestDiapers.map((diaper) => <div key={diaper.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-xs"><span className="font-semibold tabular-nums text-warm-brown">{formatTime(diaper.startedAt)} · {formatElapsedSince(diaper.startedAt, now)}</span><span className="text-muted">{diaper.peeUnits == null ? "Pee not recorded" : diaper.peeUnits > 0 ? `${diaper.peeUnits} pee ${diaper.peeUnits === 1 ? "unit" : "units"}` : "No pee"}{diaper.poop && diaper.poop !== "no" ? ` · Poo ${diaper.poop}` : ""}</span></div>)}</div> : <p className="mt-1 text-xs text-muted">No diapers logged yet.</p>}
      </div>

      <div className="mt-4 border-t border-border/70 pt-3">
        <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Medications</p><button type="button" disabled={isStale} onClick={() => setShowAddMedication((value) => !value)} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold text-accent-strong disabled:opacity-50"><Plus aria-hidden="true" className="h-4 w-4" />Add</button></div>
        {data.medications.length > 0 ? <div>{data.medications.map((medication) => <MedicationRow key={medication.id} babyId={babyId} episodeId={activeEpisode.id} medication={medication} now={now} busy={busy || isStale} onBusy={setBusy} onChanged={onRefresh} />)}</div> : <p className="mt-1 text-xs text-muted">No medications added.</p>}
        {showAddMedication && <div className="mt-3 space-y-3">{medicationDrafts.map((draft, index) => <MedicationFields key={draft.key} draft={draft} onChange={(next) => setMedicationDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => setMedicationDrafts((items) => items.filter((_, itemIndex) => itemIndex !== index))} removable={medicationDrafts.length > 1} suggestions={suggestions} />)}<button type="button" onClick={() => setMedicationDrafts((items) => [...items, EMPTY_MEDICATION()])} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold text-accent-strong"><Plus aria-hidden="true" className="h-4 w-4" />Add another</button><div className="flex flex-wrap gap-2"><button type="button" onClick={addMedication} disabled={busy || medicationDrafts.some((draft) => !draft.name.trim() || !draft.doseText.trim())} className="min-h-11 rounded-lg bg-terracotta-dark px-4 text-sm font-semibold text-white disabled:opacity-50">Save medication{medicationDrafts.length === 1 ? "" : "s"}</button><button type="button" onClick={() => setShowAddMedication(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-warm-brown">Cancel</button></div></div>}
      </div>

      {summary?.lastCompletedDayConcern && <p className="mt-4 rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-xs leading-relaxed text-danger">On {summary.lastCompletedDayConcern.date}, {summary.lastCompletedDayConcern.totalMl} ml was logged—below the episode’s {summary.lastCompletedDayConcern.thresholdMl} ml 50% full-day intake threshold.</p>}
      <EpisodeArchive babyId={babyId} data={data} />
    </section>
  );
}
