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

// Saídas do funil: para cada passo, quem chegou a uma linha e não à seguinte,
// pela situação de hoje. Assim a conta de cada coluna fecha de uma linha para
// a outra.
const SAIDAS_DO_RESUMO = ["Não qualificados", "Sem reunião marcada", "Reunião não realizada", "Sem contrato fechado"];
const SITUACOES_DO_RESUMO = [
  ["emAndamento", "ainda em andamento"],
  ["emAgendamento", "em agendamento"],
  ["agendado", "agendado"],
  ["remarcacao", "em remarcação"],
  ["reaquecimento", "em reaquecimento"],
  ["farmer", "em protocolo farmer"],
  ["reuniaoRealizada", "em reunião realizada"],
  ["fechado", "fechado depois do período"],
  ["semInteresse", "sem interesse"],
  ["desqualificado", "desqualificado"],
];
// Detalhamento recolhível por linha: clicar numa linha principal mostra ou
// esconde as saídas logo abaixo dela; o botão do topo faz isso em todas.
const passosRecolhidos = new Set();
const passoAberto = (k) => !passosRecolhidos.has(k);
function atualizarBotaoDoDetalhamento() {
  const botao = $("btnDetalhamentoResumo");
  if (!botao) return;
  const algumAberto = SAIDAS_DO_RESUMO.some((_, k) => passoAberto(k));
  botao.textContent = algumAberto ? "Recolher detalhamento" : "Mostrar detalhamento";
  botao.setAttribute("aria-pressed", String(algumAberto));
}

// Leads de uma célula do quadro (linha principal ou de saída).
function leadsDaCelula(c, linha) {
  if (linha.campo) return c.listas[linha.campo] || [];
  const saida = c.saidas?.[linha.passo];
  if (!saida) return [];
  if (linha.situacao === "fora") return saida.foraDaSequencia || [];
  if (linha.situacao) return saida.porSituacao[linha.situacao] || [];
  return Object.values(saida.porSituacao).flat();
}

// Etapas posteriores à reunião. Um lead que está nelas sem ter chegado a
// Qualificados ou a Reuniões Marcadas pulou uma etapa no Kommo: a linha
// aparece em destaque para conferência.
const SITUACOES_DEPOIS_DA_REUNIAO = new Set(["farmer", "reuniaoRealizada", "fechado"]);
const ETAPA_PULADA = ["Lead Qualificado", "Agendado"];
const SITUACOES_DE_AGENDAMENTO = new Set(["emAgendamento", "agendado"]);

// Linhas do quadro, na ordem da tabela: as cinco do funil e, entre elas, as
// saídas (só as situações que aparecem no quadro).
function linhasDoQuadro(b, aberto = passoAberto) {
  const total = (linha) => b.campanhas.reduce((t, c) => t + leadsDaCelula(c, linha).length, 0);
  const linhas = [];
  LINHAS_DO_RESUMO.forEach((principal, k) => {
    linhas.push({ ...principal, tipo: "principal", indice: k });
    if (k >= SAIDAS_DO_RESUMO.length || !aberto(k)) return;
    const cabeca = { tipo: "saida", passo: k, rotulo: SAIDAS_DO_RESUMO[k] };
    const fora = {
      tipo: "situacao",
      passo: k,
      situacao: "fora",
      alerta: true,
      rotulo: `chegaram a ${LINHAS_DO_RESUMO[k + 1].rotulo.toLowerCase()} sem passar por esta linha`,
      explicacao: `Leads contados em "${LINHAS_DO_RESUMO[k + 1].rotulo}" sem registro de "${LINHAS_DO_RESUMO[k].rotulo}" no Kommo. Vale conferir a movimentação.`,
    };
    if (total(cabeca)) {
      linhas.push(cabeca);
      for (const [situacao, rotulo] of SITUACOES_DO_RESUMO) {
        // Também em destaque: quem não passou por Qualificados e está hoje em
        // agendamento ou agendado.
        const pulou = (k < ETAPA_PULADA.length && SITUACOES_DEPOIS_DA_REUNIAO.has(situacao)) || (k === 0 && SITUACOES_DE_AGENDAMENTO.has(situacao));
        const linha = pulou
          ? {
              tipo: "situacao",
              passo: k,
              situacao,
              alerta: true,
              rotulo: `${rotulo}, sem passar por ${ETAPA_PULADA[k]}`,
              explicacao: `Leads que estão hoje ${SITUACOES_DE_AGENDAMENTO.has(situacao) ? "em agendamento ou agendados" : "numa etapa posterior à reunião"} sem terem passado por ${ETAPA_PULADA[k]} no Kommo. Provavelmente pularam uma etapa; vale conferir e corrigir no Kommo para que contem como ${k ? "reunião marcada" : "qualificados"}.`,
            }
          : { tipo: "situacao", passo: k, situacao, rotulo };
        if (total(linha)) linhas.push(linha);
      }
    }
    if (total(fora)) linhas.push(fora);
  });
  return linhas;
}

