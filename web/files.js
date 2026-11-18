// files.js — "hub 2": your files and folders as floating 3D cards.
// Click a folder → enter it (cards fly in) · click a file → zoom + preview + actions.
// Side panel = `tree` (2 levels) of the current folder, clickable. Breadcrumb on top.
// Talks to the local API of geek-hub.py (token-protected, 127.0.0.1 only).

const $ = (s) => document.querySelector(s);
const FONT = '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", monospace';

const KINDS = {
  dir:     { label: 'Dossiers', color: 0x50fa7b, css: '#50fa7b' },
  code:    { label: 'Code',     color: 0xf1fa8c, css: '#f1fa8c' },
  media:   { label: 'Médias',   color: 0xff79c6, css: '#ff79c6' },
  doc:     { label: 'Docs',     color: 0x8be9fd, css: '#8be9fd' },
  archive: { label: 'Archives', color: 0xff5555, css: '#ff5555' },
  other:   { label: 'Autres',   color: 0x9aa59d, css: '#c8d3c8' },
};
// Nerd Font glyphs (all checked present in JetBrainsMono Nerd Font Mono).
const GLYPH_KIND = { dir: '', code: '', media: '', doc: '', archive: '', other: '' };
const GLYPH_EXT = {
  py: '', js: '', mjs: '', cjs: '', c: '', h: '',
  cpp: '', hpp: '', cc: '', hh: '', html: '', htm: '',
  css: '', scss: '', json: '', jsonc: '', md: '',
  sh: '', bash: '', zsh: '', rs: '', java: '',
  pdf: '', xls: '', xlsx: '', ods: '', csv: '',
  doc: '', docx: '', odt: '', ppt: '', pptx: '', odp: '',
  conf: '', ini: '', cfg: '', toml: '', yml: '', yaml: '',
  lock: '', mp4: '', mkv: '', webm: '', avi: '', mov: '',
  mp3: '', wav: '', flac: '', ogg: '', m4a: '', opus: '',
};
// Extensions whose content is not readable as text (no preview request).
const NO_PREVIEW = new Set(['pdf', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'epub']);

let H;                       // engine API from app.js
let TOKEN = '';
const state = { path: null, parent: null, hidden: false, treeOpen: false, busy: false };

