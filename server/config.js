// Configuração central do Kommo para o Núcleo de Saúde.
//
// Este é o único arquivo que precisa ser editado quando funis, etapas, campos
// ou etiquetas mudarem na conta do Kommo.
//
// Identificadores: enquanto um ID estiver como null, o servidor tenta localizar
// o funil ou a etapa pelo nome (ver "aliases"). O mapeamento por nome é um
// recurso de apoio; o recomendado é preencher os IDs, que não mudam quando
// alguém renomeia uma coluna. A rota GET /api/diagnostico/funis lista os IDs
// encontrados na conta, prontos para copiar para cá.

// Etapas do funil, na ordem da jornada do lead. As três campanhas percorrem
// as mesmas colunas.
//
// categoria:
//   triagem  - contato e qualificação em andamento
//   avanco   - lead qualificado caminhando para o fechamento
//   sucesso  - contrato fechado
//   perda    - desqualificado ou não fechado
export const ETAPAS = [
  { chave: "CONTATO_INICIAL", nome: "Contato Inicial", categoria: "triagem", aliases: ["CONTATO INICIAL"] },
  { chave: "CONTATO_INICIADO", nome: "Contato Iniciado", categoria: "triagem", aliases: ["CONTATO INICIADO"] },
  { chave: "EM_QUALIFICACAO", nome: "Em Qualificação", categoria: "triagem", aliases: ["EM QUALIFICACAO", "QUALIFICACAO"] },
  { chave: "LEAD_QUALIFICADO", nome: "Lead Qualificado", categoria: "avanco", aliases: ["LEAD QUALIFICADO", "LEADS QUALIFICADOS", "QUALIFICADO"] },
  { chave: "EM_AGENDAMENTO", nome: "Em Agendamento", categoria: "avanco", aliases: ["EM AGENDAMENTO", "AGENDAMENTO"] },
  { chave: "AGENDADO", nome: "Agendado", categoria: "avanco", aliases: ["AGENDADO", "REUNIAO AGENDADA"] },
  { chave: "REMARCACAO", nome: "Remarcação", categoria: "avanco", aliases: ["REMARCACAO"] },
  { chave: "PROTOCOLO_FARMER", nome: "Protocolo Farmer", categoria: "avanco", aliases: ["PROTOCOLO FARMER", "FARMER"] },
  { chave: "REAQUECIMENTO", nome: "Reaquecimento", categoria: "avanco", aliases: ["REAQUECIMENTO"] },
  { chave: "FECHADO", nome: "Fechado", categoria: "sucesso", aliases: ["FECHADO", "CONTRATO FECHADO", "VENDA GANHA", "CLOSED WON"] },
  {
    chave: "DESQUALIFICADO",
    nome: "Desqualificado / Não Fechado",
    categoria: "perda",
    aliases: ["DESQUALIFICADO NAO FECHADO", "DESQUALIFICADO", "DESQUALIFICADOS", "NAO FECHADO", "VENDA PERDIDA", "CLOSED LOST"],
  },
];

