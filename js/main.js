import { initSupabase, isConfigured, getClient } from './supabase.js';
import { initAuth, onAuthChange, signOut } from './auth.js';
import * as printer from './printer.js';
import * as game from './game.js';
import * as chronicle from './chronicle.js';
import * as collection from './collection.js';
import { getTerritory, tierForStreak } from './territory.js';
import { getWorld, rolloverDay, SEASON_NAMES, SEASON_EMOJI, seasonForDay, daytimePhase } from './world.js';
import { getAIConfig, setAIConfig, hasAIKey } from './ai.js';
import { celebrateLines, reviewLines, renderReceipt } from './receipt.js';
import * as album from './album.js';
import { drawAnswer, askOracle } from './oracle.js';
import { spriteReply } from './companion.js';

// ===== 画布全屏贴合：400 × 880 设计稿 =====
// 主流全面屏手机（宽高比与设计稿 0.455 偏差 ≤4%）→ 覆盖填满整屏，裁剪 ≤2% 无感；
// 特殊比例（16:9 老机 / 平板 / 横屏 / 桌面）→ 完整显示，背景与应用同色，视觉无缝。
// 手机键盘弹起时绝不重算缩放（否则视觉视口变矮会把整个画布缩小）；
// 而是把画布上移，让底部（保存按钮等）始终露出在键盘上方，保证能正常输入和保存。
let phoneScale = 1;   // 当前缩放值（键盘弹起时保持不变）
let lastFit = { w: window.innerWidth, h: window.innerHeight, t: 0 };

function applyPhoneTransform() {
  const phone = document.getElementById('appView');
  if (!phone) return;
  // 手机端（窄屏）：全宽原生布局，不做 transform 缩放，键盘由浏览器原生滚动处理
  if (window.innerWidth <= 480) { phone.style.transform = 'none'; return; }
  // 可视高度（键盘弹起时 = 键盘上方的区域）
  const vv = window.visualViewport;
  const visualH = vv && vv.height ? vv.height : window.innerHeight;
  // 画布在布局视口里的垂直范围（translate(-50%,-50%) 居中）
  const canvasH = 880 * phoneScale;
  const top = (window.innerHeight - canvasH) / 2;
  const bottom = top + canvasH;
  // 底部超出可视区多少就上移多少（换算成画布坐标），保证按钮可点
  const lift = Math.max(0, bottom - visualH) / phoneScale;
  phone.style.transform = `translate(-50%, -50%) translateY(${-lift}px) scale(${phoneScale})`;
}

function fitPhone() {
  const phone = document.getElementById('appView');
  if (!phone) return;
  // 手机端（窄屏）：全宽原生布局，不做 transform 缩放
  if (window.innerWidth <= 480) { phone.style.transform = 'none'; return; }
  // 键盘弹起（iOS：视觉视口明显矮于布局视口；旧 Android：宽度不变、高度骤减）→ 不重算缩放
  const vv = window.visualViewport;
  const keyboardUp = !!vv && vv.height < window.innerHeight - 60;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const now = Date.now();
  const androidKeyboard = !keyboardUp && Math.abs(vw - lastFit.w) < 2 && lastFit.h - vh > 140 && now - lastFit.t > 400;
  if (!keyboardUp && !androidKeyboard) {
    lastFit = { w: vw, h: vh, t: now };
    const ratio = vw / vh;
    const coverable = ratio <= (400 / 880) * 1.04; // 0.455 × 1.04 ≈ 0.473
    phoneScale = coverable ? Math.max(vw / 400, vh / 880) : Math.min(vw / 400, vh / 880);
  }
  applyPhoneTransform(); // 无论是否重算缩放，都基于当前视口刷新上移量
}
window.addEventListener('resize', fitPhone);
window.addEventListener('orientationchange', () => setTimeout(fitPhone, 120));

// 键盘弹起/收起：只刷新上移量，绝不影响缩放，保证输入时画面不缩小、底部按钮可点
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', applyPhoneTransform);
}

// ===== 屏幕路由 =====
const screens = ['hub', 'plan', 'focus', 'print', 'album', 'worldmap', 'region', 'oracle', 'memory', 'shop', 'settings'];

function showScreen(name) {
  screens.forEach((s) => {
    const sec = document.getElementById(`screen-${s}`);
    if (sec) sec.hidden = s !== name;
  });
  // 切到对应屏幕时渲染动态内容
  if (name === 'plan') renderPlanView();
  if (name === 'memory') renderMemoryView();
  if (name === 'shop') renderShopView();
  if (name === 'settings') renderSettingsView();
  if (name === 'hub') renderHubStatus();
  if (name === 'focus') renderFocusView();
  if (name === 'print') { renderPrintView(); album.updateAlbumBadge(); }
  if (name === 'album') album.renderAlbumView();
  if (name === 'worldmap') renderWorldmapView();
  if (name === 'region') renderRegionView();
  if (name === 'oracle') renderOracleView();
}

function initRouter() {
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { showScreen(goto.dataset.goto); return; }
    const back = e.target.closest('[data-back]');
    if (back) { showScreen(back.dataset.back); }
  });
}

// ===== 全局绘本风弹层 =====
function openModal(html) {
  const mask = document.getElementById('modalMask');
  document.getElementById('modalBody').innerHTML = html;
  mask.hidden = false;
}
function closeModal() {
  document.getElementById('modalMask').hidden = true;
  document.getElementById('modalBody').innerHTML = '';
}
function initModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalMask').addEventListener('click', (e) => {
    if (e.target.id === 'modalMask') closeModal();
  });
}

// ===== 数据可用性 =====
function isGuest() {
  return document.getElementById('appView').dataset.guest === '1';
}

function offlineHint(text) {
  return `<div class="empty-state"><span>${text}</span>${isGuest() || !isConfigured() ? '<span>连接 Supabase 并登录后，这里会显示你的真实数据。</span>' : ''}</div>`;
}

// 汇总各屏需要的真实数据（profiles / world / territory / actions / collection / items）
async function fetchStats() {
  const stats = {
    profile: null, world: null, streak: 0,
    todayActions: [], collected: [], items: [],
    openTasks: [], chronicleCount: 0,
  };
  const jobs = [
    game.getProfile().then((d) => { stats.profile = d; }).catch(() => {}),
    game.getWorld().then((d) => { stats.world = d; }).catch(() => {}),
    getTerritory().then((d) => { stats.streak = d ? (d.streak || 0) : 0; }).catch(() => {}),
    chronicle.getTodayActions().then((d) => { stats.todayActions = d || []; }).catch(() => {}),
    collection.listCollection().then((d) => { stats.collected = d || []; }).catch(() => {}),
    collection.listItems().then((d) => { stats.items = d || []; }).catch(() => {}),
    game.listTasks().then((d) => { stats.openTasks = d || []; }).catch(() => {}),
    chronicle.countEntries().then((d) => { stats.chronicleCount = d || 0; }).catch(() => {}),
  ];
  await Promise.all(jobs);
  return stats;
}

// setLightBadge 已移除（侧边栏已取消，世界之光在状态栏直接展示）

// ===== 主基地：状态栏 + 地图标记（全部来自数据库） =====
async function renderHubStatus() {
  const stats = await fetchStats();
  const online = !isGuest() && isConfigured();

  // 勇者档案：profiles.username / level
  const nameEl = document.getElementById('heroName');
  const lvEl = document.getElementById('heroLevel');
  if (stats.profile) {
    nameEl.textContent = stats.profile.username || '勇者';
    lvEl.textContent = `Lv.${stats.profile.level ?? 1}`;
  } else {
    nameEl.textContent = '勇者';
    lvEl.textContent = online ? 'Lv.1' : '未连接';
  }

  // 世界状态：world.light / day_count
  const lightEl = document.getElementById('lightCount');
  const dayEl = document.getElementById('dayCount');
  lightEl.textContent = stats.world ? String(stats.world.light ?? 0) : '—';
  dayEl.textContent = stats.world ? `第 ${stats.world.day_count ?? 1} 天` : '—';

  // 地图标记副文本
  const planSub = document.getElementById('markerPlanSub');
  const memSub = document.getElementById('markerMemorySub');
  const shopSub = document.getElementById('markerShopSub');
  planSub.textContent = stats.openTasks.length > 0 ? `${stats.openTasks.length} 项待办` : '暂无待办';
  memSub.textContent = stats.chronicleCount > 0 ? `${stats.chronicleCount} 段回忆` : '时光相册';
  if (stats.items.length > 0) {
    shopSub.textContent = `${stats.collected.length} / ${stats.items.length}`;
  } else {
    shopSub.textContent = online ? '暂无图鉴' : '收集图鉴';
  }
}

