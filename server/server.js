// API do Hub Comercial do Núcleo de Saúde.
//
// Consulta o Kommo, calcula os indicadores e os entrega ao painel. Todas as
// rotas /api exigem o token definido em API_TOKEN. O painel não chama este
// servidor diretamente: quem chama é o Worker do Cloudflare, que acrescenta o
// token depois que o usuário passou pelo Cloudflare Access.

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
  CAMPANHAS,
  ETAPAS,
  ETAPA_POR_CHAVE,
  FUSO_HORARIO,
  METAS_MENSAIS,
  TAXAS_DE_REFERENCIA,
  ETAPAS_REUNIAO_REALIZADA,
  CAMPANHAS_SEM_RASTREIO_DE_ANUNCIO,
  ROTULO_SEM_RASTREIO_DE_ANUNCIO,
  MOTIVOS_SEM_INTERESSE,
  CAMPOS,
  RESPONSAVEIS,
  AGENDA,
} from "./config.js";
import * as kommo from "./kommo.js";
import * as google from "./google.js";
import { montarMapeamento, nomeDaEtapa, resolverEtapa } from "./mapeamento.js";
import { nomeOficialDoResponsavel, normalizarLeads, normalizarEvento, aplicarCorrecoes, extrairNome, extrairTelefone } from "./leads.js";
import { diasDeCalendario, calcularEscopo, etapasParaInterface, reunioesDoLead } from "./metricas.js";
import * as armazenamento from "./armazenamento.js";
import { analisarTrafego, mesclarCusto, combinarSemanas, compararSemanas, associarGastoDoMeta, associarInvestimentoPorCampanha } from "./trafego.js";
import { metaConfigurado, buscarGastoDoMeta } from "./meta.js";
import { getLocalizacao } from "./localizacao.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const MODO_LOCAL = process.env.MODO_LOCAL === "true";
const API_TOKEN = process.env.API_TOKEN || "";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// --- Controle de acesso ---------------------------------------------------

function tokensIguais(recebido, esperado) {
  const a = crypto.createHash("sha256").update(String(recebido)).digest();
  const b = crypto.createHash("sha256").update(String(esperado)).digest();
  return crypto.timingSafeEqual(a, b);
}

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (MODO_LOCAL) return next();
  if (!API_TOKEN) {
    // Sem token configurado o servidor não atende a API. Liberar o acesso
    // nessa situação exporia os dados dos leads.
    return res.status(503).json({ error: "Servidor sem API_TOKEN configurado." });
  }
  const recebido = req.get("x-api-token");
  if (!recebido || !tokensIguais(recebido, API_TOKEN)) {
    return res.status(401).json({ error: "Acesso não autorizado." });
  }
  next();
});

// --- Dados do Kommo, com cache curto em memória ----------------------------

const CACHE_FUNIS_MS = 15 * 60 * 1000;
const CACHE_DADOS_MS = 30 * 1000;
let cacheMapeamento = null; // { em, valor, funis }
const cacheDados = new Map(); // "de:ate" -> { em, promessa }

async function obterMapeamento() {
  if (cacheMapeamento && Date.now() - cacheMapeamento.em < CACHE_FUNIS_MS) return cacheMapeamento;
  const funis = await kommo.listarFunis();
  cacheMapeamento = { em: Date.now(), valor: montarMapeamento(funis), funis };
  return cacheMapeamento;
}

// Leads dos três funis e mudanças de etapa do período.
// Leads dos três funis. A consulta é a mais pesada e não depende do período,
// por isso tem cache próprio, compartilhado entre os períodos consultados.
let cacheLeads = null; // { em, promessa }

function obterLeads() {
  if (cacheLeads && Date.now() - cacheLeads.em < CACHE_DADOS_MS) return cacheLeads.promessa;
  const promessa = (async () => {
    const { valor: mapeamento } = await obterMapeamento();
    if (!mapeamento.idsDosFunis.length) return { mapeamento, leads: [] };
    const leadsBrutos = await kommo.listarLeadsDosFunis(mapeamento.idsDosFunis);
    const idsDeContatos = leadsBrutos.map((l) => l._embedded?.contacts?.[0]?.id).filter(Boolean);
    const contatosPorId = await kommo.listarContatosPorIds(idsDeContatos);
    return { mapeamento, leads: normalizarLeads(leadsBrutos, contatosPorId, mapeamento) };
  })();
  cacheLeads = { em: Date.now(), promessa };
  promessa.catch(() => (cacheLeads = null));
  return promessa;
}

// Leads e mudanças de etapa do período.
async function obterDados(deTs, ateTs) {
  const chave = `${deTs}:${ateTs}`;
  const emCache = cacheDados.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_DADOS_MS) return emCache.promessa;

  const promessa = (async () => {
    const { mapeamento, leads } = await obterLeads();
    if (!mapeamento.idsDosFunis.length) return { mapeamento, leads, eventosBrutos: [] };
    const eventosBrutos = await kommo.listarMudancasDeEtapa(deTs, ateTs);
    return { mapeamento, leads, eventosBrutos };
  })();

  cacheDados.set(chave, { em: Date.now(), promessa });
  promessa.catch(() => cacheDados.delete(chave));
  for (const [k, v] of cacheDados) if (Date.now() - v.em > CACHE_DADOS_MS) cacheDados.delete(k);
  return promessa;
}

function lerPeriodo(req) {
  const inicio = req.query.inicio;
  const fim = req.query.fim;
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  if (!formato.test(inicio || "") || !formato.test(fim || "")) return null;
  const deTs = Math.floor(new Date(`${inicio}T00:00:00${FUSO_HORARIO}`).getTime() / 1000);
  const ateTs = Math.floor(new Date(`${fim}T23:59:59${FUSO_HORARIO}`).getTime() / 1000);
  if (Number.isNaN(deTs) || Number.isNaN(ateTs) || ateTs < deTs) return null;
  return { inicio, fim, deTs, ateTs };
}

function responderErro(res, erro, mensagem) {
  const status = erro.response?.status;
  console.error(`${mensagem}:`, erro.message);
  // Erros já preparados para exibição (por exemplo, os do Meta).
  if (erro.status && !erro.response) return res.status(erro.status).json({ error: erro.message });
  if (status === 401 || status === 403) {
    return res.status(502).json({ error: "O Kommo recusou o token de acesso. Verifique KOMMO_TOKEN e KOMMO_SUBDOMAIN." });
  }
  res.status(500).json({ error: mensagem });
}

const iso = (ts) => (ts ? new Date(ts * 1000).toISOString() : null);

// --- Rotas ----------------------------------------------------------------

// Em desenvolvimento local, o próprio servidor entrega a interface. Em
// produção quem entrega é o Cloudflare.
if (MODO_LOCAL) {
  app.use(express.static(path.join(__dirname, "..", "client"), { extensions: ["html"] }));
}

// Verificação de atividade, sem dados. Usada pelo Render e para "acordar" o
// servidor.
app.get("/", (req, res) => {
  res.type("text/plain").send("Hub Comercial - Núcleo de Saúde: servidor ativo.");
});

app.get("/api/situacao", async (req, res) => {
  const situacao = {
    kommoConfigurado: kommo.kommoConfigurado(),
    armazenamentoPersistente: armazenamento.armazenamentoPersistente(),
    metaConfigurado: metaConfigurado(),
    mapeamento: null,
  };
  if (situacao.kommoConfigurado) {
    try {
      const { valor } = await obterMapeamento();
      situacao.mapeamento = { completo: valor.completo, campanhas: valor.campanhas, pendencias: valor.pendencias };
    } catch (erro) {
      situacao.erroKommo = erro.response?.status
        ? `O Kommo respondeu com o código ${erro.response.status}.`
        : "Não foi possível contatar o Kommo.";
    }
  }
  res.json(situacao);
});

app.get("/api/etapas", (req, res) => {
  res.json({ etapas: ETAPAS.map((e) => ({ chave: e.chave, nome: e.nome, categoria: e.categoria })) });
});

// Leads e eventos do período prontos para cálculo: sem os eventos excluídos,
// com as correções aplicadas e agrupados por lead.
async function prepararPeriodo(periodo) {
  const { mapeamento, leads, eventosBrutos } = await obterDados(periodo.deTs, periodo.ateTs);

  const idsExcluidos = new Set((await armazenamento.lerExclusoes()).map((e) => String(e.eventId)));
  const correcoesPorId = new Map((await armazenamento.lerCorrecoes()).map((c) => [String(c.eventId), c]));

  const leadsPorId = new Map(leads.map((l) => [l.id, l]));
  const eventosPorLead = new Map();
  let eventosDeLeadsForaDaBase = 0;

  const eventos = aplicarCorrecoes(
    eventosBrutos.filter((ev) => !idsExcluidos.has(String(ev.id))),
    correcoesPorId,
  ).map((ev) => normalizarEvento(ev, mapeamento));

  const chavesEncontradas = [];
  for (const ev of eventos) {
    // Eventos de outros funis da conta não pertencem a este painel.
    const pertenceAosFunis = mapeamento.campanhaPorFunil.has(Number(ev.funilId)) || leadsPorId.has(ev.leadId);
    if (!pertenceAosFunis) continue;
    // Lead excluído, mesclado ou removido por duplicidade de telefone.
    if (!leadsPorId.has(ev.leadId)) {
      eventosDeLeadsForaDaBase++;
      continue;
    }
    if (ev.ts < periodo.deTs || ev.ts > periodo.ateTs) continue; // correção moveu o evento para fora do período
    if (!eventosPorLead.has(ev.leadId)) eventosPorLead.set(ev.leadId, []);
    eventosPorLead.get(ev.leadId).push(ev);
    chavesEncontradas.push(ev.de, ev.para);
  }
  for (const lista of eventosPorLead.values()) lista.sort((a, b) => a.ts - b.ts);
  leads.forEach((l) => chavesEncontradas.push(l.etapa));

  return {
    mapeamento,
    leads,
    eventosPorLead,
    chavesEncontradas,
    avisos: { eventosDeLeadsForaDaBase, correcoesAtivas: correcoesPorId.size, exclusoesAtivas: idsExcluidos.size },
  };
}

// Data (AAAA-MM-DD) de um instante, no fuso do escritório.
const DESLOCAMENTO_DO_FUSO_S = -3 * 3600;
const dataLocal = (ts) => new Date((ts + DESLOCAMENTO_DO_FUSO_S) * 1000).toISOString().slice(0, 10);

// Reuniões com data marcada para hoje, pelo campo "Data da Reunião" do lead.
// Só totais e horários; nenhum dado pessoal. A etapa atual do lead diz em que
// pé está a reunião: em Agendado, ainda vai acontecer (ou está sem desfecho
// lançado); em Reunião Realizada, Protocolo Farmer, Reaquecimento ou Fechado, já aconteceu; em
// Remarcação, não aconteceu.
function reunioesDeHoje(leads, agora) {
  const hoje = dataLocal(agora);
  const doDia = leads.filter((l) => l.dataDaReuniao && dataLocal(l.dataDaReuniao) === hoje && l.etapa !== "DESQUALIFICADO");
  const hora = (ts) => new Date((ts + DESLOCAMENTO_DO_FUSO_S) * 1000).toISOString().slice(11, 16);
  // Campo só com a data, sem horário, chega como meia-noite.
  const temHorario = (l) => hora(l.dataDaReuniao) !== "00:00";
  const emAgendado = doDia.filter((l) => l.etapa === "AGENDADO").sort((a, b) => a.dataDaReuniao - b.dataDaReuniao);
  const futuras = emAgendado.filter((l) => !temHorario(l) || l.dataDaReuniao > agora);
  const proxima = futuras.find(temHorario);
  const porCampanha = {};
  for (const l of doDia) porCampanha[l.campanha] = (porCampanha[l.campanha] || 0) + 1;
  return {
    emUso: leads.some((l) => l.dataDaReuniao),
    total: doDia.length,
    porCampanha,
    aindaPorAcontecer: futuras.length,
    proxima: proxima ? hora(proxima.dataDaReuniao) : null,
    // Passou do horário e o lead continua em Agendado: falta lançar o desfecho.
    semDesfecho: emAgendado.length - futuras.length,
    realizadas: doDia.filter((l) => ETAPAS_REUNIAO_REALIZADA.includes(l.etapa)).length,
    naoRealizadas: doDia.filter((l) => l.etapa === "REMARCACAO").length,
  };
}

