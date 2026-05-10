import Link from "next/link";
import { User } from "lucide-react";
import { TicketStatus, TicketType } from "@prisma/client";
import { TICKET_TYPE_META, TICKET_STATUS_META } from "@/lib/tickets/metadata";
import { cn } from "@/lib/utils";

export interface ChildTicket {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: number;
  assignee: { id: string; name: string } | null;
}

interface Props {
  children: ChildTicket[];
}

/**
 * Affiche la liste des enfants d'un ticket, regroupés par catégorie :
 *   - Bugs d'un côté (priorité visibilité QA)
 *   - Autres enfants de l'autre (Features sous Epic, US/Tasks sous Feature, etc.)
 */
export function TicketChildren({ children }: Props) {
  if (children.length === 0) {
    return (
      <section className="border rounded-lg p-5 bg-card">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
          Tickets liés
        </h2>
        <p className="text-sm text-muted-foreground">Aucun ticket enfant.</p>
      </section>
    );
  }

  const bugs = children.filter((c) => c.type === "BUG");
  const others = children.filter((c) => c.type !== "BUG");

  return (
    <section className="border rounded-lg p-5 bg-card space-y-4">
      <h2 className="text-sm font-semibold uppercase text-muted-foreground">
        Tickets liés ({children.length})
      </h2>

      {others.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold uppercase text-muted-foreground mb-2 tracking-wider">
            Enfants ({others.length})
          </h3>
          <ul className="space-y-1">
            {others.map((c) => (
              <ChildRow key={c.id} child={c} />
            ))}
          </ul>
        </div>
      )}

      {bugs.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold uppercase text-red-600 dark:text-red-400 mb-2 tracking-wider inline-flex items-center gap-1">
            Bugs ({bugs.length})
          </h3>
          <ul className="space-y-1">
            {bugs.map((c) => (
              <ChildRow key={c.id} child={c} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ChildRow({ child }: { child: ChildTicket }) {
  const typeMeta = TICKET_TYPE_META[child.type];
  const statusMeta = TICKET_STATUS_META[child.status];
  const TypeIcon = typeMeta.icon;

  return (
    <li>
      <Link
        href={`/tickets/${child.key}`}
        className="flex items-center gap-2 p-2 rounded border bg-background hover:bg-muted/40 transition-colors"
      >
        <TypeIcon className={cn("w-3.5 h-3.5 shrink-0", typeMeta.iconColor)} aria-hidden />
        <span className="font-mono text-xs text-muted-foreground shrink-0">{child.key}</span>
        <span className="flex-1 text-sm truncate">{child.title}</span>

        {/* Priorité (bugs P1/P2 en avant) */}
        {child.priority <= 2 && (
          <span
            className={cn(
              "text-[10px] font-semibold px-1.5 rounded uppercase shrink-0",
              child.priority === 1
                ? "bg-red-500/15 text-red-600"
                : "bg-amber-500/15 text-amber-600"
            )}
          >
            P{child.priority}
          </span>
        )}

        {/* Statut */}
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
            getBadgeClass(statusMeta.badgeVariant)
          )}
        >
          <span className={cn("w-1 h-1 rounded-full", statusMeta.dotColor)} />
          {statusMeta.label}
        </span>

        {/* Assignee */}
        {child.assignee ? (
          <Avatar name={child.assignee.name} />
        ) : (
          <User className="w-4 h-4 opacity-40 shrink-0" aria-label="Non assigné" />
        )}
      </Link>
    </li>
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
      aria-label={`Assigné à ${name}`}
      title={name}
      className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[9px] font-semibold grid place-items-center shrink-0"
    >
      {initials}
    </div>
  );
}

function getBadgeClass(
  variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"
): string {
  switch (variant) {
    case "success":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "warning":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "destructive":
      return "bg-destructive/15 text-destructive";
    case "info":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    case "secondary":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-muted text-foreground";
  }
}
