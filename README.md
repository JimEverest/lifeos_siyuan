# LifeOS Sync

Export-only sync from SiYuan to GitHub (markdown + assets). GitHub is treated as a read-only mirror for collaboration and tooling.

## Quick start (dev)
1) `npm install`
2) `npm run build` (outputs `index.js` in plugin root)
3) Load the plugin folder in SiYuan.

## Usage (MVP0)
- Top bar icon → menu → **Export current doc** (uses the active document in the editor).
- Configure via menu → **Configure...** (repo URL, branch, token, export root, assets dir, ignore lists, clean frontmatter, export all assets).

## Notes on GitHub 404 logs
- During export we first try to fetch the existing file SHA. If the file does not exist, GitHub returns 404; this is normal and does not block creation. The browser console may show these 404 GETs; the subsequent PUT will create/update the file.
- Assets are written under `assets/<filename>` (no double prefix).

## Notes
- Only pushes to GitHub; no pull/backsync implemented (reserved for later).
- Ignores: notebooks/paths/tags support `*` wildcard (e.g., `Test*`, `Folder/*`).
- Assets: by default export all assets under `data/assets` unless you disable it in settings.
