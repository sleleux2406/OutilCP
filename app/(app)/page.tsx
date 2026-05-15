import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ArrowRight, FolderKanban } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { CreateProjectButton } from "@/components/projects/CreateProjectButton";

export const metadata = {
  title: "Projets",
};

export default async function HomePage() {
  const session = await requireAuth();
  const projects = await prisma.project.findMany({
    where: { parentProjectId: null }, // projets racine seulement (les RUN sont accessibles depuis leur parent)
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      _count: { select: { tickets: true } },
    },
  });

  return (
    <main className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projets</h1>
          <p className="text-sm text-muted-foreground">
            Choisissez un projet pour accéder au Kanban et au Test Runner.
          </p>
        </div>
        <CreateProjectButton userRole={session.role} />
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.key}/board`}
              className="group border rounded-lg p-4 bg-card hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary">
                    <FolderKanban className="h-4 w-4" />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <h2 className="font-semibold truncate mb-1">{p.name}</h2>
              {p.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
              )}
              <div className="text-xs text-muted-foreground tabular-nums">
                {p._count.tickets} ticket{p._count.tickets > 1 ? "s" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed rounded-lg p-12 text-center">
      <FolderKanban className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
      <h3 className="font-semibold">Aucun projet pour le moment</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
        Lancez <code className="bg-muted px-1 rounded">pnpm db:seed</code> pour générer un
        projet de démonstration.
      </p>
    </div>
  );
}
