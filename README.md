# mnt_visu — Visualiseur de MNT IGN (PWA)

Application web progressive (PWA) pour visualiser le **modèle numérique de terrain (MNT) LiDAR HD de l'IGN** sur une carte Leaflet, avec trois rendus commutables, des réglages d'affichage en direct et un **export hors-ligne** (GeoPackage ou MBTiles) utilisable sur le terrain.

- 100 % statique, sans backend, sans clé d'API : déployable tel quel sur GitHub Pages.
- Bibliothèques (Leaflet, sql.js) embarquées dans `vendor/` : l'application elle-même démarre hors-ligne. Les données MNT et les fonds de carte, eux, nécessitent le réseau (voir l'export pour le terrain).

---

## 1. Fonctionnalités

### Fonds de carte
| Choix | Service | Remarque |
|---|---|---|
| IGN BD ORTHO® | WMTS Géoplateforme `ORTHOIMAGERY.ORTHOPHOTOS` | `TILEMATRIXSET=PM_0_19` (obligatoire depuis la mise à jour IGN de mars 2025) |
| IGN Plan V2 | WMTS Géoplateforme `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` | `TILEMATRIXSET=PM` |
| OpenStreetMap | `tile.openstreetmap.org` | usage interactif uniquement |

### MNT (couche superposée)
Les altitudes brutes sont téléchargées par tuiles (WMS-R Géoplateforme, format `image/x-bil;bits=32`, flottants 32 bits) puis **dessinées localement sur canvas**. Changer de rendu ou de réglage ne redéclenche donc aucun téléchargement.

| Rendu | Description |
|---|---|
| **Gris** | Dégradé de gris continu en fonction de l'altitude (noir = bas, blanc = haut). |
| **Ombrage** | Hillshade (méthode de Horn) : simulation d'éclairage du relief. Soleil à 45° de hauteur ; azimut et exagération verticale réglables. |
| **Hypsométrie** | Teintes altimétriques : vert, jaune, brun, blanc. |

Pour **Gris** et **Hypsométrie**, l'échelle d'altitude est calculée automatiquement sur la vue courante (percentiles 2 % à 98 %, ce qui évite qu'un pixel aberrant écrase le contraste). Une légende affiche les altitudes min/max.

### Réglages en direct
- **Opacité** (0–100 %) : pour superposer le MNT à l'orthophoto ou au plan IGN.
- **Contraste** et **Luminosité** (40–250 %) : appliqués par filtre CSS sur la couche MNT, donc instantanés.
- **Azimut du soleil** (0–359°) et **Exagération verticale** (×1 à ×10) : visibles uniquement en mode Ombrage.
- Bouton **Réinitialiser les réglages**.
- Les réglages et la dernière vue sont mémorisés (`localStorage`, clés `mnt_visu.*`).

### Sources d'altitude
| Source | Couche WMS-R | Usage |
|---|---|---|
| **MNT LiDAR HD (IGN)** — défaut | `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93` | Résolution 0,5 m, là où le LiDAR HD est disponible. |
| RGE ALTI® 1 m | `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` | Couverture plus complète, utile de secours. |

### Lecture d'altitude
Un clic sur la carte affiche l'altitude (en mètres, 2 décimales) et les coordonnées du point.

### Export hors-ligne
Voir la section 3.

---

## 2. Utilisation

1. Ouvrir l'application ; le bouton ☰ (en haut à gauche) affiche ou masque le panneau.
2. Choisir le **fond de carte**.
3. Cocher **MNT IGN**, choisir la **source** et le **rendu**.
4. Régler opacité, contraste, luminosité (et azimut/exagération en ombrage).
5. Zoomer au moins au **niveau 9** : en dessous, le MNT n'est pas affiché (un message l'indique). Le meilleur compromis détail/vitesse se situe généralement entre les niveaux 14 et 18.

Messages de la ligne d'état :
- « Chargement du MNT… » : tuiles en cours de téléchargement.
- « MNT indisponible sur une partie de la vue… » : zone hors couverture, erreur réseau ou couche absente.

