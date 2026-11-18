// Shinobi Geek Hub — Three.js scene.
// Layers: cyber grid floor · neural network sphere (AI) · chakra/magic particle vortex
// (GPU-animated) · energy core · floating gallery cards (raycast hover / click focus).
// Performance contract: one requestAnimationFrame loop that fully STOPS when the window
// loses focus or is hidden (0 % CPU/GPU), pixel ratio capped, shared geometry, thumbnails.

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const $ = (s) => document.querySelector(s);
const fail = (msg) => {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = false;
};

let THREE;
try {
  THREE = await import(THREE_URL);
} catch {
  fail('Three.js est injoignable (CDN jsdelivr). Vérifie ta connexion puis relance `hub`.');
  throw new Error('three.js unavailable');
}

const PARAMS = new URLSearchParams(location.search);
const MODE = PARAMS.get('mode') === 'files' ? 'files' : 'gallery';
const MAX_DPR = 1.5;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = {
  green: 0x50fa7b, chakra: 0xff8a1f, slime: 0x3fd8ff, shadow: 0x9b5cff, red: 0xff3b4f,
};
let CAT = {                // replaced by the files mode (see files.js)
  anime:  { label: 'Animé',     color: COLORS.chakra },
  gaming: { label: 'Gaming',    color: COLORS.red },
  ai:     { label: 'IA / Tech', color: COLORS.slime },
};

