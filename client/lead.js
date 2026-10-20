// Busca de lead e ficha completa. Depende de app.js (chamarApi, esc, $,
// numero) e de trafego.js (abrirDialogo, fecharDialogo).

const dataHoraBr = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

function telefoneFormatado(telefone) {
  const d = String(telefone || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return telefone || "sem telefone";
}

// --- Busca ----------------------------------------------------------------------

let esperaDaBusca = null;
let buscaAtual = 0;

function fecharResultadosDaBusca() {
  $("resultadosDaBusca").classList.add("hidden");
}

async function buscarLeads() {
  const termo = $("buscaLead").value.trim();
  const caixa = $("resultadosDaBusca");
  if (termo.length < 2) return fecharResultadosDaBusca();
  const estaBusca = ++buscaAtual;
  caixa.classList.remove("hidden");
  caixa.innerHTML = '<p class="p-3 text-inkdim">Buscando.</p>';
  try {
    const r = await chamarApi(`/leads/busca?q=${encodeURIComponent(termo)}`);
    if (estaBusca !== buscaAtual) return; // chegou uma busca mais recente
    if (!r.resultados.length) {
      caixa.innerHTML = '<p class="p-3 text-inkdim">Nenhum lead encontrado nos três funis.</p>';
      return;
    }
    caixa.innerHTML =
      r.resultados
        .map(
          (l) => `
      <button data-lead="${esc(String(l.id))}" class="w-full text-left px-3 py-2 border-b border-line last:border-0 hover:bg-surface2 block">
        <span class="flex items-baseline justify-between gap-3">
          <span class="text-ink truncate">${esc(l.nome)}</span>
          <span class="text-inkfaint text-[10px] shrink-0">${esc(l.campanha)}${l.estado ? ` · ${esc(l.estado)}` : ""}</span>
        </span>
        <span class="flex items-baseline justify-between gap-3 mt-0.5 text-[10px]">
          <span class="text-inkdim font-mono">${esc(telefoneFormatado(l.telefone))}</span>
          <span class="text-inkdim shrink-0">${esc(l.etapa || "")}</span>
        </span>
      </button>`,
        )
        .join("") +
      (r.total > r.resultados.length ? `<p class="p-2 text-[10px] text-inkfaint">Exibindo ${numero(r.resultados.length)} de ${numero(r.total)}. Refine a busca para ver os demais.</p>` : "");
  } catch (erro) {
    if (estaBusca === buscaAtual) caixa.innerHTML = `<p class="p-3 text-negativo">${esc(erro.message)}</p>`;
  }
}

$("buscaLead").addEventListener("input", () => {
  clearTimeout(esperaDaBusca);
  esperaDaBusca = setTimeout(buscarLeads, 300);
});
$("buscaLead").addEventListener("focus", () => $("buscaLead").value.trim().length >= 2 && buscarLeads());
$("buscaLead").addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharResultadosDaBusca();
  if (e.key === "Enter") {
    clearTimeout(esperaDaBusca);
    buscarLeads();
  }
});
$("resultadosDaBusca").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-lead]");
  if (!botao) return;
  fecharResultadosDaBusca();
  abrirFichaDoLead(botao.dataset.lead);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#buscaLead, #resultadosDaBusca")) fecharResultadosDaBusca();
});

// --- Ficha ------------------------------------------------------------------------

function blocoDaFicha(titulo, linhas) {
  const preenchidas = linhas.filter(([, valor]) => valor !== null && valor !== undefined && valor !== "");
  if (!preenchidas.length) return "";
  return `
    <section>
      <p class="rotulo mb-2">${esc(titulo)}</p>
      <dl class="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 sm:gap-y-1.5">
        ${preenchidas.map(([nome, valor]) => `<dt class="text-inkdim pt-1.5 sm:pt-0">${esc(nome)}</dt><dd class="text-ink min-w-0 [overflow-wrap:anywhere]">${valor}</dd>`).join("")}
      </dl>
    </section>`;
}

