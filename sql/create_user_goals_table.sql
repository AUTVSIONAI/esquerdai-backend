-- =====================================================
-- CRIAR TABELA USER_GOALS PARA METAS DE GAMIFICAÇÃO
-- Execute este SQL no painel do Supabase
-- =====================================================

-- Garantir extensão pgcrypto para gen_random_uuid()
create extension if not exists pgcrypto;

-- Função genérica para manter updated_at atualizado
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Criar tabela user_goals se não existir
create table if not exists public.user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  goal_type text not null default 'monthly_points',
  target_value integer not null,
  current_value integer not null default 0,
  period_start date not null,
  period_end date not null,
  status text not null default 'active', -- active | completed | failed | cancelled
  auto_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índices úteis
create index if not exists idx_user_goals_user on public.user_goals(user_id);
create index if not exists idx_user_goals_type on public.user_goals(goal_type);
create index if not exists idx_user_goals_status on public.user_goals(status);
create index if not exists idx_user_goals_period on public.user_goals(period_start, period_end);
create unique index if not exists idx_user_goals_unique_month
  on public.user_goals(user_id, goal_type, period_start, period_end, status);

-- Trigger para atualizar updated_at
drop trigger if exists t_user_goals_set_updated_at on public.user_goals;
create trigger t_user_goals_set_updated_at
before update on public.user_goals
for each row execute function public.set_updated_at();

-- Habilitar RLS
alter table public.user_goals enable row level security;

-- Policies (idempotentes)
drop policy if exists "Users can view their own goals" on public.user_goals;
drop policy if exists "Users can insert their own goals" on public.user_goals;
drop policy if exists "Users can update their own goals" on public.user_goals;
drop policy if exists "Admins can manage all goals" on public.user_goals;

-- Usuários autenticados podem ver suas próprias metas
create policy "Users can view their own goals" on public.user_goals
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = user_goals.user_id
      and u.auth_id = auth.uid()
  )
);

-- Usuários podem inserir metas próprias (opcional; backend normalmente cria)
create policy "Users can insert their own goals" on public.user_goals
for insert
to authenticated
with check (
  exists (
    select 1 from public.users u
    where u.id = user_goals.user_id
      and u.auth_id = auth.uid()
  )
);

-- Usuários podem atualizar suas metas
create policy "Users can update their own goals" on public.user_goals
for update
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = user_goals.user_id
      and u.auth_id = auth.uid()
  )
);

-- Admins podem gerenciar todas as metas
create policy "Admins can manage all goals" on public.user_goals
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_id = auth.uid()
      and (u.role = 'admin' or u.is_admin = true)
  )
);

-- Seed opcional: criar meta mensal atual para usuários sem meta
-- (Pode ser omitido; a rota /api/gamification/users/:userId/goals/auto-create já faz isso)
-- insert into public.user_goals (user_id, goal_type, target_value, current_value, period_start, period_end, status, auto_generated)
-- select u.id, 'monthly_points', 500, 0,
--   date_trunc('month', now())::date,
--   (date_trunc('month', now()) + interval '1 month - 1 day')::date,
--   'active', true
-- from public.users u
-- where not exists (
--   select 1 from public.user_goals g
--   where g.user_id = u.id
--     and g.goal_type = 'monthly_points'
--     and g.period_start = date_trunc('month', now())::date
--     and g.period_end = (date_trunc('month', now()) + interval '1 month - 1 day')::date
--     and g.status = 'active'
-- );

select 'Tabela user_goals criada/atualizada com sucesso' as status;