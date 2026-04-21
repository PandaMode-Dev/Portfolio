/* global document, window, fetch, requestAnimationFrame, cancelAnimationFrame */

function distPointSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const ab2 = abx * abx + aby * aby + 1e-12;
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * abx;
  const cy = a[1] + t * aby;
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  return Math.hypot(dx, dy);
}

function raySegmentIntersect(origin, direction, a, b, maxT) {
  let dx = direction[0];
  let dy = direction[1];
  const dn = Math.hypot(dx, dy);
  if (dn < 1e-12) return null;
  dx /= dn;
  dy /= dn;
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const rxs = dx * sy - dy * sx;
  if (Math.abs(rxs) < 1e-12) return null;
  const qmax = a[0] - origin[0];
  const qmay = a[1] - origin[1];
  const t = (qmax * sy - qmay * sx) / rxs;
  const u = (qmax * dy - qmay * dx) / rxs;
  if (t >= 0 && t <= maxT && u >= 0 && u <= 1) return t;
  return null;
}

function createPortableRng(seed) {
  let state = (Number(seed) ^ 0x9e3779b9) >>> 0;
  return {
    u32() {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state;
    },
    uniform(a, b) {
      return a + (this.u32() / 4294967296) * (b - a);
    },
    randint(a, b) {
      if (b < a) [a, b] = [b, a];
      return a + (this.u32() % (b - a + 1));
    },
  };
}

function rayExitT(ox, oy, dx, dy, w, h) {
  const candidates = [];
  const eps = 1e-9;
  if (dx > eps) candidates.push((w - ox) / dx);
  else if (dx < -eps) candidates.push((0 - ox) / dx);
  if (dy > eps) candidates.push((h - oy) / dy);
  else if (dy < -eps) candidates.push((0 - oy) / dy);
  let best = null;
  for (const t of candidates) {
    if (t > 1e-6 && (best === null || t < best)) best = t;
  }
  return best != null ? best : 1.5 * Math.max(w, h);
}

function aimedSegment(ox, oy, tx, ty, w, h, beamCap) {
  let dx = tx - ox;
  let dy = ty - oy;
  let n = Math.hypot(dx, dy);
  if (n < 1e-10) {
    dx = 1;
    dy = 0;
    n = 1;
  } else {
    dx /= n;
    dy /= n;
  }
  let px = ox + dx * 1e-4;
  let py = oy + dy * 1e-4;
  if (px < 0 || px > w || py < 0 || py > h) {
    dx = -dx;
    dy = -dy;
  }
  const tHit = rayExitT(ox, oy, dx, dy, w, h);
  const tUse = Math.min(tHit, beamCap);
  const bx = ox + dx * tUse;
  const by = oy + dy * tUse;
  return [
    [ox, oy],
    [bx, by],
  ];
}

function getWaveSegment(sim, wv) {
  if (wv.lethal && wv.ax != null) {
    return [
      [wv.ax, wv.ay],
      [wv.bx, wv.by],
    ];
  }
  return aimedSegment(wv.ox, wv.oy, wv.tx, wv.ty, sim.w, sim.h, sim.beamMaxLength);
}

function difficultyRampT(sim) {
  if (sim.maxSteps <= 1) return 1;
  let t = sim.stepCount / (sim.maxSteps - 1);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return t;
}

function effectiveSpawnProb(sim) {
  const t = difficultyRampT(sim);
  return sim.spawnProb + (sim.spawnProbMax - sim.spawnProb) * t;
}

function effectiveMaxWaves(sim) {
  const t = difficultyRampT(sim);
  const cap = Math.round(sim.maxWaves + (sim.maxWavesMax - sim.maxWaves) * t);
  return Math.max(sim.maxWaves, Math.min(sim.maxWavesMax, cap));
}

function effectiveWarningSteps(sim) {
  const t = difficultyRampT(sim);
  const w = sim.warningSteps + (sim.warningStepsLate - sim.warningSteps) * t;
  return Math.max(1, Math.round(w));
}

function effectiveBeamLifetimeSteps(sim) {
  const t = difficultyRampT(sim);
  const L = sim.beamLifetimeSteps + (sim.beamLifetimeStepsLate - sim.beamLifetimeSteps) * t;
  return Math.max(1, Math.round(L));
}

function decaySpikesTick(sim) {
  if (sim.spikeCooldown > 0) sim.spikeCooldown -= 1;
  if (sim.spikeLifeLeft > 0) {
    sim.spikeLifeLeft -= 1;
    if (sim.spikeLifeLeft <= 0) {
      sim.spikeSegments = [];
      sim.spikeCooldown = sim.spikeCooldownSteps;
    }
  }
}

function armWallSpikes(sim) {
  if (!sim.spikeEnabled || sim.spikeTriggerSteps <= 0) return;
  const r = sim.prng;
  const px = sim.pos[0];
  const py = sim.pos[1];
  const ar = sim.agentR;
  const dLeft = px - ar;
  const dRight = sim.w - ar - px;
  const dBot = py - ar;
  const dTop = sim.h - ar - py;
  const dists = [dLeft, dRight, dBot, dTop];
  let side = 0;
  let best = dists[0];
  for (let i = 1; i < 4; i++) {
    if (dists[i] < best) {
      best = dists[i];
      side = i;
    }
  }
  const loR = ar * 1.6;
  const hiX = sim.w - loR;
  const hiY = sim.h - loR;
  const n = r.randint(sim.spikeCountMin, sim.spikeCountMax);
  const depth = sim.spikeDepth;
  const segs = [];
  for (let k = 0; k < n; k++) {
    if (side === 0) {
      const yy = r.uniform(loR, hiY);
      segs.push([
        [0, yy],
        [depth, yy],
      ]);
    } else if (side === 1) {
      const yy = r.uniform(loR, hiY);
      segs.push([
        [sim.w, yy],
        [sim.w - depth, yy],
      ]);
    } else if (side === 2) {
      const xx = r.uniform(loR, hiX);
      segs.push([
        [xx, 0],
        [xx, depth],
      ]);
    } else {
      const xx = r.uniform(loR, hiX);
      segs.push([
        [xx, sim.h],
        [xx, sim.h - depth],
      ]);
    }
  }
  sim.spikeSegments = segs;
  sim.spikeLifeLeft = sim.spikeLifetimeSteps;
}

function updateWallHugStreak(sim) {
  if (!sim.spikeEnabled || sim.spikeTriggerSteps <= 0) return;
  const px = sim.pos[0];
  const py = sim.pos[1];
  const ar = sim.agentR;
  const edgeLeft = px - ar;
  const edgeRight = sim.w - ar - px;
  const edgeBot = py - ar;
  const edgeTop = sim.h - ar - py;
  const distEdge = Math.min(edgeLeft, edgeRight, edgeBot, edgeTop);
  const near = distEdge <= sim.wallHugMargin;
  if (sim.spikeCooldown > 0) {
    sim.hugStreak = 0;
    return;
  }
  if (near) {
    sim.hugStreak += 1;
    if (sim.hugStreak >= sim.spikeTriggerSteps) {
      armWallSpikes(sim);
      sim.hugStreak = 0;
    }
  } else {
    sim.hugStreak = 0;
  }
}

