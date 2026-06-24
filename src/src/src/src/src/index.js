const cron = require('node-cron')
const { fetchAllQuotes } = require('./collector')
const { calcScores } = require('./scores')
const { savePoint, getBrTime } = require('./database')
const { FATORES } = require('./fatores')

const SYMBOLS = Object.keys(FATORES)

// Configuração — altere conforme necessário
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/5 * * * *' // a cada 5 minutos
const START_HOUR = parseInt(process.env.START_HOUR || '5')        // início às 05h
const END_HOUR = parseInt(process.env.END_HOUR || '23')           // encerra às 23h

function isCollectionTime() {
  const { br } = getBrTime()
  const h = br.getHours()
  const day = br.getDay()
  // Domingo: só após 21h (Ásia abre)
  if (day === 0 && h < 21) return false
  // Sábado: não coleta
  if (day === 6) return false
  // Dias úteis: coleta entre START_HOUR e END_HOUR
  return h >= START_HOUR && h <= END_HOUR
}

async function collect() {
  const { date, time } = getBrTime()

  if (!isCollectionTime()) {
    console.log(`[${date} ${time}] Fora do horário de coleta — aguardando`)
    return
  }

  console.log(`\n[${date} ${time}] Iniciando coleta...`)

  try {
    const quotes = await fetchAllQuotes(SYMBOLS)
    const scores = calcScores(quotes)

    console.log(`  Scores: alta=${scores.alta} baixa=${scores.baixa} neutro=${scores.neutro} rastro=${scores.rastro}`)

    const saved = await savePoint(scores)
    if (saved) {
      console.log(`  ✓ Salvo no Supabase: ${date} ${time}`)
    }
  } catch (err) {
    console.error(`  ✗ Erro na coleta:`, err.message)
  }
}

async function main() {
  console.log('===========================================')
  console.log('  DashboardMacro Worker — Iniciando')
  console.log(`  Schedule: ${CRON_SCHEDULE}`)
  console.log(`  Horário: ${START_HOUR}h às ${END_HOUR}h (Brasília)`)
  console.log('===========================================')

  // Coleta imediata ao iniciar
  await collect()

  // Agendar coleta periódica
  cron.schedule(CRON_SCHEDULE, collect, {
    timezone: 'America/Sao_Paulo'
  })

  console.log('\nWorker ativo. Aguardando próxima execução...')
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
