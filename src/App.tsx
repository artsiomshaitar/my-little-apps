import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Database from "@tauri-apps/plugin-sql";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  const [serviceStatus, setServiceStatus] =
    useState<ProxyServiceStatus | null>(null);
  const [proxyRoutes, setProxyRoutes] = useState<{ [id: string]: ProxyRoute }>(
    {}
  );
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showLanInfo, setShowLanInfo] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const subdomainConflict = useMemo(() => {
    if (!editingApp?.subdomain) return null;
    const conflict = apps.find(
      (a) => a.id !== editingApp.id && a.subdomain === editingApp.subdomain
    );
    return conflict ? conflict.name : null;
  }, [editingApp?.subdomain, editingApp?.id, apps]);

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
        const status =
          await invoke<ProxyServiceStatus>("get_proxy_service_status");
        setServiceStatus(status);

        const routes = await invoke<{ [id: string]: ProxyRoute }>(
          "get_proxy_routes"
        );
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

  const autoStartApps = useCallback(
    async (appsToStart: App[], currentRunning: RunningApps) => {
      for (const app of appsToStart) {
        if (app.run_on_startup && !currentRunning[app.id]) {
          try {
            const port =
              app.port ||
              (await invoke<number>("get_free_port", { preferred: null }));
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
    },
    []
  );

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
                console.log(
                  `Re-registered proxy route: ${app.subdomain} -> localhost:${port}`
                );
              } catch (e) {
                console.error(
                  `Failed to re-register proxy route for ${app.name}:`,
                  e
                );
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

  const isProxyOperational =
    serviceStatus?.installed && serviceStatus?.caddy_running;

  const handleOpenInBrowser = useCallback(
    (app: App, port: number) => {
      const sub = app.subdomain && isProxyOperational ? app.subdomain : null;
      invoke("open_in_browser", { port, subdomain: sub });
    },
    [isProxyOperational]
  );

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
        } catch (e) {}

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
        const app = apps.find((a) => a.id === appId);
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
      const pkg = await invoke<{ name?: string }>("read_package_json", {
        path,
      });
      if (pkg.name) {
        name = pkg.name;
      }
    } catch {}

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
    const port =
      app.port ||
      (await invoke<number>("get_free_port", { preferred: null }));

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
          setProxyRoutes((prev) => ({
            ...prev,
            [app.id]: { subdomain: app.subdomain!, port: actualPort },
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
        setProxyRoutes((prev) => {
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

    const originalApp = apps.find((a) => a.id === editingApp.id);
    const oldSubdomain = originalApp?.subdomain;
    const newSubdomain = editingApp.subdomain;

    if (newSubdomain) {
      const conflictingApp = apps.find(
        (a) => a.id !== editingApp.id && a.subdomain === newSubdomain
      );
      if (conflictingApp) {
        alert(`Subdomain "${newSubdomain}" is already used by "${conflictingApp.name}"`);
        return;
      }
    }

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
      const port = runningApps[editingApp.id];
      const subdomainChanged = oldSubdomain !== newSubdomain;

      try {
        if (subdomainChanged && oldSubdomain && proxyRoutes[editingApp.id]) {
          await invoke("remove_proxy_route", { appId: editingApp.id });
          setProxyRoutes((prev) => {
            const next = { ...prev };
            delete next[editingApp.id];
            return next;
          });
        }

        if (newSubdomain) {
          await invoke("add_proxy_route", {
            appId: editingApp.id,
            subdomain: newSubdomain,
            port,
          });
          setProxyRoutes((prev) => ({
            ...prev,
            [editingApp.id]: {
              subdomain: newSubdomain,
              port,
            },
          }));
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status =
          await invoke<ProxyServiceStatus>("get_proxy_service_status");
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
    if (
      !confirm(
        "Are you sure you want to uninstall the proxy service? Your apps will only be accessible via localhost:port."
      )
    ) {
      return;
    }
    try {
      await invoke("uninstall_proxy_service");
      const status =
        await invoke<ProxyServiceStatus>("get_proxy_service_status");
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status =
          await invoke<ProxyServiceStatus>("get_proxy_service_status");
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
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">&gt;</span>
            <h1 className="text-sm font-semibold tracking-tight">
              my-little-apps
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 pr-3 border-r border-border">
              <Badge
                variant={isProxyOperational ? "default" : "secondary"}
                className={cn(
                  "text-xs",
                  isProxyOperational
                    ? "bg-success/20 text-success border-success/30"
                    : "bg-muted text-muted-foreground"
                )}
              >
                proxy:{" "}
                {isProxyOperational
                  ? "running"
                  : serviceStatus?.installed
                    ? "stopped"
                    : "not installed"}
              </Badge>
              {!serviceStatus?.installed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setShowSetupWizard(true)}
                >
                  setup
                </Button>
              )}
              {serviceStatus?.installed && !isProxyOperational && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-success"
                  onClick={handleStartProxyService}
                  disabled={setupLoading}
                >
                  {setupLoading ? "starting..." : "start"}
                </Button>
              )}
              {isProxyOperational && lanIp && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setShowLanInfo(true)}
                >
                  lan
                </Button>
              )}
              {serviceStatus?.installed && (
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={handleUninstallService}
                >
                  uninstall
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="autostart"
                checked={autoStartEnabled}
                onCheckedChange={handleToggleAutostart}
                className="scale-75"
              />
              <Label htmlFor="autostart" className="text-xs text-muted-foreground cursor-pointer">
                autostart
              </Label>
            </div>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddApp}
            >
              + add app
            </Button>
          </div>
        </header>

        <main className="flex flex-1 overflow-hidden">
          <aside className="w-80 border-r border-border bg-sidebar flex flex-col">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                apps ({apps.length})
              </span>
            </div>
            <ScrollArea className="flex-1">
              {apps.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  <p>no apps added yet.</p>
                  <p className="text-xs mt-1">click "+ add app" to start</p>
                </div>
              ) : (
                <div className="py-1">
                  {apps.map((app) => {
                    const isRunning = runningApps[app.id] !== undefined;
                    const port = runningApps[app.id];

                    return (
                      <div
                        key={app.id}
                        onClick={() => setSelectedAppId(app.id)}
                        className={cn(
                          "group px-3 py-2 cursor-pointer border-l-2 transition-colors",
                          selectedAppId === app.id
                            ? "bg-accent/10 border-l-primary"
                            : "border-l-transparent hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                              {app.name}
                            </div>
                            {isRunning && (
                              <div className="flex items-center gap-1 text-xs mt-0.5">
                                {serviceStatus?.installed && app.subdomain && (
                                  <>
                                    <span
                                      className={cn(
                                        "text-success",
                                        !isProxyOperational && "opacity-50"
                                      )}
                                    >
                                      {app.subdomain}.local
                                    </span>
                                    <span className="text-muted-foreground">|</span>
                                  </>
                                )}
                                <span className="text-muted-foreground">
                                  :{port}
                                </span>
                              </div>
                            )}
                          </div>
                          <div
                            className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isRunning ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={() => handleOpenInBrowser(app, port)}
                                >
                                  open
                                </Button>
                                <Button
                                  variant="ghost-destructive"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={() => handleStopApp(app.id)}
                                >
                                  stop
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs px-2 text-success hover:text-success"
                                onClick={() => handleStartApp(app)}
                              >
                                start
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </aside>

          {selectedApp ? (
            <section className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">&gt;</span>
                  <h2 className="text-sm font-semibold">{selectedApp.name}</h2>
                  {runningApps[selectedApp.id] && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-success/10 text-success border-success/30"
                    >
                      running
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditingApp({ ...selectedApp })}
                  >
                    edit
                  </Button>
                  <Button
                    variant="ghost-destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      if (confirm("remove this app?")) {
                        handleRemoveApp(selectedApp.id);
                        setSelectedAppId(null);
                      }
                    }}
                  >
                    remove
                  </Button>
                </div>
              </div>

              <div className="p-4 border-b border-border bg-card/50">
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div className="flex">
                    <span className="text-muted-foreground w-24">path:</span>
                    <code className="text-xs break-all">{selectedApp.path}</code>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">command:</span>
                    <code className="text-xs">{selectedApp.command}</code>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">port:</span>
                    <span className="text-xs">
                      {selectedApp.port || "auto"}
                    </span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">autostart:</span>
                    <span className="text-xs">
                      {selectedApp.run_on_startup ? "yes" : "no"}
                    </span>
                  </div>
                </div>

                {runningApps[selectedApp.id] && (
                  <>
                    <Separator className="my-3" />
                    <div className="space-y-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        urls
                      </span>
                      <div className="space-y-1">
                        {serviceStatus?.installed && selectedApp.subdomain && (
                          <div
                            className={cn(
                              "flex items-center gap-2",
                              !isProxyOperational && "opacity-50"
                            )}
                          >
                            <code className="text-xs text-success">
                              http://{selectedApp.subdomain}.local
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 text-xs px-2"
                              onClick={() =>
                                copyToClipboard(
                                  `http://${selectedApp.subdomain}.local`
                                )
                              }
                              disabled={!isProxyOperational}
                            >
                              {copiedUrl ===
                              `http://${selectedApp.subdomain}.local`
                                ? "copied!"
                                : "copy"}
                            </Button>
                            {!isProxyOperational && (
                              <span className="text-xs text-warning">
                                (proxy stopped)
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-muted-foreground">
                            http://localhost:{runningApps[selectedApp.id]}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-xs px-2"
                            onClick={() =>
                              copyToClipboard(
                                `http://localhost:${runningApps[selectedApp.id]}`
                              )
                            }
                          >
                            {copiedUrl ===
                            `http://localhost:${runningApps[selectedApp.id]}`
                              ? "copied!"
                              : "copy"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    logs
                  </span>
                </div>
                <ScrollArea className="flex-1 min-h-0 bg-[oklch(0.1_0.005_285.823)]">
                  <div className="p-4 text-xs leading-relaxed">
                    {(logs[selectedApp.id] || []).length === 0 ? (
                      <p className="text-muted-foreground italic">
                        no logs yet. start the app to see output.
                      </p>
                    ) : (
                      <>
                        {(logs[selectedApp.id] || []).map((log, i) => (
                          <div
                            key={i}
                            className={cn(
                              "py-0.5",
                              log.type === "stderr" && "text-destructive"
                            )}
                          >
                            {log.message}
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </section>
          ) : (
            <section className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              {apps.length > 0 ? (
                <p>select an app to view details</p>
              ) : (
                <p>add an app to get started</p>
              )}
            </section>
          )}
        </main>

        <Dialog open={!!editingApp} onOpenChange={() => setEditingApp(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">
                <span className="text-muted-foreground">&gt;</span> edit app
              </DialogTitle>
            </DialogHeader>
            {editingApp && (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs">
                    name
                  </Label>
                  <Input
                    id="name"
                    value={editingApp.name}
                    onChange={(e) =>
                      setEditingApp({ ...editingApp, name: e.target.value })
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subdomain" className="text-xs">
                    subdomain
                  </Label>
                  <div className="flex items-center">
                    <Input
                      id="subdomain"
                      value={editingApp.subdomain || ""}
                      onChange={(e) =>
                        setEditingApp({
                          ...editingApp,
                          subdomain: e.target.value || null,
                        })
                      }
                      placeholder="my-app"
                      className={cn(
                        "h-8 text-sm rounded-r-none",
                        subdomainConflict && "border-destructive focus-visible:ring-destructive"
                      )}
                    />
                    <span className="h-8 px-3 flex items-center bg-muted text-muted-foreground text-sm border border-l-0 border-input rounded-r-md">
                      .local
                    </span>
                  </div>
                  {subdomainConflict && (
                    <p className="text-xs text-destructive">
                      already used by "{subdomainConflict}"
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="command" className="text-xs">
                    command
                  </Label>
                  <Input
                    id="command"
                    value={editingApp.command}
                    onChange={(e) =>
                      setEditingApp({ ...editingApp, command: e.target.value })
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port" className="text-xs">
                    port (empty for auto)
                  </Label>
                  <Input
                    id="port"
                    type="number"
                    value={editingApp.port || ""}
                    onChange={(e) =>
                      setEditingApp({
                        ...editingApp,
                        port: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="auto"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="run_on_startup"
                    checked={editingApp.run_on_startup}
                    onCheckedChange={(checked) =>
                      setEditingApp({
                        ...editingApp,
                        run_on_startup: checked as boolean,
                      })
                    }
                  />
                  <Label htmlFor="run_on_startup" className="text-xs cursor-pointer">
                    run on startup
                  </Label>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingApp(null)}
              >
                cancel
              </Button>
              <Button size="sm" onClick={handleSaveApp} disabled={!!subdomainConflict}>
                save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showSetupWizard} onOpenChange={setShowSetupWizard}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">
                <span className="text-muted-foreground">&gt;</span> proxy setup
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2 text-sm">
              <p className="text-muted-foreground">
                install a background proxy to access apps via clean URLs like{" "}
                <code className="text-primary">my-app.local</code>
              </p>

              <div className="bg-muted/50 p-3 space-y-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  status
                </span>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        serviceStatus?.installed ? "bg-success" : "bg-warning"
                      )}
                    />
                    <span>
                      service: {serviceStatus?.installed ? "installed" : "not installed"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        serviceStatus?.caddy_running ? "bg-success" : "bg-warning"
                      )}
                    />
                    <span>
                      proxy: {serviceStatus?.caddy_running ? "running" : "not running"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 p-3 space-y-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  what will be installed
                </span>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                  <li>background proxy service (caddy)</li>
                  <li>mDNS advertising for LAN access</li>
                </ul>
                <p className="text-xs text-warning mt-2 p-2 bg-warning/10 border border-warning/30">
                  one-time setup requiring admin password. no further passwords needed after.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSetupWizard(false)}
              >
                skip
              </Button>
              <Button
                size="sm"
                onClick={handleInstallService}
                disabled={setupLoading}
              >
                {setupLoading ? "installing..." : "install"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showLanInfo} onOpenChange={setShowLanInfo}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">
                <span className="text-muted-foreground">&gt;</span> lan access
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2 text-sm">
              <p className="text-muted-foreground">
                apps are discoverable on the local network via mDNS (Bonjour).
              </p>

              <div className="bg-muted/50 p-3 space-y-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  how to access
                </span>
                <p className="text-xs text-muted-foreground">
                  from any device on the same network:
                </p>
                <div className="bg-background p-3 text-center">
                  <code className="text-success text-lg">
                    http://your-app.local
                  </code>
                </div>
                <p className="text-xs text-muted-foreground">
                  e.g., if subdomain is "zrabi-dev", open{" "}
                  <code className="text-primary">http://zrabi-dev.local</code> in Safari on
                  your iPhone.
                </p>
              </div>

              <div className="bg-muted/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">your IP:</span>
                  <div className="flex items-center gap-2">
                    <code className="text-success">{lanIp}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => lanIp && copyToClipboard(lanIp)}
                    >
                      {copiedUrl === lanIp ? "copied!" : "copy"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button size="sm" onClick={() => setShowLanInfo(false)}>
                done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

export default AppComponent;
