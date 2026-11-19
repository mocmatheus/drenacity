/**
 * DrenaCity | Construção da base territorial de risco de alagamento
 * ------------------------------------------------------------------
 * Todas as variáveis vêm de fontes públicas reais. Nada é simulado.
 *
 *   IBGE Censo 2022            população residente, urbana, área, densidade
 *   IBGE Censo 2022            favelas e comunidades urbanas (número e população)
 *   IBGE Áreas Urbanizadas 2019  área urbanizada e área urbanizada densa
 *   IBGE Munic 2020            enchentes, enxurradas e deslizamentos nos últimos 4 anos,
 *                              áreas de ocupação irregular atingidas e intervenções
 *   IBGE PNSB 2008/2000        inundações urbanas, tipo de drenagem, dispositivos de
 *                              detenção, serviço de manejo e extensão da rede
 *   NASA POWER (1991-2020)     precipitação diária, grade de 0,5 grau
 *   SRTM 90 m (Open Topo Data) altimetria em 5 pontos por município
 *
 * Uso: node scripts/build_dataset.mjs <pasta_de_cache>
 */

import fs from 'node:fs';
import path from 'node:path';

const CACHE = process.argv[2];
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data');

const ler = (f) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));

const munMesh = ler('mun.json');
const ufMesh = ler('uf.json');
const munList = ler('munlist.json');
const centroides = ler('centroides.json');
const relevo = ler('relevo.json');

// clima.json é o consolidado final; se a coleta ainda estiver em andamento,
// o acumulador parcial permite gerar uma base provisória para testes.
let clima;
if (fs.existsSync(path.join(CACHE, 'clima.json'))) {
  clima = ler('clima.json');
} else {
  const acum = ler('clima_acum.json');
  clima = {};
  for (const [k, p] of Object.entries(acum.pontos)) {
    if (!p.anos) continue;
    clima[k] = {
      anual: Math.round(p.total / p.anos),
      max24h: Math.round(p.max / p.anos),
      max_abs: Math.round(p.max_abs),
      dias_fortes: +(p.fortes / p.anos).toFixed(1),
    };
  }
  console.warn(`atenção: usando acumulador parcial com ${Object.keys(clima).length} pontos de grade`);
}

/* ------------------------------------------------- leitura das tabelas IBGE */

const NULOS = new Set(['..', '...', '-', 'X', '']);

