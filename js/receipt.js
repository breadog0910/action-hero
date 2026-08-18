// ===== 小票渲染模块 =====
// 把结构化内容渲染成 384 点宽的黑白位图，供 printer.printRaster 打印

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
export function celebrateReceipt(taskTitle, rewards) {
  return renderReceipt([
    { text: '🎉 任务完成！', size: 26, align: 'center', bold: true, space: 6 },
    { divider: true },
    { text: `「${taskTitle}」`, size: 22, align: 'center', space: 6 },
    { divider: true },
    { text: `勇者  +${rewards.xp} XP`, size: 20, space: 2 },
    { text: `世界之光  +${rewards.light}`, size: 20, space: 2 },
    { text: `伙伴饱食  +${rewards.feed}`, size: 20, space: 6 },
    { divider: true },
    { text: '继续前进，勇者！', size: 20, align: 'center', space: 6 },
    { text: `行动勇者 · ${todayStr()}`, size: 16, align: 'center' },
  ]);
}
