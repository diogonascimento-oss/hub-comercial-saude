// Análise de tráfego: cruza a origem de marketing de cada lead (campanha Meta,
// conjunto de anúncios e anúncio) e a localização do telefone com o avanço do
// lead no funil. Funções puras, sem consulta a serviços externos.

import {
  ETAPAS_PRE_QUALIFICACAO,
  ORDEM_ETAPAS,
  CAMPANHAS_SEM_RASTREIO_DE_ANUNCIO,
  ROTULO_SEM_RASTREIO_DE_ANUNCIO,
} from "./config.js";
import { nomeDaEtapa } from "./mapeamento.js";
import { getLocalizacao } from "./localizacao.js";
import { reunioesDoLead } from "./metricas.js";

const SEM_VALOR = "(não informado)";

// Etapas-marco do gráfico de engajamento: percentual de cada grupo que
// alcançou cada uma delas.
const ETAPAS_MARCO = [
  { rotulo: "Contato Iniciado", alcancou: (l) => l.etapasVisitadas.has("CONTATO_INICIADO") },
  { rotulo: "Qualificado", alcancou: (l) => l.qualificado },
  { rotulo: "Agendado", alcancou: (l) => l.etapasVisitadas.has("AGENDADO") },
  { rotulo: "Protocolo Farmer", alcancou: (l) => l.etapasVisitadas.has("PROTOCOLO_FARMER") },
  { rotulo: "Fechado", alcancou: (l) => l.etapasVisitadas.has("FECHADO") },
];

const umaCasa = (numerador, denominador) => (denominador ? Math.round((numerador / denominador) * 1000) / 10 : 0);
const doisDecimais = (valor) => Math.round(valor * 100) / 100;

// Um registro por lead com atividade no período: etapas por que passou e
// dados de origem. Com apenasNovos, ficam só os leads criados no período, que
// é a definição de "leads gerados pela campanha".
export function consolidarLeads({ leads, eventosPorLead, deTs, ateTs, apenasNovos = false }) {
  const consolidados = [];
  for (const lead of leads) {
    const eventos = eventosPorLead.get(lead.id) || [];
    const criadoNoPeriodo = Boolean(lead.criadoEm) && lead.criadoEm >= deTs && lead.criadoEm <= ateTs;
    if (!eventos.length && !criadoNoPeriodo) continue;
    if (apenasNovos && !criadoNoPeriodo) continue;

    const etapasVisitadas = new Set();
    let qualificado = false;
    if (criadoNoPeriodo) etapasVisitadas.add(eventos[0]?.de || lead.etapa);
    for (const ev of eventos) {
      if (ev.de) etapasVisitadas.add(ev.de);
      if (ev.para) etapasVisitadas.add(ev.para);
      // Mesma regra de qualificação usada nos indicadores do funil.
      const pulouAColuna =
        (ev.para === "EM_AGENDAMENTO" || ev.para === "AGENDADO") && ETAPAS_PRE_QUALIFICACAO.includes(ev.de);
      if (ev.para === "LEAD_QUALIFICADO" || pulouAColuna) qualificado = true;
    }

    let maisAvancada = null;
    let indice = -1;
    for (const chave of etapasVisitadas) {
      const i = ORDEM_ETAPAS.indexOf(chave);
      if (i > indice) {
        indice = i;
        maisAvancada = chave;
      }
    }

    // Campanha sem rastreio de anúncio e sem nenhum campo de origem preenchido.
    const semRastreio =
      CAMPANHAS_SEM_RASTREIO_DE_ANUNCIO.includes(lead.campanha) && !lead.origem?.conjunto && !lead.origem?.anuncio;

    consolidados.push({
      leadId: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      campanha: lead.campanha,
      campanhaMeta: lead.origem?.campanhaMeta || (semRastreio ? ROTULO_SEM_RASTREIO_DE_ANUNCIO : ""),
      conjunto: lead.origem?.conjunto || (semRastreio ? ROTULO_SEM_RASTREIO_DE_ANUNCIO : ""),
      anuncio: lead.origem?.anuncio || (semRastreio ? ROTULO_SEM_RASTREIO_DE_ANUNCIO : ""),
      semRastreioDeAnuncio: semRastreio,
      etapasVisitadas,
      qualificado,
      // Reunião realizada pelas mesmas regras dos indicadores do funil (campo
      // "Situação da reunião" ou saída de Agendado para uma etapa pós-reunião).
      reuniaoRealizada: reunioesDoLead(lead, eventos).some((r) => r.resultado === "Realizada"),
      etapaMaisAvancada: nomeDaEtapa(maisAvancada),
      localizacao: getLocalizacao(lead.telefone),
    });
  }
  return consolidados;
}

