#!/usr/bin/env node
/**
 * 生成 app 图标源图 (1024x1024 PNG)。
 *
 * 图标本体取自 Lucide 开源图标库（ISC 许可）：src-tauri/icons-src/lucide-key-round.svg
 * 合成方式：蓝色圆角方块背景 + 居中白色钥匙符号，再用 @resvg/resvg-js 渲染为 PNG。
 *
 * 用法：npm run icon   （生成 src-tauri/app-icon.png，随后跑 `npx tauri icon src-tauri/app-icon.png`）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcSvg = readFileSync(
  join(root, "src-tauri/icons-src/lucide-key-round.svg"),
  "utf8"
);

// 抽取 <svg ...> 标签内的图形元素，并把 currentColor 换成白色
const bodyMatch = srcSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
if (!bodyMatch) throw new Error("无法解析 Lucide SVG");
const glyph = bodyMatch[1].replace(/currentColor/g, "#ffffff").trim();

const SIZE = 1024;
const VB = 24; // Lucide 的 viewBox
const scale = 0.625; // 符号占比（app 图标惯例 60%~70%）
const pad = (VB - VB * scale) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${VB} ${VB}">
  <rect x="0" y="0" width="${VB}" height="${VB}" rx="5.4" fill="#2563EB"/>
  <g transform="translate(${pad},${pad}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    ${glyph}
  </g>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: "width", value: SIZE } });
const png = resvg.render().asPng();
const out = join(root, "src-tauri/app-icon.png");
writeFileSync(out, png);
console.log(`saved ${out} (${png.length} bytes)`);
