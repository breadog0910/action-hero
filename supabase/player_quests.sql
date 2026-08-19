-- =====================================================
-- 剧情任务线 player_quests（增量迁移）
-- 面向已部署旧版 schema 的数据库：只补跑本文件即可。
-- 若尚未跑过 schema.sql，直接运行 schema.sql（已含本节）。
-- 全程幂等，可重复执行。
-- =====================================================

-- ---------- 1. 建表 ----------
-- 任务码：12 位字符码 = 'QST' + 9 位零填充序号（如 QST000000001），
-- 由应用层生成（如 padStart(9,'0')），UI 可直接引用，适合深链/跨端传递。
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

-- ---------- 2. 数据注释 ----------
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

-- ---------- 3. 索引 ----------
create index if not exists idx_player_quests_user
  on public.player_quests(user_id, sort_order);

-- ---------- 4. Row Level Security：仅本人可读写 ----------
alter table public.player_quests enable row level security;

drop policy if exists "player_quests_own" on public.player_quests;
create policy "player_quests_own" on public.player_quests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- （可选）示例：给当前第一个用户注入序章剧情任务线
-- 实际剧情内容由应用层/策划配置；此处仅演示字段用法。
-- =====================================================
-- insert into public.player_quests
--   (id, user_id, chapter, title, description, objective,
--    progress, progress_target, rewards, status, sort_order)
-- select 'QST000000001', u.id, '序章', '点亮第一束光',
--        '拖延阴影正笼罩着领地，是时候出发了。',
--        '完成任意 1 个真实行动', 0, 1,
--        '{"xp": 20, "light": 10}', 'active', 1
-- from (select id from auth.users limit 1) u
-- on conflict (id) do nothing;