function spawnWave(sim) {
  if (sim.waves.length >= effectiveMaxWaves(sim)) return;
  const r = sim.prng;
  const side = r.randint(0, 3);
  let ox;
  let oy;
  if (side === 0) {
    ox = 0;
    oy = r.uniform(0, sim.h);
  } else if (side === 1) {
    ox = sim.w;
    oy = r.uniform(0, sim.h);
  } else if (side === 2) {
    ox = r.uniform(0, sim.w);
    oy = 0;
  } else {
    ox = r.uniform(0, sim.w);
    oy = sim.h;
  }
  sim.waves.push({
    ox,
    oy,
    tx: sim.pos[0],
    ty: sim.pos[1],
    warningLeft: effectiveWarningSteps(sim),
    lethal: false,
    lifeLeft: 0,
    ax: null,
    ay: null,
    bx: null,
    by: null,
  });
}

function advanceLasersAndSpawn(sim) {
  decaySpikesTick(sim);
  const next = [];
  for (const wv of sim.waves) {
    if (wv.warningLeft > 0) {
      wv.warningLeft -= 1;
      if (wv.warningLeft === 0) {
        wv.lethal = true;
        wv.lifeLeft = effectiveBeamLifetimeSteps(sim);
        const [a, b] = aimedSegment(wv.ox, wv.oy, wv.tx, wv.ty, sim.w, sim.h, sim.beamMaxLength);
        wv.ax = a[0];
        wv.ay = a[1];
        wv.bx = b[0];
        wv.by = b[1];
      }
      next.push(wv);
    } else if (wv.lethal) {
      wv.lifeLeft -= 1;
      if (wv.lifeLeft <= 0) sim.dodges += 1;
      else next.push(wv);
    } else {
      next.push(wv);
    }
  }
  sim.waves = next;
  if (sim.prng.uniform(0, 1) < effectiveSpawnProb(sim)) spawnWave(sim);
}

function sensorSegmentsFromWaves(sim) {
  return sim.waves.map((wv) => getWaveSegment(sim, wv));
}

function allSensorSegments(sim) {
  const w = sensorSegmentsFromWaves(sim);
  for (const s of sim.spikeSegments) w.push(s);
  return w;
}

function laserHitLimit(sim) {
  const sc = sim.laserHitScale != null ? sim.laserHitScale : 0.62;
  return sim.agentR + (sim.laserThickness * 0.5) * sc;
}

function spikeHitLimit(sim) {
  const sc = sim.spikeHitScale != null ? sim.spikeHitScale : 0.62;
  return sim.agentR + (sim.spikeThickness * 0.5) * sc;
}

/** Shorten segment from wall end so hit tube matches playable beam (matches env.py). */
function shrinkSegmentFromStart(a, b, agentR) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const L = Math.hypot(vx, vy);
  if (L < 1e-10) return [a, b];
  const ux = vx / L;
  const uy = vy / L;
  let shave = Math.min(agentR * 0.8, 0.09 * L, L * 0.45);
  if (shave >= L - 1e-9) shave = Math.max(0, L * 0.2);
  return [
    [a[0] + ux * shave, a[1] + uy * shave],
    [b[0], b[1]],
  ];
}

function hitLethalLaser(sim) {
  const limit = laserHitLimit(sim);
  for (const wv of sim.waves) {
    if (!wv.lethal) continue;
    const seg0 = getWaveSegment(sim, wv);
    const seg = shrinkSegmentFromStart(seg0[0], seg0[1], sim.agentR);
    if (distPointSegment(sim.pos, seg[0], seg[1]) <= limit) return true;
  }
  return false;
}

function hitSpikes(sim) {
  if (!sim.spikeSegments.length) return false;
  const limit = spikeHitLimit(sim);
  for (const seg0 of sim.spikeSegments) {
    const seg = shrinkSegmentFromStart(seg0[0], seg0[1], sim.agentR);
    if (distPointSegment(sim.pos, seg[0], seg[1]) <= limit) return true;
  }
  return false;
}

function clearanceToNearestHazard(sim) {
  let best = Infinity;
  const p = sim.pos;
  const limL = laserHitLimit(sim);
  for (const wv of sim.waves) {
    let seg0 = getWaveSegment(sim, wv);
    if (wv.lethal) {
      seg0 = shrinkSegmentFromStart(seg0[0], seg0[1], sim.agentR);
    }
    const d = distPointSegment(p, seg0[0], seg0[1]);
    best = Math.min(best, d - limL);
  }
  const limS = spikeHitLimit(sim);
  for (const s of sim.spikeSegments) {
    const seg = shrinkSegmentFromStart(s[0], s[1], sim.agentR);
    const d = distPointSegment(p, seg[0], seg[1]);
    best = Math.min(best, d - limS);
  }
  return best === Infinity ? sim.hazardMarginZone + 1 : best;
}

function accumulateFitnessShaping(sim) {
  const ar = sim.agentR;
  const px = sim.pos[0];
  const py = sim.pos[1];
  const dEdge = Math.min(px - ar, sim.w - ar - px, py - ar, sim.h - ar - py);
  const innerW = sim.w - 2 * ar;
  const innerH = sim.h - 2 * ar;
  const dMax = Math.max(1e-9, 0.5 * Math.min(innerW, innerH));
  const u = Math.max(0, Math.min(1, dEdge / dMax));
  sim.fitnessShaping += sim.centerClearanceWeight * u * u;
  if (dEdge <= sim.wallHugMargin) sim.fitnessShaping -= sim.wallHugPenaltyWeight;
  const dz = sim.hazardMarginZone;
  const clear = clearanceToNearestHazard(sim);
  const prev = sim.prevHazardClearance;
  if (prev != null && prev < dz) {
    const imp = Math.max(0, clear - prev);
    if (imp > 0) sim.fitnessShaping += sim.hazardEscapeBonusWeight * imp;
    if (prev < dz && clear >= dz) sim.fitnessShaping += sim.hazardZoneExitBonus;
  }
  sim.prevHazardClearance = clear;
  if (clear < dz) {
    const frac = Math.max(0, Math.min(1, (dz - clear) / dz));
    sim.fitnessShaping -= sim.hazardProximityPenalty * frac;
  }
}