// Reuniões do lead, com o desfecho que o painel considerou e o critério usado.
function blocoDeReunioes(l) {
  if (!l.reunioes?.length) return "";
  const cor = { Realizada: "text-positivo", "Não realizada": "text-negativo", "Em aberto": "text-goldbright" };
  return `
    <section>
      <p class="rotulo mb-2">Reuniões (${numero(l.reunioes.length)})</p>
      <ol class="space-y-2.5">${l.reunioes
        .map(
          (r, i) => `<li class="border border-line p-3">
          <p class="flex items-baseline justify-between gap-3">
            <span class="text-ink">${i + 1}ª reunião${r.veioDeRemarcacao ? ' <span class="text-inkfaint">(remarcação)</span>' : ""}</span>
            <span class="font-semibold ${cor[r.resultado] || "text-inkdim"}">${esc(r.resultado)}</span>
          </p>
          <p class="text-inkdim mt-1">Agendada em ${dataHoraBr(r.agendadaEm)}${r.desfechoEm ? ` · saiu de Agendado em ${dataHoraBr(r.desfechoEm)}, para ${esc(r.destino)}` : " · o lead continua em Agendado"}</p>
          ${r.criterio ? `<p class="text-[10px] text-inkfaint mt-1">Desfecho definido por: ${esc(r.criterio)}.</p>` : ""}
          ${r.divergente ? '<p class="text-[10px] text-goldbright mt-1">O campo diz uma coisa e a coluna de destino indica outra. Prevaleceu o campo.</p>' : ""}
        </li>`,
        )
        .join("")}</ol>
      <p class="text-[10px] text-inkfaint mt-2">É assim que cada reunião deste lead entra nas taxas do painel.</p>
    </section>`;
}

// Campos que o Make grava no lead para conduzir a sequência de mensagens automáticas.
function blocoDaCadencia(campos) {
  if (!campos.length) return "";
  const rotulos = [
    [/etapa/i, "Etapa em que a cadência está"],
    [/passo/i, "Passo da sequência"],
    [/pr[oó]ximo envio/i, "Próximo envio automático"],
  ];
  const nomeLegivel = (nome) => rotulos.find(([padrao]) => padrao.test(nome))?.[1] || nome;
  return (
    blocoDaFicha("Cadência de mensagens automáticas", campos.map((c) => [nomeLegivel(c.nome), esc(c.valor)])).replace(
      "</section>",
      '<p class="text-[10px] text-inkfaint mt-2">Preenchido pelo Make para controlar a sequência de mensagens automáticas. O passo indica em que ponto da sequência o lead está. A equipe não precisa preencher nem alterar esses campos.</p></section>',
    )
  );
}

