/**
 * DrenaCity | Coleta de dados públicos reais
 * ------------------------------------------------------------------
 * Baixa e consolida, em cache local, todas as bases usadas pela plataforma:
 *
 *  IBGE / API de Agregados (SIDRA)
 *    4714  Censo 2022: população residente, área territorial, densidade
 *    8418  Áreas Urbanizadas do Brasil 2019: área urbanizada e área densa
 *    9883  Censo 2022: número de favelas e comunidades urbanas
 *    9888  Censo 2022: população residente em favelas e comunidades urbanas
 *    8536  Munic 2020: municípios atingidos por enchentes, enxurradas e deslizamentos
 *    8537  Munic 2020: áreas atingidas e intervenções contra enchentes
 *    1764  PNSB 2008: municípios que sofreram inundações/alagamentos urbanos em 5 anos
 *    1255  PNSB 2008: drenagem exclusivamente superficial nas ruas pavimentadas
 *    1665  PNSB 2008: dispositivo de detenção/amortecimento de vazão
 *    1027  PNSB 2008: existência de serviço de manejo de águas pluviais
 *    2238  PNSB 2000: extensão da rede de drenagem urbana (km)
 *
 *  IBGE / API de Malhas v3
 *    malha municipal e estadual, lista de municípios
 *
 *  Open-Meteo (reanálise ERA5 e modelo digital de elevação Copernicus GLO-90)
 *    precipitação diária 2015-2024 em grade de 0,5 grau
 *    altimetria amostrada em 5 pontos por município
 *
 * Uso: node scripts/fetch_dados.mjs <pasta_de_cache>
 */

import fs from 'node:fs';
import path from 'node:path';

const CACHE = process.argv[2];
if (!CACHE) {
  console.error('informe a pasta de cache: node scripts/fetch_dados.mjs <pasta>');
  process.exit(1);
}
fs.mkdirSync(CACHE, { recursive: true });

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const arquivo = (nome) => path.join(CACHE, nome);
const existe = (nome) => fs.existsSync(arquivo(nome)) && fs.statSync(arquivo(nome)).size > 100;
const lerJson = (nome) => JSON.parse(fs.readFileSync(arquivo(nome), 'utf8'));
const gravar = (nome, obj) => fs.writeFileSync(arquivo(nome), JSON.stringify(obj));

async function baixar(url, nome, tentativas = 4) {
  if (existe(nome)) return lerJson(nome);
  for (let i = 1; i <= tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'DrenaCity/1.0 (projeto academico)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      gravar(nome, json);
      console.log(`  ok ${nome}`);
      return json;
    } catch (e) {
      console.warn(`  tentativa ${i} de ${nome} falhou: ${e.message}`);
      if (i === tentativas) throw e;
      await dorme(1500 * i);
    }
  }
  return null;
}

const SIDRA = 'https://servicodados.ibge.gov.br/api/v3/agregados';

/* ------------------------------------------------------- 1. IBGE: malhas */

console.log('1/5 malhas e lista de municípios (IBGE)');
await baixar(
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio',
  'mun.json',
);
await baixar(
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=intermediaria&intrarregiao=UF',
  'uf.json',
);
await baixar('https://servicodados.ibge.gov.br/api/v1/localidades/municipios', 'munlist.json');

/* ------------------------------------------------- 2. IBGE: tabelas SIDRA */

console.log('2/5 tabelas do IBGE (Censo, Munic, PNSB, Áreas Urbanizadas)');

