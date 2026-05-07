import Link from "next/link";
import { KanbanSquare, LayoutDashboard, Bug } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import type { Session } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";

interface Props {
  session: Session;
}

const ROLE_LABEL: Record<Session["role"], string> = {
  ADMIN: "Admin",
  PRODUCT_OWNER: "Product Owner",
  DEVELOPER: "Développeur",
  TESTER: "Testeur",
};

/**
 * Header global affiché sur toutes les pages authentifiées.
 * Server Component : reçoit la session en prop depuis le layout applicatif.
 */
export function AppHeader({ session }: Props) {
  const canPilot = session.role === "ADMIN" || session.role === "PRODUCT_OWNER";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-14 items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight">
          QA Platform
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-accent"
          >
            <KanbanSquare className="h-4 w-4" />
            Projets
          </Link>
          {canPilot && (
            <Link
              href="/pilotage"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-accent"
            >
              <LayoutDashboard className="h-4 w-4" />
              Pilotage
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="text-right">
              <div className="text-xs font-medium">{session.userName}</div>
              <div className="text-[10px] text-muted-foreground">{session.email}</div>
            </div>
            <Avatar name={session.userName} />
            <Badge variant="secondary" className="text-[10px]">
              {ROLE_LABEL[session.role]}
            </Badge>
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
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
      className="w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-semibold grid place-items-center"
    >
      {initials}
    </div>
  );
}
