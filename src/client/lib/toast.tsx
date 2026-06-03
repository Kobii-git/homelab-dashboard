import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

export type ToastTone = "success" | "error";

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let externalPush: ToastContextValue["pushToast"] | null = null;

export function pushToast(message: string, tone: ToastTone = "success"): void {
  externalPush?.(message, tone);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    externalPush = push;
    return () => {
      externalPush = null;
    };
  }, [push]);

  const value = useMemo(() => ({ pushToast: push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            {toast.tone === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
