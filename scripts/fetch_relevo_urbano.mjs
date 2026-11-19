/**
 * DrenaCity | Suscetibilidade intraurbana em escala de rua
 * ------------------------------------------------------------------
 * Para cada cidade selecionada, monta um raster de suscetibilidade a
 * alagamento com resolução de dezenas de metros, a partir de dados reais:
 *
 *   Terrarium (AWS Open Data / Mapzen)  modelo digital de elevação global
 *                                       derivado de SRTM, NASADEM e outros,
 *                                       servido em tiles PNG de 256 px
 *   Nominatim (OpenStreetMap)           localização da sede urbana e nome da
 *                                       via nos pontos mais críticos
 *
 * Método: para cada pixel calcula-se a altura acima do ponto mais baixo da
 * vizinhança (proxy do HAND, Height Above Nearest Drainage) e a declividade
 * local. Fundo de vale plano recebe suscetibilidade alta; encosta íngreme e
 * terreno elevado recebem suscetibilidade baixa. O resultado é gravado como
 * PNG colorido georreferenciado, sobreposto ao mapa pelo navegador.
 *
 * Uso: node scripts/fetch_relevo_urbano.mjs <pasta_de_cache> <cod1,cod2,...>
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CACHE = process.argv[2];
const CODIGOS = (process.argv[3] || '').split(',').filter(Boolean);
if (!CACHE || !CODIGOS.length) {
  console.error('uso: node scripts/fetch_relevo_urbano.mjs <pasta_de_cache> <cod1,cod2,...>');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'relevo');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.join(CACHE, 'tiles'), { recursive: true });

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'DrenaCity/1.0 (academic project)' };

/* ------------------------------------------------------------ catálogo    */

function catalogo() {
  const arquivo = path.join(ROOT, 'data', 'indicadores.js');
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^window\.DRENA_DADOS=/, '').replace(/;\s*$/, '');
  return new Map(JSON.parse(texto).municipios.map((m) => [m.cod, m]));
}
const CATALOGO = catalogo();

/* -------------------------------------------------------- PNG: leitura    */

function lerPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é PNG');
  const largura = buf.readUInt32BE(16);
  const altura = buf.readUInt32BE(20);
  const bits = buf[24];
  const tipo = buf[25];
  if (bits !== 8 || (tipo !== 2 && tipo !== 6)) throw new Error(`PNG não suportado (${bits}/${tipo})`);
  const canais = tipo === 2 ? 3 : 4;

  const partes = [];
  let pos = 8;
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const nome = buf.toString('ascii', pos + 4, pos + 8);
    if (nome === 'IDAT') partes.push(buf.subarray(pos + 8, pos + 8 + tam));
    if (nome === 'IEND') break;
    pos += tam + 12;
  }
  const bruto = zlib.inflateSync(Buffer.concat(partes));

  const linha = largura * canais;
  const saida = Buffer.alloc(altura * linha);
  let p = 0;
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[p++];
    const ini = y * linha;
    const anterior = ini - linha;
    for (let x = 0; x < linha; x++) {
      const bruta = bruto[p + x];
      const a = x >= canais ? saida[ini + x - canais] : 0;
      const b = y > 0 ? saida[anterior + x] : 0;
      const c = (x >= canais && y > 0) ? saida[anterior + x - canais] : 0;
      let v;
      if (filtro === 0) v = bruta;
      else if (filtro === 1) v = bruta + a;
      else if (filtro === 2) v = bruta + b;
      else if (filtro === 3) v = bruta + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = bruta + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
      }
      saida[ini + x] = v & 0xff;
    }
    p += linha;
  }
  return { largura, altura, canais, dados: saida };
}

/* -------------------------------------------------------- PNG: escrita    */

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(nome, dados) {
  const saida = Buffer.alloc(dados.length + 12);
  saida.writeUInt32BE(dados.length, 0);
  saida.write(nome, 4, 'ascii');
  dados.copy(saida, 8);
  saida.writeUInt32BE(crc32(saida.subarray(4, 8 + dados.length)), 8 + dados.length);
  return saida;
}