---

## 3. Export hors-ligne (GeoPackage / MBTiles)

Le panneau **Export hors-ligne** enregistre la vue affichée sous forme de tuiles PNG 256 × 256 en **EPSG:3857**, avec le rendu courant (rendu, contraste, luminosité) figé dans les pixels.

### Procédure
1. Cadrer la zone voulue et régler le rendu.
2. Choisir le **zoom min** et le **zoom max** (par défaut : zoom courant et suivant).
3. Choisir le **format** et, si besoin, cocher « Intégrer l'opacité dans les tuiles ».
4. Cliquer sur **Exporter la vue affichée**. Une barre de progression apparaît, avec un bouton **Annuler**. Le fichier est téléchargé à la fin.

Nom du fichier : `mnt_visu_<rendu>_<source>_z<min>-<max>_<date>.gpkg` (ou `.mbtiles`).

### Ce qu'il faut savoir
- **Emprise** : celle de la carte à l'écran, sur chaque niveau de zoom demandé.
- **Poids du téléchargement** : environ 270 Ko par tuile (altitudes brutes). L'appli annonce le nombre de tuiles et le volume estimé, et **limite l'export à 1 500 tuiles**. Pour une grande zone, faire plusieurs exports ou réduire le zoom max.
- **Échelle** : en Gris et Hypsométrie, l'échelle d'altitude de la vue est utilisée pour **toutes** les tuiles, ce qui garantit des raccords homogènes.
- **Opacité** : non intégrée par défaut (à régler dans le logiciel de terrain).
- **Contenu** : MNT seul, sans fond de carte. Les tuiles entièrement hors couverture sont omises.
- **Mémoire** : le fichier est assemblé en mémoire du navigateur (convient pour quelques centaines de Mo).

### Formats
| Format | Structure | Ouverture |
|---|---|---|
| **GeoPackage** (`.gpkg`) | Table de tuiles `mnt_visu`, EPSG:3857, lignes de tuiles numérotées depuis le haut (norme OGC). | QGIS, QField (raster), outils GDAL. |
| **MBTiles** (`.mbtiles`) | Schéma TMS (ligne inversée), métadonnées `name`, `bounds`, `minzoom`, `maxzoom`, `format=png`. | QGIS et applications de randonnée compatibles MBTiles. |

### Tracer une limite de couche sur le terrain
1. Charger le `.gpkg` comme couche raster dans QGIS, puis créer un GeoPackage vecteur (lignes) pour les limites.
2. Transférer le projet sur le téléphone avec QField, et numériser la limite en se déplaçant, par-dessus le MNT.

---

## 4. Architecture

```
mnt_visu/
├── index.html          Interface (panneau de réglages, carte)
├── style.css           Styles
├── app.js              Carte, fonds, couche MNT (GridLayer canvas), réglages, enregistrement du SW
├── export.js           Export des tuiles → GeoPackage / MBTiles (via sql.js)
├── sw.js               Service worker « brise-cache »
├── manifest.json       Manifeste PWA
├── icon-192.png / icon-512.png
└── vendor/
    ├── leaflet/        Leaflet 1.9.4
    └── sqljs/          sql.js 1.12.0 (SQLite en WebAssembly)
```

Points techniques :
- **Tuiles MNT** : chaque tuile est demandée en 258 × 258 pixels (bordure de 1 px) pour que l'ombrage soit continu aux jonctions entre tuiles.
- **Cache de données** : les 400 dernières tuiles d'altitudes restent en mémoire pour changer de rendu sans retélécharger.
- **Hillshade** : taille de pixel corrigée de la latitude (projection Web Mercator), gradients de Horn sur 3 × 3 voisins.
- **Valeurs sans donnée** (≈ −99 999) : pixels transparents.

---

## 5. Service worker « brise-cache »

`sw.js` garantit qu'une ancienne version ne reste pas affichée après une mise à jour :

