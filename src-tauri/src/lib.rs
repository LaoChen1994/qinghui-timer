mod sharing;
mod timer;

use serde::Serialize;
use sharing::{ImportChoice, ImportSummary, SharedFile, SharedTimer};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use timer::{Alert, AlertKind, Store, Timer};

struct Engine {
    store: Store,
    path: PathBuf,
    storage_error: Option<String>,
    notification_error: Option<String>,
}

impl Engine {
    fn commit(&mut self, store: Store) -> Result<(), String> {
        let json =
            serde_json::to_vec(&store).map_err(|error| format!("计时记录保存失败：{error}"))?;
        let temporary_path = self.path.with_extension("tmp");
        let mut file = fs::File::create(&temporary_path)
            .map_err(|error| format!("计时记录保存失败：{error}"))?;
        file.write_all(&json)
            .map_err(|error| format!("计时记录保存失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("计时记录保存失败：{error}"))?;
        drop(file);
        fs::rename(&temporary_path, &self.path)
            .map_err(|error| format!("计时记录保存失败：{error}"))?;
        self.store = store;
        self.storage_error = None;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    timers: Vec<Timer>,
    alerts: Vec<Alert>,
    now: u64,
    storage_error: Option<String>,
    notification_error: Option<String>,
}

fn timestamp() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间须晚于 1970 年")
            .as_millis(),
    )
    .expect("系统时间超出支持范围")
}

#[tauri::command]
fn get_snapshot(state: State<Mutex<Engine>>) -> Result<Snapshot, String> {
    let engine = state.lock().map_err(|error| error.to_string())?;
    Ok(Snapshot {
        timers: engine.store.timers.clone(),
        alerts: engine.store.alerts.clone(),
        now: timestamp(),
        storage_error: engine.storage_error.clone(),
        notification_error: engine.notification_error.clone(),
    })
}

#[tauri::command]
fn add_timer(name: String, minutes: u32, state: State<Mutex<Engine>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|error| error.to_string())?;
    let mut store = engine.store.clone();
    store.add(&name, minutes, timestamp())?;
    engine.commit(store)
}

#[tauri::command]
fn reset_timer(id: u64, state: State<Mutex<Engine>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|error| error.to_string())?;
    let mut store = engine.store.clone();
    store.reset(id, timestamp())?;
    engine.commit(store)
}

#[tauri::command]
fn delete_timer(id: u64, state: State<Mutex<Engine>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|error| error.to_string())?;
    let mut store = engine.store.clone();
    store.remove(id)?;
    engine.commit(store)
}

#[tauri::command]
fn acknowledge_alerts(ids: Vec<String>, state: State<Mutex<Engine>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|error| error.to_string())?;
    let mut store = engine.store.clone();
    store.alerts.retain(|alert| !ids.contains(&alert.id));
    engine.commit(store)
}