const PAPEIS = [
  { chave: "sdr", rotulo: "SDR" },
  { chave: "closer", rotulo: "Closer" },
  { chave: "farmer", rotulo: "Farmer" },
];

// Indicadores por responsável: os leads são agrupados pelo nome gravado no
// campo de cada papel, e cada grupo é calculado com as mesmas regras do funil.
function indicadoresPorPessoa(leadsDoEscopo, base) {
  const resultado = {};
  for (const papel of PAPEIS) {
    const grupos = new Map();
    for (const lead of leadsDoEscopo) {
      const nome = lead.responsaveis?.[papel.chave]?.trim();
      if (!nome) continue;
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(lead);
    }
    resultado[papel.chave] = [...grupos]
      .map(([nome, leadsDaPessoa]) => {
        const { volume, taxas, entradasPorEtapa, volumeAtual } = calcularEscopo({ ...base, leads: leadsDaPessoa });
        return {
          nome,
          leadsNaBase: leadsDaPessoa.length,
          // IDs dos leads da pessoa, para o detalhamento de cada número no painel.
          ids: leadsDaPessoa.map((l) => l.id),
          leadsRecebidos: volume.leadsRecebidos,
          qualificados: volume.qualificados,
          emAgendamento: entradasPorEtapa.EM_AGENDAMENTO || 0,
          // Retrato do momento, independente do período: a fila de trabalho.
          emAgendamentoAgora: volumeAtual.EM_AGENDAMENTO || 0,
          reunioesMarcadas: volume.reunioesMarcadas,
          reunioesEmAberto: volume.reunioesEmAberto,
          reunioesRealizadas: volume.reunioesRealizadas,
          naoRealizadas: volume.naoRealizadas,
          fechados: volume.fechados,
          comparecimento: taxas.comparecimento,
          reuniaoParaFechamento: taxas.reuniaoParaFechamento,
        };
      })
      .sort((a, b) => b.leadsNaBase - a.leadsNaBase);
  }
  return resultado;
}

// Volumes e taxas de cada escopo em um período, sem listas.
async function resumoDoPeriodo(periodo, agora) {
  const { leads, eventosPorLead } = await prepararPeriodo(periodo);
  const base = { eventosPorLead, deTs: periodo.deTs, ateTs: periodo.ateTs, agora };
  const resumir = (lista) => {
    const { volume, taxas } = calcularEscopo({ ...base, leads: lista });
    return { volume, taxas };
  };
  const resumo = { TODAS: resumir(leads) };
  for (const c of CAMPANHAS) resumo[c.codigo] = resumir(leads.filter((l) => l.campanha === c.codigo));
  return resumo;
}

// Período de comparação: as mesmas datas, um mês antes. O filtro de 16 a 30
// de setembro é comparado com 16 a 30 de agosto. Quando o dia não existe no
// mês anterior (31, ou 29 e 30 em fevereiro), ou quando o filtro termina no
// último dia do mês, usa-se o último dia do mês anterior.
function periodoAnteriorA(periodo) {
  const dois = (n) => String(n).padStart(2, "0");
  const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const umMesAntes = (data, ateOFimDoMes) => {
    const [ano, mes, dia] = data.split("-").map(Number);
    const anoAnterior = mes === 1 ? ano - 1 : ano;
    const mesAnterior = mes === 1 ? 12 : mes - 1;
    const limite = ultimoDia(anoAnterior, mesAnterior);
    const ehFimDoMes = ateOFimDoMes && dia === ultimoDia(ano, mes);
    return `${anoAnterior}-${dois(mesAnterior)}-${dois(ehFimDoMes ? limite : Math.min(dia, limite))}`;
  };
  return periodoDe(umMesAntes(periodo.inicio, false), umMesAntes(periodo.fim, true));
}

app.get("/api/metrics", async (req, res) => {
  const periodo = lerPeriodo(req);
  if (!periodo) return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });

  try {
    const { mapeamento, leads, eventosPorLead, chavesEncontradas, avisos } = await prepararPeriodo(periodo);

    const agora = Math.floor(Date.now() / 1000);
    const base = { eventosPorLead, deTs: periodo.deTs, ateTs: periodo.ateTs, agora };

    const escopos = {};
    // resumo=1 (mural): só os totais, sem as listas de leads e sem o período de comparação.
    const resumo = req.query.resumo === "1";
    const todas = calcularEscopo({ ...base, leads, incluirListas: !resumo });
    const { listas, ...indicadoresGerais } = todas;
    escopos.TODAS = { ...indicadoresGerais, porPessoa: indicadoresPorPessoa(leads, base) };
    for (const campanha of CAMPANHAS) {
      const doEscopo = leads.filter((l) => l.campanha === campanha.codigo);
      escopos[campanha.codigo] = { ...calcularEscopo({ ...base, leads: doEscopo }), porPessoa: indicadoresPorPessoa(doEscopo, base) };
    }

    const anterior = periodoAnteriorA(periodo);
    const escoposAnteriores = resumo ? null : await resumoDoPeriodo(anterior, agora);

    // Metas: sempre sobre o mês corrente, independentemente do filtro.
    const hoje = dataLocal(agora);
    const mes = periodoDe(`${hoje.slice(0, 8)}01`, hoje);
    const doMes = (await resumoDoPeriodo(mes, agora)).TODAS.volume;

    res.json({
      periodo: { inicio: periodo.inicio, fim: periodo.fim },
      periodoAnterior: { inicio: anterior.inicio, fim: anterior.fim },
      motivosSemInteresse: MOTIVOS_SEM_INTERESSE,
      geradoEm: new Date().toISOString(),
      // Instante em que os dados usados nesta resposta foram lidos do Kommo.
      // Pode ser alguns segundos anterior à resposta, por causa do cache.
      dadosDe: new Date(
        Math.min(cacheLeads?.em ?? Date.now(), cacheDados.get(`${periodo.deTs}:${periodo.ateTs}`)?.em ?? Date.now()),
      ).toISOString(),
      campanhas: CAMPANHAS.map((c) => ({ codigo: c.codigo, nome: c.nome })),
      etapas: etapasParaInterface(chavesEncontradas),
      papeis: PAPEIS,
      mapeamento: { completo: mapeamento.completo, pendencias: mapeamento.pendencias },
      avisos,
      metas: await (async () => {
        const { valores, origem } = await metasDoMes(hoje.slice(0, 7));
        return { mes: hoje.slice(0, 7), origem, itens: METAS_MENSAIS.map((m) => ({ ...m, meta: valores[m.chave], atual: doMes[m.chave] })) };
      })(),
      reunioesDeHoje: reunioesDeHoje(leads, agora),
      escopos,
      escoposAnteriores,
      listas: resumo ? undefined : listas,
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao calcular os indicadores");
  }
});

// Histórico completo de mudanças de etapa do período, para auditoria. Os
// eventos excluídos do cálculo aparecem sinalizados, em vez de omitidos.
app.get("/api/historico-completo", async (req, res) => {
  const periodo = lerPeriodo(req);
  if (!periodo) return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });

  try {
    const { mapeamento, leads, eventosBrutos } = await obterDados(periodo.deTs, periodo.ateTs);
    const exclusoesPorId = new Map((await armazenamento.lerExclusoes()).map((e) => [String(e.eventId), e]));
    const correcoesPorId = new Map((await armazenamento.lerCorrecoes()).map((c) => [String(c.eventId), c]));
    const leadsPorId = new Map(leads.map((l) => [l.id, l]));

    const eventos = aplicarCorrecoes(eventosBrutos, correcoesPorId)
      .map((ev) => normalizarEvento(ev, mapeamento))
      .filter((ev) => mapeamento.campanhaPorFunil.has(Number(ev.funilId)) || leadsPorId.has(ev.leadId))
      .sort((a, b) => a.ts - b.ts);

    // Primeira entrada de cada lead em Contato Inicial dentro do período.
    const chegadaEmContatoInicial = new Map();
    for (const ev of eventos) {
      if (ev.para === "CONTATO_INICIAL" && !chegadaEmContatoInicial.has(ev.leadId)) {
        chegadaEmContatoInicial.set(ev.leadId, ev.ts);
      }
    }

    const dadosDoLead = (lead) => ({
      nome: lead?.nome || "",
      telefone: lead?.telefone || "",
      campanha: lead?.campanha || "",
      tags: lead?.tags?.join("; ") || "",
      motivoPerda: lead?.motivoPerda || "",
      campanhaMeta: lead?.origem?.campanhaMeta || "",
      conjunto: lead?.origem?.conjunto || "",
      anuncio: lead?.origem?.anuncio || "",
      dataCriacaoLead: iso(lead?.criadoEm),
    });

    const linhasDeEventos = eventos.map((ev) => {
      const lead = leadsPorId.get(ev.leadId);
      const exclusao = exclusoesPorId.get(ev.id);
      const chegadaReal = chegadaEmContatoInicial.get(ev.leadId) || null;
      return {
        eventId: ev.id,
        leadId: ev.leadId,
        ...dadosDoLead(lead),
        nome: lead?.nome || `Lead ${ev.leadId} (fora da base atual)`,
        campanha: lead?.campanha || mapeamento.campanhaPorFunil.get(Number(ev.funilId)) || "",
        data: iso(ev.ts),
        etapaOrigem: nomeDaEtapa(ev.de),
        etapaDestino: nomeDaEtapa(ev.para),
        corrigido: ev.corrigido,
        motivoCorrecao: ev.corrigido ? correcoesPorId.get(ev.id)?.motivo || "" : "",
        excluidoDoCalculo: Boolean(exclusao),
        motivoExclusao: exclusao?.motivo || "",
        chegadaContatoInicial: iso(chegadaReal || lead?.criadoEm),
        chegadaContatoInicialEstimada: !chegadaReal && Boolean(lead?.criadoEm),
      };
    });

    // Leads criados no período que ainda não mudaram de etapa não têm evento.
    // Entram como uma linha de criação, para não ficarem fora da auditoria.
    const idsComEvento = new Set(eventos.map((ev) => ev.leadId));
    const linhasDeCriacao = leads
      .filter((l) => l.criadoEm >= periodo.deTs && l.criadoEm <= periodo.ateTs && !idsComEvento.has(l.id))
      .map((lead) => ({
        eventId: `criacao-${lead.id}`,
        leadId: lead.id,
        ...dadosDoLead(lead),
        data: iso(lead.criadoEm),
        etapaOrigem: "",
        etapaDestino: lead.etapaNome,
        corrigido: false,
        motivoCorrecao: "",
        excluidoDoCalculo: false,
        motivoExclusao: "",
        chegadaContatoInicial: iso(lead.criadoEm),
        chegadaContatoInicialEstimada: true,
      }));

    const historico = [...linhasDeEventos, ...linhasDeCriacao];
    res.json({
      periodo: { inicio: periodo.inicio, fim: periodo.fim },
      totalEventos: historico.length,
      totalExcluidos: historico.filter((h) => h.excluidoDoCalculo).length,
      historico,
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao montar o histórico");
  }
});

// --- Correção de movimentações indevidas -----------------------------------

// Mudanças de etapa de um lead, com o identificador de cada evento.
app.get("/api/eventos-lead/:id", async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  try {
    const { valor: mapeamento } = await obterMapeamento();
    const brutos = await kommo.listarMudancasDeEtapaDoLead(leadId);
    const exclusoesPorId = new Map((await armazenamento.lerExclusoes()).map((e) => [String(e.eventId), e]));
    const idsExcluidos = new Set(exclusoesPorId.keys());
    const correcoesPorId = new Map((await armazenamento.lerCorrecoes()).map((c) => [String(c.eventId), c]));
    // Quem excluiu ou corrigiu a movimentação, quando e por quê.
    const marcacaoDe = (id) => {
      const m = exclusoesPorId.get(id) || correcoesPorId.get(id);
      return m ? { usuario: m.usuario || null, quando: m.criadoEm || null, motivo: m.motivo || "" } : null;
    };

    const eventos = aplicarCorrecoes(brutos, correcoesPorId)
      .map((ev) => normalizarEvento(ev, mapeamento))
      .sort((a, b) => a.tsOriginal - b.tsOriginal)
      .map((ev) => ({
        eventId: ev.id,
        dataOriginal: iso(ev.tsOriginal),
        dataEfetiva: iso(ev.ts),
        de: ev.de,
        para: ev.para,
        deNome: nomeDaEtapa(ev.de),
        paraNome: nomeDaEtapa(ev.para),
        deOriginalNome: nomeDaEtapa(ev.deOriginal),
        paraOriginalNome: nomeDaEtapa(ev.paraOriginal),
        jaExcluido: idsExcluidos.has(ev.id),
        jaCorrigido: correcoesPorId.has(ev.id),
        marcacao: marcacaoDe(ev.id),
      }));
    res.json({ leadId, eventos });
  } catch (erro) {
    responderErro(res, erro, "Falha ao buscar os eventos do lead");
  }
});

