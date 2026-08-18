// ===== 世界时间观 =====
// 世界的时间随现实推进：世界天数、季节、昼夜

import { getClient } from './supabase.js';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
export const SEASON_EMOJI = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

// 世界天数 -> 季节（每 7 天一个季节）
export function seasonForDay(dayCount) {
  return SEASONS[Math.floor((dayCount - 1) / 7) % 4];
}

// 判断是否跨天（用于夜晚结算/日复盘）
export function isNewDay(lastDateStr) {
  if (!lastDateStr) return true;
  const today = todayStr();
  return lastDateStr !== today;
}

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isNight() {
  const h = new Date().getHours();
  return h >= 20 || h < 6;
}

export function daytimePhase() {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return '清晨';
  if (h >= 12 && h < 18) return '白昼';
  if (h >= 18 && h < 20) return '黄昏';
  return '夜晚';
}

export async function getWorld() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('world').select('*').eq('user_id', user.id).single();
  if (error) throw error;
  return data;
}

// 推进世界天数（新的一天第一次结算时调用，返回是否跨天了）
export async function rolloverDay() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const world = await getWorld();
  const today = todayStr();

  // world 表没有存 last_date，用 updated_at 判断太粗；这里简单每登录推进（后续用 territory 的 last_action_date 精确判断）
  // MVP：若今天尚未计入，则 day_count +1
  const { data: actions } = await sb
    .from('actions')
    .select('created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  const crossedDay = !actions || actions.length === 0
    ? false
    : (todayStr() !== dateStr(actions[0].created_at));

  if (crossedDay) {
    const newDay = (world.day_count || 1) + 1;
    const season = seasonForDay(newDay);
    await sb.from('world')
      .update({ day_count: newDay, season })
      .eq('user_id', user.id);
    return true;
  }
  return false;
}

function dateStr(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