- Cache versionné explicitement : `CACHE_NAME = 'mnt_visu-cache-vN'`.
- À l'activation : purge de tous les caches dont le nom diffère de `CACHE_NAME`, puis `clients.claim()`. `skipWaiting()` est appelé à l'installation (activation immédiate).
- **Fichiers de l'application** (HTML, CSS, `app.js`, `export.js`, manifeste) : *network-first* avec `cache: 'no-cache'`, pour contourner le cache HTTP de GitHub Pages (≈ 10 min) ; repli sur le cache hors-ligne.
- **Fichiers stables** (Leaflet, sql.js, icônes) : *cache-first*.
- **Requêtes externes** (tuiles IGN/OSM, WMS) : non interceptées, elles passent directement au réseau.
- Côté page, l'enregistrement utilise `updateViaCache: 'none'` et la page se recharge automatiquement lorsqu'un nouveau service worker prend le contrôle.

---

## 6. Déploiement sur GitHub Pages

1. Créer un dépôt `mnt_visu` sur GitHub.
2. Y placer **le contenu** du dossier (`index.html` à la racine du dépôt), puis pousser sur `main`.
3. *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*.
4. L'application est publiée sur `https://<utilisateur>.github.io/mnt_visu/` (ici : `https://BernardHoyez.github.io/mnt_visu/`).

Tous les chemins sont relatifs : l'application fonctionne aussi dans un sous-dossier.

### Test en local
```bash
cd mnt_visu
python3 -m http.server 8000
# puis http://localhost:8000
```
Le service worker n'est actif que sur `https://` ou `localhost`.

---

## 7. Mise à jour (procédure brise-cache)

À chaque modification d'un fichier statique (HTML, CSS, JS, icônes, manifeste) :

1. Incrémenter `CACHE_NAME` dans `sw.js` (ex. `mnt_visu-cache-v3` → `mnt_visu-cache-v4`).
2. Incrémenter `APP_VERSION` dans `app.js` (affichée à côté du titre, pratique pour vérifier la version chargée).
3. Si un nouveau fichier est ajouté à l'application, l'ajouter à `APP_FILES` ou `STATIC_FILES` dans `sw.js`.
4. Pousser sur GitHub ; les clients se mettent à jour et se rechargent seuls à la visite suivante.

---

## 8. Dépannage

| Symptôme | Cause probable | Piste |
|---|---|---|
| Aucun MNT visible | Zoom < 9 | Zoomer. |
| « MNT indisponible… » | Zone sans LiDAR HD, ZICAD, réseau coupé | Basculer sur RGE ALTI® ; vérifier dans l'onglet *Réseau* du navigateur le statut HTTP des requêtes `wms-r`. |
| Orthophoto en erreur 404 | Mauvais `TILEMATRIXSET` | Utiliser `PM_0_19` pour `ORTHOIMAGERY.ORTHOPHOTOS`. |
| Ancienne version affichée | Cache | Vérifier que `CACHE_NAME` a bien été incrémenté ; recharger deux fois, ou *Application → Service Workers → Unregister* dans les outils de développement. |
| Export trop volumineux | > 1 500 tuiles | Réduire la zone ou le zoom max. |
| Export lent | ~270 Ko par tuile, 6 requêtes en parallèle | Normal ; l'export peut être annulé. |

---

## 9. Limites connues

- Couverture LiDAR HD partielle selon les départements et les dates de diffusion.
- Fonds de carte non inclus dans l'export (MNT seul).
- Pas de chargement de traces GPX/KML dans cette version : le tracé de limites se fait dans l'outil de terrain (QGIS/QField) à partir du fichier exporté.

---

## 10. Données, licences et attributions

- **Données altimétriques et fonds IGN** : © IGN, Licence Ouverte (Géoplateforme, `data.geopf.fr`).
- **OpenStreetMap** : © contributeurs OpenStreetMap (ODbL). Le service de tuiles public est destiné à un usage interactif modéré.
- **Leaflet** 1.9.4 : licence BSD-2-Clause.
- **sql.js** 1.12.0 : licence MIT.
