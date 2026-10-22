-- Workshop CRM, work orders, and financial ledger.
-- Access is restricted by JWT app_metadata.role: admin, manager, accountant, technician.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_staff_role()
returns text language sql stable set search_path = ''
as $ select coalesce((select auth.jwt())->'app_metadata'->>'role', '') $;
revoke all on function private.current_staff_role() from public, anon;
grant execute on function private.current_staff_role() to authenticated;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  email text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'website')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.work_order_number_seq;

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('WO-' || lpad(nextval('public.work_order_number_seq'::regclass)::text, 6, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  booking_request_id uuid unique references public.booking_requests(id) on delete set null,
  car_make_model text not null,
  plate_number text,
  service_type text not null,
  issue_description text not null,
  status text not null default 'open' check (status in ('open','diagnosing','waiting_parts','in_progress','ready','closed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','urgent')),
  labor_cost numeric(12,2) not null default 0 check (labor_cost >= 0),
  parts_cost numeric(12,2) not null default 0 check (parts_cost >= 0),
  total_cost numeric(12,2) generated always as (labor_cost + parts_cost) stored,
  opened_at timestamptz not null default now(),
  promised_at date,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('income','expense')),
  work_order_id uuid references public.work_orders(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  category text not null,
  description text,
  payment_method text not null default 'cash' check (payment_method in ('cash','bank_transfer','card','other')),
  transaction_date date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists customers_name_idx on public.customers (full_name);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists work_orders_customer_opened_idx on public.work_orders (customer_id, opened_at desc);
create index if not exists work_orders_status_opened_idx on public.work_orders (status, opened_at desc);
create index if not exists financial_transactions_date_type_idx on public.financial_transactions (transaction_date desc, transaction_type);
create index if not exists work_orders_created_by_idx on public.work_orders (created_by);
create index if not exists financial_transactions_work_order_id_idx on public.financial_transactions (work_order_id);
create index if not exists financial_transactions_created_by_idx on public.financial_transactions (created_by);

alter table public.customers enable row level security;
alter table public.work_orders enable row level security;
alter table public.financial_transactions enable row level security;
revoke all on public.customers, public.work_orders, public.financial_transactions from anon;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.work_orders to authenticated;
grant select, insert, update, delete on public.financial_transactions to authenticated;
grant usage, select on sequence public.work_order_number_seq to authenticated;
grant insert, select, update on public.customers to service_role;

drop policy if exists "staff manage customers" on public.customers;
create policy "staff manage customers" on public.customers for all to authenticated
  using ((select private.current_staff_role()) = any (array['admin','manager','accountant','technician']::text[]))
  with check ((select private.current_staff_role()) = any (array['admin','manager','accountant','technician']::text[]));

drop policy if exists "staff read work orders" on public.work_orders;
create policy "staff read work orders" on public.work_orders for select to authenticated
  using ((select private.current_staff_role()) = any (array['admin','manager','accountant','technician']::text[]));
drop policy if exists "authorized staff create work orders" on public.work_orders;
create policy "authorized staff create work orders" on public.work_orders for insert to authenticated
  with check ((select private.current_staff_role()) = any (array['admin','manager','technician']::text[]));
drop policy if exists "authorized staff update work orders" on public.work_orders;
create policy "authorized staff update work orders" on public.work_orders for update to authenticated
  using ((select private.current_staff_role()) = any (array['admin','manager','technician']::text[]))
  with check ((select private.current_staff_role()) = any (array['admin','manager','technician']::text[]));
drop policy if exists "admin delete work orders" on public.work_orders;
create policy "admin delete work orders" on public.work_orders for delete to authenticated
  using ((select private.current_staff_role()) = 'admin');

drop policy if exists "accounting read transactions" on public.financial_transactions;
create policy "accounting read transactions" on public.financial_transactions for select to authenticated
  using ((select private.current_staff_role()) = any (array['admin','accountant']::text[]));
drop policy if exists "accounting create transactions" on public.financial_transactions;
create policy "accounting create transactions" on public.financial_transactions for insert to authenticated
  with check ((select private.current_staff_role()) = any (array['admin','accountant']::text[]));
drop policy if exists "accounting update transactions" on public.financial_transactions;
create policy "accounting update transactions" on public.financial_transactions for update to authenticated
  using ((select private.current_staff_role()) = any (array['admin','accountant']::text[]))
  with check ((select private.current_staff_role()) = any (array['admin','accountant']::text[]));
drop policy if exists "admin delete transactions" on public.financial_transactions;
create policy "admin delete transactions" on public.financial_transactions for delete to authenticated
  using ((select private.current_staff_role()) = 'admin');

grant select, update on public.booking_requests to authenticated;
drop policy if exists "staff read booking requests" on public.booking_requests;
create policy "staff read booking requests" on public.booking_requests for select to authenticated
  using ((select private.current_staff_role()) = any (array['admin','manager','accountant','technician']::text[]));
drop policy if exists "staff update booking requests" on public.booking_requests;
create policy "staff update booking requests" on public.booking_requests for update to authenticated
  using ((select private.current_staff_role()) = any (array['admin','manager','technician']::text[]))
  with check ((select private.current_staff_role()) = any (array['admin','manager','technician']::text[]));

create or replace function private.sync_booking_customer()
returns trigger language plpgsql set search_path = '' as $$
declare normalized_phone text;
begin
  normalized_phone := regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g');
  if normalized_phone <> '' then
    insert into public.customers (full_name, phone, source)
    values (new.owner_name, normalized_phone, 'website')
    on conflict (phone) do update set full_name = excluded.full_name, updated_at = now();
  end if;
  return new;
end;
$$;
revoke all on function private.sync_booking_customer() from public, anon, authenticated;
drop trigger if exists booking_request_sync_customer on public.booking_requests;
create trigger booking_request_sync_customer after insert on public.booking_requests
for each row execute function private.sync_booking_customer();

insert into public.customers (full_name, phone, source)
select distinct on (normalized.phone) normalized.owner_name, normalized.phone, 'website'
from (
  select owner_name, regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') as phone, created_at
  from public.booking_requests
) as normalized
where normalized.phone <> ''
order by normalized.phone, normalized.created_at desc
on conflict (phone) do update set full_name = excluded.full_name, updated_at = now();
