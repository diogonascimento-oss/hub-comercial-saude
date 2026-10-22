// Persistência das exclusões e correções de eventos no Upstash Redis.
//
// O Kommo não permite apagar nem editar eventos do histórico. As marcações
// feitas pelo painel ficam aqui e são aplicadas antes de cada cálculo. O disco
// do Render no plano gratuito é descartado a cada reinício, por isso os dados
// não podem ficar em arquivo local.

import axios from "axios";

const CHAVE_EXCLUSOES = "hubsaude:exclusoes";
const CHAVE_CORRECOES = "hubsaude:correcoes";

const configurado = () => Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// Sem Upstash configurado (desenvolvimento local), os dados ficam em memória
// e se perdem ao encerrar o servidor.
const memoria = new Map();

function cliente() {
  return axios.create({
    baseURL: process.env.UPSTASH_REDIS_REST_URL,
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    timeout: 15000,
  });
}

// Uma falha de leitura é propagada. Tratar a falha como "lista vazia" faria o
// painel recalcular os indicadores ignorando as correções, sem aviso, e a
// gravação seguinte apagaria as marcações existentes.
async function ler(chave) {
  if (!configurado()) return memoria.get(chave) || [];
  const r = await cliente().get(`/get/${chave}`);
  return r.data?.result ? JSON.parse(r.data.result) : [];
}

async function gravar(chave, lista) {
  if (!configurado()) {
    memoria.set(chave, lista);
    return;
  }
  await cliente().post(`/set/${chave}`, JSON.stringify(lista));
}

async function lerRegistro(chave) {
  if (!configurado()) return memoria.get(chave) ?? null;
  const r = await cliente().get(`/get/${chave}`);
  return r.data?.result ? JSON.parse(r.data.result) : null;
}

async function remover(chave) {
  if (!configurado()) {
    memoria.delete(chave);
    return;
  }
  await cliente().post(`/del/${chave}`);
}

export const armazenamentoPersistente = configurado;

export const lerExclusoes = () => ler(CHAVE_EXCLUSOES);
export const gravarExclusoes = (lista) => gravar(CHAVE_EXCLUSOES, lista);
export const lerCorrecoes = () => ler(CHAVE_CORRECOES);
export const gravarCorrecoes = (lista) => gravar(CHAVE_CORRECOES, lista);

// --- Histórico semanal de tráfego ---------------------------------------------
//
// Cada semana salva guarda a análise daquele período, o orçamento informado, as
// decisões e as observações. O custo fica preso à semana: mudar o orçamento de
// um anúncio depois não altera as semanas já salvas.

const CHAVE_LISTA_DE_SEMANAS = "hubsaude:trafego:semanas";
const chaveDaSemana = (inicio, fim) => `hubsaude:trafego:semana:${inicio}_${fim}`;

export const lerListaDeSemanas = () => ler(CHAVE_LISTA_DE_SEMANAS);
export const lerSemana = (inicio, fim) => lerRegistro(chaveDaSemana(inicio, fim));

export async function gravarSemana(registro) {
  registro.atualizadoEm = new Date().toISOString();
  await gravar(chaveDaSemana(registro.inicio, registro.fim), registro);
  const lista = await lerListaDeSemanas();
  if (!lista.some((s) => s.inicio === registro.inicio && s.fim === registro.fim)) {
    lista.push({ inicio: registro.inicio, fim: registro.fim });
    lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
    await gravar(CHAVE_LISTA_DE_SEMANAS, lista);
  }
  return registro;
}

export async function removerSemana(inicio, fim) {
  await remover(chaveDaSemana(inicio, fim));
  const lista = (await lerListaDeSemanas()).filter((s) => !(s.inicio === inicio && s.fim === fim));
  await gravar(CHAVE_LISTA_DE_SEMANAS, lista);
}

// --- Registro de alterações ---------------------------------------------------
//
// Lista, em ordem cronológica, do que foi alterado pelo painel e por quem. Ao
// contrário das exclusões e correções, nada é apagado daqui quando uma
// alteração é revertida: a reversão vira mais uma linha. Guarda as últimas
// 1.000 entradas.

const CHAVE_REGISTRO = "hubsaude:registro";
const LIMITE_DO_REGISTRO = 1000;

export const lerRegistroDeAlteracoes = () => ler(CHAVE_REGISTRO);

export async function acrescentarAoRegistro(entrada) {
  const lista = await ler(CHAVE_REGISTRO);
  lista.push(entrada);
  await gravar(CHAVE_REGISTRO, lista.slice(-LIMITE_DO_REGISTRO));
}

// Metas mensais definidas pelo painel: um único registro com um item por mês,
// no formato { "2026-10": { fechados, reunioesRealizadas, reunioesMarcadas } }.
const CHAVE_METAS = "hubsaude:metas";
export const lerMetasDefinidas = async () => (await lerRegistro(CHAVE_METAS)) || {};
export const gravarMetasDefinidas = (metas) => gravar(CHAVE_METAS, metas);

// Quem editou a descrição de cada lead pelo painel, e quando: um único
// registro no formato { "<leadId>": { usuario, quando } }.
const CHAVE_DESCRICOES = "hubsaude:descricoes";
export const lerEdicoesDeDescricao = async () => (await lerRegistro(CHAVE_DESCRICOES)) || {};
export async function gravarEdicaoDeDescricao(leadId, edicao) {
  const todas = await lerEdicoesDeDescricao();
  todas[String(leadId)] = edicao;
  await gravar(CHAVE_DESCRICOES, todas);
}
