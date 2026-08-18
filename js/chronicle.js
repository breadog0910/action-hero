// ===== 编年史：日记 / 复盘 / 周章回 =====
// 世界的历史书。日记、复盘、对话、行动、求签都归档到这里。

import { getClient } from './supabase.js';

export async function addEntry(type, content, meta = {}) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('chronicle')
    .insert({ user_id: user.id, type, content, meta })
    .select()
    .single();
  if (error) throw error;
  return data;
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