function escreverPng(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const linhas = Buffer.alloc(altura * (largura * 4 + 1));
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura * 4 + 1)] = 0;
    rgba.copy(linhas, y * (largura * 4 + 1) + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- geografia  */

const Z = 13;
const FAIXA_M = 14; // metros acima do fundo de vale que ainda entram na escala de cor
const nTiles = 2 ** Z;
const lon2x = (lon) => Math.floor(((lon + 180) / 360) * nTiles);
const lat2y = (lat) => Math.floor(
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * nTiles,
);
const x2lon = (x) => (x / nTiles) * 360 - 180;
const y2lat = (y) => {
  const n = Math.PI - (2 * Math.PI * y) / nTiles;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

async function baixarTile(x, y) {
  const destino = path.join(CACHE, 'tiles', `${Z}_${x}_${y}.png`);
  if (fs.existsSync(destino)) return fs.readFileSync(destino);
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destino, buf);
      return buf;
    } catch (e) {
      await dorme(1200 * (i + 1));
    }
  }
  return null;
}

async function sedeUrbana(info) {
  const destino = path.join(CACHE, `sede_${info.cod}.json`);
  if (fs.existsSync(destino)) return JSON.parse(fs.readFileSync(destino, 'utf8'));
  const url = 'https://nominatim.openstreetmap.org/search'
    + `?city=${encodeURIComponent(info.nome)}&state=${encodeURIComponent(info.uf_nome)}`
    + '&country=Brazil&format=json&limit=1';
  try {
    const res = await fetch(url, { headers: UA });
    const j = await res.json();
    if (j && j[0]) {
      const sede = { lat: Number(j[0].lat), lon: Number(j[0].lon) };
      fs.writeFileSync(destino, JSON.stringify(sede));
      await dorme(1200);
      return sede;
    }
  } catch (e) {
    console.warn(`  sede de ${info.nome} não localizada: ${e.message}`);
  }
  return { lat: info.lat, lon: info.lon };
}

const CACHE_VIA = path.join(CACHE, 'vias.json');
const vias = fs.existsSync(CACHE_VIA) ? JSON.parse(fs.readFileSync(CACHE_VIA, 'utf8')) : {};

