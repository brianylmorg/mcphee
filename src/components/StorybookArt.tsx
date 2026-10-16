"use client";

import { useId } from "react";

/**
 * Storybook watercolour illustrations (classic nursery-book style): soft
 * washes, slightly wobbly brush edges and pooled pigment at the rims. Every
 * piece is decorative (aria-hidden); motion lives in globals.css under the
 * `.sb-` classes and holds still with reduced motion.
 */

/** SVG ids must be unique per instance and safe inside url(#…). */
function useSvgId(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Shared filters: a wobbly brush edge and a paper-grain wash. */
function WatercolourDefs({ id }: { id: string }) {
  return (
    <defs>
      <filter id={`${id}-edge`} x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="wobble" />
        <feGaussianBlur in="wobble" stdDeviation="0.35" />
      </filter>
      <filter id={`${id}-paper`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="8" result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.42  0 0 0 0 0.32  0 0 0 0.10 0" />
      </filter>
      <filter id={`${id}-bleed`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>
  );
}

/** Awake: a smiling sun, drifting clouds, a meadow and a bobbing bee. */
export function StorybookDay({ className = "" }: { className?: string }) {
  const id = useSvgId("sbday");
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 160 64" preserveAspectRatio="xMidYMid slice" className={`sb-art ${className}`}>
      <WatercolourDefs id={id} />
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="rgb(var(--sb-day-sky-top))" />
        <stop offset="1" stopColor="rgb(var(--sb-day-sky-bottom))" />
      </linearGradient>
      <rect width="160" height="64" fill={`url(#${id}-sky)`} />
      {/* soft pigment blooms in the wash */}
      <g filter={`url(#${id}-bleed)`} opacity="0.55">
        <ellipse cx="34" cy="20" rx="26" ry="12" fill="rgb(var(--sb-day-bloom))" />
        <ellipse cx="112" cy="46" rx="30" ry="10" fill="rgb(var(--sb-day-bloom))" />
      </g>

      {/* sun with slowly turning brushstroke rays */}
      <g transform="translate(140 14)">
        <g className="sb-sun-rays" filter={`url(#${id}-edge)`} stroke="rgb(var(--sb-sun-rim))" strokeWidth="2.2" strokeLinecap="round" opacity="0.7">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line key={angle} x1="0" y1="-15" x2="0" y2="-20" transform={`rotate(${angle})`} />
          ))}
        </g>
        <g filter={`url(#${id}-edge)`}>
          <circle r="11.5" fill="rgb(var(--sb-sun))" />
          <circle r="11.5" fill="none" stroke="rgb(var(--sb-sun-rim))" strokeWidth="1.4" opacity="0.65" />
        </g>
        {/* sleepy-happy face */}
        <g stroke="rgb(var(--sb-ink))" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.75">
          <path d="M-5 -1.5 q1.6 1.6 3.2 0" />
          <path d="M1.8 -1.5 q1.6 1.6 3.2 0" />
          <path d="M-2.2 3 q2.2 2 4.4 0" />
        </g>
        <circle cx="-6.4" cy="2.4" r="1.8" fill="rgb(var(--sb-blush))" opacity="0.55" />
        <circle cx="6.4" cy="2.4" r="1.8" fill="rgb(var(--sb-blush))" opacity="0.55" />
      </g>

      {/* drifting clouds */}
      <g className="sb-drift sb-drift-slow">
        <g filter={`url(#${id}-edge)`} transform="translate(8 4)">
          <path d="M4 12 a5 5 0 0 1 6-6 a7 7 0 0 1 13 1 a5 5 0 0 1 4 9 h-22 a4 4 0 0 1 -1-4z" fill="rgb(var(--sb-cloud))" />
          <path d="M5 15 h21" stroke="rgb(var(--sb-cloud-shade))" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
        </g>
      </g>
      <g className="sb-drift sb-drift-slower">
        <g filter={`url(#${id}-edge)`} transform="translate(70 0) scale(0.7)">
          <path d="M4 12 a5 5 0 0 1 6-6 a7 7 0 0 1 13 1 a5 5 0 0 1 4 9 h-22 a4 4 0 0 1 -1-4z" fill="rgb(var(--sb-cloud))" />
          <path d="M5 15 h21" stroke="rgb(var(--sb-cloud-shade))" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
        </g>
      </g>

      {/* meadow */}
      <g filter={`url(#${id}-edge)`}>
        <path d="M-4 64 V57 q20 -6 42 -1 t44 0 t44 -2 t40 1 V64z" fill="rgb(var(--sb-meadow))" opacity="0.85" />
        <path d="M-4 64 V60 q26 -4 54 0 t56 -1 t58 1 V64z" fill="rgb(var(--sb-meadow-deep))" opacity="0.7" />
      </g>
      <g fill="rgb(var(--sb-flower))" opacity="0.85">
        <circle cx="22" cy="57.5" r="1.3" />
        <circle cx="96" cy="56.8" r="1.2" />
        <circle cx="128" cy="58" r="1.4" />
      </g>

      {/* a little bee looping near the meadow */}
      <g className="sb-bee">
        <g transform="translate(14 44)">
          <path d="M-8 2 q-4 -6 -10 -3" stroke="rgb(var(--sb-ink))" strokeWidth="0.6" strokeDasharray="1.2 1.6" fill="none" opacity="0.45" />
          <ellipse className="sb-bee-wing" cx="-0.8" cy="-3.2" rx="2.4" ry="1.6" fill="rgb(var(--sb-wing))" opacity="0.85" />
          <ellipse cx="0" cy="0" rx="3.6" ry="2.6" fill="rgb(var(--sb-sun))" stroke="rgb(var(--sb-ink))" strokeWidth="0.5" />
          <path d="M-0.8 -2.4 v4.8 M1.4 -2.2 v4.4" stroke="rgb(var(--sb-ink))" strokeWidth="0.9" />
          <circle cx="3" cy="-0.6" r="0.45" fill="rgb(var(--sb-ink))" />
        </g>
      </g>

      <rect width="160" height="64" filter={`url(#${id}-paper)`} />
    </svg>
  );
}