function renderizarFicha(l) {
  const loc = l.localizacao;
  const localizacao = !loc.reconhecido
    ? "Não identificada (telefone fora do padrão)"
    : loc.estado
      ? `${esc(loc.estado)}${loc.regiao ? ` · ${esc(loc.regiao)}` : ""} <span class="text-inkfaint">(DDD ${esc(loc.ddd)})</span>`
      : `DDD ${esc(loc.ddd)} não reconhecido`;
  const naoInformado = '<span class="text-inkfaint">não informado</span>';
  const texto = (v) => (v ? esc(v) : "");

  $("tituloFicha").textContent = l.nome;
  $("subtituloFicha").textContent = `Lead ${l.id} · ${l.campanha} · ${l.etapa}`;

  // Campos do Kommo já exibidos nos blocos acima não se repetem na lista geral.
  const jaExibidos = new Set([l.origem.campanhaMeta, l.origem.conjunto, l.origem.anuncio, l.responsaveis.sdr, l.responsaveis.closer, l.responsaveis.farmer, l.situacaoDaReuniao, l.substatusFarmer].filter(Boolean));
  const restantes = l.camposDoLead.filter((c) => !jaExibidos.has(c.valor));
  // Campos com dados internos das automações (texto em formato JSON) não são
  // para leitura da equipe: ficam recolhidos no fim da ficha.
  const ehRegistroInterno = (valor) => {
    if (!/^\s*[{[]/.test(valor)) return false;
    try {
      JSON.parse(valor);
      return true;
    } catch {
      return false;
    }
  };
  const registrosInternos = restantes.filter((c) => ehRegistroInterno(c.valor));
  const outrosCampos = restantes.filter((c) => !c.tecnico && !ehRegistroInterno(c.valor));
  const camposTecnicos = restantes.filter((c) => c.tecnico && !ehRegistroInterno(c.valor));
  const semOrigem = l.origemSemRastreio ? esc(l.origemSemRastreio) : naoInformado;

  $("corpoFicha").innerHTML =
    blocoDaFicha("Identificação", [
      ["Nome", esc(l.nome)],
      ["Telefone", `<span class="font-mono">${esc(telefoneFormatado(l.telefone))}</span>`],
      ["Estado provável", `${localizacao}<br><span class="text-[10px] text-inkfaint">Estimativa pelo DDD: indica onde a linha foi habilitada, não necessariamente onde a pessoa mora.</span>`],
      ["Título no Kommo", texto(l.titulo)],
      ...l.camposDoContato.filter((c) => c.valor.replace(/\D/g, "") !== l.telefone).map((c) => [c.nome, esc(c.valor)]),
    ]) +
    blocoDaFicha("Situação no funil", [
      ["Campanha", esc(l.campanha)],
      ["Etapa atual", `${esc(l.etapa)}${l.diasNaEtapa !== null ? ` <span class="text-inkfaint">${l.diasNaEtapa === 0 ? "desde hoje" : `há ${numero(l.diasNaEtapa)} dia(s)`}</span>` : ""}`],
      ["Criado em", dataHoraBr(l.criadoEm)],
      ["Última atualização", dataHoraBr(l.atualizadoEm)],
      ["Situação da reunião", texto(l.situacaoDaReuniao)],
      ["Substatus Farmer", texto(l.substatusFarmer)],
      ["Motivo de perda", texto(l.motivoPerda)],
      ["Etiquetas", l.etiquetas.length ? l.etiquetas.map((t) => `<span class="inline-block border border-line px-1.5 py-0.5 mr-1 mb-1 text-[10px] text-inkdim">${esc(t)}</span>`).join("") : ""],
    ]) +
    blocoDeReunioes(l) +
    blocoDaFicha("Origem de marketing", [
      ["Campanha Meta", texto(l.origem.campanhaMeta) || semOrigem],
      ["Conjunto de anúncios", texto(l.origem.conjunto) || semOrigem],
      ["Anúncio", texto(l.origem.anuncio) || semOrigem],
    ]) +
    blocoDaFicha("Responsáveis", [
      ["SDR", texto(l.responsaveis.sdr)],
      ["Closer", texto(l.responsaveis.closer)],
      ["Farmer", texto(l.responsaveis.farmer)],
    ]) +
    blocoDaFicha("Demais campos preenchidos no Kommo", outrosCampos.map((c) => [c.nome, esc(c.valor)])) +
    blocoDaCadencia(camposTecnicos) +
    (registrosInternos.length
      ? `<details class="border border-line px-3 py-2"><summary class="cursor-pointer text-inkdim">Registros internos da automação (${numero(registrosInternos.length)})</summary>
          <p class="text-[10px] text-inkfaint mt-2">Gravados pelo Make para controlar as mensagens automáticas. A equipe não precisa ler nem alterar.</p>
          ${registrosInternos.map((c) => `<p class="text-inkdim mt-2">${esc(c.nome)}</p><pre class="mt-1 text-[10px] text-inkfaint font-mono whitespace-pre-wrap [overflow-wrap:anywhere] bg-surface2 p-2">${esc(c.valor)}</pre>`).join("")}
        </details>`
      : "") +
    `<section>
      <p class="rotulo mb-2">Histórico de movimentações (${numero(l.historico.length)})</p>
      ${
        l.historico.length
          ? `<ol class="border-l border-line pl-4 space-y-2">${l.historico
              .map(
                (h) => `<li class="${h.excluido ? "opacity-50" : ""}">
            <span class="text-inkdim tabular">${dataHoraBr(h.data)}</span>
            <span class="text-ink block">${esc(h.de)} <span class="text-inkfaint">para</span> ${esc(h.para)}</span>
            ${h.corrigido ? '<span class="text-[10px] text-goldbright block">Movimentação corrigida manualmente</span>' : ""}
            ${h.excluido ? '<span class="text-[10px] text-inkfaint block">Excluída do cálculo</span>' : ""}
            ${h.marcacao ? `<span class="text-[10px] text-inkfaint block">${esc(autoria(h.marcacao))}</span>` : ""}
          </li>`,
              )
              .join("")}</ol>`
          : '<p class="text-inkdim">Nenhuma mudança de etapa registrada. O lead permanece na etapa em que foi criado.</p>'
      }
    </section>` +
    (l.linkNoKommo ? `<p><a href="${esc(l.linkNoKommo)}" target="_blank" rel="noopener" class="underline decoration-dotted underline-offset-2 text-goldbright hover:text-ink">Abrir este lead no Kommo</a></p>` : "");
}

async function abrirFichaDoLead(leadId) {
  $("tituloFicha").textContent = "Ficha do lead";
  $("subtituloFicha").textContent = `Lead ${leadId}`;
  $("corpoFicha").innerHTML = '<p class="text-inkdim">Carregando.</p>';
  abrirDialogo("modalFicha");
  try {
    renderizarFicha(await chamarApi(`/leads/${encodeURIComponent(leadId)}`));
  } catch (erro) {
    $("corpoFicha").innerHTML = `<p class="text-negativo">Não foi possível carregar a ficha. ${esc(erro.message)}</p>`;
  }
}

// Devolve true quando havia uma ficha aberta, para a tecla Esc fechar um nível por vez.
function fecharFichaDoLead() {
  if ($("modalFicha").classList.contains("hidden")) return false;
  fecharDialogo("modalFicha");
  return true;
}

$("btnFecharFicha").addEventListener("click", fecharFichaDoLead);
$("modalFicha").addEventListener("click", (e) => e.target === $("modalFicha") && fecharFichaDoLead());