// Campanhas. Cada campanha é um funil próprio no Kommo.
//
// pipelineId: ID do funil no Kommo.
// etapas: ID de cada coluna dentro desse funil, pela chave da etapa.
export const CAMPANHAS = [
  {
    codigo: "IR-Q",
    nome: "Tema 324/TNU — Questionário",
    aliases: ["IR-Q", "IRQ"],
    pipelineId: null,
    etapas: {
      CONTATO_INICIAL: null,
      CONTATO_INICIADO: null,
      EM_QUALIFICACAO: null,
      LEAD_QUALIFICADO: null,
      EM_AGENDAMENTO: null,
      AGENDADO: null,
      REMARCACAO: null,
      PROTOCOLO_FARMER: null,
      REAQUECIMENTO: null,
      FECHADO: null,
      DESQUALIFICADO: null,
    },
  },
  {
    codigo: "IR-W",
    nome: "Tema 324/TNU — WhatsApp",
    aliases: ["IR-W", "IRW"],
    pipelineId: null,
    etapas: {
      CONTATO_INICIAL: null,
      CONTATO_INICIADO: null,
      EM_QUALIFICACAO: null,
      LEAD_QUALIFICADO: null,
      EM_AGENDAMENTO: null,
      AGENDADO: null,
      REMARCACAO: null,
      PROTOCOLO_FARMER: null,
      REAQUECIMENTO: null,
      FECHADO: null,
      DESQUALIFICADO: null,
    },
  },
  {
    codigo: "REA-Q",
    nome: "Reajuste abusivo — Questionário",
    aliases: ["REA-Q", "REAQ"],
    pipelineId: null,
    etapas: {
      CONTATO_INICIAL: null,
      CONTATO_INICIADO: null,
      EM_QUALIFICACAO: null,
      LEAD_QUALIFICADO: null,
      EM_AGENDAMENTO: null,
      AGENDADO: null,
      REMARCACAO: null,
      PROTOCOLO_FARMER: null,
      REAQUECIMENTO: null,
      FECHADO: null,
      DESQUALIFICADO: null,
    },
  },
];

// Campos personalizados de lead (IDs em Configurações > Campos Personalizados).
// A rota GET /api/diagnostico/campos lista todos os campos da conta com os IDs.
export const CAMPOS = {
  // Motivo de desqualificação. Se ficar null, o painel usa o motivo de perda
  // nativo do Kommo (quando preenchido).
  motivoDesqualificacao: null,
  // Origem de marketing, usados na exportação do histórico.
  campanhaMeta: null,
  conjunto: null,
  anuncio: null,
};

// Etiquetas definidas no protocolo de automações. Alguns indicadores dependem
// delas, porque a informação não está na coluna em que o lead se encontra.
export const ETIQUETAS = {
  confirmouReuniao: "CONFIRMOU_REUNIAO",
  noShow: "NO_SHOW",
  reuniaoRealizada: "REUNIAO_REALIZADA",
  propostaEnviada: "PROPOSTA_ENVIADA",
  tintinQualificado: "TINTIN_QUALIFICADO_ENVIADO",
  tintinFechado: "TINTIN_FECHADO_ENVIADO",
  optOut: "OPT_OUT",
};

// Regras de negócio usadas nos cálculos.

// Etapas anteriores à qualificação.
export const ETAPAS_PRE_QUALIFICACAO = ["CONTATO_INICIAL", "CONTATO_INICIADO", "EM_QUALIFICACAO"];

// Saída de "Agendado" para uma destas etapas indica que a reunião aconteceu.
export const ETAPAS_REUNIAO_REALIZADA = ["PROTOCOLO_FARMER", "REAQUECIMENTO", "FECHADO"];

// Etapas em que o lead não é cobrado por estar parado: as duas finais e o
// reaquecimento, cuja cadência é espaçada por definição.
export const ETAPAS_FORA_DO_ALERTA_DE_PARADOS = ["FECHADO", "DESQUALIFICADO", "REAQUECIMENTO"];

// Dias sem movimentação para um lead ativo ser listado como parado.
export const DIAS_PARA_LEAD_PARADO = 7;

// Pares de etapas da "conversão ampla": do total que passou pela origem,
// quantos chegaram ao destino, mesmo com etapas intermediárias.
export const PARES_CONVERSAO_AMPLA = [
  ["CONTATO_INICIADO", "EM_QUALIFICACAO"],
  ["EM_QUALIFICACAO", "LEAD_QUALIFICADO"],
  ["LEAD_QUALIFICADO", "AGENDADO"],
  ["AGENDADO", "PROTOCOLO_FARMER"],
  ["PROTOCOLO_FARMER", "FECHADO"],
  ["CONTATO_INICIADO", "FECHADO"],
];

// Fuso do escritório (America/Recife, sem horário de verão).
export const FUSO_HORARIO = "-03:00";

export const ETAPA_POR_CHAVE = new Map(ETAPAS.map((e) => [e.chave, e]));
export const ORDEM_ETAPAS = ETAPAS.map((e) => e.chave);