const resumoDoLead = (l) => ({ leadId: l.leadId, nome: l.nome, telefone: l.telefone, etapaMaisAvancada: l.etapaMaisAvancada });

function agrupar(leads, chaveDoGrupo) {
  const grupos = new Map();
  for (const lead of leads) {
    const chave = chaveDoGrupo(lead) || SEM_VALOR;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(lead);
  }
  return grupos;
}

function agruparEComputar(leads, chaveDoGrupo) {
  const resultado = [];
  for (const [grupo, doGrupo] of agrupar(leads, chaveDoGrupo)) {
    const passou = (chave) => doGrupo.filter((l) => l.etapasVisitadas.has(chave));
    const qualificados = doGrupo.filter((l) => l.qualificado);
    const reuniao = passou("AGENDADO");
    const farmer = passou("PROTOCOLO_FARMER");
    const fechados = passou("FECHADO");
    const realizadas = doGrupo.filter((l) => l.reuniaoRealizada);
    resultado.push({
      grupo,
      totalLeads: doGrupo.length,
      qualificados: qualificados.length,
      percentualQualificados: umaCasa(qualificados.length, doGrupo.length),
      reuniao: reuniao.length,
      percentualReuniao: umaCasa(reuniao.length, doGrupo.length),
      remarcacao: passou("REMARCACAO").length,
      farmer: farmer.length,
      realizadas: realizadas.length,
      reaquecimento: passou("REAQUECIMENTO").length,
      contratoFechado: fechados.length,
      desqualificados: passou("DESQUALIFICADO").length,
      // Listas para o detalhamento "quem são esses leads".
      leads: doGrupo.map(resumoDoLead),
      leadsQualificados: qualificados.map(resumoDoLead),
      leadsReuniao: reuniao.map(resumoDoLead),
      leadsFarmer: farmer.map(resumoDoLead),
      leadsRealizadas: realizadas.map(resumoDoLead),
      leadsFechados: fechados.map(resumoDoLead),
    });
  }
  return resultado.sort((a, b) => b.totalLeads - a.totalLeads);
}

function engajamentoPorEtapa(leads, chaveDoGrupo) {
  const resultado = [];
  for (const [grupo, doGrupo] of agrupar(leads, chaveDoGrupo)) {
    resultado.push({
      grupo,
      totalLeads: doGrupo.length,
      pontos: ETAPAS_MARCO.map((marco) => {
        const alcancaram = doGrupo.filter(marco.alcancou);
        return {
          etapa: marco.rotulo,
          percentual: umaCasa(alcancaram.length, doGrupo.length),
          quantidade: alcancaram.length,
          leads: alcancaram.map(resumoDoLead),
        };
      }),
    });
  }
  return resultado.sort((a, b) => b.totalLeads - a.totalLeads);
}

// O mesmo anúncio pode rodar com orçamentos diferentes em cada conjunto, por
// isso o custo é lançado pela combinação anúncio + conjunto.
const chaveAnuncioEConjunto = (l) =>
  l.semRastreioDeAnuncio ? ROTULO_SEM_RASTREIO_DE_ANUNCIO : `${l.anuncio || "(sem anúncio)"} — ${l.conjunto || "(sem conjunto)"}`;

