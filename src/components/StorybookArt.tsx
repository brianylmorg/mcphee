"use client";

import { useId } from "react";

/**
 * Storybook watercolour illustrations (classic nursery-book style): soft
 * washes, slightly wobbly brush edges and pooled pigment at the rims. Every
 * piece is decorative (aria-hidden); motion lives in globals.css under the
 * `.sb-` classes and holds still with reduced motion.
 */

/** SVG ids must be unique per instance and safe inside url(#…). */
/** Short uneven straw strokes in three overlapping thatch rows (fixed seed). */
const THATCH_STROKES: string[] = (() => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const strokes: string[] = [];
  const rows = [{ y: 31.5, from: 20, to: 74 }, { y: 25, from: 27, to: 67 }, { y: 18.5, from: 34, to: 60 }];
  for (const row of rows) {
    for (let x = row.from; x < row.to; x += 1.1 + rand() * 0.9) {
      const lean = (x - 47) * 0.05;
      const length = 4 + rand() * 3;
      strokes.push(`M${x.toFixed(1)} ${(row.y + rand() * 0.8).toFixed(1)} q${(lean * 0.5).toFixed(1)} ${(-length / 2).toFixed(1)} ${lean.toFixed(1)} ${(-length).toFixed(1)}`);
    }
  }
  return strokes;
})();

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

const CLOUD_PATH = "M4 12 a5 5 0 0 1 6-6 a7 7 0 0 1 13 1 a5 5 0 0 1 4 9 h-22 a4 4 0 0 1 -1-4z";

/**
 * Awake: the whole toggle is a morning meadow. The sun sits in `.sb-sun-arc`
 * so it can sink when the baby falls asleep; clouds drift along the top and a
 * bee loops low beneath the text.
 */
