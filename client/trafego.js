// Aba "Tráfego e campanhas": origem dos leads por conjunto de anúncios, anúncio
// e região, histórico semanal com orçamento, decisões e observações.
//
// Depende de app.js ($, esc, numero, percentual, chamarApi, mostrarErro,
// baixarArquivo, campanhaSelecionada, abaAtiva), de mapa-brasil.js e de
// relatorio-semanal.js.

let analiseDeTrafego = null;
let chaveDaAnaliseCarregada = "";
let semanaAberta = null; // registro completo da semana no diálogo
const semanasSelecionadas = new Set(); // "inicio|fim"
let ultimaSoma = null;

const CORES_DE_SERIE = ["#b6923f", "#6ea8d8", "#4fb38a", "#d0685a", "#a78bfa", "#e0965a", "#5fc4d6"];
const JSON_HEADERS = { "Content-Type": "application/json" };

const periodoDoFiltro = () => ({ inicio: $("dataInicio").value, fim: $("dataFim").value });

function abrirDialogo(id) {
  $(id).classList.remove("hidden");
  $(id).classList.add("flex");
}
// Fecha com uma saída curta, em vez de sumir de uma vez.
function fecharDialogo(id) {
  const dialogo = $(id);
  if (dialogo.classList.contains("hidden") || dialogo.classList.contains("fechando")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    dialogo.classList.add("hidden");
    dialogo.classList.remove("flex");
    return;
  }
  dialogo.classList.add("fechando");
  setTimeout(() => {
    dialogo.classList.add("hidden");
    dialogo.classList.remove("flex", "fechando");
  }, 170);
}
function fecharModaisDeTrafego() {
  // O diálogo de leads abre sobre os outros; fecha um nível por vez.
  if (!$("modalLeads").classList.contains("hidden")) return fecharDialogo("modalLeads");
  fecharDialogo("modalSemana");
  fecharDialogo("modalSoma");
}

// --- Detalhamento: leads de um grupo -------------------------------------------

// regra: texto opcional, exibido acima da lista, explicando como os leads foram contados.
function abrirLeadsDoGrupo(titulo, leads, regra = "") {
  $("tituloLeads").textContent = `${titulo} (${numero(leads.length)})`;
  $("regraDosLeads").textContent = regra;
  $("regraDosLeads").classList.toggle("hidden", !regra);
  $("corpoLeadsDoGrupo").innerHTML = leads.length
    ? leads
        .map(
          (l) => `
      <button ${l.leadId ? `data-lead="${esc(String(l.leadId))}"` : "disabled"} class="w-full flex items-center justify-between gap-3 border-b border-line py-1.5 text-left hover:bg-surface2" title="Abrir a ficha do lead">
        <span class="text-ink truncate">${esc(l.nome)}</span>
        <span class="text-inkdim font-mono shrink-0">${esc(l.telefone || "sem telefone")}</span>
        <span class="text-inkfaint text-[10px] shrink-0 w-28 text-right">${esc(l.etapaMaisAvancada || "")}</span>
      </button>`,
        )
        .join("")
    : '<p class="text-inkdim">Nenhum lead neste grupo.</p>';
  $("corpoLeadsDoGrupo").querySelectorAll("button[data-lead]").forEach((b) => b.addEventListener("click", () => abrirFichaDoLead(b.dataset.lead)));
  abrirDialogo("modalLeads");
}

// --- Listas e gráficos de grupos ------------------------------------------------

