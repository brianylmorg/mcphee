"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/theme-preference";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Light / Dark / System appearance switch, remembered on this device. */
export default function ThemePreferenceControl() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  useEffect(() => setPreference(readThemePreference()), []);

  return (
    <fieldset className="rounded-lg border border-border px-3 py-2.5">
      <legend className="px-1 text-xs text-muted">Appearance</legend>
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1">
        {OPTIONS.map(({ value, label, Icon }) => {
          const selected = preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setPreference(value);
                applyThemePreference(value);
              }}
              className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${
                selected ? "bg-surface text-accent-strong shadow-sm" : "text-muted hover:text-warm-brown"
              }`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">System follows your phone&apos;s light or dark setting.</p>
    </fieldset>
  );
}