// ── Renderer / scene / camera ────────────────────────────────────────────────
const canvas = $('#scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  fail('WebGL indisponible dans ce navigateur (accélération GPU désactivée ?).');
  throw new Error('webgl unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x030604, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030604, 0.011);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 6, 150);

const uTime = { value: 0 };                       // shared by every shader
const uPixelRatio = { value: renderer.getPixelRatio() };

// ── Cyber grid floor (AI) ────────────────────────────────────────────────────
const grid = new THREE.Mesh(
  new THREE.PlaneGeometry(420, 420),
  new THREE.ShaderMaterial({
    uniforms: { uTime, uColor: { value: new THREE.Color(COLORS.green) } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor; varying vec3 vW;
      float gridLine(float c) {
        float d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
        return 1.0 - min(d, 1.0);
      }
      void main() {
        vec2 p = vW.xz * 0.25;
        p.y += uTime * 0.8;
        float fine = max(gridLine(p.x), gridLine(p.y));
        float coarse = max(gridLine(p.x * 0.2), gridLine(p.y * 0.2));
        float dist = length(vW.xz);
        float fade = smoothstep(170.0, 8.0, dist);
        float pulse = 0.5 + 0.5 * sin(dist * 0.12 - uTime * 2.2);
        float a = (fine * 0.22 + coarse * 0.55) * fade * (0.55 + 0.45 * pulse);
        gl_FragColor = vec4(uColor * (0.9 + pulse * 0.6), a);
      }`,
  }),
);
grid.rotation.x = -Math.PI / 2;
grid.position.y = -15;
scene.add(grid);

// ── Neural network sphere (AI) ───────────────────────────────────────────────
const neural = new THREE.Group();
scene.add(neural);
const NODE_COUNT = 110;
const nodes = [];
for (let i = 0; i < NODE_COUNT; i++) {
  // Fibonacci sphere + jitter: even coverage, organic look.
  const y = 1 - (i / (NODE_COUNT - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963;
  const R = 70 + (Math.random() - 0.5) * 14;
  nodes.push(new THREE.Vector3(Math.cos(a) * r * R, y * R * 0.7, Math.sin(a) * r * R));
}
const edges = [];
nodes.forEach((n, i) => {
  nodes
    .map((m, j) => ({ j, d: n.distanceToSquared(m) }))
    .filter((e) => e.j > i)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .forEach((e) => edges.push([i, e.j]));
});
const edgePos = new Float32Array(edges.length * 6);
edges.forEach(([a, b], k) => {
  nodes[a].toArray(edgePos, k * 6);
  nodes[b].toArray(edgePos, k * 6 + 3);
});
const edgeGeo = new THREE.BufferGeometry();
edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
neural.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
  color: COLORS.green, transparent: true, opacity: 0.13, depthWrite: false,
})));

// Soft round point sprite, generated once.
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const DOT = dotTexture();
const nodeGeo = new THREE.BufferGeometry().setFromPoints(nodes);
neural.add(new THREE.Points(nodeGeo, new THREE.PointsMaterial({
  map: DOT, color: COLORS.green, size: 2.6, transparent: true, opacity: 0.85,
  depthWrite: false, blending: THREE.AdditiveBlending,
})));

// Signals travelling along edges (CPU-side, only 70 points).
const SIGNALS = 70;
const sigState = Array.from({ length: SIGNALS }, () => ({
  e: Math.floor(Math.random() * edges.length), t: Math.random(), v: 0.25 + Math.random() * 0.6,
}));
const sigPos = new Float32Array(SIGNALS * 3);
const sigGeo = new THREE.BufferGeometry();
sigGeo.setAttribute('position', new THREE.BufferAttribute(sigPos, 3));
neural.add(new THREE.Points(sigGeo, new THREE.PointsMaterial({
  map: DOT, color: COLORS.slime, size: 3.4, transparent: true,
  depthWrite: false, blending: THREE.AdditiveBlending,
})));
const tmpV = new THREE.Vector3();
function updateSignals(dt) {
  for (let i = 0; i < SIGNALS; i++) {
    const s = sigState[i];
    s.t += s.v * dt;
    if (s.t >= 1) { s.t = 0; s.e = Math.floor(Math.random() * edges.length); }
    const [a, b] = edges[s.e];
    tmpV.lerpVectors(nodes[a], nodes[b], s.t).toArray(sigPos, i * 3);
  }
  sigGeo.attributes.position.needsUpdate = true;
}

// ── Chakra / magic particle vortex (100 % GPU-animated) ──────────────────────
const PARTICLES = REDUCED ? 2500 : 7000;
const seeds = new Float32Array(PARTICLES * 4);
for (let i = 0; i < PARTICLES; i++) {
  seeds[i * 4]     = 2.5 + Math.pow(Math.random(), 0.7) * 30; // orbit radius
  seeds[i * 4 + 1] = Math.random();                           // phase
  seeds[i * 4 + 2] = 0.4 + Math.random();                     // speed
  seeds[i * 4 + 3] = Math.random();                           // kind: chakra/slime/shadow
}
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
partGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
partGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60); // positions live in the shader
const particles = new THREE.Points(partGeo, new THREE.ShaderMaterial({
  uniforms: { uTime, uPixelRatio, uSpeed: { value: REDUCED ? 0.3 : 1 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    uniform float uTime, uPixelRatio, uSpeed;
    attribute vec4 aSeed;
    varying vec3 vColor; varying float vAlpha;
    void main() {
      float t = uTime * uSpeed;
      float life = fract(t * 0.035 * aSeed.z + aSeed.y);
      float kind = aSeed.w;
      // chakra: tight rising spiral · slime: wide floating bubbles · shadow: slow outward drift
      float swirl = kind < 0.42 ? 5.0 : (kind < 0.78 ? 1.5 : 0.8);
      float ang = aSeed.y * 6.2831 + t * (0.18 + aSeed.z * 0.3) + life * swirl;
      float rad = aSeed.x * (kind < 0.42 ? (1.0 - 0.6 * life) : (kind < 0.78 ? 1.0 : 0.7 + 0.6 * life));
      float y = mix(-15.0, 17.0, life);
      vec3 p = vec3(cos(ang) * rad, y, sin(ang) * rad);
      p += 0.7 * vec3(sin(t * 0.7 + aSeed.x * 3.0), sin(t * 0.9 + aSeed.y * 20.0) * 0.5, cos(t * 0.6 + aSeed.y * 9.0));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float size = mix(1.2, 3.6, fract(aSeed.x * 13.7));
      gl_PointSize = size * uPixelRatio * (34.0 / -mv.z);
      vAlpha = smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.7, life);
      vColor = kind < 0.42 ? vec3(1.0, 0.54, 0.12) : (kind < 0.78 ? vec3(0.25, 0.85, 1.0) : vec3(0.62, 0.36, 1.0));
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor; varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vColor * a * 1.5, a * vAlpha);
    }`,
}));
scene.add(particles);

// ── Energy core ──────────────────────────────────────────────────────────────
const core = new THREE.Group();
scene.add(core);
core.add(new THREE.Mesh(
  new THREE.IcosahedronGeometry(4.2, 1),
  new THREE.MeshBasicMaterial({ color: COLORS.green, wireframe: true, transparent: true, opacity: 0.35 }),
));
core.add(new THREE.Mesh(
  new THREE.SphereGeometry(2.6, 48, 32),
  new THREE.ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.2);
        vec3 c = mix(vec3(1.0, 0.54, 0.12), vec3(0.25, 0.85, 1.0), 0.5 + 0.5 * sin(uTime * 0.8));
        gl_FragColor = vec4(c * (0.35 + f * 1.6), 0.25 + f);
      }`,
  }),
));
const rings = [COLORS.chakra, COLORS.slime, COLORS.shadow].map((color, i) => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(6.5 + i * 1.6, 0.04, 8, 160),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }),
  );
  ring.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.7, 0);
  core.add(ring);
  return ring;
});

// ── Gallery cards ────────────────────────────────────────────────────────────
const CARD_H = 3.6;
const cardGeo = new THREE.PlaneGeometry(1, 1);
const cardVS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const cardFS = /* glsl */`
  uniform sampler2D uMap; uniform float uHasMap, uHover, uDim, uAspect, uImgAspect, uTime, uBorder;
  uniform vec3 uColor;
  varying vec2 vUv;
  float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float d = sdRound(p, vec2(uAspect * 0.5, 0.5), 0.08);
    if (d > 0.0) discard;
    // "cover" fit of the thumbnail into the card
    vec2 uv = vUv - 0.5;
    if (uImgAspect > uAspect) uv.x *= uAspect / uImgAspect; else uv.y *= uImgAspect / uAspect;
    uv += 0.5;
    vec3 col = uHasMap > 0.5 ? texture2D(uMap, uv).rgb
                             : mix(vec3(0.02, 0.05, 0.03), uColor * 0.35, vUv.y);
    col *= 0.82 + 0.18 * smoothstep(0.75, 0.15, length(vUv - 0.5));
    float sheen = smoothstep(0.1, 0.0, abs(vUv.x + vUv.y - fract(uTime * 0.35) * 3.0 + 0.5));
    col += sheen * uHover * 0.22;
    float border = smoothstep(-uBorder, -uBorder * 0.25, d);
    col = mix(col, uColor * 1.5, border * (0.5 + 0.5 * uHover));
    col *= 1.0 - uDim * 0.78;
    gl_FragColor = vec4(col, 1.0);
  }`;

const cards = [];
const loader = new THREE.TextureLoader();
const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

function addCard({ title, cat, src, w = 16, h = 9, texture = null, data = null }) {
  const imgAspect = w / h;
  const aspect = THREE.MathUtils.clamp(imgAspect, 0.62, 1.78);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture }, uHasMap: { value: texture ? 1 : 0 },
      uHover: { value: 0 }, uDim: { value: 0 }, uTime, uBorder: { value: 0.05 },
      uAspect: { value: aspect }, uImgAspect: { value: imgAspect },
      uColor: { value: new THREE.Color(CAT[cat].color) },
    },
    vertexShader: cardVS,
    fragmentShader: cardFS,
  });
  const mesh = new THREE.Mesh(cardGeo, mat);
  mesh.scale.set(0.001, 0.001, 1);
  mesh.position.set(0, 0, 0);
  scene.add(mesh);
  const card = {
    mesh, mat, title, cat, aspect, data,
    home: new THREE.Vector3(), bob: Math.random() * Math.PI * 2, shown: true, s: 0,
  };
  mesh.userData.card = card;
  cards.push(card);
  if (src) {
    loader.load(src, (tex) => {
      if (!cards.includes(card)) { tex.dispose(); return; }      // card removed meanwhile
      mat.uniforms.uMap.value?.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      mat.uniforms.uMap.value = tex;
      mat.uniforms.uHasMap.value = 1;
      if (tex.image?.width) mat.uniforms.uImgAspect.value = tex.image.width / tex.image.height;
      if (!running) renderOnce();
    }, undefined, () => { /* keep the gradient placeholder */ });
  }
  return card;
}

function clearCards() {
  unfocus();
  for (const c of cards) {
    scene.remove(c.mesh);
    c.mat.uniforms.uMap.value?.dispose();
    c.mat.dispose();
  }
  cards.length = 0;
  hovered = null;
  document.body.classList.remove('hovering');
  $('#hoverLabel').classList.remove('show');
}

// Original procedural emblem cards (no copyrighted art) for themes missing from the gallery.
function emblemTexture(draw) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 640;
  draw(c.getContext('2d'), 512, 640);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function bg(g, w, h, inner, outer) {
  const grad = g.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.42, h * 0.75);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}
function caption(g, w, h, big, small, color) {
  g.textAlign = 'center';
  g.fillStyle = color;
  g.shadowColor = color; g.shadowBlur = 18;
  g.font = '900 54px Inter, Cantarell, sans-serif';
  g.fillText(big, w / 2, h - 110);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(230,255,240,.75)';
  g.font = '500 22px "JetBrainsMono Nerd Font", monospace';
  g.fillText(small, w / 2, h - 66);
}
const EMBLEMS = {
  slime: { cat: 'anime', title: 'Tensura · Magie Slime', test: /rimuru|slime|tensura/i, draw(g, w, h) {
    bg(g, w, h, '#0d3b5c', '#020a12');
    const cx = w / 2, cy = 270;
    const body = g.createLinearGradient(0, cy - 140, 0, cy + 110);
    body.addColorStop(0, '#9ff0ff'); body.addColorStop(1, '#1673d6');
    g.fillStyle = body; g.shadowColor = '#3fd8ff'; g.shadowBlur = 50;
    g.beginPath();
    g.moveTo(cx, cy - 150);
    g.bezierCurveTo(cx + 60, cy - 60, cx + 170, cy - 10, cx + 160, cy + 70);
    g.bezierCurveTo(cx + 150, cy + 125, cx - 150, cy + 125, cx - 160, cy + 70);
    g.bezierCurveTo(cx - 170, cy - 10, cx - 60, cy - 60, cx, cy - 150);
    g.fill(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(cx - 60, cy - 10, 26, 46, -0.5, 0, Math.PI * 2); g.fill();
    caption(g, w, h, 'TENSURA', 'magie · slime · isekai', '#3fd8ff');
  } },
  shadow: { cat: 'anime', title: 'Shadow Garden', test: /shadow-garden|eminence|cid|kagenou/i, draw(g, w, h) {
    bg(g, w, h, '#2b1252', '#05020b');
    g.fillStyle = '#e9dcff'; g.shadowColor = '#9b5cff'; g.shadowBlur = 60;
    g.beginPath(); g.arc(w / 2, 250, 120, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(w / 2 + 55, 225, 110, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;
    g.strokeStyle = '#b48cff'; g.lineWidth = 6; g.shadowColor = '#9b5cff'; g.shadowBlur = 25;
    g.beginPath(); g.moveTo(90, 430); g.lineTo(w - 90, 330); g.stroke(); g.shadowBlur = 0;
    caption(g, w, h, 'I AM ATOMIC', 'the eminence in shadow', '#b48cff');
  } },
  neural: { cat: 'ai', title: 'Neural Core', test: /neural|brain-3d/i, draw(g, w, h) {
    bg(g, w, h, '#0b3a1e', '#020805');
    const layers = [3, 5, 5, 2];
    const pts = layers.map((n, li) => Array.from({ length: n }, (_, k) => [
      90 + li * ((w - 180) / (layers.length - 1)), 110 + (k + 0.5) * (330 / n)]));
    g.strokeStyle = 'rgba(80,250,123,.35)'; g.lineWidth = 2;
    for (let li = 0; li < pts.length - 1; li++) {
      for (const a of pts[li]) for (const b of pts[li + 1]) {
        g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      }
    }
    g.shadowColor = '#50fa7b'; g.shadowBlur = 20;
    for (const layer of pts) for (const [x, y] of layer) {
      g.fillStyle = '#50fa7b'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
    }
    g.shadowBlur = 0;
    caption(g, w, h, 'NEURAL CORE', 'intelligence artificielle', '#50fa7b');
  } },
};

// ── Layout: golden-angle spiral on a cylinder band ───────────────────────────
let filter = 'all';
let query = '';
let cardScale = 1;
function visibleCards() { return cards.filter((c) => c.shown); }
function layout() {
  const vis = visibleCards();
  const n = vis.length;
  const R = THREE.MathUtils.clamp(11 + n * 0.32, 15, n > 80 ? 34 : 28);
  const H = Math.min(n > 80 ? 22 : 19, 4 + n * 0.4);
  cardScale = THREE.MathUtils.clamp(1.2 - n * 0.007, 0.78, 1.1);   // many cards → smaller
  camDistTarget = R + 30;                                           // keep the ring in view
  vis.forEach((c, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const a = i * 2.399963;
    const r = R * (0.9 + 0.2 * ((i * 0.618) % 1));
    c.home.set(Math.cos(a) * r, (t - 0.5) * H, Math.sin(a) * r);
  });
  $('#count').textContent = `${n} carte${n > 1 ? 's' : ''}`;
}
function setFilter(f = filter) {
  filter = f;
  cards.forEach((c) => {
    c.shown = (f === 'all' || c.cat === f) && (!query || c.title.toLowerCase().includes(query));
  });
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.filter === f));
  if (focused && !focused.shown) unfocus();
  layout();
  if (!running) renderOnce();
}
// Tabs built from CAT (+ counts); categories without cards are hidden.
function buildTabs() {
  const box = $('#tabs');
  box.textContent = '';
  const keys = ['all', ...Object.keys(CAT).filter((k) => cards.some((c) => c.cat === k))];
  if (!keys.includes(filter)) filter = 'all';
  keys.forEach((key, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (key === filter ? ' active' : '');
    b.dataset.filter = key;
    const kbd = document.createElement('kbd');
    kbd.textContent = String(i + 1);
    const n = key === 'all' ? cards.length : cards.filter((c) => c.cat === key).length;
    b.append(kbd, ` ${key === 'all' ? 'Tout' : CAT[key].label} `);
    const cnt = document.createElement('small');
    cnt.textContent = String(n);
    cnt.className = 'tab-count';
    b.append(cnt);
    b.addEventListener('click', () => setFilter(key));
    box.append(b);
  });
}
$('#search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  setFilter();
});

// ── Interaction state ────────────────────────────────────────────────────────
let orbit = 0, orbitVel = 0, autoOrbit = !REDUCED;
let camDist = 150, camDistTarget = 50;
const mouse = new THREE.Vector2(-9, -9);
const parallax = new THREE.Vector2();
let hovered = null, focused = null;
const hooks = {};   // optional mode hooks: onCardClick, onFocus, onKey
let dragging = false, downX = 0, downY = 0, lastX = 0, moved = 0;
const ray = new THREE.Raycaster();

canvas.addEventListener('pointerdown', (e) => {
  dragging = true; moved = 0; downX = lastX = e.clientX; downY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  document.body.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (dragging) {
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
    if (!focused) orbitVel = THREE.MathUtils.clamp(orbitVel + dx * 0.0022, -3, 3);
  }
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  document.body.classList.remove('dragging');
  if (moved < 5) {                       // a click, not a drag
    if (hovered) (hooks.onCardClick || focus)(hovered);
    else if (focused) unfocus();
  }
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointerleave', () => mouse.set(-9, -9));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDistTarget = THREE.MathUtils.clamp(camDistTarget + e.deltaY * 0.03, 22, 80);
}, { passive: false });

$('#prevBtn').addEventListener('click', () => step(-1));
$('#nextBtn').addEventListener('click', () => step(1));
$('#closeBtn').addEventListener('click', () => unfocus());

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {            // typing in the search box
    if (e.key === 'Escape' || e.key === 'Enter') e.target.blur();
    return;
  }
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (hooks.onKey?.(e)) return;
  const tab = /^[1-9]$/.test(e.key) ? document.querySelectorAll('.tab')[+e.key - 1] : null;
  if (tab) setFilter(tab.dataset.filter);
  else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Escape') unfocus();
  else if (e.key === 'ArrowRight') focused ? step(1) : (orbitVel -= 0.6);
  else if (e.key === 'ArrowLeft') focused ? step(-1) : (orbitVel += 0.6);
  else if (e.key === ' ') { e.preventDefault(); autoOrbit = !autoOrbit; }
  else if (e.key === 'r' || e.key === 'R') { layout(); orbitVel = 0; }
  else if (e.key === 'q' || e.key === 'Q') window.close();
});

function focus(card) {
  focused = card;
  document.body.classList.add('focused');
  const vis = visibleCards();
  $('#focusTitle').textContent = card.title;
  $('#focusCat').textContent = CAT[card.cat].label;
  $('#focusIndex').textContent = `${String(vis.indexOf(card) + 1).padStart(2, '0')} / ${vis.length}`;
  $('#focusBody').textContent = '';
  $('#focusExtra').textContent = '';
  $('#focusPanel').hidden = false;
  $('#hoverLabel').classList.remove('show');
  hooks.onFocus?.(card);
}
function unfocus() {
  focused = null;
  document.body.classList.remove('focused');
  $('#focusPanel').hidden = true;
}
function step(d) {
  const vis = visibleCards();
  if (!focused || !vis.length) return;
  focus(vis[(vis.indexOf(focused) + d + vis.length) % vis.length]);
}

// ── Center title: rotating slogans ───────────────────────────────────────────
let SLOGANS = [
  'Chakra · Magie · IA · Gaming',
  "Je ne reviens jamais sur ma parole — c'est mon nindo.",
  'Je serai le Roi des Pirates !',
  'I am Atomic.',
  'Grand Sage : analyse terminée.',
  'Réseau neuronal synchronisé.',
  'Winner winner, chicken dinner.',
  'Mission passed. Respect +',
];
let sloganIdx = 0, sloganChar = 0, sloganHold = 0;
function setSlogans(list) { SLOGANS = list.length ? list : ['']; sloganIdx = 0; sloganChar = 0; sloganHold = 0; }
function updateSlogan(dt) {
  const target = SLOGANS[sloganIdx];
  if (sloganChar < target.length) {
    sloganChar = Math.min(target.length, sloganChar + dt * 32);
  } else if ((sloganHold += dt) > 2.8) {
    sloganHold = 0; sloganChar = 0; sloganIdx = (sloganIdx + 1) % SLOGANS.length;
  }
  const txt = target.slice(0, Math.floor(sloganChar));
  const el = $('#slogan');
  if (el.textContent !== txt) el.textContent = txt;
}

// ── Main loop (stops completely when unfocused / hidden) ─────────────────────
let running = false, rafId = 0, last = 0, fpsAcc = 0, fpsFrames = 0, lastSec = -1;
const tmpQ = new THREE.Quaternion();
const fwd = new THREE.Vector3();
const target = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3();
// Horizontal screen span (px) not covered by the tree panel / side focus panel.
function focusBounds() {
  let left = 0, rightPx = innerWidth, side = false;
  const tree = $('#treePanel');
  if (!tree.hidden) left = tree.getBoundingClientRect().right;
  if (document.body.classList.contains('files')) {
    const panel = $('#focusPanel');
    if (!panel.hidden) { rightPx = panel.getBoundingClientRect().left; side = true; }
  }
  return { left, right: Math.max(rightPx, left + 100), side };
}

function update(dt) {
  uTime.value += dt;
  const t = uTime.value;

  // camera: intro dolly + mouse parallax
  camDist += (camDistTarget - camDist) * (1 - Math.exp(-dt * 2.2));
  if (mouse.x > -2) parallax.lerp(mouse, 1 - Math.exp(-dt * 3));
  camera.position.set(parallax.x * 5, 5 + parallax.y * 3, camDist);
  camera.lookAt(0, 0, 0);
  camera.getWorldDirection(fwd);

  // orbit: auto spin + drag inertia (frozen while a card is focused)
  if (!focused) orbit += ((autoOrbit ? 0.07 : 0) + orbitVel) * dt;
  orbitVel *= Math.exp(-dt * 2.5);

  core.rotation.y += dt * 0.35;
  core.rotation.x = Math.sin(t * 0.3) * 0.2;
  rings.forEach((r, i) => { r.rotation.z += dt * (0.25 + i * 0.12) * (i % 2 ? -1 : 1); });
  neural.rotation.y -= dt * 0.02;
  updateSignals(dt);

  // hover (raycast only when not dragging, only visible cards)
  // While the button is held the hover target is frozen, so a click lands on it.
  let hit = hovered;
  if (!dragging) {
    hit = null;
    if (mouse.x > -2) {
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(visibleCards().map((c) => c.mesh), false);
      hit = hits.length ? hits[0].object.userData.card : null;
    }
  }
  if (hit !== hovered) {
    hovered = hit;
    document.body.classList.toggle('hovering', !!hit);
    const lbl = $('#hoverLabel');
    if (hit && !focused) { lbl.textContent = `${CAT[hit.cat].label} · ${hit.title}`; lbl.classList.add('show'); }
    else lbl.classList.remove('show');
  }

  // cards
  const k = 1 - Math.exp(-dt * 5);
  const viewH = 2 * 15 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const bounds = focused ? focusBounds() : null;
  tmpQ.copy(camera.quaternion);
  for (const c of cards) {
    let s;
    if (c === focused) {
      // centre the card in the screen space left free by the side panels
      const pxToWorld = (viewH * camera.aspect) / innerWidth;
      right.crossVectors(fwd, camera.up).normalize();
      target.copy(camera.position).addScaledVector(fwd, 15)
        .addScaledVector(camera.up, bounds.side ? 0 : 1.1)
        .addScaledVector(right, ((bounds.left + bounds.right) / 2 - innerWidth / 2) * pxToWorld);
      s = Math.min((0.62 * viewH) / CARD_H,
        (0.85 * (bounds.right - bounds.left) * pxToWorld) / (CARD_H * c.aspect));
    } else {
      target.copy(c.home).applyAxisAngle(yAxis, orbit);
      target.y += Math.sin(t * 0.8 + c.bob) * 0.35;
      s = c.shown ? cardScale * (c === hovered ? 1.25 : 1) : 0.001;
    }
    c.mesh.position.lerp(target, k);
    c.s += (s - c.s) * k;
    c.mesh.scale.set(CARD_H * c.aspect * c.s, CARD_H * c.s, 1);
    c.mesh.quaternion.copy(tmpQ);                                  // billboard
    c.mesh.visible = c.s > 0.01;
    c.mat.uniforms.uBorder.value = 0.05 / Math.max(c.s, 1);   // constant on-screen width
    const u = c.mat.uniforms;
    u.uHover.value += ((c === hovered || c === focused ? 1 : 0) - u.uHover.value) * k;
    u.uDim.value += ((focused && c !== focused ? 1 : 0) - u.uDim.value) * k;
  }

  updateSlogan(dt);
}

function renderOnce() { renderer.render(scene, camera); }

function frame(now) {
  if (!running) return;
  const dt = Math.min((now - last) / 1000, 0.05);   // clamp: no jump after a pause
  last = now;
  update(dt);
  renderer.render(scene, camera);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { $('#fps').textContent = `${Math.round(fpsFrames / fpsAcc)} fps`; fpsAcc = 0; fpsFrames = 0; }
  const d = new Date();
  if (d.getSeconds() !== lastSec) { lastSec = d.getSeconds(); $('#clock').textContent = d.toLocaleTimeString('fr-FR'); }

  rafId = requestAnimationFrame(frame);
}
function start() {
  if (running) return;
  running = true;
  last = performance.now();
  document.body.classList.remove('paused');
  rafId = requestAnimationFrame(frame);
}
function stop() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  document.body.classList.add('paused');
}
addEventListener('blur', stop);
addEventListener('focus', start);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (document.hasFocus()) start();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
  uPixelRatio.value = renderer.getPixelRatio();
  renderer.setSize(innerWidth, innerHeight, false);
  if (!running) renderOnce();
});

// ── Engine API used by files.js ──────────────────────────────────────────────
const toastEl = $('#toast');
let toastTimer = 0;
function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('bad', bad);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
const hub = {
  THREE, PARAMS, addCard, clearCards, buildTabs, setFilter, focus, unfocus, toast, setSlogans,
  hooks,
  get focused() { return focused; },
  get cards() { return cards; },
  setCategories(cat) { CAT = cat; filter = 'all'; },
  clearSearch() { query = ''; $('#search').value = ''; },
  setTitle(kicker, main, accent = '') {
    $('#kicker').textContent = kicker;
    $('#titleMain').textContent = main;
    $('#titleAccent').textContent = accent;
  },
  flyIn() { layout(); camDist = camDistTarget + 35; },
  refresh() { if (!running) renderOnce(); },
};

// ── Boot ─────────────────────────────────────────────────────────────────────
if (MODE === 'files') {
  document.body.classList.add('files');
  try {
    const { init } = await import('./files.js');
    await init(hub);
  } catch (err) {
    fail(`Explorateur indisponible : ${err.message}`);
  }
} else {
  // Gallery: thumbnails built by the launcher + original emblem cards.
  let gallery = [];
  try {
    const res = await fetch('gallery.json', { cache: 'no-store' });
    if (res.ok) gallery = await res.json();
  } catch { /* emblems only */ }

  for (const item of Array.isArray(gallery) ? gallery : []) {
    if (CAT[item.cat] && typeof item.src === 'string' && item.src.startsWith('thumbs/')) {
      addCard({ title: String(item.title).slice(0, 60), cat: item.cat, src: item.src, w: +item.w || 16, h: +item.h || 9 });
    }
  }
  for (const e of Object.values(EMBLEMS)) {
    if (!gallery.some((g) => e.test.test(g.title))) {
      addCard({ title: e.title, cat: e.cat, w: 512, h: 640, texture: emblemTexture(e.draw) });
    }
  }
  buildTabs();
  layout();
}

requestAnimationFrame(() => document.body.classList.remove('booting'));
if (document.hasFocus()) start();
else { update(0.016); renderOnce(); document.body.classList.add('paused'); }
