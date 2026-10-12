// =====================================================================
//  app.js — o cérebro do projeto "Voos ao vivo"
// ---------------------------------------------------------------------
//  Partes deste ficheiro:
//   1. Configuração
//   2. O mapa (Leaflet)
//   3. A camada dos aviões (desenhados num <canvas>, é muito mais rápido)
//   4. Ir buscar os voos à OpenSky (através do server.js)
//   5. Clicar num avião e mostrar o painel
//   6. Rota: origem e destino (API adsbdb)
//   7. Pesquisa por callsign
//   8. Mensagens de aviso e relógio da barra do topo
//   9. Arranque
// =====================================================================


// ---------------------------------------------------------------------
// 1. CONFIGURAÇÃO
// ---------------------------------------------------------------------
const INTERVALO_MS = 30 * 1000;               // de quanto em quanto tempo atualizamos (30 s)
const URL_VOOS = "/api/voos";                 // o nosso servidor local (server.js)
const URL_ROTA = "https://api.adsbdb.com/v0/callsign/"; // + callsign
const TAMANHO_AVIAO = 16;                     // tamanho do ícone em píxeis

// Cores por altitude (as mesmas da legenda no index.html)
const CORES_ALTITUDE = [
  { ate: 3000, cor: "#7ee081" },     // abaixo de 3 km: verde
  { ate: 7000, cor: "#f4d35e" },     // 3 a 7 km: amarelo
  { ate: 10000, cor: "#f79b4b" },    // 7 a 10 km: laranja
  { ate: Infinity, cor: "#f25f8c" }, // acima de 10 km: rosa
];


// ---------------------------------------------------------------------
// 2. O MAPA
// ---------------------------------------------------------------------
const mapa = L.map("mapa", {
  center: [39.5, -8],   // começa centrado em Portugal
  zoom: 4,
  minZoom: 2,
  worldCopyJump: true,  // ao dar a volta ao mundo, o mapa "salta" para a cópia certa
  zoomControl: true,
});

// Mapa base escuro e gratuito da Esri (não precisa de chave).
// Nota: o mapa escuro da CARTO passou a pedir uma chave de API, por isso usamos este.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  attribution:
    'Mapa base &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Voos: <a href="https://opensky-network.org">OpenSky</a> · Rotas: <a href="https://www.adsbdb.com">adsbdb</a>',
}).addTo(mapa);
// Segunda camada só com os nomes (países, cidades), por cima do mapa base
L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
}).addTo(mapa);

// Grupo onde vamos desenhar a rota (linhas + aeroportos) do avião escolhido
const camadaRota = L.layerGroup().addTo(mapa);


// ---------------------------------------------------------------------
// 3. A CAMADA DOS AVIÕES
// ---------------------------------------------------------------------
// Com 10 000 aviões, criar 10 000 marcadores do Leaflet deixaria o mapa
// muito lento. Por isso desenhamos todos os aviões num único <canvas>
// por cima do mapa, e só os que estão na zona visível.

let avioes = [];             // lista com todos os aviões no ar (vem da OpenSky)
let avioesVisiveis = [];     // os que foram desenhados no ecrã (para sabermos em qual se clicou)
let selecionado = null;      // o código icao24 do avião escolhido (ou null)
let aFazerZoom = false;      // durante a animação de zoom não desenhamos

const canvas = document.createElement("canvas");
canvas.className = "camada-avioes";
mapa.getContainer().appendChild(canvas);
const ctx = canvas.getContext("2d");
const dpr = Math.min(window.devicePixelRatio || 1, 2); // ecrãs "retina" têm mais píxeis

