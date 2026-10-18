# mnt_visu
PWA Leaflet : fonds OSM / IGN Plan V2 / IGN BD ORTHO® + MNT IGN (gris, ombrage, hypsométrie), opacité, contraste, luminosité.
## Déploiement GitHub Pages
1. Créer le dépôt `mnt_visu`, y pousser le contenu de ce dossier à la racine.
2. Settings → Pages → Deploy from branch → `main` / root.
3. URL : https://BernardHoyez.github.io/mnt_visu/
## Mise à jour
À chaque modification d'un fichier statique, incrémenter `CACHE_NAME` dans `sw.js` (`mnt_visu-cache-vN`) et `APP_VERSION` dans `app.js`.
