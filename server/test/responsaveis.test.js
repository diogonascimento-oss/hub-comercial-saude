import { test } from "node:test";
import assert from "node:assert/strict";
import { nomeOficialDoResponsavel as oficial } from "../leads.js";

test("junta as variações do nome do closer", () => {
  assert.equal(oficial("closer", "Dra. Maria vasconcelos"), "Maria Vasconcelos");
  assert.equal(oficial("closer", "Maria Vasconselos"), "Maria Vasconcelos");
  assert.equal(oficial("closer", "maria"), "Maria Vasconcelos");
  assert.equal(oficial("closer", "Paula"), "Paula Caldas");
  assert.equal(oficial("closer", "  DRA PAULA CALDAS "), "Paula Caldas");
  assert.equal(oficial("closer", "Fabiana Arnaud"), "Fabianna Arnaud");
});

test("mantém nomes fora da lista e campos vazios", () => {
  assert.equal(oficial("closer", "Joana Lima"), "Joana Lima");
  assert.equal(oficial("sdr", "Diogo"), "Diogo");
  assert.equal(oficial("closer", ""), "");
  assert.equal(oficial("closer", null), "");
});

import { numeroDoTexto } from "../leads.js";
test("número em texto digitado (mensalidade)", () => {
  assert.equal(numeroDoTexto("R$ 1.500"), 1500);
  assert.equal(numeroDoTexto("850,00"), 850);
  assert.equal(numeroDoTexto("1.500,50"), 1500.5);
  assert.equal(numeroDoTexto("1200 reais"), 1200);
  assert.equal(numeroDoTexto("sem valor"), null);
});
