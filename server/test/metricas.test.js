// Testes do cálculo de indicadores com um cenário pequeno, conferido à mão.
import test from "node:test";
import assert from "node:assert/strict";
import { calcularEscopo, leituraDaSituacao, reunioesDoLead } from "../metricas.js";
import { segundosUteis } from "../expediente.js";

const HORA = 3600;
const DIA = 86400;
const DE = 1_000_000;
const ATE = DE + 30 * DIA;
const AGORA = ATE + DIA;

let seq = 0;
const ev = (leadId, ts, de, para) => ({ id: String(++seq), leadId, ts: DE + ts, tsOriginal: DE + ts, de, para });
const lead = (id, etapa, extras = {}) => ({
  id,
  nome: `Lead ${id}`,
  semNome: false,
  telefone: `8199999000${id}`,
  campanha: "IR-Q",
  etapa,
  etapaNome: etapa,
  tags: [],
  motivoPerda: "",
  criadoEm: DE + HORA,
  atualizadoEm: AGORA - DIA,
  ...extras,
});

function cenario() {
  const leads = [
    // 1: percurso completo até o fechamento.
    lead(1, "FECHADO"),
    // 2: qualificado, agendou e faltou; remarcou e a reunião aconteceu.
    lead(2, "PROTOCOLO_FARMER", { tags: ["NO_SHOW"] }),
    // 3: qualificado, sem agendamento.
    lead(3, "EM_AGENDAMENTO"),
    // 4: nunca respondeu; parado há 10 dias.
    lead(4, "CONTATO_INICIADO", { atualizadoEm: AGORA - 10 * DIA }),
    // 5: desqualificado na triagem.
    lead(5, "DESQUALIFICADO", { motivoPerda: "Sem interesse" }),
    // 6: criado antes do período; agendado no período, reunião ainda em aberto.
    lead(6, "AGENDADO", { criadoEm: DE - 5 * DIA }),
    // 7: criado antes do período e agendado antes dele; faltou dentro do período.
    lead(7, "REMARCACAO", { criadoEm: DE - 9 * DIA }),
  ];
  const eventos = [
    ev(1, 2 * HORA, "CONTATO_INICIAL", "CONTATO_INICIADO"),
    ev(1, 4 * HORA, "CONTATO_INICIADO", "EM_QUALIFICACAO"),
    ev(1, 6 * HORA, "EM_QUALIFICACAO", "LEAD_QUALIFICADO"),
    ev(1, 7 * HORA, "LEAD_QUALIFICADO", "EM_AGENDAMENTO"),
    ev(1, 10 * HORA, "EM_AGENDAMENTO", "AGENDADO"),
    ev(1, 2 * DIA, "AGENDADO", "PROTOCOLO_FARMER"),
    ev(1, 5 * DIA, "PROTOCOLO_FARMER", "FECHADO"),

    ev(2, 3 * HORA, "CONTATO_INICIAL", "CONTATO_INICIADO"),
    ev(2, 9 * HORA, "CONTATO_INICIADO", "EM_QUALIFICACAO"),
    // Pulou a coluna Lead Qualificado.
    ev(2, 12 * HORA, "EM_QUALIFICACAO", "EM_AGENDAMENTO"),
    ev(2, 14 * HORA, "EM_AGENDAMENTO", "AGENDADO"),
    ev(2, 3 * DIA, "AGENDADO", "REMARCACAO"),
    ev(2, 4 * DIA, "REMARCACAO", "AGENDADO"),
    ev(2, 6 * DIA, "AGENDADO", "PROTOCOLO_FARMER"),

    ev(3, 2 * HORA, "CONTATO_INICIAL", "CONTATO_INICIADO"),
    ev(3, 3 * HORA, "CONTATO_INICIADO", "EM_QUALIFICACAO"),
    ev(3, 5 * HORA, "EM_QUALIFICACAO", "LEAD_QUALIFICADO"),
    ev(3, 6 * HORA, "LEAD_QUALIFICADO", "EM_AGENDAMENTO"),

    ev(4, 2 * HORA, "CONTATO_INICIAL", "CONTATO_INICIADO"),

    ev(5, 2 * HORA, "CONTATO_INICIAL", "CONTATO_INICIADO"),
    ev(5, 5 * HORA, "CONTATO_INICIADO", "EM_QUALIFICACAO"),
    ev(5, 8 * HORA, "EM_QUALIFICACAO", "DESQUALIFICADO"),

    ev(6, 20 * DIA, "EM_AGENDAMENTO", "AGENDADO"),

    ev(7, 1 * DIA, "AGENDADO", "REMARCACAO"),
  ];
  const eventosPorLead = new Map();
  for (const e of eventos) {
    if (!eventosPorLead.has(e.leadId)) eventosPorLead.set(e.leadId, []);
    eventosPorLead.get(e.leadId).push(e);
  }
  return { leads, eventosPorLead };
}

