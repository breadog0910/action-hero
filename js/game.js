// ===== 核心游戏逻辑：任务 + 结算 =====
// 完成一个任务 = 勇者+XP + 世界+光 + 伙伴喂食 + 写编年史

import { getClient } from './supabase.js';
import { rollDrop } from './collection.js';
import { recordAction } from './territory.js';

const XP_BY_DIFFICULTY = { 1: 10, 2: 20, 3: 35, 4: 55, 5: 80 };
const LIGHT_BY_DIFFICULTY = { 1: 5, 2: 10, 3: 18, 4: 28, 5: 40 };
const FEED_PER_TASK = 10;
const XP_PER_LEVEL = 100;
const BOSS_MULTIPLIER = 2; // Boss 任务奖励翻倍

export function xpForDifficulty(d) {
  return XP_BY_DIFFICULTY[d] || XP_BY_DIFFICULTY[1];
}

export function lightForDifficulty(d) {
  return LIGHT_BY_DIFFICULTY[d] || LIGHT_BY_DIFFICULTY[1];
}

export async function getProfile() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

export async function getWorld() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data } = await sb.from('world').select('*').eq('user_id', user.id).single();
  return data;
}

export async function listTasks() {
  const sb = getClient();
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createTask(title, type = 'normal', difficulty = 1) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('tasks')
    .insert({ title, type, difficulty, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// 完成任务：结算奖励 + 更新档案/世界/伙伴 + 掉落 + 连续生长 + 写编年史
// 返回 rewards，供界面提示和小票渲染使用
export async function completeTask(task) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const userId = user.id;

  const isBoss = task.type === 'boss';
  const mult = isBoss ? BOSS_MULTIPLIER : 1;

  const xp = xpForDifficulty(task.difficulty) * mult;
  const light = (LIGHT_BY_DIFFICULTY[task.difficulty] || 5) * mult;
  const feed = FEED_PER_TASK;

  // 1. 标记任务完成
  const { error: taskErr } = await sb
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', task.id);
  if (taskErr) throw taskErr;

  // 2. 掉落（随机）
  let drop = null;
  try {
    drop = await rollDrop(task.difficulty);
  } catch (e) {
    console.warn('掉落失败（不影响结算）：', e);
  }

  // 3. 连续生长
  let newStreak = 0;
  try {
    newStreak = await recordAction();
  } catch (e) {
    console.warn('连续生长更新失败：', e);
  }

  // 4. 结算奖励（读当前值 + 计算新值）
  const [profileRes, worldRes, companionRes] = await Promise.all([
    sb.from('profiles').select('xp, level').eq('id', userId).single(),
    sb.from('world').select('light').eq('user_id', userId).single(),
    sb.from('companion').select('hunger, mood').eq('user_id', userId).single(),
  ]);

  const newXp = (profileRes.data.xp || 0) + xp;
  const newLevel = Math.floor(newXp / XP_PER_LEVEL) + 1;
  const newLight = (worldRes.data.light || 0) + light;
  const newHunger = Math.min(100, (companionRes.data.hunger || 0) + feed);
  const newMood = Math.min(100, (companionRes.data.mood || 0) + Math.round(feed / 2));

  // 5. 写入结算结果
  await Promise.all([
    sb.from('profiles').update({ xp: newXp, level: newLevel }).eq('id', userId),
    sb.from('world').update({ light: newLight }).eq('user_id', userId),
    sb.from('companion').update({
      hunger: newHunger,
      mood: newMood,
      last_fed_at: new Date().toISOString(),
    }).eq('user_id', userId),
    sb.from('actions').insert({
      user_id: userId,
      task_id: task.id,
      xp,
      light,
      feed,
      drop_id: drop ? drop.id : null,
    }),
    sb.from('chronicle').insert({
      user_id: userId,
      type: 'action',
      content: `完成任务「${task.title}」${isBoss ? '（Boss 战胜利！）' : ''}`,
      meta: { xp, light, feed, difficulty: task.difficulty, taskTitle: task.title, isBoss, drop },
    }),
  ]);

  return {
    xp, light, feed, newLevel,
    taskTitle: task.title,
    isBoss,
    drop,
    newStreak,
  };
}

// 完成一次专注（番茄钟）：不依赖任务表
// 专注 25 分钟 ≈ 难度 1 的奖励；时长越长奖励按比例上浮（向上取整到 5）
export async function recordFocus(minutes, goal = '') {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const userId = user.id;

  const baseXp = 10, baseLight = 5;
  const scale = Math.max(1, minutes / 25);
  const xp = Math.round((baseXp * scale) / 5) * 5;
  const light = Math.round((baseLight * scale) / 5) * 5;
  const feed = Math.round(FEED_PER_TASK / 2);

  // 连续生长
  let newStreak = 0;
  try {
    newStreak = await recordAction();
  } catch (e) {
    console.warn('连续生长更新失败：', e);
  }

  // 读当前值 + 结算
  const [profileRes, worldRes, companionRes] = await Promise.all([
    sb.from('profiles').select('xp, level').eq('id', userId).single(),
    sb.from('world').select('light').eq('user_id', userId).single(),
    sb.from('companion').select('hunger, mood').eq('user_id', userId).single(),
  ]);

  const newXp = (profileRes.data.xp || 0) + xp;
  const newLevel = Math.floor(newXp / XP_PER_LEVEL) + 1;
  const newLight = (worldRes.data.light || 0) + light;
  const newHunger = Math.min(100, (companionRes.data.hunger || 0) + feed);
  const newMood = Math.min(100, (companionRes.data.mood || 0) + Math.round(feed / 2));

  const content = goal
    ? `完成 ${minutes} 分钟专注「${goal}」`
    : `完成 ${minutes} 分钟专注时光`;

  await Promise.all([
    sb.from('profiles').update({ xp: newXp, level: newLevel }).eq('id', userId),
    sb.from('world').update({ light: newLight }).eq('user_id', userId),
    sb.from('companion').update({
      hunger: newHunger,
      mood: newMood,
      last_fed_at: new Date().toISOString(),
    }).eq('user_id', userId),
    sb.from('actions').insert({
      user_id: userId,
      task_id: null,
      xp,
      light,
      feed,
      drop_id: null,
    }),
    sb.from('chronicle').insert({
      user_id: userId,
      type: 'action',
      content,
      meta: { minutes, goal, focus: true, xp, light },
    }),
  ]);

  return { xp, light, feed, newLevel, newStreak, minutes, goal };
}
