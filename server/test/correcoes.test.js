import test from "node:test";
import assert from "node:assert/strict";
import { idsCorrigidosParaDentroDoPeriodo, aplicarCorrecoes } from "../leads.js";

const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const periodo = { deTs: ts("2026-11-02T00:00:00-03:00"), ateTs: ts("2026-11-06T23:59:59-03:00") };

// Reunião marcada como realizada no dia 8 e corrigida para o dia 6, às 16h02.
const correcoes = new Map([
  ["100", { eventId: "100", novaDataHora: "2026-11-06T16:02:00-03:00", novaEtapaDestino: "REUNIAO_REALIZADA" }],
]);
const buscar = (extra = {}) =>
  idsCorrigidosParaDentroDoPeriodo({ correcoesPorId: correcoes, idsJaPresentes: new Set(), idsExcluidos: new Set(), ...periodo, ...extra });

test("correção que traz para o período um evento registrado depois dele pede esse evento ao Kommo", () => {
  assert.deepEqual(buscar(), ["100"]);
});

test("evento que já veio na consulta do período não é pedido de novo", () => {
  assert.deepEqual(buscar({ idsJaPresentes: new Set(["100"]) }), []);
});

test("evento excluído não é trazido de volta", () => {
  assert.deepEqual(buscar({ idsExcluidos: new Set(["100"]) }), []);
});

test("correção com data fora do período não é pedida", () => {
  assert.deepEqual(buscar({ deTs: ts("2026-11-09T00:00:00-03:00"), ateTs: ts("2026-11-12T23:59:59-03:00") }), []);
});

test("correção só de etapa, sem nova data, não é pedida (a data original decide)", () => {
  const so_etapa = new Map([["200", { eventId: "200", novaDataHora: null, novaEtapaDestino: "AGENDADO" }]]);
  const ids = idsCorrigidosParaDentroDoPeriodo({ correcoesPorId: so_etapa, idsJaPresentes: new Set(), idsExcluidos: new Set(), ...periodo });
  assert.deepEqual(ids, []);
});

test("o evento trazido, depois de corrigido, fica com a data corrigida", () => {
  const bruto = { id: 100, created_at: ts("2026-11-08T16:02:00-03:00") };
  const [corrigido] = aplicarCorrecoes([bruto], correcoes);
  assert.equal(corrigido._ts, ts("2026-11-06T16:02:00-03:00"));
  assert.ok(corrigido._ts >= periodo.deTs && corrigido._ts <= periodo.ateTs);
});
