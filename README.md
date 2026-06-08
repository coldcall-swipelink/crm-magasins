# CRM Magasins — Guide d'installation complet

CRM commercial pour le suivi des opportunités basées sur des offres d'emploi de magasins.
Pipeline Kanban · Import CSV · Déduplication automatique · Règle métier : nouvelle offre = retour en "À appeler".

---

## Prérequis

- **Node.js** ≥ 18 : https://nodejs.org
- **npm** ≥ 9 (inclus avec Node.js)
- **PostgreSQL** — l'une de ces options :
  - [Supabase](https://supabase.com) (gratuit, recommandé)
  - PostgreSQL local
  - [Neon](https://neon.tech) (gratuit)

---

## Installation en 6 étapes

### Étape 1 — Récupérer les fichiers

```bash
# Copiez tous les fichiers dans un dossier crm-magasins/
cd crm-magasins
```

### Étape 2 — Installer les dépendances

```bash
npm install
```

### Étape 3 — Configurer la base de données

```bash
# Copier le fichier d'environnement
cp .env.example .env
```

Puis éditez le fichier `.env` :

#### Option A : Supabase (recommandé)

1. Créez un compte sur [supabase.com](https://supabase.com) (gratuit)
2. Créez un nouveau projet
3. Allez dans **Settings → Database → Connection string → URI**
4. Copiez l'URL et collez-la dans `.env` :

```env
DATABASE_URL="postgresql://postgres:[VOTRE_MOT_DE_PASSE]@db.[VOTRE_REF].supabase.co:5432/postgres"
```

#### Option B : PostgreSQL local

```bash
# Créer la base de données (si PostgreSQL est installé)
createdb crm_magasins
```

```env
DATABASE_URL="postgresql://postgres:votre_mot_de_passe@localhost:5432/crm_magasins"
```

#### Option C : Neon (gratuit, serverless)

1. Créez un compte sur [neon.tech](https://neon.tech)
2. Créez un projet, copiez la connection string
3. Collez dans `.env`

### Étape 4 — Lancer les migrations Prisma

```bash
# Génère le client Prisma et crée les tables en base
npm run db:migrate
```

> Si vous préférez pousser directement sans migration versionnée :
> ```bash
> npm run db:push
> ```

> **Onglet « Carte »** : le schéma `Store` inclut des colonnes `latitude` /
> `longitude` (géocodage mis en cache). Après une mise à jour, relancez
> `npm run db:migrate` (ou `npm run db:push`) pour créer ces colonnes. Le
> géocodage des adresses utilise l'API publique gratuite de la Base Adresse
> Nationale (`api-adresse.data.gouv.fr`, aucune clé requise) et la carte
> s'appuie sur OpenStreetMap.

Vérifiez que Prisma a bien généré les tables :
```bash
npm run db:studio
# Ouvre Prisma Studio sur http://localhost:5555
```

### Étape 5 — Initialiser les données de démo (seed)

```bash
# Crée les colonnes pipeline, les enseignes, et 6 affaires d'exemple
npm run db:seed
```

Vous devriez voir :
```
🌱 Seeding database…
  → Création des colonnes pipeline
  → Création des enseignes
  → Création d'un import exemple
  → Création des affaires de démonstration
  → Création des actions exemple
✅ Seed terminé avec succès !
   - 8 colonnes pipeline
   - 5 enseignes
   - 6 affaires avec offres
   - 4 actions de rappel
```

### Étape 6 — Lancer l'application

```bash
npm run dev
```

Puis ouvrez votre navigateur sur :

**→ http://localhost:3000**

---

## Utilisation

### Importer un CSV

1. Cliquez sur **Importer CSV** dans la sidebar
2. Glissez-déposez votre fichier `.csv` ou cliquez pour parcourir
3. Vérifiez l'aperçu des premières lignes
4. Cliquez **Lancer l'import**

Un fichier CSV d'exemple est disponible dans `public/exemple-import.csv`.

**Colonnes CSV reconnues** (noms flexibles, détection automatique) :

| Champ métier | Noms acceptés |
|---|---|
| Enseigne | enseigne, brand, marque |
| Nom magasin | nom magasin, magasin, etablissement |
| Ville | ville, city, commune |
| Département | département, departement, dept |
| Adresse | adresse, address, rue |
| Poste | poste, fonction, metier |
| Titre offre | titre, titre offre, intitulé |
| Date publication | date publication, date_pub, date |
| URL | lien, url, link |
| Salaire | salaire, salary |
| Contrat | contrat, type contrat |
| Source | source |

Le séparateur est auto-détecté (virgule ou point-virgule).

### Règle d'import principale

| Situation | Comportement |
|---|---|
| Nouveau magasin | → Nouvelle affaire dans **« À appeler »** |
| Magasin existant + **nouvelle offre** | → **Retour automatique en « À appeler »** |
| Magasin existant + offre déjà connue | → `lastSeenAt` mis à jour, colonne inchangée |

### Pipeline Kanban

- **Glisser-déposer** les cartes entre les colonnes
- Cliquer sur une carte pour ouvrir la **fiche affaire complète**
- **Filtres** : nouvelles affaires, nouvelles offres, recherche texte
- **Badges** : ✦ Nouvelle · ⟳ Rappelée · ⚠ Absente

---

## Scripts disponibles

```bash
npm run dev          # Serveur de développement (http://localhost:3000)
npm run build        # Build de production
npm run start        # Serveur de production (après build)

npm run db:migrate   # Créer/mettre à jour les tables en base
npm run db:push      # Push du schéma sans migration (développement)
npm run db:seed      # Remplir la base avec des données de démo
npm run db:studio    # Interface graphique Prisma Studio
npm run db:generate  # Régénérer le client Prisma
npm run db:reset     # ⚠️ Remettre à zéro la base de données
```

---

## Structure du projet

```
crm-magasins/
├── prisma/
│   ├── schema.prisma          # Modèle de données complet
│   └── seed.ts                # Données initiales
├── public/
│   └── exemple-import.csv     # CSV de test
├── src/
│   ├── app/
│   │   ├── api/               # Routes API REST
│   │   │   ├── import/        # POST — import CSV
│   │   │   ├── deals/         # GET, PATCH, + move
│   │   │   ├── actions/       # CRUD actions
│   │   │   ├── notes/         # CRUD notes
│   │   │   ├── brands/        # CRUD enseignes
│   │   │   ├── columns/       # CRUD colonnes
│   │   │   ├── import-batches/ # GET historique
│   │   │   └── dashboard/     # GET métriques
│   │   ├── dashboard/         # Page dashboard
│   │   ├── pipeline/          # Page kanban
│   │   ├── import/            # Page import CSV
│   │   ├── history/           # Page historique imports
│   │   ├── actions/           # Page actions & rappels
│   │   └── settings/          # Page paramètres
│   ├── components/
│   │   ├── layout/            # Sidebar, AppLayout
│   │   ├── pipeline/          # PipelineBoard, DealCard
│   │   ├── deal/              # DealDrawer (fiche affaire)
│   │   └── ui/                # Toast, Badge, Button
│   ├── lib/
│   │   ├── prisma.ts          # Singleton Prisma
│   │   ├── utils.ts           # Fonctions utilitaires
│   │   └── import/
│   │       ├── csvParser.ts      # Parsing CSV
│   │       ├── deduplication.ts  # Clé de dédup magasin
│   │       ├── fingerprint.ts    # Fingerprint offre
│   │       └── importService.ts  # Moteur d'import
│   └── types/
│       └── index.ts           # Types TypeScript
├── .env.example
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Déploiement en production

### Vercel + Supabase (recommandé)

```bash
# Build de production
npm run build

# Variables d'environnement à configurer sur Vercel :
# DATABASE_URL = votre URL Supabase
# NEXTAUTH_SECRET = openssl rand -base64 32
```

### Auto-hébergement

```bash
npm run build
npm run start  # Lance sur le port 3000
```

---

## Dépannage fréquent

**`Error: DATABASE_URL is not set`**
→ Vérifiez que le fichier `.env` existe et contient `DATABASE_URL`.

**`Error: Can't reach database server`**
→ Vérifiez que votre base PostgreSQL est bien accessible. Testez la connexion avec `psql $DATABASE_URL`.

**`Error: Aucune colonne pipeline trouvée`**
→ Lancez `npm run db:seed` pour initialiser les données.

**`PrismaClientKnownRequestError: Invalid value for argument`**
→ Lancez `npm run db:generate` pour regénérer le client Prisma.

**Port 3000 déjà utilisé**
→ `PORT=3001 npm run dev`
