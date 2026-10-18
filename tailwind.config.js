/** @type {import('tailwindcss').Config} */
module.exports = {
  // Touch devices keep `hover:` styles after a tap; only apply them where hover exists.
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "rgb(var(--rgb-canvas) / <alpha-value>)",
        surface: "rgb(var(--rgb-surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--rgb-surface-muted) / <alpha-value>)",
        terracotta: "rgb(var(--rgb-accent) / <alpha-value>)",
        "terracotta-dark": "rgb(var(--rgb-accent-strong) / <alpha-value>)",
        "accent-strong": "rgb(var(--rgb-accent-strong) / <alpha-value>)",
        "warm-brown": "rgb(var(--rgb-text) / <alpha-value>)",
        "warm-brown-light": "rgb(var(--rgb-text-muted) / <alpha-value>)",
        muted: "rgb(var(--rgb-text-muted) / <alpha-value>)",
        border: "rgb(var(--rgb-border) / <alpha-value>)",
        success: "rgb(var(--rgb-success) / <alpha-value>)",
        danger: "rgb(var(--rgb-danger) / <alpha-value>)",
        warning: "rgb(var(--rgb-warning) / <alpha-value>)",
        info: "rgb(var(--rgb-info) / <alpha-value>)",
        "on-accent": "rgb(var(--rgb-on-accent) / <alpha-value>)",
        frozen: "rgb(var(--rgb-frozen) / <alpha-value>)",
        "frozen-strong": "rgb(var(--rgb-frozen-strong) / <alpha-value>)",
      },
      fontFamily: {
        display: ["Manrope", "sans-serif"],
        sans: ["Instrument Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
};
