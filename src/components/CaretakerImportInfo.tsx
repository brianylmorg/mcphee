import type { ReactNode } from "react";
import { Info } from "lucide-react";

export default function CaretakerImportInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="relative shrink-0">
      <summary
        aria-label={label}
        title={label}
        className="flex min-h-8 min-w-8 cursor-pointer list-none items-center justify-center rounded text-muted hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-terracotta [&::-webkit-details-marker]:hidden"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1 w-[min(18rem,calc(100vw-4rem))] rounded border border-border bg-surface p-3 text-xs leading-relaxed text-warm-brown shadow-lg">
        {children}
      </div>
    </details>
  );
}