// Desenha a forma de um avião (a apontar para cima = Norte) num canvas pequeno.
// Fazemos isto uma vez por cor e depois só "carimbamos" a imagem — é rápido.
function criarIcone(cor, tamanho) {
  const c = document.createElement("canvas");
  c.width = c.height = tamanho * dpr;
  const g = c.getContext("2d");
  g.scale((tamanho * dpr) / 24, (tamanho * dpr) / 24); // desenhamos numa grelha de 24×24
  g.beginPath();
  g.moveTo(12, 1.5);                       // nariz
  g.lineTo(13.6, 8.5); g.lineTo(22.5, 13.5); g.lineTo(22.5, 15.5); // asa direita
  g.lineTo(13.6, 13); g.lineTo(13.2, 18.5); g.lineTo(16.5, 20.8);  // cauda direita
  g.lineTo(16.5, 22.5); g.lineTo(12, 21.3); g.lineTo(7.5, 22.5);   // fundo da cauda
  g.lineTo(7.5, 20.8); g.lineTo(10.8, 18.5); g.lineTo(10.4, 13);   // cauda esquerda
  g.lineTo(1.5, 15.5); g.lineTo(1.5, 13.5); g.lineTo(10.4, 8.5);   // asa esquerda
  g.closePath();
  g.fillStyle = cor;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.stroke();
  return c;
}
const icones = CORES_ALTITUDE.map((faixa) => criarIcone(faixa.cor, TAMANHO_AVIAO));
const iconeSelecionado = criarIcone("#ffffff", TAMANHO_AVIAO * 1.6);

function corDoAviao(aviao) {
  const alt = aviao.altitude ?? 0;
  return CORES_ALTITUDE.findIndex((faixa) => alt < faixa.ate);
}

// Ajusta o tamanho do canvas ao tamanho do mapa
function ajustarCanvas() {
  const tamanho = mapa.getSize();
  canvas.width = tamanho.x * dpr;
  canvas.height = tamanho.y * dpr;
  canvas.style.width = tamanho.x + "px";
  canvas.style.height = tamanho.y + "px";
  pedirDesenho();
}

// Para não desenhar 60 vezes seguidas enquanto arrastas o mapa,
// juntamos os pedidos e desenhamos uma vez por "frame" do ecrã.
let desenhoPendente = false;
function pedirDesenho() {
  if (desenhoPendente) return;
  desenhoPendente = true;
  requestAnimationFrame(() => {
    desenhoPendente = false;
    desenharAvioes();
  });
}

