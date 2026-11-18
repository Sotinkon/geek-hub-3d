#!/usr/bin/env python3
"""Shinobi Geek Hub launcher — two modes, same 3D front-end (index.html / app.js).

  geek-hub.py                 gallery mode: wallpapers of ~/Downloads/Wallpaper as 3D cards
  geek-hub.py --files DIR     files mode: the files/folders of DIR as 3D cards, browsable
  geek-hub.py --build-only    only refresh gallery thumbnails + gallery.json

1. Serves ONLY the hub files on 127.0.0.1 (random free port).
2. Files mode adds a small JSON API (list / tree / preview / thumb / open). Every API call
   needs the random per-session token (custom header → no cross-site request can use it),
   the Host header must be our 127.0.0.1:port (no DNS rebinding), and every path must
   resolve inside the browsing scope ($HOME, or DIR itself when DIR is outside $HOME).
3. Opens a toolbar-less browser window (--app) with a DEDICATED profile under
   ~/.cache/geek-hub — the user's real browser profiles are never touched.
4. When that window closes, the server stops: nothing stays in memory.
"""
import fcntl
import hashlib
import http.server
import io
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HOME = Path.home()
HUB = HOME / ".geek-hub"
THUMBS = HUB / "thumbs"
WALLS = Path(os.environ.get("GEEK_HUB_WALLS", HOME / "Downloads" / "Wallpaper"))
CACHE = HOME / ".cache" / "geek-hub"

# ══════════════════════════════════════════════════════════════════════════════
#  Gallery mode
# ══════════════════════════════════════════════════════════════════════════════
THUMB_MAX = 640          # px, longest side: plenty for a 3D card, tiny for the GPU
MAX_CARDS = 72
MAX_SRC_BYTES = 60 * 1024 * 1024
EXTS = {".jpg", ".jpeg", ".png", ".webp"}

ANIME = re.compile(r"luffy|naruto|goku|tanjiro|zenitsu|demon.slayer|ichigo|bleach|black.clover|"
                   r"dandadan|my.hero|aang|one.?piece|gear.?5|akatsuki|rimuru|slime|tensura|"
                   r"eminence|shadow.garden|cid|kagenou|kurama|sage|dragon.?ball|joyboy", re.I)
GAMING = re.compile(r"call.of.duty|cod|warzone|ghost|pubg|gta|grand.theft|free.fire|mortal|"
                    r"scorpion|liu.kang", re.I)
TECH = re.compile(r"neural|brain.3d|cyber|matrix|robot|windows|iron.man|\bai\b|artificial", re.I)
# Sub-folders of the gallery that are anime by definition (Pinterest-style dumps).
ANIME_DIRS = [WALLS / "dashboard" / "Anime"]
FOLDER_TITLES = {"onepiece": "One Piece", "dragon_ball": "Dragon Ball", "naruto": "Naruto",
                 "bleach": "Bleach"}


def title_of(path: Path, base: Path) -> str:
    stem = re.sub(r"-\d{3,5}x\d{3,5}(-\d+)?$", "", path.stem)
    stem = re.sub(r"-wallhaven-[a-z0-9]+$", "", stem)            # fetch-walls -s names
    stem = re.sub(r"[_\-\s]+", " ", stem).strip()
    if not re.search(r"[A-Za-z]{3}", stem):          # numeric Pinterest names
        rel = path.relative_to(base).parts
        folder = rel[-2] if len(rel) > 1 else "Anime"
        stem = FOLDER_TITLES.get(folder.lower(), folder.replace("_", " ").title())
    return stem[:1].upper() + stem[1:60]


def category(path: Path) -> str | None:
    name = path.name
    if any(d in path.parents for d in ANIME_DIRS):
        return "anime"
    if ANIME.search(name):
        return "anime"
    if GAMING.search(name):
        return "gaming"
    if TECH.search(name):
        return "ai"
    return None


def candidates():
    seen = []
    for p in sorted(WALLS.glob("*")):
        if p.is_file() and p.suffix.lower() in EXTS:
            seen.append(p)
    for d in ANIME_DIRS:
        if d.is_dir():
            seen += sorted(p for p in d.rglob("*") if p.is_file() and p.suffix.lower() in EXTS)
    return seen


