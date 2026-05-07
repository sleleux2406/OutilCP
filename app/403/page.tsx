import Link from "next/link";
import { ShieldAlert, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Accès refusé — QA Platform",
};

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-muted/40 p-4">
      <div className="max-w-md w-full bg-card border rounded-xl shadow-sm p-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
          <ShieldAlert className="w-7 h-7 text-destructive" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold mb-2">Accès refusé</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Votre rôle ne vous permet pas d'accéder à cette page. Si vous pensez qu'il s'agit
          d'une erreur, contactez votre administrateur.
        </p>
        <Button asChild>
          <Link href="/">
            <Home className="h-4 w-4" />
            Retour à l'accueil
          </Link>
        </Button>
      </div>
    </main>
  );
}
