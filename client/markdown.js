// Markdown simples e seguro para a descrição do lead: títulos (#, ##, ###),
// **negrito**, *itálico*, ~~riscado~~, `código`, listas (- e 1.), citação (>),
// linha (---), tabelas (| a | b |) e links http(s). O texto é escapado antes de qualquer marcação,
// então nenhum HTML digitado é executado.

function markdownSeguro(texto) {
  const escapar = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const embutido = (linha) => {
    let t = escapar(linha);
    const codigos = [];
    t = t.replace(/`([^`]+)`/g, (_, c) => `\u0000${codigos.push(c) - 1}\u0000`);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-goldbright underline decoration-dotted underline-offset-2">$1</a>');
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="text-goldbright underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere]">$2</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-ink">$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong class="font-semibold text-ink">$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    t = t.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="bg-surface2 px-1 font-mono text-[11px]">${codigos[Number(i)]}</code>`);
    return t;
  };

  const linhas = String(texto || "").replace(/\r\n/g, "\n").split("\n");
  const saida = [];
  let lista = null; // "ul" ou "ol"
  let paragrafo = [];
  const fecharParagrafo = () => {
    if (paragrafo.length) saida.push(`<p class="mb-1.5">${paragrafo.join("<br>")}</p>`);
    paragrafo = [];
  };
  const fecharLista = () => {
    if (lista) saida.push(lista === "ul" ? "</ul>" : "</ol>");
    lista = null;
  };

  // Tabela: linhas que começam com "|", a segunda sendo o separador |---|---:|.
  const celulas = (linha) => linha.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  const ehSeparador = (linha) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linha);
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (/^\s*\|/.test(linha) && i + 1 < linhas.length && ehSeparador(linhas[i + 1])) {
      fecharParagrafo();
      fecharLista();
      const cabecalho = celulas(linha);
      const alinhamentos = celulas(linhas[i + 1]).map((c) => (/:$/.test(c) ? (/^:/.test(c) ? "center" : "right") : "left"));
      const corpo = [];
      i += 2;
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
      i--;
      const alinhar = (j) => `text-${alinhamentos[j] || "left"}`;
      saida.push(
        `<div class="overflow-x-auto mb-2"><table class="text-xs border border-line"><thead><tr class="bg-surface2">${cabecalho
          .map((c, j) => `<th class="px-2 py-1 font-semibold text-ink ${alinhar(j)}">${embutido(c)}</th>`)
          .join("")}</tr></thead><tbody>${corpo
          .map((l) => `<tr class="border-t border-line">${cabecalho.map((_, j) => `<td class="px-2 py-1 ${alinhar(j)}">${embutido(l[j] ?? "")}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const titulo = /^(#{1,3})\s+(.+)$/.exec(linha);
    const item = /^\s*[-*+]\s+(.+)$/.exec(linha);
    const numerado = /^\s*\d+[.)]\s+(.+)$/.exec(linha);
    const citacao = /^>\s?(.*)$/.exec(linha);
    if (!linha.trim()) {
      fecharParagrafo();
      fecharLista();
    } else if (titulo) {
      fecharParagrafo();
      fecharLista();
      const tamanho = ["text-sm", "text-[13px]", "text-xs"][titulo[1].length - 1];
      saida.push(`<p class="${tamanho} font-semibold text-ink mt-2 mb-1">${embutido(titulo[2])}</p>`);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      fecharParagrafo();
      fecharLista();
      saida.push('<hr class="border-line my-2">');
    } else if (item || numerado) {
      fecharParagrafo();
      const tipo = item ? "ul" : "ol";
      if (lista !== tipo) {
        fecharLista();
        saida.push(tipo === "ul" ? '<ul class="list-disc pl-5 mb-1.5 space-y-0.5">' : '<ol class="list-decimal pl-5 mb-1.5 space-y-0.5">');
        lista = tipo;
      }
      saida.push(`<li>${embutido((item || numerado)[1])}</li>`);
    } else if (citacao) {
      fecharParagrafo();
      fecharLista();
      saida.push(`<blockquote class="border-l-2 border-line pl-2 text-inkdim mb-1.5">${embutido(citacao[1])}</blockquote>`);
    } else {
      fecharLista();
      paragrafo.push(embutido(linha));
    }
  }
  fecharParagrafo();
  fecharLista();
  return saida.join("");
}