function desenharAvioes() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  avioesVisiveis = [];
  if (aFazerZoom) return;

  // A zona visível do mapa (com uma pequena margem)
  const limites = mapa.getBounds().pad(0.05);
  const sul = limites.getSouth(), norte = limites.getNorth();
  const oeste = limites.getWest(), este = limites.getEast();
  const meio = TAMANHO_AVIAO / 2;
  let escolhido = null;

  for (const aviao of avioes) {
    if (aviao.lat < sul || aviao.lat > norte) continue; // fora do ecrã (norte/sul): ignorar

    // O mapa pode mostrar o mundo "repetido" para os lados; testamos as 3 cópias
    for (const desvio of [-360, 0, 360]) {
      const lon = aviao.lon + desvio;
      if (lon < oeste || lon > este) continue; // fora do ecrã: não desenhamos

      const p = mapa.latLngToContainerPoint([aviao.lat, lon]);
      avioesVisiveis.push({ aviao, x: p.x, y: p.y });

      if (aviao.icao24 === selecionado) { escolhido = p; continue; } // desenhado no fim, por cima

      // Rodar o ícone na direção do voo e "carimbá-lo"
      const angulo = ((aviao.rumo ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angulo), sen = Math.sin(angulo);
      ctx.setTransform(dpr * cos, dpr * sen, -dpr * sen, dpr * cos, dpr * p.x, dpr * p.y);
      ctx.drawImage(icones[corDoAviao(aviao)], -meio, -meio, TAMANHO_AVIAO, TAMANHO_AVIAO);
    }
  }

  // O avião escolhido: maior, branco e com um anel à volta
  if (escolhido) {
    const aviao = avioes.find((a) => a.icao24 === selecionado);
    const t = TAMANHO_AVIAO * 1.6;
    const angulo = ((aviao.rumo ?? 0) * Math.PI) / 180;
    ctx.setTransform(dpr, 0, 0, dpr, dpr * escolhido.x, dpr * escolhido.y);
    ctx.beginPath();
    ctx.arc(0, 0, t * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(92, 200, 255, 0.25)";
    ctx.strokeStyle = "#5cc8ff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.rotate(angulo);
    ctx.drawImage(iconeSelecionado, -t / 2, -t / 2, t, t);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Redesenhar quando o mapa se mexe ou muda de tamanho
mapa.on("move", pedirDesenho);
mapa.on("resize", ajustarCanvas);
mapa.on("zoomstart", () => { aFazerZoom = true; pedirDesenho(); });
mapa.on("zoomend", () => { aFazerZoom = false; pedirDesenho(); });

// Descobre o avião mais perto de um ponto do ecrã (para cliques e rato)
function avioesPerto(ponto, raio) {
  let melhor = null;
  let melhorDist = raio * raio;
  for (const v of avioesVisiveis) {
    const dx = v.x - ponto.x, dy = v.y - ponto.y;
    const d = dx * dx + dy * dy;
    if (d < melhorDist) { melhorDist = d; melhor = v.aviao; }
  }
  return melhor;
}

// Muda o cursor para "mãozinha" quando o rato passa por cima de um avião
mapa.on("mousemove", (e) => {
  mapa.getContainer().style.cursor = avioesPerto(e.containerPoint, 12) ? "pointer" : "";
});


// ---------------------------------------------------------------------
// 4. IR BUSCAR OS VOOS À OPENSKY
// ---------------------------------------------------------------------
// A OpenSky devolve uma lista de "state vectors". Cada um é uma lista
// de valores numa ordem fixa. Estas são as posições que usamos:
//   0 icao24 · 1 callsign · 2 país · 4 último contacto · 5 longitude
//   6 latitude · 7 altitude barométrica · 8 no solo · 9 velocidade (m/s)
//   10 rumo (graus) · 11 velocidade vertical (m/s) · 13 altitude GPS

let ultimaAtualizacao = null;   // quando recebemos dados pela última vez (ms)
let proximaAtualizacao = null;  // quando vamos pedir outra vez (ms)
let temporizador = null;
let pedidosRestantes = null;    // "créditos" que a OpenSky ainda nos deixa gastar hoje

function converterVoo(s) {
  return {
    icao24: s[0],
    callsign: (s[1] || "").trim(),
    pais: s[2],
    ultimoContacto: s[4],
    lon: s[5],
    lat: s[6],
    altitude: s[7] ?? s[13],    // se não houver altitude barométrica, usamos a de GPS
    noSolo: s[8],
    velocidade: s[9],
    rumo: s[10],
    vertical: s[11],
  };
}

async function atualizarVoos() {
  clearTimeout(temporizador);
  let esperar = INTERVALO_MS; // quanto tempo até à próxima tentativa

  try {
    const resposta = await fetch(URL_VOOS, { cache: "no-store" });
    const dados = await resposta.json().catch(() => ({}));

    if (resposta.status === 429) {
      // Limite de pedidos atingido. Mantemos os aviões antigos no mapa.
      const segundos = dados.esperaSegundos;
      esperar = Math.min(Math.max((segundos || 300) * 1000, 60 * 1000), 15 * 60 * 1000);
      mostrarAviso(
        "A OpenSky atingiu o limite de pedidos gratuitos" +
          (segundos ? ` (volta a haver daqui a ${formatarEspera(segundos)})` : "") +
          ". Os aviões no mapa são da última atualização. Vê no README como ter mais pedidos com uma conta grátis."
      );
    } else if (!resposta.ok) {
      if (dados.erro === "ligacao") {
        mostrarAviso("O servidor local não conseguiu falar com a OpenSky. Confirma a ligação à internet. Volto a tentar daqui a 30 s.");
      } else {
        mostrarAviso(`A OpenSky não respondeu como esperado (código ${dados.codigo || resposta.status}). Volto a tentar daqui a 30 s.`);
      }
    } else {
      // Tudo bem: guardamos os aviões que estão no ar e têm posição
      avioes = (dados.states || [])
        .map(converterVoo)
        .filter((a) => a.lat != null && a.lon != null && !a.noSolo);

      const restantes = resposta.headers.get("X-Pedidos-Restantes");
      pedidosRestantes = restantes != null ? Number(restantes) : pedidosRestantes;
      ultimaAtualizacao = Date.now();
      esconderAviso();

      document.getElementById("total").textContent = avioes.length.toLocaleString("pt-PT");
      pedirDesenho();
      if (selecionado) atualizarPainel();
    }
  } catch (erro) {
    // O fetch falhou de todo: normalmente é porque o server.js não está a correr
    mostrarAviso("Não consegui ligar ao servidor local. Confirma que o comando «node server.js» está a correr e abre http://localhost:8080.");
  }

  // Marcar a próxima atualização (só se a aba estiver visível, para poupar pedidos)
  proximaAtualizacao = Date.now() + esperar;
  if (!document.hidden) temporizador = setTimeout(atualizarVoos, esperar);
}

// Se mudares de aba, paramos de pedir dados; quando voltas, atualizamos logo
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(temporizador);
  } else if (!proximaAtualizacao || Date.now() >= proximaAtualizacao) {
    atualizarVoos();
  } else {
    temporizador = setTimeout(atualizarVoos, proximaAtualizacao - Date.now());
  }
});


