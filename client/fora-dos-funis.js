// Pendências: leads que chegaram num funil vigiado fora das três campanhas
// (por exemplo, o "Funil de vendas" padrão do Kommo). Mostra o que ajuda a
// descobrir por onde entraram. Depende de app.js ($, chamarApi, esc, numero,
// baixarCSV) e lead.js (abrirFichaDoLead não se aplica: o lead está fora dos
// funis do painel, então o link vai direto ao Kommo).

let foraDosFunis = null;
let diasForaDosFunisCarregados = null;

async function carregarForaDosFunis(forcar = false) {
  const dias = Number($("diasForaDosFunis").value);
  if (!forcar && dias === diasForaDosFunisCarregados) return;
  diasForaDosFunisCarregados = dias;
  $("listaForaDosFunis").innerHTML = '<p class="text-inkdim">Carregando.</p>';
  try {
    foraDosFunis = await chamarApi(`/fora-dos-funis?dias=${dias}`);
    renderizarForaDosFunis();
  } catch (erro) {
    diasForaDosFunisCarregados = null;
    $("listaForaDosFunis").innerHTML = `<p class="text-negativo">Não foi possível consultar. ${esc(erro.message)}</p>`;
  }
}

function renderizarForaDosFunis() {
  const r = foraDosFunis;
  $("totalForaDosFunis").textContent = numero(r.total);
  $("notaForaDosFunis").textContent = r.funis.length
    ? `Leads criados nos últimos ${r.dias} dias em ${r.funis.join(", ")}, fora dos três funis do núcleo. Não entram nos indicadores. Para cada um: quem criou, etiquetas, UTMs e campos preenchidos, que ajudam a descobrir por onde ele entrou.`
    : `Nenhum funil vigiado encontrado na conta. Funis fora do núcleo: ${(r.funisDaConta || []).join(", ") || "nenhum"}.`;
  if (!r.leads.length) {
    $("listaForaDosFunis").innerHTML = '<p class="text-inkdim">Nenhum lead fora dos funis no período.</p>';
    return;
  }
  const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Recife" });
  $("listaForaDosFunis").innerHTML = r.leads
    .map((l) => {
      const utms = Object.entries(l.utm).filter(([, v]) => v).map(([k, v]) => `${k}: ${esc(v)}`).join(" · ");
      return `
      <div class="py-2.5 border-b border-line last:border-0">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-ink font-semibold">${esc(l.nome)}${l.telefone ? ` <span class="font-normal text-inkdim tabular">· ${esc(l.telefone)}</span>` : ""}</span>
          <span class="text-[11px] text-inkdim tabular shrink-0">${dataHora(l.criadoEm)}</span>
        </div>
        <p class="text-[11px] text-inkdim mt-0.5">${esc(l.funil)} → ${esc(l.etapa)} · criado por ${esc(l.criadoPor)}${l.linkNoKommo ? ` · <a href="${esc(l.linkNoKommo)}" target="_blank" rel="noopener" class="text-goldbright underline decoration-dotted underline-offset-2">abrir no Kommo</a>` : ""}</p>
        ${l.noNucleo ? `<p class="text-[11px] text-positivo mt-0.5">A mesma pessoa (telefone) também está no núcleo: <button type="button" data-lead="${esc(l.noNucleo.id)}" class="underline decoration-dotted underline-offset-2">lead ${esc(l.noNucleo.id)}</button>, ${esc(l.noNucleo.campanha)}, em ${esc(l.noNucleo.etapa)}.</p>` : '<p class="text-[11px] text-goldbright mt-0.5">Não está em nenhum funil do núcleo.</p>'}
        ${l.etiquetas.length ? `<p class="text-[10px] text-inkfaint mt-0.5">Etiquetas: ${l.etiquetas.map(esc).join(", ")}</p>` : ""}
        ${utms ? `<p class="text-[10px] text-inkfaint mt-0.5">${utms}</p>` : ""}
        ${l.campos.length ? `<details class="mt-1"><summary class="text-[10px] text-inkfaint cursor-pointer">Campos preenchidos (${l.campos.length})</summary><p class="text-[10px] text-inkdim mt-1 leading-relaxed">${l.campos.map((c) => `<span class="text-inkfaint">${esc(c.nome)}:</span> ${esc(String(c.valor).slice(0, 160))}`).join("<br>")}</p></details>` : ""}
      </div>`;
    })
    .join("");
}

$("diasForaDosFunis").addEventListener("change", () => carregarForaDosFunis());
$("listaForaDosFunis").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-lead]");
  if (botao) abrirFichaDoLead(botao.dataset.lead);
});
$("btnExportarForaDosFunis").addEventListener("click", () => {
  if (!foraDosFunis?.leads.length) return;
  baixarCSV(
    `leads_fora_dos_funis_${new Date().toISOString().slice(0, 10)}.csv`,
    ["ID", "Nome", "Telefone", "Funil", "Etapa", "Criado em", "Criado por", "Etiquetas", "UTM campanha", "UTM origem", "UTM conteúdo", "UTM termo", "Também no núcleo", "Link no Kommo"],
    foraDosFunis.leads.map((l) => [
      l.id, l.nome, l.telefone, l.funil, l.etapa, new Date(l.criadoEm).toLocaleString("pt-BR"), l.criadoPor, l.etiquetas.join(", "),
      l.utm.campanha, l.utm.origem, l.utm.conteudo, l.utm.termo,
      l.noNucleo ? `${l.noNucleo.id} (${l.noNucleo.campanha}, ${l.noNucleo.etapa})` : "", l.linkNoKommo || "",
    ]),
  );
});
