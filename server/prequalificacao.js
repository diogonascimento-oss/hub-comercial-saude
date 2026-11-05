// Pré-qualificação pelo questionário: classifica cada lead pelas respostas
// gravadas nos campos do Kommo, antes de qualquer contato do atendente.
// Funções puras, sem consulta a serviços externos. As regras ficam em
// PRE_QUALIFICACAO, em config.js.
//
// Não confundir com "qualificado" (lead movido para Lead Qualificado pela
// equipe). Aqui o que vale é o que o lead respondeu.

import { CAMPANHAS, PRE_QUALIFICACAO } from "./config.js";

const SEM_VALOR = "(não informado)";

const semAcento = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const umaCasa = (numerador, denominador) => (denominador ? Math.round((numerador / denominador) * 1000) / 10 : 0);
const reais = (n) => `R$ ${Number(n).toLocaleString("pt-BR")}`;

// --- Leitura das respostas ---------------------------------------------------

// Números de um texto: "R$ 900 a R$ 1.500" -> [900, 1500]; "2 mil" -> [2000].
export function numerosDoTexto(texto) {
  const achados = [];
  for (const m of semAcento(texto).matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(\s*mil\b)?/g)) {
    let n = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (m[2]) n *= 1000;
    if (Number.isFinite(n)) achados.push(n);
  }
  return achados;
}

// Valor ou faixa em reais, como intervalo { min, max }.
//   "R$ 1.500"            -> 1500 a 1500
//   "R$ 900 a R$ 1.500"   -> 900 a 1500
//   "acima de R$ 2.000"   -> 2000 a infinito
//   "até R$ 900"          -> 0 a 900
export function intervaloDoValor(texto) {
  const numeros = numerosDoTexto(texto);
  if (!numeros.length) return null;
  if (numeros.length >= 2) return { min: Math.min(numeros[0], numeros[1]), max: Math.max(numeros[0], numeros[1]) };
  const n = numeros[0];
  const t = semAcento(texto);
  if (/\b(acima|mais de|maior|superior|a partir|alem de)\b|[>+]/.test(t)) return { min: n, max: Infinity };
  if (/\b(ate|abaixo|menos de|menor|inferior|no maximo)\b|</.test(t)) return { min: 0, max: n };
  return { min: n, max: n };
}

// Onde o intervalo fica em relação ao limite ("acima de R$ X").
//   acima  - todo o intervalo passa do limite
//   abaixo - todo o intervalo está no limite ou abaixo dele
//   incerto - o limite cai dentro da faixa: falta confirmar com o lead
export function compararComLimite(intervalo, limite) {
  if (!intervalo) return null;
  if (intervalo.min === intervalo.max) return intervalo.min > limite ? "acima" : "abaixo";
  if (intervalo.min >= limite) return "acima";
  if (intervalo.max <= limite) return "abaixo";
  return "incerto";
}

export function respostaSimNao(texto) {
  const t = semAcento(texto);
  if (!t) return null;
  if (/^(nao|n)\b|^nenhum|^nunca/.test(t)) return "nao";
  if (/^(sim|s|yes|possuo|tenho|tem|recebi|ja recebi)\b/.test(t)) return "sim";
  return null;
}

// "Sim" e "Não", e também respostas de tipo de escola ("Particular", "Pública").
export function respostaEscola(texto) {
  const t = semAcento(texto);
  if (!t) return null;
  if (/^nao\b|\bnao\b.*\bparticular|publica|municipal|estadual|federal|filantropic/.test(t)) return "nao";
  if (/particular|privad/.test(t)) return "sim";
  return respostaSimNao(texto);
}

// --- Avaliação de um critério ------------------------------------------------

// status: atende | falha | incerto | semResposta
export function avaliarCriterio(criterio, valorBruto) {
  const valor = String(valorBruto ?? "").trim();
  if (!valor) return { status: "semResposta", detalhe: `${criterio.rotulo}: sem resposta` };

  if (criterio.tipo === "valor") {
    const intervalo = intervaloDoValor(valor);
    const posicao = compararComLimite(intervalo, criterio.acimaDe);
    if (posicao === "acima") return { status: "atende", detalhe: "" };
    if (posicao === "abaixo") return { status: "falha", detalhe: `${criterio.rotulo} não passa de ${reais(criterio.acimaDe)} (${valor})` };
    if (posicao === "incerto") return { status: "incerto", detalhe: `${criterio.rotulo} na faixa ${valor}: confirmar se passa de ${reais(criterio.acimaDe)}` };
    return { status: "incerto", detalhe: `${criterio.rotulo}: resposta não reconhecida (${valor})` };
  }

  if (criterio.tipo === "simnao" || criterio.tipo === "escola") {
    const r = criterio.tipo === "escola" ? respostaEscola(valor) : respostaSimNao(valor);
    if (r === "sim") return { status: "atende", detalhe: "" };
    if (r === "nao") return { status: "falha", detalhe: `${criterio.rotulo}: ${valor}` };
    return { status: "incerto", detalhe: `${criterio.rotulo}: resposta não reconhecida (${valor})` };
  }

  if (criterio.tipo === "plano") {
    const t = semAcento(valor);
    // Aceitos primeiro: "Individual ou familiar" atende pelo "familiar".
    if (criterio.aceitos?.test(t)) return { status: "atende", detalhe: "" };
    if (criterio.recusados?.test(t)) return { status: "falha", detalhe: `${criterio.rotulo}: ${valor}` };
    return { status: "incerto", detalhe: `${criterio.rotulo}: resposta não reconhecida (${valor})` };
  }

  return { status: "incerto", detalhe: `${criterio.rotulo}: tipo de critério desconhecido` };
}

