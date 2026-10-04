// Cliente da API de Marketing do Meta. Somente leitura: consulta o valor
// investido por anúncio em um período. Exige um token com a permissão
// "ads_read" e o identificador da conta de anúncios.

import axios from "axios";

const VERSAO_PADRAO = "v23.0";
const MAXIMO_DE_PAGINAS = 50;

export function metaConfigurado() {
  return Boolean(process.env.META_TOKEN && process.env.META_CONTA_ANUNCIOS);
}

function contaDeAnuncios() {
  const conta = String(process.env.META_CONTA_ANUNCIOS || "").trim();
  return conta.startsWith("act_") ? conta : `act_${conta}`;
}

// Converte o erro do Meta em uma mensagem que não expõe o token.
function erroDoMeta(erro) {
  const detalhe = erro.response?.data?.error;
  const mensagem = detalhe?.message || erro.message || "erro desconhecido";
  const novo = new Error(`O Meta recusou a consulta: ${mensagem}`);
  novo.status = 502;
  return novo;
}

// Valor investido por anúncio entre duas datas (AAAA-MM-DD), inclusive.
export async function buscarGastoDoMeta(inicio, fim) {
  const versao = process.env.META_VERSAO_API || VERSAO_PADRAO;
  const headers = { Authorization: `Bearer ${process.env.META_TOKEN}` };
  let url = `https://graph.facebook.com/${versao}/${contaDeAnuncios()}/insights`;
  let params = {
    level: "ad",
    fields: "campaign_name,adset_name,ad_name,spend,impressions,clicks",
    time_range: JSON.stringify({ since: inicio, until: fim }),
    limit: 500,
  };

  const linhas = [];
  try {
    for (let pagina = 0; url && pagina < MAXIMO_DE_PAGINAS; pagina++) {
      const { data } = await axios.get(url, { params, headers, timeout: 30000 });
      for (const item of data.data || []) {
        linhas.push({
          campanha: item.campaign_name || "",
          conjunto: item.adset_name || "",
          anuncio: item.ad_name || "",
          gasto: Number(item.spend) || 0,
          impressoes: Number(item.impressions) || 0,
          cliques: Number(item.clicks) || 0,
        });
      }
      // O endereço da próxima página já traz todos os parâmetros.
      url = data.paging?.next || null;
      params = undefined;
    }
  } catch (erro) {
    throw erroDoMeta(erro);
  }
  return linhas;
}
