/**
 * PWA 图标生成脚本（B13）。
 *
 * 用 Node 内置 zlib 手写 PNG 编码，不引入任何依赖：
 * - 蓝底圆角方块 + 白色柱状条（呼应 SPC 柱状图语义）；
 * - 输出 icon-192.png / icon-512.png（purpose: any）与
 *   icon-maskable-512.png（purpose: maskable，四周留足安全区）。
 *
 * 运行：node scripts/generate-pwa-icons.mjs（产物写入 public/icons/）
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BG = [29, 95, 208]; // #1d5fd0
const WHITE = [255, 255, 255];

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/** 生成 RGBA 位图（width × height） */
function createRaster(size, { cornerRadius, padding }) {
  const data = Buffer.alloc(size * size * 4);
  const contentMin = padding;
  const contentMax = size - padding;
  const contentSize = contentMax - contentMin;

  // 柱状条布局：5 根递增高度的白柱
  const barCount = 5;
  const barGap = Math.round(contentSize * 0.06);
  const barWidth = Math.round((contentSize - barGap * (barCount - 1)) / barCount);
  const heights = [0.38, 0.6, 0.48, 0.82, 1.0];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      let color = null;

      // 圆角判定（仅 any 图标需要；maskable 用满画布 + 内边距）
      if (cornerRadius > 0) {
        const inX = x < cornerRadius || x >= size - cornerRadius;
        const inY = y < cornerRadius || y >= size - cornerRadius;
        if (inX && inY) {
          const cx = x < cornerRadius ? cornerRadius : size - cornerRadius;
          const cy = y < cornerRadius ? cornerRadius : size - cornerRadius;
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > cornerRadius * cornerRadius) {
            // 画布外透明
            data[offset] = 0;
            data[offset + 1] = 0;
            data[offset + 2] = 0;
            data[offset + 3] = 0;
            continue;
          }
        }
        if (x < cornerRadius || x >= size - cornerRadius) {
          // 圆角左右带内为背景色
          color = BG;
        }
      }

      if (color === null) color = BG;

      // 柱子（底部对齐）
      const relX = x - contentMin;
      if (relX >= 0 && relX < contentSize) {
        const slot = Math.floor(relX / (barWidth + barGap));
        const inBarX = slot < barCount && relX - slot * (barWidth + barGap) < barWidth;
        if (inBarX) {
          const barHeight = Math.round(contentSize * heights[slot] * 0.72);
          const barTop = contentMax - barHeight;
          if (y >= barTop && y <= contentMax) {
            color = WHITE;
          }
        }
      }

      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return data;
}

function encodePng(size, raster) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前置 filter byte 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    raster.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const outputs = [
  { name: 'icon-192.png', size: 192, cornerRadius: Math.round(192 * 0.18), padding: Math.round(192 * 0.22) },
  { name: 'icon-512.png', size: 512, cornerRadius: Math.round(512 * 0.18), padding: Math.round(512 * 0.22) },
  // maskable：满画布（不留透明角），内容安全区 ≥ 80%
  { name: 'icon-maskable-512.png', size: 512, cornerRadius: 0, padding: Math.round(512 * 0.16) },
];

for (const item of outputs) {
  const raster = createRaster(item.size, { cornerRadius: item.cornerRadius, padding: item.padding });
  const png = encodePng(item.size, raster);
  writeFileSync(join(outDir, item.name), png);
  console.log(`written ${item.name} (${png.length} bytes)`);
}
