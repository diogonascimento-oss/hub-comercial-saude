// Edição das metas mensais. As metas ficam no servidor (/api/metas), por mês,
// e valem para o painel, o mural e os relatórios.

let taxasDeReferencia = null;

function mesAtualNoEscritorio() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife" }).format(new Date()).slice(0, 7);
}

const nomeDoMes = (mes) =>
  new Date(`${mes}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

// Metas de reuniões que levam à meta de contratos, pelas taxas de referência.
function sugestaoDeReunioes(contratos) {
  if (!taxasDeReferencia || !(contratos >= 0)) return null;
  const realizadas = Math.round(contratos / (taxasDeReferencia.fechamentoSobreRealizadas / 100));
  const marcadas = Math.round(realizadas / (taxasDeReferencia.comparecimento / 100));
  return { realizadas, marcadas };
}

function mostrarSugestao() {
  const s = sugestaoDeReunioes(Number($("metaFechados").value));
  $("sugestaoRealizadas").textContent = s ? numero(s.realizadas) : "—";
  $("sugestaoMarcadas").textContent = s ? numero(s.marcadas) : "—";
}

function mostrarErroDasMetas(mensagem) {
  $("metaErro").textContent = mensagem;
  $("metaErro").classList.toggle("hidden", !mensagem);
}

async function carregarMetasDoMes(mes) {
  mostrarErroDasMetas("");
  $("metaOrigem").textContent = "Carregando.";
  try {
    const r = await chamarApi(`/metas?mes=${mes}`);
    taxasDeReferencia = r.taxasDeReferencia;
    const valor = (chave) => r.itens.find((i) => i.chave === chave)?.meta ?? "";
    $("metaFechados").value = valor("fechados");
    $("metaRealizadas").value = valor("reunioesRealizadas");
    $("metaMarcadas").value = valor("reunioesMarcadas");
    $("metaTaxas").textContent = `${String(r.taxasDeReferencia.fechamentoSobreRealizadas).replace(".", ",")}% das reuniões realizadas viram contrato e ${String(r.taxasDeReferencia.comparecimento).replace(".", ",")}% das marcadas acontecem`;
    $("metaOrigem").textContent =
      r.origem === "definida"
        ? `Metas definidas para ${nomeDoMes(mes)}.`
        : r.origem.startsWith("herdada")
          ? `${nomeDoMes(mes).replace(/^./, (c) => c.toUpperCase())} ainda não tem metas próprias; estão valendo as de ${nomeDoMes(r.origem.slice(-7))}. Ao salvar, este mês passa a ter as suas.`
          : "Nenhuma meta foi definida pelo painel ainda; estão valendo as metas padrão.";
    mostrarSugestao();
  } catch (erro) {
    $("metaOrigem").textContent = "";
    mostrarErroDasMetas(erro.message);
  }
}

function abrirEdicaoDeMetas() {
  $("metaMes").value = mesAtualNoEscritorio();
  abrirDialogo("modalMetas");
  carregarMetasDoMes($("metaMes").value);
}

async function salvarMetas(e) {
  e.preventDefault();
  const corpo = {
    mes: $("metaMes").value,
    fechados: Number($("metaFechados").value),
    reunioesRealizadas: Number($("metaRealizadas").value),
    reunioesMarcadas: Number($("metaMarcadas").value),
  };
  const botao = $("btnSalvarMetas");
  botao.disabled = true;
  try {
    await chamarApi("/metas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    fecharDialogo("modalMetas");
    atualizar();
  } catch (erro) {
    mostrarErroDasMetas(erro.message);
  } finally {
    botao.disabled = false;
  }
}

$("btnEditarMetas").addEventListener("click", abrirEdicaoDeMetas);
$("btnFecharMetas").addEventListener("click", () => fecharDialogo("modalMetas"));
$("btnCancelarMetas").addEventListener("click", () => fecharDialogo("modalMetas"));
$("modalMetas").addEventListener("click", (e) => e.target === $("modalMetas") && fecharDialogo("modalMetas"));
$("metaMes").addEventListener("change", () => $("metaMes").value && carregarMetasDoMes($("metaMes").value));
$("metaFechados").addEventListener("input", mostrarSugestao);
$("btnUsarSugestao").addEventListener("click", () => {
  const s = sugestaoDeReunioes(Number($("metaFechados").value));
  if (!s) return;
  $("metaRealizadas").value = s.realizadas;
  $("metaMarcadas").value = s.marcadas;
});
$("formMetas").addEventListener("submit", salvarMetas);
