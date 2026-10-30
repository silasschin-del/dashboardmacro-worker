-- DashboardMacro: tabela NOVA para o painel de fatores e monitor de atualidade.
-- NAO altera chart_history. Rode no Supabase > SQL Editor.

create table if not exists public.factor_snapshots (
  date          text        not null,            -- data BRT (YYYY-MM-DD), igual ao chart_history
  time          text        not null,            -- hora BRT (HH:MM), igual ao chart_history
  collected_at  timestamptz not null,            -- relogio do servidor do worker (UTC)
  interval_ms   integer     not null,            -- frequencia configurada do worker
  ok_count      integer     not null,            -- fatores com cotacao valida neste ciclo
  total_count   integer     not null,            -- fatores pedidos neste ciclo
  discarded     boolean     not null default false, -- true = ciclo descartado (< minimo de fatores)
  data          jsonb       not null,            -- {ticker: {p,c,t,lc,ok,r,w,d}}
  primary key (date, time)
);

create index if not exists factor_snapshots_collected_at_idx
  on public.factor_snapshots (collected_at desc);

-- Navegador (anon/authenticated): SOMENTE LEITURA. O worker usa a service key (ignora RLS) para gravar.
alter table public.factor_snapshots enable row level security;

drop policy if exists "factor_snapshots_select" on public.factor_snapshots;
create policy "factor_snapshots_select" on public.factor_snapshots
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.factor_snapshots from anon, authenticated;
grant select on public.factor_snapshots to anon, authenticated;
