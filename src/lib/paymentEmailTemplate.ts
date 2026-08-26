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

export const PAYMENT_EMAIL_TEMPLATE = {
  subject: 'Votre lien de paiement Swipelink — {{offre}}',
  body: [
    '<p>Bonjour {{civilite}} {{nom_famille}},</p>',
    '<p>Comme convenu, voici votre lien de paiement pour activer votre abonnement Swipelink.</p>',
    '<p><b>Récapitulatif de votre offre :</b></p>',
    '<ul>{{recap_offre}}</ul>',
    '<p>👉 <a href="{{lien_paiement}}">Cliquez ici pour procéder au paiement</a></p>',
    '<p>Le paiement est 100&nbsp;% sécurisé via Stripe. Une fois le règlement effectué, votre abonnement est activé.</p>',
    '<p>Je reste à votre disposition pour toute question.</p>',
    '<p>Bien à vous,</p>',
  ].join(''),
};