function bootstrapSimFromArena(arena) {
  const prng = createPortableRng(arena.layoutSeed);
  prng.uniform(arena.width * 0.35, arena.width * 0.65);
  prng.uniform(arena.height * 0.35, arena.height * 0.65);
  const ar = arena.agentRadius;
  const w0 = arena.width;
  const h0 = arena.height;
  const autoCap = 2 * Math.hypot(w0, h0);
  const baseWaves = arena.maxWaves ?? 1;
  const baseSpawn = arena.spawnProb ?? 0.22;
  const ws = arena.warningSteps ?? 90;
  const sim = {
    w: w0,
    h: h0,
    agentR: ar,
    speed: arena.speed,
    numRays: arena.numRays,
    maxRayLen: arena.maxRayLen,
    maxSteps: arena.maxSteps,
    maxWaves: baseWaves,
    spawnProb: baseSpawn,
    spawnProbMax:
      arena.spawnProbMax != null ? arena.spawnProbMax : Math.min(0.92, baseSpawn * 3.2),
    maxWavesMax: arena.maxWavesMax != null ? arena.maxWavesMax : baseWaves,
    laserThickness: arena.laserThickness ?? 0.028,
    laserHitScale: arena.laserHitScale != null ? arena.laserHitScale : 0.62,
    spikeHitScale: arena.spikeHitScale != null ? arena.spikeHitScale : 0.62,
    warningSteps: ws,
    warningStepsLate:
      arena.warningStepsLate != null ? arena.warningStepsLate : Math.max(8, Math.floor(ws / 5)),
    beamLifetimeSteps: arena.beamLifetimeSteps ?? 56,
    beamLifetimeStepsLate:
      arena.beamLifetimeStepsLate != null
        ? arena.beamLifetimeStepsLate
        : Math.max(8, Math.floor((arena.beamLifetimeSteps ?? 56) / 2)),
    beamMaxLength:
      arena.beamMaxLength != null && arena.beamMaxLength > 0 ? arena.beamMaxLength : autoCap,
    dodgeScoreWeight: arena.dodgeScoreWeight ?? 28,
    centerClearanceWeight: arena.centerClearanceWeight ?? 0.18,
    wallHugPenaltyWeight: arena.wallHugPenaltyWeight ?? 0.65,
    hazardMarginZone: arena.hazardMarginZone ?? 0.078,
    hazardProximityPenalty: arena.hazardProximityPenalty ?? 0.52,
    hazardEscapeBonusWeight: arena.hazardEscapeBonusWeight != null ? arena.hazardEscapeBonusWeight : 14,
    hazardZoneExitBonus: arena.hazardZoneExitBonus != null ? arena.hazardZoneExitBonus : 0.45,
    deathPenalty: arena.deathPenalty ?? 48,
    spikeEnabled: arena.spikeEnabled !== false,
    wallHugMargin: arena.wallHugMargin != null ? arena.wallHugMargin : ar * 3.25,
    spikeTriggerSteps: arena.spikeTriggerSteps ?? 40,
    spikeDepth: arena.spikeDepth ?? 0.048,
    spikeCountMin: arena.spikeCountMin ?? 5,
    spikeCountMax: arena.spikeCountMax ?? 9,
    spikeThickness: arena.spikeThickness ?? 0.024,
    spikeLifetimeSteps: arena.spikeLifetimeSteps ?? 100,
    spikeCooldownSteps: arena.spikeCooldownSteps ?? 50,
    inp: arena.inp,
    hidden: arena.hidden,
    out: arena.out,
    prng,
    waves: [],
    dodges: 0,
    pos: [...arena.startPos],
    vel: [0, 0],
    stepCount: 0,
    spikeSegments: [],
    spikeLifeLeft: 0,
    spikeCooldown: 0,
    hugStreak: 0,
    fitnessShaping: 0,
    terminatedByHit: false,
    prevHazardClearance: null,
  };
  if (sim.maxWavesMax < sim.maxWaves) sim.maxWavesMax = sim.maxWaves;
  if (sim.spawnProbMax < sim.spawnProb) sim.spawnProbMax = sim.spawnProb;
  if (sim.warningStepsLate > sim.warningSteps) sim.warningStepsLate = sim.warningSteps;
  if (sim.beamLifetimeStepsLate > sim.beamLifetimeSteps) sim.beamLifetimeStepsLate = sim.beamLifetimeSteps;
  spawnWave(sim);
  sim.prevHazardClearance = clearanceToNearestHazard(sim);
  return sim;
}

function forward(flat, x, inp, hidden, out) {
  let idx = 0;
  const h = new Array(hidden);
  for (let j = 0; j < hidden; j++) {
    let s = 0;
    for (let i = 0; i < inp; i++) {
      s += x[i] * flat[idx + i * hidden + j];
    }
    s += flat[idx + inp * hidden + j];
    h[j] = Math.tanh(s);
  }
  idx += inp * hidden + hidden;
  const w2off = idx;
  const y = new Array(out);
  for (let k = 0; k < out; k++) {
    let s = 0;
    for (let j = 0; j < hidden; j++) {
      s += h[j] * flat[w2off + j * out + k];
    }
    s += flat[w2off + hidden * out + k];
    y[k] = s;
  }
  return y;
}

function observe(sim) {
  const segs = allSensorSegments(sim);
  const rays = [];
  const n = sim.numRays;
  for (let k = 0; k < n; k++) {
    const ang = (2 * Math.PI * k) / n;
    const direction = [Math.cos(ang), Math.sin(ang)];
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const t = raySegmentIntersect(sim.pos, direction, seg[0], seg[1], sim.maxRayLen);
      if (t !== null && (best === null || t < best)) best = t;
    }
    rays.push(best === null ? sim.maxRayLen : best);
  }
  const raysNorm = rays.map((r) => r / sim.maxRayLen);
  const px = sim.pos[0] / sim.w;
  const py = sim.pos[1] / sim.h;
  const vx = sim.vel[0] / (sim.speed + 1e-12);
  const vy = sim.vel[1] / (sim.speed + 1e-12);
  return raysNorm.concat([px, py, vx, vy]);
}

function stepSim(sim, steer) {
  advanceLasersAndSpawn(sim);

  let sx = steer[0];
  let sy = steer[1];
  let n = Math.hypot(sx, sy);
  let dirx;
  let diry;
  if (n < 1e-8) {
    const vn = Math.hypot(sim.vel[0], sim.vel[1]);
    if (vn < 1e-8) {
      dirx = 1;
      diry = 0;
    } else {
      dirx = sim.vel[0] / vn;
      diry = sim.vel[1] / vn;
    }
  } else {
    dirx = sx / n;
    diry = sy / n;
  }
  sim.vel[0] = dirx * sim.speed;
  sim.vel[1] = diry * sim.speed;
  sim.pos[0] += sim.vel[0];
  sim.pos[1] += sim.vel[1];

  for (let axis = 0; axis < 2; axis++) {
    const lo = sim.agentR;
    const hi = axis === 0 ? sim.w - sim.agentR : sim.h - sim.agentR;
    if (sim.pos[axis] < lo) {
      sim.pos[axis] = lo;
      sim.vel[axis] *= -0.3;
    } else if (sim.pos[axis] > hi) {
      sim.pos[axis] = hi;
      sim.vel[axis] *= -0.3;
    }
  }

  updateWallHugStreak(sim);

  if (hitLethalLaser(sim) || hitSpikes(sim)) {
    sim.terminatedByHit = true;
    return { done: true, dead: true };
  }
  accumulateFitnessShaping(sim);
  sim.stepCount += 1;
  if (sim.stepCount >= sim.maxSteps) {
    return { done: true, dead: false };
  }
  return { done: false, dead: false };
}

