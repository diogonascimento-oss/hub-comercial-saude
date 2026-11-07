// Aba "Base de leads": todos os leads dos três funis com os campos do Kommo,
// filtráveis como numa planilha (filtros ligados por "e" ou "ou"), com ordenação, escolha de
// colunas e CSV. Depende de app.js ($, chamarApi, esc, numero, baixarCSV) e
// lead.js (abrirFichaDoLead).

let base = null; // resposta de /api/base-de-leads
let colunasDaBase = []; // definição de todas as colunas (fixas + campos do Kommo)
let colunasVisiveis = null; // chaves das colunas mostradas
let filtrosDaBase = []; // { coluna, operador, valor, valor2, juncao: "e" | "ou" }
let ordemDaBase = { coluna: "criadoEm", direcao: -1 };

const COLUNAS_FIXAS = [
  { chave: "nome", nome: "Nome", tipo: "texto" },
  { chave: "telefone", nome: "Telefone", tipo: "texto" },
  { chave: "campanha", nome: "Campanha", tipo: "lista" },
  { chave: "etapa", nome: "Etapa atual", tipo: "lista" },
  { chave: "sdr", nome: "SDR", tipo: "lista" },
  { chave: "closer", nome: "Closer", tipo: "lista" },
  { chave: "farmer", nome: "Farmer", tipo: "lista" },
  { chave: "etiquetas", nome: "Etiquetas", tipo: "texto" },
  { chave: "criadoEm", nome: "Criado em", tipo: "data" },
  { chave: "horaDeChegada", nome: "Hora de chegada", tipo: "hora" },
  { chave: "atualizadoEm", nome: "Última atualização", tipo: "data" },
];
const VISIVEIS_PADRAO = ["nome", "campanha", "etapa", "sdr", "criadoEm"];

const OPERADORES = {
  texto: [["contem", "contém"], ["naoContem", "não contém"], ["igual", "é igual a"], ["vazio", "está vazio"], ["preenchido", "está preenchido"]],
  numero: [["maior", "maior que"], ["maiorIgual", "maior ou igual a"], ["menor", "menor que"], ["menorIgual", "menor ou igual a"], ["igual", "igual a"], ["entre", "entre"], ["vazio", "está vazio"], ["preenchido", "está preenchido"]],
  data: [["depois", "a partir de"], ["antes", "até"], ["entre", "entre"], ["vazio", "está vazio"], ["preenchido", "está preenchido"]],
  lista: [["eh", "é"], ["naoEh", "não é"], ["vazio", "está vazio"], ["preenchido", "está preenchido"]],
  // Hora do dia em que o lead chegou, em qualquer data. "Entre 18:00 e 08:00"
  // atravessa a meia-noite.
  hora: [["entre", "entre"], ["depois", "a partir de"], ["antes", "até"]],
};
const SEM_VALOR = new Set(["vazio", "preenchido"]);

function lerPreferencias() {
  try {
    return JSON.parse(localStorage.getItem("baseDeLeads") || "{}");
  } catch {
    return {};
  }
}
function guardarPreferencias() {
  try {
    localStorage.setItem("baseDeLeads", JSON.stringify({ colunas: colunasVisiveis, filtros: filtrosDaBase, ordem: ordemDaBase }));
  } catch {
    // Sem armazenamento no navegador: as escolhas valem só nesta visita.
  }
}

const CHAVES_FIXAS = new Set(COLUNAS_FIXAS.map((c) => c.chave));
const horaDoDia = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Recife", hour: "2-digit", minute: "2-digit" }) : "");
const dataEHora = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Recife", dateStyle: "short", timeStyle: "short" });
function valorDaColuna(lead, chave) {
  if (chave === "horaDeChegada") return horaDoDia(lead.criadoEm);
  if (chave === "etiquetas") return (lead.etiquetas || []).join(", ");
  return CHAVES_FIXAS.has(chave) ? lead[chave] : lead.valores[chave];
}

