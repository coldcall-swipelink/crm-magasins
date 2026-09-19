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

### Fond de la carte des magasins

CARTO a rendu ses fonds de carte payants : sans clé, ses tuiles arrivent
barrées d'un filigrane **« API KEY REQUIRED »**. La carte fonctionne dans les
deux cas :

| `NEXT_PUBLIC_CARTO_API_KEY` | Fond utilisé |
|---|---|
| vide (par défaut) | Tuiles libres **OpenStreetMap**, sans inscription ni filigrane. En couleurs à la source, désaturées par le CRM pour retrouver le gris clair d'origine |
| renseignée | Fond **CARTO** pour lequel la carte a été dessinée, avec ses tuiles doubles sur écran Retina |

La clé CARTO est gratuite ([carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)).
Le préfixe `NEXT_PUBLIC_` est obligatoire : les tuiles sont chargées par le
navigateur, pas par le serveur. Après l'avoir ajoutée dans Vercel, redéployez —
une variable `NEXT_PUBLIC_` est figée au moment de la compilation.

### Pipeline Kanban

- **Glisser-déposer** les cartes entre les colonnes
- Cliquer sur une carte pour ouvrir la **fiche affaire complète**
- **Filtres** : nouvelles affaires, nouvelles offres, recherche texte
- **Badges** : ✦ Nouvelle · ⟳ Rappelée · ⚠ Absente

### Dashboard closing — ce que chaque chiffre compte

Les mêmes définitions que l'écran TV et que Smartlink Brain, pour que les
quatre outils disent la même chose :

- **MRR** = la somme des valeurs des abonnements **signés et non résiliés**
  (date de closing renseignée, case « churn » décochée). Un client résilié ne
  compte nulle part : ni dans le MRR, ni dans les closings, ni dans le panier
  moyen. Cocher « churn » sur l'abonnement suffit — la colonne Churn du
  pipeline n'est qu'un reflet.
- **MRR de la période** = les abonnements signés dans la période, résiliés
  exclus ; **MRR total cumulé** = tous les signés non résiliés, quelle que soit
  la date — c'est le MRR actuel, celui de l'écran TV.
- **Prix moyen du crédit** = Σ (valeur × 12) ÷ Σ crédits par an des
  abonnements de la période, le nombre de crédits étant lu dans le libellé du
  type (« 2 crédit par mois » = 24 par an). Multidiffusion et libellés hors
  format sont écartés, et le sous-titre le dit.
- **Taux de churn** = clients résiliés dans la période ÷ clients acquis
  jusqu'à la fin de la période (actifs et résiliés).
- **CA sur la durée du contrat** = panier moyen × durée saisie du contrat.
  Ce n'est pas une LTV (ni churn ni coûts) : la LTV vit dans Brain.

### Calendrier des appels d'une affaire (semaine type)

Chaque clic sur **« Afficher le numéro »** dans une fiche affaire journalise un
appel. Vingt secondes plus tard, la bannière **« Est-ce que le décisionnaire a
pu être contacté ? »** demande ce qu'il en est — et, si la réponse est
**Non**, *pourquoi* : « Pas sur le magasin », « En réunion » ou « Refus de
prendre l'appel ».

L'onglet **Calendrier** de la fiche affiche ces appels sur une **semaine
type** : une colonne par jour de la semaine, une ligne par heure. Les appels ne
sont pas rangés à leur date, mais à leur **jour de la semaine et à leur
heure** — un appel passé un lundi à 10 h et un autre le lundi suivant à 11 h se
retrouvent tous les deux sur la colonne « Lundi », l'un à 10 h, l'autre à 11 h.

Chaque appel est une pastille à son heure, colorée par la réponse à la pop-up :

| Couleur | Réponse | Ce que ça dit du magasin |
|---|---|---|
| 🟢 vert | Décisionnaire joint | créneau qui fonctionne |
| 🔴 rouge | Pas sur le magasin | il n'y est pas à cette heure-là |
| 🟠 orange | En réunion / refus de prendre l'appel | il y est, mais pas disponible |
| ⚪ gris | pop-up restée sans réponse | résultat inconnu |

D'un coup d'œil sur la grille : **à quelle heure ce magasin décroche, et quand
il ne sert à rien d'appeler**. La vue couvre les douze derniers mois, sur la
plage 8 h – 19 h (élargie si des appels sortent de cette plage). Cliquer un
créneau déplie les appels qui s'y trouvent, avec leur date réelle, leur
résultat et qui a appelé. Les compteurs sous la grille résument l'ensemble.

