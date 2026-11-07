// Busca de lead e ficha completa. Depende de app.js (chamarApi, esc, $,
// numero) e de trafego.js (abrirDialogo, fecharDialogo).

const dataHoraBr = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

function telefoneFormatado(telefone) {
  const d = String(telefone || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return telefone || "sem telefone";
}

// --- Busca ----------------------------------------------------------------------

let esperaDaBusca = null;
let buscaAtual = 0;

function fecharResultadosDaBusca() {
  $("resultadosDaBusca").classList.add("hidden");
}

async function buscarLeads() {
  const termo = $("buscaLead").value.trim();
  const caixa = $("resultadosDaBusca");
  if (termo.length < 2) return fecharResultadosDaBusca();
  const estaBusca = ++buscaAtual;
  caixa.classList.remove("hidden");
  caixa.innerHTML = '<p class="p-3 text-inkdim">Buscando.</p>';
  try {
    const r = await chamarApi(`/leads/busca?q=${encodeURIComponent(termo)}`);
    if (estaBusca !== buscaAtual) return; // chegou uma busca mais recente
    if (!r.resultados.length) {
      caixa.innerHTML = '<p class="p-3 text-inkdim">Nenhum lead encontrado nos três funis.</p>';
      return;
    }
    caixa.innerHTML =
      r.resultados
        .map(
          (l) => `
      <button data-lead="${esc(String(l.id))}" class="w-full text-left px-3 py-2 border-b border-line last:border-0 hover:bg-surface2 block">
        <span class="flex items-baseline justify-between gap-3">
          <span class="text-ink truncate">${esc(l.nome)}${marcaPre(l)}</span>
          <span class="text-inkfaint text-[10px] shrink-0">${esc(l.campanha)}${l.estado ? ` · ${esc(l.estado)}` : ""}</span>
        </span>
        <span class="flex items-baseline justify-between gap-3 mt-0.5 text-[10px]">
          <span class="text-inkdim font-mono">${esc(telefoneFormatado(l.telefone))}</span>
          <span class="text-inkdim shrink-0">${esc(l.etapa || "")}</span>
        </span>
      </button>`,
        )
        .join("") +
      (r.total > r.resultados.length ? `<p class="p-2 text-[10px] text-inkfaint">Exibindo ${numero(r.resultados.length)} de ${numero(r.total)}. Refine a busca para ver os demais.</p>` : "");
  } catch (erro) {
    if (estaBusca === buscaAtual) caixa.innerHTML = `<p class="p-3 text-negativo">${esc(erro.message)}</p>`;
  }
}

$("buscaLead").addEventListener("input", () => {
  clearTimeout(esperaDaBusca);
  esperaDaBusca = setTimeout(buscarLeads, 300);
});
$("buscaLead").addEventListener("focus", () => $("buscaLead").value.trim().length >= 2 && buscarLeads());
$("buscaLead").addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharResultadosDaBusca();
  if (e.key === "Enter") {
    clearTimeout(esperaDaBusca);
    buscarLeads();
  }
});
$("resultadosDaBusca").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-lead]");
  if (!botao) return;
  fecharResultadosDaBusca();
  abrirFichaDoLead(botao.dataset.lead);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#buscaLead, #resultadosDaBusca")) fecharResultadosDaBusca();
});

// --- Ficha ------------------------------------------------------------------------

function blocoDaFicha(titulo, linhas) {
  const preenchidas = linhas.filter(([, valor]) => valor !== null && valor !== undefined && valor !== "");
  if (!preenchidas.length) return "";
  return `
    <section>
      <p class="rotulo mb-2">${esc(titulo)}</p>
      <dl class="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 sm:gap-y-1.5">
        ${preenchidas.map(([nome, valor]) => `<dt class="text-inkdim pt-1.5 sm:pt-0">${esc(nome)}</dt><dd class="text-ink min-w-0 [overflow-wrap:anywhere]">${valor}</dd>`).join("")}
      </dl>
    </section>`;
}

// Descrição do lead, editável pelo painel. O texto é gravado direto no Kommo;
// abaixo dele aparece quem fez a última edição pelo painel, e quando.
let descricaoAberta = null; // { leadId, texto } da ficha exibida, base para detectar edição concorrente

function autoriaDaDescricao(edicao) {
  return edicao ? `Última edição pelo painel: ${esc(edicao.usuario || "autor não registrado")}, em ${dataHoraBr(edicao.quando)}.` : "";
}

function blocoDaDescricao(l) {
  if (!l.descricao) return "";
  descricaoAberta = { leadId: l.id, texto: l.descricao.texto };
  return `
    <section id="blocoDescricao" class="border-l-2 border-gold/60 bg-gold/[0.04] pl-3 pr-3 py-2.5">
      <div class="flex items-baseline justify-between gap-3 mb-2">
        <p class="rotulo text-goldbright">${esc(l.descricao.nome)}</p>
        <button type="button" id="btnEditarDescricao" class="text-[11px] text-goldbright underline decoration-dotted underline-offset-2 hover:text-ink">Editar</button>
      </div>
      <div id="leituraDescricao">
        <div id="textoDescricao" class="text-ink [overflow-wrap:anywhere] leading-relaxed">${l.descricao.texto ? markdownSeguro(l.descricao.texto) : '<span class="text-inkfaint">Sem descrição.</span>'}</div>
      </div>
      <div id="edicaoDescricao" class="hidden">
        <textarea id="campoDescricao" rows="7" maxlength="4000" class="w-full bg-surface2 border border-line px-3 py-2 text-ink text-xs leading-relaxed font-mono"></textarea>
        <p class="text-[10px] text-inkfaint mt-1">Aceita Markdown: **negrito**, *itálico*, # título, - lista, 1. lista numerada, &gt; citação, --- linha, tabelas (| coluna | coluna |) e [texto](https://link).</p>
        <p class="text-[10px] text-inkfaint mt-2 mb-1 uppercase tracking-wide">Prévia</p>
        <div id="previaDescricao" class="text-ink [overflow-wrap:anywhere] leading-relaxed border border-line px-3 py-2 min-h-[2.5rem]"></div>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <button type="button" id="btnSalvarDescricao" class="bg-gold hover:bg-goldbright text-bg text-[11px] font-semibold px-3 py-1.5">Salvar no Kommo</button>
          <button type="button" id="btnCancelarDescricao" class="border border-line hover:border-inkdim text-inkdim text-[11px] px-3 py-1.5">Cancelar</button>
          <span id="statusDescricao" class="text-[11px] text-inkdim"></span>
        </div>
      </div>
      <p id="autoriaDescricao" class="text-[10px] text-inkfaint mt-1.5">${autoriaDaDescricao(l.descricao.edicao)}</p>
    </section>`;
}