// ===== 计划大厅：任务列表（tasks 表） =====
async function renderPlanView() {
  const sec = document.getElementById('planContent');
  let profile = null;
  try { profile = await game.getProfile(); } catch (e) { profile = null; }

  sec.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span class="section-title" style="font-size:13px;">任务清单</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="section-count">${profile ? `Lv.${profile.level} · 经验 ${profile.xp}` : ''}</span>
        <button class="btn btn-secondary btn-small" id="printTasksBtn">🖨 打印清单</button>
      </div>
    </div>
    <ul id="taskList" style="list-style:none;display:flex;flex-direction:column;gap:10px;"></ul>
  `;

  // 一键打印待办清单
  sec.querySelector('#printTasksBtn').addEventListener('click', () => printTaskList());

  const listEl = sec.querySelector('#taskList');
  let tasks = [];
  try { tasks = await game.listTasks(); } catch (err) { tasks = []; }

  if (tasks.length === 0) {
    listEl.innerHTML = offlineHint(isGuest() || !isConfigured()
      ? '还没有任务记录'
      : '任务清单是空的，添加一个开始今天的冒险吧');
  } else {
    listEl.innerHTML = tasks.map((t) => {
      const mult = t.type === 'boss' ? 2 : 1;
      const xp = game.xpForDifficulty(t.difficulty) * mult;
      const lt = game.lightForDifficulty(t.difficulty) * mult;
      return `
      <li class="task-card">
        <span class="task-check"></span>
        <span class="task-info">
          <span class="task-title">${t.type === 'boss' ? '⚔ ' : ''}${escapeHtml(t.title)}</span>
          <span class="task-meta">难度 ${t.difficulty} · ${game.difficultyLabel(t.difficulty)} · +${xp} 积分 · +${lt} 光</span>
        </span>
        <button class="btn btn-accept" data-id="${t.id}">完成</button>
      </li>`;
    }).join('');
  }

  // 添加任务（内联表单，替代 prompt）
  const addLi = document.createElement('li');
  addLi.innerHTML = `
    <button class="add-task-btn" id="addTaskBtn"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5V12.5M1.5 7H12.5" stroke="#855938" stroke-width="2" stroke-linecap="round"/></svg>添加新任务</button>
    <div class="add-task-form" id="addTaskForm" hidden>
      <input id="newTaskTitle" type="text" placeholder="任务：想完成什么？" maxlength="40">
      <div class="task-form-row">
        <select id="newTaskType" aria-label="任务类型">
          <option value="normal">普通任务</option>
          <option value="boss">⚔ Boss 战（奖励翻倍）</option>
        </select>
        <select id="newTaskDiff" aria-label="任务难度">
          <option value="1">难度 1 · 轻松</option>
          <option value="2">难度 2 · 日常</option>
          <option value="3" selected>难度 3 · 挑战</option>
          <option value="4">难度 4 · 困难</option>
          <option value="5">难度 5 · 史诗</option>
        </select>
      </div>
      <div class="diff-preview" id="diffPreview"></div>
      <div class="task-form-actions">
        <button class="btn btn-secondary btn-small" id="cancelAddTask">取消</button>
        <button class="btn btn-primary btn-small" id="confirmAddTask">添加到清单</button>
      </div>
    </div>`;
  listEl.appendChild(addLi);

  const addBtn = addLi.querySelector('#addTaskBtn');
  const addForm = addLi.querySelector('#addTaskForm');
  const titleInput = addLi.querySelector('#newTaskTitle');
  const typeSel = addLi.querySelector('#newTaskType');
  const diffSel = addLi.querySelector('#newTaskDiff');
  const diffPreview = addLi.querySelector('#diffPreview');

  // 系统自动判定难度：输入标题/切换类型时实时更新难度与预计积分预览
  function updateDiffPreview() {
    const d = game.estimateDifficulty(titleInput.value, typeSel.value);
    diffSel.value = String(d);
    const mult = typeSel.value === 'boss' ? 2 : 1;
    const xp = game.xpForDifficulty(d) * mult;
    const lt = game.lightForDifficulty(d) * mult;
    diffPreview.innerHTML = `系统判定：<b>难度 ${d} · ${game.difficultyLabel(d)}</b> · 预计 +${xp} 积分 · +${lt} 光${typeSel.value === 'boss' ? '（Boss 翻倍）' : ''}`;
  }
  titleInput.addEventListener('input', updateDiffPreview);
  typeSel.addEventListener('change', updateDiffPreview);
  updateDiffPreview();

  addBtn.addEventListener('click', () => {
    if (isGuest() || !isConfigured()) {
      alert('游客模式下无法保存任务，请先配置 Supabase 并登录。');
      return;
    }
    addBtn.hidden = true;
    addForm.hidden = false;
    titleInput.focus();
  });
  addLi.querySelector('#cancelAddTask').addEventListener('click', () => {
    addForm.hidden = true;
    addBtn.hidden = false;
  });
  addLi.querySelector('#confirmAddTask').addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const type = typeSel.value;
    const diff = Number(diffSel.value);
    const confirmBtn = addLi.querySelector('#confirmAddTask');
    confirmBtn.disabled = true;
    game.createTask(title, type, diff)
      .then(() => { renderPlanView(); renderHubStatus(); })
      .catch((err) => {
        if (/登录|过期|会话|session|unauthorized|invalid|auth/i.test(err.message)) {
          alert('登录已过期，正在返回登录页，请重新登录后再添加任务。');
          signOut();
        } else {
          alert('新建任务失败：' + err.message);
        }
        confirmBtn.disabled = false;
      });
  });
  // 完成任务：结算弹层
  listEl.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const task = tasks.find((t) => t.id === btn.dataset.id);
      if (!task) return;
      btn.disabled = true;
      try {
        const rewards = await game.completeTask(task);
        if (autoPrintOn()) {
          // 无论是否打印成功，庆祝小票先进小票册
          const lines = celebrateLines(rewards.taskTitle, rewards);
          try {
            await album.saveTicket({ kind: 'celebrate', title: rewards.isBoss ? 'Boss 战胜利' : '任务完成', date: chronicle.todayStr(), lines });
            album.updateAlbumBadge();
          } catch (e) { console.warn('小票存档失败（不影响任务记录）：', e); }
          if (printer.isConnected()) {
            try { await printer.printRaster(renderReceipt(lines)); } catch (perr) { console.error('打印失败（不影响任务记录）：', perr); }
          }
        }
        renderHubStatus();
        openModal(rewardModalHtml(rewards));
        const okBtn = document.getElementById('rewardOkBtn');
        if (okBtn) okBtn.addEventListener('click', () => { closeModal(); renderPlanView(); });
      } catch (err) {
        alert('完成任务失败：' + err.message);
        btn.disabled = false;
      }
    });
  });
}

// ===== 一键打印待办清单 =====
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function printTaskList() {
  let tasks = [];
  try { tasks = await game.listTasks(); } catch (e) { tasks = []; }
  if (tasks.length === 0) { alert('当前没有待办任务可打印'); return; }

  // 1) 小票册存档（与打印位图共用同一份 lines 数据）
  const lines = [
    { text: '📋 待办清单', size: 26, align: 'center', bold: true, space: 6 },
    { divider: true },
    { text: todayStr(), size: 16, align: 'center', space: 6 },
    { divider: true },
  ];
  tasks.forEach((t, i) => {
    const mult = t.type === 'boss' ? 2 : 1;
    const xp = game.xpForDifficulty(t.difficulty) * mult;
    const lt = game.lightForDifficulty(t.difficulty) * mult;
    lines.push({ text: `${i + 1}. ${t.title}${t.type === 'boss' ? ' ⚔' : ''}`, size: 18, space: 2 });
    lines.push({ text: `   难度${t.difficulty} · +${xp}积分 · +${lt}光`, size: 14, space: 4 });
  });
  lines.push({ divider: true });
  lines.push({ text: `共 ${tasks.length} 项待办 · 行动勇者`, size: 16, align: 'center' });
  try {
    await album.saveTicket({ kind: 'tasklist', title: '待办清单', date: todayStr(), lines });
    album.updateAlbumBadge();
  } catch (e) { console.warn('小票存档失败（不影响打印）：', e); }

  // 2) 蓝牙小票机直打（如已连接）
  if (printer.isConnected()) {
    try {
      const text = lines.map((l) => l.text || '').join('\n');
      await printer.printText(text);
    } catch (perr) { console.error('蓝牙打印失败（不影响其他）：', perr); }
  }

  // 3) 浏览器打印 / 另存 PDF（最通用，任意设备可用）
  printTaskChecklist(tasks);
}

function printTaskChecklist(tasks) {
  const rows = tasks.map((t, i) => {
    const mult = t.type === 'boss' ? 2 : 1;
    const xp = game.xpForDifficulty(t.difficulty) * mult;
    const lt = game.lightForDifficulty(t.difficulty) * mult;
    return `<li>
      <span class="chk"></span>
      <span class="t-num">${i + 1}.</span>
      <span class="t-title">${escapeHtml(t.title)}${t.type === 'boss' ? ' ⚔' : ''}</span>
      <span class="t-meta">难度${t.difficulty} · +${xp}积分 · +${lt}光</span>
    </li>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>待办清单</title><style>
    *{box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#3a2a18;padding:36px 32px;margin:0;}
    h1{font-size:22px;margin:0 0 4px;}
    .sub{color:#8a7a66;font-size:13px;margin-bottom:20px;}
    ul{list-style:none;padding:0;margin:0;}
    li{display:flex;align-items:baseline;gap:10px;padding:11px 0;border-bottom:1px dashed #d8c8b0;}
    .chk{display:inline-block;width:15px;height:15px;border:1.6px solid #855938;border-radius:3px;margin-right:2px;flex:0 0 auto;transform:translateY(2px);}
    .t-num{color:#855938;font-weight:700;min-width:22px;}
    .t-title{flex:1;font-size:15px;}
    .t-meta{font-size:12px;color:#8a7a66;white-space:nowrap;}
    .foot{margin-top:20px;font-size:12px;color:#a99a86;text-align:center;}
    .bar{margin-top:14px;}
    button{font-size:14px;padding:9px 16px;background:#6b4423;color:#fff;border:0;border-radius:8px;cursor:pointer;}
    @media print{.bar{display:none;}}
  </style></head><body>
    <h1>📋 待办清单</h1>
    <div class="sub">行动勇者 · ${todayStr()} · 共 ${tasks.length} 项</div>
    <ul>${rows}</ul>
    <div class="foot">—— 一件一件来，世界会慢慢变亮 ——</div>
    <div class="bar"><button onclick="window.print()">🖨 打印 / 另存为 PDF</button></div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了打印窗口，请允许弹窗后重试，或前往「打印工坊」查看小票册。'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 350);
}

// 任务结算弹层内容
function rewardModalHtml(rewards) {
  const star = '<svg width="26" height="25" viewBox="0 0 22 21" fill="none"><path d="M11 1.8L13.7 7.1L19.6 7.9L15.3 12L16.4 17.9L11 15L5.6 17.9L6.7 12L2.4 7.9L8.3 7.1Z" fill="#E6BF59" stroke="#C79933" stroke-width="0.6"/></svg>';
  const rows = [
    ['勇者经验', `+${rewards.xp} XP`],
    ['世界之光', `+${rewards.light}`],
    ['伙伴饱食', `+${rewards.feed}`],
  ];
  const rowsHtml = rows.map(([k, v]) => `<div class="reward-row"><span>${k}</span><b>${v}</b></div>`).join('');
  const dropHtml = rewards.drop ? `<div class="reward-row reward-drop"><span class="drop-emoji">${rewards.drop.emoji || '❓'}</span><span>获得藏品「${escapeHtml(rewards.drop.name)}」</span></div>` : '';
  const streakHtml = rewards.newStreak ? `<div class="reward-row"><span>连续行动</span><b>${rewards.newStreak} 天</b></div>` : '';
  return `
    <div class="reward-card">
      ${star}
      <div class="reward-title">${rewards.isBoss ? '⚔ Boss 战胜利！' : '🎉 任务完成！'}</div>
      <div class="reward-sub">「${escapeHtml(rewards.taskTitle)}」</div>
      <div class="reward-list">${rowsHtml}${dropHtml}${streakHtml}</div>
      <button class="btn btn-primary btn-block" id="rewardOkBtn">继续前进</button>
    </div>`;
}

// ===== 专注矿洞：今日行动统计（actions 表，当日聚合） =====
async function renderFocusView() {
  const el = {
    count: document.getElementById('statActionCount'),
    xp: document.getElementById('statTodayXp'),
    light: document.getElementById('statTodayLight'),
  };
  let actions = [];
  try { actions = await chronicle.getTodayActions(); } catch (e) { actions = []; }

  if (!isConfigured() || isGuest()) {
    el.count.innerHTML = '—<i>次</i>';
    el.xp.innerHTML = '—<i>XP</i>';
    el.light.innerHTML = '—<i>点</i>';
    return;
  }
  const xp = actions.reduce((a, x) => a + (x.xp || 0), 0);
  const light = actions.reduce((a, x) => a + (x.light || 0), 0);
  el.count.innerHTML = `${actions.length}<i>次</i>`;
  el.xp.innerHTML = `${xp}<i>XP</i>`;
  el.light.innerHTML = `+${light}<i>点</i>`;
}

// ===== 专注计时状态机（倒计时 / 正计时）=====
let focus = {
  mode: 'countdown',    // 'countdown' 倒计时 | 'countup' 正计时
  total: 25 * 60,       // 倒计时目标（秒）
  remaining: 25 * 60,   // 倒计时剩余（秒）= total - elapsed
  elapsed: 0,           // 累计专注秒数
  running: false,
  recorded: false,      // 本段是否已记录，防止重复结算
  interval: null,
};

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// 计时器显示的数值：倒计时看剩余，正计时看已用
function focusDisplaySeconds() {
  return focus.mode === 'countdown' ? focus.remaining : focus.elapsed;
}

function focusRender() {
  const timer = document.getElementById('focusTimer');
  const startBtn = document.getElementById('focusStartBtn');
  const resetBtn = document.getElementById('focusResetBtn');
  const label = document.getElementById('focusDurLabel');
  const hint = document.getElementById('focusHint');
  const goal = document.getElementById('focusGoal');
  const presetRow = document.getElementById('focusPreset');
  const customInput = document.getElementById('focusCustomMin');
  const modeRow = document.getElementById('focusMode');

  timer.textContent = fmtTime(focusDisplaySeconds());
  timer.classList.toggle('done', focus.mode === 'countdown' && focus.remaining === 0);

  if (modeRow) modeRow.querySelectorAll('.mode-chip').forEach((c) => c.classList.toggle('active', c.dataset.mode === focus.mode));
  // 预设/自定义仅在倒计时模式可用
  if (presetRow) presetRow.style.display = focus.mode === 'countdown' ? '' : 'none';
  if (focus.mode === 'countdown') {
    if (presetRow) presetRow.querySelectorAll('.preset-chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.min) * 60 === focus.total));
    if (customInput) customInput.value = Math.round(focus.total / 60);
    label.textContent = `${Math.round(focus.total / 60)} 分钟倒计时`;
  } else {
    label.textContent = `正计时 · 已专注 ${Math.floor(focus.elapsed / 60)} 分 ${focus.elapsed % 60} 秒`;
  }

  startBtn.textContent = (focus.mode === 'countdown' && focus.remaining === 0)
    ? '再来一次'
    : (focus.running
      ? '暂停'
      : (focus.mode === 'countup' ? '开始计时' : '开始专注'));
  resetBtn.hidden = !(focus.running || focus.elapsed > 0 || (focus.mode === 'countdown' && focus.remaining !== focus.total));
  resetBtn.textContent = focus.mode === 'countup' ? '结束并记录' : '重置';

  if (focus.running) {
    hint.textContent = goal.value.trim() ? `正在专注：「${goal.value.trim()}」` : '正在专注… 世界为你点亮了一盏灯';
  } else if (focus.mode === 'countdown' && focus.remaining === 0) {
    hint.textContent = '专注完成，世界更亮了一分 ✨';
  } else if (focus.elapsed > 0) {
    hint.textContent = focus.recorded ? '已记录这段专注 ✅' : '已暂停，休息一下也可以';
  } else {
    hint.textContent = focus.mode === 'countup' ? '点开始计时，专注多久都行（满 1 分钟才记录）' : '';
  }
}

function stopTimer() {
  if (focus.interval) { clearInterval(focus.interval); focus.interval = null; }
  focus.running = false;
}

function focusSetPreset(minutes) {
  stopTimer();
  focus.total = minutes * 60;
  focus.remaining = focus.total;
  focus.elapsed = 0;
  focus.recorded = false;
  focusRender();
}

function focusTick() {
  focus.elapsed += 1;
  if (focus.mode === 'countdown') {
    focus.remaining = focus.total - focus.elapsed;
    if (focus.remaining <= 0) {
      focus.remaining = 0;
      stopTimer();
      focusRender();
      endFocusSession('done');
      return;
    }
  }
  focusRender();
}

// 结束一段专注：满 1 分钟才记录到世界；不足则温柔提示不记录
async function endFocusSession(reason) {
  if (focus.recorded) return;
  focus.recorded = true;
  const goal = (document.getElementById('focusGoal') || {}).value?.trim() || '';

  if (focus.elapsed < 60) {
    openModal(`
      <div class="reward-card">
        <span style="font-size:40px;line-height:1;">⏱️</span>
        <div class="reward-title">专注了 ${focus.elapsed} 秒</div>
        <div class="reward-sub">满 1 分钟才会记录到世界哦，<br>再坚持一下下～</div>
        <button class="btn btn-primary btn-block" id="rewardOkBtn">好的</button>
      </div>`);
    const ok = document.getElementById('rewardOkBtn');
    if (ok) ok.addEventListener('click', closeModal);
    return;
  }

  const minutes = Math.floor(focus.elapsed / 60);
  if (isGuest() || !isConfigured()) {
    openModal(`
      <div class="reward-card">
        <span style="font-size:40px;line-height:1;">⏳</span>
        <div class="reward-title">专注完成！</div>
        <div class="reward-sub">专注了 ${minutes} 分钟。<br>游客模式下无法保存记录，登录后会自动写入世界。</div>
        <button class="btn btn-primary btn-block" id="rewardOkBtn">好的</button>
      </div>`);
    const ok = document.getElementById('rewardOkBtn');
    if (ok) ok.addEventListener('click', closeModal);
    return;
  }

  try {
    const rewards = await game.recordFocus(minutes, goal);
    openModal(rewardModalHtml({
      ...rewards,
      taskTitle: goal ? `专注「${goal}」` : `${minutes} 分钟专注`,
      isBoss: false,
      drop: null,
    }));
    const ok = document.getElementById('rewardOkBtn');
    if (ok) ok.addEventListener('click', () => { closeModal(); renderFocusView(); renderHubStatus(); });
  } catch (err) {
    alert('记录专注失败：' + err.message);
  }
}

function initFocusTimer() {
  const startBtn = document.getElementById('focusStartBtn');
  const resetBtn = document.getElementById('focusResetBtn');
  const presetRow = document.getElementById('focusPreset');
  const customInput = document.getElementById('focusCustomMin');
  const goal = document.getElementById('focusGoal');
  const modeRow = document.getElementById('focusMode');

  if (presetRow) {
    presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => { if (focus.running) stopTimer(); focusSetPreset(Number(chip.dataset.min)); });
    });
  }
  if (customInput) {
    customInput.addEventListener('change', () => {
      let m = parseInt(customInput.value, 10);
      if (isNaN(m) || m < 1) { m = 1; customInput.value = 1; }
      if (m > 600) { m = 600; customInput.value = 600; }
      if (focus.running) stopTimer();
      focusSetPreset(m);
    });
  }
  if (modeRow) {
    modeRow.querySelectorAll('.mode-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip.dataset.mode === focus.mode) return;
        if (focus.running) stopTimer();
        if (focus.elapsed > 0) endFocusSession('switch'); // 切换前先结算已专注时长（若≥1分钟）
        focus.mode = chip.dataset.mode;
        focus.elapsed = 0;
        focus.remaining = focus.total;
        focus.recorded = false;
        focusRender();
      });
    });
  }

  startBtn.addEventListener('click', () => {
    if (focus.mode === 'countdown' && focus.remaining === 0) {  // 再来一次
      focusSetPreset(Math.round(focus.total / 60));
      return;
    }
    if (focus.running) {                  // 暂停
      stopTimer();
      focusRender();
      return;
    }
    focus.running = true;                 // 开始 / 继续
    focus.interval = setInterval(focusTick, 1000);
    focusRender();
  });

  resetBtn.addEventListener('click', async () => {
    if (focus.running) stopTimer();
    if (focus.elapsed > 0) await endFocusSession(focus.mode === 'countup' ? 'end' : 'manual');
    focus.elapsed = 0;
    focus.remaining = focus.total;
    focus.recorded = false;
    focusRender();
  });

  goal.addEventListener('input', () => {
    if (goal.value.length > 40) goal.value = goal.value.slice(0, 40);
  });

  focusRender();
}

// ===== 打印工坊：世界之光 + 今日结算小票（world / actions 表） =====
async function renderPrintView() {
  const totalEl = document.getElementById('lightTotal');
  const barEl = document.getElementById('lightBar');
  const rowsEl = document.getElementById('ticketRows');

  let world = null, actions = [];
  try {
    world = await game.getWorld();
    actions = await chronicle.getTodayActions();
  } catch (e) { /* 保留占位 */ }

  if (world) {
    const light = world.light ?? 0;
    totalEl.textContent = `${light} 点`;
    barEl.style.width = `${light % 100}%`;
  } else {
    totalEl.textContent = '—';
    barEl.style.width = '0%';
  }

  if (!isConfigured() || isGuest()) {
    rowsEl.innerHTML = '<div class="ticket-row"><span>暂无数据</span><span>—</span></div>';
    return;
  }
  const xp = actions.reduce((a, x) => a + (x.xp || 0), 0);
  const light = actions.reduce((a, x) => a + (x.light || 0), 0);
  const drops = actions.filter((x) => x.drop_id).length;
  rowsEl.innerHTML = `
    <div class="ticket-row"><span>完成行动</span><span>${actions.length} 次</span></div>
    <div class="ticket-row"><span>获得经验</span><span>+${xp} XP</span></div>
    <div class="ticket-row"><span>世界之光</span><span>+${light} 点</span></div>
    <div class="ticket-row"><span>藏品掉落</span><span>${drops} 件</span></div>
  `;
}

// ===== 世界地图：区域解锁状态（territory.streak / collection 计算） =====
async function renderWorldmapView() {
  const listEl = document.getElementById('regionList');
  const stats = await fetchStats();
  const online = !isGuest() && isConfigured();

  if (!online) {
    listEl.innerHTML = offlineHint('世界地图尚未点亮');
    return;
  }

  const level = stats.profile ? stats.profile.level ?? 1 : 1;
  const streak = stats.streak;
  const collectedN = stats.collected.length;

  const regions = [
    {
      name: '迷雾森林', icon: 'icon-green',
      svg: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 18L8 8L14 13L18 4" stroke="#FCF7ED" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      open: true, sub: `Lv.${level} · 已解锁`, goto: 'region',
    },
    {
      name: '静谧湖畔', icon: 'icon-blue',
      svg: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 15C5 17 8 18 11 16C14 14 17 15 18 13V6C17 8 14 7 11 9C8 11 5 10 4 8V15Z" stroke="#B88C61" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      open: streak >= 3,
      sub: streak >= 3 ? '已解锁 · 连续行动达成' : `连续行动 3 天解锁（当前 ${streak} 天）`,
    },
    {
      name: '火焰山脉', icon: 'icon-orange',
      svg: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 3L17 19H5L11 3Z" stroke="#B88C61" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      open: collectedN >= 15,
      sub: collectedN >= 15 ? '已解锁 · 收藏达人' : `收集 15 件藏品解锁（当前 ${collectedN} 件）`,
    },
  ];

  listEl.style.display = 'flex';
  listEl.style.flexDirection = 'column';
  listEl.style.gap = '10px';
  listEl.innerHTML = regions.map((r) => r.open
    ? `<button class="region-card region-open" ${r.goto ? `data-goto="${r.goto}"` : 'disabled'}>
        <span class="region-icon ${r.icon}">${r.svg}</span>
        <span class="region-info"><span class="region-name">${r.name}</span><span class="region-sub">${r.sub}</span></span>
        <span class="region-arrow">›</span>
      </button>`
    : `<button class="region-card region-locked" disabled>
        <span class="region-icon ${r.icon}">${r.svg}</span>
        <span class="region-info"><span class="region-name">${r.name}</span><span class="region-sub">${r.sub}</span></span>
        <span class="lock">🔒</span>
      </button>`
  ).join('');
}

// ===== 区域详情：挑战进度（全部由真实数据计算） =====
async function renderRegionView() {
  const box = document.getElementById('regionChallenges');
  const levelEl = document.getElementById('regionLevel');
  const stats = await fetchStats();
  const online = !isGuest() && isConfigured();

  levelEl.textContent = stats.profile ? `Lv.${stats.profile.level ?? 1}` : 'Lv.1';

  if (!online) {
    box.innerHTML = offlineHint('挑战进度尚未点亮');
    return;
  }

  const challenges = [
    {
      name: '连续行动', cur: stats.streak, goal: 7, unit: '天',
      icon: 'icon-green-slime', fill: 'fill-green',
      svg: '<svg width="22" height="16" viewBox="0 0 22 16" fill="none"><ellipse cx="11" cy="10" rx="9" ry="5.5" fill="#FCF7ED"/><circle cx="8" cy="9" r="1.4" fill="#739E61"/><circle cx="14" cy="9" r="1.4" fill="#739E61"/></svg>',
    },
    {
      name: '收集藏品', cur: stats.collected.length, goal: 15, unit: '件',
      icon: 'icon-blue-crystal', fill: 'fill-blue',
      svg: '<svg width="20" height="22" viewBox="0 0 20 22" fill="none"><path d="M10 2L17 11L10 20L3 11Z" fill="#FCF7ED"/></svg>',
    },
    {
      name: '今日行动', cur: stats.todayActions.length, goal: 3, unit: '次',
      icon: 'icon-gold-star', fill: 'fill-gold',
      svg: '<svg width="22" height="21" viewBox="0 0 22 21" fill="none"><path d="M11 1.8L13.7 7.1L19.6 7.9L15.3 12L16.4 17.9L11 15L5.6 17.9L6.7 12L2.4 7.9L8.3 7.1Z" fill="#FCF7ED"/></svg>',
    },
  ];

  box.innerHTML = challenges.map((c) => {
    const pct = Math.min(100, Math.round((c.cur / c.goal) * 100));
    const done = c.cur >= c.goal;
    return `
      <div class="challenge-card ${done ? 'challenge-done' : ''}">
        <span class="challenge-icon ${c.icon}">${c.svg}</span>
        <span class="challenge-info">
          <span class="challenge-name ${done ? 'challenge-complete' : ''}">${c.name}</span>
          <span class="challenge-count ${done ? 'done' : ''}">${c.cur} / ${c.goal} ${c.unit}${done ? ' 已完成' : ''}</span>
        </span>
        <div class="bar bar-track"><div class="bar-fill ${c.fill}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  // 进入探索：基于真实数据的探索发现弹层
  document.querySelector('.btn-explore').addEventListener('click', () => {
    if (!online) {
      openModal(`
        <div class="explore-card">
          <span class="explore-emoji">🌲</span>
          <div class="explore-title">探索发现</div>
          <div class="explore-desc">登录后，探索迷雾森林会基于你的真实行动点亮这片区域。</div>
          <button class="btn btn-primary btn-block" id="rewardOkBtn">好的</button>
        </div>`);
      document.getElementById('rewardOkBtn').addEventListener('click', closeModal);
      return;
    }
    const doneCount = challenges.filter((c) => c.cur >= c.goal).length;
    const rows = [
      ['今日行动', `${stats.todayActions.length} 次`],
      ['连续行动', `${stats.streak} 天`],
      ['已收集藏品', `${stats.collected.length} 件`],
      ['区域挑战', `${doneCount} / ${challenges.length} 完成`],
    ];
    openModal(`
      <div class="explore-card">
        <span class="explore-emoji">🌲</span>
        <div class="explore-title">探索发现 · 迷雾森林</div>
        <div class="explore-desc">林间小径上，世界记住了你的每一次行动。</div>
        <div class="explore-list">
          ${rows.map(([k, v]) => `<div class="explore-row"><span>${k}</span><b>${v}</b></div>`).join('')}
        </div>
        <div class="explore-actions">
          <button class="btn btn-secondary" id="exploreFocusBtn">去专注</button>
          <button class="btn btn-primary" id="explorePlanBtn">去接任务</button>
        </div>
      </div>`);
    document.getElementById('exploreFocusBtn').addEventListener('click', () => { closeModal(); showScreen('focus'); });
    document.getElementById('explorePlanBtn').addEventListener('click', () => { closeModal(); showScreen('plan'); });
  });
}

// ===== 答案之书：今日启示（oracle.js 翻页逻辑） =====
function renderOracleView() {
  const countEl = document.getElementById('oracleCount');
  const pages = Number(localStorage.getItem('oraclePages') || 0);
  countEl.textContent = pages > 0 ? `已翻开 ${pages} 页` : '尚未翻开';
}

function initOracle() {
  const btn = document.getElementById('oracleBtn');
  const answerEl = document.getElementById('oracleAnswer');
  const hint = document.getElementById('oracleHint');
  const questionEl = document.getElementById('oracleQuestion');
  const countEl = document.getElementById('oracleCount');

  btn.addEventListener('click', async () => {
    const question = questionEl.value.trim();
    btn.disabled = true;
    try {
      let answer;
      if (question && !isGuest() && isConfigured()) {
        const res = await askOracle(question);   // 登录 + 有提问：求签记录进编年史
        answer = res.answer;
      } else {
        answer = await drawAnswer();             // 游客或未提问：仅翻页
        if (question) {
          try { await chronicle.addEntry('oracle', answer, { question }); } catch (e) { /* 游客忽略 */ }
        }
      }
      answerEl.textContent = answer;
      hint.textContent = question ? '答案已封存进世界编年史。' : '轻轻翻开，答案已浮现。';
      const pages = Number(localStorage.getItem('oraclePages') || 0) + 1;
      localStorage.setItem('oraclePages', String(pages));
      countEl.textContent = `已翻开 ${pages} 页`;
    } catch (err) {
      answerEl.textContent = '此刻，答案在你心中。';
      hint.textContent = err.message || '';
    } finally {
      btn.disabled = false;
    }
  });

  questionEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}


// ===== 神奇精灵：实时对话 / 秘密日记（异步回信） =====
// 精灵对话已迁移为书架上的「精灵密信」书（见 openSpriteBook / renderDiaryView 的 isSprite 分支）。

// ===== 回忆小屋：主视图（成长日记）+ 书架 + 翻书 + 里程碑 =====
// 数据模型：主视图展示「我的日记」默认书的最新一篇（富排版）；书架每本书（books 表）→ 点开 → 一页页翻（chronicle.book_id）
const MEM_TYPE_NAMES = { journal: '日记', review: '复盘', conversation: '精灵对话', action: '行动', oracle: '求签', secret: '密信' };
const MEM_SPRITE_BOOK_TITLE = '精灵密信';
const MEM_MEMORY_VIEWS = ['memoryHomeView', 'memoryShelfView'];
const DIARY_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

let memState = {
  book: null,            // 当前打开的书（对象）
  entries: [],           // 当前书全部条目（按 created_at 升序）
  spread: 0,             // 当前展开：0 表示"打开即见 entry[0]"（左封面 + 右 entry[0]）
  writeType: 'journal',  // 新页类型
  from: 'shelf',         // 打开书的来路：home | shelf（关闭书时回去）
  isSprite: false,       // 当前书是否为「精灵密信」
  editingId: null,       // 正在修改的条目 id（null = 新建）
};

// 精灵延时回信的定时器（离开精灵书时清空）
let spriteTimers = [];

let diaryState = {
  cat: '',               // 当前分类筛选（'' = 全部）
  list: [],              // 筛选后的条目
  idx: 0,                // 当前展示第几篇
};

// 把 ISO 时间格式化为「2026-08-20 21:57」
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 精灵回信的随机延时：1 分钟 ~ 5 小时
function randomReplyDelayMs() {
  const min = 60 * 1000;
  const max = 5 * 60 * 60 * 1000;
  return Math.floor(min + Math.random() * (max - min));
}

function switchMemoryView(id) {
  MEM_MEMORY_VIEWS.forEach((v) => {
    const el = document.getElementById(v);
    if (el) el.hidden = v !== id;
  });
}

async function renderMemoryView() {
  // 每次进入回忆小屋：默认显示书架
  showShelf();
}

// ---------- 主视图：成长日记 / 精灵密信 ----------
async function renderDiaryView() {
  switchMemoryView('memoryHomeView');

  const pageEl = document.getElementById('diaryPage');
  const countEl = document.getElementById('diaryCount');
  const online = !isGuest() && isConfigured();
  if (!online) {
    countEl.textContent = '游客模式';
    pageEl.innerHTML = offlineHint('登录后，把今天写进你的成长日记');
    document.getElementById('diaryIndicator').textContent = '0 / 0';
    document.getElementById('diaryPrev').disabled = true;
    document.getElementById('diaryNext').disabled = true;
    return;
  }

  // 没有当前书则兜底用默认书
  if (!memState.book || !memState.entries) {
    try {
      memState.book = await chronicle.ensureDefaultBook();
      memState.entries = await chronicle.getBookEntries(memState.book.id);
    } catch (e) {
      countEl.textContent = '';
      pageEl.innerHTML = offlineHint('打开日记失败，请稍后再试');
      return;
    }
  }

  const isSprite = memState.isSprite;

  // 精灵密信：先让到点的回信“寄到”，再重新拉取并安排后续回信定时器
  if (isSprite) {
    await revealPendingReplies(memState.book.id);
    memState.entries = await chronicle.getBookEntries(memState.book.id);
    scheduleSpriteReveals();
  }

  // 标题、删除按钮
  document.getElementById('memoryBookTitle').textContent = memState.book.title || '我的日记';
  document.getElementById('deleteBookBtn').style.display = (memState.book.title === '我的日记') ? 'none' : '';

  // 精灵书不显示分类筛选；写作按钮改为“给精灵写封信”
  document.getElementById('diaryTabs').style.display = isSprite ? 'none' : '';
  const writeBtn = document.getElementById('diaryWriteBtn');
  writeBtn.style.display = '';
  writeBtn.innerHTML = isSprite
    ? '✉ 给精灵写封信'
    : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 12C2 12 2.8 10.3 3.2 9.9L9.9 3.2L10.8 4.1L4.1 10.8C3.7 11.2 2 12 2 12Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg> 写下今天的故事';
  document.getElementById('bookWriteType').textContent = (isSprite ? '密信 · ' : '日记 · ') + (memState.book.title || '');

  // 列表准备：普通日记按分类筛选；精灵书直接用全部条目（来信 + 回信）
  if (!isSprite) {
    diaryState.cat = '';
    document.querySelectorAll('#diaryTabs .diary-tab').forEach((b) => {
      b.classList.toggle('active', !b.dataset.cat);
    });
    applyDiaryFilter();
  } else {
    diaryState.cat = '';
    diaryState.list = memState.entries;
  }
  // 默认展示最新一篇
  diaryState.idx = Math.max(0, diaryState.list.length - 1);
  renderDiaryPage();
}

function applyDiaryFilter() {
  diaryState.list = diaryState.cat
    ? memState.entries.filter((e) => ((e.meta && e.meta.category) || '') === diaryState.cat)
    : memState.entries;
  diaryState.idx = Math.max(0, diaryState.list.length - 1);
}

function diaryDateTitle(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${DIARY_WEEKDAYS[d.getDay()]}`;
}

function renderDiaryPage() {
  const pageEl = document.getElementById('diaryPage');
  const indicatorEl = document.getElementById('diaryIndicator');
  const countEl = document.getElementById('diaryCount');
  const total = diaryState.list.length;

  countEl.textContent = total > 0 ? `共 ${memState.entries.length} 篇` : '';
  indicatorEl.textContent = total > 0 ? `第 ${diaryState.idx + 1} 篇 / 共 ${total} 篇` : '0 / 0';
  document.getElementById('diaryPrev').disabled = diaryState.idx <= 0;
  document.getElementById('diaryNext').disabled = diaryState.idx >= total - 1;

  if (total === 0) {
    pageEl.innerHTML = memState.isSprite
      ? `<div class="diary-empty">还没有写给精灵的信<br><span>点下方「给精灵写封信」，和它说说话吧</span></div>`
      : (diaryState.cat
        ? `<div class="diary-empty">「${escapeHtml(diaryState.cat)}」分类下还没有日记</div>`
        : `<div class="diary-empty">日记还是空白的<br><span>写下第一篇，开始你的故事</span></div>`);
    return;
  }

  const e = diaryState.list[diaryState.idx];
  const meta = e.meta || {};
  const cat = meta.category || '';
  const mood = meta.mood || '';
  const writeTime = fmtDateTime(meta.written_at || e.created_at);
  const editTime = meta.edited_at ? fmtDateTime(meta.edited_at) : '';

  if (memState.isSprite) {
    const isReply = (meta.role || 'user') === 'sprite';
    const pending = meta.pending && meta.reply_at && new Date(meta.reply_at).getTime() > Date.now();
    let statusLine = isReply ? `精灵于 ${writeTime} 回复` : `写于 ${writeTime}`;
    if (!isReply && meta.pending && meta.reply_at) {
      if (pending) statusLine += ` · 精灵正在读信，预计 ${fmtDateTime(meta.reply_at)} 回复`;
    }
    pageEl.innerHTML = `
      <div class="diary-page-head">
        <span class="diary-page-date">${isReply ? '精灵的回信' : '你写给精灵的信'}</span>
        <span class="diary-page-type">${isReply ? '回信' : '来信'}</span>
      </div>
      <div class="diary-page-divider"><i></i><b></b><i></i></div>
      <div class="diary-page-text">${escapeHtml((e.content || '').slice(0, 800))}</div>
      <div class="diary-page-divider diary-page-divider-end"><i></i><b></b><i></i></div>
      <div class="diary-page-time">${escapeHtml(statusLine)}</div>
      <div class="diary-page-actions">
        <button class="diary-act diary-act-danger" id="diaryDeleteBtn">删除</button>
      </div>
    `;
  } else {
    const typeName = MEM_TYPE_NAMES[e.type] || '记录';
    pageEl.innerHTML = `
      <div class="diary-page-head">
        <span class="diary-page-date">${escapeHtml(diaryDateTitle(e.date))}</span>
        <span class="diary-page-type">${escapeHtml(typeName)}</span>
      </div>
      <div class="diary-page-divider"><i></i><b></b><i></i></div>
      ${(cat || mood) ? `
      <div class="diary-page-meta">
        ${cat ? `<span class="diary-tag">${escapeHtml(cat)}</span>` : ''}
        ${mood ? `<span class="mood-chip active">${escapeHtml(mood)}</span>` : ''}
      </div>` : ''}
      <div class="diary-page-text">${escapeHtml((e.content || '').slice(0, 500))}</div>
      <div class="diary-page-divider diary-page-divider-end"><i></i><b></b><i></i></div>
      <div class="diary-page-time">写于 ${escapeHtml(writeTime)}${editTime ? ` · 修改于 ${escapeHtml(editTime)}` : ''}</div>
      <div class="diary-page-actions">
        <button class="diary-act" id="diaryEditBtn">修改</button>
        <button class="diary-act diary-act-danger" id="diaryDeleteBtn">删除</button>
      </div>
    `;
  }

  // 绑定本页操作按钮（每次重渲染后重新绑定）
  const delBtn = document.getElementById('diaryDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => deleteCurrentDiary());
  const editBtn = document.getElementById('diaryEditBtn');
  if (editBtn) editBtn.addEventListener('click', () => editCurrentDiary());
}

function turnDiary(dir) {
  const total = diaryState.list.length;
  if (total === 0) return;
  const next = diaryState.idx + dir;
  if (next < 0 || next > total - 1) return;
  const pageEl = document.getElementById('diaryPage');
  pageEl.classList.remove('diary-flip-next', 'diary-flip-prev');
  void pageEl.offsetWidth;
  pageEl.classList.add(dir > 0 ? 'diary-flip-next' : 'diary-flip-prev');
  diaryState.idx = next;
  setTimeout(() => renderDiaryPage(), 180);
}

// 写日记：打开默认书 + 弹出写作区
async function writeNewDiary() {
  if (isGuest() || !isConfigured()) {
    alert('登录后才能写日记。');
    return;
  }
  try {
    const book = await chronicle.ensureDefaultBook();
    memState.from = 'home';
    await openBook(book.id);
    openWriteForm();
  } catch (e) {
    alert('打开日记失败：' + e.message);
  }
}

// 在已打开的书里写新页（若有当前书则直接写，否则打开默认书）
async function startWrite() {
  if (isGuest() || !isConfigured()) {
    alert('登录后才能写日记。');
    return;
  }
  if (!memState.book) { await writeNewDiary(); return; }
  openWriteForm();
}

// ---------- 书架 ----------
async function showShelf() {
  switchMemoryView('memoryShelfView');

  const shelf = document.getElementById('bookShelf');
  const countEl = document.getElementById('shelfCount');

  const online = !isGuest() && isConfigured();
  if (!online) {
    shelf.innerHTML = '';
    countEl.textContent = '游客模式';
    return;
  }

  let books = [];
  try {
    books = await chronicle.listBooks();
    // 首次进入若没书，触发 ensureDefaultBook 创建「我的日记」
    if (books.length === 0) {
      await chronicle.ensureDefaultBook();
      books = await chronicle.listBooks();
    }
  } catch (e) {
    countEl.textContent = '';
    shelf.innerHTML = offlineHint('打开书架失败，请稍后再试');
    return;
  }

  countEl.textContent = books.length > 0 ? `共 ${books.length} 本` : '';

  if (books.length === 0) {
    shelf.innerHTML = '';
    return;
  }

  shelf.innerHTML = books.map((b) => `
    <div class="book-spine" style="background:${escapeHtml(b.cover_color || '#6B4423')}" data-book-id="${escapeHtml(b.id)}" role="button" tabindex="0">
      <div class="book-spine-band"></div>
      <div class="book-spine-title">${escapeHtml(b.title || '未命名')}</div>
      <div class="book-spine-pages">${b.page_count || 0} 页</div>
    </div>
  `).join('');

  // 绑定：点书脊 → 打开
  shelf.querySelectorAll('.book-spine').forEach((el) => {
    el.addEventListener('click', () => { memState.from = 'shelf'; openBook(el.dataset.bookId); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); memState.from = 'shelf'; openBook(el.dataset.bookId); }
    });
  });
}

// ---------- 找精灵聊聊：作为书架上一本「精灵密信」 ----------
async function openSpriteBook() {
  if (isGuest() || !isConfigured()) {
    alert('登录后才能和精灵聊天。');
    return;
  }
  try {
    const book = await chronicle.getOrCreateBookByTitle('精灵密信', {
      cover_color: '#3E6E8A',
      description: '写给精灵的悄悄话与回信',
    });
    memState.from = 'shelf';
    await openBook(book.id);
  } catch (e) {
    alert('打开精灵密信失败：' + e.message);
  }
}

// 把到点的回信“寄到”：对每封待回信且已到点的来信，生成回信条目并清除 pending
async function revealPendingReplies(bookId) {
  const entries = await chronicle.getBookEntries(bookId);
  const now = Date.now();
  for (const letter of entries) {
    const m = letter.meta || {};
    if (m.pending && m.pending_reply && m.reply_at && new Date(m.reply_at).getTime() <= now) {
      try {
        await chronicle.addEntry('secret', m.pending_reply, {
          role: 'sprite',
          written_at: m.reply_at,
          in_reply_to: letter.id,
        }, bookId);
        const newMeta = { ...m, pending: false };
        delete newMeta.pending_reply;
        await chronicle.updateEntry(letter.id, { meta: newMeta });
      } catch (e) { /* 忽略单条失败，继续 */ }
    }
  }
}

// 为当前精灵书里尚未到点的来信安排“寄到”定时器
function scheduleSpriteReveals() {
  spriteTimers.forEach((t) => clearTimeout(t));
  spriteTimers = [];
  if (!memState.isSprite || !memState.book) return;
  const now = Date.now();
  for (const letter of memState.entries) {
    const m = letter.meta || {};
    if (m.pending && m.reply_at) {
      const delay = Math.max(1000, new Date(m.reply_at).getTime() - now);
      const t = setTimeout(async () => {
        if (!memState.isSprite || !memState.book) return;
        await revealPendingReplies(memState.book.id);
        memState.entries = await chronicle.getBookEntries(memState.book.id);
        diaryState.list = memState.entries;
        renderDiaryPage();
      }, delay);
      spriteTimers.push(t);
    }
  }
}

// 发送一封写给精灵的信（精灵稍后延时回信）
async function sendSpriteLetter(content) {
  const now = new Date();
  const replyAt = new Date(now.getTime() + randomReplyDelayMs());
  const reply = await spriteReply(`（写给精灵的信）${content}`);
  await chronicle.addEntry('secret', content, {
    role: 'user',
    written_at: now.toISOString(),
    reply_at: replyAt.toISOString(),
    pending: true,
    pending_reply: reply,
  }, memState.book.id);
}

// ---------- 日记：修改 / 删除 ----------
function editCurrentDiary() {
  const e = diaryState.list[diaryState.idx];
  if (!e) return;
  openWriteForm(e);
}

async function deleteCurrentDiary() {
  const e = diaryState.list[diaryState.idx];
  if (!e) return;
  const label = memState.isSprite ? '这封与精灵的对话' : '这一篇日记';
  if (!confirm(`确定删除${label}吗？此操作不可撤销。`)) return;
  try {
    await chronicle.deleteEntry(e.id);
    memState.entries = await chronicle.getBookEntries(memState.book.id);
    if (!memState.isSprite) {
      diaryState.cat = '';
      document.querySelectorAll('#diaryTabs .diary-tab').forEach((b) => b.classList.toggle('active', !b.dataset.cat));
      applyDiaryFilter();
    } else {
      diaryState.list = memState.entries;
    }
    diaryState.idx = Math.min(diaryState.idx, Math.max(0, diaryState.list.length - 1));
    renderDiaryPage();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

// ---------- 打开书 ----------
async function openBook(bookId) {
  if (isGuest() || !isConfigured()) {
    alert('登录后才能翻阅书页哦。');
    return;
  }
  try {
    const books = await chronicle.listBooks();
    const book = books.find((b) => b.id === bookId);
    if (!book) { await showShelf(); return; }

    memState.book = book;
    memState.entries = await chronicle.getBookEntries(bookId);
    memState.writeType = (book.title === MEM_SPRITE_BOOK_TITLE) ? 'secret' : 'journal';
    memState.isSprite = (book.title === MEM_SPRITE_BOOK_TITLE);
    memState.editingId = null;

    document.getElementById('bookWrite').hidden = true;
    document.getElementById('bookWriteText').value = '';
    document.getElementById('bookWriteCount').textContent = '0 / 500';

    await renderDiaryView();
  } catch (e) {
    alert('打开书失败：' + e.message);
  }
}

function closeBook() {
  spriteTimers.forEach((t) => clearTimeout(t));
  spriteTimers = [];
  memState.book = null;
  memState.entries = [];
  memState.spread = 0;
  memState.isSprite = false;
  memState.editingId = null;
  document.getElementById('bookWrite').hidden = true;
  showShelf();
}

async function deleteCurrentBook() {
  if (!memState.book) return;
  if (memState.book.title === '我的日记') {
    alert('「我的日记」是默认书，不能删除。');
    return;
  }
  if (!confirm(`确定删除「${memState.book.title}」吗？书内所有页面都会消失。`)) return;
  try {
    await chronicle.deleteBook(memState.book.id);
    closeBook();
  } catch (e) {
    alert('删除失败：' + e.message);
  }
}

// ---------- 新建书（弹窗：书名 + 封面色）----------
const NEW_BOOK_COLORS = ['#6B4423', '#9C7B2E', '#4A6E3A', '#3E6E8A', '#7A3535', '#6E4B6E', '#9E5A2E', '#2E5E5A'];

function openNewBookModal() {
  if (isGuest() || !isConfigured()) {
    alert('登录后才能新建书本。');
    return;
  }
  let pickedColor = NEW_BOOK_COLORS[0];

  openModal(`
    <div class="newbook-header">
      <div class="newbook-header-title">新建一本</div>
      <div class="newbook-header-sub">为不同主题开一本书</div>
    </div>
    <div class="newbook-preview">
      <div class="newbook-preview-spine" id="newbookPreviewSpine" style="background:${pickedColor}">
        <div class="book-spine-band"></div>
        <div class="newbook-preview-title" id="newbookPreviewTitle">书名</div>
        <div class="book-spine-pages">0 页</div>
      </div>
    </div>
    <label class="newbook-label">书名</label>
    <input id="newbookTitle" class="newbook-input" maxlength="20" placeholder="例如：旅行日志">
    <label class="newbook-label">简介（可选）</label>
    <input id="newbookDesc" class="newbook-input" maxlength="40" placeholder="一句话说说这本书">
    <label class="newbook-label">封面色</label>
    <div class="newbook-colors" id="newbookColor">
      ${NEW_BOOK_COLORS.map((c, i) => `<button data-color="${c}" class="${i === 0 ? 'active' : ''}" style="background:${c}" aria-label="封面色"></button>`).join('')}
    </div>
    <div class="newbook-actions">
      <button class="btn btn-secondary btn-small" id="newbookCancel">取消</button>
      <button class="btn btn-primary btn-small" id="newbookSave">创建</button>
    </div>
  `);

  const colorRow = document.getElementById('newbookColor');
  const previewSpine = document.getElementById('newbookPreviewSpine');
  const titleInput = document.getElementById('newbookTitle');
  const previewTitle = document.getElementById('newbookPreviewTitle');

  colorRow.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    colorRow.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    pickedColor = b.dataset.color;
    previewSpine.style.background = pickedColor;
  });
  titleInput.addEventListener('input', () => {
    previewTitle.textContent = titleInput.value.trim() || '书名';
  });
  document.getElementById('newbookCancel').addEventListener('click', closeModal);
  document.getElementById('newbookSave').addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const description = document.getElementById('newbookDesc').value.trim();
    try {
      const book = await chronicle.createBook({ title, cover_color: pickedColor, description });
      closeModal();
      await showShelf();
      openBook(book.id);
    } catch (err) {
      alert('创建失败：' + err.message);
    }
  });
  setTimeout(() => titleInput.focus(), 50);
}

// ---------- 写新页 / 修改 ----------
function openWriteForm(prefillEntry = null) {
  if (isGuest() || !isConfigured()) {
    alert('登录后才能写下这一页。');
    return;
  }
  if (!memState.book) return;
  const form = document.getElementById('bookWrite');
  const typeEl = document.getElementById('bookWriteType');
  const textEl = document.getElementById('bookWriteText');
  const isSecret = memState.writeType === 'secret' || memState.isSprite;

  document.getElementById('bookWriteControls').style.display = isSecret ? 'none' : '';

  if (prefillEntry) {
    // 修改模式：预填原文与分类/心情
    memState.editingId = prefillEntry.id;
    typeEl.textContent = '修改这一页';
    textEl.value = prefillEntry.content || '';
    document.getElementById('bookWriteCount').textContent = `${textEl.value.length} / 500`;
    if (!isSecret) {
      const m = prefillEntry.meta || {};
      document.querySelectorAll('#bookWriteCat .diary-tab').forEach((b) => b.classList.toggle('active', b.dataset.cat === (m.category || '')));
      document.querySelectorAll('#bookWriteMood .mood-chip').forEach((b) => b.classList.toggle('active', b.dataset.mood === (m.mood || '')));
    }
  } else {
    // 新建模式
    memState.editingId = null;
    typeEl.textContent = (isSecret ? '密信 · ' : '日记 · ') + (memState.book.title || '');
    textEl.value = '';
    document.getElementById('bookWriteCount').textContent = '0 / 500';
    if (!isSecret) {
      document.querySelectorAll('#bookWriteCat .diary-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('#bookWriteMood .mood-chip').forEach((b) => b.classList.remove('active'));
    }
  }

  textEl.placeholder = isSecret ? '把想对精灵说的话写下来，它会读完后回信…' : '今天发生了什么？写进这一页…';
  form.hidden = false;
  textEl.focus();
}

function closeWriteForm() {
  document.getElementById('bookWrite').hidden = true;
  document.getElementById('bookWriteText').value = '';
  document.getElementById('bookWriteCount').textContent = '0 / 500';
}

async function saveWriteForm() {
  if (!memState.book) return;
  const text = document.getElementById('bookWriteText');
  const content = text.value.trim();
  if (!content) { text.focus(); return; }
  const saveBtn = document.getElementById('bookWriteSave');
  saveBtn.disabled = true;
  try {
    if (memState.editingId) {
      // 修改：保留原 meta（含 written_at），追加 edited_at
      const e = diaryState.list[diaryState.idx];
      const meta = { ...(e.meta || {}) };
      if (!memState.isSprite) {
        const catBtn = document.querySelector('#bookWriteCat .diary-tab.active');
        const moodBtn = document.querySelector('#bookWriteMood .mood-chip.active');
        if (catBtn) meta.category = catBtn.dataset.cat; else delete meta.category;
        if (moodBtn) meta.mood = moodBtn.dataset.mood; else delete meta.mood;
      }
      meta.edited_at = new Date().toISOString();
      await chronicle.updateEntry(memState.editingId, { content, meta });
    } else if (memState.isSprite) {
      // 写给精灵 → 延时回信
      await sendSpriteLetter(content);
    } else {
      // 新建日记：读取分类 + 心情（单选，可不选）
      const catBtn = document.querySelector('#bookWriteCat .diary-tab.active');
      const moodBtn = document.querySelector('#bookWriteMood .mood-chip.active');
      const meta = {};
      if (catBtn) meta.category = catBtn.dataset.cat;
      if (moodBtn) meta.mood = moodBtn.dataset.mood;
      await chronicle.addEntry(memState.writeType, content, meta, memState.book.id);
    }

    closeWriteForm();
    // 重新拉数据并跳到最新一篇
    memState.entries = await chronicle.getBookEntries(memState.book.id);
    if (!memState.isSprite) {
      diaryState.cat = '';
      document.querySelectorAll('#diaryTabs .diary-tab').forEach((b) => b.classList.toggle('active', !b.dataset.cat));
      applyDiaryFilter();
    } else {
      diaryState.list = memState.entries;
    }
    diaryState.idx = Math.max(0, diaryState.list.length - 1);
    renderDiaryPage();

    // 精灵书：安排后续回信“寄到”定时器
    if (memState.isSprite) scheduleSpriteReveals();
  } catch (err) {
    alert('保存失败：' + err.message);
  } finally {
    saveBtn.disabled = false;
  }
}

// ---------- 初始化绑定（页面加载时执行一次）----------
function initMemory() {
  document.getElementById('newBookBtn').addEventListener('click', openNewBookModal);
  document.getElementById('spriteEntryBtn').addEventListener('click', openSpriteBook);
  document.getElementById('closeBookBtn').addEventListener('click', closeBook);
  document.getElementById('deleteBookBtn').addEventListener('click', deleteCurrentBook);
  document.getElementById('bookWriteCancel').addEventListener('click', closeWriteForm);
  document.getElementById('bookWriteSave').addEventListener('click', saveWriteForm);

  // 日记：写、翻页、分类 tab
  document.getElementById('diaryWriteBtn').addEventListener('click', startWrite);
  document.getElementById('diaryPrev').addEventListener('click', () => turnDiary(-1));
  document.getElementById('diaryNext').addEventListener('click', () => turnDiary(1));
  document.getElementById('diaryTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.diary-tab'); if (!b) return;
    document.querySelectorAll('#diaryTabs .diary-tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    diaryState.cat = b.dataset.cat || '';
    applyDiaryFilter();
    renderDiaryPage();
  });

  // 写作区：分类 / 心情 单选（再点一次取消）
  document.getElementById('bookWriteCat').addEventListener('click', (e) => {
    const b = e.target.closest('.diary-tab'); if (!b) return;
    const was = b.classList.contains('active');
    document.querySelectorAll('#bookWriteCat .diary-tab').forEach((x) => x.classList.remove('active'));
    if (!was) b.classList.add('active');
  });
  document.getElementById('bookWriteMood').addEventListener('click', (e) => {
    const b = e.target.closest('.mood-chip'); if (!b) return;
    const was = b.classList.contains('active');
    document.querySelectorAll('#bookWriteMood .mood-chip').forEach((x) => x.classList.remove('active'));
    if (!was) b.classList.add('active');
  });

  // 字符计数 + 限长
  const text = document.getElementById('bookWriteText');
  const count = document.getElementById('bookWriteCount');
  text.addEventListener('input', () => {
    if (text.value.length > 500) text.value = text.value.slice(0, 500);
    count.textContent = `${text.value.length} / 500`;
  });

  // 键盘翻页
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('memoryHomeView').hidden) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); turnDiary(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); turnDiary(1); }
    if (e.key === 'Escape')     { e.preventDefault(); closeBook(); }
  });
}

