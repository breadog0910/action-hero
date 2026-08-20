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

// ===== 系统自动判定任务难度（1~5）=====
// 关键词命中取最高档；未命中按标题长度兜底。Boss 至少 3 级。
const DIFFICULTY_KEYWORDS = {
  5: ['论文', '答辩', '面试', '演讲', '考研', '考公', '考试周', '创业', '开业', '搬家', '手术', '大型项目', '交付', '述职', '汇报', '竞标', '离婚', '留学', '高考'],
  4: ['报告', '方案', '复习', '备考', '考试', '健身', '项目', '出差', '谈判', '加班', '通宵', '备课', '总结', '复盘', '审计', '申报', '投稿', '截稿'],
  3: ['学习', '读书', '运动', '作业', '写作', '设计', '计划', '整理', '码', '代码', '工作', '会议', '沟通', '调研', '翻译', '练琴', '备考', '改稿'],
  2: ['散步', '做饭', '购物', '洗衣服', '打扫', '背单词', '冥想', '记账', '回邮件', '打电话', '看电影', '约会', '遛狗', '浇花'],
  1: ['喝水', '吃药', '休息', '睡觉', '洗漱', '打卡', '发消息', '伸展', '深呼吸', '吃饭', '倒垃圾', '充电', '晒太阳', '伸懒腰'],
};
const DIFF_LABEL = { 1: '轻松', 2: '日常', 3: '挑战', 4: '困难', 5: '史诗' };

export function difficultyLabel(d) {
  return DIFF_LABEL[d] || DIFF_LABEL[1];
}

export function estimateDifficulty(title, type = 'normal') {
  const t = (title || '').toLowerCase();
  let score = 0;
  for (const [lvl, words] of Object.entries(DIFFICULTY_KEYWORDS)) {
    for (const w of words) {
      if (t.includes(w.toLowerCase())) score = Math.max(score, Number(lvl));
    }
  }
  if (!score) {
    const len = (title || '').trim().length;
    score = len <= 6 ? 1 : len <= 12 ? 2 : 3;
  }
  if (type === 'boss') score = Math.max(score, 3);
  return Math.min(5, Math.max(1, score));
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
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) {
    throw new Error('登录已过期或会话失效，请重新登录后再添加任务。');
  }
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
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) {
    throw new Error('登录已过期或会话失效，请重新登录后再完成任务。');
  }
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
  const xp = Math.max(5, Math.round((baseXp * scale) / 5) * 5);
  const light = Math.max(5, Math.round((baseLight * scale) / 5) * 5);
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