function mostrarLeituraDaDescricao(texto) {
  $("textoDescricao").innerHTML = texto ? markdownSeguro(texto) : '<span class="text-inkfaint">Sem descrição.</span>';
  $("edicaoDescricao").classList.add("hidden");
  $("leituraDescricao").classList.remove("hidden");
  $("btnEditarDescricao").classList.remove("hidden");
}

async function salvarDescricao() {
  if (!descricaoAberta) return;
  const botao = $("btnSalvarDescricao");
  const status = $("statusDescricao");
  const texto = $("campoDescricao").value;
  botao.disabled = true;
  status.className = "text-[11px] text-inkdim";
  status.textContent = "Salvando no Kommo.";
  try {
    const r = await fetch(`${API}/leads/${encodeURIComponent(descricaoAberta.leadId)}/descricao`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto, textoAnterior: descricaoAberta.texto }),
    });
    const corpo = await lerCorpoDaResposta(r);
    if (r.status === 409 && corpo.textoAtual !== undefined) {
      // Alguém mudou a descrição no Kommo: o texto digitado fica no campo e o
      // texto atual do Kommo aparece embaixo. Um novo clique em Salvar
      // substitui o texto do Kommo, agora de forma consciente.
      descricaoAberta.texto = corpo.textoAtual;
      status.className = "text-[11px] text-negativo block w-full";
      status.innerHTML = `A descrição mudou no Kommo enquanto você editava. Texto atual lá: <span class="text-ink whitespace-pre-wrap">${corpo.textoAtual ? esc(corpo.textoAtual) : "(vazio)"}</span><br>Ajuste o seu texto se precisar e clique em Salvar de novo para substituí-lo.`;
      return;
    }
    if (!r.ok) throw new Error(corpo.error || `O servidor respondeu com o código ${r.status}.`);
    descricaoAberta.texto = corpo.texto;
    mostrarLeituraDaDescricao(corpo.texto);
    if (corpo.edicao) $("autoriaDescricao").innerHTML = autoriaDaDescricao(corpo.edicao);
  } catch (erro) {
    status.className = "text-[11px] text-negativo";
    status.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
}

$("corpoFicha").addEventListener("click", (e) => {
  const alvo = e.target.closest("button");
  if (!alvo || !descricaoAberta) return;
  if (alvo.id === "btnEditarDescricao") {
    $("campoDescricao").value = descricaoAberta.texto;
    $("previaDescricao").innerHTML = markdownSeguro(descricaoAberta.texto);
    $("statusDescricao").textContent = "";
    $("leituraDescricao").classList.add("hidden");
    $("edicaoDescricao").classList.remove("hidden");
    alvo.classList.add("hidden");
    $("campoDescricao").focus();
  } else if (alvo.id === "btnCancelarDescricao") {
    mostrarLeituraDaDescricao(descricaoAberta.texto);
  } else if (alvo.id === "btnSalvarDescricao") {
    salvarDescricao();
  }
});

// Alteração da etapa e dos responsáveis pela ficha. As opções (colunas do
// funil do lead, motivos de perda, opções dos campos) vêm do Kommo na hora.
let edicaoAberta = null; // { leadId, opcoes }

function blocoDeAlteracao() {
  return `
    <section id="blocoAlteracao" class="border border-gold/40 bg-gold/[0.04] px-3 py-2.5">
      <div class="flex items-center justify-between gap-3">
        <p class="rotulo text-goldbright">Alterar no Kommo</p>
        <button type="button" id="btnAbrirAlteracao" class="text-[11px] text-goldbright underline decoration-dotted underline-offset-2 hover:text-ink">Mudar etapa, data da reunião ou responsáveis</button>
      </div>
      <div id="formAlteracao" class="hidden mt-3 space-y-3"></div>
    </section>`;
}

