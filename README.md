# Cinémathèque

Plateforme de streaming personnelle pour une collection de films numérisés (`.mkv`, `.mp4`, `.avi` + sous-titres `.srt`/`.ass`).

> **État : phases 1 à 3 terminées** (bibliothèque, API, moteur de lecture, système de dessin). Métadonnées TMDB codées, en attente de la clé. Nuancier : http://localhost:8765/design · banc d'essai de lecture : http://localhost:8765/dev/player

## Organisation

```
server/   API Fastify + TypeScript : scan, ffprobe/ffmpeg, TMDB, SQLite
web/      Interface React + Vite + Motion (système de dessin, puis écrans)
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
npm run build        # construit l'interface (web/dist), servie ensuite par le serveur
npm run dev:web      # interface en développement sur http://localhost:5173 (API relayée vers :8765)
npm run shots -- /design dossier prefixe   # captures 1440 / 390 / 1920 px (Playwright)
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

## Système de dessin (phase 3)

Démonstration complète : **`/design`** (le « nuancier »), composée avec les vrais films de la collection.

- **Tokens** : `web/src/styles/tokens.css`. Couleurs (noir chaud `#0D0B09`, surfaces `#16130F` / `#1F1B16`, ivoire / pierre / cendre, velours `#B3261E` réservé à l'action principale, `--film-accent` redéfini par film), échelle typographique marquée, espacements, durées (420 / 560 / 700 ms) et courbes.
- **Caractères** auto-hébergés : Instrument Serif (titres), Geist (texte), Geist Mono en petites capitales espacées (données). Icônes Phosphor au trait fin.
- **Contraste** : ivoire 14,9:1, pierre 7,0:1 sur le fond ; la cendre (3,3:1) est réservée au grand texte et au décor ; l'accent de film est toujours ≥ 4,5:1.
- **Composants** (`web/src/components`) : boutons (Projeter, secondaire, discret), boutons d'icône, sélecteur segmenté, interrupteur, curseur, champ de recherche, note, progression, badges, fiche technique mono à pointillés, nuancier, affiche 2:3 (avec affiche typographique de repli sur photogramme), image WebP + blurhash, Ken Burns, titre révélé ligne à ligne, cache letterbox, fuites de lumière, amorce 3-2-1, états vide / erreur / chargement, message passager.
- **Textures** : grain animé (désactivable : `html[data-grain="off"]`), vignettage. Tout mouvement s'efface avec `prefers-reduced-motion`.
- **Photogrammes** : pour chaque film, le serveur extrait en tâche de fond l'image la plus parlante parmi quatre (bandes noires retirées, HDR converti) ; elle sert de fond et de palette tant que TMDB n'a rien fourni.

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
