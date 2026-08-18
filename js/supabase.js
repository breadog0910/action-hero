import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// 依赖 index.html 里通过 <script> 加载的 UMD 版 supabase-js（全局变量 `supabase`）
let client = null;

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function initSupabase() {
  if (!isConfigured()) return null;
  if (typeof window.supabase === 'undefined') {
    console.error('[supabase] 严重：window.supabase 未定义，说明 supabase-js CDN 脚本没加载成功（网络或缓存）');
    return null;
  }
  if (!client) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[supabase] 客户端已创建，URL =', SUPABASE_URL);
  }
  return client;
}

export function getClient() {
  return client;
}
