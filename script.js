const API_KEY = "DEMO_KEY"; // Replace with your NASA API key
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const meteorSelect = document.getElementById('meteorSelect');
const dropBtn = document.getElementById('drop');
const massiveBtn = document.getElementById('massive');
const infoEl = document.getElementById('info');

// Contrast helper: compute luminance and return either '#fff' or '#000' for best contrast
function readableTextColor(hex) {
  // strip #
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0,2),16) / 255;
  const g = parseInt(c.substr(2,2),16) / 255;
  const b = parseInt(c.substr(4,2),16) / 255;
  const srgb = [r,g,b].map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4));
  const lum = 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
  return (lum > 0.5) ? '#000000' : '#ffffff';
}

function applyHeaderContrast() {
  const header = document.querySelector('header');
  if (!header) return;
  // get computed background color, try to convert rgb(...) to hex
  const bg = getComputedStyle(header).backgroundColor;
  let hex = '#0f172a';
  const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2,'0');
    const g = parseInt(m[2]).toString(16).padStart(2,'0');
    const b = parseInt(m[3]).toString(16).padStart(2,'0');
    hex = `#${r}${g}${b}`;
  }
  const text = readableTextColor(hex);
  // set the CSS var so styles update
  header.style.setProperty('--header-foreground', text === '#ffffff' ? '#e6fffa' : '#001219');
}

let meteor = null;
let paused = false;
let shockwaveRadius = 0;
let fireballRadius = 0;
// advanced impact/earth visuals
let landPath = null; // Path2D representing visible land on the hemisphere
let craterParticles = [];
let splashParticles = [];
let craterRadius = 0;
let craterMax = 0;

// Fetch NEOs from NASA
async function fetchNeos() {
  const today = new Date();
  const start = today.toISOString().split("T")[0];
  const end = new Date(today.getTime() + 3 * 86400000).toISOString().split("T")[0];
  const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${start}&end_date=${end}&api_key=${API_KEY}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    const neos = [];

    for (let date in data.near_earth_objects) {
      data.near_earth_objects[date].forEach(neo => {
        if (neo.close_approach_data.length > 0) {
          const approach = neo.close_approach_data[0];
          const avgDiameter = (neo.estimated_diameter.meters.estimated_diameter_max +
                              neo.estimated_diameter.meters.estimated_diameter_min) / 2;

          neos.push({
            name: neo.name,
            d: avgDiameter,
            v: parseFloat(approach.relative_velocity.kilometers_per_second),
            rho: 3.0 // approx density
          });
        }
      });
    }
    return neos.slice(0, 10); // limit
  } catch (e) {
    console.error("NASA API error", e);
    return [];
  }
}

function populateSelect(neos) {
  meteorSelect.innerHTML = "";
  neos.forEach(n => {
    const opt = document.createElement("option");
    opt.value = JSON.stringify(n);
    opt.textContent = `${n.name} — ${n.d.toFixed(1)} m, ${n.v.toFixed(1)} km/s`;
    meteorSelect.appendChild(opt);
  });
  infoEl.textContent = "Select a NEO and simulate impact!";
}

function computeEnergyMT(d_m, v_kms, rho_gcc) {
  const r = d_m / 2;
  const volume = (4 / 3) * Math.PI * Math.pow(r, 3);
  const rhoSI = rho_gcc * 1000;
  const mass = rhoSI * volume;
  const v = v_kms * 1000;
  const energyJ = 0.5 * mass * v * v;
  return energyJ / 4.184e15;
}

function damageRadiusKm(E_mt) {
  return 0.8 * Math.pow(E_mt, 1/3);
}

function startMeteor() {
  paused = false;
  shockwaveRadius = 0;
  fireballRadius = 0;
  const data = JSON.parse(meteorSelect.value);
  meteor = {
    ...data,
    x: canvas.width / 2,
    y: 0,
    vy: 4 + Math.random() * 2,
    size: Math.max(8, Math.min(40, data.d / 2000))
  };
  infoEl.textContent = "";
}

function massiveStrike() {
  // create an artificially large meteor
  paused = false;
  shockwaveRadius = 0;
  fireballRadius = 0;
  craterParticles = [];
  splashParticles = [];
  craterRadius = 0;
  craterMax = 0;
  meteor = {
    name: 'Massive Strike',
    d: 20000, // 20 km diameter (catastrophic)
    v: 20, // km/s
    rho: 3.0,
    x: canvas.width * (0.2 + Math.random() * 0.6),
    y: 0,
    vy: 6 + Math.random() * 4,
    size: 120
  };
  // flash overlay
  flashScreen(0.9, 400);
  infoEl.textContent = 'Massive strike initiated — catastrophic impact imminent.';
}

