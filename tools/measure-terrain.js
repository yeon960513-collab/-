// 지형별로 '지상 침투' 저격이 어떻게 달라지는지 측정 (공중 0, 침투 유닛 2+)
const { Game } = require('../js/game.js');
const S = require('../js/sim.js'); const D = require('../js/data.js');
const N = +process.argv[2] || 80; const res = {};
for (let s = 1; s <= N; s++) {
  const g = new Game(s * 7717, false); g.simAll = true; g.chooseCommander(g.me, g.commanderOffers()[0]);
  while (g.phase !== 'over' && g.round < 40) {
    g.startRound(); if (g.pending.augment) { g.takeAugment(g.me, g.pending.augment.offers[0]); g.pending.augment = null; }
    if (g.me.alive) g.aiTurn(g.me); g.humanPair = null;
    if (g.round > 3) g.pairs.forEach((pair) => {
      if (pair.kind !== 'pvp') return;
      [true, false].forEach((gm) => {
        for (const t of [null, 'canyon', 'flank', 'rift', 'tunnel']) {
          const st = g.setupsFor(pair);
          const air = st.A.units.filter((u) => D.UNIT_BY_ID[u.id].air).length, inf = st.A.units.filter((u) => D.UNIT_BY_ID[u.id].tags.includes('infil')).length;
          if (air > 0 || inf < 2) return;
          st.A.gambit = gm; st.B.gambit = false;
          const r = S.runToEnd(S.createBattle(st.A, st.B, { round: g.round, terrain: t }));
          const k = (t || 'plain') + (gm ? ' ON' : ' OFF'); res[k] = res[k] || [0, 0]; res[k][1]++; if (r.winner === 0) res[k][0]++;
        }
      });
    });
    g.finishRound(null);
  }
}
Object.keys(res).sort().forEach((k) => console.log(k.padEnd(12), (100 * res[k][0] / res[k][1]).toFixed(1) + '%', `(${res[k][1]})`));