function cloneSimFromArena(arena) {
  return bootstrapSimFromArena(arena);
}

/** --- UI --- */

const $ = (id) => document.getElementById(id);

const arenaCanvas = $("arena");
const chartCanvas = $("chart");
const actx = arenaCanvas.getContext("2d");
const cctx = chartCanvas.getContext("2d");

let evolutionResult = null;
let sim = null;
let genomeFlat = null;
/** Parallel replay: one sim + genome per displayed individual (subset if population is huge). */
let swarmSims = [];
let swarmGenomes = [];
let swarmTerminated = [];
let swarmBestIdx = 0;
const MAX_SWARM_RENDER = 80;
let playing = false;
let rafId = null;
let currentGenIndex = 0;
let lastGenomeKey = "";
let streamGenerationsTotal = 0;
let evolutionStreamDone = false;
/** Generation indices received from the server but not yet shown (waiting for arena to finish). */
let pendingArenaGenIndices = [];
/** Single-genome replay: episode ended (stepSim returned done). */
let singleEpisodeComplete = false;
/** When true, new generations will not call startLoop() until the user presses Play. */
let suppressAutoPlayUntilPlay = false;

function maybeEvolutionAutoPlay() {
  const box = $("autoPlayEvolve");
  if (!box || !box.checked) return;
  if (suppressAutoPlayUntilPlay) return;
  if (!evolutionResult || !evolutionResult.generations.length) return;
  if (!sim) return;
  if (swarmSims.length === 0 && !genomeFlat) return;
  startLoop();
}

function buildSwarmFromGeneration(g, arena) {
  swarmSims = [];
  swarmGenomes = [];
  swarmTerminated = [];
  swarmBestIdx = 0;

  const popG = g.populationGenomes;
  if (!popG || !popG.length) {
    sim = bootstrapSimFromArena(arena);
    genomeFlat = g.genome || null;
    return;
  }

  const popN = popG.length;
  const rawBest = Number.isInteger(g.bestIndex) ? g.bestIndex : 0;
  const bestIdxGlobal = Math.max(0, Math.min(popN - 1, rawBest));
  let indices;
  if (popN <= MAX_SWARM_RENDER) {
    indices = Array.from({ length: popN }, (_, i) => i);
  } else {
    const s = new Set([bestIdxGlobal]);
    for (let i = 0; i < popN && s.size < MAX_SWARM_RENDER; i++) s.add(i);
    indices = Array.from(s).sort((a, b) => a - b);
  }

  swarmGenomes = indices.map((i) => popG[i]);
  swarmBestIdx = indices.indexOf(bestIdxGlobal);
  if (swarmBestIdx < 0) swarmBestIdx = 0;
  swarmSims = indices.map(() => bootstrapSimFromArena(arena));
  swarmTerminated = indices.map(() => false);
  sim = swarmSims[swarmBestIdx];
  genomeFlat = swarmGenomes[swarmBestIdx];
}

function leadSim() {
  if (swarmSims.length) return swarmSims[swarmBestIdx];
  return sim;
}

function allArenaAgentsFinished() {
  if (swarmSims.length) return swarmTerminated.length > 0 && swarmTerminated.every(Boolean);
  if (sim && genomeFlat) return singleEpisodeComplete;
  return true;
}

function syncBattleRoyaleControls() {
  const brEl = $("battle_royale");
  if (!brEl) return;
  const br = brEl.checked;
  for (const id of ["tournament_k", "crossover_rate"]) {
    const el = $(id);
    if (!el) continue;
    el.disabled = br;
    const lab = el.closest("label");
    if (lab) lab.classList.toggle("field-disabled", br);
  }
}

function refreshGenReadout() {
  const el = $("genReadout");
  if (!el || !evolutionResult) return;
  const last = Math.max(0, evolutionResult.generations.length - 1);
  el.textContent = `${currentGenIndex} / ${last}`;
}

function tryApplyNextPendingGeneration() {
  if (!evolutionResult || !evolutionResult.generations.length) return;
  if (!allArenaAgentsFinished()) return;
  if (pendingArenaGenIndices.length === 0) return;
  currentGenIndex = pendingArenaGenIndices.shift();
  $("genSlider").value = String(currentGenIndex);
  refreshGenReadout();
  restartEpisode();
  syncGenDotsHighlight();
  const box = $("autoPlayEvolve");
  if (box && box.checked && !suppressAutoPlayUntilPlay) {
    startLoop();
  } else {
    drawArena();
    updateHud(false, false);
  }
}

function fitnessToColor(t) {
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(50 + (1 - u) * 110);
  const g = Math.round(65 + u * 175);
  const b = Math.round(90 + u * 155);
  return `rgb(${r},${g},${b})`;
}

function syncGenDotsHighlight() {
  const strip = $("genStrip");
  if (!strip) return;
  strip.querySelectorAll(".gen-dot").forEach((d, i) => {
    if (i === currentGenIndex) d.setAttribute("aria-current", "true");
    else d.removeAttribute("aria-current");
  });
}

function appendGenerationLogLine(rec) {
  const pre = $("genLog");
  if (!pre || !rec.generationStats) return;
  const st = rec.generationStats;
  const d = st.deaths;
  const line = `Gen ${rec.index}: best ${rec.best.toFixed(1)} mean ${rec.mean.toFixed(1)} ever ${rec.bestEver.toFixed(1)} | deaths beam ${d.laser} spike ${d.spike} horizon ${d.horizon} | ${st.struggleSummary}\n`;
  pre.textContent += line;
  pre.scrollTop = pre.scrollHeight;
}

