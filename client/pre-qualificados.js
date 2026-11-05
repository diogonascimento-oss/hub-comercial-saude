// Seção "Pré-qualificados pelo questionário" da aba Tráfego e campanhas.
//
// Mostra quantos leads já chegam com o perfil da campanha, segundo as
// respostas do questionário gravadas no Kommo, por anúncio, conjunto ou
// campanha. As regras ficam no servidor (PRE_QUALIFICACAO, em config.js).
// "Pré-qualificado" não é "Qualificado": este último continua sendo só o lead
// que a equipe qualificou na mão.
//
// Depende de app.js ($, esc, numero, percentual, chamarApi, dados,
// campanhaSelecionada, abaAtiva) e de trafego.js (periodoDoFiltro,
// abrirLeadsDoGrupo).

let preQualificados = null;
// Período e filtros com que "preQualificados" foi consultado. Os arquivos
// baixados usam este registro, e não os campos da tela, que podem ter mudado
// depois da consulta.
let periodoDosPreQualificados = null;
let chaveDosPreQualificados = "";

// Colunas de contagem. "filtro" separa, entre os leads do grupo, os que
// entram na contagem; os leads vêm todos juntos do servidor.
const COLUNAS_PRE_QUALIFICACAO = [
  {
    titulo: "Pré-qualificados",
    campo: "preQualificados",
    filtro: (l) => l.situacao === "preQualificado",
    regra: (b) => `Todos os critérios atendidos pelas respostas do questionário: ${b.criterio}.`,
  },
  {
    titulo: "Pendentes",
    campo: "pendentes",
    filtro: (l) => l.situacao === "pendente",
    regra: () => "Nenhuma resposta reprova o lead, mas falta confirmar algo: faixa de valor que cruza o limite, resposta não reconhecida ou critério sem resposta. A coluna \"Parecer\" diz o que falta.",
  },
  {
    titulo: "Não qualificados",
    campo: "naoQualificados",
    filtro: (l) => l.situacao === "naoQualificado",
    regra: () => "Pelo menos um critério claramente não atendido pelas respostas. A coluna \"Parecer\" diz qual.",
  },
  {
    titulo: "Sem respostas",
    campo: "semRespostas",
    filtro: (l) => l.situacao === "semRespostas",
    regra: () => "Nenhum critério respondido no Kommo (por exemplo, lead que veio de conversa de WhatsApp, sem o questionário).",
  },
  {
    titulo: "Qualificados pela equipe",
    campo: "qualificadosPelaEquipe",
    filtro: (l) => l.qualificadoPelaEquipe,
    regra: () => "Leads que a equipe qualificou (mesma contagem de \"Qualificados\" do resto do painel), de qualquer perfil de resposta.",
  },
  {
    titulo: "Pré-qualificados em triagem",
    campo: "preQualificadosEmTriagem",
    filtro: (l) => l.preEmTriagem,
    regra: () => "Pré-qualificados que a equipe ainda não qualificou nem descartou: continuam em Contato Inicial, Contato Iniciado ou Em Qualificação.",
  },
];

const ROTULO_DO_RESUMO = {
  anuncio: "anúncio",
  conjunto: "conjunto de anúncios",
  campanhaMeta: "campanha do Meta",
  campanha: "campanha do núcleo",
};

async function carregarPreQualificados(forcar = false) {
  if (abaAtiva !== "trafego") return;
  const { inicio, fim } = periodoDoFiltro();
  if (!inicio || !fim) return;
  const apenasNovos = $("apenasNovos").checked;
  const agrupar = $("agruparPreQualificados").value;
  const chave = `${inicio}|${fim}|${campanhaSelecionada}|${apenasNovos}|${agrupar}|${dados?.geradoEm || ""}`;
  if (!forcar && chave === chaveDosPreQualificados) return;
  chaveDosPreQualificados = chave;
  $("preQualificados").innerHTML = '<p class="text-xs text-inkdim">Carregando.</p>';
  const campanha = campanhaSelecionada;
  try {
    const resposta = await chamarApi(
      `/trafego/pre-qualificados?inicio=${inicio}&fim=${fim}&apenasNovos=${apenasNovos}&agruparPor=${agrupar}&campanha=${encodeURIComponent(campanha)}`,
    );
    preQualificados = resposta;
    periodoDosPreQualificados = { inicio, fim, apenasNovos, campanha };
    renderizarPreQualificados();
  } catch (erro) {
    chaveDosPreQualificados = "";
    $("preQualificados").innerHTML = `<p class="text-xs text-negativo">Não foi possível montar os pré-qualificados. ${esc(erro.message)}</p>`;
  }
}

