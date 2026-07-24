const https = require('https')
const { createClient } = require('@supabase/supabase-js')

// ── CONFIGURAÇÃO ──────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '300000')
const START_HOUR = parseInt(process.env.START_HOUR || '5')
const END_HOUR = parseInt(process.env.END_HOUR || '23')
const MIN_FACTORS = 30 // mínimo de fatores válidos para salvar

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERRO: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── FATORES ───────────────────────────────────────────────────
const FATORES = {
  'EURUSD=X':{p:7,dir:'neg'},'JPY=X':{p:7,dir:'pos'},'BRL=X':{p:12,dir:'pos'},
  'CNY=X':{p:6,dir:'pos'},'MXN=X':{p:5,dir:'pos'},'CHF=X':{p:4,dir:'pos'},
  'GBPUSD=X':{p:4,dir:'neg'},'AUDUSD=X':{p:4,dir:'neg'},
  '^TNX':{p:8,dir:'pos'},'^IRX':{p:6,dir:'pos'},'^FVX':{p:5,dir:'pos'},
  'TLT':{p:1,dir:'neg'},'SHY':{p:1,dir:'neg'},'IEF':{p:1,dir:'neg'},
  'ES=F':{p:10,dir:'neg'},'NQ=F':{p:8,dir:'neg'},'YM=F':{p:6,dir:'neg'},'RTY=F':{p:5,dir:'neg'},
  '^VIX':{p:10,dir:'pos'},'EMB':{p:1,dir:'neg'},'EEM':{p:1,dir:'neg'},
  'GC=F':{p:7,dir:'neg'},'CL=F':{p:5,dir:'neg'},'BZ=F':{p:4,dir:'neg'},
  'ZS=F':{p:7,dir:'neg'},'ZC=F':{p:4,dir:'neg'},'HG=F':{p:6,dir:'neg'},
  '^GDAXI':{p:4,dir:'neg'},'^FTSE':{p:3,dir:'neg'},'^N225':{p:4,dir:'neg'},'^HSI':{p:3,dir:'neg'},
  '^BVSP':{p:3,dir:'neg'},'EWZ':{p:1,dir:'neg'},'VALE':{p:1,dir:'neg'},
  'PBR':{p:1,dir:'neg'},'ITUB':{p:1,dir:'neg'},
  'BTC-USD':{p:5,dir:'neg'},'ETH-USD':{p:2,dir:'neg'},'XLF':{p:1,dir:'pos'},
}
const SYMBOLS = Object.keys(FATORES)
const MAX_RASTRO = Object.values(FATORES).reduce((a, f) => a + f.p, 0)

// ── HORÁRIO BRASÍLIA UTC-3 FIXO ───────────────────────────────
function getBrTime() {
  const now = new Date()
  const brMs = now.getTime() - (3 * 60 * 60 * 1000)
  const br = new Date(brMs)
  const year = br.getUTCFullYear()
  const month = String(br.getUTCMonth() + 1).padStart(2, '0')
  const day2 = String(br.getUTCDate()).padStart(2, '0')
  const hour = br.getUTCHours()
  const min = br.getUTCMinutes()
  const weekday = br.getUTCDay()
  return {
    date: `${year}-${month}-${day2}`,
    time: `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`,
    hour, day: weekday
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
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          // Formato v8
          if (j?.chart?.result?.[0]) {
            const m = j.chart.result[0].meta
            const price = m.regularMarketPrice || 0
            const prev = m.chartPreviousClose || m.previousClose || price
            if (price > 0) {
              const pct = prev ? ((price - prev) / prev) * 100 : 0
              return resolve({ sym, price, pct, source: `url${urlIndex}` })
            }
          }
          // Formato v7
          if (j?.quoteResponse?.result?.[0]) {
            const q = j.quoteResponse.result[0]
            const price = q.regularMarketPrice || 0
            const prev = q.regularMarketPreviousClose || price
            if (price > 0) {
              const pct = prev ? ((price - prev) / prev) * 100 : 0
              return resolve({ sym, price, pct, source: `url${urlIndex}_v7` })
            }
          }
          resolve(null)
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

async function fetchQuote(sym, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await fetchOnce(sym, i)
    if (result) return result
    // Aguarda 500ms antes do próximo retry
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 500))
  }
  return null
}

