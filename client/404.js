// Página 404: mostra o endereço pedido e conduz o pequeno jogo do lead perdido.
// O ponto dourado vaga pela tela e foge do cursor; cada captura avança uma
// etapa do funil. Nada aqui consulta a API.

const $ = (id) => document.getElementById(id);

// textContent, e não innerHTML: o endereço vem do navegador e não é confiável.
let endereco = location.pathname;
try {
  endereco = decodeURIComponent(endereco);
} catch {
  // Endereço com codificação inválida: mostra como veio.
}
$("endereco").textContent = endereco.slice(0, 80);

const MENSAGENS = [
  "Nenhuma captura ainda. O lead continua sem atendimento.",
  "<strong>Contato iniciado.</strong> Ele respondeu, mas já saiu correndo de novo.",
  "<strong>Em qualificação.</strong> Tem perfil. E está ficando mais rápido.",
  "<strong>Reunião marcada.</strong> Agora é torcer para ele comparecer.",
  "<strong>Reunião realizada.</strong> Falta só a assinatura.",
  "<strong>Contrato fechado.</strong> Meta desta página batida. Pode voltar ao trabalho.",
];
const TOTAL = MENSAGENS.length - 1;

const lead = $("lead");
const etapas = [...$("etapas").children];
const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let capturas = 0;
let pos = { x: innerWidth * 0.72, y: innerHeight * 0.38 };
let vel = { x: 60, y: -40 };
let cursor = null;
let anterior = performance.now();

const MARGEM = 34;
const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

function desenhar() {
  lead.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
}

function mostrarProgresso() {
  etapas.forEach((li, i) => li.classList.toggle("feita", i < capturas));
  $("situacao").innerHTML = MENSAGENS[capturas];
  const fim = capturas >= TOTAL;
  lead.classList.toggle("fechado", fim);
  lead.querySelector("span").textContent = fim ? "cliente" : "lead perdido";
  lead.setAttribute("aria-label", fim ? "Lead convertido em cliente" : "Capturar o lead perdido");
  $("recomecar").hidden = !fim;
  $("despachoTitulo").textContent = fim ? "Sentença · autos n.º 404" : "Despacho · autos n.º 404";
  $("despachoTexto").textContent = fim
    ? "Lead localizado e contrato fechado. A página, porém, segue inexistente. Arquive-se."
    : "Indefiro o acesso, por inexistência do objeto. Intime-se o usuário a retornar ao painel.";
}

function soltarFaiscas() {
  if (semMovimento) return;
  for (let i = 0; i < 26; i++) {
    const f = document.createElement("i");
    f.className = "faisca";
    const angulo = (i / 26) * Math.PI * 2;
    const alcance = 70 + Math.random() * 130;
    f.style.left = `${pos.x}px`;
    f.style.top = `${pos.y}px`;
    f.style.setProperty("--dx", `${Math.cos(angulo) * alcance}px`);
    f.style.setProperty("--dy", `${Math.sin(angulo) * alcance}px`);
    if (i % 3 === 0) f.style.background = "#4fb38a";
    document.body.appendChild(f);
    f.addEventListener("animationend", () => f.remove());
  }
}

function capturar() {
  if (capturas >= TOTAL) return;
  capturas++;
  lead.classList.remove("pego");
  void lead.offsetWidth; // reinicia a animação do pulso
  lead.classList.add("pego");
  mostrarProgresso();
  if (capturas >= TOTAL) {
    soltarFaiscas();
    return;
  }
  // Escapa para um ponto distante de onde foi pego.
  pos = {
    x: limitar(pos.x + (pos.x > innerWidth / 2 ? -1 : 1) * innerWidth * (0.3 + Math.random() * 0.25), MARGEM, innerWidth - MARGEM),
    y: limitar(MARGEM + Math.random() * (innerHeight - 2 * MARGEM), MARGEM, innerHeight - MARGEM),
  };
  const direcao = Math.random() * Math.PI * 2;
  vel = { x: Math.cos(direcao) * 90, y: Math.sin(direcao) * 90 };
}

function quadro(agora) {
  const dt = Math.min((agora - anterior) / 1000, 0.05);
  anterior = agora;

  if (capturas < TOTAL && !semMovimento) {
    // A cada etapa o lead fica um pouco mais arisco.
    const velocidadeMaxima = 210 + capturas * 45;
    const raioDeFuga = 120 + capturas * 12;

    if (cursor) {
      const dx = pos.x - cursor.x, dy = pos.y - cursor.y;
      const distancia = Math.hypot(dx, dy) || 1;
      if (distancia < raioDeFuga) {
        const forca = (1 - distancia / raioDeFuga) * 2600;
        vel.x += (dx / distancia) * forca * dt;
        vel.y += (dy / distancia) * forca * dt;
      }
    }
    // Vagueia de leve e perde velocidade aos poucos, até um passeio lento.
    vel.x += (Math.random() - 0.5) * 220 * dt;
    vel.y += (Math.random() - 0.5) * 220 * dt;
    const rapidez = Math.hypot(vel.x, vel.y) || 1;
    const alvo = Math.max(45, Math.min(rapidez * (1 - 1.6 * dt), velocidadeMaxima));
    vel.x = (vel.x / rapidez) * alvo;
    vel.y = (vel.y / rapidez) * alvo;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    if (pos.x < MARGEM || pos.x > innerWidth - MARGEM) vel.x *= -1;
    if (pos.y < MARGEM || pos.y > innerHeight - MARGEM) vel.y *= -1;
  }
  pos.x = limitar(pos.x, MARGEM, innerWidth - MARGEM);
  pos.y = limitar(pos.y, MARGEM, innerHeight - MARGEM);
  desenhar();
  requestAnimationFrame(quadro);
}

// Só o mouse faz o lead fugir. No toque não há cursor: basta acertar o ponto.
addEventListener("pointermove", (e) => {
  cursor = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
});
addEventListener("pointerleave", () => (cursor = null));
lead.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  capturar();
});
// Pelo teclado: Tab até o ponto e Enter ou espaço.
lead.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    capturar();
  }
});
$("recomecar").addEventListener("click", () => {
  capturas = 0;
  vel = { x: 80, y: -60 };
  mostrarProgresso();
});

mostrarProgresso();
desenhar();
requestAnimationFrame(quadro);
