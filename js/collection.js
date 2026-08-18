// ===== 世界图鉴：掉落 + 收集 =====
// 完成任务时按难度随机掉落物品，收集进图鉴

import { getClient } from './supabase.js';

// 稀有度掉落概率（难度越高，越容易掉稀有）
const RARITY_WEIGHTS = {
  1: { common: 90, uncommon: 9, rare: 1, epic: 0, legendary: 0 },
  2: { common: 75, uncommon: 20, rare: 4, epic: 1, legendary: 0 },
  3: { common: 60, uncommon: 28, rare: 10, epic: 2, legendary: 0 },
  4: { common: 45, uncommon: 32, rare: 16, epic: 6, legendary: 1 },
  5: { common: 30, uncommon: 30, rare: 24, epic: 12, legendary: 4 },
};

export const RARITY_NAMES = {
  common: '普通', uncommon: '稀有', rare: '珍贵', epic: '史诗', legendary: '传说',
};
export const RARITY_EMOJI = {
  common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟡',
};

// 获取全部掉落物目录
export async function listItems() {
  const sb = getClient();
  const { data, error } = await sb.from('items').select('*').order('name');
  if (error) throw error;
  return data || [];
}

// 已收集的图鉴
export async function listCollection() {
  const sb = getClient();
  const { data, error } = await sb
    .from('collection')
    .select('item_id, obtained_at, items(*)')
    .order('obtained_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// 按难度随机一个稀有度
function rollRarity(difficulty) {
  const weights = RARITY_WEIGHTS[difficulty] || RARITY_WEIGHTS[1];
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [rarity, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return rarity;
  }
  return 'common';
}

// 结算时调用：返回掉落物（可能为 null）
export async function rollDrop(difficulty) {
  const items = await listItems();
  if (items.length === 0) return null;

  const rarity = rollRarity(difficulty);
  const pool = items.filter((i) => i.rarity === rarity);
  if (pool.length === 0) return null;

  const item = pool[Math.floor(Math.random() * pool.length)];

  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb
    .from('collection')
    .upsert({ user_id: user.id, item_id: item.id }, { onConflict: 'user_id,item_id' });
  if (error) throw error;

  return item;
}
