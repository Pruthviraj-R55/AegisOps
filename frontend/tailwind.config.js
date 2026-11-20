/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0B0E14",
        surface: {
          DEFAULT: "#131720",
          elevated: "#191F2C",
          hover: "#1D2433",
        },
        border: {
          DEFAULT: "#222836",
          subtle: "#1E2532",
        },
        text: {
          primary: "#E6EDF3",
          muted: "#8B949E",
          dim: "#565E6B",
        },
        health: {
          excellent: "#10B981",
          good: "#38BDF8",
          fair: "#F59E0B",
          poor: "#F2495C",
          offline: "#F2495C",
          stale: "#F2495C",
        },
        series: {
          cpu: "#38BDF8",
          memory: "#A78BFA",
          latency: "#F59E0B",
          packetLoss: "#F2495C",
          disk: "#10B981",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
