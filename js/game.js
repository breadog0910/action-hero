// ===== 核心游戏逻辑：任务 + 结算 =====
// 完成一个任务 = 勇者+XP + 世界+光 + 伙伴喂食 + 写编年史

import { getClient } from './supabase.js';

const XP_BY_DIFFICULTY = { 1: 10, 2: 20, 3: 35, 4: 55, 5: 80 };
const LIGHT_BY_DIFFICULTY = { 1: 5, 2: 10, 3: 18, 4: 28, 5: 40 };
const FEED_PER_TASK = 10;
const XP_PER_LEVEL = 100;

export function xpForDifficulty(d) {
  return XP_BY_DIFFICULTY[d] || XP_BY_DIFFICULTY[1];
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
  const { data, error } = await sb
    .from('tasks')
    .insert({ title, type, difficulty })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// 完成任务：结算奖励 + 更新档案/世界/伙伴 + 写编年史
// 返回 rewards，供界面提示和小票渲染使用
export async function completeTask(task) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const userId = user.id;

  const xp = xpForDifficulty(task.difficulty);
  const light = LIGHT_BY_DIFFICULTY[task.difficulty] || 5;
  const feed = FEED_PER_TASK;

  // 1. 标记任务完成
  const { error: taskErr } = await sb
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', task.id);
  if (taskErr) throw taskErr;

  // 2. 结算奖励（读当前值 + 计算新值）
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

  // 3. 写入结算结果
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
    }),
    sb.from('chronicle').insert({
      user_id: userId,
      type: 'action',
      content: `完成任务「${task.title}」`,
      meta: { xp, light, feed, difficulty: task.difficulty, taskTitle: task.title },
    }),
  ]);

  return { xp, light, feed, newLevel, taskTitle: task.title };
}
