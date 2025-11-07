-- Create extension for UUID generation
create extension if not exists pgcrypto;

-- Table: fake_news_checks
create table if not exists public.fake_news_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tipo_input text not null,
  conteudo text not null,
  resultado text not null,
  explicacao text,
  confianca integer,
  fontes jsonb default '[]'::jsonb,
  feedback_positivo integer default 0,
  feedback_negativo integer default 0,
  denuncias integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes for fake_news_checks
create index if not exists idx_fake_news_checks_user_id on public.fake_news_checks(user_id);
create index if not exists idx_fake_news_checks_created_at on public.fake_news_checks(created_at);
create index if not exists idx_fake_news_checks_resultado on public.fake_news_checks(resultado);

-- Updated_at trigger for fake_news_checks
create or replace function public.fn_set_updated_at_fake_news_checks()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists t_fake_news_checks_set_updated_at on public.fake_news_checks;
create trigger t_fake_news_checks_set_updated_at
before update on public.fake_news_checks
for each row execute function public.fn_set_updated_at_fake_news_checks();

-- RLS policies for fake_news_checks
alter table public.fake_news_checks enable row level security;

-- Drop existing policies if they exist
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fake_news_checks' and policyname = 'user_select_own_checks') then
    drop policy user_select_own_checks on public.fake_news_checks;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fake_news_checks' and policyname = 'user_insert_own_checks') then
    drop policy user_insert_own_checks on public.fake_news_checks;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fake_news_checks' and policyname = 'user_delete_own_checks') then
    drop policy user_delete_own_checks on public.fake_news_checks;
  end if;
end $$;

create policy user_select_own_checks on public.fake_news_checks
  for select using (auth.uid() = user_id);

create policy user_insert_own_checks on public.fake_news_checks
  for insert with check (auth.uid() = user_id);

create policy user_delete_own_checks on public.fake_news_checks
  for delete using (auth.uid() = user_id);

-- Table: fake_news_feedback
create table if not exists public.fake_news_feedback (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.fake_news_checks(id) on delete cascade,
  user_id uuid not null,
  tipo_feedback text not null,
  comentario text,
  created_at timestamptz default now()
);

create unique index if not exists uniq_fake_news_feedback_check_user on public.fake_news_feedback(check_id, user_id);
create index if not exists idx_fake_news_feedback_check_id on public.fake_news_feedback(check_id);
create index if not exists idx_fake_news_feedback_user_id on public.fake_news_feedback(user_id);

-- RLS policies for fake_news_feedback
alter table public.fake_news_feedback enable row level security;

do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fake_news_feedback' and policyname = 'user_select_own_feedback') then
    drop policy user_select_own_feedback on public.fake_news_feedback;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fake_news_feedback' and policyname = 'user_upsert_own_feedback') then
    drop policy user_upsert_own_feedback on public.fake_news_feedback;
  end if;
end $$;

create policy user_select_own_feedback on public.fake_news_feedback
  for select using (auth.uid() = user_id);

create policy user_upsert_own_feedback on public.fake_news_feedback
  for insert with check (auth.uid() = user_id);

-- RPC functions to increment counters
create or replace function public.increment_feedback_positivo(check_id uuid)
returns void language sql as $$
  update public.fake_news_checks
  set feedback_positivo = coalesce(feedback_positivo, 0) + 1,
      updated_at = now()
  where id = check_id;
$$;

create or replace function public.increment_feedback_negativo(check_id uuid)
returns void language sql as $$
  update public.fake_news_checks
  set feedback_negativo = coalesce(feedback_negativo, 0) + 1,
      updated_at = now()
  where id = check_id;
$$;

create or replace function public.increment_denuncias(check_id uuid)
returns void language sql as $$
  update public.fake_news_checks
  set denuncias = coalesce(denuncias, 0) + 1,
      updated_at = now()
  where id = check_id;
$$;