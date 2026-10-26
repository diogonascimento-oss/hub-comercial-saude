// Linha do tempo das mensagens de chat de um lead, a partir dos eventos do
// Kommo (entrada e saída). Sem o texto, que a API não libera: só horários,
// direção, quem enviou e o canal. Funções puras, testadas em test/mensagens.test.js.

import { segundosUteis } from "./expediente.js";

const TIPOS = { incoming_chat_message: "recebida", outgoing_chat_message: "enviada" };

// Converte os eventos brutos em mensagens ordenadas, sem repetir a mesma
// mensagem registrada no lead e no contato.
export function mensagensDosEventos(eventos, nomesDosUsuarios = new Map()) {
  const vistas = new Set();
  const mensagens = [];
  for (const ev of eventos || []) {
    const direcao = TIPOS[ev.type];
    if (!direcao) continue;
    const msg = ev.value_after?.[0]?.message || {};
    const chave = msg.id ? `m${msg.id}` : `e${ev.id}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const autorId = Number(ev.created_by);
    mensagens.push({
      ts: Number(ev.created_at),
      direcao,
      // Enviada por alguém da equipe, ou por robô ou automação (autor 0).
      autor: direcao === "recebida" ? "cliente" : autorId ? nomesDosUsuarios.get(autorId) || `usuário ${autorId}` : "robô ou automação",
      daEquipe: direcao === "enviada" && Boolean(autorId),
      canal: msg.origin || "",
    });
  }
  return mensagens.sort((a, b) => a.ts - b.ts);
}

const mediana = (lista) => {
  if (!lista.length) return null;
  const o = [...lista].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
};

// Resumo: quantidades, tempo de resposta (da primeira mensagem do cliente
// numa sequência até a primeira resposta enviada depois dela) e, se a última
// mensagem for do cliente, desde quando ele espera.
export function resumirMensagens(mensagens, agora) {
  const respostas = [];
  const respostasDaEquipe = [];
  let esperandoDesde = null;
  for (const m of mensagens) {
    if (m.direcao === "recebida") {
      if (esperandoDesde === null) esperandoDesde = m.ts;
    } else if (esperandoDesde !== null) {
      respostas.push({ corridos: m.ts - esperandoDesde, uteis: segundosUteis(esperandoDesde, m.ts) });
      if (m.daEquipe) respostasDaEquipe.push(m.ts - esperandoDesde);
      esperandoDesde = null;
    }
  }
  const ultima = mensagens.at(-1) || null;
  return {
    recebidas: mensagens.filter((m) => m.direcao === "recebida").length,
    enviadasPelaEquipe: mensagens.filter((m) => m.daEquipe).length,
    enviadasPorRobo: mensagens.filter((m) => m.direcao === "enviada" && !m.daEquipe).length,
    respostas: respostas.length,
    medianaRespostaSeg: mediana(respostas.map((r) => r.corridos)),
    medianaRespostaUteisSeg: mediana(respostas.map((r) => r.uteis)),
    ultimaEm: ultima ? ultima.ts : null,
    ultimaDirecao: ultima ? ultima.direcao : null,
    // Cliente esperando resposta: a sequência final é dele.
    aguardandoDesde: esperandoDesde,
    aguardandoSeg: esperandoDesde !== null ? agora - esperandoDesde : null,
  };
}
