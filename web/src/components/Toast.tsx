import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}
interface ToastApi {
  show: (message: string, action?: { label: string; run: () => void }) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>(undefined);

  const dismiss = useCallback(() => setToast(null), []);
  const show = useCallback<ToastApi['show']>((message, action) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), message, actionLabel: action?.label, onAction: action?.run });
    timer.current = window.setTimeout(dismiss, 3500);
  }, [dismiss]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              onClick={() => {
                toast.onAction?.();
                dismiss();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
