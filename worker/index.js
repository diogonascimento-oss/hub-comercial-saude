// Worker do Cloudflare que fica entre o painel e a API hospedada no Render.
//
// Os arquivos da interface (pasta client/) são entregues pelo próprio
// Cloudflare. Este código só é executado para os demais caminhos, e atende
// apenas /api/*:
//
//   1. confirma que a requisição passou pelo Cloudflare Access, validando a
//      assinatura do token que o Access anexa a cada requisição autenticada;
//   2. repassa a chamada ao servidor no Render, acrescentando o token secreto
//      que o servidor exige.
//
// O token da API nunca chega ao navegador.
//
// Segredos (Cloudflare > Worker > Settings > Variables and Secrets):
//   API_ORIGEM          endereço do servidor no Render, sem barra no final
//   API_TOKEN           mesmo valor da variável API_TOKEN do servidor
//   ACCESS_TEAM_DOMAIN  domínio da equipe no Zero Trust, ex.: escritorio.cloudflareaccess.com
//   ACCESS_AUD          "Application Audience (AUD) Tag" da aplicação no Access

const VALIDADE_DAS_CHAVES_MS = 60 * 60 * 1000;
let chavesDoAccess = null; // { em, dominio, porKid }

function json(status, corpo, cabecalhosExtras = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cabecalhosExtras },
  });
}

// O servidor gratuito do Render dorme depois de 15 minutos sem uso e leva cerca
// de um minuto para acordar. Nesse tempo a conexão pode cair ou o gateway do
// Render pode responder sem JSON. O painel reconhece "acordando" e tenta de novo
// sozinho; erros reais do servidor (que sempre vêm em JSON) passam como estão.
const servidorAcordando = () =>
  json(503, { error: "O servidor está acordando. Aguarde um instante.", acordando: true }, { "Retry-After": "5" });

const ehJson = (resposta) => (resposta.headers.get("Content-Type") || "").includes("application/json");

// O Render só parece acordar o servidor gratuito com uma visita de navegador: a
// página que ele mostra enquanto acorda é para pessoas, e chamadas de API
// (Accept: application/json, sem identificação de navegador) ficam sem resposta
// ou sem efeito. Por isso a "visita para acordar" imita a abertura da página.
const CABECALHOS_DE_NAVEGADOR = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const origemDaApi = (env) => String(env.API_ORIGEM || "").replace(/\/+$/, "");

// Espera máxima de cada visita e de cada consulta (GET) à API. Um servidor
// dormindo leva cerca de um minuto para responder.
const ESPERA_DA_VISITA_MS = 110_000;
const ESPERA_DA_CONSULTA_MS = 70_000;

