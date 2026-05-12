import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";

interface Props {
  parentProjectId: string;
}

/**
 * Liste les sous-projets RUN d'un projet parent.
 * Server Component : requête Prisma directe, pas d'interactivité.
 *
 * Affiché uniquement sur les projets racines. Si le parent n'a aucun sous-projet,
 * le bandeau est masqué (pas de bruit visuel inutile).
 */
export async function SubProjectsList({ parentProjectId }: Props) {
  const subProjects = await prisma.project.findMany({
    where: { parentProjectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      key: true,
      name: true,
      createdAt: true,
      _count: { select: { tickets: true } },
    },
  });

  if (subProjects.length === 0) return null;

  return (
    <section className="border-b bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />
        <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
          Sous-projets RUN ({subProjects.length})
        </h2>
      </div>
      <ul className="flex flex-wrap gap-2">
        {subProjects.map((run) => (
          <li key={run.id}>
            <Link
              href={`/projects/${run.key}/board`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border bg-card hover:border-primary/50 hover:shadow-sm transition-all text-sm"
              title={`Créé le ${formatDate(run.createdAt)}`}
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {run.key}
              </span>
              <span className="font-medium">{run.name}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {run._count.tickets} ticket{run._count.tickets > 1 ? "s" : ""}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
