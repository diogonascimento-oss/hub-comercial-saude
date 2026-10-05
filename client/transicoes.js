// Movimento do painel que depende de script: seções que aparecem ao entrar na
// tela e números dos cartões que contam até o valor. As demais transições são
// só CSS (estilos/entrada.css).

(function () {
  const semMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (semMovimento) return;

  // Seções aparecem na primeira vez que entram na tela.
  if ("IntersectionObserver" in window) {
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) continue;
          entrada.target.classList.add("visivel");
          observador.unobserve(entrada.target);
        }
      },
      { threshold: 0.04 },
    );
    for (const secao of document.querySelectorAll("main section")) {
      secao.classList.add("revelar");
      observador.observe(secao);
    }
  }

  // Números inteiros dos cartões contam de zero até o valor quando o cartão é redesenhado.
  function contar(elemento) {
    const texto = elemento.textContent.trim();
    if (!/^\d{1,3}(\.\d{3})*$/.test(texto)) return;
    const alvo = Number(texto.replace(/\./g, ""));
    if (alvo < 2) return;
    const inicio = performance.now();
    const duracao = 650;
    (function quadro(agora) {
      const fracao = Math.min((agora - inicio) / duracao, 1);
      const suave = 1 - Math.pow(1 - fracao, 3);
      elemento.textContent = Math.round(alvo * suave).toLocaleString("pt-BR");
      if (fracao < 1) requestAnimationFrame(quadro);
    })(inicio);
  }

  function contarCartoes(grade) {
    for (const valor of grade.querySelectorAll(":scope > div > p:first-child")) {
      // O número pode estar dentro de um botão (cartão clicável).
      contar(valor.querySelector("button") || valor);
    }
  }

  const grade = document.getElementById("cartoes");
  if (grade) new MutationObserver(() => contarCartoes(grade)).observe(grade, { childList: true });
})();
