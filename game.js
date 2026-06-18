/* Cannonhill Mobile — an HTML5/touch recreation of the classic SDL artillery
 * game (originally by Dirk Plate; SDL2 port by univrsal). Faithful to the core
 * mechanics: midpoint-displacement layered terrain, per-pixel destructible &
 * collapsing ground, charge-and-fire cannons, real weapon stats, wind and an
 * adaptive AI. Rebuilt from scratch in JS for phones. */
'use strict';

//=================================================================== constants
// World height is fixed; width follows the device's landscape aspect ratio so the
// playfield fills the screen (no letterbox) on phones and tablets without distortion.
// 4:3 -> 640 (the original), 16:9 -> ~853, 19.5:9 -> ~1040. Clamped for sanity.
const H = 480;
const _sw = window.innerWidth || 640, _sh = window.innerHeight || 480;
const _aspect = Math.max(_sw, _sh) / Math.min(_sw, _sh);   // landscape ratio, orientation-agnostic
const W = Math.min(1280, Math.max(640, Math.round(H * _aspect / 2) * 2));
const G = 9.81;                      // gravity   (original: g)
const DT = 0.08;                     // sim timestep (original: t)
const CANNON_LEN = 20;               // KANONENLAENGE
const MAX_POWER = 50;                // MAXSCHUSSENERGIE
const MAX_HP = 1000;                 // MAXLEBENSENERGIE
const SNOW_D = 3, GRASS_D = 2, EARTH_D = 10; // layer thicknesses

// materials
const M_EMPTY = 0, M_GRASS = 1, M_WATER = 2, M_STONE = 3, M_SNOW = 4,
      M_EARTH = 5, M_ACID = 8;
// material colour + physics (mass/friction influence collapse behaviour)
const MAT = {
  [M_GRASS]: { r: 0,   g: 150, b: 0,   loose: 0.7 },
  [M_WATER]: { r: 100, g: 100, b: 255, loose: 1.0 },
  [M_STONE]: { r: 150, g: 150, b: 150, loose: 0.15 },
  [M_SNOW]:  { r: 255, g: 255, b: 255, loose: 0.9 },
  [M_EARTH]: { r: 140, g: 111, b: 50,  loose: 0.55 },
  [M_ACID]:  { r: 0,   g: 255, b: 0,   loose: 1.0 },
};
const COLOR_VAR = 15;                // ZFARBE — colour jitter per pixel

// weapons (index → stats), mirrors Munition[] in panzer.cpp
const W_ROCKET=1, W_SHIELD=2, W_STONE=3, W_GRENADE=4, W_LASER=5, W_GUN=6,
      W_BARREL=7, W_MEDI=8, W_MAGROCKET=9, W_MAGNET=10, W_MEGA=11, W_SNOWBALL=12;
const WEAPONS = {
  [W_ROCKET]:    { name:'Rocket',     short:'RKT', radius:20, dmg:300, price:70,  smoke:true },
  [W_SHIELD]:    { name:'Shield',     short:'SHLD',duration:500, price:200, support:true },
  [W_STONE]:     { name:'Stone',      short:'STN', radius:10, dmg:200, price:0,   crater:true },
  [W_GRENADE]:   { name:'Grenade',    short:'GRN', radius:10, dmg:300, price:80,  splinters:5, smoke:true },
  [W_LASER]:     { name:'Laser',      short:'LSR', dmg:500, price:250, instant:true },
  [W_GUN]:       { name:'Rifle',      short:'RFL', radius:5, dmg:300, price:150, straight:true },
  [W_BARREL]:    { name:'Acid Barrel',short:'ACD', radius:10, price:130, acid:true },
  [W_MEDI]:      { name:'Medi-Pack',  short:'MED', price:500, support:true, heal:true },
  [W_MAGROCKET]: { name:'Mag Rocket', short:'MRK', radius:20, dmg:300, price:155, smoke:true, magnetic:true },
  [W_MAGNET]:    { name:'Magnet',     short:'MAG', duration:500, price:180, support:true },
  [W_MEGA]:      { name:'Mega Bomb',  short:'MEG', price:850, mega:true },
  [W_SNOWBALL]:  { name:'Snowball',   short:'SNW', radius:20, price:25, snow:true },
};
const WEAPON_ORDER = [W_STONE, W_ROCKET, W_GRENADE, W_GUN, W_LASER, W_BARREL,
                      W_SNOWBALL, W_SHIELD, W_MAGNET, W_MAGROCKET, W_MEGA, W_MEDI];
const TANK_COLORS = [
  { r:230, g:40,  b:40,  name:'Red'    },
  { r:40,  g:200, b:40,  name:'Green'  },
  { r:60,  g:120, b:255, name:'Blue'   },
  { r:240, g:210, b:40,  name:'Yellow' },
];

//=================================================================== buffers
let mat = new Uint8Array(W * H);          // material id per pixel
let terrainCanvas, terrainCtx, terrainImg, terrainData; // offscreen colour buffer
let active = new Uint8Array(W * H);       // is pixel in the collapse sim?
let activeList = [];                      // working list for the powder sim

const idx = (x, y) => y * W + x;

//=================================================================== game state
const S_TITLE=0, S_SETUP=1, S_GAME=2, S_ROUND=3, S_SHOP=4, S_OVER=5;
let state = S_TITLE;

let canvas, ctx, scale = 1, offX = 0, offY = 0;
let tanks = [], shots = [], fx = [], debrisDust = [];
let wind = 0, windEnabled = true, weatherEnabled = false;
let round = 1, maxRounds = 3;
let humanCount = 1, aiCount = 2;
let shopPlayer = 0, shopList = [];
let roundWinner = -1, lastResultText = '';
let rng = Math.random;

//=================================================================== utilities
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function randInt(n) { return (Math.random() * n) | 0; }
function dist(ax, ay, bx, by) { const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }

