"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { ChevronDown, X } from "lucide-react";

export default function BabyCareMenu({ name, active, children }: { name: string; active: boolean; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <h1 className="min-w-0 font-display text-2xl text-accent-strong">
        <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-label={`Baby settings for ${name}`} onClick={() => dialogRef.current?.showModal()} className="inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg px-2 transition-colors hover:bg-surface-muted">
          <Image src="/icon.svg" alt="" width={36} height={40} priority className="h-9 w-8 shrink-0 object-contain" />
          <span className="min-w-0 truncate">{name}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        </button>
      </h1>
      <dialog ref={dialogRef} aria-labelledby="baby-care-menu-title" onClose={() => triggerRef.current?.focus()} onClick={event => { if (event.target === dialogRef.current) dialogRef.current.close(); }} className="baby-care-dialog m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-left text-warm-brown shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div><h2 id="baby-care-menu-title" className="text-base font-semibold">{name}’s care</h2><p className="mt-0.5 text-xs text-muted">{active ? "Sick mode is on" : "Baby settings & sick mode"}</p></div>
          <button type="button" aria-label="Close baby settings" onClick={() => dialogRef.current?.close()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </dialog>
    </>
  );
}
