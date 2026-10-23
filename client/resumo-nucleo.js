// Resumo para o núcleo (aba de tráfego): um quadro por campanha do núcleo,
// com as campanhas do Meta nas colunas e os indicadores nas linhas, no formato
// da planilha da coordenação. Copia para planilha e gera imagem.
// Depende de app.js ($, chamarApi, esc, numero, dados) e trafego.js
// (periodoDoFiltro, abrirLeadsDoGrupo, JSON_HEADERS).

let resumoDoNucleo = null;
let chaveDoResumo = "";

const LINHAS_DO_RESUMO = [
  { campo: "leads", rotulo: "Leads" },
  { campo: "qualificados", rotulo: "Qualificados" },
  { campo: "reunioesMarcadas", rotulo: "Reuniões Marcadas" },
  { campo: "reunioesRealizadas", rotulo: "Reuniões Realizadas" },
  { campo: "contratosFechados", rotulo: "Contratos Fechados" },
];

const reaisDoResumo = (v) => (v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const reaisSemSimbolo = (v) => (v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const nomeDaColuna = (g) => g || "(não informado)";
const ROTULO_DO_NIVEL = { campanha: "Campanha do Meta", conjunto: "Conjunto de anúncios", anuncio: "Anúncio" };

function totalDoBloco(bloco, campo) {
  return bloco.campanhas.reduce((t, c) => t + (c[campo] || 0), 0);
}
function valorTotalDoBloco(bloco) {
  const comValor = bloco.campanhas.filter((c) => c.valor !== null && c.valor !== undefined);
  return comValor.length ? Math.round(comValor.reduce((t, c) => t + c.valor, 0) * 100) / 100 : null;
}

async function carregarResumoDoNucleo(forcar = false) {
  const { inicio, fim } = periodoDoFiltro();
  if (!inicio || !fim) return;
  const apenasNovos = $("apenasNovos").checked;
  const nivel = $("colunasResumo").value;
  const chave = `${inicio}|${fim}|${apenasNovos}|${nivel}|${dados?.geradoEm || ""}`;
  if (!forcar && chave === chaveDoResumo) return;
  chaveDoResumo = chave;
  $("resumoNucleo").innerHTML = '<p class="text-xs text-inkdim">Carregando.</p>';
  try {
    resumoDoNucleo = await chamarApi(`/trafego/resumo-nucleo?inicio=${inicio}&fim=${fim}&apenasNovos=${apenasNovos}&colunas=${nivel}`);
    renderizarResumoDoNucleo();
  } catch (erro) {
    chaveDoResumo = "";
    $("resumoNucleo").innerHTML = `<p class="text-xs text-negativo">Não foi possível montar o resumo. ${esc(erro.message)}</p>`;
  }
}

function renderizarResumoDoNucleo() {
  const r = resumoDoNucleo;
  if (!r) return;
  $("notaResumoNucleo").textContent = r.apenasNovos
    ? "Contando só os leads que chegaram no período, acompanhados até hoje: um lead que chegou no período e fechou depois aparece como fechado aqui. É a leitura certa para comparar com o valor investido no período."
    : "Contando tudo o que aconteceu no período, inclusive com leads que chegaram antes dele: as reuniões e os contratos podem ser de leads de outras semanas, e os números não se comparam diretamente com o valor investido no período.";
  $("notaValorResumo").textContent = r.nivel !== "campanha"
    ? `Valor: digite o valor investido em cada ${r.nivel === "anuncio" ? "anúncio" : "conjunto"}. Ele fica salvo para este período exato e para esta forma de colunas; o valor lido do Meta vale só nas colunas por campanha.`
    : r.meta.configurado && !r.meta.erro
    ? "Valor: investido em cada campanha no período, lido do Meta. Campanhas sem gasto encontrado no Meta podem receber um valor digitado."
    : `Valor: ${r.meta.erro ? `o Meta não respondeu (${r.meta.erro}); ` : ""}digite o valor investido em cada campanha. Ele fica salvo para este período exato (mesmas datas de início e fim).`;

  $("resumoNucleo").innerHTML = r.blocos
    .map((b, bi) => {
      if (!b.campanhas.length) {
        return `<div><p class="text-xs font-semibold text-ink mb-1">${esc(b.titulo)}</p><p class="text-xs text-inkdim">Sem leads no período.</p></div>`;
      }
      const celulaNumero = (valor, ci, campo) =>
        valor > 0
          ? `<button type="button" data-bloco="${bi}" data-coluna="${ci}" data-campo="${campo}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${numero(valor)}</button>`
          : numero(valor);
      const celulaValor = (c, ci) =>
        c.origemDoValor === "meta"
          ? `<span title="Valor do Meta">${reaisDoResumo(c.valor)}</span>`
          : `<input type="text" inputmode="decimal" data-valor-bloco="${bi}" data-valor-coluna="${ci}" value="${esc(reaisSemSimbolo(c.valor))}" placeholder="R$ 0,00" class="w-24 bg-surface2 border border-line px-1.5 py-0.5 text-right text-ink tabular text-xs">`;
      return `
      <div class="overflow-x-auto">
        <table class="w-full text-xs border border-line min-w-[480px]">
          <thead>
            <tr><th colspan="${b.campanhas.length + 2}" class="bg-gold/15 text-goldbright text-right font-semibold px-3 py-1.5">${esc(b.titulo)}</th></tr>
            <tr class="text-inkdim">
              <th class="px-3 py-1.5 font-normal text-[10px] uppercase tracking-wide text-inkfaint">${esc(ROTULO_DO_NIVEL[r.nivel] || "")}</th>
              ${b.campanhas.map((c) => `<th class="px-3 py-1.5 font-normal italic text-center">${esc(nomeDaColuna(c.grupo))}</th>`).join("")}
              <th class="px-3 py-1.5 font-semibold text-center text-ink bg-surface2">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-t border-line">
              <td class="px-3 py-1.5 text-center text-inkdim">Valor</td>
              ${b.campanhas.map((c, ci) => `<td class="px-3 py-1.5 text-center tabular">${celulaValor(c, ci)}</td>`).join("")}
              <td class="px-3 py-1.5 text-center tabular font-semibold text-ink bg-surface2" data-total-valor="${bi}">${reaisDoResumo(valorTotalDoBloco(b)) || "—"}</td>
            </tr>
            ${LINHAS_DO_RESUMO.map(
              (linha) => `<tr class="border-t border-line">
                <td class="px-3 py-1.5 text-center text-inkdim">${esc(linha.rotulo)}</td>
                ${b.campanhas.map((c, ci) => `<td class="px-3 py-1.5 text-center tabular text-ink">${celulaNumero(c[linha.campo], ci, linha.campo)}</td>`).join("")}
                <td class="px-3 py-1.5 text-center tabular font-semibold text-ink bg-surface2">${celulaNumero(totalDoBloco(b, linha.campo), "total", linha.campo)}</td>
              </tr>`,
            ).join("")}
          </tbody>
        </table>
      </div>`;
    })
    .join("");
}

$("resumoNucleo").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-campo]");
  if (!botao || !resumoDoNucleo) return;
  const bloco = resumoDoNucleo.blocos[Number(botao.dataset.bloco)];
  const linha = LINHAS_DO_RESUMO.find((l) => l.campo === botao.dataset.campo);
  const colunas = botao.dataset.coluna === "total" ? bloco.campanhas : [bloco.campanhas[Number(botao.dataset.coluna)]];
  const leads = colunas.flatMap((c) => c.listas[linha.campo] || []);
  const nome = botao.dataset.coluna === "total" ? "total" : nomeDaColuna(colunas[0].grupo);
  abrirLeadsDoGrupo(`${bloco.titulo} · ${nome}: ${linha.rotulo.toLowerCase()}`, leads);
});