//=================================================================== terrain
function setPixel(x, y, m) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  mat[i] = m;
  const d = terrainData, o = i * 4;
  if (m === M_EMPTY) { d[o+3] = 0; return; }
  const c = MAT[m];
  const jitter = (Math.random() * COLOR_VAR * 2 - COLOR_VAR) | 0;
  d[o]   = clamp(c.r + jitter, 0, 255);
  d[o+1] = clamp(c.g + jitter, 0, 255);
  d[o+2] = clamp(c.b + jitter, 0, 255);
  d[o+3] = 255;
}
function clearPixel(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  mat[i] = M_EMPTY;
  terrainData[i*4+3] = 0;
}
function solid(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  return mat[idx(x, y)] !== M_EMPTY;
}

// midpoint-displacement terrain, faithful to Compute() in panzer.cpp
function generateTerrain() {
  mat.fill(M_EMPTY);
  for (let i = 0; i < terrainData.length; i += 4) terrainData[i+3] = 0;

  let pts = [{ x:0, y:H - randInt(200) - 1 }, { x:W-1, y:H - randInt(200) - 1 }];
  while (pts.length * 2 - 1 <= 600) {
    const np = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i+1];
      np.push(a);
      const span = b.x - a.x;
      let my = ((a.y + b.y) / 2) | 0;
      if (i === 0) my -= randInt(Math.max(1, span/2 | 0));
      else my -= randInt(Math.max(1, span)) - (span/2 | 0);
      my = clamp(my, 100, H - 50);
      np.push({ x: (a.x + b.x) >> 1, y: my });
    }
    np.push(pts[pts.length-1]);
    pts = np;
  }

  // fill each column down from the surface with layered materials
  let pi = 1;
  for (let x = 0; x < W; x++) {
    while (pi < pts.length - 1 && pts[pi].x < x) pi++;
    const a = pts[pi-1], b = pts[pi];
    const top = (a.y + (x - a.x) * (b.y - a.y) / Math.max(1, (b.x - a.x))) | 0;
    for (let y = top; y < H; y++) {
      let m;
      if (y < top + SNOW_D) m = M_SNOW;
      else if (y < top + SNOW_D + GRASS_D) m = M_GRASS;
      else if (y < top + SNOW_D + GRASS_D + EARTH_D) m = M_EARTH;
      else m = M_STONE;
      setPixel(x, y, m);
    }
  }
  terrainDirty = true;
}

function surfaceY(x) {
  x = clamp(x, 0, W-1);
  for (let y = 0; y < H; y++) if (mat[idx(x, y)] !== M_EMPTY) return y;
  return H - 1;
}

//=================================================================== collapse sim
function activate(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  if (mat[i] === M_EMPTY || active[i]) return;
  active[i] = 1; activeList.push(i);
}
function activateAround(x, y) {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) activate(x+dx, y+dy);
}

// falling-sand style settling for activated pixels
function stepCollapse() {
  if (activeList.length === 0) return;
  const next = [];
  // process bottom-up so stacks fall correctly
  activeList.sort((a, b) => b - a);
  for (const i of activeList) {
    active[i] = 0;
    const m = mat[i];
    if (m === M_EMPTY) continue;
    const x = i % W, y = (i / W) | 0;
    if (y >= H-1) continue;
    const below = idx(x, y+1);
    if (mat[below] === M_EMPTY) {              // straight down
      mat[below] = m; mat[i] = M_EMPTY;
      copyColor(i, below);
      activate(x, y+1); activateAround(x, y-1);
      next.push(below); active[below] = 1;
      continue;
    }
    // try to slide for loose materials
    const loose = MAT[m].loose;
    if (Math.random() < loose) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      for (const dx of [dir, -dir]) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        if (mat[idx(nx, y)] === M_EMPTY && (y+1 >= H || mat[idx(nx, y+1)] === M_EMPTY)) {
          const ni = idx(nx, y);
          mat[ni] = m; mat[i] = M_EMPTY;
          copyColor(i, ni);
          activate(nx, y); activateAround(x, y-1);
          next.push(ni); active[ni] = 1;
          break;
        }
      }
    }
  }
  activeList = next;
  terrainDirty = true;
}
function copyColor(from, to) {
  const d = terrainData, a = from*4, b = to*4;
  d[b]=d[a]; d[b+1]=d[a+1]; d[b+2]=d[a+2]; d[b+3]=d[a+3];
  d[a+3]=0;
}

let terrainDirty = true;

//=================================================================== tanks
function makeTank(i, isHuman) {
  return {
    id: i, active: true, human: isHuman, computer: !isHuman,
    color: TANK_COLORS[i],
    x: 100, y: 100, hp: MAX_HP,
    angle: i < 2 ? 60 : 120,      // degrees, 0=right .. 180=left, measured up
    power: 25, charging: false, charge: 0, shotActive: false, noAmmo: 0,
    weapon: W_STONE,
    ammo: {}, money: 0, roundsWon: 0,
    shield: 0, magnet: 0,
    // AI memory
    target: -1, wishWeapon: W_STONE, wishAngle: 90,
    lastPower: 25, accuracy: MAX_POWER/2, tooFar: false, aimCount: 0, overshoot: false,
  };
}
function initInventory(t) {
  t.ammo = {};
  for (const w of WEAPON_ORDER) t.ammo[w] = 0;
  t.ammo[W_STONE] = -1;        // infinite
  t.ammo[W_ROCKET] = 4;
  t.ammo[W_SHIELD] = 1;
  t.ammo[W_GRENADE] = 2;
  t.ammo[W_BARREL] = 2;
  t.ammo[W_SNOWBALL] = 2;
  t.money = 0; t.roundsWon = 0;
}

function placeTanks() {
  const live = tanks.filter(t => t.active);
  const n = live.length;
  live.forEach((t, k) => {
    const x = clamp(((k + 1) * W / (n + 1)) | 0, 25, W-25);
    t.x = x;
    t.y = surfaceY(x) - 1;
    t.charge = 0; t.charging = false; t.shotActive = false;
    t.shield = 0; t.magnet = 0;
  });
}

