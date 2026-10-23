// Google Agenda das closers, por uma conta de serviço do Google Cloud com
// delegação em todo o domínio (autorizada uma vez pelo administrador do
// Google Workspace). O painel age em nome de cada closer só na agenda dela,
// com o escopo de eventos. Sem a variável GOOGLE_CONTA_DE_SERVICO, a
// integração fica desligada e a ficha não oferece a opção.

import crypto from "crypto";
import axios from "axios";

const ESCOPO = "https://www.googleapis.com/auth/calendar.events";
const API = () => (process.env.GOOGLE_API_URL || "https://www.googleapis.com/calendar/v3").replace(/\/+$/, "");

// A chave JSON da conta de serviço, colada inteira na variável de ambiente
// (ou em base64, se o painel de hospedagem estragar as quebras de linha).
function credenciais() {
  const bruto = String(process.env.GOOGLE_CONTA_DE_SERVICO || "").trim();
  if (!bruto) return null;
  try {
    const json = JSON.parse(bruto.startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"));
    return json.client_email && json.private_key ? json : null;
  } catch {
    return null;
  }
}

export const googleConfigurado = () => Boolean(credenciais());

const b64url = (dados) => Buffer.from(dados).toString("base64url");
const tokens = new Map(); // e-mail -> { token, ate }

async function tokenPara(email) {
  const guardado = tokens.get(email);
  if (guardado && guardado.ate > Date.now() + 60_000) return guardado.token;
  const c = credenciais();
  if (!c) throw new Error("Google Agenda não configurado.");
  const agora = Math.floor(Date.now() / 1000);
  const uri = c.token_uri || "https://oauth2.googleapis.com/token";
  const cabecalho = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: c.client_email, sub: email, scope: ESCOPO, aud: uri, iat: agora, exp: agora + 3600 }));
  const assinatura = crypto.createSign("RSA-SHA256").update(`${cabecalho}.${corpo}`).sign(c.private_key, "base64url");
  const r = await axios.post(
    uri,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cabecalho}.${corpo}.${assinatura}` }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 },
  );
  tokens.set(email, { token: r.data.access_token, ate: Date.now() + (Number(r.data.expires_in) || 3600) * 1000 });
  return r.data.access_token;
}

async function chamar(email, metodo, caminho, dados, params) {
  const token = await tokenPara(email);
  return axios.request({
    method: metodo,
    url: `${API()}${caminho}`,
    data: dados,
    params,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 20000,
  });
}

const caminhoDaAgenda = (email) => `/calendars/${encodeURIComponent(email)}/events`;

// Corpo do evento no formato da API do Google Agenda.
export function montarEvento({ titulo, descricao, inicio, duracaoMin, online, local, leadId, idDaReuniao }) {
  const fim = inicio + duracaoMin * 60;
  const iso = (ts) => new Date(ts * 1000).toISOString();
  return {
    summary: titulo,
    description: descricao,
    start: { dateTime: iso(inicio), timeZone: "America/Recife" },
    end: { dateTime: iso(fim), timeZone: "America/Recife" },
    ...(online ? { conferenceData: { createRequest: { requestId: idDaReuniao, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : { location: local || "" }),
    // Marca o evento como criado pelo painel, para o lead certo.
    extendedProperties: { private: { painelLeadId: String(leadId) } },
  };
}

export async function criarEvento(email, evento) {
  const r = await chamar(email, "post", caminhoDaAgenda(email), evento, { conferenceDataVersion: 1, sendUpdates: "none" });
  return r.data;
}

export async function atualizarEvento(email, id, evento) {
  // Sem pedido de Meet novo ao atualizar um evento que já tem link.
  const r = await chamar(email, "patch", `${caminhoDaAgenda(email)}/${encodeURIComponent(id)}`, evento, { conferenceDataVersion: 1, sendUpdates: "none" });
  return r.data;
}

export async function apagarEvento(email, id) {
  try {
    await chamar(email, "delete", `${caminhoDaAgenda(email)}/${encodeURIComponent(id)}`, undefined, { sendUpdates: "none" });
  } catch (erro) {
    if (erro.response?.status !== 404 && erro.response?.status !== 410) throw erro;
  }
}

// Explica uma recusa do Google em português, para a ficha.
export function explicarErroDoGoogle(erro) {
  const status = erro.response?.status;
  const detalhe = erro.response?.data?.error_description || erro.response?.data?.error?.message || erro.message;
  if (status === 401 || /unauthorized_client|invalid_grant/i.test(String(detalhe))) {
    return "O Google recusou o acesso à agenda. Confira se o administrador do Workspace autorizou a conta de serviço (delegação em todo o domínio) com o escopo de eventos da agenda.";
  }
  if (status === 403) return "O Google não permitiu alterar a agenda desta closer.";
  if (status === 404) return "A agenda da closer não foi encontrada no Google. Confira o e-mail dela no painel.";
  return `Falha no Google Agenda: ${detalhe}`;
}
