import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, KanbanSquare, ClipboardCheck } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { listProjectTestsAction } from "@/app/actions/project-tests";
import { ProjectTestsView } from "@/components/tests/ProjectTestsView";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Cahier de tests ${key}` };
}

export default async function ProjectTestsPage({ params }: PageProps) {
  const session = await requireAuth();
  const { key } = await params;

  const result = await listProjectTestsAction({ projectKey: key });

  if (!result.ok) {
    if (result.error === "NOT_FOUND") notFound();
    notFound();
  }

  const canTest = session.role === "TESTER" || session.role === "ADMIN";
  const canExport =
    session.role === "ADMIN" ||
    session.role === "PRODUCT_OWNER" ||
    session.role === "TESTER";

  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-background sticky top-0 z-10">
        <Link
          href={`/projects/${result.project.key}/board`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Retour au board
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <h1 className="text-lg font-semibold">{result.project.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">
          {result.project.key}
        </span>
        <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-medium">
          <ClipboardCheck className="h-3 w-3" />
          Cahier de tests
        </span>
        {result.project.isRun && result.project.parentProject && (
          <span className="text-xs text-muted-foreground">
            ↑ RUN de{" "}
            <Link
              href={`/projects/${result.project.parentProject.key}/board`}
              className="font-mono hover:text-foreground"
            >
              {result.project.parentProject.key}
            </Link>
          </span>
        )}
        <Link
          href={`/projects/${result.project.key}/board`}
          className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border hover:bg-accent"
        >
          <KanbanSquare className="h-4 w-4" />
          Vue Kanban
        </Link>
      </header>

      <ProjectTestsView
        project={result.project}
        parents={result.parents}
        stats={result.stats}
        canTest={canTest}
        canExport={canExport}
      />
    </div>
  );
}
