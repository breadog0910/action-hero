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

-- ---------- 4.5 剧情任务线（player_quests）----------
-- 玩家按章节推进的剧情任务；任务码为 12 位字符码（QST + 9 位序号），
-- UI 可直接引用（如 QST000000001），适合作为跨端标识与深链参数。
create table if not exists public.player_quests (
  id text primary key,                        -- 12 位任务码：QST + 9 位序号
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter text not null default '序章',        -- 章节名（如 序章/第一章）
  title text not null,                         -- 剧情任务标题
  description text,                            -- 剧情描述
  objective text,                              -- 完成条件说明
  progress int not null default 0,             -- 当前进度
  progress_target int not null default 1,      -- 目标进度
  rewards jsonb not null default '{}'::jsonb,  -- 奖励 {xp, light, item_id}
  status text not null default 'locked',       -- locked/active/completed/claimed
  sort_order int not null default 0,           -- 剧情推进顺序
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.player_quests is '剧情任务线：玩家按章节推进的故事任务，任务码为 12 位字符（QST+9位数字）';
comment on column public.player_quests.id is '12 位任务码，如 QST000000001，UI 可直接引用';
comment on column public.player_quests.user_id is '所属玩家（auth.users.id）';
comment on column public.player_quests.chapter is '所属章节';
comment on column public.player_quests.title is '剧情任务标题';
comment on column public.player_quests.description is '剧情描述';
comment on column public.player_quests.objective is '完成条件说明';
comment on column public.player_quests.progress is '当前进度';
comment on column public.player_quests.progress_target is '目标进度';
comment on column public.player_quests.rewards is '完成奖励 {xp, light, item_id}';
comment on column public.player_quests.status is '状态：locked/active/completed/claimed';
comment on column public.player_quests.sort_order is '剧情顺序，数值小者在前';
comment on column public.player_quests.started_at is '接取（激活）时间';
comment on column public.player_quests.completed_at is '完成时间';
comment on column public.player_quests.created_at is '记录创建时间';

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
create index if not exists idx_player_quests_user on public.player_quests(user_id, sort_order);
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
alter table public.player_quests enable row level security;
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

-- tasks / player_quests / actions / chronicle / receipts（用户列 = user_id，带 id）
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
drop policy if exists "player_quests_own" on public.player_quests;
create policy "player_quests_own" on public.player_quests
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
