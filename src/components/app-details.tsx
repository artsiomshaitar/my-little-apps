import { memo, useRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { confirm } from "@/components/confirm-dialog";
import type { App, LogEntry, ProxyServiceStatus } from "@/types";

const emptyLogsMessage = (
  <p className="text-muted-foreground italic">no logs yet. start the app to see output.</p>
);

interface LogLineProps {
  log: LogEntry;
}

const LogLine = memo(function LogLine({ log }: LogLineProps) {
  return (
    <div className={cn("py-0.5", log.type === "stderr" && "text-destructive")}>
      {log.message}
    </div>
  );
});

interface AppLogsProps {
  logs: LogEntry[];
}

const AppLogs = memo(function AppLogs({ logs }: AppLogsProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current && logs.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">logs</span>
      </div>
      <ScrollArea className="flex-1 min-h-0 bg-[oklch(0.1_0.005_285.823)]">
        <div className="p-4 text-xs leading-relaxed">
          {logs.length === 0 ? (
            emptyLogsMessage
          ) : (
            <>
              {logs.map((log, i) => (
                <LogLine key={i} log={log} />
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

interface AppUrlsProps {
  subdomain: string | null;
  port: number;
  serviceInstalled: boolean;
  isProxyOperational: boolean | undefined;
}

const AppUrls = memo(function AppUrls({
  subdomain,
  port,
  serviceInstalled,
  isProxyOperational,
}: AppUrlsProps) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }, []);

  const proxyUrl = subdomain ? `http://${subdomain}.local` : null;
  const localhostUrl = `http://localhost:${port}`;

  return (
    <>
      <Separator className="my-3" />
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">urls</span>
        <div className="space-y-1">
          {serviceInstalled && proxyUrl ? (
            <div
              className={cn("flex items-center gap-2", !isProxyOperational && "opacity-50")}
            >
              <code className="text-xs text-success">{proxyUrl}</code>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-xs px-2"
                onClick={() => copyToClipboard(proxyUrl)}
                disabled={!isProxyOperational}
              >
                {copiedUrl === proxyUrl ? "copied!" : "copy"}
              </Button>
              {!isProxyOperational ? (
                <span className="text-xs text-warning">(proxy stopped)</span>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <code className="text-xs text-muted-foreground">{localhostUrl}</code>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-2"
              onClick={() => copyToClipboard(localhostUrl)}
            >
              {copiedUrl === localhostUrl ? "copied!" : "copy"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
});

interface AppDetailsProps {
  app: App;
  isRunning: boolean;
  port: number | undefined;
  logs: LogEntry[];
  serviceStatus: ProxyServiceStatus | null;
  isProxyOperational: boolean | undefined;
  onEdit: () => void;
  onRemove: () => void;
}

export const AppDetails = memo(function AppDetails({
  app,
  isRunning,
  port,
  logs,
  serviceStatus,
  isProxyOperational,
  onEdit,
  onRemove,
}: AppDetailsProps) {
  const handleRemove = useCallback(async () => {
    const shouldRemove = await confirm("Remove this app?", {
      confirm: "Remove",
      destructive: true,
    });
    if (shouldRemove) {
      onRemove();
    }
  }, [onRemove]);

  return (
    <section className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">&gt;</span>
          <h2 className="text-sm font-semibold">{app.name}</h2>
          {isRunning ? (
            <Badge
              variant="outline"
              className="text-xs bg-success/10 text-success border-success/30"
            >
              running
            </Badge>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
            edit
          </Button>
          <Button
            variant="ghost-destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={handleRemove}
          >
            remove
          </Button>
        </div>
      </div>

      <div className="p-4 border-b border-border bg-card/50">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex">
            <span className="text-muted-foreground w-24">path:</span>
            <code className="text-xs break-all">{app.path}</code>
          </div>
          <div className="flex">
            <span className="text-muted-foreground w-24">command:</span>
            <code className="text-xs">{app.command}</code>
          </div>
          <div className="flex">
            <span className="text-muted-foreground w-24">port:</span>
            <span className="text-xs">{app.port || "auto"}</span>
          </div>
          <div className="flex">
            <span className="text-muted-foreground w-24">autostart:</span>
            <span className="text-xs">{app.run_on_startup ? "yes" : "no"}</span>
          </div>
        </div>

        {isRunning && port ? (
          <AppUrls
            subdomain={app.subdomain}
            port={port}
            serviceInstalled={serviceStatus?.installed ?? false}
            isProxyOperational={isProxyOperational}
          />
        ) : null}
      </div>

      <AppLogs logs={logs} />
    </section>
  );
});

const selectAppMessage = <p>select an app to view details</p>;
const addAppMessage = <p>add an app to get started</p>;

interface EmptyAppDetailsProps {
  hasApps: boolean;
}

export const EmptyAppDetails = memo(function EmptyAppDetails({ hasApps }: EmptyAppDetailsProps) {
  return (
    <section className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      {hasApps ? selectAppMessage : addAppMessage}
    </section>
  );
});