function renderizarListaDeGrupos(container, lista, limite = 8) {
  if (!lista?.length) {
    container.innerHTML = '<p class="text-inkdim">Sem dados no período.</p>';
    return;
  }
  const grupos = lista.slice(0, limite);
  // Cada quantidade abre a relação dos leads correspondentes.
  const CONTAGENS = [
    { campo: "totalLeads", lista: "leads", rotulo: "leads", titulo: "todos os leads" },
    { campo: "qualificados", lista: "leadsQualificados", rotulo: "qualificados", titulo: "qualificados" },
    { campo: "reuniao", lista: "leadsReuniao", rotulo: "reuniões", titulo: "com reunião marcada" },
    { campo: "contratoFechado", lista: "leadsFechados", rotulo: "fechados", titulo: "contratos fechados" },
  ];
  container.innerHTML =
    grupos
      .map((g, i) => {
        const cor = g.percentualQualificados >= 50 ? "text-positivo" : g.percentualQualificados >= 25 ? "text-goldbright" : "text-negativo";
        return `
      <div class="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] text-ink truncate" title="${esc(g.grupo)}">${esc(g.grupo)}</p>
          <p class="text-[10px] text-inkfaint tabular flex flex-wrap gap-x-1">
            ${CONTAGENS.map((c, ci) => `<button data-grupo="${i}" data-contagem="${ci}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${numero(g[c.campo])} ${c.rotulo}</button>`).join('<span aria-hidden="true">·</span>')}
          </p>
        </div>
        <span class="shrink-0 text-right leading-tight" title="Leads qualificados sobre o total de leads do grupo">
          <span class="${cor} font-semibold tabular block">${percentual(g.percentualQualificados)}</span>
          <span class="text-[9px] text-inkfaint uppercase tracking-wide">qualificados</span>
        </span>
      </div>`;
      })
      .join("") + (lista.length > limite ? `<p class="text-[10px] text-inkfaint pt-2">Mais ${numero(lista.length - limite)} grupo(s) no relatório exportado.</p>` : "");
  container.querySelectorAll("button[data-grupo]").forEach((botao) => {
    const g = grupos[Number(botao.dataset.grupo)];
    const c = CONTAGENS[Number(botao.dataset.contagem)];
    botao.addEventListener("click", () => abrirLeadsDoGrupo(`${g.grupo}: ${c.titulo}`, g[c.lista] || []));
  });
}

// Barras horizontais: uma por grupo, com o nome acima e a quantidade de leads
// do período à direita. A barra mais longa é o grupo com mais leads.
function renderizarBarrasDeGrupos(container, lista, limite = 12) {
  if (!lista?.length) {
    container.innerHTML = '<p class="text-xs text-inkdim">Sem dados no período.</p>';
    return;
  }
  const grupos = lista.slice(0, limite);
  const maximo = Math.max(...grupos.map((g) => g.totalLeads), 1);
  const total = grupos.reduce((soma, g) => soma + g.totalLeads, 0);
  container.innerHTML = `
    <p class="text-[10px] text-inkfaint mb-3">Quantidade de leads do período em cada grupo. Clique em uma barra para ver os leads.</p>
    <div class="space-y-3">${grupos
      .map(
        (g, i) => `
      <button data-indice="${i}" class="w-full text-left hover:bg-surface2 block" title="${esc(g.grupo)}">
        <span class="flex items-baseline justify-between gap-3 mb-1">
          <span class="text-[11px] text-ink truncate">${esc(g.grupo)}</span>
          <span class="text-[11px] tabular text-ink shrink-0">${numero(g.totalLeads)} leads <span class="text-inkfaint">· ${percentual(total ? Math.round((g.totalLeads / total) * 1000) / 10 : 0)} do total</span></span>
        </span>
        <span class="h-3 bg-surface2 block"><span class="barra h-full block" style="width:${(g.totalLeads / maximo) * 100}%;background:${CORES_DE_SERIE[i % CORES_DE_SERIE.length]}"></span></span>
      </button>`,
      )
      .join("")}</div>`;
  container.querySelectorAll("button[data-indice]").forEach((botao) => {
    const g = grupos[Number(botao.dataset.indice)];
    botao.addEventListener("click", () => abrirLeadsDoGrupo(g.grupo, g.leads));
  });
}

function renderizarGrupo(idDoContainer, lista, idDoModo, limite) {
  const container = $(idDoContainer);
  if ($(idDoModo).value === "grafico") renderizarBarrasDeGrupos(container, lista);
  else renderizarListaDeGrupos(container, lista, limite);
}

// Engajamento por etapa: uma linha por grupo, com o percentual (ou a
// quantidade) de leads que alcançou cada etapa-marco.
function renderizarEngajamento(idDoContainer, lista, limite, modo) {
  const container = $(idDoContainer);
  if (!lista?.length) {
    container.innerHTML = '<p class="text-xs text-inkdim">Sem dados suficientes no período.</p>';
    return;
  }
  const grupos = [...lista].sort((a, b) => b.pontos.at(-1).percentual - a.pontos.at(-1).percentual || b.totalLeads - a.totalLeads).slice(0, limite);
  const campo = modo === "quantidade" ? "quantidade" : "percentual";
  const etapas = grupos[0].pontos.map((p) => p.etapa);
  const tracos = ["", "7,3", "2,3", "10,3,2,3", "1,4"];

  const W = 620, H = 270, ML = 36, MR = 24, MT = 22, MB = 44;
  const areaW = W - ML - MR, areaH = H - MT - MB, base = MT + areaH;
  const passo = etapas.length > 1 ? areaW / (etapas.length - 1) : 0;
  const maximo = modo === "quantidade" ? Math.max(...grupos.flatMap((g) => g.pontos.map((p) => p.quantidade)), 1) : 100;
  const sufixo = modo === "quantidade" ? "" : "%";

  const marcas = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = base - f * areaH;
      return `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="#1f2130"/><text x="${ML - 6}" y="${y + 3}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9" fill="#6b6d7a">${Math.round(maximo * f)}${sufixo}</text>`;
    })
    .join("");

  const series = grupos.map((g, gi) => {
    const cor = CORES_DE_SERIE[gi % CORES_DE_SERIE.length];
    const traco = tracos[gi % tracos.length] ? ` stroke-dasharray="${tracos[gi % tracos.length]}"` : "";
    // Pequeno deslocamento vertical por série, para que linhas com os mesmos
    // valores não fiquem exatamente sobrepostas. O número exibido é o real.
    const desvio = (gi - (grupos.length - 1) / 2) * 2.5;
    const pontos = g.pontos.map((p, i) => ({ x: ML + i * passo, y: base - (p[campo] / maximo) * areaH + desvio, valor: p[campo], i }));
    return { g, gi, cor, traco, pontos };
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Engajamento por etapa" style="display:block;width:100%;height:auto">
      ${marcas}
      ${series
        .map(
          (s) => `<path d="${s.pontos.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")}" fill="none" stroke="${s.cor}" stroke-width="2"${s.traco}/>
        ${s.pontos
          .map(
            (c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="${s.cor}" stroke="#0b0c11" stroke-width="1.5" style="cursor:pointer" data-serie="${s.gi}" data-ponto="${c.i}"/>
          ${c.valor > 0 ? `<text x="${c.x.toFixed(1)}" y="${(c.y - 9).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" font-weight="600" fill="${s.cor}" style="pointer-events:none">${c.valor.toLocaleString("pt-BR")}${sufixo}</text>` : ""}`,
          )
          .join("")}`,
        )
        .join("")}
      ${etapas.map((nome, i) => `<text x="${(ML + i * passo).toFixed(1)}" y="${base + 18}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" fill="#9a9ca8">${esc(nome)}</text>`).join("")}
    </svg>
    <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-inkdim">
      ${series.map((s) => `<span class="flex items-center gap-1.5"><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke="${s.cor}" stroke-width="2"${s.traco}/></svg>${esc(s.g.grupo)} (${numero(s.g.totalLeads)} leads)</span>`).join("")}
    </div>`;

  container.querySelectorAll("circle[data-serie]").forEach((circulo) => {
    circulo.addEventListener("click", () => {
      const g = grupos[Number(circulo.dataset.serie)];
      const ponto = g.pontos[Number(circulo.dataset.ponto)];
      abrirLeadsDoGrupo(`${g.grupo}: ${ponto.etapa}`, ponto.leads);
    });
  });
}

// Custo total, por lead e por qualificado de cada anúncio e conjunto.
function renderizarGraficoDeCusto(container, grupos) {
  const maximo = Math.max(...grupos.flatMap((g) => [g.custoTotal || 0, g.custoPorLead || 0, g.custoPorQualificado || 0]), 1);
  const W = 680, H = 290, ML = 52, MR = 16, MT = 22, MB = 34;
  const areaW = W - ML - MR, areaH = H - MT - MB, base = MT + areaH;
  const larguraDoGrupo = areaW / grupos.length;
  const larguraDaBarra = Math.min(larguraDoGrupo * 0.24, 26);
  const SERIES = [
    { campo: "custoTotal", cor: "#6ea8d8", rotulo: "Custo total", leads: "leads" },
    { campo: "custoPorLead", cor: "#b6923f", rotulo: "Custo por lead", leads: "leads" },
    { campo: "custoPorQualificado", cor: "#4fb38a", rotulo: "Custo por qualificado", leads: "leadsQualificados" },
  ];

  const marcas = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = base - f * areaH;
      return `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="#1f2130"/><text x="${ML - 6}" y="${y + 3}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9" fill="#6b6d7a">R$ ${Math.round(maximo * f).toLocaleString("pt-BR")}</text>`;
    })
    .join("");
  const barras = grupos
    .map((g, i) => {
      const centro = ML + larguraDoGrupo * i + larguraDoGrupo / 2;
      return (
        SERIES.map((s, si) => {
          const valor = g[s.campo];
          const altura = ((valor || 0) / maximo) * areaH;
          const x = centro + (si - 1.5) * (larguraDaBarra + 3);
          return `<g data-grupo="${i}" data-serie="${si}" style="cursor:pointer">
            <rect x="${x.toFixed(1)}" y="${(base - altura).toFixed(1)}" width="${larguraDaBarra.toFixed(1)}" height="${Math.max(altura, 1).toFixed(1)}" fill="${s.cor}"/>
            <text x="${(x + larguraDaBarra / 2).toFixed(1)}" y="${(base - altura - 5).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8" fill="${s.cor}">${valor === null || valor === undefined ? "—" : Math.round(valor).toLocaleString("pt-BR")}</text>
          </g>`;
        }).join("") + `<text x="${centro.toFixed(1)}" y="${base + 16}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="700" fill="#9a9ca8">${i + 1}</text>`
      );
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Custo por anúncio e conjunto" style="display:block;width:100%;max-width:760px;height:auto">${marcas}<line x1="${ML}" y1="${base}" x2="${W - MR}" y2="${base}" stroke="#33364a"/>${barras}</svg>
    <div class="flex flex-wrap items-center gap-4 mt-1 text-[10px] text-inkdim">
      ${SERIES.map((s) => `<span class="flex items-center gap-1.5"><span class="inline-block w-2 h-2" style="background:${s.cor}"></span>${s.rotulo} (R$)</span>`).join("")}
    </div>
    <div class="grid grid-cols-1 gap-1 mt-2 pt-2 border-t border-line">
      ${grupos.map((g, i) => `<p class="text-[10px] text-inkdim"><strong class="text-goldbright">${i + 1}</strong> ${esc(g.grupo)}: ${numero(g.totalLeads)} leads, ${numero(g.qualificados)} qualificados, custo por contrato ${reais(g.custoPorContratoFechado)}</p>`).join("")}
    </div>`;
  container.querySelectorAll("g[data-grupo]").forEach((el) => {
    const g = grupos[Number(el.dataset.grupo)];
    const s = SERIES[Number(el.dataset.serie)];
    el.addEventListener("click", () => abrirLeadsDoGrupo(`${g.grupo}: ${s.leads === "leads" ? "todos os leads" : "qualificados"}`, g[s.leads] || []));
  });
}

async function atualizarGraficoDeCusto() {
  const container = $("graficoCusto");
  const { inicio, fim } = periodoDoFiltro();
  try {
    const dados = await chamarApi(`/trafego/analise-com-custo?inicio=${inicio}&fim=${fim}`);
    if (!dados.semanaSalva) {
      container.innerHTML = '<p class="text-xs text-inkdim">O custo é exibido para semanas salvas. Salve o período do filtro como semana e registre o orçamento em "Gerenciar".</p>';
      return;
    }
    const grupos = (dados.porAnuncioEConjunto || []).filter((g) => g.custoTotal !== null && g.custoTotal !== undefined);
    if (!grupos.length) {
      container.innerHTML = '<p class="text-xs text-inkdim">Semana salva sem orçamento registrado. Use "Gerenciar" na lista de semanas para informar o orçamento diário de cada anúncio e conjunto.</p>';
      return;
    }
    renderizarGraficoDeCusto(container, grupos.slice(0, 10));
  } catch (erro) {
    container.innerHTML = `<p class="text-xs text-negativo">${esc(erro.message)}</p>`;
  }
}

// --- Carga e renderização da aba ---------------------------------------------------

// Tabela por campanha do Meta, no formato do relatório de tráfego: uma linha
// por campanha e uma linha de total. Cada número abre a lista dos leads.
const COLUNAS_POR_CAMPANHA = [
  { campo: "totalLeads", lista: "leads", rotulo: "Leads", titulo: "leads" },
  { campo: "qualificados", lista: "leadsQualificados", rotulo: "Qualificados", titulo: "qualificados" },
  { campo: "reuniao", lista: "leadsReuniao", rotulo: "Marcadas", titulo: "com reunião marcada" },
  { campo: "realizadas", lista: "leadsRealizadas", rotulo: "Realizadas", titulo: "com reunião realizada" },
  { campo: "contratoFechado", lista: "leadsFechados", rotulo: "Contratos", titulo: "com contrato fechado" },
];
const moeda = (valor) => (valor === null || valor === undefined ? "—" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function renderizarTabelaPorCampanha(a) {
  const grupos = a.porCampanhaMeta || [];
  const tabela = $("tabelaPorCampanha");
  $("notaPorCampanha").textContent = $("apenasNovos").checked
    ? "Somente leads que chegaram no período, e até onde cada um foi."
    : "Todos os leads com movimentação no período, inclusive os que chegaram antes.";
  if (!grupos.length) {
    tabela.innerHTML = '<tbody><tr><td class="text-inkdim">Sem leads no período.</td></tr></tbody>';
    $("rodapePorCampanha").textContent = "";
    return;
  }
  const inv = a.investimento || {};
  const somar = (campo) => grupos.reduce((t, g) => t + (g[campo] || 0), 0);
  const algumInvestido = grupos.some((g) => g.investido !== null && g.investido !== undefined);
  const totalInvestido = algumInvestido ? Math.round(grupos.reduce((t, g) => t + (g.investido || 0), 0) * 100) / 100 : null;
  const celula = (g, i, c, ci) =>
    `<td class="text-right tabular"><button data-campanha="${i}" data-coluna="${ci}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${numero(g[c.campo])}</button></td>`;
  tabela.innerHTML = `
    <thead>
      <tr class="text-inkdim text-[10px] uppercase tracking-wide">
        <th rowspan="2" class="text-left font-normal align-bottom">Campanha</th>
        <th rowspan="2" class="text-right font-normal align-bottom">Investido</th>
        <th rowspan="2" class="text-right font-normal align-bottom">Leads</th>
        <th rowspan="2" class="text-right font-normal align-bottom">Qualificados</th>
        <th colspan="2" class="text-center font-normal">Reuniões</th>
        <th rowspan="2" class="text-right font-normal align-bottom">Contratos</th>
      </tr>
      <tr class="text-inkdim text-[10px] uppercase tracking-wide">
        <th class="text-right font-normal">Marcadas</th>
        <th class="text-right font-normal">Realizadas</th>
      </tr>
    </thead>
    <tbody>
      ${grupos
        .map(
          (g, i) => `<tr>
        <td class="text-ink max-w-[220px] truncate" title="${esc(g.grupo)}">${esc(g.grupo)}</td>
        <td class="text-right tabular text-inkdim">${moeda(g.investido)}</td>
        ${COLUNAS_POR_CAMPANHA.map((c, ci) => celula(g, i, c, ci)).join("")}
      </tr>`,
        )
        .join("")}
      <tr class="destaque font-semibold">
        <td class="text-goldbright">Total</td>
        <td class="text-right tabular text-goldbright">${moeda(totalInvestido)}</td>
        ${COLUNAS_POR_CAMPANHA.map((c) => `<td class="text-right tabular text-goldbright">${numero(somar(c.campo))}</td>`).join("")}
      </tr>
    </tbody>`;
  tabela.querySelectorAll("button[data-campanha]").forEach((botao) => {
    const g = grupos[Number(botao.dataset.campanha)];
    const c = COLUNAS_POR_CAMPANHA[Number(botao.dataset.coluna)];
    botao.addEventListener("click", () => abrirLeadsDoGrupo(`${g.grupo}: ${c.titulo}`, g[c.lista] || []));
  });
  $("rodapePorCampanha").textContent = !inv.configurado
    ? "Investido: aparece quando a integração com o Meta estiver configurada (token de acesso no servidor)."
    : inv.erro
      ? `Investido indisponível: ${inv.erro}`
      : "Investido: valor gasto no Meta no período, associado pelo nome da campanha. Campanhas cujo nome no Kommo difere do Meta ficam sem valor.";
}

