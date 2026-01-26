use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Represents a running app with its subdomain mapping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRoute {
    pub subdomain: String,
    pub port: i32,
}

/// Proxy state to track routes (in-memory, synced with Caddy)
pub struct ProxyState {
    pub routes: std::sync::Arc<tokio::sync::Mutex<HashMap<String, ProxyRoute>>>, // app_id -> route
    pub hostname: String,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            routes: std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            hostname: crate::dns::get_local_hostname(),
        }
    }
}

impl Default for ProxyState {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate Caddyfile content from current routes
/// Note: Caddy requires tab indentation, not spaces, and trailing newline
fn generate_caddyfile(routes: &HashMap<String, ProxyRoute>, hostname: &str) -> String {
    let mut content = String::new();

    // Global options (using tabs for indentation)
    content.push_str("{\n");
    content.push_str("\tauto_https off\n");
    content.push_str("\tadmin localhost:2019\n");
    content.push_str("}\n\n");

    if routes.is_empty() {
        // Default route when no apps are running
        content.push_str(":80 {\n");
        content.push_str("\trespond \"My Little Apps proxy is running. No apps configured yet.\" 200\n");
        content.push_str("}\n");
    } else {
        // Add route for each running app (use http:// to force port 80)
        for route in routes.values() {
            let domain = format!("http://{}.{}.local", route.subdomain, hostname);
            content.push_str(&format!("{} {{\n", domain));
            content.push_str(&format!("\treverse_proxy localhost:{}\n", route.port));
            content.push_str("}\n\n");
        }

        // Catch-all for unmatched subdomains
        content.push_str(&format!("http://*.{}.local {{\n", hostname));
        content.push_str("\trespond \"App not found. Make sure it's running in My Little Apps.\" 404\n");
        content.push_str("}\n");
    }

    content
}

/// Load Caddyfile content directly via admin API (no file write needed)
pub async fn load_caddyfile_via_api(content: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // POST to Caddy's admin API to load config directly
    let response = client
        .post("http://localhost:2019/load")
        .header("Content-Type", "text/caddyfile")
        .body(content.to_string())
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Caddy admin API (is the proxy service running?): {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Err(format!("Caddy config load failed: {}", error_text))
    }
}

/// Update Caddy routes via admin API (no file permissions needed)
pub async fn update_routes(routes: &HashMap<String, ProxyRoute>, hostname: &str) -> Result<(), String> {
    let caddyfile_content = generate_caddyfile(routes, hostname);
    load_caddyfile_via_api(&caddyfile_content).await
}

/// Add a route for an app
pub async fn add_route(
    proxy_state: &ProxyState,
    app_id: &str,
    subdomain: &str,
    port: i32,
) -> Result<(), String> {
    let mut routes = proxy_state.routes.lock().await;
    routes.insert(
        app_id.to_string(),
        ProxyRoute {
            subdomain: subdomain.to_string(),
            port,
        },
    );

    update_routes(&routes, &proxy_state.hostname).await
}

/// Remove a route for an app
pub async fn remove_route(proxy_state: &ProxyState, app_id: &str) -> Result<(), String> {
    let mut routes = proxy_state.routes.lock().await;
    routes.remove(app_id);

    update_routes(&routes, &proxy_state.hostname).await
}

/// Get the full URL for an app
pub fn get_app_url(subdomain: &str, hostname: &str) -> String {
    format!("http://{}.{}.local", subdomain, hostname)
}

/// Slugify an app name to create a valid subdomain
pub fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
        .join("-")
}

/// Check if Caddy is responding (proxy service is working)
pub async fn is_caddy_responsive() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    client
        .get("http://localhost:2019/config/")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("My App"), "my-app");
        assert_eq!(slugify("My  App"), "my-app");
        assert_eq!(slugify("My_App_123"), "my-app-123");
        assert_eq!(slugify("  My App  "), "my-app");
    }

    #[test]
    fn test_generate_caddyfile_empty() {
        let routes = HashMap::new();
        let content = generate_caddyfile(&routes, "macbook");
        assert!(content.contains("auto_https off"));
        assert!(content.contains("No apps configured"));
    }

    #[test]
    fn test_generate_caddyfile_with_routes() {
        let mut routes = HashMap::new();
        routes.insert(
            "app1".to_string(),
            ProxyRoute {
                subdomain: "my-app".to_string(),
                port: 3000,
            },
        );
        let content = generate_caddyfile(&routes, "macbook");
        assert!(content.contains("my-app.macbook.local"));
        assert!(content.contains("reverse_proxy localhost:3000"));
    }
}
