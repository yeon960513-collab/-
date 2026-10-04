// 헤드리스 검증: 8명 전원 AI로 전체 게임을 여러 번 돌려 크래시/게임 길이/전투 시간/승리 경로를 측정
const { Game } = require('../js/game.js');
const S = require('../js/sim.js');
const N = +process.argv[2] || 40;
const stats = { games: 0, rounds: [], reasons: {}, times: [], winRace: {}, draws: 0, battles: 0, over55: 0, nexusWins: 0 };
for (let s = 1; s <= N; s++) {
  const g = new Game(s * 7919, false); g.simAll = true; g.chooseCommander(g.me, g.commanderOffers()[0]);
  // 사람 자리도 AI가 대신 플레이
  while (g.phase !== 'over' && g.round < 40) {
    g.startRound();
    // augment (pending 이면 임의 선택)
    if (g.pending.augment) { g.takeAugment(g.me, g.pending.augment.offers[0]); g.pending.augment = null; }
    if (!g.me.alive) { g.humanPair = null; g.finishRound(null); continue; }
    g.aiTurn(g.me);
    const pair = g.pairOf(0);
    const hp = pair.a === 0 ? pair : { ...pair, a: pair.b, b: pair.a };
    const { A, B } = g.setupsFor(hp);
    g.humanPair = pair;
    const r = S.runToEnd(S.createBattle(A, B, { round: g.round, event: g.event }));
    g.finishRound(r);
    stats.battles++; stats.reasons[r.reason] = (stats.reasons[r.reason] || 0) + 1; stats.times.push(r.time);
    if (r.time >= 54.9) stats.over55++;
  }
  stats.games++; stats.rounds.push(g.round);
  if (g.winner) stats.winRace[g.winner.race] = (stats.winRace[g.winner.race] || 0) + 1;
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log('games', stats.games, '평균 라운드', avg(stats.rounds), 'min', Math.min(...stats.rounds), 'max', Math.max(...stats.rounds));
console.log('전투 평균 시간', avg(stats.times), '초, 55초 타임오버 비율', (100 * stats.over55 / stats.battles).toFixed(1) + '%');
console.log('종료 사유', stats.reasons);
console.log('우승 종족', stats.winRace);