// ---------------------------------------------------------------------
// 5. CLICAR NUM AVIÃO E MOSTRAR O PAINEL
// ---------------------------------------------------------------------
const painel = document.getElementById("painel");
const $ = (id) => document.getElementById(id); // atalho para não escrever tanto

mapa.on("click", (e) => {
  // Em ecrãs táteis o dedo é menos preciso, por isso aceitamos uma área maior
  const raio = window.matchMedia("(pointer: coarse)").matches ? 22 : 12;
  const aviao = avioesPerto(e.containerPoint, raio);
  if (aviao) selecionarAviao(aviao);
  else fecharPainel();
});

$("fechar").addEventListener("click", fecharPainel);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharPainel(); });

function selecionarAviao(aviao) {
  selecionado = aviao.icao24;
  painel.hidden = false;
  atualizarPainel();
  carregarRota(aviao);
  pedirDesenho();
}

function fecharPainel() {
  selecionado = null;
  painel.hidden = true;
  camadaRota.clearLayers();
  rotaAtual = null;
  pedirDesenho();
}

// Converte graus (0–360) num ponto cardeal (N, NE, E, SE, S, SO, O, NO)
function pontoCardeal(graus) {
  const pontos = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return pontos[Math.round(graus / 45) % 8];
}

// Preenche o painel com os dados mais recentes do avião escolhido
let ultimoVistoDoSelecionado = null;
function atualizarPainel() {
  const aviao = avioes.find((a) => a.icao24 === selecionado);
  if (!aviao) {
    // O avião desapareceu da última atualização (aterrou ou ficou sem sinal)
    $("p-fase").textContent = "Sem sinal na última atualização";
    return;
  }
  ultimoVistoDoSelecionado = aviao;

  $("p-callsign").textContent = aviao.callsign || "Sem callsign";
  $("p-pais").textContent = "Avião registado em: " + aviao.pais;
  $("p-icao").textContent = aviao.icao24.toUpperCase();

  // Altitude em metros e em pés (1 metro = 3,28084 pés)
  $("p-altitude").textContent = aviao.altitude != null
    ? `${Math.round(aviao.altitude).toLocaleString("pt-PT")} m · ${Math.round(aviao.altitude * 3.28084).toLocaleString("pt-PT")} pés`
    : "Desconhecida";

  // Velocidade: a OpenSky dá metros por segundo; × 3,6 dá km/h
  $("p-velocidade").textContent = aviao.velocidade != null
    ? `${Math.round(aviao.velocidade * 3.6).toLocaleString("pt-PT")} km/h`
    : "Desconhecida";

  $("p-direcao").textContent = aviao.rumo != null
    ? `${Math.round(aviao.rumo)}° · ${pontoCardeal(aviao.rumo)}`
    : "Desconhecida";

  // Fase do voo, a partir da velocidade vertical (m/s → m/min)
  const v = aviao.vertical;
  let fase = "Em cruzeiro";
  if (v != null && v > 1.5) fase = `A subir ↑ ${Math.round(v * 60)} m/min`;
  else if (v != null && v < -1.5) fase = `A descer ↓ ${Math.round(-v * 60)} m/min`;
  $("p-fase").textContent = fase;

  atualizarHora();
  if (rotaAtual) desenharRota(); // a posição mudou: redesenhar a linha da rota
}

