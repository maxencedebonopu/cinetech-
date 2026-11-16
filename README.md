# Cinémathèque

Plateforme de streaming personnelle pour une collection de films numérisés (`.mkv`, `.mp4`, `.avi` + sous-titres `.srt`/`.ass`).

> **État : phases 1 et 2 terminées** (bibliothèque, API, moteur de lecture). Métadonnées TMDB codées, en attente de la clé. Interface : phase 3. Banc d'essai de lecture : http://localhost:8765/dev/player

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

## Lecture vidéo

Le navigateur annonce ce qu'il sait décoder (`MediaSource.isTypeSupported`) ; le serveur choisit pour chaque séance :

1. **Direct** : MP4 avec vidéo et audio lisibles (ex. Chungking Express). Le fichier est servi tel quel, avec saut par plages d'octets.
2. **Remux HLS** (cas le plus fréquent) : vidéo copiée sans réencodage (H.264, HEVC, AV1), audio converti en AAC 5.1 ou stéréo (DTS, E-AC3, AC3, Opus…), segments fMP4 de 4 s. Démarrage ≈ 1 à 2 s.
3. **Transcodage H.264** : codec non lisible (AVI MPEG-4), HDR10 / Dolby Vision sur écran SDR (conversion sur le GPU via OpenCL, sinon CPU), sous-titres image à incruster, ou débit limité (8 / 4 Mb/s) pour l'accès distant. Encodage matériel détecté au démarrage (AMF, NVENC, QSV), sinon libx264 `veryfast`. Démarrage ≈ 2 à 3 s.

**Saut dans le film** : dans la partie déjà préparée, le saut est instantané ; au-delà, ffmpeg est relancé au bon endroit (image-clé précédente pour le remux). Temps du film = `offset` du plan + `video.currentTime`.

**Sous-titres image** (PGS Blu-ray, VobSub DVD) : incrustés pendant le transcodage. Pour un Blu-ray recadré (1920×800), le cadre d'origine 1920×1080 est restitué pour que les sous-titres placés dans la bande noire restent visibles.

**Sobriété** : ffmpeg lit au plus à 4× le temps réel après 60 s d'avance ; les segments de plus de 5 min derrière la tête de lecture sont supprimés ; une séance sans nouvelles depuis 60 s est arrêtée. Le dossier `data/transcode` est vidé à l'arrêt et au démarrage, et les ffmpeg orphelins (fenêtre fermée brutalement) sont arrêtés au lancement suivant.

**Vignettes de survol** : planches JPEG 10×10 (une image toutes les 10 s), calculées en tâche de fond à basse priorité, en pause pendant une séance.

**Progression** : position enregistrée toutes les 5 s, « vu » à 90 % (la position repart alors de zéro), compteur de visionnages et temps regardé (statistiques).

## API (phases 1 et 2)

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
| POST | `/api/playback/start` | Plan de lecture (direct / remux / transcodage) pour un film, une position, une piste audio, une qualité |
| GET | `/api/hls/:session/index.m3u8` · `init.mp4` · `segNNNNN.m4s` | Flux HLS |
| GET | `/api/movies/:id/file` | Lecture directe (Range) |
| POST | `/api/playback/ping` · `/api/playback/stop` | Progression (toutes les 5 s) / fin de séance |
| GET | `/api/movies/:id/trickplay` · `/trickplay/sheetNNN.jpg` | Vignettes de survol |
| GET | `/images/{base}-{largeur}.webp` | Images en cache |
