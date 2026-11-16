"use client";

import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastMessage } from "@/lib/toast";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    function handle(event: Event) {
      const toast = (event as CustomEvent<ToastMessage>).detail;
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 4000);
    }
    window.addEventListener(TOAST_EVENT, handle);
    return () => window.removeEventListener(TOAST_EVENT, handle);
  }, []);

  return (
    <>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.type}`} key={toast.id} role="status">
            {toast.message}
          </div>
        ))}
      </div>
    </>
  );
}
