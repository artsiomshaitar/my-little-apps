import { memo, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { App } from "@/types";

interface EditAppDialogProps {
  editingApp: App | null;
  apps: App[];
  onClose: () => void;
  onSave: () => void;
  onUpdate: (app: App) => void;
}

export const EditAppDialog = memo(function EditAppDialog({
  editingApp,
  apps,
  onClose,
  onSave,
  onUpdate,
}: EditAppDialogProps) {
  const subdomainConflict = useMemo(() => {
    if (!editingApp?.subdomain) return null;
    const conflict = apps.find(
      (a) => a.id !== editingApp.id && a.subdomain === editingApp.subdomain
    );
    return conflict ? conflict.name : null;
  }, [editingApp?.subdomain, editingApp?.id, apps]);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (editingApp) {
        onUpdate({ ...editingApp, name: e.target.value });
      }
    },
    [editingApp, onUpdate]
  );

  const handleSubdomainChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (editingApp) {
        onUpdate({ ...editingApp, subdomain: e.target.value || null });
      }
    },
    [editingApp, onUpdate]
  );

  const handleCommandChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (editingApp) {
        onUpdate({ ...editingApp, command: e.target.value });
      }
    },
    [editingApp, onUpdate]
  );

  const handlePortChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (editingApp) {
        onUpdate({
          ...editingApp,
          port: e.target.value ? parseInt(e.target.value) : null,
        });
      }
    },
    [editingApp, onUpdate]
  );

  const handleRunOnStartupChange = useCallback(
    (checked: boolean | "indeterminate") => {
      if (editingApp && checked !== "indeterminate") {
        onUpdate({ ...editingApp, run_on_startup: checked });
      }
    },
    [editingApp, onUpdate]
  );

  return (
    <Dialog open={!!editingApp} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            <span className="text-muted-foreground">&gt;</span> edit app
          </DialogTitle>
        </DialogHeader>
        {editingApp ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs">
                name
              </Label>
              <Input
                id="name"
                value={editingApp.name}
                onChange={handleNameChange}
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
                  onChange={handleSubdomainChange}
                  placeholder="my-app"
                  className={cn(
                    "h-8 text-sm rounded-r-none",
                    subdomainConflict &&
                      "border-destructive focus-visible:ring-destructive"
                  )}
                />
                <span className="h-8 px-3 flex items-center bg-muted text-muted-foreground text-sm border border-l-0 border-input rounded-r-md">
                  .local
                </span>
              </div>
              {subdomainConflict ? (
                <p className="text-xs text-destructive">
                  already used by "{subdomainConflict}"
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="command" className="text-xs">
                command
              </Label>
              <Input
                id="command"
                value={editingApp.command}
                onChange={handleCommandChange}
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
                onChange={handlePortChange}
                placeholder="auto"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="run_on_startup"
                checked={editingApp.run_on_startup}
                onCheckedChange={handleRunOnStartupChange}
              />
              <Label htmlFor="run_on_startup" className="text-xs cursor-pointer">
                run on startup
              </Label>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={!!subdomainConflict}>
            save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