function cannonTip(t) {
  const rad = t.angle * Math.PI / 180;
  return { x: t.x + Math.cos(rad) * CANNON_LEN, y: t.y - 10 - Math.sin(rad) * CANNON_LEN };
}

//=================================================================== firing
function fire(t) {
  if (!t.active) return;
  const w = t.weapon;
  if (t.ammo[w] === 0) return;
  const spec = WEAPONS[w];
  const power = clamp(t.charge, 8, MAX_POWER);

  if (w === W_SHIELD) { if (t.shield === 0) t.shield = spec.duration; }
  else if (w === W_MAGNET) { if (t.magnet === 0) t.magnet = spec.duration; }
  else if (w === W_MEDI) { changeHP(t, MAX_HP, -1); }
  else if (w === W_LASER) { fireLaser(t); }
  else {
    const rad = t.angle * Math.PI / 180;
    const dirx = Math.cos(rad) * CANNON_LEN, diry = -Math.sin(rad) * CANNON_LEN;
    const k = power / (MAX_POWER / 4);   // v = dir * energy/12.5  (panzer.cpp)
    const tip = cannonTip(t);
    shots.push({
      x: tip.x, y: tip.y, vx: dirx * k, vy: diry * k,
      w, owner: t.id, life: 600, outside: false, straight: !!spec.straight,
      magnetic: !!spec.magnetic, trail: 0,
    });
    t.shotActive = true;
  }
  if (t.ammo[w] > 0) t.ammo[w]--;
  t.charge = 0; t.charging = false;
  if (w !== W_SHIELD && w !== W_MAGNET && w !== W_MEDI && w !== W_LASER) {
    // AI bookkeeping
    if (t.target !== -1) t.lastPower = power;
  }
}

function fireLaser(t) {
  const rad = t.angle * Math.PI / 180;
  let x = t.x + Math.cos(rad) * 12, y = t.y - 10 - Math.sin(rad) * 12;
  const dx = Math.cos(rad), dy = -Math.sin(rad);
  playSfx('laser');
  for (let s = 0; s < 900; s++) {
    x += dx; y += dy;
    if (x < 0 || x >= W || y >= H) break;
    if (y < 0) continue;
    fx.push({ x, y, life: 6 + randInt(6), r:255, g:80, b:80 });
    const hit = tankAt(x|0, y|0, t.id);
    if (hit >= 0) { changeHP(tanks[hit], -WEAPONS[W_LASER].dmg, t.id); break; }
    if (solid(x|0, y|0)) { clearPixel(x|0, y|0); activateAround(x|0, y|0); terrainDirty = true; }
  }
}

function tankAt(x, y, exceptId) {
  for (const t of tanks) {
    if (!t.active || t.id === exceptId) continue;
    if (x >= t.x-9 && x <= t.x+9 && y >= t.y-14 && y <= t.y+2) return t.id;
  }
  return -1;
}

//=================================================================== shots update
function updateShots() {
  for (let s = shots.length - 1; s >= 0; s--) {
    const sh = shots[s];
    const spec = WEAPONS[sh.w];
    // forces
    if (!sh.straight) sh.vy += G * DT;
    if (windEnabled && wind !== 0 && (sh.y < surfaceY(clamp(sh.x|0,0,W-1)))) {
      sh.vx += clamp(wind * 1.5 - sh.vx, -Math.abs(wind), Math.abs(wind)) * 0.1;
    }
    if (sh.magnetic) applyMagnet(sh);

    const steps = Math.max(1, Math.ceil(Math.hypot(sh.vx, sh.vy) * DT));
    let exploded = false;
    for (let st = 0; st < steps && !exploded; st++) {
      sh.x += sh.vx * DT / steps;
      sh.y += sh.vy * DT / steps;
      if (sh.w === W_ROCKET || sh.w === W_MAGROCKET || sh.w === W_GRENADE) {
        if (st % 1 === 0) addSmoke(sh.x, sh.y, sh.w === W_GRENADE);
      }
      const ix = sh.x | 0, iy = sh.y | 0;
      if (sh.x < 0 || sh.x >= W) { aiObserveLanding(sh.owner, clamp(ix,0,W-1)); removeShot(s, sh); exploded = true; break; }
      if (sh.y >= H) { aiObserveLanding(sh.owner, ix); removeShot(s, sh); exploded = true; break; }
      if (sh.y < 0) continue;                       // arc above screen
      const hit = tankAt(ix, iy, sh.owner);
      if (hit >= 0 || solid(ix, iy)) { explode(sh); shots.splice(s, 1); exploded = true; break; }
    }
    if (exploded) continue;
    if (--sh.life <= 0) { explode(sh); shots.splice(s, 1); }
  }
}
function removeShot(s, sh) {
  const owner = tanks[sh.owner];
  if (owner) owner.shotActive = shots.some((o,i)=> i!==s && o.owner===sh.owner);
  shots.splice(s, 1);
}
function addSmoke(x, y, fire) {
  if (Math.random() < 0.6)
    fx.push({ x: x + randInt(3)-1, y: y + randInt(3)-1, life: 8+randInt(8),
      r: fire?255:120, g: fire?120:120, b: fire?0:120 });
}

function applyMagnet(sh) {
  // attracted toward nearest enemy tank / enemy magnet
  let best = null, bd = 1e9;
  for (const t of tanks) {
    if (!t.active || t.id === sh.owner) continue;
    const d = dist(sh.x, sh.y, t.x, t.y - 8);
    const strength = t.magnet ? 0.5 : 1;
    if (d * strength < bd) { bd = d * strength; best = t; }
  }
  if (best) {
    const dx = best.x - sh.x, dy = (best.y - 8) - sh.y, d = Math.hypot(dx, dy) || 1;
    const f = 60 / d;
    sh.vx += dx / d * f * DT; sh.vy += dy / d * f * DT;
  }
}

