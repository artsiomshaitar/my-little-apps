use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::Mutex;
use uuid::Uuid;

// App data structure matching our SQLite schema
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct App {
    pub id: String,
    pub name: String,
    pub path: String,
    pub command: String,
    pub port: Option<i32>,
    pub run_on_startup: bool,
    pub created_at: String,
}

// Running process info
#[derive(Debug)]
pub struct RunningProcess {
    pub child: CommandChild,
    pub port: i32,
}

// App state to track running processes
pub struct AppState {
    pub processes: Arc<Mutex<HashMap<String, RunningProcess>>>,
    pub logs: Arc<Mutex<HashMap<String, Vec<String>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            logs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// Find a free port in the given range
fn find_free_port(preferred: Option<i32>) -> Option<i32> {
    if let Some(port) = preferred {
        if TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
            return Some(port);
        }
    }

    // Try random ports in range 10000-60000
    for _ in 0..100 {
        let port = 10000 + (rand_port() % 50000) as i32;
        if TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

// Simple random number for port selection
fn rand_port() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    nanos
}

#[tauri::command]
fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

#[tauri::command]
fn get_free_port(preferred: Option<i32>) -> Result<i32, String> {
    find_free_port(preferred).ok_or_else(|| "Could not find a free port".to_string())
}

#[tauri::command]
async fn read_package_json(path: String) -> Result<serde_json::Value, String> {
    let package_path = std::path::Path::new(&path).join("package.json");
    let content = std::fs::read_to_string(&package_path)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse package.json: {}", e))
}

#[tauri::command]
async fn start_app(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    id: String,
    path: String,
    command: String,
    port: i32,
) -> Result<i32, String> {
    let mut processes = state.processes.lock().await;

    // Check if already running
    if processes.contains_key(&id) {
        return Err("App is already running".to_string());
    }

    // Find a free port
    let actual_port =
        find_free_port(Some(port)).ok_or_else(|| "Could not find a free port".to_string())?;

    // Parse command
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Invalid command".to_string());
    }

    let program = parts[0];
    let args: Vec<&str> = parts[1..].to_vec();