export function analisarTrafego(parametros) {
  const leads = consolidarLeads(parametros);
  const porConjunto = agruparEComputar(leads, (l) => l.conjunto);
  const somar = (campo) => porConjunto.reduce((total, g) => total + g[campo], 0);

  return {
    totalLeads: leads.length,
    totalQualificados: somar("qualificados"),
    totalReuniao: somar("reuniao"),
    totalContratoFechado: somar("contratoFechado"),
    porConjunto,
    porAnuncio: agruparEComputar(leads, (l) => l.anuncio),
    porAnuncioEConjunto: agruparEComputar(leads, chaveAnuncioEConjunto),
    porCampanhaMeta: agruparEComputar(leads, (l) => l.campanhaMeta),
    porCampanha: agruparEComputar(leads, (l) => l.campanha),
    porRegiao: agruparEComputar(leads, (l) => l.localizacao.regiao),
    porEstado: agruparEComputar(leads, (l) => l.localizacao.estado),
    conjuntoPorRegiao: agruparEComputar(
      leads,
      (l) => `${l.conjunto || "(sem conjunto)"} → ${l.localizacao.regiao || "(DDD não identificado)"}`,
    ),
    engajamentoPorConjunto: engajamentoPorEtapa(leads, (l) => l.conjunto),
    engajamentoPorEstado: engajamentoPorEtapa(leads, (l) => l.localizacao.estado),
    leadsSemTelefoneReconhecido: leads.filter((l) => !l.localizacao.formatoReconhecido).length,
    leadsSemOrigem: leads.filter((l) => !l.conjunto && !l.anuncio).length,
    leadsSemRastreioDeAnuncio: leads.filter((l) => l.semRastreioDeAnuncio).length,
    todosOsLeads: leads.map(resumoDoLead),
    leadsQualificadosTotal: leads.filter((l) => l.qualificado).map(resumoDoLead),
    apenasNovos: Boolean(parametros.apenasNovos),
  };
}

const diasDoPeriodo = (inicio, fim) => (new Date(fim) - new Date(inicio)) / 86400000 + 1;

function comCusto(grupo, custoTotal, orcamentoDiario) {
  if (custoTotal === null || custoTotal === undefined) {
    return { ...grupo, orcamentoDiario: orcamentoDiario ?? null, custoTotal: null, custoPorLead: null, custoPorQualificado: null, custoPorContratoFechado: null };
  }
  return {
    ...grupo,
    orcamentoDiario: orcamentoDiario ?? null,
    custoTotal: doisDecimais(custoTotal),
    custoPorLead: grupo.totalLeads ? doisDecimais(custoTotal / grupo.totalLeads) : null,
    custoPorQualificado: grupo.qualificados ? doisDecimais(custoTotal / grupo.qualificados) : null,
    custoPorContratoFechado: grupo.contratoFechado ? doisDecimais(custoTotal / grupo.contratoFechado) : null,
  };
}

// Custo de um item do orçamento no período: o valor investido importado do
// Meta, quando houver; senão, o orçamento diário informado vezes os dias.
function custoDoItem(item, dias) {
  if (item.gastoReal !== null && item.gastoReal !== undefined) return item.gastoReal;
  if (item.orcamentoDiario !== null && item.orcamentoDiario !== undefined) return item.orcamentoDiario * dias;
  return null;
}

// Cruza o custo registrado para a semana com os grupos calculados. O custo por
// lead, por qualificado e por contrato é sempre calculado, nunca digitado.
export function mesclarCusto(grupos, listaDeCusto, inicio, fim) {
  const dias = diasDoPeriodo(inicio, fim);
  const custoPorGrupo = new Map((listaDeCusto || []).map((c) => [c.grupo, c]));
  return grupos.map((g) => {
    const custo = custoPorGrupo.get(g.grupo);
    return custo ? comCusto(g, custoDoItem(custo, dias), custo.orcamentoDiario) : comCusto(g, null);
  });
}

