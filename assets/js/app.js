/* DrenaCity: plataforma de inteligência territorial contra alagamentos urbanos.
   Front-end estático: Leaflet + bases públicas pré-processadas (IBGE, NASA POWER,
   SRTM e OpenStreetMap). Nenhum dado pessoal é tratado.
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  const DADOS = window.DRENA_DADOS;
  const GEO_UF = window.DRENA_GEO_UF;
  const GEO_MUN = window.DRENA_GEO_MUN;
  const BAIRROS = window.DRENA_BAIRROS || {};
  const RELEVO = window.DRENA_RELEVO || {};

  const MUNS = DADOS.municipios;
  const UFS = DADOS.estados;

  const byCod = new Map(MUNS.map((m) => [m.cod, m]));
  const ufByCode = new Map(UFS.map((e) => [e.uf, e]));
  const munsByUf = new Map();
  const geoByUf = new Map();

  for (const m of MUNS) {
    if (!munsByUf.has(m.uf)) munsByUf.set(m.uf, []);
    munsByUf.get(m.uf).push(m);
  }
  for (const f of GEO_MUN.features) {
    if (!geoByUf.has(f.properties.uf)) geoByUf.set(f.properties.uf, []);
    geoByUf.get(f.properties.uf).push(f);
  }
  for (const lista of munsByUf.values()) lista.sort((a, b) => b.indice - a.indice);

  const nf = new Intl.NumberFormat('pt-BR');
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtInt = (v) => nf.format(Math.round(v || 0));
  const fmt1 = (v) => nf1.format(v || 0);
  const milhoes = (v) => `${fmt1(v / 1e6)} mi`;
  const COLORS = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];

  // Rampa contínua (plasma): mesma usada no raster de relevo urbano. Sobre o
  // mapa escuro, o extremo baixo quase desaparece e o alto fica luminoso, o que
  // separa territórios que as cinco classes deixavam com a mesma cor.
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
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  }

  const FONTES = {
    censo: 'IBGE Censo 2022',
    urbanizada: 'IBGE Áreas Urbanizadas 2019',
    munic: 'IBGE Munic 2020',
    pnsb: 'IBGE PNSB',
    power: 'NASA POWER',
    srtm: 'SRTM 90 m',
    osm: 'OpenStreetMap',
  };

  /* ------------------------------------------------------------- métricas */

  const METRICS = {
    indice: { label: 'Índice de risco de alagamento', short: 'Índice de risco', mun: (m) => m.indice, fmt: fmt1, agg: 'pond', unit: '/100' },
    hidrologica: { label: 'Exposição hidrológica', short: 'Exposição hidrológica', mun: (m) => m.c.hidrologica, fmt: fmtInt, agg: 'pond', unit: '/100' },
    impermeabilizacao: { label: 'Adensamento urbano', short: 'Adensamento urbano', mun: (m) => m.c.impermeabilizacao, fmt: fmtInt, agg: 'pond', unit: '/100' },
    infraestrutura: { label: 'Déficit de drenagem', short: 'Déficit de drenagem', mun: (m) => m.c.infraestrutura, fmt: fmtInt, agg: 'pond', unit: '/100' },
    relevo: { label: 'Relevo e altimetria', short: 'Relevo e altimetria', mun: (m) => m.c.relevo, fmt: fmtInt, agg: 'pond', unit: '/100' },
    vulnerabilidade: { label: 'Vulnerabilidade social', short: 'Vulnerabilidade social', mun: (m) => m.c.vulnerabilidade, fmt: fmtInt, agg: 'pond', unit: '/100' },
    historico: { label: 'Histórico de enchentes', short: 'Histórico de enchentes', mun: (m) => m.c.historico, fmt: fmtInt, agg: 'pond', unit: '/100' },
    chuva_anual_mm: { label: 'Precipitação média anual', short: 'Precipitação anual', mun: (m) => m.chuva_anual_mm, fmt: fmtInt, agg: 'media', unit: ' mm' },
    chuva_max24h_mm: { label: 'Chuva máxima em 24 horas', short: 'Chuva máxima em 24h', mun: (m) => m.chuva_max24h_mm, fmt: fmtInt, agg: 'media', unit: ' mm' },
    dias_chuva_forte: { label: 'Dias de chuva forte por ano', short: 'Dias de chuva forte', mun: (m) => m.dias_chuva_forte, fmt: fmt1, agg: 'media', unit: ' dias' },
    altitude_m: { label: 'Altitude do núcleo urbano', short: 'Altitude', mun: (m) => m.altitude_m, fmt: fmtInt, agg: 'media', unit: ' m' },
    dens_urbana: { label: 'Densidade na área urbanizada', short: 'Densidade urbana', mun: (m) => m.dens_urbana, fmt: fmtInt, agg: 'pond', unit: ' hab/km²' },
    pct_favelas: { label: 'População em favelas e comunidades urbanas', short: 'População em favelas', mun: (m) => m.pct_favelas, fmt: fmt1, agg: 'pond', unit: '%' },
    pop_urbana: { label: 'População urbana', short: 'População urbana', mun: (m) => m.pop_urbana, fmt: fmtInt, agg: 'soma', unit: ' pessoas' },
  };

  const ufAgg = {};
  for (const [uf, lista] of munsByUf) {
    ufAgg[uf] = {};
    const popTotal = lista.reduce((s, m) => s + Math.max(m.populacao, 1), 0);
    for (const chave of Object.keys(METRICS)) {
      const M = METRICS[chave];
      if (M.agg === 'soma') ufAgg[uf][chave] = lista.reduce((s, m) => s + M.mun(m), 0);
      else if (M.agg === 'media') ufAgg[uf][chave] = lista.reduce((s, m) => s + M.mun(m), 0) / lista.length;
      else ufAgg[uf][chave] = lista.reduce((s, m) => s + M.mun(m) * Math.max(m.populacao, 1), 0) / popTotal;
    }
  }

  function quantis(valores) {
    const v = valores.slice().sort((a, b) => a - b);
    const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
    const cortes = [q(0.2), q(0.4), q(0.6), q(0.8)];
    // Indicadores com muitos zeros (favelas, por exemplo) produzem quintis
    // repetidos: nesse caso as faixas são distribuídas entre os valores positivos.
    if (new Set(cortes).size === 4) return cortes;
    const positivos = v.filter((x) => x > 0);
    if (positivos.length < 5) return cortes;
    const min = positivos[0];
    const max = positivos[positivos.length - 1];
    const passo = (max - min) / 5;
    return [min, min + passo, min + 2 * passo, min + 3 * passo];
  }

  const BREAKS_MUN = {};
  const BREAKS_UF = {};
  for (const chave of Object.keys(METRICS)) {
    BREAKS_MUN[chave] = quantis(MUNS.map(METRICS[chave].mun));
    BREAKS_UF[chave] = quantis(UFS.map((e) => ufAgg[e.uf][chave]));
  }

  const corClasse = (valor, cortes) => {
    for (let i = 0; i < cortes.length; i++) if (valor <= cortes[i]) return COLORS[i];
    return COLORS[4];
  };

  // Séries ordenadas para converter valor em posição relativa (percentil).
  const ORDEM_MUN = {};
  const ORDEM_UF = {};
  for (const chave of Object.keys(METRICS)) {
    ORDEM_MUN[chave] = MUNS.map(METRICS[chave].mun).sort((a, b) => a - b);
    ORDEM_UF[chave] = UFS.map((e) => ufAgg[e.uf][chave]).sort((a, b) => a - b);
  }

  function percentil(valor, ordenado) {
    let lo = 0;
    let hi = ordenado.length;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (ordenado[meio] < valor) lo = meio + 1;
      else hi = meio;
    }
    return ordenado.length > 1 ? lo / (ordenado.length - 1) : 0.5;
  }

  /** Cor de um valor no escopo informado, respeitando o modo de cor escolhido. */
  function corDe(valor, cortes, escopo) {
    if (state.cores === 'classes') return corClasse(valor, cortes);
    const ordenado = escopo === 'uf' ? ORDEM_UF[state.metric] : ORDEM_MUN[state.metric];
    return plasma(percentil(valor, ordenado));
  }

  const corBairro = (valor, lista) => (state.cores === 'classes'
    ? corClasse(valor, BREAKS_BAIRRO)
    : plasma(percentil(valor, lista || ORDEM_BAIRRO)));

  let ORDEM_BAIRRO = [0, 100];

  const CLASSES = [
    { min: 75, nome: 'Muito alto', cor: '#bd0026' },
    { min: 60, nome: 'Alto', cor: '#f03b20' },
    { min: 45, nome: 'Médio', cor: '#fd8d3c' },
    { min: 30, nome: 'Baixo', cor: '#fecc5c' },
    { min: -1, nome: 'Muito baixo', cor: '#ffffb2' },
  ];
  const classeDe = (v) => CLASSES.find((c) => v >= c.min);

  /* ---------------------------------------------------------------- estado */

  const state = {
    tela: 'mapa', nivel: 'estados', uf: null, cod: null, bairro: null,
    metric: 'indice', thr: 0, cores: 'degrade', calor: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const panelBody = $('#panel-body');
  const crumbs = $('#crumbs');
  const mapNote = $('#map-note');

  /* ------------------------------------------------------------------ mapa */

  const map = L.map('map', {
    center: [-14.6, -53.2],
    zoom: 4,
    minZoom: 3,
    maxZoom: 15,
    preferCanvas: true,
    zoomControl: false,
  });

  L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'IBGE, NASA POWER, SRTM e OpenStreetMap | mapa base Esri',
      maxZoom: 16,
      maxNativeZoom: 16,
      opacity: 0.92,
    },
  ).addTo(map);

  L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 16, maxNativeZoom: 16, pane: 'shadowPane', opacity: 0.85 },
  ).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  const canvas = L.canvas({ padding: 0.4 });

  /* ---------------------------------------------------------- camada de UF */

  const ufLayers = new Map();

  function estiloUf(feature) {
    const uf = feature.properties.uf;
    const valor = ufAgg[uf] ? ufAgg[uf][state.metric] : 0;
    const selecionado = state.uf === uf;
    const ativo = state.nivel === 'estados';
    return {
      fillColor: corDe(valor, BREAKS_UF[state.metric], 'uf'),
      fillOpacity: (ativo ? 0.8 : (selecionado ? 0.05 : 0.22)) * (state.calor ? 0.3 : 1),
      color: selecionado ? '#35c8d8' : '#0b1520',
      weight: selecionado ? 2.2 : 0.9,
    };
  }

  const ufLayer = L.geoJSON(GEO_UF, {
    style: estiloUf,
    onEachFeature(feature, layer) {
      const uf = feature.properties.uf;
      ufLayers.set(uf, layer);
      layer.on({
        mouseover() {
          if (state.nivel !== 'estados') return;
          layer.setStyle({ weight: 2.4, color: '#35c8d8' });
        },
        mouseout() { ufLayer.resetStyle(layer); },
      });
      layer.bindTooltip(() => dicaUf(uf), { className: 'tip', sticky: true });
    },
  }).addTo(map);

  // A dica do estado só faz sentido na visão nacional: nos demais níveis ela
  // competiria com a dica do município ou do bairro sob o cursor.
  function atualizarDicasUf() {
    const ativo = state.nivel === 'estados';
    ufLayers.forEach((layer, uf) => {
      layer.unbindTooltip();
      if (ativo) layer.bindTooltip(() => dicaUf(uf), { className: 'tip', sticky: true });
    });
  }

  function dicaUf(uf) {
    const e = ufByCode.get(uf);
    const M = METRICS[state.metric];
    const v = ufAgg[uf][state.metric];
    const cl = classeDe(e.indice);
    return `<strong>${e.nome} (${uf})</strong>
      <div class="t-score" style="color:${corDe(v, BREAKS_UF[state.metric], 'uf')}">${M.short}: ${M.fmt(v)}${M.unit}</div>
      <div class="t-row">Índice médio ponderado: ${fmt1(e.indice)}, risco ${cl.nome.toLowerCase()}</div>
      <div class="t-row">${fmtInt(e.criticos)} de ${fmtInt(e.municipios)} municípios em risco alto</div>
      <div class="t-row">${fmtInt(e.com_enchente)} registraram enchente entre 2017 e 2020</div>
      <div class="t-row" style="margin-top:4px;color:#35c8d8">Clique para abrir os municípios</div>`;
  }

  /* -------------------------------------------------- camada de municípios */

  let munLayer = null;
  const munLayers = new Map();

  function estiloMun(feature) {
    const m = byCod.get(feature.properties.cod);
    if (!m) return { fillOpacity: 0, weight: 0 };
    const valor = METRICS[state.metric].mun(m);
    const apagado = m.indice < state.thr;
    const sel = state.cod === m.cod;
    const emDetalhe = state.nivel === 'bairros' || state.nivel === 'ruas';
    return {
      fillColor: corDe(valor, BREAKS_MUN[state.metric], 'mun'),
      fillOpacity: (apagado ? 0.06 : (emDetalhe ? 0.08 : 0.85)) * (state.calor ? 0.3 : 1),
      color: sel ? '#35c8d8' : (apagado ? '#16242f' : '#0a1620'),
      weight: sel ? 2.4 : 0.45,
    };
  }

  function dicaMun(cod) {
    const m = byCod.get(cod);
    const M = METRICS[state.metric];
    const cl = classeDe(m.indice);
    return `<strong>${m.nome} (${m.uf})</strong>
      <div class="t-score" style="color:${cl.cor}">Índice de risco ${fmt1(m.indice)}, ${cl.nome.toLowerCase()}</div>
      ${state.metric === 'indice' ? '' : `<div class="t-row">${M.short}: ${M.fmt(M.mun(m))}${M.unit}</div>`}
      <div class="t-row">População urbana: ${fmtInt(m.pop_urbana)}</div>
      <div class="t-row">${m.enchente_4anos ? `Enchente registrada em ${m.ano_enchente || 'anos recentes'}` : 'Sem enchente registrada na Munic 2020'}</div>
      <div class="t-row">Ranking nacional: ${fmtInt(m.rank_br)} de ${fmtInt(MUNS.length)}</div>`;
  }

  function desenharMunicipios(features) {
    if (munLayer) { map.removeLayer(munLayer); munLayer = null; }
    munLayers.clear();
    munLayer = L.geoJSON(features, {
      renderer: canvas,
      style: estiloMun,
      onEachFeature(feature, layer) {
        const cod = feature.properties.cod;
        munLayers.set(cod, layer);
        layer.on({
          mouseover() { if (state.nivel === 'municipios') layer.setStyle({ weight: 1.8, color: '#9ae7f2' }); },
          mouseout() { layer.setStyle(estiloMun(feature)); },
        });
        layer.bindTooltip(() => dicaMun(cod), { className: 'tip', sticky: true });
      },
    }).addTo(map);
  }

  /* ----------------------------------------------------- camada de bairros */

  let bairroLayer = null;
  const bairroLayers = new Map();
  const temBairros = (cod) => Boolean(BAIRROS[cod] && BAIRROS[cod].bairros && BAIRROS[cod].bairros.length);

  function estiloBairro(feature) {
    const b = feature.properties.b;
    const sel = state.bairro === b.nome;
    return {
      fillColor: corBairro(b.indice),
      fillOpacity: 0.78,
      color: sel ? '#35c8d8' : '#07111a',
      weight: sel ? 2.4 : 0.7,
    };
  }

  let BREAKS_BAIRRO = [30, 45, 60, 75];

  function desenharBairros(cod) {
    if (bairroLayer) { map.removeLayer(bairroLayer); bairroLayer = null; }
    bairroLayers.clear();
    const lista = BAIRROS[cod].bairros;
    BREAKS_BAIRRO = quantis(lista.map((b) => b.indice));
    ORDEM_BAIRRO = lista.map((b) => b.indice).sort((a, b) => a - b);
    const features = lista.map((b) => ({
      type: 'Feature',
      properties: { b },
      geometry: { type: 'Polygon', coordinates: [b.anel] },
    }));
    bairroLayer = L.geoJSON(features, {
      renderer: canvas,
      style: estiloBairro,
      onEachFeature(feature, layer) {
        const b = feature.properties.b;
        bairroLayers.set(b.nome, layer);
        layer.on({
          mouseover() { layer.setStyle({ weight: 2, color: '#9ae7f2' }); },
          mouseout() { layer.setStyle(estiloBairro(feature)); },
        });
        layer.bindTooltip(() => dicaBairro(b), { className: 'tip', sticky: true });
      },
    }).addTo(map);
    const limites = bairroLayer.getBounds();
    if (limites.isValid()) map.flyToBounds(limites, { padding: [40, 40], duration: 0.9 });
  }

  function dicaBairro(b) {
    const m = byCod.get(state.cod);
    return `<strong>${b.nome}</strong>
      <div class="t-score" style="color:${corBairro(b.indice)}">Risco intraurbano ${fmt1(b.indice)}/100</div>
      <div class="t-row">Posição na cidade: ${b.rank} de ${BAIRROS[state.cod].bairros.length}</div>
      <div class="t-row">Cota do terreno: ${fmtInt(b.alt)} m</div>
      <div class="t-row">Curso d'água mais próximo: ${b.dist_agua_m == null ? 'não mapeado' : `${fmtInt(b.dist_agua_m)} m`}</div>
      <div class="t-row">${m ? m.nome : ''}</div>`;
  }

  function limparBairros() {
    if (bairroLayer) { map.removeLayer(bairroLayer); bairroLayer = null; bairroLayers.clear(); }
    state.bairro = null;
  }

  /* ------------------------------------------- camada de rua (relevo fino) */

  const temRuas = (cod) => Boolean(RELEVO[cod]);
  let rasterLayer = null;
  let marcasPonto = [];
  const amostra = { cod: null, ctx: null, w: 0, h: 0, bounds: null };

  function limparRuas() {
    if (rasterLayer) { map.removeLayer(rasterLayer); rasterLayer = null; }
    marcasPonto.forEach((m) => map.removeLayer(m));
    marcasPonto = [];
  }

  function desenharRuas(cod) {
    const r = RELEVO[cod];
    limparRuas();
    // a versão na URL evita que o navegador reaproveite um raster antigo do cache
    const fonte = `${r.arquivo}${r.versao ? `?v=${r.versao}` : ''}`;
    rasterLayer = L.imageOverlay(fonte, r.bounds, { opacity: 0.68, interactive: false }).addTo(map);

    r.pontos.forEach((p) => {
      const marca = L.circleMarker([p.lat, p.lon], {
        radius: 7, color: '#07111a', weight: 2, fillColor: '#fcffa4', fillOpacity: 1,
      }).addTo(map);
      marca.bindTooltip(`<strong>${p.via || 'Ponto crítico'}</strong>
        <div class="t-row">${[p.bairro, p.cidade].filter(Boolean).join(', ') || r.nome}</div>
        <div class="t-row">Cota ${fmtInt(p.cota)} m, apenas ${fmtInt(p.acima_do_fundo)} m acima do fundo de vale</div>`,
      { className: 'tip', sticky: true });
      marcasPonto.push(marca);
    });

    map.flyToBounds(r.bounds, { duration: 0.9 });
    prepararAmostra(cod);
  }

  // Carrega o raster num canvas para informar a suscetibilidade do ponto clicado.
  function prepararAmostra(cod) {
    if (amostra.cod === cod && amostra.ctx) return;
    const r = RELEVO[cod];
    const img = new Image();
    img.onload = () => {
      const tela = document.createElement('canvas');
      tela.width = img.width;
      tela.height = img.height;
      const ctx = tela.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      amostra.cod = cod;
      amostra.ctx = ctx;
      amostra.w = img.width;
      amostra.h = img.height;
      amostra.bounds = r.bounds;
    };
    img.src = `${r.arquivo}${r.versao ? `?v=${r.versao}` : ''}`;
  }

  const mercator = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

  function amostrarRaster(latlng) {
    if (amostra.cod !== state.cod || !amostra.ctx) return null;
    const [[sul, oeste], [norte, leste]] = amostra.bounds;
    if (latlng.lat < sul || latlng.lat > norte || latlng.lng < oeste || latlng.lng > leste) return null;
    const px = Math.floor(((latlng.lng - oeste) / (leste - oeste)) * amostra.w);
    const py = Math.floor(((mercator(norte) - mercator(latlng.lat)) / (mercator(norte) - mercator(sul))) * amostra.h);
    const d = amostra.ctx.getImageData(Math.min(px, amostra.w - 1), Math.min(py, amostra.h - 1), 1, 1).data;
    if (d[3] < 10) return 0;
    return Math.min(Math.max((d[3] - 40) / 195, 0), 1);
  }

  /* --------------------------------------------------------- mapa de calor */

  let camadaCalor = null;

  function atualizarCalor() {
    if (camadaCalor) { map.removeLayer(camadaCalor); camadaCalor = null; }
    if (!state.calor || !window.L.heatLayer) return;
    const M = METRICS[state.metric];
    const ordenado = ORDEM_MUN[state.metric];
    const base = state.uf && state.nivel !== 'estados' ? munsByUf.get(state.uf) : MUNS;
    const pontos = base
      .filter((m) => m.indice >= state.thr)
      .map((m) => [m.lat, m.lon, Math.max(percentil(M.mun(m), ordenado) ** 1.4, 0.03)]);
    camadaCalor = L.heatLayer(pontos, {
      radius: state.uf ? 30 : 20,
      blur: state.uf ? 26 : 16,
      minOpacity: 0.22,
      maxZoom: 11,
      gradient: { 0: '#0d0887', 0.35: '#9c179e', 0.6: '#ed7953', 0.82: '#fdca26', 1: '#f0f921' },
    }).addTo(map);
  }

  /* ------------------------------------------ clique por geometria do mapa */

  function anelContem(x, y, anel) {
    let dentro = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const xi = anel[i][0];
      const yi = anel[i][1];
      const xj = anel[j][0];
      const yj = anel[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  function poligonos(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }

  function geometriaContem(geom, x, y) {
    for (const poly of poligonos(geom)) {
      if (!anelContem(x, y, poly[0])) continue;
      let buraco = false;
      for (let i = 1; i < poly.length; i++) if (anelContem(x, y, poly[i])) { buraco = true; break; }
      if (!buraco) return true;
    }
    return false;
  }

  function caixa(geom) {
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (const poly of poligonos(geom)) {
      for (const p of poly[0]) {
        if (p[0] < minx) minx = p[0];
        if (p[0] > maxx) maxx = p[0];
        if (p[1] < miny) miny = p[1];
        if (p[1] > maxy) maxy = p[1];
      }
    }
    return [minx, miny, maxx, maxy];
  }

  for (const f of GEO_UF.features) f.bbox = caixa(f.geometry);
  for (const f of GEO_MUN.features) f.bbox = caixa(f.geometry);

  const naCaixa = (f, x, y) => x >= f.bbox[0] && x <= f.bbox[2] && y >= f.bbox[1] && y <= f.bbox[3];

  function acharFeature(lista, x, y) {
    for (const f of lista) if (naCaixa(f, x, y) && geometriaContem(f.geometry, x, y)) return f;
    return null;
  }

  // O teste geométrico é feito no clique do próprio mapa, e não nos eventos das
  // camadas: assim a navegação não depende do acerto do canvas sob o cursor.
  map.on('click', (ev) => {
    const x = ev.latlng.lng;
    const y = ev.latlng.lat;

    if (state.nivel === 'estados') {
      const f = acharFeature(GEO_UF.features, x, y);
      if (f) abrirUf(f.properties.uf);
      return;
    }

    if (state.nivel === 'municipios') {
      const escopo = state.uf ? geoByUf.get(state.uf) : GEO_MUN.features;
      const f = acharFeature(escopo || [], x, y);
      if (f) selecionarMunicipio(f.properties.cod);
      return;
    }

    if (state.nivel === 'bairros' && state.cod && temBairros(state.cod)) {
      for (const b of BAIRROS[state.cod].bairros) {
        if (anelContem(x, y, b.anel)) { selecionarBairro(b.nome); return; }
      }
      const f = acharFeature(geoByUf.get(state.uf) || [], x, y);
      if (f && f.properties.cod !== state.cod) selecionarMunicipio(f.properties.cod);
      return;
    }

    if (state.nivel === 'ruas') {
      const v = amostrarRaster(ev.latlng);
      if (v == null) return;
      L.popup({ className: 'tip' })
        .setLatLng(ev.latlng)
        .setContent(`<strong>Suscetibilidade ${Math.round(v * 100)} de 100</strong>
          <div class="t-row">Cerca de ${fmt1((1 - v ** (1 / 1.25)) * 14)} m acima do fundo de vale mais próximo</div>
          <div class="t-row">${v > 0.7 ? 'Planície de inundação ou fundo de vale' : v > 0.4 ? 'Cota intermediária' : 'Terreno mais alto'}</div>
          <div class="t-row">${fmt1(ev.latlng.lat)}, ${fmt1(ev.latlng.lng)}</div>`)
        .openOn(map);
    }
  });

  function repintar() {
    atualizarDicasUf();
    ufLayer.setStyle(estiloUf);
    if (munLayer) munLayer.setStyle(estiloMun);
    if (bairroLayer) bairroLayer.setStyle(estiloBairro);
  }

  /* ------------------------------------------------------------- navegação */

  function setNivel(nivel, opcoes) {
    const silencioso = opcoes && opcoes.silencioso;
    state.nivel = nivel;
    document.querySelectorAll('.seg-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.nivel === nivel));
    });

    if (nivel === 'estados') {
      limparBairros();
      limparRuas();
      if (munLayer) { map.removeLayer(munLayer); munLayer = null; munLayers.clear(); }
      state.cod = null;
      if (!silencioso) {
        state.uf = null;
        map.flyTo([-14.6, -53.2], 4, { duration: 0.8 });
      }
      mapNote.textContent = 'Clique em um estado para abrir seus municípios';
    } else if (nivel === 'municipios') {
      limparBairros();
      limparRuas();
      desenharMunicipios(state.uf ? geoByUf.get(state.uf) : GEO_MUN.features);
      mapNote.textContent = state.uf
        ? `${ufByCode.get(state.uf).nome}: clique em um município para o diagnóstico`
        : 'Todos os 5.570 municípios: clique em um para o diagnóstico';
    } else if (nivel === 'bairros') {
      limparRuas();
      if (!state.cod || !temBairros(state.cod)) {
        mapNote.textContent = 'Escolha um município com camada de bairros disponível';
      } else {
        if (!munLayer) desenharMunicipios(geoByUf.get(state.uf));
        desenharBairros(state.cod);
        mapNote.textContent = `${byCod.get(state.cod).nome}: risco relativo por bairro`;
      }
    } else if (nivel === 'ruas') {
      limparBairros();
      if (!state.cod || !temRuas(state.cod)) {
        mapNote.textContent = 'Escolha uma cidade com relevo urbano processado';
      } else {
        if (!munLayer) desenharMunicipios(geoByUf.get(state.uf));
        desenharRuas(state.cod);
        mapNote.textContent = `${byCod.get(state.cod).nome}: clique em qualquer ponto para ver a suscetibilidade`;
      }
    }
    atualizarCalor();
    repintar();
    renderPanel();
  }

  function irParaBrasil() {
    state.uf = null;
    state.cod = null;
    setNivel('estados');
  }

  function abrirUf(uf, opcoes) {
    state.uf = uf;
    state.cod = null;
    limparBairros();
    state.nivel = 'municipios';
    document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.nivel === 'municipios')));
    desenharMunicipios(geoByUf.get(uf) || []);
    const camada = ufLayers.get(uf);
    if (camada && !(opcoes && opcoes.semVoo)) map.flyToBounds(camada.getBounds(), { padding: [30, 30], duration: 0.85 });
    repintar();
    renderPanel();
    mapNote.textContent = `${ufByCode.get(uf).nome}: clique em um município para o diagnóstico`;
  }

  function selecionarMunicipio(cod, opcoes) {
    const m = byCod.get(cod);
    if (!m) return;
    limparBairros();
    limparRuas();
    if (state.nivel === 'estados') state.nivel = 'municipios';
    if (state.uf !== m.uf || !munLayer) {
      state.uf = m.uf;
      desenharMunicipios(geoByUf.get(m.uf) || []);
    }
    document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.nivel === state.nivel)));
    state.cod = cod;
    const camada = munLayers.get(cod);
    if (!(opcoes && opcoes.semVoo)) {
      if (camada && camada.getBounds && camada.getBounds().isValid()) {
        map.flyToBounds(camada.getBounds(), { padding: [70, 70], maxZoom: 11, duration: 0.9 });
      } else {
        map.flyTo([m.lat, m.lon], 10, { duration: 0.9 });
      }
    }
    repintar();
    renderPanel();
    mapNote.textContent = `${m.nome} (${m.uf}): diagnóstico no painel lateral`;
  }

  function selecionarBairro(nome) {
    state.bairro = nome;
    repintar();
    renderPanel();
  }

  /* ---------------------------------------------------------------- painel */

  function trilha() {
    const partes = [`<button data-go="br">Brasil</button>`];
    if (state.uf) {
      partes.push('<span class="sep">›</span>');
      const nome = ufByCode.get(state.uf).nome;
      if (!state.cod) partes.push(`<span class="cur">${nome}</span>`);
      else partes.push(`<button data-go="uf">${nome}</button>`);
    }
    if (state.cod) {
      const m = byCod.get(state.cod);
      partes.push('<span class="sep">›</span>');
      if (state.bairro) partes.push(`<button data-go="mun">${m.nome}</button>`, '<span class="sep">›</span>', `<span class="cur">${state.bairro}</span>`);
      else partes.push(`<span class="cur">${m.nome}</span>`);
    }
    return partes.join(' ');
  }

  const kpi = (valor, rotulo) => `<div class="kpi"><b>${valor}</b><span>${rotulo}</span></div>`;

  function distribuicao(lista) {
    const total = lista.length;
    const linhas = CLASSES.map((c) => {
      const n = lista.filter((m) => classeDe(m.indice) === c).length;
      const pct = total ? (n / total) * 100 : 0;
      return `<div class="dist-row">
          <span class="dl">${c.nome}</span>
          <span class="dist-bar"><i style="width:${pct.toFixed(1)}%;background:${c.cor}"></i></span>
          <span class="dv">${fmtInt(n)}</span>
        </div>`;
    });
    return `<div class="dist">${linhas.join('')}</div>`;
  }

  function rankingMun(lista, limite) {
    const itens = lista.filter((m) => m.indice >= state.thr).slice(0, limite).map((m, i) => {
      const cl = classeDe(m.indice);
      return `<li><button data-cod="${m.cod}">
          <span class="pos">${i + 1}</span>
          <span class="nm">${m.nome} <small>${m.uf}</small></span>
          <span class="sc" style="background:${cl.cor}">${fmt1(m.indice)}</span>
        </button></li>`;
    });
    if (!itens.length) return '<p class="note">Nenhum município acima do filtro de risco selecionado.</p>';
    return `<ul class="rank">${itens.join('')}</ul>`;
  }

  function rankingUf(limite) {
    const itens = UFS.slice(0, limite).map((e, i) => {
      const cl = classeDe(e.indice);
      return `<li><button data-uf="${e.uf}">
          <span class="pos">${i + 1}</span>
          <span class="nm">${e.nome} <small>${fmtInt(e.criticos)} municípios críticos</small></span>
          <span class="sc" style="background:${cl.cor}">${fmt1(e.indice)}</span>
        </button></li>`;
    });
    return `<ul class="rank">${itens.join('')}</ul>`;
  }

  const ROTULOS = {
    hidrologica: 'exposição hidrológica',
    impermeabilizacao: 'adensamento urbano',
    relevo: 'relevo e altimetria',
    infraestrutura: 'déficit de drenagem',
    vulnerabilidade: 'vulnerabilidade social',
    historico: 'histórico de enchentes',
  };

  function barras(m) {
    const pesos = DADOS.meta.pesos;
    const comps = Object.keys(ROTULOS)
      .map((k) => [ROTULOS[k], m.c[k], pesos[k]])
      .sort((a, b) => b[1] * b[2] - a[1] * a[2]);
    return `<div class="bars">${comps.map(([lbl, v, p]) => `
      <div class="bar-row">
        <span class="lbl">${lbl.charAt(0).toUpperCase()}${lbl.slice(1)}</span>
        <span class="val">${fmtInt(v)} · peso ${(p * 100).toFixed(0)}%</span>
        <span class="bar-track"><i class="bar-fill" style="width:${v}%;background:${classeDe(v).cor}"></i></span>
      </div>`).join('')}</div>`;
  }

  const ACOES = {
    hidrologica: 'ampliar a capacidade de amortecimento (bacias de detenção, reservatórios de retardo) e integrar o município à rede de alerta do CEMADEN',
    impermeabilizacao: 'exigir taxa de permeabilidade em novos empreendimentos e implantar pavimento drenante e jardins de chuva nos eixos mais adensados',
    relevo: 'revisar o uso e a ocupação do solo nas várzeas, recuperar matas ciliares e dimensionar a macrodrenagem dos fundos de vale',
    infraestrutura: 'inventariar e requalificar a rede de galerias, com limpeza programada de bocas de lobo antes do período chuvoso',
    vulnerabilidade: 'cadastrar moradias em área de risco, definir rotas de evacuação e enviar alertas direcionados à população mais exposta',
    historico: 'instalar sensores de nível nos pontos de alagamento recorrentes e manter registro georreferenciado das ocorrências',
  };

  function prioridades(m) {
    const pesos = DADOS.meta.pesos;
    return Object.keys(ROTULOS)
      .map((k) => [k, m.c[k] * pesos[k]])
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }

  function diagnostico(m) {
    const ordem = prioridades(m);
    const cl = classeDe(m.indice);
    return `<div class="action">
      <h4>Prioridade de intervenção sugerida</h4>
      <p>Risco <b>${cl.nome.toLowerCase()}</b> (${fmt1(m.indice)} de 100). Os fatores de maior peso em
      ${m.nome} são <b>${ROTULOS[ordem[0]]}</b> e <b>${ROTULOS[ordem[1]]}</b>.</p>
      <ul><li>${ACOES[ordem[0]]};</li><li>${ACOES[ordem[1]]}.</li></ul>
    </div>`;
  }

  function painelBrasil() {
    const popUrbana = MUNS.reduce((s, m) => s + m.pop_urbana, 0);
    const criticos = MUNS.filter((m) => m.indice >= 60);
    const popCritica = criticos.reduce((s, m) => s + m.pop_urbana, 0);
    const comEnchente = MUNS.filter((m) => m.enchente_4anos);
    const semManejo = MUNS.filter((m) => !m.servico_manejo).length;

    panelBody.innerHTML = `
      <div class="title-block">
        <h1>Panorama nacional</h1>
        <p>${fmtInt(MUNS.length)} municípios analisados com dados públicos de clima, relevo,
        urbanização, saneamento e registros oficiais de enchentes.</p>
      </div>
      <div class="kpis">
        ${kpi(fmtInt(criticos.length), 'municípios em risco alto ou muito alto')}
        ${kpi(milhoes(popCritica), 'moradores urbanos nesses municípios')}
        ${kpi(fmtInt(comEnchente.length), 'registraram enchente entre 2017 e 2020')}
        ${kpi(`${((semManejo / MUNS.length) * 100).toFixed(0)}%`, 'sem serviço estruturado de manejo de águas pluviais')}
      </div>
      <h3 class="sec">Distribuição dos municípios por classe de risco</h3>
      ${distribuicao(MUNS)}
      <h3 class="sec">Estados com maior risco médio ponderado por população</h3>
      ${rankingUf(10)}
      <h3 class="sec">Municípios prioritários no país</h3>
      ${rankingMun(MUNS, 12)}
      <p class="note"><b>Como ler:</b> o índice vai de 0 a 100 e combina exposição à chuva,
      adensamento urbano, relevo, déficit de drenagem, vulnerabilidade social e histórico de
      enchentes. Ele aponta onde investigar primeiro e não substitui estudo hidrológico local.</p>`;
  }

  function painelUf() {
    const e = ufByCode.get(state.uf);
    const lista = munsByUf.get(state.uf);
    const cl = classeDe(e.indice);
    const posicao = UFS.findIndex((u) => u.uf === e.uf) + 1;

    panelBody.innerHTML = `
      <div class="title-block">
        <h1>${e.nome}</h1>
        <p>${fmtInt(e.municipios)} municípios, região ${e.regiao}, ${fmtInt(e.area_km2)} km²</p>
      </div>
      <div class="score">
        <div class="score-num" style="color:${cl.cor}">${fmt1(e.indice)}</div>
        <div>
          <span class="score-badge" style="background:${cl.cor}">Risco ${cl.nome.toLowerCase()}</span>
          <div class="score-meta">Índice estadual ponderado por população<br>
          ${posicao} entre as 27 unidades da federação</div>
        </div>
      </div>
      <div class="kpis">
        ${kpi(fmtInt(e.criticos), 'municípios em risco alto ou muito alto')}
        ${kpi(milhoes(e.pop_critica), 'moradores urbanos nesses municípios')}
        ${kpi(fmtInt(e.com_enchente), 'com enchente registrada (Munic 2020)')}
        ${kpi(`${fmtInt(e.chuva_anual_mm)} mm`, 'precipitação média anual (NASA POWER)')}
      </div>
      <h3 class="sec">Distribuição por classe de risco</h3>
      ${distribuicao(lista)}
      <h3 class="sec">Municípios prioritários em ${e.uf}</h3>
      ${rankingMun(lista, 15)}
      <p class="note">Clique em um município no mapa ou na lista para abrir o diagnóstico.</p>`;
  }

  function indicador(valor, rotulo, fonte) {
    return `<div><b>${valor}</b><span>${rotulo}</span><span class="src">${fonte}</span></div>`;
  }

  function painelMunicipio() {
    const m = byCod.get(state.cod);
    const cl = classeDe(m.indice);
    const registros = [
      m.enchente_4anos ? `enchente ou inundação gradual${m.ano_enchente ? ` (maior impacto em ${m.ano_enchente})` : ''}` : null,
      m.enxurrada_4anos ? 'enxurrada ou inundação brusca' : null,
      m.deslizamento_4anos ? 'escorregamento ou deslizamento' : null,
      m.inundacao_pnsb ? 'inundação urbana registrada na PNSB' : null,
      m.ocupacao_irregular ? 'áreas de ocupação irregular atingidas' : null,
    ].filter(Boolean);

    panelBody.innerHTML = `
      <div class="title-block">
        <h1>${m.nome}</h1>
        <p>${m.uf_nome}, ${m.meso || m.regiao}, ${fmt1(m.area_km2)} km²</p>
      </div>
      <div class="score">
        <div class="score-num" style="color:${cl.cor}">${fmt1(m.indice)}</div>
        <div>
          <span class="score-badge" style="background:${cl.cor}">Risco ${cl.nome.toLowerCase()}</span>
          <div class="score-meta">${fmtInt(m.rank_br)} de ${fmtInt(MUNS.length)} no Brasil<br>
          ${fmtInt(m.rank_uf)} de ${fmtInt(m.total_uf)} em ${m.uf}</div>
        </div>
      </div>

      <h3 class="sec">Registros oficiais de desastre</h3>
      ${registros.length
        ? `<ul class="lista-reg">${registros.map((r) => `<li>${r}</li>`).join('')}</ul>
           <p class="note">Fonte: ${FONTES.munic} (período 2017 a 2020) e ${FONTES.pnsb}.
           ${m.intervencao_realizada ? 'O município declarou ter realizado intervenções estruturais.' : 'O município não declarou intervenções estruturais.'}</p>`
        : `<p class="note">Nenhum registro de enchente, enxurrada ou deslizamento na ${FONTES.munic}.
           O risco aqui é estrutural e preventivo.</p>`}

      <h3 class="sec">Composição do índice</h3>
      ${barras(m)}
      ${diagnostico(m)}

      <h3 class="sec">Clima e relevo</h3>
      <div class="grid-ind">
        ${indicador(`${fmtInt(m.chuva_anual_mm)} mm`, 'precipitação anual', FONTES.power)}
        ${indicador(`${fmtInt(m.chuva_max24h_mm)} mm`, 'chuva máxima em 24h', FONTES.power)}
        ${indicador(`${fmt1(m.dias_chuva_forte)}`, 'dias por ano acima de 50 mm', FONTES.power)}
        ${indicador(`${fmtInt(m.altitude_m)} m`, 'altitude do núcleo urbano', FONTES.srtm)}
        ${indicador(`${fmtInt(m.amplitude_m)} m`, 'amplitude altimétrica', FONTES.srtm)}
        ${indicador(`${fmt1(m.declividade_pct)}%`, 'declividade média', FONTES.srtm)}
      </div>

      <h3 class="sec">População e território</h3>
      <div class="grid-ind">
        ${indicador(fmtInt(m.populacao), 'população total', FONTES.censo)}
        ${indicador(fmtInt(m.pop_urbana), 'população urbana', FONTES.censo)}
        ${indicador(fmtInt(m.densidade), 'hab/km² no município', FONTES.censo)}
        ${indicador(fmtInt(m.dens_urbana), 'hab/km² na área urbanizada', FONTES.urbanizada)}
        ${indicador(`${fmt1(m.area_urbanizada_km2)} km²`, 'área urbanizada', FONTES.urbanizada)}
        ${indicador(m.favelas ? `${fmt1(m.pct_favelas)}%` : 'sem registro', m.favelas ? `moradores em ${fmtInt(m.favelas)} favelas` : 'favelas e comunidades urbanas', FONTES.censo)}
      </div>

      <h3 class="sec">Infraestrutura de drenagem</h3>
      <div class="grid-ind">
        ${indicador(m.servico_manejo ? 'Sim' : 'Não', 'serviço de manejo de águas pluviais', FONTES.pnsb)}
        ${indicador(m.drenagem_superficial ? 'Superficial' : 'Mista', 'drenagem das ruas pavimentadas', FONTES.pnsb)}
        ${indicador(m.dispositivo_detencao ? 'Sim' : 'Não', 'dispositivo de detenção de vazão', FONTES.pnsb)}
        ${indicador(m.rede_drenagem_km == null ? 'sem informação' : `${fmtInt(m.rede_drenagem_km)} km`, 'extensão da rede de drenagem', FONTES.pnsb)}
      </div>

      <div class="acoes-mun">
        ${temRuas(m.cod) ? '<button class="btn acao" data-abrir="ruas">Ver em escala de rua</button>' : ''}
        ${temBairros(m.cod) ? '<button class="btn acao" data-abrir="bairros">Ver risco por bairro</button>' : ''}
        <button class="btn acao" data-abrir="ficha">Abrir ficha de priorização</button>
        <button class="btn acao" data-abrir="cidadao">Ver painel do cidadão</button>
      </div>

      <p class="note">Código IBGE ${m.cod}. Centroide ${fmt1(m.lat)}, ${fmt1(m.lon)}.
      ${temRuas(m.cod) ? `Relevo urbano processado em ${fmtInt(RELEVO[m.cod].metros_por_pixel)} m por pixel. ` : ''}${temBairros(m.cod) ? `Camada de bairros com ${BAIRROS[m.cod].bairros.length} bairros do OpenStreetMap.` : ''}</p>`;
  }

  function painelBairro() {
    const m = byCod.get(state.cod);
    const lista = BAIRROS[state.cod].bairros;
    const b = lista.find((x) => x.nome === state.bairro);
    if (!b) return painelMunicipio();
    const cor = corBairro(b.indice);
    const alts = lista.map((x) => x.alt);
    const menor = Math.min(...alts);

    panelBody.innerHTML = `
      <div class="title-block">
        <h1>${b.nome}</h1>
        <p>${m.nome}, ${m.uf}. Risco relativo dentro da cidade.</p>
      </div>
      <div class="score">
        <div class="score-num" style="color:${cor}">${fmt1(b.indice)}</div>
        <div>
          <span class="score-badge" style="background:${cor}">${b.rank} de ${lista.length} bairros</span>
          <div class="score-meta">Índice intraurbano calculado a partir de<br>cota, declividade e distância da água</div>
        </div>
      </div>
      <h3 class="sec">Fatores físicos do bairro</h3>
      <div class="bars">
        <div class="bar-row"><span class="lbl">Cota baixa em relação à cidade</span><span class="val">${b.c.cota}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${b.c.cota}%;background:${classeDe(b.c.cota).cor}"></i></span></div>
        <div class="bar-row"><span class="lbl">Terreno plano</span><span class="val">${b.c.relevo}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${b.c.relevo}%;background:${classeDe(b.c.relevo).cor}"></i></span></div>
        <div class="bar-row"><span class="lbl">Proximidade de curso d'água</span><span class="val">${b.c.agua}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${b.c.agua}%;background:${classeDe(b.c.agua).cor}"></i></span></div>
      </div>
      <h3 class="sec">Medidas do terreno</h3>
      <div class="grid-ind">
        ${indicador(`${fmtInt(b.alt)} m`, 'cota do centro do bairro', FONTES.srtm)}
        ${indicador(`${fmtInt(b.alt - menor)} m`, 'acima do ponto mais baixo da cidade', FONTES.srtm)}
        ${indicador(`${fmtInt(b.alt_max - b.alt_min)} m`, 'variação dentro do bairro', FONTES.srtm)}
        ${indicador(b.dist_agua_m == null ? 'não mapeado' : `${fmtInt(b.dist_agua_m)} m`, 'até o curso d\'água mais próximo', FONTES.osm)}
        ${indicador(`${fmt1(b.area_km2)} km²`, 'área do bairro', FONTES.osm)}
      </div>
      <h3 class="sec">Bairros mais críticos de ${m.nome}</h3>
      <ul class="rank">${lista.slice(0, 10).map((x, i) => `
        <li><button data-bairro="${x.nome.replace(/"/g, '&quot;')}">
          <span class="pos">${i + 1}</span>
          <span class="nm">${x.nome}</span>
          <span class="sc" style="background:${corBairro(x.indice)}">${fmt1(x.indice)}</span>
        </button></li>`).join('')}</ul>
      <p class="note">O índice intraurbano compara bairros da mesma cidade. Ele usa altimetria SRTM
      e hidrografia do OpenStreetMap, e não incorpora a rede de galerias, que não tem base pública
      padronizada por bairro.</p>`;
  }

  function painelBairrosIndisponivel() {
    const disponiveis = Object.keys(BAIRROS)
      .map((cod) => byCod.get(cod))
      .filter(Boolean)
      .sort((a, b) => b.indice - a.indice);
    panelBody.innerHTML = `
      <div class="title-block">
        <h1>Risco por bairro</h1>
        <p>A camada intraurbana usa limites de bairro e hidrografia do OpenStreetMap com altimetria
        SRTM. Ela está pronta para os municípios abaixo.</p>
      </div>
      <h3 class="sec">Municípios com camada de bairros</h3>
      ${disponiveis.length ? `<ul class="rank">${disponiveis.map((m, i) => `
        <li><button data-cod="${m.cod}" data-bairros="1">
          <span class="pos">${i + 1}</span>
          <span class="nm">${m.nome} <small>${m.uf}, ${BAIRROS[m.cod].bairros.length} bairros</small></span>
          <span class="sc" style="background:${classeDe(m.indice).cor}">${fmt1(m.indice)}</span>
        </button></li>`).join('')}</ul>`
        : '<p class="note">Nenhum município processado ainda. Rode <code>node scripts/fetch_bairros.mjs</code>.</p>'}
      <p class="note">Para incluir outra cidade, basta rodar o coletor com o código IBGE do município.
      O limite é a cobertura do OpenStreetMap, que varia entre cidades.</p>`;
  }

  function painelRuas() {
    if (!state.cod || !temRuas(state.cod)) {
      const cidades = Object.keys(RELEVO)
        .map((cod) => byCod.get(cod))
        .filter(Boolean)
        .sort((a, b) => b.indice - a.indice);
      panelBody.innerHTML = `
        <div class="title-block">
          <h1>Escala de rua</h1>
          <p>Modelo digital de elevação em resolução de dezenas de metros, que mostra onde a água
          se acumula dentro da cidade: fundos de vale, planícies de inundação e pontos baixos entre
          quadras.</p>
        </div>
        <h3 class="sec">Cidades processadas</h3>
        ${cidades.length ? `<ul class="rank">${cidades.map((m, i) => `
          <li><button data-cod="${m.cod}" data-ruas="1">
            <span class="pos">${i + 1}</span>
            <span class="nm">${m.nome} <small>${m.uf}</small></span>
            <span class="sc" style="background:${classeDe(m.indice).cor}">${fmt1(m.indice)}</span>
          </button></li>`).join('')}</ul>`
          : '<p class="note">Nenhuma cidade processada ainda. Rode <code>node scripts/fetch_relevo_urbano.mjs</code> com o código IBGE do município.</p>'}
        <p class="note">O processamento vale para qualquer município do país. Cada cidade baixa os
        tiles de elevação da sua região, calcula a altura acima do fundo de vale mais próximo e
        grava uma imagem georreferenciada.</p>`;
      return;
    }

    const m = byCod.get(state.cod);
    const r = RELEVO[state.cod];

    panelBody.innerHTML = `
      <div class="title-block">
        <h1>${m.nome} em escala de rua</h1>
        <p>Suscetibilidade do terreno em resolução de ${fmtInt(r.metros_por_pixel)} m. Quanto mais
        claro, mais baixo o ponto em relação à vizinhança, e maior a chance de a água se acumular.</p>
      </div>

      <h3 class="sec">Pontos críticos identificados</h3>
      ${r.pontos.length ? `<ul class="pontos">${r.pontos.map((p) => `
        <li><button data-lat="${p.lat}" data-lon="${p.lon}">
          <b>${p.via || 'Via não nomeada no OpenStreetMap'}</b>
          <span>${[p.bairro, p.cidade].filter(Boolean).join(', ') || `${m.nome}, ${m.uf}`}</span>
          <span>Cota ${fmtInt(p.cota)} m, ${fmtInt(p.acima_do_fundo)} m acima do fundo de vale</span>
        </button></li>`).join('')}</ul>`
        : '<p class="note">Nenhum ponto crítico isolado nesta janela.</p>'}

      <div class="action">
        <h4>Como usar</h4>
        <p>Clique em qualquer ponto do mapa para ler a suscetibilidade daquele trecho. Aproxime o
        zoom até enxergar o nome das ruas sob a camada de cor.</p>
      </div>

      <h3 class="sec">Como o valor é calculado</h3>
      <p class="note">Para cada pixel, o modelo compara a cota do terreno com o ponto mais baixo em
      um raio de 1,5 km e mede a declividade local. Fundo de vale plano recebe suscetibilidade
      alta, encosta íngreme recebe baixa. É o mesmo princípio do HAND (altura acima da drenagem
      mais próxima) usado em mapeamento de inundação, aplicado a um modelo digital de elevação
      público.</p>
      <p class="note"><b>Limite:</b> o relevo diz onde a água chega, não a capacidade das galerias
      daquela rua. A camada indica onde investigar em campo, não substitui levantamento local.
      Fonte do terreno: Terrarium (AWS Open Data), derivado de SRTM e NASADEM. Nomes de via:
      ${FONTES.osm}.</p>`;
  }

  function painelBairrosCidade() {
    const m = byCod.get(state.cod);
    const lista = BAIRROS[state.cod].bairros;
    panelBody.innerHTML = `
      <div class="title-block">
        <h1>${m.nome} por bairro</h1>
        <p>${lista.length} bairros mapeados. A comparação é interna à cidade e usa cota do terreno,
        planicidade e distância do curso d'água mais próximo.</p>
      </div>
      <h3 class="sec">Bairros mais expostos</h3>
      <ul class="rank">${lista.slice(0, 12).map((b, i) => `
        <li><button data-bairro="${b.nome.replace(/"/g, '&quot;')}">
          <span class="pos">${i + 1}</span>
          <span class="nm">${b.nome} <small>cota ${fmtInt(b.alt)} m</small></span>
          <span class="sc" style="background:${corBairro(b.indice)}">${fmt1(b.indice)}</span>
        </button></li>`).join('')}</ul>
      <div class="acoes-mun">
        ${temRuas(m.cod) ? '<button class="btn acao" data-abrir="ruas">Descer para a escala de rua</button>' : ''}
        <button class="btn acao" data-abrir="ficha">Abrir ficha de priorização</button>
      </div>
      <p class="note">Clique em um bairro no mapa ou na lista para ver os fatores físicos que
      explicam a posição dele. Limites e hidrografia do ${FONTES.osm}, altimetria ${FONTES.srtm}.</p>`;
  }

  function renderPanel() {
    crumbs.innerHTML = trilha();
    if (state.nivel === 'ruas') painelRuas();
    else if (state.nivel === 'bairros' && state.cod && temBairros(state.cod) && !state.bairro) painelBairrosCidade();
    else if (state.nivel === 'bairros' && (!state.cod || !temBairros(state.cod))) painelBairrosIndisponivel();
    else if (state.bairro) painelBairro();
    else if (state.cod) painelMunicipio();
    else if (state.uf) painelUf();
    else painelBrasil();
    renderLegenda();
  }

  /* --------------------------------------------------------------- legenda */

  const faixaPlasma = `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => plasma(t)).join(', ')})`;

  function legendaDegrade(titulo, ordenado, formatar, rodape) {
    const marca = (p) => formatar(ordenado[Math.min(ordenado.length - 1, Math.round(p * (ordenado.length - 1)))]);
    return `<h5>${titulo}</h5>
      <div class="grad" style="background:${faixaPlasma}"></div>
      <div class="grad-eixo"><span>${marca(0)}</span><span>${marca(0.5)}</span><span>${marca(1)}</span></div>
      <div class="foot">${rodape}</div>`;
  }

  function renderLegenda() {
    const legenda = $('#legend');

    if (state.nivel === 'ruas') {
      legenda.innerHTML = `<h5>Suscetibilidade do terreno</h5>
        <div class="grad" style="background:${faixaPlasma}"></div>
        <div class="grad-eixo"><span>14 m acima do fundo</span><span>no fundo de vale</span></div>
        <div class="foot">Altura do terreno acima do ponto mais baixo da vizinhança, em resolução de
        ${RELEVO[state.cod] ? RELEVO[state.cod].metros_por_pixel : 35} m. O que está mais de 14 m acima
        do fundo de vale fica transparente.</div>`;
      return;
    }

    if (state.nivel === 'bairros' && state.cod && temBairros(state.cod) && state.cores === 'degrade') {
      legenda.innerHTML = legendaDegrade(
        'Risco intraurbano',
        ORDEM_BAIRRO,
        (v) => fmt1(v),
        'Comparação entre bairros da mesma cidade.',
      );
      return;
    }

    if (state.cores === 'degrade' && state.nivel !== 'bairros') {
      const M = METRICS[state.metric];
      const ordenado = state.nivel === 'estados' ? ORDEM_UF[state.metric] : ORDEM_MUN[state.metric];
      legenda.innerHTML = legendaDegrade(
        `${M.short}${M.unit === '/100' ? ' (0 a 100)' : ''}`,
        ordenado,
        (v) => `${M.fmt(v)}${M.unit === '/100' ? '' : M.unit}`,
        `Cor por posição relativa ${state.nivel === 'estados' ? 'entre as 27 UFs' : 'entre os 5.570 municípios'}.`,
      );
      return;
    }

    if (state.nivel === 'bairros' && state.cod && temBairros(state.cod)) {
      const faixas = COLORS.map((cor, i) => {
        const txt = i === 0 ? `até ${fmt1(BREAKS_BAIRRO[0])}`
          : i === 4 ? `acima de ${fmt1(BREAKS_BAIRRO[3])}`
            : `${fmt1(BREAKS_BAIRRO[i - 1])} a ${fmt1(BREAKS_BAIRRO[i])}`;
        return `<div class="row"><span class="sw" style="background:${cor}"></span>${txt}</div>`;
      });
      legenda.innerHTML = `<h5>Risco intraurbano (0 a 100)</h5>${faixas.join('')}
        <div class="foot">Comparação entre bairros da mesma cidade.</div>`;
      return;
    }
    const M = METRICS[state.metric];
    const cortes = state.nivel === 'estados' ? BREAKS_UF[state.metric] : BREAKS_MUN[state.metric];
    const faixas = [];
    let anterior = null;
    for (let i = 0; i < COLORS.length; i++) {
      const topo = cortes[i];
      let texto;
      if (i === 0) texto = `até ${M.fmt(topo)}`;
      else if (i === COLORS.length - 1) texto = `acima de ${M.fmt(anterior)}`;
      else texto = `${M.fmt(anterior)} a ${M.fmt(topo)}`;
      faixas.push(`<div class="row"><span class="sw" style="background:${COLORS[i]}"></span>${texto}</div>`);
      anterior = topo;
    }
    legenda.innerHTML = `<h5>${M.short}${M.unit === '/100' ? ' (0 a 100)' : ''}</h5>${faixas.join('')}
      <div class="foot">Classes por quintis ${state.nivel === 'estados' ? 'entre as 27 UFs' : 'entre os 5.570 municípios'}.</div>`;
  }

  /* ----------------------------------------------------- tela do cidadão */

  function municipioAtual() {
    return state.cod ? byCod.get(state.cod) : null;
  }

  function telaCidadao() {
    const m = municipioAtual();
    const alvo = $('#tela-cidadao');
    if (!m) {
      alvo.innerHTML = telaSemMunicipio('painel do cidadão');
      return;
    }
    const cl = classeDe(m.indice);
    const bairros = temBairros(m.cod) ? BAIRROS[m.cod].bairros.slice(0, 4) : [];
    const ordem = prioridades(m);

    alvo.innerHTML = `
      <div class="tela-inner">
        <div class="tela-head">
          <h1>Painel do cidadão</h1>
          <p>Como a mesma base chega a quem mora no território. Protótipo de alta fidelidade do
          aplicativo e do aviso por mensagem de texto para quem tem pouca conectividade.</p>
        </div>

        <div class="cidadao-grid">
          <div class="fone">
            <div class="fone-top"><span>DrenaCity</span><span>${m.uf}</span></div>
            <div class="fone-body">
              <div class="alerta" style="border-color:${cl.cor}">
                <span class="alerta-tag" style="background:${cl.cor}">Risco ${cl.nome.toLowerCase()}</span>
                <h2>${m.nome}</h2>
                <p>Seu município tem índice ${fmt1(m.indice)} de 100 e
                ${m.chuva_max24h_mm >= 60 ? 'registra chuvas intensas' : 'registra chuvas moderadas'},
                com máxima diária média de ${fmtInt(m.chuva_max24h_mm)} mm.</p>
              </div>

              <h3>O que fazer quando chover forte</h3>
              <ul class="checklist">
                <li>Evite ruas de fundo de vale e passagens sob viadutos.</li>
                <li>Não atravesse água corrente, nem a pé nem de carro.</li>
                <li>Deixe documentos em local alto e o celular carregado.</li>
                <li>Ligue 199 (Defesa Civil) ou 193 (Bombeiros) em emergência.</li>
              </ul>

              ${temRuas(m.cod) && RELEVO[m.cod].pontos.length ? `
              <h3>Onde a água chega primeiro</h3>
              <ul class="mini-rank">
                ${RELEVO[m.cod].pontos.slice(0, 3).map((p) => `<li><span>${p.via || 'Ponto baixo'}${p.bairro ? ', ' + p.bairro : ''}</span><b>${fmtInt(p.acima_do_fundo)} m</b></li>`).join('')}
              </ul>
              <p class="mini">Altura acima do fundo de vale mais próximo. Quanto menor, mais cedo a
              rua alaga.</p>` : ''}

              ${bairros.length ? `
              <h3>Bairros com terreno mais baixo</h3>
              <ul class="mini-rank">
                ${bairros.map((b) => `<li><span>${b.nome}</span><b style="color:${corBairro(b.indice)}">${fmt1(b.indice)}</b></li>`).join('')}
              </ul>` : ''}

              <h3>Registrar um ponto de alagamento</h3>
              <p class="mini">Foto, localização e horário. O registro alimenta o mapa de pontos
              recorrentes usado pela prefeitura na priorização de obras.</p>
              <button class="fone-btn" type="button" disabled>Registrar ocorrência</button>
            </div>
          </div>

          <div class="cidadao-lado">
            <div class="card">
              <h3>Versão por mensagem de texto</h3>
              <p class="mini">Para quem está fora de área de cobertura de dados ou usa aparelho
              simples, o mesmo alerta chega por SMS, sem imagem e sem aplicativo.</p>
              <pre class="sms">DRENACITY ${m.uf}
${m.nome.toUpperCase()}
Risco ${cl.nome.toUpperCase()} de alagamento.
Chuva forte prevista nas proximas 6h.
Evite fundos de vale e nao atravesse agua.
Defesa Civil 199.</pre>
            </div>

            <div class="card">
              <h3>Acessibilidade e inclusão</h3>
              <ul class="checklist">
                <li>Texto em linguagem simples, sem jargão técnico.</li>
                <li>Contraste alto e fonte ampliável, compatível com leitor de tela.</li>
                <li>Alerta em áudio para pessoas com baixa visão ou baixa alfabetização.</li>
                <li>Funciona em aparelho antigo, sem exigir aplicativo instalado.</li>
              </ul>
            </div>

            <div class="card">
              <h3>Por que este município recebe esse alerta</h3>
              <p class="mini">A classificação vem de dados públicos, não de opinião:</p>
              <ul class="checklist">
                <li>${ROTULOS[ordem[0]].charAt(0).toUpperCase()}${ROTULOS[ordem[0]].slice(1)} com pontuação ${m.c[ordem[0]]} de 100.</li>
                <li>${ROTULOS[ordem[1]].charAt(0).toUpperCase()}${ROTULOS[ordem[1]].slice(1)} com pontuação ${m.c[ordem[1]]} de 100.</li>
                <li>${m.enchente_4anos ? `Enchente registrada pelo IBGE em ${m.ano_enchente || 'período recente'}.` : 'Sem enchente registrada pelo IBGE entre 2017 e 2020.'}</li>
                <li>Precipitação anual de ${fmtInt(m.chuva_anual_mm)} mm medida pela NASA POWER.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>`;
  }

  function telaSemMunicipio(nome) {
    const topo = MUNS.slice(0, 8);
    return `<div class="tela-inner">
      <div class="tela-head">
        <h1>${nome.charAt(0).toUpperCase()}${nome.slice(1)}</h1>
        <p>Escolha um município no mapa, na busca ou na lista abaixo.</p>
      </div>
      <ul class="rank rank-largo">${topo.map((m, i) => `
        <li><button data-cod="${m.cod}">
          <span class="pos">${i + 1}</span>
          <span class="nm">${m.nome} <small>${m.uf}</small></span>
          <span class="sc" style="background:${classeDe(m.indice).cor}">${fmt1(m.indice)}</span>
        </button></li>`).join('')}</ul>
    </div>`;
  }

  /* ------------------------------------------------ ficha de priorização */

  function telaFicha() {
    const m = municipioAtual();
    const alvo = $('#tela-ficha');
    if (!m) { alvo.innerHTML = telaSemMunicipio('ficha de priorização'); return; }

    const cl = classeDe(m.indice);
    const ordem = prioridades(m);
    const pesos = DADOS.meta.pesos;
    const r = RELEVO[m.cod] || { metros_por_pixel: 35, pontos: [] };

    alvo.innerHTML = `
      <div class="tela-inner">
        <div class="tela-head no-print">
          <h1>Ficha de priorização</h1>
          <p>Resumo de uma página para instruir processo de obra, plano de contingência ou pedido de
          recurso. Use o botão para imprimir ou salvar em PDF.</p>
          <button class="btn ghost" id="btn-print" type="button">Imprimir ou salvar em PDF</button>
        </div>

        <article class="ficha">
          <header class="ficha-head">
            <div>
              <h2>${m.nome} <small>${m.uf}</small></h2>
              <p>${m.uf_nome}, ${m.meso || m.regiao}. Código IBGE ${m.cod}.</p>
            </div>
            <div class="ficha-score" style="border-color:${cl.cor}">
              <b style="color:${cl.cor}">${fmt1(m.indice)}</b>
              <span>Risco ${cl.nome.toLowerCase()}</span>
              <small>${fmtInt(m.rank_br)} de ${fmtInt(MUNS.length)} no país</small>
            </div>
          </header>

          <section>
            <h3>1. Diagnóstico</h3>
            <table class="tab">
              <thead><tr><th>Componente</th><th>Pontuação</th><th>Peso</th><th>Contribuição</th></tr></thead>
              <tbody>
                ${Object.keys(ROTULOS).map((k) => `<tr>
                  <td>${ROTULOS[k].charAt(0).toUpperCase()}${ROTULOS[k].slice(1)}</td>
                  <td>${m.c[k]}</td>
                  <td>${(pesos[k] * 100).toFixed(0)}%</td>
                  <td>${fmt1(m.c[k] * pesos[k])}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </section>

          <section>
            <h3>2. Evidências</h3>
            <table class="tab">
              <tbody>
                <tr><td>Precipitação anual</td><td>${fmtInt(m.chuva_anual_mm)} mm</td><td>${FONTES.power}</td></tr>
                <tr><td>Chuva máxima em 24 horas</td><td>${fmtInt(m.chuva_max24h_mm)} mm</td><td>${FONTES.power}</td></tr>
                <tr><td>Dias por ano acima de 50 mm</td><td>${fmt1(m.dias_chuva_forte)}</td><td>${FONTES.power}</td></tr>
                <tr><td>Altitude e amplitude</td><td>${fmtInt(m.altitude_m)} m, variação de ${fmtInt(m.amplitude_m)} m</td><td>${FONTES.srtm}</td></tr>
                <tr><td>População urbana</td><td>${fmtInt(m.pop_urbana)} de ${fmtInt(m.populacao)}</td><td>${FONTES.censo}</td></tr>
                <tr><td>Área urbanizada</td><td>${fmt1(m.area_urbanizada_km2)} km², ${fmtInt(m.dens_urbana)} hab/km²</td><td>${FONTES.urbanizada}</td></tr>
                <tr><td>Favelas e comunidades urbanas</td><td>${m.favelas ? `${fmtInt(m.favelas)} áreas, ${fmt1(m.pct_favelas)}% da população` : 'sem registro'}</td><td>${FONTES.censo}</td></tr>
                <tr><td>Serviço de manejo de águas pluviais</td><td>${m.servico_manejo ? 'declarado' : 'não declarado'}</td><td>${FONTES.pnsb}</td></tr>
                <tr><td>Rede de drenagem</td><td>${m.rede_drenagem_km == null ? 'sem informação' : `${fmtInt(m.rede_drenagem_km)} km`}</td><td>${FONTES.pnsb}</td></tr>
                <tr><td>Desastres registrados</td><td>${[m.enchente_4anos && 'enchente', m.enxurrada_4anos && 'enxurrada', m.deslizamento_4anos && 'deslizamento'].filter(Boolean).join(', ') || 'nenhum'}</td><td>${FONTES.munic}</td></tr>
              </tbody>
            </table>
          </section>

          ${temRuas(m.cod) && r.pontos.length ? `
          <section>
            <h3>3. Pontos críticos em escala de rua</h3>
            <table class="tab">
              <thead><tr><th>Local</th><th>Cota</th><th>Acima do fundo de vale</th></tr></thead>
              <tbody>
                ${r.pontos.map((p) => `<tr>
                  <td>${p.via || 'via não nomeada'}${p.bairro ? ', ' + p.bairro : ''}</td>
                  <td>${fmtInt(p.cota)} m</td>
                  <td>${fmtInt(p.acima_do_fundo)} m</td>
                </tr>`).join('')}
              </tbody>
            </table>
            <p class="ficha-nota">Modelo digital de elevação Terrarium em ${fmtInt(r.metros_por_pixel)} m
            por pixel. Nomes de via do OpenStreetMap.</p>
          </section>` : ''}

          <section>
            <h3>${temRuas(m.cod) && r.pontos.length ? '4' : '3'}. Intervenções prioritárias</h3>
            <ol class="ficha-acoes">
              <li><b>${ROTULOS[ordem[0]].charAt(0).toUpperCase()}${ROTULOS[ordem[0]].slice(1)}:</b> ${ACOES[ordem[0]]}.</li>
              <li><b>${ROTULOS[ordem[1]].charAt(0).toUpperCase()}${ROTULOS[ordem[1]].slice(1)}:</b> ${ACOES[ordem[1]]}.</li>
              <li><b>${ROTULOS[ordem[2]].charAt(0).toUpperCase()}${ROTULOS[ordem[2]].slice(1)}:</b> ${ACOES[ordem[2]]}.</li>
            </ol>
          </section>

          <section>
            <h3>${temRuas(m.cod) && r.pontos.length ? '5' : '4'}. Preenchimento da equipe técnica</h3>
            <table class="tab tab-form">
              <tbody>
                <tr><td>Sub-bacia ou setor prioritário</td><td class="linha"></td></tr>
                <tr><td>Intervenção selecionada</td><td class="linha"></td></tr>
                <tr><td>Custo estimado e fonte de recurso</td><td class="linha"></td></tr>
                <tr><td>Prazo e responsável</td><td class="linha"></td></tr>
                <tr><td>Indicador de acompanhamento</td><td class="linha"></td></tr>
              </tbody>
            </table>
          </section>

          <footer class="ficha-foot">
            DrenaCity, base gerada em ${DADOS.gerado_em}. Fontes: IBGE (Censo 2022, Áreas Urbanizadas
            2019, Munic 2020, PNSB), NASA POWER e SRTM. Documento de apoio à priorização, não
            substitui estudo hidrológico local.
          </footer>
        </article>
      </div>`;

    const botao = $('#btn-print');
    if (botao) botao.addEventListener('click', () => window.print());
  }

  /* ----------------------------------------------------------------- telas */

  function mostrarTela(tela) {
    state.tela = tela;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.tela === tela)));
    $('#tela-mapa').hidden = tela !== 'mapa';
    $('#tela-cidadao').hidden = tela !== 'cidadao';
    $('#tela-ficha').hidden = tela !== 'ficha';
    document.body.classList.toggle('modo-ficha', tela === 'ficha');
    if (tela === 'cidadao') telaCidadao();
    if (tela === 'ficha') telaFicha();
    if (tela === 'mapa') setTimeout(() => map.invalidateSize(), 60);
  }

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => mostrarTela(t.dataset.tela));
  });

  document.querySelectorAll('.tela').forEach((sec) => {
    sec.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-cod]');
      if (!b) return;
      selecionarMunicipio(b.dataset.cod, { semVoo: true });
      mostrarTela(state.tela);
    });
  });

  /* ---------------------------------------------------------------- busca */

  const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const indiceBusca = MUNS.map((m) => ({ m, k: normalizar(`${m.nome} ${m.uf}`) }));

  const inputBusca = $('#search');
  const listaBusca = $('#search-results');
  let marcado = -1;

  function fecharBusca() {
    listaBusca.hidden = true;
    listaBusca.innerHTML = '';
    inputBusca.setAttribute('aria-expanded', 'false');
    marcado = -1;
  }

  function buscar(termo) {
    const q = normalizar(termo.trim());
    if (q.length < 2) return fecharBusca();
    const comeca = [];
    const contem = [];
    for (const item of indiceBusca) {
      if (item.k.startsWith(q)) comeca.push(item.m);
      else if (item.k.includes(q)) contem.push(item.m);
      if (comeca.length >= 10) break;
    }
    const res = comeca.concat(contem).slice(0, 10);
    if (!res.length) {
      listaBusca.innerHTML = '<li class="r-meta">Nenhum município encontrado</li>';
      listaBusca.hidden = false;
      return;
    }
    listaBusca.innerHTML = res.map((m, i) => `
      <li role="option" data-cod="${m.cod}" data-i="${i}">
        <span class="r-name">${m.nome} <span class="r-meta">${m.uf}</span></span>
        <span class="r-score" style="background:${classeDe(m.indice).cor}">${fmt1(m.indice)}</span>
      </li>`).join('');
    listaBusca.hidden = false;
    inputBusca.setAttribute('aria-expanded', 'true');
    marcado = -1;
  }

  function escolherBusca(cod) {
    selecionarMunicipio(cod, { semVoo: state.tela !== 'mapa' });
    inputBusca.value = '';
    fecharBusca();
    if (state.tela !== 'mapa') mostrarTela(state.tela);
  }

  inputBusca.addEventListener('input', (ev) => buscar(ev.target.value));
  inputBusca.addEventListener('keydown', (ev) => {
    const itens = Array.from(listaBusca.querySelectorAll('li[data-cod]'));
    if (ev.key === 'Escape') return fecharBusca();
    if (!itens.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      marcado = (marcado + (ev.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
      itens.forEach((li, i) => li.setAttribute('aria-selected', String(i === marcado)));
      itens[marcado].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const alvo = itens[marcado >= 0 ? marcado : 0];
      if (alvo) escolherBusca(alvo.dataset.cod);
    }
  });
  listaBusca.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-cod]');
    if (li) escolherBusca(li.dataset.cod);
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.search')) fecharBusca(); });

  /* ------------------------------------------------------------ controles */

  document.querySelectorAll('.seg-btn[data-nivel]').forEach((b) => {
    b.addEventListener('click', () => setNivel(b.dataset.nivel));
  });

  document.querySelectorAll('.seg-btn[data-cores]').forEach((b) => {
    b.addEventListener('click', () => {
      state.cores = b.dataset.cores;
      document.querySelectorAll('.seg-btn[data-cores]').forEach((x) => {
        x.setAttribute('aria-pressed', String(x.dataset.cores === state.cores));
      });
      repintar();
      renderLegenda();
    });
  });

  const botaoCalor = $('#btn-calor');
  botaoCalor.addEventListener('click', () => {
    state.calor = !state.calor;
    botaoCalor.setAttribute('aria-pressed', String(state.calor));
    atualizarCalor();
    repintar();
  });

  $('#metric').addEventListener('change', (ev) => {
    state.metric = ev.target.value;
    repintar();
    renderLegenda();
    atualizarCalor();
  });

  $('#thr').addEventListener('input', (ev) => {
    state.thr = Number(ev.target.value);
    $('#thr-val').textContent = state.thr;
    if (munLayer) munLayer.setStyle(estiloMun);
    atualizarCalor();
    renderPanel();
  });

  crumbs.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-go]');
    if (!b) return;
    if (b.dataset.go === 'br') irParaBrasil();
    else if (b.dataset.go === 'uf') abrirUf(state.uf);
    else { state.bairro = null; repintar(); renderPanel(); }
  });

  panelBody.addEventListener('click', (ev) => {
    const ponto = ev.target.closest('button[data-lat]');
    if (ponto) {
      map.flyTo([Number(ponto.dataset.lat), Number(ponto.dataset.lon)], 16, { duration: 1 });
      return;
    }

    const bairro = ev.target.closest('button[data-bairro]');
    if (bairro) return selecionarBairro(bairro.dataset.bairro);

    const mun = ev.target.closest('button[data-cod]');
    if (mun) {
      selecionarMunicipio(mun.dataset.cod);
      if (mun.dataset.bairros) setNivel('bairros');
      if (mun.dataset.ruas) setNivel('ruas');
      return;
    }

    const uf = ev.target.closest('button[data-uf]');
    if (uf) return abrirUf(uf.dataset.uf);

    const acao = ev.target.closest('button[data-abrir]');
    if (acao) {
      if (acao.dataset.abrir === 'bairros') setNivel('bairros');
      else if (acao.dataset.abrir === 'ruas') setNivel('ruas');
      else mostrarTela(acao.dataset.abrir);
    }
  });

  /* ---------------------------------------------------------------- modal */

  const modal = $('#modal');
  $('#btn-metodologia').addEventListener('click', () => { $('#modal-body').innerHTML = modalHtml(); modal.hidden = false; });
  $('#modal-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') modal.hidden = true; });

  function modalHtml() {
    const pesos = DADOS.meta.pesos;
    const cob = DADOS.meta.cobertura;
    return `
      <p>O DrenaCity reúne bases públicas dispersas em um <b>índice municipal de risco de alagamento</b>
      (0 a 100) e em uma camada de risco relativo por bairro, para apoiar a priorização de estudos e
      obras de drenagem urbana. Todas as variáveis são medidas ou declaradas por fonte oficial.</p>

      <h3>Fontes de dados</h3>
      <table><thead><tr><th>Fonte</th><th>O que entra no modelo</th></tr></thead><tbody>
        ${DADOS.meta.fontes.map((f) => `<tr><td><b>${f.nome}</b></td><td>${f.detalhe}</td></tr>`).join('')}
      </tbody></table>

      <h3>Composição do índice</h3>
      <table><thead><tr><th>Componente</th><th>Peso</th><th>Base</th></tr></thead><tbody>
        <tr><td>Exposição hidrológica</td><td>${(pesos.hidrologica * 100).toFixed(0)}%</td><td>chuva anual, chuva máxima em 24 h e dias acima de 50 mm (NASA POWER)</td></tr>
        <tr><td>Déficit de drenagem</td><td>${(pesos.infraestrutura * 100).toFixed(0)}%</td><td>serviço de manejo, tipo de drenagem, dispositivo de detenção e extensão da rede (PNSB)</td></tr>
        <tr><td>Adensamento urbano</td><td>${(pesos.impermeabilizacao * 100).toFixed(0)}%</td><td>densidade na área urbanizada e proporção do território urbanizado (IBGE)</td></tr>
        <tr><td>Relevo e altimetria</td><td>${(pesos.relevo * 100).toFixed(0)}%</td><td>altitude e amplitude altimétrica (SRTM 90 m)</td></tr>
        <tr><td>Vulnerabilidade social</td><td>${(pesos.vulnerabilidade * 100).toFixed(0)}%</td><td>população em favelas e comunidades urbanas, densidade e porte populacional (Censo 2022)</td></tr>
        <tr><td>Histórico de enchentes</td><td>${(pesos.historico * 100).toFixed(0)}%</td><td>enchentes, enxurradas e deslizamentos registrados (Munic 2020 e PNSB)</td></tr>
      </tbody></table>

      <p>Cada componente é normalizado de 0 a 100. A média ponderada gera um escore bruto, que é
      padronizado por z-score e reescalado para 0 a 100, com compressão dos extremos por tangente
      hiperbólica. O índice expressa a posição relativa do município entre os 5.570 do país.
      Classes: muito alto (75 ou mais), alto (60 a 75), médio (45 a 60), baixo (30 a 45) e muito
      baixo (abaixo de 30).</p>

      <h3>Escala de rua</h3>
      <p>Dentro da cidade, o que define onde a água se acumula é o terreno. A camada de rua usa o
      modelo digital de elevação Terrarium (AWS Open Data, derivado de SRTM e NASADEM) em resolução
      de dezenas de metros. Para cada pixel calcula-se a altura acima do ponto mais baixo da
      vizinhança, em duas escalas (600 m e 2,5 km), e a declividade local. O resultado segue o
      mesmo princípio do HAND, altura acima da drenagem mais próxima, usado em mapeamento de
      inundação. Os pontos críticos recebem o nome da via pelo OpenStreetMap.</p>
      <p>Essa camada mostra onde a água chega, e não a capacidade das galerias daquela rua. Ela
      indica onde investigar em campo.</p>

      <h3>Camada de bairros</h3>
      <p>Dentro da cidade, o que diferencia uma rua da outra é o terreno. A camada intraurbana usa
      limites de bairro e hidrografia do OpenStreetMap com altimetria SRTM, e combina cota do
      terreno em relação à cidade, planicidade local e distância ao curso d'água mais próximo. É um
      risco <b>relativo à própria cidade</b>, não comparável entre municípios.</p>

      <h3>Cobertura e lacunas</h3>
      <ul>
        <li>${fmtInt(cob.municipios)} municípios com índice calculado.</li>
        <li>${fmtInt(cob.com_enchente)} municípios registraram enchente ou inundação gradual entre 2017 e 2020.</li>
        <li>${fmtInt(cob.com_favelas)} municípios têm favelas ou comunidades urbanas no Censo 2022.</li>
        <li>${fmtInt(cob.sem_pnsb)} municípios não têm resposta na PNSB, e nesses casos o componente de
        drenagem recebe valor neutro, sem penalizar nem beneficiar o território.</li>
      </ul>

      <h3>Uso responsável dos dados (LGPD)</h3>
      <ul>
        <li>Todos os indicadores são agregados por município ou por bairro. Nenhum dado pessoal,
        endereço ou registro individual é coletado, armazenado ou exibido.</li>
        <li>Fontes abertas e públicas, com finalidade de interesse público (art. 7º, III da LGPD).</li>
        <li>A plataforma é estática, sem cookies, rastreadores ou login.</li>
        <li>Se o registro cidadão de ocorrências for implantado, ele deve coletar o mínimo necessário
        (ponto e horário), sem identificar o autor, com consentimento explícito e retenção limitada.</li>
      </ul>

      <h3>Limitações e vieses reconhecidos</h3>
      <ul>
        <li><b>Autodeclaração:</b> Munic e PNSB dependem da resposta da prefeitura. Municípios com
        equipe técnica reduzida tendem a subnotificar, o que subestima o risco onde há menos estrutura.</li>
        <li><b>Defasagem:</b> a PNSB de drenagem é de 2008 e a extensão da rede é de 2000. São as bases
        nacionais mais recentes com cobertura municipal completa, e precisam ser atualizadas por
        cadastro local.</li>
        <li><b>Escala:</b> o alagamento é um fenômeno de sub-bacia e de rua. O índice municipal orienta
        a priorização, e a camada de bairro reduz, mas não elimina, essa limitação.</li>
        <li><b>Grade climática:</b> a precipitação vem de uma grade de 0,5 grau (cerca de 55 km), que
        suaviza eventos convectivos localizados.</li>
        <li><b>Cobertura do OpenStreetMap:</b> o mapeamento de bairros e hidrografia é desigual entre
        cidades, o que pode favorecer centros urbanos mais mapeados.</li>
      </ul>`;
  }

  /* ------------------------------------------------------------------ init */

  setNivel('estados');
  mostrarTela('mapa');
  console.log(`DrenaCity: ${MUNS.length} municípios, ${UFS.length} UFs, ${Object.keys(BAIRROS).length} cidades com bairros.`);
})();
