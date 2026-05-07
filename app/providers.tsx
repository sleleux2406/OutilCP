"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Providers globaux de l'application (client-side).
 * - TanStack Query : cache des données serveur, optimistic updates du Kanban.
 *
 * Le QueryClient est créé une fois par onglet via useState pour éviter
 * le partage entre requêtes SSR.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Les Server Components fournissent la donnée initiale, on évite donc
            // les re-fetchs inutiles en foreground.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
