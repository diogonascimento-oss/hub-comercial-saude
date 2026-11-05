// Testes da pré-qualificação pelo questionário.
import test from "node:test";
import assert from "node:assert/strict";
import {
  numerosDoTexto,
  intervaloDoValor,
  compararComLimite,
  respostaSimNao,
  respostaEscola,
  avaliarCriterio,
  resolverCampos,
  analisarPreQualificacao,
} from "../prequalificacao.js";
import { PRE_QUALIFICACAO } from "../config.js";

const posicao = (texto, limite) => compararComLimite(intervaloDoValor(texto), limite);

test("números em valores digitados e faixas", () => {
  assert.deepEqual(numerosDoTexto("R$ 900 a R$ 1.500"), [900, 1500]);
  assert.deepEqual(numerosDoTexto("R$ 1.500,00"), [1500]);
  assert.deepEqual(numerosDoTexto("850,5"), [850.5]);
  assert.deepEqual(numerosDoTexto("2 mil"), [2000]);
  assert.deepEqual(numerosDoTexto("sem valor"), []);
});

test("IR: acima de R$ 950, com a faixa de R$ 900 a R$ 1.500 pendente", () => {
  assert.equal(posicao("R$ 1.500", 950), "acima");
  assert.equal(posicao("980", 950), "acima");
  assert.equal(posicao("950", 950), "abaixo"); // \"acima de\" não inclui o limite
  assert.equal(posicao("850,00", 950), "abaixo");
  assert.equal(posicao("Até R$ 900", 950), "abaixo");
  assert.equal(posicao("R$ 900 a R$ 1.500", 950), "incerto");
  assert.equal(posicao("Acima de R$ 1.500", 950), "acima");
  assert.equal(posicao("R$ 1.500 a R$ 2.500", 950), "acima");
});

test("Reajuste: acima de R$ 2.000", () => {
  assert.equal(posicao("R$ 2.300,00", 2000), "acima");
  assert.equal(posicao("2000", 2000), "abaixo");
  assert.equal(posicao("Acima de R$ 2.000", 2000), "acima");
  assert.equal(posicao("R$ 1.000 a R$ 2.000", 2000), "abaixo");
  assert.equal(posicao("R$ 1.500 a R$ 2.500", 2000), "incerto");
  assert.equal(compararComLimite(intervaloDoValor("não sei"), 2000), null);
});

test("respostas de sim/não e de escola", () => {
  assert.equal(respostaSimNao("Sim"), "sim");
  assert.equal(respostaSimNao("Sim, recebi"), "sim");
  assert.equal(respostaSimNao("Não"), "nao");
  assert.equal(respostaSimNao("talvez"), null);
  assert.equal(respostaEscola("Particular"), "sim");
  assert.equal(respostaEscola("Pública"), "nao");
  assert.equal(respostaEscola("Filantrópica"), "nao");
  assert.equal(respostaEscola("Sim"), "sim");
  assert.equal(respostaEscola("Não é particular"), "nao");
});

const planoRea = PRE_QUALIFICACAO["REA-Q"].criterios[0];
test("tipo de plano: aceitos, recusados e fora da lista", () => {
  assert.equal(avaliarCriterio(planoRea, "Empresarial/CNPJ").status, "atende");
  assert.equal(avaliarCriterio(planoRea, "Familiar").status, "atende");
  assert.equal(avaliarCriterio(planoRea, "Individual").status, "falha");
  assert.equal(avaliarCriterio(planoRea, "Individual ou familiar").status, "atende");
  assert.equal(avaliarCriterio(planoRea, "Coletivo por adesão").status, "incerto");
  assert.equal(avaliarCriterio(planoRea, "").status, "semResposta");
});

test("campos: cada critério fica com um campo diferente", () => {
  const definicoes = [
    { id: 1, name: "Escola particular?" },
    { id: 2, name: "Mensalidade da escola" },
    { id: 3, name: "Filho com deficiência?" },
    { id: 4, name: "Descrição" },
  ];
  const leads = [{ campos: { 1: "Sim", 2: "R$ 1.500", 3: "Sim" } }];
  const campos = resolverCampos(PRE_QUALIFICACAO["IR-Q"].criterios, definicoes, leads);
  assert.equal(campos.mensalidade.id, 2);
  assert.equal(campos.escolaParticular.id, 1);
  assert.equal(campos.filhoComDeficiencia.id, 3);
});

test("campos: nomes que se sobrepõem entre campanhas não trocam os campos", () => {
  // \"Mensalidade da escola\" combina com os critérios de escola e de mensalidade, e
  // \"Mensalidade do plano\" (do Reajuste) combina com o de mensalidade.
  const definicoes = [
    { id: 1, name: "Filho com deficiência?" },
    { id: 2, name: "Escola particular?" },
    { id: 3, name: "Mensalidade da escola" },
    { id: 4, name: "Mensalidade do plano" },
  ];
  const leads = [
    { campos: { 1: "Sim", 2: "Sim", 3: "Acima de R$ 1.500" } },
    { campos: { 1: "Sim", 2: "Não", 3: "R$ 900 a R$ 1.500" } },
    { campos: { 1: "Sim", 3: "Até R$ 900" } },
  ];
  const campos = resolverCampos(PRE_QUALIFICACAO["IR-Q"].criterios, definicoes, leads);
  assert.equal(campos.filhoComDeficiencia.id, 1);
  assert.equal(campos.escolaParticular.id, 2);
  assert.equal(campos.mensalidade.id, 3);
});

