// src/lib/config.ts
// Configuration centralisée, lue depuis les variables d'environnement.
// Les secrets (URLs de webhook n8n, clés d'API, etc.) ne doivent JAMAIS être
// codés en dur dans le code : ils changent selon l'environnement (dev/prod) et
// ne doivent pas se retrouver sur GitHub.

export const webhooks = {
  demoFaite: process.env.N8N_WEBHOOK_DEMO_FAITE,
  relance1: process.env.N8N_WEBHOOK_RELANCE_1,
} as const;

/**
 * Envoie une charge utile JSON à un webhook n8n.
 *
 * Ne lève jamais d'erreur : si l'URL n'est pas configurée ou si l'appel échoue,
 * on log et on continue. Un webhook ne doit jamais bloquer ni faire échouer
 * le déplacement d'une affaire.
 */
export async function sendWebhook(
  url: string | undefined,
  label: string,
  payload: unknown
): Promise<void> {
  if (!url) {
    console.warn(`[webhook ${label}] URL non configurée — envoi ignoré`);
    return;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[webhook ${label}] envoyé`);
  } catch (err) {
    console.error(`[webhook ${label}] erreur :`, err);
  }
}
