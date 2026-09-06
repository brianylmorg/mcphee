"use client";

import { useState } from "react";
import { ChevronDown, History, PackagePlus, Pencil, Scale, Snowflake, Trash2, TriangleAlert } from "lucide-react";

import type { AvailableMilkBatch, FrozenMilkPacket, MilkBankHistoryItem } from "@/lib/milk-bank-ledger";

type MilkBankProps = {
  babyId: string;
  availableMl: number;
  expiredAvailableMl: number;
  availableBatches: Array<AvailableMilkBatch & { pumpedAt?: number; isAdjustment?: boolean; isExpired?: boolean }>;
  frozenMl: number;
  frozenPackets: FrozenMilkPacket[];
  history: MilkBankHistoryItem[];
  onChanged: () => Promise<void>;
};

type EditTransfer = MilkBankHistoryItem & { localTime: string };

const roundMl = (amount: number) => Math.round(amount * 100) / 100;

function singaporeDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

function toSingaporeInput(timestamp: number): string {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function fromSingaporeInput(value: string): number {
  return Date.parse(`${value}:00+08:00`);
}

export function MilkBank({
  babyId,
  availableMl,
  expiredAvailableMl,
  availableBatches,
  frozenMl,
  frozenPackets,
  history,
  onChanged,
}: MilkBankProps) {
  const [freezeAmount, setFreezeAmount] = useState("");
  const [showFreeze, setShowFreeze] = useState(false);
  const [showFrozenDetails, setShowFrozenDetails] = useState(false);
  const [expiredFreezeMl, setExpiredFreezeMl] = useState<number | null>(null);
  const [reconcileAvailable, setReconcileAvailable] = useState("");
  const [showAvailableReconcile, setShowAvailableReconcile] = useState(false);
  const [packetAmount, setPacketAmount] = useState("");
  const [packetDate, setPacketDate] = useState(() => toSingaporeInput(Date.now()));
  const [showPacketAdd, setShowPacketAdd] = useState(false);
  const [editTransfer, setEditTransfer] = useState<EditTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendBankCommand = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/milk-bank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ babyId, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  const freeze = async (confirmExpired = false) => {
    const amountMl = Number(freezeAmount);
    if (!Number.isFinite(amountMl) || amountMl <= 0) return setError("Enter a positive amount to freeze.");
    setBusy(true);
    setError(null);
    try {
      const { response, data } = await sendBankCommand({ action: "freeze", amountMl, at: Date.now(), confirmExpired });
      if (!response.ok && data.code === "EXPIRED_CONFIRMATION_REQUIRED") {
        setExpiredFreezeMl(Number(data.expiredMl));
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not freeze milk");
      setFreezeAmount("");
      setExpiredFreezeMl(null);
      setShowFreeze(false);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not freeze milk");
    } finally {
      setBusy(false);
    }
  };

  const packetAction = async (action: "thaw" | "discard", packet: FrozenMilkPacket) => {
    if (action === "discard" && !window.confirm(`Discard this ${packet.amountMl} ml frozen packet?`)) return;
    setBusy(true);
    setError(null);
    try {
      const { response, data } = await sendBankCommand({ action, packetId: packet.id, at: Date.now() });
      if (!response.ok) throw new Error(data.error || `Could not ${action} packet`);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} packet`);
    } finally {
      setBusy(false);
    }
  };

  const addPacket = async () => {
    const amountMl = Number(packetAmount);
    const at = fromSingaporeInput(packetDate);
    if (!Number.isFinite(amountMl) || amountMl <= 0 || !Number.isFinite(at)) return setError("Enter a positive packet amount and valid freeze time.");
    setBusy(true);
    setError(null);
    try {
      const { response, data } = await sendBankCommand({ action: "addPacket", amountMl, at });
      if (!response.ok) throw new Error(data.error || "Could not add packet");
      setPacketAmount("");
      setShowPacketAdd(false);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add packet");
    } finally {
      setBusy(false);
    }
  };

  const saveTransfer = async () => {
    if (!editTransfer) return;
    const at = fromSingaporeInput(editTransfer.localTime);
    if (!Number.isFinite(editTransfer.amountMl) || editTransfer.amountMl <= 0 || !Number.isFinite(at)) return setError("Enter a positive amount and valid time.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/milk-bank", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editTransfer.id, amountMl: editTransfer.amountMl, at }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That edit would make the later bank history impossible");
      setEditTransfer(null);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not edit transfer");
    } finally {
      setBusy(false);
    }
  };

  const removePacket = async (packet: FrozenMilkPacket) => {
    if (!window.confirm(`Remove the ${packet.amountMl} ml packet from the reconciliation list?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/milk-bank?id=${encodeURIComponent(packet.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "This packet cannot be removed because later history depends on it");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove packet");
    } finally {
      setBusy(false);
    }
  };

  const correctPacket = (packet: FrozenMilkPacket) => {
    const event = history.find((item) => item.id === packet.id);
    setEditTransfer({
      id: packet.id,
      eventType: event?.eventType ?? "Freeze",
      amountMl: packet.amountMl,
      at: packet.frozenAt,
      packetId: packet.id,
      localTime: toSingaporeInput(packet.frozenAt),
    });
  };

  const setAvailable = async () => {
    const targetBankMl = Number(reconcileAvailable);
    if (!Number.isFinite(targetBankMl) || targetBankMl < 0) return setError("Enter the actual Available amount.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyId, type: "bankadjust", startedAt: Date.now(), details: { targetBankMl } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not reconcile Available milk");
      setShowAvailableReconcile(false);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reconcile Available milk");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 border-t border-border pt-4" aria-labelledby="milk-bank-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="milk-bank-title" className="text-sm font-semibold text-muted">Breastmilk bank</h3>
          <p className="mt-1 flex items-baseline gap-1.5 text-warm-brown">
            <span className="font-display text-4xl font-semibold tabular-nums">{roundMl(availableMl)}</span>
            <span className="text-sm font-semibold">ml</span>
            <span className="ml-1 rounded-full bg-terracotta/10 px-2 py-1 text-xs font-semibold text-accent-strong">Available</span>
          </p>
          {expiredAvailableMl > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-warning">
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              {roundMl(expiredAvailableMl)} ml expired
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setReconcileAvailable(String(availableMl)); setShowAvailableReconcile((shown) => !shown); }}
          aria-label="Reconcile Available milk"
          className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong hover:bg-surface-muted"
        >
          <Scale aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {showAvailableReconcile && (
        <div className="mt-3 flex gap-2">
          <input aria-label="Actual Available milk in ml" type="number" min="0" step="any" value={reconcileAvailable} onChange={(event) => setReconcileAvailable(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3" />
          <button type="button" onClick={setAvailable} disabled={busy} className="min-h-11 rounded-xl bg-terracotta-dark px-4 text-sm font-semibold text-white disabled:opacity-50">Set</button>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-sky-200/80 bg-sky-50/60">
        <div className="flex min-h-16 items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2.5">
            <Snowflake aria-hidden="true" className="h-5 w-5 text-sky-700" />
            <div>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-800">Frozen</span>
              <p className="mt-0.5 font-display text-xl font-semibold tabular-nums leading-none text-sky-950">{roundMl(frozenMl)} ml</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setShowFreeze((shown) => !shown)} className="min-h-11 rounded-xl bg-sky-800 px-4 text-sm font-semibold text-white hover:bg-sky-900">Freeze</button>
            <button type="button" onClick={() => setShowFrozenDetails((shown) => !shown)} aria-expanded={showFrozenDetails} aria-controls="frozen-bank-details" aria-label={showFrozenDetails ? "Hide frozen milk details" : "Show frozen milk details"} className="flex h-11 w-11 items-center justify-center rounded-xl text-sky-800 hover:bg-sky-100">
              <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${showFrozenDetails ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>

        {showFreeze && (
          <div className="mx-3 mb-3 rounded-xl bg-white/80 p-3">
            <label className="text-xs font-semibold text-sky-950">Amount from Available (ml)</label>
            <div className="mt-1.5 flex gap-2">
              <input type="number" min="0.01" step="any" inputMode="decimal" value={freezeAmount} onChange={(event) => { setFreezeAmount(event.target.value); setExpiredFreezeMl(null); }} className="min-h-11 min-w-0 flex-1 rounded-xl border border-sky-200 bg-white px-3" />
              <button type="button" onClick={() => freeze(false)} disabled={busy} className="min-h-11 rounded-xl bg-sky-800 px-4 text-sm font-semibold text-white disabled:opacity-50">Freeze</button>
            </div>
            {expiredFreezeMl != null && (
              <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                <p>This uses {roundMl(expiredFreezeMl)} ml of expired Available milk.</p>
                <button type="button" onClick={() => freeze(true)} disabled={busy} className="mt-2 min-h-11 w-full rounded-xl bg-amber-700 px-3 font-semibold text-white">Confirm and freeze</button>
              </div>
            )}
          </div>
        )}

        <div id="frozen-bank-details" hidden={!showFrozenDetails} className="border-t border-sky-200/70 px-3 pb-3">
          <details className="mt-3 rounded-xl bg-white/70 px-3 py-2" open={frozenPackets.length > 0}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-sky-950">
              Packets · oldest first
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </summary>
            <div className="space-y-2 pb-1">
              {frozenPackets.length === 0 && <p className="py-2 text-xs text-muted">No frozen packets.</p>}
              {frozenPackets.map((packet) => (
                <div key={packet.id} className="rounded-xl border border-sky-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold tabular-nums text-sky-950">{roundMl(packet.amountMl)} ml</p>
                      <p className="mt-0.5 text-xs text-muted">Frozen {singaporeDateTime(packet.frozenAt)} · expires {singaporeDateTime(packet.expiresAt)}</p>
                    </div>
                    {packet.isExpired && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Expired</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {packet.isExpired ? (
                      <button type="button" onClick={() => packetAction("discard", packet)} disabled={busy} className="min-h-11 rounded-xl bg-amber-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Discard</button>
                    ) : (
                      <button type="button" aria-label={`Thaw ${packet.amountMl} ml packet`} onClick={() => packetAction("thaw", packet)} disabled={busy} className="min-h-11 rounded-xl bg-sky-800 px-3 text-sm font-semibold text-white disabled:opacity-50">Thaw whole</button>
                    )}
                    <button type="button" onClick={() => correctPacket(packet)} className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-semibold text-sky-900">Correct</button>
                    <button type="button" onClick={() => removePacket(packet)} className="flex min-h-11 items-center justify-center rounded-xl border border-sky-200 text-sky-900" aria-label={`Remove ${packet.amountMl} ml packet`}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="mt-2 rounded-xl bg-white/70 px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-sky-950">
              <span className="flex items-center gap-2"><PackagePlus aria-hidden="true" className="h-4 w-4" /> Reconcile frozen packets</span>
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </summary>
            <p className="text-xs text-muted">Add a missing physical packet. Correct or remove existing packets above; no opaque Frozen total adjustment is created.</p>
            <button type="button" onClick={() => setShowPacketAdd((shown) => !shown)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-200 text-sm font-semibold text-sky-900">Add packet</button>
            {showPacketAdd && (
              <div className="mt-2 grid gap-2">
                <input aria-label="Frozen packet amount in ml" type="number" min="0.01" step="any" value={packetAmount} onChange={(event) => setPacketAmount(event.target.value)} className="min-h-11 rounded-xl border border-sky-200 bg-white px-3" placeholder="Amount (ml)" />
                <input aria-label="Frozen packet recorded time" type="datetime-local" value={packetDate} onChange={(event) => setPacketDate(event.target.value)} className="min-h-11 rounded-xl border border-sky-200 bg-white px-3" />
                <button type="button" onClick={addPacket} disabled={busy} className="min-h-11 rounded-xl bg-sky-800 text-sm font-semibold text-white disabled:opacity-50">Add frozen packet</button>
              </div>
            )}
          </details>
        </div>
      </div>

      {availableBatches.length > 0 && (
        <details className="mt-3 rounded-xl border border-border bg-cream px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-warm-brown">Available batches</summary>
          <div className="space-y-2 pb-2">
            {availableBatches.map((batch) => (
              <div key={batch.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm">
                <div><p className="font-medium tabular-nums">{roundMl(batch.remainingMl)} ml</p><p className="text-xs text-muted">{batch.source === "thaw" ? "Thawed" : batch.source === "adjustment" ? "Adjustment" : "Pumped"} {singaporeDateTime(batch.addedAt ?? batch.pumpedAt ?? 0)}</p></div>
                {batch.expiresAt != null && batch.expiresAt <= Date.now() && <span className="text-xs font-semibold text-warning">Expired</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="mt-3 rounded-xl border border-border px-3 py-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-warm-brown">
          <span className="flex items-center gap-2"><History aria-hidden="true" className="h-4 w-4" /> Bank history</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </summary>
        <div className="divide-y divide-border">
          {[...history].sort((a, b) => b.at - a.at).map((item) => (
            <div key={item.id} className="flex min-h-12 items-center gap-3 py-2 text-sm">
              <span className="w-16 font-semibold tabular-nums">{roundMl(item.amountMl)} ml</span>
              <span className="flex-1 text-muted">{item.eventType}</span>
              <time className="text-xs text-muted">{singaporeDateTime(item.at)}</time>
              <button type="button" onClick={() => setEditTransfer({ ...item, localTime: toSingaporeInput(item.at) })} className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong hover:bg-surface-muted" aria-label={`Edit ${item.eventType} transfer`}><Pencil aria-hidden="true" className="h-4 w-4" /></button>
            </div>
          ))}
          {history.length === 0 && <p className="py-3 text-xs text-muted">No bank transfers yet.</p>}
        </div>
      </details>

      {editTransfer && (
        <div className="mt-3 rounded-2xl border border-terracotta/30 bg-surface-muted p-3" role="group" aria-label={`Edit ${editTransfer.eventType} transfer`}>
          <p className="text-sm font-semibold text-warm-brown">Edit {editTransfer.eventType}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input aria-label="Transfer amount in ml" type="number" min="0.01" step="any" value={editTransfer.amountMl} onChange={(event) => setEditTransfer({ ...editTransfer, amountMl: Number(event.target.value) })} className="min-h-11 rounded-xl border border-border bg-surface px-3" />
            <input aria-label="Transfer date and time" type="datetime-local" value={editTransfer.localTime} onChange={(event) => setEditTransfer({ ...editTransfer, localTime: event.target.value })} className="min-h-11 rounded-xl border border-border bg-surface px-3" />
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setEditTransfer(null)} className="min-h-11 flex-1 rounded-xl border border-border text-sm font-semibold">Cancel</button>
            <button type="button" onClick={saveTransfer} disabled={busy} className="min-h-11 flex-1 rounded-xl bg-terracotta-dark text-sm font-semibold text-white disabled:opacity-50">Save</button>
          </div>
          <p className="mt-2 text-xs text-muted">Freeze expiry is recalculated from the corrected Singapore date. Impossible later balances or packet states are rejected.</p>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-danger">{error}</p>}
    </section>
  );
}
