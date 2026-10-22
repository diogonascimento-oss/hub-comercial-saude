// Cálculo dos indicadores. Funções puras: recebem leads e eventos já
// normalizados e devolvem os números, sem consultar nenhum serviço externo.
//
// A metodologia de cada indicador está descrita em client/documentacao.html.
// Qualquer mudança de regra aqui deve ser refletida lá.

import {
  ETAPAS,
  ETIQUETAS,
  ETAPAS_PRE_QUALIFICACAO,
  ETAPAS_REUNIAO_REALIZADA,
  ETAPAS_FORA_DO_ALERTA_DE_PARADOS,
  DIAS_PARA_LEAD_PARADO,
  PARES_CONVERSAO_AMPLA,
  SITUACAO_DA_REUNIAO,
} from "./config.js";
import { segundosUteis } from "./expediente.js";
import { nomeDaEtapa } from "./mapeamento.js";

// Diferença em dias de calendário no fuso do escritório (UTC-3): uma reunião
// marcada ontem às 23h é "há 1 dia" logo depois da meia-noite, e não "hoje"
// só porque ainda não se passaram 24 horas.
const DESLOCAMENTO_DO_FUSO_S = -3 * 3600;
export function diasDeCalendario(de, ate) {
  const dia = (ts) => Math.floor((ts + DESLOCAMENTO_DO_FUSO_S) / 86400);
  return dia(ate) - dia(de);
}

const DIA = 86400;

// Posição de cada etapa no funil, pela ordem do protocolo.
const POSICAO = new Map(ETAPAS.map((e, i) => [e.chave, i]));

// Um lead pode pular uma coluna: sair de Contato Iniciado direto para Lead
// Qualificado, por exemplo. Nesse caso ele passou pelo marco daquela coluna
// mesmo sem entrar nela. Retorna true quando o lead foi de uma etapa anterior
// ao marco (ou nasceu, sem etapa de origem) para uma etapa posterior a ele.
// Ir para Desqualificado não conta: o lead pode ter sido descartado sem atingir
// o marco (telefone inválido, sem resposta).
function pulouOMarco(de, para, marco) {
  if (para === "DESQUALIFICADO" || !POSICAO.has(para)) return false;
  const posicaoDoMarco = POSICAO.get(marco);
  if (POSICAO.get(para) <= posicaoDoMarco) return false;
  return de == null || (POSICAO.has(de) && POSICAO.get(de) < posicaoDoMarco);
}

// Percentual com uma casa decimal; null quando não há base de cálculo.
function taxa(numerador, denominador) {
  return denominador > 0 ? Math.round((numerador / denominador) * 1000) / 10 : null;
}

function medidas(valores) {
  const validos = valores.filter((s) => s >= 0).sort((a, b) => a - b);
  if (!validos.length) return { amostras: 0, media: null, mediana: null };
  const meio = Math.floor(validos.length / 2);
  const mediana = validos.length % 2 ? validos[meio] : (validos[meio - 1] + validos[meio]) / 2;
  const media = validos.reduce((a, b) => a + b, 0) / validos.length;
  return { amostras: validos.length, media: Math.round(media), mediana: Math.round(mediana) };
}

// Recebe pares [início, fim] e resume o intervalo em horas úteis (medida
// principal) e em tempo corrido.
function resumirTempos(intervalos) {
  const uteis = medidas(intervalos.map(([de, ate]) => (ate >= de ? segundosUteis(de, ate) : -1)));
  const corridos = medidas(intervalos.map(([de, ate]) => ate - de));
  return {
    amostras: uteis.amostras,
    mediaSeg: uteis.media,
    medianaSeg: uteis.mediana,
    mediaCorridaSeg: corridos.media,
    medianaCorridaSeg: corridos.mediana,
  };
}

const semAcento = (texto) => String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// true: o campo informa que a reunião foi realizada; false: que não foi;
// null: campo vazio ou com valor que não permite concluir.
export function leituraDaSituacao(valor) {
  const texto = semAcento(valor);
  if (!texto) return null;
  if (SITUACAO_DA_REUNIAO.naoRealizada.some((termo) => texto.includes(termo))) return false;
  if (SITUACAO_DA_REUNIAO.realizada.some((termo) => texto.includes(termo))) return true;
  return null;
}

