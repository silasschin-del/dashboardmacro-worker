const https = require('https')
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '60000')
const START_HOUR = parseInt(process.env.START_HOUR || '5')
const END_HOUR = parseInt(process.env.END_HOUR || '23')
const MIN_FACTORS = 30
const NEUTRO_THRESHOLD = 0.02
const EMA_ALPHA = 0.3
const ACEL_WEIGHT = 0.4

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Faltam variaveis'); process.exit(1) }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const FATORES = {
  'EURUSD=X':{p:7,dir:'neg',cat:'CAMBIO'},
  'JPY=X':{p:7,dir:'pos',cat:'CAMBIO'},
  'BRL=X':{p:12,dir:'pos',cat:'CAMBIO BR'},
  'CNY=X':{p:6,dir:'pos',cat:'CHINA'},
  'MXN=X':{p:5,dir:'pos',cat:'EMERGENTE'},
  'CHF=X':{p:4,dir:'pos',cat:'SAFE HAVEN'},
  'GBPUSD=X':{p:4,dir:'neg',cat:'CAMBIO'},
  'AUDUSD=X':{p:4,dir:'neg',cat:'CAMBIO'},
  '^TNX':{p:8,dir:'pos',cat:'YIELD'},
  '^IRX':{p:6,dir:'pos',cat:'YIELD'},
  '^FVX':{p:5,dir:'pos',cat:'YIELD'},
  'TLT':{p:1,dir:'neg',cat:'BOND ETF'},
  'SHY':{p:1,dir:'neg',cat:'BOND ETF'},
  'IEF':{p:1,dir:'neg',cat:'BOND ETF'},
  'ES=F':{p:10,dir:'neg',cat:'FUTURO'},
  'NQ=F':{p:8,dir:'neg',cat:'FUTURO'},
  'YM=F':{p:6,dir:'neg',cat:'FUTURO'},
  'RTY=F':{p:5,dir:'neg',cat:'FUTURO'},
  '^VIX':{p:10,dir:'pos',cat:'VOLATIL'},
  'EMB':{p:1,dir:'neg',cat:'EMBI'},
  'EEM':{p:1,dir:'neg',cat:'EMERGENTE'},
  'GC=F':{p:7,dir:'neg',cat:'METAIS'},
  'CL=F':{p:5,dir:'neg',cat:'ENERGIA'},
  'BZ=F':{p:4,dir:'neg',cat:'ENERGIA'},
  'ZS=F':{p:7,dir:'neg',cat:'AGRO BR'},
  'ZC=F':{p:4,dir:'neg',cat:'AGRO BR'},
  'HG=F':{p:6,dir:'neg',cat:'METAIS'},
  '^GDAXI':{p:4,dir:'neg',cat:'EUROPA'},
  '^FTSE':{p:3,dir:'neg',cat:'EUROPA'},
  '^N225':{p:4,dir:'neg',cat:'ASIA'},
  '^HSI':{p:3,dir:'neg',cat:'ASIA'},
  '^BVSP':{p:3,dir:'neg',cat:'BRASIL'},
  'EWZ':{p:1,dir:'neg',cat:'BRASIL'},
  'VALE':{p:1,dir:'neg',cat:'BRASIL'},
  'PBR':{p:1,dir:'neg',cat:'BRASIL'},
  'ITUB':{p:1,dir:'neg',cat:'BRASIL'},
  'BTC-USD':{p:5,dir:'neg',cat:'CRYPTO'},
  'ETH-USD':{p:2,dir:'neg',cat:'CRYPTO'},
  'XLF':{p:1,dir:'pos',cat:'SETOR'},
}

const SYMBOLS = Object.keys(FATORES)
const MAX_RASTRO = Object.values(FATORES).reduce((a, f) => a + f.p, 0)
const MAX_STRENGTH_PCT = 5.0
const MAX_STRENGTH = Object.values(FATORES).reduce((a, f) => a + f.p * MAX_STRENGTH_PCT, 0)

// Top 10 IBOVESPA — coletados separadamente para o IBOV Proxy
// Pesos normalizados somando 100%
const IBOV_PROXY = [
  { sym: 'VALE3.SA',  key: 'vale3_pct',  peso: 0.272 },
  { sym: 'ITUB4.SA',  key: 'itub4_pct',  peso: 0.201 },
  { sym: 'PETR4.SA',  key: 'petr4_pct',  peso: 0.182 },
  { sym: 'PETR3.SA',  key: 'petr3_pct',  peso: 0.105 },
  { sym: 'BBDC4.SA',  key: 'bbdc4_pct',  peso: 0.093 },
  { sym: 'B3SA3.SA',  key: 'b3sa3_pct',  peso: 0.082 },
  { sym: 'ABEV3.SA',  key: 'abev3_pct',  peso: 0.070 },
  { sym: 'WEGE3.SA',  key: 'wege3_pct',  peso: 0.065 },
  { sym: 'BBAS3.SA',  key: 'bbas3_pct',  peso: 0.058 },
  { sym: 'ELET3.SA',  key: 'elet3_pct',  peso: 0.051 },
]

