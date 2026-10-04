// 타임오버 원인 분석: 모든 전투(8인 중 4쌍)를 대상으로 집계
const { Game } = require('../js/game.js');
const S = require('../js/sim.js');
const N = +process.argv[2] || 30;
let total = 0, to = 0; const byRound = {}, shape = [];
for (let s = 1; s <= N; s++) {
  const g = new Game(s * 7919, false); g.simAll = true; g.chooseCommander(g.me, g.commanderOffers()[0]);
  while (g.phase !== 'over' && g.round < 40) {
    g.startRound(); if (process.env.EVENT && !g.isNeutral()) g.event = process.env.EVENT;
    if (g.pending.augment) { g.takeAugment(g.me, g.pending.augment.offers[0]); g.pending.augment = null; }
    if (g.me.alive) g.aiTurn(g.me);
    g.humanPair = null;
    const results = [];
    g.pairs.forEach((pair) => {
      const st = g.setupsFor(pair);
      const bt = S.createBattle(st.A, st.B, { round: g.round, event: g.event, terrain: g.terrain });
      // 30초 시점 스냅샷
      while (!bt.over && bt.t < 30) S.step(bt);
      const snap = bt.over ? null : { a: bt.units.filter((u) => u.alive && u.side === 0), b: bt.units.filter((u) => u.alive && u.side === 1), nex: bt.nex.map((n) => n && n.hp) };
      const r = S.runToEnd(bt);
      total++;
      if (r.reason.startsWith('time') || r.reason === 'draw') {
        to++; byRound[g.round] = (byRound[g.round] || 0) + 1;
        if (snap && shape.length < 12) shape.push({ round: g.round, reason: r.reason, a: snap.a.map((u) => u.def.id + u.star + '(' + Math.round(u.hp) + ')').join(','), b: snap.b.map((u) => u.def.id + u.star + '(' + Math.round(u.hp) + ')').join(','), cost: r.survivorCost });
      }
    });
    g.finishRound(null);
  }
}
console.log('전투', total, '타임오버(판정 포함)', to, (100 * to / total).toFixed(1) + '%');
console.log('라운드별', byRound);
const rate = 100 * to / total;
console.log(rate <= 5 ? 'PASS: 타임오버 5% 이내' : 'FAIL: 타임오버 5% 초과');
process.exitCode = rate <= 5 ? 0 : 1;
shape.forEach((x) => console.log(JSON.stringify(x)));
