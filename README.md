# Cinémathèque

Plateforme de streaming personnelle pour une collection de films numérisés (`.mkv`, `.mp4`, `.avi` + sous-titres `.srt`/`.ass`).

> **État : phases 1 à 6 terminées** (bibliothèque, lecture, système de dessin, écrans, mobile / TV / PWA, lancement et accès distant). Métadonnées TMDB codées, en attente de la clé (à coller dans Réglages). Nuancier : http://localhost:8765/design · banc d'essai de lecture : http://localhost:8765/dev/player

## Lancer depuis git

```bash
git clone https://github.com/maxencedebonopu/cinetech-.git Cinematheque
cd Cinematheque
start.bat
```

`start.bat` (double-clic possible) prépare puis lance le serveur sur http://localhost:8765 :

1. **Mise à jour** : `git pull` en avance rapide, sauté si des fichiers suivis sont modifiés localement ou hors ligne (`start.bat --sans-maj` pour ne jamais mettre à jour).
2. **Dépendances** : `npm install` au premier lancement, puis seulement quand `package-lock.json` change.
3. **Configuration** : `.env` créé depuis `.env.example` s'il manque (renseigner `LIBRARY_DIRS` et `TMDB_KEY`).
4. **Interface** : reconstruite seulement quand `web/` ou `shared/` change.

Premier lancement ≈ 1 min, les suivants quelques secondes. Prérequis : Node.js 22+ et ffmpeg (voir plus bas).

Une fois prêt, le serveur **ouvre le navigateur** sur la Cinémathèque. Relancer `start.bat` alors qu'il tourne déjà ouvre simplement le navigateur, sans second serveur. `start.bat --sans-navigateur` lance le serveur sans rien ouvrir.

## Lancer d'un double-clic, et au démarrage de Windows

Double-cliquer une fois sur **`raccourcis.bat`** :

1. **Bureau + démarrage automatique** : un raccourci « Cinémathèque » (icône de bobine) sur le Bureau, et le serveur qui se lance seul à l'ouverture de session Windows (fenêtre réduite, sans ouvrir le navigateur) ;
2. **Bureau seulement** ;
3. **Retirer les raccourcis**.

Ensuite : double-clic sur « Cinémathèque » sur le Bureau. Le serveur tourne dans la fenêtre réduite de la barre des tâches ; la fermer arrête le serveur. Sans `.bat` : `node scripts/raccourcis.mjs` (`--sans-demarrage`, `--retirer`). Les raccourcis pointent vers ce dossier : à refaire si le dossier est déplacé. Le démarrage automatique est un simple raccourci dans le dossier Démarrage de Windows (`Win + R` → `shell:startup`), sans droits administrateur.

## Accès à distance : Tailscale et mot de passe

Le serveur n'est jamais exposé sur Internet : les appareils se rejoignent par **Tailscale**, un réseau privé chiffré entre vos appareils, sans ouvrir de port sur la box.

**1. Tailscale sur le PC et les appareils**

- PC : `winget install Tailscale.Tailscale`, puis se connecter (icône dans la zone de notification).
- Téléphone, tablette, téléviseur Android : application Tailscale, même compte.
- Console d'administration (login.tailscale.com) → **DNS** : activer **MagicDNS** et **HTTPS Certificates**.

