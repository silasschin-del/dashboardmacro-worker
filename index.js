/**
 * DashboardMacro Worker v3
 * 
 * ARQUITETURA DE CÁLCULO:
 * ─────────────────────────────────────────────────────────────
 * 
 * CAMPOS PRESERVADOS (contagem simples):
 *   alta    = número de fatores com pressão altista (0-39)
 *   baixa   = número de fatores com pressão baixista (0-39)
 *   neutro  = número de fatores sem direção (0-39)
 *   rastro  = (alta_peso - baixa_peso) / max_peso × 100
 * 
 * CAMPOS NOVOS (intensidade ponderada):
 *   alta_strength   = pressão altista ponderada e normalizada (0-100)
 *   baixa_strength  = pressão baixista ponderada e normalizada (0-100)
 *   rastro_strength = indicador avançado que combina:
 *                     1. Pressão líquida ponderada
 *                     2. Aceleração (derivada da pressão)
 *                     3. Persistência (EMA da pressão)
 * 
 * POR QUE ISSO MELHORA A ANTECIPAÇÃO:
 *   - Um fator com variação de 2% contribui 40x mais que um com 0.05%
 *   - A aceleração detecta mudança de regime ANTES da contagem mudar
 *   - A EMA suaviza ruído sem perder sensibilidade a tendências
 *   - O rastro_strength reage antes do rastro simples
 */

const https = require('https')
const { createClient } = require('@supabase/supabase-js')

// ── CONFIGURAÇÃO ──────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '300000') // 5 minutos
const START_HOUR = parseInt(process.env.START_HOUR || '5')
const END_HOUR = parseInt(process.env.END_HOUR || '23')
const MIN_FACTORS = 30        // mínimo para salvar
const NEUTRO_THRESHOLD = 0.02 // % mínimo para não ser neutro
const EMA_ALPHA = 0.3         // fator de suavização da EMA (0=lento, 1=rápido)
const ACEL_WEIGHT = 0.4       // peso da aceleração no rastro_strength

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERRO: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── FATORES MACROECONÔMICOS ───────────────────────────────────
/**
 * dir:'pos' = fator sobe junto com USD (ex: JPY/USD sobe = dólar forte)
 * dir:'neg' = fator cai junto com USD (ex: EUR/USD cai = dólar forte)
 * p = peso na composição do rastro (soma total = MAX_RASTRO)
 */
