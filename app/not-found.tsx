import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
          <FileQuestion className="w-7 h-7 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold mb-2">Page introuvable</h1>
        <p className="text-sm text-muted-foreground mb-6">
          L'adresse demandée n'existe pas ou n'est plus disponible.
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
