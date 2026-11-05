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
    titulo: "Pré-qualificados aguardando contato",
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
  try {
    preQualificados = await chamarApi(
      `/trafego/pre-qualificados?inicio=${inicio}&fim=${fim}&apenasNovos=${apenasNovos}&agruparPor=${agrupar}&campanha=${encodeURIComponent(campanhaSelecionada)}`,
    );
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
