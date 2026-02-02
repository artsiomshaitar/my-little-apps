use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct MdnsRegistry {
    processes: Mutex<HashMap<String, Child>>,
}

impl MdnsRegistry {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, subdomain: &str, lan_ip: &str) -> Result<(), String> {
        let hostname = format!("{}.local", subdomain);
        
        let child = Command::new("dns-sd")
            .args([
                "-P",
                subdomain,
                "_http._tcp",
                "local",
                "80",
                &hostname,
                lan_ip,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to register mDNS for {}: {}", subdomain, e))?;

        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;
        
        if let Some(mut old_child) = processes.remove(subdomain) {
            let _ = old_child.kill();
        }
        
        processes.insert(subdomain.to_string(), child);
        Ok(())
    }

    pub fn unregister(&self, subdomain: &str) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;
        
        if let Some(mut child) = processes.remove(subdomain) {
            let _ = child.kill();
        }
        
        Ok(())
    }

    pub fn unregister_all(&self) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;
        
        for (_, mut child) in processes.drain() {
            let _ = child.kill();
        }
        
        Ok(())
    }

    pub fn get_registered_subdomains(&self) -> std::collections::HashSet<String> {
        self.processes
            .lock()
            .map(|p| p.keys().cloned().collect())
            .unwrap_or_default()
    }
}

impl Default for MdnsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for MdnsRegistry {
    fn drop(&mut self) {
        if let Ok(mut processes) = self.processes.lock() {
            for (_, mut child) in processes.drain() {
                let _ = child.kill();
            }
        }
    }
}
