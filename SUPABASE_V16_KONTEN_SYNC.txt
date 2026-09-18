-- KassenSpiel V16 – nur Konten-/Daten-Synchronisierung
-- Produkte, Käufe und Kontodaten folgen demselben Login auf jedem Gerät.

create table if not exists public.ks_v16_companies (
  id text primary key,
  name text not null,
  code text not null unique,
  created_at bigint not null
);

create table if not exists public.ks_v16_users (
  id text primary key,
  company_id text references public.ks_v16_companies(id) on delete cascade,
  username text not null unique,
  password_hash text not null,
  password_salt text not null,
  display_name text not null,
  role text not null check (role in ('superadmin','company_admin','employee')),
  active boolean not null default true,
  created_at bigint not null
);

create index if not exists ks_v16_users_company_idx
  on public.ks_v16_users(company_id);

create table if not exists public.ks_v16_account_state (
  user_id text primary key references public.ks_v16_users(id) on delete cascade,
  company_id text references public.ks_v16_companies(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);

alter table public.ks_v16_companies enable row level security;
alter table public.ks_v16_users enable row level security;
alter table public.ks_v16_account_state enable row level security;

-- Keine Browser-Policies: Zugriff nur über die Vercel-API mit dem Service-Role/Secret-Key.
