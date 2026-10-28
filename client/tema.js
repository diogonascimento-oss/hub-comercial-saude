// Tema do painel (escuro ou claro). Carregado no <head>, antes de desenhar a
// página, para não piscar no tema errado. A escolha fica no navegador.
(function () {
  let tema = "escuro";
  try {
    tema = localStorage.getItem("temaDoPainel") || "escuro";
  } catch {
    // Sem armazenamento no navegador: vale o tema escuro.
  }
  if (tema === "claro") document.documentElement.dataset.tema = "claro";

  function rotulo() {
    return document.documentElement.dataset.tema === "claro" ? "Modo escuro" : "Modo claro";
  }
  document.addEventListener("DOMContentLoaded", () => {
    const botao = document.getElementById("btnTema");
    if (!botao) return;
    botao.textContent = rotulo();
    botao.addEventListener("click", () => {
      const claro = document.documentElement.dataset.tema !== "claro";
      if (claro) document.documentElement.dataset.tema = "claro";
      else delete document.documentElement.dataset.tema;
      try {
        localStorage.setItem("temaDoPainel", claro ? "claro" : "escuro");
      } catch {
        // A escolha vale só nesta visita.
      }
      botao.textContent = rotulo();
      const cor = document.querySelector('meta[name="theme-color"]');
      if (cor) cor.content = claro ? "#ffffff" : "#12131b";
    });
  });
})();