function renderizarTrafego() {
  const a = analiseDeTrafego;
  if (!a) return;
  $("totalLeadsTrafego").textContent = numero(a.totalLeads);
  $("totalQualificadosTrafego").textContent = numero(a.totalQualificados);

  const aviso = $("avisoSemOrigem");
  const avisos = [];
  if (a.leadsSemOrigem > 0) {
    avisos.push(`${numero(a.leadsSemOrigem)} de ${numero(a.totalLeads)} lead(s) estão sem conjunto de anúncios e sem anúncio preenchidos no Kommo e aparecem como "(não informado)".`);
  }
  if (a.leadsSemRastreioDeAnuncio > 0) {
    avisos.push(`${numero(a.leadsSemRastreioDeAnuncio)} lead(s) vieram de anúncio que abre o WhatsApp, canal em que o anúncio de origem não é registrado; aparecem como "WhatsApp (anúncio não rastreado)".`);
  }
  if (a.totalLeads > 0 && avisos.length) {
    aviso.textContent = avisos.join(" ");
    aviso.classList.remove("hidden");
  } else aviso.classList.add("hidden");

  renderizarTabelaPorCampanha(a);
  renderizarGrupo("tabelaPorConjunto", a.porConjunto, "modoPorConjunto", 8);
  renderizarGrupo("tabelaPorAnuncio", a.porAnuncio, "modoPorAnuncio", 8);
  renderizarGrupo("tabelaPorRegiao", a.porRegiao, "modoPorRegiao", 8);
  renderizarGrupo("tabelaConjuntoPorRegiao", a.conjuntoPorRegiao, "modoConjuntoPorRegiao", 12);

  renderizarBarrasDeGrupos($("graficoConjunto"), a.porConjunto);
  if ($("modoEstado").value === "mapa") renderizarMapaDoBrasil($("graficoEstado"), a.porEstado, (g) => abrirLeadsDoGrupo(g.grupo, g.leads));
  else renderizarBarrasDeGrupos($("graficoEstado"), a.porEstado);

  const limite = (id) => Math.min(Math.max(Number($(id).value) || 5, 1), 12);
  renderizarEngajamento("graficoEngajamentoConjunto", a.engajamentoPorConjunto, limite("qtdEngajamentoConjunto"), $("modoEngajamentoConjunto").value);
  renderizarEngajamento("graficoEngajamentoEstado", a.engajamentoPorEstado, limite("qtdEngajamentoEstado"), $("modoEngajamentoEstado").value);
}

