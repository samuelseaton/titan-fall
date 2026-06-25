// ─── Colossus Break — auto-runner ───────────────────────

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width;   // 900
const H = canvas.height;  // 600

// ── Constants ────────────────────────────────────────────
const GRAVITY      = 0.52;
const GROUND_Y     = H - 68;
const ROPE_MAX     = 420;
const PLAYER_R     = 10;
const SLASH_R      = 90;
const SPEED_BASE   = 2.6;
const SPEED_MAX    = 7.0;
const START_X      = 210;

// ── Mouse ────────────────────────────────────────────────
const mouse = { x: 0, y: 0 };
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top)  * (H / r.height);
});

// ── State ────────────────────────────────────────────────
let state;       // 'title' | 'playing' | 'gameover'
let score;
let lives;
let speed;
let frameCount;
let nextTitanIn; // world-px until next titan spawn
let screenShake;

// ── World objects ────────────────────────────────────────
let anchors;    // { x, y, obj-ref kept in player.anchorRef }
let titans;     // { x, y, w, h, wpY, dead, hitFlash }
let particles;  // { x, y, vx, vy, life, maxLife, r, color }

// ── Player ───────────────────────────────────────────────
const player = {
  x: START_X, y: GROUND_Y - PLAYER_R,
  vx: 0, vy: 0,
  grounded: false,
  grappling: false,
  anchorRef: null,  // reference to anchor object
  anchorX: 0, anchorY: 0,
  ropeLen: 0,
  slashing: false,
  slashTimer: 0,
  slashHit: new Set(),
};

// ── Input ────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); triggerSlash(); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || state !== 'playing') return;
  if (player.grappling) return;

  let best = null, bestMouseDist = Infinity;
  for (const a of anchors) {
    if (dist(player.x, player.y, a.x, a.y) > ROPE_MAX) continue;
    const md = dist(mouse.x, mouse.y, a.x, a.y);
    if (md < bestMouseDist) { bestMouseDist = md; best = a; }
  }
  if (best) {
    player.grappling = true;
    player.anchorRef = best;
    player.anchorX   = best.x;
    player.anchorY   = best.y;
    player.ropeLen   = Math.max(60, dist(player.x, player.y, best.x, best.y));
    // Kick toward anchor so the swing starts immediately
    const kdx = best.x - player.x, kdy = best.y - player.y;
    const kl  = Math.sqrt(kdx * kdx + kdy * kdy) || 1;
    player.vx += (kdx / kl) * 3;
    player.vy += (kdy / kl) * 3 - 1; // slight upward bias
  }
});

