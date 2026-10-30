-- ScrapHub database schema
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Row Level Security is enabled with no policies on every table. That is
-- deliberate: the anon key (which is public and shipped to browsers) can then
-- read nothing. Only the service role key, held server-side in the API
-- functions, bypasses RLS. Never put the service key in client code.

-- ---------------------------------------------------------------- users ----
create table if not exists app_users (
  id          text primary key,
  email       text unique not null,
  name        text not null,
  role        text not null default 'household'
              check (role in ('household','vendor','factory','transporter','admin')),
  phone       text default '',
  locality    text default '',
  pin         text default '',
  status      text not null default 'active' check (status in ('active','suspended')),
  -- Optional. OTP sign-in needs no password; this exists only so the older
  -- password flow keeps working for accounts that already have one.
  pw          jsonb,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
create index if not exists app_users_email_idx on app_users (lower(email));

-- ------------------------------------------------------------ otp codes ----
-- Codes are stored hashed. A plaintext code exists only in the email.
create table if not exists otp_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  purpose     text not null default 'signin' check (purpose in ('signin','reset','verify')),
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists otp_codes_email_idx on otp_codes (lower(email), created_at desc);
create index if not exists otp_codes_expiry_idx on otp_codes (expires_at);

-- -------------------------------------------------------------- sessions ----
-- Only the hash of a session token is stored, so a database leak does not hand
-- over live sessions.
create table if not exists sessions (
  token_hash  text primary key,
  user_id     text not null references app_users(id) on delete cascade,
  user_agent  text,
  ip          text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

-- ------------------------------------------------------------------ RLS ----
alter table app_users enable row level security;
alter table otp_codes enable row level security;
alter table sessions  enable row level security;
-- No policies on purpose: anon and authenticated roles get nothing.

-- ------------------------------------------------------------- cleanup ----
-- Housekeeping for expired rows. Call it from a scheduled job if you add one;
-- nothing breaks without it, the tables just grow slowly.
create or replace function prune_expired() returns void language sql as $$
  delete from otp_codes where expires_at < now() - interval '1 day';
  delete from sessions  where expires_at < now();
$$;

-- -------------------------------------------------- first administrator ----
-- Replace the email, run it, then sign in with an emailed code. Self-service
-- sign-up can never create an administrator, so this is the only way to make
-- the first one.
-- insert into app_users (id, email, name, role)
-- values ('u_admin', 'you@example.com', 'Platform Admin', 'admin')
-- on conflict (email) do update set role = 'admin';
