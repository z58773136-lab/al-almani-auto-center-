-- Booking data stays behind the database API. Only the Edge Function uses
-- the service role key; no anonymous read/write policy is granted.
create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  booking_type text not null,
  owner_name text not null,
  phone text not null,
  car_make_model text not null,
  car_year integer,
  plate_number text,
  message text,
  status text not null default 'تم استلام طلبك',
  created_at timestamptz not null default now()
);

alter table public.booking_requests enable row level security;
revoke all on public.booking_requests from anon, authenticated;

create index if not exists booking_requests_reference_phone_idx
  on public.booking_requests (reference, phone);

create table if not exists public.booking_rate_limits (
  id bigint generated always as identity primary key,
  key_hash text not null,
  action text not null check (action in ('create', 'lookup')),
  created_at timestamptz not null default now()
);

alter table public.booking_rate_limits enable row level security;
revoke all on public.booking_rate_limits from anon, authenticated;
create index if not exists booking_rate_limits_key_action_created_idx
  on public.booking_rate_limits (key_hash, action, created_at desc);

