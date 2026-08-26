-- =============================================================
-- KassenSpiel ONLINE SYNC V3
-- In Supabase -> SQL Editor -> New query -> komplett ausführen.
-- Kann mehrfach ausgeführt werden.
-- =============================================================

create extension if not exists pgcrypto;

create table if not exists public.ks_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ks_companies(id) on delete cascade,
  local_id text not null,
  barcode text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, local_id)
);

create unique index if not exists ks_products_company_barcode_uq
  on public.ks_products(company_id, barcode)
  where barcode <> '';

create index if not exists ks_products_company_idx
  on public.ks_products(company_id);

create table if not exists public.ks_coupons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ks_companies(id) on delete cascade,
  code text not null,
  data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create index if not exists ks_coupons_company_idx
  on public.ks_coupons(company_id);

create table if not exists public.ks_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ks_companies(id) on delete cascade,
  receipt_id text not null,
  cashier_user_id uuid references public.ks_users(id) on delete set null,
  total numeric(14,2) not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, receipt_id)
);

create index if not exists ks_receipts_company_created_idx
  on public.ks_receipts(company_id, created_at desc);

create table if not exists public.ks_company_state (
  company_id uuid primary key references public.ks_companies(id) on delete cascade,
  store_name text not null default 'Kasse',
  store_type text not null default 'Supermarkt',
  sales numeric(14,2) not null default 0,
  tx bigint not null default 0,
  day_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ks_activity_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ks_companies(id) on delete cascade,
  local_id text not null,
  user_id uuid references public.ks_users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, local_id)
);

create index if not exists ks_activity_company_created_idx
  on public.ks_activity_log(company_id, created_at desc);

-- RLS bleibt eingeschaltet. Der Browser greift NICHT direkt zu.
-- Nur die Vercel-API mit dem Supabase Secret/Service-Role-Key arbeitet mit diesen Tabellen.
alter table public.ks_products enable row level security;
alter table public.ks_coupons enable row level security;
alter table public.ks_receipts enable row level security;
alter table public.ks_company_state enable row level security;
alter table public.ks_activity_log enable row level security;

-- Firmenstatus für bereits vorhandene Firmen anlegen.
insert into public.ks_company_state(company_id,store_name,store_type)
select id,name,type from public.ks_companies
on conflict (company_id) do nothing;

-- Bon atomar speichern + Tagesumsatz/Vorgänge erhöhen.
-- Bei einem doppelten Bon wird der Umsatz NICHT ein zweites Mal erhöht.
create or replace function public.ks_record_receipt(
  p_company_id uuid,
  p_receipt_id text,
  p_data jsonb,
  p_total numeric,
  p_cashier_user_id uuid,
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer := 0;
  v_sales numeric(14,2);
  v_tx bigint;
begin
  insert into public.ks_receipts(
    company_id,receipt_id,cashier_user_id,total,data,created_at
  )
  values(
    p_company_id,
    p_receipt_id,
    p_cashier_user_id,
    coalesce(p_total,0),
    coalesce(p_data,'{}'::jsonb),
    coalesce((p_data->>'date')::timestamptz,now())
  )
  on conflict (company_id,receipt_id) do nothing;

  get diagnostics inserted_rows = row_count;

  insert into public.ks_company_state(company_id)
  values(p_company_id)
  on conflict (company_id) do nothing;

  if inserted_rows > 0 then
    update public.ks_company_state
       set sales = sales + coalesce(p_total,0),
           tx = tx + 1,
           updated_at = now()
     where company_id = p_company_id;

    if p_coupon_code is not null and p_coupon_code <> '' then
      update public.ks_coupons
         set used_count = used_count + 1,
             updated_at = now()
       where company_id = p_company_id
         and code = regexp_replace(p_coupon_code,'\D','','g');
    end if;
  end if;

  select sales,tx into v_sales,v_tx
    from public.ks_company_state
   where company_id=p_company_id;

  return jsonb_build_object(
    'sales',coalesce(v_sales,0),
    'tx',coalesce(v_tx,0),
    'inserted',inserted_rows>0
  );
end;
$$;

grant execute on function public.ks_record_receipt(uuid,text,jsonb,numeric,uuid,text) to service_role;

-- Fertig.
