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

export function initAuth() {
  const sb = getClient();
  if (!sb) return;

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
      if (mode === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        emit(data.user);
      } else {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        // 部分 Supabase 项目开了邮箱确认，需提示
        msgEl.textContent = data.session
          ? '注册成功'
          : '注册成功！请查收邮箱确认邮件后登录。';
        msgEl.className = 'log success';
      }
    } catch (err) {
      msgEl.textContent = '出错：' + err.message;
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
