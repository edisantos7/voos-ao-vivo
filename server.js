// =====================================================================
//  server.js — pequeno servidor local para o projeto "Voos ao vivo"
// ---------------------------------------------------------------------
//  Porque é que precisamos disto?
//  A API da OpenSky só aceita pedidos feitos pelo browser a partir do
//  próprio site deles (regra de segurança chamada CORS). Se a nossa página
//  pedir os dados diretamente, o browser bloqueia a resposta.
//
//  A solução: este servidor corre no teu computador, faz o pedido à
//  OpenSky (servidores não têm a regra CORS) e entrega a resposta à página.
//
//  Também:
//   - serve os ficheiros do projeto (index.html, style.css, app.js)
//   - guarda a última resposta durante 20 segundos (cache), para que
//     várias abas abertas não gastem pedidos a mais
//   - se existir um ficheiro config.json com credenciais da OpenSky,
//     usa-as (dá muitos mais pedidos por dia)
//
//  Como usar:   node server.js     e depois abrir  http://localhost:8080
//  Não precisa de instalar nada além do Node.js (versão 18 ou mais recente).
// =====================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");

// No teu computador usamos a porta 8080. Num serviço online (ex.: Render),
// é o serviço que escolhe a porta e no-la dá na variável de ambiente PORT.
const PORTA = process.env.PORT || 8080;
const PASTA = __dirname; // a pasta onde está este ficheiro
const URL_OPENSKY = "https://opensky-network.org/api/states/all";
const URL_TOKEN =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const CACHE_MS = 20 * 1000; // quanto tempo reutilizamos a mesma resposta

// ---------- Credenciais opcionais ----------
// Podem vir de dois sítios:
//  1. variáveis de ambiente OPENSKY_CLIENT_ID e OPENSKY_CLIENT_SECRET
//     (é assim que se configuram num serviço online como o Render)
//  2. o ficheiro config.json (mais prático no teu computador)
let credenciais = null;
if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
  credenciais = {
    clientId: process.env.OPENSKY_CLIENT_ID,
    clientSecret: process.env.OPENSKY_CLIENT_SECRET,
  };
} else {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(PASTA, "config.json"), "utf8"));
    if (cfg.clientId && cfg.clientSecret) credenciais = cfg;
  } catch (e) {
    // Sem credenciais: usamos a OpenSky de forma anónima (com menos pedidos por dia)
  }
}

// Token de acesso (só usado se houver credenciais). Dura cerca de 30 minutos.
let token = null;
let tokenExpira = 0;

async function obterToken() {
  if (!credenciais) return null;
  if (token && Date.now() < tokenExpira) return token; // ainda é válido
  const resposta = await fetch(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credenciais.clientId,
      client_secret: credenciais.clientSecret,
    }),
  });
  if (!resposta.ok) throw new Error("As credenciais em config.json foram recusadas pela OpenSky.");
  const dados = await resposta.json();
  token = dados.access_token;
  tokenExpira = Date.now() + (dados.expires_in - 60) * 1000; // renovamos 1 minuto antes
  return token;
}

// ---------- Cache da última resposta ----------
let cache = null; // { quando, corpo, restantes }

async function pedirVoos() {
  // Se a última resposta ainda é recente, devolvemo-la sem gastar pedidos
  if (cache && Date.now() - cache.quando < CACHE_MS) return { estado: 200, ...cache };

  const cabecalhos = {};
  const t = await obterToken();
  if (t) cabecalhos.Authorization = "Bearer " + t;

  const resposta = await fetch(URL_OPENSKY, { headers: cabecalhos });
  const restantes = resposta.headers.get("x-rate-limit-remaining");

  if (resposta.status === 429) {
    // Limite de pedidos atingido: a OpenSky diz-nos daqui a quantos segundos tentar
    const espera = resposta.headers.get("x-rate-limit-retry-after-seconds");
    return { estado: 429, corpo: JSON.stringify({ erro: "limite", esperaSegundos: Number(espera) || null }) };
  }
  if (!resposta.ok) {
    return { estado: 502, corpo: JSON.stringify({ erro: "opensky", codigo: resposta.status }) };
  }

  const corpo = await resposta.text();
  cache = { quando: Date.now(), corpo, restantes };
  return { estado: 200, ...cache };
}

// ---------- Ficheiros do projeto ----------
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
// Só estes ficheiros podem ser servidos (assim o config.json nunca sai do teu computador)
const PERMITIDOS = ["index.html", "style.css", "app.js"];

function servirFicheiro(caminho, res) {
  const nome = caminho === "/" ? "index.html" : caminho.replace(/^\/+/, "");
  if (!PERMITIDOS.includes(nome)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Não encontrado");
  }
  fs.readFile(path.join(PASTA, nome), (erro, conteudo) => {
    if (erro) {
      res.writeHead(404);
      return res.end("Não encontrado");
    }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(nome)] || "application/octet-stream" });
    res.end(conteudo);
  });
}

// ---------- O servidor ----------
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/voos") {
    try {
      const r = await pedirVoos();
      const cab = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      if (r.restantes != null) cab["X-Pedidos-Restantes"] = r.restantes;
      if (r.quando) cab["X-Obtido-Em"] = String(r.quando);
      res.writeHead(r.estado, cab);
      res.end(r.corpo);
    } catch (erro) {
      // Sem internet, OpenSky em baixo, credenciais erradas, etc.
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ erro: "ligacao", mensagem: erro.message }));
    }
    return;
  }

  servirFicheiro(url.pathname, res);
});

servidor.listen(PORTA, () => {
  console.log("");
  console.log("  ✈  Voos ao vivo está a correr!");
  console.log(process.env.PORT
    ? "  A ouvir na porta " + PORTA + " (modo online)."
    : "  Abre no browser:  http://localhost:" + PORTA);
  console.log(credenciais
    ? "  A usar a tua conta OpenSky."
    : "  Modo anónimo da OpenSky (cerca de 100 atualizações por dia). Vê o README para ter mais.");
  console.log("  Para parar: Ctrl + C");
  console.log("");
});
