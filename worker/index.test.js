// Testes do Worker de repasse: validação do token do Cloudflare Access e
// encaminhamento da chamada à API.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const DOMINIO = "escritorio-teste.cloudflareaccess.com";
const AUD = "aud-de-teste";
const env = { API_ORIGEM: "https://api.exemplo.test/", API_TOKEN: "segredo-da-api", ACCESS_TEAM_DOMAIN: DOMINIO, ACCESS_AUD: AUD };

const b64url = (dados) => Buffer.from(dados).toString("base64url");

const par = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const outroPar = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const jwkPublica = { ...(await crypto.subtle.exportKey("jwk", par.publicKey)), kid: "chave-1", alg: "RS256", use: "sig" };

async function emitirToken(conteudo = {}, chave = par.privateKey) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: "RS256", kid: "chave-1", typ: "JWT" }));
  const corpo = b64url(
    JSON.stringify({ iss: `https://${DOMINIO}`, aud: [AUD], exp: agora + 600, iat: agora, email: "pessoa@exemplo.test", ...conteudo }),
  );
  const assinatura = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(`${cabecalho}.${corpo}`));
  return `${cabecalho}.${corpo}.${b64url(new Uint8Array(assinatura))}`;
}

// Substitui a rede: responde às chaves do Access e registra o que chegou à API.
let chamadasNaApi = [];
globalThis.fetch = async (destino, opcoes = {}) => {
  const url = String(destino);
  if (url === `https://${DOMINIO}/cdn-cgi/access/certs`) return Response.json({ keys: [jwkPublica] });
  chamadasNaApi.push({ url, metodo: opcoes.method, cabecalhos: Object.fromEntries(new Headers(opcoes.headers)), corpo: opcoes.body });
  return Response.json({ ok: true }, { headers: { "x-interno": "nao-deve-sair" } });
};

const chamar = (caminho, { token, ...opcoes } = {}) => {
  chamadasNaApi = [];
  const headers = new Headers(opcoes.headers);
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  return worker.fetch(new Request(`https://painel.exemplo.test${caminho}`, { ...opcoes, headers }), env);
};

test("sem token do Access a chamada é recusada e não chega à API", async () => {
  const r = await chamar("/api/metrics?inicio=2026-09-01&fim=2026-09-30");
  assert.equal(r.status, 401);
  assert.equal(chamadasNaApi.length, 0);
});

test("token assinado por outra chave é recusado", async () => {
  const r = await chamar("/api/metrics", { token: await emitirToken({}, outroPar.privateKey) });
  assert.equal(r.status, 401);
  assert.equal(chamadasNaApi.length, 0);
});

test("token expirado, de outra aplicação ou de outro emissor é recusado", async () => {
  const passado = Math.floor(Date.now() / 1000) - 10;
  for (const conteudo of [{ exp: passado }, { aud: ["outra-aplicacao"] }, { iss: "https://outro.cloudflareaccess.com" }]) {
    const r = await chamar("/api/metrics", { token: await emitirToken(conteudo) });
    assert.equal(r.status, 401);
    assert.equal(chamadasNaApi.length, 0);
  }
});

test("token válido: repassa à API com o segredo e o e-mail do usuário", async () => {
  const r = await chamar("/api/metrics?inicio=2026-09-01&fim=2026-09-30", { token: await emitirToken() });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(chamadasNaApi.length, 1);
  assert.equal(chamadasNaApi[0].url, "https://api.exemplo.test/api/metrics?inicio=2026-09-01&fim=2026-09-30");
  assert.equal(chamadasNaApi[0].cabecalhos["x-api-token"], "segredo-da-api");
  assert.equal(chamadasNaApi[0].cabecalhos["x-usuario"], "pessoa@exemplo.test");
  // O segredo e os cabeçalhos internos da API não voltam ao navegador.
  assert.equal(r.headers.get("x-api-token"), null);
  assert.equal(r.headers.get("x-interno"), null);
});

test("repassa o corpo de um POST", async () => {
  const r = await chamar("/api/excluir-evento", {
    token: await emitirToken(),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId: "123" }),
  });
  assert.equal(r.status, 200);
  assert.equal(chamadasNaApi[0].metodo, "POST");
  assert.equal(new TextDecoder().decode(chamadasNaApi[0].corpo), '{"eventId":"123"}');
});

test("um cabeçalho x-api-token enviado pelo navegador não é aproveitado", async () => {
  await chamar("/api/metrics", { token: await emitirToken(), headers: { "x-api-token": "forjado", "x-usuario": "forjado@x" } });
  assert.equal(chamadasNaApi[0].cabecalhos["x-api-token"], "segredo-da-api");
  assert.equal(chamadasNaApi[0].cabecalhos["x-usuario"], "pessoa@exemplo.test");
});

test("caminhos fora de /api e configuração incompleta", async () => {
  assert.equal((await chamar("/qualquer-coisa", { token: await emitirToken() })).status, 404);
  const r = await worker.fetch(new Request("https://painel.exemplo.test/api/metrics"), { ...env, API_TOKEN: "" });
  assert.equal(r.status, 500);
});

test("alteração vinda de outro site é recusada; do próprio painel é aceita", async () => {
  const token = await emitirToken();
  const chamar = (origem) =>
    worker.fetch(
      new Request("https://painel.exemplo.test/api/exclusoes", {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json", ...(origem ? { Origin: origem } : {}) },
        body: "{}",
      }),
      env,
    );
  assert.equal((await chamar("https://outro-site.test")).status, 403);
  assert.notEqual((await chamar("https://painel.exemplo.test")).status, 403);
});

test("endereço inexistente recebe a página 404 do painel, com código 404", async () => {
  const pedidos = [];
  const ASSETS = {
    // Imita o Cloudflare: /404.html redireciona para /404, que entrega a página.
    fetch: async (pedido) => {
      const caminho = new URL(pedido.url).pathname;
      pedidos.push(caminho);
      if (caminho === "/404.html") return new Response(null, { status: 307, headers: { Location: "/404" } });
      return new Response("<h1>pagina 404</h1>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  };
  const r = await worker.fetch(new Request("https://painel.exemplo.test/nao/existe"), { ...env, ASSETS });
  assert.equal(r.status, 404);
  assert.match(r.headers.get("Content-Type"), /text\/html/);
  assert.equal(await r.text(), "<h1>pagina 404</h1>");
  assert.deepEqual(pedidos, ["/404.html", "/404"]);

  // Se a página não puder ser lida, a resposta continua sendo 404, em texto.
  const falha = await worker.fetch(new Request("https://painel.exemplo.test/x"), { ...env, ASSETS: { fetch: async () => { throw new Error("indisponível"); } } });
  assert.equal(falha.status, 404);
  assert.equal(await falha.text(), "Página não encontrada.");
});