// Visita a página inicial do servidor como um navegador faria e resume a
// resposta. Não envia segredo nenhum.
async function acordarServidor(env, espera = ESPERA_DA_VISITA_MS) {
  const inicio = Date.now();
  const tempo = () => Math.round(Date.now() - inicio);
  try {
    const resposta = await fetch(`${origemDaApi(env)}/`, { headers: CABECALHOS_DE_NAVEGADOR, redirect: "manual", signal: AbortSignal.timeout(espera) });
    const trecho = (await resposta.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    return { status: resposta.status, tipo: resposta.headers.get("Content-Type") || "", ms: tempo(), trecho, render: resposta.headers.get("x-render-routing") || undefined };
  } catch (erro) {
    return { erro: erro.message, ms: tempo() };
  }
}

// Evita uma visita por consulta quando o painel faz várias chamadas ao mesmo
// tempo: no máximo uma a cada 15 segundos por instância do Worker.
let ultimaVisita = 0;
// Usado nos testes, que fazem várias falhas seguidas.
export const reiniciarLimiteDeVisitas = () => {
  ultimaVisita = 0;
};
function acordarEmSegundoPlano(env, ctx) {
  if (!ctx?.waitUntil || Date.now() - ultimaVisita < 15_000) return;
  ultimaVisita = Date.now();
  ctx.waitUntil(acordarServidor(env).then((r) => console.log("Visita para acordar o servidor:", JSON.stringify(r))));
}

function decodificarBase64Url(texto) {
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(texto.length / 4) * 4, "=");
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

const decodificarJson = (trecho) => JSON.parse(new TextDecoder().decode(decodificarBase64Url(trecho)));

async function obterChavesDoAccess(dominio, forcar = false) {
  const validas =
    chavesDoAccess && chavesDoAccess.dominio === dominio && Date.now() - chavesDoAccess.em < VALIDADE_DAS_CHAVES_MS;
  if (validas && !forcar) return chavesDoAccess.porKid;

  const resposta = await fetch(`https://${dominio}/cdn-cgi/access/certs`);
  if (!resposta.ok) throw new Error(`Falha ao obter as chaves do Access (${resposta.status}).`);
  const { keys } = await resposta.json();
  const porKid = new Map();
  for (const jwk of keys || []) {
    const chave = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    porKid.set(jwk.kid, chave);
  }
  chavesDoAccess = { em: Date.now(), dominio, porKid };
  return porKid;
}

// Valida o token do Cloudflare Access. Retorna o conteúdo do token quando
// válido; lança erro caso contrário.
export async function validarTokenDoAccess(token, dominio, audiencia) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) throw new Error("Token do Access ausente ou malformado.");

  const cabecalho = decodificarJson(partes[0]);
  const conteudo = decodificarJson(partes[1]);
  if (cabecalho.alg !== "RS256") throw new Error("Algoritmo de assinatura não aceito.");

  let chaves = await obterChavesDoAccess(dominio);
  // O Access troca as chaves periodicamente; uma chave desconhecida pede nova consulta.
  if (!chaves.has(cabecalho.kid)) chaves = await obterChavesDoAccess(dominio, true);
  const chave = chaves.get(cabecalho.kid);
  if (!chave) throw new Error("Chave de assinatura desconhecida.");

  const assinaturaValida = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chave,
    decodificarBase64Url(partes[2]),
    new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
  );
  if (!assinaturaValida) throw new Error("Assinatura inválida.");

  const agora = Math.floor(Date.now() / 1000);
  if (!conteudo.exp || conteudo.exp < agora) throw new Error("Token expirado.");
  if (conteudo.nbf && conteudo.nbf > agora + 60) throw new Error("Token ainda não válido.");
  if (conteudo.iss !== `https://${dominio}`) throw new Error("Emissor do token não confere.");
  const audiencias = Array.isArray(conteudo.aud) ? conteudo.aud : [conteudo.aud];
  if (!audiencias.includes(audiencia)) throw new Error("O token pertence a outra aplicação.");

  return conteudo;
}

