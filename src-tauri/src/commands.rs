//! Tauri 命令层：把核心库（sub2api-operator）的能力暴露给界面。
//!
//! 设计要点：
//! - 阻塞型 API 调用放进 `spawn_blocking`，不卡 UI 线程；
//! - 重授权走核心库的原生浏览器自动化（fetch_stream_hooks），进度经回调转发成 Tauri 事件 `reauth:event`；
//! - 敏感值（token）只经事件 / 后端内部流转，`PlanItem.credentials` 不随 JSON 回传前端。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use sub2api_operator::browser;
use sub2api_operator::commands::reauth::{apply_value, ApplyReport};
use sub2api_operator::config::Config;
use sub2api_operator::models::Account;
use sub2api_operator::{client::Sub2ApiClient, store};

use crate::state::AppState;

/// 界面事件名（前端 `listen('reauth:event')`）。
const EVENT: &str = "reauth:event";

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// sub2api 实例地址（不含 /api/v1）
    pub base_url: String,
    /// 管理员邮箱
    pub email: String,
    /// 管理员密码
    pub password: String,
    /// 2FA 密钥（base32，可留空）
    pub totp_secret: String,
    /// 是否校验证书（自签证书取消勾选）
    pub verify_tls: bool,
    /// 接码平台门页
    pub gate_url: String,
    /// CPA 转换页
    pub cpa_url: String,
    /// 浏览器引擎：chrome（本机 Chrome）| chromium（内置）
    pub browser_engine: String,
    /// 单次重授权最长等待秒数
    pub max_seconds: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            email: String::new(),
            password: String::new(),
            totp_secret: String::new(),
            verify_tls: true,
            gate_url: "https://401.kyon888.xyz".to_string(),
            cpa_url: "https://zh.kyon888.xyz/CPAandSub2API/".to_string(),
            browser_engine: "chrome".to_string(),
            max_seconds: 150,
        }
    }
}

impl Settings {
    pub fn to_config(&self) -> anyhow::Result<Config> {
        if self.base_url.trim().is_empty() || self.email.trim().is_empty() {
            anyhow::bail!("请先在「连接设置」里填写 sub2api 地址与管理员账号");
        }
        Ok(Config {
            base_url: self.base_url.trim().to_string(),
            email: self.email.trim().to_string(),
            password: self.password.clone(),
            totp_secret: {
                let t = self.totp_secret.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            },
            verify_tls: self.verify_tls,
            gate_url: self.gate_url.trim().to_string(),
            cpa_url: self.cpa_url.trim().to_string(),
            max_seconds: self.max_seconds,
        })
    }
}

fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn load_settings_from(data_dir: &Path) -> Settings {
    std::fs::read_to_string(settings_path(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(Settings::default)
}

fn save_settings_to(data_dir: &Path, s: &Settings) -> anyhow::Result<()> {
    let txt = serde_json::to_string_pretty(s)?;
    std::fs::write(settings_path(data_dir), txt)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 视图模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    /// 当前引擎探测到的浏览器可执行文件（未找到为空）
    pub browser_path: String,
    pub browser_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EngineStatus {
    pub chrome: bool,
    pub chromium: bool,
    #[serde(default, rename = "chromeError")]
    pub chrome_error: Option<String>,
    #[serde(default, rename = "chromiumError")]
    pub chromium_error: Option<String>,
    #[serde(default, rename = "chromeVersion")]
    pub chrome_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountView {
    pub id: i64,
    pub name: String,
    pub platform: String,
    pub account_type: String,
    pub status: String,
    pub error_message: String,
    pub expires_in_days: Option<i64>,
    pub schedulable: bool,
    pub has_401: bool,
    pub needs_reauth: bool,
    /// 是否还持有 refresh_token（重授权前的体检信号）
    pub has_refresh_token: bool,
}

impl From<&Account> for AccountView {
    fn from(a: &Account) -> Self {
        let has_refresh_token = a
            .credentials
            .as_ref()
            .and_then(|c| c.get("refresh_token"))
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        Self {
            id: a.id,
            name: a.name.clone(),
            platform: a.platform.clone(),
            account_type: a.account_type.clone(),
            status: a.status.clone(),
            error_message: a.error_message.clone(),
            expires_in_days: a.expires_in_days(),
            schedulable: a.schedulable,
            has_401: a.has_401(),
            needs_reauth: a.needs_reauth(),
            has_refresh_token,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialView {
    pub exists: bool,
    pub cdk: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// 基础命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    let engine = state.settings_snapshot().browser_engine;
    let path = browser::detect_executable(Some(&engine)).ok();
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: state.data_dir.display().to_string(),
        browser_path: path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        browser_ready: path.is_some(),
    }
}

#[tauri::command]
pub async fn check_engines() -> Result<EngineStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let v = browser::check_engines();
        serde_json::from_value::<EngineStatus>(v).map_err(|e| format!("解析引擎检测结果失败：{}", e))
    })
    .await
    .map_err(|e| format!("任务调度失败：{}", e))?
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> Settings {
    state.settings_snapshot()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    let mut s = settings;
    s.base_url = s.base_url.trim().to_string();
    s.email = s.email.trim().to_string();
    s.gate_url = s.gate_url.trim().to_string();
    s.cpa_url = s.cpa_url.trim().to_string();
    if s.max_seconds < 30 {
        s.max_seconds = 30;
    }
    save_settings_to(&state.data_dir, &s).map_err(|e| format!("保存设置失败：{}", e))?;
    state.set_settings(s.clone());
    Ok(s)
}

// ---------------------------------------------------------------------------
// 接码平台凭证（复用核心库的 credentials.db）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_credentials() -> Result<CredentialView, String> {
    match store::load() {
        Ok(Some(c)) => Ok(CredentialView {
            exists: true,
            cdk: c.cdk,
            updated_at: c.updated_at,
        }),
        Ok(None) => Ok(CredentialView {
            exists: false,
            cdk: String::new(),
            updated_at: String::new(),
        }),
        Err(e) => Err(format!("读取凭证库失败：{}", e)),
    }
}

#[tauri::command]
pub fn save_credentials(cdk: String) -> Result<CredentialView, String> {
    store::save(&cdk).map_err(|e| format!("保存凭证失败：{}", e))?;
    load_credentials()
}

// ---------------------------------------------------------------------------
// 账号
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountView>, String> {
    let cfg = state.settings_snapshot().to_config().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<AccountView>, String> {
        let mut client = Sub2ApiClient::login(&cfg).map_err(|e| format!("{:#}", e))?;
        let accounts = client.list_accounts().map_err(|e| format!("{:#}", e))?;
        Ok(accounts.iter().map(AccountView::from).collect())
    })
    .await
    .map_err(|e| format!("任务调度失败：{}", e))?
}

// ---------------------------------------------------------------------------
// 重授权（一键流程，带进度）
// ---------------------------------------------------------------------------

fn emit(app: &AppHandle, v: serde_json::Value) {
    let _ = app.emit(EVENT, v);
}

#[tauri::command]
pub async fn start_reauth(
    app: AppHandle,
    state: State<'_, AppState>,
    emails: Vec<String>,
) -> Result<usize, String> {
    if emails.is_empty() {
        return Err("没有选中任何邮箱".to_string());
    }
    if state.job().is_some() {
        return Err("已有重授权任务在跑，请先等它结束或点「终止」".to_string());
    }
    let settings = state.settings_snapshot();
    settings.to_config().map_err(|e| e.to_string())?; // 提前校验连接配置
    let engine = settings.browser_engine.clone();
    browser::detect_executable(Some(&engine))
        .map_err(|e| format!("{:#}", e))?; // 提前确认浏览器存在

    // CDK 复用本地凭证库
    let cdk = store::load()
        .ok()
        .flatten()
        .map(|c| c.cdk)
        .filter(|s| !s.is_empty());

    let count = emails.len();
    let cancel = Arc::new(AtomicBool::new(false));
    state.set_job(cancel.clone());

    tauri::async_runtime::spawn(async move {
        let app2 = app.clone();
        let app3 = app2.clone();
        let job = browser::FetchHooks {
            log: Arc::new(move |l: String| {
                emit(&app3, serde_json::json!({ "event": "log", "msg": l }));
            }),
            step: Arc::new(move |step: &'static str, msg: String| {
                emit(&app2, serde_json::json!({ "event": "step", "step": step, "msg": msg }));
            }),
        };
        let app_run = app.clone();
        let cancel_check = cancel.clone();
        let res = tauri::async_runtime::spawn_blocking(move || {
            browser::fetch_stream_hooks(
                &settings.gate_url,
                &emails,
                cdk.as_deref(),
                settings.max_seconds * 1000,
                Some(&settings.cpa_url),
                Some(&settings.browser_engine),
                &job,
                Some(&cancel),
            )
        })
        .await
        .map_err(|e| format!("任务调度失败：{}", e));

        match res {
            Ok(Ok(val)) => {
                emit(
                    &app_run,
                    serde_json::json!({ "event": "done", "result": val }),
                );

                // —— 自动衔接：CPA 输出 → dry-run 预览 → 真正写回（含恢复调度开关）——
                // 不再让用户手动点「打开 CPA 页 / 预览写回 / 确认写回」。预览信息照常
                // emit 到进度里（`preview` / `apply` 事件），前端直接展示。
                let cpa_output = val
                    .get("cpaPage")
                    .and_then(|v| v.get("output"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                if cancel_check.load(Ordering::Relaxed) {
                    emit(
                        &app_run,
                        serde_json::json!({ "event": "log", "msg": "已取消，跳过自动写回" }),
                    );
                } else if let Some(raw) = cpa_output {
                    match app_run.state::<AppState>().settings_snapshot().to_config() {
                        Ok(cfg) => {
                            // 1) dry-run：先算匹配计划并展示
                            emit(
                                &app_run,
                                serde_json::json!({ "event": "step", "step": "apply", "msg": "匹配账号并预览写回" }),
                            );
                            let cfg1 = cfg.clone();
                            let raw1 = raw.clone();
                            let dry = tauri::async_runtime::spawn_blocking(
                                move || -> Result<ApplyReport, String> {
                                    let mut client =
                                        Sub2ApiClient::login(&cfg1).map_err(|e| format!("{:#}", e))?;
                                    apply_value(&mut client, &raw1, false, None, None)
                                        .map_err(|e| format!("{:#}", e))
                                },
                            )
                            .await;

                            match dry {
                                Ok(Ok(preview)) => {
                                    let n = preview.plans.len();
                                    let skipped = preview.skipped.len();
                                    emit(
                                        &app_run,
                                        serde_json::json!({ "event": "preview", "report": preview }),
                                    );
                                    emit(
                                        &app_run,
                                        serde_json::json!({
                                            "event": "log",
                                            "msg": format!(
                                                "预览：匹配 {} 个账号{}；自动写回并恢复调度开关…",
                                                n,
                                                if skipped > 0 {
                                                    format!("，跳过 {} 项", skipped)
                                                } else {
                                                    String::new()
                                                }
                                            ),
                                        }),
                                    );

                                    // 2) 真正写回
                                    let applied = tauri::async_runtime::spawn_blocking(
                                        move || -> Result<ApplyReport, String> {
                                            let mut client = Sub2ApiClient::login(&cfg)
                                                .map_err(|e| format!("{:#}", e))?;
                                            apply_value(&mut client, &raw, true, None, None)
                                                .map_err(|e| format!("{:#}", e))
                                        },
                                    )
                                    .await;

                                    match applied {
                                        Ok(Ok(report)) => {
                                            let ok = report.outcomes.iter().filter(|o| o.ok).count();
                                            let bad = report.outcomes.len() - ok;
                                            emit(
                                                &app_run,
                                                serde_json::json!({ "event": "apply", "report": report }),
                                            );
                                            emit(
                                                &app_run,
                                                serde_json::json!({
                                                    "event": "step",
                                                    "step": "applied",
                                                    "msg": format!("写回完成：成功 {} / 失败 {}", ok, bad),
                                                }),
                                            );
                                        }
                                        Ok(Err(e)) => emit(
                                            &app_run,
                                            serde_json::json!({ "event": "error", "msg": format!("自动写回失败：{}", e) }),
                                        ),
                                        Err(e) => emit(
                                            &app_run,
                                            serde_json::json!({ "event": "error", "msg": format!("写回任务调度失败：{}", e) }),
                                        ),
                                    }
                                }
                                Ok(Err(e)) => emit(
                                    &app_run,
                                    serde_json::json!({ "event": "error", "msg": format!("预览失败（无匹配账号？）：{}", e) }),
                                ),
                                Err(e) => emit(
                                    &app_run,
                                    serde_json::json!({ "event": "error", "msg": format!("预览任务调度失败：{}", e) }),
                                ),
                            }
                        }
                        Err(e) => emit(
                            &app_run,
                            serde_json::json!({ "event": "error", "msg": format!("连接配置无效，跳过自动写回：{}", e) }),
                        ),
                    }
                } else {
                    emit(
                        &app_run,
                        serde_json::json!({ "event": "log", "msg": "没有拿到 CPA 输出，跳过自动写回" }),
                    );
                }

                emit(
                    &app_run,
                    serde_json::json!({ "event": "exit", "code": 0, "success": true }),
                );
            }
            Ok(Err(e)) => {
                let cancelled = format!("{:#}", e).contains("已取消");
                emit(
                    &app_run,
                    serde_json::json!({
                        "event": "error",
                        "msg": if cancelled { "已取消".to_string() } else { format!("{:#}", e) },
                    }),
                );
                emit(
                    &app_run,
                    serde_json::json!({ "event": "exit", "code": null, "success": false, "cancelled": cancelled }),
                );
            }
            Err(e) => {
                emit(&app_run, serde_json::json!({ "event": "error", "msg": e }));
                emit(
                    &app_run,
                    serde_json::json!({ "event": "exit", "code": null, "success": false }),
                );
            }
        }
        // 整个流程（含自动写回）结束后才释放任务槽
        app_run.state::<AppState>().clear_job();
    });
    Ok(count)
}

#[tauri::command]
pub fn cancel_reauth(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.cancel_job())
}

// ---------------------------------------------------------------------------
// 写回凭证
// ---------------------------------------------------------------------------

/// 把重授权结果（CPA 输出 JSON）按邮箱写回 sub2api 账号。
/// `yes=false` 只返回匹配计划（dry-run）；`yes=true` 真正写回。
#[tauri::command]
pub async fn apply_result(
    state: State<'_, AppState>,
    raw: String,
    yes: bool,
) -> Result<ApplyReport, String> {
    let cfg = state.settings_snapshot().to_config().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || -> Result<ApplyReport, String> {
        let mut client = Sub2ApiClient::login(&cfg).map_err(|e| format!("{:#}", e))?;
        apply_value(&mut client, &raw, yes, None, None).map_err(|e| format!("{:#}", e))
    })
    .await
    .map_err(|e| format!("任务调度失败：{}", e))?
}

/// 打开外部链接（走系统默认浏览器）。给「打开 401 门页 / CPA 页」用。
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";

    std::process::Command::new(cmd)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("打开链接失败：{}", e))?;
    Ok(())
}

/// 短暂睡眠（前端调试用；避免前端自己 setTimeout 造成误解）。
#[tauri::command]
pub async fn ping() -> String {
    tokio::time::sleep(Duration::from_millis(1)).await;
    "pong".to_string()
}
