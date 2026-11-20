/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#F1EFE8', paper: '#F1EFE8', ink: '#20211E', signal: '#B83A32',
        surface: { DEFAULT: '#F8F7F2', secondary: '#E8E6DE', hover: '#E5E3DA' },
        border: { DEFAULT: '#D8D5CB', subtle: '#E4E1D8', focus: '#AAA99F' },
        text: { primary: '#20211E', secondary: '#65665E', muted: '#8D8E85' },
        accent: { DEFAULT: '#B83A32', light: '#F3E4DF', hover: '#8F2D27' },
        semantic: { excellent: '#55564F', excellentLight: '#E8E6DE', good: '#20211E', goodLight: '#E8E6DE', fair: '#62635D', fairLight: '#E8E6DE', poor: '#B83A32', poorLight: '#F3E4DF' },
        chart: { cpu: '#B83A32', memory: '#20211E', disk: '#77786F', latency: '#B83A32', packetLoss: '#20211E', security: '#62635D' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: { card: '0 1px 0 rgba(32,33,30,.06)', popover: '0 8px 24px rgba(32,33,30,.12)' },
    },
  },
  plugins: [],
};