// --- Localização dos campos no Kommo ----------------------------------------

const preenchidoNo = (lead, idDoCampo) => Boolean(String(lead.campos?.[String(idDoCampo)] ?? "").trim());

// Para cada critério, o campo do Kommo que guarda a resposta: o ID da
// configuração ou, sem ele, um campo cujo nome combina com a expressão. Os
// nomes se sobrepõem (\"Mensalidade da escola\" combina com \"escola\" e com
// \"mensalidade\"), então a escolha é feita para o conjunto: um campo atende a
// um critério só, e vale a combinação com mais critérios ligados a campos
// preenchidos nos leads da campanha, depois a com mais respostas no total.
export function resolverCampos(criterios, definicoes, leads) {
  const quantosPreencheram = (id) => leads.filter((l) => preenchidoNo(l, id)).length;
  const candidatosDe = (c) => {
    if (c.campo?.id) {
      const def = definicoes.find((d) => Number(d.id) === Number(c.campo.id));
      return [{ id: Number(c.campo.id), nome: def?.name || `Campo ${c.campo.id}` }];
    }
    if (!c.campo?.nome) return [];
    return definicoes.filter((d) => c.campo.nome.test(d.name || "")).map((d) => ({ id: Number(d.id), nome: d.name }));
  };
  const opcoes = criterios.map((c) =>
    candidatosDe(c)
      .map((d) => ({ ...d, preenchidos: quantosPreencheram(d.id) }))
      .sort((a, b) => b.preenchidos - a.preenchidos)
      .slice(0, 6),
  );

  // Placar: critérios com campo preenchido, total de respostas, campos achados.
  const placarDe = (escolha) => [
    escolha.filter((d) => d && d.preenchidos > 0).length,
    escolha.reduce((t, d) => t + (d?.preenchidos || 0), 0),
    escolha.filter(Boolean).length,
  ];
  const maior = (a, b) => {
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
    return false;
  };

  let melhor = null;
  const atual = [];
  const usados = new Set();
  const buscar = (i) => {
    if (i === criterios.length) {
      const placar = placarDe(atual);
      if (!melhor || maior(placar, melhor.placar)) melhor = { placar, escolha: [...atual] };
      return;
    }
    atual[i] = null;
    buscar(i + 1);
    for (const d of opcoes[i]) {
      if (usados.has(d.id)) continue;
      atual[i] = d;
      usados.add(d.id);
      buscar(i + 1);
      usados.delete(d.id);
    }
    atual[i] = null;
  };
  buscar(0);

  return Object.fromEntries(criterios.map((c, i) => [c.chave, melhor?.escolha[i] || null]));
}

// --- Avaliação de um lead ----------------------------------------------------

// situacao: preQualificado | pendente | naoQualificado | semRespostas
export function avaliarLead(lead, regras, campos) {
  const valorDe = (c) => (campos[c.chave] ? String(lead.campos?.[String(campos[c.chave].id)] ?? "").trim() : "");

  const itens = regras.criterios.map((c) => ({ criterio: c, valor: valorDe(c), ...avaliarCriterio(c, valorDe(c)) }));
  const respondidos = itens.filter((i) => i.status !== "semResposta");

  let situacao;
  if (!respondidos.length) situacao = "semRespostas";
  else if (itens.some((i) => i.status === "falha")) situacao = "naoQualificado";
  else if (itens.every((i) => i.status === "atende")) situacao = "preQualificado";
  else situacao = "pendente";

  const parecer = situacao === "preQualificado" || situacao === "semRespostas"
    ? ""
    : itens.filter((i) => (situacao === "naoQualificado" ? i.status === "falha" : i.status !== "atende")).map((i) => i.detalhe).join("; ");

  const complementares = (regras.complementar || []).map((c) => {
    const valor = campos[c.chave] ? String(lead.campos?.[String(campos[c.chave].id)] ?? "").trim() : "";
    return { criterio: c, valor, resposta: valor ? respostaSimNao(valor) : null };
  });

  const respostas = [...itens, ...complementares]
    .filter((i) => i.valor)
    .map((i) => `${i.criterio.rotulo}: ${i.valor}`)
    .join(" · ");

  return { situacao, parecer, respostas, complementares };
}

// --- Análise por campanha e por grupo ---------------------------------------

const AGRUPAMENTOS = {
  anuncio: (l) => l.anuncio,
  conjunto: (l) => l.conjunto,
  campanhaMeta: (l) => l.campanhaMeta,
  campanha: (l) => l.campanha,
};
export const OPCOES_DE_AGRUPAMENTO = Object.keys(AGRUPAMENTOS);

