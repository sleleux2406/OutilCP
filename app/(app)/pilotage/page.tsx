import Link from "next/link";
import { ArrowRight, Euro, Bug as BugIcon, AlertTriangle, FolderKanban } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { getEpicsRollups } from "@/lib/time-rollup";
import { sumRollups } from "@/lib/rollup-presenter";
import { formatEUR } from "@/lib/utils";

export const metadata = {
  title: "Pilotage",
};

export default async function PilotageIndexPage() {
  // [A01] Seuls ADMIN / PRODUCT_OWNER
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, key: true, name: true, description: true },
  });

  // Agrégats par projet (1 requête par projet sur la vue rollup ; pour > 50 projets,
  // fusionner en une seule requête SQL groupée)
  const projectsWithKpis = await Promise.all(
    projects.map(async (p) => {
      const epicRollups = await getEpicsRollups(p.id);
      const totals = sumRollups(epicRollups.values());
      const [bugsOpen, blocked] = await Promise.all([
        prisma.ticket.count({
          where: { projectId: p.id, type: "BUG", status: { not: "DONE" } },
        }),
        prisma.ticket.count({ where: { projectId: p.id, status: "BLOCKED" } }),
      ]);
      return { ...p, totals, bugsOpen, blocked };
    })
  );

  return (
    <main className="container py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Vue Pilotage</h1>
        <p className="text-sm text-muted-foreground">
          Coût, avancement, bugs et blocages par projet.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <FolderKanban className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Aucun projet à piloter.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projectsWithKpis.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.key}/overview`}
              className="group border rounded-lg p-4 bg-card hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                  <h2 className="font-semibold truncate">{p.name}</h2>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </div>

              <dl className="grid grid-cols-3 gap-2 text-xs">
                <Metric icon={Euro} label="Coût" value={formatEUR(p.totals.totalCostCents)} />
                <Metric
                  icon={BugIcon}
                  label="Bugs"
                  value={p.bugsOpen}
                  tone={p.bugsOpen > 0 ? "warning" : undefined}
                />
                <Metric
                  icon={AlertTriangle}
                  label="Bloqués"
                  value={p.blocked}
                  tone={p.blocked > 0 ? "danger" : undefined}
                />
              </dl>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Euro;
  label: string;
  value: string | number;
  tone?: "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <div>
      <dt className="inline-flex items-center gap-1 text-[10px] text-muted-foreground uppercase">
        <Icon className="h-3 w-3" aria-hidden /> {label}
      </dt>
      <dd className={`font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}