// ── CÁLCULO DE SCORES ─────────────────────────────────────────
// Threshold reduzido para 0.02% — menos fatores neutros, mais sensibilidade
const NEUTRO_THRESHOLD = 0.02

function calcScores(quotes) {
  let alta = 0, baixa = 0, neutro = 0, rastro = 0
  const detalhes = []

  for (const q of quotes) {
    const def = FATORES[q.sym]
    if (!def) continue

    if (Math.abs(q.pct) < NEUTRO_THRESHOLD) {
      neutro++
      detalhes.push({ sym: q.sym, dir: 'neutro', pct: q.pct })
      continue
    }

    const pressaoAlta = (def.dir === 'pos' && q.pct > 0) || (def.dir === 'neg' && q.pct < 0)
    if (pressaoAlta) {
      alta++
      rastro += def.p
      detalhes.push({ sym: q.sym, dir: 'alta', pct: q.pct, peso: def.p })
    } else {
      baixa++
      rastro -= def.p
      detalhes.push({ sym: q.sym, dir: 'baixa', pct: q.pct, peso: def.p })
    }
  }

  const rastroNorm = Math.round((rastro / MAX_RASTRO) * 100)
  return { alta, baixa, neutro, rastro: rastroNorm, detalhes }
}

// ── COLETA PRINCIPAL ──────────────────────────────────────────
async function collect() {
  const { date, time } = getBrTime()

  if (!shouldCollect()) {
    console.log(`[${date} ${time} BRT] Fora do horário — aguardando`)
    return
  }

  console.log(`\n[${date} ${time} BRT] Iniciando coleta de ${SYMBOLS.length} ativos...`)
  const startMs = Date.now()

  // Coleta todos em paralelo com retry individual
  const results = await Promise.allSettled(SYMBOLS.map(sym => fetchQuote(sym)))

  const quotes = []
  const falhas = []

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      quotes.push(r.value)
    } else {
      falhas.push(SYMBOLS[i])
    }
  })

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`  Coletados: ${quotes.length}/${SYMBOLS.length} em ${elapsed}s`)

  if (falhas.length > 0) {
    console.log(`  Falhas (${falhas.length}): ${falhas.join(', ')}`)
  }

  // Verificar total esperado
  if (quotes.length < MIN_FACTORS) {
    console.log(`  ⚠ Apenas ${quotes.length} fatores — mínimo é ${MIN_FACTORS}. Coleta descartada.`)
    return
  }

  const scores = calcScores(quotes)
  const total = scores.alta + scores.baixa + scores.neutro
  console.log(`  Scores: alta=${scores.alta} baixa=${scores.baixa} neutro=${scores.neutro} rastro=${scores.rastro} total=${total}`)

  // Só salva se total bater com o esperado
  if (total !== SYMBOLS.length) {
    console.log(`  ⚠ Total ${total} != ${SYMBOLS.length} — verificar lógica`)
  }

  const { error } = await supabase.from('chart_history').upsert(
    { date, time, alta: scores.alta, baixa: scores.baixa, neutro: scores.neutro, rastro: scores.rastro },
    { onConflict: 'date,time' }
  )

  if (error) console.error(`  ✗ Supabase: ${error.message}`)
  else console.log(`  ✓ Salvo: ${date} ${time} BRT`)
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
async function main() {
  const { date, time } = getBrTime()
  console.log('===========================================')
  console.log('  DashboardMacro Worker v2')
  console.log(`  Horário BRT: ${date} ${time}`)
  console.log(`  Coleta: ${START_HOUR}h–${END_HOUR}h BRT`)
  console.log(`  Intervalo: ${INTERVAL_MS / 1000}s`)
  console.log(`  Mínimo fatores: ${MIN_FACTORS}`)
  console.log(`  Threshold neutro: ${NEUTRO_THRESHOLD}%`)
  console.log('===========================================')

  await collect()
  setInterval(collect, INTERVAL_MS)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
