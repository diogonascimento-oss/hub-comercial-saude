// Mural: página para exibição contínua em uma tela da sala. Mostra o mês
// corrente em até três telas que se alternam. Exibe apenas totais; nenhum dado
// pessoal de lead é carregado. Depende de mapa-brasil.js para o desenho do mapa.

const API = "/api";
const ATUALIZAR_A_CADA_MS = 60 * 1000; // curto, para a comemoração sair perto do fato
const RECARREGAR_A_PAGINA_A_CADA_MS = 6 * 60 * 60 * 1000; // para receber versões novas do painel
const CHAVE_DOS_AJUSTES = "mural:ajustes";
const CHAVE_DA_CONTAGEM = "mural:contagem";

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

// contarDesde: data (AAAA-MM-DD) a partir da qual o mural conta, dentro do mês
// corrente. Vazio, o padrão, conta o mês inteiro.
let ajustes = { blocos: Object.fromEntries(BLOCOS.map((b) => [b.chave, true])), segundos: 30, som: true, desvios: false, contarDesde: "" };

function lerAjustes() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DOS_AJUSTES) || "null");
    if (salvo?.blocos) ajustes = { blocos: { ...ajustes.blocos, ...salvo.blocos }, segundos: Number(salvo.segundos) || 30, som: salvo.som !== false, desvios: salvo.desvios === true, contarDesde: /^\d{4}-\d{2}-\d{2}$/.test(salvo.contarDesde || "") ? salvo.contarDesde : "" };
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
  $("pontos").style.setProperty("--tela", `${ajustes.segundos}s`);
  mostrarTela(Math.min(telaAtual, telasAtivas.length - 1));
  reiniciarAlternancia();
}

// Recomeça a contagem da tela atual. Usada também na troca manual, pelas setas.
function reiniciarAlternancia() {
  clearInterval(relogioDasTelas);
  if (telasAtivas.length > 1) relogioDasTelas = setInterval(() => mostrarTela((telaAtual + 1) % telasAtivas.length), ajustes.segundos * 1000);
}
function trocarDeTelaManualmente(passo) {
  mostrarTela((telaAtual + passo + telasAtivas.length) % telasAtivas.length);
  reiniciarAlternancia();
}

// Chamada também depois de cada atualização, porque os cartões são redesenhados.
function aplicarVisibilidade() {
  for (const el of document.querySelectorAll("[data-bloco]")) el.hidden = !ajustes.blocos[el.dataset.bloco];
  $("indicadores").hidden = !ajustes.blocos.indicadores && !ajustes.blocos.reunioesHoje;
  $("base").hidden = !ajustes.blocos.campanhas && !ajustes.blocos.etapas;
}

function mostrarTela(indice) {
  const anterior = telasAtivas[telaAtual];
  telaAtual = indice;
  for (const tela of document.querySelectorAll(".tela")) {
    const ativa = tela.id === telasAtivas[indice];
    tela.classList.toggle("saindo", !ativa && tela.id === anterior && anterior !== telasAtivas[indice]);
    tela.classList.toggle("ativa", ativa);
    // Ordem de entrada dos cartões da tela que aparece.
    if (ativa) [...tela.querySelectorAll(".cartao")].filter((c) => !c.hidden).forEach((c, i) => c.style.setProperty("--ordem", i));
  }
  $("pontos").innerHTML = telasAtivas.length > 1 ? telasAtivas.map((_, i) => `<i class="${i === indice ? "ativo" : ""}"></i>`).join("") : "";
}

