# Élections professionnelles 2026

Application de suivi des élections professionnelles (3 au 10 décembre 2026) :
scrutin national CCMMEP et scrutins académiques locaux, tableaux de bord de
participation, gestion des adhérents, relances par mail/SMS via Brevo.

## Structure du projet

```
backend/    API Express + TypeScript + SQLite (better-sqlite3)
frontend/   Application React + TypeScript + Vite + Tailwind
seed-data/  Référentiels Excel fournis (départements/Spelc/académie,
            scrutins académiques) + un échantillon JSON CCMMEP pour
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
| `SCRAPING_SECRET_KEY` | Clé de chiffrement des mots de passe des portails de scraping | reprend `JWT_SECRET` si absent |
| `APP_MODE` | `full` (par défaut) ou `relance-only` (démo, voir plus bas) | `full` |
| `RELANCE_DEMO_EMAIL` | Email du compte admin Spelc utilisé en mode `relance-only` | requis seulement dans ce mode |

## Rôles

- **Admin général** : importe le fichier JSON CCMMEP quotidien, gère les
  comptes admin académique/Spelc, charge les référentiels (départements/Spelc/
  académie, scrutins académiques), consulte le tableau de bord national.
- **Admin académique** (plusieurs comptes possibles par académie) : importe
  les fichiers JSON 1D et 2D de son académie, consulte les tableaux de bord
  de son académie (scrutin local et/ou national filtré).
- **Admin Spelc** : importe la liste des adhérents (Excel), configure sa clé
  API Brevo et ses modèles de mail/SMS, envoie des campagnes de relance et
  suit leurs statistiques, consulte les tableaux de bord de son Spelc.

### Gestion des comptes (admin général)

Onglet Utilisateurs : création manuelle d'un compte, ou **import en masse**
d'admins Spelc/académiques depuis un CSV ou Excel (colonnes : `type_admin`
["spelc" ou "academique"], `nom`, `prenom`, `email`, `spelc`, `academie` —
le Spelc/l'académie doit déjà exister dans les référentiels). Chaque compte
importé reçoit le mot de passe temporaire `ElectionsCCM2026`, à changer
obligatoirement à la première connexion. Tout utilisateur, y compris
l'admin général, peut changer son mot de passe à tout moment via le bouton
« Changer mon mot de passe » de l'en-tête.

## Règles métier implémentées

- **Département** extrait du code postal contenu dans `affectation` (2
  premiers chiffres, 3 pour les DOM 971/972/973/974/976/978), résolu vers un
  Spelc et une académie via le référentiel Excel.
- **1er/2nd degré** déterminé à partir du champ `corps` : "Professeurs des
  écoles" → 1D ; "certifié" ou "agrégé" → 2D (les autres corps restent non
  classés, faute de règle fournie).
- **Type de scrutin académique** (CCMI/CCMA/CCMD/CCML1D/CCML2D…) résolu via
  le référentiel des scrutins académiques.
- **Courbe de participation cumulée** : un point par jour d'émargement
  distinct (`date_emargement`), reconstruite depuis l'import le plus récent
  — les fichiers étant cumulatifs par nature, un seul import suffit à
  reconstituer l'historique complet des jours déjà écoulés.
- **Rapprochement adhérents** : par nom/prénom normalisés (majuscules, sans
  accents), contre les scrutins locaux (1D + 2D réunis) du Spelc.

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
personnalisé de vrais adhérents mais destinataire réel remplacé par un
mail/mobile de test. Réglable à deux niveaux : un réglage **global**
(`GET`/`PUT /api/admin/test-settings`, sans écran dédié), utilisé par
défaut, et un réglage **propre à chaque Spelc** (onglet Brevo), prioritaire
sur le réglage global pour les campagnes de ce Spelc.

## Journal des relances

Chaque envoi individuel (campagne Spelc, mail ou SMS) est journalisé dans
`backend/data/relances.log` (NDJSON, un envoi par ligne : horodatage, type,
périmètre, campagne, nom, prénom, contact utilisé, mode test, succès).
Consultable directement sur le serveur, ou via `GET /api/admin/relance-log`
(tous Spelcs confondus, sans écran dédié) et `GET /api/brevo/relance-tracking`
(propre à un Spelc, onglet « Relances adhérents »).

## Personnalisation des mails de relance (logo, réseaux sociaux, envois de test)

Les modèles de mail (onglet « Relances adhérents » de l'admin Spelc)
supportent deux champs supplémentaires dans leur « modèle prégarni » :

- `{{logo}}` : image d'entête propre à chaque Spelc, uploadée une fois
  (encodée en base64, stockée en base — pas de fichier ni d'URL publique
  nécessaire).
- `{{reseaux_sociaux}}` : pied de page listant les réseaux sociaux cochés
  (Facebook, X/Twitter, Instagram, LinkedIn, YouTube) avec leur URL,
  configurables au même endroit que le logo.

Chaque écran de modèle propose aussi un bouton **« Mail de test »** /
**« SMS de test »** : envoie un unique message avec le contenu du modèle
actuellement affiché (pas forcément encore enregistré), avec les champs
dynamiques calculés pour le premier adhérent encore non-votant — utile
pour vérifier le rendu avant d'enregistrer puis de lancer une vraie
campagne.

## Environnement de démonstration "relance-only"

Le même code peut être déployé une seconde fois, en configuration réduite,
pour faire tester au client la seule fonctionnalité de relance des
adhérents, sans écran de connexion :

- `.env` de ce déploiement : `APP_MODE=relance-only` et
  `RELANCE_DEMO_EMAIL=<email d'un compte admin Spelc existant>` (créer ce
  compte au préalable, en mode `full`, via l'admin général).