//=================================================================== explosions
function explode(sh) {
  const spec = WEAPONS[sh.w];
  const cx = sh.x | 0, cy = sh.y | 0;
  const owner = tanks[sh.owner];
  if (owner) owner.shotActive = shots.some(o => o !== sh && o.owner === sh.owner);

  if (spec.instant) return;

  if (spec.snow) {                      // snowball — adds snow
    forCircle(cx, cy, spec.radius, (x, y) => {
      if (!solid(x, y)) setPixel(x, y, M_SNOW), activate(x, y);
    });
    terrainDirty = true; playSfx('explosion'); return;
  }
  if (spec.acid) {                      // acid barrel — corrosive blob
    playSfx('explosion');
    forCircle(cx, cy, spec.radius, (x, y) => {
      clearPixel(x, y); setPixel(x, y, M_ACID); activate(x, y);
    });
    acidOwner = sh.owner;               // credit subsequent burn damage
    damageInRadius(cx, cy, spec.radius, spec.dmg || 100, sh.owner);
    terrainDirty = true; return;
  }
  if (spec.mega) {                      // mega bomb — spits sub-munitions
    playSfx('explosion');
    const kinds = [W_ROCKET, W_STONE, W_GRENADE, W_MAGROCKET, W_BARREL];
    for (let i = 0; i < 8; i++) {
      shots.push({ x: cx, y: cy, vx: 20 - randInt(40), vy: -randInt(40),
        w: kinds[randInt(kinds.length)], owner: sh.owner, life: 400,
        straight:false, magnetic:false, trail:0 });
    }
    spawnBlast(cx, cy, 12); return;
  }

  // generic carving explosion
  const radius = spec.radius || 10;
  playSfx(spec.crater ? 'stone' : 'explosion');
  forCircle(cx, cy, radius, (x, y, d) => {
    if (spec.crater) { if (Math.random() < 0.5) { clearPixel(x,y); } else { activateAround(x,y); } }
    else clearPixel(x, y);
    if (!spec.crater) fx.push({ x, y, life: (d/4 + randInt(5))|0,
      r: 255 - randInt(100), g: (d*10)|0, b: 0 });
  });
  // activate rim so terrain collapses into the crater
  for (let a = 0; a < 360; a += 8) {
    const rx = cx + Math.cos(a*Math.PI/180) * (radius+1);
    const ry = cy + Math.sin(a*Math.PI/180) * (radius+1);
    activateAround(rx|0, ry|0);
  }
  damageInRadius(cx, cy, radius, spec.dmg || 0, sh.owner);
  spawnBlast(cx, cy, radius);
  aiObserveLanding(sh.owner, cx);

  if (spec.splinters) {
    for (let i = 0; i < spec.splinters; i++) {
      shots.push({ x: cx, y: cy, vx: sh.vx + 20 - randInt(40),
        vy: sh.vy + 20 - randInt(40), w: W_GUN, owner: sh.owner,
        life: 120, straight:false, magnetic:false, trail:0 });
    }
  }
  terrainDirty = true;
}

function forCircle(cx, cy, r, fn) {
  const r2 = r * r;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) {
      const d2 = dx*dx + dy*dy;
      if (d2 > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      fn(x, y, Math.sqrt(d2));
    }
}
function damageInRadius(cx, cy, r, maxDmg, ownerId) {
  if (!maxDmg) return;
  for (const t of tanks) {
    if (!t.active) continue;
    const d = dist(cx, cy, t.x, t.y - 7);
    if (d > r + 8) continue;
    let dmg = maxDmg * (1 - d / (r + 8));
    if (dmg <= 0) continue;
    if (t.shield > 0) continue;       // shield blocks
    changeHP(t, -dmg | 0, ownerId);
  }
}
function spawnBlast(cx, cy, r) {
  for (let i = 0; i < r*3; i++) {
    const a = Math.random()*Math.PI*2, sp = Math.random()*r;
    fx.push({ x: cx + Math.cos(a)*sp*0.3, y: cy + Math.sin(a)*sp*0.3,
      life: 8+randInt(10), r:255, g: 120+randInt(120)|0, b: 0 });
  }
}

function changeHP(t, amount, byId) {
  if (amount === 0) return;
  t.hp += amount;
  if (byId !== -1 && byId !== t.id && amount < 0) {
    tanks[byId].money -= amount;       // reward = damage dealt
  }
  if (t.hp > MAX_HP) t.hp = MAX_HP;
  if (t.hp <= 0) {
    t.hp = 0; t.active = false;
    if (byId !== -1 && byId !== t.id) tanks[byId].money += 200;
    tankExplode(t);
  }
}
function tankExplode(t) {
  playSfx('tank');
  for (let i = 0; i < 60; i++) {
    const a = Math.random()*Math.PI*2, sp = 1 + Math.random()*3;
    fx.push({ x: t.x, y: t.y-7, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 1,
      life: 20+randInt(20), r:255, g: randInt(180)|0, b:0, grav:true });
  }
}

//=================================================================== FX
function updateFX() {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    if (f.grav) { f.vy += 0.15; f.x += f.vx; f.y += f.vy; }
    if (--f.life <= 0) fx.splice(i, 1);
  }
}

//=================================================================== weather
let weather = [];
function updateWeather() {
  if (!weatherEnabled) return;
  if (weather.length < 120 && Math.random() < 0.5)
    weather.push({ x: randInt(W), y: -2, v: 2 + Math.random()*2 });
  for (let i = weather.length - 1; i >= 0; i--) {
    const p = weather[i];
    p.y += p.v; p.x += wind * 0.2;
    if (p.y > H || p.x < 0 || p.x > W) weather.splice(i, 1);
  }
}

