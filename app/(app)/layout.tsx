import { requireAuth } from "@/lib/auth";
import { AppHeader } from "@/components/layout/AppHeader";

/**
 * Layout racine de l'application authentifiée.
 * Tous les segments dans (app)/ héritent de la session et du header global.
 * Le middleware fait un pre-check cookie, mais requireAuth() est la vraie vérification.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();

  return (
    <>
      <AppHeader session={session} />
      <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>
    </>
  );
}
