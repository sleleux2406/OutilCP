import { Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listUsersAction } from "@/app/actions/users";
import { UsersAdminList } from "@/components/admin/UsersAdminList";

export const metadata = {
  title: "Gestion des utilisateurs",
};

export default async function AdminUsersPage() {
  // ADMIN uniquement (le requireRole redirige les autres)
  await requireRole(["ADMIN"]);

  const res = await listUsersAction();
  const users = res.ok ? res.users : [];

  return (
    <main className="container py-8 max-w-5xl space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 mb-2">
          <Users className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold">Gestion des utilisateurs</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Créez, modifiez et désactivez les comptes utilisateurs. Les comptes désactivés
          ne peuvent plus se connecter mais leur historique reste préservé.
        </p>
      </header>

      <UsersAdminList users={users} />
    </main>
  );
}