export function StorybookDay({ className = "" }: { className?: string }) {
  const id = useSvgId("sbday");
  const cloud = (x: number, y: number, scale: number, shade = 0.6) => (
    <g filter={`url(#${id}-edge)`} transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={CLOUD_PATH} fill="rgb(var(--sb-cloud))" />
      <path d="M5 15 h21" stroke="rgb(var(--sb-cloud-shade))" strokeWidth="1.6" strokeLinecap="round" opacity={shade} />
    </g>
  );
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 320 96" preserveAspectRatio="xMidYMid slice" className={`sb-art ${className}`}>
      <WatercolourDefs id={id} />
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="rgb(var(--sb-day-sky-top))" />
        <stop offset="1" stopColor="rgb(var(--sb-day-sky-bottom))" />
      </linearGradient>
      <rect width="320" height="96" fill={`url(#${id}-sky)`} />
      <g filter={`url(#${id}-bleed)`} opacity="0.55">
        <ellipse cx="60" cy="30" rx="54" ry="16" fill="rgb(var(--sb-day-bloom))" />
        <ellipse cx="250" cy="64" rx="60" ry="14" fill="rgb(var(--sb-day-bloom))" />
      </g>

      <g className="sb-sun-arc">
        <g transform="translate(184 36)">
          <g className="sb-sun-rays" filter={`url(#${id}-edge)`} stroke="rgb(var(--sb-sun-rim))" strokeWidth="2.4" strokeLinecap="round" opacity="0.65">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
              // Drawn at their angle (not via transform: .sb-art uses fill-box origins).
              const rad = (angle * Math.PI) / 180;
              return (
                <line key={angle} x1={(17 * Math.sin(rad)).toFixed(2)} y1={(-17 * Math.cos(rad)).toFixed(2)} x2={(23 * Math.sin(rad)).toFixed(2)} y2={(-23 * Math.cos(rad)).toFixed(2)} />
              );
            })}
          </g>
          <g filter={`url(#${id}-edge)`}>
            <circle r="13" fill="rgb(var(--sb-sun))" />
            <circle r="13" fill="none" stroke="rgb(var(--sb-sun-rim))" strokeWidth="1.4" opacity="0.6" />
          </g>
          <g stroke="rgb(var(--sb-ink))" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.7">
            <path d="M-5.6 -1.6 q1.8 1.8 3.6 0" />
            <path d="M2 -1.6 q1.8 1.8 3.6 0" />
            <path d="M-2.4 3.4 q2.4 2.2 4.8 0" />
          </g>
          <circle cx="-7.2" cy="2.8" r="2" fill="rgb(var(--sb-blush))" opacity="0.5" />
          <circle cx="7.2" cy="2.8" r="2" fill="rgb(var(--sb-blush))" opacity="0.5" />
        </g>
      </g>

      <g className="sb-drift sb-drift-slow">{cloud(22, 4, 1)}</g>
      <g className="sb-drift sb-drift-slower">{cloud(120, 4, 0.72, 0.5)}</g>
      <g className="sb-drift sb-drift-slowest">{cloud(282, 10, 0.6, 0.45)}</g>

      <g filter={`url(#${id}-edge)`}>
        <path d="M-4 96 V86 q36 -7 80 -2 t84 -1 t84 -2 t80 2 V96z" fill="rgb(var(--sb-meadow))" opacity="0.85" />
        <path d="M-4 96 V91 q46 -5 104 0 t108 -1 t116 1 V96z" fill="rgb(var(--sb-meadow-deep))" opacity="0.7" />
      </g>
      <g fill="rgb(var(--sb-flower))" opacity="0.85">
        {[24, 70, 118, 172, 214, 268, 300].map((x, i) => <circle key={x} cx={x} cy={86 + (i % 3) * 0.8} r={1.2 + (i % 2) * 0.3} />)}
      </g>

      <g className="sb-bee">
        <g transform="translate(150 70)">
          <path d="M-8 2 q-5 -6 -12 -3" stroke="rgb(var(--sb-ink))" strokeWidth="0.6" strokeDasharray="1.2 1.6" fill="none" opacity="0.4" />
          <ellipse className="sb-bee-wing" cx="-0.8" cy="-3.4" rx="2.6" ry="1.7" fill="rgb(var(--sb-wing))" opacity="0.85" />
          <ellipse cx="0" cy="0" rx="3.8" ry="2.7" fill="rgb(var(--sb-sun))" stroke="rgb(var(--sb-ink))" strokeWidth="0.5" />
          <path d="M-0.8 -2.5 v5 M1.5 -2.3 v4.6" stroke="rgb(var(--sb-ink))" strokeWidth="0.9" />
          <circle cx="3.1" cy="-0.6" r="0.45" fill="rgb(var(--sb-ink))" />
        </g>
      </g>

      <rect width="320" height="96" filter={`url(#${id}-paper)`} />
    </svg>
  );
}

/**
 * Sleeping: the whole toggle is a night sky. The moon sits in `.sb-moon-arc`
 * so it can rise as the sun sets; sparkles twinkle and z's drift up.
 */
