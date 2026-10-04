// Kommo simulado, para desenvolvimento e demonstração sem acesso à conta real.
//
// Sobe um servidor local que responde às mesmas rotas da API v4 usadas pelo
// painel, com dados fictícios gerados de forma determinística.
//
// Uso:
//   node dev/kommo-simulado.js                 (porta 4010)
//   KOMMO_BASE_URL=http://localhost:4010/api/v4 KOMMO_TOKEN=teste MODO_LOCAL=true node server.js
//
// Nenhum dado aqui é real.

import express from "express";
import { CAMPANHAS, CAMPOS, ETAPAS } from "../config.js";

const PORTA = process.env.PORTA_SIMULADO || 4010;
const DIA = 86400;
const HORA = 3600;
const AGORA = Math.floor(Date.now() / 1000);

// Gerador pseudoaleatório com semente fixa: os mesmos dados a cada execução.
let semente = 20261002;
function sortear() {
  semente = (semente * 1664525 + 1013904223) % 4294967296;
  return semente / 4294967296;
}
const chance = (p) => sortear() < p;
const entre = (min, max) => min + sortear() * (max - min);
const escolher = (lista) => lista[Math.floor(sortear() * lista.length)];

// Os funis simulados usam os mesmos IDs de server/config.js, para que o
// mapeamento por ID funcione também no ambiente de desenvolvimento.
const NOMES_DAS_COLUNAS = ["Etapa de leads de entrada", ...ETAPAS.map((e) => e.nome.toUpperCase())];
NOMES_DAS_COLUNAS[10] = "Venda ganha";
NOMES_DAS_COLUNAS[11] = "Venda perdida";

function montarFunil(id, name, idsDasEtapas) {
  const ids = [id * 10, ...ETAPAS.map((e, i) => idsDasEtapas?.[e.chave] || id * 10 + i + 1)];
  return { id, name, ids, _embedded: { statuses: NOMES_DAS_COLUNAS.map((nome, i) => ({ id: ids[i], name: nome, pipeline_id: id })) } };
}

const funis = [
  ...CAMPANHAS.map((c, i) => montarFunil(c.pipelineId || 9001 + i, `[${c.codigo}]`, c.etapas)),
  // Funil de outro núcleo, que o painel deve ignorar.
  montarFunil(9099, "Núcleo de Autismo"),
];

const PRIMEIROS = ["Ana", "Bruno", "Carla", "Daniel", "Elisa", "Fábio", "Gisele", "Heitor", "Ingrid", "Jonas", "Karen", "Lucas", "Marta", "Nelson", "Olívia", "Paulo"];
const SOBRENOMES = ["Almeida", "Barros", "Campos", "Dantas", "Esteves", "Farias", "Gouveia", "Holanda", "Lins", "Moura", "Nóbrega", "Pessoa"];
const DDDS = ["81", "81", "81", "83", "84", "85", "11", "21", "71", "87"];
const CAMPANHAS_META = ["Captação Tema 324", "Captação Reajuste"];
const CONJUNTOS = ["Pernambuco 30-55", "Nordeste amplo", "Capitais Sudeste", "Lookalike clientes"];
const ANUNCIOS = ["AD 01 - Decisão judicial", "AD 02 - Quatro sinais", "AD 03 - Depoimento", "AD 04 - Carrossel"];
const MOTIVOS = ["Sem interesse", "Sem resposta após cadência", "Considerou os honorários elevados", "Fechou com concorrente", "Sem aderência jurídica preliminar"];
const VOLUMES = [120, 70, 160, 40];
// Chance de avançar em cada passo, por funil.
const PERFIS = [
  { responde: 0.75, qualifica: 0.8, agenda: 0.4, comparece: 0.55, fecha: 0.2 },
  { responde: 0.85, qualifica: 0.7, agenda: 0.45, comparece: 0.5, fecha: 0.15 },
  { responde: 0.7, qualifica: 0.65, agenda: 0.3, comparece: 0.4, fecha: 0.4 },
  { responde: 0.8, qualifica: 0.7, agenda: 0.5, comparece: 0.6, fecha: 0.3 },
];