test("campos: o ID da configuração vale sobre o nome e o campo mais preenchido vence", () => {
  const criterio = { chave: "x", rotulo: "X", campo: { id: 99, nome: /mensalidade/i } };
  assert.equal(resolverCampos([criterio], [{ id: 5, name: "Mensalidade" }], [{ campos: {} }]).x.id, 99);
  const sem = { chave: "m", rotulo: "M", campo: { id: null, nome: /mensalidade/i } };
  const definicoes = [{ id: 5, name: "Mensalidade antiga" }, { id: 6, name: "Mensalidade" }];
  const leads = [{ campos: { 6: "100" } }, { campos: { 6: "200" } }, { campos: { 5: "300" } }];
  assert.equal(resolverCampos([sem], definicoes, leads).m.id, 6);
  assert.equal(resolverCampos([sem], [], leads).m, null);
});

// --- Análise completa ---------------------------------------------------------

const DEFINICOES_REA = [
  { id: 10, name: "Tipo de plano" },
  { id: 11, name: "Mensalidade do plano" },
  { id: 12, name: "Recebeu aumento recentemente?" },
];
const lead = (id, campos) => ({ id, campos });
const consolidado = (leadId, anuncio, extras = {}) => ({
  leadId, nome: `Lead ${leadId}`, telefone: "", campanha: "REA-Q", anuncio, conjunto: "Conj", campanhaMeta: "Camp",
  qualificado: false, situacaoDeHoje: "emAndamento", etapaMaisAvancada: "Contato Iniciado", etapaAtual: "Contato Iniciado", motivoPerda: "", ...extras,
});

function cenarioRea() {
  const leads = [
    lead(1, { 10: "Empresarial/CNPJ", 11: "R$ 2.300", 12: "Sim" }), // pré
    lead(2, { 10: "Familiar", 11: "3.100", 12: "Não" }), // pré, já qualificado pela equipe
    lead(3, { 10: "Individual", 11: "R$ 2.500" }), // não: plano
    lead(4, { 10: "Empresarial", 11: "1.200" }), // não: mensalidade
    lead(5, {}), // sem respostas
    lead(6, { 10: "Familiar" }), // pendente: falta a mensalidade
    lead(7, { 10: "Familiar", 11: "R$ 1.500 a R$ 2.500" }), // pendente: faixa cruza o limite
    lead(8, { 10: "Empresarial", 11: "2.800" }), // pré, mas já descartado pela equipe
  ];
  const consolidados = [
    consolidado(1, "REA R1"),
    consolidado(2, "REA R1", { qualificado: true, situacaoDeHoje: "agendado" }),
    consolidado(3, "REA R2"),
    consolidado(4, "REA R2"),
    consolidado(5, "REA R2"),
    consolidado(6, "REA R3"),
    consolidado(7, "REA R3"),
    consolidado(8, "REA R3", { situacaoDeHoje: "desqualificado" }),
  ];
  return { leads, consolidados, definicoes: DEFINICOES_REA };
}

test("Reajuste: contagens por anúncio e total", () => {
  const r = analisarPreQualificacao({ ...cenarioRea(), agruparPor: "anuncio" });
  assert.equal(r.campanhas.length, 1);
  const bloco = r.campanhas[0];
  assert.equal(bloco.codigo, "REA-Q");
  assert.equal(bloco.total.totalLeads, 8);
  assert.equal(bloco.total.preQualificados, 3);
  assert.equal(bloco.total.pendentes, 2);
  assert.equal(bloco.total.naoQualificados, 2);
  assert.equal(bloco.total.semRespostas, 1);
  assert.equal(bloco.total.percentualPreQualificados, 37.5);
  assert.equal(bloco.total.qualificadosPelaEquipe, 1);
  // Pré-qualificados esperando contato: o 1. O 2 já foi qualificado e o 8 descartado.
  assert.equal(bloco.total.preQualificadosEmTriagem, 1);

  const porNome = Object.fromEntries(bloco.grupos.map((g) => [g.grupo, g]));
  assert.equal(porNome["REA R1"].preQualificados, 2);
  assert.equal(porNome["REA R2"].naoQualificados, 2);
  assert.equal(porNome["REA R2"].semRespostas, 1);
  assert.equal(porNome["REA R3"].pendentes, 2);
  assert.equal(porNome["REA R3"].preQualificados, 1);
});

