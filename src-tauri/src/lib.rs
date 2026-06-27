use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
};

#[derive(Clone, Copy, Debug, serde::Deserialize)]
struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
struct BrowserPageEvent {
    tab_id: u32,
    url: String,
}

#[derive(Clone, Serialize)]
struct BrowserTitleEvent {
    tab_id: u32,
    title: String,
}

struct BrowserState {
    data_dir: PathBuf,
}

fn view_label(tab_id: u32) -> String {
    format!("browser-tab-{tab_id}")
}

fn image_script(images_enabled: bool) -> String {
    if images_enabled {
        r#"
          (() => {
            document.documentElement.dataset.devFlowImages = "on";
            document.getElementById("dev-flow-image-mode")?.remove();
          })();
        "#
        .to_string()
    } else {
        r#"
          (() => {
            document.documentElement.dataset.devFlowImages = "off";
            const apply = () => {
              let style = document.getElementById("dev-flow-image-mode");
              if (!style) {
                style = document.createElement("style");
                style.id = "dev-flow-image-mode";
                document.documentElement.appendChild(style);
              }
              style.textContent = "img,picture,svg,video,source{visibility:hidden!important}";
            };
            apply();
            new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
          })();
        "#
        .to_string()
    }
}

fn parse_external_url(url: &str) -> Result<Url, String> {
    url.parse::<Url>()
        .map_err(|error| format!("Invalid URL: {error}"))
}

fn apply_bounds(webview: &tauri::Webview, bounds: BrowserBounds) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)))
        .map_err(|error| error.to_string())
}

fn content_bounds(app: &tauri::AppHandle, chrome_height: f64) -> Result<BrowserBounds, String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window was not found.".to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let width = f64::from(size.width) / scale;
    let height = f64::from(size.height) / scale;
    let chrome_height = chrome_height.clamp(1.0, height);

    Ok(BrowserBounds {
        x: 0.0,
        y: chrome_height,
        width,
        height: (height - chrome_height).max(1.0),
    })
}

