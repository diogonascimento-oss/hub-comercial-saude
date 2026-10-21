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
  // Coluna criada depois do protocolo, no momento só em parte dos funis. É
  // localizada pelo nome; nos funis em que não existe, não gera pendência.
  { chave: "REUNIAO_REALIZADA", nome: "Reunião Realizada", categoria: "avanco", aliases: ["REUNIAO REALIZADA"], opcional: true },
  { chave: "REMARCACAO", nome: "Remarcação", categoria: "avanco", aliases: ["REMARCACAO"] },
  { chave: "PROTOCOLO_FARMER", nome: "Protocolo Farmer", categoria: "avanco", aliases: ["PROTOCOLO FARMER", "FARMER"] },
  { chave: "REAQUECIMENTO", nome: "Reaquecimento", categoria: "avanco", aliases: ["REAQUECIMENTO"] },
  { chave: "FECHADO", nome: "Fechado", categoria: "sucesso", aliases: ["FECHADO", "CONTRATO FECHADO", "VENDA GANHA", "CLOSED WON"] },
  {
    chave: "DESQUALIFICADO",
    nome: "Desqualificado / Não Fechado",
    categoria: "perda",
    aliases: ["DESQUALIFICADO NAO FECHADO", "DESQUALIFICADO", "DESQUALIFICADOS", "NAO FECHADO", "VENDA PERDIDA", "CLOSED LOST"],
    // Colunas comuns criadas pela equipe nos funis para descartar leads, além
    // da coluna final "Venda perdida". Contam como Desqualificado; o nome da
    // coluna vira o motivo quando o lead não tem motivo de perda registrado.
    colunasExtras: ["SEM INTERESSE", "DESQUALIFICADO", "DESQUALIFICADOS"],
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
// A meta de contratos (25) foi definida em outubro de 2026. As de reuniões
// foram calculadas a partir dela com as taxas de agosto de 2026 registradas no
// protocolo:
//   realizadas = 25 / 26,9% de fechamento sobre reuniões realizadas = 93
//   marcadas   = 93 / 45,6% de comparecimento = 204
//
// O painel não acompanha faturamento: o valor recebido em cada mês depende da
// forma de pagamento (parcelas de boleto, desconto do cartão) e não está no Kommo.
// Taxas de referência usadas para sugerir as metas de reuniões a partir da meta
// de contratos (agosto de 2026, registradas no protocolo).
export const TAXAS_DE_REFERENCIA = { fechamentoSobreRealizadas: 26.9, comparecimento: 45.6 };

// Metas padrão, usadas enquanto nenhuma meta for definida pelo painel.
export const METAS_MENSAIS = [
  { chave: "fechados", rotulo: "Contratos fechados", meta: 25 },
  { chave: "reunioesRealizadas", rotulo: "Reuniões realizadas", meta: 93 },
  { chave: "reunioesMarcadas", rotulo: "Reuniões marcadas", meta: 204 },
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
// "Reunião Realizada" foi criada no Kommo depois do protocolo.
export const ETAPAS_REUNIAO_REALIZADA = ["REUNIAO_REALIZADA", "PROTOCOLO_FARMER", "REAQUECIMENTO", "FECHADO"];

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
// Opções cadastradas no Kommo (campo 1127427): Agendada, Confirmada, Realizada,
// No-show (falta do cliente), Cancelada pelo cliente, Falha interna do
// escritório e Remarcada. "Agendada", "Confirmada" e "Remarcada" não dizem se a
// reunião aconteceu; nesses casos vale a movimentação.
export const SITUACAO_DA_REUNIAO = {
  naoRealizada: ["nao realizada", "nao compareceu", "no-show", "no show", "noshow", "faltou", "ausente", "cancelada", "falha interna"],
  realizada: ["realizada", "compareceu", "concluida"],
};

// Campanhas em que o anúncio de origem não é registrado no lead. No anúncio
// que abre o WhatsApp, o lead chega como uma conversa, sem a identificação do
// anúncio. Enquanto os campos de origem estiverem vazios, esses leads aparecem
// com o rótulo abaixo e não entram no aviso de leads sem origem. Se os campos
// passarem a ser preenchidos, o valor preenchido prevalece.
export const CAMPANHAS_SEM_RASTREIO_DE_ANUNCIO = ["IR-W"];
export const ROTULO_SEM_RASTREIO_DE_ANUNCIO = "WhatsApp (anúncio não rastreado)";

// Fuso do escritório (America/Recife, sem horário de verão).
export const FUSO_HORARIO = "-03:00";

export const ETAPA_POR_CHAVE = new Map(ETAPAS.map((e) => [e.chave, e]));
export const ORDEM_ETAPAS = ETAPAS.map((e) => e.chave);
