import { initSupabase, isConfigured } from './supabase.js';
import { initAuth, onAuthChange, signOut } from './auth.js';
import * as printer from './printer.js';
import * as game from './game.js';
import { celebrateReceipt } from './receipt.js';

// 自动打印开关（存 localStorage，默认开）
function autoPrintOn() {
  return localStorage.getItem('autoPrint') !== 'off';
}

// ===== 视图路由 =====
const viewIds = ['tasks', 'companion', 'world', 'chronicle', 'oracle', 'settings'];

function showView(name) {
  viewIds.forEach((id) => {
    const sec = document.getElementById(`view-${id}`);
    sec.hidden = id !== name;
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
  });
}

function initRouter() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
  document.getElementById('settingsBtn').addEventListener('click', () => showView('settings'));
}

// ===== 打印机 =====
function initPrinter() {
  const btn = document.getElementById('printerBtn');
  const stateEl = document.getElementById('printerState');

  function renderState() {
    if (printer.isConnected()) {
      stateEl.textContent = printer.getDeviceName();
      btn.classList.add('connected');
    } else {
      stateEl.textContent = '未连接';
      btn.classList.remove('connected');
    }
  }

  btn.addEventListener('click', async () => {
    if (!printer.isSupported()) {
      alert('当前浏览器不支持 Web Bluetooth（需 Chrome/Edge/Safari，且为 HTTPS 或 localhost）');
      return;
    }
    if (printer.isConnected()) {
      printer.disconnect();
      return;
    }
    try {
      await printer.connect();
    } catch (err) {
      alert('连接失败：' + err.message);
    }
  });

  printer.onConnect(renderState);
  printer.onDisconnect(renderState);
  renderState();
}

// ===== 登录态 =====
function initAuthUI() {
  const authView = document.getElementById('authView');
  const appView = document.getElementById('appView');
  const authMsg = document.getElementById('authMsg');

  onAuthChange(async (user) => {
    if (user) {
      authView.hidden = true;
      appView.hidden = false;
      showView('tasks');
      renderTasksView();
    } else {
      authView.hidden = false;
      appView.hidden = true;
      authMsg.textContent = '';
    }
  });

  // 设置页
  const settingsView = document.getElementById('view-settings');
  settingsView.innerHTML = `
    <div class="card">
      <h2>设置</h2>
      <label class="switch-row">
        <span>完成任务后自动打印小票</span>
        <input type="checkbox" id="autoPrintSwitch" ${autoPrintOn() ? 'checked' : ''}>
      </label>
      <button id="signOutBtn" class="btn">退出登录</button>
    </div>
  `;
  settingsView.querySelector('#autoPrintSwitch').addEventListener('change', (e) => {
    localStorage.setItem('autoPrint', e.target.checked ? 'on' : 'off');
  });
  settingsView.querySelector('#signOutBtn').addEventListener('click', signOut);
}

// ===== 视图占位（Phase 2 起逐步替换为真实视图）=====
function renderPlaceholders() {
  const placeholders = {
    companion: '🐣 伙伴：一个陪你成长的生命（下一步实现）',
    world: '🏰 王国：你的领地与世界图鉴（下一步实现）',
    chronicle: '📜 编年史：日记、复盘、世界史（下一步实现）',
    oracle: '🔮 贤者之书：心里想问，翻一页得答案（下一步实现）',
  };
  for (const [id, text] of Object.entries(placeholders)) {
    const sec = document.getElementById(`view-${id}`);
    sec.innerHTML = `<div class="card"><h2>${text.split('：')[0]}</h2><p class="log">${text.split('：')[1] || text}</p></div>`;
  }
}

// ===== 勇者视图：任务列表 + 新建 + 完成 =====
async function renderTasksView() {
  const sec = document.getElementById('view-tasks');
  let profile = null;
  try {
    profile = await game.getProfile();
  } catch (e) {
    profile = { level: 1, xp: 0 };
  }

  sec.innerHTML = `
    <div class="card">
      <h2>🧭 勇者之路</h2>
      <p class="log">等级 ${profile.level} · 经验 ${profile.xp}</p>
    </div>

    <div class="card">
      <form id="taskForm">
        <label for="taskTitle">新任务</label>
        <input id="taskTitle" type="text" placeholder="你想完成什么？" required>
        <label for="taskDifficulty">难度</label>
        <select id="taskDifficulty">
          <option value="1">简单 · +10 XP</option>
          <option value="2">普通 · +20 XP</option>
          <option value="3" selected>较难 · +35 XP</option>
          <option value="4">困难 · +55 XP</option>
          <option value="5">Boss 级 · +80 XP</option>
        </select>
        <button type="submit" class="btn btn-primary btn-block">接任务</button>
      </form>
    </div>

    <div class="card">
      <h2>进行中</h2>
      <ul id="taskList" class="task-list"></ul>
    </div>
  `;

  // 表单提交：新建任务
  sec.querySelector('#taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = sec.querySelector('#taskTitle').value.trim();
    const difficulty = parseInt(sec.querySelector('#taskDifficulty').value, 10);
    if (!title) return;
    try {
      await game.createTask(title, 'normal', difficulty);
      sec.querySelector('#taskTitle').value = '';
      await renderTasksView();
    } catch (err) {
      alert('新建任务失败：' + err.message);
    }
  });

  // 渲染任务列表 + 完成按钮
  const listEl = sec.querySelector('#taskList');
  let tasks = [];
  try {
    tasks = await game.listTasks();
  } catch (err) {
    listEl.innerHTML = `<li class="task-empty">加载失败：${err.message}</li>`;
    return;
  }

  if (tasks.length === 0) {
    listEl.innerHTML = '<li class="task-empty">还没有进行中的任务，先接一个吧！</li>';
    return;
  }

  listEl.innerHTML = tasks.map((t) => `
    <li class="task-item">
      <div class="task-info">
        <span class="task-title">${escapeHtml(t.title)}</span>
        <span class="task-meta">难度 ${t.difficulty} · +${game.xpForDifficulty(t.difficulty)} XP</span>
      </div>
      <button class="btn btn-primary btn-small" data-id="${t.id}">完成</button>
    </li>
  `).join('');

  // 完成按钮
  listEl.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const task = tasks.find((t) => t.id === btn.dataset.id);
      if (!task) return;
      btn.disabled = true;
      try {
        const rewards = await game.completeTask(task);
        // 打印庆祝小票
        if (autoPrintOn()) {
          try {
            if (printer.isConnected()) {
              await printer.printRaster(celebrateReceipt(rewards.taskTitle, rewards));
            } else {
              console.log('未连接打印机，跳过打印');
            }
          } catch (perr) {
            console.error('打印失败（不影响任务记录）：', perr);
          }
        }
        await renderTasksView();
      } catch (err) {
        alert('完成任务失败：' + err.message);
        btn.disabled = false;
      }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ===== 启动 =====
function boot() {
  if (!isConfigured()) {
    // 未配置 Supabase：提示用户
    const authMsg = document.getElementById('authMsg');
    authMsg.textContent = '⚠️ 请先配置 Supabase：编辑 js/config.js，填入 URL 和 anon key';
    authMsg.className = 'log error';
    document.getElementById('authSubmit').disabled = true;
    return;
  }

  initSupabase();
  initAuth();          // 内部 onAuthStateChange 会自动恢复登录态
  initAuthUI();
  initRouter();
  initPrinter();
  renderPlaceholders();
}

boot();