function abrirAjustes() {
  $("opcoesDeBlocos").innerHTML = BLOCOS.map(
    (b) => `<label><input type="checkbox" data-chave="${b.chave}" ${ajustes.blocos[b.chave] ? "checked" : ""}> ${esc(b.nome)} <small>${NOME_DA_TELA[b.tela]}</small></label>`,
  ).join("");
  $("segundosPorTela").value = String(ajustes.segundos);
  $("somLigado").checked = ajustes.som;
  $("comDesvios").checked = ajustes.desvios;
  $("contarDesde").max = hojeNoEscritorio();
  $("contarDesde").value = ajustes.contarDesde;
  $("ajustes").hidden = false;
}
function fecharAjustes() {
  for (const caixa of $("opcoesDeBlocos").querySelectorAll("input")) ajustes.blocos[caixa.dataset.chave] = caixa.checked;
  ajustes.segundos = Number($("segundosPorTela").value) || 30;
  ajustes.som = $("somLigado").checked;
  ajustes.desvios = $("comDesvios").checked;
  const desde = $("contarDesde").value;
  ajustes.contarDesde = /^\d{4}-\d{2}-\d{2}$/.test(desde) && desde <= hojeNoEscritorio() ? desde : "";
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

// Início da contagem: o dia 1 do mês, ou a data escolhida em "Ajustar" quando
// ela cai dentro do mês corrente. Uma data de mês anterior deixa de valer
// sozinha na virada do mês.
function inicioDaContagem(hoje) {
  const inicioDoMes = `${hoje.slice(0, 8)}01`;
  const desde = ajustes.contarDesde;
  return desde && desde > inicioDoMes && desde <= hoje ? desde : inicioDoMes;
}
const diaEMes = (data) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

// Metas da tela. Com o mês inteiro, valem as do servidor. Com início no meio do
// mês, cada meta fica proporcional aos dias contados, e o valor atual é o do
// período contado.
function metasDaTela(mes, hoje, inicio) {
  const itens = mes.metas?.itens || [];
  const [ano, m] = hoje.split("-").map(Number);
  const diasNoMes = new Date(ano, m, 0).getDate();
  const diaInicial = Number(inicio.slice(8, 10));
  if (diaInicial === 1) return itens.map((i) => ({ ...i, metaDoMes: i.meta }));
  const diasContados = diasNoMes - diaInicial + 1;
  return itens.map((i) => ({
    ...i,
    metaDoMes: i.meta,
    meta: i.meta > 0 ? Math.max(1, Math.round((i.meta * diasContados) / diasNoMes)) : 0,
    atual: mes.escopos.TODAS.volume[i.chave] ?? i.atual,
  }));
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

function renderizarMetas(metas, hoje, inicio, deHoje) {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  // Fração do período contado que já passou: do dia inicial até o fim do mês.
  const diaInicial = Number(inicio.slice(8, 10));
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const fracaoDoMes = (dia - diaInicial + 1) / (diasNoMes - diaInicial + 1);
  const proporcional = diaInicial > 1;
  $("metas").innerHTML = metas
    .map((m) => {
      const pct = m.meta > 0 ? Math.min((m.atual / m.meta) * 100, 100) : 0;
      const esperado = Math.round(m.meta * fracaoDoMes);
      const cor = m.atual >= m.meta ? "var(--bom)" : m.atual >= esperado ? "var(--ouro)" : "var(--ruim)";
      const faltam = Math.max(m.meta - m.atual, 0);
      return `
      <div class="cartao meta" data-chave="meta:${esc(m.chave)}" data-valor="${m.atual}" style="--cor:${cor}" ${proporcional ? `title="Meta do mês: ${numero(m.metaDoMes)}. Proporcional aos dias desde ${diaEMes(inicio)}."` : ""}>
        <p class="rotulo">${esc(m.rotulo)} · ${proporcional ? `meta desde ${diaEMes(inicio)}` : "meta do mês"}</p>
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

function renderizarIndicadores(doMes, deHoje, reunioes, rotuloDosLeads = "Leads no mês") {
  const v = doMes.volume, t = doMes.taxas;
  const CORES = { "Reuniões de hoje": "#d8b565", "Leads no mês": "#6ea8d8", Qualificados: "#a78bfa", Comparecimento: "#5fc4d6", Fechamento: "#e0965a", "Conversão final": "#4fb38a", "Reuniões marcadas": "#5fc4d6", "Reuniões realizadas": "#e0965a", "Contratos fechados": "#4fb38a" };
  // medidor: percentual de 0 a 100 exibido como uma régua fina na cor do cartão.
  const cartao = (rotulo, valor, detalhe, bloco = "indicadores", medidor = null, cor = CORES[rotulo]) => `
    <div class="cartao ind${bloco === "reunioesHoje" ? " destaque" : ""}" data-bloco="${bloco}" data-chave="${rotulo}" data-valor="${valor ?? ""}" style="--cor:${cor || "#d8b565"}">
      <p class="rotulo"><i class="pinta"></i>${rotulo}</p>
      <div>
        <p class="valor serifa num">${numero(valor)}</p>
        <p class="detalhe">${detalhe}</p>
        ${medidor === null ? "" : `<div class="medidor"><i style="width:${Math.max(0, Math.min(Number(medidor) || 0, 100))}%"></i></div>`}
      </div>
    </div>`;
  // Reuniões com data para hoje, pelo campo "Data da Reunião" do lead.
  const r = reunioes || { emUso: false, total: 0 };
  const partes = [];
  if (r.proxima) partes.push(`Próxima às <strong>${esc(r.proxima)}</strong>`);
  else if (r.aindaPorAcontecer) partes.push(`<strong>${numero(r.aindaPorAcontecer)}</strong> por acontecer`);
  if (r.realizadas) partes.push(`<strong>${numero(r.realizadas)}</strong> realizada${r.realizadas > 1 ? "s" : ""}`);
  if (r.naoRealizadas) partes.push(`<strong>${numero(r.naoRealizadas)}</strong> não realizada${r.naoRealizadas > 1 ? "s" : ""}`);
  if (r.semDesfecho) partes.push(`<strong>${numero(r.semDesfecho)}</strong> sem desfecho`);
  const detalheDeHoje = !r.emUso ? "Campo ainda sem uso" : !r.total ? "Nenhuma com data para hoje" : partes.join(" · ") || "Fora da etapa Agendado";
  const taxa = (rotulo, valor, detalhe) => cartao(rotulo, valor, detalhe, "indicadores", valor ?? 0).replace(/(<p class="valor serifa num">)[^<]*/, `$1${percentual(valor)}`);
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
    cartao(rotuloDosLeads, v.leadsRecebidos, `Hoje: <strong>${numero(deHoje?.volume.leadsRecebidos)}</strong>`, "indicadores", null, CORES["Leads no mês"]),
    cartao("Qualificados", v.qualificados, `Qualificação: <strong>${percentual(t.qualificacao)}</strong>`, "indicadores", t.qualificacao ?? 0),
    ...complemento,
  ].join("");
}

function renderizarCampanhas(campanhas, escopos) {
  const corDaCampanha = (codigo) => SERIES[campanhas.findIndex((c) => c.codigo === codigo) % SERIES.length]?.cor;
  const linha = (nome, descricao, e, classe = "") => `
    <tr class="${classe}">
      <td>${classe ? "" : `<i class="ponto" style="background:${corDaCampanha(nome)}"></i>`}${esc(nome)}${descricao ? `<small>${esc(descricao)}</small>` : ""}</td>
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
  const conhecidas = etapas.filter((e) => e.categoria !== "outra");
  const principais = conhecidas.filter((e) => !DESVIOS.includes(e.chave));
  // Com a opção ligada, os desvios entram à direita, depois de uma divisória.
  const desvios = ajustes.desvios ? conhecidas.filter((e) => DESVIOS.includes(e.chave)) : [];
  const caminho = [...principais, ...desvios];
  const series = campanhas
    .filter((c) => escopos[c.codigo])
    .map((c, i) => ({ ...SERIES[i % SERIES.length], nome: c.codigo, valores: caminho.map((e) => escopos[c.codigo].entradasPorEtapa?.[e.chave] || 0) }));

  // Com os desvios há onze etapas no eixo: mais margem à direita e rótulos menores.
  const comDesvios = desvios.length > 0;
  const W = 1600, H = 640, ML = 70, MR = comDesvios ? 95 : 40, MT = 46, MB = 86;
  const TAMANHO_DO_ROTULO = comDesvios ? 18 : 22;
  const ultimoNoMeio = comDesvios; // o último rótulo fica centrado quando há margem para isso
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
      // "Desqualificado / Não Fechado" é abreviado para caber.
      const nome = e.nome.split(" / ")[0];
      const palavras = nome.split(" ");
      const linhas = palavras.length > 1 ? [palavras.slice(0, Math.ceil(palavras.length / 2)).join(" "), palavras.slice(Math.ceil(palavras.length / 2)).join(" ")] : [nome];
      const ancora = i === 0 ? "start" : i === caminho.length - 1 && !ultimoNoMeio ? "end" : "middle";
      return linhas.map((l, li) => `<text x="${x(i)}" y="${base + 36 + li * 26}" text-anchor="${ancora}" font-family="Inter, sans-serif" font-size="${TAMANHO_DO_ROTULO}" fill="#9a9ca8">${esc(l)}</text>`).join("");
    })
    .join("");
  // Cada número fica junto ao ponto da sua linha. Quando os pontos de uma etapa
  // estão próximos, os números são afastados na vertical para não se sobreporem.
  const ALTURA_DO_NUMERO = 34;
  const numeros = caminho
    .map((_, i) => {
      const ancora = i === 0 ? "start" : i === caminho.length - 1 && !ultimoNoMeio ? "end" : "middle";
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
      // A linha liga só o caminho principal; os desvios são pontos soltos.
      (s) => `<path d="${s.valores.slice(0, principais.length).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.cor}" stroke-width="5" stroke-linejoin="round"${s.traco ? ` stroke-dasharray="${s.traco}"` : ""}/>
      ${s.valores.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="8" fill="${s.cor}" stroke="#12131b" stroke-width="3"/>`).join("")}`,
    )
    .join("");

  const xDaDivisoria = desvios.length ? x(principais.length - 1) + passo / 2 : null;
  const divisoria = desvios.length
    ? `<line x1="${xDaDivisoria}" y1="${MT - 30}" x2="${xDaDivisoria}" y2="${base}" stroke="#4a4d63" stroke-width="2" stroke-dasharray="6,8"/>
       <text x="${xDaDivisoria + 14}" y="${MT - 22}" font-family="IBM Plex Mono, monospace" font-size="17" letter-spacing="2" fill="#9a9ca8">DESVIOS DO CAMINHO PRINCIPAL</text>`
    : "";

  $("graficoEvolucao").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolução dos leads ao longo das etapas, por campanha">${marcas}${divisoria}<line x1="${ML}" y1="${base}" x2="${W - MR}" y2="${base}" stroke="#33364a"/>${linhas}${numeros}${rotulos}</svg>`;
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
  const inicio = inicioDaContagem(hoje);
  const parcial = !inicio.endsWith("-01");
  try {
    // resumo=1: o servidor devolve apenas totais, sem as listas de leads.
    const [mes, dia, trafego] = await Promise.all([
      chamarApi(`/metrics?inicio=${inicio}&fim=${hoje}&resumo=1`),
      chamarApi(`/metrics?inicio=${hoje}&fim=${hoje}&resumo=1`),
      chamarApi(`/analise-trafego?inicio=${inicio}&fim=${hoje}&apenasNovos=true&resumo=1`),
    ]);
    const metas = metasDaTela(mes, hoje, inicio);
    renderizarMetas(metas, hoje, inicio, dia.escopos.TODAS);
    renderizarIndicadores(mes.escopos.TODAS, dia.escopos.TODAS, mes.reunioesDeHoje, parcial ? `Leads desde ${diaEMes(inicio)}` : "Leads no mês");
    renderizarCampanhas(mes.campanhas, mes.escopos);
    renderizarEtapas(mes.etapas, mes.escopos.TODAS.volumeAtual);
    renderizarEvolucao(mes.campanhas, mes.etapas, mes.escopos);
    renderizarMapa(trafego);
    aplicarVisibilidade();
    destacarMudancas();
    comemorarNovidades(mes, hoje, inicio, metas);
    const nomeDoMes = new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    $("tituloCampanhas").textContent = parcial ? `Desde ${diaEMes(inicio)}, por campanha` : "Mês por campanha";
    $("mes").textContent = parcial ? `${nomeDoMes} · desde ${diaEMes(inicio)}` : nomeDoMes;
    // Horário em que os dados foram lidos do Kommo, e não o da tela.
    $("atualizado").textContent = `Dados do Kommo de ${new Date(mes.dadosDe || Date.now()).toLocaleTimeString("pt-BR")}`;
    $("aviso").textContent = "";
  } catch (erro) {
    $("aviso").textContent =
      erro.message === "SESSAO"
        ? "Sessão expirada. Recarregue a página e entre novamente para continuar atualizando."
        : "Sem resposta do servidor. Os números exibidos são os da última atualização; nova tentativa em instantes.";
  }
}

// --- Destaque do que mudou desde a última atualização --------------------------

const valoresAnteriores = new Map();

function destacarMudancas() {
  for (const cartao of document.querySelectorAll("[data-chave]")) {
    const chave = cartao.dataset.chave;
    const valor = cartao.dataset.valor;
    if (valoresAnteriores.has(chave) && valoresAnteriores.get(chave) !== valor) cartao.classList.add("mudou");
    valoresAnteriores.set(chave, valor);
  }
}

// --- Comemorações ----------------------------------------------------------------

// Compara os totais do mês com os da última leitura, gravados neste aparelho.
// Na primeira leitura do mês só registra a base, sem comemorar.
function comemorarNovidades(mes, hoje, inicio, metas) {
  const atual = {
    mes: hoje.slice(0, 7),
    // Ao mudar o início da contagem os totais mudam sem que nada tenha
    // acontecido; nesse caso só se registra a nova base.
    desde: inicio,
    fechados: {},
    marcadas: mes.escopos.TODAS.volume.reunioesMarcadas,
    realizadas: mes.escopos.TODAS.volume.reunioesRealizadas,
  };
  for (const c of mes.campanhas) atual.fechados[c.codigo] = mes.escopos[c.codigo]?.volume.fechados || 0;
  let anterior = null;
  try {
    anterior = JSON.parse(localStorage.getItem(CHAVE_DA_CONTAGEM) || "null");
    localStorage.setItem(CHAVE_DA_CONTAGEM, JSON.stringify(atual));
  } catch {
    anterior = comemorarNovidades.memoria || null;
  }
  comemorarNovidades.memoria = atual;
  if (!anterior || anterior.mes !== atual.mes || (anterior.desde && anterior.desde !== atual.desde)) return;

  const campanhasComContrato = mes.campanhas.filter((c) => atual.fechados[c.codigo] > (anterior.fechados?.[c.codigo] || 0)).map((c) => c.codigo);
  // Base gravada por uma versão anterior pode não ter todos os campos: nesse caso não comemora.
  const novasMarcadas = atual.marcadas - (anterior.marcadas ?? atual.marcadas);
  const novasRealizadas = atual.realizadas - (anterior.realizadas ?? atual.realizadas);
  const meta = metas.find((m) => m.chave === "fechados");
  let espera = 0;
  if (campanhasComContrato.length) {
    comemorarContrato({ campanhas: campanhasComContrato, total: mes.escopos.TODAS.volume.fechados, meta: meta?.meta, desde: inicio.endsWith("-01") ? null : inicio });
    espera = 10500;
  }
  // Os avisos pequenos saem um depois do outro, e depois da comemoração de contrato.
  if (novasRealizadas > 0) {
    setTimeout(() => avisar("realizada", novasRealizadas, atual.realizadas), espera);
    espera += 7800;
  }
  if (novasMarcadas > 0) setTimeout(() => avisar("marcada", novasMarcadas, atual.marcadas), espera);
}

// Contrato fechado: tela cheia, confete e som, por cerca de dez segundos.
function comemorarContrato({ campanhas, total, meta, desde = null }) {
  const festa = $("festa");
  $("festaSobre").textContent = campanhas.length ? campanhas.join(" · ") : "Núcleo de Saúde";
  const faltam = meta ? Math.max(meta - total, 0) : null;
  $("festaSob").innerHTML = `<strong>${numero(total)}º</strong> contrato ${desde ? `desde ${diaEMes(desde)}` : "do mês"}${faltam === null ? "" : faltam ? ` · faltam <strong>${numero(faltam)}</strong> para a meta` : " · <strong>meta atingida</strong>"}`;
  festa.hidden = false;
  requestAnimationFrame(() => festa.classList.add("aberta"));
  soltarConfete(festa.querySelector("canvas"), 9000);
  tocar("contrato");
  clearTimeout(comemorarContrato.fim);
  comemorarContrato.fim = setTimeout(() => {
    festa.classList.remove("aberta");
    setTimeout(() => (festa.hidden = true), 600);
  }, 9500);
}

// Reunião marcada ou realizada: aviso pequeno no alto da tela, por alguns segundos.
const AVISOS = {
  marcada: { cor: "#6ea8d8", uma: "Nova <strong>reunião marcada</strong>", varias: "novas reuniões marcadas", som: "reuniao" },
  realizada: { cor: "#4fb38a", uma: "<strong>Reunião realizada</strong>", varias: "reuniões realizadas", som: "realizada" },
};
function avisar(tipo, novas, totalDoMes) {
  const aviso = AVISOS[tipo];
  $("recado").style.setProperty("--cor", aviso.cor);
  $("recadoTexto").innerHTML = `${novas > 1 ? `<strong>${numero(novas)}</strong> ${aviso.varias}` : aviso.uma} · ${numero(totalDoMes)} no mês`;
  $("recado").classList.add("aberto");
  tocar(aviso.som);
  clearTimeout(avisar.fim);
  avisar.fim = setTimeout(() => $("recado").classList.remove("aberto"), 7000);
}

function soltarConfete(tela, duracaoMs) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ctx = tela.getContext("2d");
  const L = (tela.width = innerWidth), A = (tela.height = innerHeight);
  const cores = ["#e6c983", "#d8b565", "#fff3cf", "#4fb38a", "#6ea8d8", "#e9e7de"];
  const pecas = Array.from({ length: 220 }, (_, i) => ({
    x: Math.random() * L,
    y: -Math.random() * A * 0.6 - 20,
    vx: (Math.random() - 0.5) * 2.4,
    vy: 2.2 + Math.random() * 4.2,
    lado: 6 + Math.random() * 10,
    giro: Math.random() * Math.PI,
    vGiro: (Math.random() - 0.5) * 0.25,
    cor: cores[i % cores.length],
  }));
  const inicio = performance.now();
  (function quadro(agora) {
    const decorrido = agora - inicio;
    ctx.clearRect(0, 0, L, A);
    ctx.globalAlpha = Math.max(0, Math.min(1, (duracaoMs - decorrido) / 1500));
    for (const p of pecas) {
      p.x += p.vx + Math.sin((decorrido + p.lado * 90) / 600) * 0.8;
      p.y += p.vy;
      p.giro += p.vGiro;
      if (p.y > A + 20 && decorrido < duracaoMs - 2500) p.y = -20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.giro);
      ctx.fillStyle = p.cor;
      ctx.fillRect(-p.lado / 2, -p.lado / 4, p.lado, p.lado / 2);
      ctx.restore();
    }
    if (decorrido < duracaoMs) requestAnimationFrame(quadro);
    else ctx.clearRect(0, 0, L, A);
  })(inicio);
}

