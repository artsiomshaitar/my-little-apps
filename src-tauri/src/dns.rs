use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyServiceStatus {
    pub installed: bool,
    pub caddy_running: bool,
}

pub fn get_lan_ip() -> Option<String> {
    if let Ok(output) = Command::new("ipconfig").args(["getifaddr", "en0"]).output() {
        if output.status.success() {
            if let Ok(ip) = String::from_utf8(output.stdout) {
                let ip = ip.trim();
                if !ip.is_empty() {
                    return Some(ip.to_string());
                }
            }
        }
    }

    if let Ok(output) = Command::new("ipconfig").args(["getifaddr", "en1"]).output() {
        if output.status.success() {
            if let Ok(ip) = String::from_utf8(output.stdout) {
                let ip = ip.trim();
                if !ip.is_empty() {
                    return Some(ip.to_string());
                }
            }
        }
    }

    None
}

pub fn is_service_installed() -> bool {
    let caddy_plist = PathBuf::from("/Library/LaunchDaemons/com.my-little-apps.caddy.plist");
    caddy_plist.exists()
}

pub fn is_caddy_running() -> bool {
    Command::new("pgrep")
        .args(["-f", "my-little-apps/caddy"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn get_service_status() -> ProxyServiceStatus {
    ProxyServiceStatus {
        installed: is_service_installed(),
        caddy_running: is_caddy_running(),
    }
}

pub fn get_resource_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    if resource_path.join("install-proxy.sh").exists() {
        return Ok(resource_path);
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    if dev_path.join("install-proxy.sh").exists() {
        return Ok(dev_path);
    }

    Err("Resource directory not found".to_string())
}

pub async fn install_service(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let resource_path = get_resource_path(app_handle)?;
    let install_script = resource_path.join("install-proxy.sh");

    if !install_script.exists() {
        return Err(format!("Install script not found at {:?}", install_script));
    }

    let resource_path_str = resource_path.to_str().ok_or("Invalid resource path")?;
    let install_script_str = install_script.to_str().ok_or("Invalid script path")?;

    let osascript_command = format!(
        r#"do shell script "bash '{}' '{}'" with administrator privileges"#,
        install_script_str, resource_path_str
    );

    let output = Command::new("osascript")
        .args(["-e", &osascript_command])
        .output()
        .map_err(|e| format!("Failed to run install script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err("Installation was cancelled by user".to_string());
        }
        return Err(format!("Installation failed: {}", stderr));
    }

    Ok(())
}

pub async fn start_service() -> Result<(), String> {
    let osascript_command = r#"do shell script "launchctl load -w /Library/LaunchDaemons/com.my-little-apps.caddy.plist 2>/dev/null; exit 0" with administrator privileges"#;

    let output = Command::new("osascript")
        .args(["-e", osascript_command])
        .output()
        .map_err(|e| format!("Failed to start service: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err("Operation was cancelled by user".to_string());
        }
        if !stderr.contains("already loaded") {
            return Err(format!("Failed to start service: {}", stderr));
        }
    }

    Ok(())
}

pub async fn stop_service() -> Result<(), String> {
    let osascript_command = r#"do shell script "launchctl unload /Library/LaunchDaemons/com.my-little-apps.caddy.plist 2>/dev/null; exit 0" with administrator privileges"#;

    let output = Command::new("osascript")
        .args(["-e", osascript_command])
        .output()
        .map_err(|e| format!("Failed to stop service: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err("Operation was cancelled by user".to_string());
        }
    }

    Ok(())
}

pub async fn uninstall_service(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let resource_path = get_resource_path(app_handle)?;
    let uninstall_script = resource_path.join("uninstall-proxy.sh");

    if !uninstall_script.exists() {
        return Err(format!(
            "Uninstall script not found at {:?}",
            uninstall_script
        ));
    }

    let uninstall_script_str = uninstall_script.to_str().ok_or("Invalid script path")?;

    let osascript_command = format!(
        r#"do shell script "bash '{}'" with administrator privileges"#,
        uninstall_script_str
    );

    let output = Command::new("osascript")
        .args(["-e", &osascript_command])
        .output()
        .map_err(|e| format!("Failed to run uninstall script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err("Uninstallation was cancelled by user".to_string());
        }
        return Err(format!("Uninstallation failed: {}", stderr));
    }

    Ok(())
}
