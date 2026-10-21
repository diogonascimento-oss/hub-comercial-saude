// Testes da ligação entre colunas do Kommo e etapas do painel.
import test from "node:test";
import assert from "node:assert/strict";
import { montarMapeamento } from "../mapeamento.js";
import { CAMPANHAS } from "../config.js";

const funil = (campanha, extras = []) => ({
  id: campanha.pipelineId,
  name: campanha.codigo,
  _embedded: { statuses: [...Object.values(campanha.etapas).map((id) => ({ id, name: `Coluna ${id}` })), ...extras] },
});

test("Reunião Realizada é localizada pelo nome e não gera pendência onde não existe", () => {
  const [irq, irw, reaq] = CAMPANHAS;
  const m = montarMapeamento([funil(irq, [{ id: 999001, name: "REUNIÃO REALIZADA" }]), funil(irw), funil(reaq)]);
  assert.equal(m.completo, true);
  assert.equal(m.etapaPorColuna.get(`${irq.pipelineId}:999001`).chave, "REUNIAO_REALIZADA");
});

test("colunas de descarte criadas pela equipe contam como Desqualificado", () => {
  const [irq, irw, reaq] = CAMPANHAS;
  const m = montarMapeamento([funil(irq, [{ id: 999101, name: "sem interesse" }]), funil(irw, [{ id: 999102, name: "DESQUALIFICADO" }]), funil(reaq)]);
  assert.equal(m.completo, true);
  assert.equal(m.etapaPorColuna.get(`${irq.pipelineId}:999101`).chave, "DESQUALIFICADO");
  assert.equal(m.etapaPorColuna.get(`${irw.pipelineId}:999102`).chave, "DESQUALIFICADO");
  assert.equal(m.etapaPorColuna.get(`${irq.pipelineId}:${irq.etapas.DESQUALIFICADO}`).extra, false);
});
