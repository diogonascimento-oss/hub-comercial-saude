// Liga os funis e colunas do Kommo às campanhas e etapas do painel.
//
// A ligação usa primeiro os IDs definidos em config.js. Onde o ID estiver
// vazio, procura pelo nome. O resultado informa o que ficou pendente, para o
// painel avisar em vez de exibir números incompletos como se fossem finais.

import { CAMPANHAS, ETAPAS, ETAPA_POR_CHAVE } from "./config.js";

// Maiúsculas, sem acentos, com separadores reduzidos a um espaço.
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const compactar = (texto) => normalizar(texto).replace(/ /g, "");

function encontrarEtapaPorNome(nomeDaColuna) {
  const alvo = normalizar(nomeDaColuna);
  // Correspondência exata primeiro; depois por conteúdo, da expressão mais
  // longa para a mais curta, para "EM QUALIFICACAO" não ser confundida com
  // "LEAD QUALIFICADO".
  for (const etapa of ETAPAS) {
    if (etapa.aliases.some((a) => normalizar(a) === alvo)) return etapa.chave;
  }
  const candidatos = [];
  for (const etapa of ETAPAS) {
    for (const alias of etapa.aliases) {
      const a = normalizar(alias);
      if (a.length >= 6 && alvo.includes(a)) candidatos.push({ chave: etapa.chave, tamanho: a.length });
    }
  }
  candidatos.sort((x, y) => y.tamanho - x.tamanho);
  return candidatos[0]?.chave || null;
}

function encontrarFunilDaCampanha(campanha, funis) {
  if (campanha.pipelineId) {
    return funis.find((f) => Number(f.id) === Number(campanha.pipelineId)) || null;
  }
  const aliases = campanha.aliases.map(compactar);
  const encontrados = funis.filter((f) => aliases.some((a) => compactar(f.name).includes(a)));
  return encontrados.length === 1 ? encontrados[0] : null;
}

// funis: resposta de GET /leads/pipelines do Kommo.
export function montarMapeamento(funis) {
  const etapaPorColuna = new Map(); // "funilId:colunaId" -> { chave, nome, campanha }
  const campanhaPorFunil = new Map(); // funilId -> código da campanha
  const pendencias = [];
  const campanhas = [];

  for (const campanha of CAMPANHAS) {
    const funil = encontrarFunilDaCampanha(campanha, funis);
    if (!funil) {
      pendencias.push(
        campanha.pipelineId
          ? `Campanha ${campanha.codigo}: o funil de ID ${campanha.pipelineId} não existe na conta do Kommo.`
          : `Campanha ${campanha.codigo}: funil não identificado. Informe o pipelineId em server/config.js.`,
      );
      campanhas.push({ codigo: campanha.codigo, nome: campanha.nome, funilId: null, funilNome: null, etapasMapeadas: 0 });
      continue;
    }

    campanhaPorFunil.set(Number(funil.id), campanha.codigo);
    const colunas = funil._embedded?.statuses || [];
    const chavesMapeadas = new Set();

    // 1. IDs explícitos em config.js.
    const chavePorIdConfigurado = new Map();
    for (const [chave, id] of Object.entries(campanha.etapas || {})) {
      if (id) chavePorIdConfigurado.set(Number(id), chave);
    }

    for (const coluna of colunas) {
      let chave = chavePorIdConfigurado.get(Number(coluna.id)) || null;
      // 2. Nome da coluna, somente para etapas sem ID configurado.
      if (!chave) {
        const porNome = encontrarEtapaPorNome(coluna.name);
        if (porNome && !campanha.etapas?.[porNome] && !chavesMapeadas.has(porNome)) chave = porNome;
      }
      if (chave) chavesMapeadas.add(chave);
      etapaPorColuna.set(`${funil.id}:${coluna.id}`, {
        chave: chave || `OUTRA:${coluna.name}`,
        nome: chave ? ETAPA_POR_CHAVE.get(chave).nome : coluna.name,
        campanha: campanha.codigo,
        mapeada: Boolean(chave),
      });
    }

    for (const etapa of ETAPAS) {
      if (!chavesMapeadas.has(etapa.chave)) {
        pendencias.push(`Campanha ${campanha.codigo}: etapa "${etapa.nome}" não localizada no funil "${funil.name}".`);
      }
    }

    campanhas.push({
      codigo: campanha.codigo,
      nome: campanha.nome,
      funilId: Number(funil.id),
      funilNome: funil.name,
      etapasMapeadas: chavesMapeadas.size,
    });
  }

  // Nomes das colunas de todos os funis da conta, inclusive os que o painel não
  // acompanha. Servem para descrever de onde o lead veio quando ele entra em um
  // dos três funis a partir de outro. Além da chave "funil:coluna", guarda só o
  // ID da coluna, que é único na conta (exceto 142 e 143, comuns a todos).
  const colunasDeTodosOsFunis = new Map();
  for (const funil of funis || []) {
    for (const coluna of funil._embedded?.statuses || []) {
      const nome = `${coluna.name} (funil ${funil.name})`;
      colunasDeTodosOsFunis.set(`${funil.id}:${coluna.id}`, nome);
      if (![142, 143].includes(Number(coluna.id))) colunasDeTodosOsFunis.set(`:${coluna.id}`, nome);
    }
  }

  return {
    colunasDeTodosOsFunis,
    campanhas,
    campanhaPorFunil,
    etapaPorColuna,
    pendencias,
    completo: pendencias.length === 0,
    idsDosFunis: campanhas.map((c) => c.funilId).filter(Boolean),
  };
}

// Resolve uma coluna do Kommo para a etapa do painel.
export function resolverEtapa(mapeamento, funilId, colunaId, nomeAlternativo) {
  if (colunaId == null && !nomeAlternativo) return null;
  const registro = mapeamento.etapaPorColuna.get(`${funilId}:${colunaId}`);
  if (registro) return registro;
  // Coluna de um funil que o painel não acompanha: usa o nome real, quando conhecido.
  const deOutroFunil =
    mapeamento.colunasDeTodosOsFunis?.get(`${funilId}:${colunaId}`) || mapeamento.colunasDeTodosOsFunis?.get(`:${colunaId}`);
  const nome = nomeAlternativo || deOutroFunil || `Coluna ${colunaId}`;
  return { chave: `OUTRA:${nome}`, nome, campanha: mapeamento.campanhaPorFunil.get(Number(funilId)) || null, mapeada: false };
}

export function nomeDaEtapa(chave) {
  if (!chave) return "";
  const etapa = ETAPA_POR_CHAVE.get(chave);
  if (etapa) return etapa.nome;
  return chave.startsWith("OUTRA:") ? chave.slice(6) : chave;
}