// --- Som -------------------------------------------------------------------------
// Os sons são gerados pelo próprio navegador, sem arquivo de áudio. O navegador
// só libera o som depois de um clique ou tecla na página.

let audio = null;
function liberarSom() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {
    audio = null;
  }
}

function tocar(tipo) {
  if (!ajustes.som || !audio || audio.state !== "running") return;
  // Cada nota: [frequência em Hz, início em segundos, duração em segundos].
  const notas =
    tipo === "contrato"
      ? [[523.25, 0, 0.5], [659.25, 0.14, 0.5], [783.99, 0.28, 0.5], [1046.5, 0.42, 1.1], [783.99, 0.42, 1.1], [1318.5, 0.75, 1.3]]
      : tipo === "realizada"
        ? [[659.25, 0, 0.4], [880, 0.14, 0.4], [1318.5, 0.28, 0.8]]
        : [[880, 0, 0.45], [1174.66, 0.16, 0.7]];
  const volume = tipo === "contrato" ? 0.16 : 0.08;
  const agora = audio.currentTime + 0.05;
  for (const [frequencia, inicio, duracao] of notas) {
    const osc = audio.createOscillator();
    const ganho = audio.createGain();
    osc.type = tipo === "contrato" ? "triangle" : "sine";
    osc.frequency.value = frequencia;
    ganho.gain.setValueAtTime(0, agora + inicio);
    ganho.gain.linearRampToValueAtTime(volume, agora + inicio + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + duracao);
    osc.connect(ganho).connect(audio.destination);
    osc.start(agora + inicio);
    osc.stop(agora + inicio + duracao + 0.05);
  }
}