function campoDoResponsavel(r) {
  const id = `alteracao-${r.papel}`;
  const controle =
    r.tipo === "lista"
      ? `<select id="${id}" data-papel="${r.papel}" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs">
          <option value="">(vazio)</option>
          ${r.opcoes.map((o) => `<option value="${esc(o.valor)}" ${o.valor === r.atual ? "selected" : ""}>${esc(o.valor)}</option>`).join("")}
        </select>`
      : `<input id="${id}" data-papel="${r.papel}" list="${id}-sugestoes" value="${esc(r.atual)}" maxlength="120" autocomplete="off" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs">
         <datalist id="${id}-sugestoes">${r.sugestoes.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  return `<label class="block"><span class="text-[11px] text-inkdim">${esc(r.rotulo)}</span>${controle}</label>`;
}

function montarFormularioDeAlteracao(o) {
  const atual = o.colunas.find((c) => c.id === o.statusAtual);
  $("formAlteracao").innerHTML = `
    <label class="block"><span class="text-[11px] text-inkdim">Etapa no Kommo</span>
      <select id="alteracaoEtapa" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs">
        ${o.colunas.map((c) => `<option value="${c.id}" ${c.id === o.statusAtual ? "selected" : ""}>${esc(c.nome)}${c.id === o.statusAtual ? " (atual)" : ""}</option>`).join("")}
      </select>
    </label>
    <label id="linhaMotivoPerda" class="block ${atual?.perdido ? "" : "hidden"}"><span class="text-[11px] text-inkdim">Motivo de perda</span>
      <select id="alteracaoMotivo" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs">
        <option value="">Escolha o motivo</option>
        ${o.motivosDePerda.map((m) => `<option value="${m.id}" ${m.id === o.motivoDePerdaAtual ? "selected" : ""}>${esc(m.nome)}</option>`).join("")}
      </select>
    </label>
    ${
      o.dataDaReuniao
        ? `<div class="grid grid-cols-1 sm:grid-cols-[16rem_minmax(0,1fr)] gap-2">
            <label class="block"><span class="block text-[11px] text-inkdim">Data e hora da reunião (horário de Recife)</span>
              <input id="alteracaoData" type="datetime-local" value="${paraCampoDeRecife(o.dataDaReuniao.atual, true)}" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs [color-scheme:dark]">
            </label>
            <label class="block"><span class="block text-[11px] text-inkdim">Link da reunião (Google Meet)</span>
              <input id="alteracaoLink" type="url" value="${esc(o.dataDaReuniao.linkAtual || "")}" placeholder="https://meet.google.com/..." maxlength="500" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs">
            </label>
          </div>
          <p class="text-[10px] text-inkfaint -mt-1">A data, a hora e o link ficam só no painel: não vão para o Kommo, para não disparar as automações de lá.</p>`
        : ""
    }
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">${o.responsaveis.map(campoDoResponsavel).join("")}</div>
    ${blocoDaAgenda(o)}
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" id="btnSalvarAlteracao" class="bg-gold hover:bg-goldbright text-bg text-[11px] font-semibold px-3 py-1.5">Salvar no Kommo</button>
      <button type="button" id="btnCancelarAlteracao" class="border border-line hover:border-inkdim text-inkdim text-[11px] px-3 py-1.5">Cancelar</button>
      <span id="statusAlteracao" class="text-[11px] text-inkdim"></span>
    </div>
    <p class="text-[10px] text-inkfaint">Mudar a etapa aqui é o mesmo que mover o lead no Kommo: as automações da coluna rodam normalmente. A alteração fica registrada numa nota do lead, com o seu e-mail.</p>`;
}

// Datas da reunião sempre no horário do escritório (UTC-3, sem horário de verão).
function paraCampoDeRecife(ts, comHora) {
  if (!ts) return "";
  const iso = new Date((ts - 3 * 3600) * 1000).toISOString();
  return comHora ? iso.slice(0, 16) : iso.slice(0, 10);
}
function deCampoDeRecife(valor, comHora) {
  if (!valor) return null;
  const ms = Date.parse(comHora ? `${valor}:00-03:00` : `${valor}T00:00:00-03:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// Evento no Google Agenda da closer, quando a integração está configurada.
function blocoDaAgenda(o) {
  const a = o.agenda;
  if (!a?.configurado || !o.dataDaReuniao) return "";
  const ev = a.evento;
  const online = ev ? ev.online : true;
  const duracao = ev?.duracaoMin || a.duracaoPadraoMin;
  const duracoes = [30, 45, 60, 90, 120].includes(duracao) ? [30, 45, 60, 90, 120] : [30, 45, 60, 90, 120, duracao].sort((x, y) => x - y);
  return `
    <fieldset class="border border-line px-3 py-2.5 space-y-2">
      <legend class="text-[11px] text-inkdim px-1">Google Agenda da closer</legend>
      ${
        ev
          ? `<p class="text-[11px] text-ink">Evento na agenda de ${esc(ev.closer || ev.email)}${ev.link ? ` · <a href="${esc(ev.link)}" target="_blank" rel="noopener" class="text-goldbright underline decoration-dotted underline-offset-2">abrir no Google Agenda</a>` : ""}${ev.meet ? ` · <a href="${esc(ev.meet)}" target="_blank" rel="noopener" class="text-goldbright underline decoration-dotted underline-offset-2">link do Meet</a>` : ""}</p>`
          : `<p class="text-[11px] text-inkdim">Closers com agenda ligada ao painel: ${a.closersComAgenda.length ? esc(a.closersComAgenda.join(", ")) : "nenhuma ainda"}.</p>`
      }
      <label class="flex items-center gap-2 text-[11px] text-ink"><input type="checkbox" id="agendaSincronizar" ${ev || a.closersComAgenda.length ? "checked" : ""}> ${ev ? "Manter o evento atualizado com a data, a closer e a descrição" : "Criar o evento na agenda da closer ao salvar"}</label>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink">
        <label class="flex items-center gap-1.5"><input type="radio" name="agendaModo" value="online" ${online ? "checked" : ""}> Online (Google Meet)</label>
        <label class="flex items-center gap-1.5"><input type="radio" name="agendaModo" value="presencial" ${online ? "" : "checked"}> Presencial</label>
        <label class="flex items-center gap-1.5">Duração
          <select id="agendaDuracao" class="bg-surface2 border border-line px-1.5 py-1 text-ink text-[11px]">${duracoes.map((d) => `<option value="${d}" ${d === duracao ? "selected" : ""}>${d} min</option>`).join("")}</select>
        </label>
      </div>
      <label id="linhaLocal" class="block ${online ? "hidden" : ""}"><span class="text-[11px] text-inkdim">Local</span>
        <input id="agendaLocal" value="${esc(ev?.local || a.enderecoPadrao || "")}" maxlength="300" class="w-full bg-surface2 border border-line px-2 py-1.5 text-ink text-xs">
      </label>
      <p class="text-[10px] text-inkfaint">O evento leva a descrição do lead, os links dos anexos e o link do lead no Kommo. Se o lead for para Venda perdida ou a data for apagada, o evento sai da agenda.</p>
    </fieldset>`;
}

async function abrirAlteracao(leadId) {
  const form = $("formAlteracao");
  form.classList.remove("hidden");
  $("btnAbrirAlteracao").classList.add("hidden");
  form.innerHTML = '<p class="text-inkdim text-[11px]">Carregando as opções do Kommo.</p>';
  try {
    const opcoes = await chamarApi(`/leads/${encodeURIComponent(leadId)}/edicao`);
    edicaoAberta = { leadId, opcoes };
    montarFormularioDeAlteracao(opcoes);
  } catch (erro) {
    form.innerHTML = `<p class="text-negativo text-[11px]">Não foi possível carregar as opções. ${esc(erro.message)}</p>`;
  }
}

function fecharAlteracao() {
  edicaoAberta = null;
  $("formAlteracao").classList.add("hidden");
  $("formAlteracao").innerHTML = "";
  $("btnAbrirAlteracao").classList.remove("hidden");
}

async function salvarAlteracao() {
  if (!edicaoAberta) return;
  const { leadId, opcoes } = edicaoAberta;
  const status = $("statusAlteracao");
  const statusId = Number($("alteracaoEtapa").value);
  const destino = opcoes.colunas.find((c) => c.id === statusId);
  const motivoPerdaId = $("alteracaoMotivo").value ? Number($("alteracaoMotivo").value) : null;
  if (statusId !== opcoes.statusAtual && destino?.perdido && !motivoPerdaId) {
    status.className = "text-[11px] text-negativo";
    status.textContent = "Escolha o motivo de perda.";
    return;
  }
  const corpo = {
    etapa: { statusId, statusAnterior: opcoes.statusAtual, motivoPerdaId },
    responsaveis: Object.fromEntries(opcoes.responsaveis.map((r) => [r.papel, { valor: $(`alteracao-${r.papel}`).value.trim(), anterior: r.atual }])),
    ...(opcoes.dataDaReuniao
      ? { dataDaReuniao: { valor: deCampoDeRecife($("alteracaoData").value, true), anterior: opcoes.dataDaReuniao.atual, link: $("alteracaoLink").value.trim() } }
      : {}),
    ...($("agendaSincronizar")
      ? {
          agenda: {
            sincronizar: $("agendaSincronizar").checked,
            online: document.querySelector('input[name="agendaModo"]:checked')?.value !== "presencial",
            duracaoMin: Number($("agendaDuracao").value),
            local: $("agendaLocal").value.trim(),
          },
        }
      : {}),
  };
  const botao = $("btnSalvarAlteracao");
  botao.disabled = true;
  status.className = "text-[11px] text-inkdim";
  status.textContent = "Salvando no Kommo.";
  try {
    const r = await fetch(`${API}/leads/${encodeURIComponent(leadId)}/edicao`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const resposta = await lerCorpoDaResposta(r);
    if (r.status === 409) {
      // Alguém mudou o lead no Kommo: recarrega a ficha com os valores atuais.
      await atualizarFichaNoLugar(leadId);
      await abrirAlteracao(leadId);
      $("statusAlteracao").className = "text-[11px] text-negativo";
      $("statusAlteracao").textContent = resposta.error;
      return;
    }
    if (!r.ok) throw new Error(resposta.error || `O servidor respondeu com o código ${r.status}.`);
    if (resposta.semMudanca) {
      status.textContent = resposta.agenda?.aviso || "Nada mudou.";
      if (resposta.agenda?.aviso) status.className = "text-[11px] text-negativo";
      return;
    }
    // A ficha continua aberta, com os dados novos e o formulário à vista.
    await atualizarFichaNoLugar(leadId);
    await abrirAlteracao(leadId);
    $("statusAlteracao").className = "text-[11px] text-positivo";
    $("statusAlteracao").textContent = `Salvo: ${resposta.mudancas.join("; ")}.`;
    if (resposta.agenda && resposta.agenda.ok === false) {
      $("statusAlteracao").insertAdjacentHTML("afterend", `<span class="block w-full text-[11px] text-negativo">${esc(resposta.agenda.aviso)}</span>`);
    }
  } catch (erro) {
    status.className = "text-[11px] text-negativo";
    status.textContent = erro.message;
  } finally {
    if (botao.isConnected) botao.disabled = false;
  }
}

$("corpoFicha").addEventListener("change", (e) => {
  if (e.target.name === "agendaModo") $("linhaLocal").classList.toggle("hidden", e.target.value !== "presencial");
  if (e.target.id === "alteracaoEtapa" && edicaoAberta) {
    const destino = edicaoAberta.opcoes.colunas.find((c) => c.id === Number(e.target.value));
    $("linhaMotivoPerda").classList.toggle("hidden", !destino?.perdido);
  }
});
$("corpoFicha").addEventListener("click", (e) => {
  const alvo = e.target.closest("button");
  if (!alvo) return;
  if (alvo.id === "btnAbrirAlteracao" && $("corpoFicha").dataset.lead) abrirAlteracao($("corpoFicha").dataset.lead);
  else if (alvo.id === "btnCancelarAlteracao") fecharAlteracao();
  else if (alvo.id === "btnSalvarAlteracao") salvarAlteracao();
});

// Mensagens do chat: horários, direção e quem enviou. O texto fica só no
// Kommo, que não o libera pela API.
let mensagensDoLead = null; // leadId da ficha cujas mensagens estão na tela

function duracaoCurta(seg) {
  if (seg === null || seg === undefined) return "—";
  if (seg < 60) return "menos de 1 min";
  if (seg < 3600) return `${Math.round(seg / 60)} min`;
  if (seg < 86400) {
    const h = Math.floor(seg / 3600);
    const m = Math.round((seg % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(seg / 86400);
  const h = Math.round((seg % 86400) / 3600);
  return h ? `${d} d ${h} h` : `${d} d`;
}

function blocoDeMensagens() {
  return `
    <section id="blocoMensagens">
      <p class="rotulo mb-2">Mensagens do chat</p>
      <div id="corpoMensagens"><p class="text-inkdim">Carregando.</p></div>
    </section>`;
}

async function carregarMensagens(leadId) {
  mensagensDoLead = leadId;
  try {
    const r = await chamarApi(`/leads/${encodeURIComponent(leadId)}/mensagens`);
    if (mensagensDoLead !== leadId || !$("corpoMensagens")) return;
    if (!r.total) {
      $("corpoMensagens").innerHTML = '<p class="text-inkfaint">Nenhuma mensagem de chat registrada para este lead.</p>';
      return;
    }
    const s = r.resumo;
    const aguardando =
      s.aguardandoSeg !== null
        ? `<p class="text-[11px] ${s.aguardandoSeg >= 2 * 3600 ? "text-negativo" : "text-goldbright"} font-semibold mb-2">O cliente aguarda resposta há ${duracaoCurta(s.aguardandoSeg)} (desde ${dataHoraBr(new Date(s.aguardandoDesde * 1000).toISOString())}).</p>`
        : "";
    const itens = [...r.mensagens].reverse().slice(0, 40);
    $("corpoMensagens").innerHTML = `
      ${aguardando}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line mb-2">
        <div class="bg-bg p-2"><p class="text-ink tabular font-semibold">${numero(s.recebidas)}</p><p class="text-[10px] text-inkfaint">recebidas do cliente</p></div>
        <div class="bg-bg p-2"><p class="text-ink tabular font-semibold">${numero(s.enviadasPelaEquipe)}</p><p class="text-[10px] text-inkfaint">enviadas pela equipe</p></div>
        <div class="bg-bg p-2"><p class="text-ink tabular font-semibold">${numero(s.enviadasPorRobo)}</p><p class="text-[10px] text-inkfaint">enviadas por robô ou automação</p></div>
        <div class="bg-bg p-2"><p class="text-ink tabular font-semibold">${duracaoCurta(s.medianaRespostaSeg)}</p><p class="text-[10px] text-inkfaint">tempo típico de resposta${s.medianaRespostaUteisSeg !== null ? ` (${duracaoCurta(s.medianaRespostaUteisSeg)} em horas úteis)` : ""}</p></div>
      </div>
      <details>
        <summary class="text-[11px] text-inkdim cursor-pointer">Linha do tempo (${numero(r.total)} mensagens${r.total > itens.length ? `, últimas ${itens.length}` : ""})</summary>
        <ol class="mt-2 space-y-1">
          ${itens
            .map(
              (m) => `<li class="flex items-baseline gap-2 text-[11px]">
                <span class="tabular text-inkfaint shrink-0 w-28">${dataHoraBr(m.em)}</span>
                <span class="${m.direcao === "recebida" ? "text-goldbright" : m.daEquipe ? "text-positivo" : "text-inkdim"}">${m.direcao === "recebida" ? "Cliente enviou" : `Enviada por ${esc(m.autor)}`}</span>
              </li>`,
            )
            .join("")}
        </ol>
      </details>
      <p class="text-[10px] text-inkfaint mt-1.5">O texto das mensagens fica só no Kommo: a API não libera o conteúdo das conversas do WhatsApp. Aqui aparecem os horários e quem enviou.</p>`;
  } catch (erro) {
    if (mensagensDoLead !== leadId || !$("corpoMensagens")) return;
    $("corpoMensagens").innerHTML = `<p class="text-negativo">Não foi possível carregar as mensagens. ${esc(erro.message)}</p>`;
  }
}

// Anexos do lead: arquivos guardados no Kommo (aba de mídia do lead). A lista
// é carregada depois da ficha, para não atrasar a abertura.
let anexosDoLead = null; // leadId da ficha cujos anexos estão na tela
const TAMANHO_MAXIMO_DO_ANEXO = 20 * 1024 * 1024;

function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function blocoDosAnexos(l) {
  return `
    <section id="blocoAnexos" class="border-l-2 border-gold/60 bg-gold/[0.04] pl-3 pr-3 py-2.5">
      <div class="flex items-baseline justify-between gap-3 mb-2">
        <p class="rotulo text-goldbright">Anexos <span id="totalAnexos" class="text-inkfaint"></span></p>
        <label class="text-[11px] text-goldbright underline decoration-dotted underline-offset-2 hover:text-ink cursor-pointer">
          Anexar arquivo<input type="file" id="campoAnexo" multiple class="sr-only">
        </label>
      </div>
      <p id="statusAnexos" class="text-[11px] text-inkdim"></p>
      <ul id="listaAnexos" class="divide-y divide-line"><li class="text-inkdim py-1">Carregando.</li></ul>
      <p class="text-[10px] text-inkfaint mt-1.5">Para anexar um print, tecle Ctrl+V com a ficha aberta; também dá para arrastar arquivos para cá. Os arquivos ficam no Kommo, na aba de mídia do lead. Até 20 MB por arquivo. Fotos e PDF abrem no navegador; os demais são baixados.</p>
    </section>`;
}

function itemDoAnexo(leadId, a) {
  const base = `${API}/leads/${encodeURIComponent(leadId)}/anexos/${encodeURIComponent(a.uuid)}`;
  const tipo = (a.extensao || a.nome.split(".").pop() || "").toUpperCase().slice(0, 5);
  const origem = a.autoria
    ? `anexado por ${esc(a.autoria.usuario || "autor não registrado")} em ${dataHoraBr(a.autoria.quando)}`
    : a.criadoEm ? `anexado no Kommo em ${dataHoraBr(a.criadoEm)}` : "anexado no Kommo";
  return `
    <li class="py-2 flex items-start justify-between gap-3" data-anexo="${esc(a.uuid)}">
      <div class="min-w-0">
        <a href="${a.abreNoNavegador ? base : `${base}?baixar=1`}" target="_blank" rel="noopener" class="text-ink hover:text-goldbright underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere]">${esc(a.nome)}</a>
        <p class="text-[10px] text-inkfaint mt-0.5">${tipo ? `${esc(tipo)} · ` : ""}${tamanhoLegivel(a.tamanho)} · ${origem}</p>
      </div>
      <div class="shrink-0 flex items-center gap-3 text-[11px]">
        ${a.abreNoNavegador ? `<a href="${base}" target="_blank" rel="noopener" class="text-inkdim hover:text-ink">Abrir</a>` : ""}
        <a href="${base}?baixar=1" class="text-inkdim hover:text-ink">Baixar</a>
        <button type="button" data-apagar-anexo="${esc(a.uuid)}" data-nome="${esc(a.nome)}" class="text-inkdim hover:text-negativo">Apagar</button>
      </div>
    </li>`;
}

async function carregarAnexos(leadId) {
  anexosDoLead = leadId;
  try {
    const r = await chamarApi(`/leads/${encodeURIComponent(leadId)}/anexos`);
    if (anexosDoLead !== leadId || !$("listaAnexos")) return;
    $("totalAnexos").textContent = r.total ? `(${numero(r.total)})` : "";
    $("listaAnexos").innerHTML = r.arquivos.length
      ? r.arquivos.map((a) => itemDoAnexo(leadId, a)).join("")
      : '<li class="text-inkfaint py-1">Nenhum arquivo anexado.</li>';
  } catch (erro) {
    if (anexosDoLead !== leadId || !$("listaAnexos")) return;
    $("listaAnexos").innerHTML = `<li class="text-negativo py-1">Não foi possível carregar os anexos. ${esc(erro.message)}</li>`;
  }
}

async function enviarAnexos(arquivos) {
  const leadId = anexosDoLead;
  if (!leadId || !arquivos.length) return;
  const status = $("statusAnexos");
  const grandes = arquivos.filter((f) => f.size > TAMANHO_MAXIMO_DO_ANEXO);
  const validos = arquivos.filter((f) => f.size > 0 && f.size <= TAMANHO_MAXIMO_DO_ANEXO);
  const erros = grandes.map((f) => `${f.name}: passa de 20 MB`);
  for (let i = 0; i < validos.length; i++) {
    const f = validos[i];
    status.className = "text-[11px] text-inkdim";
    status.textContent = `Enviando ${validos.length > 1 ? `${i + 1} de ${validos.length}: ` : ""}${f.name}.`;
    try {
      const r = await fetch(`${API}/leads/${encodeURIComponent(leadId)}/anexos`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-nome-arquivo": encodeURIComponent(f.name), "x-tipo-arquivo": f.type || "" },
        body: f,
      });
      const corpo = await lerCorpoDaResposta(r);
      if (!r.ok) throw new Error(corpo.error || `O servidor respondeu com o código ${r.status}.`);
    } catch (erro) {
      erros.push(`${f.name}: ${erro.message}`);
    }
  }
  status.className = erros.length ? "text-[11px] text-negativo" : "text-[11px] text-inkdim";
  status.textContent = erros.length ? `Não enviado. ${erros.join(" · ")}` : "";
  if (validos.length) await carregarAnexos(leadId);
}

async function apagarAnexo(botao) {
  const leadId = anexosDoLead;
  const uuid = botao.dataset.apagarAnexo;
  // Primeiro clique pede confirmação; o segundo apaga.
  if (botao.dataset.confirmar !== "1") {
    botao.dataset.confirmar = "1";
    botao.textContent = "Confirmar exclusão";
    botao.classList.add("text-negativo", "font-semibold");
    setTimeout(() => {
      if (!botao.isConnected) return;
      botao.dataset.confirmar = "";
      botao.textContent = "Apagar";
      botao.classList.remove("text-negativo", "font-semibold");
    }, 5000);
    return;
  }
  botao.disabled = true;
  botao.textContent = "Apagando.";
  try {
    const r = await chamarApi(`/leads/${encodeURIComponent(leadId)}/anexos/${encodeURIComponent(uuid)}`, { method: "DELETE" });
    $("statusAnexos").className = "text-[11px] text-inkdim";
    $("statusAnexos").textContent = r.naLixeira
      ? `"${botao.dataset.nome}" apagado. Fica na lixeira do Kommo por 30 dias.`
      : `"${botao.dataset.nome}" retirado do lead. O arquivo continua no Drive do Kommo, porque a integração não tem permissão para apagar arquivos.`;
    await carregarAnexos(leadId);
  } catch (erro) {
    botao.disabled = false;
    botao.textContent = "Apagar";
    $("statusAnexos").className = "text-[11px] text-negativo";
    $("statusAnexos").textContent = erro.message;
  }
}

// Ctrl+V com um print (ou arquivo copiado) com a ficha aberta: vira anexo.
// Texto colado continua indo para o campo onde está o cursor.
document.addEventListener("paste", (e) => {
  if ($("modalFicha").classList.contains("hidden") || !anexosDoLead || !$("blocoAnexos")) return;
  const arquivos = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
  if (!arquivos.length) return;
  e.preventDefault();
  const carimbo = new Date().toLocaleString("sv-SE", { timeZone: "America/Recife" }).replace(/[: ]/g, "-");
  const nomeados = arquivos.map((f, i) => {
    // Prints chegam como "image.png"; ganham um nome com data e hora.
    if (f.name && f.name !== "image.png") return f;
    const extensao = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    return new File([f], `print-${carimbo}${arquivos.length > 1 ? `-${i + 1}` : ""}.${extensao}`, { type: f.type });
  });
  $("blocoAnexos").scrollIntoView({ block: "nearest", behavior: "smooth" });
  enviarAnexos(nomeados);
});

// Arrastar arquivos para o bloco de anexos também anexa.
$("corpoFicha").addEventListener("dragover", (e) => {
  if (e.target.closest?.("#blocoAnexos") && e.dataTransfer?.types?.includes("Files")) {
    e.preventDefault();
    $("blocoAnexos").classList.add("ring-1", "ring-gold");
  }
});
$("corpoFicha").addEventListener("dragleave", (e) => {
  if (e.target.id === "blocoAnexos") $("blocoAnexos").classList.remove("ring-1", "ring-gold");
});
$("corpoFicha").addEventListener("drop", (e) => {
  if (!e.target.closest?.("#blocoAnexos")) return;
  e.preventDefault();
  $("blocoAnexos").classList.remove("ring-1", "ring-gold");
  enviarAnexos([...(e.dataTransfer?.files || [])]);
});

$("corpoFicha").addEventListener("change", (e) => {
  if (e.target.id === "campoAnexo") {
    enviarAnexos([...e.target.files]);
    e.target.value = "";
  }
});
$("corpoFicha").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-apagar-anexo]");
  if (botao) apagarAnexo(botao);
});

// Reuniões do lead, com o desfecho que o painel considerou e o critério usado.
function blocoDeReunioes(l) {
  if (!l.reunioes?.length) return "";
  const cor = { Realizada: "text-positivo", "Não realizada": "text-negativo", "Em aberto": "text-goldbright" };
  return `
    <section>
      <p class="rotulo mb-2">Reuniões (${numero(l.reunioes.length)})</p>
      <ol class="space-y-2.5">${l.reunioes
        .map(
          (r, i) => `<li class="border border-line p-3">
          <p class="flex items-baseline justify-between gap-3">
            <span class="text-ink">${i + 1}ª reunião${r.veioDeRemarcacao ? ' <span class="text-inkfaint">(remarcação)</span>' : ""}</span>
            <span class="font-semibold ${cor[r.resultado] || "text-inkdim"}">${esc(r.resultado)}</span>
          </p>
          <p class="text-inkdim mt-1">Agendada em ${dataHoraBr(r.agendadaEm)}${r.desfechoEm ? ` · saiu de Agendado em ${dataHoraBr(r.desfechoEm)}, para ${esc(r.destino)}` : " · o lead continua em Agendado"}</p>
          ${r.criterio ? `<p class="text-[10px] text-inkfaint mt-1">Desfecho definido por: ${esc(r.criterio)}.</p>` : ""}
          ${r.divergente ? '<p class="text-[10px] text-goldbright mt-1">O campo diz uma coisa e a coluna de destino indica outra. Prevaleceu o campo.</p>' : ""}
        </li>`,
        )
        .join("")}</ol>
      <p class="text-[10px] text-inkfaint mt-2">É assim que cada reunião deste lead entra nas taxas do painel.</p>
    </section>`;
}

// Campos que o Make grava no lead para conduzir a sequência de mensagens automáticas.
// Quando o próximo envio já passou, explica por quê sempre que dá para saber:
// a sequência vale para a etapa registrada; se o lead saiu dela, os envios
// param, mas os campos continuam com os últimos valores gravados.
function situacaoDaCadencia(campos, etapaAtual) {
  const envio = campos.find((c) => /pr[oó]ximo envio/i.test(c.nome))?.valor || "";
  const m = envio.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return "";
  const quando = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 23), Number(m[5] || 59));
  if (quando > new Date()) return "";
  const etapaDaCadencia = (campos.find((c) => /etapa/i.test(c.nome))?.valor || "").split(",")[0].trim();
  if (etapaDaCadencia && etapaAtual && etapaDaCadencia.toLowerCase() !== String(etapaAtual).toLowerCase()) {
    return `A data do próximo envio já passou porque o lead saiu de ${esc(etapaDaCadencia)} (hoje está em ${esc(etapaAtual)}). A sequência vale só para a etapa em que começou, então os envios pararam; os campos ficam com os últimos valores gravados.`;
  }
  return "A data do próximo envio já passou e o lead continua na mesma etapa. Pode ser o fim da sequência ou um envio que não foi feito; o histórico do Make mostra qual dos dois.";
}

