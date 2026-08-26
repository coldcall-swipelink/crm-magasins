/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Modules Node natifs (sockets TLS, analyse MIME) : laissés hors du bundle
    // webpack, qui casserait leurs `require` dynamiques à l'exécution.
    serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'imapflow', 'mailparser'],
  },
};

export default nextConfig;
