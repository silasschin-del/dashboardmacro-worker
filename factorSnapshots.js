// Registro por ciclo dos 39 fatores, para o painel de fatores e o monitor de atualidade.
// REGRA: este modulo NUNCA lanca erro para fora e NUNCA e usado no calculo de scores.
// Se falhar, so escreve um aviso no log. chart_history nao depende dele.

const RETENTION_DAYS = 7
let lastCleanupDate = null
let roleLogged = false

// Diagnostico: mostra SO o papel da chave (anon / service_role), nunca a chave em si.
function keyRole() {
  const k = process.env.SUPABASE_SERVICE_KEY || ''
  try {
    if (k.startsWith('eyJ')) {
      const p = JSON.parse(Buffer.from(k.split('.')[1], 'base64').toString())
      return 'role=' + p.role
    }
  } catch (e) {}
  return 'formato=' + k.slice(0, 6)
}

// results: array alinhado com symbols; cada item e o objeto de fetchQuote ou null
// failReasons: Map ticker -> motivo da ultima falha
async function saveSnapshot(supabase, ctx) {
  try {
    const { date, time, intervalMs, symbols, fatores, results, failReasons, minFactors } = ctx
    const data = {}
    let ok = 0
    symbols.forEach((sym, i) => {
      const r = results[i]
      const good = r.status === 'fulfilled' && r.value
      const def = fatores[sym]
      if (good) {
        ok++
        const v = r.value
        data[sym] = {
          p: v.price,            // preco usado
          c: round(v.pct, 4),    // variacao % usada no calculo
          t: v.qt ?? null,       // regularMarketTime da cotacao (epoch s) ou null se Yahoo nao informou
          lc: v.lc ?? null,      // horario do ultimo candle 1m com preco (epoch s) ou null
          ok: true, w: def.p, d: def.dir,
        }
      } else {
        data[sym] = { p: null, c: null, t: null, lc: null, ok: false,
          r: failReasons.get(sym) || 'sem_resposta', w: def.p, d: def.dir }
      }
    })
    const { error } = await supabase.from('factor_snapshots').upsert({
      date, time,
      collected_at: new Date().toISOString(),
      interval_ms: intervalMs,
      ok_count: ok,
      total_count: symbols.length,
      discarded: ok < minFactors,
      data,
    }, { onConflict: 'date,time' })
    if (error) {
      console.error(`  Snapshot: ${error.message}`)
      if (!roleLogged) { roleLogged = true; console.error(`  Papel da chave do worker: ${keyRole()}`) }
    }
    await cleanupOld(supabase, date)
  } catch (e) {
    console.error(`  Snapshot (ignorado): ${e && e.message}`)
  }
}

async function cleanupOld(supabase, date) {
  if (lastCleanupDate === date) return
  lastCleanupDate = date
  try {
    const limite = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
    const { error } = await supabase.from('factor_snapshots').delete().lt('collected_at', limite)
    if (error) console.error(`  Limpeza snapshots: ${error.message}`)
  } catch (e) {
    console.error(`  Limpeza snapshots (ignorada): ${e && e.message}`)
  }
}

function round(n, d) { return Number.isFinite(n) ? parseFloat(n.toFixed(d)) : null }

module.exports = { saveSnapshot, RETENTION_DAYS }
