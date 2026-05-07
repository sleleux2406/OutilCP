import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware léger : protège les routes privées.
 * La vérification approfondie (rôle, session DB) se fait dans les pages via requireAuth().
 *
 * Ici on ne fait qu'un "early redirect" basé sur la présence du cookie,
 * pour éviter des requêtes SSR inutiles quand l'utilisateur n'est clairement pas loggué.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Routes publiques
  const PUBLIC_PATHS = ["/login", "/403", "/api/health"];
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSessionCookie = request.cookies.has("qa_session");
  if (!hasSessionCookie && !pathname.startsWith("/_next")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tout sauf assets statiques et favicon
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
