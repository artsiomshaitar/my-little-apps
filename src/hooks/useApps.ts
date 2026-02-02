import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { info, error } from "@tauri-apps/plugin-log";
import Database from "@tauri-apps/plugin-sql";
import type { App, RunningApps, AppLogs, ProxyRoute } from "@/types";

interface UseAppsOptions {
  addProxyRoute: (
    appId: string,
    subdomain: string,
    port: number
  ) => Promise<void>;
  removeProxyRoute: (appId: string) => Promise<void>;
  proxyRoutes: { [id: string]: ProxyRoute };
  setProxyRoutes: React.Dispatch<
    React.SetStateAction<{ [id: string]: ProxyRoute }>
  >;
  isProxyOperational: boolean | undefined;
}

export function useApps({
  addProxyRoute,
  removeProxyRoute,
  proxyRoutes,
  setProxyRoutes,
  isProxyOperational,
}: UseAppsOptions) {
  const [apps, setApps] = useState<App[]>([]);
  const [runningApps, setRunningApps] = useState<RunningApps>({});
  const [logs, setLogs] = useState<AppLogs>({});
  const [db, setDb] = useState<Database | null>(null);
  const appsRef = useRef<App[]>([]);

  useEffect(() => {
    appsRef.current = apps;
  }, [apps]);

  useEffect(() => {
    const initDb = async () => {
      try {
        const database = await Database.load("sqlite:my-little-apps.db");
        setDb(database);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        try {
          await error(`Database load failed: ${message}`);
        } catch {}
      }
    };
    initDb();
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
                await addProxyRoute(app.id, app.subdomain, actualPort);
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
    [addProxyRoute]
  );

  useEffect(() => {
    if (!db) return;

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
  }, [db, loadApps, autoStartApps, setProxyRoutes]);

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
        } catch {}

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
        const app = appsRef.current.find((a) => a.id === appId);
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
  }, [loadApps, handleOpenInBrowser, setProxyRoutes]);

  const addApp = useCallback(async () => {
    try {
      await info("Add app: opening folder dialog");
    } catch {}
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select your app folder",
    });

    if (!selected) {
      try {
        await error("Add app: dialog cancelled or returned no path");
      } catch {}
      return;
    }
    if (!db) {
      try {
        await error("Add app: database not ready");
      } catch {}
      return;
    }

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

    try {
      const id = await invoke<string>("generate_id");
      const subdomain = await invoke<string>("slugify_name", { name });

      await db.execute(
        "INSERT INTO apps (id, name, path, command, run_on_startup, subdomain) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, name, path, "bun start", false, subdomain]
      );

      try {
        await info(`Add app: added project ${name} at ${path}`);
      } catch {}
      loadApps();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      try {
        await error(`Add app failed: ${reason}`);
      } catch {}
      throw e;
    }
  }, [db, loadApps]);

  const removeApp = useCallback(
    async (id: string) => {
      if (!db) return;

      const running = await invoke<RunningApps>("get_running_apps");
      if (running[id]) {
        await invoke("stop_app", { id });
        await removeProxyRoute(id);
      }

      await db.execute("DELETE FROM apps WHERE id = $1", [id]);
      loadApps();
    },
    [db, loadApps, removeProxyRoute]
  );

  const startApp = useCallback(
    async (app: App) => {
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
          await addProxyRoute(app.id, app.subdomain, actualPort);
        }
      } catch (e) {
        console.error("Failed to start app:", e);
        alert(`Failed to start app: ${e}`);
      }
    },
    [addProxyRoute]
  );

  const stopApp = useCallback(
    async (id: string) => {
      await invoke("stop_app", { id });
      await removeProxyRoute(id);
    },
    [removeProxyRoute]
  );

  const updateApp = useCallback(
    async (editingApp: App, originalApp: App | undefined) => {
      if (!db) return;

      const oldSubdomain = originalApp?.subdomain;
      const newSubdomain = editingApp.subdomain;

      if (newSubdomain) {
        const conflictingApp = apps.find(
          (a) => a.id !== editingApp.id && a.subdomain === newSubdomain
        );
        if (conflictingApp) {
          alert(
            `Subdomain "${newSubdomain}" is already used by "${conflictingApp.name}"`
          );
          return false;
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

      const running = await invoke<RunningApps>("get_running_apps");
      if (running[editingApp.id]) {
        const port = running[editingApp.id];
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
              [editingApp.id]: { subdomain: newSubdomain, port },
            }));
          }
        } catch (e) {
          console.error("Failed to update proxy route:", e);
        }
      }

      loadApps();
      return true;
    },
    [db, apps, loadApps, proxyRoutes, setProxyRoutes]
  );

  return {
    apps,
    runningApps,
    logs,
    addApp,
    removeApp,
    startApp,
    stopApp,
    updateApp,
    handleOpenInBrowser,
    loadApps,
    isDbReady: db !== null,
  };
}