function blocoDaCadencia(campos, etapaAtual) {
  if (!campos.length) return "";
  const situacao = situacaoDaCadencia(campos, etapaAtual);
  const rotulos = [
    [/etapa/i, "Etapa em que a cadência está"],
    [/passo/i, "Passo da sequência"],
    [/pr[oó]ximo envio/i, "Próximo envio automático"],
  ];
  const nomeLegivel = (nome) => rotulos.find(([padrao]) => padrao.test(nome))?.[1] || nome;
  return (
    blocoDaFicha("Cadência de mensagens automáticas", campos.map((c) => [nomeLegivel(c.nome), esc(c.valor)])).replace(
      "</section>",
      `${situacao ? `<p class="text-[11px] text-inkdim mt-2">${situacao}</p>` : ""}<p class="text-[10px] text-inkfaint mt-2">Preenchido pelo Make para controlar a sequência de mensagens automáticas. O passo indica em que ponto da sequência o lead está. A equipe não precisa preencher nem alterar esses campos.</p></section>`,
    )
  );
}

function renderizarFicha(l) {
  const loc = l.localizacao;
  const localizacao = !loc.reconhecido
    ? "Não identificada (telefone fora do padrão)"
    : loc.estado
      ? `${esc(loc.estado)}${loc.regiao ? ` · ${esc(loc.regiao)}` : ""} <span class="text-inkfaint">(DDD ${esc(loc.ddd)})</span>`
      : `DDD ${esc(loc.ddd)} não reconhecido`;
  const naoInformado = '<span class="text-inkfaint">não informado</span>';
  const texto = (v) => (v ? esc(v) : "");

  $("tituloFicha").textContent = l.nome;
  $("subtituloFicha").textContent = `Lead ${l.id} · ${l.campanha} · ${l.etapa}`;

  // Campos do Kommo já exibidos nos blocos acima não se repetem na lista geral.
  const jaExibidos = new Set([l.origem.campanhaMeta, l.origem.conjunto, l.origem.anuncio, l.responsaveis.sdr, l.responsaveis.closer, l.responsaveis.farmer, l.situacaoDaReuniao, l.substatusFarmer].filter(Boolean));
  const restantes = l.camposDoLead.filter((c) => !jaExibidos.has(c.valor));
  // Campos com dados internos das automações (texto em formato JSON) não são
  // para leitura da equipe: ficam recolhidos no fim da ficha.
  const ehRegistroInterno = (valor) => {
    if (!/^\s*[{[]/.test(valor)) return false;
    try {
      JSON.parse(valor);
      return true;
    } catch {
      return false;
    }
  };
  const registrosInternos = restantes.filter((c) => ehRegistroInterno(c.valor));
  const outrosCampos = restantes.filter((c) => !c.tecnico && !ehRegistroInterno(c.valor));
  const camposTecnicos = restantes.filter((c) => c.tecnico && !ehRegistroInterno(c.valor));
  const semOrigem = l.origemSemRastreio ? esc(l.origemSemRastreio) : naoInformado;

  $("corpoFicha").dataset.lead = l.id;
  $("corpoFicha").innerHTML =
    '<p id="statusFicha" class="text-[11px] text-positivo empty:hidden"></p>' +
    blocoDeAlteracao() +
    blocoDaFicha("Identificação", [
      ["Nome", esc(l.nome) + marcaPre(l)],
      ["Telefone", `<span class="font-mono">${esc(telefoneFormatado(l.telefone))}</span>`],
      ["Estado provável", `${localizacao}<br><span class="text-[10px] text-inkfaint">Estimativa pelo DDD: indica onde a linha foi habilitada, não necessariamente onde a pessoa mora.</span>`],
      ["Título no Kommo", texto(l.titulo)],
      ...l.camposDoContato.filter((c) => c.valor.replace(/\D/g, "") !== l.telefone).map((c) => [c.nome, esc(c.valor)]),
    ]) +
    // Descrição e anexos logo depois da identificação, com um destaque leve,
    // para o closer achar rápido antes da reunião.
    blocoDaDescricao(l) +
    blocoDosAnexos(l) +
    blocoDaFicha("Situação no funil", [
      ["Campanha", esc(l.campanha)],
      ["Etapa atual", `${esc(l.etapa)}${l.diasNaEtapa !== null ? ` <span class="text-inkfaint">${l.diasNaEtapa === 0 ? "desde hoje" : `há ${numero(l.diasNaEtapa)} dia(s)`}</span>` : ""}`],
      ["Criado em", dataHoraBr(l.criadoEm)],
      ["Última atualização", dataHoraBr(l.atualizadoEm)],
      [
        "Reunião marcada",
        l.reuniaoDoPainel?.inicio || l.reuniaoDoPainel?.link
          ? `${l.reuniaoDoPainel.inicio ? esc(dataHoraBr(l.reuniaoDoPainel.inicio)) : "sem data"}${l.reuniaoDoPainel.link ? ` · <a href="${esc(l.reuniaoDoPainel.link)}" target="_blank" rel="noopener noreferrer" class="text-goldbright underline decoration-dotted underline-offset-2">entrar na reunião</a>` : ""}<br><span class="text-[10px] text-inkfaint">Registrada no painel${l.reuniaoDoPainel.usuario ? ` por ${esc(l.reuniaoDoPainel.usuario)}` : ""}${l.reuniaoDoPainel.quando ? ` em ${esc(dataHoraBr(l.reuniaoDoPainel.quando))}` : ""}.</span>`
          : "",
      ],
      ["Situação da reunião", texto(l.situacaoDaReuniao)],
      ["Substatus Farmer", texto(l.substatusFarmer)],
      ["Motivo de perda", texto(l.motivoPerda)],
      ["Etiquetas", l.etiquetas.length ? l.etiquetas.map((t) => `<span class="inline-block border border-line px-1.5 py-0.5 mr-1 mb-1 text-[10px] text-inkdim">${esc(t)}</span>`).join("") : ""],
    ]) +
    blocoDeReunioes(l) +
    blocoDeMensagens() +
    blocoDaFicha("Origem de marketing", [
      ["Campanha Meta", texto(l.origem.campanhaMeta) || semOrigem],
      ["Conjunto de anúncios", texto(l.origem.conjunto) || semOrigem],
      ["Anúncio", texto(l.origem.anuncio) || semOrigem],
    ]) +
    blocoDaFicha("Responsáveis", [
      ["SDR", texto(l.responsaveis.sdr)],
      ["Closer", texto(l.responsaveis.closer)],
      ["Farmer", texto(l.responsaveis.farmer)],
    ]) +
    blocoDaFicha("Demais campos preenchidos no Kommo", outrosCampos.map((c) => [c.nome, esc(c.valor)])) +
    blocoDaCadencia(camposTecnicos, l.etapa) +
    (registrosInternos.length
      ? `<details class="border border-line px-3 py-2"><summary class="cursor-pointer text-inkdim">Registros internos da automação (${numero(registrosInternos.length)})</summary>
          <p class="text-[10px] text-inkfaint mt-2">Gravados pelo Make para controlar as mensagens automáticas. A equipe não precisa ler nem alterar.</p>
          ${registrosInternos.map((c) => `<p class="text-inkdim mt-2">${esc(c.nome)}</p><pre class="mt-1 text-[10px] text-inkfaint font-mono whitespace-pre-wrap [overflow-wrap:anywhere] bg-surface2 p-2">${esc(c.valor)}</pre>`).join("")}
        </details>`
      : "") +
    `<section>
      <p class="rotulo mb-2">Histórico de movimentações (${numero(l.historico.length)})</p>
      ${
        l.historico.length
          ? `<ol class="border-l border-line pl-4 space-y-2">${l.historico
              .map(
                (h) => `<li class="${h.excluido ? "opacity-50" : ""}">
            <span class="text-inkdim tabular">${dataHoraBr(h.data)}</span>
            <span class="text-ink block">${esc(h.de)} <span class="text-inkfaint">para</span> ${esc(h.para)}</span>
            ${h.pulouAgendado ? '<span class="text-[10px] text-goldbright block">Pulou a etapa Agendado: a reunião não ficou registrada no funil e o lead não conta como reunião marcada.</span>' : ""}
            ${h.corrigido ? '<span class="text-[10px] text-goldbright block">Movimentação corrigida manualmente</span>' : ""}
            ${h.excluido ? '<span class="text-[10px] text-inkfaint block">Excluída do cálculo</span>' : ""}
            ${h.marcacao ? `<span class="text-[10px] text-inkfaint block">${esc(autoria(h.marcacao))}</span>` : ""}
          </li>`,
              )
              .join("")}</ol>`
          : '<p class="text-inkdim">Nenhuma mudança de etapa registrada. O lead permanece na etapa em que foi criado.</p>'
      }
    </section>` +
    (l.linkNoKommo ? `<p><a href="${esc(l.linkNoKommo)}" target="_blank" rel="noopener" class="underline decoration-dotted underline-offset-2 text-goldbright hover:text-ink">Abrir este lead no Kommo</a></p>` : "");
}

// Recarrega a ficha aberta sem fechá-la nem voltar ao topo: usada depois de
// salvar uma alteração, para mostrar os dados atualizados do Kommo.
async function atualizarFichaNoLugar(leadId) {
  const corpo = $("corpoFicha");
  const rolagem = corpo.scrollTop;
  const dados = await chamarApi(`/leads/${encodeURIComponent(leadId)}`);
  descricaoAberta = null;
  anexosDoLead = null;
  edicaoAberta = null;
  renderizarFicha(dados);
  corpo.scrollTop = rolagem;
  carregarAnexos(leadId);
  carregarMensagens(leadId);
}

// Endereço direto da ficha: o painel abre já com a ficha deste lead.
// Com "#anexos", a ficha rola até os anexos.
const linkDaFicha = (leadId, parte = "") => `${location.origin}/?lead=${encodeURIComponent(leadId)}${parte ? `#${parte}` : ""}`;

async function abrirFichaDoLead(leadId) {
  $("btnCopiarLinkFicha").classList.remove("hidden");
  $("btnCopiarLinkFicha").dataset.lead = leadId;
  $("btnCopiarLinkFicha").textContent = "Copiar link";
  $("tituloFicha").textContent = "Ficha do lead";
  $("subtituloFicha").textContent = `Lead ${leadId}`;
  descricaoAberta = null;
  anexosDoLead = null;
  edicaoAberta = null;
  $("corpoFicha").innerHTML = '<p class="text-inkdim">Carregando.</p>';
  abrirDialogo("modalFicha");
  try {
    renderizarFicha(await chamarApi(`/leads/${encodeURIComponent(leadId)}`));
    carregarAnexos(leadId);
    carregarMensagens(leadId);
  } catch (erro) {
    $("corpoFicha").innerHTML = `<p class="text-negativo">Não foi possível carregar a ficha. ${esc(erro.message)}</p>`;
  }
}

// Devolve true quando havia uma ficha aberta, para a tecla Esc fechar um nível por vez.
function fecharFichaDoLead() {
  if ($("modalFicha").classList.contains("hidden")) return false;
  fecharDialogo("modalFicha");
  // Ao fechar uma ficha aberta pelo link, o endereço volta ao do painel.
  if (new URLSearchParams(location.search).has("lead")) history.replaceState(null, "", location.pathname);
  return true;
}

$("btnFecharFicha").addEventListener("click", fecharFichaDoLead);
$("modalFicha").addEventListener("click", (e) => e.target === $("modalFicha") && fecharFichaDoLead());

$("btnCopiarLinkFicha").addEventListener("click", async () => {
  const botao = $("btnCopiarLinkFicha");
  const link = linkDaFicha(botao.dataset.lead);
  try {
    await navigator.clipboard.writeText(link);
    botao.textContent = "Link copiado";
  } catch {
    // Sem acesso à área de transferência: mostra o link para copiar à mão.
    botao.textContent = link;
  }
  setTimeout(() => botao.isConnected && (botao.textContent = "Copiar link"), 2500);
});

// Painel aberto pelo link de uma ficha (?lead=ID): abre a ficha direto.
(async function abrirFichaDoEndereco() {
  const leadId = new URLSearchParams(location.search).get("lead");
  if (!/^\d{1,15}$/.test(leadId || "")) return;
  await abrirFichaDoLead(leadId);
  if (location.hash === "#anexos") {
    const ir = () => $("blocoAnexos")?.scrollIntoView({ block: "start" });
    ir();
    setTimeout(ir, 1200);
  }
})();

// Prévia do Markdown enquanto a descrição é editada.
$("corpoFicha").addEventListener("input", (e) => {
  if (e.target.id === "campoDescricao") $("previaDescricao").innerHTML = markdownSeguro(e.target.value);
});
