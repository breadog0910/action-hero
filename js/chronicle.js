// ===== 编年史：日记 / 复盘 / 周章回 =====
// 世界的历史书。日记、复盘、对话、行动、求签都归档到这里。

import { getClient } from './supabase.js';

// ---------- 书本管理 ----------

// 取该用户的「我的日记」book_id；若不存在则种子创建
export async function ensureDefaultBook() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('未登录');

  // 先按 user_id 找任意一本（默认日记已建好）
  const { data: existing } = await sb
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  // 没有：种子创建（仅作防御，正常应通过 handle_new_user 触发器建好）
  const id = generateBookId();
  const { data, error } = await sb
    .from('books')
    .insert({
      id,
      user_id: user.id,
      title: '我的日记',
      cover_color: '#6B4423',
      description: '记录每一天的心情与故事',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// 列出该用户的所有书
export async function listBooks() {
  const sb = getClient();
  const { data, error } = await sb
    .from('books')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// 新建一本书
export async function createBook({ title, cover_color = '#6B4423', description = '' }) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('未登录');
  if (!title || !title.trim()) throw new Error('书名不能为空');
  const id = generateBookId();
  const { data, error } = await sb
    .from('books')
    .insert({
      id,
      user_id: user.id,
      title: title.trim().slice(0, 30),
      cover_color,
      description: description?.slice(0, 80) || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// 删除一本书（连带其下编年史）
export async function deleteBook(id) {
  const sb = getClient();
  const { error } = await sb.from('books').delete().eq('id', id);
  if (error) throw error;
}

// 按标题取书；找不到则种子创建
export async function getOrCreateBookByTitle(title, defaults = {}) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('未登录');
  const { data: existing } = await sb
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    .eq('title', title)
    .maybeSingle();
  if (existing) return existing;
  return createBook({ title, ...defaults });
}

// 默认书本配置：type → 归属书名 + 封面默认
const BOOK_BY_TYPE = {
  secret:       { title: '精灵密信', cover_color: '#3E6E8A', description: '写给精灵的悄悄话与回信' },
  conversation: { title: '精灵密信', cover_color: '#3E6E8A', description: '写给精灵的悄悄话与回信' },
};
const DEFAULT_BOOK = { title: '我的日记', cover_color: '#6B4423', description: '记录每一天的心情与故事' };

// 取一本书的全部编年史（按时间顺序）
export async function getBookEntries(bookId) {
  const sb = getClient();
  const { data, error } = await sb
    .from('chronicle')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// 生成唯一书本码：BK + 时间戳 + 随机串，绝不撞码。
function generateBookId() {
  const ts  = Date.now().toString(36).toUpperCase().slice(-6);
  const rnd = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `BK${ts}${rnd}`;
}

// ---------- 编年史条目 ----------

// 写入一条编年史；可指定归属书本；不指定则归档到「我的日记」
export async function addEntry(type, content, meta = {}, bookId = null) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('未登录');

  let targetBookId = bookId;
  if (!targetBookId) {
    const cfg = BOOK_BY_TYPE[type] || DEFAULT_BOOK;
    const book = await getOrCreateBookByTitle(cfg.title, cfg);
    targetBookId = book.id;
  }

  const { data, error } = await sb
    .from('chronicle')
    .insert({ user_id: user.id, book_id: targetBookId, type, content, meta })
    .select()
    .single();
  if (error) throw error;

  // 维护书的更新时间与页数
  await sb
    .from('books')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', targetBookId);
  await refreshBookPageCount(sb, targetBookId);

  return data;
}

async function refreshBookPageCount(sb, bookId) {
  const { count } = await sb
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId);
  await sb.from('books').update({ page_count: count || 0 }).eq('id', bookId);
}

// 取某一天的编年史
export async function getEntriesByDate(dateStr) {
  const sb = getClient();
  const { data, error } = await sb
    .from('chronicle')
    .select('*')
    .eq('date', dateStr)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// 取今天的所有「行动」记录（用于复盘）
export async function getTodayActions() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const start = todayISO();
  const { data, error } = await sb
    .from('actions')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', start)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// 最近的编年史条目（回忆小屋展示用）
export async function listRecent(limit = 10) {
  const sb = getClient();
  const { data, error } = await sb
    .from('chronicle')
    .select('id, type, content, date, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// 编年史总条数
export async function countEntries() {
  const sb = getClient();
  const { count, error } = await sb
    .from('chronicle')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

// 取今天的编年史全部条目
export async function getTodayEntries() {
  const today = todayStr();
  return getEntriesByDate(today);
}

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