const leads = [];
const contatos = [];
const eventos = [];
let proximoLead = 500000;
let proximoEvento = 9000000;

for (const [indice, funil] of funis.entries()) {
  const coluna = (i) => funil.ids[i];
  const perfil = PERFIS[indice];

  for (let n = 0; n < VOLUMES[indice]; n++) {
    const id = ++proximoLead;
    const criadoEm = Math.floor(AGORA - entre(0.5, 75) * DIA);
    const tags = [];
    let atual = 1;
    let t = criadoEm;
    let motivo = null;

    const mover = (para, atrasoEmHoras) => {
      t = Math.floor(t + atrasoEmHoras * HORA);
      if (t >= AGORA) return false;
      eventos.push({
        id: String(++proximoEvento),
        type: "lead_status_changed",
        entity_id: id,
        entity_type: "lead",
        created_at: t,
        value_before: [{ lead_status: { id: coluna(atual), pipeline_id: funil.id } }],
        value_after: [{ lead_status: { id: coluna(para), pipeline_id: funil.id } }],
      });
      atual = para;
      return true;
    };
    const perder = (atraso) => {
      if (mover(11, atraso)) motivo = escolher(MOTIVOS);
    };

    percurso: {
      if (!mover(2, entre(0.01, 0.4))) break percurso;
      if (!chance(perfil.responde)) {
        if (chance(0.3)) perder(entre(240, 320));
        break percurso;
      }
      if (!mover(3, entre(1, 40))) break percurso;
      if (!chance(perfil.qualifica)) {
        if (chance(0.7)) perder(entre(2, 48));
        break percurso;
      }
      if (!mover(4, entre(0.5, 20))) break percurso;
      if (chance(0.8)) tags.push("TINTIN_QUALIFICADO_ENVIADO");
      if (!mover(5, 0.1)) break percurso;
      if (!chance(perfil.agenda)) {
        if (chance(0.2)) perder(entre(200, 400));
        break percurso;
      }
      if (!mover(6, entre(2, 96))) break percurso;
      if (chance(0.6)) tags.push("CONFIRMOU_REUNIAO");

      let compareceu = chance(perfil.comparece);
      if (!compareceu) {
        if (!mover(7, entre(24, 72))) break percurso;
        tags.push("NO_SHOW");
        if (!chance(0.45)) break percurso;
        if (!mover(6, entre(24, 120))) break percurso;
        compareceu = chance(0.7);
        if (!compareceu) {
          mover(7, entre(24, 72));
          break percurso;
        }
      }
      if (!mover(8, entre(24, 72))) break percurso;
      tags.push("REUNIAO_REALIZADA");
      if (chance(0.7)) tags.push("PROPOSTA_ENVIADA");
      if (chance(perfil.fecha)) {
        if (mover(10, entre(24, 240)) && chance(0.9)) tags.push("TINTIN_FECHADO_ENVIADO");
      } else if (chance(0.5)) {
        if (mover(9, entre(240, 400)) && chance(0.2)) perder(entre(200, 600));
      } else if (chance(0.3)) {
        perder(entre(48, 240));
      }
    }

    const semTelefone = chance(0.03);
    const semNome = chance(0.04);
    const telefone = `55${escolher(DDDS)}9${String(Math.floor(entre(10000000, 99999999)))}`;
    const idContato = id + 1000000;
    contatos.push({
      id: idContato,
      name: semNome ? "Contato sem nome" : `${escolher(PRIMEIROS)} ${escolher(SOBRENOMES)}`,
      custom_fields_values: semTelefone ? null : [{ field_id: 1, field_name: "Telefone", field_code: "PHONE", values: [{ value: telefone }] }],
    });
    leads.push({
      id,
      name: `Lead #${id}`,
      pipeline_id: funil.id,
      status_id: coluna(atual),
      created_at: criadoEm,
      updated_at: Math.max(t, criadoEm),
      custom_fields_values: chance(0.9)
        ? [
            { field_id: CAMPOS.campanhaMeta, field_name: "Campanha Meta", values: [{ value: CAMPANHAS_META[indice === 2 ? 1 : 0] }] },
            { field_id: CAMPOS.conjunto, field_name: "Conjunto de anúncios", values: [{ value: escolher(CONJUNTOS) }] },
            { field_id: CAMPOS.anuncio, field_name: "Anúncio / Criativo", values: [{ value: escolher(ANUNCIOS) }] },
          ]
        : null,
      _embedded: {
        tags: tags.map((name, i) => ({ id: i + 1, name })),
        contacts: [{ id: idContato, is_main: true }],
        loss_reason: motivo ? [{ id: 1, name: motivo }] : [],
      },
    });
  }
}

