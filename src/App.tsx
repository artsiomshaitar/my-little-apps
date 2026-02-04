import { useState, useCallback, useEffect } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { TooltipProvider } from "@/components/ui/tooltip";
import { confirm } from "@/components/confirm-dialog";

import { useProxy, useApps } from "@/hooks";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { AppDetails, EmptyAppDetails } from "@/components/app-details";
import {
  EditAppDialog,
  SetupWizardDialog,
  LanInfoDialog,
} from "@/components/dialogs";
import type { App } from "@/types";

function AppComponent() {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [showLanInfo, setShowLanInfo] = useState(false);

  const {
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
  } = useProxy();

  const {
    apps,
    runningApps,
    appsUsage,
    logs,
    addApp,
    removeApp,
    startApp,
    stopApp,
    restartApp,
    clearLogs,
    updateApp,
    handleOpenInBrowser,
    isDbReady,
  } = useApps({
    addProxyRoute,
    removeProxyRoute,
    proxyRoutes,
    setProxyRoutes,
    isProxyOperational,
  });

  useEffect(() => {
    isEnabled().then(setAutoStartEnabled);
  }, []);

  const handleToggleAutostart = useCallback(async () => {
    if (autoStartEnabled) {
      await disable();
    } else {
      await enable();
    }
    setAutoStartEnabled((prev) => !prev);
  }, [autoStartEnabled]);

  const handleInstallService = useCallback(async () => {
    try {
      await installService();
    } catch (e) {
      alert(`Installation failed: ${e}`);
    }
  }, [installService]);

  const handleUninstallService = useCallback(async () => {
    const shouldUninstall = await confirm(
      "Are you sure you want to uninstall the proxy service? Your apps will only be accessible via localhost:port.",
      { destructive: true }
    );
    if (!shouldUninstall) return;

    try {
      await uninstallService();
    } catch (e) {
      alert(`Uninstallation failed: ${e}`);
    }
  }, [uninstallService]);

  const handleStartProxyService = useCallback(async () => {
    try {
      await startProxyService();
    } catch (e) {
      alert(`Failed to start proxy service: ${e}`);
    }
  }, [startProxyService]);

  const handleSaveApp = useCallback(async () => {
    if (!editingApp) return;

    const originalApp = apps.find((a) => a.id === editingApp.id);
    const success = await updateApp(editingApp, originalApp);

    if (success) {
      setEditingApp(null);
    }
  }, [editingApp, apps, updateApp]);

  const handleRemoveApp = useCallback(async () => {
    if (!selectedAppId) return;
    await removeApp(selectedAppId);
    setSelectedAppId(null);
  }, [selectedAppId, removeApp]);

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <AppHeader
          serviceStatus={serviceStatus}
          isProxyOperational={isProxyOperational}
          setupLoading={setupLoading}
          autoStartEnabled={autoStartEnabled}
          onToggleAutostart={handleToggleAutostart}
          onSetupClick={() => setShowSetupWizard(true)}
          onStartProxy={handleStartProxyService}
          onUninstallProxy={handleUninstallService}
          onLanInfoClick={() => setShowLanInfo(true)}
          onAddApp={addApp}
          showLanButton={!!isProxyOperational && !!lanIp}
          isDbReady={isDbReady}
        />

        <main className="flex flex-1 overflow-hidden">
          <AppSidebar
            apps={apps}
            runningApps={runningApps}
            appsUsage={appsUsage}
            selectedAppId={selectedAppId}
            serviceStatus={serviceStatus}
            isProxyOperational={isProxyOperational}
            onSelectApp={setSelectedAppId}
            onStartApp={startApp}
            onStopApp={stopApp}
            onOpenApp={handleOpenInBrowser}
          />

          {selectedApp ? (
            <AppDetails
              app={selectedApp}
              isRunning={runningApps[selectedApp.id] !== undefined}
              port={runningApps[selectedApp.id]}
              logs={logs[selectedApp.id] || []}
              serviceStatus={serviceStatus}
              isProxyOperational={isProxyOperational}
              onEdit={() => setEditingApp({ ...selectedApp })}
              onRemove={handleRemoveApp}
              onRestart={() => restartApp(selectedApp)}
              onClearLogs={() => clearLogs(selectedApp.id)}
            />
          ) : (
            <EmptyAppDetails hasApps={apps.length > 0} />
          )}
        </main>

        <EditAppDialog
          editingApp={editingApp}
          apps={apps}
          onClose={() => setEditingApp(null)}
          onSave={handleSaveApp}
          onUpdate={setEditingApp}
        />

        <SetupWizardDialog
          open={showSetupWizard}
          serviceStatus={serviceStatus}
          setupLoading={setupLoading}
          onClose={() => setShowSetupWizard(false)}
          onInstall={handleInstallService}
        />

        <LanInfoDialog
          open={showLanInfo}
          lanIp={lanIp}
          onClose={() => setShowLanInfo(false)}
        />
      </div>
    </TooltipProvider>
  );
}

export default AppComponent;