// Reuniões de um lead, uma por agendamento, com o desfecho e o critério que o
// definiu. Usa as mesmas regras de calcularEscopo, sobre todo o histórico do
// lead, e serve à ficha do lead.
export function reunioesDoLead(lead, eventos) {
  const validos = eventos.filter((e) => e.para);
  const ultimaSaida = validos.findLast((e) => e.de === "AGENDADO" && e.para !== "AGENDADO") || null;
  const reunioes = [];
  let aberta = null;
  for (const ev of validos) {
    if (ev.para === "AGENDADO" && ev.de !== "AGENDADO") {
      aberta = { agendadaEm: ev.ts, veioDeRemarcacao: ev.de === "REMARCACAO", desfechoEm: null, resultado: "Em aberto", criterio: "" };
      reunioes.push(aberta);
    } else if (ev.de === "AGENDADO" && ev.para !== "AGENDADO" && aberta) {
      const comEtiqueta = ev.para === "DESQUALIFICADO" && (lead.tags || []).includes(ETIQUETAS.reuniaoRealizada);
      const pelaMovimentacao = ETAPAS_REUNIAO_REALIZADA.includes(ev.para) || comEtiqueta;
      const peloCampo = ev === ultimaSaida ? leituraDaSituacao(lead.situacaoDaReuniao) : null;
      const realizada = peloCampo ?? pelaMovimentacao;
      aberta.desfechoEm = ev.ts;
      aberta.destino = ev.para;
      if (realizada) aberta.resultado = "Realizada";
      else if (ev.para === "REMARCACAO" || peloCampo === false) aberta.resultado = "Não realizada";
      else if (ev.para === "DESQUALIFICADO") aberta.resultado = "Perdida antes da reunião";
      else aberta.resultado = "Saída de Agendado sem desfecho reconhecido";
      aberta.criterio =
        peloCampo !== null
          ? `campo Situação da reunião ("${lead.situacaoDaReuniao}")`
          : comEtiqueta
            ? "etiqueta REUNIAO_REALIZADA"
            : "movimentação entre colunas";
      aberta.divergente = peloCampo !== null && peloCampo !== pelaMovimentacao;
      aberta = null;
    }
  }
  return reunioes;
}