canvas.addEventListener('mouseup',     e => { if (e.button === 0) releaseGrapple(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function releaseGrapple() {
  player.grappling = false;
  player.anchorRef = null;
}

// ── Slash ────────────────────────────────────────────────
function triggerSlash() {
  if (state !== 'playing' || player.slashing) return;
  player.slashing   = true;
  player.slashTimer = 16;
  player.slashHit   = new Set(); // track who we already hit this slash
}

function killTitan(t) {
  t.dead = true;
  score += 10;
  screenShake = 12;
  spawnParticles(t.x + t.w / 2, t.wpY, 28, '#f0c060', '#e04030');
  updateHUD();
}

// ── Player physics ───────────────────────────────────────
function updatePlayer(dt) {
  if (player.grappling) {
    // Keep anchorX/Y in sync with the moving anchor object
    if (player.anchorRef) {
      player.anchorX = player.anchorRef.x;
      player.anchorY = player.anchorRef.y;
    }
    // Release if anchor scrolled off left edge
    if (player.anchorX < -40) { releaseGrapple(); }
    else                        { updateSwing(dt); }
  }

  if (!player.grappling) updateFlight(dt);

  if (player.slashing) {
    player.slashTimer -= dt * 60;
    // Check hits every frame so timing window = full animation, not just keypress moment
    for (const t of titans) {
      if (t.dead || player.slashHit.has(t)) continue;
      if (dist(player.x, player.y, t.x + t.w / 2, t.wpY) < SLASH_R) {
        player.slashHit.add(t);
        killTitan(t);
      }
    }
    if (player.slashTimer <= 0) player.slashing = false;
  }

  // Soft left wall — nudge player right instead of killing them
  if (player.x < 50) { player.x = 50; player.vx = Math.max(player.vx, 1); }
}

function updateSwing(dt) {
  // Force toward mouse cursor — same direction as before, just calmer
  const mx = mouse.x - player.x, my = mouse.y - player.y;
  const ml = Math.sqrt(mx * mx + my * my);
  if (ml > 5) {
    player.vx += (mx / ml) * 0.85 * dt * 60;
    player.vy += (my / ml) * 0.85 * dt * 60;
  }

  player.vy += GRAVITY * dt * 60;

  // Speed cap
  const spd = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
  if (spd > 13) { player.vx = player.vx / spd * 13; player.vy = player.vy / spd * 13; }

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
    const vd = player.vx * nx + player.vy * ny;
    if (vd > 0) { player.vx -= vd * nx; player.vy -= vd * ny; }
  }

  groundCheck();
  player.x = Math.min(player.x, W - 10);
}

function updateFlight(dt) {
  if (keys['KeyA'] || keys['ArrowLeft'])  player.vx -= 0.4 * dt * 60;
  if (keys['KeyD'] || keys['ArrowRight']) player.vx += 0.4 * dt * 60;
  player.vx *= Math.pow(0.985, dt * 60);
  player.vy += GRAVITY * dt * 60;
  player.x  += player.vx * dt * 60;
  player.y  += player.vy * dt * 60;
  groundCheck();
  player.x = Math.max(20, Math.min(W - 10, player.x));
}

function groundCheck() {
  player.grounded = false;
  if (player.y >= GROUND_Y - PLAYER_R) {
    player.y = GROUND_Y - PLAYER_R;
    if (player.vy > 0) player.vy = 0;
    player.grounded = true;
    if (player.grappling) releaseGrapple();
  }
  if (player.y < 0) { player.y = 0; player.vy = 0; }
}

// ── World scroll & spawning ───────────────────────────────
function updateWorld(dt) {
  speed = Math.min(SPEED_MAX, SPEED_BASE + frameCount * 0.00055);
  const scroll = speed * dt * 60;

  // Move objects left
  for (const a of anchors)  a.x -= scroll;
  for (const t of titans) { t.x -= scroll; t.walkPhase += dt * 4.5; }

  // Remove anchors off left edge
  for (let i = anchors.length - 1; i >= 0; i--) {
    if (anchors[i].x < -60) anchors.splice(i, 1);
  }

  // Titans off left edge → lose a life
  for (let i = titans.length - 1; i >= 0; i--) {
    const t = titans[i];
    if (t.hitFlash > 0) t.hitFlash -= dt * 60;
    if (t.x + t.w < -10) {
      if (!t.dead) loseLife();
      titans.splice(i, 1);
    }
  }

  // Guarantee 2 anchors are always within grapple range ahead of the player
  const reachable = anchors.filter(a => a.x > player.x - 50 && a.x < player.x + ROPE_MAX + 60);
  if (reachable.length < 2) spawnAnchor();

  // Titan spawn timer (counts down in world-px)
  nextTitanIn -= scroll;
  if (nextTitanIn <= 0) {
    spawnTitan();
    nextTitanIn = 420 + Math.random() * 260 - Math.min(100, frameCount * 0.02);
  }
}

function spawnAnchor() {
  // Spawn ahead of the player, within grapple range, at varied heights
  const ahead = player.x + 180 + Math.random() * 200;
  anchors.push({
    x: Math.max(ahead, player.x + 150),
    y: 110 + Math.random() * 250,
  });
}

function spawnTitan() {
  const h = 150 + Math.random() * 140;
  const w = h * 0.46;
  titans.push({
    x: W + 30,
    y: GROUND_Y - h,
    w, h,
    wpY: (GROUND_Y - h) - h * 0.07, // eye center (head extends above t.y)
    dead: false,
    hitFlash: 0,
    walkPhase: Math.random() * Math.PI * 2,
  });
}

// ── Particles ─────────────────────────────────────────────
function spawnParticles(x, y, n, ca, cb) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 6;
    const life = 0.55 + Math.random() * 0.5;
    particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2.5,
      life, maxLife: life,
      r: 2 + Math.random() * 3,
      color: Math.random() < 0.5 ? ca : cb,
    });
  }
}

