#!/usr/bin/env node
/**
 * 把原项目的 browser-worker 同步到 src-tauri/resources/browser-worker，
 * 供 `tauri build` 打包进 .app（tauri.conf.json > bundle.resources）。
 *
 * 为什么不在本仓库维护第二份 worker.js：
 *   worker.js 只有一份（xiic-sub2api-authorize/browser-worker/worker.js），
 *   这里只在打包前拉一份副本，避免两边逻辑分叉。
 *
 * 用法：
 *   node scripts/sync-worker.mjs
 *   SUB2API_WORKER_SRC=/path/to/browser-worker node scripts/sync-worker.mjs
 */
import { cp, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src =
  process.env.SUB2API_WORKER_SRC ||
  path.resolve(root, "../xiic-sub2api-authorize/browser-worker");
const dst = path.resolve(root, "src-tauri/resources/browser-worker");

if (!existsSync(path.join(src, "worker.js"))) {
  console.error(`[sync-worker] 找不到源 worker：${src}/worker.js`);
  console.error(`[sync-worker] 用 SUB2API_WORKER_SRC 指定 browser-worker 目录。`);
  process.exit(1);
}

// 只覆盖、不整体删除（避免触发批量删除保护）
await mkdir(dst, { recursive: true });

for (const item of ["worker.js", "package.json"]) {
  const p = path.join(src, item);
  if (existsSync(p)) await cp(p, path.join(dst, item), { recursive: true, force: true });
}

// playwright-core 自包含、零依赖，只需复制它本身（不复制整个 node_modules，
// 否则 node_modules/.bin 下的符号链接会触发 cp 自引用 EINVAL）
await mkdir(path.join(dst, "node_modules"), { recursive: true });
const pc = path.join(src, "node_modules", "playwright-core");
if (existsSync(pc)) {
  await cp(pc, path.join(dst, "node_modules", "playwright-core"), { recursive: true, force: true });
  let size = 0;
  const walk = async (d) => {
    for (const e of await import("node:fs/promises").then((m) => m.readdir(d, { withFileTypes: true }))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else size += (await stat(f)).size;
    }
  };
  await walk(pc);
  console.log(`[sync-worker] playwright-core 已复制（${(size / 1024 / 1024).toFixed(1)} MB）`);
} else {
  console.warn(
    `[sync-worker] 源目录没有 playwright-core，打包后将缺少浏览器引擎。\n` +
      `              请先执行：cd ${src} && npm install`
  );
}

console.log(`[sync-worker] 已同步到 ${dst}`);
