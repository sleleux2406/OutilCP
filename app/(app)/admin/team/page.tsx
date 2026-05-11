import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Équipe",
};

const ROLE_LABEL: Record<"ADMIN" | "PRODUCT_OWNER" | "DEVELOPER" | "TESTER", string> = {
  ADMIN: "Admin",
  PRODUCT_OWNER: "Product Owner",
  DEVELOPER: "Développeur",
  TESTER: "Testeur",
};

const ROLE_BADGE_CLASS: Record<
  "ADMIN" | "PRODUCT_OWNER" | "DEVELOPER" | "TESTER",
  string
> = {
  ADMIN: "bg-red-500/15 text-red-700 dark:text-red-400",
  PRODUCT_OWNER: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  DEVELOPER: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  TESTER: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
};

export default async function AdminTeamPage() {
  // RBAC : ADMIN/PO uniquement
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  // Récupère les utilisateurs + nombre de plages de congés actuelles
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      _count: { select: { leaves: true } },
    },
  });

  return (
    <main className="container py-8 max-w-4xl space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 mb-2">
          <Users className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold">Équipe</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Cliquez sur un membre pour gérer ses congés. Ces plages seront exclues
          du calcul des dates de fin des tickets qui lui sont assignés.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
          {users.length} membre{users.length > 1 ? "s" : ""}
        </h2>

        <ul className="border rounded-lg divide-y bg-card">
          {users.map((u) => {
            const roleKey = u.role as keyof typeof ROLE_LABEL;
            return (
              <li key={u.id}>
                <Link
                  href={`/users/${u.id}/leaves`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <Avatar name={u.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{u.name}</span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ROLE_BADGE_CLASS[roleKey]}`}
                      >
                        {ROLE_LABEL[roleKey]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  </div>
                  <div className="text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0">
                    <CalendarDays className="h-3 w-3" aria-hidden />
                    {u._count.leaves} plage{u._count.leaves > 1 ? "s" : ""} de congés
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      aria-hidden
      className="w-9 h-9 rounded-full bg-primary/15 text-primary text-xs font-semibold grid place-items-center shrink-0"
    >
      {initials}
    </div>
  );
}
