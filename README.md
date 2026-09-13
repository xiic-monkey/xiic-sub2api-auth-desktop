# xiic-sub2api-auth-desktop

sub2api 重授权台 · **本地单机版**（Tauri 2 + React 19）。

同一个运维能力的两个入口：

| 形态 | 载体 | 用途 |
| --- | --- | --- |
| 服务器 | [`xiic-sub2api-authorize`](../xiic-sub2api-authorize) 的 CLI / Docker | 服务器上脚本化、定时运维 |
| 本地 | **本项目**（Tauri 桌面应用） | 本机点点鼠标就能重授权，不用敲命令 |

核心逻辑**不重复实现**：本项目通过 Cargo `path` 依赖直接复用
`xiic-sub2api-authorize` 的 lib（`sub2api-operator`）——
登录 / 2FA / 分页拉全账号 / 写回凭证 / 浏览器 worker 调用全是同一份代码。

---

## 一键重授权流程

```
① 从 sub2api 拉全量账号（admin API）
② 勾选 401 / 需重授权的账号
③ 本机 Chrome（无头）打开接码门页 → 填 CDK 进入
④ 填邮箱（换行）→ 点「获取令牌」→ 每 5 秒轮询页面
⑤ 点「复制全部」→ 从剪切板读回 session
⑥ 打开 CPA 页 → 贴入左侧 → 右侧自动出 sub2api 凭证（含 refresh_token）
⑦ 预览匹配计划（dry-run）→ 确认 → 按邮箱（忽略大小写）写回对应账号
```

全程进度与日志实时显示在界面底部；**token 不会回传前端**（写回计划只给字段名与长度）。

---

## 开发

前置：Node.js 20+、Rust 1.77+、以及**本机已安装 Google Chrome**
（默认用系统 Chrome 做无头自动化，不额外下载 Chromium）。

```bash
# 1) 前端依赖
npm install

# 2) 浏览器 worker 依赖（只需一次；worker 只有一份，在 CLI 项目里）
cd ../xiic-sub2api-authorize/browser-worker && npm install && cd -

# 3) 启动桌面应用（会同时起 vite 与 tauri）
npm run app:dev
```

> 开发期 `worker.js` 直接从同级 `../xiic-sub2api-authorize/browser-worker/` 读取，
> 不需要复制；界面「运行环境」卡片会显示它解析到的真实路径。

## 打包

```bash
npm run app:build
```

`app:build` 会先把 worker（含 `playwright-core`，约 13MB）同步到
`src-tauri/resources/`，再交给 `tauri build` 打进 `.app`。

```bash
npm run sync:worker   # 只做同步
```

## 数据存放

| 内容 | 位置 |
| --- | --- |
| 连接设置（实例地址 / 管理员账密 / 2FA / 门页 / 引擎） | `<app_data_dir>/settings.json` |
| 接码平台凭证（账号 / 密码 / CDK） | `<app_data_dir>/credentials.db` |

`app_data_dir` 在 macOS 上是 `~/Library/Application Support/com.xiic.sub2api-auth-desktop`。
界面「运行环境」卡片里可直接看到该路径。

---

## 目录结构

```
├── src/                     React 界面
│   ├── App.tsx              状态编排（加载 / 勾选 / 进度 / 写回）
│   ├── api.ts               invoke 封装 + 事件订阅
│   ├── types.ts             与 Rust 结构一一对应的类型
│   └── components/
│       ├── SettingsPanel.tsx    连接设置
│       ├── CredentialPanel.tsx  接码凭证 + 运行环境
│       ├── AccountTable.tsx     账号列表（401 筛选 / 勾选）
│       └── ReauthRunner.tsx     执行面板（时间线 + 日志 + 写回）
├── src-tauri/               Rust 后端
│   └── src/
│       ├── lib.rs           应用装配（插件 / 命令注册）
│       ├── state.rs         数据目录、worker 定位、运行中 pid
│       └── commands.rs      IPC 命令 + worker 进度事件转发
└── scripts/sync-worker.mjs  打包前同步 worker 资源
```

## 与服务器版的关系

- **只读/写 admin API**，不修改 sub2api 上游代码；
- 写回用 `POST /api/v1/admin/accounts/:id/apply-oauth-credentials`（按 id 覆盖凭证，不建重复账号）；
- 匹配键是**邮箱，忽略大小写**；结果里匹配不到的项会被跳过并列出，绝不误写。

## 注意

- CDK 有获取次数限制，**同一邮箱别重复跑**；界面会显示剩余等待时间与轮询日志。
- `#mergeBtn`（合并 CDK）是破坏性操作（旧卡作废），工具不会自动点。
