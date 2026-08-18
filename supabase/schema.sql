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

-- 用户表：统一策略（仅本人）
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','world','companion','tasks','actions','chronicle','collection','territory','receipts'
  ]
  loop
    execute format('create policy "own_select" on public.%I for select using (auth.uid() = user_id or auth.uid() = id);', t);
    execute format('create policy "own_insert" on public.%I for insert with check (auth.uid() = user_id or auth.uid() = id);', t);
    execute format('create policy "own_update" on public.%I for update using (auth.uid() = user_id or auth.uid() = id);', t);
    execute format('create policy "own_delete" on public.%I for delete using (auth.uid() = user_id or auth.uid() = id);', t);
  end loop;
end $$;

-- items 目录：所有登录用户可读
alter table public.items enable row level security;
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