// Endereço que não corresponde a nenhum arquivo da interface: devolve a página
// 404 do painel, com o código 404. Sem a página, responde em texto simples.
async function paginaNaoEncontrada(url, env) {
  const simples = () =>
    new Response("Página não encontrada.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!env.ASSETS) return simples();
  try {
    let resposta = await env.ASSETS.fetch(new Request(new URL("/404.html", url)));
    // O Cloudflare pode redirecionar /404.html para /404; segue uma vez.
    const destino = resposta.headers.get("Location");
    if (resposta.status >= 300 && resposta.status < 400 && destino) {
      resposta = await env.ASSETS.fetch(new Request(new URL(destino, url)));
    }
    if (!resposta.ok) return simples();
    const cabecalhos = new Headers(resposta.headers);
    cabecalhos.set("Cache-Control", "no-store");
    return new Response(resposta.body, { status: 404, headers: cabecalhos });
  } catch {
    return simples();
  }
}

const METODOS_ACEITOS = new Set(["GET", "POST", "PUT", "DELETE"]);

export default {
  // Chamado pela agenda do Cloudflare (triggers.crons, em wrangler.jsonc). Visita
  // a página inicial do servidor, como um navegador, para que ele não durma no
  // horário de trabalho e, se já estiver dormindo, comece a acordar antes de
  // alguém abrir o painel. Não passa pelo Access e não envia dados: só a visita.
  async scheduled(controller, env) {
    if (!env.API_ORIGEM) return;
    const r = await acordarServidor(env);
    console.log("Servidor visitado:", JSON.stringify(r));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return paginaNaoEncontrada(url, env);
    }
    if (!METODOS_ACEITOS.has(request.method)) return json(405, { error: "Método não permitido." });

    // Chamadas que alteram dados só são aceitas quando partem do próprio painel.
    // O navegador informa a origem; uma página de outro site é recusada aqui.
    const origem = request.headers.get("Origin");
    if (request.method !== "GET" && origem && origem !== url.origin) {
      return json(403, { error: "Origem não permitida." });
    }

    const faltando = ["API_ORIGEM", "API_TOKEN", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"].filter((nome) => !env[nome]);
    if (faltando.length) {
      return json(500, { error: `Configuração incompleta no Worker. Segredos ausentes: ${faltando.join(", ")}.` });
    }

    let usuario;
    try {
      const token = request.headers.get("Cf-Access-Jwt-Assertion");
      const dominio = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      usuario = await validarTokenDoAccess(token, dominio, env.ACCESS_AUD);
    } catch (erro) {
      // O motivo fica só no registro do Worker; a resposta não o revela.
      console.warn("Token do Access recusado:", erro.message);
      return json(401, { error: "Acesso não autorizado." });
    }

    // Quem está logado sai direto do token do Access, sem esperar o servidor
    // acordar: é o que a saudação de boas-vindas usa.
    if (url.pathname === "/api/eu" && request.method === "GET") return json(200, { usuario: usuario.email || null });

    // Acordar o servidor com um clique: abre a página do Render, como se o
    // endereço fosse digitado. É o que o link do aviso "servidor iniciando" usa.
    if (url.pathname === "/api/acordar" && request.method === "GET") {
      return new Response(null, { status: 302, headers: { Location: origemDaApi(env) + "/", "Cache-Control": "no-store" } });
    }

    // Diagnóstico: o que o Render responde a uma chamada de API e a uma visita
    // de navegador. Com o servidor dormindo, mostra por que ele não acorda.
    if (url.pathname === "/api/estado-do-servidor" && request.method === "GET") {
      const [comoApi, comoNavegador] = await Promise.all([
        (async () => {
          const inicio = Date.now();
          try {
            const r = await fetch(`${origemDaApi(env)}/`, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
            const trecho = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
            return { status: r.status, tipo: r.headers.get("Content-Type") || "", ms: Date.now() - inicio, trecho, render: r.headers.get("x-render-routing") || undefined };
          } catch (erro) {
            return { erro: erro.message, ms: Date.now() - inicio };
          }
        })(),
        acordarServidor(env, 30_000),
      ]);
      return json(200, { servidor: origemDaApi(env).replace(/^https?:\/\//, ""), comoApi, comoNavegador });
    }

    const destino = new URL(url.pathname + url.search, env.API_ORIGEM.replace(/\/+$/, "") + "/");
    const cabecalhos = new Headers({ "x-api-token": env.API_TOKEN, Accept: "application/json" });
    const tipo = request.headers.get("Content-Type");
    if (tipo) cabecalhos.set("Content-Type", tipo);
    if (usuario.email) cabecalhos.set("x-usuario", usuario.email);
    // Nome e tipo do arquivo nos envios de anexos.
    for (const nome of ["x-nome-arquivo", "x-tipo-arquivo"]) {
      const valor = request.headers.get(nome);
      if (valor) cabecalhos.set(nome, valor.slice(0, 600));
    }

    const temCorpo = request.method !== "GET" && request.method !== "HEAD";
    let resposta;
    try {
      resposta = await fetch(destino, {
        method: request.method,
        headers: cabecalhos,
        body: temCorpo ? await request.arrayBuffer() : undefined,
        // Consultas não ficam presas para sempre num servidor que não acorda.
        signal: temCorpo ? undefined : AbortSignal.timeout(ESPERA_DA_CONSULTA_MS),
      });
    } catch {
      acordarEmSegundoPlano(env, ctx);
      return servidorAcordando();
    }
    // Resposta sem JSON do gateway (502, 503, 504) ou página HTML no lugar dos
    // dados: o servidor ainda não está de pé. Além de avisar o painel, faz a
    // visita de navegador que o acorda.
    const paginaNoLugarDosDados = !ehJson(resposta) && /text\/html/.test(resposta.headers.get("Content-Type") || "");
    if (([502, 503, 504].includes(resposta.status) && !ehJson(resposta)) || (resposta.ok && paginaNoLugarDosDados)) {
      acordarEmSegundoPlano(env, ctx);
      return servidorAcordando();
    }

    const saida = new Headers({ "Cache-Control": "no-store" });
    saida.set("Content-Type", resposta.headers.get("Content-Type") || "application/json; charset=utf-8");
    // Downloads de anexos: nome do arquivo, tamanho e proteção contra execução.
    for (const nome of ["Content-Disposition", "Content-Length", "X-Content-Type-Options"]) {
      const valor = resposta.headers.get(nome);
      if (valor) saida.set(nome, valor);
    }
    if (saida.has("Content-Disposition") && /^image\//.test(saida.get("Content-Type"))) {
      saida.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    }
    return new Response(resposta.body, { status: resposta.status, headers: saida });
  },
};