//=================================================================== AI
function updateAI() {
  for (const t of tanks) {
    if (!t.active || !t.computer || t.shotActive) continue;
    if (t.aiCooldown && t.aiCooldown > 0) { t.aiCooldown--; continue; }

    // choose / validate target
    if (t.target === -1 || !tanks[t.target] || !tanks[t.target].active) {
      const foes = tanks.filter(o => o.active && o.id !== t.id);
      if (!foes.length) continue;
      t.target = foes[randInt(foes.length)].id;
      t.accuracy = MAX_POWER/2; t.lastPower = 25; t.aimCount = 0;
    }
    const foe = tanks[t.target];

    // pick weapon occasionally
    if (t.ammo[t.weapon] === 0 || t.aimCount % 6 === 0) {
      const opts = WEAPON_ORDER.filter(w => t.ammo[w] !== 0 &&
        !(w === W_MEDI && t.hp > MAX_HP/2) && !(w===W_SHIELD) && !(w===W_MAGNET) &&
        !(w===W_MEDI && t.hp>MAX_HP*0.6));
      const pool = opts.length ? opts : [W_STONE];
      // bias toward stronger weapons when available
      t.weapon = pool[randInt(pool.length)];
    }
    // sometimes self-heal / shield
    if (t.hp < MAX_HP*0.3 && t.ammo[W_MEDI] !== 0 && Math.random()<0.5) t.weapon = W_MEDI;

    // aim toward the foe. aimAdjust steepens the arc (toward vertical) when our
    // shots keep falling short — typically because a hill is in the way.
    const dirRight = foe.x > t.x;
    const adj = clamp(t.aimAdjust || 0, 0, 38);
    t.angle = dirRight ? (52 + adj) : (128 - adj);
    t.angle = clamp(t.angle, 18, 162);

    if (t.weapon === W_MEDI) { fire(t); t.weapon = W_STONE; t.aiCooldown = 20; continue; }

    // adaptive power search (mirrors the original's too-far / too-short logic):
    // bracket the target by stepping power up/down and halving the step each
    // time the shot crosses from short to long (or vice-versa).
    let wishPower;
    if (t.aimCount === 0) wishPower = 28;
    else if (t.tooFar) wishPower = t.lastPower - t.accuracy;
    else wishPower = t.lastPower + t.accuracy;
    wishPower = clamp(wishPower, 10, MAX_POWER);
    t.charge = wishPower;
    fire(t);
    t.aimCount++;
    t.aiCooldown = 22 + randInt(16);
  }
}
// called when an AI shot lands, to refine the next shot's power
function aiObserveLanding(ownerId, landX) {
  const t = tanks[ownerId];
  if (!t || !t.computer || t.target === -1 || !tanks[t.target] || !tanks[t.target].active) return;
  const foe = tanks[t.target];
  // "too far" = the shot overshot the foe relative to our position
  const overshot = (t.x > foe.x) ? (landX < foe.x) : (landX > foe.x);
  // if the over/undershoot flipped, we've bracketed the target → tighten
  if (t.aimCount > 0 && overshot !== t.tooFar) t.accuracy = Math.max(2, (t.accuracy * 0.5) | 0);
  t.tooFar = overshot;
  // track short shots: a run of them means terrain is blocking us, so steepen
  // the arc to lob over it; a good hit relaxes back toward a flat trajectory.
  const miss = Math.abs(landX - foe.x);
  if (!overshot && miss > 25) {
    t.shortStreak = (t.shortStreak || 0) + 1;
    if (t.shortStreak >= 2) { t.aimAdjust = clamp((t.aimAdjust || 0) + 7, 0, 38); t.accuracy = MAX_POWER/2; }
  } else {
    t.shortStreak = 0;
    if (miss < 20) t.aimAdjust = Math.max(0, (t.aimAdjust || 0) - 3);
  }
}

//=================================================================== round flow
function startGame() {
  tanks = [];
  let i = 0;
  for (; i < humanCount; i++) tanks.push(makeTank(i, true));
  for (let a = 0; a < aiCount; a++, i++) tanks.push(makeTank(i, false));
  tanks.forEach(initInventory);
  round = 1;
  startRound();
}
function startRound() {
  shots = []; fx = []; weather = []; activeList = []; active.fill(0);
  tanks.forEach(t => { t.active = true; t.hp = MAX_HP; t.target = -1;
    t.weapon = W_STONE; t.aiCooldown = 30 + randInt(30); t.aimAdjust = 0; });
  generateTerrain();
  placeTanks();
  wind = windEnabled ? (Math.random()*8 - 4) : 0;
  roundTimer = 0;
  state = S_GAME;
  startMusic();
}
let roundTimer = 0;
const SUDDEN_DEATH = 30 * 75;     // ~75s before the storm rolls in
function checkRoundEnd() {
  // sudden death: after a long stalemate, the lowest-HP tanks erode each second
  roundTimer++;
  if (roundTimer > SUDDEN_DEATH && roundTimer % 30 === 0) {
    const live = tanks.filter(t => t.active);
    if (live.length > 1) {
      live.sort((a,b)=>a.hp-b.hp);
      for (let k = 0; k < live.length - 1; k++) changeHP(live[k], -50, -1);
    }
  }
  const live = tanks.filter(t => t.active);
  if (live.length <= 1 && shots.length === 0) {
    roundWinner = live.length ? live[0].id : -1;
    if (roundWinner >= 0) tanks[roundWinner].roundsWon++;
    state = S_ROUND;
  }
}
function nextAfterRound() {
  if (round >= maxRounds) {
    state = S_OVER;
  } else {
    round++;
    shopPlayer = 0;
    enterShop();
  }
}
function enterShop() {
  // find next human to shop; AIs auto-buy
  while (shopPlayer < tanks.length && tanks[shopPlayer].computer) {
    aiShop(tanks[shopPlayer]); shopPlayer++;
  }
  if (shopPlayer >= tanks.length) { startRound(); return; }
  state = S_SHOP;
}
function aiShop(t) {
  let guard = 50;
  while (guard-- > 0) {
    const affordable = WEAPON_ORDER.filter(w => WEAPONS[w].price > 0 && WEAPONS[w].price <= t.money);
    if (!affordable.length) break;
    const w = affordable[randInt(affordable.length)];
    t.money -= WEAPONS[w].price;
    t.ammo[w] = (t.ammo[w] === -1 ? -1 : (t.ammo[w]||0) + 1);
    if (Math.random() < 0.3) break;
  }
}

