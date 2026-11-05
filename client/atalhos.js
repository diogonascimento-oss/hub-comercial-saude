// Atalhos no topo de cada aba: botões "Ir para" que levam à seção escolhida.
// Cada botão traz em data-ir o id do título da seção. A barra fica fixa no topo
// ao rolar; a rolagem desconta a altura dela para o título não ficar escondido.

document.addEventListener("click", (evento) => {
  const botao = evento.target.closest("[data-ir]");
  if (!botao) return;
  const titulo = document.getElementById(botao.dataset.ir);
  if (!titulo) return;
  // Seções recolhíveis são abertas ao chegar nelas.
  const bloco = titulo.closest("details") || titulo.closest("section") || titulo;
  if (bloco.tagName === "DETAILS") bloco.open = true;
  // Seção escondida (sem layout) não tem para onde rolar.
  if (!bloco.getClientRects().length) return;
  const barra = botao.closest("[data-atalhos]");
  const folga = (barra ? barra.offsetHeight : 0) + 12;
  window.scrollTo({ top: bloco.getBoundingClientRect().top + window.scrollY - folga, behavior: "smooth" });
});
