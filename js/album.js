// ===== 小票册模块 =====
// 每次生成小票（无论现实是否打印成功）都会收进小票册。
// 存储：登录用户 → Supabase receipts 表（RLS：仅本人可读写）；游客 → localStorage。
// 查看：React Bits <Stack /> 同款交互 —— 堆叠扇形 + 拖动翻牌 + 点击查看详情。

import { getClient } from './supabase.js';
import { getCurrentUser } from './auth.js';
import { renderReceipt } from './receipt.js';
import * as printer from './printer.js';

const LS_KEY = 'album_receipts_v1';
const SENS = 70;      // 拖动翻牌阈值（px）
const MAX_STACK = 8;  // 堆叠最多渲染张数

// ---------- 存储 ----------
function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { console.warn('[album] 本地保存失败：', e); }
}

async function currentUserId() {
  try { const u = await getCurrentUser(); return u ? u.id : null; } catch { return null; }
}

// 存入小票册：登录用户入库 receipts（type='album'），游客存本地
export async function saveTicket({ kind, title, date, lines, meta }) {
  const entry = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: kind || 'review',
    title: title || '小票',
    date: date || '',
    lines: Array.isArray(lines) ? lines : [],
    meta: meta || {},
    createdAt: Date.now(),
  };
  const userId = await currentUserId();
  const sb = getClient();
  if (userId && sb) {
    try {
      const { data, error } = await sb
        .from('receipts')
        .insert({ user_id: userId, type: 'album', content: JSON.stringify(entry) })
        .select()
        .single();
      if (!error && data) {
        entry.id = data.id; // 已入库，改用数据库主键
        return entry;
      }
      console.warn('[album] 入库失败，降级本地：', error && error.message);
    } catch (e) { console.warn('[album] 入库异常，降级本地：', e); }
  }
  pushLocal(entry);
  return entry;
}

function pushLocal(entry) {
  const list = readLocal();
  list.unshift(entry);
  writeLocal(list);
}

export async function loadAlbum() {
  const userId = await currentUserId();
  const sb = getClient();
  if (userId && sb) {
    try {
      const { data, error } = await sb
        .from('receipts')
        .select('id, content, created_at')
        .eq('type', 'album')
        .order('created_at', { ascending: false })
        .limit(200);
      if (!error && data) {
        const list = [];
        for (const row of data) {
          try {
            const c = JSON.parse(row.content);
            list.push({ ...c, id: row.id, createdAt: Date.parse(row.created_at) || 0 });
          } catch { /* 跳过损坏条目 */ }
        }
        return list;
      }
      console.warn('[album] 读取云端失败，回退本地：', error && error.message);
    } catch (e) { console.warn('[album] 读取云端异常，回退本地：', e); }
  }
  return readLocal().sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteTicket(id) {
  const userId = await currentUserId();
  const sb = getClient();
  if (id && !String(id).startsWith('local_') && userId && sb) {
    try { await sb.from('receipts').delete().eq('id', id); return; } catch (e) { console.warn('[album] 删除云端失败：', e); }
  }
  writeLocal(readLocal().filter((e) => e.id !== id));
}

// 更新打印工坊入口的小票数量徽标
export async function updateAlbumBadge() {
  const list = await loadAlbum();
  const el = document.getElementById('albumCount');
  if (el) el.textContent = list.length ? `（${list.length}）` : '';
  return list;
}

// ---------- 堆叠视图 ----------
let cards = [];
let stackEl = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 同一份 lines 行数据 → 绘本风小票 HTML（与打印位图版式一致，画风统一）
function linesToHtml(lines) {
  return (lines || []).map((ln) => {
    if (ln.divider) return '<div class="r-div"><span>✦ ✦ ✦</span></div>';
    const cls = ['r-line'];
    if (ln.bold) cls.push('r-bold');
    if (ln.align === 'center') cls.push('r-center');
    if (ln.align === 'right') cls.push('r-right');
    cls.push(ln.size >= 24 ? 'r-lg' : ln.size >= 20 ? 'r-md' : 'r-sm');
    return `<div class="${cls.join(' ')}">${esc(ln.text)}</div>`;
  }).join('');
}

function receiptCardHtml(c) {
  const chip = c.date ? `<span class="album-chip">${esc(c.date)}</span>` : '';
  return `<span class="album-tape"></span><div class="album-receipt">${linesToHtml(c.lines)}</div>${chip}`;
}

export async function renderAlbumView() {
  cards = (await loadAlbum()).slice(0, MAX_STACK);
  stackEl = document.getElementById('albumStack');
  const emptyEl = document.getElementById('albumEmpty');
  const countEl = document.getElementById('albumCount');
  if (countEl) countEl.textContent = cards.length ? `（${cards.length}）` : '';
  if (!cards.length) {
    if (emptyEl) emptyEl.hidden = false;
    if (stackEl) stackEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  renderStack();
}

function renderStack() {
  if (!stackEl) return;
  stackEl.innerHTML = '';
  cards.forEach((c, i) => {
    const el = document.createElement('div');
    const n = cards.length;
    if (c.rot === undefined) c.rot = Math.random() * 10 - 5; // 每张卡固定一个随机倾角
    const rotateZ = (n - i - 1) * 4 + c.rot;
    const scale = 1 + i * 0.05 - n * 0.05;
    el.className = 'album-card' + (i === n - 1 ? ' top' : '');
    el.style.zIndex = i;
    el.style.setProperty('--rot', `${rotateZ}deg`);
    el.style.transform = `rotate(${rotateZ}deg) scale(${scale})`;
    el.innerHTML = receiptCardHtml(c);
    stackEl.appendChild(el);
    if (i === n - 1) bindTopCard(el, c);
  });
}

// 顶卡交互：拖动超过阈值 → 甩出并翻到最底下；轻点 → 打开详情
function bindTopCard(el, card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, moved = false, dragging = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; dx = 0; dy = 0; moved = false; dragging = true;
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    const rot = parseFloat(el.style.getPropertyValue('--rot')) + dx / 14;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }

    if (!moved) { openDetail(card); return; }

    if (Math.abs(dx) > SENS || Math.abs(dy) > SENS) {
      // 甩出 → 翻到最底下
      el.style.transition = 'transform .22s ease, opacity .22s ease';
      el.style.transform = `translate(${dx * 2}px, ${dy * 2}px) rotate(${dx / 8}deg)`;
      el.style.opacity = '0';
      setTimeout(() => {
        cards = cards.filter((x) => x.id !== card.id);
        cards.unshift(card);
        renderStack();
      }, 230);
    } else {
      // 未达阈值 → 回弹复位
      el.style.transition = 'transform .38s cubic-bezier(.22, 1.2, .36, 1)';
      renderStack();
    }
  }

  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}

