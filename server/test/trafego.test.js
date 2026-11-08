// Testes da análise de tráfego e do cálculo de custo.
import test from "node:test";
import assert from "node:assert/strict";
import { analisarTrafego, consolidarLeads, agruparPorCampanhaDoNucleo, mesclarCusto, combinarSemanas, compararSemanas, associarGastoDoMeta, associarInvestimentoPorCampanha } from "../trafego.js";

const DE = 1_000_000;
const ATE = DE + 7 * 86400;
const lead = (id, conjunto, anuncio, telefone, extras = {}) => ({
  id, nome: `Lead ${id}`, telefone, campanha: "IR-Q", etapa: "CONTATO_INICIAL",
  origem: { campanhaMeta: "Campanha", conjunto, anuncio }, criadoEm: DE + 10, ...extras,
});
const ev = (leadId, de, para, ts) => ({ leadId, de, para, ts: DE + ts });

function cenario() {
  const leads = [
    lead(1, "Pernambuco", "AD 01", "5581999990001"),
    lead(2, "Pernambuco", "AD 01", "5581999990002"),
    lead(3, "Sudeste", "AD 02", "5511999990003"),
    lead(4, "", "", "123"), // sem origem e com telefone fora do padrão
    lead(5, "Sudeste", "AD 02", "5521999990005", { criadoEm: DE - 500 }), // criado antes do período
  ];
  const eventos = [
    ev(1, "CONTATO_INICIAL", "CONTATO_INICIADO", 100), ev(1, "CONTATO_INICIADO", "EM_QUALIFICACAO", 200),
    ev(1, "EM_QUALIFICACAO", "LEAD_QUALIFICADO", 300), ev(1, "LEAD_QUALIFICADO", "EM_AGENDAMENTO", 310),
    ev(1, "EM_AGENDAMENTO", "AGENDADO", 400), ev(1, "AGENDADO", "PROTOCOLO_FARMER", 500), ev(1, "PROTOCOLO_FARMER", "FECHADO", 600),
    ev(2, "CONTATO_INICIAL", "CONTATO_INICIADO", 100),
    ev(3, "CONTATO_INICIAL", "CONTATO_INICIADO", 100), ev(3, "CONTATO_INICIADO", "EM_QUALIFICACAO", 200), ev(3, "EM_QUALIFICACAO", "EM_AGENDAMENTO", 300),
    ev(5, "EM_AGENDAMENTO", "AGENDADO", 100),
  ];
  const eventosPorLead = new Map();
  for (const e of eventos) eventosPorLead.set(e.leadId, [...(eventosPorLead.get(e.leadId) || []), e]);
  return { leads, eventosPorLead, deTs: DE, ateTs: ATE };
}

test("somente leads criados no período", () => {
  const a = analisarTrafego({ ...cenario(), apenasNovos: true });
  assert.equal(a.totalLeads, 4);
  assert.equal(a.totalQualificados, 2); // 1 e o 3, que pulou a coluna
  assert.equal(a.totalReuniao, 1);
  assert.equal(a.totalContratoFechado, 1);
  assert.equal(a.leadsSemOrigem, 1);
  assert.equal(a.leadsSemTelefoneReconhecido, 1);
  const pe = a.porConjunto.find((g) => g.grupo === "Pernambuco");
  assert.deepEqual([pe.totalLeads, pe.qualificados, pe.percentualQualificados, pe.contratoFechado], [2, 1, 50, 1]);
  assert.deepEqual(a.porEstado.map((g) => [g.grupo, g.totalLeads]), [["PE", 2], ["SP", 1], ["(não informado)", 1]]);
  const engajamento = a.engajamentoPorConjunto.find((g) => g.grupo === "Pernambuco");
  assert.deepEqual(engajamento.pontos.map((p) => p.quantidade), [2, 1, 1, 1, 1]);
});

test("com todos os leads movimentados, entra o lead antigo", () => {
  const a = analisarTrafego({ ...cenario(), apenasNovos: false });
  assert.equal(a.totalLeads, 5);
  assert.equal(a.totalReuniao, 2);
});

