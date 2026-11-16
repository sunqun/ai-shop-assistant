export type ToastType = "success" | "error" | "info";

export type ToastMessage = {
  id: string;
  type: ToastType;
  message: string;
};

export const TOAST_EVENT = "app-toast";

export function showToast(message: string, type: ToastType = "error") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastMessage>(TOAST_EVENT, {
      detail: { id: crypto.randomUUID(), type, message },
    })
  );
}
