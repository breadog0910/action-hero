import { getClient } from './supabase.js';

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
  sb.auth.onAuthStateChange((event, session) => {
    emit(session ? session.user : null);
  });
}

export async function signOut() {
  const sb = getClient();
  if (sb) await sb.auth.signOut();
}