// Anexo do quadro: total de sem interesse, desqualificados e em andamento entre todos os
// leads da coluna, pela situação de hoje, sem precisar somar o detalhamento.
const ANEXO_DO_RESUMO = [
  ["semInteresse", "Sem interesse"],
  ["desqualificado", "Desqualificado"],
  ["emAndamento", "Em andamento"],
  ["emAgendamento", "Em agendamento"],
];
const TITULO_DO_ANEXO = "Total no quadro, pela situação de hoje";
const leadsDoAnexo = (c, situacao) => (c.listas.leads || []).filter((l) => l.situacaoDeHoje === situacao);

// Conversão de uma linha principal sobre a anterior, na mesma coluna.
function conversaoDaLinha(anterior, atual) {
  if (!anterior) return null;
  return `${(Math.round((atual / anterior) * 1000) / 10).toLocaleString("pt-BR")}%`;
}
const contagemDaCelula = (c, linha) => (linha.campo ? c[linha.campo] || 0 : leadsDaCelula(c, linha).length);
const totalDaLinha = (b, linha) => b.campanhas.reduce((t, c) => t + contagemDaCelula(c, linha), 0);

const reaisDoResumo = (v) => (v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const reaisSemSimbolo = (v) => (v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const nomeDaColuna = (c) => (c.partes ? c.partes.join(" · ") : c.grupo || "(não informado)");
const ROTULO_DO_NIVEL = { campanha: "Campanha do Meta", conjunto: "Conjunto de anúncios", anuncio: "Anúncio", nucleo: "Campanha do núcleo" };

// Linhas do cabeçalho de um quadro (cada uma com rótulo, colunas e TOTAL).
// No modo "todos", três linhas: campanha, conjunto e anúncio.
function cabecalhoDoBloco(b, nivel) {
  if (nivel === "todos") {
    return ["Campanha do Meta", "Conjunto de anúncios", "Anúncio"].map((rotulo, k) => [rotulo, ...b.campanhas.map((c) => c.partes?.[k] || "(não informado)"), k === 0 ? "TOTAL" : ""]);
  }
  return [[ROTULO_DO_NIVEL[nivel] || "", ...b.campanhas.map((c) => nomeDaColuna(c)), "TOTAL"]];
}

// Junta células vizinhas iguais de uma linha do cabeçalho (só entre as
// colunas de dados, e só quando as linhas de cima também são iguais).
function mesclarCabecalho(linhas, k) {
  const n = linhas[k].length;
  const chave = (j) => linhas.slice(0, k + 1).map((l) => l[j]).join("\u241f");
  const segmentos = [{ texto: linhas[k][0], inicio: 0, span: 1 }];
  for (let j = 1; j < n - 1; j++) {
    const ultimo = segmentos.at(-1);
    if (ultimo.inicio > 0 && chave(ultimo.inicio) === chave(j)) ultimo.span++;
    else segmentos.push({ texto: linhas[k][j], inicio: j, span: 1 });
  }
  segmentos.push({ texto: linhas[k][n - 1], inicio: n - 1, span: 1, total: true });
  return segmentos;
}

function totalDoBloco(bloco, campo) {
  return bloco.campanhas.reduce((t, c) => t + (c[campo] || 0), 0);
}
function valorTotalDoBloco(bloco) {
  const comValor = bloco.campanhas.filter((c) => c.valor !== null && c.valor !== undefined);
  return comValor.length ? Math.round(comValor.reduce((t, c) => t + c.valor, 0) * 100) / 100 : null;
}

// Com as campanhas do núcleo nas colunas, o quadro é um só (um quadro por
// campanha teria uma coluna única): "Quadros" passa a "Tudo unificado" e fica
// travado; ao sair dessa opção, volta ao que estava escolhido.
let quadrosAntesDoNucleo = null;
function sincronizarQuadrosComAsColunas() {
  const quadros = $("quadrosResumo");
  if ($("colunasResumo").value === "nucleo") {
    if (quadrosAntesDoNucleo === null) quadrosAntesDoNucleo = quadros.value;
    quadros.value = "todas";
    quadros.disabled = true;
    quadros.title = "Com as campanhas do núcleo nas colunas, o quadro é um só.";
  } else if (quadrosAntesDoNucleo !== null) {
    quadros.value = quadrosAntesDoNucleo;
    quadrosAntesDoNucleo = null;
    quadros.disabled = false;
    quadros.title = "";
  }
}

async function carregarResumoDoNucleo(forcar = false) {
  const { inicio, fim } = periodoDoFiltro();
  if (!inicio || !fim) return;
  sincronizarQuadrosComAsColunas();
  const apenasNovos = $("apenasNovos").checked;
  const nivel = $("colunasResumo").value;
  const juntar = $("quadrosResumo").value;
  const chave = `${inicio}|${fim}|${apenasNovos}|${nivel}|${juntar}|${dados?.geradoEm || ""}`;
  if (!forcar && chave === chaveDoResumo) return;
  chaveDoResumo = chave;
  $("resumoNucleo").innerHTML = '<p class="text-xs text-inkdim">Carregando.</p>';
  try {
    resumoDoNucleo = await chamarApi(`/trafego/resumo-nucleo?inicio=${inicio}&fim=${fim}&apenasNovos=${apenasNovos}&colunas=${nivel}&juntar=${juntar}`);
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
  $("notaValorResumo").textContent = r.nivel === "nucleo"
    ? "Valor: não aparece com as campanhas do núcleo nas colunas. O valor investido é lançado por campanha do Meta, conjunto ou anúncio; escolha uma dessas colunas para digitá-lo."
    : r.nivel !== "campanha"
    ? `Valor: digite o valor investido em cada ${{ anuncio: "anúncio", conjunto: "conjunto", todos: "coluna (campanha, conjunto e anúncio)" }[r.nivel]}. Ele fica salvo para este período exato e para esta forma de colunas; o valor lido do Meta vale só nas colunas por campanha.`
    : r.meta.configurado && !r.meta.erro
    ? "Valor: investido em cada campanha no período, lido do Meta. Campanhas sem gasto encontrado no Meta podem receber um valor digitado."
    : `Valor: ${r.meta.erro ? `o Meta não respondeu (${r.meta.erro}); ` : ""}digite o valor investido em cada campanha. Ele fica salvo para este período exato (mesmas datas de início e fim).`;

  $("resumoNucleo").innerHTML = r.blocos
    .map((b, bi) => {
      if (!b.campanhas.length) {
        return `<div><p class="text-xs font-semibold text-ink mb-1">${esc(b.titulo)}</p><p class="text-xs text-inkdim">Sem leads no período.</p></div>`;
      }
      const linhasDoBloco = linhasDoQuadro(b);
      const celulaNumero = (valor, ci, li) =>
        valor > 0
          ? `<button type="button" data-bloco="${bi}" data-coluna="${ci}" data-linha="${li}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${numero(valor)}</button>`
          : valor === 0 && linhasDoBloco[li].tipo !== "principal"
            ? '<span class="text-inkfaint">—</span>'
            : numero(valor);
      const estiloDaLinha = (linha) =>
        linha.tipo === "principal"
          ? { tr: "border-t border-line bg-surface2/70", rotulo: "px-3 py-2 text-left text-[13px] font-semibold text-ink", celula: "px-3 py-2 text-center tabular text-[13px] font-semibold text-ink" }
          : linha.tipo === "saida"
            ? { tr: "border-t border-line", rotulo: "pl-6 pr-3 py-1 text-left text-[11px] italic text-inkdim", celula: "px-3 py-1 text-center tabular text-[11px] text-inkdim" }
            : linha.alerta
              ? { tr: "", rotulo: "pl-10 pr-3 py-0.5 text-left text-[11px] text-goldbright", celula: "px-3 py-0.5 text-center tabular text-[11px] text-goldbright" }
              : { tr: "", rotulo: "pl-10 pr-3 py-0.5 text-left text-[11px] text-inkfaint", celula: "px-3 py-0.5 text-center tabular text-[11px] text-inkdim" };
      // Conversão sobre a linha principal anterior, embaixo do número.
      const conversao = (linha, anterior, atual) => {
        if (linha.tipo !== "principal" || !linha.indice) return "";
        const pct = conversaoDaLinha(anterior, atual);
        return pct
          ? `<span class="block text-[10px] font-normal text-inkfaint" title="${esc(`${linha.rotulo} sobre ${LINHAS_DO_RESUMO[linha.indice - 1].rotulo}`)}">${pct}</span>`
          : "";
      };
      const anteriorDe = (linha, c) => (c ? c[LINHAS_DO_RESUMO[linha.indice - 1].campo] || 0 : totalDoBloco(b, LINHAS_DO_RESUMO[linha.indice - 1].campo));
      const celulaValor = (c, ci) =>
        r.nivel === "nucleo"
          ? '<span class="text-inkfaint">—</span>'
          : c.origemDoValor === "meta"
          ? `<span title="Valor do Meta">${reaisDoResumo(c.valor)}</span>`
          : `<input type="text" inputmode="decimal" data-valor-bloco="${bi}" data-valor-coluna="${ci}" value="${esc(reaisSemSimbolo(c.valor))}" placeholder="R$ 0,00" class="w-24 bg-surface2 border border-line px-1.5 py-0.5 text-right text-ink tabular text-xs">`;
      return `
      <div class="overflow-x-auto">
        <table class="w-full text-xs border border-line min-w-[480px]">
          <thead>
            <tr><th colspan="${b.campanhas.length + 2}" class="bg-gold/15 text-goldbright text-right font-semibold px-3 py-1.5">${esc(b.titulo)}</th></tr>
            ${(() => {
              const linhas = cabecalhoDoBloco(b, r.nivel);
              return linhas
                .map(
                  (_, k) => `<tr class="text-inkdim">${mesclarCabecalho(linhas, k)
                    .map((seg) =>
                      seg.inicio === 0
                        ? `<th class="px-3 py-1.5 font-normal text-[10px] uppercase tracking-wide text-inkfaint text-left">${esc(seg.texto)}</th>`
                        : seg.total
                          ? k === 0
                            ? `<th rowspan="${linhas.length}" class="px-3 py-1.5 font-semibold text-center text-ink bg-surface2">TOTAL</th>`
                            : ""
                          : `<th colspan="${seg.span}" class="px-3 py-1.5 font-normal italic text-center ${linhas.length > 1 && k < linhas.length - 1 ? "border-b border-line" : ""}">${esc(seg.texto)}</th>`,
                    )
                    .join("")}</tr>`,
                )
                .join("");
            })()}
          </thead>
          <tbody>
            <tr class="border-t border-line">
              <td class="px-3 py-1.5 text-left text-inkdim">Valor</td>
              ${b.campanhas.map((c, ci) => `<td class="px-3 py-1.5 text-center tabular">${celulaValor(c, ci)}</td>`).join("")}
              <td class="px-3 py-1.5 text-center tabular font-semibold text-ink bg-surface2" data-total-valor="${bi}">${reaisDoResumo(valorTotalDoBloco(b)) || "—"}</td>
            </tr>
            ${linhasDoBloco
              .map((linha, li) => {
                const e = estiloDaLinha(linha);
                const dica = linha.explicacao ? ` title="${esc(linha.explicacao)}"` : "";
                const recolhivel = linha.tipo === "principal" && linha.indice < SAIDAS_DO_RESUMO.length;
                const rotulo = recolhivel
                  ? `<button type="button" data-passo="${linha.indice}" aria-expanded="${passoAberto(linha.indice)}" title="${passoAberto(linha.indice) ? "Esconder" : "Mostrar"} quem não avançou desta linha" class="flex items-center gap-2 text-left hover:text-goldbright"><span class="seta-do-passo inline-block text-[10px] text-inkfaint ${passoAberto(linha.indice) ? "aberta" : ""}">▸</span>${esc(linha.rotulo)}</button>`
                  : linha.tipo === "principal"
                    ? `<span class="pl-[18px]">${esc(linha.rotulo)}</span>`
                    : esc(linha.rotulo);
                return `<tr class="${e.tr}"${dica}>
                <td class="${e.rotulo}">${rotulo}</td>
                ${b.campanhas
                  .map((c, ci) => {
                    const v = contagemDaCelula(c, linha);
                    return `<td class="${e.celula}">${celulaNumero(v, ci, li)}${linha.tipo === "principal" && linha.indice ? conversao(linha, anteriorDe(linha, c), v) : ""}</td>`;
                  })
                  .join("")}
                <td class="${e.celula} font-semibold bg-surface2">${celulaNumero(totalDaLinha(b, linha), "total", li)}${linha.tipo === "principal" && linha.indice ? conversao(linha, anteriorDe(linha, null), totalDaLinha(b, linha)) : ""}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
          <tbody>
            <tr class="border-t-2 border-gold/40">
              <td colspan="${b.campanhas.length + 2}" class="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wide text-inkfaint">${TITULO_DO_ANEXO}</td>
            </tr>
            ${ANEXO_DO_RESUMO.map(([situacao, rotulo]) => {
              const botao = (lista, coluna) =>
                lista.length
                  ? `<button type="button" data-anexo="${situacao}" data-bloco="${bi}" data-coluna="${coluna}" class="underline decoration-dotted underline-offset-2 hover:text-goldbright">${numero(lista.length)}</button>`
                  : '<span class="text-inkfaint">0</span>';
              return `<tr>
                <td class="px-3 py-1.5 text-left text-[12px] font-semibold text-ink"><span class="pl-[18px]">${rotulo}</span></td>
                ${b.campanhas.map((c, ci) => `<td class="px-3 py-1.5 text-center tabular text-[12px] font-semibold text-ink">${botao(leadsDoAnexo(c, situacao), ci)}</td>`).join("")}
                <td class="px-3 py-1.5 text-center tabular text-[12px] font-semibold text-ink bg-surface2">${botao(b.campanhas.flatMap((c) => leadsDoAnexo(c, situacao)), "total")}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
    })
    .join("");
}

$("resumoNucleo").addEventListener("click", (e) => {
  const anexo = e.target.closest("button[data-anexo]");
  if (anexo && resumoDoNucleo) {
    const bloco = resumoDoNucleo.blocos[Number(anexo.dataset.bloco)];
    const colunas = anexo.dataset.coluna === "total" ? bloco.campanhas : [bloco.campanhas[Number(anexo.dataset.coluna)]];
    const nome = anexo.dataset.coluna === "total" ? "total" : nomeDaColuna(colunas[0]);
    const rotulo = ANEXO_DO_RESUMO.find(([s]) => s === anexo.dataset.anexo)[1];
    const leads = colunas.flatMap((c) => leadsDoAnexo(c, anexo.dataset.anexo)).map((l) => ({ ...l, etapaMaisAvancada: [l.etapaAtual, l.motivoPerda].filter(Boolean).join(" · ") }));
    abrirLeadsDoGrupo(`${bloco.titulo} · ${nome}: ${rotulo.toLowerCase()}`, leads, "Todos os leads da coluna que estão hoje nesta situação, em qualquer ponto do funil em que tenham parado.", {
      nome: "situacao-hoje.csv",
      cabecalho: ["ID", "Nome", "Telefone", "Etapa hoje", "Motivo de perda"],
      linhas: leads.map((l) => [l.leadId || "", l.nome, l.telefone || "", l.etapaAtual || "", l.motivoPerda || ""]),
    });
    return;
  }
  const passo = e.target.closest("button[data-passo]");
  if (passo) {
    const k = Number(passo.dataset.passo);
    if (passoAberto(k)) passosRecolhidos.add(k);
    else passosRecolhidos.delete(k);
    atualizarBotaoDoDetalhamento();
    renderizarResumoDoNucleo();
    return;
  }
  const botao = e.target.closest("button[data-linha]");
  if (!botao || !resumoDoNucleo) return;
  const bloco = resumoDoNucleo.blocos[Number(botao.dataset.bloco)];
  const linha = linhasDoQuadro(bloco)[Number(botao.dataset.linha)];
  const colunas = botao.dataset.coluna === "total" ? bloco.campanhas : [bloco.campanhas[Number(botao.dataset.coluna)]];
  const nome = botao.dataset.coluna === "total" ? "total" : nomeDaColuna(colunas[0]);
  if (linha.tipo === "principal") {
    abrirLeadsDoGrupo(`${bloco.titulo} · ${nome}: ${linha.rotulo.toLowerCase()}`, colunas.flatMap((c) => c.listas[linha.campo] || []));
    return;
  }
  // Nas saídas, a lista mostra a etapa de hoje e o motivo de perda.
  const leads = colunas.flatMap((c) => leadsDaCelula(c, linha)).map((l) => ({ ...l, etapaMaisAvancada: [l.etapaAtual, l.motivoPerda].filter(Boolean).join(" · ") }));
  const titulo = linha.tipo === "saida" ? linha.rotulo : `${SAIDAS_DO_RESUMO[linha.passo]}, ${linha.rotulo}`;
  abrirLeadsDoGrupo(
    `${bloco.titulo} · ${nome}: ${titulo.toLowerCase()}`,
    leads,
    linha.explicacao || `Leads que chegaram a "${LINHAS_DO_RESUMO[linha.passo].rotulo}" e não a "${LINHAS_DO_RESUMO[linha.passo + 1].rotulo}", com a etapa em que estão hoje.`,
    { nome: "saidas.csv", cabecalho: ["ID", "Nome", "Telefone", "Etapa hoje", "Motivo de perda"], linhas: leads.map((l) => [l.leadId || "", l.nome, l.telefone || "", l.etapaAtual || "", l.motivoPerda || ""]) },
  );
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

// Linhas exportadas: as da tela e, depois de cada linha principal a partir de
// Qualificados, a conversão sobre a anterior.
function linhasDaExportacao(b) {
  const saida = [];
  for (const l of linhasDoQuadro(b)) {
    saida.push({
      tipo: l.tipo === "situacao" && l.alerta ? "alerta" : l.tipo,
      valores: [
        l.tipo === "principal" ? l.rotulo : l.tipo === "saida" ? `   ${l.rotulo}` : `      ${l.rotulo}`,
        ...b.campanhas.map((c) => contagemDaCelula(c, l)),
        totalDaLinha(b, l),
      ],
    });
    if (l.tipo === "principal" && l.indice) {
      const anterior = LINHAS_DO_RESUMO[l.indice - 1];
      saida.push({
        tipo: "conversao",
        valores: [
          `   % sobre ${anterior.rotulo}`,
          ...b.campanhas.map((c) => conversaoDaLinha(c[anterior.campo] || 0, c[l.campo] || 0) || "—"),
          conversaoDaLinha(totalDoBloco(b, anterior.campo), totalDoBloco(b, l.campo)) || "—",
        ],
      });
    }
  }
  saida.push({ tipo: "anexoTitulo", valores: [TITULO_DO_ANEXO, ...b.campanhas.map(() => ""), ""] });
  for (const [situacao, rotulo] of ANEXO_DO_RESUMO) {
    saida.push({
      tipo: "anexo",
      valores: [rotulo, ...b.campanhas.map((c) => leadsDoAnexo(c, situacao).length), b.campanhas.reduce((t, c) => t + leadsDoAnexo(c, situacao).length, 0)],
    });
  }
  return saida;
}

function tabelasDoResumo() {
  // Uma matriz por bloco: título, cabeçalho e linhas, já com os totais.
  return resumoDoNucleo.blocos
    .filter((b) => b.campanhas.length)
    .map((b) => ({
      titulo: b.titulo,
      cabecalhos: cabecalhoDoBloco(b, resumoDoNucleo.nivel),
      linhas: [
        ["Valor", ...b.campanhas.map((c) => c.valor), valorTotalDoBloco(b)],
        ...linhasDaExportacao(b).map((l) => l.valores),
      ],
      tipos: ["valor", ...linhasDaExportacao(b).map((l) => l.tipo)],
    }));
}

// Tabelas do resumo em HTML, no estilo da planilha da coordenação.
function htmlDasTabelas(tabelas) {
  return tabelas
    .map(
      (t) => `<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">
        <tr><th colspan="${t.cabecalhos[0].length}" style="background:#1f5597;color:#fff;text-align:right">${esc(t.titulo)}</th></tr>
        ${t.cabecalhos
          .map(
            (_, k) =>
              `<tr>${mesclarCabecalho(t.cabecalhos, k)
                .map((seg) =>
                  seg.total
                    ? k === 0
                      ? `<th rowspan="${t.cabecalhos.length}" style="background:#a9c4eb;font-weight:bold">TOTAL</th>`
                      : ""
                    : `<th colspan="${seg.span}" style="background:#d9d9d9;font-style:${seg.inicio ? "italic" : "normal"};font-weight:normal">${esc(seg.texto)}</th>`,
                )
                .join("")}</tr>`,
          )
          .join("")}
        ${t.linhas
          .map(
            (l, i) =>
              t.tipos?.[i] === "anexoTitulo"
                ? `<tr><td colspan="${l.length}" style="text-align:left;background:#ffffff;border-top:2px solid #1f5597;color:#555;font-size:9pt;text-transform:uppercase;letter-spacing:0.5px;padding-top:8px">${esc(l[0])}</td></tr>`
                : `<tr>${l
                .map((v, j) => {
                  const sub = ["saida", "situacao", "alerta", "conversao"].includes(t.tipos?.[i]);
                  const fundo = j === l.length - 1 ? "background:#a9c4eb;font-weight:bold" : sub ? "background:#f3f3f3" : "background:#d9d9d9";
                  const rotulo = j === 0 && sub ? `text-align:left;white-space:pre;color:#555;font-size:10pt;${t.tipos[i] === "saida" ? "font-style:italic" : ""}` : "text-align:center";
                  const corDoAlerta = t.tipos?.[i] === "alerta" ? ";color:#8a5a00" : "";
                  const principal = t.tipos?.[i] === "principal" ? ";font-weight:bold" : "";
                  if (t.tipos?.[i] === "anexo") {
                    return `<td style="text-align:center;font-weight:bold;background:${j === l.length - 1 ? "#a9c4eb" : "#fff2cc"}">${esc(String(v ?? ""))}</td>`;
                  }
                  return `<td style="${rotulo};${fundo}${sub && j ? ";color:#555;font-size:10pt" : ""}${corDoAlerta}${principal}">${esc(j && i === 0 ? reaisDoResumo(v) : String(v ?? ""))}</td>`;
                })
                .join("")}</tr>`,
          )
          .join("")}
      </table>`,
    )
    .join("<br>");
}

function descricaoDoPeriodo() {
  const r = resumoDoNucleo;
  const br = (iso) => iso.split("-").reverse().join("/");
  return `Período: ${br(r.inicio)} a ${br(r.fim)} · ${r.apenasNovos ? "leads que chegaram no período, acompanhados até hoje" : "tudo o que aconteceu no período"}`;
}
const nomeDoArquivoDoResumo = (extensao) =>
  `resumo-nucleo_${resumoDoNucleo.inicio}_a_${resumoDoNucleo.fim}_${resumoDoNucleo.nivel}${{ ir: "_ir-unificado", todas: "_unificado" }[resumoDoNucleo.juntar] || ""}.${extensao}`;

// CSV com ponto e vírgula, que o Excel em português abre direto nas colunas.
$("btnCsvResumo").addEventListener("click", () => {
  if (!resumoDoNucleo) return;
  const celula = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [[descricaoDoPeriodo()], []];
  for (const t of tabelasDoResumo()) {
    linhas.push([t.titulo], ...t.cabecalhos);
    t.linhas.forEach((l, i) => linhas.push(l.map((v, j) => (j && i === 0 ? reaisSemSimbolo(v) : v))));
    linhas.push([]);
  }
  baixarArquivo(nomeDoArquivoDoResumo("csv"), "\ufeff" + linhas.map((l) => l.map(celula).join(";")).join("\r\n"), "text/csv;charset=utf-8");
});

// HTML autocontido, para abrir no navegador, imprimir ou anexar.
$("btnHtmlResumo").addEventListener("click", () => {
  if (!resumoDoNucleo) return;
  const documento = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Resumo para o núcleo</title>
<style>body{font-family:Calibri,Arial,sans-serif;margin:24px;color:#222}h1{font-size:18px;margin:0 0 4px}p{font-size:12px;color:#555;margin:0 0 16px}table{margin-bottom:24px}td,th{padding:4px 10px;border:1px solid #fff}@media print{body{margin:0}}</style></head>
<body><h1>Resumo para o núcleo</h1><p>${esc(descricaoDoPeriodo())}</p>${htmlDasTabelas(tabelasDoResumo())}</body></html>`;
  baixarArquivo(nomeDoArquivoDoResumo("html"), documento, "text/html;charset=utf-8");
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
  const largura = Math.max(...tabelas.map((t) => larguraRotulo + (t.cabecalhos[0].length - 1) * larguraColuna)) + 40;
  const alturaDoBloco = (t) => alturaLinha * (1 + t.cabecalhos.length + t.linhas.length);
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
    const n = t.cabecalhos[0].length;
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
    // Cabeçalho (uma ou três linhas, com células iguais mescladas)
    const alturaDoCabecalho = alturaLinha * t.cabecalhos.length;
    t.cabecalhos.forEach((_, k) => {
      for (const seg of mesclarCabecalho(t.cabecalhos, k)) {
        if (seg.total && k > 0) continue;
        const x = xDaColuna(seg.inicio);
        const w = seg.total || seg.inicio === 0 ? larguraDaColuna(seg.inicio) : larguraColuna * seg.span;
        const h = seg.total ? alturaDoCabecalho : alturaLinha;
        ctx.fillStyle = seg.total ? "#a9c4eb" : "#d9d9d9";
        ctx.fillRect(x, y + k * alturaLinha, w, h);
        ctx.strokeStyle = "#ffffff";
        ctx.strokeRect(x, y + k * alturaLinha, w, h);
        ctx.fillStyle = "#222222";
        ctx.font = seg.total ? "bold 13px Arial, sans-serif" : seg.inicio === 0 ? "12px Arial, sans-serif" : "italic 13px Arial, sans-serif";
        ctx.textAlign = "center";
        const limite = Math.max(8, Math.floor(w / 7.5));
        const texto = String(seg.texto || "");
        ctx.fillText(texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto, x + w / 2, y + k * alturaLinha + (seg.total ? h / 2 + 5 : 17));
      }
    });
    y += alturaDoCabecalho;
    // Linhas
    t.linhas.forEach((linha, i) => {
      if (t.tipos[i] === "anexoTitulo") {
        const larguraTotal = larguraRotulo + (n - 1) * larguraColuna;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(xDaColuna(0), y, larguraTotal, alturaLinha);
        ctx.fillStyle = "#1f5597";
        ctx.fillRect(xDaColuna(0), y, larguraTotal, 2);
        ctx.fillStyle = "#555555";
        ctx.font = "11px Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(linha[0]).toUpperCase(), xDaColuna(0) + 8, y + 18);
        y += alturaLinha;
        return;
      }
      const sub = ["saida", "situacao", "alerta", "conversao"].includes(t.tipos[i]);
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = j === n - 1 ? "#a9c4eb" : t.tipos[i] === "anexo" ? "#fff2cc" : sub ? "#f3f3f3" : "#d9d9d9";
        ctx.fillRect(xDaColuna(j), y, larguraDaColuna(j), alturaLinha);
        ctx.strokeStyle = "#ffffff";
        ctx.strokeRect(xDaColuna(j), y, larguraDaColuna(j), alturaLinha);
        ctx.fillStyle = t.tipos[i] === "alerta" ? "#8a5a00" : sub ? "#555555" : "#222222";
        ctx.font = `${t.tipos[i] === "saida" && j === 0 ? "italic " : ""}${j === n - 1 || t.tipos[i] === "principal" || t.tipos[i] === "anexo" ? "bold " : ""}${sub ? "11px" : "13px"} Arial, sans-serif`;
        const v = linha[j];
        const texto = j && i === 0 ? reaisDoResumo(v) || "—" : String(v ?? "");
        if (j === 0 && sub) {
          ctx.textAlign = "left";
          const recuo = t.tipos[i] === "saida" || t.tipos[i] === "conversao" ? 14 : 26;
          const limite = Math.floor((larguraRotulo - recuo - 4) / 5.6);
          const limpo = texto.trim();
          ctx.fillText(limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo, xDaColuna(0) + recuo, y + 17);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(texto, xDaColuna(j) + larguraDaColuna(j) / 2, y + 17);
        }
      }
      y += alturaLinha;
    });
    ctx.strokeStyle = "#ffffff";
    y += espaco;
  }
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nomeDoArquivoDoResumo("png");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
});

$("colunasResumo").addEventListener("change", () => carregarResumoDoNucleo());
$("quadrosResumo").addEventListener("change", () => carregarResumoDoNucleo());
$("btnDetalhamentoResumo").addEventListener("click", () => {
  const algumAberto = SAIDAS_DO_RESUMO.some((_, k) => passoAberto(k));
  SAIDAS_DO_RESUMO.forEach((_, k) => (algumAberto ? passosRecolhidos.add(k) : passosRecolhidos.delete(k)));
  atualizarBotaoDoDetalhamento();
  renderizarResumoDoNucleo();
});