fn layout_browser(
    app: &tauri::AppHandle,
    chrome_height: f64,
    active_tab_id: Option<u32>,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window was not found.".to_string())?;
    let main_webview = app
        .get_webview("main")
        .ok_or_else(|| "Main webview was not found.".to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let width = f64::from(size.width) / scale;
    let height = f64::from(size.height) / scale;

    if active_tab_id.is_none() {
        main_webview
            .set_position(LogicalPosition::new(0.0, 0.0))
            .map_err(|error| error.to_string())?;
        main_webview
            .set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
            .map_err(|error| error.to_string())?;
    } else {
        let chrome_height = chrome_height.clamp(1.0, height);
        main_webview
            .set_position(LogicalPosition::new(0.0, 0.0))
            .map_err(|error| error.to_string())?;
        main_webview
            .set_size(LogicalSize::new(width.max(1.0), chrome_height))
            .map_err(|error| error.to_string())?;
    }

    let bounds = content_bounds(app, chrome_height)?;
    for (_label, webview) in app.webviews() {
        if webview.label().starts_with("browser-tab-") {
            let is_active = active_tab_id
                .map(|id| webview.label() == view_label(id))
                .unwrap_or(false);
            if is_active {
                apply_bounds(&webview, bounds)?;
                webview.show().map_err(|error| error.to_string())?;
                webview.set_focus().map_err(|error| error.to_string())?;
            } else {
                webview.hide().map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn browser_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: u32,
    url: String,
    bounds: BrowserBounds,
    images_enabled: bool,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window was not found.".to_string())?;
    let label = view_label(tab_id);

    if let Some(webview) = app.get_webview(&label) {
        webview
            .navigate(parse_external_url(&url)?)
            .map_err(|error| error.to_string())?;
        apply_bounds(&webview, bounds)?;
        webview.show().map_err(|error| error.to_string())?;
        webview.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let app_for_page = app.clone();
    let app_for_title = app.clone();
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(parse_external_url(&url)?))
        .devtools(true)
        .data_directory(state.data_dir.clone())
        .on_page_load(move |_webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = app_for_page.emit(
                    "browser-page-loaded",
                    BrowserPageEvent {
                        tab_id,
                        url: payload.url().to_string(),
                    },
                );
            }
        })
        .on_document_title_changed(move |_webview, title| {
            let _ = app_for_title.emit("browser-title-changed", BrowserTitleEvent { tab_id, title });
        });

    if !images_enabled {
        builder = builder.initialization_script_for_all_frames(image_script(false));
    }

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|error| error.to_string())?;

    webview
        .set_auto_resize(false)
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    webview.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_layout(
    app: tauri::AppHandle,
    chrome_height: f64,
    active_tab_id: Option<u32>,
) -> Result<(), String> {
    layout_browser(&app, chrome_height, active_tab_id)
}

#[tauri::command]
fn browser_navigate(app: tauri::AppHandle, tab_id: u32, url: String) -> Result<(), String> {
    let label = view_label(tab_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("WebView not found: {label}"))?;
    webview
        .navigate(parse_external_url(&url)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_show(app: tauri::AppHandle, active_tab_id: Option<u32>) -> Result<(), String> {
    for (_label, webview) in app.webviews() {
        if webview.label().starts_with("browser-tab-") {
            let is_active = active_tab_id
                .map(|id| webview.label() == view_label(id))
                .unwrap_or(false);
            if is_active {
                webview.show().map_err(|error| error.to_string())?;
                webview.set_focus().map_err(|error| error.to_string())?;
            } else {
                webview.hide().map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn browser_resize(app: tauri::AppHandle, bounds: BrowserBounds) -> Result<(), String> {
    for (_label, webview) in app.webviews() {
        if webview.label().starts_with("browser-tab-") {
            apply_bounds(&webview, bounds)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn browser_close(app: tauri::AppHandle, tab_id: u32) -> Result<(), String> {
    let label = view_label(tab_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn browser_action(app: tauri::AppHandle, tab_id: u32, action: String) -> Result<(), String> {
    let label = view_label(tab_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("WebView not found: {label}"))?;
    let script = match action.as_str() {
        "back" => "history.back();",
        "forward" => "history.forward();",
        "reload" => "location.reload();",
        _ => return Err(format!("Unknown browser action: {action}")),
    };
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_find(app: tauri::AppHandle, tab_id: u32, query: String, backward: bool) -> Result<(), String> {
    let label = view_label(tab_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("WebView not found: {label}"))?;
    let query_json = serde_json::to_string(&query).map_err(|error| error.to_string())?;
    let script = format!("window.find({query_json}, false, {backward}, true, false, false, false);");
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_set_images(app: tauri::AppHandle, images_enabled: bool) -> Result<(), String> {
    let script = image_script(images_enabled);
    for (_label, webview) in app.webviews() {
        if webview.label().starts_with("browser-tab-") {
            let _ = webview.eval(script.clone());
        }
    }
    Ok(())
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle, tab_id: Option<u32>) -> Result<(), String> {
    if let Some(tab_id) = tab_id {
        if let Some(webview) = app.get_webview(&view_label(tab_id)) {
            webview.open_devtools();
            return Ok(());
        }
    }

    let webview = app
        .get_webview("main")
        .ok_or_else(|| "Main webview was not found.".to_string())?;
    webview.open_devtools();
    Ok(())
}

pub fn run() {
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let data_dir = std::env::temp_dir().join(format!("dev-flow-browser-{run_id}"));
    let _ = fs::create_dir_all(&data_dir);

    tauri::Builder::default()
        .manage(BrowserState { data_dir })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            browser_create,
            browser_layout,
            browser_navigate,
            browser_show,
            browser_resize,
            browser_close,
            browser_action,
            browser_find,
            browser_set_images,
            open_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Flow Browser");
}
