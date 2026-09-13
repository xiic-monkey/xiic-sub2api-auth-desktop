//! Tauri 命令层：把核心库（sub2api-operator）的能力暴露给界面。
//!
//! 设计要点：
//! - 阻塞型 API 调用放进 `spawn_blocking`，不卡 UI 线程；
//! - 重授权 worker 用 `--progress` 输出 NDJSON，逐行转发成 Tauri 事件 `reauth:event`；
//! - 敏感值（token）只经事件 / 后端内部流转，`PlanItem.credentials` 不随 JSON 回传前端。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

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
    pub worker_root: String,
    pub worker_script: String,
    pub worker_ready: bool,
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
    pub account: String,
    pub password: String,
    pub cdk: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// 基础命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    let worker_script = state.worker_script();
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: state.data_dir.display().to_string(),
        worker_root: state.worker_root.display().to_string(),
        worker_script: worker_script.display().to_string(),
        worker_ready: worker_script.exists(),
    }
}

#[tauri::command]
pub async fn check_engines(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    let worker = state.worker_script();
    if !worker.exists() {
        return Err(format!(
            "找不到浏览器 worker：{}\n（开发期请确认同级存在 xiic-sub2api-authorize/browser-worker/）",
            worker.display()
        ));
    }
    let out = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("node")
            .arg(&worker)
            .arg("check")
            .output()
    })
    .await
    .map_err(|e| format!("任务调度失败：{}", e))?
    .map_err(|e| format!("执行 node 失败（确认已安装 Node.js）：{}", e))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str::<EngineStatus>(&stdout).map_err(|e| {
        format!(
            "解析引擎检测结果失败：{}\n原始输出：{}",
            e,
            stdout.chars().take(300).collect::<String>()
        )
    })
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
            account: c.account,
            password: c.password,
            cdk: c.cdk,
            updated_at: c.updated_at,
        }),
        Ok(None) => Ok(CredentialView {
            exists: false,
            account: String::new(),
            password: String::new(),
            cdk: String::new(),
            updated_at: String::new(),
        }),
        Err(e) => Err(format!("读取凭证库失败：{}", e)),
    }
}

#[tauri::command]
pub fn save_credentials(
    account: String,
    password: String,
    cdk: String,
) -> Result<CredentialView, String> {
    // 密码留空 = 保留原密码（避免脱敏展示后误清空）
    store::save(&account, &password, &cdk, true).map_err(|e| format!("保存凭证失败：{}", e))?;
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
    if state.pid().is_some() {
        return Err("已有重授权任务在跑，请先等它结束或点「终止」".to_string());
    }
    let settings = state.settings_snapshot();
    settings.to_config().map_err(|e| e.to_string())?; // 提前校验连接配置
    let worker = state.worker_script();
    if !worker.exists() {
        return Err(format!("找不到浏览器 worker：{}", worker.display()));
    }
    let root = state.worker_root.clone();

    // CDK 复用本地凭证库
    let cdk = store::load()
        .ok()
        .flatten()
        .map(|c| c.cdk)
        .filter(|s| !s.is_empty());

    let count = emails.len();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        run_worker(app2, worker, root, settings, emails, cdk).await;
    });
    Ok(count)
}

async fn run_worker(
    app: AppHandle,
    worker: PathBuf,
    root: PathBuf,
    s: Settings,
    emails: Vec<String>,
    cdk: Option<String>,
) {
    let mut cmd = TokioCommand::new("node");
    cmd.arg(&worker)
        .arg("fetch")
        .arg(&s.gate_url)
        .arg("--emails")
        .arg(emails.join("\n"))
        .arg("--browser")
        .arg(&s.browser_engine)
        .arg("--progress")
        .arg("--max")
        .arg((s.max_seconds * 1000).to_string())
        .arg("--then-open")
        .arg(&s.cpa_url)
        .env("SUB2OP_ROOT", &root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(c) = cdk.as_deref() {
        cmd.arg("--cdk").arg(c);
    }

    emit(
        &app,
        serde_json::json!({
            "event": "step", "step": "spawn",
            "msg": format!("启动浏览器自动化（引擎 {}，{} 个邮箱）", s.browser_engine, emails.len()),
        }),
    );

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit(
                &app,
                serde_json::json!({ "event": "error", "msg": format!("启动 node 失败：{}", e) }),
            );
            emit(&app, serde_json::json!({ "event": "exit", "code": null }));
            return;
        }
    };

    let pid = child.id();
    // 记录 pid 供「终止」使用
    if let Some(p) = pid {
        app.state::<AppState>().set_pid(Some(p));
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // stdout：NDJSON 进度事件，原样透传
    let app_out = app.clone();
    let t_out = tokio::spawn(async move {
        if let Some(out) = stdout {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let v = serde_json::from_str::<serde_json::Value>(line)
                    .unwrap_or_else(|_| serde_json::json!({ "event": "raw", "line": line }));
                emit(&app_out, v);
            }
        }
    });

    // stderr：人类可读日志（poll 明细等）
    let app_err = app.clone();
    let t_err = tokio::spawn(async move {
        if let Some(err) = stderr {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                emit(
                    &app_err,
                    serde_json::json!({ "event": "log", "msg": line.trim() }),
                );
            }
        }
    });

    let status = child.wait().await;
    let _ = t_out.await;
    let _ = t_err.await;

    app.state::<AppState>().set_pid(None);
    let code = status.ok().and_then(|s| s.code());
    emit(
        &app,
        serde_json::json!({ "event": "exit", "code": code, "success": code == Some(0) }),
    );
}

#[tauri::command]
pub fn cancel_reauth(state: State<'_, AppState>) -> Result<bool, String> {
    match state.pid() {
        Some(pid) => {
            // worker 会连带关闭它启动的浏览器
            let ok = std::process::Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            state.set_pid(None);
            Ok(ok)
        }
        None => Ok(false),
    }
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
