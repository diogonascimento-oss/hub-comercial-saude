// Relatórios em HTML para download: semana salva e soma de semanas.
//
// Os arquivos gerados são autocontidos, em estilo claro, próprios para leitura
// e impressão fora do painel. Usa esc(), numero() e percentual() de app.js.

const ESTILO_DO_RELATORIO = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; max-width: 980px; margin: 0 auto; padding: 32px 24px 72px; color: #1a1a1a; line-height: 1.55; background: #fff; }
  h1 { font-size: 22px; color: #0f1b2d; border-bottom: 3px solid #b6923f; padding-bottom: 10px; margin-bottom: 4px; }
  p.sub { font-size: 12.5px; color: #666; margin: 0 0 24px; }
  h2 { font-size: 16px; color: #0f1b2d; margin-top: 34px; border-bottom: 1px solid #e2e2e2; padding-bottom: 6px; }
  h3 { font-size: 13.5px; color: #0f1b2d; margin: 22px 0 6px; }
  p.nota { font-size: 11.5px; color: #777; margin: 0 0 8px; }
  p.vazio { font-size: 12.5px; color: #888; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 18px; font-size: 12.5px; }
  th, td { border: 1px solid #e2e2e2; padding: 6px 9px; text-align: left; }
  th { background: #0f1b2d; color: #fff; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafa; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.destaque { font-weight: 700; color: #0f1b2d; }
  tr.total td { font-weight: 700; background: #f6f1e4; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #e2e2e2; border: 1px solid #e2e2e2; margin: 12px 0 8px; }
  .kpi { background: #fff; padding: 14px 12px; }
  .kpi .valor { font-size: 23px; font-weight: 700; color: #0f1b2d; }
  .kpi .rotulo { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #777; margin-top: 3px; }
  ul.registros { font-size: 12.5px; padding-left: 18px; }
  ul.registros li { margin-bottom: 6px; }
  .data { font-family: monospace; color: #8a6d00; font-weight: 700; margin-right: 6px; }
  .legenda span { display: inline-block; margin-right: 14px; font-size: 11px; }
`;

const reais = (valor) => (valor === null || valor === undefined ? "—" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function kpi(valor, rotulo) {
  return `<div class="kpi"><div class="valor">${valor}</div><div class="rotulo">${esc(rotulo)}</div></div>`;
}

// Tabela por campanha do Meta, no formato usado pelo tráfego.
function tabelaPorCampanhaMeta(lista) {
  if (!lista?.length) return '<p class="vazio">Sem dados neste período.</p>';
  const soma = (campo) => lista.reduce((t, g) => t + (g[campo] || 0), 0);
  const linha = (rotulo, g, forte = false) =>
    `<tr${forte ? ' class="total"' : ""}><td>${esc(rotulo)}</td><td class="num">${g.totalLeads}</td><td class="num">${g.qualificados}</td><td class="num">${g.reuniao}</td><td class="num">${g.realizadas ?? 0}</td><td class="num">${g.contratoFechado}</td></tr>`;
  return `<table>
    <thead><tr><th>Campanha</th><th class="num">Leads</th><th class="num">Qualificados</th><th class="num">Reuniões marcadas</th><th class="num">Reuniões realizadas</th><th class="num">Contratos</th></tr></thead>
    <tbody>${lista.map((g) => linha(g.grupo, g)).join("")}${linha("Total", { totalLeads: soma("totalLeads"), qualificados: soma("qualificados"), reuniao: soma("reuniao"), realizadas: soma("realizadas"), contratoFechado: soma("contratoFechado") }, true)}</tbody>
  </table>`;
}

function tabelaDeGrupos(titulo, lista, nota = "") {
  if (!lista?.length) return `<h3>${esc(titulo)}</h3><p class="vazio">Sem dados neste período.</p>`;
  return `
    <h3>${esc(titulo)}</h3>
    ${nota ? `<p class="nota">${esc(nota)}</p>` : ""}
    <table>
      <thead><tr><th>Grupo</th><th class="num">Leads</th><th class="num">Qualificados</th><th class="num">Taxa de qualificação</th><th class="num">Reuniões</th><th class="num">Remarcação</th><th class="num">Farmer</th><th class="num">Fechados</th><th class="num">Desqualificados</th></tr></thead>
      <tbody>${lista
        .map(
          (g) => `<tr><td>${esc(g.grupo)}</td><td class="num">${g.totalLeads}</td><td class="num">${g.qualificados}</td><td class="num destaque">${percentual(g.percentualQualificados)}</td><td class="num">${g.reuniao}</td><td class="num">${g.remarcacao ?? 0}</td><td class="num">${g.farmer}</td><td class="num">${g.contratoFechado}</td><td class="num">${g.desqualificados ?? 0}</td></tr>`,
        )
        .join("")}</tbody>
    </table>`;
}

const CORES_DO_RELATORIO = ["#0f1b2d", "#9c6a1f", "#2e6b44", "#8a3324", "#5b8aa6", "#7a5aa0"];

function barrasEstaticas(lista) {
  if (!lista?.length) return '<p class="vazio">Sem dados neste período.</p>';
  const maximo = Math.max(...lista.map((g) => g.totalLeads), 1);
  const altura = 22;
  const largura = 600;
  const barras = lista
    .map((g, i) => {
      const y = 10 + i * altura;
      const w = (g.totalLeads / maximo) * (largura - 90);
      return `<text x="34" y="${y + 13}" text-anchor="end" font-family="monospace" font-size="10" font-weight="700" fill="#555">${i + 1}</text>
        <rect x="40" y="${y}" width="${w.toFixed(1)}" height="16" fill="${CORES_DO_RELATORIO[i % CORES_DO_RELATORIO.length]}"/>
        <text x="${(46 + w).toFixed(1)}" y="${y + 13}" font-family="monospace" font-size="10" fill="#333">${g.totalLeads}</text>`;
    })
    .join("");
  const legenda = lista.map((g, i) => `<span><strong>${i + 1}</strong> ${esc(g.grupo)}</span>`).join("");
  return `<svg viewBox="0 0 ${largura} ${lista.length * altura + 20}" style="display:block;width:100%;max-width:600px;height:auto;margin:10px 0">${barras}</svg><div class="legenda">${legenda}</div>`;
}

// Engajamento por etapa, em quantidade de leads.
function engajamentoEstatico(lista, limite = 6) {
  if (!lista?.length) return '<p class="vazio">Sem dados suficientes neste período.</p>';
  const grupos = [...lista].sort((a, b) => b.pontos.at(-1).percentual - a.pontos.at(-1).percentual).slice(0, limite);
  const etapas = grupos[0].pontos.map((p) => p.etapa);
  const tracos = ["", "7,3", "2,3", "10,3,2,3", "1,4", "4,2"];
  const W = 640, H = 270, ML = 34, MR = 20, MT = 20, MB = 50;
  const areaW = W - ML - MR, areaH = H - MT - MB, base = MT + areaH;
  const passo = etapas.length > 1 ? areaW / (etapas.length - 1) : 0;
  const maximo = Math.max(...grupos.flatMap((g) => g.pontos.map((p) => p.quantidade)), 1);

  const marcas = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = base - f * areaH;
      return `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="#ddd"/><text x="${ML - 6}" y="${y + 3}" text-anchor="end" font-family="monospace" font-size="9" fill="#888">${Math.round(maximo * f)}</text>`;
    })
    .join("");
  const linhas = grupos
    .map((g, gi) => {
      const cor = CORES_DO_RELATORIO[gi % CORES_DO_RELATORIO.length];
      const traco = tracos[gi % tracos.length] ? ` stroke-dasharray="${tracos[gi % tracos.length]}"` : "";
      const pontos = g.pontos.map((p, i) => ({ x: ML + i * passo, y: base - (p.quantidade / maximo) * areaH, v: p.quantidade }));
      return `<path d="${pontos.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")}" fill="none" stroke="${cor}" stroke-width="2"${traco}/>
        ${pontos.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${cor}"/><text x="${c.x.toFixed(1)}" y="${(c.y - 8).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${cor}">${c.v}</text>`).join("")}`;
    })
    .join("");
  const rotulos = etapas.map((nome, i) => `<text x="${(ML + i * passo).toFixed(1)}" y="${base + 16}" text-anchor="middle" font-family="monospace" font-size="9" fill="#666">${esc(nome)}</text>`).join("");
  const legenda = grupos.map((g, gi) => `<span><strong style="color:${CORES_DO_RELATORIO[gi % CORES_DO_RELATORIO.length]}">${gi + 1}</strong> ${esc(g.grupo)} (${g.totalLeads} leads)</span>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;max-width:640px;height:auto;margin:10px 0">${marcas}${linhas}${rotulos}</svg><div class="legenda">${legenda}</div>`;
}

function tabelaDeCusto(grupos) {
  const comCusto = (grupos || []).filter((g) => g.custoTotal !== null && g.custoTotal !== undefined);
  if (!comCusto.length) return '<p class="vazio">Nenhum orçamento registrado para esta semana.</p>';
  return `<table>
    <thead><tr><th>Anúncio e conjunto</th><th class="num">Leads</th><th class="num">Qualificados</th><th class="num">Fechados</th><th class="num">Orçamento diário</th><th class="num">Custo total</th><th class="num">Custo por lead</th><th class="num">Custo por qualificado</th><th class="num">Custo por contrato</th></tr></thead>
    <tbody>${comCusto
      .map(
        (g) => `<tr><td>${esc(g.grupo)}</td><td class="num">${g.totalLeads}</td><td class="num">${g.qualificados}</td><td class="num">${g.contratoFechado}</td><td class="num">${reais(g.orcamentoDiario)}</td><td class="num">${reais(g.custoTotal)}</td><td class="num destaque">${reais(g.custoPorLead)}</td><td class="num destaque">${reais(g.custoPorQualificado)}</td><td class="num destaque">${reais(g.custoPorContratoFechado)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
}

function tabelaDeComparacao(c) {
  if (!c || c.semAnterior) return `<p class="vazio">${esc(c?.mensagem || "Sem semana anterior salva para comparar.")}</p>`;
  const linha = (rotulo, chave, menorEhMelhor = false) => {
    const m = c[chave];
    const formatar = (v) => (chave.startsWith("custo") ? reais(v) : v ?? "—");
    if (!m || m.variacaoPct === null) return `<tr><td>${rotulo}</td><td class="num">—</td><td class="num">${m ? formatar(m.atual) : "—"}</td><td class="num">sem comparação</td></tr>`;
    const subiu = m.variacaoPct > 0;
    const cor = m.variacaoPct === 0 ? "#666" : subiu !== menorEhMelhor ? "#1e7a4a" : "#a33";
    const sinal = m.variacaoPct > 0 ? "+" : "";
    return `<tr><td>${rotulo}</td><td class="num">${formatar(m.anterior)}</td><td class="num">${formatar(m.atual)}</td><td class="num" style="color:${cor};font-weight:700">${sinal}${m.variacaoPct.toLocaleString("pt-BR")}%</td></tr>`;
  };
  return `<p class="nota">Comparada com a semana de ${esc(c.semanaAnterior.inicio)} a ${esc(c.semanaAnterior.fim)}.</p>
    <table><thead><tr><th>Indicador</th><th class="num">Semana anterior</th><th class="num">Esta semana</th><th class="num">Variação</th></tr></thead>
    <tbody>${linha("Leads", "leads")}${linha("Qualificados", "qualificados")}${linha("Reuniões", "reuniao")}${linha("Contratos fechados", "contratoFechado")}${linha("Custo por lead", "custoPorLead", true)}${linha("Custo por qualificado", "custoPorQualificado", true)}</tbody></table>`;
}

function listaDeAnotacoes(registro) {
  if (!registro) return '<p class="vazio">Semana não salva no histórico.</p>';
  const data = (iso) => new Date(iso).toLocaleDateString("pt-BR");
  const decisoes = registro.decisoes?.length
    ? `<h3>Decisões</h3><ul class="registros">${registro.decisoes.map((d) => `<li><span class="data">${data(d.criadoEm)}</span>${d.assunto ? `<strong>${esc(d.assunto)}:</strong> ` : ""}${esc(d.decisao)}</li>`).join("")}</ul>`
    : "";
  const observacoes = registro.observacoes?.length
    ? `<h3>Observações</h3><ul class="registros">${registro.observacoes.map((o) => `<li><span class="data">${data(o.criadoEm)}</span>${esc(o.texto)}</li>`).join("")}</ul>`
    : "";
  return decisoes + observacoes || '<p class="vazio">Nenhuma decisão ou observação registrada.</p>';
}

function documentoHTML(titulo, subtitulo, corpo) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${esc(titulo)}</title>
<style>${ESTILO_DO_RELATORIO}</style>
</head>
<body>
  <h1>${esc(titulo)}</h1>
  <p class="sub">Robson Menezes Advogados · Núcleo de Saúde · ${esc(subtitulo)} · Gerado em ${new Date().toLocaleString("pt-BR")}</p>
  ${corpo}
  <p style="margin-top:32px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#999;text-align:right">Desenvolvido por <a href="https://github.com/diogocoding" style="color:#999;text-decoration:none">diogocoding</a></p>
</body>
</html>`;
}

// contexto: { inicio, fim, funil (escopo geral de /api/metrics), analise,
// analiseComCusto, registro, comparacao }
function relatorioSemanalHTML(contexto) {
  const { inicio, fim, funil, analise, analiseComCusto, registro, comparacao } = contexto;
  const v = funil?.volume || {};
  const t = funil?.taxas || {};
  const corpo = `
  <h2>1. Atividade da equipe no período</h2>
  <p class="nota">Tudo o que aconteceu entre as datas do relatório, com qualquer lead, inclusive os que chegaram antes.</p>
  <div class="kpis">
    ${kpi(numero(v.leadsRecebidos), "Leads recebidos")}
    ${kpi(numero(v.qualificados), "Qualificados")}
    ${kpi(numero(v.reunioesMarcadas), "Reuniões marcadas")}
    ${kpi(numero(v.reunioesRealizadas), "Reuniões realizadas")}
    ${kpi(percentual(t.comparecimento), "Comparecimento")}
    ${kpi(numero(v.naoRealizadas), "Não realizadas")}
    ${kpi(numero(v.fechados), "Contratos fechados")}
    ${kpi(numero(v.reunioesEmAberto), "Reuniões em aberto")}
  </div>

  <h2>2. Comparação com a semana anterior</h2>
  ${tabelaDeComparacao(comparacao)}

  <h2>3. Origem dos leads</h2>
  <p class="nota">Somente os leads que chegaram no período, acompanhados até a data em que este relatório foi gerado.</p>
  <h3>Por campanha do Meta</h3>
  ${tabelaPorCampanhaMeta(analise?.porCampanhaMeta)}
  ${tabelaDeGrupos("Por campanha do núcleo (IR-Q, IR-W, REA-Q)", analise?.porCampanha)}
  ${tabelaDeGrupos("Por conjunto de anúncios", analise?.porConjunto)}
  ${tabelaDeGrupos("Por anúncio", analise?.porAnuncio)}
  ${tabelaDeGrupos("Por região (DDD do telefone)", analise?.porRegiao)}
  ${tabelaDeGrupos("Conjunto de anúncios por região", analise?.conjuntoPorRegiao, "Cruza o público visado pelo conjunto com a região de quem chegou.")}

  <h3>Distribuição por estado</h3>
  ${barrasEstaticas(analise?.porEstado)}
  <h3>Engajamento por etapa: conjunto de anúncios (quantidade de leads)</h3>
  ${engajamentoEstatico(analise?.engajamentoPorConjunto)}
  <h3>Engajamento por etapa: estados (quantidade de leads)</h3>
  ${engajamentoEstatico(analise?.engajamentoPorEstado)}

  <h2>4. Custo de tráfego</h2>
  ${tabelaDeCusto(analiseComCusto?.porAnuncioEConjunto)}

  <h2>5. Decisões e observações</h2>
  ${listaDeAnotacoes(registro)}`;
  return documentoHTML("Relatório semanal de tráfego e funil", `Período: ${inicio} a ${fim}`, corpo);
}

// d: resposta de /api/trafego/rollup
function relatorioDaSomaHTML(d) {
  const colunasDeCusto = d.todasComCusto ? '<th class="num">Custo total</th><th class="num">Custo por lead</th><th class="num">Custo por qualificado</th>' : "";
  const tabela = (lista, comCusto) => `<table>
    <thead><tr><th>Grupo</th><th class="num">Leads</th><th class="num">Qualificados</th><th class="num">Taxa de qualificação</th><th class="num">Reuniões</th><th class="num">Fechados</th>${comCusto ? colunasDeCusto : ""}</tr></thead>
    <tbody>${lista
      .map(
        (g) => `<tr><td>${esc(g.grupo)}</td><td class="num">${g.totalLeads}</td><td class="num">${g.qualificados}</td><td class="num destaque">${percentual(g.percentualQualificados)}</td><td class="num">${g.reuniao}</td><td class="num">${g.contratoFechado}</td>${comCusto && d.todasComCusto ? `<td class="num">${reais(g.custoTotal)}</td><td class="num">${reais(g.custoPorLead)}</td><td class="num">${reais(g.custoPorQualificado)}</td>` : ""}</tr>`,
      )
      .join("")}</tbody></table>`;
  const corpo = `
  <div class="kpis">
    ${kpi(numero(d.totalLeads), "Leads")}
    ${kpi(numero(d.totalQualificados), "Qualificados")}
    ${kpi(numero(d.totalReuniao), "Reuniões")}
    ${kpi(numero(d.totalContratoFechado), "Contratos fechados")}
  </div>
  <p class="nota">Leads que chegaram em cada semana somada, acompanhados até a data em que este relatório foi gerado.</p>
  <h2>1. Por campanha do Meta</h2>
  ${tabelaPorCampanhaMeta(d.porCampanhaMeta)}
  <h2>2. Por conjunto de anúncios</h2>
  ${tabela(d.porConjunto, false)}
  <h2>3. Por anúncio e conjunto</h2>
  ${d.todasComCusto ? "" : '<p class="nota">Nem todas as semanas somadas têm orçamento registrado; os valores de custo foram omitidos.</p>'}
  ${tabela(d.porAnuncioEConjunto, true)}
  <h2>4. Por região</h2>
  ${tabela(d.porRegiao, false)}`;
  return documentoHTML("Relatório de semanas somadas", `Período: ${d.periodo.inicio} a ${d.periodo.fim} · ${d.semanasIncluidas} semanas`, corpo);
}
