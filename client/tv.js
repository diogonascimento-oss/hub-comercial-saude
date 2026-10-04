// Modo TV: uma tela, sem rolagem, com as metas e os números do mês corrente.
// Exibe apenas totais; nenhum dado pessoal de lead é carregado para a tela.

const API = "/api";
const ATUALIZAR_A_CADA_MS = 5 * 60 * 1000;
const RECARREGAR_A_PAGINA_A_CADA_MS = 6 * 60 * 60 * 1000; // para receber versões novas do painel

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const numero = (n) => (n ?? 0).toLocaleString("pt-BR");
const percentual = (t) => (t === null || t === undefined ? "—" : `${t.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

// Data de hoje no horário do escritório, no formato AAAA-MM-DD.
function hojeNoEscritorio() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife" }).format(new Date());
}

async function chamarApi(caminho) {
  const resposta = await fetch(`${API}${caminho}`);
  const tipo = resposta.headers.get("Content-Type") || "";
  if (!tipo.includes("application/json")) throw new Error("SESSAO");
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.error || `Código ${resposta.status}`);
  return corpo;
}

function renderizarMetas(metas, hoje) {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const fracaoDoMes = dia / diasNoMes;
  $("metas").innerHTML = (metas?.itens || [])
    .map((m) => {
      const pct = m.meta > 0 ? Math.min((m.atual / m.meta) * 100, 100) : 0;
      const esperado = Math.round(m.meta * fracaoDoMes);
      const cor = m.atual >= m.meta ? "var(--bom)" : m.atual >= esperado ? "var(--ouro)" : "var(--ruim)";
      const faltam = Math.max(m.meta - m.atual, 0);
      return `
      <div class="cartao meta">
        <p class="rotulo">${esc(m.rotulo)} · meta do mês</p>
        <div>
          <p class="valor serifa num">${numero(m.atual)} <small>/ ${numero(m.meta)}</small></p>
          <div class="trilho">
            <div class="barra" style="width:${pct}%;background:${cor}"></div>
            <div class="ritmo" style="left:${Math.min(fracaoDoMes * 100, 100)}%" title="Ritmo esperado para hoje"></div>
          </div>
          <p class="rodape"><span>${faltam ? `Faltam ${numero(faltam)}` : "Meta atingida"}</span><span>Ritmo esperado até hoje: ${numero(esperado)}</span></p>
        </div>
      </div>`;
    })
    .join("");
}

function renderizarIndicadores(doMes, deHoje) {
  const v = doMes.volume, t = doMes.taxas;
  const cartao = (rotulo, valor, detalhe) => `
    <div class="cartao ind">
      <p class="rotulo">${rotulo}</p>
      <div><p class="valor serifa num">${numero(valor)}</p><p class="detalhe">${detalhe}</p></div>
    </div>`;
  $("indicadores").innerHTML = [
    cartao("Leads no mês", v.leadsRecebidos, `Hoje: <strong>${numero(deHoje?.volume.leadsRecebidos)}</strong>`),
    cartao("Qualificados", v.qualificados, `Taxa de qualificação: <strong>${percentual(t.qualificacao)}</strong>`),
    cartao("Reuniões marcadas", v.reunioesMarcadas, `Hoje: <strong>${numero(deHoje?.volume.reunioesMarcadas)}</strong>`),
    cartao("Reuniões realizadas", v.reunioesRealizadas, `Comparecimento: <strong>${percentual(t.comparecimento)}</strong>`),
    cartao("Contratos fechados", v.fechados, `Conversão final: <strong>${percentual(t.conversaoFinal)}</strong>`),
  ].join("");
}

function renderizarCampanhas(campanhas, escopos) {
  const linha = (nome, descricao, e, classe = "") => `
    <tr class="${classe}">
      <td>${esc(nome)}${descricao ? `<small>${esc(descricao)}</small>` : ""}</td>
      <td class="num">${numero(e.volume.leadsRecebidos)}</td>
      <td class="num">${numero(e.volume.qualificados)}</td>
      <td class="num">${numero(e.volume.reunioesMarcadas)}</td>
      <td class="num">${numero(e.volume.reunioesRealizadas)}</td>
      <td class="num">${numero(e.volume.fechados)}</td>
    </tr>`;
  $("porCampanha").innerHTML =
    campanhas.filter((c) => escopos[c.codigo]).map((c) => linha(c.codigo, c.nome, escopos[c.codigo])).join("") +
    linha("Total", "", escopos.TODAS, "total");
}

const CORES = { triagem: "#8d8f9b", avanco: "#b6923f", sucesso: "#4fb38a", perda: "#d0685a" };

function renderizarEtapas(etapas, volumeAtual) {
  const maximo = Math.max(...etapas.map((e) => volumeAtual[e.chave] || 0), 1);
  $("porEtapa").innerHTML = etapas
    .map((e) => {
      const qtd = volumeAtual[e.chave] || 0;
      return `
      <div class="etapa">
        <span class="nome">${esc(e.nome)}</span>
        <span class="trilho"><span class="barra" style="display:block;width:${(qtd / maximo) * 100}%;background:${CORES[e.categoria] || "#5d6070"}"></span></span>
        <span class="qtd num">${numero(qtd)}</span>
      </div>`;
    })
    .join("");
}

async function atualizar() {
  const hoje = hojeNoEscritorio();
  const inicioDoMes = `${hoje.slice(0, 8)}01`;
  try {
    // Sem as listas de leads: o modo TV usa apenas os totais.
    const [mes, dia] = await Promise.all([
      chamarApi(`/metrics?inicio=${inicioDoMes}&fim=${hoje}&resumo=1`),
      chamarApi(`/metrics?inicio=${hoje}&fim=${hoje}&resumo=1`),
    ]);
    renderizarMetas(mes.metas, hoje);
    renderizarIndicadores(mes.escopos.TODAS, dia.escopos.TODAS);
    renderizarCampanhas(mes.campanhas, mes.escopos);
    renderizarEtapas(mes.etapas, mes.escopos.TODAS.volumeAtual);
    $("mes").textContent = new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    $("atualizado").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    $("aviso").textContent = "";
  } catch (erro) {
    $("aviso").textContent =
      erro.message === "SESSAO"
        ? "Sessão expirada. Recarregue a página e entre novamente para continuar atualizando."
        : "Sem resposta do servidor. Os números exibidos são os da última atualização; nova tentativa em instantes.";
  }
}

function marcarHora() {
  $("relogio").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Tela cheia e tela sempre ligada, quando o navegador permitir.
function telaCheia() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
}
async function manterTelaLigada() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Sem suporte ou sem permissão: a televisão segue a configuração dela.
  }
}
document.addEventListener("click", (e) => !e.target.closest("a") && telaCheia());
document.addEventListener("keydown", (e) => e.key.toLowerCase() === "f" && telaCheia());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && manterTelaLigada());

marcarHora();
setInterval(marcarHora, 15000);
atualizar();
setInterval(atualizar, ATUALIZAR_A_CADA_MS);
setTimeout(() => location.reload(), RECARREGAR_A_PAGINA_A_CADA_MS);
manterTelaLigada();
