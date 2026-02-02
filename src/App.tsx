import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Database from "@tauri-apps/plugin-sql";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import "./App.css";

interface App {
  id: string;
  name: string;
  path: string;
  command: string;
  port: number | null;
  run_on_startup: boolean;
  created_at: string;
  subdomain: string | null;
}

interface ProxyServiceStatus {
  installed: boolean;
  caddy_running: boolean;
}

interface ProxyRoute {
  subdomain: string;
  port: number;
}

interface RunningApps {
  [id: string]: number;
}

interface LogEntry {
  type: "stdout" | "stderr";
  message: string;
}

function AppComponent() {
  const [apps, setApps] = useState<App[]>([]);
  const [runningApps, setRunningApps] = useState<RunningApps>({});
  const [logs, setLogs] = useState<{ [id: string]: LogEntry[] }>({});
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [db, setDb] = useState<Database | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const [lanIp, setLanIp] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ProxyServiceStatus | null>(null);
  const [proxyRoutes, setProxyRoutes] = useState<{ [id: string]: ProxyRoute }>({});
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showLanInfo, setShowLanInfo] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    const initDb = async () => {
      const database = await Database.load("sqlite:my-little-apps.db");
      setDb(database);
    };
    initDb();
  }, []);

  useEffect(() => {
    const initProxy = async () => {
      try {
        const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
        setServiceStatus(status);
        
        const routes = await invoke<{ [id: string]: ProxyRoute }>("get_proxy_routes");
        setProxyRoutes(routes);
        
        const ip = await invoke<string | null>("get_lan_ip");
        setLanIp(ip);
        
        if (!status.installed) {
          setShowSetupWizard(true);
        }
      } catch (e) {
        console.error("Failed to initialize proxy:", e);
      }
    };
    initProxy();
  }, []);

  const loadApps = useCallback(async () => {
    if (!db) return;
    const result = await db.select<App[]>("SELECT * FROM apps ORDER BY name");
    setApps(result);
    invoke("refresh_tray", { apps: result });
    return result;
  }, [db]);

  const autoStartApps = useCallback(async (appsToStart: App[], currentRunning: RunningApps) => {
    for (const app of appsToStart) {
      if (app.run_on_startup && !currentRunning[app.id]) {
        try {
          const port = app.port || (await invoke<number>("get_free_port", { preferred: null }));
          const actualPort = await invoke<number>("start_app", {
            id: app.id,
            path: app.path,
            command: app.command,
            port,
            subdomain: app.subdomain,
          });
          
          if (app.subdomain) {
            try {
              await invoke("add_proxy_route", {
                appId: app.id,
                subdomain: app.subdomain,
                port: actualPort,
              });
            } catch (e) {
              console.error(`Failed to add proxy route for ${app.name}:`, e);
            }
          }
        } catch (e) {
          console.error(`Failed to auto-start ${app.name}:`, e);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (db) {
      const init = async () => {
        const loadedApps = await loadApps();
        const running = await invoke<RunningApps>("get_running_apps");
        setRunningApps(running);
        
        const newProxyRoutes: { [id: string]: ProxyRoute } = {};
        if (loadedApps) {
          for (const app of loadedApps) {
            const port = running[app.id];
            if (port && app.subdomain) {
              try {
                await invoke("add_proxy_route", {
                  appId: app.id,
                  subdomain: app.subdomain,
                  port,
                });
                newProxyRoutes[app.id] = { subdomain: app.subdomain, port };
                console.log(`Re-registered proxy route: ${app.subdomain} -> localhost:${port}`);
              } catch (e) {
                console.error(`Failed to re-register proxy route for ${app.name}:`, e);
              }
            }
          }
        }
        setProxyRoutes(newProxyRoutes);
        
        if (loadedApps) {
          await autoStartApps(loadedApps, running);
        }
      };
      init();
    }
  }, [db, loadApps, autoStartApps]);

  useEffect(() => {
    isEnabled().then(setAutoStartEnabled);
  }, []);

  useEffect(() => {
    if (logsEndRef.current && selectedAppId && logs[selectedAppId]?.length) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, selectedAppId]);

  const isProxyOperational = serviceStatus?.installed && serviceStatus?.caddy_running;

  const handleOpenInBrowser = useCallback((app: App, port: number) => {
    const sub = app.subdomain && isProxyOperational ? app.subdomain : null;
    invoke("open_in_browser", { port, subdomain: sub });
  }, [isProxyOperational]);

  useEffect(() => {
    const unlistenStarted = listen<{ id: string; port: number }>(
      "app-started",
      (event) => {
        setRunningApps((prev) => ({
          ...prev,
          [event.payload.id]: event.payload.port,
        }));
        loadApps();
      }
    );

    const unlistenStopped = listen<{ id: string; code: number | null }>(
      "app-stopped",
      async (event) => {
        const appId = event.payload.id;
        
        setRunningApps((prev) => {
          const next = { ...prev };
          delete next[appId];
          return next;
        });
        
        try {
          await invoke("remove_proxy_route", { appId });
          setProxyRoutes((prev) => {
            const next = { ...prev };
            delete next[appId];
            return next;
          });
        } catch (e) {
        }
        
        loadApps();
      }
    );

    const unlistenLog = listen<{ id: string; type: string; message: string }>(
      "app-log",
      (event) => {
        setLogs((prev) => ({
          ...prev,
          [event.payload.id]: [
            ...(prev[event.payload.id] || []),
            {
              type: event.payload.type as "stdout" | "stderr",
              message: event.payload.message,
            },
          ].slice(-200),
        }));
      }
    );

    const unlistenOpenApp = listen<string>("open-app", async (event) => {
      const appId = event.payload;
      const currentRunning = await invoke<RunningApps>("get_running_apps");
      const port = currentRunning[appId];
      if (port) {
        const app = apps.find(a => a.id === appId);
        if (app) {
          handleOpenInBrowser(app, port);
        } else {
          invoke("open_in_browser", { port, subdomain: null });
        }
      }
    });

    return () => {
      unlistenStarted.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
      unlistenLog.then((fn) => fn());
      unlistenOpenApp.then((fn) => fn());
    };
  }, [loadApps, runningApps, apps, handleOpenInBrowser]);

  const handleAddApp = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select your app folder",
    });

    if (!selected || !db) return;

    const path = selected as string;

    const existing = await db.select<App[]>(
      "SELECT * FROM apps WHERE path = $1",
      [path]
    );
    if (existing.length > 0) {
      alert("This app is already added!");
      return;
    }

    let name = path.split("/").pop() || "Unknown App";
    try {
      const pkg = await invoke<{ name?: string }>("read_package_json", { path });
      if (pkg.name) {
        name = pkg.name;
      }
    } catch {
    }

    const id = await invoke<string>("generate_id");
    const subdomain = await invoke<string>("slugify_name", { name });

    await db.execute(
      "INSERT INTO apps (id, name, path, command, run_on_startup, subdomain) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, name, path, "bun start", false, subdomain]
    );

    loadApps();
  };

  const handleRemoveApp = async (id: string) => {
    if (!db) return;

    if (runningApps[id]) {
      await invoke("stop_app", { id });
      
      if (proxyRoutes[id]) {
        try {
          await invoke("remove_proxy_route", { appId: id });
          setProxyRoutes((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        } catch (e) {
          console.error("Failed to remove proxy route:", e);
        }
      }
    }

    await db.execute("DELETE FROM apps WHERE id = $1", [id]);
    loadApps();
  };

  const handleStartApp = async (app: App) => {
    const port = app.port || (await invoke<number>("get_free_port", { preferred: null }));
    
    try {
      const actualPort = await invoke<number>("start_app", {
        id: app.id,
        path: app.path,
        command: app.command,
        port,
        subdomain: app.subdomain,
      });
      
      if (app.subdomain) {
        try {
          await invoke("add_proxy_route", {
            appId: app.id,
            subdomain: app.subdomain,
            port: actualPort,
          });
          setProxyRoutes(prev => ({
            ...prev,
            [app.id]: { subdomain: app.subdomain!, port: actualPort }
          }));
        } catch (e) {
          console.error("Failed to add proxy route:", e);
        }
      }
    } catch (e) {
      console.error("Failed to start app:", e);
      alert(`Failed to start app: ${e}`);
    }
  };

  const handleStopApp = async (id: string) => {
    await invoke("stop_app", { id });
    
    if (proxyRoutes[id]) {
      try {
        await invoke("remove_proxy_route", { appId: id });
        setProxyRoutes(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch (e) {
        console.error("Failed to remove proxy route:", e);
      }
    }
  };

  const handleSaveApp = async () => {
    if (!editingApp || !db) return;

    await db.execute(
      "UPDATE apps SET name = $1, command = $2, port = $3, run_on_startup = $4, subdomain = $5 WHERE id = $6",
      [
        editingApp.name,
        editingApp.command,
        editingApp.port,
        editingApp.run_on_startup ? 1 : 0,
        editingApp.subdomain,
        editingApp.id,
      ]
    );

    if (runningApps[editingApp.id]) {
      try {
        if (editingApp.subdomain) {
          await invoke("add_proxy_route", {
            appId: editingApp.id,
            subdomain: editingApp.subdomain,
            port: runningApps[editingApp.id],
          });
          setProxyRoutes((prev) => ({
            ...prev,
            [editingApp.id]: { subdomain: editingApp.subdomain!, port: runningApps[editingApp.id] }
          }));
        } else if (proxyRoutes[editingApp.id]) {
          await invoke("remove_proxy_route", { appId: editingApp.id });
          setProxyRoutes((prev) => {
            const next = { ...prev };
            delete next[editingApp.id];
            return next;
          });
        }
      } catch (e) {
        console.error("Failed to update proxy route:", e);
      }
    }

    setEditingApp(null);
    loadApps();
  };

  const handleToggleAutostart = async () => {
    if (autoStartEnabled) {
      await disable();
    } else {
      await enable();
    }
    setAutoStartEnabled(!autoStartEnabled);
  };

  const handleInstallService = async () => {
    setSetupLoading(true);
    try {
      await invoke("install_proxy_service");
      
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
        setServiceStatus(status);
        
        if (status.installed && status.caddy_running) {
          setShowSetupWizard(false);
          break;
        }
      }
    } catch (e) {
      console.error("Service installation failed:", e);
      alert(`Installation failed: ${e}`);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleUninstallService = async () => {
    if (!confirm("Are you sure you want to uninstall the proxy service? Your apps will only be accessible via localhost:port.")) {
      return;
    }
    try {
      await invoke("uninstall_proxy_service");
      const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
      setServiceStatus(status);
    } catch (e) {
      console.error("Service uninstallation failed:", e);
      alert(`Uninstallation failed: ${e}`);
    }
  };

  const handleStartProxyService = async () => {
    setSetupLoading(true);
    try {
      await invoke("start_proxy_service");
      
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
        setServiceStatus(status);
        
        if (status.caddy_running) {
          break;
        }
      }
    } catch (e) {
      console.error("Service start failed:", e);
      alert(`Failed to start proxy service: ${e}`);
    } finally {
      setSetupLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  return (
    <div className="app-container">
      <header className="header">
        <h1>My Little Apps</h1>
        <div className="header-actions">
          <div className="proxy-status">
            <span className={`status-indicator ${isProxyOperational ? "active" : "inactive"}`}>
              Proxy: {isProxyOperational ? "Running" : serviceStatus?.installed ? "Stopped" : "Not installed"}
            </span>
            {!serviceStatus?.installed && (
              <button className="btn btn-small" onClick={() => setShowSetupWizard(true)}>
                Setup Proxy
              </button>
            )}
            {serviceStatus?.installed && !isProxyOperational && (
              <button 
                className="btn btn-small btn-success" 
                onClick={handleStartProxyService}
                disabled={setupLoading}
              >
                {setupLoading ? "Starting..." : "Start Proxy"}
              </button>
            )}
            {isProxyOperational && lanIp && (
              <button className="btn btn-small" onClick={() => setShowLanInfo(true)}>
                LAN Access
              </button>
            )}
            {serviceStatus?.installed && (
              <button className="btn btn-small btn-danger" onClick={handleUninstallService}>
                Uninstall
              </button>
            )}
          </div>
          <label className="autostart-toggle">
            <input
              type="checkbox"
              checked={autoStartEnabled}
              onChange={handleToggleAutostart}
            />
            <span>Start manager on login</span>
          </label>
          <button className="btn btn-primary" onClick={handleAddApp}>
            + Add App
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="apps-list">
          <h2>Your Apps</h2>
          {apps.length === 0 ? (
            <div className="empty-state">
              <p>No apps added yet.</p>
              <p>Click "Add App" to get started!</p>
            </div>
          ) : (
            <ul>
              {apps.map((app) => {
                const isRunning = runningApps[app.id] !== undefined;
                const port = runningApps[app.id];

                return (
                  <li
                    key={app.id}
                    className={`app-item ${selectedAppId === app.id ? "selected" : ""} ${isRunning ? "running" : ""}`}
                    onClick={() => setSelectedAppId(app.id)}
                  >
                    <div className="app-info">
                      <span className={`status-dot ${isRunning ? "running" : "stopped"}`} />
                      <div className="app-details">
                        <strong>{app.name}</strong>
                        {isRunning && (
                          <div className="url-badges">
                            {serviceStatus?.installed && app.subdomain && (
                              <>
                                <span className={`url-badge lan ${!isProxyOperational ? "inactive" : ""}`}>
                                  {app.subdomain}.local
                                </span>
                                <span className="url-separator">|</span>
                              </>
                            )}
                            <span className="url-badge localhost">localhost:{port}</span>
                          </div>
                        )}
                        <small>{app.path}</small>
                      </div>
                    </div>
                    <div className="app-actions">
                        {isRunning ? (
                        <>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenInBrowser(app, port);
                            }}
                          >
                            Open
                          </button>
                          <button
                            className="btn btn-small btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStopApp(app.id);
                            }}
                          >
                            Stop
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-small btn-success"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartApp(app);
                          }}
                        >
                          Start
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selectedApp && (
          <section className="app-detail">
            <div className="detail-header">
              <h2>{selectedApp.name}</h2>
              <div className="detail-actions">
                <button
                  className="btn btn-small"
                  onClick={() => setEditingApp({ ...selectedApp })}
                >
                  Edit
                </button>
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => {
                    if (confirm("Are you sure you want to remove this app?")) {
                      handleRemoveApp(selectedApp.id);
                      setSelectedAppId(null);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="detail-info">
              <div className="info-row">
                <label>Path:</label>
                <code>{selectedApp.path}</code>
              </div>
              <div className="info-row">
                <label>Command:</label>
                <code>{selectedApp.command}</code>
              </div>
              <div className="info-row">
                <label>Port:</label>
                <span>{selectedApp.port || "Auto"}</span>
              </div>
              <div className="info-row">
                <label>Run on startup:</label>
                <span>{selectedApp.run_on_startup ? "Yes" : "No"}</span>
              </div>
              {runningApps[selectedApp.id] && (
                <div className="info-row urls">
                  <label>URLs:</label>
                  <div className="url-links">
                    {serviceStatus?.installed && selectedApp.subdomain && (
                      <div className={`url-link-item ${!isProxyOperational ? "inactive" : ""}`}>
                        <code>http://{selectedApp.subdomain}.local</code>
                        <button 
                          className="btn-copy" 
                          onClick={() => copyToClipboard(`http://${selectedApp.subdomain}.local`)}
                          disabled={!isProxyOperational}
                          title={!isProxyOperational ? "Proxy is stopped" : undefined}
                        >
                          {copiedUrl === `http://${selectedApp.subdomain}.local` ? "Copied!" : "Copy"}
                        </button>
                        {!isProxyOperational && <span className="url-status">(proxy stopped)</span>}
                      </div>
                    )}
                    <div className="url-link-item">
                      <code>http://localhost:{runningApps[selectedApp.id]}</code>
                      <button 
                        className="btn-copy" 
                        onClick={() => copyToClipboard(`http://localhost:${runningApps[selectedApp.id]}`)}
                      >
                        {copiedUrl === `http://localhost:${runningApps[selectedApp.id]}` ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="logs-section">
              <h3>Logs</h3>
              <div className="logs-container">
                {(logs[selectedApp.id] || []).length === 0 ? (
                  <p className="no-logs">No logs yet. Start the app to see output.</p>
                ) : (
                  <pre>
                    {(logs[selectedApp.id] || []).map((log, i) => (
                      <div
                        key={i}
                        className={`log-line ${log.type === "stderr" ? "error" : ""}`}
                      >
                        {log.message}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </pre>
                )}
              </div>
            </div>
          </section>
        )}

        {!selectedApp && apps.length > 0 && (
          <section className="app-detail empty">
            <p>Select an app to view details</p>
          </section>
        )}
      </main>

      {editingApp && (
        <div className="modal-overlay" onClick={() => setEditingApp(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit App</h2>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={editingApp.name}
                onChange={(e) =>
                  setEditingApp({ ...editingApp, name: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Subdomain</label>
              <div className="subdomain-input">
                <input
                  type="text"
                  value={editingApp.subdomain || ""}
                  onChange={(e) =>
                    setEditingApp({ ...editingApp, subdomain: e.target.value || null })
                  }
                  placeholder="my-app"
                />
                <span className="subdomain-suffix">.local</span>
              </div>
            </div>
            <div className="form-group">
              <label>Command</label>
              <input
                type="text"
                value={editingApp.command}
                onChange={(e) =>
                  setEditingApp({ ...editingApp, command: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Port (leave empty for auto)</label>
              <input
                type="number"
                value={editingApp.port || ""}
                onChange={(e) =>
                  setEditingApp({
                    ...editingApp,
                    port: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="Auto"
              />
            </div>
            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={editingApp.run_on_startup}
                  onChange={(e) =>
                    setEditingApp({
                      ...editingApp,
                      run_on_startup: e.target.checked,
                    })
                  }
                />
                Run on startup
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditingApp(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveApp}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showSetupWizard && (
        <div className="modal-overlay" onClick={() => setShowSetupWizard(false)}>
          <div className="modal dns-setup-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Proxy Service Setup</h2>
            <p>
              To access your apps via clean URLs like <code>my-app.local</code>,
              we need to install a background proxy service.
            </p>
            
            <div className="dns-status-details">
              <h3>Current Status</h3>
              <ul>
                <li className={serviceStatus?.installed ? "ok" : "missing"}>
                  Service: {serviceStatus?.installed ? "Installed" : "Not installed"}
                </li>
                <li className={serviceStatus?.caddy_running ? "ok" : "missing"}>
                  Proxy: {serviceStatus?.caddy_running ? "Running" : "Not running"}
                </li>
              </ul>
            </div>

            <div className="dns-setup-info">
              <h3>What will be installed:</h3>
              <ul>
                <li>Background proxy service (Caddy)</li>
                <li>mDNS advertising for LAN access</li>
              </ul>
              <p className="warning">
                This is a one-time setup that requires your administrator password.
                After installation, no further passwords will be needed.
              </p>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowSetupWizard(false)}>
                Skip for now
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleInstallService}
                disabled={setupLoading}
              >
                {setupLoading ? "Installing..." : "Install Service"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLanInfo && (
        <div className="modal-overlay" onClick={() => setShowLanInfo(false)}>
          <div className="modal lan-info-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Access from Other Devices</h2>
            <p>
              Your apps are automatically discoverable on the local network via mDNS (Bonjour).
            </p>
            
            <div className="lan-setup-steps">
              <h3>How to Access</h3>
              <p>From any device on the same Wi-Fi network, simply open:</p>
              <div className="lan-url-example">
                <code>http://your-app.local</code>
              </div>
              <p className="info-note">
                For example, if your app's subdomain is "zrabi-dev", open <code>http://zrabi-dev.local</code> in Safari on your iPhone.
              </p>
              <p className="info-note">
                This works automatically - no DNS configuration needed!
              </p>
            </div>

            <div className="lan-info-details">
              <div className="info-row">
                <label>Your Mac's IP:</label>
                <div className="ip-display">
                  <code>{lanIp}</code>
                  <button 
                    className="btn-copy" 
                    onClick={() => lanIp && copyToClipboard(lanIp)}
                  >
                    {copiedUrl === lanIp ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowLanInfo(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppComponent;
