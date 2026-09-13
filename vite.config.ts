import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // 1. 不让 vite 的清屏盖住 rust 报错
  clearScreen: false,
  // 2. tauri 需要固定端口，占用则直接失败（而不是悄悄换端口）
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. 忽略 src-tauri，避免 rust 变更触发前端热更新
      ignored: ["**/src-tauri/**"],
    },
  },
}));
