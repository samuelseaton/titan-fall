// ─────────────────────────────────────────────
//  Colossus Break — game.js
// ─────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ── Constants ────────────────────────────────
const GRAVITY = 0.45;
const ROPE_LEN_MAX = 260;
const PLAYER_RADIUS = 8;
const SLASH_RADIUS_BASE = 28;
const GROUND_Y = H - 80;       // top of wall base
const WALL_TOP_Y = H - 110;    // battlements top
const WALL_X = W * 0.72;       // right wall inner face

// Anchor points (rooftops / battlements)
const ANCHORS = [
  { x: 80,  y: 260 },
  { x: 200, y: 200 },
  { x: 330, y: 240 },
  { x: 460, y: 190 },
  { x: 590, y: 220 },
  { x: 680, y: WALL_TOP_Y - 10 },
  { x: 750, y: WALL_TOP_Y - 30 },
  { x: 820, y: WALL_TOP_Y - 10 },
  { x: 120, y: 360 },
  { x: 400, y: 340 },
  { x: 540, y: 320 },
];

// ── Upgrade state ─────────────────────────────
const upgrades = {
  grapple: 0,   // max 4
  blade:   0,   // max 4
  cannon:  0,   // max 4
  wall:    0,   // max 4 (repairs only)
};

const UPGRADE_COSTS = {
  grapple: [20, 30, 45, 60],
  blade:   [20, 30, 45, 60],
  cannon:  [25, 35, 50, 70],
  wall:    [30, 40, 55, 75],
};

function grappleSpeed()   { return 8 + upgrades.grapple * 2; }
function slashRadius()    { return SLASH_RADIUS_BASE + upgrades.blade * 8; }
function cannonDamage()   { return 2 + upgrades.cannon * 2; }

// ── Mouse ─────────────────────────────────────
const mouse = { x: 0, y: 0 };
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (W / rect.width);
  mouse.y = (e.clientY - rect.top)  * (H / rect.height);
});

// ── Game state ────────────────────────────────
let state = 'title';  // title | playing | upgrade | gameover
let hintTimer = 360;  // frames to show in-game hints
let wave  = 0;
let kills = 0;
let points = 0;
let wallHP = 100;
let totalColossiThisWave = 0;

// ── Player ────────────────────────────────────
const player = {
  x: 420, y: 300,
  vx: 0,  vy: 0,
  grounded: false,
  grappling: false,
  anchorX: 0, anchorY: 0,
  ropeLen: 0,
  slashing: false,
  slashTimer: 0,
  dead: false,
};

// ── Colossi ───────────────────────────────────
let colossi = [];

// ── Projectiles (cannon shots) ────────────────
let cannonBalls = [];

// ── Visual effects ────────────────────────────
let particles = [];
let screenShake = 0;

// ── Cannons on the wall ───────────────────────
const CANNONS = [
  { x: WALL_X + 20, y: WALL_TOP_Y + 10, cooldown: 0, maxCooldown: 140 },
  { x: WALL_X + 20, y: WALL_TOP_Y + 50, cooldown: 70, maxCooldown: 140 },
];

// ─────────────────────────────────────────────
//  Colossus factory
// ─────────────────────────────────────────────
function createColossus(spawnIndex) {
  const scaleFactor = 1 + wave * 0.12;
  const h = (180 + Math.random() * 80) * Math.min(scaleFactor, 2.2);
  const w = h * 0.52;
  const speed = (0.28 + wave * 0.04) * (0.85 + Math.random() * 0.3);
  const maxHP = Math.floor((60 + wave * 20) * scaleFactor);

  // Weak-point position relative to colossus origin (top-center of body)
  const wpOffsetX = (Math.random() - 0.5) * w * 0.5;
  const wpOffsetY = h * (0.15 + Math.random() * 0.25);

  return {
    x: -w - spawnIndex * 60,
    y: GROUND_Y - h,
    w, h, speed,
    hp: maxHP, maxHP,
    dead: false,
    reachedWall: false,
    breachTimer: 0,
    wpOffX: wpOffsetX,
    wpOffY: wpOffsetY,
    wpGlow: 0,
    hitFlash: 0,
  };
}

