# Audit du dépôt & feuille de route

Date : 2026-06-05.
Contexte : le projet a été écrit via Claude chat (copier-coller), sans workflow git ni
garde-fous. Ce document récapitule l'état des lieux et propose une restructuration
**progressive** pour pouvoir faire évoluer le produit sereinement (« scaler »).

> Les éléments cochés ✅ ont déjà été traités dans le premier chantier « Fondations ».
> Les autres sont à faire **plus tard, une branche par sujet**, vérifiés avant fusion.

---

## 1. Ce qui est déjà solide

- Stack moderne et cohérente (Next.js 14 App Router, React 18, Prisma, PostgreSQL).
- Séparation correcte `app/` / `components/` / `lib/`.
- Logique d'import CSV bien isolée dans `lib/import/` (parser, dédup, fingerprint).
- README détaillé.

---

## 2. Traité dans le chantier « Fondations » ✅

- ✅ **Workflow git** : branche `dev` + `main` protégée (voir `GUIDE-DEV.md`).
- ✅ **Environnement de dev** : base Neon dédiée via `.env.development.local`.
- ✅ **Lockfile** `package-lock.json` généré et versionné (builds reproductibles).
- ✅ **`.nvmrc`** (Node 20) + champ `engines` dans `package.json`.
- ✅ **Prettier** + `.editorconfig` + `.eslintrc.json` explicite ; scripts `format`.
- ✅ **Secrets sortis du code** : URLs de webhook n8n → variables d'env
  (`src/lib/config.ts`).
- ✅ **Robustesse du build** : client Resend instancié à la demande ;
  toutes les routes API marquées `dynamic = 'force-dynamic'` → le build réussit
  désormais **sans base de données** (prérequis pour une CI).
- ✅ **`.gitignore`** : les migrations Prisma ne sont plus ignorées.
- ✅ **Documentation** : `CLAUDE.md`, `GUIDE-DEV.md`, ce fichier.

---

## 3. Dette technique restante (feuille de route)

### Priorité haute

1. **Composants monolithiques à découper**
   - `src/components/deal/DealDrawer.tsx` (~481 lignes, ~9 responsabilités) →
     `DealHeader`, `DealInfoTab`, `DealOffersTab`, `DealActionsTab`, `DealNotesTab`,
     `DealEmailTab` + hooks `useDealData` / `useDealUpdate`.
   - `src/app/settings/page.tsx` (~426 lignes) → un composant par section
     (enseignes, colonnes, collaborateurs, templates email).

2. **Couche d'accès API centralisée** (`src/services/`)
   - ~44 appels `fetch()` dispersés dans les composants, sans gestion d'erreur
     commune. Créer un `apiClient` + des services par domaine (`dealService`, etc.).

3. **Hooks réutilisables** (`src/hooks/`) : `useDeals`, `useActions`, `useNotes`…
   pour mutualiser chargement / état / erreurs.

### Priorité moyenne

4. **Typage** : supprimer progressivement les ~49 `any` ; typer les réponses d'API
   (idéalement avec validation runtime via `zod`).

5. **Styles** : factoriser les styles inline dupliqués (`inp`, `btnPri`, `btnDef`…)
   dans `src/lib/styles.ts` (déjà existant mais sous-utilisé).

6. **Gestion d'erreurs UI** : ajouter `error.tsx` et `loading.tsx` par route
   (conventions Next.js App Router) ; messages d'erreur utilisateur explicites.

7. **Prisma Migrate** : passer de `db:push` à des **migrations versionnées**
   (`prisma migrate`). Permet de synchroniser proprement dev ↔ prod et de garder
   l'historique du schéma. À faire avec une migration « baseline » de l'existant.

### Priorité basse / plus tard

8. **CI GitHub Actions** légère : `npm ci` + `lint` + `build` à chaque Pull Request
   (faisable maintenant que le build ne dépend plus d'une base).

9. **Sécurité des dépendances** : `npm audit` remonte des vulnérabilités
   (1 critique, 7 hautes au moment de l'audit) — à traiter via mises à jour
   ciblées après mise en place de la CI.

10. **Authentification** : `NEXTAUTH_SECRET` est présent mais aucune auth n'est
    implémentée. À prévoir si le produit s'ouvre à plusieurs utilisateurs externes.

---

## 4. Méthode recommandée pour la restructuration

- **Une branche par sujet** (ex. `feature/split-dealdrawer`), petite et focalisée.
- Toujours `npm run build` vert avant de fusionner.
- Vérifier le parcours impacté dans le navigateur (base de dev).
- Fusionner via Pull Request vers `dev`, puis promouvoir vers `main` une fois validé.
