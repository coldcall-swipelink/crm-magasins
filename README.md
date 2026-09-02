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

### Recevoir les offres automatiquement (N8N → CRM)

Au lieu de recevoir un Excel par email et de le trier à la main, l'automatisation
N8N pousse ses offres directement dans le CRM. **Rien n'entre dans le pipeline
sans validation** : les offres arrivent dans une boîte de réception, et une
popup propose de cocher celles à importer.

**1. Configurer le jeton** (`.env`, puis sur l'hébergeur) :

```env
OFFERS_WEBHOOK_TOKEN="…"    # openssl rand -base64 32
```

**2. Brancher N8N** sur un nœud *HTTP Request* en fin de workflow :

```
POST https://<votre-crm>/api/webhooks/job-offers?token=<OFFERS_WEBHOOK_TOKEN>
Content-Type: application/json

{
  "label": "Indeed — 12/03",
  "source": "n8n-indeed",
  "rows": [
    { "enseigne": "Leclerc", "nom magasin": "E.Leclerc Rennes", "ville": "Rennes",
      "poste": "Manager Rayon", "date publication": "2026-03-12",
      "lien": "https://…", "contrat": "CDI", "source": "Indeed" }
  ]
}
```

Formats également acceptés : un tableau d'offres nu (`[ {…}, {…} ]`), une
enveloppe `offers` / `data` / `items`, un CSV entier (`{"csv": "enseigne;…"}`)
ou du CSV brut avec `Content-Type: text/csv`. **Les noms de colonnes sont ceux
de l'import manuel** (tableau ci-dessus) : le fichier déjà produit par le
workflow passe tel quel.

**3. Trier dans le CRM.** À l'arrivée d'un lot, la popup **« Nouvelles offres
reçues »** s'ouvre sur n'importe quel écran. Chaque ligne indique si le magasin
est déjà suivi et si l'offre a déjà été importée :

| Étiquette | Sens | Coché par défaut |
|---|---|---|
| **Nouveau magasin** | magasin inconnu du CRM | ✅ |
| **Magasin déjà suivi** | affaire existante, offre nouvelle | ✅ |
| **Offre déjà importée** | doublon d'une offre déjà en base | ❌ |

- **Importer la sélection** → les offres cochées passent par l'import normal
  (mêmes règles que le CSV, voir ci-dessous) ; les non cochées sont écartées.
- **Plus tard** → la popup se referme jusqu'au prochain lot ; le tri reste
  accessible dans **Offres reçues** (barre latérale, avec le nombre en attente).

Le webhook est **rejouable** : une offre déjà reçue — importée, écartée ou
encore en attente — n'est jamais reproposée (comptée dans `duplicates` de la
réponse JSON).

### Règle d'import principale

| Situation | Comportement |
|---|---|
| Nouveau magasin | → Nouvelle affaire dans **« À appeler »** |
| Magasin existant + **nouvelle offre** | → **Retour automatique en « À appeler »** |
| Magasin existant + offre déjà connue | → `lastSeenAt` mis à jour, colonne inchangée |

### Voir ses disponibilités pour caler une démo

Sous le champ **Date de la démo** de la fiche affaire, le bouton **📅 Afficher
les dispos** ouvre l'agenda Google de la semaine en créneaux de 30 minutes :
libre en vert, occupé en rouge, passé en gris. Les flèches naviguent d'une
semaine à l'autre, et **cliquer un créneau libre renseigne la date de démo**.

L'agenda lu est celui déjà connecté pour les visios Google Meet
(`GOOGLE_CALENDAR_ID`, « primary » par défaut) : rien de plus à configurer si
les invitations Meet fonctionnent déjà. La lecture est en **lecture seule** —
consulter les disponibilités n'écrit jamais dans l'agenda.

Les sept jours sont affichés, week-end compris : un directeur de magasin est
souvent joignable le samedi. La plage horaire par défaut va de 9 h à 19 h
(`CALENDAR_START_HOUR` / `CALENDAR_END_HOUR`), dans le fuseau
`GOOGLE_MEET_TIMEZONE`.

Sans intégration Google configurée, la grille s'affiche vide et le dit, plutôt
que de tomber en erreur.

#### Réautoriser l'agenda Google

Si la pop-up affiche « Agenda illisible » avec une erreur **403
`ACCESS_TOKEN_SCOPE_INSUFFICIENT`**, c'est que le `GOOGLE_REFRESH_TOKEN` en
place n'a que l'autorisation d'**écrire** des événements (celle qui sert aux
invitations Meet), pas celle de **lire** l'agenda. Refaites le parcours :

```bash
npm run google:auth
```

Le script a besoin de `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans un
`.env.local` à la racine — recopiez-les depuis Vercel → Settings → Environment
Variables (ou `npx vercel env pull .env.local` si vous avez la CLI ; le `npx`
est nécessaire, la commande `vercel` n'est pas installée par défaut).

Il affiche alors une adresse Google. Ouvrez-la, acceptez, et selon l'endroit
d'où vous lancez le script :

| Où tourne le script | Ce qui se passe |
|---|---|
| Sur la machine du navigateur | Google revient sur `http://localhost:5555/oauth2callback`, le script attrape le code **tout seul** |
| Sur une machine distante (**Codespace**, serveur, SSH) | Le navigateur affiche « site inaccessible » : c'est **normal**. Copiez l'**adresse entière de la barre du navigateur** et collez-la dans le terminal |

Dans les deux cas, le script vérifie immédiatement que l'agenda est lisible,
puis affiche le `GOOGLE_REFRESH_TOKEN` à recopier dans Vercel avant de
redéployer. Il n'écrit rien : ni dans vos fichiers, ni dans votre agenda.

