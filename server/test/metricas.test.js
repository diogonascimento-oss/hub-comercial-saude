// Testes do cálculo de indicadores com um cenário pequeno, conferido à mão.
import test from "node:test";
import assert from "node:assert/strict";
import { calcularEscopo } from "../metricas.js";

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
  assert.equal(volume.desqualificados, 1);
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
  assert.equal(tempos.atePrimeiraMensagem.medianaSeg, HORA);
  // Respostas: 2h (lead 1), 6h (2), 1h (3), 3h (5).
  assert.equal(tempos.atePrimeiraResposta.amostras, 4);
  assert.equal(tempos.atePrimeiraResposta.medianaSeg, 2.5 * HORA);
  // Qualificação ao agendamento: 4h (lead 1) e 2h (lead 2).
  assert.equal(tempos.daQualificacaoAoAgendamento.amostras, 2);
  assert.equal(tempos.daQualificacaoAoAgendamento.mediaSeg, 3 * HORA);
});

test("etiquetas, motivos e listas", () => {
  const r = calcular();
  assert.deepEqual(r.etiquetas.noShow, { total: 1, emUso: true });
  assert.deepEqual(r.etiquetas.confirmadas, { total: 0, emUso: false });
  assert.deepEqual(r.desqualificadosPorMotivo, [{ motivo: "Sem interesse", total: 1 }]);
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