// ---------- 详情弹层 ----------
function openModal(html) {
  const mask = document.getElementById('modalMask');
  document.getElementById('modalBody').innerHTML = html;
  mask.hidden = false;
}
function closeModal() {
  const mask = document.getElementById('modalMask');
  if (mask) mask.hidden = true;
  document.getElementById('modalBody').innerHTML = '';
}

function openDetail(card) {
  openModal(`
    <div class="album-detail">
      <div class="album-d-head"><span class="album-d-title">${esc(card.title)}</span><span class="album-d-date">${esc(card.date || '')}</span></div>
      <div class="album-receipt-lg">${linesToHtml(card.lines)}</div>
      <div class="album-d-actions">
        <button class="btn btn-primary" id="albumPrintBtn">🖨️ 打印</button>
        <button class="btn btn-secondary" id="albumDelBtn">🗑️ 删除</button>
      </div>
    </div>`);
  document.getElementById('albumPrintBtn').addEventListener('click', () => printEntry(card));
  document.getElementById('albumDelBtn').addEventListener('click', () => deleteEntry(card));
}

// 打印：支持蓝牙直连 → 直打；否则渲染图片 → 系统分享 / 新窗口保存
async function printEntry(card) {
  if (printer.isSupported() && printer.isConnected()) {
    try {
      await printer.printRaster(renderReceipt(card.lines));
      closeModal();
      return;
    } catch (err) { alert('打印失败：' + err.message); return; }
  }
  await shareTicket(card.lines, card.title || '行动勇者小票');
}

export async function shareTicket(lines, name) {
  try {
    const raster = renderReceipt(lines);
    const blob = await new Promise((r) => raster.ctx.canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('图片生成失败');
    const file = new File([blob], `行动勇者小票-${Date.now()}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name || '行动勇者 · 小票' });
    } else {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // 用户取消分享
    alert('生成图片失败：' + (err && err.message ? err.message : err));
  }
}

async function deleteEntry(card) {
  if (!confirm(`删除这张小票「${card.title}」？删除后无法恢复。`)) return;
  try { await deleteTicket(card.id); } catch (e) { alert('删除失败：' + e.message); return; }
  closeModal();
  await updateAlbumBadge();
  renderAlbumView();
}

// ---------- 初始化 ----------
export function initAlbum() {
  updateAlbumBadge(); // 入口徽标计数（静默更新）
}
