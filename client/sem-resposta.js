// Pendências: clientes cuja última mensagem no chat está sem resposta.
// Depende de app.js ($, chamarApi, esc, numero, baixarCSV, nomeEtapa) e
// lead.js (abrirFichaDoLead, duracaoCurta).

let semResposta = null;
let horasSemRespostaCarregadas = null;

async function carregarSemResposta(forcar = false) {
  const horas = Number($("horasSemResposta").value);
  if (!forcar && horas === horasSemRespostaCarregadas) return;
  horasSemRespostaCarregadas = horas;
  $("listaSemResposta").innerHTML = '<p class="text-inkdim">Carregando.</p>';
  try {
    semResposta = await chamarApi(`/mensagens/sem-resposta?horas=${horas}`);
    const lista = semResposta.leads.filter((l) => campanhaSelecionada === "TODAS" || l.campanha === campanhaSelecionada);
    $("totalSemResposta").textContent = numero(lista.length);
    $("listaSemResposta").innerHTML = lista.length
      ? lista
          .map(
            (l) => `<div class="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
          <div class="min-w-0">
            <button type="button" data-lead="${esc(l.id)}" class="text-ink hover:text-goldbright underline decoration-dotted underline-offset-2 text-left truncate max-w-full">${esc(l.nome)}${marcaPre(l)}</button>
            <p class="text-[10px] text-inkfaint">${esc(l.campanha)} · ${esc(nomeEtapa(l.etapaAtual))}${l.sdr ? ` · SDR: ${esc(l.sdr)}` : ""}</p>
          </div>
          <span class="text-[11px] tabular shrink-0 font-semibold ${l.aguardandoSeg >= 86400 ? "text-negativo" : "text-goldbright"}">há ${duracaoCurta(l.aguardandoSeg)}</span>
        </div>`,
          )
          .join("")
      : '<p class="text-inkdim">Nenhum cliente aguardando resposta.</p>';
  } catch (erro) {
    horasSemRespostaCarregadas = null;
    $("listaSemResposta").innerHTML = `<p class="text-negativo">Não foi possível verificar. ${esc(erro.message)}</p>`;
  }
}

$("horasSemResposta").addEventListener("change", () => carregarSemResposta());
$("listaSemResposta").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-lead]");
  if (botao) abrirFichaDoLead(botao.dataset.lead);
});
$("btnExportarSemResposta").addEventListener("click", () => {
  if (!semResposta?.leads.length) return;
  baixarCSV(
    `clientes_aguardando_resposta_${new Date().toISOString().slice(0, 10)}.csv`,
    ["ID", "Nome", "Telefone", "Campanha", "Etapa atual", "SDR", "Aguardando desde", "Horas aguardando"],
    semResposta.leads.map((l) => [l.id, l.nome, l.telefone, l.campanha, nomeEtapa(l.etapaAtual), l.sdr, new Date(l.aguardandoDesde).toLocaleString("pt-BR"), Math.round(l.aguardandoSeg / 360) / 10]),
  );
});
