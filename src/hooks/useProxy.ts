import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProxyServiceStatus, ProxyRoute } from "@/types";

export function useProxy() {
  const [lanIp, setLanIp] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ProxyServiceStatus | null>(null);
  const [proxyRoutes, setProxyRoutes] = useState<{ [id: string]: ProxyRoute }>({});
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);

  const isProxyOperational = serviceStatus?.installed && serviceStatus?.caddy_running;

  useEffect(() => {
    const initProxy = async () => {
      try {
        const [status, routes, ip] = await Promise.all([
          invoke<ProxyServiceStatus>("get_proxy_service_status"),
          invoke<{ [id: string]: ProxyRoute }>("get_proxy_routes"),
          invoke<string | null>("get_lan_ip"),
        ]);

        setServiceStatus(status);
        setProxyRoutes(routes);
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

  const addProxyRoute = useCallback(async (appId: string, subdomain: string, port: number) => {
    try {
      await invoke("add_proxy_route", { appId, subdomain, port });
      setProxyRoutes((prev) => ({
        ...prev,
        [appId]: { subdomain, port },
      }));
    } catch (e) {
      console.error("Failed to add proxy route:", e);
      throw e;
    }
  }, []);

  const removeProxyRoute = useCallback(async (appId: string) => {
    try {
      await invoke("remove_proxy_route", { appId });
      setProxyRoutes((prev) => {
        const next = { ...prev };
        delete next[appId];
        return next;
      });
    } catch (e) {
      console.error("Failed to remove proxy route:", e);
    }
  }, []);

  const installService = useCallback(async () => {
    setSetupLoading(true);
    try {
      await invoke("install_proxy_service");

      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
        setServiceStatus(status);

        if (status.installed && status.caddy_running) {
          setShowSetupWizard(false);
          break;
        }
      }
    } catch (e) {
      console.error("Service installation failed:", e);
      throw e;
    } finally {
      setSetupLoading(false);
    }
  }, []);

  const uninstallService = useCallback(async () => {
    try {
      await invoke("uninstall_proxy_service");
      const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
      setServiceStatus(status);
    } catch (e) {
      console.error("Service uninstallation failed:", e);
      throw e;
    }
  }, []);

  const startProxyService = useCallback(async () => {
    setSetupLoading(true);
    try {
      await invoke("start_proxy_service");

      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await invoke<ProxyServiceStatus>("get_proxy_service_status");
        setServiceStatus(status);

        if (status.caddy_running) {
          break;
        }
      }
    } catch (e) {
      console.error("Service start failed:", e);
      throw e;
    } finally {
      setSetupLoading(false);
    }
  }, []);

  return {
    lanIp,
    serviceStatus,
    proxyRoutes,
    showSetupWizard,
    setupLoading,
    isProxyOperational,
    setShowSetupWizard,
    setProxyRoutes,
    addProxyRoute,
    removeProxyRoute,
    installService,
    uninstallService,
    startProxyService,
  };
}
