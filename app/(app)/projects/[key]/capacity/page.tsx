import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, KanbanSquare } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getCapacityViewAction } from "@/app/actions/capacity";
import { CapacityTimeline } from "@/components/capacity/CapacityTimeline";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Capacité ${key}` };
}

export default async function CapacityPage({ params }: PageProps) {
  // [A01] Page réservée aux rôles de pilotage
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);
  const { key } = await params;

  const result = await getCapacityViewAction({ projectKey: key, weeksCount: 12 });

  if (!result.ok) {
    if (result.error === "NOT_FOUND") notFound();
    if (result.error === "FORBIDDEN") notFound();
    // VALIDATION : ne devrait pas arriver, mais on évite un crash
    notFound();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-background">
        <Link
          href="/pilotage"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Pilotage
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <h1 className="text-lg font-semibold">{result.project.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">
          {result.project.key}
        </span>
        <span className="ml-2 text-xs px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-medium">
          Capacité
        </span>
        <Link
          href={`/projects/${result.project.key}/board`}
          className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border hover:bg-accent"
        >
          <KanbanSquare className="h-4 w-4" />
          Vue Kanban
        </Link>
      </header>

      <CapacityTimeline
        projectKey={result.project.key}
        weeks={result.weeks}
        p1Tickets={result.p1Tickets}
        hasPlan={result.hasPlan}
        planGeneratedAt={result.planGeneratedAt}
        projectedEndDate={result.projectedEndDate}
        leftoverMinutes={result.leftoverMinutes}
      />
    </div>
  );
}