function updateParticles(dt) {
  const scroll = speed * dt * 60;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 0.18 * dt * 60;
    p.x  += p.vx * dt * 60 - scroll;
    p.y  += p.vy * dt * 60;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ── HUD / lives ───────────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-score').textContent = score;
  document.getElementById('hud-lives').textContent = '♥'.repeat(Math.max(0, lives));
  const pct = Math.min(100, Math.round(((speed - SPEED_BASE) / (SPEED_MAX - SPEED_BASE)) * 100));
  document.getElementById('hud-speed-fill').style.width = pct + '%';
}

function loseLife() {
  if (state !== 'playing') return;
  lives--;
  screenShake = 22;
  updateHUD();
  if (lives <= 0) triggerGameOver();
}

// ── Utility ───────────────────────────────────────────────
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Drawing ───────────────────────────────────────────────
function draw() {
  ctx.save();
  if (screenShake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * screenShake * 0.7,
      (Math.random() - 0.5) * screenShake * 0.7
    );
    screenShake = Math.max(0, screenShake - 1.4);
  }

  drawBackground();
  drawAnchors();
  drawTitans();
  drawParticles();
  if (state !== 'title') drawPlayer();

  ctx.restore();
}

function drawBackground() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#5090c8');
  sky.addColorStop(1, '#b8d8f0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);

  // Clouds (static — move would need world coords)
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  [[100,55,65,22],[310,38,85,18],[560,60,72,20],[760,42,50,16]].forEach(([cx,cy,rw,rh]) => {
    ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx+rw*0.55, cy+5, rw*0.65, rh*0.7, 0, 0, Math.PI*2); ctx.fill();
  });

  // Far buildings (parallax — shift at half speed)
  // We fake parallax by using a static offset driven by frameCount
  const parallax = (frameCount * speed * 0.3) % 280;
  ctx.fillStyle = '#6a8090';
  for (let i = 0; i < 5; i++) {
    const bx = ((i * 280 - parallax + 1400) % 1400) - 100;
    const bh = 80 + Math.sin(i * 1.7) * 40;
    ctx.fillRect(bx, GROUND_Y - bh, 120, bh);
    // Windows
    ctx.fillStyle = 'rgba(255,240,180,0.3)';
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++)
        ctx.fillRect(bx + 10 + c*26, GROUND_Y - bh + 12 + r*22, 14, 12);
    ctx.fillStyle = '#6a8090';
  }

  // Ground
  const grd = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  grd.addColorStop(0, '#7aaa50');
  grd.addColorStop(1, '#4a7030');
  ctx.fillStyle = grd;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Ground edge line
  ctx.strokeStyle = '#3a6020';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();
}

function getTargetAnchor() {
  if (state !== 'playing' || player.grappling) return null;
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    if (dist(player.x, player.y, a.x, a.y) > ROPE_MAX) continue;
    const md = dist(mouse.x, mouse.y, a.x, a.y);
    if (md < bestD) { bestD = md; best = a; }
  }
  return best;
}

