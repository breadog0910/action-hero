# ⚔️ 行动勇者 · 一个会生长的世界

面向 ADHD 人群的游戏化生活/工作规划产品。核心：**用「现实行动 → 世界获得光 → 打印机吐出实物小票」的正反馈对抗拖延。**

> 当前进度：**Phase 1**（Supabase 账号 + 多视图骨架 + 打印模块化）已完成，核心玩法逐步实现中。

## 技术栈

- 前端：原生 HTML/CSS/JS + ES Modules，无构建步骤
- 后端：Supabase（Auth + Postgres + RLS）
- 打印：Web Bluetooth（Luck Jingle BLE 小票机，58mm）

## 运行

Web Bluetooth 要求**安全上下文**（HTTPS 或 localhost）。本地调试：

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 配置 Supabase（首次必做）

1. 到 [supabase.com](https://supabase.com) 注册并**创建项目**（选一个离你近的区域）。
2. 打开项目面板 → **SQL Editor**，把 [`supabase/schema.sql`](supabase/schema.sql) 整段粘贴运行（建 10 张表 + RLS + 自动初始化触发器）。
3. 打开 **Settings → API**，复制 `Project URL` 和 `anon public key`。
4. 填入 [`js/config.js`](js/config.js) 里的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`。
5. 若注册后需要邮箱确认：Settings → Authentication → Providers → Email，可先关掉 "Confirm email"（本地测试）。

## 使用

1. 打开页面 → 注册/登录（注册后自动创建你的世界、伙伴、领地）。
2. 顶部点「🖨️ 连接打印机」，选你的 Luck Jingle 设备。

## 打印机协议（Luck Jingle / LuckPrinter SDK）

- BLE 服务 `ff00`，写特征 `ff02`，通知特征 `ff01`
- 使能 `10 FF F1 03`，唤醒 `12×00`，走纸 `1B 4A 50`，结束 `10 FF F1 45`
- 位图 `GS v 0`，384 点宽，1-bit 高位在前

参考：[thermal-pocket-printer-basic](https://github.com/ChiaraCannolee/thermal-pocket-printer-basic)

## 项目结构

```
index.html            多视图骨架
style.css
js/
  config.js           Supabase 配置（填 URL + anon key）
  supabase.js         Supabase 客户端
  auth.js             登录/注册
  printer.js          BLE 连接 + 位图渲染 + 打印
  main.js             入口 + 视图路由
supabase/
  schema.sql          建表 + RLS + 触发器
```
