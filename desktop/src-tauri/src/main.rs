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

const PORT: u16 = 8429;
const MAIN: &str = "main";
const START_TIMEOUT: Duration = Duration::from_secs(30);

struct Server(Mutex<Option<Child>>);

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

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let autostart_on = handle.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItem::with_id(handle, "open", "Open Agent Hands", true, None::<&str>)?;
    let browser = MenuItem::with_id(handle, "browser", "Open in Browser", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(handle, "autostart", "Start at Login", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", "Quit Open Agent Hands", true, None::<&str>)?;
    let separator = || PredefinedMenuItem::separator(handle);
    let menu = Menu::with_items(handle, &[&open, &browser, &separator()?, &autostart, &separator()?, &quit])?;

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
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Open Agent Hands")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            build_tray(app)?;
            boot(app.handle().clone());
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
