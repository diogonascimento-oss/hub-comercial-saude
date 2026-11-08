// Testes da busca de nomes do Meta (campanhas, conjuntos e anúncios por ID).
import test from "node:test";
import assert from "node:assert/strict";
import { buscarNomesDoMeta } from "../meta.js";

function comAmbiente(variaveis, fn) {
  const antes = { ...process.env };
  Object.assign(process.env, variaveis);
  for (const k of Object.keys(variaveis)) if (variaveis[k] === undefined) delete process.env[k];
  return Promise.resolve(fn()).finally(() => {
    for (const k of ["META_TOKEN", "META_CONTA_ANUNCIOS", "META_VERSAO_API"]) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  });
}

test("sem token e conta configurados, não consulta o Meta", async () => {
  await comAmbiente({ META_TOKEN: undefined, META_CONTA_ANUNCIOS: undefined }, async () => {
    const get = async () => assert.fail("não devia consultar");
    assert.deepEqual(await buscarNomesDoMeta(get), {});
  });
});

test("busca campanhas, conjuntos e anúncios, com paginação, e devolve ID -> nome", async () => {
  await comAmbiente({ META_TOKEN: "segredo", META_CONTA_ANUNCIOS: "123" }, async () => {
    const chamadas = [];
    const respostas = {
      "https://graph.facebook.com/v23.0/act_123/campaigns": { data: [{ id: "1", name: "Campanha A" }], paging: { next: "https://graph.facebook.com/proxima-campanhas" } },
      "https://graph.facebook.com/proxima-campanhas": { data: [{ id: "2", name: "Campanha B" }] },
      "https://graph.facebook.com/v23.0/act_123/adsets": { data: [{ id: "3", name: "Conjunto C" }] },
      "https://graph.facebook.com/v23.0/act_123/ads": { data: [{ id: "4", name: "Anúncio D" }, { id: "5" }] }, // sem nome: ignorado
    };
    const get = async (url, opcoes) => {
      chamadas.push({ url, params: opcoes.params, autorizacao: opcoes.headers.Authorization });
      return { data: respostas[url] };
    };
    assert.deepEqual(await buscarNomesDoMeta(get), { 1: "Campanha A", 2: "Campanha B", 3: "Conjunto C", 4: "Anúncio D" });
    assert.equal(chamadas.length, 4);
    assert.deepEqual(chamadas[0].params, { fields: "id,name", limit: 500 });
    assert.equal(chamadas[1].params, undefined); // a próxima página já traz os parâmetros
    assert.ok(chamadas.every((c) => c.autorizacao === "Bearer segredo"));
  });
});

test("erro do Meta vira mensagem sem expor o token", async () => {
  await comAmbiente({ META_TOKEN: "segredo", META_CONTA_ANUNCIOS: "act_123" }, async () => {
    const get = async () => {
      const erro = new Error("falhou com segredo");
      erro.response = { data: { error: { message: "Token expirado" } } };
      throw erro;
    };
    await assert.rejects(() => buscarNomesDoMeta(get), (e) => /Token expirado/.test(e.message) && !/segredo/.test(e.message) && e.status === 502);
  });
});