test("Reajuste: pareceres e informação complementar", () => {
  const bloco = analisarPreQualificacao(cenarioRea()).campanhas[0];
  const leadPorId = (id) => bloco.total.leads.find((l) => l.leadId === id);
  assert.match(leadPorId(3).parecer, /Tipo de plano: Individual/);
  assert.match(leadPorId(4).parecer, /Mensalidade não passa de R\$ 2\.000/);
  assert.match(leadPorId(6).parecer, /Mensalidade: sem resposta/);
  assert.match(leadPorId(7).parecer, /confirmar se passa de R\$ 2\.000/);
  assert.equal(leadPorId(1).respostas, "Tipo de plano: Empresarial/CNPJ · Mensalidade: R$ 2.300 · Aumento recente: Sim");
  // O aumento recente só é contado entre os pré-qualificados (1, 2 e 8) e não decide nada.
  assert.deepEqual(bloco.complementar, [{ chave: "aumentoRecente", rotulo: "Aumento recente", sim: 1, nao: 1, semResposta: 1 }]);
  assert.equal(leadPorId(8).situacao, "preQualificado");
});

test("IR: faixa de R$ 900 a R$ 1.500 fica pendente e quem não tem escola particular não qualifica", () => {
  const definicoes = [
    { id: 20, name: "Filho com deficiência?" },
    { id: 21, name: "Escola particular?" },
    { id: 22, name: "Mensalidade da escola" },
  ];
  const leads = [
    lead(1, { 20: "Sim", 21: "Sim", 22: "Acima de R$ 1.500" }), // pré
    lead(2, { 20: "Sim", 21: "Sim", 22: "R$ 900 a R$ 1.500" }), // pendente
    lead(3, { 20: "Sim", 21: "Não", 22: "R$ 3.000" }), // não: escola
    lead(4, { 20: "Sim", 21: "Sim", 22: "Até R$ 900" }), // não: mensalidade
  ];
  const consolidados = leads.map((l) => consolidado(l.id, "IR R1", { campanha: "IR-Q" }));
  const bloco = analisarPreQualificacao({ leads, consolidados, definicoes }).campanhas[0];
  assert.equal(bloco.codigo, "IR-Q");
  assert.deepEqual(
    [bloco.total.preQualificados, bloco.total.pendentes, bloco.total.naoQualificados, bloco.total.semRespostas],
    [1, 1, 2, 0],
  );
  assert.ok(bloco.campos.every((c) => c.encontrado), "os três campos foram localizados");
});

test("campo do questionário não encontrado: tudo sem respostas, e o bloco avisa quais campos faltam", () => {
  const leads = [lead(1, { 99: "x" })];
  const bloco = analisarPreQualificacao({ leads, consolidados: [consolidado(1, "REA R1")], definicoes: [{ id: 99, name: "Outra coisa" }] }).campanhas[0];
  assert.equal(bloco.total.semRespostas, 1);
  assert.deepEqual(bloco.campos.map((c) => c.encontrado), [null, null, null]);
});

test("agrupamento por conjunto e campanha sem leads não gera bloco", () => {
  const r = analisarPreQualificacao({ ...cenarioRea(), agruparPor: "conjunto" });
  assert.deepEqual(r.campanhas[0].grupos.map((g) => g.grupo), ["Conj"]);
  assert.equal(r.agruparPor, "conjunto");
  assert.equal(analisarPreQualificacao({ ...cenarioRea(), agruparPor: "invalido" }).agruparPor, "anuncio");
  assert.equal(analisarPreQualificacao({ leads: [], consolidados: [], definicoes: [] }).campanhas.length, 0);
});

test("campos reais da conta: cada critério acha o seu campo pelo nome", () => {
  const nomes = {
    1094674: "Plano de saúde", 1121931: "Descrição", 1127409: "Campanha Meta", 1127443: "IR: Mensalidade escolar",
    1127439: "IR: Filho(a) possui deficiência?", 1127441: "IR: Estuda em escola particular?",
    1127445: "REA: Modelo do plano", 1127447: "REA: Valor do plano", 1127449: "REA: Recebeu aumento recente?",
    1127427: "Situação da reunião", 1127423: "Código da campanha",
  };
  const definicoes = Object.entries(nomes).map(([id, name]) => ({ id: Number(id), name }));
  // Cada campanha vê só os seus leads: o IR responde os campos do IR, o REA os do REA.
  const leadsIR = [{ campos: { 1127439: "Sim", 1127441: "Sim", 1127443: "R$ 1.500" } }];
  const leadsREA = [{ campos: { 1127445: "Empresarial", 1127447: "R$ 2.500", 1127449: "Sim" } }];
  const ir = resolverCampos(PRE_QUALIFICACAO["IR-Q"].criterios, definicoes, leadsIR);
  assert.equal(ir.filhoComDeficiencia.id, 1127439);
  assert.equal(ir.escolaParticular.id, 1127441);
  assert.equal(ir.mensalidade.id, 1127443);
  const regras = PRE_QUALIFICACAO["REA-Q"];
  const rea = resolverCampos([...regras.criterios, ...regras.complementar], definicoes, leadsREA);
  assert.equal(rea.tipoDePlano.id, 1127445);
  assert.equal(rea.mensalidade.id, 1127447);
  assert.equal(rea.aumentoRecente.id, 1127449);
});
