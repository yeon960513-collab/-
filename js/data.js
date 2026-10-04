/* 데이터 정의: 종족/유닛/시너지/증강. 수치는 모두 초안(플레이테스트로 조정). */
(function (root) {
  const COLS = 7, ROWS = 8;
  const STAR = { 1: 1, 2: 1.8, 3: 3.2 };

  const RACES = {
    union: { name: '연합군', color: '#4aa3ff', icon: '⚙' },
    swarm: { name: '군체', color: '#b45bff', icon: '☣' },
    sanct: { name: '성역', color: '#ffd24a', icon: '✦' },
  };

  // as: 공격 간격(초), range: 칸, ms: 이동속도(칸/초), nx: 넥서스 피해 배율
  // skill: {k, v(수치), mana(필요 마나), ...}
  const U = (o) => Object.assign({ armor: 0, ms: 2, nx: 1, tags: [], skill: null }, o);
  const UNITS = [
    // ---- 연합군 ----
    U({ id: 'rifle', race: 'union', name: '소총병', cost: 1, hp: 450, atk: 28, as: 0.8, range: 3, armor: 1, tags: ['range'] }),
    U({ id: 'shield', race: 'union', name: '방패병', cost: 1, hp: 700, atk: 22, as: 1.0, range: 1, armor: 4, tags: ['guard'],
        skill: { k: 'shield', v: 220, mana: 65 } }),
    U({ id: 'medic', race: 'union', name: '의무병', cost: 2, hp: 500, atk: 14, as: 1.0, range: 3, armor: 0, tags: ['range'],
        skill: { k: 'heal', v: 260, mana: 45 } }),
    U({ id: 'tank', race: 'union', name: '공성전차', cost: 3, hp: 800, atk: 70, as: 1.8, range: 5, armor: 3, nx: 1.6, ms: 1.6, tags: ['siege', 'range'] }),
    U({ id: 'ghost', race: 'union', name: '그림자 요원', cost: 3, hp: 520, atk: 42, as: 1.1, range: 4, armor: 1, ms: 2.4, tags: ['infil', 'range'],
        skill: { k: 'stun', v: 80, dur: 1.5, mana: 60 } }),
    U({ id: 'warship', race: 'union', name: '전함', cost: 5, hp: 2200, atk: 105, as: 1.6, range: 4, armor: 6, nx: 1.5, ms: 1.5, tags: ['siege', 'range'],
        skill: { k: 'aoe', v: 260, radius: 1.5, mana: 70 } }),
    // ---- 군체 ----
    U({ id: 'zergling', race: 'swarm', name: '갉이', cost: 1, hp: 350, atk: 24, as: 0.55, range: 1, ms: 2.8, tags: ['melee'] }),
    U({ id: 'spitter', race: 'swarm', name: '독침충', cost: 2, hp: 450, atk: 36, as: 1.0, range: 3, tags: ['range'] }),
    U({ id: 'burrower', race: 'swarm', name: '땅굴벌레', cost: 2, hp: 600, atk: 30, as: 0.9, range: 1, ms: 2.6, tags: ['infil', 'melee'] }),
    U({ id: 'crusher', race: 'swarm', name: '분쇄수', cost: 3, hp: 1150, atk: 52, as: 1.3, range: 1, armor: 5, tags: ['guard', 'melee'],
        skill: { k: 'shield', v: 300, mana: 70 } }),
    U({ id: 'queen', race: 'swarm', name: '여왕', cost: 4, hp: 800, atk: 38, as: 1.0, range: 3, armor: 1, tags: ['range'],
        skill: { k: 'haste', v: 0.4, dur: 5, radius: 3, mana: 50 } }),
    U({ id: 'colossus', race: 'swarm', name: '거신 괴수', cost: 5, hp: 3000, atk: 125, as: 1.5, range: 1, armor: 4, nx: 1.4, tags: ['siege', 'melee'],
        skill: { k: 'stun', v: 120, dur: 1.5, mana: 60 } }),
    // ---- 성역 ----
    U({ id: 'zealot', race: 'sanct', name: '광전사', cost: 1, hp: 500, atk: 30, as: 0.9, range: 1, armor: 1, tags: ['melee'] }),
    U({ id: 'guardian', race: 'sanct', name: '수호병', cost: 2, hp: 650, atk: 26, as: 1.0, range: 1, armor: 3, tags: ['guard', 'melee'],
        skill: { k: 'barrier', v: 220, radius: 2, mana: 55 } }),
    U({ id: 'stalker', race: 'sanct', name: '추적자', cost: 2, hp: 450, atk: 34, as: 1.0, range: 4, tags: ['infil', 'range'], ms: 2.4,
        skill: { k: 'blink', mana: 40 } }),
    U({ id: 'templar', race: 'sanct', name: '고위 사제', cost: 3, hp: 520, atk: 20, as: 1.0, range: 4, tags: ['range'],
        skill: { k: 'aoe', v: 240, radius: 1.5, mana: 60 } }),
    U({ id: 'immortal', race: 'sanct', name: '불멸자', cost: 4, hp: 1300, atk: 72, as: 1.4, range: 3, armor: 4, nx: 1.2, tags: ['siege', 'range'],
        skill: { k: 'barrier', v: 350, radius: 1, mana: 60 } }),
    U({ id: 'archon', race: 'sanct', name: '집정관', cost: 5, hp: 1800, atk: 88, as: 1.2, range: 2, armor: 2, tags: ['melee'],
        skill: { k: 'aoe', v: 300, radius: 1.5, mana: 55 } }),
  ];
  const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

  const ROLE_NAMES = { infil: '침투', siege: '공성', guard: '수비', melee: '근접', range: '원거리' };

  // 시너지: 보드 위 "서로 다른 유닛 종류" 수 기준
  const SYNERGIES = {
    union: { name: '연합군', kind: 'race', steps: [2, 4], desc: ['아군 연합군 공격력 +10%', '아군 연합군 공격력 +25%'] },
    swarm: { name: '군체', kind: 'race', steps: [2, 4], desc: ['아군 군체 공속 +15%', '아군 군체 공속 +35%'] },
    sanct: { name: '성역', kind: 'race', steps: [2, 4], desc: ['아군 성역 체력 +20%', '아군 성역 체력 +45%'] },
    infil: { name: '침투', kind: 'role', steps: [2, 3], desc: ['침투 유닛 이동속도 +30%', '+ 침투 유닛 넥서스 피해 +50%'] },
    siege: { name: '공성', kind: 'role', steps: [2, 3], desc: ['공성 유닛 넥서스 피해 +30%', '넥서스 피해 +70%, 사거리 +1'] },
    guard: { name: '수비', kind: 'role', steps: [2, 3], desc: ['아군 전체 방어력 +3', '방어력 +6, 넥서스 방벽 +600'] },
  };

  // 증강 (rarity: silver/gold/prism). fx(mods) 가 플레이어 모디파이어에 적용된다.
  const A = (o) => o;
  const AUGMENTS = [
    A({ id: 'vein', name: '풍부한 광맥', rarity: 'silver', cat: '경제', desc: '매 라운드 미네랄 +1', fx: (m) => (m.mineralInc += 1) }),
    A({ id: 'gasv', name: '가스 간헐천', rarity: 'silver', cat: '경제', desc: '매 라운드 가스 +1', fx: (m) => (m.gasInc += 1) }),
    A({ id: 'bank', name: '은행가', rarity: 'gold', cat: '경제', desc: '이자 상한 +2, 즉시 미네랄 +4', fx: (m) => { m.interestCap += 2; m.instantMinerals += 4; } }),
    A({ id: 'train', name: '전투 숙련', rarity: 'silver', cat: '전투', desc: '모든 유닛 공격력 +12%', fx: (m) => (m.atkMul *= 1.12) }),
    A({ id: 'armor', name: '강화 외골격', rarity: 'silver', cat: '전투', desc: '모든 유닛 체력 +18%', fx: (m) => (m.hpMul *= 1.18) }),
    A({ id: 'rush', name: '속공 명령', rarity: 'gold', cat: '전투', desc: '모든 유닛 공격속도 +20%', fx: (m) => (m.asMul *= 1.2) }),
    A({ id: 'popup', name: '보급 확장', rarity: 'gold', cat: '전투', desc: '인구수 상한 +1', fx: (m) => (m.popBonus += 1) }),
    A({ id: 'r_union', name: '연합군 특화', rarity: 'silver', cat: '종족', desc: '연합군 공격력·체력 +20%', fx: (m) => (m.raceMul.union *= 1.2) }),
    A({ id: 'r_swarm', name: '군체 특화', rarity: 'silver', cat: '종족', desc: '군체 공격력·체력 +20%', fx: (m) => (m.raceMul.swarm *= 1.2) }),
    A({ id: 'r_sanct', name: '성역 특화', rarity: 'silver', cat: '종족', desc: '성역 공격력·체력 +20%', fx: (m) => (m.raceMul.sanct *= 1.2) }),
    A({ id: 'snipe', name: '넥서스 저격', rarity: 'gold', cat: '넥서스', desc: '넥서스 대상 피해 +50%', fx: (m) => (m.nexusDmgMul *= 1.5) }),
    A({ id: 'wall', name: '방벽 발생기', rarity: 'silver', cat: '넥서스', desc: '넥서스 방벽 +1000', fx: (m) => (m.nexusShield += 1000) }),
    A({ id: 'repair', name: '자동 수리', rarity: 'gold', cat: '넥서스', desc: '매 라운드 넥서스 HP 6% 회복', fx: (m) => (m.nexusRegen += 0.06) }),
    A({ id: 'turret', name: '반격 포탑', rarity: 'gold', cat: '넥서스', desc: '넥서스가 사거리 4 내 적을 초당 70 피해로 공격', fx: (m) => (m.turret += 70) }),
    A({ id: 'decoy', name: '교란 장막', rarity: 'gold', cat: '넥서스', desc: '적 침투 유닛은 전투 시작 후 5초간 이동 불가', fx: (m) => (m.decoy = true) }),
    A({ id: 'gamble', name: '도박꾼', rarity: 'gold', cat: '위험', desc: '저격 선언 성공/승리 시 미네랄 +3 추가 (선언 패배 시 피해는 그대로)', fx: (m) => (m.gambler = true) }),
    A({ id: 'allin', name: '올인 징집', rarity: 'prism', cat: '위험', desc: '인구수 +2, 공격력 +25% / 체력 -10%', fx: (m) => { m.popBonus += 2; m.atkMul *= 1.25; m.hpMul *= 0.9; } }),
    A({ id: 'prism_bank', name: '대형 광산', rarity: 'prism', cat: '경제', desc: '미네랄 +2 / 가스 +2 매 라운드, 즉시 미네랄 +8', fx: (m) => { m.mineralInc += 2; m.gasInc += 2; m.instantMinerals += 8; } }),
    A({ id: 'prism_war', name: '전쟁의 서막', rarity: 'prism', cat: '전투', desc: '공격력·체력·공속 +15%', fx: (m) => { m.atkMul *= 1.15; m.hpMul *= 1.15; m.asMul *= 1.15; } }),
    A({ id: 'prism_fort', name: '철옹성', rarity: 'prism', cat: '넥서스', desc: '넥서스 방벽 +2500, 방어력 +10', fx: (m) => { m.nexusShield += 2500; m.nexusArmor += 10; } }),
  ];
  const AUG_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]));

  // 지휘관: 게임 시작 시 3택1. fx(mods) 로 패시브 적용, start: 시작 지급 유닛
  const COMMANDERS = [
    { id: 'miner', name: '광부 대장', desc: '매 라운드 미네랄 +1, 확장 비용 -2', fx: (m) => { m.mineralInc += 1; m.expandDiscount += 2; } },
    { id: 'siege', name: '공성 사령관', desc: '공성 유닛 넥서스 피해 +25%, 시작 시 공성전차 1기', start: ['tank'], fx: (m) => (m.siegeNx *= 1.25) },
    { id: 'fort', name: '요새 사령관', desc: '넥서스 방벽 +600, 넥서스 방어력 +4', fx: (m) => { m.nexusShield += 600; m.nexusArmor += 4; } },
    { id: 'scout', name: '정찰 대장', desc: '정찰 무료, 시작 가스 +3', fx: (m) => { m.scoutFree = true; m.startGas += 3; } },
    { id: 'raider', name: '돌격 대장', desc: '저격 선언 패배 페널티 ×1.2(기본 ×1.5), 승리 보너스 +2', fx: (m) => { m.gambitLossMul = 1.2; m.gambitWinBonus += 2; } },
    { id: 'sage', name: '학자', desc: '매 라운드 가스 +1, 테크업 비용 -1(최소 1)', fx: (m) => { m.gasInc += 1; m.techDiscount += 1; } },
  ];
  const CMD_BY_ID = Object.fromEntries(COMMANDERS.map((c) => [c.id, c]));

  // 전장 이벤트: 준비 단계에서 미리 공개되며 그 라운드의 모든 전투에 적용
  const EVENTS = [
    { id: 'fog', name: '짙은 안개', desc: '모든 유닛 사거리 -1 (최소 1)' },
    { id: 'rush', name: '질주 지대', desc: '모든 유닛 이동속도 +40%' },
    { id: 'mana', name: '마나 폭풍', desc: '마나 획득 2배 (스킬 빈번 발동)' },
    { id: 'frost', name: '혹한', desc: '모든 유닛 체력 -15%, 공격력 +15%' },
  ];
  const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

  const CFG = {
    COLS, ROWS,
    NEXUS_HP: 6000, ATK_SCALE: 1.4, MANA_HIT: 3, NEXUS_SHIELD: 800, NEXUS_ARMOR: 8, NEXUS_R: 0.5,
    GRACE_ROUNDS: 3,              // 이 라운드까지 넥서스 직격 무효
    BATTLE_START_DELAY: 3, BERSERK_AT: 30, BERSERK_RATE: 0.1, BATTLE_MAX: 55,
    PREP_TIME: 30,
    AUG_ROUNDS: [2, 4, 7, 10, 14],
    NEUTRAL_ROUNDS: [5, 10, 15, 20],
    POP_BY_TECH: [0, 4, 5, 6, 8, 10],
    TECH_COST: [0, 0, 2, 4, 7, 11],
    SHOP_ODDS: [null, [100, 0, 0, 0, 0], [75, 25, 0, 0, 0], [55, 30, 15, 0, 0], [35, 30, 25, 10, 0], [20, 25, 30, 18, 7]],
    SHOP_SIZE: 5, BENCH: 8, REROLL: 2, EXPAND_COST: 6, MAX_EXPAND: 2,
    START_MINERALS: 8, BASE_INCOME: 5,
    MAX_ROUNDS: 30, EVENT_FROM: 4, EVENT_CHANCE: 0.4,
  };

  const out = { COLS, ROWS, STAR, RACES, UNITS, UNIT_BY_ID, ROLE_NAMES, SYNERGIES, AUGMENTS, AUG_BY_ID, COMMANDERS, CMD_BY_ID, EVENTS, EVENT_BY_ID, CFG };
  if (typeof module !== 'undefined') module.exports = out; else root.SC = Object.assign(root.SC || {}, { data: out });
})(typeof window !== 'undefined' ? window : globalThis);
