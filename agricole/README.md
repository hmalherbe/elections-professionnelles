# Système de suivi des élections professionnelles agricoles

Application distincte du suivi éducation nationale (`../backend`,
`../frontend`), construite à partir des mêmes briques (React/Vite/Tailwind,
Express/SQLite, intégration Brevo) mais pour un périmètre beaucoup plus
simple :

- **2 scrutins nationaux** (fichiers JSON d'émargements, import quotidien
  manuel — voir `backend/src/lib/scrutins.ts` pour les codes/libellés, à
  renommer dès que les noms officiels seront connus), sans notion
  d'académie ni de Spelc local.
- **Un fichier global des adhérents**, importé une seule fois avant le
  début des élections (remplacement intégral à chaque import).
- **Relance par mail uniquement** (pas de SMS), via Brevo — modèle unique,
  partagé par tous les comptes administrateurs.
- **Participation par établissement** (lycée agricole), par scrutin.
- **Plusieurs comptes administrateurs**, tous avec les mêmes droits (pas de
  hiérarchie de rôles).

## Développement local

```bash
cd agricole
npm install --workspace backend --workspace frontend
npm run dev:backend    # API sur http://localhost:4000
npm run dev:frontend   # Frontend sur http://localhost:5173 (proxy /api)
```

Variables d'environnement : voir `.env.example`.

## Déploiement

```bash
cd agricole
cp .env.example .env   # puis renseigner les valeurs
docker compose up -d --build
```

Sert l'application sur le port **8081** par défaut (`FRONTEND_PORT` dans
`.env` pour changer), en attendant qu'un nom de domaine commun avec la
sandbox existante (port 8080) permette d'en faire un sous-domaine dédié.
