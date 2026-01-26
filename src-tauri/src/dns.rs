use std::path::PathBuf;
use std::process::Command;

/// Proxy service installation status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyServiceStatus {
    pub installed: bool,
    pub dnsmasq_running: bool,
    pub caddy_running: bool,
    pub hostname: String,
}

/// Get the local hostname (e.g., "artsioms-macbook-pro")
pub fn get_local_hostname() -> String {
    if let Ok(hostname) = std::env::var("MY_LITTLE_APPS_HOSTNAME") {
        return hostname;
    }

    if let Ok(output) = Command::new("hostname").output() {
        if let Ok(hostname) = String::from_utf8(output.stdout) {
            let hostname = hostname.trim().to_lowercase();
            return hostname.strip_suffix(".local").unwrap_or(&hostname).to_string();
        }
    }

    "localhost".to_string()
}

/// Check if the proxy service is installed
pub fn is_service_installed() -> bool {
    let dnsmasq_plist = PathBuf::from("/Library/LaunchDaemons/com.my-little-apps.dnsmasq.plist");
    let caddy_plist = PathBuf::from("/Library/LaunchDaemons/com.my-little-apps.caddy.plist");
    
    dnsmasq_plist.exists() && caddy_plist.exists()
}

/// Check if dnsmasq daemon is running
pub fn is_dnsmasq_running() -> bool {
    Command::new("pgrep")
        .args(["-f", "my-little-apps/dnsmasq"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if Caddy daemon is running
pub fn is_caddy_running() -> bool {
    Command::new("pgrep")
        .args(["-f", "my-little-apps/caddy"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get full proxy service status
pub fn get_service_status() -> ProxyServiceStatus {
    ProxyServiceStatus {
        installed: is_service_installed(),
        dnsmasq_running: is_dnsmasq_running(),
        caddy_running: is_caddy_running(),
        hostname: get_local_hostname(),
    }
}

/// Get the path to bundled resources
pub fn get_resource_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    
    // In production, resources are in the app bundle
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    if resource_path.join("install-proxy.sh").exists() {
        return Ok(resource_path);
    }

    // In development, look in src-tauri/resources
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    if dev_path.join("install-proxy.sh").exists() {
        return Ok(dev_path);
    }

    Err("Resource directory not found".to_string())
}

/// Install the proxy service using osascript for admin privileges
pub async fn install_service(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let resource_path = get_resource_path(app_handle)?;
    let install_script = resource_path.join("install-proxy.sh");

    if !install_script.exists() {
        return Err(format!("Install script not found at {:?}", install_script));
    }

    let resource_path_str = resource_path.to_str().ok_or("Invalid resource path")?;
    let install_script_str = install_script.to_str().ok_or("Invalid script path")?;

    // Use osascript to run the install script with admin privileges
    // This will show a native macOS password prompt
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

/// Start/restart the proxy service (load LaunchDaemons)
/// This doesn't require admin privileges if the daemons are already installed
pub async fn start_service() -> Result<(), String> {
    // Try to load the LaunchDaemons using launchctl
    // Note: loading system daemons requires sudo, so we use osascript
    let osascript_command = r#"do shell script "launchctl load -w /Library/LaunchDaemons/com.my-little-apps.dnsmasq.plist 2>/dev/null; launchctl load -w /Library/LaunchDaemons/com.my-little-apps.caddy.plist 2>/dev/null; exit 0" with administrator privileges"#;

    let output = Command::new("osascript")
        .args(["-e", osascript_command])
        .output()
        .map_err(|e| format!("Failed to start service: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err("Operation was cancelled by user".to_string());
        }
        // Don't fail if already loaded
        if !stderr.contains("already loaded") {
            return Err(format!("Failed to start service: {}", stderr));
        }
    }

    Ok(())
}

/// Stop the proxy service (unload LaunchDaemons without removing)
pub async fn stop_service() -> Result<(), String> {
    let osascript_command = r#"do shell script "launchctl unload /Library/LaunchDaemons/com.my-little-apps.dnsmasq.plist 2>/dev/null; launchctl unload /Library/LaunchDaemons/com.my-little-apps.caddy.plist 2>/dev/null; exit 0" with administrator privileges"#;

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

/// Uninstall the proxy service using osascript for admin privileges
pub async fn uninstall_service(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let resource_path = get_resource_path(app_handle)?;
    let uninstall_script = resource_path.join("uninstall-proxy.sh");

    if !uninstall_script.exists() {
        return Err(format!("Uninstall script not found at {:?}", uninstall_script));
    }

    let uninstall_script_str = uninstall_script.to_str().ok_or("Invalid script path")?;

    // Use osascript to run the uninstall script with admin privileges
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_local_hostname() {
        let hostname = get_local_hostname();
        assert!(!hostname.is_empty());
        assert!(!hostname.ends_with(".local"));
    }
}
