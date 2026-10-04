/* 전투 시뮬레이터: 순수 로직(DOM 없음). 고정 틱(0.1s) 결정론적 진행. */
(function (root) {
  const D = typeof module !== 'undefined' ? require('./data.js') : root.SC.data;
  const { CFG, UNIT_BY_ID, STAR, SYNERGIES } = D;
  const HEX = D.hex;
  const COLS = CFG.COLS, ROWS = CFG.ROWS, TICK = 0.1;

  function newMods() {
    return {
      atkMul: 1, hpMul: 1, asMul: 1, raceMul: { union: 1, swarm: 1, sanct: 1 },
      nexusDmgMul: 1, nexusShield: 0, nexusArmor: 0, nexusRegen: 0, turret: 0, decoy: false, gambler: false,
      mineralInc: 0, gasInc: 0, interestCap: 3, instantMinerals: 0, popBonus: 0,
      siegeNx: 1, airMul: 1, flak: false, expandDiscount: 0, scoutFree: false, startGas: 0, gambitLossMul: 1.5, gambitWinBonus: 0, techDiscount: 0,
    };
  }

  // 보드 위 유닛 목록 [{id, star}] -> 시너지 레벨 {key: 0|1|2}
  function computeSynergies(list) {
    const seen = {};
    list.forEach((u) => {
      const b = UNIT_BY_ID[u.id];
      const keys = [b.race].concat(b.tags);
      keys.forEach((k) => { if (SYNERGIES[k]) (seen[k] = seen[k] || new Set()).add(u.id); });
    });
    const out = {};
    Object.keys(SYNERGIES).forEach((k) => {
      const n = seen[k] ? seen[k].size : 0;
      const steps = SYNERGIES[k].steps;
      out[k] = { count: n, level: n >= steps[1] ? 2 : n >= steps[0] ? 1 : 0 };
    });
    return out;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 보드 좌표(자기 시점: y 0=최전방) -> 전역 좌표
  function toGlobal(side, x, y) {
    return side === 0 ? { gx: x, gy: ROWS / 2 + y } : { gx: COLS - 1 - x, gy: ROWS / 2 - 1 - y };
  }

  /**
   * setup = { units:[{id,star,x,y}], mods, nexus:{hp,maxHp}|null, gambit:bool, hpScale?, atkScale? }
   */
  function createBattle(a, b, opts) {
    opts = opts || {};
    const bt = {
      event: opts.event || null, t: 0, tick: 0, over: false, result: null, units: [], events: [], round: opts.round || 1,
      setups: [a, b], nex: [null, null], grid: [], gridAir: [], blocked: [], terrain: opts.terrain || null, nextId: 1,
    };
    for (let y = 0; y < ROWS; y++) { bt.grid.push(new Array(COLS).fill(0)); bt.gridAir.push(new Array(COLS).fill(0)); bt.blocked.push(new Array(COLS).fill(false)); }
    bt.portals = [];
    if (opts.terrain && D.TERRAIN_BY_ID[opts.terrain]) {
      const T = D.TERRAIN_BY_ID[opts.terrain];
      T.cells.forEach(([x, y]) => { bt.blocked[y][x] = true; });
      bt.portals = (T.portals || []).map((p) => ({ side: p.side, inX: p.in[0], inY: p.in[1], outX: p.out[0], outY: p.out[1] }));
    }

    [a, b].forEach((s, side) => {
      s.mods = s.mods || newMods();
      const syn = computeSynergies(s.units);
      s._syn = syn;
      const lv = (k) => syn[k].level;
      s.units.forEach((su) => {
        const base = UNIT_BY_ID[su.id], star = STAR[su.star || 1];
        const g = toGlobal(side, su.x, su.y);
        const m = s.mods;
        let hp = base.hp * star * m.hpMul * m.raceMul[base.race] * (s.hpScale || 1);
        let atk = base.atk * CFG.ATK_SCALE * star * m.atkMul * m.raceMul[base.race] * (s.atkScale || 1);
        let asR = m.asMul, ms = base.ms, armor = base.armor, range = base.range, nx = base.nx * m.nexusDmgMul;
        if (base.race === 'union') atk *= [1, 1.10, 1.25][lv('union')];
        if (base.race === 'swarm') asR *= [1, 1.15, 1.35][lv('swarm')];
        if (base.race === 'sanct') hp *= [1, 1.2, 1.45][lv('sanct')];
        if (base.tags.includes('infil')) { ms *= [1, 1.3, 1.3][lv('infil')]; nx *= [1, 1, 1.5][lv('infil')]; }
        if (base.tags.includes('siege')) { nx *= m.siegeNx * [1, 1.3, 1.7][lv('siege')]; range += lv('siege') === 2 ? 1 : 0; }
        armor += [0, 3, 6][lv('guard')];
        if (base.air) { hp *= m.airMul * [1, 1.15, 1.15][lv('air')]; atk *= m.airMul; ms *= [1, 1, 1.2][lv('air')]; nx *= [1, 1, 1.4][lv('air')]; }
        if (s.gambit && !base.tags.includes('guard')) { nx *= CFG.GAMBIT_NX; ms *= CFG.GAMBIT_MS; } // 저격 선언: 돌격 태세
        if (opts.event === 'frost') { hp *= 0.85; atk *= 1.15; }
        if (opts.event === 'fog') range = Math.max(1, range - 1);
        if (opts.event === 'rush') ms *= 1.4;
        const u = {
          id: bt.nextId++, side, def: base, star: su.star || 1, x: g.gx, y: g.gy, px: g.gx, py: g.gy, air: !!base.air, climb: !base.air && base.tags.includes('infil'), hits: base.hits, aaMul: base.aaMul,
          maxHp: Math.round(hp), hp: Math.round(hp), shield: 0, atk, asR, ms, armor, range, nx,
          pow: (atk / base.atk / CFG.ATK_SCALE), mana: base.skill ? base.skill.mana * 0.5 : 0, atkCd: 0.3, moveCd: 0,
          stun: 0, haste: 0, hasteV: 0, alive: true, dmgDealt: 0, nexDealt: 0, kills: 0,
          snipe: base.tags.includes('infil') || (s.gambit && !base.tags.includes('guard')),
        };
        if (!u.air && bt.blocked[u.y][u.x]) relocate(bt, u);
        bt.units.push(u);
        (u.air ? bt.gridAir : bt.grid)[u.y][u.x] = u.id;
      });
      const hasNex = !!s.nexus;
      if (hasNex) {
        const mx = s.nexus.maxHp;
        bt.nex[side] = {
          side, hp: s.nexus.hp, maxHp: mx, shield: CFG.NEXUS_SHIELD + s.mods.nexusShield + (lv('guard') === 2 ? 600 : 0),
          armor: CFG.NEXUS_ARMOR + s.mods.nexusArmor, x: (COLS - 1) / 2, y: side === 0 ? ROWS : -1,
          cells: [2, 3, 4].map((cx) => [cx, side === 0 ? ROWS : -1]),
          dealt: 0, turretCd: 1, grace: (opts.round || 1) <= CFG.GRACE_ROUNDS,
        };
        bt.nex[side].maxShield = bt.nex[side].shield;
      }
    });
    bt.byId = Object.fromEntries(bt.units.map((u) => [u.id, u]));
    return bt;
  }

  // ---- 헬퍼 ----
  // 육각 격자 거리(칸 수)
  const dist = (ax, ay, bx, by) => HEX.dist(ax, ay, bx, by);
  function nexDist(x, y, n) { let d = 1e9; for (const c of n.cells) { const k = HEX.dist(x, y, c[0], c[1]); if (k < d) d = k; } return d; }
  function enemiesOf(bt, side) { return bt.units.filter((u) => u.alive && u.side !== side); }
  function alliesOf(bt, side) { return bt.units.filter((u) => u.alive && u.side === side); }
  function nearest(u, list) {
    let best = null, bd = 1e9;
    for (const e of list) { const d = dist(u.x, u.y, e.x, e.y); if (d < bd - 1e-9) { bd = d; best = e; } }
    return best;
  }
  function inRangeUnit(u, e) { return dist(u.x, u.y, e.x, e.y) <= u.range + 1e-6; }
  function inRangeNex(u, n) { return nexDist(u.x, u.y, n) <= u.range + CFG.NEXUS_R; }
  const inB = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  // 공중 유닛은 공중 레이어만, 지상 유닛은 절벽과 지상 점유를 피한다
  const free = (bt, x, y, air, climb) => inB(x, y) && (air ? bt.gridAir[y][x] === 0 : ((climb || !bt.blocked[y][x]) && bt.grid[y][x] === 0));
  // 지형 위에 놓인 지상 유닛을 같은 진영의 가장 가까운 빈 칸으로 옮긴다 (결정론적)
  function relocate(bt, u) {
    const half = u.side === 0 ? [ROWS / 2, ROWS - 1] : [0, ROWS / 2 - 1];
    let best = null, bd = 1e9;
    for (let y = half[0]; y <= half[1]; y++) for (let x = 0; x < COLS; x++) {
      if (bt.blocked[y][x] || bt.grid[y][x] !== 0) continue;
      const d = Math.abs(x - u.x) + Math.abs(y - u.y) * 1.01;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) { u.x = best[0]; u.y = best[1]; u.px = u.x; u.py = u.y; }
  }
  function canHit(bt, u, e) { return bt.t > CFG.BERSERK_AT || (e.air ? u.hits !== 'ground' : u.hits !== 'air'); }

  function bfsStep(bt, u, goalFn) {
    if (goalFn(u.x, u.y)) return null;
    const seen = new Map(); const key = (x, y) => y * COLS + x;
    const q = [[u.x, u.y]]; seen.set(key(u.x, u.y), null);
    const fwd = u.side === 0 ? -1 : 1, lean = (u.id % 2) ? 1 : -1; // 짝/홀 유닛이 좌/우 경로를 번갈아 선호 -> 동선 분산
    const order = (cx, cy) => HEX.neighbors(cx, cy).slice().sort((p, q) => (Math.sign(q[1] * fwd) - Math.sign(p[1] * fwd)) || ((p[0] - q[0]) * lean));
    while (q.length) {
      const [cx, cy] = q.shift();
      for (const [dx, dy] of order(cx, cy)) {
        const nx = cx + dx, ny = cy + dy;
        if (!free(bt, nx, ny, u.air, u.climb) || seen.has(key(nx, ny))) continue;
        seen.set(key(nx, ny), [cx, cy]);
        if (goalFn(nx, ny)) {
          let c = [nx, ny], p = seen.get(key(nx, ny));
          while (p && !(p[0] === u.x && p[1] === u.y)) { c = p; p = seen.get(key(p[0], p[1])); }
          return c;
        }
        q.push([nx, ny]);
      }
    }
    return undefined; // 경로 없음
  }

  function moveTo(bt, u, cell) {
    const G = u.air ? bt.gridAir : bt.grid;
    G[u.y][u.x] = 0; u.px = u.x; u.py = u.y; u.x = cell[0]; u.y = cell[1]; G[u.y][u.x] = u.id;
    u.moveCd = 1 / u.ms; u.movedAt = bt.t;
  }

  function dmgUnit(bt, src, tgt, amount) {
    const d = Math.max(1, Math.round(amount - tgt.armor));
    let left = d;
    if (tgt.shield > 0) { const a = Math.min(tgt.shield, left); tgt.shield -= a; left -= a; }
    tgt.hp -= left;
    if (tgt.def.skill) tgt.mana += CFG.MANA_HIT * manaMul(bt, tgt);
    if (src) src.dmgDealt += d;
    if (tgt.hp <= 0 && tgt.alive) {
      tgt.alive = false; (tgt.air ? bt.gridAir : bt.grid)[tgt.y][tgt.x] = 0; if (src) src.kills++;
      bt.events.push({ t: bt.t, type: 'die', id: tgt.id });
    }
    return d;
  }

  function dmgNexus(bt, src, n, amount) {
    if (n.grace) return 0;
    let d = Math.max(1, Math.round((amount - n.armor) * CFG.NEXUS_DMG_SCALE)), left = d;
    if (n.shield > 0) { const a = Math.min(n.shield, left); n.shield -= a; left -= a; }
    n.hp -= left; n.dealt += d; if (src) src.nexDealt += d;
    bt.events.push({ t: bt.t, type: 'nhit', side: n.side });
    return d;
  }

  // 마나 폭풍: 방어막 계열 스킬은 교착을 막기 위해 가속하지 않는다
  function manaMul(bt, u) { return bt.event === 'mana' && u.def.skill.k !== 'shield' && u.def.skill.k !== 'barrier' ? 2 : 1; }
  function berserkMul(bt) { return bt.t > CFG.BERSERK_AT ? 1 + CFG.BERSERK_RATE * (bt.t - CFG.BERSERK_AT) : 1; }

  function cast(bt, u, tgt) {
    const s = u.def.skill; if (!s) return false;
    const foes = enemiesOf(bt, u.side), allies = alliesOf(bt, u.side);
    const v = (s.v || 0) * u.pow;
    switch (s.k) {
      case 'shield': u.shield = Math.max(u.shield, v); break;
      case 'barrier': allies.forEach((a) => { if (dist(u.x, u.y, a.x, a.y) <= s.radius + 0.01) a.shield = Math.max(a.shield, v); }); break;
      case 'heal': {
        let best = null, br = 2;
        allies.forEach((a) => { const r = a.hp / a.maxHp; if (r < br && dist(u.x, u.y, a.x, a.y) <= 6) { br = r; best = a; } });
        if (!best || br >= 1) return false;
        best.hp = Math.min(best.maxHp, best.hp + v); break;
      }
      case 'haste': allies.forEach((a) => { if (dist(u.x, u.y, a.x, a.y) <= s.radius + 0.01) { a.haste = s.dur; a.hasteV = s.v; } }); break;
      case 'stun': { if (!tgt) return false; dmgUnit(bt, u, tgt, v + tgt.armor); tgt.stun = Math.max(tgt.stun, s.dur); break; }
      case 'aoe': {
        if (!tgt) return false;
        foes.forEach((e) => { if (dist(tgt.x, tgt.y, e.x, e.y) <= s.radius + 0.01) dmgUnit(bt, u, e, v + e.armor); });
        break;
      }
      case 'blink': {
        const row = u.side === 0 ? 0 : ROWS - 1; let best = null, bd = 1e9;
        for (let x = 0; x < COLS; x++) if (free(bt, x, row, u.air)) { const d = Math.abs(x - (COLS - 1) / 2); if (d < bd) { bd = d; best = x; } }
        if (best === null) return false;
        { const G = u.air ? bt.gridAir : bt.grid; G[u.y][u.x] = 0; u.px = u.x; u.py = u.y; u.x = best; u.y = row; G[row][best] = u.id; u.movedAt = bt.t; } break;
      }
      default: return false;
    }
    bt.events.push({ t: bt.t, type: 'skill', id: u.id, k: s.k });
    return true;
  }

  function actUnit(bt, u) {
    if (u.stun > 0) return;
    const foes = enemiesOf(bt, u.side);
    const hittable = foes.filter((e) => canHit(bt, u, e)); // 공중/지상 공격 가능 여부
    const enemyNex = bt.nex[1 - u.side];
    const opp = bt.setups[1 - u.side];
    // 교란 장막: 침투 유닛 이동 불가
    const decoyed = opp.mods && opp.mods.decoy && u.def.tags.includes('infil') && bt.t < CFG.BATTLE_START_DELAY + 5;
    const nexTargetable = enemyNex && !enemyNex.grace;
    let target = null, tNex = false;
    if (u.snipe && nexTargetable) tNex = true;
    else { target = nearest(u, hittable); if (!target && nexTargetable) tNex = true; } // 때릴 수 있는 적이 없으면 넥서스로
    if (tNex) {
      if (inRangeNex(u, enemyNex)) {
        attackNex(bt, u, enemyNex);
        return;
      }
      if (u.moveCd <= 0 && !decoyed && !u.air && u.def.tags.includes('infil') && !u.portalUsed && bt.portals.length) {
        // 땅굴: 가장 가까운 입구로 이동 → 도착하면 적 넥서스 옆 출구로 순간이동
        let best = null, bd = 1e9;
        bt.portals.forEach((p) => { if (p.side !== u.side) return; const d = dist(u.x, u.y, p.inX, p.inY); if (d < bd) { bd = d; best = p; } });
        if (best) {
          if (u.x === best.inX && u.y === best.inY) { portalJump(bt, u, best); return; }
          const st = bfsStep(bt, u, (x, y) => x === best.inX && y === best.inY);
          if (st) { moveTo(bt, u, st); return; }
        }
      }
      if (u.moveCd <= 0 && !decoyed) {
        const step = bfsStep(bt, u, (x, y) => nexDist(x, y, enemyNex) <= u.range + CFG.NEXUS_R);
        if (step) moveTo(bt, u, step);
        else if (step === undefined) { // 경로 없음 → 근처 적 교전
          const t2 = nearest(u, hittable); if (t2 && inRangeUnit(u, t2)) attackUnit(bt, u, t2);
        }
      }
      return;
    }
    if (!target) return;
    // 마나 스킬
    if (u.def.skill && u.mana >= u.def.skill.mana) {
      const k = u.def.skill.k;
      const needsTgt = k === 'stun' || k === 'aoe';
      if (!needsTgt || inRangeUnit(u, target)) { if (cast(bt, u, target)) { u.mana = 0; return; } }
    }
    if (inRangeUnit(u, target)) { attackUnit(bt, u, target); return; }
    if (u.moveCd <= 0 && !decoyed) {
      const tx = target.x, ty = target.y;
      const step = bfsStep(bt, u, (x, y) => dist(x, y, tx, ty) <= u.range + 1e-6);
      if (step) moveTo(bt, u, step);
    }
  }

  function portalJump(bt, u, p) {
    // 출구 주변에서 가장 가까운 빈 칸
    let best = null, bd = 1e9;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!free(bt, x, y, false, true)) continue;
      const d = Math.abs(x - p.outX) + Math.abs(y - p.outY) * 1.01;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    u.portalUsed = true;
    if (!best || bd > 3) return;
    bt.grid[u.y][u.x] = 0; u.px = u.x; u.py = u.y; u.x = best[0]; u.y = best[1]; bt.grid[u.y][u.x] = u.id; u.movedAt = bt.t; u.moveCd = 0.5;
    bt.events.push({ t: bt.t, type: 'tp', id: u.id, x: u.px, y: u.py });
  }
  function atkInterval(bt, u) {
    const hmul = u.haste > 0 ? 1 + u.hasteV : 1;
    return u.def.as / (u.asR * berserkMul(bt) * hmul);
  }
  function attackUnit(bt, u, e) {
    if (u.atkCd > 0) return;
    u.atkCd = atkInterval(bt, u);
    const dd = dmgUnit(bt, u, e, u.atk * (e.air ? u.aaMul : 1));
    if (u.def.skill) u.mana += 8 * manaMul(bt, u);
    bt.events.push({ t: bt.t, type: 'atk', from: u.id, to: e.id, d: dd });
  }
  function attackNex(bt, u, n) {
    if (u.atkCd > 0) return;
    u.atkCd = atkInterval(bt, u);
    const dd = dmgNexus(bt, u, n, u.atk * u.nx);
    if (u.def.skill) u.mana += 8 * manaMul(bt, u);
    bt.events.push({ t: bt.t, type: 'atkn', from: u.id, side: n.side, d: dd });
  }

  function costValue(list) { return list.reduce((s, u) => s + u.def.cost * STAR[u.star], 0); }

  function judge(bt) {
    const A = alliesOf(bt, 0), B = alliesOf(bt, 1);
    // 넥서스 파괴 (동시 파괴 시 남은 HP 비율 비교 불가 → 무승부)
    const n0 = bt.nex[0], n1 = bt.nex[1];
    const d0 = n0 && n0.hp <= 0, d1 = n1 && n1.hp <= 0;
    if (d0 || d1) return d0 && d1 ? fin(bt, -1, 'draw') : fin(bt, d1 ? 0 : 1, 'nexus');
    if (!A.length || !B.length) {
      if (A.length) return fin(bt, 0, 'wipe');
      if (B.length) return fin(bt, 1, 'wipe');
      return byNexus(bt, 'wipe');
    }
    if (bt.t >= CFG.BATTLE_MAX) {
      const ca = costValue(A), cb = costValue(B);
      if (ca !== cb) return fin(bt, ca > cb ? 0 : 1, 'time');
      return byNexus(bt, 'time');
    }
    return false;
  }
  function byNexus(bt, why) {
    const n0 = bt.nex[0], n1 = bt.nex[1];
    if (n0 && n1) {
      const r0 = n0.hp / n0.maxHp, r1 = n1.hp / n1.maxHp;
      if (Math.abs(r0 - r1) > 1e-9) return fin(bt, r0 > r1 ? 0 : 1, why === 'wipe' ? 'wipe-nexus' : 'time-nexus');
    }
    return fin(bt, -1, 'draw');
  }
  function fin(bt, winner, reason) {
    bt.over = true;
    const surv = [alliesOf(bt, 0), alliesOf(bt, 1)];
    bt.result = {
      winner, reason, time: bt.t,
      survivors: surv.map((l) => l.map((u) => ({ id: u.def.id, star: u.star }))),
      survivorCost: surv.map(costValue),
      nexusDealt: [bt.nex[1] ? bt.nex[1].dealt : 0, bt.nex[0] ? bt.nex[0].dealt : 0], // [side0이 가한, side1이 가한]
      nexusHp: bt.nex.map((n) => (n ? Math.max(0, Math.round(n.hp)) : null)),
      mvp: bt.units.slice().sort((p, q) => q.dmgDealt + q.nexDealt - p.dmgDealt - p.nexDealt)[0],
    };
    return true;
  }

  function step(bt, dt) {
    dt = dt || TICK;
    if (bt.over) return;
    bt.t += dt; bt.tick++;
    if (bt.t < CFG.BATTLE_START_DELAY) return;
    for (const u of bt.units) {
      if (!u.alive) continue;
      u.atkCd -= dt; u.moveCd -= dt;
      if (u.stun > 0) u.stun -= dt;
      if (u.haste > 0) u.haste -= dt;
    }
    for (const u of bt.units) if (u.alive) actUnit(bt, u);
    // 포탑
    bt.nex.forEach((n, side) => {
      if (!n || n.grace) return;
      const tur = CFG.NEXUS_TURRET + bt.setups[side].mods.turret; // 기본 방어 포탑 + 증강
      n.turretCd -= dt;
      if (n.turretCd <= 0) {
        n.turretCd += 1;
        const foes = enemiesOf(bt, side).filter((e) => nexDist(e.x, e.y, n) <= 4);
        const t = nearest({ x: n.x, y: n.y }, foes);
        if (t) { dmgUnit(bt, null, t, tur * (t.air ? (bt.setups[side].mods.flak ? 2 : 1.5) : 1)); bt.events.push({ t: bt.t, type: 'turret', side, to: t.id }); }
      }
    });
    // 마나가 넘친 유닛 정리, 사망 유닛 정리
    judge(bt);
  }

  function runToEnd(bt) { let guard = 0; while (!bt.over && guard++ < 2000) step(bt, TICK); return bt.result; }

  const out = { newMods, computeSynergies, mulberry32, createBattle, step, runToEnd, toGlobal, berserkMul, TICK, costValue };
  if (typeof module !== 'undefined') module.exports = out; else root.SC = Object.assign(root.SC || {}, { sim: out });
})(typeof window !== 'undefined' ? window : globalThis);