// ─────────────────────────────────────────────
//  Wave spawning
// ─────────────────────────────────────────────
function startWave() {
  wave++;
  const count = 2 + Math.floor(wave * 1.2);
  totalColossiThisWave = count;
  colossi = [];
  for (let i = 0; i < count; i++) {
    colossi.push(createColossus(i));
  }
  cannonBalls = [];
  particles = [];
  state = 'playing';
  updateHUD();
}

// ─────────────────────────────────────────────
//  Input
// ─────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup',   e => { keys[e.code] = false; });

canvas.addEventListener('mousedown', e => {
  if (state !== 'playing' || e.button !== 0) return;
  // Find anchor nearest to mouse cursor that the player can reach
  let best = null, bestDistToMouse = Infinity;
  for (const a of ANCHORS) {
    if (dist(player.x, player.y, a.x, a.y) > ROPE_LEN_MAX) continue;
    const d = dist(mouse.x, mouse.y, a.x, a.y);
    if (d < bestDistToMouse) { bestDistToMouse = d; best = a; }
  }
  if (best) {
    player.grappling = true;
    player.anchorX = best.x;
    player.anchorY = best.y;
    const d = dist(player.x, player.y, best.x, best.y);
    player.ropeLen = Math.max(60, d);
    if (Math.abs(player.vx) < 1 && Math.abs(player.vy) < 1) {
      player.vx = -3; player.vy = -2;
    }
  }
});

canvas.addEventListener('mouseup', e => {
  if (e.button === 0) releaseGrapple();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && state === 'playing') {
    e.preventDefault();
    triggerSlash();
  }
});

function releaseGrapple() {
  if (!player.grappling) return;
  player.grappling = false;
  // vx/vy already correct — no conversion needed with constraint model
}

function triggerSlash() {
  if (player.slashing) return;
  player.slashing = true;
  player.slashTimer = 18;
  checkSlashHit();
}

// ─────────────────────────────────────────────
//  Slash hit detection
// ─────────────────────────────────────────────
function checkSlashHit() {
  const r = slashRadius();
  for (const c of colossi) {
    if (c.dead) continue;
    const wpX = c.x + c.w / 2 + c.wpOffX;
    const wpY = c.y + c.wpOffY;
    if (dist(player.x, player.y, wpX, wpY) < r + 14) {
      killColossus(c);
    }
  }
}

function killColossus(c) {
  c.dead = true;
  kills++;
  points += 10 + wave * 5;
  screenShake = 18;
  spawnParticles(c.x + c.w / 2, c.y + c.h / 2, 40, '#f0c060', '#e04030');
  updateHUD();
}

// ─────────────────────────────────────────────
//  Physics update
// ─────────────────────────────────────────────
function updatePlayer(dt) {
  if (player.dead) return;

  if (player.grappling) {
    updateSwing(dt);
  } else {
    updateFreeFlight(dt);
  }

  // Slash timer
  if (player.slashing) {
    player.slashTimer -= dt * 60;
    if (player.slashTimer <= 0) player.slashing = false;
  }

}

function updateSwing(dt) {
  // Reel in / out with W/S (optional, not required)
  if (keys['KeyW'] || keys['ArrowUp'])   player.ropeLen = Math.max(40,          player.ropeLen - grappleSpeed() * dt * 60);
  if (keys['KeyS'] || keys['ArrowDown']) player.ropeLen = Math.min(ROPE_LEN_MAX, player.ropeLen + 5 * dt * 60);

  // Mouse steers the swing — apply force toward cursor
  const tmx = mouse.x - player.x;
  const tmy = mouse.y - player.y;
  const tmLen = Math.sqrt(tmx * tmx + tmy * tmy);
  if (tmLen > 5) {
    const strength = 1.4;
    player.vx += (tmx / tmLen) * strength * dt * 60;
    player.vy += (tmy / tmLen) * strength * dt * 60;
  }

  // Gravity
  player.vy += GRAVITY * dt * 60;

  // Move
  player.x += player.vx * dt * 60;
  player.y += player.vy * dt * 60;

  // Rope constraint
  const dx = player.x - player.anchorX;
  const dy = player.y - player.anchorY;
  const d  = Math.sqrt(dx * dx + dy * dy);
  if (d > player.ropeLen) {
    const nx = dx / d, ny = dy / d;
    player.x = player.anchorX + nx * player.ropeLen;
    player.y = player.anchorY + ny * player.ropeLen;
    const vDotN = player.vx * nx + player.vy * ny;
    if (vDotN > 0) {
      player.vx -= vDotN * nx;
      player.vy -= vDotN * ny;
    }
  }

  // Ground
  if (player.y >= GROUND_Y - PLAYER_RADIUS) {
    player.y = GROUND_Y - PLAYER_RADIUS;
    releaseGrapple();
    player.vy = 0;
    player.grounded = true;
  }

  player.x = Math.max(10, Math.min(W - 10, player.x));
}