const TABELAS = [
  ['censo.json', '4714/periodos/2022/variaveis/93|6318|614?localidades=N6[all]'],
  ['urbanizada.json', '8418/periodos/2019/variaveis/12749|12747?localidades=N6[all]'],
  ['favelas_num.json', '9883/periodos/2022/variaveis/9910?localidades=N6[all]'],
  ['favelas_pop.json', '9888/periodos/2022/variaveis/9612?localidades=N6[all]'],
  ['munic_desastres.json', '8536/periodos/2020/variaveis/12443|12444|12445?localidades=N6[all]&classificacao=1210[all]'],
  ['munic_areas.json', '8537/periodos/2020/variaveis/12443?localidades=N6[all]&classificacao=1214[50900]'],
  ['munic_interv.json', '8537/periodos/2020/variaveis/12443?localidades=N6[all]&classificacao=1215[50935]'],
  ['pnsb_inundacao.json', '1764/periodos/2008/variaveis/444?localidades=N6[all]&classificacao=360[8486]'],
  ['pnsb_superficial.json', '1255/periodos/2008/variaveis/78?localidades=N6[all]&classificacao=28[516]'],
  ['pnsb_detencao.json', '1665/periodos/2008/variaveis/391?localidades=N6[all]&classificacao=340[8056]'],
  ['pnsb_manejo.json', '1027/periodos/2008/variaveis/2604?localidades=N6[all]&classificacao=12965[120946]'],
  ['pnsb_rede_km.json', '2238/periodos/2000/variaveis/1165?localidades=N6[all]&classificacao=12128[101303]'],
];

for (const [nome, caminho] of TABELAS) {
  await baixar(`${SIDRA}/${caminho}`, nome);
  await dorme(250);
}

/* ------------------------------------------------- 3. centroides e bboxes */

console.log('3/5 centroides dos municípios');

function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

const RAD = Math.PI / 180;
const R = 6378137;

function ringArea(ring) {
  let total = 0;
  const n = ring.length;
  if (n <= 2) return 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const p3 = ring[(i + 2) % n];
    total += (p3[0] * RAD - p1[0] * RAD) * Math.sin(p2[1] * RAD);
  }
  return Math.abs(total * R * R / 2);
}

let centroides;
if (existe('centroides.json')) {
  centroides = lerJson('centroides.json');
} else {
  const malha = lerJson('mun.json');
  centroides = malha.features.map((f) => {
    let best = null;
    let bestA = -1;
    let area = 0;
    for (const poly of polygonsOf(f.geometry)) {
      const a = ringArea(poly[0]);
      area += a;
      for (let i = 1; i < poly.length; i++) area -= ringArea(poly[i]);
      if (a > bestA) { bestA = a; best = poly[0]; }
    }
    let x = 0;
    let y = 0;
    for (const pt of best) { x += pt[0]; y += pt[1]; }
    return {
      cod: String(f.properties.codarea),
      lat: +(y / best.length).toFixed(4),
      lon: +(x / best.length).toFixed(4),
      area_geom: +(area / 1e6).toFixed(2),
    };
  });
  gravar('centroides.json', centroides);
  console.log(`  ${centroides.length} centroides calculados`);
}

/* ------------------------------------------------------------ 4. relevo  */

console.log('4/5 altimetria (Open Topo Data / SRTM 90 m)');

const DELTA = 0.04; // ~4,4 km em latitude
const relevo = existe('relevo.json') ? lerJson('relevo.json') : {};

const pendentes = centroides.filter((c) => !relevo[c.cod]);
console.log(`  ${pendentes.length} municípios pendentes`);

