import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health check : vérifie que l'application tourne ET que la BDD répond.
 * N'expose AUCUNE information sensible (version, path, stack).
 * [A05 — pas de leak de config]
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