function updateFreeFlight(dt) {
  const wasGrounded = player.grounded;

  if (wasGrounded) {
    // Snappy ground walk
    if      (keys['KeyA'] || keys['ArrowLeft'])  player.vx = -5;
    else if (keys['KeyD'] || keys['ArrowRight']) player.vx =  5;
    else player.vx *= Math.pow(0.6, dt * 60); // friction when idle
  } else {
    // Air steering (softer)
    if (keys['KeyA'] || keys['ArrowLeft'])  player.vx -= 0.4 * dt * 60;
    if (keys['KeyD'] || keys['ArrowRight']) player.vx += 0.4 * dt * 60;
    player.vx *= Math.pow(0.97, dt * 60);
  }

  player.vy += GRAVITY * dt * 60;
  player.x += player.vx * dt * 60;
  player.y += player.vy * dt * 60;

  player.grounded = false;
  if (player.y >= GROUND_Y - PLAYER_RADIUS) {
    player.y = GROUND_Y - PLAYER_RADIUS;
    if (player.vy > 0) player.vy = 0;
    player.grounded = true;
  }

  player.x = Math.max(10, Math.min(W - 10, player.x));
  if (player.y < 10) { player.y = 10; player.vy = 0; }
}

// ─────────────────────────────────────────────
//  Colossi update
// ─────────────────────────────────────────────
function updateColossi(dt) {
  let allDead = true;

  for (const c of colossi) {
    if (c.dead) continue;
    allDead = false;

    c.wpGlow = (Math.sin(Date.now() / 200) * 0.4 + 0.6);
    if (c.hitFlash > 0) c.hitFlash -= dt * 60;

    if (!c.reachedWall) {
      c.x += c.speed * dt * 60;
      if (c.x + c.w >= WALL_X - 10) {
        c.reachedWall = true;
        c.x = WALL_X - c.w - 10;
      }
    } else {
      // Pound the wall
      c.breachTimer += dt * 60;
      if (c.breachTimer >= 120) {
        c.breachTimer = 0;
        wallHP -= 4 + wave;
        screenShake = 10;
        wallHP = Math.max(0, wallHP);
        updateHUD();
        if (wallHP <= 0) {
          triggerGameOver();
          return;
        }
      }
    }

    // Cannon chip damage
    for (let i = cannonBalls.length - 1; i >= 0; i--) {
      const b = cannonBalls[i];
      const wpX = c.x + c.w / 2 + c.wpOffX;
      const wpY = c.y + c.wpOffY;
      if (dist(b.x, b.y, c.x + c.w / 2, c.y + c.h / 2) < c.w / 2 + 6) {
        c.hp -= cannonDamage();
        c.hitFlash = 6;
        cannonBalls.splice(i, 1);
        if (c.hp <= 0 && !c.dead) {
          // Cannons can't finish — just stagger
          c.hp = 1;
        }
      }
    }
  }

  if (allDead && state === 'playing') {
    startUpgradePhase();
  }
}

