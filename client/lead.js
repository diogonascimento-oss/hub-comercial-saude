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
          <span class="text-ink truncate">${esc(l.nome)}</span>
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
    <section id="blocoDescricao">
      <div class="flex items-baseline justify-between gap-3 mb-2">
        <p class="rotulo">${esc(l.descricao.nome)}</p>
        <button type="button" id="btnEditarDescricao" class="text-[11px] text-goldbright underline decoration-dotted underline-offset-2 hover:text-ink">Editar</button>
      </div>
      <div id="leituraDescricao">
        <p id="textoDescricao" class="text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">${l.descricao.texto ? esc(l.descricao.texto) : '<span class="text-inkfaint">Sem descrição.</span>'}</p>
      </div>
      <div id="edicaoDescricao" class="hidden">
        <textarea id="campoDescricao" rows="5" maxlength="4000" class="w-full bg-surface2 border border-line px-3 py-2 text-ink text-xs leading-relaxed"></textarea>
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
  $("textoDescricao").innerHTML = texto ? esc(texto) : '<span class="text-inkfaint">Sem descrição.</span>';
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
    const corpo = (r.headers.get("Content-Type") || "").includes("application/json") ? await r.json() : { error: "A sessão expirou. Recarregue a página para entrar novamente." };
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
        <button type="button" id="btnAbrirAlteracao" class="text-[11px] text-goldbright underline decoration-dotted underline-offset-2 hover:text-ink">Mudar etapa ou responsáveis</button>
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
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">${o.responsaveis.map(campoDoResponsavel).join("")}</div>
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" id="btnSalvarAlteracao" class="bg-gold hover:bg-goldbright text-bg text-[11px] font-semibold px-3 py-1.5">Salvar no Kommo</button>
      <button type="button" id="btnCancelarAlteracao" class="border border-line hover:border-inkdim text-inkdim text-[11px] px-3 py-1.5">Cancelar</button>
      <span id="statusAlteracao" class="text-[11px] text-inkdim"></span>
    </div>
    <p class="text-[10px] text-inkfaint">Mudar a etapa aqui é o mesmo que mover o lead no Kommo: as automações da coluna rodam normalmente. A alteração fica registrada numa nota do lead, com o seu e-mail.</p>`;
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
  };
  const botao = $("btnSalvarAlteracao");
  botao.disabled = true;
  status.className = "text-[11px] text-inkdim";
  status.textContent = "Salvando no Kommo.";
  try {
    const r = await fetch(`${API}/leads/${encodeURIComponent(leadId)}/edicao`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const resposta = (r.headers.get("Content-Type") || "").includes("application/json") ? await r.json() : { error: "A sessão expirou. Recarregue a página para entrar novamente." };
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
      status.textContent = "Nada mudou.";
      return;
    }
    // A ficha continua aberta, com os dados novos e o formulário à vista.
    await atualizarFichaNoLugar(leadId);
    await abrirAlteracao(leadId);
    $("statusAlteracao").className = "text-[11px] text-positivo";
    $("statusAlteracao").textContent = `Salvo no Kommo: ${resposta.mudancas.join("; ")}.`;
  } catch (erro) {
    status.className = "text-[11px] text-negativo";
    status.textContent = erro.message;
  } finally {
    if (botao.isConnected) botao.disabled = false;
  }
}

$("corpoFicha").addEventListener("change", (e) => {
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
    <section id="blocoAnexos">
      <div class="flex items-baseline justify-between gap-3 mb-2">
        <p class="rotulo">Anexos <span id="totalAnexos" class="text-inkfaint"></span></p>
        <label class="text-[11px] text-goldbright underline decoration-dotted underline-offset-2 hover:text-ink cursor-pointer">
          Anexar arquivo<input type="file" id="campoAnexo" multiple class="sr-only">
        </label>
      </div>
      <p id="statusAnexos" class="text-[11px] text-inkdim"></p>
      <ul id="listaAnexos" class="divide-y divide-line"><li class="text-inkdim py-1">Carregando.</li></ul>
      <p class="text-[10px] text-inkfaint mt-1.5">Os arquivos ficam no Kommo, na aba de mídia do lead. Até 20 MB por arquivo. Fotos e PDF abrem no navegador; os demais são baixados.</p>
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
      const corpo = (r.headers.get("Content-Type") || "").includes("application/json") ? await r.json() : { error: "A sessão expirou. Recarregue a página para entrar novamente." };
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
function blocoDaCadencia(campos) {
  if (!campos.length) return "";
  const rotulos = [
    [/etapa/i, "Etapa em que a cadência está"],
    [/passo/i, "Passo da sequência"],
    [/pr[oó]ximo envio/i, "Próximo envio automático"],
  ];
  const nomeLegivel = (nome) => rotulos.find(([padrao]) => padrao.test(nome))?.[1] || nome;
  return (
    blocoDaFicha("Cadência de mensagens automáticas", campos.map((c) => [nomeLegivel(c.nome), esc(c.valor)])).replace(
      "</section>",
      '<p class="text-[10px] text-inkfaint mt-2">Preenchido pelo Make para controlar a sequência de mensagens automáticas. O passo indica em que ponto da sequência o lead está. A equipe não precisa preencher nem alterar esses campos.</p></section>',
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
      ["Nome", esc(l.nome)],
      ["Telefone", `<span class="font-mono">${esc(telefoneFormatado(l.telefone))}</span>`],
      ["Estado provável", `${localizacao}<br><span class="text-[10px] text-inkfaint">Estimativa pelo DDD: indica onde a linha foi habilitada, não necessariamente onde a pessoa mora.</span>`],
      ["Título no Kommo", texto(l.titulo)],
      ...l.camposDoContato.filter((c) => c.valor.replace(/\D/g, "") !== l.telefone).map((c) => [c.nome, esc(c.valor)]),
    ]) +
    blocoDaFicha("Situação no funil", [
      ["Campanha", esc(l.campanha)],
      ["Etapa atual", `${esc(l.etapa)}${l.diasNaEtapa !== null ? ` <span class="text-inkfaint">${l.diasNaEtapa === 0 ? "desde hoje" : `há ${numero(l.diasNaEtapa)} dia(s)`}</span>` : ""}`],
      ["Criado em", dataHoraBr(l.criadoEm)],
      ["Última atualização", dataHoraBr(l.atualizadoEm)],
      ["Situação da reunião", texto(l.situacaoDaReuniao)],
      ["Substatus Farmer", texto(l.substatusFarmer)],
      ["Motivo de perda", texto(l.motivoPerda)],
      ["Etiquetas", l.etiquetas.length ? l.etiquetas.map((t) => `<span class="inline-block border border-line px-1.5 py-0.5 mr-1 mb-1 text-[10px] text-inkdim">${esc(t)}</span>`).join("") : ""],
    ]) +
    blocoDeReunioes(l) +
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
    blocoDaDescricao(l) +
    blocoDosAnexos(l) +
    blocoDaFicha("Demais campos preenchidos no Kommo", outrosCampos.map((c) => [c.nome, esc(c.valor)])) +
    blocoDaCadencia(camposTecnicos) +
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
}

async function abrirFichaDoLead(leadId) {
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
  } catch (erro) {
    $("corpoFicha").innerHTML = `<p class="text-negativo">Não foi possível carregar a ficha. ${esc(erro.message)}</p>`;
  }
}

// Devolve true quando havia uma ficha aberta, para a tecla Esc fechar um nível por vez.
function fecharFichaDoLead() {
  if ($("modalFicha").classList.contains("hidden")) return false;
  fecharDialogo("modalFicha");
  return true;
}

$("btnFecharFicha").addEventListener("click", fecharFichaDoLead);
$("modalFicha").addEventListener("click", (e) => e.target === $("modalFicha") && fecharFichaDoLead());
