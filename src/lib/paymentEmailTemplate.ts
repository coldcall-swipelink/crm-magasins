// Template intégrée de l'email « Lien de paiement ».
//
// Utilisée par le composeur « Envoyer un lien de paiement » de la fiche affaire :
// dès qu'un lien est sélectionné, le sujet et le corps se remplissent avec ce
// modèle, adapté à l'offre choisie via les variables ci-dessous (mêmes doubles
// accolades que les templates du CRM, remplacées par replaceVars côté fiche).
//
// Variables spécifiques au lien de paiement (en plus de celles des templates
// classiques — {{civilite}}, {{nom_famille}}, {{nom_magasin}}, …) :
//   {{offre}}          — libellé de l'offre (« 2 crédits/mois ») ou nom du lien spécial
//   {{mode_paiement}}  — « Paiement mensuel », « Paiement comptant (réduction 5%) »…
//   {{montant}}        — montant Stripe (« 1 200,00 €/mois »), vide si inconnu
//   {{recap_offre}}    — les <li> du récapitulatif, déjà filtrés des champs vides
//   {{lien_paiement}}  — l'URL finale du lien Stripe
//
// La signature de l'expéditeur est ajoutée automatiquement à l'envoi (API
// /api/emails) : ne pas la mettre ici.
//
// Si une template CRM dont le nom contient « paiement » existe (Paramètres →
// templates), elle est utilisée à la place de ce modèle — même jeu de variables.

/**
 * Libellé de périodicité déduit du montant Stripe (« 1 200,00 €/mois »,
 * « 600,00 €/3 mois »…). Le plan tarifaire du CRM appelle « Paiement mensuel »
 * tout paiement récurrent, y compris les offres annuelles facturées tous les
 * 2/3/6 mois — source de confusion dans l'email. La périodicité réelle du lien
 * Stripe fait foi. Chaîne vide si le montant n'en porte pas (paiement en une
 * fois, ou montant inconnu).
 */
export function paymentRecurrenceLabel(amountLabel: string): string {
  const idx = amountLabel.indexOf('/');
  if (idx === -1) return '';
  const suffix = amountLabel.slice(idx + 1).trim();
  if (suffix === 'mois') return 'Paiement mensuel';
  if (suffix === 'an') return 'Paiement annuel';
  const months = suffix.match(/^(\d+)\s*mois$/);
  if (months) {
    const n = Number(months[1]);
    if (n === 3) return 'Paiement trimestriel (tous les 3 mois)';
    if (n === 6) return 'Paiement semestriel (tous les 6 mois)';
    return `Paiement tous les ${n} mois`;
  }
  return `Paiement tous les ${suffix}`;
}

export const PAYMENT_EMAIL_TEMPLATE = {
  subject: 'Votre lien de paiement — Offre Smartlink {{offre}}',
  body: [
    '<p>Bonjour {{civilite}} {{nom_famille}},</p>',
    '<p>Comme convenu, voici votre lien de paiement pour votre offre Smartlink — {{offre}}.</p>',
    '<p><b>Récapitulatif de votre offre :</b></p>',
    '<ul>{{recap_offre}}</ul>',
    '<p><b>Inclus dans votre offre :</b></p>',
    '<ul>',
    '<li>Un consultant en recrutement attitré, 100&nbsp;% disponible pour vos crédits Smartlink</li>',
    '<li>Support 7j/7, de 7h à 23h</li>',
    '</ul>',
    '<p>👉 <a href="{{lien_paiement}}">{{lien_paiement}}</a></p>',
    '<p>Le paiement est 100&nbsp;% sécurisé via Stripe. Une fois le paiement effectué, vos crédits Smartlink seront débloqués, et vous pourrez retrouver votre facture sous 24h sur votre espace, dans l\'onglet «&nbsp;Facture&nbsp;».</p>',
    '<p>Merci pour votre confiance !</p>',
    '<p>Je reste à votre disposition pour toute question.</p>',
    '<p>Bien à vous,</p>',
  ].join(''),
};
