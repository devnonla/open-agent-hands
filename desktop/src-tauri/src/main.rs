#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const PORT: u16 = 8429;
const MAIN: &str = "main";
const START_TIMEOUT: Duration = Duration::from_secs(30);
const UPDATER_PUBKEY: Option<&str> = option_env!("AGENTHANDS_UPDATER_PUBKEY");
const UPDATER_ENDPOINT: Option<&str> = option_env!("AGENTHANDS_UPDATER_ENDPOINT");
const UPDATE_FIRST_CHECK: Duration = Duration::from_secs(15);
const UPDATE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

struct Server(Mutex<Option<Child>>);

#[derive(Default)]
struct Updates {
    busy: Mutex<bool>,
    skipped: Mutex<Option<String>>,
    pending: Mutex<Option<String>>,
    item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

fn updater_config() -> Option<(&'static str, &'static str)> {
    match (UPDATER_PUBKEY, UPDATER_ENDPOINT) {
        (Some(key), Some(url)) if !key.is_empty() && !url.is_empty() => Some((key, url)),
        _ => None,
    }
}

enum Health {
    Ours,
    Other,
    Down,
}

fn base_url() -> String {
    format!("http://127.0.0.1:{PORT}")
}

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".open-agent-hands")
}

fn log_path() -> PathBuf {
    data_dir().join("logs").join("server.log")
}

fn health() -> Health {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return Health::Down;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return Health::Other;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    if response.contains("\"app\":\"agenthands\"") {
        Health::Ours
    } else {
        Health::Other
    }
}

fn spawn_server() -> std::io::Result<Child> {
    let exe = std::env::current_exe()?;
    let binary = exe.with_file_name("agenthands");
    let log = log_path();
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let out = std::fs::OpenOptions::new().create(true).append(true).open(&log)?;
    Command::new(binary)
        .args(["--port", &PORT.to_string()])
        .stdin(Stdio::null())
        .stdout(out.try_clone()?)
        .stderr(out)
        .spawn()
}

fn stop_server(app: &AppHandle) {
    let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() else {
        return;
    };
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn server_exited(app: &AppHandle) -> bool {
    let state = app.state::<Server>();
    let mut guard = state.0.lock().unwrap();
    match guard.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(Some(_))),
        None => false,
    }
}

fn set_status(app: &AppHandle, kind: &str, text: &str) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let kind = serde_json::to_string(kind).unwrap_or_default();
        let text = serde_json::to_string(text).unwrap_or_default();
        let _ = window.eval(&format!("window.setStatus && window.setStatus({kind}, {text})"));
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_in_browser() {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    let _ = Command::new(opener).arg(base_url()).spawn();
}

fn boot(app: AppHandle) {
    std::thread::spawn(move || {
        match health() {
            Health::Ours => {}
            Health::Other => {
                set_status(&app, "error", &format!("Port {PORT} is used by another app. Stop it, then reopen Open Agent Hands."));
                return;
            }
            Health::Down => match spawn_server() {
                Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
                Err(err) => {
                    set_status(&app, "error", &format!("Could not start the server: {err}"));
                    return;
                }
            },
        }

        let deadline = Instant::now() + START_TIMEOUT;
        while Instant::now() < deadline {
            if matches!(health(), Health::Ours) {
                if let (Some(window), Ok(url)) = (app.get_webview_window(MAIN), base_url().parse()) {
                    let _ = window.navigate(url);
                }
                return;
            }
            if server_exited(&app) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        set_status(&app, "error", &format!("The server did not start. See {}", log_path().display()));
    });
}

fn message(app: &AppHandle, kind: MessageDialogKind, text: String) {
    app.dialog().message(text).title("Open Agent Hands").kind(kind).blocking_show();
}

fn ask(app: &AppHandle, text: String, ok: &str, cancel: &str) -> bool {
    app.dialog()
        .message(text)
        .title("Open Agent Hands")
        .buttons(MessageDialogButtons::OkCancelCustom(ok.into(), cancel.into()))
        .blocking_show()
}

fn log_update(text: &str) {
    let path = data_dir().join("logs").join("desktop.log");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(file, "[{now}] update: {text}");
    }
}

fn set_update_item(app: &AppHandle, text: &str, enabled: bool) {
    if let Some(item) = app.state::<Updates>().item.lock().unwrap().as_ref() {
        let _ = item.set_text(text);
        let _ = item.set_enabled(enabled);
    }
}

fn reset_update_item(app: &AppHandle) {
    let pending = app.state::<Updates>().pending.lock().unwrap().clone();
    let tooltip = match &pending {
        Some(version) => format!("Open Agent Hands - update {version} available"),
        None => "Open Agent Hands".to_string(),
    };
    match pending {
        Some(version) => set_update_item(app, &format!("Install Update {version}…"), true),
        None => set_update_item(app, "Check for Updates…", true),
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn show_progress(app: &AppHandle, text: &str, percent: u32) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    let text = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into());
    let script = format!(
        r#"(function(){{var e=document.getElementById('__ah_update');if(!e){{e=document.createElement('div');e.id='__ah_update';e.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#18181b;color:#fff;padding:12px 16px;border-radius:10px;font:13px -apple-system,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);min-width:280px';e.innerHTML='<div id="__ah_update_text"></div><div style="height:4px;background:#3f3f46;border-radius:2px;margin-top:8px;overflow:hidden"><div id="__ah_update_bar" style="height:100%;width:0;background:#8b5cf6;transition:width .2s"></div></div>';(document.body||document.documentElement).appendChild(e);}}document.getElementById('__ah_update_text').textContent={text};document.getElementById('__ah_update_bar').style.width='{percent}%';}})();"#
    );
    let _ = window.eval(&script);
}

