// Interface do Hub Comercial do Núcleo de Saúde.
//
// A interface chama /api no próprio domínio. O Worker do Cloudflare repassa a
// chamada ao servidor; nenhum token ou endereço do servidor fica neste arquivo.
// O acesso à página é controlado pelo Cloudflare Access.

const API = "/api";
const INTERVALO_DE_ATUALIZACAO_MS = 5 * 60 * 1000;
const ESPERA_PARA_AVISO_DE_INICIALIZACAO_MS = 6000;

const $ = (id) => document.getElementById(id);

// --- Estado -----------------------------------------------------------------

let dados = null; // última resposta de /api/metrics
let campanhaSelecionada = "TODAS";
let nomesDasEtapas = new Map();
let categoriasDasEtapas = new Map();

// --- Utilitários ------------------------------------------------------------

// Todo texto vindo do Kommo passa por aqui antes de entrar no HTML.
function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const numero = (n) => (n ?? 0).toLocaleString("pt-BR");
const percentual = (t) => (t === null || t === undefined ? "—" : `${t.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

function duracao(segundos) {
  if (segundos === null || segundos === undefined) return "—";
  const minutos = Math.round(segundos / 60);
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h ${String(minutos % 60).padStart(2, "0")} min`;
  const dias = Math.floor(horas / 24);
  return `${dias} dias ${horas % 24} h`;
}

const nomeEtapa = (chave) => nomesDasEtapas.get(chave) || (chave?.startsWith("OUTRA:") ? chave.slice(6) : chave || "—");

const CORES_DE_CATEGORIA = { triagem: "#8d8f9b", avanco: "#b6923f", sucesso: "#4fb38a", perda: "#d0685a", outra: "#5d6070" };
const corEtapa = (chave) => CORES_DE_CATEGORIA[categoriasDasEtapas.get(chave) || "outra"];

function classeDaTaxa(t) {
  if (t === null || t === undefined) return "text-inkdim";
  return t >= 50 ? "text-positivo" : t >= 25 ? "text-goldbright" : "text-negativo";
}

function dataLocal(iso) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function baixarCSV(nomeDoArquivo, cabecalho, linhas) {
  const celula = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const texto = [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeDoArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

function mostrarErro(mensagem) {
  const el = $("avisoErro");
  el.textContent = mensagem;
  el.classList.toggle("hidden", !mensagem);
}

// Chamada à API. Uma resposta que não seja JSON indica que a sessão do
// Cloudflare Access expirou e a requisição foi redirecionada ao login.
async function chamarApi(caminho, opcoes) {
  let resposta;
  try {
    resposta = await fetch(`${API}${caminho}`, opcoes);
  } catch {
    throw new Error("Não foi possível contatar o servidor. Verifique a conexão e tente novamente.");
  }
  const tipo = resposta.headers.get("Content-Type") || "";
  if (!tipo.includes("application/json")) {
    throw new Error("A sessão expirou. Recarregue a página para entrar novamente.");
  }
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.error || `O servidor respondeu com o código ${resposta.status}.`);
  return corpo;
}

// --- Datas iniciais: do primeiro dia do mês até hoje -------------------------

(function definirPeriodoInicial() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  $("dataInicio").value = `${ano}-${mes}-01`;
  $("dataFim").value = `${ano}-${mes}-${dia}`;
})();

// --- Renderização -----------------------------------------------------------

const escopo = () => dados.escopos[campanhaSelecionada];
const daCampanha = (lista) => (campanhaSelecionada === "TODAS" ? lista : lista.filter((l) => l.campanha === campanhaSelecionada));

const LINHAS_DO_COMPARATIVO = [
  ["Leads recebidos", (e) => numero(e.volume.leadsRecebidos)],
  ["Leads contatados", (e) => numero(e.volume.contatados)],
  ["Com primeira resposta", (e) => numero(e.volume.comPrimeiraResposta)],
  ["Qualificados", (e) => numero(e.volume.qualificados)],
  ["Taxa de qualificação", (e) => percentual(e.taxas.qualificacao), true],
  ["Qualificados sem agendamento", (e) => numero(e.volume.qualificadosSemAgendamento)],
  ["Qualificado para agendado", (e) => percentual(e.taxas.qualificadoParaAgendado), true],
  ["Reuniões marcadas", (e) => numero(e.volume.reunioesMarcadas)],
  ["Reuniões realizadas", (e) => numero(e.volume.reunioesRealizadas)],
  ["Não realizadas (foram para Remarcação)", (e) => numero(e.volume.naoRealizadas)],
  ["Taxa de comparecimento", (e) => percentual(e.taxas.comparecimento), true],
  ["Remarcações recuperadas", (e) => numero(e.volume.remarcacoesRecuperadas)],
  ["Taxa de remarcação recuperada", (e) => percentual(e.taxas.remarcacaoRecuperada), true],
  ["Entradas no Protocolo Farmer", (e) => numero(e.volume.entradasEmFarmer)],
  ["Em reaquecimento (situação atual)", (e) => numero(e.volume.emReaquecimentoAgora)],
  ["Contratos fechados", (e) => numero(e.volume.fechados)],
  ["Reunião para fechamento", (e) => percentual(e.taxas.reuniaoParaFechamento), true],
  ["Conversão final", (e) => percentual(e.taxas.conversaoFinal), true],
  ["Desqualificados", (e) => numero(e.volume.desqualificados)],
];

