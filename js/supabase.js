import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// 依赖 index.html 里通过 <script> 加载的 UMD 版 supabase-js（全局变量 `supabase`）
let client = null;

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function initSupabase() {
  if (!isConfigured()) return null;
  if (!client) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export function getClient() {
  return client;
}