// A hora da última atualização (e "há quantos segundos"), refrescada todos os segundos
function atualizarHora() {
  const aviao = ultimoVistoDoSelecionado;
  if (!aviao || painel.hidden) return;
  const quando = new Date(aviao.ultimoContacto * 1000);
  const ha = Math.max(0, Math.round((Date.now() - quando) / 1000));
  $("p-hora").textContent = `${quando.toLocaleTimeString("pt-PT")} (há ${formatarEspera(ha)})`;
}


// ---------------------------------------------------------------------
// 6. ROTA: ORIGEM E DESTINO
// ---------------------------------------------------------------------
// Só pedimos a rota quando carregas num avião. As respostas ficam guardadas
// numa "cache" (um Map), para não repetirmos o mesmo pedido.

const cacheRotas = new Map(); // callsign → { origem, destino, companhia } ou null (desconhecida)
let rotaAtual = null;         // a rota do avião escolhido

async function carregarRota(aviao) {
  camadaRota.clearLayers();
  rotaAtual = null;
  $("ver-rota").hidden = true;
  $("p-companhia").textContent = "";
  mostrarAeroportos("…", "A procurar…", "…", "");

  const callsign = aviao.callsign;
  if (!callsign) return mostrarRotaDesconhecida();

  let rota;
  if (cacheRotas.has(callsign)) {
    rota = cacheRotas.get(callsign); // já a tínhamos: não pedimos outra vez
  } else {
    try {
      const resposta = await fetch(URL_ROTA + encodeURIComponent(callsign));
      if (resposta.status === 404) {
        rota = null; // a base de dados não conhece este voo
      } else if (!resposta.ok) {
        throw new Error("código " + resposta.status);
      } else {
        const dados = await resposta.json();
        const r = dados.response && dados.response.flightroute;
        rota = r ? { origem: r.origin, destino: r.destination, companhia: r.airline } : null;
      }
      cacheRotas.set(callsign, rota); // guardar na cache (mesmo que seja "desconhecida")
    } catch (erro) {
      // Falha de rede ou limite da adsbdb: não guardamos, para poder tentar outra vez
      if (selecionado === aviao.icao24) {
        mostrarAeroportos("?", "Não foi possível obter a rota agora. Tenta clicar outra vez daqui a pouco.", "?", "");
      }
      return;
    }
  }

  // Se entretanto escolheste outro avião, ignoramos esta resposta
  if (selecionado !== aviao.icao24) return;
  if (!rota) return mostrarRotaDesconhecida();

  rotaAtual = rota;
  mostrarAeroportos(
    codigoAeroporto(rota.origem), descreverAeroporto(rota.origem),
    codigoAeroporto(rota.destino), descreverAeroporto(rota.destino)
  );
  if (rota.companhia && rota.companhia.name) $("p-companhia").textContent = rota.companhia.name;
  $("ver-rota").hidden = false;
  desenharRota();
}