function colunasDoComparativo() {
  return [...dados.campanhas.map((c) => ({ codigo: c.codigo, titulo: c.codigo, descricao: c.nome })), { codigo: "TODAS", titulo: "Total", descricao: "Três campanhas" }];
}

function renderizarComparativo() {
  const colunas = colunasDoComparativo();
  $("cabecalhoComparativo").innerHTML = `
    <tr class="rotulo text-left">
      <th class="font-semibold">Indicador</th>
      ${colunas.map((c) => `<th class="font-semibold text-right" title="${esc(c.descricao)}">${esc(c.titulo)}</th>`).join("")}
    </tr>`;
  $("corpoComparativo").innerHTML = LINHAS_DO_COMPARATIVO.map(
    ([rotulo, valor, ehTaxa]) => `
    <tr class="${ehTaxa ? "destaque" : ""}">
      <td class="${ehTaxa ? "text-inkdim pl-8 text-xs" : "text-ink"}">${esc(rotulo)}</td>
      ${colunas
        .map((c) => `<td class="text-right tabular ${c.codigo === "TODAS" ? "font-semibold text-ink" : "text-ink/90"} ${ehTaxa ? "text-xs" : ""}">${valor(dados.escopos[c.codigo])}</td>`)
        .join("")}
    </tr>`,
  ).join("");
}

function renderizarSeletorDeCampanha() {
  const opcoes = [{ codigo: "TODAS", nome: "Todas as campanhas" }, ...dados.campanhas];
  const html = opcoes
    .map(
      (c) => `
    <button role="tab" aria-selected="${c.codigo === campanhaSelecionada}" data-campanha="${esc(c.codigo)}"
      class="px-4 py-2 text-xs font-semibold border-b-2 ${c.codigo === campanhaSelecionada ? "aba-ativa" : "border-transparent text-inkdim hover:text-ink"}">
      ${c.codigo === "TODAS" ? "Todas as campanhas" : `${esc(c.codigo)} <span class="font-normal text-inkfaint ml-1">${esc(c.nome)}</span>`}
    </button>`,
    )
    .join("");
  // O mesmo seletor aparece nas duas abas e vale para ambas.
  for (const id of ["seletorCampanha", "seletorCampanhaTrafego"]) {
    $(id).innerHTML = html;
    $(id).querySelectorAll("button").forEach((botao) =>
      botao.addEventListener("click", () => {
        campanhaSelecionada = botao.dataset.campanha;
        renderizarSeletorDeCampanha();
        renderizarEscopo();
        atualizarTrafego();
      }),
    );
  }
}

function cartao(valor, rotulo, detalhe, corDoValor = "text-ink") {
  return `
    <div class="p-5">
      <p class="font-serif text-3xl font-semibold tabular ${corDoValor}">${valor}</p>
      <p class="rotulo mt-2">${esc(rotulo)}</p>
      ${detalhe ? `<p class="text-[11px] text-inkdim mt-2 leading-relaxed">${detalhe}</p>` : ""}
    </div>`;
}

function renderizarCartoes() {
  const { volume: v, taxas: t, etiquetas } = escopo();
  const noShow = etiquetas.noShow.emUso
    ? `${numero(etiquetas.noShow.total)} com a etiqueta NO_SHOW`
    : "Etiqueta NO_SHOW ainda não utilizada";

  $("cartoes").innerHTML = [
    cartao(numero(v.leadsRecebidos), "Leads recebidos", `${numero(v.contatados)} contatados · ${numero(v.comPrimeiraResposta)} com primeira resposta`),
    cartao(numero(v.qualificados), "Qualificados", `Taxa de qualificação: <span class="${classeDaTaxa(t.qualificacao)}">${percentual(t.qualificacao)}</span><br>${numero(v.qualificadosSemAgendamento)} sem agendamento`),
    cartao(numero(v.reunioesMarcadas), "Reuniões marcadas", `${numero(v.reunioesMarcadasNovas)} novas · ${numero(v.remarcacoes)} remarcações<br>Qualificado para agendado: <span class="${classeDaTaxa(t.qualificadoParaAgendado)}">${percentual(t.qualificadoParaAgendado)}</span>`, "text-goldbright"),
    cartao(numero(v.reunioesRealizadas), "Reuniões realizadas", `Comparecimento: <span class="${classeDaTaxa(t.comparecimento)}">${percentual(t.comparecimento)}</span>`, "text-positivo"),
    cartao(numero(v.naoRealizadas), "Não realizadas", `${percentual(t.naoRealizacao)} das marcadas<br>${esc(noShow)}`, "text-negativo"),
    cartao(numero(v.remarcacoesRecuperadas), "Remarcações recuperadas", `De ${numero(v.entradasEmRemarcacao)} entradas em Remarcação: ${percentual(t.remarcacaoRecuperada)}<br>${numero(v.remarcacoesRecuperadasERealizadas)} recuperadas e realizadas`),
    cartao(numero(v.fechados), "Contratos fechados", `Reunião para fechamento: <span class="${classeDaTaxa(t.reuniaoParaFechamento)}">${percentual(t.reuniaoParaFechamento)}</span><br>Conversão final: ${percentual(t.conversaoFinal)}`, "text-positivo"),
    cartao(numero(v.desqualificados), "Desqualificados", `${numero(v.perdidasAntesDaReuniao)} perdidos entre o agendamento e a reunião`),
  ].join("");

  const emAberto = $("avisoEmAberto");
  if (v.reunioesEmAberto > 0) {
    emAberto.textContent =
      `${numero(v.reunioesEmAberto)} reunião(ões) marcada(s) no período ainda sem desfecho registrado (${percentual(t.emAberto)} das marcadas). ` +
      "As taxas de comparecimento e de não realização podem mudar quando esses desfechos forem lançados.";
    emAberto.classList.remove("hidden");
  } else emAberto.classList.add("hidden");

  const fora = $("avisoForaDaBase");
  const total = dados.avisos.eventosDeLeadsForaDaBase;
  const marcacoes = dados.avisos.exclusoesAtivas + dados.avisos.correcoesAtivas;
  const partes = [];
  if (total > 0) partes.push(`${numero(total)} evento(s) do período pertencem a leads que não estão mais na base (excluídos, mesclados ou duplicados por telefone) e não entram nos indicadores.`);
  if (marcacoes > 0) partes.push(`Há ${numero(dados.avisos.exclusoesAtivas)} evento(s) excluído(s) do cálculo e ${numero(dados.avisos.correcoesAtivas)} corrigido(s) manualmente.`);
  fora.textContent = partes.join(" ");
  fora.classList.toggle("hidden", !partes.length);
}