// --- Busca e ficha do lead ---------------------------------------------------

const semAcento = (texto) => String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Estado e região prováveis, pelo DDD do telefone. É uma estimativa: o DDD
// indica onde a linha foi habilitada, não onde a pessoa mora hoje.
function localizacaoProvavel(telefone) {
  const l = getLocalizacao(telefone);
  return { ddd: l.ddd, estado: l.estado, regiao: l.regiao, reconhecido: l.formatoReconhecido };
}


// Leads que estão agora em uma etapa, para o relatório por etapa. Situação
// atual da base, independente do período do filtro.
app.get("/api/leads/etapa", async (req, res) => {
  const chave = String(req.query.chave || "");
  const campanha = String(req.query.campanha || "TODAS");
  if (!chave || chave.length > 120) return res.status(400).json({ error: "Informe a etapa." });
  try {
    const { leads } = await obterLeads();
    const agora = Math.floor(Date.now() / 1000);
    const naEtapa = leads
      .filter((l) => l.etapa === chave && (campanha === "TODAS" || l.campanha === campanha))
      .sort((a, b) => (a.atualizadoEm || 0) - (b.atualizadoEm || 0));
    res.json({
      etapa: chave,
      total: naEtapa.length,
      leads: naEtapa.map((l) => ({
        id: l.id,
        nome: l.nome,
        telefone: l.telefone,
        campanha: l.campanha,
        criadoEm: iso(l.criadoEm),
        atualizadoEm: iso(l.atualizadoEm),
        diasSemAtualizacao: l.atualizadoEm ? diasDeCalendario(l.atualizadoEm, agora) : null,
        tags: l.tags,
        origem: l.origem,
        sdr: l.responsaveis?.sdr || "",
        bancos: l.bancos || "",
        estado: getLocalizacao(l.telefone).estado || "",
      })),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao listar os leads da etapa");
  }
});

// Todos os leads atribuídos a uma pessoa num papel (SDR, Closer ou Farmer),
// pelo nome gravado no campo do Kommo, em qualquer etapa e sem filtro de
// período. A atribuição continua sendo feita no Kommo; aqui só se consulta.
app.get("/api/leads/responsavel", async (req, res) => {
  const papel = String(req.query.papel || "");
  const nome = String(req.query.nome || "").trim();
  const campanha = String(req.query.campanha || "TODAS");
  if (!PAPEIS.some((p) => p.chave === papel) || !nome || nome.length > 120) {
    return res.status(400).json({ error: "Informe o papel e o nome do responsável." });
  }
  try {
    const { leads } = await obterLeads();
    const agora = Math.floor(Date.now() / 1000);
    const ordem = new Map(ETAPAS.map((e, i) => [e.chave, i]));
    const alvo = semAcento(nome);
    const daPessoa = leads
      .filter((l) => semAcento(l.responsaveis?.[papel] || "").trim() === alvo && (campanha === "TODAS" || l.campanha === campanha))
      .sort((a, b) => (ordem.get(a.etapa) ?? 99) - (ordem.get(b.etapa) ?? 99) || (a.atualizadoEm || 0) - (b.atualizadoEm || 0));
    res.json({
      papel,
      nome,
      total: daPessoa.length,
      leads: daPessoa.map((l) => ({
        id: l.id,
        nome: l.nome,
        telefone: l.telefone,
        campanha: l.campanha,
        etapa: l.etapa,
        criadoEm: iso(l.criadoEm),
        atualizadoEm: iso(l.atualizadoEm),
        diasSemAtualizacao: l.atualizadoEm ? diasDeCalendario(l.atualizadoEm, agora) : null,
        tags: l.tags,
        origem: l.origem,
        estado: getLocalizacao(l.telefone).estado || "",
      })),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao listar os leads do responsável");
  }
});

// Busca por nome, telefone, título do lead no Kommo ou ID, nos três funis.
app.get("/api/leads/busca", async (req, res) => {
  const termo = String(req.query.q || "").trim().slice(0, 80);
  if (termo.length < 2) return res.json({ termo, total: 0, resultados: [] });
  try {
    const { leads } = await obterLeads();
    const texto = semAcento(termo);
    const digitos = termo.replace(/\D/g, "");
    const encontrados = leads.filter(
      (l) =>
        semAcento(l.nome).includes(texto) ||
        semAcento(l.titulo).includes(texto) ||
        (digitos.length >= 3 && (l.telefone.includes(digitos) || String(l.id).includes(digitos))),
    );
    encontrados.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
    res.json({
      termo,
      total: encontrados.length,
      resultados: encontrados.slice(0, 25).map((l) => ({
        id: l.id,
        nome: l.nome,
        telefone: l.telefone,
        campanha: l.campanha,
        etapa: l.etapaNome,
        estado: getLocalizacao(l.telefone).estado,
      })),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao buscar leads");
  }
});

// Ficha completa de um lead: dados atuais, origem, campos preenchidos,
// localização provável e histórico de movimentações.
// Campo "Descrição" do lead, localizado pelo nome na lista de campos da conta
// (o ID não consta da configuração). Fica em memória por uma hora.
let campoDeDescricaoEmCache = { valor: undefined, ate: 0 };
async function campoDeDescricao() {
  if (campoDeDescricaoEmCache.ate > Date.now()) return campoDeDescricaoEmCache.valor;
  const campos = await kommo.listarCamposDeLead();
  const campo = campos.find((c) => /^descri[cç][aã]o$/i.test(String(c.name || "").trim()));
  const valor = campo ? { id: Number(campo.id), nome: campo.name } : null;
  campoDeDescricaoEmCache = { valor, ate: Date.now() + 3600_000 };
  return valor;
}
const textoDoCampo = (bruto, campoId) =>
  String((bruto.custom_fields_values || []).find((c) => Number(c.field_id) === Number(campoId))?.values?.[0]?.value ?? "");
const textoComparavel = (t) => String(t ?? "").replace(/\r\n/g, "\n").trim();

app.get("/api/leads/:id", async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  try {
    const { valor: mapeamento } = await obterMapeamento();
    const bruto = await kommo.buscarLead(leadId);
    const campanha = mapeamento.campanhaPorFunil.get(Number(bruto.pipeline_id));
    if (!campanha) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });

    const idContato = bruto._embedded?.contacts?.[0]?.id;
    const [contato, eventosBrutos, exclusoes, correcoes, campoDescricao, edicoesDeDescricao] = await Promise.all([
      idContato ? kommo.buscarContato(idContato) : null,
      kommo.listarMudancasDeEtapaDoLead(leadId),
      armazenamento.lerExclusoes(),
      armazenamento.lerCorrecoes(),
      campoDeDescricao().catch(() => null),
      armazenamento.lerEdicoesDeDescricao().catch(() => ({})),
    ]);
    const contatosPorId = new Map(contato ? [[contato.id, contato]] : []);
    const [lead] = normalizarLeads([bruto], contatosPorId, mapeamento);

    // Campos de data chegam do Kommo como número de segundos; são convertidos
    // para o horário do escritório.
    const funilDoLead = bruto.pipeline_id;
    const TIPOS_DE_DATA = { date: { dateStyle: "short" }, birthday: { dateStyle: "short" }, date_time: { dateStyle: "short", timeStyle: "short" } };
    const valorLegivel = (campo, v) => {
      const bruto = v?.value;
      const formato = TIPOS_DE_DATA[campo.field_type];
      if (formato && /^\d{9,10}$/.test(String(bruto))) {
        return new Date(Number(bruto) * 1000).toLocaleString("pt-BR", { ...formato, timeZone: "America/Recife" });
      }
      if (typeof bruto === "boolean") return bruto ? "Sim" : "Não";
      // Marcação das automações no formato "ID da coluna|data": é traduzida
      // para o nome da etapa, mantendo o registro original ao lado.
      const marcacao = /^(\d+)\|(\d{4})-(\d{2})-(\d{2})$/.exec(String(bruto ?? "").trim());
      if (marcacao) {
        const etapa = resolverEtapa(mapeamento, funilDoLead, marcacao[1]);
        if (etapa?.nome && !/^Coluna \d+$/.test(etapa.nome)) {
          return `${etapa.nome}, desde ${marcacao[4]}/${marcacao[3]}/${marcacao[2]} (registro: ${marcacao[0]})`;
        }
      }
      return String(bruto ?? "").trim();
    };
    const camposPreenchidos = (campos) =>
      (campos || [])
        .map((c) => ({
          nome: c.field_name || c.field_code || `Campo ${c.field_id}`,
          valor: (c.values || []).map((v) => valorLegivel(c, v)).filter(Boolean).join("; "),
          // Campos de controle usados pelas automações, sem leitura direta pela equipe.
          tecnico: /^cad[êe]ncia\s*:/i.test(c.field_name || ""),
        }))
        .filter((c) => c.valor);

    const exclusoesPorId = new Map(exclusoes.map((e) => [String(e.eventId), e]));
    const idsExcluidos = new Set(exclusoesPorId.keys());
    const correcoesPorId = new Map(correcoes.map((c) => [String(c.eventId), c]));
    const eventosDoLead = aplicarCorrecoes(eventosBrutos, correcoesPorId)
      .map((ev) => normalizarEvento(ev, mapeamento))
      .sort((a, b) => a.ts - b.ts);
    // As reuniões seguem o cálculo do painel: movimentações excluídas não contam.
    const reunioes = reunioesDoLead(lead, eventosDoLead.filter((ev) => !idsExcluidos.has(ev.id))).map((r) => ({
      agendadaEm: iso(r.agendadaEm),
      desfechoEm: iso(r.desfechoEm),
      destino: r.destino ? nomeDaEtapa(r.destino) : null,
      veioDeRemarcacao: r.veioDeRemarcacao,
      resultado: r.resultado,
      criterio: r.criterio,
      divergente: Boolean(r.divergente),
    }));
    // Na última movimentação, quando ela levou o lead à etapa de perda em que
    // ele está, o motivo registrado no Kommo aparece junto do nome da etapa.
    const ultimoEvento = eventosDoLead.at(-1);
    const comMotivo = (ev) =>
      ev === ultimoEvento && ev.para === lead.etapa && lead.etapa === "DESQUALIFICADO" && lead.motivoPerda ? `${nomeDaEtapa(ev.para)} · ${lead.motivoPerda}` : nomeDaEtapa(ev.para);
    const historico = eventosDoLead
      .map((ev) => ({
        data: iso(ev.ts),
        de: nomeDaEtapa(ev.de),
        para: comMotivo(ev),
        excluido: idsExcluidos.has(ev.id),
        corrigido: correcoesPorId.has(ev.id),
        // Quem excluiu ou corrigiu pelo painel, quando e por quê.
        marcacao: ((m) => (m ? { usuario: m.usuario || null, quando: m.criadoEm || null, motivo: m.motivo || "" } : null))(
          exclusoesPorId.get(ev.id) || correcoesPorId.get(ev.id),
        ),
      }));

    const agora = Math.floor(Date.now() / 1000);
    const ultimaMudanca = historico.length ? Date.parse(historico.at(-1).data) / 1000 : lead.criadoEm;
    res.json({
      id: lead.id,
      titulo: lead.titulo,
      nome: lead.nome,
      telefone: lead.telefone,
      localizacao: localizacaoProvavel(lead.telefone),
      campanha,
      etapa: lead.etapaNome,
      diasNaEtapa: ultimaMudanca ? Math.floor((agora - ultimaMudanca) / 86400) : null,
      criadoEm: iso(lead.criadoEm),
      atualizadoEm: iso(lead.atualizadoEm),
      etiquetas: lead.tags,
      motivoPerda: lead.motivoPerda,
      origem: lead.origem,
      origemSemRastreio:
        CAMPANHAS_SEM_RASTREIO_DE_ANUNCIO.includes(campanha) && !lead.origem.conjunto && !lead.origem.anuncio
          ? ROTULO_SEM_RASTREIO_DE_ANUNCIO
          : null,
      responsaveis: lead.responsaveis,
      situacaoDaReuniao: lead.situacaoDaReuniao,
      substatusFarmer: lead.substatusFarmer,
      reunioes,
      camposDoLead: camposPreenchidos(bruto.custom_fields_values).filter((c) => !campoDescricao || c.nome !== campoDescricao.nome),
      // Descrição editável pelo painel, com a última edição feita por ele.
      descricao: campoDescricao
        ? { nome: campoDescricao.nome, texto: textoDoCampo(bruto, campoDescricao.id), edicao: edicoesDeDescricao[leadId] || null }
        : null,
      camposDoContato: camposPreenchidos(contato?.custom_fields_values),
      historico,
      linkNoKommo: process.env.KOMMO_SUBDOMAIN ? `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/leads/detail/${lead.id}` : null,
    });
  } catch (erro) {
    if (erro.response?.status === 404 || erro.response?.status === 204) return res.status(404).json({ error: "Lead não encontrado no Kommo." });
    responderErro(res, erro, "Falha ao consultar o lead");
  }
});

// --- Usuário e registro de alterações ---------------------------------------

// E-mail de quem está logado, informado pelo Worker a partir do login no
// Cloudflare Access. Não vem do navegador, que poderia falsificá-lo.
const usuarioDa = (req) => String(req.get("x-usuario") || "").slice(0, 200) || null;

app.get("/api/eu", (req, res) => res.json({ usuario: usuarioDa(req) }));

// Anota uma alteração no registro. Uma falha aqui não desfaz a alteração, que
// já foi gravada; fica apenas no log do servidor.
async function registrarAlteracao(req, acao, detalhes = {}) {
  try {
    await armazenamento.acrescentarAoRegistro({ quando: new Date().toISOString(), usuario: usuarioDa(req), acao, ...detalhes });
  } catch (erro) {
    console.error("Falha ao anotar o registro de alterações:", erro.message);
  }
}

// Edição da descrição do lead pelo painel. Grava direto no Kommo, guarda quem
// editou e quando, e deixa uma nota no lead para a equipe ver no próprio
// Kommo. Para não sobrescrever o que alguém escreveu enquanto a ficha estava
// aberta, o texto anterior enviado pelo navegador precisa ser igual ao atual.
app.put("/api/leads/:id/descricao", async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  const texto = textoComparavel(req.body?.texto);
  if (texto.length > 4000) return res.status(400).json({ error: "A descrição pode ter no máximo 4.000 caracteres." });
  const usuario = usuarioDa(req) || (MODO_LOCAL ? "modo local" : null);
  if (!usuario) return res.status(401).json({ error: "Não foi possível identificar quem está editando. Recarregue a página e entre novamente." });
  try {
    const campo = await campoDeDescricao();
    if (!campo) return res.status(409).json({ error: "O Kommo não tem um campo chamado Descrição nos leads." });
    const { valor: mapeamento } = await obterMapeamento();
    const bruto = await kommo.buscarLead(leadId);
    if (!mapeamento.campanhaPorFunil.get(Number(bruto.pipeline_id))) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const atual = textoComparavel(textoDoCampo(bruto, campo.id));
    if (atual !== textoComparavel(req.body?.textoAnterior)) {
      return res.status(409).json({ error: "A descrição mudou no Kommo enquanto a ficha estava aberta.", textoAtual: atual });
    }
    if (atual === texto) return res.json({ texto, edicao: null, semMudanca: true });

    await kommo.gravarCampoDeTextoDoLead(leadId, campo.id, texto);
    const edicao = { usuario, quando: new Date().toISOString() };
    const quando = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Recife" });
    await Promise.all([
      armazenamento.gravarEdicaoDeDescricao(leadId, edicao).catch((e) => console.error("Falha ao guardar a autoria da descrição:", e.message)),
      kommo.anotarNoLead(leadId, `Descrição ${texto ? "editada" : "apagada"} pelo painel por ${usuario} em ${quando}.`).catch((e) => console.error("Falha ao anotar no Kommo:", e.message)),
      registrarAlteracao(req, texto ? "Descrição do lead editada" : "Descrição do lead apagada", { leadId }),
    ]);
    atualizarEventoDoLead(leadId);
    res.json({ texto, edicao });
  } catch (erro) {
    if (erro.response?.status === 404 || erro.response?.status === 204) return res.status(404).json({ error: "Lead não encontrado no Kommo." });
    if (erro.response?.status === 403 || erro.response?.status === 401) return res.status(502).json({ error: "O Kommo recusou a gravação. O token do painel pode não ter permissão de escrita." });
    responderErro(res, erro, "Falha ao gravar a descrição no Kommo");
  }
});

// --- Etapa e responsáveis, editados pela ficha -------------------------------
//
// A ficha permite mudar a coluna do lead no Kommo e os campos de SDR, Closer e
// Farmer. É o mesmo que fazer no Kommo: as automações ligadas à coluna rodam
// normalmente. Cada mudança deixa uma nota no lead com quem fez e quando.

const STATUS_GANHO = 142;
const STATUS_PERDIDO = 143;
const CAMPO_DO_PAPEL = { sdr: CAMPOS.sdrResponsavel, closer: CAMPOS.closerResponsavel, farmer: CAMPOS.farmerResponsavel };
const ROTULO_DO_PAPEL = { sdr: "SDR", closer: "Closer", farmer: "Farmer" };

let camposDaContaEmCache = { valor: null, ate: 0 };
async function camposDaConta() {
  if (camposDaContaEmCache.ate > Date.now()) return camposDaContaEmCache.valor;
  const valor = await kommo.listarCamposDeLead();
  camposDaContaEmCache = { valor, ate: Date.now() + 3600_000 };
  return valor;
}

function esquecerDadosEmCache() {
  cacheLeads = null;
  cacheDados.clear();
}

const valorDoCampoBruto = (bruto, campoId) => {
  const campo = (bruto.custom_fields_values || []).find((c) => Number(c.field_id) === Number(campoId));
  return String(campo?.values?.[0]?.value ?? "").trim();
};

async function opcoesDeEdicao(leadId) {
  const [{ valor: mapeamento, funis }, bruto, campos, { leads }] = await Promise.all([
    obterMapeamento(),
    kommo.buscarLead(leadId),
    camposDaConta(),
    obterLeads(),
  ]);
  const campanha = mapeamento.campanhaPorFunil.get(Number(bruto.pipeline_id));
  if (!campanha) return null;
  const funil = funis.find((f) => Number(f.id) === Number(bruto.pipeline_id));
  // A coluna de entrada do Kommo (tipo 1) recebe leads novos; não é destino de movimentação.
  const colunas = [...(funil?._embedded?.statuses || [])]
    .filter((c) => Number(c.type) !== 1 || Number(c.id) === Number(bruto.status_id))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((c) => {
      const etapa = mapeamento.etapaPorColuna.get(`${bruto.pipeline_id}:${c.id}`);
      return {
        id: Number(c.id),
        nome: c.name,
        ganho: Number(c.id) === STATUS_GANHO,
        // Venda perdida: no Kommo é a coluna 143; o motivo de perda só vale nela.
        perdido: Number(c.id) === STATUS_PERDIDO || (etapa?.chave === "DESQUALIFICADO" && !etapa.extra && Number(c.id) !== STATUS_GANHO),
      };
    });
  const responsaveis = Object.entries(CAMPO_DO_PAPEL)
    .filter(([, campoId]) => campoId)
    .map(([papel, campoId]) => {
      const def = campos.find((c) => Number(c.id) === Number(campoId));
      const opcoes = (def?.enums || []).map((e) => ({ id: Number(e.id), valor: e.value }));
      // Sugestões para campo de texto: nomes oficiais e nomes já usados.
      const usados = new Set((RESPONSAVEIS[papel] || []).map((r) => r.nome));
      for (const l of leads) if (l.responsaveis?.[papel]) usados.add(l.responsaveis[papel]);
      return {
        papel,
        rotulo: ROTULO_DO_PAPEL[papel],
        campoId: Number(campoId),
        tipo: opcoes.length ? "lista" : "texto",
        opcoes,
        sugestoes: opcoes.length ? [] : [...usados].sort((a, b) => a.localeCompare(b, "pt-BR")),
        atual: valorDoCampoBruto(bruto, campoId),
      };
    });
  // Campo "Data da reunião" do Kommo, localizado pelo nome.
  const defData = campos.find((c) => /^data da reuni[aã]o$/i.test(String(c.name || "").trim()));
  const valorData = defData ? Number((bruto.custom_fields_values || []).find((c) => Number(c.field_id) === Number(defData.id))?.values?.[0]?.value) : NaN;
  const dataDaReuniao = defData
    ? { campoId: Number(defData.id), nome: defData.name, comHora: defData.type !== "date", atual: Number.isFinite(valorData) && valorData > 0 ? valorData : null }
    : null;
  return { bruto, campanha, colunas, statusAtual: Number(bruto.status_id), responsaveis, dataDaReuniao };
}

// E-mail da agenda de cada closer: o de config.js ou, se faltar, o da
// variável AGENDAS_DAS_CLOSERS ({"Nome oficial": "email"}).
function emailDaAgenda(nomeOficial) {
  const daConfig = (RESPONSAVEIS.closer || []).find((c) => c.nome === nomeOficial)?.email;
  if (daConfig) return daConfig;
  try {
    return JSON.parse(process.env.AGENDAS_DAS_CLOSERS || "{}")[nomeOficial] || null;
  } catch {
    return null;
  }
}

async function gravarLinkDaReuniao(leadId, bruto, link) {
  const campo = (await camposDaConta()).find((c) => /^link da reuni[aã]o$/i.test(String(c.name || "").trim()));
  if (!campo) return;
  const atual = valorDoCampoBruto(bruto, campo.id);
  if ((link || "") === atual) return;
  await kommo.atualizarLead(leadId, { custom_fields_values: [{ field_id: Number(campo.id), values: link ? [{ value: link }] : null }] });
}

// Cria, atualiza ou cancela o evento da reunião na agenda da closer. Uma
// falha no Google não desfaz o que já foi gravado no Kommo: volta como aviso.
async function sincronizarAgenda({ leadId, bruto, lead, campanha, closer, inicio, cancelar, pedido }) {
  if (!google.googleConfigurado()) return null;
  const eventos = await armazenamento.lerEventosDaAgenda();
  const existente = eventos[leadId] || null;
  try {
    if (cancelar) {
      if (!existente) return null;
      await google.apagarEvento(existente.email, existente.eventoId);
      await armazenamento.gravarEventoDaAgenda(leadId, null);
      if (existente.meet) await gravarLinkDaReuniao(leadId, bruto, "").catch(() => {});
      return { ok: true, cancelado: true, mudanca: "evento removido do Google Agenda" };
    }
    if (!inicio) return null;
    const nomeOficial = nomeOficialDoResponsavel("closer", closer);
    const email = emailDaAgenda(nomeOficial);
    if (!email) {
      // A reunião saiu da closer que tinha o evento: ele não fica na agenda dela.
      let removido = "";
      if (existente) {
        await google.apagarEvento(existente.email, existente.eventoId);
        await armazenamento.gravarEventoDaAgenda(leadId, null);
        removido = `evento removido da agenda de ${existente.closer || existente.email}`;
      }
      return {
        ok: false,
        mudanca: removido || undefined,
        aviso: closer ? `A closer "${closer}" não tem agenda ligada ao painel; a reunião ficou só no Kommo.` : "Escolha a closer para criar o evento no Google Agenda.",
      };
    }
    const online = pedido.online ?? existente?.online ?? true;
    const duracaoMin = Math.min(Math.max(Number(pedido.duracaoMin) || existente?.duracaoMin || AGENDA.duracaoPadraoMin, 15), 480);
    const local = String(pedido.local ?? existente?.local ?? AGENDA.enderecoDoEscritorio).slice(0, 300);

    // Descrição do evento: dados do lead, descrição do Kommo e links.
    const campoDescricao = await campoDeDescricao().catch(() => null);
    const descricaoKommo = campoDescricao ? textoDoCampo(bruto, campoDescricao.id) : "";
    let anexos = [];
    try {
      anexos = await kommo.detalharArquivos(await kommo.listarUuidsDosArquivosDoLead(leadId));
    } catch {
      anexos = [];
    }
    const painel = AGENDA.enderecoDoPainel.replace(/\/+$/, "");
    const linhas = [
      `Lead: ${lead?.nome || bruto.name || leadId}`,
      lead?.telefone ? `Telefone: ${lead.telefone}` : "",
      `Campanha: ${campanha}`,
      descricaoKommo ? `\nDescrição:\n${descricaoKommo}` : "",
      `\nFicha do lead no painel (descrição, anexos e histórico): ${painel}/?lead=${leadId}`,
      anexos.length ? `\nAnexos (abrem pelo painel, com login):\n${anexos.map((a) => `- ${a.name}: ${painel}/api/leads/${leadId}/anexos/${a.uuid}`).join("\n")}` : "",
      process.env.KOMMO_SUBDOMAIN ? `\nLead no Kommo: https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/leads/detail/${leadId}` : "",
    ].filter(Boolean);
    const evento = google.montarEvento({
      titulo: `Reunião ${campanha} · ${lead?.nome || bruto.name || `lead ${leadId}`}`,
      descricao: linhas.join("\n"),
      inicio,
      duracaoMin,
      online,
      local,
      leadId,
      idDaReuniao: `painel-${leadId}-${Date.now()}`,
    });

    let criado;
    if (existente && existente.email === email) {
      if (existente.meet && online) delete evento.conferenceData;
      if (!online) evento.conferenceData = null;
      criado = await google.atualizarEvento(email, existente.eventoId, evento);
    } else {
      if (existente) await google.apagarEvento(existente.email, existente.eventoId).catch(() => {});
      criado = await google.criarEvento(email, evento);
    }
    const meet = criado.hangoutLink || criado.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || null;
    // O link do Meet vai também para o campo "Link da Reunião" do lead, que é
    // o que o lembrete automático do Kommo envia ao cliente.
    await gravarLinkDaReuniao(leadId, bruto, online ? meet : "").catch((e) => console.error("Falha ao gravar o link da reunião:", e.message));
    const registro = { email, closer: nomeOficial, eventoId: criado.id, link: criado.htmlLink || null, meet, online, local, duracaoMin, inicio };
    await armazenamento.gravarEventoDaAgenda(leadId, registro);
    const quando = new Date(inicio * 1000).toLocaleString("pt-BR", { timeZone: "America/Recife", dateStyle: "short", timeStyle: "short" });
    return {
      ok: true,
      ...registro,
      mudanca: `evento ${existente && existente.email === email ? "atualizado" : "criado"} no Google Agenda de ${nomeOficial} para ${quando}${online ? meet ? ` (Meet: ${meet})` : " (online)" : local ? ` (presencial: ${local})` : " (presencial)"}`,
    };
  } catch (erro) {
    console.error("Falha no Google Agenda:", erro.response?.status, JSON.stringify(erro.response?.data || erro.message).slice(0, 400));
    return { ok: false, aviso: google.explicarErroDoGoogle(erro) };
  }
}

// Depois de mudar a descrição ou os anexos, o evento já criado na agenda é
// refeito com o texto e os links novos. Falhas ficam só no log.
async function atualizarEventoDoLead(leadId) {
  if (!google.googleConfigurado()) return;
  try {
    const existente = (await armazenamento.lerEventosDaAgenda())[leadId];
    if (!existente) return;
    const [{ valor: mapeamento }, bruto, { leads }] = await Promise.all([obterMapeamento(), kommo.buscarLead(leadId), obterLeads()]);
    const campanha = mapeamento.campanhaPorFunil.get(Number(bruto.pipeline_id));
    if (!campanha) return;
    await sincronizarAgenda({
      leadId,
      bruto,
      lead: leads.find((l) => String(l.id) === leadId),
      campanha,
      closer: existente.closer,
      inicio: existente.inicio,
      cancelar: false,
      pedido: {},
    });
  } catch (erro) {
    console.error("Falha ao atualizar o evento do lead:", erro.message);
  }
}

app.get("/api/leads/:id/edicao", async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  try {
    const [opcoes, motivos] = await Promise.all([opcoesDeEdicao(leadId), kommo.listarMotivosDePerda().catch(() => [])]);
    if (!opcoes) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const { bruto, ...resto } = opcoes;
    const eventos = google.googleConfigurado() ? await armazenamento.lerEventosDaAgenda().catch(() => ({})) : {};
    res.json({
      ...resto,
      agenda: {
        configurado: google.googleConfigurado(),
        closersComAgenda: (RESPONSAVEIS.closer || []).filter((c) => emailDaAgenda(c.nome)).map((c) => c.nome),
        evento: eventos[leadId] || null,
        duracaoPadraoMin: AGENDA.duracaoPadraoMin,
        enderecoPadrao: AGENDA.enderecoDoEscritorio,
      },
      motivoDePerdaAtual: bruto.loss_reason_id ? Number(bruto.loss_reason_id) : null,
      motivosDePerda: motivos.map((m) => ({ id: Number(m.id), nome: m.name })),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao carregar as opções de edição do lead");
  }
});

// Grava a nova etapa e/ou os responsáveis. O navegador envia também os
// valores que via ao abrir a ficha; se algum mudou no Kommo desde então, nada
// é gravado e a ficha é recarregada.
app.put("/api/leads/:id/edicao", async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  const usuario = usuarioDa(req) || (MODO_LOCAL ? "modo local" : null);
  if (!usuario) return res.status(401).json({ error: "Não foi possível identificar quem está editando. Recarregue a página e entre novamente." });
  const corpo = req.body || {};
  try {
    const opcoes = await opcoesDeEdicao(leadId);
    if (!opcoes) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const { bruto, colunas, statusAtual, responsaveis } = opcoes;
    const dados = {};
    const mudancas = [];

    if (corpo.etapa && Number(corpo.etapa.statusId) !== statusAtual) {
      if (Number(corpo.etapa.statusAnterior) !== statusAtual) {
        return res.status(409).json({ error: "O lead mudou de etapa no Kommo enquanto a ficha estava aberta. A ficha foi recarregada; confira antes de salvar." });
      }
      const destino = colunas.find((c) => c.id === Number(corpo.etapa.statusId));
      if (!destino) return res.status(400).json({ error: "Etapa inválida para o funil deste lead." });
      dados.status_id = destino.id;
      dados.pipeline_id = Number(bruto.pipeline_id);
      let motivoTexto = "";
      if (destino.perdido && corpo.etapa.motivoPerdaId) {
        const motivos = await kommo.listarMotivosDePerda();
        const motivo = motivos.find((m) => Number(m.id) === Number(corpo.etapa.motivoPerdaId));
        if (!motivo) return res.status(400).json({ error: "Motivo de perda inválido." });
        dados.loss_reason_id = Number(motivo.id);
        motivoTexto = ` (motivo: ${motivo.name})`;
      }
      const origem = colunas.find((c) => c.id === statusAtual)?.nome || "etapa anterior";
      mudancas.push(`etapa: ${origem} → ${destino.nome}${motivoTexto}`);
    }

    const novosCampos = [];
    for (const r of responsaveis) {
      const pedido = corpo.responsaveis?.[r.papel];
      if (!pedido) continue;
      // Nome digitado que corresponde a um nome oficial é gravado no formato oficial.
      const digitado = String(pedido.valor ?? "").trim().slice(0, 120);
      const novo = r.tipo === "texto" ? nomeOficialDoResponsavel(r.papel, digitado) : digitado;
      if (novo === r.atual) continue;
      if (String(pedido.anterior ?? "").trim() !== r.atual) {
        return res.status(409).json({ error: `O campo ${r.rotulo} mudou no Kommo enquanto a ficha estava aberta. A ficha foi recarregada; confira antes de salvar.` });
      }
      if (r.tipo === "lista" && novo) {
        const opcao = r.opcoes.find((o) => o.valor === novo);
        if (!opcao) return res.status(400).json({ error: `Opção inválida para ${r.rotulo}.` });
        novosCampos.push({ field_id: r.campoId, values: [{ enum_id: opcao.id }] });
      } else {
        novosCampos.push({ field_id: r.campoId, values: novo ? [{ value: novo }] : null });
      }
      mudancas.push(`${r.rotulo}: ${r.atual || "vazio"} → ${novo || "vazio"}`);
    }
    // Data e hora da reunião, em segundos (horário do escritório no navegador).
    const pedidoData = corpo.dataDaReuniao;
    if (pedidoData && opcoes.dataDaReuniao) {
      const d = opcoes.dataDaReuniao;
      const novo = pedidoData.valor ? Math.floor(Number(pedidoData.valor)) : null;
      const anterior = pedidoData.anterior ? Math.floor(Number(pedidoData.anterior)) : null;
      if (novo !== d.atual) {
        if (anterior !== d.atual) {
          return res.status(409).json({ error: "A data da reunião mudou no Kommo enquanto a ficha estava aberta. A ficha foi recarregada; confira antes de salvar." });
        }
        if (novo !== null && (!Number.isFinite(novo) || novo < 946684800 || novo > 4102444800)) return res.status(400).json({ error: "Data da reunião inválida." });
        novosCampos.push({ field_id: d.campoId, values: novo ? [{ value: novo }] : null });
        const legivel = (ts) =>
          ts ? new Date(ts * 1000).toLocaleString("pt-BR", { timeZone: "America/Recife", dateStyle: "short", ...(d.comHora ? { timeStyle: "short" } : {}) }) : "vazio";
        mudancas.push(`${d.nome}: ${legivel(d.atual)} → ${legivel(novo)}`);
      }
    }
    if (novosCampos.length) dados.custom_fields_values = novosCampos;

    const pedidoAgenda = corpo.agenda && google.googleConfigurado() ? corpo.agenda : null;
    if (!mudancas.length && !pedidoAgenda) return res.json({ ok: true, semMudanca: true });

    // Situação final do lead, depois desta alteração, para a agenda.
    const closerFinal = (() => {
      const r = responsaveis.find((x) => x.papel === "closer");
      const pedido = corpo.responsaveis?.closer;
      return pedido ? nomeOficialDoResponsavel("closer", String(pedido.valor ?? "").trim()) : r?.atual || "";
    })();
    const inicioFinal = opcoes.dataDaReuniao
      ? corpo.dataDaReuniao ? (corpo.dataDaReuniao.valor ? Math.floor(Number(corpo.dataDaReuniao.valor)) : null) : opcoes.dataDaReuniao.atual
      : null;
    const destinoPerdido = dados.status_id ? Boolean(colunas.find((c) => c.id === dados.status_id)?.perdido) : false;
    const { leads } = await obterLeads();
    const leadNormalizado = leads.find((l) => String(l.id) === leadId);

    if (mudancas.length) {
      await kommo.atualizarLead(leadId, dados);
      esquecerDadosEmCache();
    }

    let agenda = null;
    if (pedidoAgenda || destinoPerdido || (corpo.dataDaReuniao && !inicioFinal)) {
      agenda = await sincronizarAgenda({
        leadId,
        bruto,
        lead: leadNormalizado,
        campanha: opcoes.campanha,
        closer: closerFinal,
        inicio: inicioFinal,
        cancelar: destinoPerdido || !inicioFinal || pedidoAgenda?.sincronizar === false,
        pedido: pedidoAgenda || {},
      });
      if (agenda?.mudanca) mudancas.push(agenda.mudanca);
    }
    if (!mudancas.length) return res.json({ ok: true, semMudanca: true, agenda });

    const quando = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Recife" });
    await Promise.all([
      kommo.anotarNoLead(leadId, `Alterado pelo painel por ${usuario} em ${quando}: ${mudancas.join("; ")}.`).catch((e) => console.error("Falha ao anotar no Kommo:", e.message)),
      registrarAlteracao(req, "Lead alterado pela ficha", { leadId, detalhe: mudancas.join("; ") }),
    ]);
    res.json({ ok: true, mudancas, agenda });
  } catch (erro) {
    if (erro.response?.status === 400) {
      console.error("Kommo recusou a alteração:", JSON.stringify(erro.response.data || {}).slice(0, 500));
      return res.status(400).json({ error: "O Kommo recusou a alteração. Se a etapa exige campos obrigatórios no Kommo, preencha-os lá." });
    }
    if (erro.response?.status === 403 || erro.response?.status === 401) return res.status(502).json({ error: "O Kommo recusou a gravação. O token do painel pode não ter permissão de escrita." });
    responderErro(res, erro, "Falha ao alterar o lead no Kommo");
  }
});

// --- Anexos do lead ------------------------------------------------------------
//
// Os arquivos ficam no Kommo (aba de mídia do lead). O painel lista, envia,
// abre, baixa e apaga, sempre deixando uma nota no lead com quem fez e quando.

const TAMANHO_MAXIMO_DO_ANEXO = 20 * 1024 * 1024;
// Só imagens comuns e PDF abrem dentro do navegador; o resto é baixado, para
// que um arquivo enviado (HTML, SVG) nunca rode como página do painel.
const ABRE_NO_NAVEGADOR = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i;

async function leadAcompanhado(leadId) {
  const { valor: mapeamento } = await obterMapeamento();
  const bruto = await kommo.buscarLead(leadId);
  return Boolean(mapeamento.campanhaPorFunil.get(Number(bruto.pipeline_id)));
}

function erroDeArquivos(res, erro, contexto) {
  const status = erro.response?.status;
  if (status === 401 || status === 403) {
    return res.status(502).json({ error: "O Kommo recusou o acesso aos arquivos. A integração do painel no Kommo precisa da permissão de acesso a arquivos (e de apagar arquivos, para excluir)." });
  }
  if (status === 404) return res.status(404).json({ error: "Lead ou arquivo não encontrado no Kommo." });
  return responderErro(res, erro, contexto);
}

const nomeSeguro = (nome) => String(nome || "arquivo").replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "arquivo";
const arquivoParaPainel = (f, autoria) => ({
  uuid: String(f.uuid),
  nome: f.name || f.sanitized_name || "arquivo",
  tamanho: Number(f.size) || 0,
  tipo: f.metadata?.mime_type || "",
  extensao: f.metadata?.extension || "",
  criadoEm: f.created_at ? new Date(f.created_at * 1000).toISOString() : null,
  abreNoNavegador: ABRE_NO_NAVEGADOR.test(f.metadata?.mime_type || ""),
  autoria: autoria || null,
});

app.get("/api/leads/:id/anexos", async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  try {
    if (!(await leadAcompanhado(leadId))) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const uuids = await kommo.listarUuidsDosArquivosDoLead(leadId);
    const [arquivos, autorias] = await Promise.all([kommo.detalharArquivos(uuids), armazenamento.lerAutoriaDosAnexos().catch(() => ({}))]);
    const ativos = arquivos.filter((f) => !f.deleted_at && !f.is_trashed);
    ativos.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ total: ativos.length, arquivos: ativos.map((f) => arquivoParaPainel(f, autorias[String(f.uuid)])), tamanhoMaximo: TAMANHO_MAXIMO_DO_ANEXO });
  } catch (erro) {
    erroDeArquivos(res, erro, "Falha ao listar os anexos do lead");
  }
});

