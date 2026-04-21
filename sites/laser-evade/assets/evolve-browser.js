/* global createPortableRng, bootstrapSimFromArena, observe, forward, stepSim, hitLethalLaser, hitSpikes, handleStreamPacket */
/**
 * In-browser genetic algorithm for static hosting (GitHub Pages).
 * Uses the same simulation + MLP as assets/app.js when the Python API is unavailable.
 */
(function () {
  function mlpSizes(numRays, hidden) {
    return [numRays + 4, hidden, 2];
  }

  function numParams(inp, hidden, out) {
    return inp * hidden + hidden + hidden * out + out;
  }

  function buildArenaTemplate(p, layoutSeed, inp, hid, out, nWeights) {
    const w = p.width;
    const h = p.height;
    const ar = p.agent_radius;
    const prng = createPortableRng(layoutSeed);
    let x = prng.uniform(w * 0.35, w * 0.65);
    let y = prng.uniform(h * 0.35, h * 0.65);
    x = Math.max(ar, Math.min(w - ar, x));
    y = Math.max(ar, Math.min(h - ar, y));
    const autoCap = 2 * Math.hypot(w, h);
    const beamMax = p.beam_max_length > 0 ? p.beam_max_length : autoCap;
    const wallHug = p.wall_hug_margin > 0 ? p.wall_hug_margin : ar * 3.25;
    return {
      layoutSeed,
      segments: [],
      startPos: [x, y],
      width: w,
      height: h,
      agentRadius: ar,
      speed: p.speed,
      numRays: p.num_rays,
      maxRayLen: p.max_ray_len,
      maxSteps: p.max_steps,
      maxWaves: p.max_waves,
      spawnProb: p.spawn_prob,
      spawnProbMax: p.spawn_prob_max,
      maxWavesMax: p.max_waves_max,
      laserThickness: p.laser_thickness,
      laserHitScale: 0.62,
      spikeHitScale: 0.62,
      warningSteps: p.warning_steps,
      warningStepsLate: p.warning_steps_late,
      beamLifetimeSteps: p.beam_lifetime_steps,
      beamLifetimeStepsLate: p.beam_lifetime_steps_late,
      beamMaxLength: beamMax,
      dodgeScoreWeight: p.dodge_score_weight,
      centerClearanceWeight: p.center_clearance_weight,
      wallHugPenaltyWeight: p.wall_hug_penalty_weight,
      hazardMarginZone: p.hazard_margin_zone,
      hazardProximityPenalty: p.hazard_proximity_penalty,
      hazardEscapeBonusWeight: p.hazard_escape_bonus_weight,
      hazardZoneExitBonus: p.hazard_zone_exit_bonus,
      deathPenalty: p.death_penalty,
      spikeEnabled: p.spike_enabled,
      wallHugMargin: wallHug,
      spikeTriggerSteps: p.spike_trigger_steps,
      spikeDepth: p.spike_depth,
      spikeCountMin: p.spike_count_min,
      spikeCountMax: p.spike_count_max,
      spikeThickness: p.spike_thickness,
      spikeLifetimeSteps: p.spike_lifetime_steps,
      spikeCooldownSteps: p.spike_cooldown_steps,
      inp,
      hidden: hid,
      out,
      numParams: nWeights,
    };
  }

  function episodeFitness(sim, dead) {
    let fit = sim.stepCount + sim.dodgeScoreWeight * sim.dodges + sim.fitnessShaping;
    if (sim.stepCount >= sim.maxSteps) fit += 50;
    if (dead && sim.terminatedByHit) fit -= sim.deathPenalty;
    return fit;
  }

  function deathReason(sim, dead) {
    if (!dead) return "horizon";
    if (hitLethalLaser(sim)) return "laser";
    if (hitSpikes(sim)) return "spike";
    return "laser";
  }

  function evaluateGenome(flat, arenaTpl) {
    const arena = JSON.parse(JSON.stringify(arenaTpl));
    const sim = bootstrapSimFromArena(arena);
    for (;;) {
      const obs = observe(sim);
      const act = forward(flat, obs, sim.inp, sim.hidden, sim.out);
      const r = stepSim(sim, act);
      if (r.done) {
        const dead = r.dead;
        const reason = deathReason(sim, dead);
        const fitness = episodeFitness(sim, dead);
        return {
          fitness,
          summary: {
            deathReason: reason,
            steps: sim.stepCount,
            fitness,
            wallHugFraction: 0,
            hazardZoneFraction: 0,
          },
        };
      }
    }
  }

  function aggregateGenerationStats(summaries, population, maxSteps) {
    let laser = 0;
    let spike = 0;
    let horizon = 0;
    for (const s of summaries) {
      if (s.deathReason === "laser") laser += 1;
      else if (s.deathReason === "spike") spike += 1;
      else horizon += 1;
    }
    const died = laser + spike;
    const fitList = summaries.map((s) => s.fitness);
    const stepsList = summaries.map((s) => s.steps);
    let mn = Infinity;
    let mx = -Infinity;
    for (const f of fitList) {
      mn = Math.min(mn, f);
      mx = Math.max(mx, f);
    }
    const meanFit = fitList.reduce((a, b) => a + b, 0) / Math.max(1, population);
    const deadSteps = summaries.filter((s) => s.deathReason === "laser" || s.deathReason === "spike").map((s) => s.steps);
    const meanStepsDead = deadSteps.length ? deadSteps.reduce((a, b) => a + b, 0) / deadSteps.length : 0;
    const earlyDie = summaries.filter(
      (s) => (s.deathReason === "laser" || s.deathReason === "spike") && s.steps < maxSteps * 0.25
    ).length;

    const struggleParts = [];
    if (died > 0) {
      const lp = (100 * laser) / died;
      const sp = (100 * spike) / died;
      struggleParts.push(`killed: ${laser} beam (${lp.toFixed(0)}% of deaths), ${spike} spike (${sp.toFixed(0)}% of deaths)`);
    }
    if (earlyDie > 0) {
      struggleParts.push(`${earlyDie} died in first 25% of episode (${((100 * earlyDie) / Math.max(1, died)).toFixed(0)}% of deaths)`);
    }
    if (horizon === population) {
      struggleParts.push("entire population reached horizon (max steps)");
    } else if (horizon > population * 0.5) {
      struggleParts.push(`${horizon}/${population} survived full episode`);
    }

    return {
      deaths: { laser, spike, horizon, unknown: Math.max(0, population - laser - spike - horizon) },
      pctLaserOfPop: population ? Math.round((1000 * laser) / population) / 10 : 0,
      pctSpikeOfPop: population ? Math.round((1000 * spike) / population) / 10 : 0,
      pctHorizonOfPop: population ? Math.round((1000 * horizon) / population) / 10 : 0,
      meanFitness: Math.round(meanFit * 100) / 100,
      meanSteps: stepsList.length ? Math.round((stepsList.reduce((a, b) => a + b, 0) / stepsList.length) * 10) / 10 : 0,
      meanStepsWhenKilled: Math.round(meanStepsDead * 10) / 10,
      meanWallHugFraction: 0,
      meanHazardZoneFraction: 0,
      struggleSummary: struggleParts.length ? struggleParts.join("; ") : "mixed outcomes; no single dominant pattern",
    };
  }

  function mutateFlat(g, rate, sigma, rng) {
    for (let i = 0; i < g.length; i++) {
      if (rng.uniform(0, 1) < rate) {
        const u1 = Math.max(1e-12, rng.uniform(0, 1));
        const u2 = rng.uniform(0, 1);
        const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
        g[i] += noise;
      }
    }
  }

  function breedBattleRoyale(pop, fitness, rng, population, elite, mutationRate, mutationSigma) {
    let bestI = 0;
    for (let i = 1; i < population; i++) {
      if (fitness[i] > fitness[bestI]) bestI = i;
    }
    const champion = pop[bestI].slice();
    const newPop = [];
    const nElite = Math.min(elite, population);
    for (let i = 0; i < nElite; i++) {
      newPop.push(champion.slice());
    }
    for (let i = nElite; i < population; i++) {
      const g = champion.slice();
      mutateFlat(g, mutationRate, mutationSigma, rng);
      newPop.push(g);
    }
    return newPop;
  }

  function tournamentSelect(fitness, k, rng) {
    const n = fitness.length;
    let best = Math.floor(rng.uniform(0, 1) * n);
    for (let i = 1; i < k; i++) {
      const j = Math.floor(rng.uniform(0, 1) * n);
      if (fitness[j] > fitness[best]) best = j;
    }
    return best;
  }

  function crossoverFlat(rng, a, b, p) {
    const c1 = a.slice();
    const c2 = b.slice();
    for (let i = 0; i < c1.length; i++) {
      if (rng.uniform(0, 1) < p) {
        const t = c1[i];
        c1[i] = c2[i];
        c2[i] = t;
      }
    }
    return [c1, c2];
  }

  function breedClassic(pop, fitness, rng, population, elite, tournamentK, crossoverRate, mutationRate, mutationSigma) {
    const order = [];
    for (let i = 0; i < population; i++) order.push(i);
    order.sort((i, j) => fitness[j] - fitness[i]);
    const newPop = [];
    for (let i = 0; i < elite; i++) {
      newPop.push(pop[order[i]].slice());
    }
    let i = elite;
    while (i < population) {
      const p1 = pop[tournamentSelect(fitness, tournamentK, rng)].slice();
      const p2 = pop[tournamentSelect(fitness, tournamentK, rng)].slice();
      const [c1, c2] = crossoverFlat(rng, p1, p2, crossoverRate);
      mutateFlat(c1, mutationRate, mutationSigma, rng);
      mutateFlat(c2, mutationRate, mutationSigma, rng);
      newPop.push(c1);
      if (i + 1 < population) newPop.push(c2);
      i += 2;
    }
    return newPop;
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  async function evaluatePopulationAsync(pop, arenaTpl) {
    const fitness = [];
    const summaries = [];
    for (let i = 0; i < pop.length; i++) {
      const r = evaluateGenome(pop[i], arenaTpl);
      fitness.push(r.fitness);
      summaries.push(r.summary);
      if ((i & 3) === 3) await yieldToBrowser();
    }
    return { fitness, summaries };
  }

  window.runLaserEvolveClient = async function runLaserEvolveClient(payload) {
    const generations = payload.generations;
    const population = payload.population;
    const hidden = payload.hidden;
    const elite = Math.min(payload.elite, Math.floor(population / 2));
    const tournamentK = Math.min(payload.tournament_k, population);
    const crossoverRate = payload.crossover_rate;
    const mutationRate = payload.mutation_rate;
    const mutationSigma = payload.mutation_sigma;
    const battleRoyale = payload.battle_royale;
    const seed = payload.seed >>> 0;

    const gaRng = createPortableRng(seed);
    let layoutSeed = payload.layout_seed;
    if (layoutSeed == null || layoutSeed === "") {
      layoutSeed = gaRng.u32() & 0x7fffffff;
    } else {
      layoutSeed = parseInt(String(layoutSeed), 10) >>> 0;
    }

    const numRays = payload.num_rays;
    const dims = mlpSizes(numRays, hidden);
    const inp = dims[0];
    const hid = dims[1];
    const out = dims[2];
    const nWeights = numParams(inp, hid, out);
    const arenaTpl = buildArenaTemplate(payload, layoutSeed, inp, hid, out, nWeights);

    handleStreamPacket({
      type: "init",
      arena: arenaTpl,
      generationsTotal: generations,
      reproductionMode: battleRoyale ? "battleRoyale" : "classic",
    });
    await yieldToBrowser();

    const pop = [];
    for (let i = 0; i < population; i++) {
      const row = [];
      for (let j = 0; j < nWeights; j++) {
        let s = 0;
        for (let k = 0; k < 12; k++) s += gaRng.uniform(0, 1);
        row.push((s - 6) * 0.6);
      }
      pop.push(row);
    }

    let bestEver = pop[0].slice();
    let bestScore = -Infinity;
    const maxSteps = payload.max_steps;

    for (let gen = 0; gen < generations; gen++) {
      const { fitness, summaries } = await evaluatePopulationAsync(pop, arenaTpl);
      let genBest = fitness[0];
      let genMean = fitness[0];
      let bi = 0;
      for (let i = 1; i < population; i++) {
        genMean += fitness[i];
        if (fitness[i] > genBest) {
          genBest = fitness[i];
          bi = i;
        }
      }
      genMean /= population;

      if (fitness[bi] > bestScore) {
        bestScore = fitness[bi];
        bestEver = pop[bi].slice();
      }

      const stats = aggregateGenerationStats(summaries, population, maxSteps);
      const rec = {
        index: gen,
        best: genBest,
        mean: genMean,
        bestEver: bestScore,
        generationStats: stats,
        bestIndex: bi,
        populationGenomes: pop.map(function (r) {
          return r.slice();
        }),
        genome: pop[bi].slice(),
        reproductionMode: battleRoyale ? "battleRoyale" : "classic",
      };

      handleStreamPacket({
        type: "generation",
        record: rec,
        progress: { current: gen + 1, total: generations },
      });
      await yieldToBrowser();

      let nextPop;
      if (battleRoyale) {
        nextPop = breedBattleRoyale(pop, fitness, gaRng, population, elite, mutationRate, mutationSigma);
      } else {
        nextPop = breedClassic(
          pop,
          fitness,
          gaRng,
          population,
          elite,
          tournamentK,
          crossoverRate,
          mutationRate,
          mutationSigma
        );
      }
      pop.length = 0;
      for (let i = 0; i < nextPop.length; i++) pop.push(nextPop[i]);
    }

    handleStreamPacket({
      type: "done",
      bestGenome: bestEver,
      historyBest: [],
    });
  };
})();