function renderizarBarras(idDoContainer, contagem, detalhe) {
  const itens = dados.etapas.map((e) => ({ chave: e.chave, total: contagem[e.chave] || 0 })).filter((i) => i.total > 0 || categoriasDasEtapas.get(i.chave) !== "outra");
  const maximo = Math.max(...itens.map((i) => i.total), 1);
  $(idDoContainer).innerHTML = itens.length
    ? itens
        .map(
          (i) => `
      <div class="flex items-center gap-3">
        <div class="w-44 shrink-0 text-[11px] text-inkdim text-right truncate" title="${esc(nomeEtapa(i.chave))}">${esc(nomeEtapa(i.chave))}</div>
        <div class="flex-1 h-3.5 bg-surface2"><div class="barra h-full" style="width:${(i.total / maximo) * 100}%;background:${corEtapa(i.chave)}"></div></div>
        <div class="w-24 shrink-0 text-sm tabular text-ink">${numero(i.total)}${detalhe ? `<span class="text-[10px] text-inkfaint ml-2">${detalhe(i.chave)}</span>` : ""}</div>
      </div>`,
        )
        .join("")
    : '<p class="text-xs text-inkdim">Sem dados no período.</p>';
}

function renderizarFunil() {
  const e = escopo();
  renderizarBarras("graficoEntradas", e.entradasPorEtapa);
  renderizarBarras("graficoVolume", e.volumeAtual, (chave) => (e.tempoMedioPorEtapa[chave] !== undefined ? `${e.tempoMedioPorEtapa[chave]} d` : ""));
}

function renderizarTempos() {
  const t = escopo().tempos;
  const bloco = (titulo, descricao, r) => `
    <div class="p-5">
      <p class="font-serif text-2xl font-semibold tabular text-ink">${duracao(r.medianaSeg)}</p>
      <p class="rotulo mt-2">${esc(titulo)}</p>
      <p class="text-[11px] text-inkdim mt-2 leading-relaxed">${esc(descricao)}<br>
        Mediana de ${numero(r.amostras)} lead(s) · média: ${duracao(r.mediaSeg)}</p>
    </div>`;
  $("cartoesTempos").innerHTML = [
    bloco("Da entrada à primeira mensagem", "Da criação do lead até a mudança para Contato Iniciado.", t.atePrimeiraMensagem),
    bloco("Até a primeira resposta", "De Contato Iniciado até a entrada em Em Qualificação.", t.atePrimeiraResposta),
    bloco("Da qualificação ao agendamento", "Da qualificação até a primeira entrada em Agendado.", t.daQualificacaoAoAgendamento),
  ].join("");
}

function linhaDeConversao(origem, destino, taxa, rodape) {
  const largura = taxa === null ? 0 : Math.min(taxa, 100);
  const cor = taxa === null ? "#5d6070" : taxa >= 50 ? "#4fb38a" : taxa >= 25 ? "#b6923f" : "#d0685a";
  return `
    <div class="py-2 border-b border-line last:border-0">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-ink truncate">${origem ? `${esc(origem)} <span class="text-inkfaint">para</span> ` : ""}${esc(destino)}</span>
        <span class="${classeDaTaxa(taxa)} font-semibold tabular shrink-0">${percentual(taxa)}</span>
      </div>
      <div class="h-px bg-line mt-1.5"><div class="barra h-px" style="width:${largura}%;background:${cor}"></div></div>
      <p class="text-[10px] text-inkfaint mt-1 tabular">${rodape}</p>
    </div>`;
}

function renderizarDestinos() {
  const e = escopo();
  const origem = $("seletorOrigem").value;
  const lista = e.destinosPorEtapa[origem] || [];
  $("destinos").innerHTML = lista.length
    ? `<p class="text-[10px] text-inkfaint mb-1">${numero(e.saidasPorEtapa[origem] || 0)} lead(s) saíram desta etapa no período.</p>` +
      lista.map((d) => linhaDeConversao("", nomeEtapa(d.destino), d.taxa, `${numero(d.total)} lead(s)`)).join("")
    : '<p class="text-xs text-inkdim">Nenhuma saída registrada no período.</p>';
}

