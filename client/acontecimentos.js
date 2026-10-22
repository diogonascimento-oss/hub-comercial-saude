// Acontecimentos do dia: agendamentos, reuniões realizadas e não realizadas,
// remarcações e contratos, em ordem de horário. Os dados vêm de
// /api/acontecimentos, que aplica as mesmas regras dos cartões de indicadores.
// Respeita a campanha escolhida no seletor do painel.

const TIPOS_DE_ACONTECIMENTO = {
  agendamento: { rotulo: "Reunião marcada", cor: "#d8b565", responsavel: "sdr" },
  reagendamento: { rotulo: "Reunião remarcada", cor: "#d8b565", responsavel: "sdr" },
  realizada: { rotulo: "Reunião realizada", cor: "#6ea8d8", responsavel: "closer" },
  naoRealizada: { rotulo: "Reunião não realizada", cor: "#d0685a", responsavel: "closer" },
  remarcacao: { rotulo: "Foi para Remarcação", cor: "#9a9ca8", responsavel: "sdr" },
  perdidaAntesDaReuniao: { rotulo: "Perdido antes da reunião", cor: "#9a9ca8", responsavel: "sdr" },
  contrato: { rotulo: "Contrato fechado", cor: "#4fb38a", responsavel: "closer" },
};

// Ordem e textos do resumo no topo da seção.
const RESUMO_DOS_ACONTECIMENTOS = [
  [["agendamento", "reagendamento"], "reunião marcada", "reuniões marcadas"],
  [["realizada"], "realizada", "realizadas"],
  [["naoRealizada"], "não realizada", "não realizadas"],
  [["remarcacao"], "remarcação", "remarcações"],
  [["contrato"], "contrato", "contratos"],
];

let acontecimentosDoDia = null;

function hojeNoEscritorio() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife" }).format(new Date());
}

function deslocarDia(data, dias) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function carregarAcontecimentos() {
  const campo = $("diaAcontecimentos");
  if (!campo.value) campo.value = hojeNoEscritorio();
  campo.max = hojeNoEscritorio();
  $("btnDiaSeguinte").disabled = campo.value >= hojeNoEscritorio();
  $("listaAcontecimentos").innerHTML = '<p class="px-4 py-6 text-xs text-inkdim">Carregando.</p>';
  try {
    acontecimentosDoDia = await chamarApi(`/acontecimentos?dia=${campo.value}`);
    renderizarAcontecimentos();
  } catch (erro) {
    acontecimentosDoDia = null;
    $("resumoAcontecimentos").textContent = "";
    $("listaAcontecimentos").innerHTML = `<p class="px-4 py-6 text-xs text-negativo">${esc(erro.message)}</p>`;
  }
}

function renderizarAcontecimentos() {
  if (!acontecimentosDoDia) return;
  const lista = acontecimentosDoDia.acontecimentos.filter(
    (a) => campanhaSelecionada === "TODAS" || a.lead.campanha === campanhaSelecionada,
  );
  const ehHoje = acontecimentosDoDia.dia === hojeNoEscritorio();
  const nomeDoDia = ehHoje ? "Hoje" : new Date(`${acontecimentosDoDia.dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }).replace(/^./, (c) => c.toUpperCase());

  const contar = (tipos) => lista.filter((a) => tipos.includes(a.tipo)).length;
  const partes = RESUMO_DOS_ACONTECIMENTOS.map(([tipos, um, varios]) => {
    const n = contar(tipos);
    return n ? `<strong class="text-ink">${numero(n)}</strong> ${n === 1 ? um : varios}` : null;
  }).filter(Boolean);
  $("resumoAcontecimentos").innerHTML = `<span class="text-ink">${esc(nomeDoDia)}:</span> ${partes.length ? partes.join(" · ") : "nenhum acontecimento registrado"}`;

  if (!lista.length) {
    $("listaAcontecimentos").innerHTML = `<p class="px-4 py-6 text-xs text-inkdim">Nenhum agendamento, reunião ou contrato registrado no Kommo ${ehHoje ? "hoje" : "neste dia"}${campanhaSelecionada === "TODAS" ? "" : ` em ${esc(campanhaSelecionada)}`}.</p>`;
    return;
  }

  $("listaAcontecimentos").innerHTML = lista
    .map((a) => {
      const tipo = TIPOS_DE_ACONTECIMENTO[a.tipo] || { rotulo: a.tipo, cor: "#9a9ca8" };
      const hora = new Date(a.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Recife" });
      // Nos acontecimentos da reunião em diante, aparecem o SDR que marcou e o
      // closer; nos demais, só o SDR.
      const papeis = tipo.responsavel === "closer" ? [["sdr", "SDR"], ["closer", "Closer"]] : [["sdr", "SDR"]];
      const pessoas = papeis
        .filter(([chave]) => a.responsaveis?.[chave])
        .map(([chave, rotulo]) => `<span class="block">${rotulo}: ${esc(a.responsaveis[chave])}</span>`)
        .join("");
      const caminho = a.de ? `${esc(a.de)} → ${esc(a.para)}` : esc(a.para);
      return `
      <li class="grid grid-cols-[3rem_minmax(0,1fr)] sm:grid-cols-[3.5rem_13rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
        <span class="tabular text-xs text-inkdim">${hora}</span>
        <span class="text-xs font-semibold flex items-center gap-2" style="color:${tipo.cor}"><i class="inline-block w-2 h-2 rounded-full shrink-0" style="background:${tipo.cor}"></i>${esc(tipo.rotulo)}</span>
        <span class="col-start-2 sm:col-start-auto min-w-0 text-xs">
          <button type="button" data-lead="${esc(a.lead.id)}" class="text-ink hover:text-goldbright underline decoration-dotted underline-offset-2 text-left">${esc(a.lead.nome)}</button>
          <span class="text-inkfaint"> · ${esc(a.lead.campanha)}</span>
          <span class="block text-[11px] text-inkfaint truncate">${caminho}${a.detalhe ? ` · ${esc(a.detalhe)}` : ""}</span>
        </span>
        <span class="col-start-2 sm:col-start-auto text-[11px] text-inkdim sm:text-right whitespace-nowrap">${pessoas}</span>
      </li>`;
    })
    .join("");
}

$("diaAcontecimentos").addEventListener("change", carregarAcontecimentos);
$("btnDiaAnterior").addEventListener("click", () => {
  $("diaAcontecimentos").value = deslocarDia($("diaAcontecimentos").value || hojeNoEscritorio(), -1);
  carregarAcontecimentos();
});
$("btnDiaSeguinte").addEventListener("click", () => {
  const seguinte = deslocarDia($("diaAcontecimentos").value || hojeNoEscritorio(), 1);
  if (seguinte > hojeNoEscritorio()) return;
  $("diaAcontecimentos").value = seguinte;
  carregarAcontecimentos();
});
$("btnHojeAcontecimentos").addEventListener("click", () => {
  $("diaAcontecimentos").value = hojeNoEscritorio();
  carregarAcontecimentos();
});
$("listaAcontecimentos").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-lead]");
  if (botao) abrirFichaDoLead(botao.dataset.lead);
});
