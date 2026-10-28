// Configuração do Tailwind. O arquivo client/estilos.css é gerado a partir de
// estilos/entrada.css com "npm run build:css" e não deve ser editado à mão.
export default {
  content: ["./client/*.html", "./client/*.js"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // Cores definidas em estilos/entrada.css (tema escuro e tema claro).
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        surface2: "rgb(var(--c-surface2) / <alpha-value>)",
        line: "var(--c-line)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        inkdim: "rgb(var(--c-inkdim) / <alpha-value>)",
        inkfaint: "rgb(var(--c-inkfaint) / <alpha-value>)",
        gold: "rgb(var(--c-gold) / <alpha-value>)",
        goldbright: "rgb(var(--c-goldbright) / <alpha-value>)",
        positivo: "rgb(var(--c-positivo) / <alpha-value>)",
        negativo: "rgb(var(--c-negativo) / <alpha-value>)",
      },
    },
  },
};