//=================================================================== rendering
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  // world aspect already matches the device, so cover the viewport completely
  scale = Math.max(vw / W, vh / H);
  canvas.style.width = (W * scale) + 'px';
  canvas.style.height = (H * scale) + 'px';
  offX = (vw - W*scale) / 2; offY = (vh - H*scale) / 2;
  document.getElementById('rotate').style.display = (vw < vh) ? 'flex' : 'none';
}

let skyGrad = null;
function drawSky() {
  if (!skyGrad) {
    skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, '#2b6fd6');
    skyGrad.addColorStop(0.55, '#7db4ec');
    skyGrad.addColorStop(1, '#cfe6fb');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);
  // a couple of soft clouds
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  cloud(110, 90, 1.1); cloud(430, 70, 0.8); cloud(300, 130, 0.6);
}
function cloud(x, y, s) {
  ctx.beginPath();
  ctx.ellipse(x, y, 50*s, 18*s, 0, 0, 7);
  ctx.ellipse(x+40*s, y+6*s, 34*s, 14*s, 0, 0, 7);
  ctx.ellipse(x-40*s, y+6*s, 34*s, 14*s, 0, 0, 7);
  ctx.fill();
}

function drawTank(t) {
  const x = t.x, y = t.y;
  ctx.save();
  ctx.translate(x, y);
  // shield bubble
  if (t.shield > 0) {
    ctx.strokeStyle = 'rgba(120,200,255,'+(0.4+0.3*Math.sin(Date.now()/120))+')';
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -7, 20, 0, 7); ctx.stroke();
  }
  // body
  const c = t.color;
  ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
  ctx.fillRect(-10, -8, 20, 7);
  ctx.fillStyle = `rgb(${(c.r*0.7)|0},${(c.g*0.7)|0},${(c.b*0.7)|0})`;
  ctx.fillRect(-11, -3, 22, 4);
  // turret dome
  ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
  ctx.beginPath(); ctx.arc(0, -8, 6, Math.PI, 0); ctx.fill();
  // cannon
  const rad = t.angle * Math.PI / 180;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -10);
  ctx.lineTo(Math.cos(rad)*CANNON_LEN, -10 - Math.sin(rad)*CANNON_LEN); ctx.stroke();
  ctx.restore();

  // health + ammo plate (like the original's little box under each tank)
  const bx = x - 11, by = y + 4;
  ctx.fillStyle = 'rgba(240,240,240,0.85)';
  ctx.fillRect(bx, by, 22, 6);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(bx+1, by+1, 20, 4);
  ctx.fillStyle = '#27ae60';
  ctx.fillRect(bx+1, by+1, (20 * t.hp / MAX_HP)|0, 4);
}

function drawCharge(t) {
  if (t.noAmmo > 0) {
    const by = t.y - 26;
    ctx.font = 'bold 8px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('✕ NO AMMO', t.x + 1, by + 1);
    ctx.fillStyle = '#ff5252'; ctx.fillText('✕ NO AMMO', t.x, by);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    return;
  }
  if (!t.charging) return;
  const tip = cannonTip(t);
  const w = 22, h = 4, bx = t.x - w/2, by = t.y - 26;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx-1, by-1, w+2, h+2);
  ctx.fillStyle = '#f1c40f'; ctx.fillRect(bx, by, w * t.charge / MAX_POWER, h);
  const pct = Math.round(t.charge / MAX_POWER * 100);
  ctx.font = '7px -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(pct + '%', t.x + 1, by - 1);
  ctx.fillStyle = '#fff'; ctx.fillText(pct + '%', t.x, by - 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function render() {
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  drawSky();

  if (terrainDirty) { terrainCtx.putImageData(terrainImg, 0, 0); terrainDirty = false; }
  ctx.drawImage(terrainCanvas, 0, 0);

  // weather
  if (weatherEnabled) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const p of weather) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - wind*0.4, p.y + 4); }
    ctx.stroke();
  }

  // fx
  for (const f of fx) {
    ctx.fillStyle = `rgba(${f.r|0},${f.g|0},${f.b|0},${clamp(f.life/15,0,1)})`;
    ctx.fillRect(f.x|0, f.y|0, 2, 2);
  }
  // shots
  for (const sh of shots) {
    ctx.fillStyle = '#111';
    ctx.fillRect((sh.x|0)-1, (sh.y|0)-1, 3, 3);
  }
  for (const t of tanks) if (t.active) { drawTank(t); drawCharge(t); }

  drawHUD();
}

function drawHUD() {
  // wind arrow + round, top-center
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(W/2-70, 6, 140, 22);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign='center';
  ctx.fillText(`Round ${round}/${maxRounds}`, W/2, 21);
  // wind
  if (windEnabled) {
    ctx.save(); ctx.translate(W/2 + 52, 17);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
    const dir = Math.sign(wind), len = clamp(Math.abs(wind)*3, 4, 22);
    ctx.moveTo(-len*dir/2, 0); ctx.lineTo(len*dir/2, 0);
    ctx.moveTo(len*dir/2, 0); ctx.lineTo(len*dir/2 - 4*dir, -3);
    ctx.moveTo(len*dir/2, 0); ctx.lineTo(len*dir/2 - 4*dir, 3);
    ctx.stroke(); ctx.restore();
    ctx.fillText('Wind', W/2 - 48, 21);
  }
}