// Busca a análise quando a aba está visível e o filtro mudou desde a última carga.
async function atualizarTrafego(forcar = false) {
  if (abaAtiva !== "trafego") return;
  const { inicio, fim } = periodoDoFiltro();
  if (!inicio || !fim) return;
  const apenasNovos = $("apenasNovos").checked;
  const chave = `${inicio}|${fim}|${campanhaSelecionada}|${apenasNovos}|${dados?.geradoEm || ""}`;
  if (!forcar && chave === chaveDaAnaliseCarregada) return;
  try {
    analiseDeTrafego = await chamarApi(`/analise-trafego?inicio=${inicio}&fim=${fim}&apenasNovos=${apenasNovos}&campanha=${encodeURIComponent(campanhaSelecionada)}`);
    chaveDaAnaliseCarregada = chave;
    renderizarTrafego();
    atualizarGraficoDeCusto();
    carregarSemanas();
  } catch (erro) {
    mostrarErro(erro.message);
  }
}

// --- Histórico semanal salvo ------------------------------------------------------------

const dataBR = (iso) => iso.split("-").reverse().join("/");

async function carregarSemanas() {
  const container = $("listaSemanas");
  try {
    const semanas = await chamarApi("/trafego/semanas");
    if (!semanas.length) {
      container.innerHTML = '<p class="text-inkdim">Nenhuma semana salva.</p>';
      return;
    }
    const botao = "border border-line hover:border-gold/60 text-inkdim hover:text-ink text-[11px] font-semibold px-3 py-1";
    container.innerHTML = semanas
      .slice()
      .reverse()
      .map((s) => {
        const chave = `${s.inicio}|${s.fim}`;
        return `
      <div class="flex items-center gap-2 border border-line px-3 py-2 flex-wrap" data-semana="${esc(chave)}">
        <input type="checkbox" class="accent-gold" data-acao="selecionar" aria-label="Selecionar para somar" ${semanasSelecionadas.has(chave) ? "checked" : ""}>
        <span class="flex-1 text-ink tabular">${dataBR(s.inicio)} a ${dataBR(s.fim)}</span>
        <button data-acao="ver" class="${botao}" title="Coloca estas datas no filtro do topo e mostra os números da semana">Filtrar por esta semana</button>
        <button data-acao="gerenciar" class="${botao}">Gerenciar</button>
        <button data-acao="exportar" class="${botao}">Exportar relatório</button>
      </div>`;
      })
      .join("");
  } catch (erro) {
    container.innerHTML = `<p class="text-negativo">${esc(erro.message)}</p>`;
  }
}

