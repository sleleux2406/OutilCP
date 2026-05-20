import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listProjectMembersAction } from "@/app/actions/project-members";
import { ProjectMembersList } from "@/components/projects/ProjectMembersList";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Membres ${key}` };
}

export default async function ProjectMembersPage({ params }: PageProps) {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);
  const { key } = await params;

  const result = await listProjectMembersAction({ projectKey: key });

  if (!result.ok) {
    if (result.error === "NOT_FOUND") notFound();
    notFound();
  }

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
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Membres {result.project.key}
        </h1>
      </header>

      <main className="flex-1 container max-w-4xl py-6">
        <ProjectMembersList
          project={result.project}
          members={result.members}
          availableUsers={result.availableUsers}
          currentUserId={session.userId}
        />
      </main>
    </div>
  );
}
