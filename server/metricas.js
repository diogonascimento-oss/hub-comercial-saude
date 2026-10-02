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
} from "./config.js";
import { nomeDaEtapa } from "./mapeamento.js";

const DIA = 86400;

// Percentual com uma casa decimal; null quando não há base de cálculo.
function taxa(numerador, denominador) {
  return denominador > 0 ? Math.round((numerador / denominador) * 1000) / 10 : null;
}

function resumirTempos(segundos) {
  const validos = segundos.filter((s) => s >= 0).sort((a, b) => a - b);
  if (!validos.length) return { amostras: 0, mediaSeg: null, medianaSeg: null };
  const meio = Math.floor(validos.length / 2);
  const mediana = validos.length % 2 ? validos[meio] : (validos[meio - 1] + validos[meio]) / 2;
  const media = validos.reduce((a, b) => a + b, 0) / validos.length;
  return { amostras: validos.length, mediaSeg: Math.round(media), medianaSeg: Math.round(mediana) };
}

// leads: leads normalizados do escopo (uma campanha ou todas).
// eventosPorLead: Map leadId -> eventos do período, em ordem cronológica, já
//   sem os excluídos e com as correções aplicadas.
// deTs, ateTs: limites do período, em segundos.
// agora: instante da consulta, em segundos.
export function calcularEscopo({ leads, eventosPorLead, deTs, ateTs, agora, incluirListas = false }) {
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
  let entradasEmRemarcacao = 0;
  let remarcacoesRecuperadas = 0;
  let remarcacoesRecuperadasERealizadas = 0;

  const leadsComReuniaoMarcada = new Set();
  const leadsFechados = new Set();
  const leadsDesqualificados = new Set();
  const leadsQualificados = new Set();
  const qualificadosQueAgendaram = new Set();

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
      // A criação do lead não gera evento de mudança de etapa. A etapa em que
      // ele nasceu é a de origem do primeiro evento; sem eventos, é a atual.
      const etapaDeNascimento = eventos[0]?.de || lead.etapa;
      if (etapaDeNascimento) registrarEntrada(etapaDeNascimento, lead.id, lead.criadoEm);
    }

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
        if (veioDeRemarcacao) remarcacoesRecuperadas++;
        ultimoAgendamentoVeioDeRemarcacao = veioDeRemarcacao;

        if (instanteDaQualificacao !== null) {
          qualificadosQueAgendaram.add(lead.id);
          if (!agendamentoPosQualificacaoContado) {
            temposDaQualificacaoAoAgendamento.push(ev.ts - instanteDaQualificacao);
            agendamentoPosQualificacaoContado = true;
          }
        }
      }

      if (ev.de === "AGENDADO" && ev.para !== "AGENDADO") {
        const realizada =
          ETAPAS_REUNIAO_REALIZADA.includes(ev.para) ||
          (ev.para === "DESQUALIFICADO" && tem(ETIQUETAS.reuniaoRealizada));
        if (realizada) reunioesRealizadas++;

        // Os desfechos abaixo só contam quando o agendamento correspondente
        // também ocorreu no período. Sem isso, a falta de um lead agendado no
        // mês anterior entraria na taxa deste mês sem ter entrado na base.
        if (agendamentosSemDesfecho > 0) {
          agendamentosSemDesfecho--;
          if (realizada) {
            realizadasDaCoorte++;
            if (ultimoAgendamentoVeioDeRemarcacao) remarcacoesRecuperadasERealizadas++;
          } else if (ev.para === "REMARCACAO") {
            naoRealizadas++;
            if (tem(ETIQUETAS.noShow)) naoRealizadasComEtiquetaNoShow++;
          } else if (ev.para === "DESQUALIFICADO") {
            perdidasAntesDaReuniao++;
          } else {
            outrasSaidasDeAgendado++;
          }
        }
      }

      if (ev.para === "REMARCACAO" && ev.de !== "REMARCACAO") entradasEmRemarcacao++;
      if (ev.para === "FECHADO") leadsFechados.add(lead.id);
      if (ev.para === "DESQUALIFICADO") leadsDesqualificados.add(lead.id);

      if (ev.para === "CONTATO_INICIADO" && instanteDoContatoIniciado === null) {
        instanteDoContatoIniciado = ev.ts;
        if (criadoNoPeriodo) temposAtePrimeiraMensagem.push(ev.ts - lead.criadoEm);
      }
      if (ev.para === "EM_QUALIFICACAO" && instanteDoContatoIniciado !== null && !respostaContada) {
        temposAtePrimeiraResposta.push(ev.ts - instanteDoContatoIniciado);
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

  const qualificados = leadsQualificados.size;
  const fechados = leadsFechados.size;
  const reunioesEmAberto = agendamentoEmAberto.size;

  const resultado = {
    volume: {
      leadsRecebidos,
      contatados: totalQueEntrou("CONTATO_INICIADO"),
      comPrimeiraResposta: totalQueEntrou("EM_QUALIFICACAO"),
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
    resultado.listas = {
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
          diasParado: Math.floor((agora - l.atualizadoEm) / DIA),
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
            diasAguardando: Math.floor((agora - ts) / DIA),
          };
        })
        .sort((a, b) => b.diasAguardando - a.diasAguardando),
    };
  }

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
