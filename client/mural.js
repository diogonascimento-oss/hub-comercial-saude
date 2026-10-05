// Mural: página para exibição contínua em uma tela da sala. Mostra o mês
// corrente em até três telas que se alternam. Exibe apenas totais; nenhum dado
// pessoal de lead é carregado. Depende de mapa-brasil.js para o desenho do mapa.

const API = "/api";
const ATUALIZAR_A_CADA_MS = 5 * 60 * 1000;
const RECARREGAR_A_PAGINA_A_CADA_MS = 6 * 60 * 60 * 1000; // para receber versões novas do painel
const CHAVE_DOS_AJUSTES = "mural:ajustes";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const numero = (n) => (n ?? 0).toLocaleString("pt-BR");
const percentual = (t) => (t === null || t === undefined ? "—" : `${t.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

// --- Ajustes: quais blocos aparecem e o tempo de cada tela ---------------------

const BLOCOS = [
  { chave: "metas", nome: "Metas do mês", tela: "telaResumo" },
  { chave: "indicadores", nome: "Indicadores do mês", tela: "telaResumo" },
  { chave: "reunioesHoje", nome: "Reuniões de hoje", tela: "telaResumo" },
  { chave: "campanhas", nome: "Resumo por campanha", tela: "telaResumo" },
  { chave: "etapas", nome: "Leads em cada etapa", tela: "telaResumo" },
  { chave: "evolucao", nome: "Evolução ao longo das etapas", tela: "telaEvolucao" },
  { chave: "mapa", nome: "Mapa de leads por estado", tela: "telaMapa" },
];
const NOME_DA_TELA = { telaResumo: "tela 1", telaEvolucao: "tela 2", telaMapa: "tela 3" };

let ajustes = { blocos: Object.fromEntries(BLOCOS.map((b) => [b.chave, true])), segundos: 30 };

function lerAjustes() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DOS_AJUSTES) || "null");
    if (salvo?.blocos) ajustes = { blocos: { ...ajustes.blocos, ...salvo.blocos }, segundos: Number(salvo.segundos) || 30 };
  } catch {
    // Sem armazenamento disponível: vale o padrão.
  }
}
function gravarAjustes() {
  try {
    localStorage.setItem(CHAVE_DOS_AJUSTES, JSON.stringify(ajustes));
  } catch {
    // A escolha vale até a página ser recarregada.
  }
}

// --- Telas e alternância -------------------------------------------------------

let telasAtivas = [];
let telaAtual = 0;
let relogioDasTelas = null;

function aplicarAjustes() {
  aplicarVisibilidade();
  telasAtivas = [...new Set(BLOCOS.filter((b) => ajustes.blocos[b.chave]).map((b) => b.tela))];
  if (!telasAtivas.length) telasAtivas = ["telaResumo"];
  mostrarTela(Math.min(telaAtual, telasAtivas.length - 1));
  clearInterval(relogioDasTelas);
  if (telasAtivas.length > 1) relogioDasTelas = setInterval(() => mostrarTela((telaAtual + 1) % telasAtivas.length), ajustes.segundos * 1000);
}

// Chamada também depois de cada atualização, porque os cartões são redesenhados.
function aplicarVisibilidade() {
  for (const el of document.querySelectorAll("[data-bloco]")) el.hidden = !ajustes.blocos[el.dataset.bloco];
  $("indicadores").hidden = !ajustes.blocos.indicadores && !ajustes.blocos.reunioesHoje;
  $("base").hidden = !ajustes.blocos.campanhas && !ajustes.blocos.etapas;
}

function mostrarTela(indice) {
  telaAtual = indice;
  for (const tela of document.querySelectorAll(".tela")) tela.classList.toggle("ativa", tela.id === telasAtivas[indice]);
  $("pontos").innerHTML = telasAtivas.length > 1 ? telasAtivas.map((_, i) => `<i class="${i === indice ? "ativo" : ""}"></i>`).join("") : "";
}

function abrirAjustes() {
  $("opcoesDeBlocos").innerHTML = BLOCOS.map(
    (b) => `<label><input type="checkbox" data-chave="${b.chave}" ${ajustes.blocos[b.chave] ? "checked" : ""}> ${esc(b.nome)} <small>${NOME_DA_TELA[b.tela]}</small></label>`,
  ).join("");
  $("segundosPorTela").value = String(ajustes.segundos);
  $("ajustes").hidden = false;
}
function fecharAjustes() {
  for (const caixa of $("opcoesDeBlocos").querySelectorAll("input")) ajustes.blocos[caixa.dataset.chave] = caixa.checked;
  ajustes.segundos = Number($("segundosPorTela").value) || 30;
  gravarAjustes();
  $("ajustes").hidden = true;
  aplicarAjustes();
  atualizar();
}

// --- Dados ---------------------------------------------------------------------

// Data de hoje no horário do escritório, no formato AAAA-MM-DD.
function hojeNoEscritorio() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife" }).format(new Date());
}

async function chamarApi(caminho) {
  const resposta = await fetch(`${API}${caminho}`);
  const tipo = resposta.headers.get("Content-Type") || "";
  if (!tipo.includes("application/json")) throw new Error("SESSAO");
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.error || `Código ${resposta.status}`);
  return corpo;
}

// --- Tela 1: resumo ------------------------------------------------------------

function renderizarMetas(metas, hoje, deHoje) {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const fracaoDoMes = dia / new Date(ano, mes, 0).getDate();
  $("metas").innerHTML = (metas?.itens || [])
    .map((m) => {
      const pct = m.meta > 0 ? Math.min((m.atual / m.meta) * 100, 100) : 0;
      const esperado = Math.round(m.meta * fracaoDoMes);
      const cor = m.atual >= m.meta ? "var(--bom)" : m.atual >= esperado ? "var(--ouro)" : "var(--ruim)";
      const faltam = Math.max(m.meta - m.atual, 0);
      return `
      <div class="cartao meta">
        <p class="rotulo">${esc(m.rotulo)} · meta do mês</p>
        <div>
          <p class="valor serifa num">${numero(m.atual)} <small>/ ${numero(m.meta)}</small></p>
          <div class="trilho">
            <div class="barra" style="width:${pct}%;background:${cor}"></div>
            <div class="ritmo" style="left:${Math.min(fracaoDoMes * 100, 100)}%"></div>
          </div>
          <p class="rodape"><span>Hoje: ${numero(deHoje?.volume?.[m.chave])} · ${faltam ? `faltam ${numero(faltam)}` : "meta atingida"}</span><span>Ritmo esperado até hoje: ${numero(esperado)}</span></p>
        </div>
      </div>`;
    })
    .join("");
}

function renderizarIndicadores(doMes, deHoje, reunioes) {
  const v = doMes.volume, t = doMes.taxas;
  const cartao = (rotulo, valor, detalhe, bloco = "indicadores") => `
    <div class="cartao ind${bloco === "reunioesHoje" ? " destaque" : ""}" data-bloco="${bloco}">
      <p class="rotulo">${rotulo}</p>
      <div><p class="valor serifa num">${numero(valor)}</p><p class="detalhe">${detalhe}</p></div>
    </div>`;
  // Reuniões com data para hoje, pelo campo "Data da Reunião" do lead.
  const r = reunioes || { emUso: false, total: 0, horarios: [] };
  const detalheDeHoje = !r.emUso
    ? "Campo ainda sem uso"
    : !r.total
      ? "Nenhuma com data para hoje"
      : r.proxima
        ? `Próxima às <strong>${esc(r.proxima)}</strong> · faltam ${numero(r.aindaPorAcontecer)}`
        : r.horarios.length
          ? "Todas já passaram do horário"
          : "Sem horário informado";
  const taxa = (rotulo, valor, detalhe) => cartao(rotulo, valor, detalhe).replace(/(<p class="valor serifa num">)[^<]*/, `$1${percentual(valor)}`);
  // Reuniões marcadas, realizadas e contratos já aparecem nas metas. Com as
  // metas à mostra, esta fileira traz as taxas; sem elas, traz as contagens.
  const complemento = ajustes.blocos.metas
    ? [
        taxa("Comparecimento", t.comparecimento, `<strong>${numero(v.realizadasDaCoorte)}</strong> de ${numero(v.reunioesMarcadas)} marcadas`),
        taxa("Fechamento", t.reuniaoParaFechamento, `<strong>${numero(v.fechados)}</strong> de ${numero(v.reunioesRealizadas)} realizadas`),
        taxa("Conversão final", t.conversaoFinal, `<strong>${numero(v.fechados)}</strong> de ${numero(v.leadsRecebidos)} leads`),
      ]
    : [
        cartao("Reuniões marcadas", v.reunioesMarcadas, `Hoje: <strong>${numero(deHoje?.volume.reunioesMarcadas)}</strong>`),
        cartao("Reuniões realizadas", v.reunioesRealizadas, `Comparecimento: <strong>${percentual(t.comparecimento)}</strong>`),
        cartao("Contratos fechados", v.fechados, `Conversão final: <strong>${percentual(t.conversaoFinal)}</strong>`),
      ];
  $("indicadores").innerHTML = [
    cartao("Reuniões de hoje", r.total, detalheDeHoje, "reunioesHoje"),
    cartao("Leads no mês", v.leadsRecebidos, `Hoje: <strong>${numero(deHoje?.volume.leadsRecebidos)}</strong>`),
    cartao("Qualificados", v.qualificados, `Qualificação: <strong>${percentual(t.qualificacao)}</strong>`),
    ...complemento,
  ].join("");
}

function renderizarCampanhas(campanhas, escopos) {
  const linha = (nome, descricao, e, classe = "") => `
    <tr class="${classe}">
      <td>${esc(nome)}${descricao ? `<small>${esc(descricao)}</small>` : ""}</td>
      <td class="num">${numero(e.volume.leadsRecebidos)}</td>
      <td class="num">${numero(e.volume.qualificados)}</td>
      <td class="num">${numero(e.volume.reunioesMarcadas)}</td>
      <td class="num">${numero(e.volume.reunioesRealizadas)}</td>
      <td class="num">${numero(e.volume.fechados)}</td>
    </tr>`;
  $("porCampanha").innerHTML =
    campanhas.filter((c) => escopos[c.codigo]).map((c) => linha(c.codigo, c.nome, escopos[c.codigo])).join("") +
    linha("Total", "", escopos.TODAS, "total");
}

const CORES_DE_CATEGORIA = { triagem: "#8d8f9b", avanco: "#b6923f", sucesso: "#4fb38a", perda: "#d0685a" };

function renderizarEtapas(etapas, volumeAtual) {
  const conhecidas = etapas.filter((e) => e.categoria !== "outra");
  const maximo = Math.max(...conhecidas.map((e) => volumeAtual[e.chave] || 0), 1);
  $("porEtapa").innerHTML = conhecidas
    .map((e) => {
      const qtd = volumeAtual[e.chave] || 0;
      return `
      <div class="etapa">
        <span class="nome">${esc(e.nome)}</span>
        <span class="trilho"><span class="barra" style="width:${(qtd / maximo) * 100}%;background:${CORES_DE_CATEGORIA[e.categoria] || "#5d6070"}"></span></span>
        <span class="qtd num">${numero(qtd)}</span>
      </div>`;
    })
    .join("");
}

// --- Tela 2: evolução ao longo das etapas --------------------------------------

const SERIES = [
  { cor: "#d8b565", traco: "" },
  { cor: "#6ea8d8", traco: "14,8" },
  { cor: "#4fb38a", traco: "4,7" },
];
const DESVIOS = ["REMARCACAO", "REAQUECIMENTO", "DESQUALIFICADO"];

function renderizarEvolucao(campanhas, etapas, escopos) {
  const caminho = etapas.filter((e) => e.categoria !== "outra" && !DESVIOS.includes(e.chave));
  const series = campanhas
    .filter((c) => escopos[c.codigo])
    .map((c, i) => ({ ...SERIES[i % SERIES.length], nome: c.codigo, valores: caminho.map((e) => escopos[c.codigo].entradasPorEtapa?.[e.chave] || 0) }));

  const W = 1600, H = 640, ML = 70, MR = 40, MT = 46, MB = 86;
  const areaW = W - ML - MR, areaH = H - MT - MB, base = MT + areaH;
  const passo = caminho.length > 1 ? areaW / (caminho.length - 1) : 0;
  const maximo = Math.max(...series.flatMap((s) => s.valores), 1);
  const x = (i) => ML + i * passo;
  const y = (v) => base - (v / maximo) * areaH;

  const marcas = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => `<line x1="${ML}" y1="${y(maximo * f)}" x2="${W - MR}" y2="${y(maximo * f)}" stroke="#1f2130"/><text x="${ML - 14}" y="${y(maximo * f) + 7}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="20" fill="#6b6d7a">${Math.round(maximo * f)}</text>`)
    .join("");
  // Nomes das etapas em até duas linhas, para caberem sob cada ponto.
  const rotulos = caminho
    .map((e, i) => {
      const palavras = e.nome.split(" ");
      const linhas = palavras.length > 1 ? [palavras.slice(0, Math.ceil(palavras.length / 2)).join(" "), palavras.slice(Math.ceil(palavras.length / 2)).join(" ")] : [e.nome];
      const ancora = i === 0 ? "start" : i === caminho.length - 1 ? "end" : "middle";
      return linhas.map((l, li) => `<text x="${x(i)}" y="${base + 36 + li * 26}" text-anchor="${ancora}" font-family="Inter, sans-serif" font-size="22" fill="#9a9ca8">${esc(l)}</text>`).join("");
    })
    .join("");
  // Cada número fica junto ao ponto da sua linha. Quando os pontos de uma etapa
  // estão próximos, os números são afastados na vertical para não se sobreporem.
  const ALTURA_DO_NUMERO = 34;
  const numeros = caminho
    .map((_, i) => {
      const ancora = i === 0 ? "start" : i === caminho.length - 1 ? "end" : "middle";
      const texto = (valor, yTexto, cor) =>
        `<text x="${x(i)}" y="${yTexto.toFixed(1)}" text-anchor="${ancora}" font-family="Fraunces, Georgia, serif" font-size="30" font-weight="600" fill="${cor}" stroke="#12131b" stroke-width="7" paint-order="stroke" stroke-linejoin="round">${numero(valor)}</text>`;
      // Um rótulo por valor distinto: na cor da campanha quando o valor é só
      // dela, em cor neutra quando duas ou mais campanhas coincidem.
      const porValor = new Map();
      for (const s of series) porValor.set(s.valores[i], [...(porValor.get(s.valores[i]) || []), s]);
      const rotulosDaEtapa = [...porValor]
        .map(([valor, donas]) => ({ valor, cor: donas.length > 1 ? "#e9e7de" : donas[0].cor, y: y(valor) - 18 }))
        .sort((a, b) => a.y - b.y);
      // De cima para baixo, garante a distância mínima; se passar da base, sobe o conjunto.
      for (let k = 1; k < rotulosDaEtapa.length; k++) rotulosDaEtapa[k].y = Math.max(rotulosDaEtapa[k].y, rotulosDaEtapa[k - 1].y + ALTURA_DO_NUMERO);
      const excesso = rotulosDaEtapa.at(-1).y - (base - 10);
      if (excesso > 0) for (const r of rotulosDaEtapa) r.y -= excesso;
      for (let k = rotulosDaEtapa.length - 2; k >= 0; k--) rotulosDaEtapa[k].y = Math.min(rotulosDaEtapa[k].y, rotulosDaEtapa[k + 1].y - ALTURA_DO_NUMERO);
      return rotulosDaEtapa.map((r) => texto(r.valor, Math.max(r.y, 26), r.cor)).join("");
    })
    .join("");
  const linhas = series
    .map(
      (s) => `<path d="${s.valores.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.cor}" stroke-width="5" stroke-linejoin="round"${s.traco ? ` stroke-dasharray="${s.traco}"` : ""}/>
      ${s.valores.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="8" fill="${s.cor}" stroke="#12131b" stroke-width="3"/>`).join("")}`,
    )
    .join("");

  $("graficoEvolucao").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolução dos leads ao longo das etapas, por campanha">${marcas}<line x1="${ML}" y1="${base}" x2="${W - MR}" y2="${base}" stroke="#33364a"/>${linhas}${numeros}${rotulos}</svg>`;
  $("legendaEvolucao").innerHTML =
    series
      .map((s) => `<span><i style="background:${s.traco ? `repeating-linear-gradient(90deg, ${s.cor} 0 10px, transparent 10px 16px)` : s.cor}"></i>${esc(s.nome)}</span>`)
      .join("") + '<span style="margin-left:auto">Número colorido: valor de uma campanha. Número branco: valor igual em mais de uma.</span>';
}