#[tauri::command]
async fn preview_import(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<SharedFile>, String> {
    window
        .set_focus()
        .map_err(|error| format!("无法激活文件选择窗口：{error}"))?;
    let Some(file) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("导入怪物计时记录")
        .add_filter("青回传世计时分享文件", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|error| format!("无法读取文件路径：{error}"))?;
    let json = fs::read(path).map_err(|error| format!("分享文件读取失败：{error}"))?;
    let mut shared: SharedFile =
        serde_json::from_slice(&json).map_err(|error| format!("分享文件格式错误：{error}"))?;
    for timer in &mut shared.timers {
        timer.name = timer.name.trim().into();
    }
    shared.validate()?;
    Ok(Some(shared))
}

#[tauri::command]
fn confirm_import(
    file: SharedFile,
    choices: Vec<ImportChoice>,
    state: State<Mutex<Engine>>,
) -> Result<ImportSummary, String> {
    let mut engine = state.lock().map_err(|error| error.to_string())?;
    let (store, summary) = engine.store.merge_shared(&file, &choices, timestamp())?;
    if summary.added + summary.updated > 0 {
        engine.commit(store)?;
    }
    Ok(summary)
}

#[tauri::command]
async fn export_timers(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Mutex<Engine>>,
) -> Result<Option<String>, String> {
    let json = {
        let engine = state.lock().map_err(|error| error.to_string())?;
        let file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: timestamp(),
            timers: engine
                .store
                .timers
                .iter()
                .map(|timer| SharedTimer {
                    name: timer.name.clone(),
                    minutes: timer.minutes,
                    started_at: timer.started_at,
                    deadline: timer.deadline,
                })
                .collect(),
        };
        serde_json::to_vec_pretty(&file).map_err(|error| format!("分享文件生成失败：{error}"))?
    };
    window
        .set_focus()
        .map_err(|error| format!("无法激活文件保存窗口：{error}"))?;
    let Some(file) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("导出怪物计时记录")
        .set_file_name("青回传世怪物计时记录.json")
        .add_filter("青回传世计时分享文件", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|error| format!("无法读取保存路径：{error}"))?;
    fs::write(&path, json).map_err(|error| format!("分享文件保存失败：{error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            fs::create_dir_all(&directory)?;
            let path = directory.join("timers.json");
            let store = match fs::read(&path) {
                Ok(json) => serde_json::from_slice(&json)?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Store::default(),
                Err(error) => return Err(error.into()),
            };
            app.manage(Mutex::new(Engine {
                store,
                path,
                storage_error: None,
                notification_error: None,
            }));
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let state = handle.state::<Mutex<Engine>>();
                if let Ok(mut engine) = state.lock() {
                    let mut store = engine.store.clone();
                    let alerts = store.advance(timestamp());
                    if !alerts.is_empty() {
                        if let Err(error) = engine.commit(store) {
                            engine.storage_error = Some(error);
                            drop(engine);
                            std::thread::sleep(Duration::from_secs(1));
                            continue;
                        }
                        for alert in alerts {
                            let remaining =
                                alert.deadline.saturating_sub(timestamp()).div_ceil(1_000);
                            let message = match alert.kind {
                                AlertKind::Warning => format!(
                                    "{} 即将刷新，剩余 {} 分 {} 秒。",
                                    alert.name,
                                    remaining / 60,
                                    remaining % 60
                                ),
                                AlertKind::Ready => {
                                    format!("{} 已经刷新，可以出发了！", alert.name)
                                }
                            };
                            if let Err(error) = handle
                                .notification()
                                .builder()
                                .title("青回传世 · 刷新提醒")
                                .body(message)
                                .show()
                            {
                                engine.notification_error = Some(format!(
                                    "系统通知发送失败：{error}，应用内弹框仍然有效。"
                                ));
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_secs(1));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            add_timer,
            reset_timer,
            delete_timer,
            acknowledge_alerts,
            preview_import,
            confirm_import,
            export_timers
        ])
        .run(tauri::generate_context!())
        .expect("青回传世怪物计时器启动失败");
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn failed_save_keeps_the_last_committed_state() {
        let mut engine = Engine {
            store: Store::default(),
            path: std::env::temp_dir()
                .join(format!("qinghui-missing-{}", timestamp()))
                .join("timers.json"),
            storage_error: None,
            notification_error: None,
        };
        let mut next = engine.store.clone();
        next.add("逆魔", 40, 1_000).unwrap();
        assert!(engine.commit(next).is_err());
        assert!(engine.store.timers.is_empty());
    }

    #[test]
    fn atomic_save_supports_replacing_existing_records() {
        let directory = std::env::temp_dir().join(format!(
            "qinghui-storage-{}-{}",
            std::process::id(),
            timestamp()
        ));
        fs::create_dir_all(&directory).unwrap();
        let mut engine = Engine {
            store: Store::default(),
            path: directory.join("timers.json"),
            storage_error: None,
            notification_error: None,
        };
        let mut next = engine.store.clone();
        next.add("通天教主", 90, 1_000).unwrap();
        engine.commit(next).unwrap();
        let mut next = engine.store.clone();
        next.reset(1, 10_000).unwrap();
        engine.commit(next).unwrap();
        let restored: Store = serde_json::from_slice(&fs::read(&engine.path).unwrap()).unwrap();
        assert_eq!(restored.timers[0].started_at, 10_000);
        assert_eq!(restored.timers[0].deadline, 5_410_000);
        assert!(!engine.path.with_extension("tmp").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