function codigoAeroporto(a) { return a.iata_code || a.icao_code || "?"; }
function descreverAeroporto(a) {
  return [a.name, [a.municipality, a.country_name].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

function mostrarAeroportos(codOrig, nomeOrig, codDest, nomeDest) {
  $("p-orig-codigo").textContent = codOrig;
  $("p-orig-nome").textContent = nomeOrig;
  $("p-dest-codigo").textContent = codDest;
  $("p-dest-nome").textContent = nomeDest;
}

function mostrarRotaDesconhecida() {
  mostrarAeroportos("—", "Rota desconhecida", "—", "");
}

// Calcula pontos ao longo de um "círculo máximo": o caminho mais curto
// entre dois pontos numa esfera (é por isso que as rotas parecem curvas no mapa).
function circuloMaximo(de, para, numPontos) {
  const rad = Math.PI / 180;
  const lat1 = de[0] * rad, lon1 = de[1] * rad;
  const lat2 = para[0] * rad, lon2 = para[1] * rad;
  // Distância angular entre os dois pontos
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  ));
  if (d < 1e-6) return [de, para];
  const pontos = [];
  for (let i = 0; i <= numPontos; i++) {
    const f = i / numPontos;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pontos.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / rad, Math.atan2(y, x) / rad]);
  }
  return pontos;
}

// Evita que a linha "salte" o mapa todo quando passa a longitude 180°
function desenrolarLongitudes(pontos, referencia) {
  let anterior = referencia;
  return pontos.map(([lat, lon]) => {
    while (lon - anterior > 180) lon -= 360;
    while (lon - anterior < -180) lon += 360;
    anterior = lon;
    return [lat, lon];
  });
}

// Desenha: origem → avião (linha contínua, já voado) e avião → destino (tracejado)
function desenharRota() {
  camadaRota.clearLayers();
  const aviao = ultimoVistoDoSelecionado;
  if (!rotaAtual || !aviao) return;

  const origem = [rotaAtual.origem.latitude, rotaAtual.origem.longitude];
  const destino = [rotaAtual.destino.latitude, rotaAtual.destino.longitude];
  const agora = [aviao.lat, aviao.lon];

  // Os dois troços, com a longitude "desenrolada" à volta da posição do avião
  const voado = desenrolarLongitudes(circuloMaximo(agora, origem, 64), aviao.lon).reverse();
  const falta = desenrolarLongitudes(circuloMaximo(agora, destino, 64), aviao.lon);

  L.polyline(voado, { color: "#5cc8ff", weight: 2.5, opacity: 0.9, interactive: false }).addTo(camadaRota);
  L.polyline(falta, { color: "#5cc8ff", weight: 2.5, opacity: 0.8, dashArray: "6 8", interactive: false }).addTo(camadaRota);

  // Pontos dos aeroportos, com o código sempre visível
  const marcarAeroporto = (ponto, aeroporto) =>
    L.circleMarker(ponto, { radius: 6, color: "#ffffff", weight: 2, fillColor: "#5cc8ff", fillOpacity: 1 })
      .bindTooltip(codigoAeroporto(aeroporto), { permanent: true, direction: "top", offset: [0, -8], className: "etiqueta-aeroporto" })
      .addTo(camadaRota);
  marcarAeroporto(voado[0], rotaAtual.origem);
  marcarAeroporto(falta[falta.length - 1], rotaAtual.destino);
}

// Botão "Ver a rota inteira": ajusta o zoom para caber a rota toda
$("ver-rota").addEventListener("click", () => {
  const limites = L.latLngBounds([]);
  camadaRota.eachLayer((camada) => {
    if (camada.getBounds) limites.extend(camada.getBounds());
  });
  if (limites.isValid()) {
    const largura = window.innerWidth;
    // Deixar espaço para o painel (à direita no computador, em baixo no telemóvel)
    const opcoes = largura > 700
      ? { paddingTopLeft: [40, 90], paddingBottomRight: [380, 40] }
      : { paddingTopLeft: [30, 150], paddingBottomRight: [30, window.innerHeight * 0.6] };
    mapa.fitBounds(limites, opcoes);
  }
});


