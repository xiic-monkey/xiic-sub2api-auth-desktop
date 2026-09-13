import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AccountView,
  AppInfo,
  ApplyReport,
  CredentialView,
  EngineStatus,
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

  startReauth: (emails: string[]) => invoke<number>("start_reauth", { emails }),
  cancelReauth: () => invoke<boolean>("cancel_reauth"),

  applyResult: (raw: string, yes: boolean) => invoke<ApplyReport>("apply_result", { raw, yes }),

  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

/** 订阅重授权进度事件。 */
export function onReauthEvent(cb: (e: ReauthEvent) => void): Promise<UnlistenFn> {
  return listen<ReauthEvent>("reauth:event", (ev) => cb(ev.payload));
}