/** Sleeping: a dozing crescent moon, twinkling sparkles and drifting z's. */
export function StorybookNight({ className = "" }: { className?: string }) {
  const id = useSvgId("sbnight");
  const sparkle = "M0 -3.4 Q0.5 -0.5 3.4 0 Q0.5 0.5 0 3.4 Q-0.5 0.5 -3.4 0 Q-0.5 -0.5 0 -3.4z";
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 160 64" preserveAspectRatio="xMidYMid slice" className={`sb-art ${className}`}>
      <WatercolourDefs id={id} />
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="rgb(var(--sb-night-top))" />
        <stop offset="1" stopColor="rgb(var(--sb-night-bottom))" />
      </linearGradient>
      <rect width="160" height="64" fill={`url(#${id}-sky)`} />
      <g filter={`url(#${id}-bleed)`} opacity="0.5">
        <ellipse cx="30" cy="48" rx="34" ry="12" fill="rgb(var(--sb-night-bloom))" />
        <ellipse cx="120" cy="16" rx="28" ry="12" fill="rgb(var(--sb-night-bloom))" />
      </g>

      {/* moon gently rocking, with a nightcap of glow */}
      <g transform="translate(138 18)">
        <g className="sb-moon">
          <circle r="15" fill="rgb(var(--sb-moon) / 0.18)" filter={`url(#${id}-bleed)`} />
          <g filter={`url(#${id}-edge)`}>
            <path d="M3 -12 a12 12 0 1 0 6 20 a10 10 0 0 1 -6 -20z" fill="rgb(var(--sb-moon))" />
            <path d="M3 -12 a12 12 0 1 0 6 20" fill="none" stroke="rgb(var(--sb-moon-rim))" strokeWidth="1.2" opacity="0.6" />
          </g>
          <path d="M-5.5 -1 q1.8 1.6 3.6 0" stroke="rgb(var(--sb-ink))" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.7" />
          <circle cx="-4.5" cy="3.4" r="1.7" fill="rgb(var(--sb-blush))" opacity="0.5" />
          <text className="sb-z sb-z-1" x="-14" y="-6" fontSize="6" fill="rgb(var(--sb-moon))">z</text>
          <text className="sb-z sb-z-2" x="-19" y="-11" fontSize="4.5" fill="rgb(var(--sb-moon))">z</text>
        </g>
      </g>

      {/* sparkles */}
      {[
        { x: 14, y: 12, s: 1, d: "0s" },
        { x: 40, y: 50, s: 0.7, d: "-1.1s" },
        { x: 62, y: 9, s: 0.8, d: "-2.2s" },
        { x: 92, y: 54, s: 0.6, d: "-0.6s" },
        { x: 108, y: 8, s: 0.9, d: "-1.7s" },
        { x: 6, y: 40, s: 0.55, d: "-2.8s" },
      ].map((star) => (
        <g key={`${star.x}-${star.y}`} transform={`translate(${star.x} ${star.y}) scale(${star.s})`}>
          <path className="sb-sparkle" style={{ animationDelay: star.d }} d={sparkle} fill="rgb(var(--sb-star))" />
        </g>
      ))}

      {/* a sleepy cloud along the bottom */}
      <g className="sb-drift sb-drift-slower">
        <g filter={`url(#${id}-edge)`} transform="translate(18 50) scale(0.8)">
          <path d="M4 12 a5 5 0 0 1 6-6 a7 7 0 0 1 13 1 a5 5 0 0 1 4 9 h-22 a4 4 0 0 1 -1-4z" fill="rgb(var(--sb-night-cloud))" opacity="0.7" />
        </g>
      </g>

      <rect width="160" height="64" filter={`url(#${id}-paper)`} />
    </svg>
  );
}