**2. Adresse HTTPS** (nécessaire pour installer l'application et pour le mode hors ligne), dans un terminal sur le PC :

```bash
tailscale serve --bg 8765
```

La Cinémathèque répond alors sur `https://<nom-du-pc>.<votre-réseau>.ts.net` (l'adresse exacte s'affiche, et `tailscale serve status` la redonne). Le réglage survit aux redémarrages ; `tailscale serve reset` l'arrête. Visible seulement par les appareils de votre réseau Tailscale, jamais publiquement (ne pas utiliser `tailscale funnel`).

**3. Mot de passe** : sur le PC, **Réglages → Accès distant** → choisir un mot de passe (6 caractères ou plus). Il est enregistré haché dans la base ; le `.env` peut aussi en fournir un (`MOT_DE_PASSE`), utilisé seulement si aucun n'est défini dans Réglages.

**Règles**

- Le PC lui-même (`http://localhost:8765`) n'a jamais besoin du mot de passe.
- Tout autre appareil (adresse Tailscale, `http://100.x.y.z:8765`, réseau local) arrive sur la page « Séance privée ». Le mot de passe ouvre une séance d'un an sur cet appareil (cookie `HttpOnly`).
- **Sans mot de passe défini, l'accès distant est fermé.**
- Après 5 essais ratés, l'appareil attend 1 min, puis 2, 4… Changer le mot de passe déconnecte tous les autres appareils ; « Tout déconnecter » aussi. Le retirer n'est possible que depuis le PC.
- Seules les données sont gardées (API, affiches, flux) ; l'interface elle-même est publique pour pouvoir afficher la page de connexion.

**Sur l'appareil** : ouvrir l'adresse `https://…ts.net`, entrer le mot de passe, puis « Ajouter à l'écran d'accueil » (téléphone) ; sur un téléviseur, le navigateur passe seul en mode TV.

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
| `TMDB_KEY` | Clé TMDB v3 ou jeton v4 (themoviedb.org → Paramètres → API). Plus simple : la coller dans Réglages, qui passe avant le .env |
| `TMDB_LANGUAGE` | Langue des fiches (défaut `fr-FR`) |
| `MOT_DE_PASSE` | Mot de passe de l'accès distant, si aucun n'est défini dans Réglages → Accès distant |
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

## Écrans (phase 4)

- **Accueil** `/` : film à l'affiche, reprise, nouveautés, séance du soir, décennie, roulette, jamais vus.
- **Fiche film** `/film/:id` : palette du film, générique, fiche technique, pistes, correction TMDB, films voisins.
- **Bibliothèque** `/bibliotheque` : affiches, planche-contact, chronologie ; filtres dans l'adresse.
- **Lecteur** `/lecture/:id` : rideau et amorce, chapitres, vignettes, sous-titres réglables, raccourcis.
- **Recherche** : `Ctrl K` ou `/` partout (sauf en projection), titres, cinéastes, années, fautes de frappe.
- **Statistiques** `/statistiques` (« Le registre ») : temps, séances, films, plus longue série ; registre jour par jour ; heure et jour préférés ; films les plus revus et journal des séances ; décennies, genres, cinéastes ; état de la collection (définition, image, son, sous-titres, records) ; notes. Par année ou depuis le début (`?annee=2026`). Une séance de moins d'une minute ne compte pas.
- **Réglages** `/reglages` (« La cabine ») : dossiers (vérifiés avant ajout, rescan avec progression), clé TMDB (vérifiée auprès de TMDB, stockée dans la base locale, jamais réaffichée : seuls ses 4 derniers caractères), langue des fiches, films à corriger, langue audio (VO par défaut) et sous-titres préférés, qualité à distance, amorce, grain, sous-titres orphelins à rattacher (film proposé si titre et année concordent), état du système.

## Mobile, téléviseur, application installable (phase 5)

- **Application installable (PWA)** : manifeste, icônes (régénérées par `node scripts/icons.mjs` dans `web/`), service worker généré au build avec la liste des fichiers. Sur téléphone : « Ajouter à l'écran d'accueil ». Le service worker exige **HTTPS ou localhost** : à distance, passer par l'adresse HTTPS de Tailscale (phase 6).
- **Hors ligne** : l'interface, les affiches déjà vues et la dernière copie du catalogue restent disponibles ; un bandeau l'indique. La projection attend le réseau. Jamais mis en cache : flux vidéo, sous-titres, le reste de l'API.
- **Cache HTTP** : fichiers à empreinte (`/assets`) gardés un an ; `index.html`, `sw.js`, manifeste toujours revalidés (une mise à jour arrive au rechargement suivant).
- **Téléviseur** : détecté automatiquement (Tizen, webOS, Android TV, Fire TV…) ou forcé dans Réglages → Salle, ou avec `?tv=1` (`?tv=0` pour revenir). Interface agrandie et marges d'overscan, sans grain, focus large ; **navigation aux flèches** vers l'élément le plus proche dans la direction, l'élément choisi vient au milieu de l'écran ; OK ouvre, Retour revient (touches retour Samsung 10009 et LG 461 comprises). Le lecteur garde ses touches (voir « ? »).
- **Mobile** : zones sûres (encoche, barre d'accueil), pas de surbrillance ni de zoom au double tap, plein écran du lecteur en paysage (Android ; l'iPhone utilise son lecteur plein écran).
- Vérifications : `node scripts/pwa-check.mjs`, `node scripts/tv-check.mjs <prefixe>` (dans `web/`).

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
| GET · PUT · DELETE | `/api/tmdb/key` | État de la clé (provenance, 4 derniers caractères) / vérification et enregistrement / retrait |
| POST | `/api/library/check-dir` | Le dossier existe-t-il sur le serveur ? |
| GET | `/api/auth` | Accès distant : appareil local ?, mot de passe défini ?, connecté ? |
| POST | `/api/auth/connexion` · `/api/auth/deconnexion` | Ouvre / ferme la séance de l'appareil (cookie d'un an) |
| PUT · DELETE | `/api/auth/mot-de-passe` | Définit ou change (à distance : mot de passe actuel requis) / retire (depuis le PC seulement) |
| POST | `/api/auth/fermer-seances` | Déconnecte tous les appareils |
| GET | `/api/stats?annee=` | Statistiques : registre des séances (année ou tout) et collection |
| POST | `/api/playback/start` | Plan de lecture (direct / remux / transcodage) pour un film, une position, une piste audio, une qualité |
| GET | `/api/hls/:session/index.m3u8` · `init.mp4` · `segNNNNN.m4s` | Flux HLS |
| GET | `/api/movies/:id/file` | Lecture directe (Range) |
| POST | `/api/playback/ping` · `/api/playback/stop` | Progression (toutes les 5 s) / fin de séance |
| GET | `/api/movies/:id/trickplay` · `/trickplay/sheetNNN.jpg` | Vignettes de survol |
| GET | `/images/{base}-{largeur}.webp` | Images en cache |
