// 저격(넥서스 우선) 전략의 실효성 측정: 같은 편성으로 저격 선언 on/off 비교
const { Game } = require('../js/game.js');
const S = require('../js/sim.js');
const N = +process.argv[2] || 40;
const D = require('../js/data.js');
const buckets = {};
const acc = { on: { w: 0, n: 0, nexusWin: 0 }, off: { w: 0, n: 0, nexusWin: 0 }, natural: { nexusWin: 0, n: 0 } };
for (let s = 1; s <= N; s++) {
  const g = new Game(s * 104729, false); g.simAll = true; g.chooseCommander(g.me, g.commanderOffers()[0]);
  while (g.phase !== 'over' && g.round < 40) {
    g.startRound();
    if (g.pending.augment) { g.takeAugment(g.me, g.pending.augment.offers[0]); g.pending.augment = null; }
    if (g.me.alive) g.aiTurn(g.me);
    g.humanPair = null;
    if (g.round > 3) g.pairs.forEach((pair) => {
      if (pair.kind !== 'pvp') return;
      [true, false].forEach((gm) => {
        const st = g.setupsFor(pair); st.A.gambit = gm; st.B.gambit = false;
        const r = S.runToEnd(S.createBattle(st.A, st.B, { round: g.round, event: g.event, terrain: g.terrain }));
        const k = gm ? 'on' : 'off';
        const air = st.A.units.filter((u) => D.UNIT_BY_ID[u.id].air).length, oaa = st.B.units.filter((u) => D.UNIT_BY_ID[u.id].tags.includes('aa')).length, bk = (air >= 2 ? '공중2+' : air === 1 ? '공중1' : '공중0') + (g.terrain ? '/지형' : '/평원') + (air >= 2 ? (oaa >= 1 ? '/적대공1+' : '/적대공0') : '');
        buckets[bk] = buckets[bk] || { on: [0, 0], off: [0, 0] }; buckets[bk][k][1]++; if (r.winner === 0) buckets[bk][k][0]++;
        acc[k].n++; if (r.winner === 0) acc[k].w++; if (r.winner === 0 && r.reason === 'nexus') acc[k].nexusWin++;
      });
    });
    g.finishRound(null);
  }
}
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
console.log('저격 선언 ON : 승률', pct(acc.on.w, acc.on.n), ' 넥서스 파괴 승리', pct(acc.on.nexusWin, acc.on.n), '(표본', acc.on.n + ')');
console.log('저격 선언 OFF: 승률', pct(acc.off.w, acc.off.n), ' 넥서스 파괴 승리', pct(acc.off.nexusWin, acc.off.n));
console.log('--- 내 편성 구성별 (ON/OFF 승률, 표본)');
Object.keys(buckets).sort().forEach((k) => { const b = buckets[k]; console.log(k.padEnd(10), 'ON', pct(b.on[0], b.on[1] || 1), `(${b.on[1]})`, ' OFF', pct(b.off[0], b.off[1] || 1), `(${b.off[1]})`); });