let emaRastro = null

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
      hostname: u.hostname, path: u.pathname + u.search, timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
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
            if (price > 0) return resolve({ sym, pct: prev ? ((price-prev)/prev)*100 : 0 })
          }
          if (j?.quoteResponse?.result?.[0]) {
            const q = j.quoteResponse.result[0]
            const price = q.regularMarketPrice || 0
            const prev = q.regularMarketPreviousClose || price
            if (price > 0) return resolve({ sym, pct: prev ? ((price-prev)/prev)*100 : 0 })
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

function calcScores(quotes) {
  let alta = 0, baixa = 0, neutro = 0, rastro_peso = 0
  let alta_strength_raw = 0, baixa_strength_raw = 0

  for (const sym of SYMBOLS) {
    const q = quotes.find(x => x.sym === sym)
    const def = FATORES[sym]
    if (!q) { neutro++; continue }
    const absPct = Math.abs(q.pct)
    if (absPct < NEUTRO_THRESHOLD) { neutro++; continue }
    const pressaoAlta = (def.dir==='pos' && q.pct>0) || (def.dir==='neg' && q.pct<0)
    if (pressaoAlta) {
      alta++; rastro_peso += def.p
      alta_strength_raw += def.p * Math.min(absPct, MAX_STRENGTH_PCT)
    } else {
      baixa++; rastro_peso -= def.p
      baixa_strength_raw += def.p * Math.min(absPct, MAX_STRENGTH_PCT)
    }
  }

  const rastro = Math.round((rastro_peso / MAX_RASTRO) * 100)
  const alta_strength = parseFloat((alta_strength_raw / MAX_STRENGTH * 100).toFixed(2))
  const baixa_strength = parseFloat((baixa_strength_raw / MAX_STRENGTH * 100).toFixed(2))
  const pressao_liquida = alta_strength - baixa_strength

  if (emaRastro === null) emaRastro = pressao_liquida
  const ema_anterior = emaRastro
  emaRastro = EMA_ALPHA * pressao_liquida + (1 - EMA_ALPHA) * ema_anterior
  const aceleracao = pressao_liquida - ema_anterior
  const rastro_strength_raw = pressao_liquida + (aceleracao * ACEL_WEIGHT)
  const rastro_strength = parseFloat(Math.max(-100, Math.min(100, rastro_strength_raw)).toFixed(2))

  return {
    alta, baixa, neutro, rastro,
    alta_strength, baixa_strength, rastro_strength,
    _debug: { pressao_liquida: pressao_liquida.toFixed(2), aceleracao: aceleracao.toFixed(2), ema: emaRastro.toFixed(2) }
  }
}

async function collect() {
  const { date, time } = getBrTime()

  if (!shouldCollect()) {
    console.log(`[${date} ${time} BRT] Fora do horario — aguardando`)
    return
  }

  console.log(`\n[${date} ${time} BRT] Coletando ${SYMBOLS.length} ativos...`)
  const t0 = Date.now()

  // Coleta fatores macro e IBOV Proxy em paralelo
  const [macroResults, proxyResults] = await Promise.all([
    Promise.allSettled(SYMBOLS.map(fetchQuote)),
    Promise.allSettled(IBOV_PROXY.map(a => fetchQuote(a.sym)))
  ])

  const quotes = macroResults.filter(r => r.status==='fulfilled' && r.value).map(r => r.value)
  const falhas = SYMBOLS.filter((_, i) => !(macroResults[i].status==='fulfilled' && macroResults[i].value))

  console.log(`  Coletados: ${quotes.length}/${SYMBOLS.length} em ${((Date.now()-t0)/1000).toFixed(1)}s`)
  if (falhas.length) console.log(`  Falhas macro: ${falhas.join(', ')}`)

  if (quotes.length < MIN_FACTORS) {
    console.log(`  Minimo ${MIN_FACTORS} — descartado`)
    return
  }

  const scores = calcScores(quotes)

  // Processa IBOV Proxy
  const proxyData = {}
  let indiceProxy = 0
  IBOV_PROXY.forEach((a, i) => {
    const r = proxyResults[i]
    const pct = r.status === 'fulfilled' && r.value ? r.value.pct : 0
    proxyData[a.key] = parseFloat(pct.toFixed(3))
    indiceProxy += pct * a.peso
  })
  console.log(`  IBOV Proxy: indice=${indiceProxy.toFixed(2)}% | ${IBOV_PROXY.map((a,i) => `${a.sym.replace('.SA','')}=${proxyData[a.key]}%`).join(' ')}`)

  console.log(`  Contagem: alta=${scores.alta} baixa=${scores.baixa} neutro=${scores.neutro} rastro=${scores.rastro}`)
  console.log(`  Strength: alta=${scores.alta_strength} baixa=${scores.baixa_strength} rastro_str=${scores.rastro_strength}`)

  const { error } = await supabase.from('chart_history').upsert({
    date, time,
    alta: scores.alta,
    baixa: scores.baixa,
    neutro: scores.neutro,
    rastro: scores.rastro,
    alta_strength: scores.alta_strength,
    baixa_strength: scores.baixa_strength,
    rastro_strength: scores.rastro_strength,
    ...proxyData,
  }, { onConflict: 'date,time' })

  if (error) console.error(`  Supabase: ${error.message}`)
  else console.log(`  Salvo: ${date} ${time} BRT`)
}

async function main() {
  const { date, time } = getBrTime()
  console.log('===========================================')
  console.log('  DashboardMacro Worker v4')
  console.log(`  Horario BRT: ${date} ${time}`)
  console.log(`  Coleta: ${START_HOUR}h-${END_HOUR}h BRT`)
  console.log(`  Intervalo: ${INTERVAL_MS/1000}s`)
  console.log(`  Fatores macro: ${SYMBOLS.length}`)
  console.log(`  IBOV Proxy: ${IBOV_PROXY.length} acoes`)
  console.log('===========================================')
  await collect()
  setInterval(collect, INTERVAL_MS)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
