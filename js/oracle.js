// ===== 贤者之书（答案之书）=====
// 心里想问 → 随机翻一页 → 得一句答案

import { addEntry } from './chronicle.js';

let answersCache = null;

async function loadAnswers() {
  if (answersCache) return answersCache;
  const res = await fetch('data/answers.json');
  const data = await res.json();
  answersCache = data.answers || [];
  return answersCache;
}

// 翻一页：返回随机答案
export async function drawAnswer() {
  const answers = await loadAnswers();
  if (answers.length === 0) return '此刻，答案在你心中。';
  const idx = Math.floor(Math.random() * answers.length);
  return answers[idx];
}

// 求签：记录到编年史，返回答案
export async function askOracle(question) {
  const answer = await drawAnswer();
  await addEntry('oracle', answer, { question: question || null });
  return { question, answer };
}