const calcular = () => calcularEscopo({ ...cenario(), deTs: DE, ateTs: ATE, agora: AGORA, incluirListas: true });

test("volumes do período", () => {
  const { volume } = calcular();
  assert.equal(volume.leadsRecebidos, 5); // 6 e 7 foram criados antes
  assert.equal(volume.contatados, 5);
  assert.equal(volume.comPrimeiraResposta, 4); // 1, 2, 3, 5
  assert.equal(volume.qualificados, 3); // 1, 3 e o 2, que pulou a coluna
  assert.equal(volume.qualificadosSemAgendamento, 1); // 3
  assert.equal(volume.reunioesMarcadas, 4); // 1, 2 (duas vezes), 6
  assert.equal(volume.remarcacoes, 1);
  assert.equal(volume.reunioesMarcadasNovas, 3);
  assert.equal(volume.leadsComReuniaoMarcada, 3);
  assert.equal(volume.reunioesRealizadas, 2); // 1 e 2
  assert.equal(volume.fechados, 1);
  // O único lead perdido tem o motivo "Sem interesse": vai para esse cartão.
  assert.equal(volume.desqualificados, 0);
  assert.equal(volume.semInteresse, 1);
});

test("a falta de um lead agendado antes do período não entra na taxa", () => {
  const { volume } = calcular();
  assert.equal(volume.naoRealizadas, 1); // só o lead 2; o 7 foi agendado antes do período
  assert.equal(volume.entradasEmRemarcacao, 2); // 2 e 7 entraram na coluna
  assert.equal(volume.remarcacoesRecuperadas, 1);
  assert.equal(volume.remarcacoesRecuperadasERealizadas, 1);
});

test("taxas", () => {
  const { taxas } = calcular();
  assert.equal(taxas.qualificacao, 60); // 3 de 5
  assert.equal(taxas.qualificadoParaAgendado, 66.7); // 2 de 3
  assert.equal(taxas.comparecimento, 50); // 2 de 4
  assert.equal(taxas.naoRealizacao, 25); // 1 de 4
  assert.equal(taxas.emAberto, 25); // 1 de 4
  assert.equal(taxas.remarcacaoRecuperada, 50); // 1 de 2
  assert.equal(taxas.reuniaoParaFechamento, 50); // 1 de 2
  assert.equal(taxas.conversaoFinal, 20); // 1 de 5
});

test("sem base de cálculo a taxa é nula, não zero", () => {
  const r = calcularEscopo({ leads: [], eventosPorLead: new Map(), deTs: DE, ateTs: ATE, agora: AGORA });
  assert.equal(r.taxas.comparecimento, null);
  assert.equal(r.taxas.conversaoFinal, null);
  assert.equal(r.tempos.atePrimeiraMensagem.medianaSeg, null);
});

