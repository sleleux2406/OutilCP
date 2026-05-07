import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";

interface PageProps {
  searchParams: Promise<{ from?: string }>;
}

export const metadata = {
  title: "Connexion — QA Platform",
};

export default async function LoginPage({ searchParams }: PageProps) {
  // Si déjà connecté, rediriger vers la home
  const existing = await getSession();
  if (existing) redirect("/");

  const { from } = await searchParams;
  // On whitelist le paramètre `from` : doit être un chemin relatif commençant par /
  const redirectTo = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  return (
    <main className="min-h-screen grid place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm bg-card border rounded-xl shadow-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold">QA Platform</h1>
          <p className="text-sm text-muted-foreground mt-1">Connexion à votre espace de travail</p>
        </div>
        <LoginForm redirectTo={redirectTo} />
      </div>
    </main>
  );
}