// ── API ──────────────────────────────────────────────────────────────────────
async function api(name, params = {}) {
  const url = new URL(`/api/${name}`, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'X-Hub-Token': TOKEN }, cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
async function openPath(path, how) {
  try {
    const res = await fetch('/api/open', {
      method: 'POST',
      headers: { 'X-Hub-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, how }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    H.toast({ terminal: ' Terminal ouvert', vscode: '󰨞 VS Code ouvert' }[how] || '󰏌 Ouvert');
  } catch (err) {
    H.toast(`Refusé : ${err.message}`, true);
  }
}
const thumbUrl = (path) => `/api/thumb?path=${encodeURIComponent(path)}&t=${encodeURIComponent(TOKEN)}`;
let homeDir = '';           // from the breadcrumb: paths are shown as ~/…
const tildify = (p) => (homeDir && (p === homeDir || p.startsWith(homeDir + '/')) ? '~' + p.slice(homeDir.length) : p);
const parentOf = (p) => p.slice(0, p.lastIndexOf('/')) || '/';

// ── Card textures ────────────────────────────────────────────────────────────
function glyph(e) {
  if (e.dir) return e.name === '.git' ? '' : GLYPH_KIND.dir;
  if (/^dockerfile$/i.test(e.name)) return '';
  return GLYPH_EXT[e.ext] || GLYPH_KIND[e.kind] || GLYPH_KIND.other;
}
function humanSize(n) {
  if (n == null) return '';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
function meta(e) {
  if (e.dir) return e.count == null ? 'accès refusé' : `${e.count >= 999 ? '999+' : e.count} élément${e.count > 1 ? 's' : ''}`;
  return [humanSize(e.size), e.ext ? e.ext.toUpperCase() : 'fichier'].join(' · ');
}
// Split a name (often without spaces) into at most `max` lines of width `w`.
function wrap(g, text, w, max) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (g.measureText(cur + ch).width > w && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    lines.length = max;
    let last = lines[max - 1];
    while (last && g.measureText(last + '…').width > w) last = last.slice(0, -1);
    lines[max - 1] = last + '…';
  }
  return lines;
}
function fileTexture(e) {
  const { THREE } = H;
  const W = 256, Hh = 320;
  const c = document.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  const k = KINDS[e.kind] || KINDS.other;
  g.fillStyle = '#050906';
  g.fillRect(0, 0, W, Hh);
  const grad = g.createLinearGradient(0, 0, 0, Hh);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `${k.css}38`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, Hh);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 0; y < Hh; y += 4) g.fillRect(0, y, W, 1);          // scanlines

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = k.css;
  g.shadowColor = k.css;
  g.shadowBlur = 26;
  g.font = `100px ${FONT}`;
  g.fillText(glyph(e), W / 2, 118);
  g.shadowBlur = 0;

  g.font = `bold 21px ${FONT}`;
  g.fillStyle = '#eaffef';
  wrap(g, e.name, W - 30, 2).forEach((l, i) => g.fillText(l, W / 2, 222 + i * 26));
  g.font = `15px ${FONT}`;
  g.fillStyle = 'rgba(200,230,210,.62)';
  g.fillText(meta(e), W / 2, 290);
  if (e.link) {
    g.textAlign = 'right';
    g.fillStyle = '#8be9fd';
    g.font = `14px ${FONT}`;
    g.fillText('↪ lien', W - 14, 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── Navigation ───────────────────────────────────────────────────────────────
async function navigate(path, focusName = null) {
  if (state.busy) return false;
  state.busy = true;
  let data;
  try {
    data = await api('list', { path, hidden: state.hidden ? 1 : 0 });
  } catch (err) {
    H.toast(`Impossible d'ouvrir : ${err.message}`, true);
    return false;
  } finally {
    state.busy = false;
  }
  state.path = data.path;
  state.parent = data.parent;
  if (data.crumbs[0]?.name === '~') homeDir = data.crumbs[0].path;

  H.clearCards();
  H.clearSearch();
  for (const e of data.entries) {
    H.addCard({
      title: e.name, cat: e.kind, w: 256, h: 320, data: e,
      texture: fileTexture(e), src: e.image ? thumbUrl(e.path) : null,
    });
  }
  H.buildTabs();
  H.setFilter('all');
  H.flyIn();

  const nd = data.entries.filter((e) => e.dir).length;
  const nf = data.entries.length - nd;
  H.setTitle(data.label, data.name);
  H.setSlogans([
    `${nd} dossier${nd > 1 ? 's' : ''} · ${nf} fichier${nf > 1 ? 's' : ''}${data.more ? ` · +${data.more} non affichés` : ''}`,
    'clic sur un dossier : entrer · ⌫ : dossier parent',
    'T : arborescence · . : fichiers cachés · / : rechercher',
  ]);
  document.title = `Files · ${data.name}`;
  renderCrumbs(data);
  if (state.treeOpen) loadTree();
  if (data.entries.length === 0) H.toast('Dossier vide');
  if (focusName) {
    const card = H.cards.find((c) => c.data?.name === focusName);
    if (card) H.focus(card);
  }
  return true;
}

function goParent() {
  if (state.parent) navigate(state.parent, state.path.slice(state.path.lastIndexOf('/') + 1));
  else H.toast('Racine atteinte');
}

// ── Breadcrumb + folder actions ──────────────────────────────────────────────
function crumbButton(text, onClick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}
function renderCrumbs(data) {
  const nav = $('#crumbs');
  nav.hidden = false;
  nav.textContent = '';
  data.crumbs.forEach((c, i) => {
    if (i) {
      const s = document.createElement('span');
      s.className = 'sep';
      s.textContent = '/';
      nav.append(s);
    }
    const last = i === data.crumbs.length - 1;
    nav.append(crumbButton(c.name, () => navigate(c.path), last ? 'current' : ''));
  });
  if (data.parent) nav.append(crumbButton('↑ parent', goParent, 'crumb-action'));
  nav.append(crumbButton(' terminal ici', () => openPath(state.path, 'terminal'), 'crumb-action'));
  nav.append(crumbButton('󰨞 VS Code', () => openPath(state.path, 'vscode'), 'crumb-action'));
  nav.append(crumbButton('󰉋 Fichiers', () => openPath(state.path, 'open'), 'crumb-action'));
}

// ── Tree panel ───────────────────────────────────────────────────────────────
function treeLine(branch, name, kind, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tree-line';
  const br = document.createElement('span');
  br.className = 'branch';
  br.textContent = branch;
  const nm = document.createElement('span');
  nm.className = `k-${kind}`;
  nm.textContent = name;
  b.append(br, nm);
  b.addEventListener('click', onClick);
  return b;
}
function renderNodes(box, nodes, more, prefix) {
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1 && !more;
    box.append(treeLine(prefix + (last ? '└── ' : '├── '), n.dir ? `${n.name}/` : n.name, n.kind,
      () => (n.dir ? navigate(n.path) : revealFile(n.path))));
    if (n.children) renderNodes(box, n.children, n.more, prefix + (last ? '    ' : '│   '));
  });
  if (more) {
    const m = document.createElement('div');
    m.className = 'tree-more';
    m.textContent = `${prefix}└── … +${more}`;
    box.append(m);
  }
}
async function loadTree() {
  const body = $('#treeBody');
  const forPath = state.path;
  try {
    const t = await api('tree', { path: forPath, hidden: state.hidden ? 1 : 0 });
    if (forPath !== state.path) return;                 // navigated meanwhile
    body.textContent = '';
    body.append(treeLine('', `${t.name}/`, 'dir', () => H.unfocus()));
    renderNodes(body, t.children, t.more, '');
  } catch (err) {
    body.textContent = err.message;
  }
}
function setTree(open) {
  state.treeOpen = open;
  $('#treePanel').hidden = !open;
  document.body.classList.toggle('tree-open', open);
  if (open && state.path) loadTree();
}
async function revealFile(path) {
  const dir = parentOf(path);
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (dir === state.path) {
    const card = H.cards.find((c) => c.data?.name === name);
    if (card) { H.clearSearch(); H.setFilter('all'); H.focus(card); }
  } else {
    await navigate(dir, name);
  }
}

// ── Focus panel: info, preview, actions ──────────────────────────────────────
function actionButton(text, onClick, primary = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (primary) b.className = 'primary';
  b.addEventListener('click', onClick);
  return b;
}
async function onFocus(card) {
  const e = card.data;
  if (!e) return;
  const body = $('#focusBody');
  const extra = $('#focusExtra');
  const info = document.createElement('div');
  const p = document.createElement('div');
  p.className = 'path';
  p.textContent = tildify(e.path);
  info.append(p, `${meta(e)} · modifié le ${new Date(e.mtime * 1000).toLocaleString('fr-FR')}`);
  body.append(info);

  if (e.dir) {
    extra.append(actionButton(' Entrer', () => navigate(e.path), true));
  } else {
    extra.append(actionButton('󰏌 Ouvrir', () => openPath(e.path, 'open'), true));
  }
  extra.append(
    actionButton(' Terminal', () => openPath(e.path, 'terminal')),
    actionButton('󰨞 VS Code', () => openPath(e.path, 'vscode')),
    actionButton(' Copier le chemin', async () => {
      try { await navigator.clipboard.writeText(e.path); H.toast('Chemin copié'); }
      catch { H.toast('Presse-papiers indisponible', true); }
    }),
  );

  if (!e.dir && e.kind !== 'media' && e.kind !== 'archive' && !NO_PREVIEW.has(e.ext) && e.size <= 5 * 1024 * 1024) {
    try {
      const pv = await api('preview', { path: e.path });
      if (H.focused !== card) return;                  // moved on meanwhile
      const pre = document.createElement('pre');
      pre.textContent = pv.binary ? '(fichier binaire — pas d\'aperçu)'
        : pv.text.split('\n').slice(0, 300).join('\n') + (pv.truncated ? '\n…' : '');
      body.append(pre);
    } catch (err) {
      if (H.focused === card) body.append(`  (aperçu indisponible : ${err.message})`);
    }
  }
}

function onKey(e) {
  if (e.key === 'Backspace') { e.preventDefault(); if (H.focused) H.unfocus(); else goParent(); return true; }
  if (e.key === 't' || e.key === 'T') { setTree(!state.treeOpen); return true; }
  if (e.key === '.') { state.hidden = !state.hidden; H.toast(state.hidden ? 'Fichiers cachés : affichés' : 'Fichiers cachés : masqués'); navigate(state.path); return true; }
  if (e.key === 'Enter' && H.focused?.data) {
    const d = H.focused.data;
    if (d.dir) navigate(d.path); else openPath(d.path, 'open');
    return true;
  }
  return false;
}

// ── Entry point ──────────────────────────────────────────────────────────────
export async function init(hub) {
  H = hub;
  TOKEN = hub.PARAMS.get('token') || '';
  if (!TOKEN) throw new Error('jeton de session manquant');
  hub.setCategories(Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, color: v.color }])));
  hub.hooks.onCardClick = (card) => (card.data?.dir ? navigate(card.data.path) : hub.focus(card));
  hub.hooks.onFocus = onFocus;
  hub.hooks.onKey = onKey;
  $('#hint').textContent = 'clic : ouvrir · ⌫ : parent · T : tree · . : cachés · / : chercher · Q : quitter';
  $('#treeClose').addEventListener('click', () => setTree(false));
  // Let the Nerd Font load before the first canvas cards are drawn.
  try { await document.fonts.load(`100px ${FONT}`, ''); } catch { /* system font fallback */ }
  setTree(innerWidth > 1100);
  if (!(await navigate(null))) throw new Error('dossier de départ illisible');
}
