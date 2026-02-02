import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ProxyServiceStatus } from "@/types";

interface AppHeaderProps {
  serviceStatus: ProxyServiceStatus | null;
  isProxyOperational: boolean | undefined;
  setupLoading: boolean;
  autoStartEnabled: boolean;
  onToggleAutostart: () => void;
  onSetupClick: () => void;
  onStartProxy: () => void;
  onUninstallProxy: () => void;
  onLanInfoClick: () => void;
  onAddApp: () => void;
  showLanButton: boolean;
}

export const AppHeader = memo(function AppHeader({
  serviceStatus,
  isProxyOperational,
  setupLoading,
  autoStartEnabled,
  onToggleAutostart,
  onSetupClick,
  onStartProxy,
  onUninstallProxy,
  onLanInfoClick,
  onAddApp,
  showLanButton,
}: AppHeaderProps) {
  const proxyStatusText = isProxyOperational
    ? "running"
    : serviceStatus?.installed
    ? "stopped"
    : "not installed";

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">&gt;</span>
        <h1 className="text-sm font-semibold tracking-tight">my-little-apps</h1>
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
            proxy: {proxyStatusText}
          </Badge>
          {!serviceStatus?.installed ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={onSetupClick}
            >
              setup
            </Button>
          ) : null}
          {serviceStatus?.installed && !isProxyOperational ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-success"
              onClick={onStartProxy}
              disabled={setupLoading}
            >
              {setupLoading ? "starting..." : "start"}
            </Button>
          ) : null}
          {showLanButton ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={onLanInfoClick}
            >
              lan
            </Button>
          ) : null}
          {serviceStatus?.installed ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-6 text-xs"
              onClick={onUninstallProxy}
            >
              uninstall
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="autostart"
            checked={autoStartEnabled}
            onCheckedChange={onToggleAutostart}
            className="scale-75"
          />
          <Label
            htmlFor="autostart"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            autostart
          </Label>
        </div>
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs"
          onClick={onAddApp}
        >
          + add app
        </Button>
      </div>
    </header>
  );
});