function atualizarBotaoDeSoma() {
  const n = semanasSelecionadas.size;
  $("btnSomarSemanas").classList.toggle("hidden", n < 2);
  $("btnSomarSemanas").textContent = `Somar ${n} semanas selecionadas`;
}

async function salvarSemanaDoFiltro() {
  const botao = $("btnSalvarSemana");
  const rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Salvando";
  try {
    await chamarApi("/trafego/salvar-semana", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...periodoDoFiltro(), apenasNovos: $("apenasNovos").checked }) });
    await carregarSemanas();
    atualizarGraficoDeCusto();
  } catch (erro) {
    alert(`Não foi possível salvar a semana. ${erro.message}`);
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

async function exportarRelatorioDaSemana(inicio, fim) {
  try {
    const consulta = `inicio=${inicio}&fim=${fim}`;
    const [metricas, analise, registro, analiseComCusto, comparacao] = await Promise.all([
      chamarApi(`/metrics?${consulta}`),
      chamarApi(`/analise-trafego?${consulta}&apenasNovos=true`),
      chamarApi(`/trafego/semana?${consulta}`),
      chamarApi(`/trafego/analise-com-custo?${consulta}`),
      chamarApi(`/trafego/comparar-semana-anterior?${consulta}`),
    ]);
    const html = relatorioSemanalHTML({ inicio, fim, funil: metricas.escopos.TODAS, analise, registro, analiseComCusto, comparacao });
    baixarArquivo(`relatorio_semanal_${inicio}_${fim}.html`, html, "text/html;charset=utf-8;");
  } catch (erro) {
    alert(`Não foi possível exportar o relatório. ${erro.message}`);
  }
}

// --- Diálogo: gerenciar semana -------------------------------------------------------------

async function abrirSemana(inicio, fim) {
  $("tituloSemana").textContent = `${dataBR(inicio)} a ${dataBR(fim)}`;
  for (const id of ["comparacaoSemanal", "formularioCusto", "listaDecisoes", "listaObservacoes"]) $(id).innerHTML = '<p class="text-inkdim">Carregando.</p>';
  abrirDialogo("modalSemana");
  try {
    semanaAberta = await chamarApi(`/trafego/semana?inicio=${inicio}&fim=${fim}`);
    renderizarFormularioDeCusto();
    renderizarAnotacoes();
    renderizarComparacao();
  } catch (erro) {
    alert(`Não foi possível abrir a semana. ${erro.message}`);
    fecharDialogo("modalSemana");
  }
}

async function renderizarComparacao() {
  const container = $("comparacaoSemanal");
  try {
    const c = await chamarApi(`/trafego/comparar-semana-anterior?inicio=${semanaAberta.inicio}&fim=${semanaAberta.fim}`);
    if (c.semAnterior) {
      container.innerHTML = `<p class="text-inkdim">${esc(c.mensagem)}</p>`;
      return;
    }
    // Para custo, queda é melhora; para os demais, alta é melhora.
    const linha = (rotulo, chave, menorEhMelhor = false) => {
      const m = c[chave];
      const formatar = (v) => (chave.startsWith("custo") ? reais(v) : v ?? "—");
      if (!m || m.variacaoPct === null) {
        return `<div class="flex items-center justify-between py-1.5 border-b border-line last:border-0"><span class="text-inkdim">${rotulo}</span><span class="text-inkfaint">sem base de comparação</span></div>`;
      }
      const subiu = m.variacaoPct > 0;
      const cor = m.variacaoPct === 0 ? "text-inkdim" : subiu !== menorEhMelhor ? "text-positivo" : "text-negativo";
      return `<div class="flex items-center justify-between py-1.5 border-b border-line last:border-0">
        <span class="text-inkdim">${rotulo}</span>
        <span class="flex items-center gap-3 tabular"><span class="text-ink">${formatar(m.anterior)} para ${formatar(m.atual)}</span><span class="${cor} font-semibold w-16 text-right">${subiu ? "+" : ""}${m.variacaoPct.toLocaleString("pt-BR")}%</span></span>
      </div>`;
    };
    container.innerHTML = `<p class="text-[10px] text-inkfaint mb-1">Em relação à semana de ${dataBR(c.semanaAnterior.inicio)} a ${dataBR(c.semanaAnterior.fim)}.</p>
      ${linha("Leads", "leads")}${linha("Qualificados", "qualificados")}${linha("Reuniões", "reuniao")}${linha("Contratos fechados", "contratoFechado")}${linha("Custo por lead", "custoPorLead", true)}${linha("Custo por qualificado", "custoPorQualificado", true)}`;
  } catch (erro) {
    container.innerHTML = `<p class="text-negativo">${esc(erro.message)}</p>`;
  }
}

function renderizarFormularioDeCusto() {
  const custo = semanaAberta.custo || {};
  const salvo = new Map((custo.porAnuncio || []).map((c) => [c.grupo, c.orcamentoDiario]));
  const investido = new Map((custo.porAnuncio || []).filter((c) => c.gastoReal !== null && c.gastoReal !== undefined).map((c) => [c.grupo, c.gastoReal]));
  const meta = custo.meta;
  const grupos = (semanaAberta.analise?.porAnuncioEConjunto || []).map((g) => g.grupo);
  const campo = "w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink";
  $("formularioCusto").innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
      <label class="block"><span class="text-inkfaint text-[10px]">Orçamento mensal (R$)</span><input type="number" min="0" step="0.01" id="custoMensal" value="${custo.orcamentoMensal ?? ""}" class="${campo}"></label>
      <label class="block"><span class="text-inkfaint text-[10px]">Orçamento diário total (R$)</span><input type="number" min="0" step="0.01" id="custoDiarioTotal" value="${custo.orcamentoDiarioTotal ?? ""}" class="${campo}"></label>
      <label class="block"><span class="text-inkfaint text-[10px]">Branding diário (R$)</span><input type="number" min="0" step="0.01" id="custoBranding" value="${custo.brandingDiario ?? ""}" class="${campo}"></label>
    </div>
    <p class="text-inkdim mb-2">Orçamento diário por anúncio e conjunto de anúncios (R$ por dia)</p>
    ${
      grupos.length
        ? grupos
            .map(
              (nome) => `<label class="flex items-center gap-2 mb-1.5">
        <span class="text-[11px] text-ink flex-1 truncate" title="${esc(nome)}">${esc(nome)}</span>
        ${investido.has(nome) ? `<span class="text-[10px] text-inkdim tabular whitespace-nowrap" title="Valor investido na semana, importado do Meta">${reais(investido.get(nome))} investidos</span>` : ""}
        <input type="number" min="0" step="0.01" data-grupo="${esc(nome)}" value="${salvo.get(nome) ?? ""}" class="campo-custo w-28 bg-surface2 border border-line px-2 py-1 text-xs text-ink">
      </label>`,
            )
            .join("")
        : '<p class="text-inkdim">Nenhum anúncio identificado nos leads desta semana.</p>'
    }
    <button id="btnSalvarCusto" class="mt-3 bg-gold hover:bg-goldbright text-bg font-bold px-4 py-1.5 text-xs uppercase tracking-wide">Salvar orçamento</button>
    <button id="btnImportarMeta" class="mt-3 ml-2 border border-line hover:border-gold text-ink px-4 py-1.5 text-xs uppercase tracking-wide">Importar valor investido do Meta</button>
    <span id="avisoCusto" class="ml-3 text-positivo" role="status"></span>
    <p class="text-[10px] text-inkfaint mt-2">Com o valor importado do Meta, o custo usa o que foi efetivamente investido na semana; sem ele, usa o orçamento diário informado vezes os dias.</p>
    ${
      meta
        ? `<div class="mt-2 text-[10px] text-inkdim">
        <p>Importado do Meta em ${new Date(meta.importadoEm).toLocaleString("pt-BR")}: ${reais(meta.gastoTotal)} investidos na conta, ${reais(meta.gastoAssociado)} associados a anúncios com leads na semana.</p>
        ${
          meta.semLeads?.length
            ? `<details class="mt-1"><summary class="cursor-pointer">${numero(meta.semLeads.length)} anúncio(s) com investimento e sem lead associado</summary>
          <ul class="mt-1 space-y-0.5">${meta.semLeads.map((a) => `<li>${esc(a.anuncio)} — ${esc(a.conjunto)}: ${reais(a.gasto)}</li>`).join("")}</ul>
          <p class="mt-1 text-inkfaint">A associação é pelo nome. Confira se o anúncio e o conjunto gravados no lead, no Kommo, têm o mesmo nome usado no Meta.</p></details>`
            : ""
        }
      </div>`
        : ""
    }`;
  $("btnSalvarCusto").addEventListener("click", salvarCusto);
  $("btnImportarMeta").addEventListener("click", importarGastoDoMeta);
}

async function importarGastoDoMeta() {
  const botao = $("btnImportarMeta");
  botao.disabled = true;
  botao.textContent = "Importando.";
  try {
    semanaAberta = await chamarApi("/trafego/importar-gasto-meta", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ inicio: semanaAberta.inicio, fim: semanaAberta.fim }) });
    renderizarFormularioDeCusto();
    $("avisoCusto").textContent = "Valor investido importado.";
    renderizarComparacao();
    atualizarGraficoDeCusto();
  } catch (erro) {
    alert(`Não foi possível importar do Meta. ${erro.message}`);
    botao.disabled = false;
    botao.textContent = "Importar valor investido do Meta";
  }
}

async function salvarCusto() {
  const valor = (id) => ($(id).value === "" ? null : Number($(id).value));
  const custo = {
    orcamentoMensal: valor("custoMensal"),
    orcamentoDiarioTotal: valor("custoDiarioTotal"),
    brandingDiario: valor("custoBranding"),
    porAnuncio: [...document.querySelectorAll(".campo-custo")].filter((el) => el.value !== "").map((el) => ({ grupo: el.dataset.grupo, orcamentoDiario: Number(el.value) })),
  };
  const botao = $("btnSalvarCusto");
  botao.disabled = true;
  try {
    semanaAberta = await chamarApi("/trafego/custo", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ inicio: semanaAberta.inicio, fim: semanaAberta.fim, custo }) });
    $("avisoCusto").textContent = "Orçamento salvo.";
    renderizarComparacao();
    atualizarGraficoDeCusto();
  } catch (erro) {
    alert(`Não foi possível salvar o orçamento. ${erro.message}`);
  } finally {
    botao.disabled = false;
  }
}

function renderizarAnotacoes() {
  const data = (iso) => new Date(iso).toLocaleDateString("pt-BR");
  const acoes = (tipo, id) => `<span class="flex gap-2 shrink-0">
      <button data-anotacao="${tipo}" data-acao="editar" data-id="${esc(id)}" class="text-inkdim hover:text-goldbright underline decoration-dotted">Editar</button>
      <button data-anotacao="${tipo}" data-acao="excluir" data-id="${esc(id)}" class="text-inkdim hover:text-negativo underline decoration-dotted">Excluir</button>
    </span>`;
  const campo = "bg-surface2 border border-line px-2 py-1.5 text-xs text-ink";
  const botao = "bg-gold hover:bg-goldbright text-bg text-xs font-bold px-3 py-1.5";

  const decisoes = semanaAberta.decisoes || [];
  $("listaDecisoes").innerHTML =
    (decisoes.length
      ? decisoes.map((d) => `<div class="flex items-start justify-between gap-3 border border-line p-2"><p class="min-w-0"><span class="text-inkfaint tabular mr-2">${data(d.criadoEm)}</span>${d.assunto ? `<strong class="text-ink">${esc(d.assunto)}:</strong> ` : ""}<span class="text-ink">${esc(d.decisao)}</span></p>${acoes("decisao", d.id)}</div>`).join("")
      : '<p class="text-inkdim">Nenhuma decisão registrada.</p>') +
    `<div class="flex gap-2 mt-2"><input id="novoAssunto" placeholder="Assunto" aria-label="Assunto" class="w-32 ${campo}"><input id="novaDecisao" placeholder="Decisão tomada" aria-label="Decisão" class="flex-1 ${campo}"><button data-anotacao="decisao" data-acao="incluir" class="${botao}">Incluir</button></div>`;

  const observacoes = semanaAberta.observacoes || [];
  $("listaObservacoes").innerHTML =
    (observacoes.length
      ? observacoes.map((o) => `<div class="flex items-start justify-between gap-3 border border-line p-2"><p class="min-w-0"><span class="text-inkfaint tabular mr-2">${data(o.criadoEm)}</span><span class="text-ink">${esc(o.texto)}</span></p>${acoes("observacao", o.id)}</div>`).join("")
      : '<p class="text-inkdim">Nenhuma observação registrada.</p>') +
    `<div class="flex gap-2 mt-2"><input id="novaObservacao" placeholder="Nova observação" aria-label="Observação" class="flex-1 ${campo}"><button data-anotacao="observacao" data-acao="incluir" class="${botao}">Incluir</button></div>`;
}

async function executarAcaoDeAnotacao(tipo, acao, id) {
  const semana = { inicio: semanaAberta.inicio, fim: semanaAberta.fim };
  const rota = `/trafego/${tipo}`;
  const nomeDoId = tipo === "decisao" ? "decisaoId" : "observacaoId";
  const campoDeTexto = tipo === "decisao" ? "decisao" : "texto";
  try {
    if (acao === "incluir") {
      const corpo = tipo === "decisao" ? { assunto: $("novoAssunto").value, decisao: $("novaDecisao").value } : { texto: $("novaObservacao").value };
      if (!corpo[campoDeTexto].trim()) return;
      semanaAberta = await chamarApi(rota, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...semana, ...corpo }) });
    } else if (acao === "editar") {
      const lista = tipo === "decisao" ? semanaAberta.decisoes : semanaAberta.observacoes;
      const atual = lista.find((x) => x.id === id);
      const novo = prompt(tipo === "decisao" ? "Editar decisão:" : "Editar observação:", atual[campoDeTexto]);
      if (novo === null || !novo.trim()) return;
      semanaAberta = await chamarApi(rota, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ ...semana, [nomeDoId]: id, [campoDeTexto]: novo }) });
    } else if (acao === "excluir") {
      if (!confirm("Excluir este registro? A exclusão não pode ser desfeita.")) return;
      semanaAberta = await chamarApi(`${rota}?inicio=${semana.inicio}&fim=${semana.fim}&${nomeDoId}=${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    renderizarAnotacoes();
  } catch (erro) {
    alert(`Não foi possível concluir a operação. ${erro.message}`);
  }
}

async function excluirSemanaAberta() {
  const { inicio, fim } = semanaAberta;
  if (!confirm(`Excluir a semana de ${dataBR(inicio)} a ${dataBR(fim)}? A análise salva, o orçamento, as decisões e as observações serão apagados. A exclusão não pode ser desfeita.`)) return;
  try {
    await chamarApi(`/trafego/semana?inicio=${inicio}&fim=${fim}`, { method: "DELETE" });
    semanasSelecionadas.delete(`${inicio}|${fim}`);
    atualizarBotaoDeSoma();
    fecharDialogo("modalSemana");
    carregarSemanas();
    atualizarGraficoDeCusto();
  } catch (erro) {
    alert(`Não foi possível excluir a semana. ${erro.message}`);
  }
}

// --- Soma de semanas --------------------------------------------------------------------------

async function somarSemanas() {
  const semanas = [...semanasSelecionadas].map((chave) => {
    const [inicio, fim] = chave.split("|");
    return { inicio, fim };
  });
  $("corpoSoma").innerHTML = '<p class="text-inkdim">Calculando.</p>';
  $("tituloSoma").textContent = "";
  abrirDialogo("modalSoma");
  try {
    const d = await chamarApi("/trafego/rollup", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ semanas }) });
    ultimaSoma = d;
    $("tituloSoma").textContent = `${dataBR(d.periodo.inicio)} a ${dataBR(d.periodo.fim)} (${d.semanasIncluidas} semanas)`;
    const total = (valor, rotulo, cor = "text-ink") => `<div class="p-4 text-center"><p class="font-serif text-2xl font-semibold tabular ${cor}">${numero(valor)}</p><p class="rotulo mt-1">${rotulo}</p></div>`;
    const linha = (g) => `<div class="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0">
        <span class="min-w-0 flex-1"><span class="block text-[11px] text-ink truncate" title="${esc(g.grupo)}">${esc(g.grupo)}</span>
        <span class="block text-[10px] text-inkfaint tabular">${numero(g.totalLeads)} leads · ${numero(g.qualificados)} qualificados${g.custoPorLead !== null && g.custoPorLead !== undefined ? ` · ${reais(g.custoPorLead)} por lead` : ""}</span></span>
        <span class="text-goldbright font-semibold tabular shrink-0">${percentual(g.percentualQualificados)}</span></div>`;
    $("corpoSoma").innerHTML = `
      <div class="grade grid-cols-2 sm:grid-cols-4 mb-5">${total(d.totalLeads, "Leads")}${total(d.totalQualificados, "Qualificados", "text-goldbright")}${total(d.totalReuniao, "Reuniões")}${total(d.totalContratoFechado, "Contratos fechados", "text-positivo")}</div>
      <p class="rotulo mb-2">Por conjunto de anúncios</p>
      <div class="mb-5">${d.porConjunto.slice(0, 10).map(linha).join("")}</div>
      <p class="rotulo mb-2">Por anúncio e conjunto</p>
      <div>${d.porAnuncioEConjunto.slice(0, 10).map(linha).join("")}</div>
      ${d.todasComCusto ? "" : '<p class="text-[10px] text-inkfaint mt-3">Nem todas as semanas selecionadas têm orçamento registrado; os valores de custo foram omitidos.</p>'}`;
  } catch (erro) {
    $("corpoSoma").innerHTML = `<p class="text-negativo">${esc(erro.message)}</p>`;
  }
}

