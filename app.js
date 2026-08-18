// ===== Luck Jingle 蓝牙小票打印机 =====
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

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const printBtn = document.getElementById('printBtn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const textEl = document.getElementById('text');

function log(msg) {
  logEl.textContent = msg;
  console.log(msg);
}

async function connect() {
  try {
    log('正在搜索打印机…');
    // Luck Jingle 不广播服务 UUID，需 acceptAllDevices 按名称过滤
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    writeChar = await service.getCharacteristic(WRITE_UUID);

    // 通知特征值可选，MVP 先不订阅
    try {
      const notifyChar = await service.getCharacteristic(NOTIFY_UUID);
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', () => {});
    } catch (e) {
      // 部分机型无通知特征，忽略
    }

    statusEl.textContent = `已连接：${device.name || '未知设备'}`;
    statusEl.classList.add('connected');
    printBtn.disabled = false;
    disconnectBtn.disabled = false;
    connectBtn.disabled = true;
    log('连接成功，可以打印了');
  } catch (err) {
    log('连接失败：' + err.message);
  }
}

function disconnect() {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  }
}

function onDisconnected() {
  writeChar = null;
  statusEl.textContent = '未连接';
  statusEl.classList.remove('connected');
  printBtn.disabled = true;
  disconnectBtn.disabled = true;
  connectBtn.disabled = false;
  log('已断开连接');
}

// 把文本渲染成 384 点宽的黑白位图
function renderTextToRaster(text) {
  const fontSize = 20;      // 字号
  const lineHeight = 30;    // 行高
  const padding = 16;       // 边距
  const maxWidth = PAPER_WIDTH - padding * 2;

  const lines = (text || '').split('\n');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px sans-serif`;

  // 中文不自动换行的话先简单处理：超长按字符折行
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

  // 白底
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';

  wrapped.forEach((line, i) => {
    ctx.fillText(line, padding, padding + i * lineHeight);
  });

  return { ctx, width: canvas.width, height: canvas.height };
}

// canvas 像素转 1-bit 位图（每 8 像素 1 字节，高位在前，黑点 = 1）
function rasterToBitmap(ctx, width, height) {
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array((width / 8) * height);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 8) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = (y * width + (x + bit)) * 4;
        if (img[px] < 128) b |= 0x80 >> bit; // 黑像素置 1，MSB 在前
      }
      bytes[idx++] = b;
    }
  }
  return bytes;
}

// 构建 GS v 0 位图命令
function buildRasterCommand(bitmap, height) {
  const header = [
    0x1d, 0x76, 0x30, 0x00,          // GS v 0, m=0
    BYTES_PER_LINE & 0xff, (BYTES_PER_LINE >> 8) & 0xff, // xL, xH
    height & 0xff, (height >> 8) & 0xff,                 // yL, yH
  ];
  const cmd = new Uint8Array(header.length + bitmap.length);
  cmd.set(header, 0);
  cmd.set(bitmap, header.length);
  return cmd;
}

// 分包写入特征值（每包 CHUNK_SIZE 字节，加微延时防丢数据）
async function sendBytes(bytes) {
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    await writeChar.writeValueWithoutResponse(chunk);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function print() {
  if (!writeChar) {
    log('请先连接打印机');
    return;
  }
  try {
    printBtn.disabled = true;
    log('正在打印…');

    const text = textEl.value.trim();
    const { ctx, width, height } = renderTextToRaster(text || '(空)');
    const bitmap = rasterToBitmap(ctx, width, height);
    const rasterCmd = buildRasterCommand(bitmap, height);

    await sendBytes(new Uint8Array(CMD_ENABLE));
    await sendBytes(new Uint8Array(CMD_WAKEUP));
    await sendBytes(rasterCmd);
    await sendBytes(new Uint8Array(CMD_FEED));
    await sendBytes(new Uint8Array(CMD_STOP));

    log('打印完成');
  } catch (err) {
    log('打印失败：' + err.message);
  } finally {
    printBtn.disabled = false;
  }
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
printBtn.addEventListener('click', print);

// 基本能力检查
if (!navigator.bluetooth) {
  statusEl.textContent = '当前浏览器不支持 Web Bluetooth（需 Chrome/Edge/Safari，且为 HTTPS 或 localhost）';
  connectBtn.disabled = true;
}