/** Childcare balloon: dusty rose and bobbing while in care, pale and still otherwise. */
export function StorybookBalloon({ active, className = "" }: { active: boolean; className?: string }) {
  const id = useSvgId("sbballoon");
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 32 40" className={`sb-balloon ${active ? "sb-balloon-active" : ""} ${className}`}>
      <WatercolourDefs id={id} />
      <radialGradient id={`${id}-fill`} cx="0.38" cy="0.32" r="0.75">
        <stop offset="0" stopColor={active ? "rgb(var(--sb-balloon-light))" : "rgb(var(--sb-balloon-idle-light))"} />
        <stop offset="1" stopColor={active ? "rgb(var(--sb-balloon))" : "rgb(var(--sb-balloon-idle))"} />
      </radialGradient>
      <path className="sb-balloon-string" d="M16 27.5 q-3 3 0 5.5 t0 6" stroke="rgb(var(--sb-ink))" strokeWidth="0.8" fill="none" opacity="0.55" strokeLinecap="round" />
      <g className="sb-balloon-body">
        <g filter={`url(#${id}-edge)`}>
          <path d="M16 2.5 c7 0 11.5 5.4 11.5 11.6 c0 7 -6.2 12.4 -11.5 13.4 c-5.3 -1 -11.5 -6.4 -11.5 -13.4 C4.5 7.9 9 2.5 16 2.5z" fill={`url(#${id}-fill)`} />
          <path d="M16 2.5 c7 0 11.5 5.4 11.5 11.6 c0 7 -6.2 12.4 -11.5 13.4 c-5.3 -1 -11.5 -6.4 -11.5 -13.4 C4.5 7.9 9 2.5 16 2.5z" fill="none" stroke={active ? "rgb(var(--sb-balloon-rim))" : "rgb(var(--sb-balloon-idle-rim))"} strokeWidth="1.1" opacity="0.7" />
          <path d="M14.4 27.4 l1.6 1.8 l1.6 -1.8z" fill={active ? "rgb(var(--sb-balloon-rim))" : "rgb(var(--sb-balloon-idle-rim))"} />
        </g>
        <path d="M10 9 q2 -3.4 5.6 -3.8" stroke="rgb(255 255 255 / 0.75)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        {active && (
          <g stroke="rgb(var(--sb-ink))" strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.7">
            <path d="M11.6 14.6 q1.2 1.2 2.4 0" />
            <path d="M18 14.6 q1.2 1.2 2.4 0" />
            <path d="M14.4 18 q1.6 1.4 3.2 0" />
          </g>
        )}
      </g>
    </svg>
  );
}

/**
 * At home: a lemon cottage drawn wide enough to sit behind the baby face. The
 * left side (lemon tree, window, door) shows; the right side fades out under
 * the face via a CSS mask on `.sb-home`.
 */
