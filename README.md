# DashboardMacro Worker

Serviço de coleta automática de dados macroeconômicos.

## Variáveis de ambiente necessárias

- `SUPABASE_URL` — URL do projeto Supabase
- `SUPABASE_SERVICE_KEY` — chave service_role do Supabase
- `CRON_SCHEDULE` — frequência de coleta (padrão: `*/5 * * * *`)
- `START_HOUR` — hora de início da coleta (padrão: `5`)
- `END_HOUR` — hora de encerramento (padrão: `23`)