async function carregarBaseDeLeads(forcar = false) {
  if (base && !forcar && Date.now() - Date.parse(base.geradoEm) < 60_000) return;
  $("tabelaBase").innerHTML = '<tbody><tr><td class="p-4 text-inkdim">Carregando a base.</td></tr></tbody>';
  try {
    base = await chamarApi("/base-de-leads");
    colunasDaBase = [...COLUNAS_FIXAS, ...base.campos.map((c) => ({ ...c, doKommo: true }))];
    const pref = lerPreferencias();
    const existe = (k) => colunasDaBase.some((c) => c.chave === k);
    colunasVisiveis = (pref.colunas || VISIVEIS_PADRAO).filter(existe);
    filtrosDaBase = (pref.filtros || []).filter((f) => existe(f.coluna));
    if (pref.ordem && existe(pref.ordem.coluna)) ordemDaBase = pref.ordem;
    renderizarFiltrosDaBase();
    renderizarTabelaDaBase();
  } catch (erro) {
    $("tabelaBase").innerHTML = `<tbody><tr><td class="p-4 text-negativo">Não foi possível carregar a base. ${esc(erro.message)}</td></tr></tbody>`;
  }
}

const colunaPorChave = (k) => colunasDaBase.find((c) => c.chave === k);

function valoresDistintos(chave) {
  const todos = new Set();
  for (const l of base.leads) {
    const v = valorDaColuna(l, chave);
    if (v !== undefined && v !== null && v !== "") String(v).split("; ").forEach((x) => todos.add(x));
  }
  return [...todos].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function renderizarFiltrosDaBase() {
  const opcoesDeColuna = (selecionada) =>
    colunasDaBase.map((c) => `<option value="${esc(c.chave)}" ${c.chave === selecionada ? "selected" : ""}>${esc(c.nome)}${c.doKommo ? "" : " ·"}</option>`).join("");
  $("filtrosBase").innerHTML = filtrosDaBase.length
    ? filtrosDaBase
        .map((f, i) => {
          const col = colunaPorChave(f.coluna);
          const ops = OPERADORES[col.tipo];
          const tipoDoCampo = col.tipo === "data" ? "date" : col.tipo === "hora" ? "time" : col.tipo === "numero" ? "number" : "text";
          let entrada = "";
          if (!SEM_VALOR.has(f.operador)) {
            if (col.tipo === "lista") {
              entrada = `<select data-filtro="${i}" data-parte="valor" class="bg-surface2 border border-line px-2 py-1 text-ink text-[11px] max-w-[16rem]"><option value="">Escolha</option>${valoresDistintos(f.coluna)
                .map((v) => `<option value="${esc(v)}" ${v === f.valor ? "selected" : ""}>${esc(v)}</option>`)
                .join("")}</select>`;
            } else {
              const lista = col.tipo === "texto" ? `list="sugestoes-${i}"` : "";
              entrada = `<input data-filtro="${i}" data-parte="valor" type="${tipoDoCampo}" ${lista} value="${esc(f.valor ?? "")}" ${col.tipo === "numero" ? 'step="any"' : ""} class="bg-surface2 border border-line px-2 py-1 text-ink text-[11px] w-40 [color-scheme:dark]">`;
              if (col.tipo === "texto") entrada += `<datalist id="sugestoes-${i}">${valoresDistintos(f.coluna).slice(0, 50).map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
              if (f.operador === "entre") entrada += `<span class="text-inkfaint text-[11px]">e</span><input data-filtro="${i}" data-parte="valor2" type="${tipoDoCampo}" value="${esc(f.valor2 ?? "")}" ${col.tipo === "numero" ? 'step="any"' : ""} class="bg-surface2 border border-line px-2 py-1 text-ink text-[11px] w-40 [color-scheme:dark]">`;
            }
          }
          return `<div class="flex items-center gap-2 flex-wrap">
            ${
              i
                ? `<select data-filtro="${i}" data-parte="juncao" title="Como este filtro se soma aos anteriores" class="bg-surface2 border border-line px-1 py-1 text-ink text-[11px] w-12"><option value="e" ${f.juncao !== "ou" ? "selected" : ""}>e</option><option value="ou" ${f.juncao === "ou" ? "selected" : ""}>ou</option></select>`
                : '<span class="text-[11px] text-inkfaint w-12">Onde</span>'
            }
            <select data-filtro="${i}" data-parte="coluna" class="bg-surface2 border border-line px-2 py-1 text-ink text-[11px] max-w-[16rem]">${opcoesDeColuna(f.coluna)}</select>
            <select data-filtro="${i}" data-parte="operador" class="bg-surface2 border border-line px-2 py-1 text-ink text-[11px]">${ops.map(([k, r]) => `<option value="${k}" ${k === f.operador ? "selected" : ""}>${r}</option>`).join("")}</select>
            ${entrada}
            <button type="button" data-remover-filtro="${i}" class="text-inkdim hover:text-negativo text-[11px] px-1" title="Remover filtro">✕</button>
          </div>`;
        })
        .join("") + avisoDeMistura()
    : '<p class="text-[11px] text-inkfaint">Nenhum filtro. Use "+ Adicionar filtro" para filtrar por qualquer campo, por exemplo mensalidade maior que 1.000.</p>';
}

// Com "e" e "ou" misturados, o "e" une primeiro, como numa expressão comum:
// A e B ou C equivale a (A e B) ou C.
function avisoDeMistura() {
  const juncoes = new Set(filtrosDaBase.slice(1).map((f) => (f.juncao === "ou" ? "ou" : "e")));
  return juncoes.size > 1
    ? '<p class="text-[11px] text-inkfaint">Com "e" e "ou" juntos, os filtros ligados por "e" formam um grupo, e o lead aparece se atender a qualquer um dos grupos.</p>'
    : "";
}

const filtroCompleto = (f) => SEM_VALOR.has(f.operador) || (f.valor !== undefined && f.valor !== null && f.valor !== "");

function passaNosFiltros(lead) {
  const grupos = [[]];
  filtrosDaBase.forEach((f, i) => {
    if (i && f.juncao === "ou") grupos.push([]);
    grupos[grupos.length - 1].push(f);
  });
  // Filtros ainda sem valor não contam; um grupo só com eles é ignorado.
  const validos = grupos.map((g) => g.filter(filtroCompleto)).filter((g) => g.length);
  if (!validos.length) return true;
  return validos.some((g) => g.every((f) => passaNoFiltro(lead, f)));
}

function passaNoFiltro(lead, f) {
  const col = colunaPorChave(f.coluna);
  const v = valorDaColuna(lead, f.coluna);
  const vazio = v === undefined || v === null || v === "";
  if (f.operador === "vazio") return vazio;
  if (f.operador === "preenchido") return !vazio;
  if (f.valor === undefined || f.valor === null || f.valor === "") return true; // filtro ainda sem valor
  if (vazio) return f.operador === "naoContem" || f.operador === "naoEh";
  const sem = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (col.tipo === "texto") {
    if (f.operador === "contem") return sem(v).includes(sem(f.valor));
    if (f.operador === "naoContem") return !sem(v).includes(sem(f.valor));
    if (f.operador === "igual") return sem(v).trim() === sem(f.valor).trim();
  }
  if (col.tipo === "lista") {
    const partes = String(v).split("; ");
    return f.operador === "eh" ? partes.includes(f.valor) : !partes.includes(f.valor);
  }
  if (col.tipo === "numero") {
    const n = Number(v);
    const a = Number(f.valor);
    const b = Number(f.valor2);
    return {
      maior: n > a,
      maiorIgual: n >= a,
      menor: n < a,
      menorIgual: n <= a,
      igual: n === a,
      entre: f.valor2 === undefined || f.valor2 === "" ? n >= a : n >= Math.min(a, b) && n <= Math.max(a, b),
    }[f.operador];
  }
  if (col.tipo === "hora") {
    const de = f.valor;
    const ate = f.valor2;
    if (f.operador === "depois") return v >= de;
    if (f.operador === "antes") return v <= de;
    if (!ate) return v >= de;
    return de <= ate ? v >= de && v <= ate : v >= de || v <= ate;
  }
  if (col.tipo === "data") {
    const dia = new Date(v).toLocaleDateString("sv-SE", { timeZone: "America/Recife" });
    if (f.operador === "depois") return dia >= f.valor;
    if (f.operador === "antes") return dia <= f.valor;
    if (f.operador === "entre") return dia >= f.valor && (!f.valor2 || dia <= f.valor2);
  }
  return true;
}

function leadsFiltradosDaBase() {
  const busca = $("buscaBase").value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let lista = base.leads.filter(passaNosFiltros);
  if (busca) {
    lista = lista.filter((l) =>
      [l.nome, l.telefone, l.campanha, l.etapa, l.sdr, l.closer, l.farmer, ...(l.etiquetas || []), ...Object.values(l.valores)]
        .join(" ")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .includes(busca),
    );
  }
  const col = colunaPorChave(ordemDaBase.coluna);
  const chave = (l) => {
    const v = valorDaColuna(l, ordemDaBase.coluna);
    if (v === undefined || v === null || v === "") return null;
    if (col?.tipo === "numero") return Number(v);
    if (col?.tipo === "data") return Date.parse(v);
    return String(v).toLowerCase();
  };
  return lista.sort((a, b) => {
    const x = chave(a);
    const y = chave(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1; // vazios sempre no fim
    if (y === null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * ordemDaBase.direcao;
  });
}

function formatarCelula(col, v) {
  if (v === undefined || v === null || v === "") return '<span class="text-inkfaint">—</span>';
  if (col.tipo === "numero") return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  if (col.tipo === "data") return col.chave === "criadoEm" ? dataEHora(v) : new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
  const t = String(v);
  return esc(t.length > 80 ? `${t.slice(0, 79)}…` : t);
}

const LIMITE_NA_TELA = 500;

function renderizarTabelaDaBase() {
  if (!base) return;
  const lista = leadsFiltradosDaBase();
  const colunas = colunasVisiveis.map(colunaPorChave).filter(Boolean);
  $("totalBase").textContent = `${numero(lista.length)} de ${numero(base.leads.length)}`;
  const seta = (k) => (ordemDaBase.coluna === k ? (ordemDaBase.direcao > 0 ? " ▲" : " ▼") : "");
  $("tabelaBase").innerHTML = `
    <thead><tr class="text-inkdim text-[10px] uppercase tracking-wide bg-surface2">
      ${colunas.map((c) => `<th class="text-left font-normal px-3 py-2 whitespace-nowrap ${c.tipo === "numero" ? "text-right" : ""}"><button type="button" data-ordenar="${esc(c.chave)}" class="hover:text-ink">${esc(c.nome)}${seta(c.chave)}</button></th>`).join("")}
    </tr></thead>
    <tbody>${
      lista.length
        ? lista
            .slice(0, LIMITE_NA_TELA)
            .map(
              (l) => `<tr class="border-t border-line hover:bg-surface2/60">${colunas
                .map((c) =>
                  c.chave === "nome"
                    ? `<td class="px-3 py-1.5"><button type="button" data-lead="${esc(l.id)}" class="text-ink hover:text-goldbright underline decoration-dotted underline-offset-2 text-left">${esc(l.nome)}${marcaPre(l)}</button></td>`
                    : `<td class="px-3 py-1.5 ${c.tipo === "numero" ? "text-right tabular" : ""} text-inkdim">${formatarCelula(c, valorDaColuna(l, c.chave))}</td>`,
                )
                .join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${colunas.length}" class="px-3 py-4 text-inkdim">Nenhum lead com esses filtros.</td></tr>`
    }</tbody>`;
  $("rodapeBase").textContent = lista.length > LIMITE_NA_TELA ? `Mostrando os ${LIMITE_NA_TELA} primeiros de ${numero(lista.length)}. O CSV traz todos.` : "";
}

function renderizarPainelDeColunas() {
  const marcar = (c) => `<label class="flex items-center gap-1.5 text-inkdim"><input type="checkbox" data-coluna-visivel="${esc(c.chave)}" ${colunasVisiveis.includes(c.chave) ? "checked" : ""}> ${esc(c.nome)}${c.doKommo ? ` <span class="text-inkfaint">(${numero(c.preenchidos)})</span>` : ""}</label>`;
  $("painelColunasBase").innerHTML = `
    <p class="rotulo mb-2">Dados do lead</p>
    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5 mb-3">${COLUNAS_FIXAS.map(marcar).join("")}</div>
    <p class="rotulo mb-2">Campos do Kommo <span class="normal-case tracking-normal text-inkfaint">(entre parênteses, quantos leads têm o campo preenchido)</span></p>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">${base.campos.map(marcar).join("")}</div>`;
}

// --- Eventos ---------------------------------------------------------------------

$("btnAdicionarFiltro").addEventListener("click", () => {
  if (!base) return;
  const sugestao = base.campos.find((c) => /mensalidade/i.test(c.nome)) || colunaPorChave("etapa");
  filtrosDaBase.push({ coluna: sugestao.chave, operador: OPERADORES[sugestao.tipo][0][0], valor: "" });
  if (!colunasVisiveis.includes(sugestao.chave)) colunasVisiveis.push(sugestao.chave);
  renderizarFiltrosDaBase();
  renderizarTabelaDaBase();
  guardarPreferencias();
});
$("btnLimparFiltros").addEventListener("click", () => {
  filtrosDaBase = [];
  $("buscaBase").value = "";
  renderizarFiltrosDaBase();
  renderizarTabelaDaBase();
  guardarPreferencias();
});
$("filtrosBase").addEventListener("change", (e) => {
  const alvo = e.target.closest("[data-filtro]");
  if (!alvo) return;
  const f = filtrosDaBase[Number(alvo.dataset.filtro)];
  const parte = alvo.dataset.parte;
  if (parte === "coluna") {
    const col = colunaPorChave(alvo.value);
    Object.assign(f, { coluna: alvo.value, operador: OPERADORES[col.tipo][0][0], valor: "", valor2: "" });
    // Filtrar por um campo também mostra a coluna dele.
    if (!colunasVisiveis.includes(alvo.value)) colunasVisiveis.push(alvo.value);
    renderizarFiltrosDaBase();
  } else if (parte === "operador") {
    f.operador = alvo.value;
    renderizarFiltrosDaBase();
  } else if (parte === "juncao") {
    f.juncao = alvo.value;
    renderizarFiltrosDaBase();
  } else {
    f[parte] = alvo.value;
  }
  renderizarTabelaDaBase();
  guardarPreferencias();
});
$("filtrosBase").addEventListener("input", (e) => {
  const alvo = e.target.closest("input[data-filtro]");
  if (!alvo) return;
  filtrosDaBase[Number(alvo.dataset.filtro)][alvo.dataset.parte] = alvo.value;
  renderizarTabelaDaBase();
});
$("filtrosBase").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-remover-filtro]");
  if (!botao) return;
  filtrosDaBase.splice(Number(botao.dataset.removerFiltro), 1);
  renderizarFiltrosDaBase();
  renderizarTabelaDaBase();
  guardarPreferencias();
});
$("buscaBase").addEventListener("input", () => base && renderizarTabelaDaBase());
$("tabelaBase").addEventListener("click", (e) => {
  const ordenar = e.target.closest("button[data-ordenar]");
  if (ordenar) {
    const k = ordenar.dataset.ordenar;
    ordemDaBase = ordemDaBase.coluna === k ? { coluna: k, direcao: -ordemDaBase.direcao } : { coluna: k, direcao: colunaPorChave(k)?.tipo === "texto" || colunaPorChave(k)?.tipo === "lista" ? 1 : -1 };
    renderizarTabelaDaBase();
    guardarPreferencias();
    return;
  }
  const lead = e.target.closest("button[data-lead]");
  if (lead) abrirFichaDoLead(lead.dataset.lead);
});
$("btnColunasBase").addEventListener("click", () => {
  if (!base) return;
  const painel = $("painelColunasBase");
  painel.classList.toggle("hidden");
  if (!painel.classList.contains("hidden")) renderizarPainelDeColunas();
});
$("painelColunasBase").addEventListener("change", (e) => {
  const caixa = e.target.closest("input[data-coluna-visivel]");
  if (!caixa) return;
  const k = caixa.dataset.colunaVisivel;
  colunasVisiveis = caixa.checked ? [...colunasVisiveis, k] : colunasVisiveis.filter((x) => x !== k);
  if (!colunasVisiveis.includes("nome")) colunasVisiveis.unshift("nome");
  renderizarTabelaDaBase();
  guardarPreferencias();
});
$("btnCsvBase").addEventListener("click", () => {
  if (!base) return;
  const colunas = [{ chave: "id", nome: "ID", tipo: "texto" }, ...colunasVisiveis.map(colunaPorChave).filter(Boolean)];
  const texto = (c, v) => {
    if (v === undefined || v === null || v === "") return "";
    if (c.tipo === "numero") return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });
    if (c.tipo === "data") return c.chave === "criadoEm" ? dataEHora(v) : new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
    return String(v);
  };
  baixarCSV(
    `base_de_leads_${new Date().toISOString().slice(0, 10)}.csv`,
    colunas.map((c) => c.nome),
    leadsFiltradosDaBase().map((l) => colunas.map((c) => texto(c, c.chave === "id" ? l.id : valorDaColuna(l, c.chave)))),
  );
});
