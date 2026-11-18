import test from "node:test";
import assert from "node:assert/strict";
import { aplicarDatasDeCriacao } from "../leads.js";
import { calcularEscopo } from "../metricas.js";

const DIA = 86400;
const DE = 1_000_000;
const ATE = DE + 7 * DIA;
const AGORA = ATE + DIA;

const lead = (id, criadoEm) => ({
  id,
  nome: `Lead ${id}`,
  semNome: false,
  telefone: `8199999000${id}`,
  campanha: "IR-Q",
  etapa: "CONTATO_INICIADO",
  etapaNome: "CONTATO_INICIADO",
  tags: [],
  motivoPerda: "",
  criadoEm,
  atualizadoEm: AGORA - DIA,
});
const recebidos = (leads) => calcularEscopo({ leads, eventosPorLead: new Map(), deTs: DE, ateTs: ATE, agora: AGORA }).volume.leadsRecebidos;

test("a data de chegada definida pelo painel vale sobre a do Kommo e guarda a original", () => {
  const edicoes = { 1: { criadoEm: DE + DIA, usuario: "diogo@x.com", quando: "2026-11-09T10:00:00.000Z" } };
  const [editado, intacto] = aplicarDatasDeCriacao([lead(1, DE - 3 * DIA), lead(2, DE + 2 * DIA)], edicoes);
  assert.equal(editado.criadoEm, DE + DIA);
  assert.equal(editado.criadoEmOriginal, DE - 3 * DIA);
  assert.deepEqual(editado.criadoEmEditada, { usuario: "diogo@x.com", quando: "2026-11-09T10:00:00.000Z" });
  assert.equal(intacto.criadoEm, DE + 2 * DIA);
  assert.equal(intacto.criadoEmEditada, undefined);
});

test("sem edições, ou com registro inválido, os leads ficam como estão", () => {
  const leads = [lead(1, DE + DIA)];
  assert.deepEqual(aplicarDatasDeCriacao(leads, {}), leads);
  assert.deepEqual(aplicarDatasDeCriacao(leads, undefined), leads);
  assert.deepEqual(aplicarDatasDeCriacao(leads, { 1: { criadoEm: "texto" } }), leads);
});

test("lead que chegou antes do período passa a contar como recebido ao ter a data trazida para dentro", () => {
  const original = [lead(1, DE - 3 * DIA)];
  assert.equal(recebidos(original), 0);
  const editado = aplicarDatasDeCriacao(original, { 1: { criadoEm: DE + DIA } });
  assert.equal(recebidos(editado), 1);
});

test("lead que chegou dentro do período deixa de contar ao ter a data levada para fora", () => {
  const original = [lead(1, DE + DIA)];
  assert.equal(recebidos(original), 1);
  const editado = aplicarDatasDeCriacao(original, { 1: { criadoEm: ATE + 5 * DIA } });
  assert.equal(recebidos(editado), 0);
});
