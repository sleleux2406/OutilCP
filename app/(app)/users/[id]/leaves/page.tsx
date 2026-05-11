import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CalendarDays, ChevronLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeaveList } from "@/components/admin/LeaveList";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: "Congés",
};

export default async function UserLeavesPage({ params }: PageProps) {
  const session = await requireAuth();
  const { id: targetUserId } = await params;

  // Autorisation : self OU ADMIN/PO
  const isSelf = session.userId === targetUserId;
  const isManager = session.role === "ADMIN" || session.role === "PRODUCT_OWNER";
  if (!isSelf && !isManager) {
    redirect("/403");
  }

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) notFound();

  const leaves = await prisma.userLeave.findMany({
    where: { userId: targetUserId },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true, endDate: true, label: true },
  });

  const initialLeaves = leaves.map((l) => ({
    id: l.id,
    startDate: l.startDate.toISOString().slice(0, 10),
    endDate: l.endDate.toISOString().slice(0, 10),
    label: l.label,
  }));

  return (
    <main className="container py-8 max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Accueil
        </Link>
      </div>

      <header>
        <div className="inline-flex items-center gap-2 mb-2">
          <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold">
            Congés {isSelf ? "(mes congés)" : `— ${user.name}`}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {isSelf
            ? "Vos plages de congés. Elles seront exclues du calcul des dates de fin de vos tickets."
            : `Plages de congés de ${user.name}. Excluez-les du calcul des dates de fin des tickets qui lui sont assignés.`}
        </p>
      </header>

      <LeaveList userId={targetUserId} initialLeaves={initialLeaves} />
    </main>
  );
}
