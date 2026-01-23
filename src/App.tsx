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
}

interface RunningApps {
  [id: string]: number; // id -> port
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

  // Initialize database
  useEffect(() => {
    const initDb = async () => {
      const database = await Database.load("sqlite:my-little-apps.db");
      setDb(database);
    };
    initDb();
  }, []);

  // Load apps from database
  const loadApps = useCallback(async () => {
    if (!db) return;
    const result = await db.select<App[]>("SELECT * FROM apps ORDER BY name");
    setApps(result);

    // Refresh tray menu
    invoke("refresh_tray", { apps: result });
    
    return result;
  }, [db]);

  // Auto-start apps on initial load
  const autoStartApps = useCallback(async (appsToStart: App[], currentRunning: RunningApps) => {
    for (const app of appsToStart) {
      if (app.run_on_startup && !currentRunning[app.id]) {
        try {
          const port = app.port || (await invoke<number>("get_free_port", { preferred: null }));
          await invoke("start_app", {
            id: app.id,
            path: app.path,
            command: app.command,
            port,
          });
          console.log(`Auto-started: ${app.name}`);
        } catch (e) {
          console.error(`Failed to auto-start ${app.name}:`, e);
        }
      }
    }
  }, []);

  // Load apps when db is ready and auto-start if needed
  useEffect(() => {
    if (db) {
      const init = async () => {
        const loadedApps = await loadApps();
        const running = await invoke<RunningApps>("get_running_apps");
        setRunningApps(running);
        
        // Auto-start apps marked for startup
        if (loadedApps) {
          await autoStartApps(loadedApps, running);
        }
      };
      init();
    }
  }, [db, loadApps, autoStartApps]);

  // Check autostart status
  useEffect(() => {
    isEnabled().then(setAutoStartEnabled);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current && selectedAppId && logs[selectedAppId]?.length) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, selectedAppId]);

  // Get running apps on mount
  useEffect(() => {
    invoke<RunningApps>("get_running_apps").then(setRunningApps);
  }, []);

  // Listen for app events
  useEffect(() => {
    const unlistenStarted = listen<{ id: string; port: number }>(
      "app-started",
      (event) => {
        setRunningApps((prev) => ({
          ...prev,
          [event.payload.id]: event.payload.port,
        }));
        loadApps(); // Refresh tray
      }
    );

    const unlistenStopped = listen<{ id: string; code: number | null }>(
      "app-stopped",
      (event) => {
        setRunningApps((prev) => {
          const next = { ...prev };
          delete next[event.payload.id];
          return next;
        });
        loadApps(); // Refresh tray
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
          ].slice(-200), // Keep last 200 entries
        }));
      }
    );

    const unlistenOpenApp = listen<string>("open-app", async (event) => {
      const appId = event.payload;
      // Get current running apps from backend since state might be stale
      const currentRunning = await invoke<RunningApps>("get_running_apps");
      const port = currentRunning[appId];
      if (port) {
        invoke("open_in_browser", { port });
      }
    });

    return () => {
      unlistenStarted.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
      unlistenLog.then((fn) => fn());
      unlistenOpenApp.then((fn) => fn());
    };
  }, [loadApps, runningApps]);

  // Add new app
  const handleAddApp = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select your app folder",
    });

    if (!selected || !db) return;

    const path = selected as string;

    // Check if already exists
    const existing = await db.select<App[]>(
      "SELECT * FROM apps WHERE path = $1",
      [path]
    );
    if (existing.length > 0) {
      alert("This app is already added!");
      return;
    }

    // Try to read package.json for name
    let name = path.split("/").pop() || "Unknown App";
    try {
      const pkg = await invoke<{ name?: string }>("read_package_json", { path });
      if (pkg.name) {
        name = pkg.name;
      }
    } catch {
      // Use folder name if package.json doesn't exist
    }

    const id = await invoke<string>("generate_id");

    await db.execute(
      "INSERT INTO apps (id, name, path, command, run_on_startup) VALUES ($1, $2, $3, $4, $5)",
      [id, name, path, "bun start", false]
    );

    loadApps();
  };

  // Remove app
  const handleRemoveApp = async (id: string) => {
    if (!db) return;

    // Stop if running
    if (runningApps[id]) {
      await invoke("stop_app", { id });
    }

    await db.execute("DELETE FROM apps WHERE id = $1", [id]);
    loadApps();
  };

  // Start app
  const handleStartApp = async (app: App) => {
    const port = app.port || (await invoke<number>("get_free_port", { preferred: null }));
    
    try {
      await invoke("start_app", {
        id: app.id,
        path: app.path,
        command: app.command,
        port,
      });
    } catch (e) {
      console.error("Failed to start app:", e);
      alert(`Failed to start app: ${e}`);
    }
  };

  // Stop app
  const handleStopApp = async (id: string) => {
    await invoke("stop_app", { id });
  };

  // Open in browser
  const handleOpenInBrowser = (port: number) => {
    invoke("open_in_browser", { port });
  };

  // Save app changes
  const handleSaveApp = async () => {
    if (!editingApp || !db) return;

    await db.execute(
      "UPDATE apps SET name = $1, command = $2, port = $3, run_on_startup = $4 WHERE id = $5",
      [
        editingApp.name,
        editingApp.command,
        editingApp.port,
        editingApp.run_on_startup ? 1 : 0,
        editingApp.id,
      ]
    );

    setEditingApp(null);
    loadApps();
  };

  // Toggle manager autostart
  const handleToggleAutostart = async () => {
    if (autoStartEnabled) {
      await disable();
    } else {
      await enable();
    }
    setAutoStartEnabled(!autoStartEnabled);
  };

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  return (
    <div className="app-container">
      <header className="header">
        <h1>My Little Apps</h1>
        <div className="header-actions">
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
                        {isRunning && <span className="port-badge">:{port}</span>}
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
                              handleOpenInBrowser(port);
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

      {/* Edit Modal */}
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
    </div>
  );
}

export default AppComponent;
