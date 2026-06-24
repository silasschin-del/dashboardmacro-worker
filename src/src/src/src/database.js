const { createClient } = require('@supabase/supabase-js')

let supabase = null

function getClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios')
    supabase = createClient(url, key)
  }
  return supabase
}

function getBrTime() {
  const now = new Date()
  const br = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const date = br.toLocaleDateString('en-CA') // YYYY-MM-DD
  const time = `${br.getHours().toString().padStart(2,'0')}:${br.getMinutes().toString().padStart(2,'0')}`
  return { date, time, br }
}

async function savePoint(scores) {
  const db = getClient()
  const { date, time } = getBrTime()

  const { error } = await db.from('chart_history').upsert(
    {
      date,
      time,
      alta: scores.alta,
      baixa: scores.baixa,
      neutro: scores.neutro,
      rastro: scores.rastro,
    },
    { onConflict: 'date,time' }
  )

  if (error) {
    console.error('  Erro ao salvar no Supabase:', error.message)
    return false
  }

  return true
}

module.exports = { savePoint, getBrTime }