> Ces réponses sont stockées sur `CallLog.outcome` (avec `CallLog.connected` en
> miroir, pour les compteurs d'appels aboutis). Après une mise à jour, relancez
> `npm run db:migrate` (ou `npm run db:push`) pour créer cette colonne.

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

### Créer un utilisateur produit depuis une affaire

Onglet **Recrutement** de la fiche affaire, encadré « Utilisateur produit » :
le bouton **« ＋ Créer un user »** ouvre un petit formulaire (prénom, nom,
email, poste) et crée, dans la base **produit** Supabase, tout ce qu'il faut
pour que le magasin puisse se connecter :

1. le compte dans l'onglet **Authentication**, avec le mot de passe
   `00000000` — c'est lui qui donne le `user_id` ;
2. la ligne **`User`** (Table Editor) : ce `user_id`, le nom, le prénom et
   l'email saisis ;
3. la ligne **`Recruiter`** : ce `user_id`, l'`organization_id` rattaché à
   l'affaire, le poste (`company_position`), `cgu_pp_accepted` et `is_admin` à
   `true`, et `configured_at` à la date et l'heure de la création.

Le `user_id` créé s'affiche sous le formulaire, prêt à être copié.

**Prérequis** — l'affaire doit porter une organisation principale : celle posée
automatiquement en « Démo prévue », créée à la demande avec « Créer
l'organisation dans Supabase », ou saisie à la main juste au-dessus. Sans elle,
le bouton n'est pas proposé.

**Rien d'autre n'est touché** — le bouton ne fait que ces trois créations.
Aucune ligne existante n'est modifiée ni supprimée, et si l'email a déjà un
compte dans Supabase, la création s'arrête sur un message d'erreur sans rien
écrire : le compte existant reste tel quel (mot de passe compris).

---

## Outil « Campagnes » — séquences d'emails

Outil de prospection par email intégré à l'application, mais **espace à part
entière** : le sélecteur en haut du volet gauche (logo + « CRM Magasins »)
bascule entre le **CRM** (pipeline, paiements, carte, offres reçues…) et
**Campagnes**. Dans cet espace, le volet gauche porte ses propres écrans :
Vue d'ensemble (`/campagnes`), Campagnes (`/campagnes/sequences`), Leads
(`/campagnes/leads`), Déclencheurs (`/campagnes/declencheurs`), Historique
(`/campagnes/historique`) et Boîtes d'envoi (`/campagnes/boites`). Quand on
rebascule vers un espace, on revient sur la dernière page qu'on y avait
ouverte (mémoire de l'onglet du navigateur). Les deux espaces et leurs menus
sont décrits dans `src/lib/workspace.ts`.

Fonctions : import de leads, séquences d'emails espacés de délais d'attente,
arrêt automatique dès qu'un lead répond, tableaux de bord.

### Ce qui le distingue du reste du CRM

Les emails d'affaire partent par Resend. Les campagnes, elles, partent **en
direct depuis de vraies boîtes** (Google Workspace, OVH) en SMTP, et leurs
réponses sont relevées en IMAP sur ces mêmes boîtes. C'est ce qui permet
d'utiliser plusieurs domaines, de garder les fils de discussion cohérents, et
de détecter les réponses sans dépendre d'un routeur tiers.

### Mise en route

1. **Clé de chiffrement.** `CAMPAIGN_SECRET_KEY` (`openssl rand -hex 32`) dans
   l'environnement : les mots de passe des boîtes sont chiffrés en base
   (AES-256-GCM) et ne ressortent jamais par l'API. Sans elle, aucune boîte ne
   peut être enregistrée.
2. **Adresse publique.** `NEXT_PUBLIC_APP_URL` doit pointer sur l'adresse
   réelle du CRM : c'est la base des liens de suivi d'ouverture et de
   désinscription placés dans les emails.
3. **Connecter une boîte** (Campagnes → Boîtes d'envoi). La connexion SMTP et
   IMAP est testée AVANT enregistrement : une boîte listée est une boîte qui a
   déjà fonctionné.
   - *Google Workspace* : le mot de passe habituel du compte est refusé en
     SMTP. Il faut un **mot de passe d'application** : activer la validation en
     deux étapes sur le compte, puis, connecté avec cette adresse, ouvrir
     <https://myaccount.google.com/apppasswords>, nommer l'application et
     copier les 16 caractères. Activer aussi l'IMAP (Gmail → Paramètres →
     Transfert et POP/IMAP), sans quoi les réponses ne remonteront pas.
     Si la page des mots de passe d'application est inaccessible, c'est que
     l'administrateur Workspace les a désactivés, ou que le compte est en
     « Protection avancée ».
   - *OVH MX Plan* : le mot de passe de la boîte elle-même, celui du webmail —
     rien à générer. Il se redéfinit dans l'espace client OVH → Web Cloud →
     Emails → domaine → Comptes e-mail → l'adresse → Modifier le mot de passe.
4. **Importer des leads** (Campagnes → Leads). CSV ou TSV, seul l'email est
   obligatoire. Les colonnes non reconnues deviennent des champs personnalisés,
   donc des variables : une colonne « Effectif du magasin » donne
   `{{effectif_du_magasin}}`.
5. **Créer une campagne**, rédiger la séquence, y inscrire des leads, lancer.

### Garde-fous d'envoi

Chaque boîte porte les siens : quota journalier, délai aléatoire entre deux
envois, plage horaire et jours autorisés (dans SON fuseau), montée en charge
progressive. Le moteur ne déroule jamais une campagne d'un bloc : il relève les
inscriptions dont l'heure est venue, boîte par boîte, dans ces limites.

Quotas indicatifs des fournisseurs : ~2 000 destinataires/jour sur Google
Workspace (500 en compte gratuit). Réglez le quota du CRM en dessous.

### Traitement lead par lead

Un lead dans une campagne est une **inscription** : c'est l'objet que l'on
arrête individuellement. Mettre en pause, reprendre ou arrêter un lead — depuis
l'onglet Leads de la campagne ou depuis sa fiche — ne touche ni les autres
leads ni l'état de la campagne.

L'arrêt automatique sur réponse repose sur le relevé IMAP. Une réponse
rattachée à un envoi précis (en-têtes `In-Reply-To` / `References`) n'arrête que
sa campagne ; une réponse non rattachée arrête toutes les séquences en cours du
lead. Les désinscriptions et les adresses mortes sortent le lead de toutes ses
séquences, définitivement.

### Automatisation

Deux crons, déclarés dans `vercel.json`, authentifiés par `CRON_SECRET` :

| Route | Cadence | Rôle |
| --- | --- | --- |
| `POST /api/campaigns/run` | 5 min | fait partir les emails dus |
| `POST /api/campaigns/sync-replies` | 10 min | relève les réponses, applique l'arrêt |

Les deux sont rejouables sans risque de doublon et appelables depuis n'importe
quel planificateur (N8N…) avec le même jeton.

### Mesure

Le taux d'ouverture repose sur un pixel invisible : une image bloquée ne compte
pas l'ouverture, un pré-chargement (Apple Mail, proxy Gmail) la compte à tort.
Il se lit comme une tendance. Le taux de réponse, mesuré sur les réponses
réellement reçues dans les boîtes, est le chiffre solide. Les liens ne sont pas
réécrits : pas de suivi de clic, mais des emails propres.

---

## Pilote « Prospection de Valeur » — parcours boucher

Un magasin publie une offre de boucher. Son directeur reçoit un mail dont
l'unique bouton ouvre **rdv.swipelink.fr/boucher**, où il répond à trois
questions et réserve une démo de 15 min en visio. Le CRM fait le reste : il
pose le rendez-vous dans l'agenda, fait avancer l'affaire, lance le sourcing et
envoie les rappels.

### Le trajet, de bout en bout

1. **Envoi** — `POST /api/pv/invites` génère un jeton par magasin et envoie le
   mail. Le jeton est tiré au hasard (32 octets), stocké haché, et l'URL ne
   contient aucune donnée personnelle.
2. **Ouverture** — `GET /boucher?t=…` sert la page avec le nom du magasin et le
   nombre de profils **déjà écrits dans le HTML** : le directeur ouvre le lien
   depuis sa boîte mail, souvent en 4G, et doit lire le nom de SON magasin tout
   de suite. Un jeton inconnu ou expiré reçoit une page d'explication, et rien
   d'autre — aucune donnée du magasin n'est servie.
3. **Trois questions** — expérience, salaire, prise de poste. Chaque réponse est
   remontée anonymement (`POST /api/pv/events`).
4. **Créneau** — `GET /api/pv/slots` renvoie les trous RÉELS de l'agenda des
   démos, à J+2 minimum, recalculés à chaque appel, sans cache.
5. **Réservation** — `POST /api/pv/bookings` prend le créneau (30 min bloquées
   dans l'agenda pour une démo annoncée à 15 : la marge est voulue), crée l'événement
   et la visio, fait passer l'affaire en `Closing › DEMO PREVUE`, la duplique
   dans `Recrutement › SOURCING A FAIRE`, et envoie la confirmation avec son
   fichier `.ics` (lien visio + lien « déplacer »).
6. **Rappels** — la veille et 1 h avant, e-mail et SMS. Et le lendemain, une
   relance pour ceux qui ont répondu aux questions sans réserver.

### Deux ou trois choses à savoir

**Deux réservations sur le même créneau.** C'est la base qui tranche, pas
l'application : `PvBooking.slotKey` porte l'heure de début et est unique. Le
second insert viole la contrainte et reçoit un **409**, que la page sait
traiter (« ce créneau vient d'être pris »). Lire les créneaux libres puis
écrire ne suffirait pas — entre la lecture et l'écriture, l'autre est passé.

**Le nombre de profils est une estimation.** Tant que les candidats ne portent
pas de localisation exploitable, compter les bouchers à moins de 25 km n'est
pas possible. On estime donc d'après la taille de l'agglomération (grande
agglomération : 70 à 88 ; ville moyenne : 46 à 58 ; ailleurs : 30 à 42), avec
un tirage **stable** : le même magasin obtient toujours le même nombre, et
celui-ci est figé sur l'invitation dès l'envoi — le mail annonce 74, la page
affiche 74. Tout passe par `countButcherProfiles()` dans
`src/lib/pv/profiles.ts` : le jour où les candidats seront localisés, seule
cette fonction changera.

**Les références sont filtrées quatre fois.** Client actuel (abonnement closé,
non résilié, pas encore échu), même enseigne, à moins de 100 km, et **a accepté
d'être cité** (case `citableReference` de la fiche affaire). Sans référence, le
bloc est retiré du mail et masqué sur la page : mieux vaut pas de preuve
sociale qu'une preuve sociale creuse.

**La relance ne se fonde jamais sur un clic.** Les Safe Links de Microsoft
ouvrent les liens à la place du destinataire, avant même qu'il n'ait lu : un
clic ne prouve la présence de personne. Seules les réponses aux questions
(`answer_1..3`) déclenchent la relance.

**Deux canaux d'envoi, et ce n'est pas un doublon.** L'invitation est un message
froid : elle part d'une boîte de l'outil Campagnes (domaine dédié, préchauffage,
cadence), seul chemin qui convertisse aussi le logo en image intégrée (CID),
qu'Outlook affiche sans demander « Télécharger les images ». Les confirmations
et rappels, eux, sont attendus : ils partent par Resend.

### Mise en ligne

1. Déclarer `rdv.swipelink.fr` dans Vercel (Settings → Domains) **sur ce
   projet** : la page est une route du CRM, pas un site à part.
2. Renseigner les variables `PV_*` et `TWILIO_*` (voir `.env.example`, qui
   détaille aussi SPF, DKIM, DMARC et le préchauffage du domaine d'envoi —
   à faire AVANT le premier envoi).
3. Les deux crons sont déjà déclarés dans `vercel.json` :
   `/api/pv/reminders` toutes les 10 min, `/api/pv/follow-ups` en semaine à 9h30.

### Envoyer les invitations

```bash
# Aperçu d'un magasin dans le navigateur (aucun jeton créé, aucun envoi)
open "https://crm.swipelink.fr/api/pv/invites?token=$CRON_SECRET&dealId=<id>"

# Envoi réel
curl -X POST "https://crm.swipelink.fr/api/pv/invites?token=$CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"dealIds":["<id1>","<id2>"]}'
```

Générer une nouvelle invitation pour un magasin révoque la précédente : un
magasin n'a jamais deux liens valables en circulation.

### Où regarder

| Fichier | Rôle |
|---|---|
| `src/pv-assets/` | La page et le mail, fichiers HTML complets, ouvrables tels quels dans un navigateur (mode démo tant que `CONFIG.API` est vide) |
| `src/app/boucher/route.ts` | Sert la page : jeton vérifié, magasin et profils injectés |
| `src/app/api/pv/` | Les cinq routes publiques + invitations, rappels, relances |
| `src/lib/pv/bookings.ts` | La réservation, et le verrou qui produit le 409 |
| `src/lib/pv/slots.ts` | Les créneaux réellement libres |
| `src/lib/pv/profiles.ts` | L'estimation du nombre de profils |
| `src/lib/pv/references.ts` | Les trois clients voisins citables |

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
