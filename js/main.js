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
import { talk as talkSprite } from './companion.js';

// ===== 画布全屏贴合：400 × 880 设计稿 =====
// 主流全面屏手机（宽高比与设计稿 0.455 偏差 ≤4%）→ 覆盖填满整屏，裁剪 ≤2% 无感；
// 特殊比例（16:9 老机 / 平板 / 横屏 / 桌面）→ 完整显示，背景与应用同色，视觉无缝。
function fitPhone() {
  const phone = document.getElementById('appView');
  if (!phone) return;
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const ratio = vw / vh;
  const coverable = ratio <= (400 / 880) * 1.04; // 0.455 × 1.04 ≈ 0.473
  const scale = coverable ? Math.max(vw / 400, vh / 880) : Math.min(vw / 400, vh / 880);
  phone.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
window.addEventListener('resize', fitPhone);
window.addEventListener('orientationchange', () => setTimeout(fitPhone, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitPhone);

// ===== 屏幕路由 =====
const screens = ['hub', 'plan', 'focus', 'print', 'album', 'worldmap', 'region', 'oracle', 'memory', 'shop', 'honor', 'settings'];

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
  if (name === 'honor') renderHonorView();
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
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;">
      <span class="section-title" style="font-size:13px;">任务清单</span>
      <span class="section-count">${profile ? `Lv.${profile.level} · 经验 ${profile.xp}` : ''}</span>
    </div>
    <ul id="taskList" style="list-style:none;display:flex;flex-direction:column;gap:10px;"></ul>
  `;

  const listEl = sec.querySelector('#taskList');
  let tasks = [];
  try { tasks = await game.listTasks(); } catch (err) { tasks = []; }

  if (tasks.length === 0) {
    listEl.innerHTML = offlineHint(isGuest() || !isConfigured()
      ? '还没有任务记录'
      : '任务清单是空的，添加一个开始今天的冒险吧');
  } else {
    listEl.innerHTML = tasks.map((t) => `
      <li class="task-card">
        <span class="task-check"></span>
        <span class="task-info">
          <span class="task-title">${t.type === 'boss' ? '⚔ ' : ''}${escapeHtml(t.title)}</span>
          <span class="task-meta">难度 ${t.difficulty} · +${game.xpForDifficulty(t.difficulty) * (t.type === 'boss' ? 2 : 1)} XP · +${game.lightForDifficulty(t.difficulty) * (t.type === 'boss' ? 2 : 1)} 光</span>
        </span>
        <button class="btn btn-accept" data-id="${t.id}">完成</button>
      </li>
    `).join('');
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
      <div class="task-form-actions">
        <button class="btn btn-secondary btn-small" id="cancelAddTask">取消</button>
        <button class="btn btn-primary btn-small" id="confirmAddTask">添加到清单</button>
      </div>
    </div>`;
  listEl.appendChild(addLi);

  const addBtn = addLi.querySelector('#addTaskBtn');
  const addForm = addLi.querySelector('#addTaskForm');
  addBtn.addEventListener('click', () => {
    if (isGuest() || !isConfigured()) {
      alert('游客模式下无法保存任务，请先配置 Supabase 并登录。');
      return;
    }
    addBtn.hidden = true;
    addForm.hidden = false;
    addLi.querySelector('#newTaskTitle').focus();
  });
  addLi.querySelector('#cancelAddTask').addEventListener('click', () => {
    addForm.hidden = true;
    addBtn.hidden = false;
  });
  addLi.querySelector('#confirmAddTask').addEventListener('click', () => {
    const title = addLi.querySelector('#newTaskTitle').value.trim();
    if (!title) { addLi.querySelector('#newTaskTitle').focus(); return; }
    const type = addLi.querySelector('#newTaskType').value;
    const diff = Number(addLi.querySelector('#newTaskDiff').value);
    const confirmBtn = addLi.querySelector('#confirmAddTask');
    confirmBtn.disabled = true;
    game.createTask(title, type, diff)
      .then(() => { renderPlanView(); renderHubStatus(); })
      .catch((err) => { alert('新建任务失败：' + err.message); confirmBtn.disabled = false; });
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

// ===== 番茄钟状态机 =====
let focus = {
  total: 25 * 60,      // 选定时长（秒）
  remaining: 25 * 60,  // 剩余（秒）
  running: false,
  interval: null,
};

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function focusRender() {
  const timer = document.getElementById('focusTimer');
  const startBtn = document.getElementById('focusStartBtn');
  const resetBtn = document.getElementById('focusResetBtn');
  const label = document.getElementById('focusDurLabel');
  const hint = document.getElementById('focusHint');
  const goal = document.getElementById('focusGoal');
  const presetRow = document.getElementById('focusPreset');

  timer.textContent = fmtTime(focus.remaining);
  timer.classList.toggle('done', focus.remaining === 0);
  label.textContent = `${Math.round(focus.total / 60)} 分钟`;
  startBtn.textContent = focus.remaining === 0 ? '再来一次' : (focus.running ? '暂停' : '开始专注');
  resetBtn.hidden = !(focus.running || focus.remaining !== focus.total);

  presetRow.querySelectorAll('.preset-chip').forEach((c) => {
    c.classList.toggle('active', Number(c.dataset.min) * 60 === focus.total);
  });

  if (focus.running) {
    hint.textContent = goal.value.trim() ? `正在专注：「${goal.value.trim()}」` : '正在专注… 世界为你点亮了一盏灯';
  } else if (focus.remaining === 0) {
    hint.textContent = '专注完成，世界更亮了一分 ✨';
  } else if (focus.remaining !== focus.total) {
    hint.textContent = '已暂停，休息一下也可以';
  } else {
    hint.textContent = '';
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
  focusRender();
}

function focusTick() {
  focus.remaining -= 1;
  if (focus.remaining <= 0) {
    focus.remaining = 0;
    stopTimer();
    focusRender();
    onFocusDone();
    return;
  }
  focusRender();
}

// 专注结束：游客提示 / 登录后写入真实数据
async function onFocusDone() {
  const minutes = Math.round(focus.total / 60);
  const goal = document.getElementById('focusGoal').value.trim();

  if (isGuest() || !isConfigured()) {
    openModal(`
      <div class="reward-card">
        <span style="font-size:40px;line-height:1;">⏳</span>
        <div class="reward-title">专注完成！</div>
        <div class="reward-sub">完成了 ${minutes} 分钟专注时光。<br>游客模式下无法保存记录，登录后会自动写入世界。</div>
        <button class="btn btn-primary btn-block" id="rewardOkBtn">好的</button>
      </div>`);
    document.getElementById('rewardOkBtn').addEventListener('click', closeModal);
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
    document.getElementById('rewardOkBtn').addEventListener('click', () => { closeModal(); renderFocusView(); renderHubStatus(); });
  } catch (err) {
    alert('记录专注失败：' + err.message);
  }
}

function initFocusTimer() {
  const startBtn = document.getElementById('focusStartBtn');
  const resetBtn = document.getElementById('focusResetBtn');
  const presetRow = document.getElementById('focusPreset');
  const goal = document.getElementById('focusGoal');

  presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (focus.running) stopTimer();
      focusSetPreset(Number(chip.dataset.min));
    });
  });

  startBtn.addEventListener('click', () => {
    if (focus.remaining === 0) {          // 再来一次
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

  resetBtn.addEventListener('click', () => {
    focusSetPreset(Math.round(focus.total / 60));
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

// ===== 荣耀碑：世界足迹（全部由真实数据计算） =====
async function renderHonorView() {
  const listEl = document.getElementById('honorList');
  const countEl = document.getElementById('honorCount');
  const online = !isGuest() && isConfigured();

  if (!online) {
    countEl.textContent = '';
    listEl.innerHTML = offlineHint('登录后，这里会刻下你的每一段足迹');
    return;
  }

  const stats = await fetchStats();

  // 额外查询：总行动数 / 累计专注次数
  let actionTotal = 0, focusTotal = 0;
  try {
    const sb = getClient();
    const [{ count: a }, { count: f }] = await Promise.all([
      sb.from('actions').select('id', { count: 'exact', head: true }),
      sb.from('chronicle').select('id', { count: 'exact', head: true }).filter('meta->>focus', 'eq', 'true'),
    ]);
    actionTotal = a || 0;
    focusTotal = f || 0;
  } catch (e) { /* 保留占位 */ }

  const streak = stats.streak;
  const collected = stats.collected.length;
  const light = stats.world ? (stats.world.light ?? 0) : 0;
  const day = stats.world ? (stats.world.day_count ?? 1) : 1;

  const honors = [
    { icon: '🏁', name: '序章完成', desc: '完成第一次行动，踏上勇者之路', cur: actionTotal, goal: 1, unit: '次' },
    { icon: '🔥', name: '周计划达人', desc: '连续 7 天完成行动', cur: streak, goal: 7, unit: '天' },
    { icon: '⏳', name: '专注大师', desc: '累计 3 次专注时光', cur: focusTotal, goal: 3, unit: '次' },
    { icon: '📚', name: '收藏家', desc: '收集 15 件藏品', cur: collected, goal: 15, unit: '件' },
    { icon: '✨', name: '世界之光', desc: '让世界之光达到 100 点', cur: light, goal: 100, unit: '点' },
    { icon: '🗺️', name: '远行者', desc: '在世界中度过第 7 天', cur: day, goal: 7, unit: '天' },
  ];

  const earned = honors.filter((h) => h.cur >= h.goal).length;
  countEl.textContent = `已完成 ${earned} / ${honors.length} 项荣耀`;
  listEl.innerHTML = honors.map((h) => {
    const done = h.cur >= h.goal;
    const pct = Math.min(100, Math.round((h.cur / h.goal) * 100));
    return `
      <div class="honor-card ${done ? 'earned' : ''}">
        <span class="honor-icon">${h.icon}</span>
        <span class="honor-info">
          <span class="honor-name">${h.name}</span>
          <span class="honor-desc">${h.desc}</span>
        </span>
        <span class="honor-badge">${done ? '✓ 已达成' : `${h.cur} / ${h.goal} ${h.unit}`}</span>
        <div class="bar bar-track honor-progress"><div class="bar-fill ${done ? 'fill-gold' : 'fill-blue'}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

// ===== 神奇精灵：实时对话 / 秘密日记（异步回信） =====
let spriteMode = 'chat';   // chat | secret

function initSpriteChat() {
  document.getElementById('entryJournal').addEventListener('click', () => {
    if (isGuest() || !isConfigured()) {
      alert('游客模式下无法写日记，登录后即可把今天写进世界。');
      return;
    }
    const form = document.getElementById('journalForm');
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById('journalText').focus();
  });

  document.getElementById('entrySprite').addEventListener('click', openSpritePanel);
}

function openSpritePanel() {
  const online = !isGuest() && isConfigured();
  openModal(`
    <div class="sprite-head">
      <span class="sprite-avatar">🧚</span>
      <div>
        <div class="sprite-title">神奇精灵</div>
        <div class="sprite-sub">住在回忆小屋里的伙伴 · ${online ? '会读你的秘密，也会陪你聊天' : '登录后它才会醒来'}</div>
      </div>
    </div>
    <div class="tab-row">
      <button class="tab-chip active" id="tabChat">实时对话</button>
      <button class="tab-chip" id="tabSecret">秘密日记</button>
    </div>
    <div id="spriteBody"></div>
  `);
  document.getElementById('tabChat').addEventListener('click', () => { spriteMode = 'chat'; renderSpritePanel(); });
  document.getElementById('tabSecret').addEventListener('click', () => { spriteMode = 'secret'; renderSpritePanel(); });
  renderSpritePanel();
}

function renderSpritePanel() {
  const body = document.getElementById('spriteBody');
  if (spriteMode === 'chat') {
    body.innerHTML = `
      <div class="chat-box" id="chatBox"></div>
      <div class="chat-input-row">
        <input id="chatInput" type="text" placeholder="想和精灵说点什么…" maxlength="100">
        <button class="btn btn-primary" id="chatSendBtn">发送</button>
      </div>`;
    bindChatBox();
  } else {
    body.innerHTML = `
      <div class="secret-note">
        <textarea id="secretText" rows="3" maxlength="300" placeholder="把不敢说出口的话，悄悄写给精灵…"></textarea>
        <button class="btn btn-primary btn-block" id="secretSendBtn">封存这封信</button>
        <p class="secret-hint">精灵会在 <b>一段时间后</b> 回复你——下次打开小屋时，读一读它的回信吧。</p>
        <p class="secret-status" id="secretStatus"></p>
      </div>`;
    bindSecretBox();
  }
}

function bubbleEl(role, text) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.textContent = text;
  return div;
}

function bindChatBox() {
  const box = document.getElementById('chatBox');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');

  const history = JSON.parse(localStorage.getItem('sprite_chat') || '[]');
  history.forEach((m) => box.appendChild(bubbleEl(m.role, m.text)));
  box.scrollTop = box.scrollHeight;

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    if (isGuest() || !isConfigured()) {
      alert('游客模式下精灵还不能回应，登录后它就会醒来。');
      return;
    }
    input.value = '';
    box.appendChild(bubbleEl('user', text));
    history.push({ role: 'user', text });
    localStorage.setItem('sprite_chat', JSON.stringify(history.slice(-30)));
    box.appendChild(bubbleEl('system', '精灵正在思考…'));
    box.scrollTop = box.scrollHeight;
    sendBtn.disabled = true;
    try {
      const reply = await talkSprite(text);
      const thinking = box.querySelector('.chat-bubble.system');
      if (thinking) thinking.remove();
      box.appendChild(bubbleEl('sprite', reply));
      history.push({ role: 'sprite', text: reply });
      localStorage.setItem('sprite_chat', JSON.stringify(history.slice(-30)));
    } catch (err) {
      const thinking = box.querySelector('.chat-bubble.system');
      if (thinking) thinking.remove();
      box.appendChild(bubbleEl('system', err.message || '精灵打了个盹，稍后再试。'));
    } finally {
      sendBtn.disabled = false;
      box.scrollTop = box.scrollHeight;
    }
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}

function bindSecretBox() {
  const text = document.getElementById('secretText');
  const sendBtn = document.getElementById('secretSendBtn');
  const status = document.getElementById('secretStatus');

  // 打开面板时：若有待回信的秘密，先让精灵回信
  const pending = JSON.parse(localStorage.getItem('sprite_secret_pending') || 'null');
  if (pending) {
    deliverSecretReply(pending, status);
    localStorage.removeItem('sprite_secret_pending');
  }

  sendBtn.addEventListener('click', async () => {
    const content = text.value.trim();
    if (!content) { text.focus(); return; }
    if (isGuest() || !isConfigured()) {
      alert('游客模式下无法封存秘密，请先登录。');
      return;
    }
    sendBtn.disabled = true;
    try {
      await chronicle.addEntry('secret', `写给精灵的秘密：${content}`);
      localStorage.setItem('sprite_secret_pending', JSON.stringify({ text: content, at: Date.now() }));
      text.value = '';
      status.textContent = '💌 信已封存，精灵会在一段时间后回复你。';
      // 演示友好：约 9 秒后模拟“一段时间”，精灵来信
      setTimeout(() => {
        const stored = JSON.parse(localStorage.getItem('sprite_secret_pending') || 'null');
        if (stored && document.getElementById('spriteBody')) {
          deliverSecretReply(stored, status);
          localStorage.removeItem('sprite_secret_pending');
        }
      }, 9000);
    } catch (err) {
      alert('封存失败：' + err.message);
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// 生成精灵回信（AI 或固定模板，回信自动写进编年史）
async function deliverSecretReply(pending, statusEl) {
  try {
    const reply = await talkSprite(`（秘密日记）${pending.text}`);
    if (statusEl) statusEl.textContent = `📮 精灵回复了你：「${reply}」`;
  } catch (e) {
    if (statusEl) statusEl.textContent = '精灵还在读你的信，稍后再来看看。';
  }
}

// ===== 回忆小屋：时光相册（chronicle 表最近条目）+ 写日记 =====
async function renderMemoryView() {
  const listEl = document.getElementById('memoryList');
  const countEl = document.getElementById('memoryCount');
  const journalBtn = document.getElementById('journalBtn');

  let entries = [], total = 0;
  try {
    entries = await chronicle.listRecent(10);
    total = await chronicle.countEntries();
  } catch (e) { entries = []; }

  const online = !isGuest() && isConfigured();
  countEl.textContent = online ? (total > 0 ? `已收藏 ${total} 段回忆` : '') : '';
  journalBtn.hidden = !online;   // 游客不能写日记

  if (!online || entries.length === 0) {
    listEl.innerHTML = offlineHint(online ? '还没有回忆，完成第一个任务或写下第一篇日记吧' : '回忆相册是空的');
    return;
  }

  const starSvg = '<svg width="18" height="17" viewBox="0 0 18 17" fill="none"><path d="M9 1.2L11.2 5.6L16.1 6.3L12.5 9.7L13.4 14.5L9 12.1L4.6 14.5L5.5 9.7L1.9 6.3L6.8 5.6Z" fill="#C79933"/></svg>';
  const typeNames = { journal: '日记', review: '复盘', conversation: '对话', action: '行动', oracle: '求签', secret: '秘密日记' };
  const typeIcons = {
    journal: '📖', review: '🌙', conversation: '💬', action: '⚔️', oracle: '🔮', secret: '💌',
  };

  listEl.innerHTML = entries.map((e) => {
    const brief = (e.content || '').length > 42 ? e.content.slice(0, 42) + '…' : (e.content || '');
    return `
    <div class="memory-card">
      <span class="memory-icon" style="background:var(--gold)">
        <span style="font-size:20px;">${typeIcons[e.type] || '⭐'}</span>
      </span>
      <span class="memory-info">
        <span class="memory-title">${escapeHtml(brief)}</span>
        <span class="memory-meta">${e.date || ''} · ${typeNames[e.type] || e.type || '记录'}</span>
      </span>
      <span>${starSvg}</span>
    </div>`;
  }).join('');
}

// 写日记（登录后可用，保存进 chronicle 表）
function initJournal() {
  const btn = document.getElementById('journalBtn');
  const form = document.getElementById('journalForm');
  const text = document.getElementById('journalText');
  const count = document.getElementById('journalCount');
  const saveBtn = document.getElementById('journalSave');

  btn.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) text.focus();
  });
  document.getElementById('journalCancel').addEventListener('click', () => {
    form.hidden = true;
    text.value = '';
    count.textContent = '0 / 200';
  });
  text.addEventListener('input', () => {
    if (text.value.length > 200) text.value = text.value.slice(0, 200);
    count.textContent = `${text.value.length} / 200`;
  });
  saveBtn.addEventListener('click', async () => {
    const content = text.value.trim();
    if (!content) { text.focus(); return; }
    saveBtn.disabled = true;
    try {
      await chronicle.addEntry('journal', content);
      form.hidden = true;
      text.value = '';
      count.textContent = '0 / 200';
      renderMemoryView();
    } catch (err) {
      alert('保存回忆失败：' + err.message);
    } finally {
      saveBtn.disabled = false;
    }
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
  initJournal();
  initShopFilter();
  initOracle();
  initSpriteChat();

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
