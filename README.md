# Élections professionnelles 2026

Application de suivi des élections professionnelles (3 au 10 décembre 2026) :
scrutin national CCMMEP et scrutins académiques locaux, tableaux de bord de
participation, gestion des adhérents, relances par mail/SMS via Brevo, et
simulation de la journée des PSA.

## Structure du projet

```
backend/    API Express + TypeScript + SQLite (better-sqlite3)
frontend/   Application React + TypeScript + Vite + Tailwind
seed-data/  Référentiels Excel fournis (départements/Spelc/académie,
            scrutins académiques, PSA) + un échantillon JSON CCMMEP pour
            les tests
```

## Déploiement (Docker)

Le dossier `infra/` contient tout le nécessaire pour déployer l'application
sur un serveur unique avec Docker :

- `infra/Dockerfile.backend` : build de l'API (Node/Express)
- `infra/Dockerfile.frontend` : build du frontend (Vite) servi par nginx,
  qui fait aussi office de reverse proxy vers l'API (`/api/*`)
- `docker-compose.yml` : orchestre les deux services + un volume persistant
  pour la base SQLite

Sur le serveur :

```bash
git clone https://github.com/hmalherbe/elections-professionnelles.git
cd elections-professionnelles
git checkout claude/elections-tracking-app-l2lmal
cp .env.example .env
# éditer .env : JWT_SECRET et SEED_ADMIN_PASSWORD (valeurs fortes, uniques)
docker compose up -d --build
```

L'application est alors accessible sur le port 80 du serveur. Le compte
admin général est créé automatiquement au premier démarrage avec les
identifiants de `.env` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`), et les
référentiels de `seed-data/` sont chargés automatiquement.

Pour mettre à jour après un nouveau push :

```bash
cd elections-professionnelles
git pull
docker compose up -d --build
```

**Note sécurité** : ce compose sert l'app en HTTP simple (pas de nom de
domaine fourni pour du TLS automatique). Pour du HTTPS, pointer un nom de
domaine vers le serveur et remplacer nginx par Caddy (TLS automatique via
Let's Encrypt) ou ajouter certbot devant nginx.

## Démarrage rapide (développement local)

```bash
npm install

# Initialise la base SQLite, crée le compte admin général et charge les
# référentiels du dossier seed-data/
npm run seed --workspace backend

# Terminal 1 : API sur http://localhost:4000
npm run dev:backend

# Terminal 2 : application sur http://localhost:5173 (proxy /api -> :4000)
npm run dev:frontend
```

Le compte admin général créé par le seed :

- email : `admin@elections-pro.fr`
- mot de passe : `ChangeMoi123!`

**À changer immédiatement en production** (ou définir `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` avant `npm run seed`).

## Variables d'environnement (backend)

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | Port de l'API | `4000` |
| `JWT_SECRET` | Secret de signature des sessions | `dev-secret-change-me` (à changer en prod) |
| `DATABASE_PATH` | Emplacement du fichier SQLite | `backend/data/elections.sqlite` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Identifiants du compte admin général créé par le seed | voir ci-dessus |

## Rôles

- **Admin général** : importe le fichier JSON CCMMEP quotidien, gère les
  comptes admin académique/Spelc, charge les référentiels (départements/Spelc/
  académie, scrutins académiques, liste des PSA), consulte le tableau de bord
  national et lance la simulation de la journée PSA.
- **Admin académique** (plusieurs comptes possibles par académie) : importe
  les fichiers JSON 1D et 2D de son académie, consulte les tableaux de bord
  de son académie (scrutin local et/ou national filtré).
- **Admin Spelc** : importe la liste des adhérents (Excel), configure sa clé
  API Brevo et ses modèles de mail/SMS, envoie des campagnes de relance et
  suit leurs statistiques, consulte les tableaux de bord de son Spelc.

## Règles métier implémentées

- **Département** extrait du code postal contenu dans `affectation` (2
  premiers chiffres, 3 pour les DOM 971/972/973/974/976/978), résolu vers un
  Spelc et une académie via le référentiel Excel.
- **1er/2nd degré** déterminé à partir du champ `corps` : "Professeurs des
  écoles" → 1D ; "certifié" ou "agrégé" → 2D (les autres corps restent non
  classés, faute de règle fournie).
- **Type de scrutin académique** (CCMI/CCMA/CCMD/CCML1D/CCML2D…) résolu via
  le référentiel des scrutins académiques.
- **Courbe de participation cumulée** : un point par import quotidien
  (`snapshot_date`), les fichiers étant cumulatifs par nature.
- **Rapprochement adhérents** : par nom/prénom normalisés (majuscules, sans
  accents), contre les scrutins locaux (1D + 2D réunis) du Spelc.
- **Simulation PSA** : génère aléatoirement, pour chaque PSA et pour les
  scrutins CCMMEP + local, une date d'émargement (ou une abstention) répartie
  sur les 8 jours du scrutin (3 → 10 décembre 2026).

## Sécurité

Le module de référentiels/adhérents utilise `exceljs` plutôt que le paquet
`xlsx` (SheetJS) : ce dernier a des vulnérabilités connues (pollution de
prototype, ReDoS) non corrigées sur npm, inacceptables pour un parseur
recevant des fichiers uploadés.

## Tests

```bash
npm run test:backend
```

Les tests couvrent la logique de parsing (classification 1D/2D, extraction du
département, parsing des dates d'émargement) contre les formats réellement
observés dans les fichiers fournis.

## Intégration Brevo

L'envoi de mails/SMS et la synchronisation des statistiques appellent
réellement l'API Brevo (`api.brevo.com`) avec la clé configurée par chaque
admin Spelc. Sans clé configurée, l'envoi est refusé explicitement (aucune
donnée simulée n'est renvoyée comme si l'envoi avait eu lieu).

Chaque campagne (Spelc) peut être envoyée en **mode test** : contenu
personnalisé de vrais adhérents mais destinataire réel remplacé par le
mail/mobile de test — configuré une seule fois par l'admin général
(onglet PSA, section « Mail / mobile de test »), utilisé partout où le
mode test est actif.

## Relances PSA

L'admin général possède sa propre clé API Brevo et ses propres modèles
mail/SMS (indépendants de ceux des Spelcs), utilisés pour relancer les
PSA après une simulation. Sur l'onglet PSA, cocher une ou plusieurs
dates parmi les 8 jours du scrutin déclenche, pour chaque date et pour
chaque canal (mail/SMS), une relance réelle vers Brevo à destination des
PSA n'ayant pas encore voté (national et/ou local) à cette date-là dans
la simulation en cours.

## Journal des relances

Chaque envoi individuel (campagne Spelc ou relance PSA, mail ou SMS) est
journalisé dans `backend/data/relances.log` (NDJSON, un envoi par ligne :
horodatage, type, périmètre, campagne, nom, prénom, contact utilisé, mode
test, succès). Consultable depuis l'onglet PSA de l'admin général
(« Journal des relances ») ou directement sur le serveur.
