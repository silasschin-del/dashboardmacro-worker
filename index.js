const https = require('https')
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '300000')
const START_HOUR = parseInt(process.env.START_HOUR || '5')
const END_HOUR = parseInt(process.env.END_HOUR || '23')

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Faltam variáveis de ambiente'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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

function getBrTime() {
  const now = new Date()
  // UTC-3 fixo (Brasília sem horário de verão)
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

function fetchQuote(sym) {
  return new Promise(resolve => {
    const encoded = encodeURIComponent(sym)
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
    ]
    function tryUrl(i) {
      if (i >= urls.length) return resolve(null)
      const u = new URL(urls[i])
      const req = https.get({
        hostname: u.hostname, path: u.pathname + u.search, timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
      }, res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => {
          try {
            const j = JSON.parse(d)
            if (!j?.chart?.result?.[0]) return tryUrl(i+1)
            const m = j.chart.result[0].meta
            const price = m.regularMarketPrice || 0
            const prev = m.chartPreviousClose || m.previousClose || price
            if (price === 0) return tryUrl(i+1)
            resolve({ sym, pct: prev ? ((price-prev)/prev)*100 : 0 })
          } catch { tryUrl(i+1) }
        })
      })
      req.on('error', () => tryUrl(i+1))
      req.on('timeout', () => { req.destroy(); tryUrl(i+1) })
    }
    tryUrl(0)
  })
}

function calcScores(quotes) {
  let alta = 0, baixa = 0, neutro = 0, rastro = 0
  for (const q of quotes) {
    const def = FATORES[q.sym]
    if (!def) continue
    if (Math.abs(q.pct) < 0.05) { neutro++; continue }
    const up = (def.dir==='pos' && q.pct>0) || (def.dir==='neg' && q.pct<0)
    if (up) { alta++; rastro+=def.p } else { baixa++; rastro-=def.p }
  }
  return { alta, baixa, neutro, rastro: Math.round((rastro/MAX_RASTRO)*100) }
}

async function collect() {
  const { date, time, hour, day } = getBrTime()
  if (!shouldCollect()) {
    console.log(`[${date} ${time} BRT] Fora do horário — aguardando`)
    return
  }
  console.log(`\n[${date} ${time} BRT] Coletando ${SYMBOLS.length} ativos...`)
  const results = await Promise.allSettled(SYMBOLS.map(fetchQuote))
  const quotes = results.filter(r => r.status==='fulfilled' && r.value).map(r => r.value)
  console.log(`  Ativos: ${quotes.length}/${SYMBOLS.length}`)
  if (quotes.length < 3) { console.log('  Insuficiente — pulando'); return }
  const scores = calcScores(quotes)
  console.log(`  alta=${scores.alta} baixa=${scores.baixa} neutro=${scores.neutro} rastro=${scores.rastro}`)
  const { error } = await supabase.from('chart_history').upsert(
    { date, time, alta: scores.alta, baixa: scores.baixa, neutro: scores.neutro, rastro: scores.rastro },
    { onConflict: 'date,time' }
  )
  if (error) console.error('  Supabase:', error.message)
  else console.log(`  ✓ Salvo: ${date} ${time} BRT`)
}

async function main() {
  const { date, time } = getBrTime()
  console.log('===========================================')
  console.log('  DashboardMacro Worker')
  console.log(`  Horário BRT: ${date} ${time}`)
  console.log(`  Coleta: ${START_HOUR}h–${END_HOUR}h BRT`)
  console.log(`  Intervalo: ${INTERVAL_MS/1000}s`)
  console.log('===========================================')
  await collect()
  setInterval(collect, INTERVAL_MS)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
