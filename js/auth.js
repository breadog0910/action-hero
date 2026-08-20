import { getClient } from './supabase.js';
import { SUPABASE_URL } from './config.js';

// 登录态变化回调（由 main.js 注册）
const listeners = [];
export function onAuthChange(fn) { listeners.push(fn); }

function emit(user) {
  listeners.forEach((fn) => fn(user));
}

export async function getCurrentUser() {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}请求超时（${ms / 1000} 秒）`)), ms)
    ),
  ]);
}

export function initAuth() {
  const sb = getClient();
  if (!sb) return;
  console.log('[auth] Supabase 客户端已就绪，URL =', sb.auth ? 'ok' : 'missing');

  const form = document.getElementById('authForm');
  const submitBtn = document.getElementById('authSubmit');
  const toggleBtn = document.getElementById('authToggle');
  const msgEl = document.getElementById('authMsg');
  const emailEl = document.getElementById('authEmail');
  const passEl = document.getElementById('authPassword');

  let mode = 'login'; // login | signup
  updateMode();

  function updateMode() {
    submitBtn.textContent = mode === 'login' ? '登录' : '注册';
    toggleBtn.textContent = mode === 'login' ? '还没有账号？注册' : '已有账号？登录';
  }

  toggleBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    updateMode();
    msgEl.textContent = '';
  });

  // 网络检测按钮：结果直接显示在页面上
  const diagBtn = document.getElementById('diagBtn');
  diagBtn.addEventListener('click', async () => {
    msgEl.textContent = '检测中…';
    msgEl.className = 'log';
    const t0 = performance.now();
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: 'GET' });
      const ms = Math.round(performance.now() - t0);
      msgEl.textContent = `✅ 网络正常！服务器响应 HTTP ${r.status}，耗时 ${ms} 毫秒。可以正常登录。`;
      msgEl.className = 'log success';
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      msgEl.textContent = `❌ 连不上服务器（${ms} 毫秒后失败）：${err.message}。\n\n这通常意味着浏览器访问 Supabase 被网络/VPN/代理挡住了。`;
      msgEl.className = 'log error';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    const password = passEl.value;
    msgEl.textContent = '请稍候…';
    msgEl.className = 'log';

    try {
      const result = mode === 'login'
        ? await withTimeout(sb.auth.signInWithPassword({ email, password }), 20000, '登录')
        : await withTimeout(sb.auth.signUp({ email, password }), 20000, '注册');
      const { data, error } = result;

      if (error) {
        msgEl.textContent = '出错：' + (error.message || error);
        msgEl.className = 'log error';
        return;
      }

      if (mode === 'login') {
        emit(data.user);
      } else {
        msgEl.textContent = data.session
          ? '注册成功'
          : '注册成功！请查收邮箱确认邮件后登录。';
        msgEl.className = 'log success';
      }
    } catch (err) {
      console.error('[auth] 请求异常：', err);
      msgEl.textContent = '出错：' + (err && err.message ? err.message : err);
      msgEl.className = 'log error';
    }
  });

  // 监听会话变化（登录/退出）
  // 重要：onAuthStateChange 的 session 来自本地缓存，可能已过期。
  // 直接相信它，界面会误判“已登录”，但后续保存（createTask 等）用
  // getUser() 严格校验时会失败，导致“能进页面却加不了任务”。
  // 因此这里改用 getUser() 向服务端严格校验后再 emit。
  sb.auth.onAuthStateChange((event, session) => {
    if (!session) { emit(null); return; }
    sb.auth.getUser()
      .then(({ data, error }) => emit(error || !data.user ? null : data.user))
      .catch(() => emit(null));
  });
}

export async function signOut() {
  const sb = getClient();
  if (sb) await sb.auth.signOut();
}
