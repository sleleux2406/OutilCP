"use client";

import { useTransition } from "react";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Loader2 } from "lucide-react";

/**
 * Bouton de déconnexion — appelle la Server Action logoutAction.
 * Utilisable dans le header global.
 */
export function LogoutButton({ className }: { className?: string }) {
  const [pending, start] = useTransition();
  return (
    <form
      action={() => start(() => logoutAction())}
      className={className}
    >
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">Déconnexion</span>
      </Button>
    </form>
  );
}