// Barra e contagem regressiva até a próxima conferência dos números. É nesse
// momento que uma comemoração pode aparecer.
let proximaConferencia = 0;
function agendarProximaConferencia() {
  proximaConferencia = Date.now() + ATUALIZAR_A_CADA_MS;
  const andamento = $("andamento");
  andamento.classList.remove("correndo");
  andamento.style.setProperty("--duracao", `${ATUALIZAR_A_CADA_MS / 1000}s`);
  void andamento.offsetWidth; // reinicia a animação
  andamento.classList.add("correndo");
}
async function conferir() {
  $("proxima").textContent = "Conferindo o Kommo.";
  await atualizar();
  agendarProximaConferencia();
}

function marcarHora() {
  $("relogio").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const falta = Math.max(0, Math.round((proximaConferencia - Date.now()) / 1000));
  if (proximaConferencia) $("proxima").textContent = `Próxima conferência em ${Math.floor(falta / 60)}:${String(falta % 60).padStart(2, "0")}.`;
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
$("btnTestarContrato").addEventListener("click", () => {
  ajustes.som = $("somLigado").checked;
  $("ajustes").hidden = true;
  comemorarContrato({ campanhas: ["Demonstração"], total: 1, meta: 30 });
  setTimeout(abrirAjustes, 10200);
});
$("btnTestarReuniao").addEventListener("click", () => {
  ajustes.som = $("somLigado").checked;
  avisar("marcada", 1, 1);
});
$("btnTestarRealizada").addEventListener("click", () => {
  ajustes.som = $("somLigado").checked;
  avisar("realizada", 1, 1);
});
// Qualquer clique ou tecla libera o som para as próximas comemorações.
document.addEventListener("pointerdown", liberarSom);
document.addEventListener("keydown", liberarSom);
document.addEventListener("keydown", (e) => {
  if (!$("ajustes").hidden) return e.key === "Escape" && fecharAjustes();
  if (e.key.toLowerCase() === "f") telaCheia();
  if (e.key === "ArrowRight") trocarDeTelaManualmente(1);
  if (e.key === "ArrowLeft") trocarDeTelaManualmente(-1);
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && manterTelaLigada());

lerAjustes();
aplicarAjustes();
marcarHora();
setInterval(marcarHora, 1000);
conferir();
setInterval(conferir, ATUALIZAR_A_CADA_MS);
setTimeout(() => location.reload(), RECARREGAR_A_PAGINA_A_CADA_MS);
manterTelaLigada();