export function StorybookHome({ className = "" }: { className?: string }) {
  const id = useSvgId("sbhome");
  const lemon = (x: number, y: number, r = 0) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r})`}>
      <ellipse rx="2.6" ry="1.9" fill="rgb(var(--sb-lemon))" />
      <ellipse rx="2.6" ry="1.9" fill="none" stroke="rgb(var(--sb-lemon-rim))" strokeWidth="0.5" opacity="0.7" />
      <circle cx="-0.9" cy="-0.6" r="0.6" fill="rgb(255 255 255 / 0.7)" />
    </g>
  );
  return (
    <svg aria-hidden="true" focusable="false" viewBox="-5 -2 93 66" className={`sb-home ${className}`}>
      <WatercolourDefs id={id} />
      <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="rgb(var(--sb-window))" stopOpacity="0.95" />
        <stop offset="1" stopColor="rgb(var(--sb-window))" stopOpacity="0" />
      </radialGradient>

      {/* ground wash */}
      <g filter={`url(#${id}-edge)`}>
        <path d="M0 60 q22 -4 44 -1 t44 0 V64 H0z" fill="rgb(var(--sb-meadow))" opacity="0.85" />
      </g>

      {/* chimney smoke */}
      <g fill="rgb(var(--sb-cloud-shade))" opacity="0.85">
        <circle className="sb-smoke-puff sb-smoke-1" cx="59" cy="9" r="2.6" />
        <circle className="sb-smoke-puff sb-smoke-2" cx="61" cy="5" r="2" />
      </g>

      <g filter={`url(#${id}-edge)`}>
        {/* chimney */}
        <rect x="55.5" y="12" width="6" height="11" rx="1" fill="rgb(var(--sb-roof-deep))" />
        {/* walls */}
        <path d="M24 30 h46 v26 a2 2 0 0 1 -2 2 h-42 a2 2 0 0 1 -2 -2z" fill="rgb(var(--sb-wall))" />
        <path d="M24 30 h46 v26 a2 2 0 0 1 -2 2 h-42 a2 2 0 0 1 -2 -2z" fill="none" stroke="rgb(var(--sb-wall-rim))" strokeWidth="1.1" opacity="0.55" />
        {/* roof */}
        <path d="M18 32 L47 9 L76 32 q-1.6 2 -4 0.8 L47 13.6 L22 32.8 q-2.4 1.2 -4 -0.8z" fill="rgb(var(--sb-roof-deep))" />
        <path d="M20.5 31.2 L47 10.6 L73.5 31.2 L47 17z" fill="rgb(var(--sb-roof))" />
        {/* round window with lemon-yellow frame and shutters */}
        <rect x="27" y="36" width="3.4" height="10" rx="1" fill="rgb(var(--sb-lemon))" />
        <rect x="42.6" y="36" width="3.4" height="10" rx="1" fill="rgb(var(--sb-lemon))" />
        <circle cx="36.5" cy="41" r="5.6" fill="rgb(var(--sb-lemon-rim))" />
        <circle cx="36.5" cy="41" r="4.6" fill="rgb(var(--sb-window))" />
        <path d="M36.5 36.4 v9.2 M31.9 41 h9.2" stroke="rgb(var(--sb-wall-rim))" strokeWidth="0.8" opacity="0.7" />
        {/* door with a lemon wreath */}
        <path d="M51 58 v-12 a5 5 0 0 1 10 0 v12z" fill="rgb(var(--sb-door))" />
        <circle cx="56" cy="47" r="2.6" fill="none" stroke="rgb(var(--sb-meadow-deep))" strokeWidth="1.2" />
        <circle cx="56" cy="44.6" r="0.9" fill="rgb(var(--sb-lemon))" />
        <circle cx="58.3" cy="47.6" r="0.9" fill="rgb(var(--sb-lemon))" />
        <circle cx="53.8" cy="47.8" r="0.9" fill="rgb(var(--sb-lemon))" />
        <circle cx="59.6" cy="52.5" r="0.6" fill="rgb(var(--sb-sun))" />
      </g>
      <circle className="sb-window-glow" cx="36.5" cy="41" r="7.5" fill={`url(#${id}-glow)`} />

      {/* lemon tree on the visible left edge */}
      <g filter={`url(#${id}-edge)`}>
        <path d="M11 60 q1 -9 -0.4 -18" stroke="rgb(var(--sb-trunk))" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </g>
      <g className="sb-tree-sway">
        <g filter={`url(#${id}-edge)`}>
          <circle cx="10.5" cy="34" r="9.5" fill="rgb(var(--sb-meadow-deep))" />
          <circle cx="5.5" cy="38" r="6" fill="rgb(var(--sb-meadow))" />
          <circle cx="16" cy="38.5" r="6" fill="rgb(var(--sb-meadow))" />
        </g>
        {[lemon(6.5, 33, -20), lemon(13.5, 30, 15), lemon(15.5, 39.5, -10), lemon(8, 41, 25)]}
      </g>
      {/* a fallen lemon */}
      {lemon(19, 59.5, 10)}
    </svg>
  );
}
