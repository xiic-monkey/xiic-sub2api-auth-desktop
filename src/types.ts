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
  /** 收码站地址（非 CDK 授权路径用） */
  mail_base_url: string;
  mail_username: string;
  mail_password: string;
  /** 非 CDK 授权使用有头窗口（Cloudflare 要求人工验证时可人工点一下） */
  openai_headed: boolean;
  /** 非 CDK 单账号最长等待秒数 */
  openai_max_seconds: number;
}

/** 邮箱导入收码站的结果 */
export interface BindReport {
  total: number;
  bound: number;
  already_bound: number;
  not_found: number;
  newly_bound: string[];
  missing: string[];
  batches: number;
}

/** 非 CDK 单账号授权结果 */
export interface OAuthAccountOutcome {
  account_id: number;
  email: string;
  ok: boolean;
  stage: string;
  message: string;
}

/** 非 CDK 一键授权报告 */
export interface OAuthImportResult {
  emails: string[];
  imported: BindReport | null;
  import_error: string | null;
  outcomes: OAuthAccountOutcome[];
  applied: ApplyOutcome[];
}

export interface CredentialView {
  exists: boolean;
  cdk: string;
  updated_at: string;
}

export interface CdkCheckResult {
  ok: boolean;
  cdk: string;
  remaining: number | null;
  quota: number | null;
  left_text: string;
}

export interface CdkMergeResult {
  ok: boolean;
  new_cdk: string;
  new_left: string;
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
  /** 调度优先级（sub2api 原生，越小越优先）；分组后等于页码 */
  priority: number | null;
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

export interface DeleteOutcome {
  account_id: number;
  email: string;
  ok: boolean;
  message: string;
}

/** 分组：一页账号的设置结果 */
export interface GroupOutcome {
  page: number;
  priority: number;
  account_ids: number[];
  ok: boolean;
  message: string;
}

/** 分组整体结果 */
export interface GroupResult {
  page_size: number;
  total: number;
  pages: number;
  outcomes: GroupOutcome[];
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
  /** 自动衔接：写回前的匹配计划（dry-run） */
  | { event: "preview"; report: ApplyReport }
  /** 自动衔接：真正写回后的结果 */
  | { event: "apply"; report: ApplyReport }
  /** CDK 查询次数完成 */
  | { event: "cdk-check"; result: CdkCheckResult }
  /** CDK 合并完成 */
  | { event: "cdk-merge"; result: CdkMergeResult }
  /** 非 CDK 一键授权完成（sub2api 授权链接 + 收码站验证码） */
  | { event: "openai-oauth"; result: OAuthImportResult }
  /** fetch 检测到账号被封禁/停用 */
  | { event: "banned"; emails: string[] }
  /** 已尝试从 sub2api 删除被封禁账号 */
  | { event: "deleted"; deleted: DeleteOutcome[] }
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
  /** fetch 结果页检测到的被封禁/停用邮箱 */
  bannedEmails: string[];
  errors: string[];
}
