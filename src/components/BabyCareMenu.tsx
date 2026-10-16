"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { ChevronDown, X } from "lucide-react";

export default function BabyCareMenu({ name, active, accessory, accessoryPlacement = "tuck", subtitle, children }: {
  name: string;
  active: boolean;
  /** Childcare control drawn with the face: the home cottage or the balloon. */
  accessory?: ReactNode;
  /** "behind": in the row, partly covered by the face (cottage); "tuck": held at its top-left (balloon). */
  accessoryPlacement?: "tuck" | "behind";
  /** Second line under the name: age, weight and who is logging. */
  subtitle?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(true);
  const close = () => dialogRef.current?.close();
  const open = () => dialogRef.current?.showModal();
  const closeForHandoff = () => {
    restoreFocusRef.current = false;
    close();
  };
  return (
    <>
      <div className="baby-identity-row flex min-w-0 items-center justify-center gap-3">
        {accessory && accessoryPlacement === "behind" && (
          <span className="baby-home-backdrop relative z-0 -mr-12 shrink-0">{accessory}</span>
        )}
        <span className="relative z-10 shrink-0">
          {/* The face is a second, pointer-only way into the same menu as the name. */}
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={open} className="baby-face relative block rounded-2xl transition-transform active:scale-95">
            <Image src="/icon.svg" alt="" width={72} height={80} priority className="h-16 w-14 object-contain" />
          </button>
          {/* Held at the face's top-left like a balloon on a string. */}
          {accessory && accessoryPlacement === "tuck" && <span className="absolute -left-8 -top-2 z-10">{accessory}</span>}
        </span>
        <div className="min-w-0 text-left">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="flex shrink-0 font-display text-2xl font-semibold leading-8 text-accent-strong">
              <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-label={`Baby settings for ${name}`} onClick={open} className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 transition-colors hover:bg-surface-muted">
                <span className="max-w-[9.5rem] truncate">{name}</span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
              </button>
            </h1>
          </div>
          {subtitle}
        </div>
      </div>
      <dialog ref={dialogRef} aria-labelledby="baby-care-menu-title" onClose={() => { if (restoreFocusRef.current) triggerRef.current?.focus(); restoreFocusRef.current = true; }} onClick={event => { if (event.target === dialogRef.current) close(); }} className="baby-care-dialog m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-left text-warm-brown shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div><h2 id="baby-care-menu-title" className="text-base font-semibold">{name}’s care</h2><p className="mt-0.5 text-xs text-muted">{active ? "Sick mode is on" : "Baby settings & sick mode"}</p></div>
          <button type="button" aria-label="Close baby settings" onClick={close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <div className="p-4">{typeof children === "function" ? children(closeForHandoff) : children}</div>
      </dialog>
    </>
  );
}