//=================================================================== main loop
let lastSim = 0;
const SIM_MS = 1000/30;
function frame(ts) {
  requestAnimationFrame(frame);
  if (state === S_GAME) {
    if (!lastSim) lastSim = ts;
    // if too much time has elapsed (round just started, tab was hidden, etc.)
    // don't try to "catch up" with a burst of steps — that looks like the game
    // briefly running fast. Snap the clock forward and resume at normal speed.
    if (ts - lastSim > SIM_MS * 5) lastSim = ts - SIM_MS;
    while (ts - lastSim >= SIM_MS) {
      simStep();
      lastSim += SIM_MS;
    }
    render();
    syncHumanWeaponUI();
  } else {
    // keep the sim clock fresh while on menus/shop so returning to play
    // doesn't accumulate a backlog of steps.
    lastSim = 0;
  }
}
function simStep() {
  // human continuous input
  for (const t of tanks) {
    if (!t.active || !t.human) continue;
    if (input.left) t.angle = clamp(t.angle + 1.6, 5, 175);
    if (input.right) t.angle = clamp(t.angle - 1.6, 5, 175);
    if (t.charging) t.charge = Math.min(MAX_POWER, t.charge + 1);
    if (t.noAmmo > 0) t.noAmmo--;
    if (t.shield > 0) t.shield--;
    if (t.magnet > 0) t.magnet--;
  }
  for (const t of tanks) { if (t.computer) { if (t.shield>0)t.shield--; if(t.magnet>0)t.magnet--; } }

  updateAI();
  updateShots();
  // run a few collapse iterations per step for responsive terrain
  for (let i = 0; i < 3; i++) stepCollapse();
  // acid eats terrain it touches
  updateAcid();
  updateFX();
  updateWeather();
  checkRoundEnd();
}

let acidTimer = 0;
let acidOwner = -1;
const ACID_BITE = 1.4;      // hp lost per acid pixel absorbed
const ACID_ABSORB = 16;     // max pixels a tank absorbs per tick (paces the burn)
function updateAcid() {
  acidTimer++;
  if (acidTimer % 4 !== 0) return;

  // acid touching a tank is absorbed and burns it — damage over time
  for (const t of tanks) {
    if (!t.active || t.shield > 0) continue;
    let absorbed = 0;
    for (let y = (t.y-14)|0; y <= t.y+2 && absorbed < ACID_ABSORB; y++) {
      for (let x = (t.x-9)|0; x <= t.x+9 && absorbed < ACID_ABSORB; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        if (mat[idx(x, y)] !== M_ACID) continue;
        clearPixel(x, y); activateAround(x, y); absorbed++;
        fx.push({ x, y, life: 6+randInt(6), r: 60, g: 255, b: 60 });
      }
    }
    if (absorbed > 0) {
      changeHP(t, -Math.max(1, Math.round(absorbed * ACID_BITE)), acidOwner);
      terrainDirty = true;
    }
  }

  // acid pixels slowly dissolve neighbouring non-acid terrain
  // sample: scan active acid by checking a random subset for performance
  for (let n = 0; n < 400; n++) {
    const i = randInt(W*H);
    if (mat[i] !== M_ACID) continue;
    const x = i % W, y = (i/W)|0;
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    const d = dirs[randInt(4)];
    const nx = x+d[0], ny = y+d[1];
    if (nx<0||nx>=W||ny<0||ny>=H) continue;
    const ni = idx(nx,ny);
    if (mat[ni] !== M_EMPTY && mat[ni] !== M_ACID) {
      clearPixel(nx, ny); activateAround(nx, ny); terrainDirty = true;
    }
  }
}

//=================================================================== input
const input = { left:false, right:false };
function humanTank() { return tanks.find(t => t.active && t.human); }

function bindButton(el, on, off) {
  const start = e => { e.preventDefault(); on(); };
  const end = e => { e.preventDefault(); off && off(); };
  el.addEventListener('touchstart', start, {passive:false});
  el.addEventListener('touchend', end, {passive:false});
  el.addEventListener('touchcancel', end, {passive:false});
  el.addEventListener('mousedown', start);
  window.addEventListener('mouseup', end);
}

function setupControls() {
  bindButton(document.getElementById('btnLeft'),  ()=>input.left=true,  ()=>input.left=false);
  bindButton(document.getElementById('btnRight'), ()=>input.right=true, ()=>input.right=false);
  bindButton(document.getElementById('btnFire'),
    ()=>{ const t=humanTank(); if(t){ if(t.ammo[t.weapon]===0){ t.noAmmo=45; } else if(WEAPONS[t.weapon].support||WEAPONS[t.weapon].instant){ t.charge=MAX_POWER; fire(t);} else { t.charging=true; t.charge=Math.max(t.charge,2);} } },
    ()=>{ const t=humanTank(); if(t && t.charging) fire(t); });
  document.getElementById('btnPrev').addEventListener('click', ()=>cycleWeapon(-1));
  document.getElementById('btnNext').addEventListener('click', ()=>cycleWeapon(1));
  document.getElementById('btnMenu').addEventListener('click', ()=>{ state=S_TITLE; showScreen('title'); });
}
function cycleWeapon(dir) {
  const t = humanTank(); if (!t) return;
  let i = WEAPON_ORDER.indexOf(t.weapon);
  for (let n = 0; n < WEAPON_ORDER.length; n++) {
    i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    if (t.ammo[WEAPON_ORDER[i]] !== 0) { t.weapon = WEAPON_ORDER[i]; break; }
  }
  syncHumanWeaponUI();
}
function syncHumanWeaponUI() {
  const t = humanTank(); if (!t) return;
  const spec = WEAPONS[t.weapon];
  document.getElementById('wName').textContent = spec.name;
  const a = t.ammo[t.weapon];
  document.getElementById('wAmmo').textContent = a === -1 ? '∞' : a;
}

//=================================================================== sound (WebAudio, synthesised — no asset files needed)
let actx = null, musicGain = null, musicNode = null;
function ensureAudio() { if (!actx) { try { actx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){} } }
function playSfx(kind) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  const now = actx.currentTime;
  if (kind === 'explosion' || kind === 'tank') {
    o.type='sawtooth'; o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(40, now+0.4);
    g.gain.setValueAtTime(0.3, now); g.gain.exponentialRampToValueAtTime(0.001, now+0.45);
    o.start(now); o.stop(now+0.45);
  } else if (kind === 'stone') {
    o.type='triangle'; o.frequency.setValueAtTime(200, now);
    o.frequency.exponentialRampToValueAtTime(80, now+0.2);
    g.gain.setValueAtTime(0.2, now); g.gain.exponentialRampToValueAtTime(0.001, now+0.2);
    o.start(now); o.stop(now+0.2);
  } else if (kind === 'laser') {
    o.type='square'; o.frequency.setValueAtTime(900, now);
    o.frequency.exponentialRampToValueAtTime(200, now+0.25);
    g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now+0.25);
    o.start(now); o.stop(now+0.25);
  } else if (kind === 'fire') {
    o.type='square'; o.frequency.setValueAtTime(300, now);
    o.frequency.exponentialRampToValueAtTime(120, now+0.15);
    g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.001, now+0.15);
    o.start(now); o.stop(now+0.15);
  }
}
let muted = false;
function startMusic() {/* music intentionally minimal; SFX only */}

