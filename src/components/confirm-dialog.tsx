import { useState, useCallback, createContext } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOptions {
  title?: string;
  cancel?: string;
  confirm?: string;
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  message: string;
  options: ConfirmOptions;
  resolve: ((value: boolean) => void) | null;
}

type ShowConfirmFn = (
  message: string,
  options?: ConfirmOptions
) => Promise<boolean>;

const ConfirmContext = createContext<ShowConfirmFn | null>(null);

let globalShowConfirm: ShowConfirmFn | null = null;

export function confirm(
  message: string,
  options?: ConfirmOptions
): Promise<boolean> {
  if (!globalShowConfirm) {
    console.error("ConfirmDialogProvider not mounted");
    return Promise.resolve(false);
  }
  return globalShowConfirm(message, options);
}

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    message: "",
    options: {},
    resolve: null,
  });

  const showConfirm: ShowConfirmFn = useCallback((message, options = {}) => {
    return new Promise<boolean>((resolve) => {
      setState({
        open: true,
        message,
        options,
        resolve,
      });
    });
  }, []);

  globalShowConfirm = showConfirm;

  const handleResponse = (value: boolean) => {
    state.resolve?.(value);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  };

  return (
    <ConfirmContext.Provider value={showConfirm}>
      {children}
      <AlertDialog
        open={state.open}
        onOpenChange={(open) => !open && handleResponse(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold">
              <span className="text-muted-foreground">&gt;</span>{" "}
              {state.options.title || "confirm"}
            </AlertDialogTitle>
            <AlertDialogDescription>{state.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" onClick={() => handleResponse(false)}>
              {state.options.cancel || "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant={state.options.destructive ? "destructive" : "default"}
              onClick={() => handleResponse(true)}
            >
              {state.options.confirm || "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