function renderizarConversao() {
  const e = escopo();
  $("conversaoAmpla").innerHTML = e.conversaoAmpla
    .map((c) => linhaDeConversao(nomeEtapa(c.origem), nomeEtapa(c.destino), c.taxa, `${numero(c.chegaram)} de ${numero(c.entraram)} lead(s)`))
    .join("");
  $("conversaoEntreEtapas").innerHTML = e.conversaoEntreEtapas.length
    ? e.conversaoEntreEtapas
        .slice(0, 8)
        .map((c) => linhaDeConversao(nomeEtapa(c.origem), nomeEtapa(c.destino), c.taxa, `${numero(c.total)} lead(s) · percentual sobre as saídas da origem`))
        .join("")
    : '<p class="text-xs text-inkdim">Sem movimentações no período.</p>';

  const seletor = $("seletorOrigem");
  const origens = dados.etapas.map((x) => x.chave).filter((chave) => e.destinosPorEtapa[chave]);
  const anterior = seletor.value;
  seletor.innerHTML = origens.length
    ? origens.map((chave) => `<option value="${esc(chave)}">${esc(nomeEtapa(chave))}</option>`).join("")
    : '<option value="">Sem dados</option>';
  if (origens.includes(anterior)) seletor.value = anterior;
  renderizarDestinos();
}

function listaComBarras(itens, rotuloDe, vazio) {
  if (!itens.length) return `<p class="text-xs text-inkdim">${esc(vazio)}</p>`;
  const maximo = Math.max(...itens.map((i) => i.total), 1);
  return itens
    .map(
      (i) => `
    <div>
      <div class="flex justify-between gap-2"><span class="text-ink truncate">${esc(rotuloDe(i))}</span><span class="tabular text-inkdim shrink-0">${numero(i.total)}</span></div>
      <div class="h-px bg-line mt-1.5"><div class="barra h-px bg-gold" style="width:${(i.total / maximo) * 100}%"></div></div>
    </div>`,
    )
    .join("");
}

function renderizarPerdas() {
  const e = escopo();
  $("motivos").innerHTML = listaComBarras(e.desqualificadosPorMotivo, (i) => i.motivo, "Nenhum lead desqualificado no período.");
  $("etiquetasFrequentes").innerHTML = listaComBarras(e.etiquetasMaisFrequentes, (i) => i.tag, "Nenhuma etiqueta na base.");

  const linhas = [
    ["Reuniões confirmadas pelo lead", "CONFIRMOU_REUNIAO", e.etiquetas.confirmadas],
    ["Propostas enviadas", "PROPOSTA_ENVIADA", e.etiquetas.propostasEnviadas],
    ["Qualificados enviados ao TinTin/Meta", "TINTIN_QUALIFICADO_ENVIADO", e.etiquetas.qualificadosEnviadosAoTintin],
    ["Fechados enviados ao TinTin/Meta", "TINTIN_FECHADO_ENVIADO", e.etiquetas.fechadosEnviadosAoTintin],
  ];
  $("porEtiqueta").innerHTML = linhas
    .map(
      ([rotulo, etiqueta, r]) => `
    <div class="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
      <div class="min-w-0"><p class="text-ink">${esc(rotulo)}</p><p class="text-[10px] text-inkfaint font-mono">${esc(etiqueta)}</p></div>
      ${r.emUso ? `<span class="font-serif text-lg font-semibold tabular text-ink">${numero(r.total)}</span>` : '<span class="text-[10px] text-inkfaint text-right">etiqueta ainda<br>não utilizada</span>'}
    </div>`,
    )
    .join("");
}

function itemDeLista(principal, secundario, direita) {
  return `
    <div class="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
      <div class="min-w-0"><p class="text-ink truncate">${principal}</p><p class="text-[10px] text-inkfaint">${secundario}</p></div>
      <span class="text-[11px] tabular text-goldbright shrink-0">${direita}</span>
    </div>`;
}

const LIMITE_DE_ITENS = 40;

function renderizarPendencias() {
  const parados = daCampanha(dados.listas.leadsParados);
  $("totalParados").textContent = numero(parados.length);
  $("listaParados").innerHTML = parados.length
    ? parados.slice(0, LIMITE_DE_ITENS).map((l) => itemDeLista(esc(l.nome), `${esc(l.campanha)} · ${esc(nomeEtapa(l.etapaAtual))}`, `${numero(l.diasParado)} dias`)).join("") +
      (parados.length > LIMITE_DE_ITENS ? `<p class="text-[10px] text-inkfaint pt-2">Mais ${numero(parados.length - LIMITE_DE_ITENS)} no arquivo CSV.</p>` : "")
    : '<p class="text-xs text-inkdim">Nenhum lead ativo parado.</p>';

  const emAberto = daCampanha(dados.listas.reunioesEmAberto);
  $("totalEmAberto").textContent = numero(emAberto.length);
  $("listaEmAberto").innerHTML = emAberto.length
    ? emAberto.slice(0, LIMITE_DE_ITENS).map((l) => itemDeLista(esc(l.nome), `${esc(l.campanha)} · agendada em ${dataLocal(l.agendadoEm)}`, `${numero(l.diasAguardando)} dias`)).join("")
    : '<p class="text-xs text-inkdim">Todas as reuniões marcadas no período têm desfecho registrado.</p>';
}

function leadsFiltrados() {
  const termo = $("buscaLeads").value.trim().toLowerCase();
  return daCampanha(dados.listas.leadsDoPeriodo).filter(
    (l) =>
      !termo ||
      l.nome.toLowerCase().includes(termo) ||
      l.telefone.includes(termo) ||
      nomeEtapa(l.etapaNoPeriodo).toLowerCase().includes(termo) ||
      nomeEtapa(l.etapaAtual).toLowerCase().includes(termo),
  );
}

