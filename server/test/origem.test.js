// Testes da leitura da origem dos leads (campanha do Meta, conjunto e anúncio).
import test from "node:test";
import assert from "node:assert/strict";
import { camposDeOrigemEquivalentes, normalizarLeads } from "../leads.js";
import { CAMPOS } from "../config.js";

const mapeamento = {
  campanhaPorFunil: new Map([[1, "REA-Q"]]),
  etapaPorColuna: new Map([["1:10", { chave: "CONTATO_INICIAL", nome: "Contato Inicial" }]]),
};
const bruto = (id, campos) => ({
  id,
  pipeline_id: 1,
  status_id: 10,
  name: `Lead ${id}`,
  created_at: 1_700_000_000 + id,
  custom_fields_values: [{ field_code: "PHONE", field_name: "Telefone", values: [{ value: `8499999${String(id).padStart(4, "0")}` }] }, ...campos],
});
const campo = (field_id, valor) => ({ field_id, field_name: `Campo ${field_id}`, values: [{ value: valor }] });

const definicoes = [
  { id: CAMPOS.campanhaMeta, name: "Campanha Meta" },
  { id: CAMPOS.conjunto, name: "Conjunto" },
  { id: CAMPOS.anuncio, name: "Anúncio" },
  { id: 900001, name: "REA: Campanha Meta" }, // campo novo, com prefixo da campanha
  { id: 900002, name: "conjunto" }, // mesmo nome, outro ID
  { id: 900003, name: "Descrição" },
];

test("campos com o mesmo nome dos de origem, ignorando prefixo, acento e maiúsculas", () => {
  assert.deepEqual(camposDeOrigemEquivalentes(definicoes), { campanhaMeta: [900001], conjunto: [900002], anuncio: [] });
  assert.deepEqual(camposDeOrigemEquivalentes([]), { campanhaMeta: [], conjunto: [], anuncio: [] });
});

test("lead com a campanha só no campo novo passa a mostrar a campanha", () => {
  const opcoes = { camposDeOrigem: camposDeOrigemEquivalentes(definicoes) };
  const antigo = bruto(1, [campo(CAMPOS.campanhaMeta, "REA - Cadastro"), campo(CAMPOS.conjunto, "Conjunto 1")]);
  const novo = bruto(2, [campo(900001, "REA - Cadastro novo"), campo(900002, "Conjunto 2")]);
  const sem = bruto(3, [campo(900003, "texto")]);

  const [a, n, v] = normalizarLeads([antigo, novo, sem], new Map(), mapeamento, opcoes);
  assert.equal(a.origem.campanhaMeta, "REA - Cadastro");
  assert.equal(n.origem.campanhaMeta, "REA - Cadastro novo");
  assert.equal(n.origem.conjunto, "Conjunto 2");
  assert.equal(v.origem.campanhaMeta, "");
  // Sem as opções, o comportamento é o de antes: só o campo configurado.
  const [, semOpcao] = normalizarLeads([antigo, novo], new Map(), mapeamento);
  assert.equal(semOpcao.origem.campanhaMeta, "");
});

test("o campo configurado vale sobre os equivalentes e as UTMs continuam como reserva", () => {
  const opcoes = { camposDeOrigem: camposDeOrigemEquivalentes(definicoes) };
  const ambos = bruto(1, [campo(CAMPOS.campanhaMeta, "Configurado"), campo(900001, "Equivalente")]);
  const utm = bruto(2, [{ field_id: 777, field_code: "UTM_CAMPAIGN", field_name: "utm_campaign", values: [{ value: "Da UTM" }] }]);
  const [a, u] = normalizarLeads([ambos, utm], new Map(), mapeamento, opcoes);
  assert.equal(a.origem.campanhaMeta, "Configurado");
  assert.equal(u.origem.campanhaMeta, "Da UTM");
});