- Le frontend saute directement à l'onglet « Relances adhérents » du Spelc
  désigné (`POST /api/auth/demo-login`, sans mot de passe).
- Le backend refuse en plus, quel que soit le compte utilisé, toute route
  hors `/api/brevo/*` (verrou serveur, voir `backend/src/index.ts`) — pas
  seulement un masquage côté interface.

Laisser `APP_MODE` vide (ou absent) déploie l'application complète, sans
aucune restriction — c'est le mode de la prod.

## Récupération automatique des fichiers (scraping)

Sur l'onglet Imports de l'admin général (scrutin national) et de chaque
admin académique (1er/2nd degré), un encart « Récupération automatique »
permet de configurer un portail de gestion (URL de connexion, identifiant,
mot de passe, URL du/des fichier(s) JSON) puis de le déclencher en un
clic. Techniquement : un navigateur Chromium headless (Playwright, aucune
fenêtre visible) se connecte au portail avec les identifiants fournis,
récupère le fichier dans la session authentifiée, puis l'importe comme un
import manuel classique. Le mot de passe est chiffré (AES-256-GCM) avant
stockage en base, jamais renvoyé en clair par l'API.

Les vrais portails de gestion (CCMMEP national et académiques) n'existent
pas encore — ils n'ouvriront qu'en décembre 2026, et leur formulaire de
connexion exact (noms des champs) n'est pas connu à l'avance. Le champ
« Options avancées » de l'encart permet d'indiquer des sélecteurs CSS
spécifiques (identifiant/mot de passe/bouton) si le formulaire réel diffère
du cas standard (`input[name="username"]`, `input[name="password"]`,
`button[type="submit"]`).

En attendant, le service `mock-portal` (voir `docker-compose.yml`) simule
un vrai portail — une page de connexion HTML, une session par cookie, des
fichiers JSON protégés — pour valider tout le mécanisme de bout en bout.
Il n'est accessible que depuis le conteneur backend (`http://mock-portal:8081/...`),
jamais exposé publiquement. Ses identifiants se configurent via
`MOCK_PORTAL_USERNAME`/`MOCK_PORTAL_PASSWORD` dans `.env`. Une fois les
vrais portails ouverts, il suffit de reconfigurer les encarts avec les
vraies URLs — ce service de test peut alors être retiré du
`docker-compose.yml`.

## Assistant conversationnel (IA)

Chaque tableau de bord (admin général, académique, Spelc) possède un onglet
« Assistant » permettant de poser des questions en langage naturel sur les
données de participation (« Quel est le taux de participation de mon
académie ? », « Combien de mes adhérents ont voté ? »...).

Techniquement, ce n'est pas un RAG par recherche vectorielle : les données
étant entièrement structurées (tables SQL), le modèle **Mistral**
(`mistral-large-latest`, appelé via son API de *function calling*) choisit
parmi un jeu d'outils prédéfinis (résumé de participation, courbe,
répartition par établissement, par type de scrutin, adhérents d'un Spelc...),
chacun correspondant à une requête SQL déjà utilisée par les tableaux de
bord — le modèle ne peut donc jamais halluciner un chiffre.

**Cloisonnement des données** : le périmètre (académie/Spelc) n'est jamais
confié au modèle. Il est toujours forcé côté serveur à partir du rôle de
l'utilisateur authentifié (`backend/src/services/chatTools.ts`), quel que
soit ce que le prompt ou le modèle tenterait de demander :

- **admin général** : accès à toutes les données (CCMMEP national, toutes
  les académies, tous les Spelcs, y compris leurs adhérents).
- **admin académique** : uniquement les données de sa propre académie
  (scrutin national filtré + scrutin académique local) ; pas d'accès aux
  données d'adhérents (propres aux Spelcs), ni aux autres académies.
- **admin Spelc** : uniquement les données de son propre Spelc (votants,
  non-votants, adhérents et non-adhérents) ; pas d'accès aux autres Spelcs
  ni aux données académiques globales.

La clé API Mistral se configure une seule fois par l'admin général (onglet
Assistant), chiffrée en base (même mécanisme que les mots de passe de
scraping) et jamais renvoyée en clair par l'API.
