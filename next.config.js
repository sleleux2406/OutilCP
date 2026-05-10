/**
 * Configuration Next.js compatible dev local + GitHub Codespaces.
 *
 * En Codespace, l'URL change à chaque redémarrage. Plutôt que de la
 * hardcoder, on lit CODESPACE_NAME (variable env fournie par Codespaces)
 * et on construit l'origine autorisée dynamiquement.
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

// Origines autorisées pour les Server Actions.
// En Codespace, CODESPACE_NAME est défini → on ajoute le hostname Codespace.
const codespaceOrigins = process.env.CODESPACE_NAME
  ? [
      `${process.env.CODESPACE_NAME}-3000.app.github.dev`,
      `${process.env.CODESPACE_NAME}-3000.preview.app.github.dev`,
    ]
  : [];

const allowedOrigins = [
  "localhost:3000",
  "127.0.0.1:3000",
  ...codespaceOrigins,
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
