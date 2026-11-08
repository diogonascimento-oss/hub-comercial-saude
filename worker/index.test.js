// Testes do Worker de repasse: validação do token do Cloudflare Access e
// encaminhamento da chamada à API.
import test from "node:test";
import assert from "node:assert/strict";
import worker, { reiniciarLimiteDeVisitas } from "./index.js";

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

const chamar = (caminho, { token, ctx, ...opcoes } = {}) => {
  chamadasNaApi = [];
  const headers = new Headers(opcoes.headers);
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  return worker.fetch(new Request(`https://painel.exemplo.test${caminho}`, { ...opcoes, headers }), env, ctx);
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

test("anexos: repassa nome e tipo do arquivo e devolve os cabeçalhos do download", async () => {
  const r = await chamar("/api/leads/1/anexos", {
    token: await emitirToken(),
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-nome-arquivo": "laudo%20m%C3%A9dico.pdf", "x-tipo-arquivo": "application/pdf" },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.equal(r.status, 200);
  assert.equal(chamadasNaApi[0].cabecalhos["x-nome-arquivo"], "laudo%20m%C3%A9dico.pdf");
  assert.equal(chamadasNaApi[0].cabecalhos["x-tipo-arquivo"], "application/pdf");
  assert.equal(chamadasNaApi[0].corpo.byteLength, 3);

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (destino, opcoes) =>
    String(destino).includes("/cdn-cgi/") ? fetchOriginal(destino, opcoes)
      : new Response("png", { headers: { "Content-Type": "image/png", "Content-Disposition": 'inline; filename="foto.png"', "X-Content-Type-Options": "nosniff", "x-interno": "nao" } });
  try {
    const d = await chamar("/api/leads/1/anexos/abc12345", { token: await emitirToken() });
    assert.equal(d.headers.get("Content-Disposition"), 'inline; filename="foto.png"');
    assert.equal(d.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(d.headers.get("Content-Security-Policy"), /default-src 'none'/);
    assert.equal(d.headers.get("x-interno"), null);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// --- Servidor dormindo -------------------------------------------------------------

// Troca a resposta da API por um instante e devolve a rede de teste ao final.
async function comApi(respostaDaApi, fn) {
  const normal = globalThis.fetch;
  globalThis.fetch = async (destino, opcoes = {}) => {
    if (String(destino).includes("/cdn-cgi/access/certs")) return normal(destino, opcoes);
    return respostaDaApi(destino, opcoes);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = normal;
  }
}

test("conexão que cai com o servidor dormindo: o painel é avisado de que ele está acordando", async () => {
  const r = await comApi(() => Promise.reject(new TypeError("fetch failed")), async () => chamar("/api/metrics", { token: await emitirToken() }));
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("Retry-After"), "5");
  const corpo = await r.json();
  assert.equal(corpo.acordando, true);
});

test("erro do gateway do Render sem JSON também vira \"acordando\"", async () => {
  for (const status of [502, 503, 504]) {
    const r = await comApi(
      () => new Response("<html>Bad Gateway</html>", { status, headers: { "Content-Type": "text/html" } }),
      async () => chamar("/api/metrics", { token: await emitirToken() }),
    );
    assert.equal(r.status, 503, `status ${status}`);
    assert.equal((await r.json()).acordando, true);
  }
});

test("erro de verdade do servidor, em JSON, passa como está (não é \"acordando\")", async () => {
  const r = await comApi(
    () => Response.json({ error: "O Kommo recusou o token de acesso." }, { status: 502 }),
    async () => chamar("/api/metrics", { token: await emitirToken() }),
  );
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: "O Kommo recusou o token de acesso." });
});

test("agenda: visita a página inicial do servidor, sem segredo e sem derrubar o Worker se falhar", async () => {
  const visitas = [];
  await comApi(
    (destino, opcoes) => {
      visitas.push({ url: String(destino), cabecalhos: Object.fromEntries(new Headers(opcoes.headers)) });
      return new Response("ok");
    },
    () => worker.scheduled({}, env),
  );
  assert.equal(visitas.length, 1);
  assert.equal(visitas[0].url, "https://api.exemplo.test/");
  assert.equal(visitas[0].cabecalhos["x-api-token"], undefined);
  assert.match(visitas[0].cabecalhos.accept, /text\/html/); // visita de navegador, como o clique manual

  // Falha da rede: não lança.
  await comApi(() => Promise.reject(new Error("sem rede")), () => worker.scheduled({}, env));
  // Sem endereço configurado: não faz nada.
  await comApi(() => assert.fail("não devia chamar a rede"), () => worker.scheduled({}, {}));
});

// --- Acordar o servidor como um navegador ----------------------------------------------

// Contexto de execução de mentira: guarda o que o Worker pede para fazer "em segundo plano".
const contexto = () => {
  const tarefas = [];
  return { waitUntil: (p) => tarefas.push(p), esperar: () => Promise.all(tarefas) };
};
const respostaDeServidorDormindo = (_destino, opcoes = {}) => {
  const cabecalhos = new Headers(opcoes.headers);
  // O Render mostra a página de espera a quem pede HTML, e nega a quem pede JSON.
  return cabecalhos.get("Accept")?.includes("text/html")
    ? new Response("<html>Welcome to Render</html>", { status: 200, headers: { "Content-Type": "text/html" } })
    : new Response("Service Unavailable", { status: 503, headers: { "Content-Type": "text/plain" } });
};

test("consulta que falha com o servidor dormindo: avisa o painel e faz a visita de navegador em segundo plano", async () => {
  reiniciarLimiteDeVisitas();
  const visitas = [];
  const ctx = contexto();
  const r = await comApi(
    (destino, opcoes) => {
      visitas.push({ url: String(destino), cabecalhos: Object.fromEntries(new Headers(opcoes.headers)) });
      return respostaDeServidorDormindo(destino, opcoes);
    },
    async () => {
      const resposta = await chamar("/api/metrics", { token: await emitirToken(), ctx });
      await ctx.esperar();
      return resposta;
    },
  );
  assert.equal(r.status, 503);
  assert.equal((await r.json()).acordando, true);
  // 1ª: a chamada de API (JSON, com o segredo); 2ª: a visita de navegador à página inicial, sem segredo.
  assert.equal(visitas.length, 2);
  assert.equal(visitas[0].cabecalhos.accept, "application/json");
  assert.equal(visitas[0].cabecalhos["x-api-token"], "segredo-da-api");
  assert.equal(visitas[1].url, "https://api.exemplo.test/");
  assert.match(visitas[1].cabecalhos.accept, /text\/html/);
  assert.match(visitas[1].cabecalhos["user-agent"], /Mozilla\/5\.0/);
  assert.equal(visitas[1].cabecalhos["x-api-token"], undefined);
});

test("várias consultas seguidas fazem uma visita só (no máximo uma a cada 15 segundos)", async () => {
  reiniciarLimiteDeVisitas();
  let visitasDeNavegador = 0;
  const ctx = contexto();
  await comApi(
    (destino, opcoes) => {
      if (new Headers(opcoes.headers).get("Accept")?.includes("text/html")) visitasDeNavegador++;
      return respostaDeServidorDormindo(destino, opcoes);
    },
    async () => {
      const token = await emitirToken();
      await Promise.all([1, 2, 3].map((n) => chamar(`/api/metrics?n=${n}`, { token, ctx })));
      await ctx.esperar();
    },
  );
  assert.equal(visitasDeNavegador, 1);
});

test("página HTML no lugar dos dados (200) também vira \"acordando\"", async () => {
  reiniciarLimiteDeVisitas();
  const ctx = contexto();
  const r = await comApi(
    () => new Response("<html>Welcome to Render</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    async () => {
      const resposta = await chamar("/api/metrics", { token: await emitirToken(), ctx });
      await ctx.esperar();
      return resposta;
    },
  );
  assert.equal(r.status, 503);
  assert.equal((await r.json()).acordando, true);
});

test("consultas têm tempo máximo; envios de dados não", async () => {
  const sinais = [];
  await comApi(
    (_destino, opcoes) => {
      sinais.push([opcoes.method, Boolean(opcoes.signal)]);
      return Response.json({ ok: true });
    },
    async () => {
      const token = await emitirToken();
      await chamar("/api/metrics", { token });
      await chamar("/api/leads/1", { token, method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    },
  );
  assert.deepEqual(sinais, [["GET", true], ["POST", false]]);
});

test("/api/acordar leva à página do servidor (só para quem passou pelo Access)", async () => {
  const sem = await chamar("/api/acordar");
  assert.equal(sem.status, 401);
  const r = await chamar("/api/acordar", { token: await emitirToken(), redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://api.exemplo.test/");
  assert.equal(chamadasNaApi.length, 0);
});

test("/api/estado-do-servidor mostra o que o servidor responde a uma chamada de API e a uma visita de navegador", async () => {
  const r = await comApi(respostaDeServidorDormindo, async () => chamar("/api/estado-do-servidor", { token: await emitirToken() }));
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.servidor, "api.exemplo.test");
  assert.equal(corpo.comoApi.status, 503);
  assert.equal(corpo.comoNavegador.status, 200);
  assert.match(corpo.comoNavegador.trecho, /Welcome to Render/);
  // O diagnóstico não revela o segredo da API.
  assert.ok(!JSON.stringify(corpo).includes("segredo-da-api"));
  const sem = await chamar("/api/estado-do-servidor");
  assert.equal(sem.status, 401);
});
