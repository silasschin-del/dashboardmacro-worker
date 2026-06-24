const { FATORES, MAX_RASTRO } = require('./fatores')

function calcScores(quotes) {
  let alta = 0, baixa = 0, neutro = 0, rastro = 0
  const fatoresResult = []

  for (const [sym, def] of Object.entries(FATORES)) {
    const q = quotes[sym]
    if (!q || !q.ok) {
      neutro++
      continue
    }

    const pct = q.pct
    if (Math.abs(pct) < 0.05) {
      neutro++
      continue
    }

    const pressaoAlta = (def.dir === 'pos' && pct > 0) || (def.dir === 'neg' && pct < 0)
    if (pressaoAlta) {
      alta++
      rastro += def.p
    } else {
      baixa++
      rastro -= def.p
    }

    fatoresResult.push({ sym, cat: def.cat, pct: pct.toFixed(2), dir: pressaoAlta ? 'alta' : 'baixa' })
  }

  const rastroNorm = Math.round((rastro / MAX_RASTRO) * 100)

  return { alta, baixa, neutro, rastro: rastroNorm, fatores: fatoresResult }
}

module.exports = { calcScores }