// ===== 收集小铺：收集橱窗（items / collection 表，稀有度筛选） =====
let shopRarity = '';   // '' = 全部

async function renderShopView() {
  const grid = document.getElementById('collectGrid');
  const countEl = document.getElementById('shopCount');
  const progressText = document.getElementById('shopProgressText');
  const progressFill = document.getElementById('shopProgressFill');
  const filterRow = document.getElementById('shopFilter');

  let items = [], collected = [];
  try {
    items = await collection.listItems();
    collected = await collection.listCollection();
  } catch (e) { items = []; }

  if (!isConfigured() || isGuest()) {
    grid.innerHTML = offlineHint('图鉴还没有点亮');
    countEl.textContent = '';
    filterRow.hidden = true;
    progressText.textContent = '—';
    progressFill.style.width = '0%';
    return;
  }

  if (items.length === 0) {
    grid.innerHTML = offlineHint('数据库中还没有藏品目录，请先在 Supabase 的 items 表中添加藏品');
    countEl.textContent = '';
    filterRow.hidden = true;
    progressText.textContent = '0 / 0';
    progressFill.style.width = '0%';
    return;
  }

  const got = collected.length;
  countEl.textContent = `已收集 ${got} / ${items.length}`;
  progressText.textContent = `${got} / ${items.length}`;
  progressFill.style.width = `${Math.min(100, Math.round((got / items.length) * 100))}%`;
  filterRow.hidden = false;

  // 稀有度筛选
  filterRow.querySelectorAll('.filter-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.rarity === shopRarity);
  });
  const shown = shopRarity ? items.filter((it) => it.rarity === shopRarity) : items;

  if (shown.length === 0) {
    grid.innerHTML = offlineHint('这个稀有度还没有藏品，继续行动让它掉落吧');
    return;
  }

  grid.innerHTML = shown.map((it) => {
    const has = collected.some((c) => c.item_id === it.id);
    return `
      <div class="collect-card ${has ? '' : 'locked'}">
        <span class="collect-icon" style="background:${has ? 'var(--gold)' : 'var(--cream-dark)'}">${has ? (it.emoji || '❓') : '🔒'}</span>
        <span class="collect-name">${has ? escapeHtml(it.name || '藏品') : '未解锁'}</span>
        <span class="collect-state">${has ? '已获得' : '未解锁'}</span>
      </div>`;
  }).join('');
}