test("custo: orçamento diário vezes os dias da semana", () => {
  const a = analisarTrafego({ ...cenario(), apenasNovos: true });
  const grupos = mesclarCusto(a.porAnuncioEConjunto, [{ grupo: "AD 01 — Pernambuco", orcamentoDiario: 20 }], "2026-09-21", "2026-09-27");
  const comCusto = grupos.find((g) => g.grupo === "AD 01 — Pernambuco");
  assert.deepEqual([comCusto.custoTotal, comCusto.custoPorLead, comCusto.custoPorQualificado, comCusto.custoPorContratoFechado], [140, 70, 140, 140]);
  const semCusto = grupos.find((g) => g.grupo === "AD 02 — Sudeste");
  assert.equal(semCusto.custoTotal, null);
  assert.equal(semCusto.custoPorLead, null);
});

test("soma e comparação de semanas", () => {
  const analise = analisarTrafego({ ...cenario(), apenasNovos: true });
  const custo = { porAnuncio: [{ grupo: "AD 01 — Pernambuco", orcamentoDiario: 20 }] };
  const s1 = { inicio: "2026-09-14", fim: "2026-09-20", analise, custo };
  const s2 = { inicio: "2026-09-21", fim: "2026-09-27", analise, custo: { porAnuncio: [{ grupo: "AD 01 — Pernambuco", orcamentoDiario: 40 }] } };

  const soma = combinarSemanas([s1, s2]);
  assert.equal(soma.totalLeads, 8);
  assert.equal(soma.todasComCusto, true);
  const g = soma.porAnuncioEConjunto.find((x) => x.grupo === "AD 01 — Pernambuco");
  assert.deepEqual([g.totalLeads, g.percentualQualificados, g.custoTotal, g.custoPorLead], [4, 50, 420, 105]);
  assert.equal(combinarSemanas([s1, { ...s2, custo: null }]).todasComCusto, false);

  const c = compararSemanas(s2, s1);
  assert.deepEqual(c.leads, { atual: 4, anterior: 4, variacaoPct: 0 });
  assert.deepEqual(c.custoPorLead, { atual: 70, anterior: 35, variacaoPct: 100 });
  assert.equal(compararSemanas({ ...s2, custo: null }, s1).custoPorLead, null);
});

test("valor investido do Meta: associação pelo nome e precedência sobre o orçamento", () => {
  const grupos = [
    { grupo: "AD 01 — Pernambuco", totalLeads: 4, qualificados: 2, contratoFechado: 1 },
    { grupo: "AD 02 — Bahia", totalLeads: 2, qualificados: 0, contratoFechado: 0 },
  ];
  const linhas = [
    { campanha: "C", conjunto: "pernambuco ", anuncio: "ad  01", gasto: 100.5 },
    { campanha: "C", conjunto: "Pernambuco", anuncio: "AD 01", gasto: 19.5 },
    { campanha: "C", conjunto: "Ceará", anuncio: "AD 09", gasto: 30 },
    { campanha: "C", conjunto: "Ceará", anuncio: "AD 10", gasto: 0 },
  ];
  const r = associarGastoDoMeta(grupos, linhas);
  assert.deepEqual(r.porGrupo, [{ grupo: "AD 01 — Pernambuco", gastoReal: 120 }]);
  assert.deepEqual([r.gastoTotal, r.gastoAssociado], [150, 120]);
  assert.deepEqual(r.semLeads, [{ anuncio: "AD 09", conjunto: "Ceará", campanha: "C", gasto: 30 }]);

  // O valor investido prevalece sobre o orçamento diário; sem ele, vale o orçamento.
  const custo = [
    { grupo: "AD 01 — Pernambuco", orcamentoDiario: 50, gastoReal: 120 },
    { grupo: "AD 02 — Bahia", orcamentoDiario: 10, gastoReal: null },
  ];
  const [a, b] = mesclarCusto(grupos, custo, "2026-09-14", "2026-09-20");
  assert.deepEqual([a.custoTotal, a.custoPorLead, a.custoPorContratoFechado], [120, 30, 120]);
  assert.equal(b.custoTotal, 70);
});