def build_gallery() -> int:
    from PIL import Image  # Pillow is already used by the manga-term layer

    Image.MAX_IMAGE_PIXELS = 80_000_000
    THUMBS.mkdir(parents=True, exist_ok=True)
    items, keep = [], set()
    counts = {"anime": 0, "gaming": 0, "ai": 0}
    for src in candidates():
        cat = category(src)
        if not cat or len(items) >= MAX_CARDS:
            continue
        try:
            if src.stat().st_size > MAX_SRC_BYTES:
                continue
            key = hashlib.sha1(str(src.relative_to(WALLS)).encode()).hexdigest()[:20]
            dst = THUMBS / f"{key}.jpg"
            if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
                with Image.open(src) as im:
                    im.draft("RGB", (THUMB_MAX * 2, THUMB_MAX * 2))
                    im = im.convert("RGB")
                    im.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
                    tmp = dst.with_suffix(".tmp")
                    im.save(tmp, "JPEG", quality=84, optimize=True, progressive=True)
                    tmp.replace(dst)
            with Image.open(dst) as th:
                w, h = th.size
        except Exception as exc:  # unreadable / corrupt image: skip it, never crash the hub
            print(f"skip {src.name}: {exc}", file=sys.stderr)
            continue
        keep.add(dst.name)
        counts[cat] += 1
        items.append({"title": title_of(src, WALLS), "cat": cat,
                      "src": f"thumbs/{dst.name}", "w": w, "h": h})
    for old in THUMBS.glob("*"):
        if old.name not in keep:
            old.unlink(missing_ok=True)
    tmp = HUB / "gallery.json.tmp"
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1))
    tmp.replace(HUB / "gallery.json")
    print(f"gallery: {len(items)} cartes ({counts['anime']} animé, {counts['gaming']} gaming, "
          f"{counts['ai']} tech)", flush=True)
    return len(items)


# ══════════════════════════════════════════════════════════════════════════════
#  Files mode: read-only browsing API + "open" actions
# ══════════════════════════════════════════════════════════════════════════════
MAX_ENTRIES = 200            # cards per folder
TREE_PER_DIR = 40
PREVIEW_BYTES = 48 * 1024
FTHUMB_MAX = 320
EXT_KIND = {}
for _kind, _exts in {
    "code": "py js mjs cjs ts tsx jsx c h cpp hpp cc hh rs go java kt sh bash zsh fish rb php "
            "html htm css scss sass less json jsonc yml yaml toml xml sql lua cs swift vue svelte "
            "ini conf cfg cmake mk ipynb gradle dart r pl hs ex exs nix env",
    "media": "png jpg jpeg gif webp svg bmp ico tif tiff avif heic mp4 mkv webm avi mov "
             "mp3 wav flac ogg m4a opus aac",
    "doc": "md markdown txt rst pdf doc docx odt xls xlsx ods ppt pptx odp csv tsv rtf tex log epub",
    "archive": "zip tar gz tgz xz bz2 zst 7z rar deb rpm appimage iso jar whl snap",
}.items():
    for _e in _exts.split():
        EXT_KIND[_e] = _kind
CODE_NAMES = {"makefile", "dockerfile", "cmakelists.txt", "gemfile", "rakefile", "justfile",
              ".gitignore", ".bashrc", ".zshrc", ".profile", ".editorconfig"}
IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "avif"}
# Never handed to xdg-open: these can execute code when "opened".
NEVER_OPEN = {"desktop", "appimage", "run", "bin", "exe", "msi", "so", "jar", "deb", "rpm", "snap"}


def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name.lstrip(".") else ""


def kind_of(name: str, is_dir: bool) -> str:
    if is_dir:
        return "dir"
    if name.lower() in CODE_NAMES:
        return "code"
    return EXT_KIND.get(ext_of(name), "other")


def is_text(head: bytes) -> bool:
    return b"\x00" not in head