function initShopFilter() {
  document.getElementById('shopFilter').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    shopRarity = chip.dataset.rarity || '';
    renderShopView();
  });
}

// ===== 更多 · 设置（勇者档案 + AI 配置 + 打印 + 退出） =====
async function renderSettingsView() {
  const sec = document.getElementById('settingsContent');
  const ai = getAIConfig();
  const online = !isGuest() && isConfigured();

  // 真实档案数据
  let profile = null, territory = null, world = null;
  try { profile = await game.getProfile(); } catch (e) { profile = null; }
  try { territory = await getTerritory(); } catch (e) { territory = null; }
  try { world = await game.getWorld(); } catch (e) { world = null; }

  const level = profile ? (profile.level ?? 1) : 1;
  const xp = profile ? (profile.xp ?? 0) : 0;
  const xpInLevel = xp % 100;
  const streak = territory ? (territory.streak || 0) : 0;
  const tier = territory ? tierForStreak(streak) : null;
  const dayCount = world ? (world.day_count ?? 1) : 1;
  const season = world && world.season ? world.season : seasonForDay(dayCount);
  const username = (profile && profile.username) ? profile.username : '勇者';

  const heroCard = online && profile ? `
    <div class="profile-card">
      <div class="avatar"><img src="assets/images/hero-avatar.png" alt="勇者头像"></div>
      <div>
        <div class="profile-name">${escapeHtml(username)}</div>
        <div class="profile-level">Lv.${level} · ${tier ? tier.name + ' ' + tier.emoji : '勇者'}</div>
      </div>
      <div class="profile-xp">
        <div class="profile-xp-head"><span>经验 ${xp} / 距离升级还差 ${100 - xpInLevel}</span><b>Lv.${level}</b></div>
        <div class="bar bar-track"><div class="bar-fill fill-gold" style="width:${Math.min(100, Math.round((xpInLevel / 100) * 100))}%"></div></div>
      </div>
      <div class="profile-tags">
        <span class="profile-tag">🔥 连续行动 ${streak} 天</span>
        <span class="profile-tag">🌍 第 ${dayCount} 天 · ${SEASON_NAMES[season] || ''}${SEASON_EMOJI[season] || ''}</span>
        <span class="profile-tag">🌙 ${daytimePhase()}</span>
      </div>
      <div class="rename-row">
        <input id="renameInput" placeholder="修改昵称" maxlength="12" value="${escapeHtml(username)}">
        <button class="btn btn-secondary btn-small" id="renameBtn">改名</button>
      </div>
    </div>
  ` : offlineHint('登录后这里会显示你的勇者档案');

  sec.innerHTML = `
    ${heroCard}

    <div class="card">
      <h2 class="section-title" style="font-size:13px;margin-bottom:10px;">游戏设置</h2>
      <label class="switch-row">
        <span>完成任务后自动打印小票</span>
        <input type="checkbox" id="autoPrintSwitch" ${autoPrintOn() ? 'checked' : ''}>
      </label>
    </div>

    <div class="card">
      <h2 class="section-title" style="font-size:13px;margin-bottom:10px;">AI 配置（可选）</h2>
      <p class="log" style="text-align:left;">不填也能用。填入后世界会更懂你。</p>
      <label for="aiKey">API Key</label>
      <input id="aiKey" type="password" placeholder="sk-..." value="${escapeHtml(ai.apiKey)}">
      <label for="aiBaseURL">Base URL</label>
      <input id="aiBaseURL" type="text" placeholder="https://api.deepseek.com" value="${escapeHtml(ai.baseURL)}">
      <label for="aiModel">Model</label>
      <input id="aiModel" type="text" placeholder="deepseek-chat" value="${escapeHtml(ai.model)}">
      <button id="aiSaveBtn" class="btn btn-primary btn-block">保存 AI 配置</button>
      <p id="aiStatus" class="log"></p>
    </div>

    <button id="signOutBtn" class="btn btn-secondary btn-block">退出登录</button>
  `;

  // 改名
  const renameInput = sec.querySelector('#renameInput');
  if (renameInput) {
    const renameBtn = sec.querySelector('#renameBtn');
    renameBtn.addEventListener('click', async () => {
      const name = renameInput.value.trim();
      if (!name) { renameInput.focus(); return; }
      renameBtn.disabled = true;
      try {
        const sb = getClient();
        const { data: { user } } = await sb.auth.getUser();
        await sb.from('profiles').update({ username: name }).eq('id', user.id);
        renderHubStatus();
        renderSettingsView();
      } catch (err) {
        alert('改名失败：' + err.message);
        renameBtn.disabled = false;
      }
    });
  }

  sec.querySelector('#autoPrintSwitch').addEventListener('change', (e) => {
    localStorage.setItem('autoPrint', e.target.checked ? 'on' : 'off');
  });

  sec.querySelector('#aiSaveBtn').addEventListener('click', () => {
    const apiKey = sec.querySelector('#aiKey').value.trim();
    const baseURL = sec.querySelector('#aiBaseURL').value.trim();
    const model = sec.querySelector('#aiModel').value.trim();
    setAIConfig({ apiKey, baseURL, model });
    const status = sec.querySelector('#aiStatus');
    status.textContent = hasAIKey() ? 'AI 已配置' : '已保存（未填 key）';
    status.className = 'log success';
  });

  sec.querySelector('#signOutBtn').addEventListener('click', () => {
    if (isGuest()) {
      document.getElementById('appView').dataset.guest = '';
      document.getElementById('authView').hidden = false;
      document.getElementById('appView').hidden = true;
      return;
    }
    signOut();
  });
}

