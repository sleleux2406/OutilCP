/**
 * Configuration Next.js compatible dev local + GitHub Codespaces + Vercel production.
 *
 * - En local : localhost:3000
 * - En Codespace : ${CODESPACE_NAME}-3000.app.github.dev (variable injectee par Codespaces)
 * - En Vercel : ${VERCEL_URL} (variable injectee par Vercel a chaque deploy)
 *               + le domaine VERCEL_PROJECT_PRODUCTION_URL pour l'URL stable
 */

const S3_HOSTS = "https://*.r2.cloudflarestorage.com https://*.s3.amazonaws.com";

const CSP_PARTS = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${S3_HOSTS}`,
  "font-src 'self' data:",
  `connect-src 'self' ${S3_HOSTS} https://*.app.github.dev wss://*.app.github.dev`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

const CSP = CSP_PARTS.join("; ");

// Origines autorisees pour les Server Actions.
// En Codespace : CODESPACE_NAME -> hostname Codespace.
// En Vercel : VERCEL_URL (URL de la deployment) + VERCEL_PROJECT_PRODUCTION_URL (URL stable).
const codespaceOrigins = process.env.CODESPACE_NAME
  ? [
      `${process.env.CODESPACE_NAME}-3000.app.github.dev`,
      `${process.env.CODESPACE_NAME}-3000.preview.app.github.dev`,
    ]
  : [];

const vercelOrigins = [];
if (process.env.VERCEL_URL) {
  vercelOrigins.push(process.env.VERCEL_URL);
}
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  vercelOrigins.push(process.env.VERCEL_PROJECT_PRODUCTION_URL);
}

const allowedOrigins = [
  "localhost:3000",
  "127.0.0.1:3000",
  ...codespaceOrigins,
  ...vercelOrigins,
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
      allowedOrigins,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
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

module.exports = nextConfig;
