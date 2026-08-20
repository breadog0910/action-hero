-- =====================================================
-- 迁移脚本：回忆小屋 → 书架 / 翻书 / 多本并存（books 功能）
-- 适用场景：已经在 Supabase 跑过原版 schema.sql，只需补上「书本」功能。
-- 特性：全程幂等（if not exists / create or replace / drop policy if exists），可反复运行，不丢数据。
-- 在 Supabase 项目 SQL Editor 里整段运行一次即可。
-- =====================================================

-- ---------- 1. 新建 books（书本）表 ----------
create table if not exists public.books (
  id text primary key,                          -- 12 位书本码：BK + 10 位序号
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,                          -- 书名（必填）
  cover_emoji text not null default '📖',       -- 封面图标
  cover_color text not null default '#A03E2B',  -- 书脊/封面颜色
  description text,                             -- 简介
  page_count int not null default 0,            -- 冗余字段：当前页数
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.books is '书本：把编年史按"一本书"聚合，支持多本并存、独立翻阅';
comment on column public.books.id is '12 位书本码，BK + 10 位数字，如 BK0000000001';
comment on column public.books.title is '书名（用户可改）';
comment on column public.books.cover_emoji is '封面图标 emoji';
comment on column public.books.cover_color is '书脊/封面色（hex）';
comment on column public.books.description is '书本简介';
comment on column public.books.page_count is '页数（冗余字段，写入时维护）';

-- ---------- 2. chronicle 增加 book_id 字段（兼容历史数据为 NULL） ----------
alter table public.chronicle add column if not exists book_id text references public.books(id) on delete cascade;
comment on column public.chronicle.book_id is '归属书本（FK → books.id），NULL 表示未归档（兼容历史数据）';

-- ---------- 3. 索引 ----------
create index if not exists idx_chronicle_book on public.chronicle(book_id, created_at);
create index if not exists idx_books_user on public.books(user_id, updated_at desc);

-- ---------- 4. RLS：仅本人可读写 ----------
alter table public.books enable row level security;
drop policy if exists "books_own" on public.books;
create policy "books_own" on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 5. 更新新用户触发器：注册时种子「我的日记」默认书 ----------
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

  -- 种子一本「我的日记」：使用 BK + 10 位序号，按 user 段错开，避免全局冲突
  v_book_id := 'BK' || lpad(replace(new.id::text, '-', ''), 10, '0');
  insert into public.books (id, user_id, title, cover_emoji, cover_color, description)
  values (v_book_id, new.id, '我的日记', '📖', '#A03E2B', '记录每一天的心情与故事')
  on conflict (id) do nothing;

  return new;
end;
$$;