// ─────────────────────────────────────────────
//  Cannons
// ─────────────────────────────────────────────
function updateCannons(dt) {
  for (const cannon of CANNONS) {
    if (cannon.cooldown > 0) { cannon.cooldown -= dt * 60; continue; }
    // Find nearest living colossus
    let target = null, bestX = Infinity;
    for (const c of colossi) {
      if (!c.dead && c.x < bestX) { bestX = c.x; target = c; }
    }
    if (!target) continue;
    cannon.cooldown = cannon.maxCooldown;
    const tx = target.x + target.w / 2;
    const ty = target.y + target.h / 2;
    const d = dist(cannon.x, cannon.y, tx, ty);
    const spd = 7;
    cannonBalls.push({
      x: cannon.x, y: cannon.y,
      vx: (tx - cannon.x) / d * spd,
      vy: (ty - cannon.y) / d * spd,
      life: 90,
    });
  }

  for (let i = cannonBalls.length - 1; i >= 0; i--) {
    const b = cannonBalls[i];
    b.x += b.vx * dt * 60;
    b.y += b.vy * dt * 60;
    b.life -= dt * 60;
    if (b.life <= 0) cannonBalls.splice(i, 1);
  }
}

// ─────────────────────────────────────────────
//  Particles
// ─────────────────────────────────────────────
function spawnParticles(x, y, count, colA, colB) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 2 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 3,
      life: 0.8 + Math.random() * 0.6,
      maxLife: 0,
      color: Math.random() < 0.5 ? colA : colB,
      r: 2 + Math.random() * 4,
    });
    particles[particles.length - 1].maxLife = particles[particles.length - 1].life;
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 0.15 * dt * 60;
    p.x  += p.vx * dt * 60;
    p.y  += p.vy * dt * 60;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ─────────────────────────────────────────────
//  Upgrade phase
// ─────────────────────────────────────────────
function startUpgradePhase() {
  state = 'upgrade';
  document.getElementById('upgrade-panel').style.display = 'block';
  document.getElementById('upg-wave-label').textContent = `Wave ${wave} Complete`;
  refreshUpgradeUI();
}

function refreshUpgradeUI() {
  document.getElementById('upg-points').textContent = points;

  const defs = [
    { key: 'grapple', max: 4 },
    { key: 'blade',   max: 4 },
    { key: 'cannon',  max: 4 },
    { key: 'wall',    max: 4 },
  ];

  for (const d of defs) {
    const lvl = upgrades[d.key];
    const cost = lvl < d.max ? UPGRADE_COSTS[d.key][lvl] : null;
    const btn  = document.getElementById(`upg-${d.key}`);
    const costEl = document.getElementById(`cost-${d.key}`);
    document.getElementById(`upg-${d.key}-level`).textContent = d.key === 'wall' ? '' : `Lv ${lvl}`;

    if (cost === null) {
      btn.disabled = true;
      costEl.textContent = 'MAX';
    } else {
      btn.disabled = points < cost;
      costEl.textContent = cost;
    }
  }
}

function buyUpgrade(key) {
  const lvl  = upgrades[key];
  const cost = UPGRADE_COSTS[key][lvl];
  if (points < cost) return;
  points -= cost;

  if (key === 'wall') {
    wallHP = Math.min(100, wallHP + 25);
    updateHUD();
    // Wall repair doesn't level up, resets cost but costs keep going
    upgrades[key]++;
    if (upgrades[key] >= 4) upgrades[key] = 0; // allow repeated repair
  } else {
    upgrades[key]++;
  }

  refreshUpgradeUI();
}

document.getElementById('upg-grapple').addEventListener('click', () => buyUpgrade('grapple'));
document.getElementById('upg-blade').addEventListener('click',   () => buyUpgrade('blade'));
document.getElementById('upg-cannon').addEventListener('click',  () => buyUpgrade('cannon'));
document.getElementById('upg-wall').addEventListener('click',    () => buyUpgrade('wall'));

document.getElementById('deploy-btn').addEventListener('click', () => {
  document.getElementById('upgrade-panel').style.display = 'none';
  resetPlayerPosition();
  startWave();
});

function resetPlayerPosition() {
  player.x = 750; player.y = WALL_TOP_Y - 20;
  player.vx = 0; player.vy = 0;
  player.grappling = false;
  player.grounded = false;
  player.dead = false;
  player.slashing = false;
}

// ─────────────────────────────────────────────
//  Game over / title
// ─────────────────────────────────────────────
function triggerGameOver() {
  state = 'gameover';
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = 'Wall Breached';
  document.getElementById('overlay-title').className = 'color-red';
  document.getElementById('overlay-sub').textContent =
    `Wave ${wave} — ${kills} Colossi Slain — ${points} Points`;
  ov.classList.add('visible');
}

