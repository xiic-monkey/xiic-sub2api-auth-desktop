//! 应用状态：数据目录、运行中的重授权任务（取消令牌）。

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::commands::Settings;

pub struct AppState {
    /// 应用数据目录（credentials.db / settings.json 落这里）
    pub data_dir: PathBuf,
    /// 内存中的设置副本
    pub settings: Mutex<Settings>,
    /// 正在跑的重授权任务：Some=运行中，Arc 里的标志位用于取消
    job: Mutex<Option<Arc<AtomicBool>>>,
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

    /// 有任务在跑时返回其取消令牌。
    pub fn job(&self) -> Option<Arc<AtomicBool>> {
        self.job.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_job(&self, token: Arc<AtomicBool>) {
        if let Ok(mut g) = self.job.lock() {
            *g = Some(token);
        }
    }

    pub fn clear_job(&self) {
        if let Ok(mut g) = self.job.lock() {
            *g = None;
        }
    }

    /// 置取消标志；任务在下一次轮询前（最多 5 秒）自行结束并关闭浏览器。
    pub fn cancel_job(&self) -> bool {
        match self.job() {
            Some(token) => {
                token.store(true, std::sync::atomic::Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

/// 启动时初始化：建数据目录、把 cwd 切过去（让 credentials.db 落在数据目录）、装载设置进内存。
pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let data_dir = handle.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    // 核心库里的 store 用相对路径（credentials.db），这里把 cwd 固定到数据目录。
    std::env::set_current_dir(&data_dir)?;

    let settings = crate::commands::load_settings_from(&data_dir);
    app.manage(AppState {
        data_dir,
        settings: Mutex::new(settings),
        job: Mutex::new(None),
    });
    Ok(())
}
