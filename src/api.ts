import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AccountView,
  AppInfo,
  ApplyReport,
  BindReport,
  CdkCheckResult,
  CdkMergeResult,
  CredentialView,
  EngineStatus,
  GroupResult,
  ReauthEvent,
  Settings,
} from "./types";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  checkEngines: () => invoke<EngineStatus>("check_engines"),

  loadSettings: () => invoke<Settings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),

  loadCredentials: () => invoke<CredentialView>("load_credentials"),
  saveCredentials: (cdk: string) =>
    invoke<CredentialView>("save_credentials", { cdk }),

  listAccounts: () => invoke<AccountView[]>("list_accounts"),

  groupAccounts: (pageSize: number) =>
    // Tauri 2 会把 Rust 侧的 snake_case 参数名转成 camelCase，所以这里必须传 pageSize
    invoke<GroupResult>("group_accounts", { pageSize }),

  startReauth: (emails: string[]) => invoke<number>("start_reauth", { emails }),
  cancelReauth: () => invoke<boolean>("cancel_reauth"),

  applyResult: (raw: string, yes: boolean) => invoke<ApplyReport>("apply_result", { raw, yes }),

  checkCdkLeft: (cdk: string) => invoke<CdkCheckResult>("check_cdk_left", { cdk }),
  mergeCdk: (codes: string[]) => invoke<CdkMergeResult>("merge_cdk", { codes }),

  /** 一键把 sub2api 账号邮箱导入收码站（服务端自带去重） */
  importMailEmails: () => invoke<BindReport>("import_mail_emails"),

  /** 非 CDK 一键授权：走 sub2api 授权链接 + 收码站验证码（空数组 = 全部 401 账号） */
  startOpenaiReauth: (emails: string[]) =>
    invoke<number>("start_openai_reauth", { emails }),

  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

/** 订阅重授权进度事件。 */
export function onReauthEvent(cb: (e: ReauthEvent) => void): Promise<UnlistenFn> {
  return listen<ReauthEvent>("reauth:event", (ev) => cb(ev.payload));
}
