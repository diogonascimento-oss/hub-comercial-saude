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
      <dl class="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-1.5">
        ${preenchidas.map(([nome, valor]) => `<dt class="text-inkdim">${esc(nome)}</dt><dd class="text-ink break-words">${valor}</dd>`).join("")}
      </dl>
    </section>`;
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
  const outrosCampos = l.camposDoLead.filter((c) => !jaExibidos.has(c.valor));

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
    blocoDaFicha("Origem de marketing", [
      ["Campanha Meta", texto(l.origem.campanhaMeta) || naoInformado],
      ["Conjunto de anúncios", texto(l.origem.conjunto) || naoInformado],
      ["Anúncio", texto(l.origem.anuncio) || naoInformado],
    ]) +
    blocoDaFicha("Responsáveis", [
      ["SDR", texto(l.responsaveis.sdr)],
      ["Closer", texto(l.responsaveis.closer)],
      ["Farmer", texto(l.responsaveis.farmer)],
    ]) +
    blocoDaFicha("Demais campos preenchidos no Kommo", outrosCampos.map((c) => [c.nome, esc(c.valor)])) +
    `<section>
      <p class="rotulo mb-2">Histórico de movimentações (${numero(l.historico.length)})</p>
      ${
        l.historico.length
          ? `<ol class="border-l border-line pl-4 space-y-2">${l.historico
              .map(
                (h) => `<li class="${h.excluido ? "opacity-50" : ""}">
            <span class="text-inkdim tabular">${dataHoraBr(h.data)}</span>
            <span class="text-ink block">${esc(h.de)} <span class="text-inkfaint">para</span> ${esc(h.para)}</span>
            ${h.corrigido ? '<span class="text-[10px] text-goldbright">Movimentação corrigida manualmente</span>' : ""}
            ${h.excluido ? '<span class="text-[10px] text-inkfaint">Excluída do cálculo</span>' : ""}
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
