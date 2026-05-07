"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, destroySession, getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(256),
  redirectTo: z.string().startsWith("/").max(500).optional(),
});

export type LoginState =
  | { ok: false; error: string; email?: string }
  | { ok: true }
  | null;

/**
 * Action de login — utilisée avec useActionState côté client.
 *
 * Mesures de sécurité :
 *   - Rate-limit par IP (10 tentatives / 5 min)
 *   - Rate-limit par email (5 tentatives / 10 min)
 *   - Message d'erreur volontairement générique (ne révèle pas si l'email existe) [A01/A07]
 *   - Comparaison bcrypt constant-time [A02]
 *   - Toujours exécuter verifyPassword même si l'utilisateur n'existe pas (anti timing attack)
 *   - Audit log sur échecs et succès [A09]
 *   - Pas de retour du hash bcrypt dans la réponse
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // 1) Parse + validation stricte
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: "Email ou mot de passe invalide." };
  }
  const { email, password, redirectTo } = parsed.data;

  // 2) Rate-limit IP + email
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown";
  const userAgent = hdrs.get("user-agent") || null;

  const ipLimit = rateLimit(`login:ip:${ip}`, { limit: 10, windowMs: 5 * 60 * 1000 });
  const emailLimit = rateLimit(`login:email:${email}`, { limit: 5, windowMs: 10 * 60 * 1000 });

  if (!ipLimit.allowed || !emailLimit.allowed) {
    const wait = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
    return {
      ok: false,
      error: `Trop de tentatives. Réessayez dans ${wait} secondes.`,
      email,
    };
  }

  // 3) Lookup + comparaison mot de passe
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, hashedPassword: true },
  });

  // Anti timing attack : on compare toujours, même avec un hash factice
  const FAKE_HASH = "$2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  const hashToCheck = user?.hashedPassword ?? FAKE_HASH;
  const passwordOk = await verifyPassword(password, hashToCheck);

  if (!user || !passwordOk) {
    // Audit best-effort (pas bloquant)
    if (user) {
      await prisma.auditLog
        .create({
          data: {
            userId: user.id,
            action: "AUTH.LOGIN_FAILED",
            entityType: "User",
            entityId: user.id,
            metadata: { ip, userAgent },
          },
        })
        .catch(() => {});
    }
    return { ok: false, error: "Email ou mot de passe invalide.", email };
  }

  // 4) Création session
  await createSession(user.id, { userAgent, ipAddress: ip });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "AUTH.LOGIN_SUCCESS",
      entityType: "User",
      entityId: user.id,
      metadata: { ip, userAgent },
    },
  });

  // 5) Redirection vers la page demandée OU dashboard
  const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
  redirect(target);
}

/**
 * Déconnexion — invalide la session côté BDD + supprime le cookie.
 */
export async function logoutAction() {
  const session = await getSession();
  if (session) {
    await prisma.auditLog
      .create({
        data: {
          userId: session.userId,
          action: "AUTH.LOGOUT",
          entityType: "User",
          entityId: session.userId,
        },
      })
      .catch(() => {});
  }
  await destroySession();
  redirect("/login");
}
