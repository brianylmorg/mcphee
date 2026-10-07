"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Shared progressive-disclosure grammar for the "latest entries" summaries
 * (latest diapers in the health check-in and latest feeds in the milk card).
 *
 * Collapsed: the title and chevron sit before the caller-provided newest-entry
 * summary, so the entry's trailing value (for example "120 ml") stays flush
 * right. Expanding switches the summary to title-only (`group-open:hidden`)
 * and reveals the full entry list plus any footer action, so the newest record
 * is never shown twice.
 *
 * This is a native <details>/<summary>: Enter/Space, the focus-visible ring and
 * the open/closed state are handled by the browser, so background refreshes
 * never collapse an opened disclosure. Entries stay mounted while collapsed
 * (the browser hides the content), keeping the DOM stable across refreshes.
 */
export default function LatestEntriesDisclosure({
  title,
  summary,
  entries,
  footer,
  className,
  titleClassName,
  summaryWrapperClassName,
  contentClassName,
}: {
  title: string;
  summary?: ReactNode;
  entries?: ReactNode;
  footer?: ReactNode;
  className?: string;
  titleClassName?: string;
  summaryWrapperClassName?: string;
  contentClassName?: string;
}) {
  return (
    <details className={`latest-entries group ${className ?? ""}`} data-latest-entries="true">
      <summary className="latest-entries-toggle flex w-full cursor-pointer list-none items-center gap-2 text-left [&::-webkit-details-marker]:hidden">
        <span className={`latest-entries-title ${titleClassName ?? ""}`}>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="latest-entries-chevron h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180"
        />
        {summary ? (
          <span className={`latest-entries-newest min-w-0 flex-1 group-open:hidden ${summaryWrapperClassName ?? ""}`}>
            {summary}
          </span>
        ) : null}
      </summary>
      <div className={contentClassName} data-latest-entries-content="true">
        {entries}
        {footer}
      </div>
    </details>
  );
}
