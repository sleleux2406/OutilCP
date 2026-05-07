/**
 * Rate limiter in-memory pour les endpoints sensibles (login, reset password).
 * [OWASP A07 — protection brute-force]
 *
 * Implémentation volontairement simple : Map<key, {count, windowStart}>.
 * Pour un déploiement multi-instances, remplacer par Upstash Redis ou
 * @vercel/kv (même interface).
 *
 * Limites :
 *   - Perdu au redémarrage (acceptable — la fenêtre est courte)
 *   - Non partagé entre workers Node (acceptable en dev et en single-instance)
 */

interface Entry {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Entry>();

export interface RateLimitOptions {
  /** Nombre max d'actions autorisées dans la fenêtre */
  limit: number;
  /** Fenêtre en millisecondes */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Vérifie et incrémente le compteur pour une clé donnée.
 * La clé doit être suffisamment spécifique : `login:${email}` ou `login:ip:${ip}`.
 */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart >= opts.windowMs) {
    // Nouvelle fenêtre
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: opts.limit - 1, retryAfterSeconds: 0 };
  }

  if (entry.count >= opts.limit) {
    const retryAfterMs = opts.windowMs - (now - entry.windowStart);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  entry.count += 1;
  return { allowed: true, remaining: opts.limit - entry.count, retryAfterSeconds: 0 };
}

/**
 * Nettoyage périodique des buckets expirés (anti-fuite mémoire).
 * Lancé à l'import côté serveur uniquement.
 */
if (typeof window === "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now - entry.windowStart > 60 * 60 * 1000) {
        buckets.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}
