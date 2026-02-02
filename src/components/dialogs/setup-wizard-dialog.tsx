import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProxyServiceStatus } from "@/types";

interface SetupWizardDialogProps {
  open: boolean;
  serviceStatus: ProxyServiceStatus | null;
  setupLoading: boolean;
  onClose: () => void;
  onInstall: () => void;
}

export const SetupWizardDialog = memo(function SetupWizardDialog({
  open,
  serviceStatus,
  setupLoading,
  onClose,
  onInstall,
}: SetupWizardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
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
          <Button variant="ghost" size="sm" onClick={onClose}>
            skip
          </Button>
          <Button size="sm" onClick={onInstall} disabled={setupLoading}>
            {setupLoading ? "installing..." : "install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