test("tempos", () => {
  const { tempos } = calcular();
  // Criação em +1h; primeira mensagem em +2h, +3h, +2h, +2h, +2h.
  assert.equal(tempos.atePrimeiraMensagem.amostras, 5);
  assert.equal(tempos.atePrimeiraMensagem.medianaCorridaSeg, HORA);
  // Respostas: 2h (lead 1), 6h (2), 1h (3), 3h (5).
  assert.equal(tempos.atePrimeiraResposta.amostras, 4);
  assert.equal(tempos.atePrimeiraResposta.medianaCorridaSeg, 2.5 * HORA);
  // Qualificação ao agendamento: 4h (lead 1) e 2h (lead 2).
  assert.equal(tempos.daQualificacaoAoAgendamento.amostras, 2);
  assert.equal(tempos.daQualificacaoAoAgendamento.mediaCorridaSeg, 3 * HORA);
});

test("etiquetas, motivos e listas", () => {
  const r = calcular();
  assert.deepEqual(r.etiquetas.noShow, { total: 1, emUso: true });
  assert.deepEqual(r.etiquetas.confirmadas, { total: 0, emUso: false });
  assert.deepEqual(r.desqualificadosPorMotivo, [{ motivo: "Sem interesse", total: 1, semInteresse: true }]);
  assert.deepEqual(r.listas.reunioesEmAberto.map((l) => l.id), [6]);
  assert.deepEqual(r.listas.leadsParados.map((l) => l.id), [4]);
  assert.equal(r.listas.leadsDoPeriodo.length, 7);
});

test("entradas por etapa e conversão ampla", () => {
  const r = calcular();
  assert.equal(r.entradasPorEtapa.CONTATO_INICIAL, 5); // etapa de nascimento dos leads criados no período
  assert.equal(r.entradasPorEtapa.AGENDADO, 3);
  const par = r.conversaoAmpla.find((p) => p.origem === "LEAD_QUALIFICADO" && p.destino === "AGENDADO");
  assert.deepEqual(par, { origem: "LEAD_QUALIFICADO", destino: "AGENDADO", entraram: 2, chegaram: 1, taxa: 50 });
});

test("horas úteis: segunda a sexta, das 8h às 18h, no fuso do escritório", () => {
  const ts = (iso) => Date.parse(`${iso}-03:00`) / 1000;
  // Sexta 19h até segunda 9h: só a primeira hora de segunda conta.
  assert.equal(segundosUteis(ts("2026-10-02T19:00:00"), ts("2026-10-05T09:00:00")), HORA);
  // Dentro do mesmo dia útil.
  assert.equal(segundosUteis(ts("2026-10-05T09:15:00"), ts("2026-10-05T11:45:00")), 2.5 * HORA);
  // Terça 17h até quarta 10h: uma hora na terça e duas na quarta.
  assert.equal(segundosUteis(ts("2026-10-06T17:00:00"), ts("2026-10-07T10:00:00")), 3 * HORA);
  // Sábado e domingo inteiros não contam; semana cheia soma 50 horas.
  assert.equal(segundosUteis(ts("2026-10-03T09:00:00"), ts("2026-10-04T17:00:00")), 0);
  assert.equal(segundosUteis(ts("2026-10-05T00:00:00"), ts("2026-10-12T00:00:00")), 50 * HORA);
  assert.equal(segundosUteis(ts("2026-10-05T10:00:00"), ts("2026-10-05T09:00:00")), 0);
});

