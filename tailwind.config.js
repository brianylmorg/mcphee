/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#FDF8F3",
        terracotta: "#C4785A",
        "terracotta-dark": "#A85D3F",
        "warm-brown": "#3D2B1F",
        "warm-brown-light": "#5C4033",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        sans: ["Instrument Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
};