    // Create shell command with PORT env variable
    let shell = app_handle.shell();
    let cmd = shell
        .command(program)
        .args(args)
        .current_dir(&path)
        .env("PORT", actual_port.to_string());

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("Failed to start app: {}", e))?;

    // Store the process
    processes.insert(
        id.clone(),
        RunningProcess {
            child,
            port: actual_port,
        },
    );

    // Initialize logs for this app
    {
        let mut logs = state.logs.lock().await;
        logs.insert(id.clone(), Vec::new());
    }

    // Spawn a task to capture output
    let logs = state.logs.clone();
    let app_id = id.clone();
    let handle = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Ok(line) = String::from_utf8(bytes) {
                        let mut logs_guard = logs.lock().await;
                        if let Some(app_logs) = logs_guard.get_mut(&app_id) {
                            app_logs.push(format!("[stdout] {}", line.trim()));
                            // Keep only last 500 lines
                            if app_logs.len() > 500 {
                                app_logs.remove(0);
                            }
                        }
                        // Emit log event to frontend
                        let _ = handle.emit(
                            "app-log",
                            serde_json::json!({
                                "id": app_id,
                                "type": "stdout",
                                "message": line.trim()
                            }),
                        );
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Ok(line) = String::from_utf8(bytes) {
                        let mut logs_guard = logs.lock().await;
                        if let Some(app_logs) = logs_guard.get_mut(&app_id) {
                            app_logs.push(format!("[stderr] {}", line.trim()));
                            if app_logs.len() > 500 {
                                app_logs.remove(0);
                            }
                        }
                        let _ = handle.emit(
                            "app-log",
                            serde_json::json!({
                                "id": app_id,
                                "type": "stderr",
                                "message": line.trim()
                            }),
                        );
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let _ = handle.emit(
                        "app-stopped",
                        serde_json::json!({
                            "id": app_id,
                            "code": payload.code
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    // Emit started event
    let _ = app_handle.emit(
        "app-started",
        serde_json::json!({
            "id": id,
            "port": actual_port
        }),
    );

    Ok(actual_port)
}

#[tauri::command]
async fn stop_app(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut processes = state.processes.lock().await;

    if let Some(process) = processes.remove(&id) {
        process
            .child
            .kill()
            .map_err(|e| format!("Failed to stop app: {}", e))?;

        let _ = app_handle.emit(
            "app-stopped",
            serde_json::json!({
                "id": id,
                "code": null
            }),
        );
    }

    Ok(())
}

#[tauri::command]
async fn get_app_status(state: State<'_, AppState>, id: String) -> Result<Option<i32>, String> {
    let processes = state.processes.lock().await;
    Ok(processes.get(&id).map(|p| p.port))
}

#[tauri::command]
async fn get_running_apps(state: State<'_, AppState>) -> Result<HashMap<String, i32>, String> {
    let processes = state.processes.lock().await;
    Ok(processes.iter().map(|(k, v)| (k.clone(), v.port)).collect())
}

#[tauri::command]
async fn get_app_logs(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let logs = state.logs.lock().await;
    Ok(logs.get(&id).cloned().unwrap_or_default())
}

#[tauri::command]
async fn open_in_browser(port: i32) -> Result<(), String> {
    let url = format!("http://localhost:{}", port);
    open::that(&url).map_err(|e| format!("Failed to open browser: {}", e))
}

fn update_tray_menu(app: &AppHandle, apps: Vec<App>, running: &HashMap<String, i32>) {
    let tray = app.tray_by_id("main-tray");
    if tray.is_none() {
        return;
    }
    let tray = tray.unwrap();

    // Build menu items
    let mut menu_builder = Menu::with_id(app, "tray-menu");
    
    if let Ok(menu) = &mut menu_builder {
        // Add app items
        for app_data in &apps {
            let status = if let Some(port) = running.get(&app_data.id) {
                format!("{} (:{}) - Running", app_data.name, port)
            } else {
                format!("{} - Stopped", app_data.name)
            };

            if let Ok(item) = MenuItem::with_id(app, &app_data.id, &status, true, None::<&str>) {
                let _ = menu.append(&item);
            }
        }

        // Add separator if there are apps
        if !apps.is_empty() {
            if let Ok(sep) = PredefinedMenuItem::separator(app) {
                let _ = menu.append(&sep);
            }
        }

        // Add settings item
        if let Ok(settings) = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>) {
            let _ = menu.append(&settings);
        }

        // Add quit item
        if let Ok(quit) = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>) {
            let _ = menu.append(&quit);
        }

        let _ = tray.set_menu(Some(menu.clone()));
    }
}

#[tauri::command]
async fn refresh_tray(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    apps: Vec<App>,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let running: HashMap<String, i32> = processes.iter().map(|(k, v)| (k.clone(), v.port)).collect();
    update_tray_menu(&app_handle, apps, &running);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Define database migrations
    let migrations = vec![Migration {
        version: 1,
        description: "create_apps_table",
        sql: r#"
            CREATE TABLE IF NOT EXISTS apps (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                command TEXT NOT NULL DEFAULT 'bun start',
                port INTEGER,
                run_on_startup INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        "#,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:my-little-apps.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            // Load tray icon from PNG file
            let icon_bytes = include_bytes!("../icons/icon.png");
            let img = image::load_from_memory(icon_bytes).expect("Failed to load icon");
            let rgba = img.to_rgba8();
            let (width, height) = rgba.dimensions();
            let icon = Image::new_owned(rgba.into_raw(), width, height);

            // Create initial menu
            let menu = Menu::with_id(app, "tray-menu")?;
            let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            menu.append(&settings)?;
            menu.append(&quit)?;

            // Build tray
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    match id {
                        "settings" => {
                            // Show or create settings window
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            } else {
                                let _ = WebviewWindowBuilder::new(
                                    app,
                                    "main",
                                    tauri::WebviewUrl::App("index.html".into()),
                                )
                                .title("My Little Apps")
                                .inner_size(900.0, 650.0)
                                .build();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {
                            // App item clicked - emit event to open in browser
                            let _ = app.emit("open-app", id);
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Hide the main window on startup if launched with --minimized
            if std::env::args().any(|arg| arg == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_id,
            get_free_port,
            read_package_json,
            start_app,
            stop_app,
            get_app_status,
            get_running_apps,
            get_app_logs,
            open_in_browser,
            refresh_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
