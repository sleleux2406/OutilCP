"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Gestionnaire global d'erreurs React (côté client).
 * N'expose PAS la stack ou le message complet à l'utilisateur [A09].
 * En dev on montre le message pour aider au debug.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log côté client. En prod, brancher sur Sentry/Datadog.
    console.error("[GlobalError]", error.digest ?? error.message);
  }, [error]);

  const showDetails = process.env.NODE_ENV !== "production";

  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="max-w-md w-full text-center bg-card border rounded-xl p-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
          <AlertTriangle className="w-7 h-7 text-destructive" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold mb-2">Une erreur est survenue</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Nos équipes ont été notifiées. Vous pouvez réessayer ci-dessous.
        </p>
        {showDetails && (
          <pre className="text-left text-xs bg-muted p-3 rounded-md mb-4 overflow-auto max-h-40">
            {error.message}
            {error.digest && <>{"\n"}digest: {error.digest}</>}
          </pre>
        )}
        <Button onClick={reset}>
          <RotateCw className="h-4 w-4" />
          Réessayer
        </Button>
      </div>
    </main>
  );
}
