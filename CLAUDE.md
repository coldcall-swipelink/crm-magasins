# CLAUDE.md

Ce fichier guide Claude Code (et tout assistant IA) lorsqu'il travaille sur ce dépôt.

## Présentation du projet

CRM pour la prospection commerciale auprès de magasins (« magasins »). Il suit des
opportunités (« affaires »/deals) liées à des offres d'emploi détectées en magasin,
dans un pipeline kanban, avec import CSV intelligent (déduplication) et intégrations
email/webhooks.

## Stack technique

- **Next.js 14** (App Router) + **React 18** + **TypeScript** (strict)
- **Prisma 5** ORM + **PostgreSQL** (hébergé sur **Neon**)
- **CSS** : styles inline / vanilla (pas de Tailwind)
- Libs : `recharts` (graphiques), `lucide-react` (icônes), `csv-parse`, `date-fns`,
  `resend` + `nodemailer` (emails)

## Commandes essentielles

```bash
npm run dev            # serveur de dev (http://localhost:3000)
npm run build          # build de prod (génère le client Prisma + build Next)
npm run lint           # ESLint (doit rester vert)
npm run format         # formate le code avec Prettier
npm run format:check   # vérifie le formatage sans modifier

npm run db:push        # synchronise le schéma Prisma avec la base (dev)
npm run db:seed        # insère des données de démonstration
npm run db:studio      # interface graphique Prisma (port 5555)
```

## Architecture

```
src/
├── app/                # App Router : pages + routes API
│   ├── api/            # routes API REST (route.ts) — TOUTES dynamiques
│   ├── pipeline/       # board kanban (page principale)
│   ├── dashboard/      # statistiques
│   ├── import/         # import CSV
│   ├── history/        # historique des imports
│   ├── actions/        # tâches / rappels
│   └── settings/       # configuration (enseignes, colonnes, collaborateurs…)
├── components/         # composants React (layout/, pipeline/, deal/, ui/)
├── lib/                # utilitaires partagés
│   ├── config.ts       # config lue depuis l'env (webhooks…) — voir « Conventions »
│   ├── prisma.ts       # singleton du client Prisma
│   ├── import/         # logique d'import CSV (parser, dédup, fingerprint, service)
│   └── utils.ts        # helpers (normalisation, couleurs, dates)
└── types/              # définitions TypeScript

prisma/
├── schema.prisma       # 13 modèles (Brand, Store, Deal, JobOffer, Action…)
└── seed.ts             # données de démo
```

## Conventions importantes

- **Secrets & config** : jamais de secret ni d'URL d'environnement codés en dur.
  Tout passe par des variables d'environnement, centralisées dans `src/lib/config.ts`.
  Voir `.env.example` pour la liste des variables.
- **Routes API** : chaque `route.ts` qui lit la base déclare
  `export const dynamic = 'force-dynamic';` (exécution à chaque requête, jamais
  pré-générée au build). Le build doit donc réussir **sans** base de données.
- **Modèle de données** : une `Store` ↔ une `Deal` (1:1) ; une `Store` a plusieurs
  `JobOffer` ; la déduplication store privilégie `externalId` > `SIRET` >
  `enseigne|ville|nom` normalisé.
- **Règle métier import** : toute nouvelle offre détectée remet l'affaire en
  « À appeler ».
- **Langue** : UI et commentaires en français ; noms de fichiers/types en anglais.

## Workflow Git

- `main` = version stable/production. **Aucun push direct.**
- `dev` = branche d'intégration/développement (base Neon de dev).
- Travail sur branches `feature/*` ou `claude/*` → PR vers `dev` → tests → PR `dev`→`main`.
- Voir `GUIDE-DEV.md` pour le détail vulgarisé.

## Vérification du travail

Pas de tests automatisés dans le dépôt (choix assumé). Pour vérifier un changement :
1. `npm run build` (compile + typecheck + lint) doit réussir.
2. Lancer l'app avec une base locale ou la base de dev et tester le parcours impacté.

## Pistes de restructuration

Voir `AUDIT.md` pour la feuille de route (découpage des gros composants, couche
services/hooks, suppression des `any`, adoption de Prisma Migrate, CI…).
