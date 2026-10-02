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

export const armazenamentoPersistente = configurado;

export const lerExclusoes = () => ler(CHAVE_EXCLUSOES);
export const gravarExclusoes = (lista) => gravar(CHAVE_EXCLUSOES, lista);
export const lerCorrecoes = () => ler(CHAVE_CORRECOES);
export const gravarCorrecoes = (lista) => gravar(CHAVE_CORRECOES, lista);