// leads: leads normalizados do escopo (uma campanha ou todas).
// eventosPorLead: Map leadId -> eventos do período, em ordem cronológica, já
//   sem os excluídos e com as correções aplicadas.
// deTs, ateTs: limites do período, em segundos.
// agora: instante da consulta, em segundos.
export function calcularEscopo({ leads, eventosPorLead, deTs, ateTs, agora, incluirListas = false, incluirAcontecimentos = false }) {
  // Acontecimentos do período, um por movimentação relevante, registrados nos
  // mesmos pontos em que os indicadores são contados. Assim a lista do dia
  // usa exatamente as regras dos cartões.
  const acontecimentos = [];
  const registrarAcontecimento = (lead, ev, tipo, detalhe = "") => {
    if (incluirAcontecimentos) acontecimentos.push({ ts: ev.ts, leadId: lead.id, tipo, de: ev.de, para: ev.para, detalhe });
  };
  // etapa -> Map(leadId -> instante da primeira entrada no período)
  const entradas = new Map();
  const registrarEntrada = (chave, leadId, ts) => {
    if (!entradas.has(chave)) entradas.set(chave, new Map());
    const porLead = entradas.get(chave);
    if (!porLead.has(leadId) || ts < porLead.get(leadId)) porLead.set(leadId, ts);
  };
  const totalQueEntrou = (chave) => entradas.get(chave)?.size || 0;

  // Leads únicos por transição e por etapa de origem.
  const transicoes = new Map(); // "origem|||destino" -> Set(leadId)
  const saidas = new Map(); // origem -> Set(leadId)

  let reunioesMarcadas = 0;
  let remarcacoes = 0;
  let reunioesRealizadas = 0; // saídas de Agendado com reunião realizada, na janela
  let realizadasDaCoorte = 0; // idem, com o agendamento também dentro da janela
  let naoRealizadas = 0;
  let naoRealizadasComEtiquetaNoShow = 0;
  let perdidasAntesDaReuniao = 0;
  let outrasSaidasDeAgendado = 0;
  let desfechosPeloCampo = 0;
  let desfechosDivergentes = 0;
  let entradasEmRemarcacao = 0;
  let remarcacoesRecuperadas = 0;
  let remarcacoesRecuperadasERealizadas = 0;

  const leadsComReuniaoMarcada = new Set();
  const leadsFechados = new Set();
  const leadsDesqualificados = new Set();
  const leadsQualificados = new Set();
  // Contatados e com primeira resposta: quem entrou na coluna do marco no
  // período ou a pulou (ver pulouOMarco).
  const leadsContatados = new Set();
  const leadsComPrimeiraResposta = new Set();
  const qualificadosQueAgendaram = new Set();
  // Conjuntos usados só para o detalhamento "quem são esses leads".
  const leadsRecebidosNoPeriodo = new Set();
  const leadsComReuniaoRealizada = new Set();
  const leadsComReuniaoNaoRealizada = new Set();
  const leadsComRemarcacaoRecuperada = new Set();

  const temposAtePrimeiraMensagem = [];
  const temposAtePrimeiraResposta = [];
  const temposDaQualificacaoAoAgendamento = [];

  const ultimaEtapaNoPeriodo = new Map();
  const agendamentoEmAberto = new Map(); // leadId -> instante do último agendamento

  let leadsRecebidos = 0;

  for (const lead of leads) {
    const eventos = eventosPorLead.get(lead.id) || [];
    const criadoNoPeriodo = Boolean(lead.criadoEm) && lead.criadoEm >= deTs && lead.criadoEm <= ateTs;
    const tem = (etiqueta) => lead.tags.includes(etiqueta);

    if (criadoNoPeriodo) {
      leadsRecebidos++;
      leadsRecebidosNoPeriodo.add(lead.id);
      // A criação do lead não gera evento de mudança de etapa. A etapa em que
      // ele nasceu é a de origem do primeiro evento; sem eventos, é a atual.
      const etapaDeNascimento = eventos[0]?.de || lead.etapa;
      if (etapaDeNascimento) {
        registrarEntrada(etapaDeNascimento, lead.id, lead.criadoEm);
        // Lead que já nasce adiante (o do WhatsApp, por exemplo, pode ser
        // criado em Em Qualificação) passou pelos marcos anteriores.
        if (etapaDeNascimento === "CONTATO_INICIADO" || pulouOMarco(null, etapaDeNascimento, "CONTATO_INICIADO")) leadsContatados.add(lead.id);
        if (etapaDeNascimento === "EM_QUALIFICACAO" || pulouOMarco(null, etapaDeNascimento, "EM_QUALIFICACAO")) leadsComPrimeiraResposta.add(lead.id);
      }
    }

    const ultimaSaidaDeAgendado = eventos.findLast((e) => e.para && e.de === "AGENDADO" && e.para !== "AGENDADO") || null;
    let vezesAgendado = 0;
    let agendamentosSemDesfecho = 0;
    let ultimoAgendamentoVeioDeRemarcacao = false;
    let instanteDaQualificacao = null;
    let instanteDoContatoIniciado = null;
    let respostaContada = false;
    let agendamentoPosQualificacaoContado = false;

    for (const ev of eventos) {
      if (!ev.para) continue;

      if (ev.de && ev.de !== ev.para) {
        const par = `${ev.de}|||${ev.para}`;
        if (!transicoes.has(par)) transicoes.set(par, new Set());
        transicoes.get(par).add(lead.id);
        if (!saidas.has(ev.de)) saidas.set(ev.de, new Set());
        saidas.get(ev.de).add(lead.id);
      }

      registrarEntrada(ev.para, lead.id, ev.ts);
      ultimaEtapaNoPeriodo.set(lead.id, ev.para);

      // Qualificação: entrada em Lead Qualificado. Como é uma coluna de
      // passagem, também conta quem saiu direto de uma etapa anterior à
      // qualificação para Em Agendamento ou Agendado.
      const pulouAColuna =
        (ev.para === "EM_AGENDAMENTO" || ev.para === "AGENDADO") && ETAPAS_PRE_QUALIFICACAO.includes(ev.de);
      if (instanteDaQualificacao === null && (ev.para === "LEAD_QUALIFICADO" || pulouAColuna)) {
        instanteDaQualificacao = ev.ts;
        leadsQualificados.add(lead.id);
      }

      if (ev.para === "AGENDADO" && ev.de !== "AGENDADO") {
        reunioesMarcadas++;
        vezesAgendado++;
        agendamentosSemDesfecho++;
        leadsComReuniaoMarcada.add(lead.id);
        agendamentoEmAberto.set(lead.id, ev.ts);

        const veioDeRemarcacao = ev.de === "REMARCACAO";
        if (vezesAgendado > 1 || veioDeRemarcacao) remarcacoes++;
        if (veioDeRemarcacao) {
          remarcacoesRecuperadas++;
          leadsComRemarcacaoRecuperada.add(lead.id);
        }
        ultimoAgendamentoVeioDeRemarcacao = veioDeRemarcacao;
        registrarAcontecimento(lead, ev, vezesAgendado > 1 || veioDeRemarcacao ? "reagendamento" : "agendamento");

        if (instanteDaQualificacao !== null) {
          qualificadosQueAgendaram.add(lead.id);
          if (!agendamentoPosQualificacaoContado) {
            temposDaQualificacaoAoAgendamento.push([instanteDaQualificacao, ev.ts]);
            agendamentoPosQualificacaoContado = true;
          }
        }
      }

      if (ev.de === "AGENDADO" && ev.para !== "AGENDADO") {
        const realizadaPelaMovimentacao =
          ETAPAS_REUNIAO_REALIZADA.includes(ev.para) ||
          (ev.para === "DESQUALIFICADO" && tem(ETIQUETAS.reuniaoRealizada));
        // O campo "Situação da reunião" guarda só a situação mais recente do
        // lead; por isso decide apenas a última saída de Agendado. Nas
        // anteriores, e quando o campo não permite concluir, vale a movimentação.
        const peloCampo = ev === ultimaSaidaDeAgendado ? leituraDaSituacao(lead.situacaoDaReuniao) : null;
        const realizada = peloCampo ?? realizadaPelaMovimentacao;
        if (peloCampo !== null) {
          desfechosPeloCampo++;
          if (peloCampo !== realizadaPelaMovimentacao) desfechosDivergentes++;
        }
        if (realizada) {
          reunioesRealizadas++;
          leadsComReuniaoRealizada.add(lead.id);
          registrarAcontecimento(lead, ev, "realizada", peloCampo === true ? "pelo campo Situação da reunião" : "");
        } else if (ev.para === "REMARCACAO" || peloCampo === false) {
          // Na lista do dia entra toda reunião que não aconteceu, inclusive as
          // marcadas antes do período (o cartão "Não realizadas" conta só as
          // marcadas dentro dele).
          registrarAcontecimento(lead, ev, "naoRealizada", peloCampo === false && lead.situacaoDaReuniao ? lead.situacaoDaReuniao : "");
        } else if (ev.para === "DESQUALIFICADO") {
          registrarAcontecimento(lead, ev, "perdidaAntesDaReuniao");
        }

        // Os desfechos abaixo só contam quando o agendamento correspondente
        // também ocorreu no período. Sem isso, a falta de um lead agendado no
        // mês anterior entraria na taxa deste mês sem ter entrado na base.
        if (agendamentosSemDesfecho > 0) {
          agendamentosSemDesfecho--;
          if (realizada) {
            realizadasDaCoorte++;
            if (ultimoAgendamentoVeioDeRemarcacao) remarcacoesRecuperadasERealizadas++;
          } else if (ev.para === "REMARCACAO" || peloCampo === false) {
            naoRealizadas++;
            leadsComReuniaoNaoRealizada.add(lead.id);
            if (tem(ETIQUETAS.noShow)) naoRealizadasComEtiquetaNoShow++;
          } else if (ev.para === "DESQUALIFICADO") {
            perdidasAntesDaReuniao++;
          } else {
            outrasSaidasDeAgendado++;
          }
        }
      }

      if (ev.para === "REMARCACAO" && ev.de !== "REMARCACAO") {
        entradasEmRemarcacao++;
        // Vindo de Agendado, o acontecimento já foi registrado como reunião não realizada.
        if (ev.de !== "AGENDADO") registrarAcontecimento(lead, ev, "remarcacao");
      }
      if (ev.para === "FECHADO") {
        leadsFechados.add(lead.id);
        if (ev.de !== "FECHADO") registrarAcontecimento(lead, ev, "contrato");
      }
      if (ev.para === "DESQUALIFICADO") leadsDesqualificados.add(lead.id);

      const contatou = ev.para === "CONTATO_INICIADO" || pulouOMarco(ev.de, ev.para, "CONTATO_INICIADO");
      const respondeu = ev.para === "EM_QUALIFICACAO" || pulouOMarco(ev.de, ev.para, "EM_QUALIFICACAO");
      if (contatou) leadsContatados.add(lead.id);
      if (respondeu) leadsComPrimeiraResposta.add(lead.id);
      // Os tempos só usam a entrada na própria coluna: num salto, o instante
      // do contato ou da resposta não está registrado no Kommo.
      if (ev.para === "CONTATO_INICIADO" && instanteDoContatoIniciado === null) {
        instanteDoContatoIniciado = ev.ts;
        if (criadoNoPeriodo) temposAtePrimeiraMensagem.push([lead.criadoEm, ev.ts]);
      }
      if (ev.para === "EM_QUALIFICACAO" && instanteDoContatoIniciado !== null && !respostaContada) {
        temposAtePrimeiraResposta.push([instanteDoContatoIniciado, ev.ts]);
        respostaContada = true;
      }
    }

    // Reunião em aberto: agendada no período e o lead continua em Agendado.
    if (lead.etapa !== "AGENDADO") agendamentoEmAberto.delete(lead.id);
  }

  const porId = new Map(leads.map((l) => [l.id, l]));
  const contarComEtiqueta = (ids, etiqueta) => {
    let n = 0;
    for (const id of ids) if (porId.get(id)?.tags.includes(etiqueta)) n++;
    return n;
  };
  const etiquetaEmUso = (etiqueta) => leads.some((l) => l.tags.includes(etiqueta));

  // Motivos de perda dos leads desqualificados no período.
  const contagemDeMotivos = new Map();
  for (const id of leadsDesqualificados) {
    const motivo = porId.get(id)?.motivoPerda || "Sem motivo registrado";
    contagemDeMotivos.set(motivo, (contagemDeMotivos.get(motivo) || 0) + 1);
  }

  // Retrato atual da base, independente do período.
  const volumeAtual = {};
  const somaDeDiasPorEtapa = {};
  for (const lead of leads) {
    volumeAtual[lead.etapa] = (volumeAtual[lead.etapa] || 0) + 1;
    if (lead.atualizadoEm) {
      somaDeDiasPorEtapa[lead.etapa] = (somaDeDiasPorEtapa[lead.etapa] || 0) + (agora - lead.atualizadoEm) / DIA;
    }
  }
  const tempoMedioPorEtapa = {};
  for (const [chave, total] of Object.entries(volumeAtual)) {
    tempoMedioPorEtapa[chave] = Math.round((somaDeDiasPorEtapa[chave] || 0) / total);
  }

  const leadsParados = leads.filter(
    (l) =>
      l.atualizadoEm &&
      agora - l.atualizadoEm > DIAS_PARA_LEAD_PARADO * DIA &&
      !ETAPAS_FORA_DO_ALERTA_DE_PARADOS.includes(l.etapa),
  );

  const contagemDeTags = new Map();
  for (const lead of leads) for (const tag of lead.tags) contagemDeTags.set(tag, (contagemDeTags.get(tag) || 0) + 1);

  const entradasPorEtapa = {};
  for (const [chave, porLead] of entradas) entradasPorEtapa[chave] = porLead.size;

  const conversaoEntreEtapas = [];
  const destinosPorEtapa = {};
  const saidasPorEtapa = {};
  for (const [origem, conjunto] of saidas) saidasPorEtapa[origem] = conjunto.size;
  for (const [par, conjunto] of transicoes) {
    const [origem, destino] = par.split("|||");
    const item = { origem, destino, total: conjunto.size, taxa: taxa(conjunto.size, saidasPorEtapa[origem]) };
    conversaoEntreEtapas.push(item);
    (destinosPorEtapa[origem] ||= []).push({ destino, total: item.total, taxa: item.taxa });
  }
  conversaoEntreEtapas.sort((a, b) => b.total - a.total);
  Object.values(destinosPorEtapa).forEach((lista) => lista.sort((a, b) => b.total - a.total));

  const conversaoAmpla = PARES_CONVERSAO_AMPLA.map(([origem, destino]) => {
    const naOrigem = entradas.get(origem) || new Map();
    const noDestino = entradas.get(destino) || new Map();
    let chegaram = 0;
    for (const [leadId, tsOrigem] of naOrigem) {
      const tsDestino = noDestino.get(leadId);
      if (tsDestino !== undefined && tsDestino >= tsOrigem) chegaram++;
    }
    return { origem, destino, entraram: naOrigem.size, chegaram, taxa: taxa(chegaram, naOrigem.size) };
  });

  // Registros do protocolo gravados em campos de seleção do lead. Refletem a
  // situação atual de cada lead.
  const contarPorCampo = (lista, campo, semValor) => {
    const contagem = new Map();
    for (const l of lista) contagem.set(l[campo] || semValor, (contagem.get(l[campo] || semValor) || 0) + 1);
    return [...contagem].map(([valor, total]) => ({ valor, total })).sort((a, b) => b.total - a.total);
  };
  const leadsNoFarmer = leads.filter((l) => l.etapa === "PROTOCOLO_FARMER");
  const leadsComReuniao = [...leadsComReuniaoMarcada].map((id) => porId.get(id));

  const qualificados = leadsQualificados.size;
  const fechados = leadsFechados.size;
  const reunioesEmAberto = agendamentoEmAberto.size;

  const resultado = {
    volume: {
      leadsRecebidos,
      contatados: leadsContatados.size,
      comPrimeiraResposta: leadsComPrimeiraResposta.size,
      qualificados,
      qualificadosSemAgendamento: qualificados - qualificadosQueAgendaram.size,
      reunioesMarcadas,
      reunioesMarcadasNovas: reunioesMarcadas - remarcacoes,
      remarcacoes,
      leadsComReuniaoMarcada: leadsComReuniaoMarcada.size,
      reunioesRealizadas,
      realizadasDaCoorte,
      naoRealizadas,
      perdidasAntesDaReuniao,
      outrasSaidasDeAgendado,
      reunioesEmAberto,
      entradasEmRemarcacao,
      remarcacoesRecuperadas,
      remarcacoesRecuperadasERealizadas,
      entradasEmFarmer: totalQueEntrou("PROTOCOLO_FARMER"),
      entradasEmReaquecimento: totalQueEntrou("REAQUECIMENTO"),
      emReaquecimentoAgora: volumeAtual.REAQUECIMENTO || 0,
      fechados,
      desqualificados: leadsDesqualificados.size,
    },
    taxas: {
      qualificacao: taxa(qualificados, leadsRecebidos),
      qualificadoParaAgendado: taxa(qualificadosQueAgendaram.size, qualificados),
      comparecimento: taxa(realizadasDaCoorte, reunioesMarcadas),
      naoRealizacao: taxa(naoRealizadas, reunioesMarcadas),
      emAberto: taxa(reunioesEmAberto, reunioesMarcadas),
      remarcacaoRecuperada: taxa(remarcacoesRecuperadas, entradasEmRemarcacao),
      reuniaoParaFechamento: taxa(fechados, reunioesRealizadas),
      conversaoFinal: taxa(fechados, leadsRecebidos),
    },
    // Indicadores que dependem das etiquetas do protocolo. "emUso" informa se
    // a etiqueta aparece em algum lead da base; quando não aparece, o zero
    // significa "ainda não utilizada", e não "nenhum caso".
    etiquetas: {
      confirmadas: {
        total: contarComEtiqueta(leadsComReuniaoMarcada, ETIQUETAS.confirmouReuniao),
        emUso: etiquetaEmUso(ETIQUETAS.confirmouReuniao),
      },
      noShow: { total: naoRealizadasComEtiquetaNoShow, emUso: etiquetaEmUso(ETIQUETAS.noShow) },
      propostasEnviadas: {
        total: contarComEtiqueta(entradas.get("PROTOCOLO_FARMER")?.keys() || [], ETIQUETAS.propostaEnviada),
        emUso: etiquetaEmUso(ETIQUETAS.propostaEnviada),
      },
      qualificadosEnviadosAoTintin: {
        total: contarComEtiqueta(leadsQualificados, ETIQUETAS.tintinQualificado),
        emUso: etiquetaEmUso(ETIQUETAS.tintinQualificado),
      },
      fechadosEnviadosAoTintin: {
        total: contarComEtiqueta(leadsFechados, ETIQUETAS.tintinFechado),
        emUso: etiquetaEmUso(ETIQUETAS.tintinFechado),
      },
    },
    registros: {
      substatusFarmer: {
        emUso: leads.some((l) => l.substatusFarmer),
        itens: contarPorCampo(leadsNoFarmer, "substatusFarmer", "Sem substatus"),
      },
      situacaoDaReuniao: {
        emUso: leads.some((l) => l.situacaoDaReuniao),
        itens: contarPorCampo(leadsComReuniao, "situacaoDaReuniao", "Sem situação registrada"),
        // Desfechos de reunião decididos pelo campo, e quantos deles
        // contrariam o que a movimentação entre colunas indicaria.
        desfechosPeloCampo,
        desfechosDivergentes,
      },
    },
    tempos: {
      atePrimeiraMensagem: resumirTempos(temposAtePrimeiraMensagem),
      atePrimeiraResposta: resumirTempos(temposAtePrimeiraResposta),
      daQualificacaoAoAgendamento: resumirTempos(temposDaQualificacaoAoAgendamento),
    },
    desqualificadosPorMotivo: [...contagemDeMotivos]
      .map(([motivo, total]) => ({ motivo, total }))
      .sort((a, b) => b.total - a.total),
    entradasPorEtapa,
    volumeAtual,
    tempoMedioPorEtapa,
    conversaoEntreEtapas: conversaoEntreEtapas.slice(0, 12),
    destinosPorEtapa,
    saidasPorEtapa,
    conversaoAmpla,
    qualidade: {
      semNomeOuTelefone: leads.filter((l) => l.semNome || !l.telefone).length,
      parados: leadsParados.length,
    },
    etiquetasMaisFrequentes: [...contagemDeTags]
      .map(([tag, total]) => ({ tag, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
  };

  if (incluirListas) {
    // Etapas em que cada lead entrou no período, para o detalhamento do
    // gráfico de evolução.
    const etapasPorLead = new Map();
    for (const [chave, porLead] of entradas) {
      for (const leadId of porLead.keys()) {
        if (!etapasPorLead.has(leadId)) etapasPorLead.set(leadId, []);
        etapasPorLead.get(leadId).push(chave);
      }
    }
    // Indicadores em que cada lead foi contado, para o detalhamento dos cartões.
    const conjuntos = {
      leadsRecebidos: leadsRecebidosNoPeriodo,
      contatados: leadsContatados,
      comPrimeiraResposta: leadsComPrimeiraResposta,
      qualificados: leadsQualificados,
      qualificadosSemAgendamento: new Set([...leadsQualificados].filter((id) => !qualificadosQueAgendaram.has(id))),
      reunioesMarcadas: leadsComReuniaoMarcada,
      reunioesRealizadas: leadsComReuniaoRealizada,
      naoRealizadas: leadsComReuniaoNaoRealizada,
      remarcacoesRecuperadas: leadsComRemarcacaoRecuperada,
      fechados: leadsFechados,
      desqualificados: leadsDesqualificados,
    };
    const indicadoresPorLead = new Map();
    for (const [indicador, ids] of Object.entries(conjuntos)) {
      for (const id of ids) {
        if (!indicadoresPorLead.has(id)) indicadoresPorLead.set(id, []);
        indicadoresPorLead.get(id).push(indicador);
      }
    }
    resultado.listas = {
      leadsPorIndicador: [...indicadoresPorLead].map(([leadId, indicadores]) => {
        const l = porId.get(leadId);
        return { id: l.id, nome: l.nome, telefone: l.telefone, campanha: l.campanha, etapaAtual: l.etapa, indicadores };
      }),
      leadsPorEtapa: [...etapasPorLead].map(([leadId, etapas]) => {
        const l = porId.get(leadId);
        return { id: l.id, nome: l.nome, telefone: l.telefone, campanha: l.campanha, etapaAtual: l.etapa, etapas };
      }),
      leadsDoPeriodo: leads
        .filter((l) => ultimaEtapaNoPeriodo.has(l.id))
        .map((l) => ({
          id: l.id,
          nome: l.nome,
          semNome: l.semNome,
          telefone: l.telefone,
          campanha: l.campanha,
          etapaNoPeriodo: ultimaEtapaNoPeriodo.get(l.id),
          etapaAtual: l.etapa,
          tags: l.tags,
          atualizadoEm: l.atualizadoEm,
        })),
      leadsParados: leadsParados
        .map((l) => ({
          id: l.id,
          nome: l.nome,
          telefone: l.telefone,
          campanha: l.campanha,
          etapaAtual: l.etapa,
          diasParado: diasDeCalendario(l.atualizadoEm, agora),
        }))
        .sort((a, b) => b.diasParado - a.diasParado),
      reunioesEmAberto: [...agendamentoEmAberto]
        .map(([leadId, ts]) => {
          const l = porId.get(leadId);
          return {
            id: l.id,
            nome: l.nome,
            telefone: l.telefone,
            campanha: l.campanha,
            agendadoEm: new Date(ts * 1000).toISOString(),
            // Data da reunião gravada no lead, quando a equipe preenche o campo.
            dataDaReuniao: l.dataDaReuniao ? new Date(l.dataDaReuniao * 1000).toISOString() : null,
            diasAteAReuniao: l.dataDaReuniao ? diasDeCalendario(agora, l.dataDaReuniao) : null,
            diasAguardando: diasDeCalendario(ts, agora),
          };
        })
        .sort((a, b) => a.agendadoEm.localeCompare(b.agendadoEm)),
    };
  }

  if (incluirAcontecimentos) resultado.acontecimentos = acontecimentos.sort((a, b) => a.ts - b.ts);
  return resultado;
}

// Lista de etapas para a interface: as onze do protocolo, na ordem do funil,
// seguidas de colunas do Kommo que não correspondem a nenhuma delas.
export function etapasParaInterface(chavesEncontradas = []) {
  const conhecidas = ETAPAS.map((e) => ({ chave: e.chave, nome: e.nome, categoria: e.categoria }));
  const extras = [...new Set(chavesEncontradas)]
    .filter((c) => c && !ETAPAS.some((e) => e.chave === c))
    .map((c) => ({ chave: c, nome: nomeDaEtapa(c), categoria: "outra" }));
  return [...conhecidas, ...extras];
}
