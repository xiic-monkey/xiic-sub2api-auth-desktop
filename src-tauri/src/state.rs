//! 应用状态：数据目录、浏览器 worker 定位、运行中的重授权进程。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::commands::Settings;

pub struct AppState {
    /// 应用数据目录（credentials.db / settings.json 落这里）
    pub data_dir: PathBuf,
    /// 含 `browser-worker/worker.js` 的目录（注入给 worker 的 SUB2OP_ROOT）
    pub worker_root: PathBuf,
    /// 内存中的设置副本
    pub settings: Mutex<Settings>,
    /// 正在跑的重授权子进程 pid（用于取消）
    pub reauth_pid: Mutex<Option<u32>>,
}

fn has_worker(dir: &Path) -> bool {
    dir.join("browser-worker").join("worker.js").exists()
}

/// 依次尝试：环境变量 → 打包资源目录 → 开发期同级原项目 → 当前目录。
fn resolve_worker_root(app: &AppHandle) -> PathBuf {
    // 1) 环境变量（手动指定 / 容器里注入）
    if let Ok(p) = std::env::var("SUB2OP_ROOT") {
        let pb = PathBuf::from(&p);
        if has_worker(&pb) {
            return pb;
        }
    }
    // 2) 打包后的资源目录
    if let Ok(rd) = app.path().resource_dir() {
        for cand in [rd.join("resources"), rd.clone()] {
            if has_worker(&cand) {
                return cand;
            }
        }
    }
    // 3) 开发期：同级目录里的原项目（worker 只有一份，不复制维护）
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../xiic-sub2api-authorize");
    if has_worker(&dev) {
        return dev;
    }
    // 4) 兜底
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

impl AppState {
    pub fn set_settings(&self, s: Settings) {
        if let Ok(mut g) = self.settings.lock() {
            *g = s;
        }
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| Settings::default())
    }

    pub fn worker_script(&self) -> PathBuf {
        self.worker_root.join("browser-worker").join("worker.js")
    }

    pub fn set_pid(&self, pid: Option<u32>) {
        if let Ok(mut g) = self.reauth_pid.lock() {
            *g = pid;
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.reauth_pid.lock().ok().and_then(|g| *g)
    }
}

/// 启动时初始化：建数据目录、把 cwd 切过去（让 credentials.db / config.toml 落在数据目录）、
/// 解析 worker 目录并注入 SUB2OP_ROOT、装载设置进内存。
pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let data_dir = handle.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    // 核心库里的 store 用相对路径（credentials.db），这里把 cwd 固定到数据目录。
    std::env::set_current_dir(&data_dir)?;

    let worker_root = resolve_worker_root(&handle);
    // 核心库的 browser 模块优先读 SUB2OP_ROOT 定位 worker。
    std::env::set_var("SUB2OP_ROOT", &worker_root);

    let settings = crate::commands::load_settings_from(&data_dir);
    app.manage(AppState {
        data_dir,
        worker_root,
        settings: Mutex::new(settings),
        reauth_pid: Mutex::new(None),
    });
    Ok(())
}
