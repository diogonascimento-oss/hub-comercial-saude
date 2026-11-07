// Converte os registros brutos do Kommo (leads, contatos e eventos) para o
// formato usado pelos cálculos.

import { CAMPOS, RESPONSAVEIS } from "./config.js";
import { resolverEtapa } from "./mapeamento.js";

const PALAVRAS_CHAVE_TELEFONE = ["telefone", "celular", "fone", "whatsapp", "phone", "tel.", "tel "];
const PALAVRAS_CHAVE_NOME = ["nome completo", "nome do lead", "nome cliente"];

function telefoneDosCampos(campos) {
  for (const campo of campos || []) {
    const nome = campo.field_name?.toLowerCase() || "";
    const ehTelefone = campo.field_code === "PHONE" || PALAVRAS_CHAVE_TELEFONE.some((p) => nome.includes(p));
    if (!ehTelefone) continue;
    for (const v of campo.values || []) {
      const valor = String(v?.value || "").trim();
      if (valor) return valor;
    }
  }
  return "";
}

// No Kommo o telefone costuma ficar no contato, não no lead.
export function extrairTelefone(lead, contato) {
  return telefoneDosCampos(lead.custom_fields_values) || telefoneDosCampos(contato?.custom_fields_values) || "";
}

const contemLetra = (texto) => /\p{L}/u.test(texto);
const tituloAutomatico = (titulo) => /^lead\s*#\s*\d+$/i.test(titulo.trim());
const nomeAutomatico = (nome) => /^(sem nome|contato sem nome|unnamed contact)$/i.test(nome.trim());

function nomeDosCampos(campos) {
  const campo = (campos || []).find((f) => {
    const nome = f.field_name?.toLowerCase() || "";
    return PALAVRAS_CHAVE_NOME.some((p) => nome.includes(p));
  });
  const valor = campo?.values?.[0]?.value ? String(campo.values[0].value).trim() : "";
  return valor && contemLetra(valor) ? valor : "";
}

// O título do lead é preenchido pelo Kommo como "Lead #123" quando ninguém
// digita um nome. Ordem de preferência: campo de nome do lead, campo de nome
// do contato, nome do contato, título do lead.
export function extrairNome(lead, contato) {
  const doLead = nomeDosCampos(lead.custom_fields_values);
  if (doLead) return doLead;
  if (contato) {
    const doContato = nomeDosCampos(contato.custom_fields_values);
    if (doContato) return doContato;
    const nomeContato = contato.name ? contato.name.trim() : "";
    if (nomeContato && contemLetra(nomeContato) && !nomeAutomatico(nomeContato)) return nomeContato;
  }
  const titulo = lead.name ? lead.name.trim() : "";
  if (titulo && contemLetra(titulo) && !tituloAutomatico(titulo)) return titulo;
  return "";
}

export function valorDoCampo(campos, idDoCampo) {
  if (!idDoCampo) return "";
  const campo = (campos || []).find((f) => Number(f.field_id) === Number(idDoCampo));
  if (!campo) return "";
  return (campo.values || [])
    .map((v) => String(v?.value ?? "").trim())
    .filter(Boolean)
    .join("; ");
}

// Valor de um campo de rastreamento do Kommo (UTM), localizado pelo código do
// campo (UTM_CAMPAIGN, UTM_CONTENT...), que é o mesmo em todas as contas.
export function valorDoRastreamento(campos, codigo) {
  const campo = (campos || []).find((f) => String(f.field_code || "").toUpperCase() === codigo);
  if (!campo) return "";
  return (campo.values || [])
    .map((v) => String(v?.value ?? "").trim())
    .filter(Boolean)
    .join("; ");
}

