"use client";

import { useId, type CSSProperties } from "react";

/**
 * Storybook watercolour illustrations (classic nursery-book style): soft
 * washes, slightly wobbly brush edges and pooled pigment at the rims. Every
 * piece is decorative (aria-hidden); motion lives in globals.css under the
 * `.sb-` classes and holds still with reduced motion.
 */

/** SVG ids must be unique per instance and safe inside url(#…). */
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

/** Painted storybook art (Google Flow watercolours, cut out in public/storybook). */
const ART = "/storybook";

function Layer({ src, className, style }: { src: string; className?: string; style?: CSSProperties }) {
  // Decorative: empty alt, never focusable, never dragged.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${ART}/${src}`} alt="" draggable={false} decoding="async" className={`sb-layer ${className ?? ""}`} style={style} />;
}

/**
 * Awake: the painted morning meadow fills the toggle. The sun glows in open
 * sky (inside `.sb-sun-arc`, so it can set), clouds drift at different speeds,
 * and he runs unhurriedly across the meadow: after a bee, then away from it.
 */
export function StorybookDay({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`sb-painted sb-painted-day ${className}`}>
      <Layer src="awake-backdrop.webp" className="sb-backdrop" />
      <span className="sb-sun-arc sb-pos" style={{ left: "46%", top: "-10%", width: "17%" }}>
        <Layer src="sun.webp" className="sb-sun-glow" />
      </span>
      <span className="sb-pos sb-cloud-drift sb-cloud-a" style={{ left: "2%", top: "4%", width: "22%" }}><Layer src="cloud-1.webp" /></span>
      <span className="sb-pos sb-cloud-drift sb-cloud-b" style={{ left: "28%", top: "-6%", width: "15%" }}><Layer src="cloud-2.webp" /></span>
      <span className="sb-pos sb-cloud-drift sb-cloud-c" style={{ left: "76%", top: "0%", width: "18%" }}><Layer src="cloud-3.webp" /></span>
      {/* He runs back and forth across the meadow, clear of the timer and the
          "Sleep" strip. The bee always flies on his right: running right he
          chases it, and on the way back it chases him. The run is a 6-frame
          flip-book (kid-run.webp); travel and turns share one duration so both
          turn exactly at each end. */}
      <span className="sb-pos sb-kid-track" style={{ left: "max(50.5%, 11rem)", width: "calc(74% - max(50.5%, 11rem))", bottom: "6%", height: "50%" }}>
        <span className="sb-kid-runner">
          <span className="sb-kid-face">
            <span className="sb-kid-frame"><Layer src="kid-run.webp" className="sb-kid-strip" /></span>
          </span>
          <span className="sb-kid-bee"><span className="sb-bee-rock"><Layer src="bee-up.webp" /></span></span>
        </span>
      </span>
    </span>
  );
}

const NIGHT_STARS = [
  { src: "star-1.webp", left: "22%", top: "5%", width: "3.6%", delay: "0s" },
  { src: "star-3.webp", left: "30%", top: "6%", width: "3.2%", delay: "-1.2s" },
  { src: "star-2.webp", left: "38%", top: "40%", width: "3%", delay: "-2.1s" },
  { src: "star-7.webp", left: "79%", top: "3%", width: "3.6%", delay: "-0.6s" },
  { src: "star-5.webp", left: "88%", top: "12%", width: "3%", delay: "-1.7s" },
  { src: "star-4.webp", left: "42%", top: "4%", width: "2.6%", delay: "-2.6s" },
];

/**
 * Sleeping: the painted night sky, deepened so light text reads. The moon
 * rocks inside `.sb-moon-arc` (so it can rise), stars twinkle one by one, the
 * sleepy cloud drifts low, and he sleeps in the grass, breathing slowly with
 * z's floating up.
 */
export function StorybookNight({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`sb-painted sb-painted-night ${className}`}>
      <Layer src="night-backdrop.webp" className="sb-backdrop" />
      <span className="sb-night-veil" />
      <span className="sb-moon-arc sb-pos" style={{ left: "48%", top: "4%", width: "13%" }}>
        <Layer src="moon.webp" className="sb-moon-rock" />
      </span>
      {NIGHT_STARS.map((star) => (
        <span key={star.src} className="sb-pos" style={{ left: star.left, top: star.top, width: star.width }}>
          <Layer src={star.src} className="sb-star-twinkle" style={{ animationDelay: star.delay }} />
        </span>
      ))}
      {/* The sleepy cloud drifts beside the moon, at the same height. */}
      <span className="sb-pos sb-cloud-drift sb-cloud-sleepy" style={{ left: "62%", top: "10%", width: "12%" }}><Layer src="sleepy-cloud.webp" /></span>
      {/* He lies on the painted hill, below the moon, on a soft contact shadow
          so he rests on the ground. His left edge stays clear of the timer's
          frosted backing (about 11rem wide whatever the toggle width), and on
          narrow phones he shrinks rather than running into the "Wake up" strip. */}
      <span className="sb-pos" style={{ left: "max(52%, 11.5rem)", bottom: "2%", width: "min(16%, calc(76% - max(52%, 11.5rem)))" }}>
        <span className="sb-kid-ground" />
        <Layer src="kid-sleep.webp" className="sb-kid-breathe" />
        <span className="sb-zz sb-zz-1">z</span>
        <span className="sb-zz sb-zz-2">z</span>
      </span>
    </span>
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
      <g className="sb-balloon-string">
        <path d="M16 27.5 q-3 3 0 5.5 t0 6" stroke="rgb(60 40 30 / 0.35)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M16 27.5 q-3 3 0 5.5 t0 6" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
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
 * At home: the painted lemon cottage, sized to sit behind the baby face. Its
 * right side fades out under the face via the CSS mask on `.sb-home`; a curl
 * of smoke rises from the chimney.
 */
export function StorybookHome({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`sb-home-wrap relative block aspect-[360/296] ${className}`}>
      <Layer src="cottage.webp" className="sb-home" />
      <span className="sb-pos sb-smoke-rise" style={{ left: "25.3%", bottom: "92%", width: "11.5%" }}><Layer src="smoke.webp" /></span>
    </span>
  );
}
