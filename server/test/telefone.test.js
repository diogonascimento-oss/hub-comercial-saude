// Testes da comparação de telefones e da deduplicação de leads.
import test from "node:test";
import assert from "node:assert/strict";
import { chaveDoTelefone, normalizarLeads } from "../leads.js";

test("o mesmo celular com e sem o nono dígito tem a mesma chave", () => {
  assert.equal(chaveDoTelefone("(84) 8635-5452"), "84986355452");
  assert.equal(chaveDoTelefone("(84) 98635-5452"), "84986355452");
  assert.equal(chaveDoTelefone("(62) 8607-2126"), chaveDoTelefone("(62) 98607-2126"));
});

test("com e sem código do país, com zero na frente e com pontuação", () => {
  const base = chaveDoTelefone("84986355452");
  assert.equal(chaveDoTelefone("+55 84 98635-5452"), base);
  assert.equal(chaveDoTelefone("5584986355452"), base);
  assert.equal(chaveDoTelefone("558486355452"), base); // +55, sem o nono dígito
  assert.equal(chaveDoTelefone("084 98635-5452"), base);
});

test("DDD 55 não é confundido com o código do país", () => {
  assert.equal(chaveDoTelefone("(55) 99123-4567"), "55991234567");
  assert.equal(chaveDoTelefone("+55 55 99123-4567"), "55991234567");
});

test("telefone fixo e números sem DDD", () => {
  assert.equal(chaveDoTelefone("(84) 3222-1234"), "8432221234"); // fixo: não ganha o 9
  assert.equal(chaveDoTelefone("8635-5452"), "986355452"); // celular antigo sem DDD
  assert.equal(chaveDoTelefone("98635-5452"), "986355452");
  assert.equal(chaveDoTelefone(""), "");
  assert.equal(chaveDoTelefone(null), "");
});

test("números diferentes continuam diferentes", () => {
  assert.notEqual(chaveDoTelefone("(84) 98635-5452"), chaveDoTelefone("(84) 98635-5453"));
  assert.notEqual(chaveDoTelefone("(84) 98635-5452"), chaveDoTelefone("(85) 98635-5452"));
});

// --- Deduplicação ---------------------------------------------------------------
const mapeamento = {
  campanhaPorFunil: new Map([[1, "REA-Q"], [2, "IR-Q"]]),
  etapaPorColuna: new Map([
    ["1:10", { chave: "CONTATO_INICIAL", nome: "Contato Inicial" }],
    ["2:20", { chave: "CONTATO_INICIAL", nome: "Contato Inicial" }],
  ]),
};
const bruto = (id, funil, telefone, nome) => ({
  id,
  pipeline_id: funil,
  status_id: funil === 1 ? 10 : 20,
  name: nome,
  created_at: 1_700_000_000 + id,
  custom_fields_values: telefone ? [{ field_code: "PHONE", field_name: "Telefone", values: [{ value: telefone }] }] : [],
});
const ids = (leads) => leads.map((l) => l.id).sort((a, b) => a - b);

test("duplicados por nono dígito ou +55 viram um lead só, o mais recente", () => {
  const leads = normalizarLeads(
    [
      bruto(1, 1, "(84) 8635-5452", "MARLA"), // 8 dígitos
      bruto(2, 1, "(84) 98635-5452", "Marla Araújo"), // mesma pessoa
      bruto(3, 1, "+55 62 98607-2126", "Marla"),
      bruto(4, 1, "(62) 8607-2126", "Marla Rosa de Araújo"),
      bruto(5, 1, "(11) 91111-1111", "Outra pessoa"),
    ],
    new Map(),
    mapeamento,
  );
  assert.deepEqual(ids(leads), [2, 4, 5]);
  assert.equal(leads.find((l) => l.id === 2).nome, "Marla Araújo");
});

test("a mesma pessoa em campanhas diferentes continua nas duas", () => {
  const leads = normalizarLeads([bruto(1, 1, "(84) 8635-5452", "A"), bruto(2, 2, "(84) 98635-5452", "A")], new Map(), mapeamento);
  assert.deepEqual(ids(leads), [1, 2]);
});

test("telefone igual de antes e sem telefone continuam como antes", () => {
  const leads = normalizarLeads(
    [bruto(1, 1, "(84) 98635-5452", "A"), bruto(2, 1, "(84) 98635-5452", "A"), bruto(3, 1, "", "Sem telefone"), bruto(4, 1, "", "Sem telefone 2"), bruto(5, 1, "123", "Curto"), bruto(6, 1, "123", "Curto 2")],
    new Map(),
    mapeamento,
  );
  assert.deepEqual(ids(leads), [2, 3, 4, 5, 6]);
});

test("o telefone mostrado não muda, só a comparação", () => {
  const [lead] = normalizarLeads([bruto(1, 1, "(84) 8635-5452", "A")], new Map(), mapeamento);
  assert.equal(lead.telefone, "8486355452");
});
