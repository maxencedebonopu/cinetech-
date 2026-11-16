# Cinémathèque

Plateforme de streaming personnelle pour une collection de films numérisés (`.mkv`, `.mp4`, `.avi` + sous-titres `.srt`/`.ass`).

> **État : phase 1 terminée** (scan, base de données, analyse technique, sous-titres, API). Métadonnées TMDB codées, en attente de la clé. Interface : phase 3.

## Organisation

```
server/   API Fastify + TypeScript : scan, ffprobe/ffmpeg, TMDB, SQLite
web/      Interface React + Vite (phase 3)
shared/   Types partagés serveur ↔ interface
data/     Créé au lancement : base SQLite, images en cache, fichiers temporaires (jamais versionné)
```

## Prérequis

- **Node.js 22+** (installé : v24)
- **ffmpeg** : installé avec `winget install Gyan.FFmpeg`. Le serveur le trouve tout seul (PATH ou dossier winget). Il sert à :
  - analyser chaque fichier (durée, codecs, pistes, chapitres) avec `ffprobe` ;
  - convertir à la volée l'audio que les navigateurs ne lisent pas (DTS, E-AC3, AC3, Opus multicanal…) ;
  - convertir le HDR en SDR, extraire les sous-titres intégrés, générer les vignettes ;
  - encoder en H.264 avec la carte graphique AMD (AMF), détectée automatiquement.

## Configuration

Copier `.env.example` en `.env` (déjà fait) et renseigner :

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (défaut 8765) |
| `TMDB_KEY` | Clé TMDB v3 ou jeton v4 (themoviedb.org → Paramètres → API) |
| `TMDB_LANGUAGE` | Langue des fiches (défaut `fr-FR`) |
| `LIBRARY_DIRS` | Dossiers de films au premier lancement, séparés par `;` |

## Commandes

```bash
npm install          # une fois
npm run scan         # scan complet en ligne de commande (affiche un bilan)
npm start            # lance le serveur sur http://localhost:8765
npm run dev          # serveur avec rechargement automatique
```

## Fonctionnement de la bibliothèque

1. **Scan récursif** des dossiers + **surveillance** (chokidar) : un film copié est ajouté quelques secondes après la fin de la copie. Un fichier déplacé ou renommé garde sa fiche et son historique.
2. **Reconnaissance du nom** : `Titre (Année)`, style scène `Titre.Année.1080p.BluRay…`, groupes `[xxx]` en tête, éditions (« The Final Cut »).
3. **Analyse ffprobe** : conteneur, codec, résolution, profondeur, HDR10 / Dolby Vision, pistes audio, sous-titres intégrés, chapitres.
4. **Sous-titres externes** : rattachés par nom identique (même dossier) ou par titre + année (un dossier `Subtitles\` séparé fonctionne). Sans année, il faut un titre quasi identique et sans homonyme. Encodage détecté (UTF-8, UTF-16, Windows-1252…), langue détectée **par le contenu** (les noms de fichiers se trompent souvent). Les sous-titres sans film restent « orphelins », rattachables à la main.
5. **Sous-titres intégrés** : pistes texte (SRT/ASS) extraites en WebVTT à la demande puis mises en cache. Pistes image (PGS Blu-ray, VobSub DVD) signalées comme « incrustation nécessaire ».
6. **TMDB** : recherche avec score de confiance (titre, année, popularité). ≥ 0,75 → associé ; 0,55–0,75 → « à vérifier » ; en dessous → « non reconnu ». Fiche en français, casting, équipe, logo, fond sans texte. Images converties en WebP à plusieurs tailles, avec blurhash et palette d'accent lisible (contraste AA sur le fond).

## API (phase 1)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | ffmpeg, ffprobe, TMDB, encodeurs matériels |
| GET | `/api/movies` | Liste des films |
| GET | `/api/movies/:id` | Fiche complète (média, sous-titres, données perso) |
| PATCH | `/api/movies/:id/user` | Note, position, vu, décalage des sous-titres |
| GET | `/api/tmdb/search?q=&year=` | Recherche pour la correction manuelle |
| POST | `/api/movies/:id/match` | Associer un film à un identifiant TMDB |
| POST | `/api/library/scan` · GET `/api/library/status` | Relancer un scan / état |
| GET | `/api/subtitles/:id.vtt` | Sous-titre en WebVTT |
| GET | `/api/subtitles/orphans` · POST `/api/subtitles/:id/assign` | Sous-titres sans film / rattachement manuel |
| GET/PUT | `/api/settings` | Réglages |
| GET | `/images/{base}-{largeur}.webp` | Images en cache |
