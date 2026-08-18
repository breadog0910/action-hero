-- =====================================================
-- 行动勇者（ActionHero）Supabase 数据库结构
-- 在 Supabase 项目的 SQL Editor 里整段运行一次即可。
-- =====================================================

-- ---------- 1. 勇者档案 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  level int not null default 1,
  xp int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 2. 世界状态 ----------
create table if not exists public.world (
  user_id uuid primary key references auth.users(id) on delete cascade,
  season text not null default 'spring',   -- spring/summer/autumn/winter
  light int not null default 0,            -- 世界之光（活跃度）
  day_count int not null default 1,        -- 世界天数
  updated_at timestamptz not null default now()
);

-- ---------- 3. 伙伴 ----------
create table if not exists public.companion (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '小光',
  hunger int not null default 100,
  mood int not null default 100,
  growth int not null default 0,
  stage int not null default 1,
  last_fed_at timestamptz
);

-- ---------- 4. 任务 ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null default 'normal',     -- normal / boss
  difficulty int not null default 1,       -- 1~5
  status text not null default 'open',     -- open / done
  created_at timestamptz not null default now()
);

-- ---------- 5. 行动结算（世界的一束光）----------
create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  xp int not null default 0,
  light int not null default 0,
  drop_id uuid,
  feed int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 6. 编年史（日记/复盘/对话/行动/求签）----------
create table if not exists public.chronicle (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                       -- journal/review/conversation/action/oracle
  content text,
  meta jsonb,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- 7. 掉落物目录（静态）----------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rarity text not null default 'common',    -- common/uncommon/rare/epic/legendary
  emoji text,
  description text
);

-- ---------- 8. 世界图鉴（已收集）----------
create table if not exists public.collection (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  obtained_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- ---------- 9. 领地 + 连续生长 ----------
create table if not exists public.territory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  streak int not null default 0,
  last_action_date date,
  unlocked_tiles int not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------- 10. 打印历史 ----------
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                       -- celebrate/explore/comfort/review/oracle...
  content text,
  created_at timestamptz not null default now()
);

-- =====================================================
-- 索引
-- =====================================================
create index if not exists idx_tasks_user on public.tasks(user_id);
create index if not exists idx_actions_user on public.actions(user_id, created_at);
create index if not exists idx_chronicle_user on public.chronicle(user_id, date);
create index if not exists idx_receipts_user on public.receipts(user_id, created_at);

-- =====================================================
-- Row Level Security：仅本人可读写
-- =====================================================
alter table public.profiles enable row level security;
alter table public.world enable row level security;
alter table public.companion enable row level security;
alter table public.tasks enable row level security;
alter table public.actions enable row level security;
alter table public.chronicle enable row level security;
alter table public.collection enable row level security;
alter table public.territory enable row level security;
alter table public.receipts enable row level security;

-- 用户表：仅本人可读写。注意各表用户标识列不同：
--   profiles 用 id 列（= auth.users.id）
--   其余表用 user_id 列

-- profiles（用户列 = id）
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- world / companion / territory（用户列 = user_id，主键）
drop policy if exists "world_own" on public.world;
create policy "world_own" on public.world
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "companion_own" on public.companion;
create policy "companion_own" on public.companion
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "territory_own" on public.territory;
create policy "territory_own" on public.territory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- tasks / actions / chronicle / receipts（用户列 = user_id，带自增 id）
drop policy if exists "tasks_own" on public.tasks;
create policy "tasks_own" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "actions_own" on public.actions;
create policy "actions_own" on public.actions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "chronicle_own" on public.chronicle;
create policy "chronicle_own" on public.chronicle
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "receipts_own" on public.receipts;
create policy "receipts_own" on public.receipts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- collection（复合主键，无独立 id，用户列 = user_id）
drop policy if exists "collection_own" on public.collection;
create policy "collection_own" on public.collection
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- items 目录：所有登录用户可读
alter table public.items enable row level security;
drop policy if exists "items_read" on public.items;
create policy "items_read" on public.items for select using (true);

-- =====================================================
-- 新用户注册时自动初始化世界/伙伴/领地/档案
-- =====================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.world (user_id) values (new.id) on conflict do nothing;
  insert into public.companion (user_id) values (new.id) on conflict do nothing;
  insert into public.territory (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
