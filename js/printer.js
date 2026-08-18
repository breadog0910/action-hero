// ===== Luck Jingle 蓝牙小票打印机（从 app.js 抽出的模块）=====
// 协议：BLE，服务 ff00，写特征 ff02，通知特征 ff01
// 指令：ESC/POS 变体，位图 384 点宽（58mm 纸）

// 16 位短 UUID 展开为 128 位
const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';
const NOTIFY_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';

// 打印指令
const CMD_ENABLE = [0x10, 0xff, 0xf1, 0x03]; // 使能/开机
const CMD_WAKEUP = new Array(12).fill(0x00); // 唤醒
const CMD_FEED = [0x1b, 0x4a, 0x50];         // ESC J 80 -> 走纸
const CMD_STOP = [0x10, 0xff, 0xf1, 0x45];   // 结束任务

const PAPER_WIDTH = 384;        // 58mm 热敏纸点数宽
const BYTES_PER_LINE = 48;      // 384 / 8
const CHUNK_SIZE = 20;          // BLE 单包写入字节数

let device = null;
let writeChar = null;

// 连接状态回调（由 main.js 注册）
const listeners = { connected: [], disconnected: [] };
export function onConnect(fn) { listeners.connected.push(fn); }
export function onDisconnect(fn) { listeners.disconnected.push(fn); }

export function isConnected() {
  return !!(device && device.gatt && device.gatt.connected);
}

export function getDeviceName() {
  return device ? (device.name || '未知设备') : null;
}

export function isSupported() {
  return !!navigator.bluetooth;
}

async function connect() {
  // Luck Jingle 不广播服务 UUID，需 acceptAllDevices
  device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICE_UUID],
  });

  device.addEventListener('gattserverdisconnected', () => {
    writeChar = null;
    listeners.disconnected.forEach((fn) => fn());
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  writeChar = await service.getCharacteristic(WRITE_UUID);

  // 通知特征值可选，MVP 先不强制订阅
  try {
    const notifyChar = await service.getCharacteristic(NOTIFY_UUID);
    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', () => {});
  } catch (e) {
    // 部分机型无通知特征，忽略
  }

  listeners.connected.forEach((fn) => fn());
}

export function disconnect() {
  if (device && device.gatt && device.gatt.connected) {
    device.gatt.disconnect();
  }
}

// 把文本渲染成 384 点宽的黑白位图（返回 canvas 尺寸 + 位图字节）
export function renderTextToRaster(text) {
  const fontSize = 20;
  const lineHeight = 30;
  const padding = 16;
  const maxWidth = PAPER_WIDTH - padding * 2;

  const lines = (text || '').split('\n');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px sans-serif`;

  // 超长按字符折行
  const wrapped = [];
  for (const raw of lines) {
    let line = '';
    for (const ch of raw) {
      if (ctx.measureText(line + ch).width > maxWidth && line.length > 0) {
        wrapped.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    wrapped.push(line);
  }

  const height = wrapped.length * lineHeight + padding * 2;
  canvas.width = PAPER_WIDTH;
  canvas.height = height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  wrapped.forEach((line, i) => ctx.fillText(line, padding, padding + i * lineHeight));

  return { ctx, width: canvas.width, height: canvas.height };
}

// canvas 像素转 1-bit 位图（每 8 像素 1 字节，高位在前，黑点 = 1）
export function rasterToBitmap(ctx, width, height) {
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array((width / 8) * height);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 8) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = (y * width + (x + bit)) * 4;
        if (img[px] < 128) b |= 0x80 >> bit;
      }
      bytes[idx++] = b;
    }
  }
  return bytes;
}

// 构建 GS v 0 位图命令
function buildRasterCommand(bitmap, height) {
  const header = [
    0x1d, 0x76, 0x30, 0x00,
    BYTES_PER_LINE & 0xff, (BYTES_PER_LINE >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ];
  const cmd = new Uint8Array(header.length + bitmap.length);
  cmd.set(header, 0);
  cmd.set(bitmap, header.length);
  return cmd;
}

// 分包写入特征值（加微延时防丢数据）
async function sendBytes(bytes) {
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    await writeChar.writeValueWithoutResponse(chunk);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// 高层 API：打印一段文本
export async function printText(text) {
  if (!writeChar) throw new Error('请先连接打印机');
  const { ctx, width, height } = renderTextToRaster(text || '(空)');
  const bitmap = rasterToBitmap(ctx, width, height);
  const rasterCmd = buildRasterCommand(bitmap, height);

  await sendBytes(new Uint8Array(CMD_ENABLE));
  await sendBytes(new Uint8Array(CMD_WAKEUP));
  await sendBytes(rasterCmd);
  await sendBytes(new Uint8Array(CMD_FEED));
  await sendBytes(new Uint8Array(CMD_STOP));
}

// 高层 API：打印一张已经渲染好的位图（供 receipt.js 使用）
export async function printRaster({ ctx, width, height }) {
  if (!writeChar) throw new Error('请先连接打印机');
  const bitmap = rasterToBitmap(ctx, width, height);
  const rasterCmd = buildRasterCommand(bitmap, height);

  await sendBytes(new Uint8Array(CMD_ENABLE));
  await sendBytes(new Uint8Array(CMD_WAKEUP));
  await sendBytes(rasterCmd);
  await sendBytes(new Uint8Array(CMD_FEED));
  await sendBytes(new Uint8Array(CMD_STOP));
}

export { connect };