fn hide_progress(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.eval("var e=document.getElementById('__ah_update');if(e)e.remove();");
    }
}

async fn check_for_update(app: AppHandle, manual: bool) {
    let Some((_, endpoint)) = updater_config() else { return };
    {
        let state = app.state::<Updates>();
        let mut busy = state.busy.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
    }
    if manual {
        set_update_item(&app, "Checking for Updates…", false);
    }
    let result = run_update_check(&app, endpoint, manual).await;
    *app.state::<Updates>().busy.lock().unwrap() = false;
    if let Err(err) = result {
        log_update(&format!("check failed: {err}"));
        if manual {
            message(&app, MessageDialogKind::Error, format!("Could not check for updates: {err}"));
        }
    }
    reset_update_item(&app);
}

async fn run_update_check(app: &AppHandle, endpoint: &str, manual: bool) -> Result<(), String> {
    let url = endpoint.parse().map_err(|e| format!("{e}"))?;
    let updater = app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        *app.state::<Updates>().pending.lock().unwrap() = None;
        if manual {
            let current = app.package_info().version.to_string();
            message(app, MessageDialogKind::Info, format!("You're up to date. Open Agent Hands {current} is the latest version."));
        }
        return Ok(());
    };

    log_update(&format!("{} is available (running {})", update.version, update.current_version));
    *app.state::<Updates>().pending.lock().unwrap() = Some(update.version.clone());
    reset_update_item(app);

    let skipped = app.state::<Updates>().skipped.lock().unwrap().clone();
    if !manual && skipped.as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }

    show_main(app);
    let mut text = format!("Open Agent Hands {} is available. You have {}.", update.version, update.current_version);
    if let Some(notes) = update.body.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        let notes: String = notes.chars().take(600).collect();
        text.push_str(&format!("\n\n{notes}"));
    }
    text.push_str("\n\nThe app restarts after the update. Your data stays where it is.");
    if !ask(app, text, "Install and Restart", "Later") {
        *app.state::<Updates>().skipped.lock().unwrap() = Some(update.version.clone());
        return Ok(());
    }

    let version = update.version.clone();
    show_main(app);
    set_update_item(app, "Downloading update… 0%", false);
    show_progress(app, &format!("Downloading Open Agent Hands {version}… 0%"), 0);

    let mut downloaded: u64 = 0;
    let mut last_percent: u32 = 101;
    let installed = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let Some(total) = total.filter(|t| *t > 0) else { return };
                let percent = ((downloaded * 100) / total).min(100) as u32;
                if percent != last_percent {
                    last_percent = percent;
                    set_update_item(app, &format!("Downloading update… {percent}%"), false);
                    show_progress(app, &format!("Downloading Open Agent Hands {version}… {percent}%"), percent);
                }
            },
            || {
                set_update_item(app, "Installing update…", false);
                show_progress(app, "Installing. The app restarts in a moment.", 100);
            },
        )
        .await;

    if let Err(err) = installed {
        hide_progress(app);
        log_update(&format!("install failed: {err}"));
        message(app, MessageDialogKind::Error, format!("The update could not be installed: {err}\n\nYour current version keeps working. Try again from the menu bar."));
        return Ok(());
    }

    log_update(&format!("installed {version}, restarting"));
    stop_server(app);
    app.restart();
}

fn start_update_checks(app: &AppHandle) {
    if updater_config().is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(UPDATE_FIRST_CHECK).await;
        loop {
            check_for_update(app.clone(), false).await;
            tokio::time::sleep(UPDATE_INTERVAL).await;
        }
    });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let autostart_on = handle.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItem::with_id(handle, "open", "Open Agent Hands", true, None::<&str>)?;
    let browser = MenuItem::with_id(handle, "browser", "Open in Browser", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(handle, "autostart", "Start at Login", true, autostart_on, None::<&str>)?;
    let updates = MenuItem::with_id(handle, "updates", "Check for Updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", "Quit Open Agent Hands", true, None::<&str>)?;
    let separator = || PredefinedMenuItem::separator(handle);
    let menu = Menu::with_items(handle, &[&open, &browser, &separator()?, &autostart, &separator()?, &quit])?;
    if updater_config().is_some() {
        menu.insert(&updates, 3)?;
    }

    if updater_config().is_some() {
        *handle.state::<Updates>().item.lock().unwrap() = Some(updates.clone());
    }

    let toggle = autostart.clone();
    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Open Agent Hands")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "browser" => open_in_browser(),
            "autostart" => {
                let launcher = app.autolaunch();
                let enabled = launcher.is_enabled().unwrap_or(false);
                let _ = if enabled { launcher.disable() } else { launcher.enable() };
                let _ = toggle.set_checked(launcher.is_enabled().unwrap_or(false));
            }
            "updates" => {
                let app = app.clone();
                tauri::async_runtime::spawn(check_for_update(app, true));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init());
    if let Some((pubkey, _)) = updater_config() {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().pubkey(pubkey).build());
    }
    let app = builder
        .manage(Server(Mutex::new(None)))
        .manage(Updates::default())
        .setup(|app| {
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Open Agent Hands")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            build_tray(app)?;
            boot(app.handle().clone());
            start_update_checks(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Open Agent Hands");

    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::Exit => stop_server(app),
        _ => {}
    });
}