const FATORES = {
  // CÂMBIO
  'EURUSD=X': { p:7,  dir:'neg', cat:'CÂMBIO' },
  'JPY=X':    { p:7,  dir:'pos', cat:'CÂMBIO' },
  'BRL=X':    { p:12, dir:'pos', cat:'CÂMBIO BR' },
  'CNY=X':    { p:6,  dir:'pos', cat:'CHINA' },
  'MXN=X':    { p:5,  dir:'pos', cat:'EMERGENTE' },
  'CHF=X':    { p:4,  dir:'pos', cat:'SAFE HAVEN' },
  'GBPUSD=X': { p:4,  dir:'neg', cat:'CÂMBIO' },
  'AUDUSD=X': { p:4,  dir:'neg', cat:'CÂMBIO' },
  // JUROS
  '^TNX':     { p:8,  dir:'pos', cat:'YIELD' },
  '^IRX':     { p:6,  dir:'pos', cat:'YIELD' },
  '^FVX':     { p:5,  dir:'pos', cat:'YIELD' },
  'TLT':      { p:1,  dir:'neg', cat:'BOND ETF' },
  'SHY':      { p:1,  dir:'neg', cat:'BOND ETF' },
  'IEF':      { p:1,  dir:'neg', cat:'BOND ETF' },
  // FUTUROS EUA
  'ES=F':     { p:10, dir:'neg', cat:'FUTURO' },
  'NQ=F':     { p:8,  dir:'neg', cat:'FUTURO' },
  'YM=F':     { p:6,  dir:'neg', cat:'FUTURO' },
  'RTY=F':    { p:5,  dir:'neg', cat:'FUTURO' },
  // VOLATILIDADE
  '^VIX':     { p:10, dir:'pos', cat:'VOLATIL.' },
  'EMB':      { p:1,  dir:'neg', cat:'EMBI' },
  'EEM':      { p:1,  dir:'neg', cat:'EMERGENTE' },
  // COMMODITIES
  'GC=F':     { p:7,  dir:'neg', cat:'METAIS' },
  'CL=F':     { p:5,  dir:'neg', cat:'ENERGIA' },
  'BZ=F':     { p:4,  dir:'neg', cat:'ENERGIA' },
  'ZS=F':     { p:7,  dir:'neg', cat:'AGRO BR' },
  'ZC=F':     { p:4,  dir:'neg', cat:'AGRO BR' },
  'HG=F':     { p:6,  dir:'neg', cat:'METAIS' },
  // BOLSAS MUNDO
  '^GDAXI':   { p:4,  dir:'neg', cat:'EUROPA' },
  '^FTSE':    { p:3,  dir:'neg', cat:'EUROPA' },
  '^N225':    { p:4,  dir:'neg', cat:'ÁSIA' },
  '^HSI':     { p:3,  dir:'neg', cat:'ÁSIA' },
  // BRASIL
  '^BVSP':    { p:3,  dir:'neg', cat:'BRASIL' },
  'EWZ':      { p:1,  dir:'neg', cat:'BRASIL' },
  'VALE':     { p:1,  dir:'neg', cat:'BRASIL' },
  'PBR':      { p:1,  dir:'neg', cat:'BRASIL' },
  'ITUB':     { p:1,  dir:'neg', cat:'BRASIL' },
  // CRYPTO
  'BTC-USD':  { p:5,  dir:'neg', cat:'CRYPTO' },
  'ETH-USD':  { p:2,  dir:'neg', cat:'CRYPTO' },
  'XLF':      { p:1,  dir:'pos', cat:'SETOR' },
}

const SYMBOLS = Object.keys(FATORES)
const MAX_RASTRO = Object.values(FATORES).reduce((a, f) => a + f.p, 0)

// Máximo teórico de strength (peso × variação máxima esperada de 5%)
const MAX_STRENGTH_PCT = 5.0
const MAX_STRENGTH = Object.values(FATORES).reduce((a, f) => a + f.p * MAX_STRENGTH_PCT, 0)

// ── ESTADO DA EMA (persiste entre coletas) ────────────────────
let emaRastro = null // EMA do rastro_strength

// ── HORÁRIO BRASÍLIA UTC-3 FIXO ───────────────────────────────
function getBrTime() {
  const now = new Date()
  const brMs = now.getTime() - (3 * 60 * 60 * 1000)
  const br = new Date(brMs)
  return {
    date: `${br.getUTCFullYear()}-${String(br.getUTCMonth()+1).padStart(2,'0')}-${String(br.getUTCDate()).padStart(2,'0')}`,
    time: `${String(br.getUTCHours()).padStart(2,'0')}:${String(br.getUTCMinutes()).padStart(2,'0')}`,
    hour: br.getUTCHours(),
    day: br.getUTCDay()
  }
}

function shouldCollect() {
  const { hour, day } = getBrTime()
  if (day === 6) return false
  if (day === 0 && hour < 21) return false
  return hour >= START_HOUR && hour <= END_HOUR
}