class FilesAPI:
    def __init__(self, start: Path):
        self.start = start
        self.scope = HOME if (start == HOME or HOME in start.parents) else start

    def resolve(self, raw: str | None) -> Path:
        """Absolute path inside the scope, or PermissionError/FileNotFoundError."""
        p = Path(raw or str(self.start)).expanduser()
        if not p.is_absolute():
            raise PermissionError("chemin relatif refusé")
        rp = p.resolve(strict=True)
        if rp != self.scope and self.scope not in rp.parents:
            raise PermissionError("hors du périmètre autorisé")
        return rp

    def label(self, p: Path) -> str:
        if p == HOME or HOME in p.parents:
            rel = p.relative_to(HOME)
            return "~" if str(rel) == "." else f"~/{rel}"
        return str(p)

    def crumbs(self, p: Path):
        chain = [p] + [q for q in p.parents if q == self.scope or self.scope in q.parents]
        out = []
        for q in reversed(chain):
            out.append({"name": "~" if q == HOME else (q.name or "/"), "path": str(q)})
        return out

    @staticmethod
    def entries(d: Path, hidden: bool, limit: int):
        items = []
        with os.scandir(d) as it:
            for e in it:
                if not hidden and e.name.startswith("."):
                    continue
                items.append(e)
        items.sort(key=lambda e: (not e.is_dir(follow_symlinks=True), e.name.lower()))
        return items[:limit], max(0, len(items) - limit)

    def list(self, q):
        d = self.resolve(q.get("path"))
        if not d.is_dir():
            raise NotADirectoryError(str(d))
        hidden = q.get("hidden") == "1"
        items, more = self.entries(d, hidden, MAX_ENTRIES)
        out = []
        for e in items:
            try:
                is_dir = e.is_dir(follow_symlinks=True)
                st = e.stat(follow_symlinks=True)
            except OSError:
                continue
            ent = {"name": e.name, "path": os.path.join(d, e.name), "kind": kind_of(e.name, is_dir),
                   "ext": ext_of(e.name), "dir": is_dir, "link": e.is_symlink(),
                   "size": None if is_dir else st.st_size, "mtime": int(st.st_mtime)}
            if is_dir:
                try:
                    with os.scandir(e.path) as sub:
                        n = 0
                        for s in sub:
                            if hidden or not s.name.startswith("."):
                                n += 1
                                if n >= 999:
                                    break
                    ent["count"] = n
                except OSError:
                    ent["count"] = None
            elif ent["ext"] in IMAGE_EXTS and st.st_size <= 40 * 1024 * 1024:
                ent["image"] = True
            out.append(ent)
        parent = d.parent if d != self.scope else None
        return {"path": str(d), "label": self.label(d), "name": d.name or "/",
                "parent": str(parent) if parent else None, "crumbs": self.crumbs(d),
                "entries": out, "more": more}

    def tree(self, q):
        root = self.resolve(q.get("path"))
        hidden = q.get("hidden") == "1"

        def walk(d: Path, depth: int):
            try:
                items, more = self.entries(d, hidden, TREE_PER_DIR)
            except OSError:
                return [], 0
            nodes = []
            for e in items:
                try:
                    is_dir = e.is_dir(follow_symlinks=True)
                except OSError:
                    continue
                node = {"name": e.name, "path": os.path.join(d, e.name), "dir": is_dir,
                        "kind": kind_of(e.name, is_dir)}
                if is_dir and depth > 1 and not e.is_symlink():
                    node["children"], node["more"] = walk(Path(e.path), depth - 1)
                nodes.append(node)
            return nodes, more

        children, more = walk(root, 2)
        return {"path": str(root), "name": root.name or "/", "children": children, "more": more}

    def preview(self, q):
        f = self.resolve(q.get("path"))
        if not f.is_file():
            raise IsADirectoryError(str(f))
        with open(f, "rb") as fh:
            head = fh.read(PREVIEW_BYTES)
        if not is_text(head[:4096]):
            return {"binary": True}
        return {"binary": False, "text": head.decode("utf-8", errors="replace"),
                "truncated": f.stat().st_size > PREVIEW_BYTES}

    def thumb(self, q) -> bytes:
        from PIL import Image

        f = self.resolve(q.get("path"))
        if ext_of(f.name) not in IMAGE_EXTS or f.stat().st_size > 40 * 1024 * 1024:
            raise PermissionError("pas une image")
        Image.MAX_IMAGE_PIXELS = 80_000_000
        with Image.open(f) as im:
            im.draft("RGB", (FTHUMB_MAX * 2, FTHUMB_MAX * 2))
            im = im.convert("RGB")
            im.thumbnail((FTHUMB_MAX, FTHUMB_MAX))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
        return buf.getvalue()

    def open(self, body):
        p = self.resolve(body.get("path"))
        how = body.get("how")
        if how == "terminal":
            d = p if p.is_dir() else p.parent
            if shutil.which("kitty"):
                cmd = ["kitty", "--directory", str(d)]
            elif shutil.which("gnome-terminal"):
                cmd = ["gnome-terminal", f"--working-directory={d}"]
            else:
                raise FileNotFoundError("aucun terminal trouvé")
        elif how == "vscode":
            # Folder → opened as a workspace; file → opened in the editor (no execution).
            exe = shutil.which("code") or shutil.which("codium")
            if not exe:
                raise FileNotFoundError("VS Code introuvable (commande `code`)")
            cmd = [exe, str(p)]
        elif how == "open":
            if p.is_file():
                if ext_of(p.name) in NEVER_OPEN:
                    raise PermissionError("type exécutable : ouverture refusée")
                mode = p.stat().st_mode
                if mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
                    with open(p, "rb") as fh:
                        if not is_text(fh.read(4096)):
                            raise PermissionError("binaire exécutable : ouverture refusée")
            cmd = ["xdg-open", str(p)]
        else:
            raise ValueError("action inconnue")
        subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
        return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
