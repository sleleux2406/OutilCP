import { CalendarX } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HolidayList } from "@/components/admin/HolidayList";

export const metadata = {
  title: "Jours fériés",
};

export default async function AdminHolidaysPage() {
  // RBAC : seuls ADMIN et PRODUCT_OWNER peuvent gérer les jours fériés
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const holidays = await prisma.holiday.findMany({
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true },
  });

  // Sérialisation pour passer au Client Component
  const initialHolidays = holidays.map((h) => ({
    id: h.id,
    date: h.date.toISOString().slice(0, 10),
    label: h.label,
  }));

  return (
    <main className="container py-8 max-w-3xl space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 mb-2">
          <CalendarX className="h-5 w-5 text-destructive" aria-hidden />
          <h1 className="text-2xl font-bold">Jours fériés globaux</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Les jours fériés s&apos;appliquent à toute l&apos;équipe et sont exclus du calcul
          des dates de fin des tickets. Une seule entrée par date.
        </p>
      </header>

      <HolidayList initialHolidays={initialHolidays} />
    </main>
  );
}