// ===== 打印机 =====
function initPrinter() {
  const btn = document.getElementById('printerBtn');
  const stateEl = document.getElementById('printerState');

  function renderState() {
    if (printer.isConnected()) {
      stateEl.textContent = printer.getDeviceName();
    } else {
      stateEl.textContent = '连接打印机';
    }
  }

  btn.addEventListener('click', async () => {
    if (!printer.isSupported()) return; // 降级模式：按钮已禁用
    if (printer.isConnected()) {
      printer.disconnect();
      return;
    }
    try { await printer.connect(); } catch (err) { alert('连接失败：' + err.message); }
  });

  printer.onConnect(renderState);
  printer.onDisconnect(renderState);
  renderState();

  // 打印今日小票：无论打印是否成功，先存档进小票册
  document.getElementById('printTicketBtn').addEventListener('click', async () => {
    const actions = await chronicle.getTodayActions();
    const entries = await chronicle.getTodayEntries();
    const date = chronicle.todayStr();
    const lines = reviewLines({ date, actions, entries });
    try {
      await album.saveTicket({ kind: 'review', title: '今日复盘', date, lines });
      album.updateAlbumBadge();
    } catch (e) { console.warn('小票存档失败：', e); }
    if (!printer.isSupported()) {
      await album.shareTicket(lines, '行动勇者 · 今日小票');
      return;
    }
    if (!printer.isConnected()) {
      alert('打印机未连接，小票已存入小票册，可随时从小票册查看或打印');
      return;
    }
    try {
      await printer.printRaster(renderReceipt(lines));
    } catch (err) {
      alert('打印失败：' + err.message + '（小票已存入小票册）');
    }
  });

  // 不支持蓝牙：切换为「生成小票图片」降级模式
  if (!printer.isSupported()) {
    btn.disabled = true;
    btn.classList.add('disabled');
    stateEl.textContent = '此设备不支持蓝牙';
    const tip = document.getElementById('printFallbackTip');
    if (tip) tip.hidden = false;
    const ticketBtn = document.getElementById('printTicketBtn');
    if (ticketBtn) ticketBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="6" rx="1.5" stroke="#FCF7ED" stroke-width="1.6"/><rect x="4.5" y="1.5" width="7" height="4" rx="1" stroke="#FCF7ED" stroke-width="1.6"/><rect x="4.5" y="9.5" width="7" height="4.5" rx="1" stroke="#FCF7ED" stroke-width="1.6"/></svg>生成小票图片';
  }
}

