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

-- ---------- 11. 书本（日记本）----------
-- 一本"书"可装多页编年史：日记、复盘、对话、行动、求签、密信都归档其中。
-- 默认会有一本「我的日记」；用户也可新建多本（旅行/灵感/读书笔记…）。
create table if not exists public.books (
  id text primary key,                          -- 12 位书本码：BK + 10 位序号
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,                          -- 书名（必填）
  cover_emoji text default '',                   -- 封面图标（已弃用，保留兼容）
  cover_color text not null default '#6B4423',   -- 书脊/封面颜色
  description text,                             -- 简介
  page_count int not null default 0,            -- 冗余字段：当前页数
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.books is '书本：把编年史按"一本书"聚合，支持多本并存、独立翻阅';
comment on column public.books.id is '12 位书本码，BK + 10 位数字，如 BK0000000001';
comment on column public.books.title is '书名（用户可改）';
comment on column public.books.cover_emoji is '封面图标（已弃用，保留兼容）';
comment on column public.books.cover_color is '书脊/封面色（hex）';
comment on column public.books.description is '书本简介';
comment on column public.books.page_count is '页数（冗余字段，写入时维护）';

-- ---------- 6. 编年史（日记/复盘/对话/行动/求签）----------
create table if not exists public.chronicle (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text references public.books(id) on delete cascade,  -- 归属书本
  type text not null,                       -- journal/review/conversation/action/oracle/secret
  content text,
  meta jsonb,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

comment on column public.chronicle.book_id is '归属书本（FK → books.id），NULL 表示未归档（兼容历史数据）';

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
create index if not exists idx_chronicle_book on public.chronicle(book_id, created_at);
create index if not exists idx_books_user on public.books(user_id, updated_at desc);
create index if not exists idx_receipts_user on public.receipts(user_id, created_at);

-- =====================================================
-- Row Level Security：仅本人可读写
-- =====================================================
alter table public.profiles enable row level security;
alter table public.world enable row level security;
alter table public.companion enable row level security;
alter table public.tasks enable row level security;
alter table public.player_quests enable row level security;
alter table public.books enable row level security;
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

-- books（用户列 = user_id）
drop policy if exists "books_own" on public.books;
create policy "books_own" on public.books
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
-- 新用户注册时自动初始化世界/伙伴/领地/档案 + 默认书
-- =====================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_book_id text;
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.world (user_id) values (new.id) on conflict do nothing;
  insert into public.companion (user_id) values (new.id) on conflict do nothing;
  insert into public.territory (user_id) values (new.id) on conflict do nothing;

  -- 种子一本「我的日记」
  v_book_id := 'BK' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 10));
  insert into public.books (id, user_id, title, cover_color, description)
  values (v_book_id, new.id, '我的日记', '#6B4423', '记录每一天的心情与故事')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