app.post("/api/leads/:id/anexos", express.raw({ type: () => true, limit: TAMANHO_MAXIMO_DO_ANEXO }), async (req, res) => {
  const leadId = String(req.params.id);
  if (!/^\d+$/.test(leadId)) return res.status(400).json({ error: "ID de lead inválido." });
  const conteudo = Buffer.isBuffer(req.body) ? req.body : null;
  if (!conteudo || !conteudo.length) return res.status(400).json({ error: "Arquivo vazio." });
  let nome;
  try {
    nome = nomeSeguro(decodeURIComponent(String(req.get("x-nome-arquivo") || "")));
  } catch {
    nome = "arquivo";
  }
  const tipo = String(req.get("x-tipo-arquivo") || "").slice(0, 120);
  const usuario = usuarioDa(req) || (MODO_LOCAL ? "modo local" : null);
  if (!usuario) return res.status(401).json({ error: "Não foi possível identificar quem está enviando. Recarregue a página e entre novamente." });
  try {
    if (!(await leadAcompanhado(leadId))) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const arquivo = await kommo.enviarArquivo(nome, tipo, conteudo);
    await kommo.ligarArquivoAoLead(leadId, arquivo.uuid);
    const autoria = { usuario, quando: new Date().toISOString() };
    const quando = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Recife" });
    await Promise.all([
      armazenamento.gravarAutoriaDoAnexo(arquivo.uuid, autoria).catch((e) => console.error("Falha ao guardar a autoria do anexo:", e.message)),
      kommo.anotarNoLead(leadId, `Arquivo "${nome}" anexado pelo painel por ${usuario} em ${quando}.`).catch((e) => console.error("Falha ao anotar no Kommo:", e.message)),
      registrarAlteracao(req, "Arquivo anexado ao lead", { leadId, detalhe: nome }),
    ]);
    atualizarEventoDoLead(leadId);
    res.json({ arquivo: arquivoParaPainel({ ...arquivo, metadata: arquivo.metadata || { mime_type: tipo } }, autoria) });
  } catch (erro) {
    erroDeArquivos(res, erro, "Falha ao enviar o arquivo ao Kommo");
  }
});