test("situação da reunião: o campo decide e a movimentação é a reserva", () => {
  assert.equal(leituraDaSituacao("Realizada"), true);
  assert.equal(leituraDaSituacao("Não realizada"), false);
  assert.equal(leituraDaSituacao("No-show"), false);
  assert.equal(leituraDaSituacao("No-show (falta do cliente)"), false);
  assert.equal(leituraDaSituacao("Cancelada pelo cliente"), false);
  assert.equal(leituraDaSituacao("Falha interna do escritório"), false);
  assert.equal(leituraDaSituacao("Agendada"), null);
  assert.equal(leituraDaSituacao("Confirmada"), null);
  assert.equal(leituraDaSituacao("Remarcada"), null);
  assert.equal(leituraDaSituacao(""), null);

  const calcularCom = (leads, eventos) => {
    const eventosPorLead = new Map();
    for (const e of eventos) eventosPorLead.set(e.leadId, [...(eventosPorLead.get(e.leadId) || []), e]);
    return calcularEscopo({ leads, eventosPorLead, deTs: DE, ateTs: ATE, agora: AGORA });
  };
  const eventos = [
    // Lead 1: foi para o Farmer, mas o campo diz que a reunião não aconteceu.
    ev(1, 2 * HORA, "LEAD_QUALIFICADO", "AGENDADO"), ev(1, 5 * HORA, "AGENDADO", "PROTOCOLO_FARMER"),
    // Lead 2: foi para Remarcação, mas o campo diz que a reunião aconteceu.
    ev(2, 2 * HORA, "LEAD_QUALIFICADO", "AGENDADO"), ev(2, 5 * HORA, "AGENDADO", "REMARCACAO"),
    // Lead 3: campo vazio, vale a movimentação (realizada).
    ev(3, 2 * HORA, "LEAD_QUALIFICADO", "AGENDADO"), ev(3, 5 * HORA, "AGENDADO", "FECHADO"),
    // Lead 4: campo sem conclusão, vale a movimentação (não realizada).
    ev(4, 2 * HORA, "LEAD_QUALIFICADO", "AGENDADO"), ev(4, 5 * HORA, "AGENDADO", "REMARCACAO"),
  ];
  const leads = [
    lead(1, "PROTOCOLO_FARMER", { situacaoDaReuniao: "Não realizada" }),
    lead(2, "REMARCACAO", { situacaoDaReuniao: "Realizada" }),
    lead(3, "FECHADO", { situacaoDaReuniao: "" }),
    lead(4, "REMARCACAO", { situacaoDaReuniao: "Remarcada" }),
  ];
  const r = calcularCom(leads, eventos);
  assert.deepEqual([r.volume.reunioesMarcadas, r.volume.reunioesRealizadas, r.volume.naoRealizadas], [4, 2, 2]);
  assert.equal(r.taxas.comparecimento, 50);
  assert.deepEqual([r.registros.situacaoDaReuniao.desfechosPeloCampo, r.registros.situacaoDaReuniao.desfechosDivergentes], [2, 2]);
});

test("reuniões do lead: desfecho e critério de cada agendamento", () => {
  const eventos = [
    ev(1, 1 * HORA, "LEAD_QUALIFICADO", "AGENDADO"),
    ev(1, 2 * HORA, "AGENDADO", "REMARCACAO"),
    ev(1, 3 * HORA, "REMARCACAO", "AGENDADO"),
    ev(1, 4 * HORA, "AGENDADO", "REMARCACAO"),
    ev(1, 5 * HORA, "REMARCACAO", "AGENDADO"),
  ];
  const r = reunioesDoLead(lead(1, "AGENDADO", { situacaoDaReuniao: "Realizada" }), eventos);
  assert.deepEqual(r.map((x) => x.resultado), ["Não realizada", "Realizada", "Em aberto"]);
  assert.equal(r[0].criterio, "movimentação entre colunas");
  assert.match(r[1].criterio, /campo Situação da reunião/);
  assert.equal(r[1].divergente, true);
  assert.equal(r[1].veioDeRemarcacao, true);
});