// Valor digitado: grava ao sair do campo ou com Enter.
$("resumoNucleo").addEventListener("change", async (e) => {
  const campo = e.target.closest("input[data-valor-bloco]");
  if (!campo || !resumoDoNucleo) return;
  const bloco = resumoDoNucleo.blocos[Number(campo.dataset.valorBloco)];
  const coluna = bloco.campanhas[Number(campo.dataset.valorColuna)];
  const texto = campo.value.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const valor = texto === "" ? null : Number(texto);
  const status = $("statusResumo");
  if (valor !== null && (!Number.isFinite(valor) || valor < 0)) {
    status.className = "text-[11px] text-negativo";
    status.textContent = "Valor inválido. Use o formato 149,34.";
    return;
  }
  try {
    const r = await chamarApi("/trafego/resumo-nucleo/valor", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ inicio: resumoDoNucleo.inicio, fim: resumoDoNucleo.fim, campanha: bloco.codigo, nivel: resumoDoNucleo.nivel, grupo: coluna.grupo, valor }),
    });
    coluna.valor = r.valor;
    coluna.origemDoValor = r.valor === null ? null : "digitado";
    campo.value = reaisSemSimbolo(r.valor);
    document.querySelector(`[data-total-valor="${campo.dataset.valorBloco}"]`).textContent = reaisDoResumo(valorTotalDoBloco(bloco)) || "—";
    status.className = "text-[11px] text-inkdim";
    status.textContent = "Valor salvo.";
  } catch (erro) {
    status.className = "text-[11px] text-negativo";
    status.textContent = erro.message;
  }
});
$("resumoNucleo").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input[data-valor-bloco]")) e.target.blur();
});

