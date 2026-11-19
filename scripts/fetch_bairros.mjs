/**
 * DrenaCity | Camada intraurbana (bairros)
 * ------------------------------------------------------------------
 * Para cada município selecionado, monta a camada de bairros com dados reais:
 *
 *   OpenStreetMap (Overpass API)
 *     limites administrativos de bairro (admin_level 10, ODbL)
 *     hidrografia urbana (waterway = river, stream, canal)
 *
 *   Open-Meteo / Copernicus DEM GLO-90
 *     altimetria amostrada em 5 pontos por bairro
 *
 * O risco intraurbano é relativo à própria cidade e combina cota altimétrica,
 * declividade local e distância ao curso d'água mais próximo, que são os
 * fatores físicos dominantes do alagamento urbano.
 *
 * Uso: node scripts/fetch_bairros.mjs <pasta_de_cache> [cod_ibge,cod_ibge,...]
 */

import fs from 'node:fs';
import path from 'node:path';

const CACHE = process.argv[2];
const CODIGOS = (process.argv[3] || '').split(',').filter(Boolean);
if (!CACHE || !CODIGOS.length) {
  console.error('uso: node scripts/fetch_bairros.mjs <pasta_de_cache> <cod1,cod2,...>');
  process.exit(1);
}

// Instâncias públicas do Overpass. A principal costuma recusar carga em horário
// de pico, então o coletor alterna entre espelhos antes de desistir da cidade.
const ESPELHOS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const arq = (n) => path.join(CACHE, n);

async function overpass(query, nome, tentativas = 1) {
  if (fs.existsSync(arq(nome))) return JSON.parse(fs.readFileSync(arq(nome), 'utf8'));
  for (let volta = 1; volta <= tentativas; volta++) {
    for (const ep of ESPELHOS) {
      try {
        const ctrl = AbortSignal.timeout(120000);
        const res = await fetch(ep, {
          method: 'POST',
          body: query,
          signal: ctrl,
          headers: { 'Content-Type': 'text/plain', 'User-Agent': 'DrenaCity/1.0 (academic project)' },
        });
        if (res.ok) {
          const json = await res.json();
          fs.writeFileSync(arq(nome), JSON.stringify(json));
          return json;
        }
        console.warn(`  ${nome}: ${new URL(ep).host} respondeu ${res.status}`);
      } catch (e) {
        console.warn(`  ${nome}: ${new URL(ep).host} falhou (${e.message})`);
      }
      await dorme(3000);
    }
    await dorme(10000 * volta);
  }
  return null;
}

// Lê nome e UF de cada município a partir da base já construída.
function catalogo() {
  const arquivo = path.resolve(import.meta.dirname, '..', 'data', 'indicadores.js');
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^window\.DRENA_DADOS=/, '').replace(/;\s*$/, '');
  const dados = JSON.parse(texto);
  return new Map(dados.municipios.map((m) => [m.cod, m]));
}
const CATALOGO = catalogo();

/* ------------------------------------------------------------- geometria */

// Junta os trechos (ways) de uma relação em anéis fechados.
function montarAneis(membros) {
  const trechos = membros
    .filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map((m) => m.geometry.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]));
  const aneis = [];
  const usados = new Set();

  for (let i = 0; i < trechos.length; i++) {
    if (usados.has(i)) continue;
    usados.add(i);
    const anel = trechos[i].slice();
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      const fim = anel[anel.length - 1];
      const ini = anel[0];
      if (fim[0] === ini[0] && fim[1] === ini[1]) break;
      for (let j = 0; j < trechos.length; j++) {
        if (usados.has(j)) continue;
        const t = trechos[j];
        const a = t[0];
        const b = t[t.length - 1];
        if (a[0] === fim[0] && a[1] === fim[1]) { anel.push(...t.slice(1)); usados.add(j); cresceu = true; break; }
        if (b[0] === fim[0] && b[1] === fim[1]) { anel.push(...t.slice(0, -1).reverse()); usados.add(j); cresceu = true; break; }
      }
    }
    if (anel.length > 3) {
      const p = anel[0];
      const u = anel[anel.length - 1];
      if (p[0] !== u[0] || p[1] !== u[1]) anel.push(p);
      aneis.push(anel);
    }
  }
  return aneis;
}

const RAD = Math.PI / 180;
const R = 6378137;

function areaAnel(anel) {
  let total = 0;
  for (let i = 0; i < anel.length; i++) {
    const p1 = anel[i];
    const p2 = anel[(i + 1) % anel.length];
    const p3 = anel[(i + 2) % anel.length];
    total += (p3[0] * RAD - p1[0] * RAD) * Math.sin(p2[1] * RAD);
  }
  return Math.abs(total * R * R / 2);
}

