import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface LanInfoDialogProps {
  open: boolean;
  lanIp: string | null;
  onClose: () => void;
}

export const LanInfoDialog = memo(function LanInfoDialog({
  open,
  lanIp,
  onClose,
}: LanInfoDialogProps) {
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            <span className="text-muted-foreground">&gt;</span> lan access
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-muted-foreground text-xs">
            apps are discoverable on the local network via mDNS (Bonjour).
          </p>
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">how to access</span>
            <p className="text-xs text-muted-foreground">
              from any device on the same network:
            </p>
            <div className="bg-muted px-3 py-2">
              <code className="text-success text-sm">http://your-app.local</code>
            </div>
            <p className="text-xs text-muted-foreground">
              e.g., if subdomain is "zrabi-dev", open{" "}
              <code className="text-primary">http://zrabi-dev.local</code> in Safari on
              your iPhone.
            </p>
          </div>
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">your IP</span>
            <div className="flex items-center gap-2">
              <code className="text-xs text-success">{lanIp ?? "—"}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => lanIp && copyToClipboard(lanIp)}
                disabled={!lanIp}
              >
                {copiedUrl === lanIp ? "copied!" : "copy"}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