// --- Copiar para planilha ----------------------------------------------------------------

function tabelasDoResumo() {
  // Uma matriz por bloco: título, cabeçalho e linhas, já com os totais.
  return resumoDoNucleo.blocos
    .filter((b) => b.campanhas.length)
    .map((b) => ({
      titulo: b.titulo,
      cabecalho: [ROTULO_DO_NIVEL[resumoDoNucleo.nivel] || "", ...b.campanhas.map((c) => nomeDaColuna(c.grupo)), "TOTAL"],
      linhas: [
        ["Valor", ...b.campanhas.map((c) => c.valor), valorTotalDoBloco(b)],
        ...LINHAS_DO_RESUMO.map((l) => [l.rotulo, ...b.campanhas.map((c) => c[l.campo] || 0), totalDoBloco(b, l.campo)]),
      ],
    }));
}

$("btnCopiarResumo").addEventListener("click", async () => {
  if (!resumoDoNucleo) return;
  const tabelas = tabelasDoResumo();
  const texto = tabelas
    .map((t) => [t.titulo, t.cabecalho.join("\t"), ...t.linhas.map((l, i) => l.map((v, j) => (j && i === 0 ? reaisDoResumo(v) : v ?? "")).join("\t"))].join("\n"))
    .join("\n\n");
  const html = tabelas
    .map(
      (t) => `<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">
        <tr><th colspan="${t.cabecalho.length}" style="background:#1f5597;color:#fff;text-align:right">${esc(t.titulo)}</th></tr>
        <tr>${t.cabecalho.map((h, j) => `<th style="background:${j === t.cabecalho.length - 1 ? "#a9c4eb" : "#d9d9d9"};font-style:${j && j < t.cabecalho.length - 1 ? "italic" : "normal"};font-weight:${j === t.cabecalho.length - 1 ? "bold" : "normal"}">${esc(h)}</th>`).join("")}</tr>
        ${t.linhas
          .map(
            (l, i) =>
              `<tr>${l
                .map((v, j) => `<td style="text-align:center;${j === l.length - 1 ? "background:#a9c4eb;font-weight:bold" : i % 2 ? "background:#d9d9d9" : ""}">${esc(j && i === 0 ? reaisDoResumo(v) : String(v ?? ""))}</td>`)
                .join("")}</tr>`,
          )
          .join("")}
      </table>`,
    )
    .join("<br>");
  const status = $("statusResumo");
  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([texto], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    } else {
      await navigator.clipboard.writeText(texto);
    }
    status.className = "text-[11px] text-inkdim";
    status.textContent = "Copiado. Cole na planilha (Ctrl+V) na célula onde o primeiro quadro deve começar.";
  } catch {
    status.className = "text-[11px] text-negativo";
    status.textContent = "O navegador não deixou copiar. Tente de novo clicando no botão.";
  }
});

