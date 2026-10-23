import { test } from "node:test";
import assert from "node:assert/strict";
import { montarEvento, googleConfigurado } from "../google.js";

test("evento online pede Meet; presencial leva o local", () => {
  const inicio = Date.parse("2026-10-24T14:30:00-03:00") / 1000;
  const online = montarEvento({ titulo: "T", descricao: "D", inicio, duracaoMin: 60, online: true, local: "", leadId: 7, idDaReuniao: "x" });
  assert.equal(online.start.dateTime, "2026-10-24T17:30:00.000Z");
  assert.equal(online.end.dateTime, "2026-10-24T18:30:00.000Z");
  assert.equal(online.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(online.extendedProperties.private.painelLeadId, "7");
  const presencial = montarEvento({ titulo: "T", descricao: "D", inicio, duracaoMin: 45, online: false, local: "Escritório", leadId: 7, idDaReuniao: "x" });
  assert.equal(presencial.location, "Escritório");
  assert.equal(presencial.conferenceData, undefined);
});

test("sem a chave da conta de serviço, a integração fica desligada", () => {
  const antes = process.env.GOOGLE_CONTA_DE_SERVICO;
  delete process.env.GOOGLE_CONTA_DE_SERVICO;
  assert.equal(googleConfigurado(), false);
  process.env.GOOGLE_CONTA_DE_SERVICO = "não é json";
  assert.equal(googleConfigurado(), false);
  if (antes === undefined) delete process.env.GOOGLE_CONTA_DE_SERVICO;
  else process.env.GOOGLE_CONTA_DE_SERVICO = antes;
});
