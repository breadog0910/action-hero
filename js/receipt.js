// ===== 小票渲染模块 =====
// 把结构化内容渲染成 384 点宽的黑白位图，供 printer.printRaster 打印
// 同时导出「行构建函数」（*Lines），小票册用同一份行数据渲染绘本风卡片，保证画风统一

const PAPER_WIDTH = 384;
const PADDING = 16;

// 折行：按字符宽度把超长文本折成多行
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  lines.push(line);
  return lines;
}

// lines 元素：{ text, size, align(left/center/right), bold, space(上方额外间距px), divider(布尔) }
export function renderReceipt(lines) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const maxWidth = PAPER_WIDTH - PADDING * 2;

  // 第一遍：计算每一行的绘制位置和高度
  let y = PADDING;
  const drawOps = [];

  for (const ln of lines) {
    const size = ln.size || 20;
    const bold = ln.bold ? 'bold ' : '';
    ctx.font = `${bold}${size}px sans-serif`;
    const align = ln.align || 'left';

    if (ln.divider) {
      drawOps.push({ type: 'line', y: y });
      y += 8;
      continue;
    }

    const wrapped = wrapText(ctx, ln.text || '', maxWidth);
    const lineHeight = Math.round(size * 1.4);
    for (const w of wrapped) {
      drawOps.push({ type: 'text', text: w, size, bold, align, y });
      y += lineHeight;
    }
    y += ln.space || 0;
  }

  const height = y + PADDING;
  canvas.width = PAPER_WIDTH;
  canvas.height = height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  for (const op of drawOps) {
    if (op.type === 'line') {
      // 分隔线
      ctx.fillRect(PADDING, op.y, PAPER_WIDTH - PADDING * 2, 2);
      continue;
    }
    ctx.font = `${op.bold}${op.size}px sans-serif`;
    let x = PADDING;
    const w = ctx.measureText(op.text).width;
    if (op.align === 'center') x = (PAPER_WIDTH - w) / 2;
    else if (op.align === 'right') x = PAPER_WIDTH - PADDING - w;
    ctx.fillText(op.text, x, op.y);
  }

  return { ctx, width: canvas.width, height: canvas.height };
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ===== 庆祝小票：完成任务 =====
export function celebrateLines(taskTitle, rewards) {
  const lines = [];
  if (rewards.isBoss) {
    lines.push({ text: '⚔️ Boss 战胜利！', size: 26, align: 'center', bold: true, space: 6 });
  } else {
    lines.push({ text: '🎉 任务完成！', size: 26, align: 'center', bold: true, space: 6 });
  }
  lines.push({ divider: true });
  lines.push({ text: `「${taskTitle}」`, size: 22, align: 'center', space: 6 });
  lines.push({ divider: true });
  lines.push({ text: `勇者  +${rewards.xp} XP`, size: 20, space: 2 });
  lines.push({ text: `世界之光  +${rewards.light}`, size: 20, space: 2 });
  lines.push({ text: `伙伴饱食  +${rewards.feed}`, size: 20, space: 2 });

  if (rewards.drop) {
    lines.push({ text: `掉落  ${rewards.drop.emoji || ''} ${rewards.drop.name}`, size: 20, space: 2 });
  }

  if (rewards.newStreak) {
    lines.push({ text: `连续行动  ${rewards.newStreak} 天`, size: 18, space: 6 });
  }

  lines.push({ divider: true });
  lines.push({ text: rewards.isBoss ? '你打败了最拖延的自己！' : '继续前进，勇者！', size: 20, align: 'center', space: 6 });
  lines.push({ text: `行动勇者 · ${todayStr()}`, size: 16, align: 'center' });
  return lines;
}

export function celebrateReceipt(taskTitle, rewards) {
  return renderReceipt(celebrateLines(taskTitle, rewards));
}

// ===== 复盘小票：今日总结 =====
export function reviewLines({ date, actions, entries }) {
  const lines = [
    { text: '🌙 今日复盘', size: 26, align: 'center', bold: true, space: 6 },
    { divider: true },
    { text: date, size: 18, align: 'center', space: 6 },
    { divider: true },
  ];

  const totalXp = actions.reduce((s, a) => s + (a.xp || 0), 0);
  const totalLight = actions.reduce((s, a) => s + (a.light || 0), 0);

  if (actions.length === 0) {
    lines.push({ text: '今天还没有行动记录', size: 18, align: 'center', space: 4 });
    lines.push({ text: '世界在安静地等你', size: 16, align: 'center', space: 6 });
  } else {
    lines.push({ text: `完成了 ${actions.length} 件事`, size: 20, align: 'center', space: 4 });
    lines.push({ text: `共获得 +${totalXp} XP`, size: 18, space: 2 });
    lines.push({ text: `世界之光 +${totalLight}`, size: 18, space: 6 });

    lines.push({ divider: true });
    lines.push({ text: '今日轨迹', size: 18, bold: true, space: 4 });
    const journalLines = entries
      .filter((e) => e.type === 'journal')
      .map((e) => e.content);
    if (journalLines.length) {
      journalLines.forEach((j) => lines.push({ text: `· ${j}`, size: 16, space: 2 }));
    } else {
      lines.push({ text: '（还没写日记）', size: 16, space: 2 });
    }
  }

  lines.push({ divider: true });
  lines.push({ text: '明天，世界继续生长', size: 18, align: 'center', space: 6 });
  lines.push({ text: `行动勇者 · ${todayStr()}`, size: 16, align: 'center' });
  return lines;
}

export function reviewReceipt(input) {
  return renderReceipt(reviewLines(input));
}

// ===== 答案小票：贤者之书 =====
export function oracleLines({ question, answer }) {
  const lines = [
    { text: '🔮 贤者之书', size: 26, align: 'center', bold: true, space: 6 },
    { divider: true },
  ];
  if (question) {
    lines.push({ text: '你问', size: 16, align: 'center', space: 2 });
    lines.push({ text: `「${question}」`, size: 18, align: 'center', space: 6 });
    lines.push({ divider: true });
  }
  lines.push({ text: answer, size: 22, align: 'center', space: 8 });
  lines.push({ divider: true });
  lines.push({ text: `行动勇者 · ${todayStr()}`, size: 16, align: 'center' });
  return lines;
}

export function oracleReceipt(input) {
  return renderReceipt(oracleLines(input));
}