export function StorybookNight({ className = "" }: { className?: string }) {
  const id = useSvgId("sbnight");
  const sparkle = "M0 -3.4 Q0.5 -0.5 3.4 0 Q0.5 0.5 0 3.4 Q-0.5 0.5 -3.4 0 Q-0.5 -0.5 0 -3.4z";
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 320 96" preserveAspectRatio="xMidYMid slice" className={`sb-art ${className}`}>
      <WatercolourDefs id={id} />
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="rgb(var(--sb-night-top))" />
        <stop offset="1" stopColor="rgb(var(--sb-night-bottom))" />
      </linearGradient>
      <rect width="320" height="96" fill={`url(#${id}-sky)`} />
      <g filter={`url(#${id}-bleed)`} opacity="0.5">
        <ellipse cx="70" cy="74" rx="70" ry="16" fill="rgb(var(--sb-night-bloom))" />
        <ellipse cx="190" cy="26" rx="56" ry="16" fill="rgb(var(--sb-night-bloom))" />
      </g>

      <g className="sb-moon-arc">
        <g transform="translate(184 36)">
          <g className="sb-moon">
            <circle r="18" fill="rgb(var(--sb-moon) / 0.18)" filter={`url(#${id}-bleed)`} />
            <g filter={`url(#${id}-edge)`}>
              <path d="M3.5 -14 a14 14 0 1 0 7 23 a11.5 11.5 0 0 1 -7 -23z" fill="rgb(var(--sb-moon))" />
              <path d="M3.5 -14 a14 14 0 1 0 7 23" fill="none" stroke="rgb(var(--sb-moon-rim))" strokeWidth="1.2" opacity="0.6" />
            </g>
            <path d="M-6.4 -1.2 q2 1.8 4 0" stroke="rgb(var(--sb-ink))" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.7" />
            <circle cx="-5.2" cy="4" r="1.9" fill="rgb(var(--sb-blush))" opacity="0.5" />
            <text className="sb-z sb-z-1" x="-17" y="-7" fontSize="7" fill="rgb(var(--sb-moon))">z</text>
            <text className="sb-z sb-z-2" x="-23" y="-13" fontSize="5" fill="rgb(var(--sb-moon))">z</text>
          </g>
        </g>
      </g>

      {[
        { x: 18, y: 14, s: 1, d: "0s" },
        { x: 64, y: 30, s: 0.6, d: "-1.1s" },
        { x: 104, y: 10, s: 0.85, d: "-2.2s" },
        { x: 146, y: 20, s: 0.55, d: "-0.6s" },
        { x: 226, y: 10, s: 0.9, d: "-1.7s" },
        { x: 290, y: 16, s: 0.75, d: "-2.8s" },
        { x: 306, y: 58, s: 0.55, d: "-0.3s" },
        { x: 120, y: 62, s: 0.5, d: "-1.4s" },
      ].map((star) => (
        <g key={`${star.x}-${star.y}`} transform={`translate(${star.x} ${star.y}) scale(${star.s})`}>
          <path className="sb-sparkle" style={{ animationDelay: star.d }} d={sparkle} fill="rgb(var(--sb-star))" />
        </g>
      ))}

      <g className="sb-drift sb-drift-slower">
        <g filter={`url(#${id}-edge)`} transform="translate(40 76) scale(0.9)">
          <path d={CLOUD_PATH} fill="rgb(var(--sb-night-cloud))" opacity="0.7" />
        </g>
      </g>
      <g filter={`url(#${id}-edge)`}>
        <path d="M-4 96 V90 q50 -5 110 -1 t110 0 t108 -1 V96z" fill="rgb(var(--sb-night-bottom))" opacity="0.9" />
      </g>

      <rect width="320" height="96" filter={`url(#${id}-paper)`} />
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
 * At home: a thatched stone cottage in the classic nursery-book manner (fine
 * sepia pen line over loose, translucent watercolour washes, pen hatching for
 * shade, paper grain). Drawn wide enough to sit behind the baby face: the left
 * side (lemon tree, lattice window, door) shows and the right side fades out
 * under the face via a CSS mask on `.sb-home`.
 */
export function StorybookHome({ className = "" }: { className?: string }) {
  const id = useSvgId("sbhome");
  const ink = "rgb(var(--sb-ink))";
  const wash = (opacity: number) => ({ filter: `url(#${id}-wash)`, opacity });
  const lemon = (x: number, y: number, r = 0) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r}) scale(0.62)`}>
      <path d="M-2.4 0 q0.2 -2 2.4 -2 q2.4 0 2.6 1.8 q0.3 0.4 0 0.6 q-0.3 1.8 -2.6 1.8 q-2.3 0 -2.4 -2.2z" fill="rgb(var(--sb-lemon))" opacity="0.9" />
      <path d="M-2.4 0 q0.2 -2 2.4 -2 q2.4 0 2.6 1.8" fill="none" stroke={ink} strokeWidth="0.35" opacity="0.7" />
      <path d="M-0.4 1.4 q1.6 0.4 2.4 -0.6" fill="none" stroke="rgb(var(--sb-lemon-rim))" strokeWidth="0.6" opacity="0.8" />
    </g>
  );
  return (
    <svg aria-hidden="true" focusable="false" viewBox="-5 -2 93 66" className={`sb-home ${className}`}>
      <defs>
        {/* Washes: soft, bled edges that slightly overrun the pen line. */}
        <filter id={`${id}-wash`} x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="11" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G" result="bled" />
          <feGaussianBlur in="bled" stdDeviation="0.55" result="soft" />
          {/* pigment pooling: a darker rim where the wash dries */}
          <feMorphology in="soft" operator="erode" radius="0.6" result="inner" />
          <feComposite in="soft" in2="inner" operator="out" result="rim" />
          <feColorMatrix in="rim" type="matrix" values="0.8 0 0 0 0  0 0.8 0 0 0  0 0 0.8 0 0  0 0 0 0.55 0" result="rimDark" />
          {/* paper grain showing through the pigment, only where paint is */}
          <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" seed="21" result="grainNoise" />
          <feColorMatrix in="grainNoise" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.18  0 0 0 0.35 -0.05" result="grainTint" />
          <feComposite in="grainTint" in2="soft" operator="in" result="grain" />
          <feMerge><feMergeNode in="soft" /><feMergeNode in="rimDark" /><feMergeNode in="grain" /></feMerge>
        </filter>
        {/* Pen line: a gentle hand tremor. */}
        <filter id={`${id}-pen`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="1" seed="4" result="tremor" />
          <feDisplacementMap in="SourceGraphic" in2="tremor" scale="0.9" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgb(var(--sb-window))" stopOpacity="0.9" />
          <stop offset="1" stopColor="rgb(var(--sb-window))" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-thatch`}>
          <path d="M19 31 C26 22 36 13 47 10.5 C58 13 68 22 75 31 C70 33.5 62 33 47 33 C32 33 24 33.5 19 31z" />
        </clipPath>
      </defs>

      {/* ---------- washes ---------- */}
      {/* meadow, fading out at the edges */}
      <g {...wash(0.7)}>
        <path d="M-4 58 C10 54.5 26 55.5 44 56.5 C60 57.5 74 55 88 56.5 L88 64 L-4 64z" fill="rgb(var(--sb-meadow))" />
        <path d="M-4 61 C14 59 34 60.5 52 61.5 C66 62 78 60.5 88 61.5 L88 64 L-4 64z" fill="rgb(var(--sb-meadow-deep))" opacity="0.6" />
      </g>
      {/* stone walls */}
      <g {...wash(0.75)}>
        <path d="M24.5 31 C24 39 24.2 48 24.4 57 L69.6 57 C69.8 48 70 39 69.5 31z" fill="rgb(var(--sb-wall))" />
        {/* shade under the eaves and on the right */}
        <path d="M24.5 31 L69.5 31 L69.5 35 C55 34 40 34.5 24.5 35.5z" fill="rgb(var(--sb-wall-rim))" opacity="0.45" />
      </g>
      {/* thatch */}
      <g {...wash(0.85)}>
        <path d="M19 31 C26 22 36 13 47 10.5 C58 13 68 22 75 31 C70 33.5 62 33 47 33 C32 33 24 33.5 19 31z" fill="rgb(var(--sb-thatch))" />
        <path d="M21 30.5 C30 30 40 29.8 47 30 C56 29.8 66 30 73 30.5 C68 33 60 32.6 47 32.8 C33 32.6 25 33 21 30.5z" fill="rgb(var(--sb-thatch-deep))" opacity="0.6" />
      </g>
      {/* chimney, door, window, roses */}
      <g {...wash(0.8)}>
        <path d="M57 9.5 L62.5 9.2 L62.6 20 L57.2 18z" fill="rgb(var(--sb-roof))" />
        <path d="M50.6 57 L50.4 45.5 C50.6 41.6 59.4 41.6 59.6 45.5 L59.4 57z" fill="rgb(var(--sb-door))" />
        <path d="M30.2 37.4 L42.8 37.2 L42.9 48.6 L30.3 48.8z" fill="rgb(var(--sb-window))" opacity="0.7" />
      </g>
      <circle className="sb-window-glow" cx="36.5" cy="43" r="8" fill={`url(#${id}-glow)`} />
      <g {...wash(0.75)}>
        <circle cx="27.5" cy="37" r="2.6" fill="rgb(var(--sb-rose))" />
        <circle cx="25.6" cy="41.5" r="2" fill="rgb(var(--sb-rose))" />
        <circle cx="28.6" cy="45.5" r="1.8" fill="rgb(var(--sb-rose))" />
        <path d="M25 36 C23 40 26 44 24.6 50 C26 52 27.5 50 28.6 47 C30 42 29.5 38 30 35z" fill="rgb(var(--sb-meadow-deep))" opacity="0.6" />
      </g>
      {/* lemon tree in a terracotta pot */}
      <g className="sb-tree-sway">
        <g {...wash(0.8)}>
          <path d="M2 30 C1 24 6 20 11 21 C15 18.5 21 21 20.5 26 C23.5 28.5 22 34.5 18 35 C17 38.5 11 39 9 36.5 C4.5 37.5 0.5 34 2 30z" fill="rgb(var(--sb-meadow-deep))" />
          <path d="M5 29 C5 25 9 23.5 11.5 24.5 C14.5 23 18 25 17.5 28.5 C19 31 16.5 33.5 14 33 C12 35 8 34.5 7.5 32.5 C5 33 4 31 5 29z" fill="rgb(var(--sb-meadow))" opacity="0.8" />
        </g>
        {[lemon(5.5, 27, -18), lemon(9, 23.5, 8), lemon(13.5, 23, 12), lemon(17.8, 26.5, -25), lemon(18, 31.5, -8), lemon(9.5, 33.4, 20), lemon(13.8, 30, 4), lemon(4.6, 32, 30), lemon(11.2, 28.2, -12)]}
      </g>
      <g {...wash(0.85)}>
        <path d="M6.4 49 L17.6 49 L16.2 57.4 L7.8 57.4z" fill="rgb(var(--sb-pot))" />
      </g>

      {/* ---------- pen line ---------- */}
      <g filter={`url(#${id}-pen)`} fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round" opacity="0.82">
        {/* thatch outline and straw strokes */}
        <path d="M18.6 31.2 C26 21.6 36.5 12.8 47 10.2" strokeWidth="0.75" />
        <path d="M47 10.2 C57.5 12.8 68 21.6 75.4 31.2" strokeWidth="0.55" />
        <path d="M19.2 31.4 C25 33.6 33 32.8 47 33.1 C61 32.8 69 33.6 74.8 31.4" strokeWidth="0.6" opacity="0.8" />
        <g clipPath={`url(#${id}-thatch)`} strokeWidth="0.3" opacity="0.5">
          {THATCH_STROKES.map((d, i) => <path key={i} d={d} />)}
        </g>
        {/* overhanging thatch edge: a few ragged tufts */}
        <path d="M21 31.6 l-0.6 1.6 M25 32.4 l-0.4 1.5 M30 32.7 l-0.3 1.4 M36 32.9 l-0.2 1.3 M42 33 l0 1.2 M52 33 l0.2 1.3 M58 32.9 l0.3 1.4 M64 32.6 l0.4 1.5 M70 32.2 l0.6 1.5" strokeWidth="0.35" opacity="0.55" />
        {/* walls: uneven edges and a few stones */}
        <path d="M24.6 33 C24.2 41 24.4 49 24.5 57.2 M69.4 33 C69.8 41 69.6 49 69.5 57.2" strokeWidth="0.6" />
        <path d="M44.5 38.5 c1.6 -0.6 3.4 -0.3 4.4 0.4 M62 39 c1.4 -0.5 3 -0.2 3.8 0.5 M45.5 51.5 c1.8 -0.5 3.6 0 4.2 0.6 M63 49 c1.2 -0.4 2.6 0 3.2 0.4 M33 52.5 c1.6 -0.4 3 0 3.6 0.5" strokeWidth="0.4" opacity="0.6" />
        {/* hatching in the eaves' shadow */}
        <path d="M27 34.4 l2.2 -1.4 M30 34.3 l2.2 -1.4 M33 34.2 l2.2 -1.4 M36 34.1 l2.2 -1.4 M39 34.1 l2.2 -1.4 M42 34 l2.2 -1.4 M45 34 l2.2 -1.4 M48 34 l2.2 -1.4" strokeWidth="0.3" opacity="0.5" />
        {/* chimney */}
        <path d="M57 18 L56.9 9.6 L62.6 9.2 L62.7 20.2" strokeWidth="0.6" />
        <path d="M56.4 9.6 L63.2 9.1" strokeWidth="0.7" />
        {/* lattice window */}
        <path d="M30.2 37.3 L42.9 37.1 L43 48.7 L30.3 48.9z" strokeWidth="0.65" />
        <path d="M36.6 37.2 L36.6 48.8 M30.3 43 L42.9 42.9" strokeWidth="0.4" opacity="0.75" />
        <path d="M33.4 37.3 L33.5 48.8 M39.8 37.2 L39.8 48.7 M30.3 40.1 L42.9 40 M30.3 45.9 L42.9 45.8" strokeWidth="0.22" opacity="0.5" />
        <path d="M29.4 49.4 L43.8 49.2" strokeWidth="0.8" />
        {/* door */}
        <path d="M50.6 57.2 L50.4 45.5 C50.6 41.4 59.4 41.4 59.6 45.5 L59.4 57.2" strokeWidth="0.65" />
        <path d="M55 42.6 L55 57" strokeWidth="0.3" opacity="0.55" />
        <circle cx="58" cy="50.5" r="0.45" fill={ink} stroke="none" />
        {/* lemon wreath */}
        <circle cx="55" cy="46.6" r="2" strokeWidth="0.5" stroke="rgb(var(--sb-meadow-deep))" />
        {/* rose stems */}
        <path d="M26 50 C25 46 27 43 25.8 39 C26.5 36.5 28.5 35.5 29.6 34.6" strokeWidth="0.35" opacity="0.6" />
        <path d="M26.4 37 c0.6 -0.8 1.6 -0.8 2 0 M24.8 41.4 c0.5 -0.6 1.2 -0.6 1.6 0 M27.8 45.4 c0.5 -0.6 1.2 -0.6 1.6 0" strokeWidth="0.35" opacity="0.7" />
        {/* tree: trunk, loose foliage line */}
        <path d="M11.8 49 C12 44 11 40 12.2 35 M12 41 C10.5 39.5 9.4 38.6 8.4 37.6 M12.1 39 C13.6 37.6 14.8 37 16 36.4" strokeWidth="0.7" />
        <path d="M2.2 30.4 C1 24.4 6 20.2 11 21.2 C15 18.8 20.8 21 20.4 26 M21.6 29.6 C22.2 32.6 20.4 34.6 18.2 35" strokeWidth="0.45" opacity="0.7" />
        {/* pot */}
        <path d="M6 49 L18 49 M6.6 49.4 L7.8 57.5 L16.2 57.5 L17.4 49.4" strokeWidth="0.6" />
        <path d="M6.8 51 L17.2 51" strokeWidth="0.35" opacity="0.6" />
        {/* ground line and grass flicks */}
        <path d="M-3 57.6 C12 56.8 30 57.4 50 57.6 C64 57.8 76 57.2 88 57.6" strokeWidth="0.4" opacity="0.5" />
        <path d="M2 57.4 l0.6 -2 M3.4 57.4 l-0.3 -1.6 M20.5 57.5 l0.5 -1.8 M22 57.5 l-0.4 -1.4 M44 57.6 l0.5 -1.8 M46 57.6 l-0.3 -1.5 M64 57.4 l0.5 -1.9" strokeWidth="0.35" opacity="0.6" />
      </g>
      {[lemon(19.5, 58.2, 12)]}

      {/* chimney smoke: inked wisps */}
      <g fill="none" stroke="rgb(var(--sb-ink))" strokeLinecap="round" strokeWidth="0.45" opacity="0.5">
        <path className="sb-smoke-puff sb-smoke-1" d="M59.8 8.4 c-1.6 -1.2 0.8 -2.6 -0.4 -4" />
        <path className="sb-smoke-puff sb-smoke-2" d="M61.2 6.4 c1.4 -1 -0.6 -2.2 0.6 -3.6" />
      </g>
    </svg>
  );
}
