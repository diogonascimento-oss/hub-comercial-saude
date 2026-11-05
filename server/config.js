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
    // Título do quadro no "Resumo para o núcleo" da aba de tráfego.
    tituloNoResumo: "IR",
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
    // Título do quadro no "Resumo para o núcleo" da aba de tráfego.
    tituloNoResumo: "IR - WhatsApp (Novo Número)",
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
    // Título do quadro no "Resumo para o núcleo" da aba de tráfego.
    tituloNoResumo: "Reajuste",
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

// Nome oficial de cada responsável. O campo no Kommo é texto livre, então o
// mesmo nome pode chegar escrito de jeitos diferentes. O painel junta as
// variações sem diferenciar maiúsculas, acentos e títulos (Dr., Dra.); aceita
// só o primeiro nome quando ele não se repete na lista; e aceita as grafias
// listadas em "variacoes". Nomes fora da lista aparecem como foram gravados.
export const RESPONSAVEIS = {
  sdr: [],
  // "email" é a conta do Google Workspace da closer: a agenda onde o painel
  // cria o evento da reunião. Sem e-mail, a reunião só é gravada no Kommo.
  closer: [
    { nome: "Fabianna Arnaud", variacoes: ["Fabiana Arnaud"], email: null },
    { nome: "Maria Vasconcelos", variacoes: ["Maria Vasconselos"], email: null },
    { nome: "Paula Caldas", variacoes: [], email: null },
  ],
  farmer: [],
};

// Motivos de perda que NÃO são desqualificação: desinteresse ou desistência,
// em qualquer etapa (inclusive antes de terminar a qualificação). Os leads perdidos com um destes motivos vão para o
// cartão "Sem interesse"; todos os demais motivos (inclusive "Motivo
// indefinido", "Outro" e perda sem motivo) continuam em "Desqualificados".
// A comparação ignora maiúsculas e acentos. A coluna "Sem interesse" criada
// nos funis entra aqui pelo próprio nome.
export const MOTIVOS_SEM_INTERESSE = [
  "Sem interesse",
  "Orçamento insuficiente",
  "Fechou com outro escritório",
  "Parou de responder",
  "Não aceitou condições",
  "Considerou os honorários elevados",
  "Não percebeu urgência/benefício",
  "Não gostou do atendimento",
  "Demora ou falha no retorno do escritório",
  "Desistiu após reunião",
  "Preferiu não ajuizar",
  "Opt-out/bloqueio",
];

// Evento da reunião no Google Agenda da closer, criado pela ficha do lead.
export const AGENDA = {
  duracaoPadraoMin: 60,
  // Endereço sugerido para reuniões presenciais (pode ser editado na ficha).
  enderecoDoEscritorio: "",
  // Endereço do painel, para os links do lead e dos anexos dentro do evento.
  enderecoDoPainel: "https://saude.rmadv.workers.dev",
};

// Funis da conta fora das três campanhas onde leads do núcleo podem cair por
// engano. O painel lista os leads novos que aparecem neles (Pendências), para
// investigar a origem. A comparação ignora maiúsculas e acentos.
export const FUNIS_VIGIADOS = ["Funil de vendas"];

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

// Pré-qualificação pelo questionário.
//
// "Qualificado" no painel é só quem a equipe qualificou na mão (moveu para
// Lead Qualificado). "Pré-qualificado" é outra coisa: o lead cujas respostas
// do questionário, gravadas nos campos do Kommo, já atendem ao critério da
// campanha, antes de qualquer contato do atendente. Serve para saber quanto do
// tráfego chega com o perfil certo e quais leads bons ainda esperam contato.
//
// Cada critério lê um campo de lead do Kommo:
//   campo.id    - ID do campo (GET /api/diagnostico/campos lista os IDs). Quando
//                 preenchido, vale sobre o nome.
//   campo.nome  - expressão que localiza o campo pelo nome. Se vários campos
//                 combinarem, vale o mais preenchido na campanha.
//   tipo        - como interpretar a resposta:
//     "valor"      valor em reais, digitado ("R$ 1.500") ou faixa ("R$ 900 a R$
//                  1.500", "acima de R$ 2.000"); compara com "acimaDe". Faixa
//                  que cruza o limite fica como PENDENTE.
//     "simnao"     "Sim" atende; "Não" não atende.
//     "escola"     como "simnao", e também entende "Particular" / "Pública".
//     "plano"      atende quando a resposta casa com "aceitos"; não atende quando
//                  casa com "recusados"; resposta fora das duas fica PENDENTE.
//
// Resultado de cada lead:
//   pré-qualificado - todos os critérios atendidos
//   não qualificado - algum critério claramente não atendido
//   pendente        - sem falha, mas com resposta em faixa que cruza o limite,
//                     resposta não reconhecida ou critério sem resposta
//   sem respostas   - nenhum critério respondido (ex.: lead de WhatsApp)
//
// "complementar" são perguntas mostradas à parte, que NÃO entram na decisão.
//
// IR-W (WhatsApp) usa as regras de IR-Q: se o lead não tiver as respostas
// gravadas, aparece como "sem respostas".
const REGRAS_IR = {
  titulo: "Tema 324/TNU",
  criterios: [
    { chave: "filhoComDeficiencia", rotulo: "Filho com deficiência", descricao: "responde \"sim\" sobre filho com deficiência", tipo: "simnao", campo: { id: null, nome: /defici[eê]ncia|neurodiverg|autis|\btea\b|laudo/i } },
    { chave: "escolaParticular", rotulo: "Escola particular", descricao: "responde \"sim\" sobre escola particular", tipo: "escola", campo: { id: null, nome: /escola|col[eé]gio|particular/i } },
    { chave: "mensalidade", rotulo: "Mensalidade", descricao: "mensalidade acima de R$ 950 (a faixa de R$ 900 a R$ 1.500 fica pendente, pois falta confirmar se passa de R$ 950)", tipo: "valor", acimaDe: 950, campo: { id: null, nome: /mensalidade|valor.*(escola|mensal)|quanto.*paga/i } },
  ],
  complementar: [],
};

export const PRE_QUALIFICACAO = {
  "IR-Q": REGRAS_IR,
  "IR-W": REGRAS_IR,
  "REA-Q": {
    titulo: "Reajuste abusivo",
    criterios: [
      {
        chave: "tipoDePlano", rotulo: "Tipo de plano", descricao: "plano Empresarial/CNPJ ou Familiar", tipo: "plano",
        aceitos: /empresarial|cnpj|\bpme\b|\bmei\b|famil/i,
        recusados: /individual|pessoa f[ií]sica|\bpf\b/i,
        campo: { id: null, nome: /tipo.*plano|modelo.*plano|plano.*(tipo|modalidade)|modalidade|contrata[cç][aã]o/i },
      },
      { chave: "mensalidade", rotulo: "Mensalidade", descricao: "mensalidade acima de R$ 2.000", tipo: "valor", acimaDe: 2000, campo: { id: null, nome: /mensalidade|valor.*(plano|mensal)|quanto.*paga/i } },
    ],
    // Informação complementar: não é requisito de qualificação.
    complementar: [
      { chave: "aumentoRecente", rotulo: "Aumento recente", tipo: "simnao", campo: { id: null, nome: /aument|reajust/i } },
    ],
  },
};
