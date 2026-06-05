# Guide de développement (pour les non-développeurs)

Ce guide explique **simplement** comment travailler sur le projet sans rien casser.
Tu n'as pas besoin d'être développeur pour le suivre.

---

## 1. L'idée générale : ne plus jamais casser la prod

Avant, tout était poussé directement sur `main` (la version « officielle »). Si une
modif cassait quelque chose, ça cassait **en direct**.

Désormais on sépare en deux :

| Branche | Rôle | Image mentale |
|---------|------|---------------|
| **`main`** | La version stable, celle qui tourne pour de vrai | Le magasin ouvert au public |
| **`dev`** | Là où on bricole et on teste les nouveautés | L'arrière-boutique / l'atelier |

On bricole dans `dev`. Quand c'est testé et que ça marche, on « pousse en prod » en
fusionnant `dev` dans `main`.

```
   tu (ou Claude) travailles  ──►   dev   ──►   main
        sur une branche             (on teste)   (la version qui tourne)
```

**Règle d'or : on ne touche jamais directement à `main`.** On passe toujours par une
*Pull Request* (une demande de fusion que l'on peut relire avant de valider).

---

## 2. La base de données : une copie pour le dev

Le code se branche à une base de données (PostgreSQL, hébergée sur **Neon**). Pour ne
pas abîmer les vraies données pendant les tests, on utilise une **base de dev séparée**.

Neon propose une fonction « **branching** » : créer une copie instantanée de ta base.

### À faire une fois (côté Neon, ~2 minutes)
1. Va sur https://console.neon.tech → ton projet.
2. Onglet **Branches** → **Create branch** → nomme-la `dev`.
3. Copie sa **connection string** (l'URL qui commence par `postgresql://…`).
4. À la racine du projet, crée un fichier nommé **`.env.development.local`** contenant :
   ```
   DATABASE_URL="postgresql://…colle-ici-l-url-de-ta-branche-dev…"
   ```
   > Ce fichier reste sur ta machine, il n'est jamais envoyé sur GitHub (c'est voulu).

À partir de là, `npm run dev` utilise automatiquement la base de **dev**, et la prod
garde sa propre base.

---

## 3. Le cycle de travail au quotidien

1. **Démarrer le projet en local**
   ```bash
   npm install      # la première fois, ou après un changement de dépendances
   npm run dev      # ouvre http://localhost:3000
   ```
2. **Demander une modif** (à Claude Code ou en codant). Le travail se fait sur une
   branche dédiée (ex. `claude/...` ou `feature/ma-nouveaute`), **pas** sur `main`.
3. **Vérifier que ça compile** :
   ```bash
   npm run build    # doit se terminer sans erreur
   ```
4. **Tester dans le navigateur** sur http://localhost:3000.
5. **Fusionner** : ouvrir une Pull Request vers `dev` sur GitHub, vérifier, fusionner.
6. **Mettre en prod** : quand `dev` est validé, ouvrir une PR `dev` → `main` et fusionner.

---

## 4. Les variables d'environnement (les « réglages secrets »)

Le fichier **`.env.example`** liste tous les réglages nécessaires (base de données,
webhooks n8n, clé email Resend…). Il sert de **modèle** : copie-le pour créer ton vrai
fichier de réglages.

- `.env` → réglages communs / prod
- `.env.development.local` → réglages de **dev** (ta base de dev) — prioritaire en `npm run dev`

> Ces fichiers `.env*` ne sont **jamais** envoyés sur GitHub : ils contiennent des
> secrets. Ne les colle jamais dans le code.

---

## 5. Aide-mémoire des commandes

```bash
npm run dev            # lancer le projet en local
npm run build          # vérifier que tout compile (à faire avant de fusionner)
npm run lint           # vérifier la qualité du code
npm run format         # remettre le code au propre automatiquement

npm run db:studio      # voir/éditer les données dans une interface (port 5555)
npm run db:seed        # remplir la base avec des données de démo
npm run db:push        # appliquer le schéma à la base de dev
```

---

## 6. Conseils

- En cas de doute, **demande**. Mieux vaut une question qu'une prod cassée.
- Active la **protection de la branche `main`** sur GitHub (Settings → Branches) pour
  interdire les pushs directs et exiger une Pull Request : c'est le filet de sécurité.
- Garde les modifications **petites et fréquentes** : plus facile à relire et à annuler.
