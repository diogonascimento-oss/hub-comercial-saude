// Testes do chamarApi do painel (client/app.js): como ele se comporta enquanto o
// servidor gratuito do Render acorda. O trecho é extraído do arquivo do cliente
// e executado com uma rede, um relógio e uma tela de mentira.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const fonte = fs.readFileSync(new URL("../../client/app.js", import.meta.url), "utf8");
const trecho = fonte.slice(fonte.indexOf("const MENSAGEM_SESSAO_EXPIRADA"), fonte.indexOf("// --- Datas iniciais"));
assert.ok(trecho.includes("async function chamarApi"), "trecho do chamarApi não encontrado");

// respostas: lista de funções/valores devolvidos a cada tentativa; a última se repete.
function montar(respostas) {
  const estado = { agora: 0, chamadas: 0, avisos: [], esperas: [] };
  const contexto = {
    API: "/api",
    Date: { now: () => estado.agora },
    // O tempo "passa" sem esperar de verdade.
    setTimeout: (fn, ms) => {
      estado.agora += ms;
      estado.esperas.push(ms);
      fn();
    },
    mostrarErro: (m) => estado.avisos.push(m),
    fetch: async () => {
      const r = respostas[Math.min(estado.chamadas++, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  vm.createContext(contexto);
  vm.runInContext(`${trecho}\nthis.chamarApi = chamarApi;`, contexto);
  return { chamarApi: contexto.chamarApi, estado };
}

const ok = () => Response.json({ resultado: 1 });
const html = (status) => new Response("<html>aguarde</html>", { status, headers: { "Content-Type": "text/html" } });
const json = (status, corpo) => Response.json(corpo, { status });
const semRede = () => new TypeError("Failed to fetch");

test("conexão que cai enquanto o servidor acorda: tenta de novo, avisa na tela e limpa o aviso", async () => {
  const { chamarApi, estado } = montar([semRede(), semRede(), semRede(), ok()]);
  assert.deepEqual(await chamarApi("/metrics"), { resultado: 1 });
  assert.equal(estado.chamadas, 4);
  assert.ok(/acordando/.test(estado.avisos[0]));
  assert.equal(estado.avisos.at(-1), ""); // aviso removido ao carregar
});

test("página de espera do Render (sem JSON) e aviso \"acordando\" do Worker também são repetidos", async () => {
  const { chamarApi, estado } = montar([html(502), json(503, { error: "x", acordando: true }), html(200), ok()]);
  assert.deepEqual(await chamarApi("/metrics"), { resultado: 1 });
  assert.equal(estado.chamadas, 4);
});

test("erro de verdade em JSON aparece na hora, sem repetir", async () => {
  const { chamarApi, estado } = montar([json(502, { error: "O Kommo recusou o token de acesso." }), ok()]);
  await assert.rejects(() => chamarApi("/metrics"), /O Kommo recusou o token/);
  assert.equal(estado.chamadas, 1);
  assert.deepEqual(estado.avisos, []);
});

test("sessão expirada aparece na hora, sem repetir", async () => {
  const { chamarApi, estado } = montar([html(401), ok()]);
  await assert.rejects(() => chamarApi("/metrics"), /sessão expirou/);
  assert.equal(estado.chamadas, 1);
});

test("chamadas que alteram dados nunca são repetidas", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const { chamarApi, estado } = montar([semRede(), ok()]);
    await assert.rejects(() => chamarApi("/leads/1", { method }), /Não foi possível contatar/);
    assert.equal(estado.chamadas, 1, method);
  }
});

test("servidor que não acorda: desiste depois de 4 minutos, com a última mensagem, sem deixar aviso", async () => {
  const { chamarApi, estado } = montar([html(503)]);
  await assert.rejects(() => chamarApi("/metrics"), /acordando/);
  assert.ok(estado.agora >= 4 * 60 * 1000, `esperou ${estado.agora} ms`);
  assert.ok(estado.chamadas > 10);
  assert.equal(estado.avisos.at(-1), "");
});

test("a espera começa curta e passa a 15 segundos", async () => {
  const { chamarApi, estado } = montar([semRede(), semRede(), semRede(), semRede(), semRede(), semRede(), semRede(), ok()]);
  await chamarApi("/metrics");
  assert.deepEqual(estado.esperas, [3000, 5000, 8000, 10000, 15000, 15000, 15000]);
});
