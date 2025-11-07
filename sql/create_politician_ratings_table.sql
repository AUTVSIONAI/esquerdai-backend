-- Create politician_ratings table to store user evaluations for politicians
-- Run this in Supabase SQL editor (or apply via your migrations pipeline)

-- Ensure pgcrypto is available for gen_random_uuid()
create extension if not exists pgcrypto;

-- Create table
create table if not exists public.politician_ratings (
  id uuid primary key default gen_random_uuid(),
  politician_id uuid not null references public.politicians(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure one rating per user per politician
create unique index if not exists idx_politician_ratings_unique_user_politician
  on public.politician_ratings(politician_id, user_id);

-- Helpful indexes
create index if not exists idx_politician_ratings_politician
  on public.politician_ratings(politician_id);

create index if not exists idx_politician_ratings_user
  on public.politician_ratings(user_id);

create index if not exists idx_politician_ratings_created_at
  on public.politician_ratings(created_at);

-- Trigger to keep updated_at fresh (function may already exist; safe to replace)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger t_politician_ratings_set_updated_at
before update on public.politician_ratings
for each row execute function public.set_updated_at();

-- Optional: enable RLS for client-side reads (service role bypasses RLS)
alter table public.politician_ratings enable row level security;
create policy p_politician_ratings_select_authenticated
on public.politician_ratings
for select
to authenticated
using (true);