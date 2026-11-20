/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        app: "#F4F6F8",
        surface: {
          DEFAULT: "#FFFFFF",
          secondary: "#F8FAFC",
          hover: "#F1F5F9",
        },
        border: {
          DEFAULT: "#E3E8ED",
          subtle: "#EDF2F7",
          focus: "#CBD5E1",
        },
        text: {
          primary: "#17212B",
          secondary: "#667085",
          muted: "#98A2B3",
        },
        accent: {
          DEFAULT: "#147D70",
          light: "#E8F3F1",
          hover: "#0F6258",
        },
        semantic: {
          excellent: "#23865B",
          excellentLight: "#EAF5F0",
          good: "#3267C8",
          goodLight: "#EFF4FC",
          fair: "#B7791F",
          fairLight: "#FEF7EC",
          poor: "#C2414B",
          poorLight: "#FDF2F2",
        },
        chart: {
          cpu: "#147D70",
          memory: "#3267C8",
          disk: "#8B6BA8",
          latency: "#147D70",
          packetLoss: "#C2414B",
          security: "#B7791F",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
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
      boxShadow: {
        card: "0 1px 2px 0 rgba(16, 24, 40, 0.05)",
        popover: "0 4px 6px -2px rgba(16, 24, 40, 0.05), 0 12px 16px -4px rgba(16, 24, 40, 0.08)",
      },
    },
  },
  plugins: [],
};
