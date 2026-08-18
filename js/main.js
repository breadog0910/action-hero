import { initSupabase, isConfigured } from './supabase.js';
import { initAuth, onAuthChange, signOut } from './auth.js';
import * as printer from './printer.js';

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
      // 各视图渲染入口（Phase 2+ 会在这里初始化任务/伙伴等）
    } else {
      authView.hidden = false;
      appView.hidden = true;
      authMsg.textContent = '';
    }
  });

  // 设置页里加退出登录
  const settingsView = document.getElementById('view-settings');
  settingsView.innerHTML = `
    <div class="card">
      <h2>设置</h2>
      <p class="log">更多设置后续加入</p>
      <button id="signOutBtn" class="btn">退出登录</button>
    </div>
  `;
  settingsView.querySelector('#signOutBtn').addEventListener('click', signOut);
}

// ===== 视图占位（Phase 1 仅骨架，后续阶段填充）=====
function renderPlaceholders() {
  const placeholders = {
    tasks: '🧭 勇者之路：在这里接任务、打 Boss（下一步实现）',
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