// --- Rotas ----------------------------------------------------------------

const app = express();

app.use((req, res, next) => {
  if (!req.get("authorization")) return res.status(401).json({ title: "Unauthorized" });
  next();
});

// Lê filtros no formato filter[campo][0]=valor ou filter[campo][]=valor.
function valoresDoFiltro(filtro) {
  if (filtro == null) return null;
  if (Array.isArray(filtro)) return filtro.map(String);
  if (typeof filtro === "object") return Object.values(filtro).map(String);
  return [String(filtro)];
}

function paginar(req, res, chave, itens) {
  const limite = Math.min(Number(req.query.limit) || 50, 250);
  const pagina = Number(req.query.page) || 1;
  const lote = itens.slice((pagina - 1) * limite, pagina * limite);
  if (!lote.length) return res.status(204).end();
  const corpo = { _page: pagina, _links: { self: { href: req.originalUrl } }, _embedded: { [chave]: lote } };
  if (pagina * limite < itens.length) corpo._links.next = { href: `pagina-${pagina + 1}` };
  res.json(corpo);
}

app.get("/api/v4/leads/pipelines", (req, res) =>
  res.json({ _embedded: { pipelines: funis.map(({ ids, ...funil }) => funil) } }),
);

app.get("/api/v4/leads/custom_fields", (req, res) =>
  res.json({ _embedded: { custom_fields: [{ id: 7001, name: "Motivo de desqualificação", code: null, type: "select" }] } }),
);

app.get("/api/v4/leads", (req, res) => {
  const ids = valoresDoFiltro(req.query.filter?.pipeline_id);
  paginar(req, res, "leads", ids ? leads.filter((l) => ids.includes(String(l.pipeline_id))) : leads);
});

app.get("/api/v4/leads/:id", (req, res) => {
  const lead = leads.find((l) => String(l.id) === req.params.id);
  return lead ? res.json(lead) : res.status(404).json({ title: "Not found" });
});

app.get("/api/v4/contacts", (req, res) => {
  const ids = valoresDoFiltro(req.query.filter?.id);
  paginar(req, res, "contacts", ids ? contatos.filter((c) => ids.includes(String(c.id))) : contatos);
});

app.get("/api/v4/contacts/:id", (req, res) => {
  const contato = contatos.find((c) => String(c.id) === req.params.id);
  return contato ? res.json(contato) : res.status(404).json({ title: "Not found" });
});

app.get("/api/v4/events", (req, res) => {
  const f = req.query.filter || {};
  let lista = eventos;
  if (f.entity_id) lista = lista.filter((e) => String(e.entity_id) === String(f.entity_id));
  if (f.created_at?.from) lista = lista.filter((e) => e.created_at >= Number(f.created_at.from));
  if (f.created_at?.to) lista = lista.filter((e) => e.created_at <= Number(f.created_at.to));
  paginar(req, res, "events", lista.slice().sort((a, b) => b.created_at - a.created_at));
});

app.listen(PORTA, () => {
  console.log(`Kommo simulado na porta ${PORTA}: ${leads.length} leads, ${eventos.length} eventos (dados fictícios).`);
});
