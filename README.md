# 蓝牙小票打印网页

通过浏览器 Web Bluetooth 连接 Luck Jingle（鹭江科技）BLE 小票打印机，把文本渲染成位图后打印。

## 运行

Web Bluetooth 要求**安全上下文**（HTTPS 或 localhost）。本地调试最简单的方式：

```bash
# 在项目目录下，任选一种起一个本地服务器
python -m http.server 8080
# 或
npx serve .
```

然后浏览器打开 `http://localhost:8080`。

> 手机访问需通过局域网 HTTPS（非 localhost 地址必须 HTTPS），或先在电脑上跑通。

## 使用

1. 打开页面，点「连接打印机」，在弹出的设备列表里选你的打印机（Luck Jingle 通常不显示服务 UUID，按名称/地址选）。
2. 输入文本，点「立即打印」。

## 支持的浏览器

- 电脑：Chrome / Edge
- 安卓：Chrome
- iPhone：Safari（iOS 18+）

## 打印机协议（Luck Jingle / LuckPrinter SDK）

- BLE 服务 `ff00`，写特征 `ff02`，通知特征 `ff01`
- 使能：`10 FF F1 03`，唤醒：12×`00`，走纸：`1B 4A 50`，结束：`10 FF F1 45`
- 位图：`GS v 0`（`1D 76 30 00` + 宽高 + 数据），384 点宽，1-bit，高位在前

参考：[thermal-pocket-printer-basic](https://github.com/ChiaraCannolee/thermal-pocket-printer-basic)
