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

function json(status, corpo) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
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

const METODOS_ACEITOS = new Set(["GET", "POST", "PUT", "DELETE"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Página não encontrada.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
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

    const destino = new URL(url.pathname + url.search, env.API_ORIGEM.replace(/\/+$/, "") + "/");
    const cabecalhos = new Headers({ "x-api-token": env.API_TOKEN, Accept: "application/json" });
    const tipo = request.headers.get("Content-Type");
    if (tipo) cabecalhos.set("Content-Type", tipo);
    if (usuario.email) cabecalhos.set("x-usuario", usuario.email);

    const temCorpo = request.method !== "GET" && request.method !== "HEAD";
    let resposta;
    try {
      resposta = await fetch(destino, {
        method: request.method,
        headers: cabecalhos,
        body: temCorpo ? await request.arrayBuffer() : undefined,
      });
    } catch {
      return json(502, { error: "Não foi possível contatar o servidor da API." });
    }

    const saida = new Headers({ "Cache-Control": "no-store" });
    saida.set("Content-Type", resposta.headers.get("Content-Type") || "application/json; charset=utf-8");
    return new Response(resposta.body, { status: resposta.status, headers: saida });
  },
};
