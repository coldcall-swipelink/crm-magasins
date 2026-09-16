// src/lib/campaigns/providers.ts
//
// Réglages serveurs par fournisseur d'email.
//
// Ces constantes vivent à part de src/lib/campaigns/mailboxes.ts (qui, lui,
// tire nodemailer, imapflow et Prisma) pour que le formulaire de connexion
// puisse les lire directement, sans passer par le réseau : la liste des
// fournisseurs doit s'afficher même quand l'API est en panne.
//
// Côté fournisseur, la seule mise en place est le mot de passe :
//   • Google Workspace → validation en deux étapes, puis un « mot de passe
//     d'application » de 16 caractères ;
//   • OVH MX Plan      → le mot de passe de la boîte, celui du webmail.

export const PROVIDER_PRESETS = {
  google: {
    label: 'Google Workspace / Gmail',
    smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
    imapHost: 'imap.gmail.com', imapPort: 993,
    hint: "Validation en deux étapes activée, puis un « mot de passe d'application » de 16 caractères.",
  },
  ovh: {
    label: 'OVH (MX Plan)',
    smtpHost: 'ssl0.ovh.net', smtpPort: 465, smtpSecure: true,
    imapHost: 'ssl0.ovh.net', imapPort: 993,
    hint: 'Le mot de passe de la boîte, celui qui ouvre le webmail OVH.',
  },
  custom: {
    label: 'Autre (réglages manuels)',
    smtpHost: '', smtpPort: 465, smtpSecure: true,
    imapHost: '', imapPort: 993,
    hint: 'Renseignez les serveurs SMTP et IMAP de votre hébergeur.',
  },
} as const;

export type ProviderKey = keyof typeof PROVIDER_PRESETS;

export function isProviderKey(value: string): value is ProviderKey {
  return value === 'google' || value === 'ovh' || value === 'custom';
}

/** Devine le fournisseur d'après le domaine — simple confort de saisie. */
export function guessProvider(email: string): ProviderKey {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (!domain) return 'custom';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'google';
  return 'custom';
}