document.getElementById('restart-btn').addEventListener('click', resetGame);

function resetGame() {
  wave = 0; kills = 0; points = 0; wallHP = 100;
  upgrades.grapple = 0; upgrades.blade = 0;
  upgrades.cannon = 0;  upgrades.wall = 0;
  colossi = []; cannonBalls = []; particles = [];
  screenShake = 0; hintTimer = 360;
  resetPlayerPosition();
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('upgrade-panel').style.display = 'none';
  for (const c of CANNONS) c.cooldown = 0;
  updateHUD();
  startWave();
}

// ─────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-wave').textContent   = wave;
  document.getElementById('hud-colossi').textContent = colossi.filter(c => !c.dead).length;
  document.getElementById('hud-kills').textContent  = kills;
  document.getElementById('hud-points').textContent = points;
  document.getElementById('hud-wall').textContent   = Math.ceil(wallHP) + '%';
  document.getElementById('wall-health-fill').style.width = wallHP + '%';
}

// ─────────────────────────────────────────────
//  Drawing
// ─────────────────────────────────────────────
function draw() {
  // Screen shake
  ctx.save();
  if (screenShake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * screenShake * 0.8,
      (Math.random() - 0.5) * screenShake * 0.8
    );
    screenShake = Math.max(0, screenShake - 1);
  }

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d0a18');
  sky.addColorStop(0.6, '#1a1020');
  sky.addColorStop(1, '#2a1808');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  drawBackground();
  drawWall();
  drawAnchors();

  if (state === 'playing' || state === 'upgrade') {
    drawColossi();
    drawCannonBalls();
    drawParticles();
    drawPlayer();
    drawHints();
  }

  if (state === 'title') {
    drawTitle();
  }

  ctx.restore();
}

function drawBackground() {
  // Distant city silhouette
  ctx.fillStyle = '#120e1c';
  for (let i = 0; i < 12; i++) {
    const bx = i * 75 + 10;
    const bh = 40 + Math.sin(i * 2.3) * 30;
    ctx.fillRect(bx, GROUND_Y - bh, 50, bh);
  }

  // Ground
  const grd = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  grd.addColorStop(0, '#1e1408');
  grd.addColorStop(1, '#0a0805');
  ctx.fillStyle = grd;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Ground line
  ctx.strokeStyle = '#3a2810';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(W, GROUND_Y);
  ctx.stroke();
}

function drawWall() {
  const wallW = W - WALL_X;

  // Wall body
  const wg = ctx.createLinearGradient(WALL_X, 0, W, 0);
  wg.addColorStop(0, '#2a2018');
  wg.addColorStop(1, '#1a1408');
  ctx.fillStyle = wg;
  ctx.fillRect(WALL_X, WALL_TOP_Y, wallW, H - WALL_TOP_Y);

  // Battlement notches
  ctx.fillStyle = '#221a10';
  const notchW = 22, notchH = 20, notchGap = 32;
  for (let nx = WALL_X + 8; nx < W - 10; nx += notchGap) {
    ctx.fillRect(nx, WALL_TOP_Y - notchH, notchW, notchH);
  }

  // Stone texture lines
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth = 1;
  for (let row = 0; row < 8; row++) {
    const ly = WALL_TOP_Y + 20 + row * 28;
    ctx.beginPath();
    ctx.moveTo(WALL_X, ly);
    ctx.lineTo(W, ly);
    ctx.stroke();
  }

  // Wall health tint (cracks)
  if (wallHP < 60) {
    ctx.fillStyle = `rgba(180,20,0,${(60 - wallHP) / 200})`;
    ctx.fillRect(WALL_X, WALL_TOP_Y, wallW, H - WALL_TOP_Y);
  }

  // Cannons
  for (const cannon of CANNONS) {
    ctx.save();
    ctx.fillStyle = '#302010';
    ctx.fillRect(cannon.x - 14, cannon.y - 8, 14, 16);
    ctx.fillStyle = '#181008';
    ctx.fillRect(cannon.x - 22, cannon.y - 5, 12, 10);
    ctx.restore();
  }
}

