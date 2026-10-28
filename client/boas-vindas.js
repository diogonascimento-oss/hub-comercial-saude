// Saudação ao abrir o painel: uma vez por sessão do navegador, por cerca de
// dois segundos, com o primeiro nome da conta usada no login. Um clique ou
// qualquer tecla fecha antes. Depende de app.js (chamarApi).

(function () {
  try {
    if (sessionStorage.getItem("boasVindasMostradas")) return;
    sessionStorage.setItem("boasVindasMostradas", "1");
  } catch {
    // Sem armazenamento da sessão: a saudação aparece a cada abertura.
  }
  const semMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Nomes femininos que não terminam em "a" e masculinos que terminam.
  const FEMININOS = new Set(["beatriz", "raquel", "isabel", "ingrid", "carmen", "ester", "esther", "rute", "ruth", "lais", "thais", "tais", "iris", "jaqueline", "michele", "michelle", "caroline", "aline", "alice", "simone", "elaine", "denise", "liz", "luz", "rachel", "suellen", "karen", "kelly", "nicole", "danielle", "gabrielle", "gisele", "giselle", "jamile", "lorraine", "mabel", "miriam", "noemi", "solange", "yasmin", "jasmin", "evelyn", "ellen", "sharon", "vivian", "lilian", "marilene", "rosimeire", "cleide", "irene", "ivone", "ines", "dulce", "hellen", "agnes", "mercedes", "rosangela"]);
  const MASCULINOS = new Set(["luca", "lucca", "joshua", "nicola", "elias", "jonas", "matias", "tobias", "garcia", "costa", "sousa", "souza"]);

  function primeiroNome(usuario) {
    const local = String(usuario || "").split("@")[0];
    const nome = local.split(/[._\-+\d]/).find(Boolean) || "";
    return nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
  }
  function bemVindo(nome) {
    const chave = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!chave) return "Boas-vindas";
    const feminino = FEMININOS.has(chave) || (chave.endsWith("a") && !MASCULINOS.has(chave));
    return feminino ? "Bem-vinda" : "Bem-vindo";
  }
  function saudacaoDoHorario() {
    const hora = Number(new Date().toLocaleString("en-US", { timeZone: "America/Recife", hour: "numeric", hour12: false }));
    return hora >= 5 && hora < 12 ? "Bom dia" : hora >= 12 && hora < 18 ? "Boa tarde" : "Boa noite";
  }

  const monograma = document.querySelector("header svg")?.outerHTML || "";
  const tela = document.createElement("div");
  tela.id = "boasVindas";
  tela.setAttribute("role", "status");
  tela.className = "fixed inset-0 z-[100] flex items-center justify-center bg-bg cursor-pointer";
  tela.innerHTML = `
    <div class="boas-vindas-conteudo text-center px-6">
      <div class="boas-vindas-logo mx-auto w-fit [&>svg]:h-16 [&>svg]:w-auto">${monograma}</div>
      <p class="boas-vindas-saudacao rotulo mt-8">${saudacaoDoHorario()}</p>
      <p class="boas-vindas-nome font-serif text-3xl md:text-4xl text-ink mt-3"><span data-bem-vindo>Boas-vindas</span><span data-nome></span></p>
      <span class="boas-vindas-linha block h-px w-40 bg-gold/70 mx-auto mt-6"></span>
      <p class="boas-vindas-sub text-xs text-inkdim mt-5 uppercase tracking-[0.3em]">Hub Comercial · Núcleo de Saúde</p>
    </div>`;
  document.body.appendChild(tela);
  document.body.classList.add("com-boas-vindas");

  chamarApi("/eu")
    .then(({ usuario }) => {
      const nome = primeiroNome(usuario);
      if (!nome || !tela.isConnected) return;
      tela.querySelector("[data-bem-vindo]").textContent = bemVindo(nome);
      tela.querySelector("[data-nome]").textContent = `, ${nome}`;
    })
    .catch(() => {});

  let fechada = false;
  function fechar() {
    if (fechada) return;
    fechada = true;
    document.body.classList.remove("com-boas-vindas");
    if (semMovimento) return tela.remove();
    tela.classList.add("saindo");
    setTimeout(() => tela.remove(), 650);
  }
  tela.addEventListener("click", fechar);
  addEventListener("keydown", fechar, { once: true });
  setTimeout(fechar, semMovimento ? 1600 : 2300);
})();
