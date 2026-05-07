import type { NextConfig } from "next";

// Whitelist des hôtes d'upload — synchronisée avec app/actions/test-runner.ts
// et app/actions/uploads.ts (function isAllowedUploadHost).
const S3_HOSTS = "https://*.r2.cloudflarestorage.com https://*.s3.amazonaws.com";

/**
 * Content-Security-Policy stricte [OWASP A05 / SYM-GR-0005].
 * - default-src 'self'  → rien d'extérieur par défaut
 * - script-src 'self' 'unsafe-inline' → 'unsafe-inline' requis par Next.js hydration.
 *   Pour un durcissement total, migrer vers Nonce-based CSP (voir next docs CSP).
 * - img-src : self + data: (icônes inline) + domaines S3 pour les captures
 * - connect-src : self (Server Actions) + S3 pour les PUT d'upload
 * - frame-ancestors 'none' remplace X-Frame-Options DENY
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${S3_HOSTS}`,
  "font-src 'self' data:",
  `connect-src 'self' ${S3_HOSTS}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // En-têtes de sécurité par défaut [OWASP A05]
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.s3.amazonaws.com" },
    ],
  },
};

export default nextConfig;