function renderizarLeads() {
  const leads = leadsFiltrados();
  $("totalLeads").textContent = numero(leads.length);
  $("corpoLeads").innerHTML = leads.length
    ? leads
        .slice(0, 500)
        .map((l) => {
          const cor = corEtapa(l.etapaNoPeriodo);
          const avancou = l.etapaAtual !== l.etapaNoPeriodo;
          return `
        <tr>
          <td class="px-4 py-2.5 max-w-[220px] truncate ${l.semNome ? "text-negativo" : "text-ink"}" title="${esc(l.nome)}">${esc(l.nome)}</td>
          <td class="px-4 py-2.5 text-xs font-mono ${l.telefone ? "text-inkdim" : "text-negativo"}">${esc(l.telefone || "sem telefone")}</td>
          <td class="px-4 py-2.5 text-xs text-inkdim">${esc(l.campanha)}</td>
          <td class="px-4 py-2.5">
            <span class="text-[11px] font-semibold px-2 py-0.5" style="color:${cor};border:1px solid ${cor}55">${esc(nomeEtapa(l.etapaNoPeriodo))}</span>
            ${avancou ? `<div class="text-[10px] text-inkfaint mt-1">atualmente em ${esc(nomeEtapa(l.etapaAtual))}</div>` : ""}
          </td>
          <td class="px-4 py-2.5 text-[10px] text-inkdim font-mono">${l.tags.length ? l.tags.map(esc).join(", ") : "—"}</td>
          <td class="px-4 py-2.5 text-right text-xs text-inkdim tabular">${l.atualizadoEm ? new Date(l.atualizadoEm * 1000).toLocaleDateString("pt-BR") : "—"}</td>
        </tr>`;
        })
        .join("") +
      (leads.length > 500 ? `<tr><td colspan="6" class="px-4 py-3 text-xs text-inkfaint">Exibindo 500 de ${numero(leads.length)}. Use a busca ou exporte o CSV para ver todos.</td></tr>` : "")
    : '<tr><td colspan="6" class="px-4 py-8 text-center text-inkdim text-xs">Nenhum lead movimentado no período.</td></tr>';
}

function renderizarEscopo() {
  renderizarCartoes();
  renderizarFunil();
  renderizarTempos();
  renderizarConversao();
  renderizarPerdas();
  renderizarPendencias();
  renderizarLeads();
}

