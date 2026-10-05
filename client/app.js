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

// Tempo medido em horas úteis: não é convertido em dias, porque um dia de
// expediente tem dez horas, e não vinte e quatro.
function duracaoUtil(segundos) {
  if (segundos === null || segundos === undefined) return "—";
  const minutos = Math.round(segundos / 60);
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
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

// [rótulo, valor numérico do indicador, é taxa?]
const LINHAS_DO_COMPARATIVO = [
  ["Leads recebidos", (e) => e.volume.leadsRecebidos],
  ["Leads contatados", (e) => e.volume.contatados],
  ["Com primeira resposta", (e) => e.volume.comPrimeiraResposta],
  ["Qualificados", (e) => e.volume.qualificados],
  ["Taxa de qualificação", (e) => e.taxas.qualificacao, true],
  ["Qualificados sem agendamento", (e) => e.volume.qualificadosSemAgendamento],
  ["Qualificado para agendado", (e) => e.taxas.qualificadoParaAgendado, true],
  ["Reuniões marcadas", (e) => e.volume.reunioesMarcadas],
  ["Reuniões realizadas", (e) => e.volume.reunioesRealizadas],
  ["Não realizadas (foram para Remarcação)", (e) => e.volume.naoRealizadas],
  ["Taxa de comparecimento", (e) => e.taxas.comparecimento, true],
  ["Remarcações recuperadas", (e) => e.volume.remarcacoesRecuperadas],
  ["Taxa de remarcação recuperada", (e) => e.taxas.remarcacaoRecuperada, true],
  ["Entradas no Protocolo Farmer", (e) => e.volume.entradasEmFarmer],
  ["Em reaquecimento (situação atual)", (e) => e.volume.emReaquecimentoAgora],
  ["Contratos fechados", (e) => e.volume.fechados],
  ["Reunião para fechamento", (e) => e.taxas.reuniaoParaFechamento, true],
  ["Conversão final", (e) => e.taxas.conversaoFinal, true],
  ["Desqualificados", (e) => e.volume.desqualificados],
];

const formatarIndicador = ([, valor, ehTaxa], e) => (ehTaxa ? percentual(valor(e)) : numero(valor(e)));

// Cor e traço de cada campanha nos gráficos. O traço diferencia as séries
// também para quem não distingue as cores.
const ESTILO_DE_CAMPANHA = [
  { cor: "#b6923f", traco: "" },
  { cor: "#6ea8d8", traco: "7,3" },
  { cor: "#4fb38a", traco: "2,3" },
];
const estiloDaCampanha = (codigo) => ESTILO_DE_CAMPANHA[Math.max(dados.campanhas.findIndex((c) => c.codigo === codigo), 0) % ESTILO_DE_CAMPANHA.length];

function colunasDoComparativo() {
  return [...dados.campanhas.map((c) => ({ codigo: c.codigo, titulo: c.codigo, descricao: c.nome })), { codigo: "TODAS", titulo: "Total", descricao: "Três campanhas" }];
}

function renderizarComparativo() {
  const modo = $("modoComparativo").value;
  $("tabelaComparativo").classList.toggle("hidden", modo !== "tabela");
  $("graficoComparativo").classList.toggle("hidden", modo === "tabela");
  if (modo === "grafico") return renderizarComparativoEmGrafico();
  if (modo === "funil") return renderizarFunilLadoALado();

  const colunas = colunasDoComparativo();
  $("cabecalhoComparativo").innerHTML = `
    <tr class="rotulo text-left">
      <th class="font-semibold">Indicador</th>
      ${colunas.map((c) => `<th class="font-semibold text-right" title="${esc(c.descricao)}">${esc(c.titulo)}</th>`).join("")}
    </tr>`;
  $("corpoComparativo").innerHTML = LINHAS_DO_COMPARATIVO.map(
    (linha) => `
    <tr class="${linha[2] ? "destaque" : ""}">
      <td class="${linha[2] ? "text-inkdim pl-8 text-xs" : "text-ink"}">${esc(linha[0])}</td>
      ${colunas
        .map((c) => `<td class="text-right tabular ${c.codigo === "TODAS" ? "font-semibold text-ink" : "text-ink/90"} ${linha[2] ? "text-xs" : ""}">${formatarIndicador(linha, dados.escopos[c.codigo])}</td>`)
        .join("")}
    </tr>`,
  ).join("");
}

// Funil lado a lado: os cinco marcos do caminho do lead em cada campanha, com
// a barra proporcional aos leads recebidos e a conversão em relação ao marco
// anterior.
const MARCOS_DO_FUNIL = [
  ["Leads recebidos", "leadsRecebidos"],
  ["Qualificados", "qualificados"],
  ["Reuniões marcadas", "reunioesMarcadas"],
  ["Reuniões realizadas", "reunioesRealizadas"],
  ["Contratos fechados", "fechados"],
];

function renderizarFunilLadoALado() {
  const colunas = [...dados.campanhas.map((c) => ({ codigo: c.codigo, titulo: c.codigo, nome: c.nome, cor: estiloDaCampanha(c.codigo).cor })), { codigo: "TODAS", titulo: "Total", nome: "Três campanhas", cor: "#d8b565" }];
  $("graficoComparativo").innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
      ${colunas
        .map((c) => {
          const v = dados.escopos[c.codigo].volume;
          const valores = MARCOS_DO_FUNIL.map(([, chave]) => v[chave]);
          const maximo = Math.max(...valores, 1);
          return `
        <div>
          <p class="font-serif text-base font-semibold text-ink">${esc(c.titulo)}</p>
          <p class="text-[11px] text-inkfaint mb-3">${esc(c.nome)}</p>
          ${MARCOS_DO_FUNIL.map(([rotulo], i) => {
            const anterior = i > 0 ? valores[i - 1] : null;
            const conversao = anterior ? Math.round((valores[i] / anterior) * 1000) / 10 : null;
            return `
            <div class="mb-2.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11px] text-inkdim">${rotulo}</span>
                <span class="text-[10px] text-inkfaint tabular">${i > 0 ? `${percentual(conversao)} do anterior` : ""}</span>
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <div class="flex-1 h-6 bg-surface2 flex justify-center"><div class="barra h-full" style="width:${(valores[i] / maximo) * 100}%;background:${c.cor}"></div></div>
                <span class="w-10 font-serif text-lg font-semibold tabular text-ink text-right">${numero(valores[i])}</span>
              </div>
            </div>`;
          }).join("")}
          <p class="text-[11px] text-inkdim mt-3">Conversão final: <span class="text-ink font-semibold">${percentual(dados.escopos[c.codigo].taxas.conversaoFinal)}</span></p>
        </div>`;
        })
        .join("")}
    </div>
    <p class="text-[10px] text-inkfaint mt-4">Cada barra é proporcional ao maior valor da própria campanha. Os números são fatos do período, não o mesmo grupo de leads: uma etapa pode superar a anterior quando há leads recebidos antes do período.</p>`;
}

// Comparativo em gráfico: para cada indicador, uma barra por campanha. Nos
// volumes, a escala é a do próprio indicador; nas taxas, vai de 0 a 100%.
function renderizarComparativoEmGrafico() {
  const bloco = (linha) => {
    const [rotulo, valor, ehTaxa] = linha;
    const valores = dados.campanhas.map((c) => valor(dados.escopos[c.codigo]));
    const maximo = ehTaxa ? 100 : Math.max(...valores, 1);
    return `
      <div>
        <div class="flex items-baseline justify-between gap-2 mb-1">
          <p class="text-[11px] text-ink">${esc(rotulo)}</p>
          <p class="text-[10px] text-inkfaint tabular">Total: ${formatarIndicador(linha, dados.escopos.TODAS)}</p>
        </div>
        ${dados.campanhas
          .map((c, i) => {
            const v = valores[i];
            const largura = v === null || v === undefined ? 0 : Math.min((v / maximo) * 100, 100);
            return `<div class="flex items-center gap-2 mb-0.5">
              <span class="w-12 shrink-0 text-[10px] font-mono text-inkdim">${esc(c.codigo)}</span>
              <span class="flex-1 h-2.5 bg-surface2 block"><span class="barra h-full block" style="width:${largura}%;background:${estiloDaCampanha(c.codigo).cor}"></span></span>
              <span class="w-14 shrink-0 text-[11px] tabular text-ink text-right">${formatarIndicador(linha, dados.escopos[c.codigo])}</span>
            </div>`;
          })
          .join("")}
      </div>`;
  };
  const volumes = LINHAS_DO_COMPARATIVO.filter((l) => !l[2]);
  const taxas = LINHAS_DO_COMPARATIVO.filter((l) => l[2]);
  $("graficoComparativo").innerHTML = `
    <div class="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-[11px] text-inkdim">
      ${dados.campanhas.map((c) => `<span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5" style="background:${estiloDaCampanha(c.codigo).cor}"></span>${esc(c.codigo)} · ${esc(c.nome)}</span>`).join("")}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-5">
      <div class="lg:col-span-2">
        <p class="rotulo mb-3">Volumes</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">${volumes.map(bloco).join("")}</div>
      </div>
      <div>
        <p class="rotulo mb-3">Taxas</p>
        <div class="space-y-4">${taxas.map(bloco).join("")}</div>
      </div>
    </div>
    <p class="text-[10px] text-inkfaint mt-4">Nos volumes, o comprimento da barra é relativo ao maior valor do próprio indicador. Nas taxas, a escala vai de 0 a 100%; um traço indica que não há base de cálculo.</p>`;
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

// Variação de um volume em relação ao período anterior, de mesma duração.
// menorEhMelhor inverte a cor para indicadores em que a alta é ruim.
function comparacaoComAnterior(chave, menorEhMelhor = false) {
  const atual = escopo().volume[chave];
  const anterior = dados.escoposAnteriores?.[campanhaSelecionada]?.volume[chave];
  if (anterior === undefined) return "";
  if (anterior === 0) return `<span class="text-inkfaint">Período anterior: 0</span>`;
  const pct = Math.round(((atual - anterior) / anterior) * 1000) / 10;
  const cor = pct === 0 ? "text-inkdim" : pct > 0 !== menorEhMelhor ? "text-positivo" : "text-negativo";
  return `<span class="text-inkfaint">Período anterior: ${numero(anterior)}</span> <span class="${cor} font-semibold tabular">${pct > 0 ? "+" : ""}${pct.toLocaleString("pt-BR")}%</span>`;
}

// Regra de contagem de cada indicador, exibida junto com a lista de leads.
const REGRAS_DOS_INDICADORES = {
  leadsRecebidos: ["Leads recebidos", "Leads criados no Kommo dentro do período selecionado, nos funis das três campanhas."],
  contatados: ["Leads contatados", "Leads que entraram na coluna Contato Iniciado dentro do período. Inclui leads criados antes do período que só foram movidos agora."],
  comPrimeiraResposta: ["Com primeira resposta", "Leads que entraram na coluna Em Qualificação dentro do período. Inclui leads contatados antes do período que responderam agora, por isso não é necessariamente uma parte dos contatados."],
  qualificados: ["Qualificados", "Leads que entraram na coluna Lead Qualificado dentro do período. Também conta quem foi movido direto de uma etapa anterior à qualificação para Em Agendamento ou Agendado."],
  qualificadosSemAgendamento: ["Qualificados sem agendamento", "Leads qualificados no período que não entraram em Agendado depois da qualificação, dentro do período."],
  reunioesMarcadas: ["Leads com reunião marcada", "Leads que entraram na coluna Agendado dentro do período. O número do cartão conta agendamentos: um lead reagendado conta mais de uma vez no cartão e uma vez nesta lista."],
  reunioesRealizadas: ["Leads com reunião realizada", "Leads que saíram de Agendado dentro do período com a reunião realizada, conforme o campo Situação da reunião. Sem o campo preenchido, contam as saídas para Protocolo Farmer, Reaquecimento ou Fechado; a saída para Desqualificado conta somente se o lead tiver a etiqueta REUNIAO_REALIZADA."],
  naoRealizadas: ["Leads com reunião não realizada", "Leads que saíram de Agendado para Remarcação, quando o agendamento também ocorreu dentro do período."],
  remarcacoesRecuperadas: ["Remarcações recuperadas", "Leads movidos de Remarcação para Agendado dentro do período."],
  fechados: ["Contratos fechados", "Leads que entraram na coluna final de venda ganha dentro do período."],
  desqualificados: ["Desqualificados", "Leads que entraram na coluna final de venda perdida dentro do período."],
};

// Abre a relação dos leads contados em um indicador, na campanha selecionada.
function abrirLeadsDoIndicador(indicador) {
  const [titulo, regra] = REGRAS_DOS_INDICADORES[indicador];
  const leads = daCampanha(dados.listas.leadsPorIndicador)
    .filter((l) => l.indicadores.includes(indicador))
    .map((l) => ({ leadId: l.id, nome: l.nome, telefone: l.telefone, etapaMaisAvancada: `${l.campanha} · hoje em ${nomeEtapa(l.etapaAtual)}` }));
  abrirLeadsDoGrupo(titulo, leads, regra);
}

// Trecho clicável dentro do texto de um cartão.
const linkDoIndicador = (indicador, texto) => `<button data-indicador="${indicador}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${texto}</button>`;

function cartao(valor, rotulo, detalhe, corDoValor = "text-ink", comparacao = "", indicador = "") {
  return `
    <div class="p-5">
      <p class="font-serif text-3xl font-semibold tabular ${corDoValor}">${indicador ? `<button data-indicador="${indicador}" class="hover:underline decoration-1 underline-offset-4" title="Ver os leads e a regra de cálculo">${valor}</button>` : valor}</p>
      <p class="rotulo mt-2">${esc(rotulo)}</p>
      ${comparacao ? `<p class="text-[11px] mt-2">${comparacao}</p>` : ""}
      ${detalhe ? `<p class="text-[11px] text-inkdim mt-2 leading-relaxed">${detalhe}</p>` : ""}
    </div>`;
}

function renderizarCartoes() {
  const { volume: v, taxas: t, etiquetas } = escopo();
  const noShow = etiquetas.noShow.emUso
    ? `${numero(etiquetas.noShow.total)} com a etiqueta NO_SHOW`
    : "Etiqueta NO_SHOW ainda não utilizada";
  const c = comparacaoComAnterior;

  $("cartoes").innerHTML = [
    cartao(numero(v.leadsRecebidos), "Leads recebidos", `${linkDoIndicador("contatados", `${numero(v.contatados)} contatados`)} · ${linkDoIndicador("comPrimeiraResposta", `${numero(v.comPrimeiraResposta)} com primeira resposta`)}`, "text-ink", c("leadsRecebidos"), "leadsRecebidos"),
    cartao(numero(v.qualificados), "Qualificados", `Taxa de qualificação: <span class="${classeDaTaxa(t.qualificacao)}">${percentual(t.qualificacao)}</span><br>${linkDoIndicador("qualificadosSemAgendamento", `${numero(v.qualificadosSemAgendamento)} sem agendamento`)}`, "text-ink", c("qualificados"), "qualificados"),
    cartao(numero(v.reunioesMarcadas), "Reuniões marcadas", `${numero(v.reunioesMarcadasNovas)} novas · ${numero(v.remarcacoes)} remarcações<br>Qualificado para agendado: <span class="${classeDaTaxa(t.qualificadoParaAgendado)}">${percentual(t.qualificadoParaAgendado)}</span>`, "text-goldbright", c("reunioesMarcadas"), "reunioesMarcadas"),
    cartao(numero(v.reunioesRealizadas), "Reuniões realizadas", `Comparecimento: <span class="${classeDaTaxa(t.comparecimento)}">${percentual(t.comparecimento)}</span>`, "text-positivo", c("reunioesRealizadas"), "reunioesRealizadas"),
    cartao(numero(v.naoRealizadas), "Não realizadas", `${percentual(t.naoRealizacao)} das marcadas<br>${esc(noShow)}`, "text-negativo", c("naoRealizadas", true), "naoRealizadas"),
    cartao(numero(v.remarcacoesRecuperadas), "Remarcações recuperadas", `De ${numero(v.entradasEmRemarcacao)} entradas em Remarcação: ${percentual(t.remarcacaoRecuperada)}<br>${numero(v.remarcacoesRecuperadasERealizadas)} recuperadas e realizadas`, "text-ink", c("remarcacoesRecuperadas"), "remarcacoesRecuperadas"),
    cartao(numero(v.fechados), "Contratos fechados", `Reunião para fechamento: <span class="${classeDaTaxa(t.reuniaoParaFechamento)}">${percentual(t.reuniaoParaFechamento)}</span><br>Conversão final: ${percentual(t.conversaoFinal)}`, "text-positivo", c("fechados"), "fechados"),
    cartao(numero(v.desqualificados), "Desqualificados", `${numero(v.perdidasAntesDaReuniao)} perdidos entre o agendamento e a reunião`, "text-ink", c("desqualificados", true), "desqualificados"),
  ].join("");

  const dataBr = (iso) => iso.split("-").reverse().join("/");
  $("periodoAnterior").textContent = dados.periodoAnterior
    ? `"Período anterior", nos cartões acima, é ${dataBr(dados.periodoAnterior.inicio)} a ${dataBr(dados.periodoAnterior.fim)}.`
    : "";

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

// Evolução dos leads ao longo das etapas: quantos entraram em cada etapa no
// período, na ordem do funil. Uma linha por campanha ou uma linha unificada,
// que segue a campanha selecionada.
function renderizarEvolucao() {
  const container = $("graficoEvolucao");
  const DESVIOS = ["REMARCACAO", "REAQUECIMENTO", "DESQUALIFICADO"];
  const conhecidas = dados.etapas.filter((e) => e.categoria !== "outra");
  const principais = conhecidas.filter((e) => !DESVIOS.includes(e.chave));
  const desvios = $("etapasEvolucao").value === "todas" ? conhecidas.filter((e) => DESVIOS.includes(e.chave)) : [];
  // Caminho principal à esquerda; desvios, quando exibidos, à direita.
  const etapas = [...principais, ...desvios];
  const unificado = $("modoEvolucao").value === "unificado";
  const series = unificado
    ? [{ nome: campanhaSelecionada === "TODAS" ? "Todas as campanhas" : campanhaSelecionada, cor: "#d8b565", traco: "", escopo: escopo() }]
    : dados.campanhas.map((c) => ({ nome: c.codigo, ...estiloDaCampanha(c.codigo), escopo: dados.escopos[c.codigo] }));
  for (const s of series) s.valores = etapas.map((e) => s.escopo.entradasPorEtapa[e.chave] || 0);
  // Campanha de cada série, para localizar os leads no detalhamento.
  series.forEach((s, i) => (s.campanha = unificado ? campanhaSelecionada : dados.campanhas[i].codigo));

  const maximo = Math.max(...series.flatMap((s) => s.valores), 1);
  if (!series.some((s) => s.valores.some((v) => v > 0))) {
    container.innerHTML = '<p class="text-xs text-inkdim">Nenhum lead movimentado no período.</p>';
    return;
  }

  const W = 940, H = 330, ML = 84, MR = 24, MT = 24, MB = 104;
  const areaW = W - ML - MR, areaH = H - MT - MB, base = MT + areaH;
  const passo = areaW / (etapas.length - 1);
  const x = (i) => ML + i * passo;
  const y = (v) => base - (v / maximo) * areaH;

  const marcas = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => `<line x1="${ML}" y1="${y(maximo * f)}" x2="${W - MR}" y2="${y(maximo * f)}" stroke="#1f2130"/><text x="${ML - 6}" y="${y(maximo * f) + 3}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9" fill="#6b6d7a">${Math.round(maximo * f)}</text>`)
    .join("");
  const linhas = series
    .map((s, si) => {
      // Com várias linhas, o rótulo alterna acima e abaixo do ponto para reduzir a sobreposição.
      const deslocamento = unificado || si !== 1 ? -9 : 15;
      // A linha liga apenas o caminho principal; os desvios são pontos soltos.
      return `<path d="${s.valores.slice(0, principais.length).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.cor}" stroke-width="2"${s.traco ? ` stroke-dasharray="${s.traco}"` : ""}/>
      ${s.valores
        .map(
          (v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5" fill="#0b0c11" stroke="${s.cor}" stroke-width="2" style="cursor:pointer" data-serie="${si}" data-etapa="${i}"><title>${esc(s.nome)}, ${esc(etapas[i].nome)}: ${v}</title></circle>
          <text x="${x(i).toFixed(1)}" y="${(y(v) + deslocamento).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9.5" font-weight="600" fill="${s.cor}">${v}</text>`,
        )
        .join("")}`;
    })
    .join("");
  const xDoSeparador = desvios.length ? x(principais.length - 1) + passo / 2 : null;
  const separador = desvios.length
    ? `<line x1="${xDoSeparador}" y1="${MT - 8}" x2="${xDoSeparador}" y2="${base}" stroke="#33364a" stroke-dasharray="3,4"/>
       <text x="${xDoSeparador + 8}" y="${MT - 10}" font-family="IBM Plex Mono, monospace" font-size="9" fill="#6b6d7a">DESVIOS DO CAMINHO PRINCIPAL</text>`
    : "";
  const rotulos = etapas
    .map((e, i) => `<g transform="translate(${x(i).toFixed(1)},${base + 14}) rotate(-28)"><text text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="${corEtapa(e.chave)}">${esc(e.nome)}</text></g>`)
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução dos leads ao longo das etapas" style="display:block;width:100%;height:auto">
      ${marcas}<line x1="${ML}" y1="${base}" x2="${W - MR}" y2="${base}" stroke="#33364a"/>${separador}${linhas}${rotulos}
    </svg>
    <div class="flex flex-wrap gap-x-5 gap-y-1 mt-1 text-[11px] text-inkdim">
      ${series.map((s) => `<span class="flex items-center gap-1.5"><svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" stroke="${s.cor}" stroke-width="2"${s.traco ? ` stroke-dasharray="${s.traco}"` : ""}/></svg>${esc(s.nome)}</span>`).join("")}
    </div>`;

  container.querySelectorAll("circle[data-serie]").forEach((ponto) => {
    ponto.addEventListener("click", () => {
      const serie = series[Number(ponto.dataset.serie)];
      const etapa = etapas[Number(ponto.dataset.etapa)];
      const leads = dados.listas.leadsPorEtapa
        .filter((l) => l.etapas.includes(etapa.chave) && (serie.campanha === "TODAS" || l.campanha === serie.campanha))
        .map((l) => ({ leadId: l.id, nome: l.nome, telefone: l.telefone, etapaMaisAvancada: `${l.campanha} · hoje em ${nomeEtapa(l.etapaAtual)}` }));
      abrirLeadsDoGrupo(`${serie.nome}: entraram em ${etapa.nome}`, leads);
    });
  });
}

function renderizarFunil() {
  const e = escopo();
  renderizarEvolucao();
  renderizarBarras("graficoVolume", e.volumeAtual, (chave) => (e.tempoMedioPorEtapa[chave] !== undefined ? `${e.tempoMedioPorEtapa[chave]} d` : ""));
}

function renderizarTempos() {
  const t = escopo().tempos;
  const bloco = (titulo, descricao, r) => `
    <div class="p-5">
      <p class="font-serif text-2xl font-semibold tabular text-ink">${duracaoUtil(r.medianaSeg)}</p>
      <p class="rotulo mt-2">${esc(titulo)}</p>
      <p class="text-[11px] text-inkdim mt-2 leading-relaxed">${esc(descricao)}<br>
        Mediana de ${numero(r.amostras)} lead(s), em horas úteis · média: ${duracaoUtil(r.mediaSeg)}<br>
        Em tempo corrido: ${duracao(r.medianaCorridaSeg)}</p>
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

function renderizarMetas() {
  const itens = dados.metas?.itens || [];
  const [ano, mes] = (dados.metas?.mes || "").split("-");
  $("metas").innerHTML = itens
    .map((m) => {
      const pct = m.meta > 0 ? Math.min((m.atual / m.meta) * 100, 100) : 0;
      const cor = pct >= 100 ? "#4fb38a" : pct >= 60 ? "#b6923f" : "#d0685a";
      return `
      <div class="min-w-[150px]" title="Meta do mês ${mes}/${ano}, somadas as três campanhas">
        <div class="flex justify-between items-baseline gap-3">
          <span class="rotulo">${esc(m.rotulo)}</span>
          <span class="font-serif text-sm font-semibold text-ink tabular">${numero(m.atual)} / ${numero(m.meta)}</span>
        </div>
        <div class="h-1 bg-surface2 mt-1.5"><div class="barra h-full" style="width:${pct}%;background:${cor}"></div></div>
      </div>`;
    })
    .join("");
}

// Colunas exibidas para cada papel.
const COLUNAS_POR_PAPEL = {
  sdr: [["Leads", "leadsRecebidos"], ["Qualif.", "qualificados"], ["Reuniões marcadas", "reunioesMarcadas"]],
  closer: [["Realizadas", "reunioesRealizadas"], ["Não realizadas", "naoRealizadas"], ["Fechados", "fechados"]],
  farmer: [["Realizadas", "reunioesRealizadas"], ["Fechados", "fechados"]],
};

function renderizarPorPessoa() {
  const porPessoa = escopo().porPessoa || {};
  $("porPessoa").innerHTML = (dados.papeis || [])
    .map((papel) => {
      const pessoas = porPessoa[papel.chave] || [];
      const colunas = COLUNAS_POR_PAPEL[papel.chave];
      const corpo = pessoas.length
        ? `<table class="w-full text-xs">
            <thead><tr class="text-inkfaint text-[10px] text-left"><th class="font-normal pb-1.5">Nome</th>${colunas.map(([rotulo]) => `<th class="font-normal pb-1.5 text-right">${rotulo}</th>`).join("")}</tr></thead>
            <tbody>${pessoas
              .map((pessoa) => `<tr class="border-t border-line"><td class="py-1.5 text-ink truncate max-w-[140px]" title="${esc(pessoa.nome)}">${esc(pessoa.nome)}</td>${colunas.map(([, chave]) => `<td class="py-1.5 text-right tabular text-ink">${numero(pessoa[chave])}</td>`).join("")}</tr>`)
              .join("")}</tbody>
          </table>`
        : `<p class="text-xs text-inkdim">Campo "${esc(papel.rotulo)} responsável" ainda não preenchido nos leads.</p>`;
      return `<div class="bg-bg p-5"><p class="rotulo mb-3">${esc(papel.rotulo)}</p>${corpo}</div>`;
    })
    .join("");
}

function renderizarRegistros() {
  const r = escopo().registros;
  const bloco = (id, registro, nomeDoCampo, vazio) => {
    $(id).innerHTML = !registro.emUso
      ? `<p class="text-xs text-inkdim">Campo "${nomeDoCampo}" ainda não preenchido nos leads.</p>`
      : listaComBarras(registro.itens.map((i) => ({ rotulo: i.valor, total: i.total })), (i) => i.rotulo, vazio);
  };
  bloco("substatusFarmer", r.substatusFarmer, "Substatus Farmer", "Nenhum lead no Protocolo Farmer.");
  bloco("situacaoDaReuniao", r.situacaoDaReuniao, "Situação da reunião", "Nenhuma reunião marcada no período.");
  const s = r.situacaoDaReuniao;
  if (s.emUso) {
    $("situacaoDaReuniao").insertAdjacentHTML(
      "beforeend",
      `<p class="text-[10px] text-inkfaint mt-3">${numero(s.desfechosPeloCampo)} desfecho(s) de reunião no período definidos por este campo${s.desfechosDivergentes ? `, ${numero(s.desfechosDivergentes)} deles diferentes do que a movimentação entre colunas indicaria` : ""}. Nos demais, vale a movimentação.</p>`,
    );
  }
}

function renderizarEscopo() {
  renderizarPorPessoa();
  renderizarRegistros();
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

  renderizarMetas();
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
    LINHAS_DO_COMPARATIVO.map((linha) => [linha[0], ...colunas.map((c) => formatarIndicador(linha, dados.escopos[c.codigo]))]),
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
  <p style="margin-top:32px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#999;text-align:right">Desenvolvido por <a href="https://github.com/diogocoding" style="color:#999;text-decoration:none">diogocoding</a></p>
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
  fecharDialogo(modal.id);
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
$("cartoes").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-indicador]");
  if (botao && dados) abrirLeadsDoIndicador(botao.dataset.indicador);
});
$("modoComparativo").addEventListener("change", () => dados && renderizarComparativo());
$("modoEvolucao").addEventListener("change", () => dados && renderizarEvolucao());
$("etapasEvolucao").addEventListener("change", () => dados && renderizarEvolucao());
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
  // A ficha do lead abre sobre os demais diálogos; fecha primeiro.
  if (fecharFichaDoLead()) return;
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