function distanciaM(a, b) {
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD) * 111320;
  const dy = (a[1] - b[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ------------------------------------------------------------- pipeline  */

const destino = path.resolve(import.meta.dirname, '..', 'data', 'bairros.js');
const saida = {};
if (fs.existsSync(destino)) {
  const texto = fs.readFileSync(destino, 'utf8').replace(/^window\.DRENA_BAIRROS=/, '').trim().replace(/;$/, '');
  try { Object.assign(saida, JSON.parse(texto)); } catch (e) { /* arquivo vazio */ }
}

for (const cod of CODIGOS) {
  const info = CATALOGO.get(cod);
  if (!info) { console.warn(`código ${cod} não está na base`); continue; }
  console.log(`\n${info.nome} (${info.uf})`);

  // A cidade é localizada pelo nome dentro da área do estado, o que evita
  // confundir homônimos em unidades da federação diferentes.
  const escopo = `area["name"="${info.uf_nome}"]["admin_level"="4"]["boundary"="administrative"]->.uf;
rel(area.uf)["name"="${info.nome}"]["admin_level"="8"]["boundary"="administrative"];
map_to_area->.a;`;

  const qBairros = `[out:json][timeout:180];
${escopo}
rel(area.a)["boundary"="administrative"]["admin_level"~"^(10|9)$"];
out geom;`;
  const bairrosRaw = await overpass(qBairros, `osm_bairros_${cod}.json`);
  if (!bairrosRaw || !bairrosRaw.elements.length) {
    console.warn('  sem bairros mapeados no OpenStreetMap');
    continue;
  }
  await dorme(2500);

  const qAgua = `[out:json][timeout:180];
${escopo}
way(area.a)["waterway"~"^(river|stream|canal)$"];
out geom;`;
  const aguaRaw = await overpass(qAgua, `osm_agua_${cod}.json`);
  await dorme(2500);

  const linhasAgua = (aguaRaw?.elements || [])
    .filter((e) => e.geometry)
    .map((e) => e.geometry.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]));

  const bairros = [];
  for (const el of bairrosRaw.elements) {
    const aneis = montarAneis(el.members || []);
    if (!aneis.length) continue;
    aneis.sort((a, b) => areaAnel(b) - areaAnel(a));
    const principal = aneis[0];
    const area = areaAnel(principal) / 1e6;
    if (area <= 0.01) continue;

    let x = 0;
    let y = 0;
    for (const p of principal) { x += p[0]; y += p[1]; }
    const centro = [+(x / principal.length).toFixed(5), +(y / principal.length).toFixed(5)];

    let dist = 99999;
    for (const linha of linhasAgua) {
      for (const p of linha) {
        const d = distanciaM(centro, p);
        if (d < dist) dist = d;
      }
    }

    bairros.push({
      nome: el.tags.name || `Bairro ${el.id}`,
      centro,
      area_km2: +area.toFixed(2),
      dist_agua_m: dist === 99999 ? null : Math.round(dist),
      anel: principal,
    });
  }
  console.log(`  ${bairros.length} bairros, ${linhasAgua.length} trechos de hidrografia`);

  // altimetria: centro + 4 pontos a ~1,1 km
  const D = 0.01;
  for (let i = 0; i < bairros.length; i += 20) {
    const lote = bairros.slice(i, i + 20);
    const lats = [];
    const lons = [];
    for (const b of lote) {
      lats.push(b.centro[1], b.centro[1] + D, b.centro[1] - D, b.centro[1], b.centro[1]);
      lons.push(b.centro[0], b.centro[0], b.centro[0], b.centro[0] + D, b.centro[0] - D);
    }
    try {
      const pontos = [];
      for (let k = 0; k < lats.length; k++) pontos.push(`${lats[k].toFixed(5)},${lons[k].toFixed(5)}`);
      const res = await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${pontos.join('|')}`, {
        headers: { 'User-Agent': 'DrenaCity/1.0 (academic project)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const el = (await res.json()).results.map((r) => (r.elevation === null ? 0 : r.elevation));
      lote.forEach((b, k) => {
        const p = el.slice(k * 5, k * 5 + 5).map((v) => (v === null ? 0 : v));
        b.alt = Math.round(p[0]);
        b.alt_min = Math.round(Math.min(...p));
        b.alt_max = Math.round(Math.max(...p));
      });
    } catch (e) {
      console.warn(`  altimetria lote ${i}: ${e.message}`);
      await dorme(4000);
      i -= 20;
      continue;
    }
    await dorme(1100);
  }

  // índice intraurbano relativo à cidade
  const alts = bairros.map((b) => b.alt).filter((v) => v != null);
  const altMin = Math.min(...alts);
  const altMax = Math.max(...alts);
  const faixa = Math.max(altMax - altMin, 1);
  const distMax = Math.max(...bairros.map((b) => b.dist_agua_m ?? 5000), 1);

  for (const b of bairros) {
    const cota = 100 * (1 - (b.alt - altMin) / faixa);            // quanto mais baixo, maior
    const relevo = 100 * (1 - Math.min((b.alt_max - b.alt_min) / 60, 1)); // plano = pior drenagem
    const agua = 100 * (1 - Math.min((b.dist_agua_m ?? distMax) / 2500, 1));
    b.c = { cota: Math.round(cota), relevo: Math.round(relevo), agua: Math.round(agua) };
    b.indice = +(0.45 * cota + 0.2 * relevo + 0.35 * agua).toFixed(1);
    delete b.centro;
  }

  bairros.sort((a, b) => b.indice - a.indice);
  bairros.forEach((b, i) => { b.rank = i + 1; });

  saida[cod] = {
    bairros: bairros.map((b) => ({
      nome: b.nome,
      area_km2: b.area_km2,
      alt: b.alt,
      alt_min: b.alt_min,
      alt_max: b.alt_max,
      dist_agua_m: b.dist_agua_m,
      indice: b.indice,
      rank: b.rank,
      c: b.c,
      anel: b.anel,
    })),
  };
  fs.writeFileSync(destino, `window.DRENA_BAIRROS=${JSON.stringify(saida)};
`);
  console.log(`  ok: maior risco em ${bairros[0].nome} (${bairros[0].indice})`);
}

fs.writeFileSync(destino, `window.DRENA_BAIRROS=${JSON.stringify(saida)};\n`);
console.log('\ngravado:', destino, Object.keys(saida).length, 'municípios');
