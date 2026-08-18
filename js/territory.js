// ===== 领地：连续生长 =====
// 连续行动解锁地块；中断只停止生长，不清零惩罚

import { getClient } from './supabase.js';
import { todayStr } from './world.js';

// 领地等级（连续天数）对应的称号与地块
export const TERRITORY_TIERS = [
  { days: 0, name: '荒地', emoji: '🏜️' },
  { days: 1, name: '萌芽之地', emoji: '🌱' },
  { days: 3, name: '小小营地', emoji: '⛺' },
  { days: 7, name: '村庄', emoji: '🏡' },
  { days: 14, name: '小镇', emoji: '🏘️' },
  { days: 30, name: '城堡', emoji: '🏰' },
  { days: 60, name: '王国', emoji: '👑' },
];

export function tierForStreak(streak) {
  let t = TERRITORY_TIERS[0];
  for (const tier of TERRITORY_TIERS) {
    if (streak >= tier.days) t = tier;
  }
  return t;
}

export async function getTerritory() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('territory')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error) throw error;
  return data;
}

// 每次结算行动后调用：更新连续天数
export async function recordAction() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const t = await getTerritory();
  const today = todayStr();
  const yesterday = yesterdayStr();

  let newStreak;
  if (t.last_action_date === today) {
    newStreak = t.streak; // 今天已行动过，不变
  } else if (t.last_action_date === yesterday) {
    newStreak = t.streak + 1; // 连续
  } else {
    newStreak = 1; // 中断，重新开始（不清零惩罚，从 1 重新数）
  }

  const unlockedTiles = Math.max(t.unlocked_tiles || 1, newStreak + 1);

  const { error } = await sb
    .from('territory')
    .update({ streak: newStreak, last_action_date: today, unlocked_tiles: unlockedTiles })
    .eq('user_id', user.id);
  if (error) throw error;

  return newStreak;
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
