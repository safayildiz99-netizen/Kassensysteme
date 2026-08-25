-- KassenSpiel: in Supabase > SQL Editor ausführen.
-- Die Tabellen sind NICHT direkt für Browser/anon zugänglich.
-- Der Zugriff erfolgt ausschließlich über Vercel mit dem Service-Role-Key.

create extension if not exists pgcrypto;

create table if not exists public.ks_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'Supermarkt',
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.ks_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.ks_companies(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  role text not null check (role in ('superadmin','company_admin','employee')),
  password_salt text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ks_companies enable row level security;
alter table public.ks_users enable row level security;

-- Keine anon/authenticated Policies anlegen.
-- Vercel verwendet ausschließlich SUPABASE_SERVICE_ROLE_KEY.