function renderGenDots() {
  const strip = $("genStrip");
  if (!strip) return;
  strip.innerHTML = "";
  if (!evolutionResult || evolutionResult.generations.length === 0) {
    const p = document.createElement("p");
    p.className = "gen-strip-empty";
    p.textContent = "Run evolution to see one dot per generation.";
    strip.appendChild(p);
    return;
  }
  const gens = evolutionResult.generations;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < gens.length; i++) {
    mn = Math.min(mn, gens[i].best);
    mx = Math.max(mx, gens[i].best);
  }
  if (!Number.isFinite(mn) || mn === mx) {
    mn -= 1;
    mx += 1;
  }
  strip.setAttribute("role", "list");
  for (let i = 0; i < gens.length; i++) {
    const g = gens[i];
    const t = (g.best - mn) / (mx - mn);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gen-dot";
    btn.style.background = fitnessToColor(t);
    let tip = `Generation ${g.index}: best ${g.best.toFixed(1)} · mean ${g.mean.toFixed(1)} · best ever ${g.bestEver.toFixed(1)}`;
    if (g.generationStats) {
      const d = g.generationStats.deaths;
      tip += ` · deaths beam ${d.laser} spike ${d.spike} horizon ${d.horizon}`;
      tip += `\n${g.generationStats.struggleSummary}`;
    }
    btn.title = tip;
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-label", `Generation ${g.index}, best fitness ${g.best.toFixed(1)}`);
    btn.addEventListener("click", () => setGeneration(i));
    strip.appendChild(btn);
  }
  syncGenDotsHighlight();
}

function setGeneration(index) {
  if (!evolutionResult) return;
  const last = evolutionResult.generations.length - 1;
  pendingArenaGenIndices = [];
  currentGenIndex = Math.max(0, Math.min(last, index));
  $("genSlider").value = String(currentGenIndex);
  refreshGenReadout();
  stopLoop();
  restartEpisode();
  drawChart();
  syncGenDotsHighlight();
}

function setStatus(text, cls) {
  const el = $("runStatus");
  el.textContent = text;
  el.className = "status-pill" + (cls ? ` ${cls}` : "");
}

function readNum(id) {
  return parseFloat($(id).value);
}

function readInt(id) {
  return parseInt($(id).value, 10);
}

function buildEvolvePayload() {
  const lsRaw = $("layout_seed").value.trim();
  let layoutSeed = null;
  if (lsRaw !== "") {
    const n = parseInt(lsRaw, 10);
    layoutSeed = Number.isFinite(n) ? n : null;
  }
  return {
    generations: readInt("generations"),
    population: readInt("population"),
    hidden: readInt("hidden"),
    elite: readInt("elite"),
    tournament_k: readInt("tournament_k"),
    crossover_rate: readNum("crossover_rate"),
    mutation_rate: readNum("mutation_rate"),
    mutation_sigma: readNum("mutation_sigma"),
    parallel_eval: !$("parallel_eval") || $("parallel_eval").checked,
    eval_workers: readInt("eval_workers"),
    seed: readInt("seed"),
    layout_seed: layoutSeed,
    width: readNum("width"),
    height: readNum("height"),
    agent_radius: readNum("agent_radius"),
    speed: readNum("speed"),
    max_waves: readInt("max_waves"),
    max_waves_max: readInt("max_waves_max"),
    spawn_prob: readNum("spawn_prob"),
    spawn_prob_max: readNum("spawn_prob_max"),
    laser_thickness: readNum("laser_thickness"),
    spike_enabled: !$("spike_enabled") || $("spike_enabled").checked,
    wall_hug_margin: readNum("wall_hug_margin"),
    spike_trigger_steps: readInt("spike_trigger_steps"),
    spike_depth: readNum("spike_depth"),
    spike_count_min: readInt("spike_count_min"),
    spike_count_max: readInt("spike_count_max"),
    spike_thickness: readNum("spike_thickness"),
    spike_lifetime_steps: readInt("spike_lifetime_steps"),
    spike_cooldown_steps: readInt("spike_cooldown_steps"),
    warning_steps: readInt("warning_steps"),
    warning_steps_late: readInt("warning_steps_late"),
    beam_lifetime_steps: readInt("beam_lifetime_steps"),
    beam_lifetime_steps_late: readInt("beam_lifetime_steps_late"),
    beam_max_length: readNum("beam_max_length"),
    dodge_score_weight: readNum("dodge_score_weight"),
    center_clearance_weight: readNum("center_clearance_weight"),
    wall_hug_penalty_weight: readNum("wall_hug_penalty_weight"),
    hazard_margin_zone: readNum("hazard_margin_zone"),
    hazard_proximity_penalty: readNum("hazard_proximity_penalty"),
    hazard_escape_bonus_weight: readNum("hazard_escape_bonus_weight"),
    hazard_zone_exit_bonus: readNum("hazard_zone_exit_bonus"),
    death_penalty: readNum("death_penalty"),
    num_rays: readInt("num_rays"),
    max_ray_len: readNum("max_ray_len"),
    max_steps: readInt("max_steps"),
    battle_royale: $("battle_royale") ? $("battle_royale").checked : true,
  };
}

function resizeArenaCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const frame = document.querySelector(".game-frame");
  const rect = arenaCanvas.getBoundingClientRect();
  const avail = frame ? frame.clientWidth - 24 : rect.width || 560;
  const css = Math.min(720, Math.max(300, avail));
  arenaCanvas.style.width = `${css}px`;
  arenaCanvas.style.height = `${css}px`;
  arenaCanvas.width = Math.floor(css * dpr);
  arenaCanvas.height = Math.floor(css * dpr);
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeChartCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = chartCanvas.getBoundingClientRect();
  const w = Math.max(240, rect.width || 300);
  const ch = 180;
  chartCanvas.style.width = `${w}px`;
  chartCanvas.style.height = `${ch}px`;
  chartCanvas.width = Math.floor(w * dpr);
  chartCanvas.height = Math.floor(ch * dpr);
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawArena() {
  const lead = leadSim();
  if (!lead) return;
  const w = arenaCanvas.width / (window.devicePixelRatio || 1);
  const h = arenaCanvas.height / (window.devicePixelRatio || 1);
  actx.clearRect(0, 0, w, h);

  const rg = actx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.72);
  rg.addColorStop(0, "#141c28");
  rg.addColorStop(1, "#06080c");
  actx.fillStyle = rg;
  actx.fillRect(0, 0, w, h);

  const sx = w / lead.w;
  const sy = h / lead.h;
  const pxu = Math.min(sx, sy);
  const beamPx = Math.max(2.5, lead.laserThickness * pxu);
  const spikePx = Math.max(2, lead.spikeThickness * pxu);

  actx.strokeStyle = "rgba(88, 166, 255, 0.18)";
  actx.lineWidth = 1;
  actx.strokeRect(0.5, 0.5, w - 1, h - 1);

  actx.lineCap = "round";
  for (const sp of lead.spikeSegments) {
    actx.lineCap = "butt";
    const x0 = sp[0][0] * sx;
    const y0 = h - sp[0][1] * sy;
    const x1 = sp[1][0] * sx;
    const y1 = h - sp[1][1] * sy;
    actx.beginPath();
    actx.moveTo(x0, y0);
    actx.lineTo(x1, y1);
    actx.strokeStyle = "rgba(180, 95, 255, 0.45)";
    actx.lineWidth = spikePx * 2.2;
    actx.stroke();
    actx.beginPath();
    actx.moveTo(x0, y0);
    actx.lineTo(x1, y1);
    actx.strokeStyle = "rgba(230, 200, 255, 0.95)";
    actx.lineWidth = Math.max(2, spikePx * 1.05);
    actx.stroke();
    actx.lineCap = "round";
  }
  for (const wave of lead.waves) {
    const seg = getWaveSegment(lead, wave);
    const x0 = seg[0][0] * sx;
    const y0 = h - seg[0][1] * sy;
    const x1 = seg[1][0] * sx;
    const y1 = h - seg[1][1] * sy;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    if (!wave.lethal) {
      actx.save();
      actx.setLineDash([7, 6]);
      actx.strokeStyle = "rgba(255, 210, 100, 0.95)";
      actx.lineWidth = Math.max(3, beamPx * 0.92);
      actx.shadowColor = "rgba(255, 200, 80, 0.6)";
      actx.shadowBlur = 12;
      actx.beginPath();
      actx.moveTo(x0, y0);
      actx.lineTo(x1, y1);
      actx.stroke();
      actx.restore();
      actx.fillStyle = "rgba(255, 230, 160, 0.95)";
      actx.font = "600 10px system-ui";
      actx.textAlign = "center";
      actx.fillText("WARNING", mx, my - 6);
      actx.textAlign = "left";
    } else {
      actx.lineCap = "butt";
      actx.beginPath();
      actx.moveTo(x0, y0);
      actx.lineTo(x1, y1);
      actx.strokeStyle = "rgba(255, 50, 90, 0.35)";
      actx.lineWidth = beamPx * 2.35;
      actx.stroke();
      actx.beginPath();
      actx.moveTo(x0, y0);
      actx.lineTo(x1, y1);
      actx.strokeStyle = "rgba(255, 120, 160, 0.98)";
      actx.lineWidth = beamPx * 1.12;
      actx.stroke();
      actx.beginPath();
      actx.moveTo(x0, y0);
      actx.lineTo(x1, y1);
      actx.strokeStyle = "rgba(255, 235, 245, 0.9)";
      actx.lineWidth = Math.max(1.5, beamPx * 0.48);
      actx.stroke();
      actx.lineCap = "round";
    }
  }

  const arBase = Math.max(4, lead.agentR * Math.min(sx, sy));
  const singleDead = !swarmSims.length && sim && sim.terminatedByHit;
  const drawOrder = swarmSims.length
    ? swarmSims.map((_, i) => i).sort((a, b) => {
        const da = swarmTerminated[a] ? 1 : 0;
        const db = swarmTerminated[b] ? 1 : 0;
        if (da !== db) return db - da;
        if (a === swarmBestIdx) return 1;
        if (b === swarmBestIdx) return -1;
        return a - b;
      })
    : [0];

  for (const idx of drawOrder) {
    const s = swarmSims.length ? swarmSims[idx] : lead;
    const isBest = !swarmSims.length || idx === swarmBestIdx;
    const dead = swarmSims.length ? swarmTerminated[idx] : singleDead;
    const ax = s.pos[0] * sx;
    const ay = h - s.pos[1] * sy;
    const ar = isBest ? arBase : arBase * 0.88;
    if (dead) {
      const fill = isBest ? "rgba(248, 81, 73, 0.95)" : "rgba(220, 65, 60, 0.88)";
      actx.fillStyle = fill;
      actx.beginPath();
      actx.arc(ax, ay, ar, 0, Math.PI * 2);
      actx.fill();
      actx.strokeStyle = "rgba(90, 25, 22, 0.95)";
      actx.lineWidth = Math.max(1.5, ar * 0.11);
      actx.stroke();
      const k = ar * 0.58;
      actx.strokeStyle = "rgba(20, 12, 12, 0.95)";
      actx.lineWidth = Math.max(2.2, ar * 0.15);
      actx.lineCap = "round";
      actx.beginPath();
      actx.moveTo(ax - k, ay - k);
      actx.lineTo(ax + k, ay + k);
      actx.moveTo(ax - k, ay + k);
      actx.lineTo(ax + k, ay - k);
      actx.stroke();
      continue;
    }
    if (isBest) {
      const ag = actx.createRadialGradient(ax - ar * 0.35, ay - ar * 0.35, ar * 0.15, ax, ay, ar * 1.05);
      ag.addColorStop(0, "#e8fbff");
      ag.addColorStop(0.55, "rgba(77, 212, 255, 0.95)");
      ag.addColorStop(1, "rgba(30, 120, 200, 0.85)");
      actx.fillStyle = ag;
      actx.beginPath();
      actx.arc(ax, ay, ar, 0, Math.PI * 2);
      actx.fill();
      actx.strokeStyle = "rgba(200, 245, 255, 0.5)";
      actx.lineWidth = 1.5;
      actx.stroke();
    } else {
      actx.fillStyle = "rgba(118, 128, 145, 0.48)";
      actx.beginPath();
      actx.arc(ax, ay, ar, 0, Math.PI * 2);
      actx.fill();
      actx.strokeStyle = "rgba(160, 170, 188, 0.32)";
      actx.lineWidth = 1;
      actx.stroke();
    }
  }
}

function drawChart() {
  if (!evolutionResult) return;
  const gens = evolutionResult.generations;
  const padL = 44;
  const padR = 16;
  const padT = 12;
  const padB = 24;
  const cw = chartCanvas.width / (window.devicePixelRatio || 1);
  const ch = chartCanvas.height / (window.devicePixelRatio || 1);
  cctx.clearRect(0, 0, cw, ch);
  cctx.fillStyle = "#0d1117";
  cctx.fillRect(0, 0, cw, ch);

  const n = gens.length;
  if (n < 1) return;

  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < n; i++) {
    ymin = Math.min(ymin, gens[i].mean, gens[i].best, gens[i].bestEver);
    ymax = Math.max(ymax, gens[i].mean, gens[i].best, gens[i].bestEver);
  }
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }

  const innerW = cw - padL - padR;
  const innerH = ch - padT - padB;
  const xAt = (i) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - ((v - ymin) / (ymax - ymin)) * innerH;

  cctx.strokeStyle = "#30363d";
  cctx.lineWidth = 1;
  for (let t = 0; t <= 4; t++) {
    const v = ymin + (t / 4) * (ymax - ymin);
    const y = yAt(v);
    cctx.beginPath();
    cctx.moveTo(padL, y);
    cctx.lineTo(cw - padR, y);
    cctx.stroke();
    cctx.fillStyle = "#6e7681";
    cctx.font = "11px system-ui";
    cctx.textAlign = "right";
    cctx.fillText(v.toFixed(0), padL - 6, y + 3);
  }

  function polyline(getter, color, lw) {
    cctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xAt(i);
      const y = yAt(getter(gens[i]));
      if (i === 0) cctx.moveTo(x, y);
      else cctx.lineTo(x, y);
    }
    cctx.strokeStyle = color;
    cctx.lineWidth = lw;
    cctx.stroke();
  }

  polyline((g) => g.mean, "rgba(210, 168, 255, 0.85)", 1.5);
  polyline((g) => g.best, "rgba(88, 166, 255, 0.95)", 2);
  polyline((g) => g.bestEver, "rgba(63, 185, 80, 0.75)", 1.5);

  const gi = Math.max(0, Math.min(n - 1, currentGenIndex));
  const gx = xAt(gi);
  cctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  cctx.lineWidth = 1;
  cctx.beginPath();
  cctx.moveTo(gx, padT);
  cctx.lineTo(gx, padT + innerH);
  cctx.stroke();

  cctx.fillStyle = "#8b949e";
  cctx.font = "11px system-ui";
  cctx.textAlign = "center";
  cctx.fillText("generation", padL + innerW / 2, ch - 8);
}

