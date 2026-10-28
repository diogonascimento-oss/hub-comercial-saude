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

  // Barra fina no topo mostra quanto da página já foi percorrido.
  const progresso = document.createElement("div");
  progresso.className = "progresso-da-rolagem";
  progresso.setAttribute("aria-hidden", "true");
  document.body.appendChild(progresso);

  // Profundidade no cabeçalho: o monograma e o nome descem mais devagar que a
  // página e esmaecem ao rolar (paralaxe).
  const marca = document.querySelector("header > div > div:first-child");
  let pendente = false;
  function aoRolar() {
    pendente = false;
    const y = scrollY;
    const total = document.documentElement.scrollHeight - innerHeight;
    progresso.style.transform = `scaleX(${total > 0 ? Math.min(y / total, 1) : 0})`;
    if (marca && y < 400) {
      marca.style.transform = `translateY(${(y * 0.35).toFixed(1)}px)`;
      marca.style.opacity = String(Math.max(1 - y / 260, 0.15));
    }
  }
  addEventListener("scroll", () => {
    if (!pendente) {
      pendente = true;
      requestAnimationFrame(aoRolar);
    }
  }, { passive: true });
  aoRolar();

  // Luz que acompanha o ponteiro nos cartões e quadros: a superfície reage ao
  // toque e ao mouse.
  document.addEventListener(
    "pointermove",
    (e) => {
      const alvo = e.target.closest?.(".grade > div, .reage-ao-toque");
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      alvo.style.setProperty("--mx", `${e.clientX - r.left}px`);
      alvo.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    { passive: true },
  );

  // Ondulação a partir do ponto tocado nos botões principais.
  document.addEventListener("pointerdown", (e) => {
    const botao = e.target.closest?.(".ondula");
    if (!botao) return;
    const r = botao.getBoundingClientRect();
    const onda = document.createElement("span");
    onda.className = "onda";
    const lado = Math.max(r.width, r.height) * 2;
    onda.style.cssText = `width:${lado}px;height:${lado}px;left:${e.clientX - r.left - lado / 2}px;top:${e.clientY - r.top - lado / 2}px`;
    botao.appendChild(onda);
    setTimeout(() => onda.remove(), 650);
  });

  const grade = document.getElementById("cartoes");
  if (grade) new MutationObserver(() => contarCartoes(grade)).observe(grade, { childList: true });
})();
