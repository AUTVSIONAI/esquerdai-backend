-- Create politician_agents table and seed agents for approved politicians
-- Run this in Supabase SQL editor (or apply via your migrations pipeline)

-- Ensure pgcrypto is available for gen_random_uuid()
create extension if not exists pgcrypto;

-- Create table
create table if not exists public.politician_agents (
  id uuid primary key default gen_random_uuid(),
  politician_id uuid not null references public.politicians(id) on delete cascade,
  trained_prompt text not null,
  voice_id text,
  personality_config jsonb not null default '{}'::jsonb,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure only one agent per politician (optional but recommended)
create unique index if not exists idx_politician_agents_unique_politician
  on public.politician_agents(politician_id);

-- Helpful indexes
create index if not exists idx_politician_agents_active
  on public.politician_agents(is_active);

-- Trigger to keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger t_politician_agents_set_updated_at
before update on public.politician_agents
for each row execute function public.set_updated_at();

-- Optional: RLS setup (service role bypasses RLS; enable if you plan client reads)
alter table public.politician_agents enable row level security;
-- Simple read policy for authenticated users (adjust as needed)
create policy p_politician_agents_select_authenticated
on public.politician_agents
for select
to authenticated
using (true);

-- Seed: create agents for all approved and active politicians without an agent yet
insert into public.politician_agents (
  politician_id,
  trained_prompt,
  voice_id,
  personality_config,
  is_active
)
select
  p.id,
  (
    'Você é ' || coalesce(p.name, 'um político') || ', ' || coalesce(p.position, '') ||
    case when p.state is not null and p.state <> '' then ' de ' || p.state else '' end ||
    ' do partido ' || coalesce(p.party, '') || E'\n\n' ||
    'Suas características:' || E'\n- Posição política: ' || coalesce(p.position, '') ||
    E'\n- Estado: ' || coalesce(p.state, 'Nacional') ||
    E'\n- Partido: ' || coalesce(p.party, '') ||
    E'\n- Biografia: ' || coalesce(p.short_bio, 'Político comprometido com o desenvolvimento do país') ||
    E'\n- Plano de governo: ' || coalesce(p.government_plan, 'Focado em melhorias para a população') ||
    E'\n- Principais ideologias: ' || coalesce(
      (
        select string_agg(x, ', ')
        from jsonb_array_elements_text(p.main_ideologies) as j(x)
      ), 'Progressista'
    ) || E'\n\n' ||
    'Responda como este político responderia, mantendo coerência com suas posições políticas e ideológicas. '
    'Seja respeitoso, político e mantenha o foco em questões relevantes para sua área de atuação. '
    'Use linguagem acessível e demonstre conhecimento sobre as necessidades do seu estado/região.'
  )::text,
  null,
  '{"tone":"professional","style":"political","formality":"formal"}'::jsonb,
  true
from public.politicians p
where p.status = 'approved'
  and p.is_active = true
  and p.is_approved = true
  and not exists (
    select 1 from public.politician_agents pa where pa.politician_id = p.id
  );