function updateHud(done, dead) {
  let g = null;
  if (evolutionResult && evolutionResult.generations.length) {
    const gi = Math.max(0, Math.min(evolutionResult.generations.length - 1, currentGenIndex));
    g = evolutionResult.generations[gi];
  }
  $("hudGen").textContent = g ? `Generation ${g.index}` : "Generation —";
  const highEl = $("hudHigh");
  if (highEl) {
    highEl.textContent = g
      ? `High score (evolution): ${g.bestEver.toFixed(1)} · only goes up`
      : "High score (evolution) —";
  }
  const focal = leadSim();
  if (focal) {
    const bonus = done && !dead && focal.stepCount >= focal.maxSteps ? 50 : 0;
    const shaping = focal.fitnessShaping ?? 0;
    const deathAdj = done && dead && focal.terminatedByHit ? focal.deathPenalty ?? 0 : 0;
    const runScore = focal.stepCount + focal.dodgeScoreWeight * focal.dodges + bonus + shaping - deathAdj;
    let runLine = `Best run: ${focal.stepCount} steps · ${focal.dodges} dodged · score ${runScore.toFixed(0)}`;
    if (swarmSims.length > 1) {
      const alive = swarmTerminated.filter((t) => !t).length;
      const total = swarmSims.length;
      const full = g && g.populationGenomes ? g.populationGenomes.length : total;
      const capNote = full > total ? ` (showing ${total}/${full})` : "";
      runLine += ` · swarm ${alive}/${total} alive${capNote}`;
    }
    $("hudStep").textContent = runLine;
  } else {
    $("hudStep").textContent = "This run —";
  }
  $("hudFit").textContent = g
    ? `This gen: best ${g.best.toFixed(1)} · mean ${g.mean.toFixed(1)}`
    : "This gen —";
  const st = $("hudState");
  if (!focal) {
    st.textContent = "—";
    st.className = "ok";
  } else if (!done) {
    st.textContent = swarmSims.length ? "swarm running" : "running";
    st.className = "ok";
  } else if (dead) {
    st.textContent = swarmSims.length ? "swarm finished (best died)" : "dead";
    st.className = "dead";
  } else {
    st.textContent = swarmSims.length ? "swarm finished" : "survived";
    st.className = "ok";
  }
}

function restartEpisode() {
  if (!evolutionResult) return;
  const gens = evolutionResult.generations;
  if (!gens.length) return;
  const arena = evolutionResult.arena;
  const gi = Math.max(0, Math.min(gens.length - 1, currentGenIndex));
  currentGenIndex = gi;
  singleEpisodeComplete = false;
  buildSwarmFromGeneration(gens[gi], arena);
  lastGenomeKey = `${currentGenIndex}`;
  drawArena();
  updateHud(false, false);
}

function simulationTickMulti(steps) {
  if (swarmSims.length) {
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < swarmSims.length; i++) {
        if (swarmTerminated[i]) continue;
        const si = swarmSims[i];
        const obs = observe(si);
        const act = forward(swarmGenomes[i], obs, si.inp, si.hidden, si.out);
        const r = stepSim(si, act);
        if (r.done) swarmTerminated[i] = true;
      }
      if (swarmTerminated[swarmBestIdx] && !swarmTerminated.every(Boolean)) {
        advanceLasersAndSpawn(swarmSims[swarmBestIdx]);
      }
      if (swarmTerminated.every(Boolean)) break;
    }
    const allFinished = swarmTerminated.every(Boolean);
    const lead = swarmSims[swarmBestIdx];
    const leadDead = allFinished && lead.terminatedByHit;
    drawArena();
    updateHud(allFinished, leadDead);
    if (allFinished) {
      playing = false;
      tryApplyNextPendingGeneration();
    }
    return;
  }

  if (!sim || !genomeFlat) return;
  let done = false;
  let dead = false;
  for (let s = 0; s < steps; s++) {
    const obs = observe(sim);
    const act = forward(genomeFlat, obs, sim.inp, sim.hidden, sim.out);
    const r = stepSim(sim, act);
    done = r.done;
    dead = r.dead;
    if (done) break;
  }
  drawArena();
  updateHud(done, dead);
  if (done) {
    singleEpisodeComplete = true;
    playing = false;
    tryApplyNextPendingGeneration();
  }
}

function loop() {
  if (!playing) {
    rafId = null;
    $("btnPlay").disabled = !evolutionResult || !sim;
    $("btnPause").disabled = true;
    return;
  }
  const steps = parseInt($("speedSlider").value, 10) || 1;
  simulationTickMulti(steps);
  if (playing) {
    rafId = requestAnimationFrame(loop);
  } else {
    rafId = null;
    $("btnPlay").disabled = !evolutionResult || !sim;
    $("btnPause").disabled = true;
  }
}

function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  playing = true;
  $("btnPlay").disabled = true;
  $("btnPause").disabled = false;
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  $("btnPlay").disabled = !evolutionResult || !sim;
  $("btnPause").disabled = true;
}

