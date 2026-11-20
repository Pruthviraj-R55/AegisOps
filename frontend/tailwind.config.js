/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#05070A",
        surface: {
          DEFAULT: "#0C1017",
          elevated: "#121722",
          hover: "#18202F",
        },
        border: {
          DEFAULT: "#1B2230",
          subtle: "#151B27",
          focus: "#2A364E",
        },
        text: {
          primary: "#E6EDF3",
          muted: "#8B949E",
          dim: "#4E5664",
        },
        accent: {
          emerald: "#00D26A",
          cyan: "#38BDF8",
          amber: "#F59E0B",
          crimson: "#F2495C",
          purple: "#A78BFA",
        },
        health: {
          excellent: "#00D26A",
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
          disk: "#00D26A",
          security: "#E6EDF3",
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
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', filter: 'drop-shadow(0 0 4px #00D26A)' },
          '50%': { opacity: '0.6', filter: 'drop-shadow(0 0 1px #00D26A)' },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.35s ease-out forwards',
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