function drawAnchors() {
  const target = getTargetAnchor();

  // Reach circle — shows what the player can grab
  if (!player.grappling) {
    ctx.beginPath();
    ctx.arc(player.x, player.y, ROPE_MAX, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Preview line to targeted anchor
  if (target) {
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = 'rgba(255,220,80,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const a of anchors) {
    const inRange  = dist(player.x, player.y, a.x, a.y) <= ROPE_MAX;
    const isActive = player.grappling && player.anchorRef === a;
    const isTarget = target === a;

    // Post
    ctx.strokeStyle = '#7a5828';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + 12);
    ctx.lineTo(a.x, a.y + 58);
    ctx.stroke();

    // Outer pulse ring on reachable anchors
    if (inRange && !player.grappling) {
      const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.5;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,220,80,${pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (isTarget) {
      ctx.fillStyle = 'rgba(255,220,80,0.85)';
      ctx.font = 'bold 11px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('HOLD TO GRAB', a.x, a.y - 20);
      ctx.textAlign = 'left';
    }

    // Hook dot
    const dotR = isActive ? 11 : isTarget ? 10 : inRange ? 9 : 6;
    ctx.beginPath();
    ctx.arc(a.x, a.y, dotR, 0, Math.PI * 2);
    ctx.fillStyle  = isActive ? '#fff8a0' : isTarget ? '#f0c020' : inRange ? '#d4a030' : '#6a5020';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#ffffff' : '#e0c060';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawTitans() {
  for (const t of titans) {
    if (t.dead) continue;
    const flash = t.hitFlash > 0;
    const cx    = t.x + t.w / 2;
    const skin  = flash ? '#a04020' : '#6a4830';
    const dark  = flash ? '#803018' : '#4a3020';

    const torsoH   = t.h * 0.52;
    const bob      = Math.abs(Math.sin(t.walkPhase)) * 3;
    const torsoY   = t.y + bob;
    const hipY     = torsoY + torsoH;
    const legH     = GROUND_Y - hipY;        // always pin feet to ground
    const legW     = t.w * 0.21;
    const armLen   = t.h * 0.30;
    const armW     = t.w * 0.15;
    const slide    = Math.sin(t.walkPhase) * t.w * 0.22;   // feet slide L/R
    const armSwing = Math.sin(t.walkPhase) * 0.55;         // arm angle

    // ── Legs: slide feet horizontally so they always touch ground ──
    const leftLegX  = cx - legW / 2 + slide;   // left foot slides right when backward
    const rightLegX = cx - legW / 2 - slide;   // right foot slides left when forward
    ctx.fillStyle = dark;
    // draw back leg first so front leg overlaps it
    if (slide > 0) {
      ctx.fillRect(leftLegX,  hipY, legW, legH);
      ctx.fillRect(rightLegX, hipY, legW, legH);
    } else {
      ctx.fillRect(rightLegX, hipY, legW, legH);
      ctx.fillRect(leftLegX,  hipY, legW, legH);
    }

    // ── Arms: pivot near shoulders, proper counter-swing ──────────
    const shoulderY = torsoY + torsoH * 0.12;
    ctx.fillStyle = skin;
    // left arm: swings BACKWARD (clockwise) when right leg is forward
    ctx.save();
    ctx.translate(cx - t.w * 0.28, shoulderY);
    ctx.rotate(armSwing);
    ctx.fillRect(-armW / 2, 0, armW, armLen);
    ctx.restore();
    // right arm: swings FORWARD (counter-clockwise) when right leg is forward
    ctx.save();
    ctx.translate(cx + t.w * 0.28, shoulderY);
    ctx.rotate(-armSwing);
    ctx.fillRect(-armW / 2, 0, armW, armLen);
    ctx.restore();

    // ── Torso ─────────────────────────────────────────────────────
    ctx.fillStyle = skin;
    ctx.fillRect(t.x + t.w * 0.08, torsoY, t.w * 0.84, torsoH);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.strokeRect(t.x + t.w * 0.08, torsoY, t.w * 0.84, torsoH);

    // ── Head ──────────────────────────────────────────────────────
    const hW = t.w * 0.58, hH = t.h * 0.14;
    const headY  = torsoY - hH;
    const eyeCX  = cx;
    const eyeCY  = headY + hH * 0.5;
    ctx.fillStyle = dark;
    ctx.fillRect(cx - hW / 2, headY, hW, hH);

    // ── Eye = weak point (pulsing green glow replaces orange eye) ──
    t.wpY = eyeCY; // keep hit detection in sync with visual
    const glow = Math.sin(Date.now() / 180) * 0.35 + 0.65;
    const gr = ctx.createRadialGradient(eyeCX, eyeCY, 0, eyeCX, eyeCY, 20);
    gr.addColorStop(0,    `rgba(80,230,140,${glow * 0.9})`);
    gr.addColorStop(0.55, `rgba(40,180,80,${glow * 0.4})`);
    gr.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(eyeCX, eyeCY, 20, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeCX, eyeCY, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(140,255,170,${glow})`; ctx.fill();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (p.life / p.maxLife), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  // Rope
  if (player.grappling) {
    ctx.beginPath();
    ctx.moveTo(player.anchorX, player.anchorY);
    ctx.lineTo(player.x, player.y);
    ctx.strokeStyle = '#c0a050';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(player.anchorX, player.anchorY, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0d060';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Direction arrow from player toward mouse
    const mx = mouse.x - player.x, my = mouse.y - player.y;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 24) {
      const nx = mx / ml, ny = my / ml;
      const len = Math.min(ml * 0.4, 40);
      const ex = player.x + nx * len, ey = player.y + ny * len;
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(ex, ey);
      ctx.strokeStyle = 'rgba(255,220,100,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - nx * 8 - ny * 5, ey - ny * 8 + nx * 5);
      ctx.lineTo(ex - nx * 8 + ny * 5, ey - ny * 8 - nx * 5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,220,100,0.55)'; ctx.fill();
    }
  }

  // Slash arc
  if (player.slashing) {
    const prog = 1 - player.slashTimer / 16;
    ctx.beginPath();
    ctx.arc(player.x, player.y, SLASH_R,
      -Math.PI * 0.85 + prog * Math.PI,
       Math.PI * 0.15 + prog * Math.PI);
    ctx.strokeStyle = `rgba(200,245,255,${0.9 - prog * 0.75})`;
    ctx.lineWidth = 3; ctx.stroke();
  }

  // Character — side view
  ctx.save();
  ctx.translate(player.x, player.y);

  // Legs
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(-6, 2, 5, 11);
  ctx.fillRect(2, 2, 5, 11);

  // Cape
  ctx.fillStyle = '#4a2880';
  ctx.beginPath();
  ctx.moveTo(-8, -12); ctx.lineTo(-20, 6); ctx.lineTo(-8, 2);
  ctx.closePath(); ctx.fill();

  // Torso / harness
  ctx.fillStyle = '#c8a050';
  ctx.fillRect(-7, -16, 14, 18);
  ctx.fillStyle = '#8a6030';
  ctx.fillRect(-5, -14, 10, 3);
  ctx.fillRect(-5, -8,  10, 3);

  // Head
  ctx.fillStyle = '#d4a870';
  ctx.beginPath(); ctx.arc(1, -23, 9, 0, Math.PI * 2); ctx.fill();

  // Blade when slashing
  if (player.slashing) {
    ctx.strokeStyle = '#d8f0ff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, -10); ctx.lineTo(28, -26); ctx.stroke();
  }

  ctx.restore();
}

// ── Game over / reset ─────────────────────────────────────
function triggerGameOver() {
  state = 'gameover';
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = 'Fallen';
  document.getElementById('overlay-title').className = 'color-red';
  document.getElementById('overlay-sub').textContent = `Score: ${score}`;
  document.getElementById('restart-btn').textContent = 'Try Again';
  ov.classList.add('visible');
}

function resetGame() {
  score = 0; lives = 3; speed = SPEED_BASE;
  frameCount = 0; nextTitanIn = 600; screenShake = 0;
  anchors = []; titans = []; particles = [];
  player.x = START_X; player.y = GROUND_Y - PLAYER_R;
  player.vx = 0; player.vy = 0;
  player.grappling = false; player.anchorRef = null;
  player.grounded = true; player.slashing = false;
  document.getElementById('overlay').classList.remove('visible');
  // Spawn opening anchors so player isn't stranded
  anchors.push({ x: START_X + 160, y: 190 });
  anchors.push({ x: START_X + 320, y: 150 });
  anchors.push({ x: START_X + 480, y: 210 });
  anchors.push({ x: START_X + 620, y: 170 });
  updateHUD();
  state = 'playing';
}

document.getElementById('restart-btn').addEventListener('click', () => {
  if (state === 'title') {
    document.getElementById('overlay').classList.remove('visible');
    resetGame();
  } else {
    resetGame();
  }
});

// ── Loop ──────────────────────────────────────────────────
let lastTime = 0;
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  if (state === 'playing') {
    frameCount++;
    updateWorld(dt);
    updatePlayer(dt);
    updateParticles(dt);
    updateHUD();
  }

  draw();
  requestAnimationFrame(loop);
}

// ── Boot ──────────────────────────────────────────────────
(function boot() {
  state = 'title';
  score = 0; lives = 3; speed = SPEED_BASE;
  frameCount = 0; nextTitanIn = 600; screenShake = 0;
  anchors = []; titans = []; particles = [];
  player.x = START_X; player.y = GROUND_Y - PLAYER_R;
  updateHUD();

  const ov = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = 'Colossus Break';
  document.getElementById('overlay-title').className = 'color-gold';
  document.getElementById('overlay-sub').innerHTML =
    'Hold left-click — grapple to hook<br>Move mouse — steer your swing<br>Release — fly<br>Space — slash the glowing weak point';
  document.getElementById('restart-btn').textContent = 'Begin';
  ov.classList.add('visible');

  requestAnimationFrame(loop);
})();