Le port d'écoute se règle avec `GOOGLE_AUTH_PORT`. Si Google répond
`redirect_uri_mismatch`, ajoutez l'URI affichée par le script dans la console
Google Cloud → API et services → Identifiants → votre ID client OAuth → URI de
redirection autorisés. Si le script se plaint de ne pas recevoir de refresh
token, retirez d'abord l'accès du CRM sur
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### Programmer l'envoi d'un email

Dans la fiche affaire, le composeur d'email propose une ligne **Départ** :

| Choix | Effet |
|---|---|
| **Tout de suite** | comportement habituel, l'email part immédiatement |
| **Dans 1 h · Demain 9 h · Lundi 9 h** | raccourcis |
| Champ date/heure | n'importe quel moment futur |

Un email programmé apparaît aussitôt dans la frise de l'affaire avec le badge
**🕘 Programmé** et sa date de départ, et reste **annulable** d'un clic tant
qu'il n'est pas parti.

Rien à configurer : le départ est assuré par le **cron Vercel** déclaré dans
`vercel.json`, qui appelle `/api/emails/send-scheduled` toutes les dix minutes.
Renseignez simplement `CRON_SECRET` dans les variables d'environnement — Vercel
le présente de lui-même à ses crons. L'ouverture d'une fiche affaire relève
aussi la file, mais on ne peut pas compter dessus à 9 h du matin.

> Sur le plan **Hobby**, Vercel limite les crons à un par jour : la précision
> tomberait à 24 h. Dans ce cas, appelez la même route depuis N8N ou tout autre
> planificateur, toutes les 5 à 15 minutes :
> `POST /api/emails/send-scheduled?token=$EMAIL_SYNC_TOKEN`

Une pièce jointe ne peut pas accompagner un envoi programmé (rien ne la
conserve entre la rédaction et le départ) : le composeur le signale et refuse
l'envoi plutôt que de la perdre en route.

### Pipeline Kanban

- **Glisser-déposer** les cartes entre les colonnes
- Cliquer sur une carte pour ouvrir la **fiche affaire complète**
- **Filtres** : nouvelles affaires, nouvelles offres, recherche texte
- **Badges** : ✦ Nouvelle · ⟳ Rappelée · ⚠ Absente

### Numéros de téléphone des magasins (recherche automatique)

Le champ **N° de Téléphone** d'une affaire peut être rempli automatiquement,
sans aller chercher le numéro à la main sur Google ou sur le site de l'enseigne.

**Comment ça marche** — une cascade, du gratuit vers le payant :

| Étape | Source | Coût | Couverture |
|---|---|---|---|
| 1 | Numéro déjà connu (import, saisie) | — | — |
| 2 | **OpenStreetMap** (API Overpass) | gratuit, sans clé | les grandes enseignes y sont largement cartographiées |
| 3 | **Google Places** (fiche de l'établissement) | payant, facultatif | le reliquat, c'est-à-dire les magasins non résolus à l'étape 2 |

L'étape 2 traite les magasins **par enseigne et par département** : une seule
requête OpenStreetMap sert des dizaines de magasins. L'étape 3, la seule qui
coûte de l'argent, n'est déclenchée que sur ce que l'étape 2 n'a pas résolu.

**Le bon numéro, pas juste un numéro** — chaque candidat est noté sur des
indices vérifiables (enseigne présente dans le nom, code postal identique,
ville identique, distance au magasin géocodé, adresse concordante). Selon la
note :

- **note élevée** → le numéro est enregistré tout seul ;
- **note moyenne** → il part dans une file de vérification où un clic suffit à
  valider ou écarter (avec le lien vers la fiche d'origine pour trancher d'un
  coup d'œil) ;
- **aucun candidat** → le magasin est marqué non résolu et peut être relancé
  plus tard (par exemple après avoir activé Google).

Un numéro déjà saisi à la main n'est **jamais** écrasé.

**Où piloter**

- **Paramètres → « Numéros de téléphone des magasins »** : lancer la campagne
  sur toute la base, suivre l'avancement en direct, traiter la file de
  vérification.
- **Fiche affaire → bouton « 🔍 Trouver le numéro »** : recherche à l'unité,
  quasi instantanée, quand un magasin isolé n'a pas de numéro.
- **Ligne de commande** (recommandé pour le tout premier passage sur une grosse
  base, car sans limite de temps d'exécution) :

```bash
npm run phones:lookup                          # état des lieux, sans rien modifier
npm run phones:lookup -- --run                 # lance la campagne
npm run phones:lookup -- --run --no-google     # sources gratuites uniquement
npm run phones:lookup -- --run --scope echecs  # relance les magasins non résolus
```

La campagne est **reprenable** : chaque magasin traité est marqué en base, une
interruption ne fait donc rien perdre.

**Activer Google (facultatif)** — Google Cloud Console → activer l'API
« Places API (New) » → créer une clé d'API → la renseigner dans
`GOOGLE_PLACES_API_KEY` (cf. `.env.example`). Sans clé, tout fonctionne : seule
la couverture est plus faible. Cette API étant facturée à l'appel, pensez à
plafonner le quota côté Google Cloud avant un gros passage.

---

## Scripts disponibles

```bash
npm run dev          # Serveur de développement (http://localhost:3000)
npm run build        # Build de production
npm run start        # Serveur de production (après build)

npm run phones:lookup   # Recherche automatique des numéros de magasins
                        # (ajouter -- --run pour exécuter réellement)

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
