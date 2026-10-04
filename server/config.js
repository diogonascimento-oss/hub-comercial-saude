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
//
// Funis da conta: IR-Q é "[IR]", IR-W é "[IR WHATS]" e REA-Q é "[REAJUSTE]".
// Fechado e Desqualificado usam as colunas finais do Kommo, "Venda ganha"
// (142) e "Venda perdida" (143), cujos IDs são iguais em todos os funis.
export const CAMPANHAS = [
  {
    codigo: "IR-Q",
    nome: "Tema 324/TNU — Questionário",
    aliases: ["IR-Q", "IRQ"],
    pipelineId: 14334820,
    etapas: {
      CONTATO_INICIAL: 110711364,
      CONTATO_INICIADO: 110711500,
      EM_QUALIFICACAO: 111494428,
      LEAD_QUALIFICADO: 110711504,
      EM_AGENDAMENTO: 110711508,
      AGENDADO: 110711512,
      REMARCACAO: 110711516,
      PROTOCOLO_FARMER: 111494432,
      REAQUECIMENTO: 110711520,
      FECHADO: 142,
      DESQUALIFICADO: 143,
    },
  },
  {
    codigo: "IR-W",
    nome: "Tema 324/TNU — WhatsApp",
    aliases: ["IR-W", "IRW"],
    pipelineId: 14334824,
    etapas: {
      CONTATO_INICIAL: 110711380,
      CONTATO_INICIADO: 110711432,
      EM_QUALIFICACAO: 111494488,
      LEAD_QUALIFICADO: 110711436,
      EM_AGENDAMENTO: 110711440,
      AGENDADO: 110711444,
      REMARCACAO: 110711448,
      PROTOCOLO_FARMER: 111494492,
      REAQUECIMENTO: 112306380,
      FECHADO: 142,
      DESQUALIFICADO: 143,
    },
  },
  {
    codigo: "REA-Q",
    nome: "Reajuste abusivo — Questionário",
    aliases: ["REA-Q", "REAQ"],
    pipelineId: 14334420,
    etapas: {
      CONTATO_INICIAL: 110707980,
      CONTATO_INICIADO: 110707984,
      EM_QUALIFICACAO: 111494084,
      LEAD_QUALIFICADO: 110707988,
      EM_AGENDAMENTO: 110708016,
      AGENDADO: 110708020,
      REMARCACAO: 110708024,
      PROTOCOLO_FARMER: 111494088,
      REAQUECIMENTO: 110708028,
      FECHADO: 142,
      DESQUALIFICADO: 143,
    },
  },
];

// Campos personalizados de lead (IDs em Configurações > Campos Personalizados).
// A rota GET /api/diagnostico/campos lista todos os campos da conta com os IDs.
export const CAMPOS = {
  // Motivo de desqualificação. A conta não tem campo próprio para isso: com
  // null, o painel usa o motivo de perda nativo do Kommo, pedido ao mover o
  // lead para "Venda perdida".
  motivoDesqualificacao: null,
  // Origem de marketing, usados na exportação do histórico.
  campanhaMeta: 1127409,
  conjunto: 1127411,
  anuncio: 1127413,
  // Responsáveis por lead, usados nos indicadores por pessoa.
  sdrResponsavel: 1127415,
  closerResponsavel: 1127417,
  farmerResponsavel: 1127419,
  // Registros do protocolo gravados em campos de seleção.
  situacaoDaReuniao: 1127427,
  substatusFarmer: 1127429,
};

// Metas do mês corrente, somadas as três campanhas.
//
// A meta de contratos foi definida pelo escritório. As de reuniões foram
// derivadas dela com as taxas de agosto de 2026 registradas no protocolo
// (26,9% de fechamento sobre reuniões realizadas e 45,6% de comparecimento) e
// arredondadas. São provisórias, até o escritório definir os números finais.
export const METAS_MENSAIS = [
  { chave: "fechados", rotulo: "Contratos fechados", meta: 30 },
  { chave: "reunioesRealizadas", rotulo: "Reuniões realizadas", meta: 110 },
  { chave: "reunioesMarcadas", rotulo: "Reuniões marcadas", meta: 240 },
];

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

// Expediente usado na medição dos tempos de atendimento em horas úteis:
// segunda a sexta, das 8h às 18h. O sábado não conta, porque o atendimento
// nesse dia é eventual. Feriados não são descontados.
export const EXPEDIENTE = {
  diasDaSemana: [1, 2, 3, 4, 5], // 0 = domingo
  horaDeInicio: 8,
  horaDeFim: 18,
  fusoEmHoras: -3,
};

// Leitura do campo "Situação da reunião". O valor do campo decide se a reunião
// foi realizada; quando está vazio ou não se encaixa em nenhuma das listas,
// vale a movimentação entre colunas. A comparação ignora maiúsculas e acentos.
// A lista de "não realizada" é verificada primeiro.
export const SITUACAO_DA_REUNIAO = {
  naoRealizada: ["nao realizada", "nao compareceu", "no-show", "no show", "noshow", "faltou", "ausente", "cancelada"],
  realizada: ["realizada", "compareceu", "concluida"],
};

// Fuso do escritório (America/Recife, sem horário de verão).
export const FUSO_HORARIO = "-03:00";

export const ETAPA_POR_CHAVE = new Map(ETAPAS.map((e) => [e.chave, e]));
export const ORDEM_ETAPAS = ETAPAS.map((e) => e.chave);
