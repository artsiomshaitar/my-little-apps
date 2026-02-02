use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyRoute {
    pub subdomain: String,
    pub port: i32,
}

pub struct ProxyState {
    pub routes: std::sync::Arc<tokio::sync::Mutex<HashMap<String, ProxyRoute>>>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            routes: std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}

impl Default for ProxyState {
    fn default() -> Self {
        Self::new()
    }
}

fn generate_caddyfile(routes: &HashMap<String, ProxyRoute>) -> String {
    let mut content = String::new();

    content.push_str("{\n");
    content.push_str("\tauto_https off\n");
    content.push_str("\tadmin localhost:2019\n");
    content.push_str("}\n\n");

    if routes.is_empty() {
        content.push_str(":80 {\n");
        content.push_str("\trespond \"My Little Apps proxy is running. No apps configured yet.\" 200\n");
        content.push_str("}\n");
    } else {
        for route in routes.values() {
            content.push_str(&format!("http://{}.local {{\n", route.subdomain));
            content.push_str(&format!("\treverse_proxy localhost:{}\n", route.port));
            content.push_str("}\n\n");
        }
    }

    content
}

pub async fn load_caddyfile_via_api(content: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

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

pub async fn update_routes(routes: &HashMap<String, ProxyRoute>) -> Result<(), String> {
    let caddyfile_content = generate_caddyfile(routes);
    load_caddyfile_via_api(&caddyfile_content).await
}

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

    update_routes(&routes).await
}

pub async fn remove_route(proxy_state: &ProxyState, app_id: &str) -> Result<(), String> {
    let mut routes = proxy_state.routes.lock().await;
    routes.remove(app_id);

    update_routes(&routes).await
}

pub fn get_app_url(subdomain: &str) -> String {
    format!("http://{}.local", subdomain)
}

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
        let content = generate_caddyfile(&routes);
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
        let content = generate_caddyfile(&routes);
        assert!(content.contains("my-app.local"));
        assert!(content.contains("reverse_proxy localhost:3000"));
    }
}
