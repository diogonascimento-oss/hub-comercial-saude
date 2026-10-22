// Cliente da API v4 do Kommo. Leitura, mais duas escritas pontuais pedidas
// pela equipe: a descrição do lead e uma nota que registra quem a editou.

import axios from "axios";

const LIMITE_POR_PAGINA = 250;
const MAXIMO_DE_PAGINAS = 2000;

let cliente = null;

function obterCliente() {
  if (cliente) return cliente;
  const baseURL =
    process.env.KOMMO_BASE_URL ||
    `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4`;
  cliente = axios.create({
    baseURL,
    headers: { Authorization: `Bearer ${process.env.KOMMO_TOKEN}` },
    timeout: 30000,
  });
  return cliente;
}

export function kommoConfigurado() {
  return Boolean(process.env.KOMMO_TOKEN && (process.env.KOMMO_SUBDOMAIN || process.env.KOMMO_BASE_URL));
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Uma requisição GET, com nova tentativa quando o Kommo sinaliza excesso de
// chamadas (429) ou falha temporária (5xx).
async function requisitar(caminho, params) {
  const tentativas = 4;
  for (let i = 1; ; i++) {
    try {
      return await obterCliente().get(caminho, { params });
    } catch (erro) {
      const status = erro.response?.status;
      const temporario = status === 429 || (status >= 500 && status < 600) || !erro.response;
      if (!temporario || i >= tentativas) throw erro;
      await esperar(500 * 2 ** (i - 1));
    }
  }
}

// Percorre todas as páginas de uma listagem. O Kommo responde 204 (sem corpo)
// quando não há registros e informa "_links.next" enquanto houver mais páginas.
//
// Uma falha no meio da paginação interrompe a consulta com erro. Devolver uma
// lista parcial produziria indicadores errados sem nenhum aviso.
async function listarTudo(caminho, chaveEmbutida, params = {}) {
  const itens = [];
  for (let pagina = 1; pagina <= MAXIMO_DE_PAGINAS; pagina++) {
    const r = await requisitar(caminho, { ...params, limit: LIMITE_POR_PAGINA, page: pagina });
    if (r.status === 204 || !r.data) break;
    const lote = r.data?._embedded?.[chaveEmbutida] || [];
    itens.push(...lote);
    const haProxima = Boolean(r.data?._links?.next?.href);
    if (!lote.length || !haProxima) break;
  }
  return itens;
}

export function listarFunis() {
  return listarTudo("/leads/pipelines", "pipelines");
}

export function listarCamposDeLead() {
  return listarTudo("/leads/custom_fields", "custom_fields");
}

// Leads dos funis informados, com o contato vinculado e o motivo de perda.
export function listarLeadsDosFunis(idsDosFunis) {
  const params = { with: "contacts,loss_reason" };
  idsDosFunis.forEach((id, i) => {
    params[`filter[pipeline_id][${i}]`] = id;
  });
  return listarTudo("/leads", "leads", params);
}

// Contatos por ID, em blocos, para não exceder o tamanho da URL.
export async function listarContatosPorIds(ids) {
  const contatosPorId = new Map();
  const unicos = [...new Set(ids)].filter(Boolean);
  const tamanhoDoBloco = 100;
  for (let i = 0; i < unicos.length; i += tamanhoDoBloco) {
    const bloco = unicos.slice(i, i + tamanhoDoBloco);
    const params = {};
    bloco.forEach((id, j) => {
      params[`filter[id][${j}]`] = id;
    });
    const contatos = await listarTudo("/contacts", "contacts", params);
    contatos.forEach((c) => contatosPorId.set(c.id, c));
  }
  return contatosPorId;
}

// Eventos de mudança de etapa em um intervalo (timestamps em segundos).
export function listarMudancasDeEtapa(deTs, ateTs) {
  return listarTudo("/events", "events", {
    "filter[entity]": "leads",
    "filter[type]": "lead_status_changed",
    "filter[created_at][from]": deTs,
    "filter[created_at][to]": ateTs,
  });
}

// Todas as mudanças de etapa de um lead, sem limite de data.
export function listarMudancasDeEtapaDoLead(leadId) {
  return listarTudo("/events", "events", {
    "filter[entity]": "leads",
    "filter[type]": "lead_status_changed",
    "filter[entity_id]": leadId,
  });
}

export async function buscarLead(leadId) {
  const r = await requisitar(`/leads/${leadId}`, { with: "contacts,loss_reason" });
  return r.data;
}

export async function buscarContato(contatoId) {
  const r = await requisitar(`/contacts/${contatoId}`);
  return r.data;
}

// Escrita no Kommo. Repete só quando o Kommo sinaliza excesso de chamadas
// (429), caso em que a requisição comprovadamente não foi processada.
async function escrever(metodo, caminho, corpo) {
  for (let i = 1; ; i++) {
    try {
      return await obterCliente().request({ method: metodo, url: caminho, data: corpo });
    } catch (erro) {
      if (erro.response?.status !== 429 || i >= 4) throw erro;
      await esperar(500 * 2 ** (i - 1));
    }
  }
}

// Grava um campo de texto do lead. Texto vazio apaga o conteúdo do campo.
export function gravarCampoDeTextoDoLead(leadId, campoId, texto) {
  return escrever("patch", `/leads/${leadId}`, {
    custom_fields_values: [{ field_id: Number(campoId), values: texto ? [{ value: texto }] : null }],
  });
}

// Nota comum no histórico do lead, visível para a equipe no Kommo.
export function anotarNoLead(leadId, texto) {
  return escrever("post", `/leads/${leadId}/notes`, [{ note_type: "common", params: { text: texto } }]);
}

// --- Arquivos do lead (Drive do Kommo) ---------------------------------------
//
// Os arquivos ficam no serviço de arquivos do Kommo, num endereço próprio
// ("drive_url" da conta). O envio é feito por sessão, em partes do tamanho
// que o próprio serviço informa; depois o arquivo é ligado ao lead e aparece
// na aba de mídia dele no Kommo.

let enderecoDoDrive = null;
async function urlDoDrive() {
  if (enderecoDoDrive) return enderecoDoDrive;
  const r = await requisitar("/account", { with: "drive_url" });
  const url = r.data?.drive_url;
  if (!url) throw new Error("O Kommo não informou o endereço do serviço de arquivos da conta.");
  enderecoDoDrive = String(url).replace(/\/+$/, "");
  return enderecoDoDrive;
}

const cabecalhoDeAutorizacao = () => ({ Authorization: `Bearer ${process.env.KOMMO_TOKEN}` });

// UUIDs dos arquivos ligados ao lead, de todas as páginas.
export async function listarUuidsDosArquivosDoLead(leadId) {
  const uuids = [];
  let antesDe = null;
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = await requisitar(`/leads/${leadId}/files`, { limit: 50, ...(antesDe ? { before_id: antesDe } : {}) });
    if (r.status === 204 || !r.data) break;
    const lote = r.data?._embedded?.files || [];
    for (const f of lote) uuids.push(String(f.file_uuid || f.uuid));
    if (lote.length < 50) break;
    antesDe = Math.min(...lote.map((f) => Number(f.id)).filter(Number.isFinite));
    if (!Number.isFinite(antesDe)) break;
  }
  return uuids.filter(Boolean);
}