#  HTTP server
# ══════════════════════════════════════════════════════════════════════════════
# Only these static paths are ever served (no directory listing, no traversal).
SERVED = re.compile(r"^/(index\.html|style\.css|app\.js|files\.js|gallery\.json|"
                    r"thumbs/[0-9a-f]{20}\.jpg)$")
ERRORS = {PermissionError: 403, FileNotFoundError: 404, NotADirectoryError: 400,
          IsADirectoryError: 400, ValueError: 400}


class Handler(http.server.SimpleHTTPRequestHandler):
    api: FilesAPI | None = None    # set in files mode
    token = ""
    host = ""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HUB), **kw)

    # ── helpers ──
    def send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api_allowed(self, query) -> bool:
        if self.api is None or self.headers.get("Host") != self.host:
            return False
        given = self.headers.get("X-Hub-Token") or query.get("t", "")
        return secrets.compare_digest(given, self.token)

    def run_api(self, fn):
        try:
            return fn()
        except tuple(ERRORS) as exc:
            self.send_json({"error": str(exc)}, ERRORS[type(exc)] if type(exc) in ERRORS else 400)
        except OSError as exc:
            self.send_json({"error": exc.strerror or str(exc)}, 403)
        return None

    # ── verbs ──
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path.startswith("/api/"):
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            if not self.api_allowed(q):
                self.send_error(403)
                return
            name = url.path[5:]
            if name in ("list", "tree", "preview"):
                res = self.run_api(lambda: getattr(self.api, name)(q))
                if res is not None:
                    self.send_json(res)
            elif name == "thumb":
                data = self.run_api(lambda: self.api.thumb(q))
                if data is not None:
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            else:
                self.send_error(404)
            return
        path = "/index.html" if url.path == "/" else url.path
        if not SERVED.match(path):
            self.send_error(404)
            return
        self.path = path
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def do_POST(self):
        url = urlsplit(self.path)
        # POST needs the header token (a cross-site form can never set it).
        if url.path != "/api/open" or self.api is None or self.headers.get("Host") != self.host \
                or not secrets.compare_digest(self.headers.get("X-Hub-Token", ""), self.token):
            self.send_error(403)
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 8192)
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "requête invalide"}, 400)
            return
        res = self.run_api(lambda: self.api.open(body))
        if res is not None:
            self.send_json(res)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, *args):
        pass


def find_browser():
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "brave-browser", "microsoft-edge"):
        exe = shutil.which(name)
        if exe:
            return exe
    return None


def main() -> int:
    args = sys.argv[1:]
    if "--build-only" in args:
        build_gallery()
        return 0

    files_dir = None
    if "--files" in args:
        i = args.index("--files")
        files_dir = Path(args[i + 1] if i + 1 < len(args) else os.getcwd()).expanduser().resolve()
        if not files_dir.is_dir():
            print(f"Pas un dossier : {files_dir}", file=sys.stderr)
            return 1
    else:
        build_gallery()

    browser = find_browser()
    if not browser:
        print("Aucun navigateur Chromium trouvé (chrome/chromium/brave/edge) pour le mode --app.",
              file=sys.stderr)
        return 1

    # One window per mode; each mode has its own profile (a shared profile would hand the
    # second window to the first browser process and make our launcher exit at once).
    mode = "files" if files_dir else "gallery"
    CACHE.mkdir(parents=True, exist_ok=True)
    lock = open(CACHE / f"{mode}.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Ce hub est déjà ouvert.", file=sys.stderr)
        return 0

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    Handler.host = f"127.0.0.1:{port}"
    url = f"http://127.0.0.1:{port}/"
    profile = CACHE / ("browser-profile" if mode == "gallery" else "browser-profile-files")
    if files_dir:
        Handler.api = FilesAPI(files_dir)
        Handler.token = secrets.token_urlsafe(24)
        url += f"?mode=files&token={Handler.token}"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    cmd = [browser, f"--app={url}", f"--user-data-dir={profile}",
           "--class=GeekHub", "--window-size=1600,920",
           "--no-first-run", "--no-default-browser-check", "--disable-sync",
           "--disable-extensions", "--disable-background-networking",
           "--disable-component-update", "--disable-features=Translate,MediaRouter",
           "--ozone-platform-hint=auto"]
    try:
        subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=False)
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