//=================================================================== screens
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('show');
  if (id) document.getElementById(id).classList.add('show');
  document.getElementById('hud').style.display = (id ? 'none' : 'flex');
  document.getElementById('topbar').style.display = (id ? 'none' : 'flex');
}

function buildSetup() {
  document.getElementById('aiCountVal').textContent = aiCount;
  document.getElementById('roundsVal').textContent = maxRounds;
  document.getElementById('windChk').checked = windEnabled;
  document.getElementById('weatherChk').checked = weatherEnabled;
}

function buildRoundScreen() {
  const el = document.getElementById('roundResult');
  const winner = roundWinner >= 0 ? tanks[roundWinner] : null;
  el.innerHTML = `<h1>${winner ? winner.color.name + ' wins the round!' : 'Draw'}</h1>` +
    '<table class="scores"><tr><th>Player</th><th>Rounds</th><th>$</th></tr>' +
    tanks.map(t => `<tr><td style="color:rgb(${t.color.r},${t.color.g},${t.color.b})">${t.color.name}${t.human?' (You)':''}</td><td>${t.roundsWon}</td><td>${t.money}</td></tr>`).join('') +
    '</table>';
}

function buildShop() {
  const t = tanks[shopPlayer];
  document.getElementById('shopTitle').textContent = `${t.color.name} — Shop`;
  document.getElementById('shopMoney').textContent = t.money;
  const list = document.getElementById('shopList');
  list.innerHTML = '';
  for (const w of WEAPON_ORDER) {
    const spec = WEAPONS[w];
    if (spec.price <= 0) continue;
    const row = document.createElement('div');
    row.className = 'shopRow';
    const have = t.ammo[w] === -1 ? '∞' : (t.ammo[w]||0);
    row.innerHTML = `<span class="sn">${spec.name}</span><span class="sp">$${spec.price}</span><span class="sh">x${have}</span>`;
    const buy = document.createElement('button');
    buy.textContent = 'Buy';
    buy.disabled = t.money < spec.price;
    buy.onclick = () => {
      if (t.money >= spec.price) {
        t.money -= spec.price;
        t.ammo[w] = (t.ammo[w]===-1?-1:(t.ammo[w]||0)+1);
        playSfx('fire'); buildShop();
      }
    };
    row.appendChild(buy);
    list.appendChild(row);
  }
}

function buildOver() {
  const ranked = [...tanks].sort((a,b)=> b.roundsWon - a.roundsWon || b.money - a.money);
  const champ = ranked[0];
  document.getElementById('overResult').innerHTML =
    `<h1>${champ.color.name} is the Champion!</h1>` +
    '<table class="scores"><tr><th>#</th><th>Player</th><th>Rounds</th></tr>' +
    ranked.map((t,i)=>`<tr><td>${i+1}</td><td style="color:rgb(${t.color.r},${t.color.g},${t.color.b})">${t.color.name}${t.human?' (You)':''}</td><td>${t.roundsWon}</td></tr>`).join('') +
    '</table>';
}

//=================================================================== wiring
function setupMenus() {
  document.getElementById('startBtn').addEventListener('click', () => { ensureAudio(); buildSetup(); showScreen('setup'); });
  document.getElementById('howBtn').addEventListener('click', () => showScreen('help'));
  document.getElementById('helpBack').addEventListener('click', () => showScreen('title'));

  document.getElementById('aiMinus').onclick = () => { aiCount = clamp(aiCount-1, 1, 3); buildSetup(); };
  document.getElementById('aiPlus').onclick  = () => { aiCount = clamp(aiCount+1, 1, 3); buildSetup(); };
  document.getElementById('rMinus').onclick = () => { maxRounds = clamp(maxRounds-1, 1, 9); buildSetup(); };
  document.getElementById('rPlus').onclick  = () => { maxRounds = clamp(maxRounds+1, 1, 9); buildSetup(); };
  document.getElementById('windChk').onchange = e => windEnabled = e.target.checked;
  document.getElementById('weatherChk').onchange = e => weatherEnabled = e.target.checked;
  document.getElementById('setupBack').onclick = () => showScreen('title');
  document.getElementById('playBtn').onclick = () => { humanCount = 1; ensureAudio(); showScreen(null); startGame(); };

  document.getElementById('roundNext').onclick = () => nextAfterRound();
  document.getElementById('shopDone').onclick = () => {
    shopPlayer++;
    enterShop();
    if (state === S_SHOP) buildShop();
  };
  document.getElementById('overMenu').onclick = () => { state = S_TITLE; showScreen('title'); };
}

// watch state changes that need a DOM screen
let lastState = -1;
setInterval(() => {
  if (state === lastState) return;
  lastState = state;
  if (state === S_TITLE) showScreen('title');
  else if (state === S_GAME) showScreen(null);
  else if (state === S_ROUND) { buildRoundScreen(); showScreen('round'); }
  else if (state === S_SHOP) { buildShop(); showScreen('shop'); }
  else if (state === S_OVER) { buildOver(); showScreen('over'); }
}, 80);

//=================================================================== boot
function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  ctx.imageSmoothingEnabled = false;

  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = W; terrainCanvas.height = H;
  terrainCtx = terrainCanvas.getContext('2d');
  terrainImg = terrainCtx.createImageData(W, H);
  terrainData = terrainImg.data;

  window.addEventListener('resize', resize);
  resize();
  setupControls();
  setupMenus();
  showScreen('title');
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
window.addEventListener('load', boot);
