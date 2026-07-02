const https = require('https')
const { createClient } = require('@supabase/supabase-js')

// ── CONFIGURAÇÃO ──────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '300000') // 5 minutos
const START_HOUR = parseInt(process.env.START_HOUR || '5')
const END_HOUR = parseInt(process.env.END_HOUR || '23')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERRO: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── FATORES ───────────────────────────────────────────────────
const FATORES = {
  'EURUSD=X': {p:7,dir:'neg'},'JPY=X': {p:7,dir:'pos'},'BRL=X': {p:12,dir:'pos'},
  'CNY=X': {p:6,dir:'pos'},'MXN=X': {p:5,dir:'pos'},'CHF=X': {p:4,dir:'pos'},
  'GBPUSD=X': {p:4,dir:'neg'},'AUDUSD=X': {p:4,dir:'neg'},
  '^TNX': {p:8,dir:'pos'},'^IRX': {p:6,dir:'pos'},'^FVX': {p:5,dir:'pos'},
  'TLT': {p:1,dir:'neg'},'SHY': {p:1,dir:'neg'},'IEF': {p:1,dir:'neg'},
  'ES=F': {p:10,dir:'neg'},'NQ=F': {p:8,dir:'neg'},'YM=F': {p:6,dir:'neg'},'RTY=F': {p:5,dir:'neg'},
  '^VIX': {p:10,dir:'pos'},'EMB': {p:1,dir:'neg'},'EEM': {p:1,dir:'neg'},
  'GC=F': {p:7,dir:'neg'},'CL=F': {p:5,dir:'neg'},'BZ=F': {p:4,dir:'neg'},
  'ZS=F': {p:7,dir:'neg'},'ZC=F': {p:4,dir:'neg'},'HG=F': {p:6,dir:'neg'},
  '^GDAXI': {p:4,dir:'neg'},'^FTSE': {p:3,dir:'neg'},'^N225': {p:4,dir:'neg'},'^HSI': {p:3,dir:'neg'},
  '^BVSP': {p:3,dir:'neg'},'EWZ': {p:1,dir:'neg'},'VALE': {p:1,dir:'neg'},
  'PBR': {p:1,dir:'neg'},'ITUB': {p:1,dir:'neg'},
  'BTC-USD': {p:5,dir:'neg'},'ETH-USD': {p:2,dir:'neg'},'XLF': {p:1,dir:'pos'},
}
const SYMBOLS = Object.keys(FATORES)
const MAX_RASTRO = Object.values(FATORES).reduce((a, f) => a + f.p, 0)

// ── COLETA ────────────────────────────────────────────────────
function fetchQuote(sym) {
  return new Promise(resolve => {
    const encoded = encodeURIComponent(sym)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`
    const urlObj = new URL(url)
    const req = https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (!json?.chart?.result?.[0]) return resolve(null)
          const meta = json.chart.result[0].meta
          const price = meta.regularMarketPrice || 0
          const prev = meta.chartPreviousClose || meta.previousClose || price
          if (price === 0) return resolve(null)
          const pct = prev !== 0 ? ((price - prev) / prev) * 100 : 0
          resolve({ sym, pct })
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

// ── SCORES ────────────────────────────────────────────────────
function calcScores(quotes) {
  let alta = 0, baixa = 0, neutro = 0, rastro = 0
  for (const q of quotes) {
    const def = FATORES[q.sym]
    if (!def) continue
    if (Math.abs(q.pct) < 0.05) { neutro++; continue }
    const up = (def.dir === 'pos' && q.pct > 0) || (def.dir === 'neg' && q.pct < 0)
    if (up) { alta++; rastro += def.p } else { baixa++; rastro -= def.p }
  }
  return { alta, baixa, neutro, rastro: Math.round((rastro / MAX_RASTRO) * 100) }
}

// ── HORÁRIO BR ────────────────────────────────────────────────
function getBrTime() {
  const now = new Date()
  const br = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const date = br.toLocaleDateString('en-CA')
  const time = `${br.getHours().toString().padStart(2,'0')}:${br.getMinutes().toString().padStart(2,'0')}`
  return { date, time, hour: br.getHours(), day: br.getDay() }
}

function shouldCollect() {
  const { hour, day } = getBrTime()
  if (day === 6) return false // sábado
  if (day === 0 && hour < 21) return false // domingo antes das 21h
  return hour >= START_HOUR && hour <= END_HOUR
}

// ── COLETA PRINCIPAL ──────────────────────────────────────────
async function collect() {
  const { date, time } = getBrTime()

  if (!shouldCollect()) {
    console.log(`[${date} ${time}] Fora do horário — aguardando`)
    return
  }

  console.log(`\n[${date} ${time}] Iniciando coleta de ${SYMBOLS.length} ativos...`)

  const results = await Promise.allSettled(SYMBOLS.map(fetchQuote))
  const quotes = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)

  console.log(`  Ativos coletados: ${quotes.length}/${SYMBOLS.length}`)

  if (quotes.length < 3) {
    console.log('  Dados insuficientes — pulando salvamento')
    return
  }

  const scores = calcScores(quotes)
  console.log(`  Scores: alta=${scores.alta} baixa=${scores.baixa} neutro=${scores.neutro} rastro=${scores.rastro}`)

  const { error } = await supabase.from('chart_history').upsert(
    { date, time, alta: scores.alta, baixa: scores.baixa, neutro: scores.neutro, rastro: scores.rastro },
    { onConflict: 'date,time' }
  )

  if (error) console.error('  Erro Supabase:', error.message)
  else console.log(`  ✓ Salvo: ${date} ${time}`)
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
async function main() {
  console.log('=========================================')
  console.log('  DashboardMacro Worker')
  console.log(`  Intervalo: ${INTERVAL_MS / 1000}s`)
  console.log(`  Horário: ${START_HOUR}h–${END_HOUR}h (Brasília)`)
  console.log('=========================================')

  await collect()
  setInterval(collect, INTERVAL_MS)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