function blocoDePreQualificados(b, bi, agruparPor) {
  const faltando = b.campos.filter((c) => !c.complementar && !c.encontrado);
  const aviso = faltando.length
    ? `<p class="border border-gold/25 bg-gold/5 text-goldbright text-xs px-4 py-2.5">Não encontrei no Kommo o campo de: ${faltando.map((c) => esc(c.rotulo)).join(", ")}. Sem ele, os leads dessa pergunta ficam como pendentes ou sem respostas. Informe o ID do campo (ou ajuste o nome) em PRE_QUALIFICACAO, no server/config.js; a rota /api/diagnostico/campos lista os campos e os IDs.</p>`
    : "";
  const camposLidos = b.campos
    .map((c) =>
      c.encontrado
        ? `${esc(c.rotulo)}${c.complementar ? " (complementar)" : ""}: campo \"${esc(c.encontrado.nome)}\" (${numero(c.encontrado.preenchidos)} preenchido${c.encontrado.preenchidos === 1 ? "" : "s"})`
        : `${esc(c.rotulo)}${c.complementar ? " (complementar)" : ""}: campo não encontrado`,
    )
    .join(" · ");

  const celula = (g, gi, c, ci) =>
    g[c.campo] > 0
      ? `<button type="button" data-bloco="${bi}" data-grupo="${gi}" data-coluna="${ci}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${numero(g[c.campo])}</button>`
      : `<span class="text-inkfaint">0</span>`;
  const linha = (g, gi, classe = "") => `<tr class="${classe}">
        <td class="${gi < 0 ? "text-goldbright" : "text-ink"} max-w-[240px] truncate" title="${esc(g.grupo)}">${esc(g.grupo)}</td>
        <td class="text-right tabular">${numero(g.totalLeads)}</td>
        ${COLUNAS_PRE_QUALIFICACAO.slice(0, 1).map((c, ci) => `<td class="text-right tabular text-positivo">${celula(g, gi, c, ci)}</td>`).join("")}
        <td class="text-right tabular text-inkdim">${percentual(g.percentualPreQualificados)}</td>
        ${COLUNAS_PRE_QUALIFICACAO.slice(1).map((c, ci) => `<td class="text-right tabular">${celula(g, gi, c, ci + 1)}</td>`).join("")}
      </tr>`;

  const complementar = (b.complementar || [])
    .map(
      (c) =>
        `Informação complementar, que não entra no critério: entre os pré-qualificados, ${numero(c.sim)} informaram \"${esc(c.rotulo.toLowerCase())}\", ${numero(c.nao)} responderam que não e ${numero(c.semResposta)} não responderam.`,
    )
    .join(" ");
  const ninguemRespondeu = b.total.totalLeads > 0 && b.total.semRespostas === b.total.totalLeads;

  return `<div class="space-y-2">
    <p class="text-xs font-semibold text-ink">${esc(b.titulo)} <span class="text-inkfaint font-normal">(${esc(b.codigo)}) · ${numero(b.total.totalLeads)} lead${b.total.totalLeads === 1 ? "" : "s"}</span></p>
    <p class="text-[11px] text-inkdim leading-relaxed">Critério: ${esc(b.criterio)}.</p>
    ${aviso}
    ${ninguemRespondeu && !faltando.length ? '<p class="text-[11px] text-goldbright">Nenhum lead desta campanha tem as respostas do questionário gravadas no Kommo.</p>' : ""}
    <div class="overflow-x-auto"><table class="comparativo compacta w-full text-xs">
      <thead>
        <tr class="text-inkdim text-[10px] uppercase tracking-wide">
          <th class="text-left font-normal align-bottom">${esc(ROTULO_DO_RESUMO[agruparPor] || "Grupo")}</th>
          <th class="text-right font-normal align-bottom">Leads</th>
          <th class="text-right font-normal align-bottom">Pré-qualificados</th>
          <th class="text-right font-normal align-bottom">%</th>
          ${COLUNAS_PRE_QUALIFICACAO.slice(1).map((c) => `<th class="text-right font-normal align-bottom">${esc(c.titulo)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${b.grupos.map((g, gi) => linha(g, gi)).join("")}
        ${linha(b.total, -1, "destaque font-semibold")}
      </tbody>
    </table></div>
    <p class="text-[10px] text-inkfaint leading-relaxed">${complementar ? `${complementar} ` : ""}Campos lidos no Kommo — ${camposLidos}.</p>
  </div>`;
}

function renderizarPreQualificados() {
  const r = preQualificados;
  if (!r) return;
  const container = $("preQualificados");
  if (!r.campanhas.length) {
    container.innerHTML = '<p class="text-xs text-inkdim">Sem leads no período nas campanhas com questionário.</p>';
    return;
  }
  container.innerHTML = r.campanhas.map((b, bi) => blocoDePreQualificados(b, bi, r.agruparPor)).join("");
  container.querySelectorAll("button[data-bloco]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const b = r.campanhas[Number(botao.dataset.bloco)];
      const gi = Number(botao.dataset.grupo);
      const g = gi < 0 ? b.total : b.grupos[gi];
      const c = COLUNAS_PRE_QUALIFICACAO[Number(botao.dataset.coluna)];
      abrirLeadsDoGrupo(`${b.titulo} · ${g.grupo}: ${c.titulo.toLowerCase()}`, g.leads.filter(c.filtro), c.regra(b));
    });
  });
}

$("agruparPreQualificados").addEventListener("change", () => carregarPreQualificados());

// --- Download: imagem (PNG) e HTML -------------------------------------------------------------
//
// Os dois arquivos trazem o período, a campanha e o agrupamento da consulta,
// as tabelas por campanha, o critério usado e um aviso quando algum campo do
// questionário não foi encontrado no Kommo (os números ficam parciais).

const dataBr = (iso) => iso.split("-").reverse().join("/");

function descricaoDoPeriodoPre() {
  const p = periodoDosPreQualificados;
  const escopo = p.apenasNovos ? "leads que chegaram no período, acompanhados até hoje" : "tudo o que aconteceu no período";
  return `Período: ${dataBr(p.inicio)} a ${dataBr(p.fim)} · ${escopo}`;
}

function descricaoDosFiltrosPre() {
  const p = periodoDosPreQualificados;
  const campanha = p.campanha === "TODAS" ? "Todas as campanhas" : `Campanha ${p.campanha}`;
  return `${campanha} · Agrupado por ${ROTULO_DO_RESUMO[preQualificados.agruparPor] || "anúncio"}`;
}

const geradoEmPre = () => `Gerado em ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;

const nomeDoArquivoDosPreQualificados = (extensao) => {
  const p = periodoDosPreQualificados;
  return `pre-qualificados_${p.inicio}_a_${p.fim}_${preQualificados.agruparPor}${p.campanha === "TODAS" ? "" : `_${p.campanha}`}.${extensao}`;
};

// Cabeçalho e valores da tabela, na mesma ordem da tela.
function cabecalhoDaTabelaPre(r) {
  const grupo = ROTULO_DO_RESUMO[r.agruparPor] || "Grupo";
  return [grupo[0].toUpperCase() + grupo.slice(1), "Leads", COLUNAS_PRE_QUALIFICACAO[0].titulo, "%", ...COLUNAS_PRE_QUALIFICACAO.slice(1).map((c) => c.titulo)];
}
function valoresDoGrupoPre(g) {
  return [g.grupo, numero(g.totalLeads), numero(g[COLUNAS_PRE_QUALIFICACAO[0].campo]), percentual(g.percentualPreQualificados), ...COLUNAS_PRE_QUALIFICACAO.slice(1).map((c) => numero(g[c.campo]))];
}
const avisoDeCamposPre = (b) => {
  const faltando = b.campos.filter((c) => !c.complementar && !c.encontrado).map((c) => c.rotulo);
  return faltando.length ? `Atenção: não encontrei no Kommo o campo de ${faltando.join(", ")}. Os leads dessa pergunta ficam como pendentes ou sem respostas.` : "";
};
const complementarDoBlocoPre = (b) =>
  (b.complementar || [])
    .map((c) => `Informação complementar, que não entra no critério: entre os pré-qualificados, ${numero(c.sim)} informaram "${c.rotulo.toLowerCase()}", ${numero(c.nao)} responderam que não e ${numero(c.semResposta)} não responderam.`)
    .join(" ");

// Imagem, no estilo das tabelas do resumo para o núcleo. Devolve o canvas.
function imagemDosPreQualificados() {
  const r = preQualificados;
  const escala = 2;
  const margem = 20;
  const larguraGrupo = 250;
  const larguraNumero = 108;
  const alturaLinha = 26;
  const cabecalho = cabecalhoDaTabelaPre(r);
  const larguraTabela = larguraGrupo + (cabecalho.length - 1) * larguraNumero;
  const largura = larguraTabela + margem * 2;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const quebrar = (texto, fonte, larguraMax) => {
    ctx.font = fonte;
    const linhas = [];
    let atual = "";
    for (const palavra of String(texto).split(/\s+/).filter(Boolean)) {
      const teste = atual ? `${atual} ${palavra}` : palavra;
      if (atual && ctx.measureText(teste).width > larguraMax) {
        linhas.push(atual);
        atual = palavra;
      } else atual = teste;
    }
    if (atual) linhas.push(atual);
    return linhas;
  };
  const cortar = (texto, fonte, larguraMax) => {
    ctx.font = fonte;
    let t = String(texto);
    if (ctx.measureText(t).width <= larguraMax) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > larguraMax) t = t.slice(0, -1);
    return `${t}…`;
  };

  const FONTE_TEXTO = "11px Arial, sans-serif";
  const FONTE_CABECALHO = "bold 11px Arial, sans-serif";
  const linhasDoCabecalho = cabecalho.map((t, j) => quebrar(t, FONTE_CABECALHO, (j === 0 ? larguraGrupo : larguraNumero) - 10));
  const alturaDoCabecalho = Math.max(...linhasDoCabecalho.map((l) => l.length)) * 14 + 12;

  // Primeira passada: alturas, para dimensionar o canvas.
  const blocos = r.campanhas.map((b) => ({
    b,
    criterio: quebrar(`Critério: ${b.criterio}.`, FONTE_TEXTO, larguraTabela),
    aviso: quebrar(avisoDeCamposPre(b), FONTE_TEXTO, larguraTabela),
    complementar: quebrar(complementarDoBlocoPre(b), FONTE_TEXTO, larguraTabela),
  }));
  const alturaDoBloco = (x) =>
    alturaLinha + 8 + x.criterio.length * 15 + (x.aviso.length ? 4 + x.aviso.length * 15 : 0) + 6 + alturaDoCabecalho + (x.b.grupos.length + 1) * alturaLinha + (x.complementar.length ? 8 + x.complementar.length * 15 : 0);
  const alturaDoTopo = 92;
  const altura = margem + alturaDoTopo + blocos.reduce((h, x) => h + alturaDoBloco(x) + 30, 0);

  canvas.width = largura * escala;
  canvas.height = altura * escala;
  ctx.scale(escala, escala);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largura, altura);

  // Topo: título, período, filtros.
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f5597";
  ctx.font = "bold 18px Arial, sans-serif";
  ctx.fillText("Pré-qualificados pelo questionário", margem, margem + 18);
  ctx.fillStyle = "#333333";
  ctx.font = "13px Arial, sans-serif";
  ctx.fillText(descricaoDoPeriodoPre(), margem, margem + 40);
  ctx.fillText(descricaoDosFiltrosPre(), margem, margem + 58);
  ctx.fillStyle = "#777777";
  ctx.font = "10px Arial, sans-serif";
  ctx.fillText(geradoEmPre(), margem, margem + 74);

  const texto = (linhas, x, y, cor) => {
    ctx.fillStyle = cor;
    ctx.font = FONTE_TEXTO;
    ctx.textAlign = "left";
    linhas.forEach((l, i) => ctx.fillText(l, x, y + 11 + i * 15));
  };
  const xDaColuna = (j) => margem + (j === 0 ? 0 : larguraGrupo + (j - 1) * larguraNumero);
  const larguraDaColuna = (j) => (j === 0 ? larguraGrupo : larguraNumero);
  const celula = (j, y, h, fundo) => {
    ctx.fillStyle = fundo;
    ctx.fillRect(xDaColuna(j), y, larguraDaColuna(j), h);
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(xDaColuna(j), y, larguraDaColuna(j), h);
  };

  let y = margem + alturaDoTopo;
  for (const x of blocos) {
    // Barra de título da campanha
    ctx.fillStyle = "#1f5597";
    ctx.fillRect(margem, y, larguraTabela, alturaLinha);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(cortar(`${x.b.titulo} (${x.b.codigo}) · ${numero(x.b.total.totalLeads)} lead${x.b.total.totalLeads === 1 ? "" : "s"}`, "bold 14px Arial, sans-serif", larguraTabela - 20), margem + 10, y + 18);
    y += alturaLinha + 8;
    texto(x.criterio, margem, y, "#555555");
    y += x.criterio.length * 15;
    if (x.aviso.length) {
      y += 4;
      texto(x.aviso, margem, y, "#8a5a00");
      y += x.aviso.length * 15;
    }
    y += 6;

    // Cabeçalho
    cabecalho.forEach((_, j) => {
      celula(j, y, alturaDoCabecalho, "#d9d9d9");
      ctx.fillStyle = "#222222";
      ctx.font = FONTE_CABECALHO;
      ctx.textAlign = j === 0 ? "left" : "center";
      const linhas = linhasDoCabecalho[j];
      const topo = y + (alturaDoCabecalho - linhas.length * 14) / 2;
      linhas.forEach((l, i) => ctx.fillText(l, j === 0 ? xDaColuna(0) + 8 : xDaColuna(j) + larguraDaColuna(j) / 2, topo + 11 + i * 14));
    });
    y += alturaDoCabecalho;

    // Grupos e total
    [...x.b.grupos, x.b.total].forEach((g, i, todos) => {
      const total = i === todos.length - 1;
      valoresDoGrupoPre(g).forEach((v, j) => {
        celula(j, y, alturaLinha, total ? "#a9c4eb" : j === 2 || j === 3 ? "#e2efda" : "#f3f3f3");
        ctx.fillStyle = "#222222";
        ctx.font = `${total || j === 2 ? "bold " : ""}12px Arial, sans-serif`;
        if (j === 0) {
          ctx.textAlign = "left";
          ctx.fillText(cortar(v, ctx.font, larguraGrupo - 16), xDaColuna(0) + 8, y + 17);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(v, xDaColuna(j) + larguraDaColuna(j) / 2, y + 17);
        }
      });
      y += alturaLinha;
    });

    if (x.complementar.length) {
      y += 8;
      texto(x.complementar, margem, y, "#555555");
      y += x.complementar.length * 15;
    }
    y += 30;
  }
  return canvas;
}

