---
name: nouveaux-films
description: Quand Maxence ajoute des films dans son dossier (C:\DOCUMENTS\Movies & Shows) et tape /nouveaux-films, ou dit « j'ai ajouté des films », « nouveaux films », « mets à jour le site ». Prépare tout pour la Cinémathèque (sous-titres zippés, scan, fiches Wikipédia), vérifie chaque film, corrige les mauvaises fiches et rend un bilan court.
---

# Nouveaux films → Cinémathèque

Le serveur surveille déjà le dossier : un film copié apparaît seul. Ce skill fait le reste et vérifie.
Tout se fait avec `scripts/nouveaux-films.mjs` (à la racine du dépôt C:\DOCUMENTS\Claude\Cinematheque).
Répondre en français, court.

## 1. Le serveur tourne ?

```bash
curl -s -m 3 http://127.0.0.1:8765/api/health
```

Sinon, le lancer comme un double-clic (avec l'outil PowerShell, pas Bash : un process lancé depuis Bash meurt à la fin de la commande) :

```powershell
& explorer.exe (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Cinémathèque.lnk')
```

puis attendre que `/api/health` réponde (quelques secondes ; une minute si l'interface se reconstruit).

## 2. Préparer et scanner

```bash
node scripts/nouveaux-films.mjs
```

- extrait les sous-titres livrés en `.zip` dans `Subtitles\`, puis range les .zip dans `Subtitles\Archives\`
  (déplacés, jamais supprimés ; un .zip sans sous-titres reste où il est) ;
- lance un scan et attend la fin : analyse ffprobe, photogrammes, fiches Wikipédia ;
- affiche le bilan : nouveaux films depuis le dernier bilan, problèmes, sous-titres sans film.

Les fiches Wikipédia prennent ~40 s par film (Wikimédia limite le débit). Au-delà de 2 nouveaux films,
lancer la commande en arrière-plan et attendre sa fin plutôt que de couper.

## 3. Corriger ce que le bilan signale

| Signalé | Faire |
|---|---|
| `fiche introuvable`, `année … ≠ fichier`, ou titre / affiche visiblement d'un autre film | `node scripts/nouveaux-films.mjs --chercher "Titre année"` puis `node scripts/nouveaux-films.mjs --corriger <id> <Q…>` avec le bon film (réalisateur et année dans la description). |
| `sans affiche` alors que la fiche est juste | Pas d'affiche sur Wikipédia anglais : le signaler, le photogramme du film sert de visuel. |
| `sans synopsis` | Vérifier que c'est le bon film ; sinon corriger comme ci-dessus. Sinon le signaler. |
| `pas de sous-titres français` | Si un sous-titre de la liste « sans film » correspond (même titre, même année) : `curl -s -X POST -H "content-type: application/json" -d '{"movieId": <id>}' http://127.0.0.1:8765/api/subtitles/<id-sous-titre>/assign` (les ids : `curl -s http://127.0.0.1:8765/api/subtitles/orphans`). Sinon le signaler, ne rien télécharger sans demander. |
| Sous-titre d'un autre film (ex. `The.Thing.2011` pour `The Thing 1982`) | Le laisser orphelin. |

Ne jamais renommer ni supprimer les fichiers de films ou de sous-titres de Maxence. Seul déplacement prévu :
les .zip vers `Subtitles\Archives\` (fait par le script). Un film rangé ailleurs (ex. une vidéo dans `Subtitles\`) :
le signaler et proposer de le remettre à la racine ; le serveur retrouve un film déplacé (même taille), son historique est conservé.
Le titre affiché est toujours celui du nom de fichier (pas de traduction) : ne pas le « corriger ».

## 4. Vérifier puis rendre compte

- `node scripts/nouveaux-films.mjs --bilan` : plus rien à regarder (ou seulement ce qu'on ne peut pas régler).
- Si le navigateur intégré est disponible : ouvrir http://localhost:8765/bibliotheque et regarder les nouvelles affiches.

Bilan à Maxence, en quelques lignes : les films ajoutés (titre, année), ce qui a été corrigé, ce qui reste
(sans affiche, sans sous-titres français), et rappeler qu'ils sont visibles sur le téléphone à
https://pcmaxouw.tail46de67.ts.net.
