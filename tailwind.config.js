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
        bg: "#0b0c11",
        surface: "#12131b",
        surface2: "#181a24",
        line: "rgba(255,255,255,0.09)",
        ink: "#e9e7de",
        inkdim: "#9a9ca8",
        inkfaint: "#6b6d7a",
        gold: "#b6923f",
        goldbright: "#d8b565",
        positivo: "#4fb38a",
        negativo: "#d0685a",
      },
    },
  },
};