// --- Eventos da aba ----------------------------------------------------------------------------

$("apenasNovos").addEventListener("change", () => atualizarTrafego(true));
for (const id of ["modoPorConjunto", "modoPorAnuncio", "modoPorRegiao", "modoConjuntoPorRegiao", "modoEstado", "qtdEngajamentoConjunto", "modoEngajamentoConjunto", "qtdEngajamentoEstado", "modoEngajamentoEstado"]) {
  $(id).addEventListener("change", renderizarTrafego);
}

$("cartaoLeadsTrafego").addEventListener("click", () => analiseDeTrafego && abrirLeadsDoGrupo("Leads no período", analiseDeTrafego.todosOsLeads));
$("cartaoQualificadosTrafego").addEventListener("click", () => analiseDeTrafego && abrirLeadsDoGrupo("Qualificados no período", analiseDeTrafego.leadsQualificadosTotal));

$("btnSalvarSemana").addEventListener("click", salvarSemanaDoFiltro);
$("btnSomarSemanas").addEventListener("click", somarSemanas);
$("btnExportarSoma").addEventListener("click", () => {
  if (ultimaSoma) baixarArquivo(`semanas_somadas_${ultimaSoma.periodo.inicio}_${ultimaSoma.periodo.fim}.html`, relatorioDaSomaHTML(ultimaSoma), "text/html;charset=utf-8;");
});

