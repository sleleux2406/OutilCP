/**
 * Authentification & autorisation — RBAC
 *
 * Implémentation simple à base de cookies HTTP-only + sessions en BDD.
 * Pas de JWT (révocation immédiate via DELETE en BDD).
 *
 * Sécurité :
 *   - Le token brut n'est JAMAIS stocké : seul son hash SHA-256 l'est [A02]
 *   - Cookie HttpOnly + Secure + SameSite=Lax [A07]
 *   - Rotation à chaque login
 *   - Expiration à 7 jours, purge automatique via index expiresAt
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { Role } from "@prisma/client";

const SESSION_COOKIE = "qa_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const BCRYPT_COST = 12; // [A02] coût recommandé OWASP 2024+

export interface Session {
  userId: string;
  userName: string;
  email: string;
  role: Role;
}

/** Hash déterministe du token (stocké en BDD) */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Génère un token cryptographiquement fort (256 bits) */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash d'un mot de passe — jamais utilisé pour comparaison directe */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Comparaison constant-time d'un mot de passe */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Crée une session en BDD + dépose le cookie HTTP-only.
 * À appeler après vérification du mot de passe.
 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null }
): Promise<void> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Invalide la session courante (logout) */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Récupère la session depuis le cookie (sans lancer d'erreur).
 * Renvoie null si absente/expirée/révoquée.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  // Soft delete : un user desactive ne peut plus avoir de session active
  if (row.user.deletedAt) return null;

  return {
    userId: row.user.id,
    userName: row.user.name,
    email: row.user.email,
    role: row.user.role,
  };
}

/** Exige une session — redirige vers /login sinon */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Exige un rôle spécifique — 403 sinon */
export async function requireRole(roles: Role[]): Promise<Session> {
  const session = await requireAuth();
  if (!roles.includes(session.role)) {
    redirect("/403");
  }
  return session;
}

/**
 * Autorisation fine : cet utilisateur peut-il modifier ce ticket ?
 * - ADMIN / PRODUCT_OWNER : toujours
 * - DEVELOPER : s'il est assigné OU créateur
 * - TESTER : uniquement les champs liés aux tests (géré ailleurs)
 */
export async function canEditTicket(
  session: Session,
  ticket: { assigneeId: string | null; creatorId?: string; projectId: string }
): Promise<boolean> {
  if (session.role === "ADMIN" || session.role === "PRODUCT_OWNER") return true;
  if (session.role === "DEVELOPER") {
    return ticket.assigneeId === session.userId || ticket.creatorId === session.userId;
  }
  return false;
}