// Data da reunião gravada no lead, em segundos. O campo é localizado pelo nome
// ("Data da Reunião"), porque o ID dele não consta da configuração.
function dataDaReuniao(lead) {
  const campo = (lead.custom_fields_values || []).find((c) =>
    /^data da reuni[aã]o$/i.test(String(c.field_name || "").trim()),
  );
  const valor = Number(campo?.values?.[0]?.value);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

// Chave de comparação de um nome: sem acentos, sem diferença de maiúsculas,
// sem título (Dr., Dra., Doutor, Doutora) e sem pontuação solta.
function chaveDoNome(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;]/g, " ")
    .replace(/^\s*(dr|dra|doutor|doutora)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Nome oficial do responsável, conforme RESPONSAVEIS em config.js.
export function nomeOficialDoResponsavel(papel, gravado) {
  const texto = String(gravado || "").trim();
  if (!texto) return "";
  const lista = RESPONSAVEIS[papel] || [];
  const chave = chaveDoNome(texto);
  const exato = lista.find((r) => [r.nome, ...(r.variacoes || [])].some((n) => chaveDoNome(n) === chave));
  if (exato) return exato.nome;
  const primeiroNome = (n) => chaveDoNome(n).split(" ")[0];
  const peloPrimeiroNome = lista.filter((r) => primeiroNome(r.nome) === chave);
  return peloPrimeiroNome.length === 1 ? peloPrimeiroNome[0].nome : texto;
}

function motivoDePerda(lead, etapa) {
  const doCampo = valorDoCampo(lead.custom_fields_values, CAMPOS.motivoDesqualificacao);
  if (doCampo) return doCampo;
  const nativo = lead._embedded?.loss_reason?.[0]?.name || "";
  if (nativo) return nativo;
  // Lead descartado numa coluna criada pela equipe: o nome da coluna é o motivo.
  if (etapa?.extra && etapa.coluna) return etapa.coluna.charAt(0).toUpperCase() + etapa.coluna.slice(1).toLowerCase();
  return "";
}

// Chave de comparação de telefones brasileiros: só os dígitos, sem o código do
// país (55) e com o nono dígito dos celulares. Os números antigos não têm o 9
// (8635-5452) e os novos têm (98635-5452), mas são o mesmo aparelho; o formulário
// e o WhatsApp também gravam o mesmo número com e sem +55. Fixos (começam em 2 a
// 5) ficam como estão. Serve só para comparar: o telefone exibido não muda.
export function chaveDoTelefone(telefone) {
  let t = String(telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if ((t.length === 12 || t.length === 13) && t.startsWith("55")) t = t.slice(2);
  if (t.length === 10 && /[6-9]/.test(t[2])) t = `${t.slice(0, 2)}9${t.slice(2)}`;
  if (t.length === 8 && /[6-9]/.test(t[0])) t = `9${t}`;
  return t;
}

// Campo de origem do lead (campanha do Meta, conjunto ou anúncio): o configurado
// em CAMPOS e, se vier vazio, os campos equivalentes (mesmo nome, com outro ID).
function valorDeOrigem(lead, chave, opcoes) {
  for (const id of [CAMPOS[chave], ...(opcoes.camposDeOrigem?.[chave] || [])]) {
    const valor = valorDoCampo(lead.custom_fields_values, id);
    if (valor) return valor;
  }
  return "";
}

// Nome de um campo para comparar: sem acentos, pontuação, maiúsculas e sem o
// prefixo da campanha ("IR:", "REA:"), com que os campos novos têm sido criados.
const nomeDoCampoParaComparar = (nome) =>
  String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\s*(ir|rea)(-[qw])?\s*[:\-]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Outros campos de lead com o mesmo nome dos campos de origem configurados.
// Quando um campo é recriado (ou a automação passa a gravar em um campo novo,
// com outro ID), os leads novos trazem a campanha no campo novo e o painel,
// que lia só o ID antigo, passa a mostrá-los como "(não informado)". Devolve,
// para cada campo de origem, os IDs equivalentes. definicoes: campos de lead
// da conta, com id e name.
export function camposDeOrigemEquivalentes(definicoes) {
  const resultado = {};
  for (const chave of ["campanhaMeta", "conjunto", "anuncio"]) {
    const configurado = (definicoes || []).find((d) => Number(d.id) === CAMPOS[chave]);
    const nome = configurado ? nomeDoCampoParaComparar(configurado.name) : "";
    resultado[chave] = nome
      ? definicoes.filter((d) => Number(d.id) !== CAMPOS[chave] && nomeDoCampoParaComparar(d.name) === nome).map((d) => Number(d.id))
      : [];
  }
  return resultado;
}

// Leads normalizados e sem duplicidade. Dois leads com o mesmo telefone na
// mesma campanha são tratados como a mesma pessoa; permanece o mais recente.
// O telefone é comparado por chaveDoTelefone, então o mesmo número com e sem o
// nono dígito, ou com e sem +55, também conta como duplicado.
// A mesma pessoa pode existir em campanhas diferentes.
export function normalizarLeads(leadsBrutos, contatosPorId, mapeamento, opcoes = {}) {
  const normalizados = [];
  for (const lead of leadsBrutos) {
    const campanha = mapeamento.campanhaPorFunil.get(Number(lead.pipeline_id));
    if (!campanha) continue;

    const contato = contatosPorId.get(lead._embedded?.contacts?.[0]?.id) || null;
    const telefone = String(extrairTelefone(lead, contato)).replace(/[^0-9]/g, "");
    const nome = extrairNome(lead, contato);
    const etapa = resolverEtapa(mapeamento, lead.pipeline_id, lead.status_id);

    normalizados.push({
      id: Number(lead.id),
      titulo: String(lead.name || ""),
      contatoId: lead._embedded?.contacts?.[0]?.id ? Number(lead._embedded.contacts[0].id) : null,
      // Todos os campos preenchidos no Kommo, por ID do campo, para a aba
      // "Base de leads" (filtros como numa planilha).
      campos: Object.fromEntries(
        (lead.custom_fields_values || []).map((c) => [String(c.field_id), (c.values || []).map((v) => v.value).filter((v) => v !== null && v !== undefined && v !== "").join("; ")]),
      ),
      nome: nome || `Sem nome (${telefone || "sem telefone"})`,
      semNome: !nome,
      telefone,
      campanha,
      etapa: etapa.chave,
      etapaNome: etapa.nome,
      tags: lead._embedded?.tags?.map((t) => t.name) || [],
      motivoPerda: motivoDePerda(lead, etapa),
      // Origem de marketing. Os campos do protocolo, preenchidos pelo Make nos
      // leads de formulário, têm prioridade. Sem eles, valem as UTMs que o
      // Kommo grava nos leads de anúncio de WhatsApp: utm_campaign para a
      // campanha, utm_term para o conjunto e utm_content para o anúncio.
      origem: {
        campanhaMeta: valorDeOrigem(lead, "campanhaMeta", opcoes) || valorDoRastreamento(lead.custom_fields_values, "UTM_CAMPAIGN"),
        conjunto: valorDeOrigem(lead, "conjunto", opcoes) || valorDoRastreamento(lead.custom_fields_values, "UTM_TERM"),
        anuncio: valorDeOrigem(lead, "anuncio", opcoes) || valorDoRastreamento(lead.custom_fields_values, "UTM_CONTENT"),
      },
      responsaveis: {
        sdr: nomeOficialDoResponsavel("sdr", valorDoCampo(lead.custom_fields_values, CAMPOS.sdrResponsavel)),
        closer: nomeOficialDoResponsavel("closer", valorDoCampo(lead.custom_fields_values, CAMPOS.closerResponsavel)),
        farmer: nomeOficialDoResponsavel("farmer", valorDoCampo(lead.custom_fields_values, CAMPOS.farmerResponsavel)),
      },
      situacaoDaReuniao: valorDoCampo(lead.custom_fields_values, CAMPOS.situacaoDaReuniao),
      substatusFarmer: valorDoCampo(lead.custom_fields_values, CAMPOS.substatusFarmer),
      dataDaReuniao: dataDaReuniao(lead),
      criadoEm: Number(lead.created_at) || null,
      atualizadoEm: Number(lead.updated_at) || null,
    });
  }

  normalizados.sort((a, b) => a.id - b.id);
  const semDuplicidade = new Map();
  for (const lead of normalizados) {
    const telefone = chaveDoTelefone(lead.telefone);
    const chave = telefone.length >= 8 ? `${lead.campanha}:${telefone}` : `id:${lead.id}`;
    semDuplicidade.set(chave, lead);
  }
  return Array.from(semDuplicidade.values());
}

// Evento de mudança de etapa em formato simples. Correções manuais (campos
// _origem, _destino) têm precedência sobre o que veio do Kommo.
export function normalizarEvento(evento, mapeamento) {
  const antes = evento.value_before?.[0]?.lead_status;
  const depois = evento.value_after?.[0]?.lead_status;
  const origemKommo = antes ? resolverEtapa(mapeamento, antes.pipeline_id, antes.id, antes.name) : null;
  const destinoKommo = depois ? resolverEtapa(mapeamento, depois.pipeline_id, depois.id, depois.name) : null;

  return {
    id: String(evento.id),
    leadId: Number(evento.entity_id),
    ts: Number(evento._ts ?? evento.created_at),
    tsOriginal: Number(evento.created_at),
    de: evento._origem ?? origemKommo?.chave ?? null,
    para: evento._destino ?? destinoKommo?.chave ?? null,
    deOriginal: origemKommo?.chave ?? null,
    paraOriginal: destinoKommo?.chave ?? null,
    funilId: depois?.pipeline_id ?? antes?.pipeline_id ?? null,
    corrigido: Boolean(evento._corrigido),
  };
}

// Aplica as correções manuais sobre os eventos brutos, sem alterar o original.
export function aplicarCorrecoes(eventos, correcoesPorId) {
  if (!correcoesPorId.size) return eventos;
  return eventos.map((ev) => {
    const c = correcoesPorId.get(String(ev.id));
    if (!c) return ev;
    return {
      ...ev,
      _ts: c.novaDataHora ? Math.floor(new Date(c.novaDataHora).getTime() / 1000) : ev.created_at,
      _origem: c.novaEtapaOrigem || undefined,
      _destino: c.novaEtapaDestino,
      _corrigido: true,
    };
  });
}

// Número contido num texto digitado ("R$ 1.500,00", "1500", "850,5").
export function numeroDoTexto(texto) {
  const bruto = String(texto ?? "").replace(/[R$\s]/gi, "");
  const m = /-?\d[\d.,]*/.exec(bruto);
  if (!m) return null;
  let t = m[0];
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
