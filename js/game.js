/* 게임 상태/경제/AI/매칭. DOM 비의존 -> node에서 헤드리스 테스트 가능 */
(function (root) {
  const D = typeof module !== 'undefined' ? require('./data.js') : root.SC.data;
  const S = typeof module !== 'undefined' ? require('./sim.js') : root.SC.sim;
  const { CFG, UNITS, UNIT_BY_ID, AUGMENTS, AUG_BY_ID, STAR, COMMANDERS, CMD_BY_ID, EVENTS } = D;
  const BOARD_W = CFG.COLS, BOARD_H = CFG.ROWS / 2;
  const NAMES = ['나', '아르투스', '벨라', '카이', '다이나', '에코', '플룩스', '그리프'];

  function Game(seed, hard) {
    this.rng = S.mulberry32(seed || 1);
    this.hard = !!hard;
    this.round = 0;
    this.uid = 1;
    this.phase = 'init';
    this.log = [];
    this.players = NAMES.map((n, i) => {
      const races = ['union', 'swarm', 'sanct'];
      return {
        id: i, name: n, human: i === 0, race: races[Math.floor(this.rng() * 3)], alive: true, rank: 0,
        minerals: CFG.START_MINERALS, gas: 0, tech: 1, expansions: 0, nexusHp: CFG.NEXUS_HP, maxHp: CFG.NEXUS_HP,
        bench: new Array(CFG.BENCH).fill(null), board: Array.from({ length: BOARD_H }, () => new Array(BOARD_W).fill(null)),
        shop: [], winStreak: 0, loseStreak: 0, augments: [], mods: S.newMods(), gambit: false, scouted: false,
        commander: null, emergency: false, lastOpp: -1, aiOffset: Math.floor(this.rng() * 3), report: null, snapshot: null, rerollCount: 0,
      };
    });
    this.me = this.players[0];
    this.event = null;
    this.players.filter((p) => !p.human).forEach((p) => this.chooseCommander(p, this.pick(COMMANDERS).id));
    this.pending = { augment: null };
    this.pairs = [];
  }
  const P = Game.prototype;
  P.rand = function (n) { return Math.floor(this.rng() * n); };
  P.pick = function (arr) { return arr[this.rand(arr.length)]; };
  P.alive = function () { return this.players.filter((p) => p.alive); };
  P.cap = function (p) { return CFG.POP_BY_TECH[p.tech] + p.mods.popBonus; };
  P.boardUnits = function (p) {
    const l = [];
    p.board.forEach((row, y) => row.forEach((u, x) => { if (u) l.push({ id: u.id, star: u.star, x, y, uid: u.uid }); }));
    return l;
  };
  P.popCount = function (p) { return this.boardUnits(p).length; };
  P.mkUnit = function (id) { return { id, star: 1, uid: this.uid++ }; };

  // ---- 지휘관 ----
  P.commanderOffers = function () {
    const pool = COMMANDERS.slice(), out = [];
    while (out.length < 3) out.push(pool.splice(this.rand(pool.length), 1)[0].id);
    return out;
  };
  P.chooseCommander = function (p, id) {
    const c = CMD_BY_ID[id]; p.commander = id; c.fx(p.mods);
    p.gas += p.mods.startGas; p.mods.startGas = 0;
    (c.start || []).forEach((uid) => { const i = this.firstEmptyBench(p); if (i >= 0) p.bench[i] = this.mkUnit(uid); });
  };
  P.techCost = function (p) { return Math.max(1, CFG.TECH_COST[p.tech + 1] - p.mods.techDiscount); };
  P.expandCost = function (p) { return Math.max(1, CFG.EXPAND_COST - p.mods.expandDiscount); };

  // ---- 상점 ----
  P.rollTier = function (p) {
    const odds = CFG.SHOP_ODDS[p.tech]; let r = this.rng() * 100, c = 0;
    for (let i = 0; i < odds.length; i++) { c += odds[i]; if (r < c) return i + 1; }
    return 1;
  };
  P.refreshShop = function (p) {
    p.shop = [];
    for (let i = 0; i < CFG.SHOP_SIZE; i++) {
      const tier = this.rollTier(p);
      p.shop.push(this.pick(UNITS.filter((u) => u.cost === tier)).id);
    }
  };

  // ---- 위치 조작 ----
  P.get = function (p, loc) { return loc.zone === 'bench' ? p.bench[loc.i] : p.board[loc.y][loc.x]; };
  P.set = function (p, loc, v) { if (loc.zone === 'bench') p.bench[loc.i] = v; else p.board[loc.y][loc.x] = v; };
  P.firstEmptyBench = function (p) { return p.bench.findIndex((x) => !x); };

  P.buy = function (p, idx) {
    const id = p.shop[idx]; if (!id) return { ok: false, msg: '빈 슬롯' };
    const def = UNIT_BY_ID[id];
    if (p.minerals < def.cost) return { ok: false, msg: '미네랄 부족' };
    const bi = this.firstEmptyBench(p);
    if (bi < 0) return { ok: false, msg: '벤치가 가득 참' };
    p.minerals -= def.cost; p.shop[idx] = null; p.bench[bi] = this.mkUnit(id);
    return { ok: true, merges: this.autoMerge(p) };
  };
  P.refund = function (u) { return UNIT_BY_ID[u.id].cost * Math.pow(3, u.star - 1); };
  P.sell = function (p, loc) {
    const u = this.get(p, loc); if (!u) return { ok: false };
    p.minerals += this.refund(u); this.set(p, loc, null); return { ok: true };
  };
  P.move = function (p, from, to) {
    const a = this.get(p, from), b = this.get(p, to);
    if (!a) return { ok: false };
    if (from.zone === to.zone && from.i === to.i && from.x === to.x && from.y === to.y) return { ok: false };
    // 벤치->보드 배치 시 인구수 제한
    if (from.zone === 'bench' && to.zone === 'board' && !b && this.popCount(p) >= this.cap(p)) return { ok: false, msg: '인구수 한도 (테크를 올리세요)' };
    this.set(p, from, b || null); this.set(p, to, a);
    return { ok: true };
  };
  P.autoMerge = function (p) {
    const merges = [];
    for (;;) {
      const all = [];
      p.bench.forEach((u, i) => u && all.push({ u, loc: { zone: 'bench', i } }));
      p.board.forEach((row, y) => row.forEach((u, x) => u && all.push({ u, loc: { zone: 'board', x, y } })));
      let done = true;
      const groups = {};
      all.forEach((e) => { const k = e.u.id + ':' + e.u.star; (groups[k] = groups[k] || []).push(e); });
      for (const k of Object.keys(groups)) {
        const g = groups[k];
        if (g.length >= 3 && g[0].u.star < 3) {
          g.sort((a, b) => (a.loc.zone === 'board' ? 0 : 1) - (b.loc.zone === 'board' ? 0 : 1));
          const keep = g[0];
          for (let i = 1; i < 3; i++) this.set(p, g[i].loc, null);
          keep.u.star++; merges.push({ id: keep.u.id, star: keep.u.star, loc: keep.loc });
          done = false; break;
        }
      }
      if (done) break;
    }
    return merges;
  };

  // ---- 경제 ----
  P.reroll = function (p) {
    if (p.minerals < CFG.REROLL) return { ok: false, msg: '미네랄 부족' };
    p.minerals -= CFG.REROLL; this.refreshShop(p); return { ok: true };
  };
  P.techUp = function (p) {
    if (p.tech >= 5) return { ok: false, msg: '최고 테크' };
    const c = this.techCost(p);
    if (p.gas < c) return { ok: false, msg: '가스 부족' };
    p.gas -= c; p.tech++; return { ok: true };
  };
  P.expand = function (p) {
    if (p.expansions >= CFG.MAX_EXPAND) return { ok: false, msg: '확장 한도' };
    const ec = this.expandCost(p);
    if (p.minerals < ec) return { ok: false, msg: '미네랄 부족' };
    p.minerals -= ec; p.expansions++; return { ok: true };
  };
  P.income = function (p) {
    const base = CFG.BASE_INCOME + Math.floor(this.round / 5) + p.mods.mineralInc + p.expansions * 2 + (this.hard && !p.human ? 2 : 0);
    const st = Math.max(p.winStreak, p.loseStreak);
    const streak = st >= 6 ? 3 : st >= 4 ? 2 : st >= 2 ? 1 : 0;
    const interest = Math.min(p.mods.interestCap, Math.floor(p.minerals / 10));
    p.minerals += base + streak + interest;
    p.gas += 2 + p.mods.gasInc + p.expansions * 3;
    return { base, streak, interest };
  };

  // ---- 증강 ----
  P.augmentOffers = function (p) {
    const r = this.round;
    const w = r <= 4 ? [70, 30, 0] : r <= 9 ? [40, 50, 10] : [20, 50, 30];
    const names = ['silver', 'gold', 'prism'];
    const owned = new Set(p.augments);
    const out = [];
    let guard = 0;
    while (out.length < 3 && guard++ < 200) {
      let x = this.rng() * 100, rar = 'silver';
      for (let i = 0; i < 3; i++) { if (x < w[i]) { rar = names[i]; break; } x -= w[i]; }
      const pool = AUGMENTS.filter((a) => a.rarity === rar && !owned.has(a.id) && !out.includes(a.id));
      if (pool.length) out.push(this.pick(pool).id);
    }
    return out;
  };
  P.takeAugment = function (p, id) {
    const a = AUG_BY_ID[id]; p.augments.push(id); a.fx(p.mods);
    if (p.mods.instantMinerals) { p.minerals += p.mods.instantMinerals; p.mods.instantMinerals = 0; }
  };

  // ---- AI ----
  const ROLE_ORDER = (b) => (b.tags.includes('guard') ? 0 : b.tags.includes('melee') ? 1 : b.tags.includes('infil') ? 2 : b.tags.includes('siege') ? 3 : 4);
  P.aiPlace = function (p) {
    const all = [];
    p.bench.forEach((u, i) => u && all.push({ u, loc: { zone: 'bench', i } }));
    p.board.forEach((row, y) => row.forEach((u, x) => u && all.push({ u, loc: { zone: 'board', x, y } })));
    all.forEach((e) => this.set(p, e.loc, null));
    const score = (u) => UNIT_BY_ID[u.id].cost * Math.pow(2.2, u.star - 1) + (UNIT_BY_ID[u.id].race === p.race ? 0.6 : 0);
    all.sort((a, b) => score(b.u) - score(a.u));
    const cap = this.cap(p), chosen = all.slice(0, cap), rest = all.slice(cap);
    const rowOf = (b) => { const o = ROLE_ORDER(b); return o <= 1 ? 0 : o === 2 ? 1 : o === 3 ? 2 : 3; };
    const colOrder = [3, 2, 4, 1, 5, 0, 6];
    const taken = Array.from({ length: BOARD_H }, () => 0);
    chosen.sort((a, b) => ROLE_ORDER(UNIT_BY_ID[a.u.id]) - ROLE_ORDER(UNIT_BY_ID[b.u.id]));
    chosen.forEach((e) => {
      let y = rowOf(UNIT_BY_ID[e.u.id]);
      while (taken[y] >= BOARD_W) y = (y + 1) % BOARD_H;
      p.board[y][colOrder[taken[y]++]] = e.u;
    });
    rest.slice(0, CFG.BENCH).forEach((e, i) => (p.bench[i] = e.u));
    p.gambit = chosen.filter((e) => UNIT_BY_ID[e.u.id].tags.includes('infil')).length >= 2 && this.rng() < 0.22;
  };
  P.aiTurn = function (p) {
    const tgt = [3, 6, 10, 15].map((r) => r + p.aiOffset);
    const want = 1 + tgt.filter((r) => this.round >= r).length;
    while (p.tech < want && p.gas >= this.techCost(p)) this.techUp(p);
    if (p.expansions < 1 && this.round >= 4 && p.minerals >= this.expandCost(p) + 4 && this.rng() < 0.5) this.expand(p);
    const reserve = this.round < 8 ? 10 : this.round < 14 ? 4 : 0;
    const have = () => { const m = {}; [].concat(p.bench, ...p.board).forEach((u) => u && (m[u.id] = (m[u.id] || 0) + 1)); return m; };
    for (let rr = 0; rr < 4; rr++) {
      const h = have();
      const order = p.shop.map((id, i) => ({ id, i })).filter((s) => s.id).sort((a, b) => {
        const sa = (h[a.id] || 0) * 3 + (UNIT_BY_ID[a.id].race === p.race ? 2 : 0) + UNIT_BY_ID[a.id].cost * 0.3;
        const sb = (h[b.id] || 0) * 3 + (UNIT_BY_ID[b.id].race === p.race ? 2 : 0) + UNIT_BY_ID[b.id].cost * 0.3;
        return sb - sa;
      });
      for (const s of order) {
        const c = UNIT_BY_ID[s.id].cost;
        const merging = (h[s.id] || 0) >= 2;
        if (p.minerals - c >= (merging ? 0 : reserve) || this.popCount(p) < this.cap(p) - 1 && p.minerals >= c) {
          if (this.firstEmptyBench(p) < 0) {
            const worst = p.bench.map((u, i) => ({ u, i })).sort((a, b) => UNIT_BY_ID[a.u.id].cost * a.u.star - UNIT_BY_ID[b.u.id].cost * b.u.star)[0];
            this.sell(p, { zone: 'bench', i: worst.i });
          }
          this.buy(p, s.i);
        }
      }
      if (p.minerals - CFG.REROLL >= reserve + 2 && this.rng() < 0.6) this.reroll(p); else break;
    }
    this.aiPlace(p);
  };

  // ---- 라운드 진행 ----
  P.isNeutral = function () { return CFG.NEUTRAL_ROUNDS.includes(this.round); };
  P.startRound = function () {
    this.round++; this.phase = 'prep'; this.pending.augment = null; this.report = null;
    this.event = null;
    if (this.round >= CFG.EVENT_FROM && !this.isNeutral() && this.rng() < CFG.EVENT_CHANCE) this.event = this.pick(EVENTS).id;
    this.alive().forEach((p) => {
      const inc = this.income(p);
      if (p.human) p.lastIncome = inc;
      if (p.mods.nexusRegen) p.nexusHp = Math.min(p.maxHp, p.nexusHp + Math.round(p.maxHp * p.mods.nexusRegen));
      p.gambit = false; p.scouted = false; p.rerollCount = 0; p.report = null;
      this.refreshShop(p);
    });
    // 증강 (AI는 즉시 선택)
    if (CFG.AUG_ROUNDS.includes(this.round)) {
      this.alive().forEach((p) => {
        const offers = this.augmentOffers(p);
        if (p.human) this.pending.augment = { offers, rerolled: false };
        else this.takeAugment(p, this.pick(offers));
      });
    }
    this.alive().filter((p) => !p.human).forEach((p) => this.aiTurn(p));
    this.makePairs();
  };
  P.makePairs = function () {
    this.pairs = [];
    if (this.isNeutral()) {
      this.alive().forEach((p) => this.pairs.push({ a: p.id, b: null, kind: 'neutral' }));
      return;
    }
    let ids = this.alive().map((p) => p.id), tries = 0, order;
    do {
      order = ids.slice().sort(() => this.rng() - 0.5); tries++;
      var ok = true;
      for (let i = 0; i + 1 < order.length; i += 2) if (this.players[order[i]].lastOpp === order[i + 1]) ok = false;
    } while (!ok && tries < 12);
    for (let i = 0; i + 1 < order.length; i += 2) this.pairs.push({ a: order[i], b: order[i + 1], kind: 'pvp' });
    if (order.length % 2 === 1) {
      const lone = order[order.length - 1];
      const others = this.alive().filter((p) => p.id !== lone);
      const dead = this.players.filter((p) => !p.alive && p.snapshot);
      const src = dead.length ? this.pick(dead) : this.pick(others);
      this.pairs.push({ a: lone, b: null, kind: 'ghost', ghost: src.id });
    }
  };
  P.pairOf = function (pid) { return this.pairs.find((x) => x.a === pid || x.b === pid); };

  P.creepsFor = function () {
    const r = this.round;
    const idx = CFG.NEUTRAL_ROUNDS.indexOf(r);
    const n = 4 + idx * 2;
    const maxCost = Math.min(5, 2 + idx);
    const list = [];
    const pool = UNITS.filter((u) => u.cost <= maxCost);
    for (let i = 0; i < n; i++) {
      const def = pool[(r * 7 + i * 3) % pool.length];
      list.push({ id: def.id, star: idx >= 2 && i < 2 ? 2 : 1, x: [3, 2, 4, 1, 5, 0, 6, 3][i % 8], y: i < 3 ? 0 : i < 6 ? 1 : 2 });
    }
    return { units: list, mods: S.newMods(), nexus: null, hpScale: 0.8 + idx * 0.25, atkScale: 0.75 + idx * 0.2 };
  };
  P.setupOf = function (p) {
    const mods = JSON.parse(JSON.stringify({ ...p.mods }));
    mods.nexusShield = p.mods.nexusShield - 300 * p.expansions;
    // JSON 복제 후 불리언/숫자만 필요 (함수 없음)
    return { units: this.boardUnits(p), mods, nexus: { hp: p.nexusHp, maxHp: p.maxHp }, gambit: p.gambit };
  };
  P.setupsFor = function (pair) {
    const A = this.setupOf(this.players[pair.a]);
    let B, label;
    if (pair.kind === 'pvp') { B = this.setupOf(this.players[pair.b]); label = this.players[pair.b].name; }
    else if (pair.kind === 'ghost') {
      const g = this.players[pair.ghost];
      B = g.snapshot ? JSON.parse(JSON.stringify(g.snapshot)) : this.setupOf(g);
      B.nexus = { hp: CFG.NEXUS_HP, maxHp: CFG.NEXUS_HP }; B.gambit = false; label = g.name + '의 잔상';
    } else { B = this.creepsFor(); label = '중립 군단'; }
    return { A, B, label };
  };
  P.humanBattle = function () {
    const pair = this.pairOf(0), me = this.me;
    const { A, B, label } = this.setupsFor(pair.a === 0 ? pair : { ...pair, a: pair.b, b: pair.a });
    this.phase = 'battle';
    this.oppLabel = label;
    this.humanPair = pair;
    return S.createBattle(A, B, { round: this.round, event: this.event });
  };

  P.settleSide = function (p, side, r, opp) {
    const o = r.winner === side ? 'win' : r.winner === -1 ? 'draw' : 'lose';
    p.nexusHp = Math.max(0, r.nexusHp[side] === null ? p.nexusHp : r.nexusHp[side]);
    let extra = 0;
    if (o === 'lose') {
      if (opp.kind === 'neutral') extra = 120;
      else extra = Math.round((40 + 20 * r.survivorCost[1 - side]) * (p.gambit ? p.mods.gambitLossMul : 1));
      if (r.reason !== 'nexus' || p.nexusHp > 0) p.nexusHp = Math.max(0, p.nexusHp - extra);
    }
    let bonus = 0;
    if (o === 'win') { p.winStreak++; p.loseStreak = 0; if (p.gambit) bonus = (p.mods.gambler ? 5 : 2) + p.mods.gambitWinBonus; }
    else if (o === 'lose') { p.loseStreak++; p.winStreak = 0; }
    p.minerals += bonus;
    p.report = { outcome: o, reason: r.reason, extra, bonus, time: r.time, opp: opp.label, dealt: r.nexusDealt[side],
      taken: r.nexusDealt[1 - side], survivors: r.survivors[side].length, oppSurvivors: r.survivors[1 - side].length, gambit: p.gambit };
    if (p.nexusHp > 0 && p.nexusHp < p.maxHp * 0.3 && !p.emergency) { p.emergency = true; p.minerals += 10; p.report.emergency = true; }
    if (opp.kind === 'neutral' && o === 'win') {
      p.minerals += 4; p.report.reward = '미네랄 +4';
      const bi = this.firstEmptyBench(p);
      if (bi >= 0) { const def = this.pick(UNITS.filter((u) => u.cost <= 3)); p.bench[bi] = this.mkUnit(def.id); p.report.reward += ', ' + def.name + ' 획득'; this.autoMerge(p); }
    }
  };

  P.finishRound = function (humanResult) {
    const nowAlive = this.alive();
    nowAlive.forEach((p) => { p.snapshot = this.setupOf(p); });
    const humanPair = this.humanPair;
    this.pairs.forEach((pair) => {
      let r;
      const isHuman = pair === humanPair;
      const s = this.setupsFor(pair);
      if (isHuman) r = humanResult; else r = S.runToEnd(S.createBattle(s.A, s.B, { round: this.round, event: this.event }));
      const pa = this.players[pair.a];
      const oppA = { kind: pair.kind, label: s.label };
      // humanBattle 이 쌍을 뒤집어 만든 경우 방지: 사람이 b 쪽이면 사이드를 뒤집어 처리
      const humanIsB = isHuman && pair.b === 0;
      if (humanIsB) {
        const me = this.players[0], other = this.players[pair.a];
        // humanResult 는 side0=사람 기준 → side0=me
        this.settleSide(me, 0, r, { kind: pair.kind, label: other.name });
        if (pair.kind === 'pvp') {
          other.lastOpp = 0; me.lastOpp = other.id;
          this.settleSide(other, 1, r, { kind: pair.kind, label: me.name });
        }
        return;
      }
      this.settleSide(pa, 0, r, oppA);
      if (pair.kind === 'pvp') {
        const pb = this.players[pair.b];
        pa.lastOpp = pb.id; pb.lastOpp = pa.id;
        this.settleSide(pb, 1, r, { kind: pair.kind, label: pa.name });
      }
    });
    // 탈락 처리
    const dead = this.alive().filter((p) => p.nexusHp <= 0).sort((a, b) => a.nexusHp - b.nexusHp);
    let remaining = this.alive().length;
    dead.forEach((p) => { p.alive = false; p.rank = remaining--; });
    this.phase = 'result';
    const living = this.alive();
    if ((!this.me.alive && !this.simAll) || living.length <= 1 || this.round >= CFG.MAX_ROUNDS) {
      if (living.length) {
        living.sort((a, b) => b.nexusHp - a.nexusHp).forEach((p, i) => (p.rank = i + 1));
      }
      this.phase = 'over';
      this.winner = living.length ? living.sort((a, b) => a.rank - b.rank)[0] : null;
    }
  };

  const out = { Game, BOARD_W, BOARD_H };
  if (typeof module !== 'undefined') module.exports = out; else root.SC = Object.assign(root.SC || {}, { game: out });
})(typeof window !== 'undefined' ? window : globalThis);
