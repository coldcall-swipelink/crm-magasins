// Ce que le serveur a RÉELLEMENT fait des dates de closing demandées, et
// comment le dire à celui qui vient de déplacer la carte.
//
// Les deux pop-ups — celle du pipeline et celle de la fiche — annonçaient
// jusqu'ici ce que l'utilisateur avait TAPÉ, jamais ce que le serveur avait
// retenu. Or le serveur refuse de dater un abonnement qui porte déjà une date :
// écraser celle du contrat en cours par celle d'un nouveau serait bien pire.
// Ce refus est juste, mais il était muet, et la pop-up annonçait par-dessus
// « date de closing enregistrée ». L'affaire partait en SMARTLINKÉ, aucun
// closing n'était écrit, l'écran mural restait muet, et rien nulle part ne
// disait pourquoi.

/** Résultat de l'enregistrement des dates, tel que la route le renvoie. */
export interface ClosingIssue {
  /** Abonnements effectivement datés par cet appel. */
  posees: number;
  /** Abonnements laissés tels quels : ils portaient déjà une date. */
  ignorees: number;
}

/** Le message et sa couleur. `info` plutôt que `error` quand rien n'a été
 *  enregistré : le déplacement, lui, a bien eu lieu — ce n'est pas un échec,
 *  c'est une chose à savoir. Mais surtout pas le vert du succès. */
export function messageClosing(
  prefixe: string,
  issue: ClosingIssue | null | undefined,
  par: string,
): { texte: string; type: 'success' | 'info' } {
  // Aucune date n'était demandée : le déplacement se raconte tout seul.
  if (!issue || (issue.posees === 0 && issue.ignorees === 0)) {
    return { texte: `${prefixe}${par}`, type: 'success' };
  }

  if (issue.posees === 0) {
    const sujet = issue.ignorees === 1
      ? 'cet abonnement en avait déjà une'
      : `ces ${issue.ignorees} abonnements en avaient déjà une`;
    return {
      texte: `${prefixe} — AUCUNE date enregistrée : ${sujet}. `
        + 'Pour un second contrat, ajoute un second abonnement dans l’onglet Abonnement.',
      type: 'info',
    };
  }

  const posees = issue.posees === 1
    ? 'date de closing enregistrée'
    : `${issue.posees} dates de closing enregistrées`;

  if (issue.ignorees === 0) return { texte: `${prefixe} — ${posees}${par}`, type: 'success' };

  const restes = issue.ignorees === 1
    ? '1 abonnement déjà daté, laissé inchangé'
    : `${issue.ignorees} abonnements déjà datés, laissés inchangés`;
  return { texte: `${prefixe} — ${posees}${par} · ${restes}`, type: 'info' };
}