function getTargetAnchor() {
  if (state !== 'playing' || player.grappling) return null;
  let best = null, bestDistToMouse = Infinity;
  for (const a of ANCHORS) {
    if (dist(player.x, player.y, a.x, a.y) > ROPE_LEN_MAX) continue;
    const d = dist(mouse.x, mouse.y, a.x, a.y);
    if (d < bestDistToMouse) { bestDistToMouse = d; best = a; }
  }
  return best;
}

function drawAnchors() {
  const targeted = getTargetAnchor();

  // Draw preview line to targeted anchor
  if (targeted) {
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(targeted.x, targeted.y);
    ctx.strokeStyle = 'rgba(200,160,60,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const a of ANCHORS) {
    const isActive   = player.grappling && player.anchorX === a.x && player.anchorY === a.y;
    const isTargeted = targeted === a;
    const r = isTargeted || isActive ? 8 : 5;

    if (isTargeted) {
      // Outer glow ring
      ctx.beginPath();
      ctx.arc(a.x, a.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,200,80,0.1)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#f0c060' : isTargeted ? '#c8a040' : '#4a3820';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#fff8c0' : isTargeted ? '#f0d060' : '#8a6840';
    ctx.lineWidth = isTargeted || isActive ? 2 : 1.5;
    ctx.stroke();

    // Label on targeted
    if (isTargeted) {
      ctx.fillStyle = 'rgba(240,200,80,0.7)';
      ctx.font = '10px Courier New';
      ctx.fillText('CLICK', a.x - 13, a.y - 12);
    }
  }
}

function drawColossi() {
  for (const c of colossi) {
    if (c.dead) continue;

    ctx.save();

    const flash = c.hitFlash > 0 ? c.hitFlash / 6 : 0;

    // Body
    const bodyGrad = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
    bodyGrad.addColorStop(0, flash > 0 ? `rgba(255,${120-flash*80},${60-flash*60},1)` : '#4a3828');
    bodyGrad.addColorStop(1, flash > 0 ? `rgba(200,${80-flash*60},${40-flash*40},1)` : '#2a1e14');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(c.x, c.y, c.w, c.h);

    // Body edge
    ctx.strokeStyle = flash > 0 ? '#e04020' : '#3a2818';
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x, c.y, c.w, c.h);

    // Head
    const headW = c.w * 0.55;
    const headH = c.h * 0.18;
    const headX = c.x + (c.w - headW) / 2;
    ctx.fillStyle = flash > 0 ? '#b03020' : '#3a2820';
    ctx.fillRect(headX, c.y - headH, headW, headH);

    // Eyes — two dim glows
    const eyeY = c.y - headH * 0.4;
    ctx.fillStyle = `rgba(255,180,40,${0.4 + flash * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(headX + headW * 0.3, eyeY, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headX + headW * 0.7, eyeY, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Weak-point glow
    const wpX = c.x + c.w / 2 + c.wpOffX;
    const wpY = c.y + c.wpOffY;
    const glowR = 10 + c.wpGlow * 6;
    const glow = ctx.createRadialGradient(wpX, wpY, 0, wpX, wpY, glowR);
    glow.addColorStop(0, `rgba(80,230,140,${c.wpGlow * 0.9})`);
    glow.addColorStop(0.5, `rgba(40,180,80,${c.wpGlow * 0.5})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(wpX, wpY, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(wpX, wpY, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(120,255,160,${c.wpGlow})`;
    ctx.fill();

    // HP bar
    const barW = c.w * 0.8;
    const barX = c.x + c.w * 0.1;
    const barY = c.y - headH - 14;
    ctx.fillStyle = '#1a0a04';
    ctx.fillRect(barX, barY, barW, 6);
    const hpFrac = c.hp / c.maxHP;
    ctx.fillStyle = hpFrac > 0.5 ? '#60a030' : hpFrac > 0.25 ? '#c08020' : '#c02010';
    ctx.fillRect(barX, barY, barW * hpFrac, 6);

    ctx.restore();
  }
}

function drawCannonBalls() {
  for (const b of cannonBalls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e08030';
    ctx.fill();
    // Trail
    ctx.beginPath();
    ctx.arc(b.x - b.vx * 2, b.y - b.vy * 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,120,30,0.4)';
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  // Grapple rope
  if (player.grappling) {
    ctx.beginPath();
    ctx.moveTo(player.anchorX, player.anchorY);
    ctx.lineTo(player.x, player.y);
    ctx.strokeStyle = '#c0a060';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Anchor indicator
    ctx.beginPath();
    ctx.arc(player.anchorX, player.anchorY, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0c060';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Mouse direction arrow while swinging
  if (player.grappling) {
    const tmx = mouse.x - player.x;
    const tmy = mouse.y - player.y;
    const tmLen = Math.sqrt(tmx * tmx + tmy * tmy);
    if (tmLen > 20) {
      const nx = tmx / tmLen, ny = tmy / tmLen;
      const arrowLen = Math.min(tmLen * 0.4, 40);
      const ex = player.x + nx * arrowLen;
      const ey = player.y + ny * arrowLen;
      ctx.beginPath();
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = 'rgba(255,220,100,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Arrowhead
      const perp = 5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - nx * 8 - ny * perp, ey - ny * 8 + nx * perp);
      ctx.lineTo(ex - nx * 8 + ny * perp, ey - ny * 8 - nx * perp);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,220,100,0.5)';
      ctx.fill();
    }
  }

  // Slash arc
  if (player.slashing) {
    const r = slashRadius();
    const progress = 1 - player.slashTimer / 18;
    ctx.beginPath();
    ctx.arc(player.x, player.y, r, -Math.PI * 0.8 + progress * Math.PI, Math.PI * 0.2 + progress * Math.PI);
    ctx.strokeStyle = `rgba(200,240,255,${0.9 - progress * 0.7})`;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(player.x, player.y, r * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(160,220,255,${0.3 - progress * 0.3})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Body
  ctx.save();
  ctx.translate(player.x, player.y);

  // Cape/cloak
  ctx.beginPath();
  ctx.moveTo(-6, -4);
  ctx.lineTo(-14, 12);
  ctx.lineTo(0, 8);
  ctx.closePath();
  ctx.fillStyle = '#3a2060';
  ctx.fill();

  // Torso
  ctx.fillStyle = '#c0a060';
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#f0d080';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(3, -2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawHints() {
  if (hintTimer <= 0) return;
  hintTimer--;
  const alpha = Math.min(1, hintTimer / 60) * 0.85;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(12, H - 82, 240, 76);
  ctx.fillStyle = '#7a6a4a';
  ctx.font = '10px Courier New';
  ctx.fillText('CONTROLS', 22, H - 90);
  ctx.fillStyle = '#e8d8a8';
  ctx.font = '12px Courier New';
  ctx.fillText('Hold click  — grapple', 22, H - 64);
  ctx.fillText('Move mouse  — steer swing', 22, H - 46);
  ctx.fillText('Release     — let go & fly', 22, H - 28);
  ctx.fillText('Space       — slash weak point', 22, H - 10);
  ctx.restore();
}

function drawTitle() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
}

// ─────────────────────────────────────────────
//  Utility
// ─────────────────────────────────────────────
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─────────────────────────────────────────────
//  Game loop
// ─────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  if (state === 'playing') {
    updatePlayer(dt);
    updateColossi(dt);
    updateCannons(dt);
    updateParticles(dt);
    updateHUD();
  }

  draw();
  requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
(function boot() {
  resetPlayerPosition();
  state = 'title';

  // Show title overlay
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = 'Colossus Break';
  document.getElementById('overlay-title').className = 'color-gold';
  document.getElementById('overlay-sub').innerHTML =
    'Hold left-click — grapple &nbsp;|&nbsp; Move mouse — steer &nbsp;|&nbsp; Release — let go &nbsp;|&nbsp; Space — slash';
  document.getElementById('restart-btn').textContent = 'Begin';
  document.getElementById('restart-btn').onclick = function () {
    this.textContent = 'Begin Again';
    this.onclick = resetGame;
    ov.classList.remove('visible');
    resetGame();
  };
  ov.classList.add('visible');

  requestAnimationFrame(loop);
})();