$("btnImagemPreQualificados").addEventListener("click", () => {
  if (!preQualificados?.campanhas.length || !periodoDosPreQualificados) return;
  imagemDosPreQualificados().toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nomeDoArquivoDosPreQualificados("png");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
});

// HTML autocontido, para abrir no navegador, imprimir ou anexar.
function htmlDosPreQualificados() {
  const r = preQualificados;
  const th = (t, j) => `<th style="background:#d9d9d9;padding:4px 10px;border:1px solid #fff;font-size:11px;${j === 0 ? "text-align:left" : "text-align:center;width:96px"}">${esc(t)}</th>`;
  const tabela = (b) => `<table style="border-collapse:collapse;margin-bottom:6px">
    <thead><tr>${cabecalhoDaTabelaPre(r).map(th).join("")}</tr></thead>
    <tbody>${[...b.grupos, b.total]
      .map((g, i, todos) => {
        const total = i === todos.length - 1;
        return `<tr>${valoresDoGrupoPre(g)
          .map((v, j) => `<td style="padding:4px 10px;border:1px solid #fff;font-size:12px;${j === 0 ? "text-align:left;max-width:280px" : "text-align:center"};background:${total ? "#a9c4eb" : j === 2 || j === 3 ? "#e2efda" : "#f3f3f3"};${total || j === 2 ? "font-weight:bold" : ""}">${esc(v)}</td>`)
          .join("")}</tr>`;
      })
      .join("")}</tbody></table>`;
  const camposLidos = (b) =>
    b.campos
      .map((c) => `${esc(c.rotulo)}${c.complementar ? " (complementar)" : ""}: ${c.encontrado ? `campo "${esc(c.encontrado.nome)}" (${numero(c.encontrado.preenchidos)} preenchido${c.encontrado.preenchidos === 1 ? "" : "s"})` : "campo não encontrado"}`)
      .join(" · ");
  const blocos = r.campanhas
    .map((b) => {
      const aviso = avisoDeCamposPre(b);
      const complementar = complementarDoBlocoPre(b);
      return `<h2>${esc(b.titulo)} <small>(${esc(b.codigo)}) · ${numero(b.total.totalLeads)} lead${b.total.totalLeads === 1 ? "" : "s"}</small></h2>
<p>Critério: ${esc(b.criterio)}.</p>${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ""}${tabela(b)}${complementar ? `<p>${esc(complementar)}</p>` : ""}<p class="campos">Campos lidos no Kommo — ${camposLidos(b)}.</p>`;
    })
    .join("");
  const legenda = COLUNAS_PRE_QUALIFICACAO.slice(1)
    .map((c) => `<li><b>${esc(c.titulo)}:</b> ${esc(c.regra(r.campanhas[0]))}</li>`)
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pré-qualificados pelo questionário</title>
<style>body{font-family:Calibri,Arial,sans-serif;margin:24px;color:#222}h1{font-size:20px;margin:0 0 6px;color:#1f5597}h2{font-size:15px;margin:26px 0 4px;background:#1f5597;color:#fff;padding:5px 10px}h2 small{font-weight:normal}p{font-size:12px;color:#555;margin:0 0 8px}p.topo{font-size:13px;color:#333;margin:0 0 4px}p.aviso{color:#8a5a00}p.campos{font-size:10px;color:#777}ul{font-size:11px;color:#555;padding-left:18px}@media print{body{margin:0}}</style></head>
<body><h1>Pré-qualificados pelo questionário</h1>
<p class="topo">${esc(descricaoDoPeriodoPre())}</p><p class="topo">${esc(descricaoDosFiltrosPre())}</p><p class="campos">${esc(geradoEmPre())}</p>
${blocos}
<h2>Como ler</h2><p>Pré-qualificado é o lead cujas respostas do questionário, gravadas no Kommo, atendem a todos os critérios da campanha. Não é o mesmo que "Qualificados pela equipe".</p><ul>${legenda}</ul></body></html>`;
}

$("btnHtmlPreQualificados").addEventListener("click", () => {
  if (!preQualificados?.campanhas.length || !periodoDosPreQualificados) return;
  baixarArquivo(nomeDoArquivoDosPreQualificados("html"), htmlDosPreQualificados(), "text/html;charset=utf-8");
});
