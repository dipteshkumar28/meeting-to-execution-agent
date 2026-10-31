export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Manrope", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
      keyframes: {
        pulseRing: { "0%": { boxShadow: "0 0 0 0 rgba(244,63,94,.55)" }, "100%": { boxShadow: "0 0 0 14px rgba(244,63,94,0)" } },
        slideIn: { from: { opacity: 0, transform: "translateY(-6px)" }, to: { opacity: 1, transform: "none" } },
      },
      animation: { ring: "pulseRing 1.4s ease-out infinite", slideIn: "slideIn .25s ease-out" },
    },
  },
  plugins: [],
};