test("quem pula Contato Iniciado ou Em Qualificação conta como contatado e como respondido", () => {
  const calcularCom = (leads, eventos) => {
    const eventosPorLead = new Map();
    for (const e of eventos) eventosPorLead.set(e.leadId, [...(eventosPorLead.get(e.leadId) || []), e]);
    return calcularEscopo({ leads, eventosPorLead, deTs: DE, ateTs: ATE, agora: AGORA });
  };
  const fora = { criadoEm: DE - 10 * DIA }; // criado antes do período
  const leads = [
    lead(1, "LEAD_QUALIFICADO", fora), // Contato Iniciado -> Lead Qualificado: respondeu
    lead(2, "AGENDADO", fora), // Contato Inicial -> Agendado: contatado e respondeu
    lead(3, "DESQUALIFICADO", fora), // Contato Iniciado -> Desqualificado: não respondeu
    lead(4, "EM_QUALIFICACAO", fora), // caminho normal
    lead(5, "AGENDADO", fora), // Lead Qualificado -> Agendado: nada a contar aqui
    lead(6, "EM_QUALIFICACAO"), // nasceu em Em Qualificação, no período, sem eventos
  ];
  const eventos = [
    ev(1, HORA, "CONTATO_INICIADO", "LEAD_QUALIFICADO"),
    ev(2, HORA, "CONTATO_INICIAL", "AGENDADO"),
    ev(3, HORA, "CONTATO_INICIADO", "DESQUALIFICADO"),
    ev(4, HORA, "CONTATO_INICIAL", "CONTATO_INICIADO"), ev(4, 2 * HORA, "CONTATO_INICIADO", "EM_QUALIFICACAO"),
    ev(5, HORA, "LEAD_QUALIFICADO", "AGENDADO"),
  ];
  const v = calcularCom(leads, eventos).volume;
  assert.equal(v.contatados, 3); // 2, 4 e 6
  assert.equal(v.comPrimeiraResposta, 4); // 1, 2, 4 e 6
});

test("acontecimentos do dia seguem as mesmas regras dos cartões", () => {
  const leads = [lead(1, "FECHADO"), lead(2, "REMARCACAO"), lead(3, "AGENDADO"), lead(4, "AGENDADO")];
  const eventos = [
    ev(1, HORA, "LEAD_QUALIFICADO", "AGENDADO"), ev(1, 3 * HORA, "AGENDADO", "FECHADO"),
    ev(2, 2 * HORA, "AGENDADO", "REMARCACAO"),
    ev(3, 4 * HORA, "REMARCACAO", "AGENDADO"),
    ev(4, 5 * HORA, "EM_AGENDAMENTO", "AGENDADO"),
  ];
  const eventosPorLead = new Map();
  for (const e of eventos) eventosPorLead.set(e.leadId, [...(eventosPorLead.get(e.leadId) || []), e]);
  const r = calcularEscopo({ leads, eventosPorLead, deTs: DE, ateTs: ATE, agora: AGORA, incluirAcontecimentos: true });
  assert.deepEqual(
    r.acontecimentos.map((a) => `${a.leadId}:${a.tipo}`),
    ["1:agendamento", "2:naoRealizada", "1:realizada", "1:contrato", "3:reagendamento", "4:agendamento"],
  );
  assert.equal(r.acontecimentos.filter((a) => a.tipo.endsWith("agendamento")).length, r.volume.reunioesMarcadas);
  assert.equal(r.acontecimentos.filter((a) => a.tipo === "realizada").length, r.volume.reunioesRealizadas);
  assert.equal(calcularEscopo({ leads, eventosPorLead, deTs: DE, ateTs: ATE, agora: AGORA }).acontecimentos, undefined);
});

test("saída de Agendado para a coluna Reunião Realizada conta como reunião realizada", () => {
  const leads = [lead(91, "REUNIAO_REALIZADA")];
  const eventos = [ev(91, 1 * HORA, "EM_AGENDAMENTO", "AGENDADO"), ev(91, 2 * DIA, "AGENDADO", "REUNIAO_REALIZADA")];
  const r = calcularEscopo({ leads, eventosPorLead: new Map([[91, eventos]]), deTs: DE, ateTs: ATE, agora: AGORA });
  assert.equal(r.volume.reunioesRealizadas, 1);
  assert.equal(r.volume.realizadasDaCoorte, 1);
  assert.equal(r.taxas.comparecimento, 100);
});
