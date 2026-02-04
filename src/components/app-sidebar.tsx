import { memo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  App,
  AppUsage,
  AppsUsage,
  RunningApps,
  ProxyServiceStatus,
} from "@/types";
import { Badge } from "./ui/badge";

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const emptyStateContent = (
  <div className="p-4 text-center text-muted-foreground text-sm">
    <p>no apps added yet.</p>
    <p className="text-xs mt-1">click "+ add app" to start</p>
  </div>
);

interface AppListItemProps {
  app: App;
  isSelected: boolean;
  isRunning: boolean;
  port: number | undefined;
  usage: AppUsage | undefined;
  onSelect: (id: string) => void;
  onStart: (app: App) => void;
  onStop: (id: string) => void;
  onOpen: (app: App, port: number) => void;
}

const AppListItem = memo(function AppListItem({
  app,
  isSelected,
  isRunning,
  port,
  usage,
  onSelect,
  onStart,
  onStop,
  onOpen,
}: AppListItemProps) {
  const usageLine =
    isRunning && port ? (
      usage ? (
        <span>
          {usage.cpu.toFixed(1)}% CPU · {formatMB(usage.memory)} MB
        </span>
      ) : (
        "—% CPU · — MB"
      )
    ) : null;

  return (
    <div
      onClick={() => onSelect(app.id)}
      className={cn(
        "group px-3 py-2 cursor-pointer border-l-3 transition-colors",
        isSelected
          ? "bg-accent border-l-primary"
          : "border-l-transparent hover:bg-muted/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{app.name}</div>
          {usageLine ? (
            <div className="text-xs mt-0.5 text-muted-foreground">
              {usageLine}
            </div>
          ) : null}
        </div>
        <div
          className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {isRunning && port ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => onOpen(app, port)}
              >
                open
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => onStop(app.id)}
              >
                stop
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2 text-success hover:text-success"
              onClick={() => onStart(app)}
            >
              start
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

interface AppSidebarProps {
  apps: App[];
  runningApps: RunningApps;
  appsUsage: AppsUsage;
  selectedAppId: string | null;
  serviceStatus: ProxyServiceStatus | null;
  isProxyOperational: boolean | undefined;
  onSelectApp: (id: string) => void;
  onStartApp: (app: App) => void;
  onStopApp: (id: string) => void;
  onOpenApp: (app: App, port: number) => void;
}

export const AppSidebar = memo(function AppSidebar({
  apps,
  runningApps,
  appsUsage,
  selectedAppId,
  serviceStatus: _serviceStatus,
  isProxyOperational: _isProxyOperational,
  onSelectApp,
  onStartApp,
  onStopApp,
  onOpenApp,
}: AppSidebarProps) {
  return (
    <aside className="w-80 border-r border-border bg-sidebar flex flex-col">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          apps ({apps.length})
        </span>
      </div>
      <ScrollArea className="flex-1">
        {apps.length === 0 ? (
          emptyStateContent
        ) : (
          <div className="py-1">
            {apps.map((app) => (
              <AppListItem
                key={app.id}
                app={app}
                isSelected={selectedAppId === app.id}
                isRunning={runningApps[app.id] !== undefined}
                port={runningApps[app.id]}
                usage={appsUsage[app.id]}
                onSelect={onSelectApp}
                onStart={onStartApp}
                onStop={onStopApp}
                onOpen={onOpenApp}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
});
