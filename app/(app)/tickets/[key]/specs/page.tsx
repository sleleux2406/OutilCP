import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, Lock, History } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Specs ${key} (lecture seule)` };
}

/**
 * Vue LECTURE SEULE des specifications d'une Feature.
 *
 * Module 2.2 : permet aux developpeurs (qui ne voient pas la Feature dans
 * leur Kanban principal) de consulter les specs depuis le ticket Bug.
 *
 * - Pas de bouton de modification
 * - Pas de boutons d'action (test, edit, etc.)
 * - Affichage clair du versioning (versionCreation, versionSpecsCourante)
 * - Affichage des cas de test en mode read-only
 */
export default async function TicketSpecsPage({ params }: PageProps) {
  await requireAuth();
  const { key } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { key },
    select: {
      id: true,
      key: true,
      title: true,
      type: true,
      status: true,
      description: true,
      idFeatureSource: true,
      versionCreation: true,
      versionSpecsCourante: true,
      createdAt: true,
      updatedAt: true,
      project: {
        select: {
          key: true,
          name: true,
          parentProjectId: true,
          parentProject: { select: { key: true, name: true } },
        },
      },
      parent: { select: { key: true, title: true } },
      testCases: {
        select: {
          id: true,
          title: true,
          preconditions: true,
          steps: true,
          expected: true,
          order: true,
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!ticket) notFound();

  const isFeature = ticket.type === "FEATURE";
  const isUserStory = ticket.type === "USER_STORY";

  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-background sticky top-0 z-10">
        <Link
          href={`/tickets/${ticket.key}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Retour au ticket
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Specs {ticket.key}
        </h1>
        <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-medium">
          <Lock className="h-3 w-3" />
          Lecture seule
        </span>
      </header>

      <main className="flex-1 container max-w-4xl py-6 space-y-6">
        {/* Bandeau d'info contextuel */}
        {(ticket.idFeatureSource || ticket.versionCreation) && (
          <section className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50 p-4 text-sm">
            <div className="flex items-start gap-2">
              <History className="h-4 w-4 text-blue-700 dark:text-blue-300 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="font-semibold text-blue-900 dark:text-blue-100">
                  Tracabilite des specifications
                </p>
                {ticket.idFeatureSource && (
                  <p className="text-blue-800 dark:text-blue-200">
                    <span className="font-medium">ID fonctionnel :</span>{" "}
                    <code className="font-mono bg-blue-100 dark:bg-blue-900 px-1 rounded">
                      {ticket.idFeatureSource}
                    </code>
                  </p>
                )}
                {ticket.versionCreation && (
                  <p className="text-blue-800 dark:text-blue-200">
                    <span className="font-medium">Version a la creation :</span>{" "}
                    <code className="font-mono bg-blue-100 dark:bg-blue-900 px-1 rounded">
                      {ticket.versionCreation}
                    </code>
                  </p>
                )}
                {ticket.versionSpecsCourante && (
                  <p className="text-blue-800 dark:text-blue-200">
                    <span className="font-medium">Version courante :</span>{" "}
                    <code className="font-mono bg-blue-100 dark:bg-blue-900 px-1 rounded">
                      {ticket.versionSpecsCourante}
                    </code>
                    {ticket.versionSpecsCourante !== ticket.versionCreation && (
                      <span className="ml-2 text-[10px] uppercase font-semibold text-orange-700 dark:text-orange-300">
                        Mises a jour depuis la creation
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Contexte projet */}
        <section className="text-sm space-y-1">
          <p>
            <span className="text-muted-foreground">Projet :</span>{" "}
            <Link
              href={`/projects/${ticket.project.key}/board`}
              className="font-mono hover:underline"
            >
              {ticket.project.key}
            </Link>{" "}
            — {ticket.project.name}
            {ticket.project.parentProjectId && ticket.project.parentProject && (
              <>
                {" "}
                <span className="text-muted-foreground">(RUN de</span>{" "}
                <Link
                  href={`/projects/${ticket.project.parentProject.key}/board`}
                  className="font-mono hover:underline"
                >
                  {ticket.project.parentProject.key}
                </Link>
                <span className="text-muted-foreground">)</span>
              </>
            )}
          </p>
          {ticket.parent && (
            <p>
              <span className="text-muted-foreground">Parent :</span>{" "}
              <Link
                href={`/tickets/${ticket.parent.key}/specs`}
                className="font-mono hover:underline"
              >
                {ticket.parent.key}
              </Link>{" "}
              — {ticket.parent.title}
            </p>
          )}
        </section>

        {/* Titre + statut */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 uppercase">
              {ticket.type}
            </span>
            <span className="text-xs text-muted-foreground">
              Statut : {ticket.status}
            </span>
          </div>
          <h2 className="text-2xl font-bold">{ticket.title}</h2>
        </section>

        {/* Description Markdown */}
        {ticket.description ? (
          <section>
            <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
              Description
            </h3>
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                {ticket.description}
              </ReactMarkdown>
            </div>
          </section>
        ) : (
          <section className="text-sm text-muted-foreground italic">
            Aucune description.
          </section>
        )}

        {/* Cas de test (lecture seule) */}
        {(isFeature || isUserStory) && ticket.testCases.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
              Cas de test ({ticket.testCases.length})
            </h3>
            <ul className="space-y-3">
              {ticket.testCases.map((tc) => (
                <li
                  key={tc.id}
                  className="border rounded-lg p-3 bg-card text-sm space-y-2"
                >
                  <div className="font-semibold flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      Cas {tc.order}
                    </span>
                    {tc.title}
                  </div>
                  {tc.preconditions && (
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase">
                        Preconditions :
                      </span>
                      <p className="text-xs mt-0.5 whitespace-pre-wrap">
                        {tc.preconditions}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase">
                      Etapes :
                    </span>
                    <p className="text-xs mt-0.5 whitespace-pre-wrap">{tc.steps}</p>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase">
                      Resultat attendu :
                    </span>
                    <p className="text-xs mt-0.5 whitespace-pre-wrap">{tc.expected}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="border-t pt-4 text-[10px] text-muted-foreground italic">
          Cette page est en lecture seule. Pour modifier les specifications, demandez
          au Product Owner ou a l&apos;Admin du projet.
        </footer>
      </main>
    </div>
  );
}
