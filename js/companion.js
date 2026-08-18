// ===== 伙伴：陪你成长的生命 =====
// 状态：饱食 / 心情 / 成长 / 阶段
// 对话由 AI 扮演（无 key 时回退固定回复）

import { getClient } from './supabase.js';
import { chat, hasAIKey } from './ai.js';
import { addEntry } from './chronicle.js';

export const STAGE_NAMES = {
  1: '幼芽', 2: '幼苗', 3: '成长', 4: '绽放', 5: '守护者',
};

export async function getCompanion() {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from('companion')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function renameCompanion(name) {
  const sb = getClient();
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb
    .from('companion')
    .update({ name })
    .eq('user_id', user.id);
  if (error) throw error;
}

// 成长值 -> 阶段（每 100 成长升一阶段）
export function stageForGrowth(growth) {
  return Math.min(5, Math.floor(growth / 100) + 1);
}

// 伙伴回应你（对话）
export async function talk(userText) {
  const companion = await getCompanion();
  const name = companion.name || '小光';
  const stageName = STAGE_NAMES[companion.stage] || '伙伴';

  let reply;
  if (hasAIKey()) {
    const sys = `你是「行动勇者」世界里陪伴用户的伙伴，名字叫${name}，当前是${stageName}阶段。` +
      `你温暖、鼓励、不评判。用户是 ADHD 人群，正在对抗拖延。` +
      `用简短（1-3 句）、温柔的中文回应。可以夸赞完成的事、安抚疲惫或低落、鼓励开始拖延的事。不要长篇大论。`;
    try {
      reply = await chat([
        { role: 'system', content: sys },
        { role: 'user', content: userText },
      ], { temperature: 0.9, maxTokens: 200 });
    } catch (e) {
      reply = fallbackReply(userText, name);
    }
  } else {
    reply = fallbackReply(userText, name);
  }

  // 写进编年史（对话类型）
  await addEntry('conversation', `对${name}说：${userText}`, { reply });
  return reply;
}

function fallbackReply(text, name) {
  if (/完成|做了|搞定|成功|打败/.test(text)) {
    return `太棒了！${name}为你骄傲，这个世界因为你又亮了一点。✨`;
  }
  if (/累|累死|疲惫|好难|不想/.test(text)) {
    return `辛苦了。先休息一下也没关系，${name}会一直陪着你。🌿`;
  }
  if (/难过|伤心|不好|低落|焦虑|烦/.test(text)) {
    return `我在呢。你已经很努力了，抱抱你。今天的不开心，说给${name}听就好。🤗`;
  }
  if (/拖延|不想做|拖了/.test(text)) {
    return `没关系，我们把它拆成很小的一步，先做十分钟就好，${name}陪你。⏱️`;
  }
  return `${name}听到啦。你愿意说出来，就已经很棒了。💛`;
}
