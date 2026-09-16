/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Modules Node natifs (sockets TLS, analyse MIME) : laissés hors du bundle
    // webpack, qui casserait leurs `require` dynamiques à l'exécution.
    serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'imapflow', 'mailparser'],
    // La page du parcours boucher et le modèle de mail sont des fichiers HTML
    // lus au moment de l'exécution (cf. src/lib/pv/templates.ts). Sans cette
    // inclusion explicite, la trace de déploiement Vercel ne les embarquerait
    // pas : rdv.swipelink.fr/boucher répondrait 500 en production alors que
    // tout marche en local.
    outputFileTracingIncludes: {
      '/**': ['./src/pv-assets/**'],
    },
  },
};

export default nextConfig;