// ---------------------------------------------------------------------
// 7. PESQUISA POR CALLSIGN
// ---------------------------------------------------------------------
$("pesquisa").addEventListener("submit", (e) => {
  e.preventDefault(); // não recarregar a página
  const texto = $("caixa-pesquisa").value.trim().toUpperCase().replace(/\s+/g, "");
  if (!texto) return;

  if (!avioes.length) {
    return mostrarAviso("Ainda não há dados de voos carregados. Espera pela primeira atualização.", true, 4000);
  }

  // Primeiro procuramos o callsign exato; se não houver, um que comece pelo texto
  const aviao =
    avioes.find((a) => a.callsign === texto) ||
    avioes.find((a) => a.callsign.startsWith(texto));

  if (!aviao) {
    return mostrarAviso(`Não encontrei nenhum voo no ar com o callsign «${texto}». Os callsigns usam o código ICAO da companhia (ex.: TAP em vez de TP).`, true, 6000);
  }

  esconderAviso();
  mapa.flyTo([aviao.lat, aviao.lon], Math.max(mapa.getZoom(), 7), { duration: 1.2 });
  selecionarAviao(aviao);
  $("caixa-pesquisa").blur(); // no telemóvel, fecha o teclado
});


// ---------------------------------------------------------------------
// 8. MENSAGENS DE AVISO E RELÓGIO DA BARRA DO TOPO
// ---------------------------------------------------------------------
let temporizadorAviso = null;

// mostrarAviso(texto, informativo?, duraçãoEmMs?)
function mostrarAviso(texto, informativo = false, duracao = 0) {
  const aviso = $("aviso");
  aviso.textContent = texto;
  aviso.classList.toggle("info", informativo);
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  if (duracao) temporizadorAviso = setTimeout(esconderAviso, duracao);
}
function esconderAviso() { $("aviso").hidden = true; }

// Transforma segundos num texto curto: "12 s", "3 min", "2 h"
function formatarEspera(segundos) {
  if (segundos < 60) return `${segundos} s`;
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
  return `${Math.round(segundos / 3600)} h`;
}

// Todos os segundos: atualizar o texto "atualizado há…" e a hora do painel
setInterval(() => {
  if (location.protocol === "file:") return; // sem servidor não há nada para mostrar
  const estado = $("estado");
  if (!ultimaAtualizacao) {
    estado.textContent = "A carregar os voos…";
  } else {
    const ha = Math.round((Date.now() - ultimaAtualizacao) / 1000);
    let texto = `Atualizado há ${formatarEspera(ha)}`;
    if (document.hidden) texto += " · em pausa";
    else if (proximaAtualizacao) texto += ` · próxima em ${formatarEspera(Math.max(0, Math.round((proximaAtualizacao - Date.now()) / 1000)))}`;
    // Cada atualização do mundo inteiro gasta 4 créditos da OpenSky
    if (pedidosRestantes != null) texto += ` · ≈${Math.floor(pedidosRestantes / 4)} atualizações restantes hoje`;
    estado.textContent = texto;
  }
  atualizarHora();
}, 1000);


// ---------------------------------------------------------------------
// 9. ARRANQUE
// ---------------------------------------------------------------------
ajustarCanvas();

if (location.protocol === "file:") {
  // Abriste o index.html com duplo clique: assim não funciona (vê o README)
  mostrarAviso("Esta página tem de ser aberta através do servidor local. Na pasta do projeto corre «node server.js» e abre http://localhost:8080.");
  $("estado").textContent = "Sem ligação ao servidor";
} else {
  atualizarVoos();
}