function renderizarTudo() {
  nomesDasEtapas = new Map(dados.etapas.map((e) => [e.chave, e.nome]));
  categoriasDasEtapas = new Map(dados.etapas.map((e) => [e.chave, e.categoria]));

  const pendencias = dados.mapeamento.pendencias || [];
  $("avisoMapeamento").classList.toggle("hidden", dados.mapeamento.completo);
  $("listaPendencias").innerHTML = pendencias.map((p) => `<li>${esc(p)}</li>`).join("");

  renderizarComparativo();
  renderizarSeletorDeCampanha();
  renderizarEscopo();
  $("ultimaAtualizacao").textContent = new Date(dados.geradoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// --- Carga dos dados ---------------------------------------------------------

let carregando = false;

async function atualizar() {
  if (carregando) return;
  const inicio = $("dataInicio").value;
  const fim = $("dataFim").value;
  if (!inicio || !fim || fim < inicio) {
    mostrarErro("Informe um período válido: a data final não pode ser anterior à inicial.");
    return;
  }

  carregando = true;
  const botao = $("btnFiltrar");
  botao.disabled = true;
  botao.textContent = "Carregando";
  const aviso = setTimeout(() => $("avisoServidor").classList.remove("hidden"), ESPERA_PARA_AVISO_DE_INICIALIZACAO_MS);

  try {
    dados = await chamarApi(`/metrics?inicio=${inicio}&fim=${fim}`);
    mostrarErro("");
    renderizarTudo();
    atualizarTrafego();
  } catch (erro) {
    mostrarErro(`${erro.message}${dados ? " Os números exibidos são da última consulta bem-sucedida." : ""}`);
  } finally {
    clearTimeout(aviso);
    $("avisoServidor").classList.add("hidden");
    botao.disabled = false;
    botao.textContent = "Aplicar";
    carregando = false;
  }
}

// --- Exportações -------------------------------------------------------------

const sufixoDoPeriodo = () => `${$("dataInicio").value}_${$("dataFim").value}`;

function exportarComparativo() {
  if (!dados) return;
  const colunas = colunasDoComparativo();
  baixarCSV(
    `comparativo_${sufixoDoPeriodo()}.csv`,
    ["Indicador", ...colunas.map((c) => c.titulo)],
    LINHAS_DO_COMPARATIVO.map(([rotulo, valor]) => [rotulo, ...colunas.map((c) => valor(dados.escopos[c.codigo]))]),
  );
}

function exportarLeads() {
  if (!dados) return;
  baixarCSV(
    `leads_${sufixoDoPeriodo()}.csv`,
    ["ID", "Nome", "Telefone", "Campanha", "Etapa no período", "Etapa atual", "Etiquetas", "Última atualização"],
    leadsFiltrados().map((l) => [l.id, l.nome, l.telefone, l.campanha, nomeEtapa(l.etapaNoPeriodo), nomeEtapa(l.etapaAtual), l.tags.join(", "), l.atualizadoEm ? new Date(l.atualizadoEm * 1000).toLocaleDateString("pt-BR") : ""]),
  );
}

function exportarParados() {
  if (!dados) return;
  baixarCSV(
    `leads_parados_${new Date().toISOString().slice(0, 10)}.csv`,
    ["ID", "Nome", "Telefone", "Campanha", "Etapa atual", "Dias sem movimentação"],
    daCampanha(dados.listas.leadsParados).map((l) => [l.id, l.nome, l.telefone, l.campanha, nomeEtapa(l.etapaAtual), l.diasParado]),
  );
}

function exportarEmAberto() {
  if (!dados) return;
  baixarCSV(
    `reunioes_em_aberto_${new Date().toISOString().slice(0, 10)}.csv`,
    ["ID", "Nome", "Telefone", "Campanha", "Agendada em", "Dias aguardando"],
    daCampanha(dados.listas.reunioesEmAberto).map((l) => [l.id, l.nome, l.telefone, l.campanha, dataLocal(l.agendadoEm), l.diasAguardando]),
  );
}

function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// Histórico em HTML: tabela autocontida, com filtro, em estilo claro para
// leitura e impressão fora do painel.
function historicoEmHTML(cabecalho, linhas, inicio, fim) {
  const iExcluido = cabecalho.indexOf("Excluído do cálculo");
  const iCorrigido = cabecalho.indexOf("Corrigido");
  const iEstimada = cabecalho.indexOf("Chegada estimada");
  const corpo = linhas
    .map((linha) => {
      const celulas = linha
        .map((v, i) => {
          const alerta = i === iExcluido && v === "Sim" ? ' class="alerta"' : (i === iCorrigido || i === iEstimada) && v === "Sim" ? ' class="aviso"' : "";
          return `<td${alerta}>${esc(v)}</td>`;
        })
        .join("");
      return `<tr${linha[iExcluido] === "Sim" ? ' class="excluida"' : ""}>${celulas}</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Histórico de movimentações - ${inicio} a ${fim}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f5; color: #1a1a1a; }
  h1 { font-size: 18px; color: #0f1b2d; margin: 0 0 4px; }
  p.sub { font-size: 12px; color: #666; margin: 0 0 18px; }
  input { padding: 6px 10px; font-size: 13px; border: 1px solid #d5d5d5; width: 300px; margin-bottom: 12px; }
  .rolagem { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 12.5px; }
  th, td { border: 1px solid #e2e2e2; padding: 6px 10px; text-align: left; white-space: nowrap; }
  thead th { position: sticky; top: 0; background: #0f1b2d; color: #fff; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tr.excluida { opacity: 0.55; font-style: italic; }
  td.alerta { color: #b3261e; font-weight: 600; }
  td.aviso { color: #8a6d00; font-weight: 600; }
  p.contador { font-size: 12px; color: #666; margin-top: 10px; }
</style>
</head>
<body>
  <h1>Histórico completo de movimentações</h1>
  <p class="sub">Robson Menezes Advogados · Núcleo de Saúde · Período: ${inicio} a ${fim} · Gerado em ${new Date().toLocaleString("pt-BR")}</p>
  <input type="search" id="filtro" placeholder="Filtrar por nome, etapa, campanha" aria-label="Filtrar">
  <div class="rolagem">
    <table>
      <thead><tr>${cabecalho.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>
${corpo}
      </tbody>
    </table>
  </div>
  <p class="contador" id="contador"></p>
  <script>
    var filtro = document.getElementById("filtro");
    var linhas = Array.prototype.slice.call(document.querySelectorAll("tbody tr"));
    var contador = document.getElementById("contador");
    function contar() {
      var visiveis = linhas.filter(function (l) { return l.style.display !== "none"; }).length;
      contador.textContent = visiveis + " de " + linhas.length + " linhas exibidas";
    }
    filtro.addEventListener("input", function () {
      var termo = filtro.value.toLowerCase();
      linhas.forEach(function (l) { l.style.display = l.textContent.toLowerCase().indexOf(termo) >= 0 ? "" : "none"; });
      contar();
    });
    contar();
  <\/script>
</body>
</html>`;
}

// formato: "csv" ou "html". As colunas de campanha, conjunto e anúncio entram
// conforme a opção marcada no menu.
async function exportarHistorico(formato) {
  const botao = $("btnExportarHistorico");
  const rotulo = botao.textContent;
  const inicio = $("dataInicio").value;
  const fim = $("dataFim").value;
  const comCampanha = $("incluirCampanha").checked;
  botao.disabled = true;
  botao.textContent = "Gerando";
  try {
    const r = await chamarApi(`/historico-completo?inicio=${inicio}&fim=${fim}`);
    if (!r.historico.length) {
      mostrarErro("Nenhuma movimentação encontrada no período para exportar.");
      return;
    }
    const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "");
    const simNao = (v) => (v ? "Sim" : "Não");
    const cabecalho = ["ID do lead", "Nome", "Telefone", "Campanha", "Data", "Etapa de origem", "Etapa de destino", "Corrigido", "Motivo da correção", "Excluído do cálculo", "Motivo da exclusão", "Criação do lead", "Chegada em Contato Inicial", "Chegada estimada", "Etiquetas", "Motivo de perda"];
    if (comCampanha) cabecalho.push("Campanha Meta", "Conjunto de anúncios", "Anúncio");
    const linhas = r.historico.map((h) => {
      const linha = [h.leadId, h.nome, h.telefone, h.campanha, dataHora(h.data), h.etapaOrigem, h.etapaDestino, simNao(h.corrigido), h.motivoCorrecao, simNao(h.excluidoDoCalculo), h.motivoExclusao, dataHora(h.dataCriacaoLead), dataHora(h.chegadaContatoInicial), simNao(h.chegadaContatoInicialEstimada), h.tags, h.motivoPerda];
      if (comCampanha) linha.push(h.campanhaMeta, h.conjunto, h.anuncio);
      return linha;
    });
    if (formato === "html") {
      baixarArquivo(`historico_completo_${sufixoDoPeriodo()}.html`, historicoEmHTML(cabecalho, linhas, inicio, fim), "text/html;charset=utf-8;");
    } else {
      baixarCSV(`historico_completo_${sufixoDoPeriodo()}.csv`, cabecalho, linhas);
    }
    mostrarErro("");
  } catch (erro) {
    mostrarErro(erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

// --- Correção de movimentação indevida ----------------------------------------

const modal = $("modalCorrecao");
let etapasParaCorrecao = null;

function abrirModal() {
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  $("leadIdCorrecao").value = "";
  $("eventosCorrecao").innerHTML = "";
  $("leadIdCorrecao").focus();
}

function fecharModal() {
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

// Converte uma data ISO para o formato do campo datetime-local, no horário do navegador.
function paraCampoDeDataHora(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function buscarEventos() {
  const leadId = $("leadIdCorrecao").value.trim();
  const container = $("eventosCorrecao");
  if (!/^\d+$/.test(leadId)) {
    container.innerHTML = '<p class="text-negativo">Informe o ID numérico do lead, visível no endereço do cartão no Kommo.</p>';
    return;
  }
  container.innerHTML = '<p class="text-inkdim">Buscando.</p>';
  try {
    if (!etapasParaCorrecao) etapasParaCorrecao = (await chamarApi("/etapas")).etapas;
    const { eventos } = await chamarApi(`/eventos-lead/${leadId}`);
    if (!eventos.length) {
      container.innerHTML = '<p class="text-inkdim">Nenhuma mudança de etapa encontrada para este lead.</p>';
      return;
    }
    const opcoes = (selecionada) => etapasParaCorrecao.map((e) => `<option value="${esc(e.chave)}" ${e.chave === selecionada ? "selected" : ""}>${esc(e.nome)}</option>`).join("");
    const botaoSecundario = "border border-line hover:border-gold/60 text-inkdim hover:text-ink text-[11px] font-semibold px-3 py-1.5";

    container.innerHTML = eventos
      .map(
        (ev) => `
      <div class="border border-line ${ev.jaExcluido ? "opacity-60" : ""}">
        <div class="flex items-center justify-between gap-2 px-3 py-2">
          <div class="min-w-0">
            <p class="text-ink truncate">${esc(ev.deNome || "(criação)")} <span class="text-inkfaint">para</span> ${esc(ev.paraNome)}
              ${ev.jaCorrigido ? '<span class="text-goldbright text-[10px] font-semibold ml-1">corrigido</span>' : ""}
              ${ev.jaExcluido ? '<span class="text-negativo text-[10px] font-semibold ml-1">excluído do cálculo</span>' : ""}</p>
            ${ev.jaCorrigido ? `<p class="text-inkfaint text-[10px]">Registro original: ${esc(ev.deOriginalNome)} para ${esc(ev.paraOriginalNome)}, em ${new Date(ev.dataOriginal).toLocaleString("pt-BR")}</p>` : ""}
            <p class="text-inkfaint text-[10px] tabular">${new Date(ev.dataEfetiva).toLocaleString("pt-BR")}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${
              ev.jaExcluido
                ? `<button data-acao="reverter-exclusao" data-id="${esc(ev.eventId)}" class="${botaoSecundario}">Reverter exclusão</button>`
                : ev.jaCorrigido
                  ? `<button data-acao="reverter-correcao" data-id="${esc(ev.eventId)}" class="${botaoSecundario}">Reverter correção</button>`
                  : `<button data-acao="editar" data-id="${esc(ev.eventId)}" class="${botaoSecundario}">Ajustar</button>
                     <button data-acao="excluir" data-id="${esc(ev.eventId)}" class="border border-negativo/40 hover:bg-negativo/10 text-negativo text-[11px] font-semibold px-3 py-1.5">Excluir do cálculo</button>`
            }
          </div>
        </div>
        <div class="hidden px-3 pb-3 space-y-2" data-formulario="${esc(ev.eventId)}">
          <div class="grid grid-cols-2 gap-2">
            <label class="block"><span class="text-inkfaint text-[10px]">Etapa de origem</span>
              <select class="campo-origem w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">${opcoes(ev.de)}</select></label>
            <label class="block"><span class="text-inkfaint text-[10px]">Etapa de destino</span>
              <select class="campo-destino w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink">${opcoes(ev.para)}</select></label>
          </div>
          <label class="block"><span class="text-inkfaint text-[10px]">Data e hora em que a mudança ocorreu</span>
            <input type="datetime-local" class="campo-data w-full bg-surface2 border border-line px-2 py-1.5 text-xs text-ink" value="${paraCampoDeDataHora(ev.dataEfetiva)}"></label>
          <div class="flex gap-2 justify-end">
            <button data-acao="cancelar" data-id="${esc(ev.eventId)}" class="text-inkdim hover:text-ink text-[11px] px-3 py-1.5">Cancelar</button>
            <button data-acao="salvar" data-id="${esc(ev.eventId)}" class="bg-gold hover:bg-goldbright text-bg text-[11px] font-bold px-3 py-1.5">Salvar correção</button>
          </div>
        </div>
      </div>`,
      )
      .join("");
  } catch (erro) {
    container.innerHTML = `<p class="text-negativo">${esc(erro.message)}</p>`;
  }
}

async function executarAcaoDeCorrecao(acao, eventId) {
  const formulario = document.querySelector(`[data-formulario="${CSS.escape(eventId)}"]`);
  const json = { "Content-Type": "application/json" };
  try {
    if (acao === "editar") return formulario.classList.remove("hidden");
    if (acao === "cancelar") return formulario.classList.add("hidden");
    if (acao === "excluir") {
      if (!confirm("Confirma que esta movimentação foi um engano e deve ser desconsiderada nos indicadores?")) return;
      await chamarApi("/excluir-evento", { method: "POST", headers: json, body: JSON.stringify({ eventId }) });
    } else if (acao === "reverter-exclusao") {
      await chamarApi(`/excluir-evento/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    } else if (acao === "reverter-correcao") {
      if (!confirm("Reverter esta correção? O evento volta a valer com a etapa e o horário originais do Kommo.")) return;
      await chamarApi(`/corrigir-evento/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    } else if (acao === "salvar") {
      const dataHora = formulario.querySelector(".campo-data").value;
      if (!dataHora) return alert("Informe a data e a hora em que a mudança ocorreu.");
      const corpo = {
        eventId,
        novaEtapaOrigem: formulario.querySelector(".campo-origem").value,
        novaEtapaDestino: formulario.querySelector(".campo-destino").value,
        novaDataHora: new Date(dataHora).toISOString(),
      };
      if (!confirm(`Confirma a correção para ${nomeEtapa(corpo.novaEtapaOrigem)} para ${nomeEtapa(corpo.novaEtapaDestino)}, em ${new Date(corpo.novaDataHora).toLocaleString("pt-BR")}?`)) return;
      await chamarApi("/corrigir-evento", { method: "POST", headers: json, body: JSON.stringify(corpo) });
    }
    await buscarEventos();
    atualizar();
  } catch (erro) {
    alert(`Não foi possível concluir a operação. ${erro.message}`);
  }
}

// --- Eventos da página ---------------------------------------------------------

$("btnFiltrar").addEventListener("click", atualizar);
$("seletorOrigem").addEventListener("change", renderizarDestinos);
$("buscaLeads").addEventListener("input", () => dados && renderizarLeads());
$("btnExportarComparativo").addEventListener("click", exportarComparativo);
$("btnExportarLeads").addEventListener("click", exportarLeads);
$("btnExportarParados").addEventListener("click", exportarParados);
$("btnExportarEmAberto").addEventListener("click", exportarEmAberto);
$("btnExportarHistorico").addEventListener("click", (e) => {
  e.stopPropagation();
  $("menuHistorico").classList.toggle("hidden");
});
$("menuHistorico").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => $("menuHistorico").classList.add("hidden"));
$("btnHistoricoCSV").addEventListener("click", () => {
  $("menuHistorico").classList.add("hidden");
  exportarHistorico("csv");
});
$("btnHistoricoHTML").addEventListener("click", () => {
  $("menuHistorico").classList.add("hidden");
  exportarHistorico("html");
});

// Abas
let abaAtiva = "funil";
function mostrarAba(aba) {
  abaAtiva = aba;
  const trafego = aba === "trafego";
  $("abaFunil").classList.toggle("hidden", trafego);
  $("abaTrafego").classList.toggle("hidden", !trafego);
  for (const [id, ativa] of [["abaBotaoFunil", !trafego], ["abaBotaoTrafego", trafego]]) {
    $(id).setAttribute("aria-selected", String(ativa));
    $(id).className = `px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 ${ativa ? "aba-ativa" : "border-transparent text-inkdim hover:text-ink"}`;
  }
  if (trafego) atualizarTrafego();
}
$("abaBotaoFunil").addEventListener("click", () => mostrarAba("funil"));
$("abaBotaoTrafego").addEventListener("click", () => mostrarAba("trafego"));

$("btnAbrirCorrecao").addEventListener("click", abrirModal);
$("btnFecharCorrecao").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => e.target === modal && fecharModal());
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  fecharModal();
  fecharModaisDeTrafego();
});
$("btnBuscarEventos").addEventListener("click", buscarEventos);
$("leadIdCorrecao").addEventListener("keydown", (e) => e.key === "Enter" && buscarEventos());
$("eventosCorrecao").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-acao]");
  if (botao) executarAcaoDeCorrecao(botao.dataset.acao, botao.dataset.id);
});

// Atualização automática, suspensa enquanto a aba não está visível.
setInterval(() => document.visibilityState === "visible" && atualizar(), INTERVALO_DE_ATUALIZACAO_MS);
document.addEventListener("visibilitychange", () => {
  const desatualizado = !dados || Date.now() - new Date(dados.geradoEm).getTime() > INTERVALO_DE_ATUALIZACAO_MS;
  if (document.visibilityState === "visible" && desatualizado) atualizar();
});

// A primeira carga aguarda todos os scripts da página (trafego.js vem depois).
window.addEventListener("DOMContentLoaded", atualizar);