// --- Tela 3: mapa --------------------------------------------------------------

function renderizarMapa(analise) {
  const lista = analise?.porEstado || [];
  const porSigla = new Map(lista.map((g) => [g.grupo, g.totalLeads]));
  const maximo = Math.max(...lista.filter((g) => MAPA_ESTADOS_BRASIL[g.grupo]).map((g) => g.totalLeads), 1);
  const estados = Object.entries(MAPA_ESTADOS_BRASIL)
    .map(([sigla, info]) => {
      const total = porSigla.get(sigla) || 0;
      const cor = total > 0 ? interpolarCor("#3a3221", "#d8b565", total / maximo) : "#181a24";
      return `<path d="${info.d}" fill="${cor}" stroke="#0b0c11" stroke-width="1.2"/>
        <text x="${info.labelX}" y="${info.labelY}" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="700" fill="${total > 0 ? "#0b0c11" : "#6b6d7a"}" text-anchor="middle">${sigla}</text>`;
    })
    .join("");
  $("mapa").innerHTML = `<svg viewBox="0 0 450 460" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa do Brasil com a quantidade de leads por estado">${estados}</svg>`;

  const ordenados = lista.filter((g) => MAPA_ESTADOS_BRASIL[g.grupo] && g.totalLeads > 0).sort((a, b) => b.totalLeads - a.totalLeads || a.grupo.localeCompare(b.grupo));
  const total = analise?.totalLeads || 0;
  $("estados").innerHTML = ordenados.length
    ? ordenados
        .slice(0, 10)
        .map(
          (g) => `
      <div class="etapa" style="grid-template-columns:14vw 1fr 8vw;font-size:2.2vh">
        <span class="nome" style="color:var(--tinta)">${esc(MAPA_ESTADOS_BRASIL[g.grupo].nome)}</span>
        <span class="trilho" style="height:1.6vh"><span class="barra" style="width:${(g.totalLeads / maximo) * 100}%;background:var(--ouroclaro)"></span></span>
        <span class="qtd num" style="font-size:2.6vh">${numero(g.totalLeads)} <small style="font-size:1.6vh;color:var(--apagada);font-weight:400">${percentual(total ? Math.round((g.totalLeads / total) * 1000) / 10 : 0)}</small></span>
      </div>`,
        )
        .join("")
    : '<p class="explica">Nenhum lead com estado identificado neste mês.</p>';

  const semEstado = porSigla.get("(não informado)") || 0;
  $("regioes").innerHTML =
    (analise?.porRegiao || [])
      .filter((g) => g.grupo !== "(não informado)" && g.totalLeads > 0)
      .sort((a, b) => b.totalLeads - a.totalLeads)
      .map((g) => `<span>${esc(g.grupo)} <strong class="num">${numero(g.totalLeads)}</strong></span>`)
      .join("") + (semEstado ? `<span>Sem estado identificado <strong class="num">${numero(semEstado)}</strong></span>` : "");
}