function handleStreamPacket(pkt) {
  if (pkt.type === "error") {
    throw new Error(pkt.message || "Evolution failed");
  }
  if (pkt.type === "init") {
    streamGenerationsTotal = pkt.generationsTotal || 0;
    evolutionResult = {
      arena: pkt.arena,
      generations: [],
      historyBest: [],
    };
    swarmSims = [];
    swarmGenomes = [];
    swarmTerminated = [];
    swarmBestIdx = 0;
    pendingArenaGenIndices = [];
    singleEpisodeComplete = false;
    sim = bootstrapSimFromArena(pkt.arena);
    genomeFlat = null;
    currentGenIndex = 0;
    $("genSlider").min = "0";
    $("genSlider").max = "0";
    $("genSlider").value = "0";
    $("genSlider").disabled = true;
    const cap = Math.max(0, streamGenerationsTotal - 1);
    $("genReadout").textContent = streamGenerationsTotal ? `0 / ${cap}` : "0 / 0";
    resizeArenaCanvas();
    drawArena();
    updateHud(false, false);
    renderGenDots();
    resizeChartCanvas();
    drawChart();
    setStatus(streamGenerationsTotal ? `Evolving… 0 / ${streamGenerationsTotal}` : "Evolving…", "running");
    const gl = $("genLog");
    if (gl) gl.textContent = "";
    return;
  }
  if (pkt.type === "generation") {
    evolutionResult.generations.push(pkt.record);
    appendGenerationLogLine(pkt.record);
    const idx = evolutionResult.generations.length - 1;
    $("genSlider").max = String(idx);
    renderGenDots();
    resizeChartCanvas();
    drawChart();
    syncGenDotsHighlight();
    const p = pkt.progress;
    if (p) setStatus(`Evolving… gen ${p.current} / ${p.total}`, "running");
    const strip = $("genStrip");
    if (strip) strip.scrollLeft = strip.scrollWidth;

    const showNow = idx === 0 || (pendingArenaGenIndices.length === 0 && allArenaAgentsFinished());
    if (showNow) {
      currentGenIndex = idx;
      $("genSlider").value = String(currentGenIndex);
      refreshGenReadout();
      restartEpisode();
      maybeEvolutionAutoPlay();
    } else {
      pendingArenaGenIndices.push(idx);
      refreshGenReadout();
    }
    return;
  }
  if (pkt.type === "done") {
    evolutionStreamDone = true;
    evolutionResult.bestGenome = pkt.bestGenome;
    if (pkt.historyBest && pkt.historyBest.length) evolutionResult.historyBest = pkt.historyBest;
    const last = evolutionResult.generations.length - 1;
    $("genSlider").disabled = false;
    $("genSlider").max = String(Math.max(0, last));
    refreshGenReadout();
    $("btnRestart").disabled = false;
    $("btnPlay").disabled = false;
    $("btnEvolve").disabled = false;
    renderGenDots();
    drawChart();
    syncGenDotsHighlight();
    setStatus("Ready", "ready");
    if (pendingArenaGenIndices.length === 0 && allArenaAgentsFinished()) {
      currentGenIndex = Math.max(0, last);
      $("genSlider").value = String(currentGenIndex);
      refreshGenReadout();
      restartEpisode();
      maybeEvolutionAutoPlay();
    }
  }
}

async function consumeEvolveStream(res) {
  evolutionStreamDone = false;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (;;) {
      const sep = buf.indexOf("\n\n");
      if (sep < 0) break;
      const raw = buf.slice(0, sep).trim();
      buf = buf.slice(sep + 2);
      if (!raw.startsWith("data:")) continue;
      const jsonStr = raw.replace(/^data:\s*/, "");
      let pkt;
      try {
        pkt = JSON.parse(jsonStr);
      } catch (_) {
        continue;
      }
      handleStreamPacket(pkt);
    }
  }
  if (!evolutionStreamDone) {
    $("btnEvolve").disabled = false;
    if (evolutionResult && evolutionResult.generations && evolutionResult.generations.length) {
      $("genSlider").disabled = false;
      $("btnRestart").disabled = false;
      $("btnPlay").disabled = false;
    }
    setStatus("Stream ended before completion", "");
  }
}

async function onEvolve() {
  stopLoop();
  pendingArenaGenIndices = [];
  singleEpisodeComplete = false;
  suppressAutoPlayUntilPlay = false;
  setStatus("Connecting…", "running");
  $("btnEvolve").disabled = true;
  $("btnPlay").disabled = true;
  $("btnPause").disabled = true;
  $("btnRestart").disabled = true;
  $("genSlider").disabled = true;

  const payload = buildEvolvePayload();
  const apiUrl = new URL("api/evolve/stream", window.location.href).href;

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = await res.json();
        if (typeof err.detail === "string") msg = err.detail;
        else if (Array.isArray(err.detail))
          msg = err.detail.map((x) => (x.msg ? x.msg : JSON.stringify(x))).join("; ");
      } catch (_) {}
      throw new Error(msg);
    }
    await consumeEvolveStream(res);
  } catch (e) {
    if (typeof window.runLaserEvolveClient === "function") {
      console.warn("Evolution API unavailable, using in-browser GA.", e);
      try {
        await window.runLaserEvolveClient(payload);
        return;
      } catch (e2) {
        console.error(e2);
        setStatus(`Error: ${e2.message}`, "");
        alert(e2.message);
      }
    } else {
      console.error(e);
      setStatus(`Error: ${e.message}`, "");
      alert(e.message);
    }
    $("btnEvolve").disabled = false;
    if (evolutionResult && evolutionResult.generations && evolutionResult.generations.length) {
      $("genSlider").disabled = false;
      $("btnRestart").disabled = false;
      $("btnPlay").disabled = false;
    }
  }
}

function onGenSlider() {
  setGeneration(parseInt($("genSlider").value, 10));
}

function wire() {
  const br = $("battle_royale");
  if (br) {
    br.addEventListener("change", syncBattleRoyaleControls);
    syncBattleRoyaleControls();
  }
  $("btnEvolve").addEventListener("click", onEvolve);
  $("genSlider").addEventListener("input", onGenSlider);
  $("speedSlider").addEventListener("input", () => {
    $("speedReadout").textContent = `${$("speedSlider").value}×`;
  });
  $("btnPlay").addEventListener("click", () => {
    if (!sim) return;
    suppressAutoPlayUntilPlay = false;
    const doneText = $("hudState").textContent;
    if (
      doneText === "dead" ||
      doneText === "survived" ||
      doneText === "swarm finished" ||
      doneText === "swarm finished (best died)"
    )
      restartEpisode();
    startLoop();
  });
  $("btnPause").addEventListener("click", () => {
    suppressAutoPlayUntilPlay = true;
    stopLoop();
    $("btnPlay").disabled = !evolutionResult || !sim;
  });
  $("btnRestart").addEventListener("click", () => {
    stopLoop();
    restartEpisode();
    $("btnPlay").disabled = false;
  });
  window.addEventListener("resize", () => {
    resizeArenaCanvas();
    resizeChartCanvas();
    drawArena();
    drawChart();
  });
}

function init() {
  $("speedReadout").textContent = `${$("speedSlider").value}×`;
  wire();
  resizeArenaCanvas();
  resizeChartCanvas();
  renderGenDots();
}

init();
