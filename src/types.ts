// 与 Rust 侧 commands.rs 的结构一一对应（字段名保持 snake_case）。

export interface Settings {
  base_url: string;
  email: string;
  password: string;
  totp_secret: string;
  verify_tls: boolean;
  gate_url: string;
  cpa_url: string;
  browser_engine: string;
  max_seconds: number;
}

export interface CredentialView {
  exists: boolean;
  cdk: string;
  updated_at: string;
}

export interface AccountView {
  id: number;
  name: string;
  platform: string;
  account_type: string;
  status: string;
  error_message: string;
  expires_in_days: number | null;
  schedulable: boolean;
  has_401: boolean;
  needs_reauth: boolean;
  has_refresh_token: boolean;
}

export interface EngineStatus {
  chrome: boolean;
  chromium: boolean;
  chromeError: string | null;
  chromiumError: string | null;
  chromePath?: string | null;
  chromiumPath?: string | null;
}

export interface AppInfo {
  version: string;
  data_dir: string;
  /** 当前引擎探测到的浏览器可执行文件（未找到为空串） */
  browser_path: string;
  browser_ready: boolean;
}

export interface FieldPreview {
  key: string;
  value: string;
  hidden: boolean;
}

export interface PlanItem {
  account_id: number;
  account_type: string;
  email: string;
  preview: FieldPreview[];
}

export interface ApplyOutcome {
  account_id: number;
  email: string;
  ok: boolean;
  message: string;
}

export interface ApplyReport {
  dry_run: boolean;
  plans: PlanItem[];
  skipped: string[];
  outcomes: ApplyOutcome[];
}

/** 重授权流程的进度事件（Rust 侧经回调转发）。 */
export type ReauthEvent =
  | { event: "step"; step: string; msg: string }
  | {
      event: "poll";
      t: string;
      stat: string;
      err: string;
      emailsLen: number;
      dlAll: boolean;
      copyAll: boolean;
    }
  | { event: "log"; msg: string }
  | { event: "done"; result: FetchResult }
  | { event: "error"; msg: string; errors?: string[] }
  | { event: "exit"; code: number | null; success?: boolean }
  | { event: "raw"; line: string };

export interface FetchResult {
  ok: boolean;
  url: string;
  emailsCount: number;
  done: boolean;
  finalState: { t?: string; stat?: string; note?: string } | null;
  copyClicked: boolean;
  /** 401 页「复制全部」读回的原始 session（含 token） */
  clipboard: string;
  cpaPage: { url: string; title: string; output: string } | null;
  errors: string[];
}