// --- Atualização ---------------------------------------------------------------

async function atualizar() {
  const hoje = hojeNoEscritorio();
  const inicioDoMes = `${hoje.slice(0, 8)}01`;
  try {
    // resumo=1: o servidor devolve apenas totais, sem as listas de leads.
    const [mes, dia, trafego] = await Promise.all([
      chamarApi(`/metrics?inicio=${inicioDoMes}&fim=${hoje}&resumo=1`),
      chamarApi(`/metrics?inicio=${hoje}&fim=${hoje}&resumo=1`),
      chamarApi(`/analise-trafego?inicio=${inicioDoMes}&fim=${hoje}&apenasNovos=true&resumo=1`),
    ]);
    renderizarMetas(mes.metas, hoje, dia.escopos.TODAS);
    renderizarIndicadores(mes.escopos.TODAS, dia.escopos.TODAS, mes.reunioesDeHoje);
    renderizarCampanhas(mes.campanhas, mes.escopos);
    renderizarEtapas(mes.etapas, mes.escopos.TODAS.volumeAtual);
    renderizarEvolucao(mes.campanhas, mes.etapas, mes.escopos);
    renderizarMapa(trafego);
    aplicarVisibilidade();
    $("mes").textContent = new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    $("atualizado").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    $("aviso").textContent = "";
  } catch (erro) {
    $("aviso").textContent =
      erro.message === "SESSAO"
        ? "Sessão expirada. Recarregue a página e entre novamente para continuar atualizando."
        : "Sem resposta do servidor. Os números exibidos são os da última atualização; nova tentativa em instantes.";
  }
}

function marcarHora() {
  $("relogio").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Tela cheia e tela sempre ligada, quando o navegador permitir.
function telaCheia() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
async function manterTelaLigada() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Sem suporte ou sem permissão: o aparelho segue a configuração dele.
  }
}

$("btnTelaCheia").addEventListener("click", telaCheia);
$("btnAjustar").addEventListener("click", abrirAjustes);
$("btnFecharAjustes").addEventListener("click", fecharAjustes);
document.addEventListener("keydown", (e) => {
  if (!$("ajustes").hidden) return e.key === "Escape" && fecharAjustes();
  if (e.key.toLowerCase() === "f") telaCheia();
  if (e.key === "ArrowRight") mostrarTela((telaAtual + 1) % telasAtivas.length);
  if (e.key === "ArrowLeft") mostrarTela((telaAtual - 1 + telasAtivas.length) % telasAtivas.length);
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && manterTelaLigada());

lerAjustes();
aplicarAjustes();
marcarHora();
setInterval(marcarHora, 15000);
atualizar();
setInterval(atualizar, ATUALIZAR_A_CADA_MS);
setTimeout(() => location.reload(), RECARREGAR_A_PAGINA_A_CADA_MS);
manterTelaLigada();
