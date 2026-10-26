import { test } from "node:test";
import assert from "node:assert/strict";
import { mensagensDosEventos, resumirMensagens } from "../mensagens.js";

const ev = (id, type, ts, autor = 0, msgId = id) => ({ id: String(id), type, created_at: ts, created_by: autor, value_after: [{ message: { id: `m${msgId}`, origin: "waba" } }] });

test("ordena, tira repetidas e identifica quem enviou", () => {
  const usuarios = new Map([[7, "Bianca"]]);
  const m = mensagensDosEventos(
    [ev(3, "outgoing_chat_message", 300, 7), ev(1, "incoming_chat_message", 100), ev(9, "incoming_chat_message", 100, 0, 1), ev(2, "outgoing_chat_message", 150, 0), ev(4, "lead_status_changed", 120)],
    usuarios,
  );
  assert.deepEqual(m.map((x) => [x.ts, x.direcao, x.autor]), [[100, "recebida", "cliente"], [150, "enviada", "robô ou automação"], [300, "enviada", "Bianca"]]);
});

test("tempo de resposta e cliente aguardando", () => {
  const m = mensagensDosEventos([
    ev(1, "incoming_chat_message", 1000),
    ev(2, "incoming_chat_message", 1100),
    ev(3, "outgoing_chat_message", 1600, 7),
    ev(4, "incoming_chat_message", 5000),
  ]);
  const r = resumirMensagens(m, 8600);
  assert.equal(r.recebidas, 3);
  assert.equal(r.enviadasPelaEquipe, 1);
  assert.equal(r.respostas, 1);
  assert.equal(r.medianaRespostaSeg, 600);
  assert.equal(r.aguardandoDesde, 5000);
  assert.equal(r.aguardandoSeg, 3600);
});

test("sem mensagem pendente quando a última é da equipe", () => {
  const r = resumirMensagens(mensagensDosEventos([ev(1, "incoming_chat_message", 10), ev(2, "outgoing_chat_message", 20, 0)]), 100);
  assert.equal(r.aguardandoDesde, null);
  assert.equal(r.enviadasPorRobo, 1);
});