// Detalhes dos arquivos (nome, tamanho, tipo, link de download).
export async function detalharArquivos(uuids) {
  if (!uuids.length) return [];
  const drive = await urlDoDrive();
  const r = await axios.get(`${drive}/v1.0/files`, {
    headers: { ...cabecalhoDeAutorizacao(), Accept: "application/json" },
    params: { "filter[uuid]": uuids.join(",") },
    timeout: 30000,
  });
  if (r.status === 204 || !r.data) return [];
  return r.data?._embedded?.files || r.data?.files || [];
}

// Envia o arquivo em partes e devolve o objeto do arquivo criado no Drive.
export async function enviarArquivo(nome, tipo, conteudo) {
  const drive = await urlDoDrive();
  const sessao = await axios.post(
    `${drive}/v1.0/sessions`,
    { file_name: nome, file_size: conteudo.length, ...(tipo ? { content_type: tipo } : {}), with_preview: /^image\//.test(tipo || "") },
    { headers: { ...cabecalhoDeAutorizacao(), "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 },
  );
  const { upload_url: primeiraUrl, max_part_size: tamanhoDaParte, max_file_size: tamanhoMaximo } = sessao.data || {};
  if (!primeiraUrl) throw new Error("O Kommo não abriu a sessão de envio do arquivo.");
  if (tamanhoMaximo && conteudo.length > tamanhoMaximo) throw new Error("O arquivo passa do tamanho máximo aceito pelo Kommo.");
  const parte = Number(tamanhoDaParte) > 0 ? Number(tamanhoDaParte) : 512 * 1024;
  let url = primeiraUrl;
  for (let inicio = 0; inicio < conteudo.length || inicio === 0; inicio += parte) {
    const r = await axios.post(url, conteudo.subarray(inicio, inicio + parte), {
      headers: { ...cabecalhoDeAutorizacao(), "Content-Type": "application/octet-stream", Accept: "application/json" },
      maxBodyLength: Infinity,
      timeout: 60000,
    });
    if (r.data?.uuid) return r.data;
    if (!r.data?.next_url) throw new Error("O Kommo interrompeu o envio do arquivo.");
    url = r.data.next_url;
    if (conteudo.length === 0) break;
  }
  throw new Error("O Kommo não confirmou o recebimento do arquivo.");
}

export function ligarArquivoAoLead(leadId, uuid) {
  return obterCliente().put(`/leads/${leadId}/files`, [{ file_uuid: uuid }]);
}

export function desligarArquivoDoLead(leadId, uuid) {
  return obterCliente().delete(`/leads/${leadId}/files`, { data: [{ file_uuid: uuid }] });
}

// Manda o arquivo para a lixeira do Drive (recuperável por 30 dias no Kommo).
// Exige a permissão de apagar arquivos na integração.
export async function apagarArquivoDoDrive(uuid) {
  const drive = await urlDoDrive();
  return axios.delete(`${drive}/v1.0/files`, {
    headers: { ...cabecalhoDeAutorizacao(), "Content-Type": "application/json", Accept: "application/json" },
    data: [{ uuid }],
    timeout: 30000,
  });
}

// Conteúdo do arquivo, como fluxo, a partir do link de download do Drive.
export async function baixarArquivo(link) {
  // O token só vai para o serviço de arquivos do Kommo.
  const drive = new URL(await urlDoDrive());
  const destino = new URL(link, drive);
  if (destino.origin !== drive.origin && !destino.hostname.endsWith(".kommo.com")) throw new Error("Link de download fora do Kommo.");
  return axios.get(destino.href, { headers: cabecalhoDeAutorizacao(), responseType: "stream", timeout: 60000, maxRedirects: 5 });
}
