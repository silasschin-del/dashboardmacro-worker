const https = require('https')

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
]

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function fetchUrl(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      timeout: timeoutMs,
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchQuote(sym) {
  const encoded = encodeURIComponent(sym)
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetchUrl(url, 7000)
      if (res.status !== 200) continue

      const data = JSON.parse(res.body)

      // Formato v8 (chart)
      if (data?.chart?.result?.[0]) {
        const meta = data.chart.result[0].meta
        const price = meta.regularMarketPrice ?? 0
        const prev = meta.chartPreviousClose ?? meta.previousClose ?? price
        if (price === 0) continue
        const pct = prev !== 0 ? ((price - prev) / prev) * 100 : 0
        return { sym, price, pct, ok: true }
      }

      // Formato v7 (quote)
      if (data?.quoteResponse?.result?.[0]) {
        const q = data.quoteResponse.result[0]
        const price = q.regularMarketPrice ?? 0
        const prev = q.regularMarketPreviousClose ?? price
        if (price === 0) continue
        const pct = prev !== 0 ? ((price - prev) / prev) * 100 : 0
        return { sym, price, pct, ok: true }
      }
    } catch {}
  }
  return { sym, price: 0, pct: 0, ok: false }
}

async function fetchAllQuotes(symbols) {
  console.log(`  Buscando ${symbols.length} ativos...`)
  const results = await Promise.allSettled(symbols.map(fetchQuote))
  const quotes = {}
  let ok = 0, fail = 0

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.ok) {
      quotes[symbols[i]] = r.value
      ok++
    } else {
      fail++
    }
  })

  console.log(`  Resultado: ${ok} ok, ${fail} falha`)
  return quotes
}

module.exports = { fetchAllQuotes }
