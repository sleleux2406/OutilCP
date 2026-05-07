"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Wrapper pré-configuré de Sonner.
 * À monter une seule fois dans app/layout.tsx.
 *
 * Usage ailleurs :
 *   import { toast } from "sonner";
 *   toast.success("OK"); toast.error("KO"); toast(jsx, { action: {...} });
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}
