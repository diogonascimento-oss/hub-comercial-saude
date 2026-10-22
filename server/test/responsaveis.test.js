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