// --- Imagem (PNG) no estilo da planilha ------------------------------------------------------

$("btnImagemResumo").addEventListener("click", () => {
  if (!resumoDoNucleo) return;
  const tabelas = tabelasDoResumo();
  if (!tabelas.length) return;
  const escala = 2;
  const larguraRotulo = 190;
  const larguraColuna = 160;
  const alturaLinha = 26;
  const espaco = 28;
  const largura = Math.max(...tabelas.map((t) => larguraRotulo + (t.cabecalho.length - 1) * larguraColuna)) + 40;
  const alturaDoBloco = (t) => alturaLinha * (2 + t.linhas.length);
  const altura = 50 + tabelas.reduce((h, t) => h + alturaDoBloco(t) + espaco, 0);
  const canvas = document.createElement("canvas");
  canvas.width = largura * escala;
  canvas.height = altura * escala;
  const ctx = canvas.getContext("2d");
  ctx.scale(escala, escala);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largura, altura);
  ctx.fillStyle = "#333333";
  ctx.font = "12px Arial, sans-serif";
  const r = resumoDoNucleo;
  ctx.fillText(
    `Período: ${r.inicio.split("-").reverse().join("/")} a ${r.fim.split("-").reverse().join("/")} · ${r.apenasNovos ? "leads que chegaram no período, acompanhados até hoje" : "tudo o que aconteceu no período"}`,
    20,
    28,
  );
  let y = 50;
  for (const t of tabelas) {
    const n = t.cabecalho.length;
    const larguraTabela = larguraRotulo + (n - 1) * larguraColuna;
    const x0 = 20;
    const xDaColuna = (j) => (j === 0 ? x0 : x0 + larguraRotulo + (j - 1) * larguraColuna);
    const larguraDaColuna = (j) => (j === 0 ? larguraRotulo : larguraColuna);
    // Título
    ctx.fillStyle = "#1f5597";
    ctx.fillRect(x0, y, larguraTabela, alturaLinha);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(t.titulo, x0 + larguraTabela - 10, y + 18);
    y += alturaLinha;
    // Cabeçalho
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = j === n - 1 ? "#a9c4eb" : "#d9d9d9";
      ctx.fillRect(xDaColuna(j), y, larguraDaColuna(j), alturaLinha);
      ctx.fillStyle = "#222222";
      ctx.font = j === n - 1 ? "bold 13px Arial, sans-serif" : "italic 13px Arial, sans-serif";
      ctx.textAlign = "center";
      const texto = t.cabecalho[j];
      ctx.fillText(texto.length > 22 ? `${texto.slice(0, 21)}…` : texto, xDaColuna(j) + larguraDaColuna(j) / 2, y + 17);
    }
    y += alturaLinha;
    // Linhas
    t.linhas.forEach((linha, i) => {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = j === n - 1 ? "#a9c4eb" : i % 2 ? "#d9d9d9" : "#ffffff";
        ctx.fillRect(xDaColuna(j), y, larguraDaColuna(j), alturaLinha);
        ctx.fillStyle = "#222222";
        ctx.font = j === n - 1 ? "bold 13px Arial, sans-serif" : "13px Arial, sans-serif";
        ctx.textAlign = "center";
        const v = linha[j];
        ctx.fillText(j && i === 0 ? reaisDoResumo(v) || "—" : String(v ?? ""), xDaColuna(j) + larguraDaColuna(j) / 2, y + 17);
      }
      y += alturaLinha;
    });
    ctx.strokeStyle = "#ffffff";
    y += espaco;
  }
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `resumo-nucleo_${r.inicio}_a_${r.fim}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
});

$("colunasResumo").addEventListener("change", () => carregarResumoDoNucleo());