// Abre (imagens e PDF) ou baixa o arquivo. Só serve arquivos ligados ao lead.
app.get("/api/leads/:id/anexos/:uuid", async (req, res) => {
  const leadId = String(req.params.id);
  const uuid = String(req.params.uuid);
  if (!/^\d+$/.test(leadId) || !/^[\w-]{8,64}$/.test(uuid)) return res.status(400).json({ error: "Arquivo inválido." });
  try {
    if (!(await leadAcompanhado(leadId))) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const uuids = await kommo.listarUuidsDosArquivosDoLead(leadId);
    if (!uuids.includes(uuid)) return res.status(404).json({ error: "Arquivo não encontrado neste lead." });
    const [arquivo] = await kommo.detalharArquivos([uuid]);
    const link = arquivo?._links?.download?.href || arquivo?._links?.download_version?.href;
    if (!link) return res.status(502).json({ error: "O Kommo não informou o link de download do arquivo." });
    const resposta = await kommo.baixarArquivo(link);
    const tipo = arquivo.metadata?.mime_type || resposta.headers["content-type"] || "application/octet-stream";
    const abrir = ABRE_NO_NAVEGADOR.test(tipo) && req.query.baixar !== "1";
    const nome = nomeSeguro(arquivo.name);
    res.set("Content-Type", abrir ? tipo : "application/octet-stream");
    res.set("Content-Disposition", `${abrir ? "inline" : "attachment"}; filename="${nome.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.set("X-Content-Type-Options", "nosniff");
    if (resposta.headers["content-length"]) res.set("Content-Length", resposta.headers["content-length"]);
    resposta.data.pipe(res);
  } catch (erro) {
    erroDeArquivos(res, erro, "Falha ao baixar o arquivo do Kommo");
  }
});

// Apaga o anexo: desliga do lead e manda o arquivo para a lixeira do Kommo,
// onde ele ainda pode ser recuperado por 30 dias.
app.delete("/api/leads/:id/anexos/:uuid", async (req, res) => {
  const leadId = String(req.params.id);
  const uuid = String(req.params.uuid);
  if (!/^\d+$/.test(leadId) || !/^[\w-]{8,64}$/.test(uuid)) return res.status(400).json({ error: "Arquivo inválido." });
  const usuario = usuarioDa(req) || (MODO_LOCAL ? "modo local" : null);
  if (!usuario) return res.status(401).json({ error: "Não foi possível identificar quem está apagando. Recarregue a página e entre novamente." });
  try {
    if (!(await leadAcompanhado(leadId))) return res.status(404).json({ error: "Lead fora dos funis acompanhados pelo painel." });
    const uuids = await kommo.listarUuidsDosArquivosDoLead(leadId);
    if (!uuids.includes(uuid)) return res.status(404).json({ error: "Arquivo não encontrado neste lead." });
    const [arquivo] = await kommo.detalharArquivos([uuid]).catch(() => []);
    const nome = arquivo?.name || "arquivo";
    await kommo.desligarArquivoDoLead(leadId, uuid);
    let naLixeira = true;
    try {
      await kommo.apagarArquivoDoDrive(uuid);
    } catch (erro) {
      naLixeira = false;
      console.error("Arquivo desligado do lead, mas não foi para a lixeira do Kommo:", erro.response?.status || erro.message);
    }
    const quando = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Recife" });
    await Promise.all([
      armazenamento.gravarAutoriaDoAnexo(uuid, null).catch(() => {}),
      kommo.anotarNoLead(leadId, `Arquivo "${nome}" apagado pelo painel por ${usuario} em ${quando}.`).catch((e) => console.error("Falha ao anotar no Kommo:", e.message)),
      registrarAlteracao(req, "Arquivo do lead apagado", { leadId, detalhe: nome }),
    ]);
    atualizarEventoDoLead(leadId);
    res.json({ ok: true, naLixeira });
  } catch (erro) {
    erroDeArquivos(res, erro, "Falha ao apagar o arquivo no Kommo");
  }
});

const leadInformado = (req) => (/^\d{1,15}$/.test(String(req.body?.leadId ?? req.query?.leadId ?? "")) ? String(req.body?.leadId ?? req.query?.leadId) : null);

app.get("/api/registro", async (req, res) => {
  try {
    const lista = await armazenamento.lerRegistroDeAlteracoes();
    res.json({ total: lista.length, entradas: lista.slice(-300).reverse() });
  } catch (erro) {
    responderErro(res, erro, "Falha ao ler o registro de alterações");
  }
});

app.get("/api/exclusoes", async (req, res) => {
  try {
    res.json(await armazenamento.lerExclusoes());
  } catch (erro) {
    responderErro(res, erro, "Falha ao ler as exclusões");
  }
});

app.post("/api/excluir-evento", async (req, res) => {
  const eventId = req.body?.eventId ? String(req.body.eventId) : "";
  if (!eventId) return res.status(400).json({ error: "eventId é obrigatório." });
  try {
    const lista = await armazenamento.lerExclusoes();
    if (!lista.some((e) => String(e.eventId) === eventId)) {
      lista.push({
        eventId,
        motivo: String(req.body.motivo || "Movimentação indevida, excluída do cálculo pelo painel").slice(0, 300),
        criadoEm: new Date().toISOString(),
        usuario: req.get("x-usuario") || null,
      });
      await armazenamento.gravarExclusoes(lista);
      // A exclusão e a correção de um mesmo evento são mutuamente exclusivas.
      const correcoes = await armazenamento.lerCorrecoes();
      const semEste = correcoes.filter((c) => String(c.eventId) !== eventId);
      if (semEste.length !== correcoes.length) await armazenamento.gravarCorrecoes(semEste);
      await registrarAlteracao(req, "Movimentação excluída do cálculo", { leadId: leadInformado(req), eventId, motivo: lista.at(-1).motivo });
    }
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro, "Falha ao gravar a exclusão");
  }
});

app.delete("/api/excluir-evento/:eventId", async (req, res) => {
  try {
    const eventId = String(req.params.eventId);
    const lista = (await armazenamento.lerExclusoes()).filter((e) => String(e.eventId) !== eventId);
    await armazenamento.gravarExclusoes(lista);
    await registrarAlteracao(req, "Exclusão revertida", { leadId: leadInformado(req), eventId });
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro, "Falha ao reverter a exclusão");
  }
});

app.get("/api/correcoes", async (req, res) => {
  try {
    res.json(await armazenamento.lerCorrecoes());
  } catch (erro) {
    responderErro(res, erro, "Falha ao ler as correções");
  }
});

// Reescreve, para efeito de cálculo, a etapa de destino de um evento
// (obrigatória), a de origem e a data e hora (opcionais).
app.post("/api/corrigir-evento", async (req, res) => {
  const { novaEtapaOrigem, novaEtapaDestino, novaDataHora, motivo } = req.body || {};
  const eventId = req.body?.eventId ? String(req.body.eventId) : "";
  if (!eventId) return res.status(400).json({ error: "eventId é obrigatório." });
  if (!ETAPA_POR_CHAVE.has(novaEtapaDestino)) return res.status(400).json({ error: "Etapa de destino inválida." });
  if (novaEtapaOrigem && !ETAPA_POR_CHAVE.has(novaEtapaOrigem)) {
    return res.status(400).json({ error: "Etapa de origem inválida." });
  }
  if (novaDataHora && Number.isNaN(new Date(novaDataHora).getTime())) {
    return res.status(400).json({ error: "Data e hora inválidas." });
  }
  try {
    const exclusoes = await armazenamento.lerExclusoes();
    const semEste = exclusoes.filter((e) => String(e.eventId) !== eventId);
    if (semEste.length !== exclusoes.length) await armazenamento.gravarExclusoes(semEste);

    const lista = (await armazenamento.lerCorrecoes()).filter((c) => String(c.eventId) !== eventId);
    lista.push({
      eventId,
      novaEtapaOrigem: novaEtapaOrigem || null,
      novaEtapaDestino,
      novaDataHora: novaDataHora || null,
      motivo: String(motivo || "Etapa ou horário ajustados pelo painel").slice(0, 300),
      criadoEm: new Date().toISOString(),
      usuario: req.get("x-usuario") || null,
    });
    await armazenamento.gravarCorrecoes(lista);
    await registrarAlteracao(req, "Movimentação corrigida", {
      leadId: leadInformado(req),
      eventId,
      motivo: lista.at(-1).motivo,
      detalhe: `${novaEtapaOrigem ? `${nomeDaEtapa(novaEtapaOrigem)} para ` : "Destino: "}${nomeDaEtapa(novaEtapaDestino)}`,
    });
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro, "Falha ao gravar a correção");
  }
});

app.delete("/api/corrigir-evento/:eventId", async (req, res) => {
  try {
    const eventId = String(req.params.eventId);
    const lista = (await armazenamento.lerCorrecoes()).filter((c) => String(c.eventId) !== eventId);
    await armazenamento.gravarCorrecoes(lista);
    await registrarAlteracao(req, "Correção revertida", { leadId: leadInformado(req), eventId });
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro, "Falha ao reverter a correção");
  }
});

// --- Metas mensais -------------------------------------------------------------

const CHAVES_DE_META = METAS_MENSAIS.map((m) => m.chave);
const metasPadrao = () => Object.fromEntries(METAS_MENSAIS.map((m) => [m.chave, m.meta]));
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

// Metas de um mês: as definidas para ele ou, sem elas, as do mês definido mais
// recente anterior a ele. Sem nenhuma definição, valem as metas padrão.
async function metasDoMes(mes) {
  const definidas = await armazenamento.lerMetasDefinidas();
  if (definidas[mes]) return { valores: { ...metasPadrao(), ...definidas[mes] }, origem: "definida" };
  const anterior = Object.keys(definidas).filter((m) => m < mes).sort().at(-1);
  if (anterior) return { valores: { ...metasPadrao(), ...definidas[anterior] }, origem: `herdada de ${anterior}` };
  return { valores: metasPadrao(), origem: "padrão" };
}

app.get("/api/metas", async (req, res) => {
  const mes = String(req.query.mes || "");
  if (!MES.test(mes)) return res.status(400).json({ error: "Informe o mês no formato AAAA-MM." });
  try {
    const { valores, origem } = await metasDoMes(mes);
    res.json({
      mes,
      origem,
      itens: METAS_MENSAIS.map((m) => ({ chave: m.chave, rotulo: m.rotulo, meta: valores[m.chave] })),
      taxasDeReferencia: TAXAS_DE_REFERENCIA,
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao ler as metas");
  }
});

app.put("/api/metas", async (req, res) => {
  const mes = String(req.body?.mes || "");
  if (!MES.test(mes)) return res.status(400).json({ error: "Informe o mês no formato AAAA-MM." });
  const novas = {};
  for (const chave of CHAVES_DE_META) {
    const valor = Number(req.body?.[chave]);
    if (!Number.isInteger(valor) || valor < 0 || valor > 100000) {
      return res.status(400).json({ error: "Cada meta deve ser um número inteiro entre 0 e 100.000." });
    }
    novas[chave] = valor;
  }
  try {
    const { valores: antes } = await metasDoMes(mes);
    const definidas = await armazenamento.lerMetasDefinidas();
    definidas[mes] = novas;
    await armazenamento.gravarMetasDefinidas(definidas);
    const resumo = (v) => METAS_MENSAIS.map((m) => `${m.rotulo.toLowerCase()} ${v[m.chave]}`).join(", ");
    await registrarAlteracao(req, "Metas do mês alteradas", { detalhe: `${mes}: ${resumo(antes)} → ${resumo(novas)}` });
    res.json({ ok: true, mes, ...novas });
  } catch (erro) {
    responderErro(res, erro, "Falha ao gravar as metas");
  }
});

// --- Acontecimentos do dia -----------------------------------------------------

// Agendamentos, reuniões realizadas e não realizadas, remarcações e contratos
// de um dia, em ordem de horário. As regras são as mesmas dos cartões.
app.get("/api/acontecimentos", async (req, res) => {
  const dia = String(req.query.dia || "");
  const periodo = lerPeriodo({ query: { inicio: dia, fim: dia } });
  if (!periodo) return res.status(400).json({ error: "Informe o dia no formato AAAA-MM-DD." });
  try {
    const { leads, eventosPorLead } = await prepararPeriodo(periodo);
    const agora = Math.floor(Date.now() / 1000);
    const { acontecimentos } = calcularEscopo({
      leads,
      eventosPorLead,
      deTs: periodo.deTs,
      ateTs: periodo.ateTs,
      agora,
      incluirAcontecimentos: true,
    });
    const porId = new Map(leads.map((l) => [l.id, l]));
    const lista = acontecimentos.map((a) => {
      const lead = porId.get(a.leadId);
      return {
        em: iso(a.ts),
        tipo: a.tipo,
        detalhe: a.detalhe,
        de: a.de ? nomeDaEtapa(a.de) : null,
        para: nomeDaEtapa(a.para),
        lead: { id: lead.id, nome: lead.nome, campanha: lead.campanha },
        responsaveis: lead.responsaveis,
      };
    });
    const totais = {};
    for (const a of lista) totais[a.tipo] = (totais[a.tipo] || 0) + 1;
    res.json({ dia, totais, acontecimentos: lista });
  } catch (erro) {
    responderErro(res, erro, "Falha ao listar os acontecimentos do dia");
  }
});

// --- Tráfego e campanhas -------------------------------------------------------

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function periodoDe(inicio, fim) {
  return lerPeriodo({ query: { inicio, fim } });
}

// Análise de tráfego de um período, opcionalmente restrita a uma campanha.
async function calcularAnaliseDeTrafego(periodo, { apenasNovos, campanha }) {
  // Com apenasNovos, a análise acompanha os leads que chegaram no período até
  // hoje: entram só os criados entre o início e o fim, mas as movimentações
  // consideradas vão até a data atual. Assim, um lead que chegou na semana e
  // fechou contrato na semana seguinte aparece como fechado na sua semana de
  // chegada. Sem apenasNovos, valem só as movimentações do período.
  const hoje = dataLocal(Math.floor(Date.now() / 1000));
  const periodoDosEventos = apenasNovos && periodo.fim < hoje ? lerPeriodo({ query: { inicio: periodo.inicio, fim: hoje } }) : periodo;
  const { leads, eventosPorLead } = await prepararPeriodo(periodoDosEventos);
  const doEscopo = campanha && campanha !== "TODAS" ? leads.filter((l) => l.campanha === campanha) : leads;
  return analisarTrafego({ leads: doEscopo, eventosPorLead, deTs: periodo.deTs, ateTs: periodo.ateTs, apenasNovos });
}

// Semanas salvas guardam o orçamento, as decisões e as observações; os números
// dos leads são sempre recalculados, com os leads que chegaram em cada semana
// acompanhados até hoje. Uma única leitura do Kommo atende todas as semanas.
async function comAnaliseAtual(registros) {
  if (!registros.length) return registros;
  const hoje = dataLocal(Math.floor(Date.now() / 1000));
  const inicio = registros.map((r) => r.inicio).sort()[0];
  const fim = [hoje, ...registros.map((r) => r.fim)].sort().at(-1);
  const { leads, eventosPorLead } = await prepararPeriodo(lerPeriodo({ query: { inicio, fim } }));
  return registros.map((r) => {
    const semana = lerPeriodo({ query: { inicio: r.inicio, fim: r.fim } });
    const apenasNovos = r.analise?.apenasNovos ?? true;
    return { ...r, analise: analisarTrafego({ leads, eventosPorLead, deTs: semana.deTs, ateTs: semana.ateTs, apenasNovos }) };
  });
}

app.get("/api/analise-trafego", async (req, res) => {
  const periodo = lerPeriodo(req);
  if (!periodo) return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
  try {
    const analise = await calcularAnaliseDeTrafego(periodo, {
      apenasNovos: req.query.apenasNovos === "true",
      campanha: req.query.campanha,
    });
    // resumo=1 (mural): só as contagens por estado e por região, sem leads.
    if (req.query.resumo === "1") {
      const contagens = (lista) => (lista || []).map((g) => ({ grupo: g.grupo, totalLeads: g.totalLeads }));
      return res.json({ totalLeads: analise.totalLeads, porEstado: contagens(analise.porEstado), porRegiao: contagens(analise.porRegiao) });
    }
    // Valor investido por campanha, lido do Meta quando o token está
    // configurado. Uma falha do Meta não impede a resposta: o valor fica vazio.
    analise.investimento = { configurado: metaConfigurado(), erro: null };
    if (metaConfigurado()) {
      try {
        const linhas = await buscarGastoDoMeta(periodo.inicio, periodo.fim);
        analise.porCampanhaMeta = associarInvestimentoPorCampanha(analise.porCampanhaMeta, linhas);
      } catch (erro) {
        analise.investimento.erro = erro.message || "Falha ao consultar o Meta.";
      }
    }
    res.json(analise);
  } catch (erro) {
    responderErro(res, erro, "Falha ao montar a análise de tráfego");
  }
});

// Lê a semana indicada na requisição (query ou corpo). Responde 400 ou 404 e
// devolve null quando não há o que processar.
async function semanaDaRequisicao(req, res) {
  const inicio = req.body?.inicio || req.query.inicio;
  const fim = req.body?.fim || req.query.fim;
  if (!DATA.test(inicio || "") || !DATA.test(fim || "")) {
    res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
    return null;
  }
  const registro = await armazenamento.lerSemana(inicio, fim);
  if (!registro) {
    res.status(404).json({ error: "Semana não encontrada. Salve a semana antes." });
    return null;
  }
  return registro;
}

const texto = (valor, limite = 1000) => String(valor ?? "").trim().slice(0, limite);

// Salva o período como uma semana do histórico. Regravar a mesma semana
// atualiza a análise e preserva custo, decisões e observações.
app.post("/api/trafego/salvar-semana", async (req, res) => {
  const periodo = periodoDe(req.body?.inicio, req.body?.fim);
  if (!periodo) return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
  try {
    const analise = await calcularAnaliseDeTrafego(periodo, { apenasNovos: Boolean(req.body.apenasNovos) });
    const existente = await armazenamento.lerSemana(periodo.inicio, periodo.fim);
    const registro = await armazenamento.gravarSemana({
      inicio: periodo.inicio,
      fim: periodo.fim,
      analise,
      custo: existente?.custo || null,
      decisoes: existente?.decisoes || [],
      observacoes: existente?.observacoes || [],
      criadoEm: existente?.criadoEm || new Date().toISOString(),
    });
    res.json(registro);
  } catch (erro) {
    responderErro(res, erro, "Falha ao salvar a semana");
  }
});

app.get("/api/trafego/semanas", async (req, res) => {
  try {
    res.json(await armazenamento.lerListaDeSemanas());
  } catch (erro) {
    responderErro(res, erro, "Falha ao listar as semanas salvas");
  }
});

app.get("/api/trafego/semana", async (req, res) => {
  try {
    const registro = await semanaDaRequisicao(req, res);
    if (registro) res.json(registro);
  } catch (erro) {
    responderErro(res, erro, "Falha ao ler a semana");
  }
});

app.delete("/api/trafego/semana", async (req, res) => {
  try {
    const registro = await semanaDaRequisicao(req, res);
    if (!registro) return;
    await armazenamento.removerSemana(registro.inicio, registro.fim);
    await registrarAlteracao(req, "Semana de tráfego apagada", { detalhe: `${registro.inicio} a ${registro.fim}` });
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro, "Falha ao excluir a semana");
  }
});

// Orçamento da semana. Só valores de custo: leads e qualificados vêm do Kommo.
app.post("/api/trafego/custo", async (req, res) => {
  try {
    const registro = await semanaDaRequisicao(req, res);
    if (!registro) return;
    const custo = req.body.custo || {};
    const valor = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== "" ? Number(v) : null);
    registro.custo = {
      orcamentoMensal: valor(custo.orcamentoMensal),
      orcamentoDiarioTotal: valor(custo.orcamentoDiarioTotal),
      brandingDiario: valor(custo.brandingDiario),
      porAnuncio: juntarCusto(
        (Array.isArray(custo.porAnuncio) ? custo.porAnuncio : []).map((c) => ({ grupo: texto(c.grupo, 300), orcamentoDiario: valor(c.orcamentoDiario) })),
        (registro.custo?.porAnuncio || []).map((c) => ({ grupo: c.grupo, gastoReal: c.gastoReal ?? null })),
      ),
      meta: registro.custo?.meta || null,
    };
    await registrarAlteracao(req, "Orçamento da semana alterado", { detalhe: `${registro.inicio} a ${registro.fim}` });
    res.json(await armazenamento.gravarSemana(registro));
  } catch (erro) {
    responderErro(res, erro, "Falha ao salvar o custo");
  }
});

// Une, por grupo, o orçamento diário digitado e o valor investido importado do
// Meta. Ficam só os grupos com pelo menos um dos dois valores.
function juntarCusto(orcamentos, gastos) {
  const porGrupo = new Map();
  const item = (grupo) => porGrupo.get(grupo) || porGrupo.set(grupo, { grupo, orcamentoDiario: null, gastoReal: null }).get(grupo);
  for (const o of orcamentos) if (o.grupo) item(o.grupo).orcamentoDiario = o.orcamentoDiario ?? null;
  for (const g of gastos) if (g.grupo) item(g.grupo).gastoReal = g.gastoReal ?? null;
  return [...porGrupo.values()].filter((c) => c.orcamentoDiario !== null || c.gastoReal !== null);
}

// Importa do Meta o valor investido na semana e o associa aos anúncios e
// conjuntos dos leads. O orçamento digitado é preservado; onde houver valor
// importado, é ele que entra no cálculo do custo.
app.post("/api/trafego/importar-gasto-meta", async (req, res) => {
  try {
    if (!metaConfigurado()) {
      return res.status(400).json({ error: "Integração com o Meta não configurada. Defina META_TOKEN e META_CONTA_ANUNCIOS no servidor." });
    }
    const registro = await semanaDaRequisicao(req, res);
    if (!registro) return;
    const linhas = await buscarGastoDoMeta(registro.inicio, registro.fim);
    const associacao = associarGastoDoMeta(registro.analise?.porAnuncioEConjunto || [], linhas);
    registro.custo = {
      orcamentoMensal: registro.custo?.orcamentoMensal ?? null,
      orcamentoDiarioTotal: registro.custo?.orcamentoDiarioTotal ?? null,
      brandingDiario: registro.custo?.brandingDiario ?? null,
      porAnuncio: juntarCusto(
        (registro.custo?.porAnuncio || []).map((c) => ({ grupo: c.grupo, orcamentoDiario: c.orcamentoDiario ?? null })),
        associacao.porGrupo,
      ),
      meta: {
        importadoEm: new Date().toISOString(),
        gastoTotal: associacao.gastoTotal,
        gastoAssociado: associacao.gastoAssociado,
        semLeads: associacao.semLeads.slice(0, 50),
      },
    };
    await registrarAlteracao(req, "Valor investido importado do Meta", { detalhe: `${registro.inicio} a ${registro.fim}` });
    res.json(await armazenamento.gravarSemana(registro));
  } catch (erro) {
    responderErro(res, erro, "Falha ao importar o valor investido do Meta");
  }
});

// Decisões e observações de uma semana: incluir, editar e excluir.
function rotasDeAnotacao(caminho, lista, nomeDoId, montar) {
  app.post(caminho, async (req, res) => {
    try {
      const registro = await semanaDaRequisicao(req, res);
      if (!registro) return;
      const item = montar(req.body);
      if (!item) return res.status(400).json({ error: "Texto obrigatório." });
      registro[lista].push({ id: crypto.randomUUID(), ...item, criadoEm: new Date().toISOString(), usuario: req.get("x-usuario") || null });
      res.json(await armazenamento.gravarSemana(registro));
    } catch (erro) {
      responderErro(res, erro, "Falha ao gravar");
    }
  });
  app.put(caminho, async (req, res) => {
    try {
      const registro = await semanaDaRequisicao(req, res);
      if (!registro) return;
      const item = registro[lista].find((x) => x.id === req.body[nomeDoId]);
      if (!item) return res.status(404).json({ error: "Registro não encontrado nesta semana." });
      const novo = montar({ ...item, ...req.body });
      if (!novo) return res.status(400).json({ error: "Texto obrigatório." });
      Object.assign(item, novo, { editadoEm: new Date().toISOString() });
      res.json(await armazenamento.gravarSemana(registro));
    } catch (erro) {
      responderErro(res, erro, "Falha ao editar");
    }
  });
  app.delete(caminho, async (req, res) => {
    try {
      const registro = await semanaDaRequisicao(req, res);
      if (!registro) return;
      registro[lista] = registro[lista].filter((x) => x.id !== req.query[nomeDoId]);
      res.json(await armazenamento.gravarSemana(registro));
    } catch (erro) {
      responderErro(res, erro, "Falha ao excluir");
    }
  });
}

rotasDeAnotacao("/api/trafego/decisao", "decisoes", "decisaoId", (corpo) => {
  const decisao = texto(corpo.decisao);
  return decisao ? { assunto: texto(corpo.assunto, 120), decisao } : null;
});
rotasDeAnotacao("/api/trafego/observacao", "observacoes", "observacaoId", (corpo) => {
  const conteudo = texto(corpo.texto);
  return conteudo ? { texto: conteudo } : null;
});

// Análise da semana salva, com o custo cruzado quando houver orçamento.
app.get("/api/trafego/analise-com-custo", async (req, res) => {
  try {
    const { inicio, fim } = req.query;
    if (!DATA.test(inicio || "") || !DATA.test(fim || "")) {
      return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
    }
    // Período ainda não salvo como semana é uma situação normal, não um erro.
    const salvo = await armazenamento.lerSemana(inicio, fim);
    if (!salvo) return res.json({ semanaSalva: false, porAnuncioEConjunto: [] });
    const [registro] = await comAnaliseAtual([salvo]);
    const grupos = registro.analise.porAnuncioEConjunto || [];
    res.json({
      ...registro.analise,
      semanaSalva: true,
      custo: registro.custo,
      porAnuncioEConjunto: registro.custo
        ? mesclarCusto(grupos, registro.custo.porAnuncio, registro.inicio, registro.fim)
        : grupos,
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao calcular o custo");
  }
});

app.get("/api/trafego/comparar-semana-anterior", async (req, res) => {
  try {
    const atual = await semanaDaRequisicao(req, res);
    if (!atual) return;
    const anteriores = (await armazenamento.lerListaDeSemanas()).filter((s) => s.fim < atual.inicio);
    const referencia = anteriores[anteriores.length - 1];
    const anteriorSalva = referencia ? await armazenamento.lerSemana(referencia.inicio, referencia.fim) : null;
    if (!anteriorSalva) return res.json({ semAnterior: true, mensagem: "Não há semana salva anterior a esta para comparar." });
    const [atualRecalculada, anterior] = await comAnaliseAtual([atual, anteriorSalva]);
    res.json({ semAnterior: false, ...compararSemanas(atualRecalculada, anterior) });
  } catch (erro) {
    responderErro(res, erro, "Falha ao comparar as semanas");
  }
});

// Soma várias semanas salvas em um relatório único.
app.post("/api/trafego/rollup", async (req, res) => {
  const semanas = Array.isArray(req.body?.semanas) ? req.body.semanas.slice(0, 60) : [];
  if (semanas.length < 2) return res.status(400).json({ error: "Selecione ao menos duas semanas." });
  try {
    const registros = [];
    for (const s of semanas) {
      const registro = DATA.test(s.inicio || "") && DATA.test(s.fim || "") ? await armazenamento.lerSemana(s.inicio, s.fim) : null;
      if (!registro) return res.status(404).json({ error: `Semana ${s.inicio} a ${s.fim} não encontrada.` });
      registros.push(registro);
    }
    registros.sort((a, b) => a.inicio.localeCompare(b.inicio));
    res.json({
      periodo: { inicio: registros[0].inicio, fim: registros[registros.length - 1].fim },
      semanasIncluidas: registros.length,
      ...combinarSemanas(await comAnaliseAtual(registros)),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao somar as semanas");
  }
});

// --- Diagnóstico: apoio à configuração de server/config.js -----------------

// Funis e colunas da conta, com os IDs e a etapa do painel a que cada coluna
// foi associada.
app.get("/api/diagnostico/funis", async (req, res) => {
  try {
    cacheMapeamento = null;
    const { valor: mapeamento, funis } = await obterMapeamento();
    res.json({
      completo: mapeamento.completo,
      pendencias: mapeamento.pendencias,
      funis: funis.map((f) => ({
        id: f.id,
        nome: f.name,
        campanha: mapeamento.campanhaPorFunil.get(Number(f.id)) || null,
        colunas: (f._embedded?.statuses || []).map((s) => {
          const registro = mapeamento.etapaPorColuna.get(`${f.id}:${s.id}`);
          return { id: s.id, nome: s.name, etapa: registro?.mapeada ? registro.chave : null };
        }),
      })),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao consultar os funis");
  }
});

// Campos personalizados de lead, com os IDs.
app.get("/api/diagnostico/campos", async (req, res) => {
  try {
    const campos = await kommo.listarCamposDeLead();
    res.json({ total: campos.length, campos: campos.map((c) => ({
        id: c.id,
        nome: c.name,
        codigo: c.code,
        tipo: c.type,
        // Opções dos campos de seleção, necessárias para ligar um indicador a um valor específico.
        opcoes: c.enums ? c.enums.map((o) => ({ id: o.id, valor: o.value })) : undefined,
      })) });
  } catch (erro) {
    responderErro(res, erro, "Falha ao consultar os campos");
  }
});

// Campos brutos de um lead, para conferir como nome, telefone e motivo de
// perda estão gravados na conta.
app.get("/api/diagnostico/lead/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "ID de lead inválido." });
  try {
    const lead = await kommo.buscarLead(req.params.id);
    const idContato = lead._embedded?.contacts?.[0]?.id;
    const contato = idContato ? await kommo.buscarContato(idContato) : null;
    res.json({
      id: lead.id,
      titulo: lead.name,
      funilId: lead.pipeline_id,
      colunaId: lead.status_id,
      etiquetas: lead._embedded?.tags?.map((t) => t.name) || [],
      motivoDePerdaNativo: lead._embedded?.loss_reason?.[0]?.name || null,
      camposDoLead: lead.custom_fields_values,
      contato: contato && { id: contato.id, nome: contato.name, campos: contato.custom_fields_values },
      nomeExtraido: extrairNome(lead, contato),
      telefoneExtraido: extrairTelefone(lead, contato),
    });
  } catch (erro) {
    responderErro(res, erro, "Falha ao consultar o lead");
  }
});

app.use("/api", (req, res) => res.status(404).json({ error: "Rota inexistente." }));

// Erros de leitura do corpo (arquivo grande demais, JSON malformado) também
// respondem em JSON, que é o que o painel entende.
app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  if (erro.type === "entity.too.large") return res.status(413).json({ error: "Arquivo grande demais. O limite é de 20 MB." });
  if (erro.type === "entity.parse.failed") return res.status(400).json({ error: "Dados inválidos." });
  console.error(erro);
  res.status(500).json({ error: "Erro interno do servidor." });
});

app.listen(PORT, () => {
  console.log(`Hub Comercial - Núcleo de Saúde: servidor ativo na porta ${PORT}`);
  if (MODO_LOCAL) console.log("MODO_LOCAL ativo: API sem token e interface servida por este servidor. Não usar em produção.");
  else if (!API_TOKEN) console.warn("API_TOKEN não configurado: a API recusará todas as requisições.");
  if (!kommo.kommoConfigurado()) console.warn("KOMMO_TOKEN ou KOMMO_SUBDOMAIN não configurados.");
  if (!armazenamento.armazenamentoPersistente()) {
    console.warn("Upstash não configurado: exclusões e correções ficarão apenas em memória.");
  }
});