$("listaSemanas").addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-acao]");
  if (!alvo) return;
  const [inicio, fim] = alvo.closest("[data-semana]").dataset.semana.split("|");
  if (alvo.dataset.acao === "selecionar") {
    if (alvo.checked) semanasSelecionadas.add(`${inicio}|${fim}`);
    else semanasSelecionadas.delete(`${inicio}|${fim}`);
    atualizarBotaoDeSoma();
  } else if (alvo.dataset.acao === "ver") {
    // Põe a semana no filtro de datas do topo e leva a tela até os números.
    $("dataInicio").value = inicio;
    $("dataFim").value = fim;
    atualizar();
    $("tTrafegoResumo").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (alvo.dataset.acao === "gerenciar") abrirSemana(inicio, fim);
  else if (alvo.dataset.acao === "exportar") exportarRelatorioDaSemana(inicio, fim);
});

for (const id of ["listaDecisoes", "listaObservacoes"]) {
  $(id).addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-anotacao]");
    if (botao) executarAcaoDeAnotacao(botao.dataset.anotacao, botao.dataset.acao, botao.dataset.id);
  });
}
$("btnExcluirSemana").addEventListener("click", excluirSemanaAberta);

$("btnFecharSemana").addEventListener("click", () => fecharDialogo("modalSemana"));
$("btnFecharLeads").addEventListener("click", () => fecharDialogo("modalLeads"));
$("btnFecharSoma").addEventListener("click", () => fecharDialogo("modalSoma"));
for (const id of ["modalSemana", "modalLeads", "modalSoma"]) {
  $(id).addEventListener("click", (e) => e.target === $(id) && fecharDialogo(id));
}