async function nomeDaVia(lat, lon) {
  const chave = `${lat},${lon}`;
  if (vias[chave]) return vias[chave];
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=17&addressdetails=1`;
    const res = await fetch(url, { headers: UA });
    const j = await res.json();
    const e = j.address || {};
    const via = e.road || e.pedestrian || e.residential || null;
    const bairro = e.suburb || e.neighbourhood || e.city_district || null;
    const cidade = e.city || e.town || e.municipality || e.village || null;
    vias[chave] = { via, bairro, cidade };
    fs.writeFileSync(CACHE_VIA, JSON.stringify(vias));
    await dorme(1200);
    return vias[chave];
  } catch (e) {
    return { via: null, bairro: null, cidade: null };
  }
}

/* ------------------------------------------------------- filtro de mínimo */

// Mínimo deslizante em janela, aplicado em linhas e depois em colunas.
function minimoJanela(dados, largura, altura, raio) {
  const tmp = new Float32Array(dados.length);
  const fila = new Int32Array(Math.max(largura, altura));

  for (let y = 0; y < altura; y++) {
    let ini = 0;
    let fim = 0;
    const base = y * largura;
    for (let x = 0; x < largura + raio; x++) {
      if (x < largura) {
        const v = dados[base + x];
        while (fim > ini && dados[base + fila[fim - 1]] >= v) fim--;
        fila[fim++] = x;
      }
      const alvo = x - raio;
      if (alvo >= 0) {
        while (fila[ini] < alvo - raio) ini++;
        tmp[base + alvo] = dados[base + fila[ini]];
      }
    }
  }

  const saida = new Float32Array(dados.length);
  for (let x = 0; x < largura; x++) {
    let ini = 0;
    let fim = 0;
    for (let y = 0; y < altura + raio; y++) {
      if (y < altura) {
        const v = tmp[y * largura + x];
        while (fim > ini && tmp[fila[fim - 1] * largura + x] >= v) fim--;
        fila[fim++] = y;
      }
      const alvo = y - raio;
      if (alvo >= 0) {
        while (fila[ini] < alvo - raio) ini++;
        saida[alvo * largura + x] = tmp[fila[ini] * largura + x];
      }
    }
  }
  return saida;
}

/* ----------------------------------------------------------------- cores  */

// Rampa plasma: legível sobre mapa escuro e segura para daltonismo.
const PLASMA = [
  [13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150], [203, 70, 121],
  [229, 107, 93], [248, 148, 65], [253, 195, 40], [240, 249, 33],
];

function plasma(t) {
  const p = Math.min(Math.max(t, 0), 1) * (PLASMA.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  const a = PLASMA[i];
  const b = PLASMA[Math.min(i + 1, PLASMA.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/* --------------------------------------------------------------- pipeline */

const saida = {};
const destinoJs = path.join(ROOT, 'data', 'relevo.js');
if (fs.existsSync(destinoJs)) {
  const texto = fs.readFileSync(destinoJs, 'utf8').replace(/^window\.DRENA_RELEVO=/, '').replace(/;\s*$/, '');
  Object.assign(saida, JSON.parse(texto));
}

for (const cod of CODIGOS) {
  const info = CATALOGO.get(cod);
  if (!info) { console.warn(`código ${cod} fora da base`); continue; }
  console.log(`\n${info.nome} (${info.uf})`);

  const sede = await sedeUrbana(info);

  // janela proporcional ao porte urbano, limitada para manter o arquivo leve
  const grau = info.pop_urbana > 1500000 ? 0.26 : info.pop_urbana > 400000 ? 0.17 : 0.11;
  const x0 = lon2x(sede.lon - grau);
  const x1 = lon2x(sede.lon + grau);
  const y0 = lat2y(sede.lat + grau * 0.85);
  const y1 = lat2y(sede.lat - grau * 0.85);
  const nx = x1 - x0 + 1;
  const ny = y1 - y0 + 1;
  console.log(`  ${nx} x ${ny} tiles em zoom ${Z}`);

  const largura = nx * 256;
  const altura = ny * 256;
  const elev = new Float32Array(largura * altura);
  let baixados = 0;

  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const buf = await baixarTile(x0 + tx, y0 + ty);
      if (!buf) continue;
      baixados++;
      let png;
      try { png = lerPng(buf); } catch (e) { console.warn(`  tile ${tx},${ty}: ${e.message}`); continue; }
      const { dados, canais } = png;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * canais;
          const h = dados[i] * 256 + dados[i + 1] + dados[i + 2] / 256 - 32768;
          elev[(ty * 256 + y) * largura + tx * 256 + x] = h;
        }
      }
    }
    process.stdout.write(`\r  tiles: ${baixados}/${nx * ny}`);
  }
  console.log('');

  const metrosPorPixel = (156543.03392 * Math.cos((sede.lat * Math.PI) / 180)) / 2 ** Z;
  const raio = Math.max(8, Math.round(2500 / metrosPorPixel));
  const raioCurto = Math.max(4, Math.round(600 / metrosPorPixel));
  const minLocal = minimoJanela(elev, largura, altura, raio);
  const minCurto = minimoJanela(elev, largura, altura, raioCurto);

  // Altura acima do fundo de vale em duas escalas: a curta capta depressões de
  // quadra, a longa capta a planície de inundação da bacia.
  const alturas = new Float32Array(largura * altura);
  const BINS = 800;
  const hist = new Float64Array(BINS);
  let nLand = 0;
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < -1) { alturas[i] = -1; continue; }
    const h = 0.45 * Math.max(elev[i] - minCurto[i], 0) + 0.55 * Math.max(elev[i] - minLocal[i], 0);
    alturas[i] = h;
    hist[Math.min(BINS - 1, Math.floor(h * 8))]++;
    nLand++;
  }
  // distribuição acumulada das alturas, para posicionar cada pixel na cidade
  const cdf = new Float64Array(BINS);
  let acc = 0;
  for (let i = 0; i < BINS; i++) { acc += hist[i]; cdf[i] = nLand ? acc / nLand : 0; }

  // suscetibilidade por pixel
  const risco = new Float32Array(largura * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = y * largura + x;
      const e = elev[i];
      if (e < -1) { risco[i] = -1; continue; } // mar ou corpo d'água profundo
      const h = alturas[i];
      const xe = Math.min(x + 1, largura - 1);
      const xd = Math.max(x - 1, 0);
      const yb = Math.min(y + 1, altura - 1);
      const yc = Math.max(y - 1, 0);
      const dzdx = (elev[y * largura + xe] - elev[y * largura + xd]) / (2 * metrosPorPixel);
      const dzdy = (elev[yb * largura + x] - elev[yc * largura + x]) / (2 * metrosPorPixel);
      const decl = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      // A cor mapeia diretamente os metros acima do fundo de vale mais próximo:
      // 0 m no topo da rampa, 14 m ou mais fora da faixa de interesse.
      const porCota = (1 - Math.min(h / FAIXA_M, 1)) ** 1.25;
      const porDeclive = 1 - Math.min(decl / 0.12, 1) * 0.45;
      risco[i] = Math.min(Math.max(porCota * porDeclive, 0), 1);
    }
  }
  // reamostragem 2x para manter o arquivo leve, com ~35 m por pixel
  const fator = 2;
  const lw = Math.floor(largura / fator);
  const lh = Math.floor(altura / fator);
  const rgba = Buffer.alloc(lw * lh * 4);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      let soma = 0;
      let n = 0;
      for (let dy = 0; dy < fator; dy++) {
        for (let dx = 0; dx < fator; dx++) {
          const v = risco[(y * fator + dy) * largura + x * fator + dx];
          if (v >= 0) { soma += v; n++; }
        }
      }
      const i = (y * lw + x) * 4;
      if (!n) { rgba[i + 3] = 0; continue; }
      const v = Math.round((soma / n) * 32) / 32;
      const [r, g, b] = plasma(v);
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = v < 0.1 ? 0 : Math.round(Math.min(40 + v * 195, 235));
    }
  }

  const png = escreverPng(lw, lh, rgba);
  fs.writeFileSync(path.join(OUT_DIR, `${cod}.png`), png);

  // pontos críticos: máximos locais de suscetibilidade, bem separados
  const candidatos = [];
  const passo = Math.round(400 / metrosPorPixel);
  for (let y = raio; y < altura - raio; y += passo) {
    for (let x = raio; x < largura - raio; x += passo) {
      const v = risco[y * largura + x];
      if (v > 0.45) candidatos.push({ x, y, v });
    }
  }
  candidatos.sort((a, b) => b.v - a.v);
  const escolhidos = [];
  const minSep = Math.round(1800 / metrosPorPixel);
  for (const c of candidatos) {
    if (escolhidos.every((e) => Math.hypot(e.x - c.x, e.y - c.y) > minSep)) escolhidos.push(c);
    if (escolhidos.length === 26) break;
  }

  const pontos = [];
  for (const c of escolhidos) {
    if (pontos.filter((p) => p.via).length >= 5) break;
    if (pontos.length >= 22) break;
    const lon = x2lon(x0 + c.x / 256);
    const lat = y2lat(y0 + c.y / 256);
    const { via, bairro, cidade } = await nomeDaVia(lat.toFixed(5), lon.toFixed(5));
    pontos.push({
      lat: +lat.toFixed(5),
      lon: +lon.toFixed(5),
      risco: +c.v.toFixed(2),
      cota: Math.round(elev[c.y * largura + c.x]),
      acima_do_fundo: Math.round(alturas[c.y * largura + c.x]),
      via,
      bairro,
      cidade,
    });
  }
  pontos.sort((a, b) => (b.via ? 1 : 0) - (a.via ? 1 : 0) || b.risco - a.risco);
  pontos.length = Math.min(pontos.length, 5);

  saida[cod] = {
    nome: info.nome,
    uf: info.uf,
    bounds: [[y2lat(y1 + 1), x2lon(x0)], [y2lat(y0), x2lon(x1 + 1)]],
    arquivo: `data/relevo/${cod}.png`,
    versao: Date.now().toString(36),
    metros_por_pixel: +(metrosPorPixel * fator).toFixed(1),
    pontos,
  };
  fs.writeFileSync(destinoJs, `window.DRENA_RELEVO=${JSON.stringify(saida)};\n`);
  console.log(`  ok: ${lw}x${lh} px, ${(png.length / 1024).toFixed(0)} kB, ${pontos.length} pontos críticos`);
  for (const p of pontos) console.log(`     ${p.via || 'via não mapeada'}${p.bairro ? `, ${p.bairro}` : ''} (${p.acima_do_fundo} m acima do fundo de vale)`);
}

console.log('\ngravado:', destinoJs);