for (let i = 0; i < pendentes.length; i += 20) {
  const lote = pendentes.slice(i, i + 20);
  const pontos = [];
  for (const c of lote) {
    pontos.push(
      `${c.lat},${c.lon}`,
      `${(c.lat + DELTA).toFixed(4)},${c.lon}`,
      `${(c.lat - DELTA).toFixed(4)},${c.lon}`,
      `${c.lat},${(c.lon + DELTA).toFixed(4)}`,
      `${c.lat},${(c.lon - DELTA).toFixed(4)}`,
    );
  }
  try {
    const res = await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${pontos.join('|')}`, {
      headers: { 'User-Agent': 'DrenaCity/1.0 (academic project)' },
    });
    if (res.status === 429) { console.warn('  limite atingido, aguardando 60s'); await dorme(60000); i -= 20; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const el = json.results.map((r) => (r.elevation === null ? 0 : r.elevation));
    lote.forEach((c, k) => {
      const p = el.slice(k * 5, k * 5 + 5);
      relevo[c.cod] = {
        alt: Math.round(p[0]),
        min: Math.round(Math.min(...p)),
        max: Math.round(Math.max(...p)),
      };
    });
  } catch (e) {
    console.warn(`  lote ${i} falhou: ${e.message}`);
    await dorme(4000);
    i -= 20;
    continue;
  }
  if ((i / 20) % 25 === 0) {
    gravar('relevo.json', relevo);
    console.log(`  ${Object.keys(relevo).length}/${centroides.length}`);
  }
  await dorme(1100); // a API pública aceita 1 chamada por segundo
}
gravar('relevo.json', relevo);
console.log(`  relevo completo: ${Object.keys(relevo).length} municípios`);

/* ------------------------------------------------------------- 5. clima  */

console.log('5/5 precipitação diária 2015-2024 (NASA POWER, grade de 0,5 grau)');

// A API regional da NASA POWER devolve a grade inteira de uma caixa de 10 graus
// por requisição, o que cobre o Brasil com 16 caixas por ano.
const ANOS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const CAIXAS = [];
for (let la = -35; la < 6; la += 10) {
  for (let lo = -75; lo < -33; lo += 10) {
    CAIXAS.push({ latMin: la, latMax: Math.min(la + 10, 6), lonMin: lo, lonMax: Math.min(lo + 10, -33) });
  }
}

const acum = existe('clima_acum.json') ? lerJson('clima_acum.json') : { feitos: [], pontos: {} };
const feitos = new Set(acum.feitos);
const totalTarefas = CAIXAS.length * ANOS.length;
console.log(`  ${CAIXAS.length} caixas x ${ANOS.length} anos = ${totalTarefas} requisições (${feitos.size} já feitas)`);

for (const caixa of CAIXAS) {
  for (const ano of ANOS) {
    const chave = `${caixa.latMin}_${caixa.lonMin}_${ano}`;
    if (feitos.has(chave)) continue;
    const url = 'https://power.larc.nasa.gov/api/temporal/daily/regional'
      + '?parameters=PRECTOTCORR&community=ag&format=json'
      + `&latitude-min=${caixa.latMin}&latitude-max=${caixa.latMax}`
      + `&longitude-min=${caixa.lonMin}&longitude-max=${caixa.lonMax}`
      + `&start=${ano}0101&end=${ano}1231`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'DrenaCity/1.0 (academic project)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      for (const f of json.features || []) {
        const [lon, lat] = f.geometry.coordinates;
        const k = `${lat}|${lon}`;
        const serie = Object.values(f.properties.parameter.PRECTOTCORR).filter((v) => v > -900);
        if (!serie.length) continue;
        const p = acum.pontos[k] || { anos: 0, total: 0, max: 0, fortes: 0, max_abs: 0 };
        const total = serie.reduce((s, v) => s + Math.max(v, 0), 0);
        const max = Math.max(...serie);
        const fortes = serie.filter((v) => v >= 50).length;
        p.anos++;
        p.total += total;
        p.max += max;
        p.fortes += fortes;
        if (max > p.max_abs) p.max_abs = max;
        acum.pontos[k] = p;
      }
      feitos.add(chave);
      acum.feitos = [...feitos];
      gravar('clima_acum.json', acum);
      if (feitos.size % 10 === 0) console.log(`  ${feitos.size}/${totalTarefas} requisições`);
    } catch (e) {
      console.warn(`  ${chave} falhou: ${e.message}`);
      await dorme(6000);
    }
    await dorme(600);
  }
}

const clima = {};
for (const [k, p] of Object.entries(acum.pontos)) {
  if (!p.anos) continue;
  clima[k] = {
    anual: Math.round(p.total / p.anos),
    max24h: Math.round(p.max / p.anos),
    max_abs: Math.round(p.max_abs),
    dias_fortes: +(p.fortes / p.anos).toFixed(1),
  };
}
gravar('clima.json', clima);
console.log(`  clima consolidado: ${Object.keys(clima).length} pontos de grade`);

console.log('\nColeta finalizada. Cache em:', CACHE);