test("campanha sem rastreio de anúncio recebe rótulo próprio e não conta como sem origem", () => {
  const leads = [
    { ...lead(1, "", "", "81999990001"), campanha: "IR-W" },
    { ...lead(2, "Pernambuco", "AD 01", "81999990002"), campanha: "IR-W" },
    { ...lead(3, "", "", "81999990003"), campanha: "IR-Q" },
  ];
  const a = analisarTrafego({ leads, eventosPorLead: new Map(), deTs: DE, ateTs: ATE });
  assert.deepEqual([a.leadsSemOrigem, a.leadsSemRastreioDeAnuncio], [1, 1]);
  assert.deepEqual(
    a.porConjunto.map((g) => g.grupo).sort(),
    ["(não informado)", "Pernambuco", "WhatsApp (anúncio não rastreado)"],
  );
});

test("por campanha do Meta: reuniões realizadas e valor investido pelo nome da campanha", () => {
  const a = analisarTrafego({ ...cenario(), apenasNovos: true });
  const campanha = a.porCampanhaMeta.find((g) => g.grupo === "Campanha");
  assert.deepEqual([campanha.totalLeads, campanha.qualificados, campanha.reuniao, campanha.realizadas, campanha.contratoFechado], [4, 2, 1, 1, 1]);
  const comInvestimento = associarInvestimentoPorCampanha(a.porCampanhaMeta, [
    { campanha: " campanha ", gasto: 100.5 },
    { campanha: "CAMPANHA", gasto: 20 },
    { campanha: "Outra área do escritório", gasto: 999 },
  ]);
  assert.equal(comInvestimento.find((g) => g.grupo === "Campanha").investido, 120.5);
  assert.equal(associarInvestimentoPorCampanha([{ grupo: "Sem gasto" }], []).at(0).investido, null);
  assert.equal(comInvestimento.length, a.porCampanhaMeta.length);
});

// --- Resumo: colunas por campanha do núcleo -------------------------------------------

test("colunas por campanha do núcleo: uma por campanha, na ordem da configuração e com o título do quadro", () => {
  const leads = [
    lead(1, "A", "AD 01", "5581999990001", { campanha: "REA-Q" }),
    lead(2, "A", "AD 01", "5581999990002", { campanha: "IR-Q" }),
    lead(3, "A", "AD 01", "5581999990003", { campanha: "IR-Q" }),
    lead(4, "", "", "5581999990004", { campanha: "REA-Q", origem: { campanhaMeta: "", conjunto: "", anuncio: "" } }), // sem campanha do Meta
    lead(5, "A", "AD 01", "5581999990005", { campanha: "IR-W" }),
  ];
  const consolidados = consolidarLeads({ leads, eventosPorLead: new Map(), deTs: DE, ateTs: ATE, apenasNovos: true });
  const grupos = agruparPorCampanhaDoNucleo(consolidados);
  assert.deepEqual(grupos.map((g) => [g.grupo, g.totalLeads]), [["IR", 2], ["IR - WhatsApp (Novo Número)", 1], ["Reajuste", 2]]);
  // Cada coluna traz os leads dela, inclusive o que não tem campanha do Meta: não existe "(não informado)" aqui.
  assert.deepEqual(grupos[2].leads.map((l) => l.leadId).sort(), [1, 4]);
  assert.ok(grupos.every((g) => g.grupo !== "(não informado)"));
});

test("colunas por campanha do núcleo: só entram as campanhas que têm leads", () => {
  const consolidados = consolidarLeads({ leads: [lead(1, "A", "AD 01", "5581999990001", { campanha: "REA-Q" })], eventosPorLead: new Map(), deTs: DE, ateTs: ATE, apenasNovos: true });
  assert.deepEqual(agruparPorCampanhaDoNucleo(consolidados).map((g) => g.grupo), ["Reajuste"]);
  assert.deepEqual(agruparPorCampanhaDoNucleo([]), []);
});