// Custo total de uma semana salva, somando os conjuntos com custo registrado.
export function custoTotalDaSemana(registro) {
  if (!registro.custo?.porAnuncio?.length) return null;
  const dias = diasDoPeriodo(registro.inicio, registro.fim);
  return registro.custo.porAnuncio.reduce((total, c) => total + (custoDoItem(c, dias) || 0), 0);
}

// Valor investido no Meta por campanha, associado pelo nome da campanha
// gravado no lead (maiúsculas e espaços ignorados). Gastos de campanhas sem
// lead no período não entram: a conta de anúncios pode ter campanhas de outras
// áreas do escritório.
export function associarInvestimentoPorCampanha(grupos, linhas) {
  const gastoPorNome = new Map();
  for (const linha of linhas || []) {
    const chave = normalizarNome(linha.campanha);
    if (chave) gastoPorNome.set(chave, (gastoPorNome.get(chave) || 0) + (Number(linha.gasto) || 0));
  }
  return (grupos || []).map((g) => {
    const chave = normalizarNome(g.grupo);
    return { ...g, investido: gastoPorNome.has(chave) ? doisDecimais(gastoPorNome.get(chave)) : null };
  });
}

const normalizarNome = (texto) => String(texto || "").trim().toLowerCase().replace(/\s+/g, " ");

// Associa o valor investido vindo do Meta aos grupos "anúncio — conjunto" da
// semana. A associação é pelo nome: o anúncio e o conjunto gravados no lead
// precisam ter o mesmo nome usado no Meta (maiúsculas e espaços são ignorados).
// O que foi investido em anúncios sem lead na semana é devolvido à parte.
export function associarGastoDoMeta(grupos, linhas) {
  const grupoPorNome = new Map((grupos || []).map((g) => [normalizarNome(g.grupo), g.grupo]));
  const gastoPorGrupo = new Map();
  const semLeads = [];
  let gastoTotal = 0;
  for (const linha of linhas || []) {
    gastoTotal += linha.gasto;
    const chave = normalizarNome(chaveAnuncioEConjunto({ anuncio: linha.anuncio.trim(), conjunto: linha.conjunto.trim() }));
    const grupo = grupoPorNome.get(chave);
    if (grupo) gastoPorGrupo.set(grupo, (gastoPorGrupo.get(grupo) || 0) + linha.gasto);
    else if (linha.gasto > 0) semLeads.push({ anuncio: linha.anuncio, conjunto: linha.conjunto, campanha: linha.campanha, gasto: doisDecimais(linha.gasto) });
  }
  return {
    porGrupo: [...gastoPorGrupo].map(([grupo, gasto]) => ({ grupo, gastoReal: doisDecimais(gasto) })),
    gastoTotal: doisDecimais(gastoTotal),
    gastoAssociado: doisDecimais([...gastoPorGrupo.values()].reduce((a, b) => a + b, 0)),
    semLeads: semLeads.sort((a, b) => b.gasto - a.gasto),
  };
}

function somarGrupos(listas) {
  const soma = new Map();
  const campos = ["totalLeads", "qualificados", "reuniao", "realizadas", "remarcacao", "farmer", "reaquecimento", "contratoFechado", "desqualificados"];
  const listasDeLeads = ["leads", "leadsQualificados", "leadsReuniao", "leadsRealizadas", "leadsFarmer", "leadsFechados"];
  for (const lista of listas) {
    for (const g of lista || []) {
      if (!soma.has(g.grupo)) {
        soma.set(g.grupo, { grupo: g.grupo, ...Object.fromEntries(campos.map((c) => [c, 0])), ...Object.fromEntries(listasDeLeads.map((c) => [c, []])) });
      }
      const acumulado = soma.get(g.grupo);
      for (const c of campos) acumulado[c] += g[c] || 0;
      for (const c of listasDeLeads) acumulado[c].push(...(g[c] || []));
    }
  }
  // Os percentuais são recalculados sobre as contagens somadas.
  return [...soma.values()]
    .map((g) => ({
      ...g,
      percentualQualificados: umaCasa(g.qualificados, g.totalLeads),
      percentualReuniao: umaCasa(g.reuniao, g.totalLeads),
    }))
    .sort((a, b) => b.totalLeads - a.totalLeads);
}

