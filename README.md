# DrenaCity

**Inteligência territorial para prevenção de alagamentos urbanos.**

Plataforma web que cruza dados públicos de clima, relevo, urbanização, saneamento e registros
oficiais de desastre para responder a uma pergunta de gestão: *onde o alagamento é mais provável e
onde investir primeiro*. Cobre os 5.570 municípios brasileiros, com navegação do país ao estado, do
estado ao município e, nas cidades processadas, do município ao bairro.

Todas as variáveis vêm de fonte pública real. Nenhuma é simulada.

---

## Como executar

Pré-requisito: Node.js. Não há dependências a instalar.

```bash
node scripts/serve.mjs
```

Depois abra `http://localhost:5173`.

O mapa base vem da internet. Sem conexão, as malhas do IBGE continuam sendo desenhadas sobre o
fundo escuro e todos os indicadores seguem funcionando, porque ficam embutidos nos arquivos de
dados.

---

## As três telas

| Tela | Para quem | O que entrega |
|---|---|---|
| **Mapa** | gestor público, equipe técnica | coroplético nacional por estado, município ou bairro, com 14 indicadores, filtro de risco mínimo, busca e painel de diagnóstico |
| **Painel do cidadão** | morador | protótipo do aviso no celular, versão em mensagem de texto para baixa conectividade, orientações de segurança e explicação de por que aquele município recebe o alerta |
| **Ficha de priorização** | secretaria de obras, Defesa Civil | resumo de uma página por município, com diagnóstico, evidências, intervenções prioritárias e campos para a equipe preencher. Imprime ou salva em PDF |

O seletor de nível controla a granularidade do mapa, do país à rua:

| Nível | O que mostra |
|---|---|
| **Estados** | as 27 unidades da federação, com índice ponderado por população |
| **Municípios** | os 5.570 municípios, do país inteiro ou de um estado |
| **Bairros** | risco relativo entre bairros da mesma cidade, nas cidades processadas |
| **Ruas** | suscetibilidade do terreno em resolução de dezenas de metros, com pontos críticos nomeados por via |

Clicar em um estado abre os municípios daquele estado, clicar em um município abre o diagnóstico, e
no nível de rua clicar em qualquer ponto informa a suscetibilidade daquele trecho.

As cores têm dois modos: **degradê** contínuo, em que a cor vem da posição relativa do território
entre todos os outros, e **classes**, em cinco faixas. O botão **mapa de calor** sobrepõe uma
superfície contínua que evidencia aglomerações de risco.

---

## Índice de risco de alagamento (0 a 100)

Seis componentes, cada um normalizado de 0 a 100 a partir de dados medidos ou declarados:

| Componente | Peso | Base real |
|---|---|---|
| Exposição hidrológica | 22% | chuva anual, chuva máxima em 24 h e dias acima de 50 mm (NASA POWER, 2015-2024) |
| Déficit de drenagem | 18% | serviço de manejo de águas pluviais, tipo de drenagem nas ruas pavimentadas, dispositivo de detenção e extensão da rede (IBGE PNSB) |
| Adensamento urbano | 17% | densidade na área urbanizada e proporção do território urbanizado (IBGE) |
| Relevo e altimetria | 16% | altitude e amplitude altimétrica em cinco pontos por município (SRTM 90 m) |
| Vulnerabilidade social | 15% | população em favelas e comunidades urbanas, densidade e porte populacional (Censo 2022) |
| Histórico de enchentes | 12% | enchentes, enxurradas e deslizamentos registrados (IBGE Munic 2020 e PNSB) |

A média ponderada gera um escore bruto, padronizado por z-score e reescalado para 0 a 100, com
compressão dos extremos por tangente hiperbólica. O índice expressa a posição relativa do município
entre os 5.570 do país.

Classes: **muito alto** (75 ou mais), **alto** (60 a 75), **médio** (45 a 60), **baixo** (30 a 45),
**muito baixo** (abaixo de 30).

### Escala de bairro e de rua

Dentro da cidade, o terreno é o que diferencia uma rua da outra.

A **camada de rua** usa o modelo digital de elevação Terrarium (AWS Open Data, derivado de SRTM e
NASADEM) em tiles de 256 px. Para cada pixel, o pipeline calcula a altura acima do ponto mais baixo
da vizinhança em duas escalas (600 m e 2,5 km) e a declividade local, seguindo o mesmo princípio do
HAND (height above nearest drainage) usado em mapeamento de inundação. O resultado é gravado como
PNG georreferenciado e sobreposto ao mapa. Os cinco pontos mais críticos de cada cidade recebem o
nome da via pelo OpenStreetMap.

A **camada de bairro** combina cota do bairro em relação à cidade, planicidade local e distância ao
curso d'água mais próximo, com limites e hidrografia do OpenStreetMap. É um risco **relativo à
própria cidade**, não comparável entre municípios.

---

## Fontes de dados

| Fonte | Ano | O que entra |
|---|---|---|
| IBGE, Censo Demográfico | 2022 | população residente, população urbana, área, densidade, favelas e comunidades urbanas |
| IBGE, Áreas Urbanizadas do Brasil | 2019 | área urbanizada e área urbanizada densa por município |
| IBGE, Munic | 2020 | enchentes, enxurradas e deslizamentos nos últimos 4 anos, ocupações irregulares atingidas e intervenções realizadas |
| IBGE, PNSB | 2008 e 2000 | inundações urbanas, tipo de drenagem, dispositivos de detenção, serviço de manejo e extensão da rede |
| IBGE, Malhas territoriais | 2022 | geometria de municípios e estados |
| NASA POWER | 2015-2024 | precipitação diária em grade de 0,5 grau |
| SRTM 90 m, via Open Topo Data | 2000 | altimetria amostrada em cinco pontos por município |
| Terrarium, AWS Open Data | contínuo | modelo digital de elevação em escala de rua, derivado de SRTM e NASADEM |
| OpenStreetMap | contínuo | limites de bairro e hidrografia urbana |