// ── COLETA COM RETRY ──────────────────────────────────────────
function fetchOnce(sym, urlIndex) {
  const encoded = encodeURIComponent(sym)
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`,
  ]
  if (urlIndex >= urls.length) return Promise.resolve(null)
  const u = new URL(urls[urlIndex])
  return new Promise(resolve => {
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          if (j?.chart?.result?.[0]) {
            const m = j.chart.result[0].meta
            const price = m.regularMarketPrice || 0
            const prev = m.chartPreviousClose || m.previousClose || price
            if (price > 0) return resolve({ sym, price, pct: prev ? ((price-prev)/prev)*100 : 0 })
          }
          if (j?.quoteResponse?.result?.[0]) {
            const q = j.quoteResponse.result[0]
            const price = q.regularMarketPrice || 0
            const prev = q.regularMarketPreviousClose || price
            if (price > 0) return resolve({ sym, price, pct: prev ? ((price-prev)/prev)*100 : 0 })
          }
          resolve(null)
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

async function fetchQuote(sym) {
  for (let i = 0; i < 3; i++) {
    const r = await fetchOnce(sym, i)
    if (r) return r
    if (i < 2) await new Promise(r => setTimeout(r, 400))
  }
  return null
}

// ── CÁLCULO DE SCORES ─────────────────────────────────────────
/**
 * ALGORITMO PRINCIPAL:
 * 
 * 1. CONTAGEM SIMPLES (campos originais):
 *    Para cada fator, verifica se |pct| > NEUTRO_THRESHOLD
 *    Se sim, classifica como altista ou baixista pela direção
 *    Conta quantos são alta, baixa, neutro
 * 
 * 2. INTENSIDADE PONDERADA (campos novos):
 *    alta_strength = Σ(peso × |pct|) dos fatores altistas / MAX_STRENGTH × 100
 *    baixa_strength = Σ(peso × |pct|) dos fatores baixistas / MAX_STRENGTH × 100
 *    Fatores com maior variação % contribuem proporcionalmente mais
 * 
 * 3. RASTRO SIMPLES (campo original):
 *    rastro = (Σpeso_alta - Σpeso_baixa) / MAX_RASTRO × 100
 * 
 * 4. RASTRO AVANÇADO (campo novo):
 *    pressao_liquida = alta_strength - baixa_strength
 *    aceleracao = pressao_liquida - ema_anterior (detecta mudança de regime)
 *    ema = alpha × pressao_liquida + (1-alpha) × ema_anterior (suaviza ruído)
 *    rastro_strength = pressao_liquida + (aceleracao × ACEL_WEIGHT)
 *    Clamped entre -100 e +100
 */
function calcScores(quotes) {
  let alta = 0, baixa = 0, neutro = 0
  let rastro_peso = 0
  let alta_strength_raw = 0
  let baixa_strength_raw = 0

  const falhas = []

  for (const sym of SYMBOLS) {
    const q = quotes.find(x => x.sym === sym)
    const def = FATORES[sym]

    if (!q) { neutro++; falhas.push(sym); continue }

    const absPct = Math.abs(q.pct)

    // Classificação direcional
    if (absPct < NEUTRO_THRESHOLD) {
      neutro++
      continue
    }

    const pressaoAlta = (def.dir === 'pos' && q.pct > 0) || (def.dir === 'neg' && q.pct < 0)

    if (pressaoAlta) {
      alta++
      rastro_peso += def.p
      // Intensidade = peso × variação absoluta (capped em MAX_STRENGTH_PCT)
      alta_strength_raw += def.p * Math.min(absPct, MAX_STRENGTH_PCT)
    } else {
      baixa++
      rastro_peso -= def.p
      baixa_strength_raw += def.p * Math.min(absPct, MAX_STRENGTH_PCT)
    }
  }

  // Rastro simples normalizado (-100 a +100)
  const rastro = Math.round((rastro_peso / MAX_RASTRO) * 100)

  // Intensidade normalizada (0 a 100)
  const alta_strength = parseFloat((alta_strength_raw / MAX_STRENGTH * 100).toFixed(2))
  const baixa_strength = parseFloat((baixa_strength_raw / MAX_STRENGTH * 100).toFixed(2))

  // Pressão líquida ponderada (-100 a +100)
  const pressao_liquida = alta_strength - baixa_strength

  // EMA da pressão líquida (persistência)
  if (emaRastro === null) emaRastro = pressao_liquida
  const ema_anterior = emaRastro
  emaRastro = EMA_ALPHA * pressao_liquida + (1 - EMA_ALPHA) * ema_anterior

  // Aceleração = diferença entre pressão atual e EMA anterior
  // Positivo = acelerando para cima (antecipa alta)
  // Negativo = acelerando para baixo (antecipa queda)
  const aceleracao = pressao_liquida - ema_anterior

  // Rastro avançado = pressão líquida + componente de aceleração
  const rastro_strength_raw = pressao_liquida + (aceleracao * ACEL_WEIGHT)
  const rastro_strength = parseFloat(Math.max(-100, Math.min(100, rastro_strength_raw)).toFixed(2))

  return {
    // Campos originais
    alta, baixa, neutro, rastro,
    // Campos novos
    alta_strength, baixa_strength, rastro_strength,
    // Debug
    _debug: { pressao_liquida: pressao_liquida.toFixed(2), aceleracao: aceleracao.toFixed(2), ema: emaRastro.toFixed(2), falhas }
  }
}

// ── COLETA PRINCIPAL ──────────────────────────────────────────
async function collect() {
  const { date, time } = getBrTime()

  if (!shouldCollect()) {
    console.log(`[${date} ${time} BRT] Fora do horário — aguardando`)
    return
  }

  console.log(`\n[${date} ${time} BRT] Coletando ${SYMBOLS.length} ativos...`)
  const t0 = Date.now()

  const results = await Promise.allSettled(SYMBOLS.map(fetchQuote))
  const quotes = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
  const falhas = SYMBOLS.filter((_, i) => !(results[i].status === 'fulfilled' && results[i].value))

  console.log(`  Coletados: ${quotes.length}/${SYMBOLS.length} em ${((Date.now()-t0)/1000).toFixed(1)}s`)
  if (falhas.length) console.log(`  Falhas: ${falhas.join(', ')}`)

  if (quotes.length < MIN_FACTORS) {
    console.log(`  ⚠ Mínimo ${MIN_FACTORS} — descartado`)
    return
  }

  const scores = calcScores(quotes)
  console.log(`  Contagem: alta=${scores.alta} baixa=${scores.baixa} neutro=${scores.neutro} rastro=${scores.rastro}`)
  console.log(`  Strength: alta=${scores.alta_strength} baixa=${scores.baixa_strength} rastro_str=${scores.rastro_strength}`)
  console.log(`  Debug: pressao=${scores._debug.pressao_liquida} acel=${scores._debug.aceleracao} ema=${scores._debug.ema}`)

  const { error } = await supabase.from('chart_history').upsert({
    date, time,
    // Campos originais
    alta: scores.alta,
    baixa: scores.baixa,
    neutro: scores.neutro,
    rastro: scores.rastro,
    // Campos novos
    alta_strength: scores.alta_strength,
    baixa_strength: scores.baixa_strength,
    rastro_strength: scores.rastro_strength,
  }, { onConflict: 'date,time' })

  if (error) console.error(`  ✗ Supabase: ${error.message}`)
  else console.log(`  ✓ Salvo: ${date} ${time} BRT`)
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
async function main() {
  const { date, time } = getBrTime()
  console.log('===========================================')
  console.log('  DashboardMacro Worker v3')
  console.log(`  Horário BRT: ${date} ${time}`)
  console.log(`  Coleta: ${START_HOUR}h–${END_HOUR}h BRT`)
  console.log(`  Intervalo: ${INTERVAL_MS/1000}s`)
  console.log(`  EMA Alpha: ${EMA_ALPHA} | Acel Weight: ${ACEL_WEIGHT}`)
  console.log('===========================================')

  await collect()
  setInterval(collect, INTERVAL_MS)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