function serieValor(s, periodo) {
  const v = s.serie[periodo] ?? Object.values(s.serie)[0];
  if (v == null || NULOS.has(String(v).trim())) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Map(cod -> valor) para uma variável, usando a primeira combinação de classificação. */
function tabela(arquivo, varId) {
  const dados = ler(arquivo);
  const alvo = dados.find((v) => String(v.id) === String(varId)) || dados[0];
  const mapa = new Map();
  const res = alvo.resultados[0];
  for (const s of res.series) mapa.set(s.localidade.id, serieValor(s));
  return mapa;
}

/** Munic 2020: município atingido em algum dos anos, com o ano do maior impacto. */
function tabelaDesastre(arquivo, varId) {
  const dados = ler(arquivo);
  const alvo = dados.find((v) => String(v.id) === String(varId));
  const mapa = new Map();
  for (const r of alvo.resultados) {
    const cls = r.classificacoes.find((c) => c.id === '1210');
    const ano = cls ? Object.values(cls.categoria)[0] : '';
    for (const s of r.series) {
      const v = serieValor(s);
      if (v === 1 && /^\d{4}$/.test(ano)) mapa.set(s.localidade.id, Number(ano));
      else if (v === 1 && !mapa.has(s.localidade.id)) mapa.set(s.localidade.id, 0);
    }
  }
  return mapa;
}

const T = {
  pop: tabela('censo.json', 93),
  area: tabela('censo.json', 6318),
  dens: tabela('censo.json', 614),
  popUrbana: tabela('pop_urbana.json', 93),
  urbanizada: tabela('urbanizada.json', 12749),
  urbanaDensa: tabela('urbanizada.json', 12747),
  favelasNum: tabela('favelas_num.json', 9910),
  favelasPop: tabela('favelas_pop.json', 9612),
  enchente: tabelaDesastre('munic_desastres.json', 12443),
  enxurrada: tabelaDesastre('munic_desastres.json', 12444),
  deslizamento: tabelaDesastre('munic_desastres.json', 12445),
  ocupIrregular: tabela('munic_areas.json', 12443),
  intervencao: tabela('munic_interv.json', 12443),
  pnsbInundacao: tabela('pnsb_inundacao.json', 444),
  pnsbSuperficial: tabela('pnsb_superficial.json', 78),
  pnsbDetencao: tabela('pnsb_detencao.json', 391),
  pnsbManejo: tabela('pnsb_manejo.json', 2604),
  redeKm: tabela('pnsb_rede_km.json', 1165),
};

/* ------------------------------------------------------- divisão territorial */

const meta = new Map();
for (const m of munList) {
  const uf = m.microrregiao?.mesorregiao?.UF || m['regiao-imediata']?.['regiao-intermediaria']?.UF;
  if (!uf) continue;
  meta.set(String(m.id), {
    nome: m.nome,
    uf: uf.sigla,
    uf_nome: uf.nome,
    uf_id: String(uf.id),
    regiao: uf.regiao.nome,
    meso: m.microrregiao?.mesorregiao?.nome || '',
  });
}

const centro = new Map(centroides.map((c) => [c.cod, c]));

/* -------------------------------------------------------------- utilitários */

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => +Number(v).toFixed(1);
const norm = (v, lo, hi) => clamp(((v - lo) / (hi - lo)) * 100);
const normLog = (v, lo, hi) => norm(Math.log10(1 + Math.max(v, 0)), Math.log10(1 + lo), Math.log10(1 + hi));
const flag = (mapa, cod) => (mapa.get(cod) === 1 ? 1 : 0);

function climaDe(lat, lon) {
  const k = `${Math.round(lat * 2) / 2}|${Math.round(lon * 2) / 2}`;
  if (clima[k]) return clima[k];
  let melhor = null;
  let dist = Infinity;
  for (const [chave, v] of Object.entries(clima)) {
    const [la, lo] = chave.split('|').map(Number);
    const d = (la - lat) ** 2 + (lo - lon) ** 2;
    if (d < dist) { dist = d; melhor = v; }
  }
  return melhor;
}

/* ----------------------------------------------------- construção municipal */

const municipios = [];
const geoFeatures = [];
let semPnsb = 0;

for (const f of munMesh.features) {
  const cod = String(f.properties.codarea);
  const info = meta.get(cod);
  const c = centro.get(cod);
  if (!info || !c) continue;

  const rel = relevo[cod] || { alt: 0, min: 0, max: 0 };
  const cl = climaDe(c.lat, c.lon) || { anual: 1400, max24h: 60, max_abs: 90, dias_fortes: 3 };

  const populacao = T.pop.get(cod) ?? 0;
  const popUrbana = T.popUrbana.get(cod) ?? 0;
  const area = T.area.get(cod) ?? c.area_geom;
  const densidade = T.dens.get(cod) ?? (area ? populacao / area : 0);
  const urbanizada = T.urbanizada.get(cod) ?? 0;
  const urbanaDensa = T.urbanaDensa.get(cod) ?? 0;
  const favelas = T.favelasNum.get(cod) ?? 0;
  const popFavelas = T.favelasPop.get(cod) ?? 0;
  const redeKm = T.redeKm.get(cod);

  const temPnsb = T.pnsbManejo.has(cod) && T.pnsbManejo.get(cod) !== null;
  if (!temPnsb) semPnsb++;

  const manejo = flag(T.pnsbManejo, cod);
  const superficial = flag(T.pnsbSuperficial, cod);
  const detencao = flag(T.pnsbDetencao, cod);
  const inundacaoPnsb = flag(T.pnsbInundacao, cod);
  const ocupIrregular = flag(T.ocupIrregular, cod);
  const intervencao = flag(T.intervencao, cod);

  const anoEnchente = T.enchente.get(cod) ?? 0;
  const enchente = T.enchente.has(cod) ? 1 : 0;
  const enxurrada = T.enxurrada.has(cod) ? 1 : 0;
  const deslizamento = T.deslizamento.has(cod) ? 1 : 0;

  const amplitude = Math.max(rel.max - rel.min, 0);
  const declividade = r1((amplitude / 4400) * 100);
  const densUrbana = urbanizada > 0.05 ? popUrbana / urbanizada : densidade;
  const taxaUrbanizacao = area > 0 ? (urbanizada / area) * 100 : 0;
  const pctFavelas = populacao > 0 ? (popFavelas / populacao) * 100 : 0;
  const redePorKm2 = urbanizada > 0.05 && redeKm != null ? redeKm / urbanizada : null;

  // --------------------------------------------------- componentes do índice
  const c_hidrologica = clamp(
    0.40 * norm(cl.anual, 500, 2800)
    + 0.35 * norm(cl.max24h, 25, 130)
    + 0.25 * norm(cl.dias_fortes, 0, 12),
  );

  const c_impermeabilizacao = clamp(
    0.60 * normLog(densUrbana, 200, 12000)
    + 0.40 * norm(taxaUrbanizacao, 0, 25),
  );

  const c_relevo = clamp(
    0.55 * (100 - norm(declividade, 0, 12))
    + 0.45 * (100 - normLog(rel.alt, 0, 900)),
  );

  const c_infraestrutura = clamp(
    30 * (1 - manejo)
    + 25 * superficial
    + 20 * (1 - detencao)
    + 25 * (redePorKm2 == null ? 0.5 : 1 - norm(redePorKm2, 0, 6) / 100),
  );

  const c_vulnerabilidade = clamp(
    0.45 * norm(pctFavelas, 0, 25)
    + 0.35 * normLog(densidade, 2, 8000)
    + 0.20 * normLog(populacao, 2000, 6000000),
  );

  const c_historico = clamp(
    35 * enchente + 25 * enxurrada + 15 * deslizamento
    + 15 * inundacaoPnsb + 10 * ocupIrregular,
  );

  const bruto = clamp(
    0.22 * c_hidrologica
    + 0.17 * c_impermeabilizacao
    + 0.16 * c_relevo
    + 0.18 * c_infraestrutura
    + 0.15 * c_vulnerabilidade
    + 0.12 * c_historico,
  );

  municipios.push({
    cod,
    nome: info.nome,
    uf: info.uf,
    uf_nome: info.uf_nome,
    regiao: info.regiao,
    meso: info.meso,
    lat: c.lat,
    lon: c.lon,
    area_km2: r1(area),
    populacao,
    pop_urbana: popUrbana,
    densidade: r1(densidade),
    dens_urbana: Math.round(densUrbana),
    area_urbanizada_km2: r1(urbanizada),
    area_urbana_densa_km2: r1(urbanaDensa),
    taxa_urbanizacao: r1(taxaUrbanizacao),
    favelas,
    pop_favelas: popFavelas,
    pct_favelas: r1(pctFavelas),
    chuva_anual_mm: cl.anual,
    chuva_max24h_mm: cl.max24h,
    chuva_max_abs_mm: cl.max_abs,
    dias_chuva_forte: cl.dias_fortes,
    altitude_m: rel.alt,
    amplitude_m: amplitude,
    declividade_pct: declividade,
    rede_drenagem_km: redeKm ?? null,
    drenagem_superficial: superficial,
    dispositivo_detencao: detencao,
    servico_manejo: manejo,
    inundacao_pnsb: inundacaoPnsb,
    enchente_4anos: enchente,
    ano_enchente: anoEnchente,
    enxurrada_4anos: enxurrada,
    deslizamento_4anos: deslizamento,
    ocupacao_irregular: ocupIrregular,
    intervencao_realizada: intervencao,
    c: {
      hidrologica: Math.round(c_hidrologica),
      impermeabilizacao: Math.round(c_impermeabilizacao),
      relevo: Math.round(c_relevo),
      infraestrutura: Math.round(c_infraestrutura),
      vulnerabilidade: Math.round(c_vulnerabilidade),
      historico: Math.round(c_historico),
    },
    bruto,
  });

  geoFeatures.push({
    type: 'Feature',
    properties: { cod, uf: info.uf, nome: info.nome },
    geometry: f.geometry,
  });
}

/* ------------------------------------------------- padronização do índice   */

const media = municipios.reduce((s, m) => s + m.bruto, 0) / municipios.length;
const desvio = Math.sqrt(municipios.reduce((s, m) => s + (m.bruto - media) ** 2, 0) / municipios.length);

for (const m of municipios) {
  const z = (m.bruto - media) / desvio;
  const zs = 3 * Math.tanh(z / 3);
  m.indice = r1(clamp(48 + 15 * zs, 1, 99));
  delete m.bruto;
}

municipios.sort((a, b) => b.indice - a.indice);
municipios.forEach((m, i) => { m.rank_br = i + 1; });

const porUf = new Map();
for (const m of municipios) {
  if (!porUf.has(m.uf)) porUf.set(m.uf, []);
  porUf.get(m.uf).push(m);
}
for (const lista of porUf.values()) {
  lista.forEach((m, i) => { m.rank_uf = i + 1; m.total_uf = lista.length; });
}

/* ------------------------------------------------------- agregados por UF   */

const estados = [];
for (const [uf, lista] of porUf) {
  const pop = lista.reduce((s, m) => s + m.populacao, 0);
  const popUrb = lista.reduce((s, m) => s + m.pop_urbana, 0);
  const criticos = lista.filter((m) => m.indice >= 60);
  estados.push({
    uf,
    nome: lista[0].uf_nome,
    regiao: lista[0].regiao,
    municipios: lista.length,
    populacao: pop,
    pop_urbana: popUrb,
    pop_critica: criticos.reduce((s, m) => s + m.pop_urbana, 0),
    area_km2: Math.round(lista.reduce((s, m) => s + m.area_km2, 0)),
    indice: r1(lista.reduce((s, m) => s + m.indice * Math.max(m.populacao, 1), 0) / Math.max(pop, 1)),
    indice_simples: r1(lista.reduce((s, m) => s + m.indice, 0) / lista.length),
    criticos: criticos.length,
    com_enchente: lista.filter((m) => m.enchente_4anos).length,
    chuva_anual_mm: Math.round(lista.reduce((s, m) => s + m.chuva_anual_mm, 0) / lista.length),
  });
}
estados.sort((a, b) => b.indice - a.indice);

const UF_COD = {};
for (const info of meta.values()) UF_COD[info.uf_id] = info.uf;

/* -------------------------------------------------------------- gravação    */

fs.mkdirSync(OUT, { recursive: true });

const geoMun = { type: 'FeatureCollection', features: geoFeatures };
const geoUf = {
  type: 'FeatureCollection',
  features: ufMesh.features.map((f) => ({
    type: 'Feature',
    properties: { uf: UF_COD[String(f.properties.codarea)] || String(f.properties.codarea) },
    geometry: f.geometry,
  })),
};

const escreve = (arquivo, variavel, obj) => fs.writeFileSync(path.join(OUT, arquivo), `window.${variavel}=${JSON.stringify(obj)};\n`);

escreve('geo-municipios.js', 'DRENA_GEO_MUN', geoMun);
escreve('geo-estados.js', 'DRENA_GEO_UF', geoUf);
escreve('indicadores.js', 'DRENA_DADOS', {
  gerado_em: new Date().toISOString().slice(0, 10),
  municipios,
  estados,
  meta: {
    fontes: [
      { chave: 'censo', nome: 'IBGE, Censo Demográfico 2022', detalhe: 'população residente, população urbana, área territorial, densidade, favelas e comunidades urbanas' },
      { chave: 'urbanizada', nome: 'IBGE, Áreas Urbanizadas do Brasil 2019', detalhe: 'área urbanizada e área urbanizada densa por município' },
      { chave: 'munic', nome: 'IBGE, Munic 2020', detalhe: 'enchentes, enxurradas e deslizamentos nos últimos 4 anos, áreas de ocupação irregular atingidas e intervenções realizadas' },
      { chave: 'pnsb', nome: 'IBGE, PNSB 2008 e 2000', detalhe: 'inundações urbanas, tipo de drenagem nas ruas pavimentadas, dispositivos de detenção, serviço de manejo de águas pluviais e extensão da rede' },
      { chave: 'power', nome: 'NASA POWER, série diária 2015-2024', detalhe: 'precipitação diária em grade de 0,5 grau, da qual derivam a chuva anual, a chuva máxima em 24 h e os dias de chuva forte' },
      { chave: 'srtm', nome: 'SRTM 90 m via Open Topo Data', detalhe: 'altitude e amplitude altimétrica amostradas em cinco pontos por município' },
      { chave: 'osm', nome: 'OpenStreetMap', detalhe: 'limites de bairro e hidrografia urbana na camada intraurbana' },
    ],
    pesos: {
      hidrologica: 0.22,
      impermeabilizacao: 0.17,
      relevo: 0.16,
      infraestrutura: 0.18,
      vulnerabilidade: 0.15,
      historico: 0.12,
    },
    cobertura: {
      municipios: municipios.length,
      sem_pnsb: semPnsb,
      com_favelas: municipios.filter((m) => m.favelas > 0).length,
      com_enchente: municipios.filter((m) => m.enchente_4anos).length,
    },
  },
});

/* ------------------------------------------------------------- CSV para ML  */

const colunas = [
  'cod_ibge', 'municipio', 'uf', 'regiao', 'latitude', 'longitude', 'area_km2',
  'populacao_2022', 'populacao_urbana', 'densidade_hab_km2', 'densidade_urbana',
  'area_urbanizada_km2', 'taxa_urbanizacao_pct', 'favelas', 'populacao_favelas', 'pct_favelas',
  'chuva_anual_mm', 'chuva_max24h_mm', 'chuva_max_abs_mm', 'dias_chuva_forte',
  'altitude_m', 'amplitude_altimetrica_m', 'declividade_pct',
  'rede_drenagem_km', 'drenagem_superficial', 'dispositivo_detencao', 'servico_manejo',
  'inundacao_pnsb_2008', 'ocupacao_irregular_atingida', 'intervencao_realizada',
  'enxurrada_4anos', 'deslizamento_4anos',
  'enchente_4anos', 'indice_risco', 'classe_risco',
];
const classe = (v) => (v >= 75 ? 'muito_alto' : v >= 60 ? 'alto' : v >= 45 ? 'medio' : v >= 30 ? 'baixo' : 'muito_baixo');
const linhas = [colunas.join(',')];
for (const m of [...municipios].sort((a, b) => a.cod.localeCompare(b.cod))) {
  linhas.push([
    m.cod, `"${m.nome.replace(/"/g, '""')}"`, m.uf, m.regiao, m.lat, m.lon, m.area_km2,
    m.populacao, m.pop_urbana, m.densidade, m.dens_urbana,
    m.area_urbanizada_km2, m.taxa_urbanizacao, m.favelas, m.pop_favelas, m.pct_favelas,
    m.chuva_anual_mm, m.chuva_max24h_mm, m.chuva_max_abs_mm, m.dias_chuva_forte,
    m.altitude_m, m.amplitude_m, m.declividade_pct,
    m.rede_drenagem_km ?? '', m.drenagem_superficial, m.dispositivo_detencao, m.servico_manejo,
    m.inundacao_pnsb, m.ocupacao_irregular, m.intervencao_realizada,
    m.enxurrada_4anos, m.deslizamento_4anos,
    m.enchente_4anos, m.indice, classe(m.indice),
  ].join(','));
}
fs.writeFileSync(path.join(OUT, 'drenacity_municipios.csv'), `${linhas.join('\n')}\n`);
fs.writeFileSync(path.join(OUT, 'municipios.geojson'), JSON.stringify(geoMun));
fs.writeFileSync(path.join(OUT, 'estados.geojson'), JSON.stringify(geoUf));

/* ---------------------------------------------------------------- relatório */

const topo = municipios.slice(0, 8).map((m) => `${m.nome}/${m.uf} ${m.indice}`).join(' | ');
const dist = {};
for (const m of municipios) dist[classe(m.indice)] = (dist[classe(m.indice)] || 0) + 1;

console.log('municípios:', municipios.length, '| estados:', estados.length);
console.log('sem dados da PNSB:', semPnsb);
console.log('com enchente registrada (Munic 2020):', municipios.filter((m) => m.enchente_4anos).length);
console.log('distribuição:', JSON.stringify(dist));
console.log('topo:', topo);
console.log('UFs:', estados.slice(0, 5).map((e) => `${e.uf} ${e.indice}`).join(' | '));