// 自动打印开关（存 localStorage，默认开）
function autoPrintOn() {
  return localStorage.getItem('autoPrint') !== 'off';
}

// ===== 登录态 =====
function initAuthUI() {
  const authView = document.getElementById('authView');
  const appView = document.getElementById('appView');

  onAuthChange(async (user) => {
    if (user) {
      authView.hidden = true;
      appView.hidden = false;
      fitPhone();
      maybeRolloverDay();
      showScreen('hub');
    } else if (!appView.dataset.guest) {
      authView.hidden = false;
      appView.hidden = true;
      document.getElementById('authMsg').textContent = '';
    }
  });
}

// 世界天数随现实推进（每天一次，localStorage 防重复）
async function maybeRolloverDay() {
  if (isGuest() || !isConfigured()) return;
  const today = chronicle.todayStr();
  if (localStorage.getItem('lastRolloverDate') === today) return;
  try {
    await rolloverDay();
  } catch (e) {
    console.warn('世界天数推进失败（不影响使用）：', e);
  }
  localStorage.setItem('lastRolloverDate', today);
}

// ===== 启动 =====
function boot() {
  fitPhone();
  initRouter();
  initPrinter();
  album.initAlbum();
  initModal();
  initFocusTimer();
  initMemory();
  initShopFilter();
  initOracle();

  const authMsg = document.getElementById('authMsg');
  if (!isConfigured()) {
    // 未配置 Supabase：提供游客模式，可直接浏览绘本世界
    authMsg.textContent = '未配置 Supabase，可先以游客身份浏览世界（数据不可保存）';
    authMsg.className = 'log';
    const guestBtn = document.createElement('button');
    guestBtn.className = 'btn btn-secondary btn-block';
    guestBtn.textContent = '先去逛逛（游客模式）';
    guestBtn.addEventListener('click', () => {
      document.getElementById('authView').hidden = true;
      const appView = document.getElementById('appView');
      appView.hidden = false;
      appView.dataset.guest = '1';
      showScreen('hub');
    });
    const form = document.getElementById('authForm');
    form.parentNode.insertBefore(guestBtn, form.nextSibling);
    document.getElementById('authSubmit').disabled = true;
    return;
  }

  initSupabase();
  initAuth();          // 内部 onAuthStateChange 会自动恢复登录态
  initAuthUI();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

boot();