### Reprodução da base

```bash
node scripts/fetch_dados.mjs <pasta_de_cache>
```

```bash
node scripts/build_dataset.mjs <pasta_de_cache>
```

```bash
node scripts/fetch_bairros.mjs <pasta_de_cache> 4314902,2611606
```

```bash
node scripts/fetch_relevo_urbano.mjs <pasta_de_cache> 4314902,2611606
```

O coletor guarda cada resposta em cache, então pode ser interrompido e retomado. A pasta de cache
fica fora do projeto para não carregar centenas de megabytes de respostas brutas no repositório.

---

## Arquivos gerados em `data/`

| Arquivo | Uso |
|---|---|
| `drenacity_municipios.csv` | base tabular com 5.570 linhas e 35 colunas, pronta para o notebook de Machine Learning |
| `indicadores.js` | indicadores municipais e agregados estaduais consumidos pelo site |
| `geo-municipios.js`, `geo-estados.js` | malhas do IBGE no formato carregado pelo site |
| `bairros.js` | camada de bairros das cidades processadas |
| `relevo.js` e `relevo/*.png` | rasters de suscetibilidade em escala de rua |
| `municipios.geojson`, `estados.geojson` | mesmas malhas em GeoJSON puro |

### Para a entrega de Machine Learning

O CSV traz um alvo de classificação com rótulo real: **`enchente_4anos`**, que indica se o IBGE
registrou enchente ou inundação gradual no município entre 2017 e 2020 (Munic 2020). As preditoras
são físicas e territoriais: chuva, altimetria, declividade, densidade, área urbanizada, favelas e
infraestrutura de drenagem.

Evite usar `indice_risco` como alvo com essas mesmas colunas: o índice é calculado a partir delas,
o que geraria vazamento de informação. Se o grupo quiser um alvo de regressão, use uma variável
contínua observada, como `dias_chuva_forte` ou a extensão da rede de drenagem.

---

## Uso responsável dos dados

- Todos os indicadores são agregados por município ou por bairro. Nenhum dado pessoal, endereço ou
  registro individual é coletado, armazenado ou exibido (LGPD, art. 7º, III).
- Site estático, sem cookies, rastreadores ou login.
- Se o registro cidadão de ocorrências for implantado, deve coletar o mínimo necessário (ponto e
  horário), sem identificar o autor, com consentimento explícito e retenção limitada.

### Limitações reconhecidas

- **Autodeclaração:** Munic e PNSB dependem da resposta da prefeitura, e municípios com equipe
  técnica reduzida tendem a subnotificar.
- **Defasagem:** a PNSB de drenagem é de 2008 e a extensão da rede é de 2000. São as bases nacionais
  mais recentes com cobertura municipal completa.
- **Escala:** o alagamento é um fenômeno de sub-bacia e de rua. O índice municipal orienta a
  priorização, e a camada de bairro reduz, mas não elimina, essa limitação.
- **Grade climática:** a precipitação vem de uma grade de 0,5 grau, que suaviza eventos convectivos
  muito localizados.
- **Cobertura do OpenStreetMap:** o mapeamento de bairros e hidrografia varia entre cidades.

---

## Publicação

O projeto é um site estático: não tem build, backend nem variáveis de ambiente. Qualquer
hospedagem de arquivos estáticos serve.

### Netlify

1. Crie um repositório vazio no GitHub, sem README nem .gitignore.
2. Aponte este projeto para ele e envie:

```bash
git remote add origin https://github.com/SEU_USUARIO/drenacity.git
```

```bash
git push -u origin main
```

3. Na Netlify, escolha **Add new site**, **Import an existing project**, conecte o GitHub e
   selecione o repositório.
4. Deixe o **build command** vazio e o **publish directory** como `.` (ponto). O arquivo
   `netlify.toml` na raiz já traz essa configuração, então a Netlify costuma preencher sozinha.
5. Clique em **Deploy**. Cada `git push` passa a republicar o site automaticamente.

O repositório tem cerca de 18 MB, quase tudo em dados: malhas do IBGE, indicadores e os rasters
de relevo urbano. Está bem abaixo dos limites do GitHub e do plano gratuito da Netlify.

---

## Estrutura

```
DrenaCity/
├── index.html                 # estrutura das três telas
├── assets/css/style.css       # tema escuro, layout, ficha para impressão
├── assets/js/app.js           # mapa, camadas, métricas, busca, painéis e telas
├── data/                      # indicadores, malhas, bairros e CSV
└── scripts/
    ├── fetch_dados.mjs        # coleta IBGE, NASA POWER e SRTM
    ├── fetch_bairros.mjs      # coleta a camada de bairros
    ├── fetch_relevo_urbano.mjs # raster de suscetibilidade em escala de rua
    ├── build_dataset.mjs      # monta o índice e grava os arquivos de dados
    └── serve.mjs              # servidor estático local
```

Tecnologias: HTML, CSS e JavaScript puro, com [Leaflet 1.9.4](https://leafletjs.com) para o mapa e
mapa base Esri Dark Gray. Sem build, sem framework e sem backend.