// Soma várias semanas salvas em um só relatório. O custo só é incluído quando
// todas as semanas têm orçamento informado.
export function combinarSemanas(registros) {
  const analises = registros.map((r) => r.analise);
  const total = (campo) => analises.reduce((soma, a) => soma + (a[campo] || 0), 0);
  const combinado = {
    totalLeads: total("totalLeads"),
    totalQualificados: total("totalQualificados"),
    totalReuniao: total("totalReuniao"),
    totalContratoFechado: total("totalContratoFechado"),
    porCampanhaMeta: somarGrupos(analises.map((a) => a.porCampanhaMeta)),
    porConjunto: somarGrupos(analises.map((a) => a.porConjunto)),
    porAnuncio: somarGrupos(analises.map((a) => a.porAnuncio)),
    porAnuncioEConjunto: somarGrupos(analises.map((a) => a.porAnuncioEConjunto)),
    porRegiao: somarGrupos(analises.map((a) => a.porRegiao)),
    porEstado: somarGrupos(analises.map((a) => a.porEstado)),
  };

  const todasComCusto = registros.every((r) => r.custo?.porAnuncio?.length);
  if (todasComCusto) {
    const custoPorGrupo = new Map();
    for (const r of registros) {
      const dias = diasDoPeriodo(r.inicio, r.fim);
      for (const c of r.custo.porAnuncio) {
        custoPorGrupo.set(c.grupo, (custoPorGrupo.get(c.grupo) || 0) + (custoDoItem(c, dias) || 0));
      }
    }
    combinado.porAnuncioEConjunto = combinado.porAnuncioEConjunto.map((g) =>
      comCusto(g, custoPorGrupo.has(g.grupo) ? custoPorGrupo.get(g.grupo) : null),
    );
  }
  return { ...combinado, todasComCusto };
}

const variacao = (atual, anterior) => {
  if (anterior === null || anterior === undefined || atual === null || atual === undefined) return null;
  if (anterior === 0) return atual > 0 ? 100 : 0;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
};

// Compara uma semana salva com a semana salva imediatamente anterior.
export function compararSemanas(atual, anterior) {
  const item = (a, b) => ({ atual: a, anterior: b, variacaoPct: variacao(a, b) });
  const custoPor = (registro, campo) => {
    const total = custoTotalDaSemana(registro);
    return total !== null && registro.analise[campo] ? doisDecimais(total / registro.analise[campo]) : null;
  };
  const comCustoNasDuas = custoTotalDaSemana(atual) !== null && custoTotalDaSemana(anterior) !== null;
  return {
    semanaAtual: { inicio: atual.inicio, fim: atual.fim },
    semanaAnterior: { inicio: anterior.inicio, fim: anterior.fim },
    leads: item(atual.analise.totalLeads, anterior.analise.totalLeads),
    qualificados: item(atual.analise.totalQualificados, anterior.analise.totalQualificados),
    reuniao: item(atual.analise.totalReuniao, anterior.analise.totalReuniao),
    contratoFechado: item(atual.analise.totalContratoFechado, anterior.analise.totalContratoFechado),
    custoPorLead: comCustoNasDuas ? item(custoPor(atual, "totalLeads"), custoPor(anterior, "totalLeads")) : null,
    custoPorQualificado: comCustoNasDuas
      ? item(custoPor(atual, "totalQualificados"), custoPor(anterior, "totalQualificados"))
      : null,
  };
}