function flashScreen(alpha, duration) {
  // draw a full-screen white flash overlay for a short duration
  const start = performance.now();
  function frame(t) {
    const elapsed = t - start;
    const prog = Math.min(1, elapsed / duration);
    const a = alpha * (1 - prog);
    ctx.save();
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (prog < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function drawEarth() {
  // Draw a semi-circular (hemisphere) Earth horizon with continents and clouds
  const centerX = canvas.width / 2;
  const centerY = canvas.height + Math.max(120, canvas.height * 0.5);
  const radius = Math.min(canvas.width, canvas.height) + 80;

  // ocean base on hemisphere
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
  ctx.closePath();
  const oceanGrad = ctx.createRadialGradient(centerX, centerY - 40, radius * 0.2, centerX, centerY, radius);
  oceanGrad.addColorStop(0, '#3b76c9');
  oceanGrad.addColorStop(0.6, '#1161a8');
  oceanGrad.addColorStop(1, '#05304d');
  ctx.fillStyle = oceanGrad;
  ctx.fill();

  // create land shapes clipped to the hemisphere using Path2D so we can test impacts
  landPath = new Path2D();
  // simple continent 1 (left)
  landPath.moveTo(centerX - radius * 0.7, centerY - 10);
  landPath.bezierCurveTo(centerX - radius * 0.5, centerY - radius * 0.3, centerX - radius * 0.2, centerY - radius * 0.2, centerX - radius * 0.05, centerY - 30);
  landPath.bezierCurveTo(centerX - radius * 0.15, centerY - 10, centerX - radius * 0.35, centerY + 10, centerX - radius * 0.6, centerY + 20);
  landPath.closePath();

  // simple continent 2 (center-right)
  landPath.moveTo(centerX + radius * 0.05, centerY - 40);
  landPath.bezierCurveTo(centerX + radius * 0.18, centerY - radius * 0.35, centerX + radius * 0.45, centerY - radius * 0.05, centerX + radius * 0.55, centerY - 10);
  landPath.bezierCurveTo(centerX + radius * 0.35, centerY + 20, centerX + radius * 0.12, centerY + 8, centerX + radius * 0.05, centerY - 40);
  landPath.closePath();

  // draw land clipped to hemisphere
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2f6b3f';
  ctx.fill(landPath);

  // subtle continent shading
  ctx.globalCompositeOperation = 'overlay';
  const landShade = ctx.createLinearGradient(0, centerY - radius, 0, centerY + radius);
  landShade.addColorStop(0, 'rgba(255,255,255,0.02)');
  landShade.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = landShade;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // atmosphere glow along rim
  const glow = ctx.createRadialGradient(centerX, centerY - radius * 0.15, radius * 0.85, centerX, centerY, radius * 1.05);
  glow.addColorStop(0.96, 'rgba(135,206,235,0.05)');
  glow.addColorStop(1, 'rgba(135,206,235,0.25)');
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
  ctx.strokeStyle = glow;
  ctx.lineWidth = 10;
  ctx.stroke();

  // clouds removed to keep the Earth rendering stable (no moving white blobs)
}

function drawMeteor(m) {
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
  ctx.fillStyle = "#f87171";
  ctx.fill();
  ctx.strokeStyle = "#fb923c";
  ctx.stroke();
}

function explosion(m) {
  const E_mt = computeEnergyMT(m.d, m.v, m.rho);
  const rad = damageRadiusKm(E_mt);
  const pxRad = Math.min(400, rad * 6);

  const impactX = m.x;
  const impactY = canvas.height - 40; // approximate contact point along horizon

  // determine if impact is on land by testing the point against landPath
  const isLand = landPath ? ctx.isPointInPath(landPath, impactX, impactY) : true;

  // common: fireball
  if (fireballRadius < pxRad / 2) fireballRadius += 4;
  ctx.beginPath();
  ctx.arc(impactX, impactY, fireballRadius, 0, Math.PI * 2);
  ctx.fillStyle = isLand ? 'rgba(255,120,20,0.75)' : 'rgba(255,200,120,0.6)';
  ctx.fill();

  // shockwave
  if (shockwaveRadius < pxRad) shockwaveRadius += 8;
  ctx.beginPath();
  ctx.arc(impactX, impactY, shockwaveRadius, 0, Math.PI * 2);
  ctx.strokeStyle = isLand ? 'rgba(200,160,80,0.8)' : 'rgba(180,220,255,0.7)';
  ctx.lineWidth = isLand ? 4 : 3;
  ctx.stroke();

  // branch visuals
  if (isLand) {
    // create crater if not created yet
    if (craterRadius < pxRad / 2) craterRadius += 2;
    craterMax = Math.max(craterMax, pxRad / 2);

    // draw crater: dark center and raised rim
    ctx.beginPath();
    ctx.ellipse(impactX, impactY, craterRadius, craterRadius * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40,30,30,0.9)';
    ctx.fill();

    // rim
    ctx.beginPath();
    ctx.ellipse(impactX, impactY - craterRadius * 0.08, craterRadius * 1.12, craterRadius * 0.55, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(110,80,60,0.9)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // spawn ejecta particles once
    if (craterParticles.length === 0) {
      const count = Math.min(120, Math.round(pxRad / 2));
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 6;
        craterParticles.push({x: impactX, y: impactY, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 2, life: 60 + Math.random() * 80});
      }
    }

    // draw and update ejecta
    craterParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity
      p.life -= 1;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(140,110,80,0.9)';
      ctx.fillRect(p.x, p.y, 2, 2);
    });
    craterParticles = craterParticles.filter(p => p.life > 0);

    infoEl.textContent = `${m.name} impact on land: ${E_mt.toFixed(2)} MT TNT — crater ~${rad.toFixed(2)} km.`;
  } else {
    // ocean impact: splash particles and expanding concentric waves
    if (splashParticles.length === 0) {
      const count = Math.min(180, Math.round(pxRad));
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 8;
        splashParticles.push({x: impactX, y: impactY, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 3, life: 40 + Math.random() * 60});
      }
    }

    // draw splash particles
    splashParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.life -= 1;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(220,240,255,0.9)';
      ctx.fillRect(p.x, p.y, 2, 2);
    });
    splashParticles = splashParticles.filter(p => p.life > 0);

    infoEl.textContent = `${m.name} impact in ocean: ${E_mt.toFixed(2)} MT TNT — large tsunami/waves possible (~${rad.toFixed(2)} km radius estimate).`;
  }

  // final text overlay
  ctx.fillStyle = '#fff';
  ctx.font = '14px Arial';
  ctx.fillText(`${m.name} Impact`, 20, 20);
  ctx.fillText(`Energy: ${E_mt.toFixed(2)} MT TNT`, 20, 40);
  ctx.fillText(`Damage Radius: ${rad.toFixed(2)} km`, 20, 60);

  paused = true;
}

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawEarth();
  if (meteor) {
    if (!paused) {
      meteor.y += meteor.vy;
      drawMeteor(meteor);
      if (meteor.y >= canvas.height - 60) {
        explosion(meteor);
      }
    } else {
      explosion(meteor);
    }
  }
  // animate ongoing crater/splash particles even if paused
  if (craterParticles.length > 0) {
    // particles already updated in explosion; just draw subtle fading
    craterParticles.forEach(p => {
      ctx.fillStyle = 'rgba(120,90,60,0.9)';
      ctx.fillRect(p.x, p.y, 2, 2);
    });
  }
  if (splashParticles.length > 0) {
    splashParticles.forEach(p => {
      ctx.fillStyle = 'rgba(210,230,255,0.9)';
      ctx.fillRect(p.x, p.y, 2, 2);
    });
  }

  // decay shockwave and fireball slowly after pause
  if (paused) {
    shockwaveRadius += 1;
    fireballRadius = Math.max(0, fireballRadius - 0.5);
    // slowly reduce crater particles over time
    if (craterParticles.length === 0 && splashParticles.length === 0 && shockwaveRadius > 800) {
      // reset for next sim
      meteor = null;
      paused = false;
      shockwaveRadius = 0;
      fireballRadius = 0;
      craterRadius = 0;
      craterMax = 0;
    }
  }
  requestAnimationFrame(loop);
}

dropBtn.onclick = startMeteor;
if (massiveBtn) massiveBtn.onclick = massiveStrike;

// Init
fetchNeos().then(populateSelect);
applyHeaderContrast();
loop();

// Recompute contrast on resize and when header's attributes change
window.addEventListener('resize', applyHeaderContrast);
const headerEl = document.querySelector('header');
if (headerEl) {
  const mo = new MutationObserver(applyHeaderContrast);
  mo.observe(headerEl, { attributes: true, attributeFilter: ['style', 'class'] });
}