function resumir(registros) {
  const quantos = (situacao) => registros.filter((r) => r.situacao === situacao).length;
  const preQualificados = quantos("preQualificado");
  return {
    totalLeads: registros.length,
    preQualificados,
    percentualPreQualificados: umaCasa(preQualificados, registros.length),
    pendentes: quantos("pendente"),
    naoQualificados: quantos("naoQualificado"),
    semRespostas: quantos("semRespostas"),
    // Qualificados na mão pela equipe, para comparar com a pré-qualificação.
    qualificadosPelaEquipe: registros.filter((r) => r.qualificadoPelaEquipe).length,
    // Pré-qualificados que a equipe ainda não qualificou nem descartou: a fila
    // de leads bons esperando contato.
    preQualificadosEmTriagem: registros.filter((r) => r.preEmTriagem).length,
    leads: registros,
  };
}

function descricaoDoCriterio(regras) {
  return regras.criterios.map((c) => c.descricao || c.rotulo).join("; ");
}

// consolidados: saída de consolidarLeads (origem, etapas e qualificação da
// equipe). leads: leads normalizados, que trazem as respostas em "campos".
// definicoes: campos de lead da conta (id e nome).
export function analisarPreQualificacao({ consolidados, leads, definicoes, agruparPor = "anuncio", regras = PRE_QUALIFICACAO }) {
  const chaveDoGrupo = AGRUPAMENTOS[agruparPor] || AGRUPAMENTOS.anuncio;
  const leadPorId = new Map(leads.map((l) => [l.id, l]));
  const blocos = [];

  for (const [codigo, regrasDaCampanha] of Object.entries(regras)) {
    const doBloco = consolidados.filter((c) => c.campanha === codigo && leadPorId.has(c.leadId));
    if (!doBloco.length) continue;

    const todosOsCriterios = [...regrasDaCampanha.criterios, ...(regrasDaCampanha.complementar || [])];
    const campos = resolverCampos(todosOsCriterios, definicoes, doBloco.map((c) => leadPorId.get(c.leadId)));

    const registros = doBloco.map((c) => {
      const a = avaliarLead(leadPorId.get(c.leadId), regrasDaCampanha, campos);
      return {
        leadId: c.leadId,
        nome: c.nome,
        telefone: c.telefone,
        etapaMaisAvancada: c.etapaMaisAvancada,
        etapaAtual: c.etapaAtual,
        motivoPerda: c.motivoPerda,
        situacaoDeHoje: c.situacaoDeHoje,
        situacao: a.situacao,
        parecer: a.parecer,
        respostas: a.respostas,
        qualificadoPelaEquipe: Boolean(c.qualificado),
        preEmTriagem: a.situacao === "preQualificado" && !c.qualificado && c.situacaoDeHoje === "emAndamento",
        _grupo: chaveDoGrupo(c) || SEM_VALOR,
        _complementares: a.complementares,
      };
    });

    const porGrupo = new Map();
    for (const r of registros) {
      if (!porGrupo.has(r._grupo)) porGrupo.set(r._grupo, []);
      porGrupo.get(r._grupo).push(r);
    }
    const semInternos = (lista) => lista.map(({ _grupo, _complementares, ...resto }) => resto);
    const grupos = [...porGrupo]
      .map(([grupo, doGrupo]) => ({ grupo, ...resumir(semInternos(doGrupo)) }))
      .sort((a, b) => b.totalLeads - a.totalLeads || a.grupo.localeCompare(b.grupo, "pt-BR"));

    // Informação complementar, só entre os pré-qualificados.
    const preQualificados = registros.filter((r) => r.situacao === "preQualificado");
    const complementar = (regrasDaCampanha.complementar || []).map((c, i) => {
      const respostas = preQualificados.map((r) => r._complementares[i]?.resposta);
      return {
        chave: c.chave,
        rotulo: c.rotulo,
        sim: respostas.filter((r) => r === "sim").length,
        nao: respostas.filter((r) => r === "nao").length,
        semResposta: respostas.filter((r) => !r).length,
      };
    });

    blocos.push({
      codigo,
      titulo: regrasDaCampanha.titulo || codigo,
      nome: CAMPANHAS.find((c) => c.codigo === codigo)?.nome || codigo,
      criterio: descricaoDoCriterio(regrasDaCampanha),
      campos: [
        ...regrasDaCampanha.criterios.map((c) => ({ chave: c.chave, rotulo: c.rotulo, complementar: false, encontrado: campos[c.chave] })),
        ...(regrasDaCampanha.complementar || []).map((c) => ({ chave: c.chave, rotulo: c.rotulo, complementar: true, encontrado: campos[c.chave] })),
      ],
      total: { grupo: "Total", ...resumir(semInternos(registros)) },
      grupos,
      complementar,
    });
  }

  return { geradoEm: new Date().toISOString(), agruparPor: AGRUPAMENTOS[agruparPor] ? agruparPor : "anuncio", campanhas: blocos };
}
