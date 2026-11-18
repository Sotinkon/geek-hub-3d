#!/usr/bin/env bash
# Installs Geek Hub 3D into ~/.geek-hub and adds the hub / anime3d / fetch-walls aliases.
# Idempotent: safe to run again to update. Nothing outside ~/.geek-hub and ~/.bashrc is touched.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
DEST="$HOME/.geek-hub"

for cmd in python3 flock setsid; do
    command -v "$cmd" >/dev/null || { echo "Prérequis manquant : $cmd" >&2; exit 1; }
done
python3 -I -c 'import PIL' 2>/dev/null || echo "⚠  Pillow absent : sudo apt install python3-pil (miniatures)"
command -v google-chrome >/dev/null || command -v chromium >/dev/null || command -v chromium-browser >/dev/null \
    || command -v brave-browser >/dev/null || echo "⚠  Aucun navigateur Chromium trouvé (Chrome/Chromium/Brave) pour le mode --app"

mkdir -p "$DEST/bin"
install -m 644 "$SRC"/web/{index.html,style.css,app.js,files.js} "$DEST/"
install -m 755 "$SRC"/bin/{hub,geek-hub.py,fetch-walls} "$DEST/bin/"
echo "✓ fichiers installés dans $DEST"

MARK='# Geek Hub 3D (hub / anime3d / fetch-walls)'
if ! grep -qF "$MARK" "$HOME/.bashrc" 2>/dev/null && ! grep -q "geek-hub/bin/hub" "$HOME/.bashrc" 2>/dev/null; then
    cp "$HOME/.bashrc" "$HOME/.bashrc.backup_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
    cat >> "$HOME/.bashrc" <<'RC'

# Geek Hub 3D (hub / anime3d / fetch-walls)
if [ -x ~/.geek-hub/bin/hub ]; then
    alias hub='~/.geek-hub/bin/hub'
    alias anime3d='~/.geek-hub/bin/hub'
    alias fetch-walls='~/.geek-hub/bin/fetch-walls'
fi
RC
    echo "✓ alias ajoutés à ~/.bashrc (sauvegarde créée)"
else
    echo "• alias déjà présents dans ~/.bashrc"
fi
echo "→ ouvre un nouveau terminal (ou: source ~/.bashrc), puis: hub   ou   hub 2"
