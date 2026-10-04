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

import { CAMPANHAS, ETAPAS, ETAPA_POR_CHAVE, FUSO_HORARIO } from "./config.js";
import * as kommo from "./kommo.js";
import { montarMapeamento, nomeDaEtapa } from "./mapeamento.js";
import { normalizarLeads, normalizarEvento, aplicarCorrecoes, extrairNome, extrairTelefone } from "./leads.js";
import { calcularEscopo, etapasParaInterface } from "./metricas.js";
import * as armazenamento from "./armazenamento.js";
import { analisarTrafego, mesclarCusto, combinarSemanas, compararSemanas } from "./trafego.js";

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
const CACHE_DADOS_MS = 60 * 1000;
let cacheMapeamento = null; // { em, valor, funis }
const cacheDados = new Map(); // "de:ate" -> { em, promessa }

async function obterMapeamento() {
  if (cacheMapeamento && Date.now() - cacheMapeamento.em < CACHE_FUNIS_MS) return cacheMapeamento;
  const funis = await kommo.listarFunis();
  cacheMapeamento = { em: Date.now(), valor: montarMapeamento(funis), funis };
  return cacheMapeamento;
}

// Leads dos três funis e mudanças de etapa do período.
async function obterDados(deTs, ateTs) {
  const chave = `${deTs}:${ateTs}`;
  const emCache = cacheDados.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_DADOS_MS) return emCache.promessa;

  const promessa = (async () => {
    const { valor: mapeamento } = await obterMapeamento();
    if (!mapeamento.idsDosFunis.length) {
      return { mapeamento, leads: [], eventosBrutos: [] };
    }
    const leadsBrutos = await kommo.listarLeadsDosFunis(mapeamento.idsDosFunis);
    const idsDeContatos = leadsBrutos.map((l) => l._embedded?.contacts?.[0]?.id).filter(Boolean);
    const contatosPorId = await kommo.listarContatosPorIds(idsDeContatos);
    const leads = normalizarLeads(leadsBrutos, contatosPorId, mapeamento);
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

app.get("/api/metrics", async (req, res) => {
  const periodo = lerPeriodo(req);
  if (!periodo) return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });

  try {
    const { mapeamento, leads, eventosPorLead, chavesEncontradas, avisos } = await prepararPeriodo(periodo);

    const agora = Math.floor(Date.now() / 1000);
    const base = { eventosPorLead, deTs: periodo.deTs, ateTs: periodo.ateTs, agora };

    const escopos = {};
    const todas = calcularEscopo({ ...base, leads, incluirListas: true });
    const { listas, ...indicadoresGerais } = todas;
    escopos.TODAS = indicadoresGerais;
    for (const campanha of CAMPANHAS) {
      escopos[campanha.codigo] = calcularEscopo({ ...base, leads: leads.filter((l) => l.campanha === campanha.codigo) });
    }

    res.json({
      periodo: { inicio: periodo.inicio, fim: periodo.fim },
      geradoEm: new Date().toISOString(),
      campanhas: CAMPANHAS.map((c) => ({ codigo: c.codigo, nome: c.nome })),
      etapas: etapasParaInterface(chavesEncontradas),
      mapeamento: { completo: mapeamento.completo, pendencias: mapeamento.pendencias },
      avisos,
      escopos,
      listas,
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
    const idsExcluidos = new Set((await armazenamento.lerExclusoes()).map((e) => String(e.eventId)));
    const correcoesPorId = new Map((await armazenamento.lerCorrecoes()).map((c) => [String(c.eventId), c]));

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
      }));
    res.json({ leadId, eventos });
  } catch (erro) {
    responderErro(res, erro, "Falha ao buscar os eventos do lead");
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
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro, "Falha ao reverter a correção");
  }
});

// --- Tráfego e campanhas -------------------------------------------------------

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function periodoDe(inicio, fim) {
  return lerPeriodo({ query: { inicio, fim } });
}

// Análise de tráfego de um período, opcionalmente restrita a uma campanha.
async function calcularAnaliseDeTrafego(periodo, { apenasNovos, campanha }) {
  const { leads, eventosPorLead } = await prepararPeriodo(periodo);
  const doEscopo = campanha && campanha !== "TODAS" ? leads.filter((l) => l.campanha === campanha) : leads;
  return analisarTrafego({ leads: doEscopo, eventosPorLead, deTs: periodo.deTs, ateTs: periodo.ateTs, apenasNovos });
}

app.get("/api/analise-trafego", async (req, res) => {
  const periodo = lerPeriodo(req);
  if (!periodo) return res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
  try {
    res.json(
      await calcularAnaliseDeTrafego(periodo, {
        apenasNovos: req.query.apenasNovos === "true",
        campanha: req.query.campanha,
      }),
    );
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
      porAnuncio: (Array.isArray(custo.porAnuncio) ? custo.porAnuncio : [])
        .map((c) => ({ grupo: texto(c.grupo, 300), orcamentoDiario: valor(c.orcamentoDiario) }))
        .filter((c) => c.grupo && c.orcamentoDiario !== null),
    };
    res.json(await armazenamento.gravarSemana(registro));
  } catch (erro) {
    responderErro(res, erro, "Falha ao salvar o custo");
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
    const registro = await armazenamento.lerSemana(inicio, fim);
    if (!registro) return res.json({ semanaSalva: false, porAnuncioEConjunto: [] });
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
    const anterior = referencia ? await armazenamento.lerSemana(referencia.inicio, referencia.fim) : null;
    if (!anterior) return res.json({ semAnterior: true, mensagem: "Não há semana salva anterior a esta para comparar." });
    res.json({ semAnterior: false, ...compararSemanas(atual, anterior) });
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
      ...combinarSemanas(registros),
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

app.listen(PORT, () => {
  console.log(`Hub Comercial - Núcleo de Saúde: servidor ativo na porta ${PORT}`);
  if (MODO_LOCAL) console.log("MODO_LOCAL ativo: API sem token e interface servida por este servidor. Não usar em produção.");
  else if (!API_TOKEN) console.warn("API_TOKEN não configurado: a API recusará todas as requisições.");
  if (!kommo.kommoConfigurado()) console.warn("KOMMO_TOKEN ou KOMMO_SUBDOMAIN não configurados.");
  if (!armazenamento.armazenamentoPersistente()) {
    console.warn("Upstash não configurado: exclusões e correções ficarão apenas em memória.");
  }
});
