/* 화면/입력/렌더링 */
(function () {
  const D = SC.data, S = SC.sim, G = SC.game;
  const { CFG, UNIT_BY_ID, RACES, SYNERGIES, AUG_BY_ID, ROLE_NAMES, STAR } = D;
  const CELL = 72, W = CFG.COLS * CELL, H = (CFG.ROWS + 2) * CELL;
  const $ = (s) => document.querySelector(s);
  const cv = $('#board'), ctx = cv.getContext('2d');

  let g = null, bt = null, mode = 'menu', sel = null, prepLeft = 0, speed = 1, acc = 0, last = 0;
  let fx = [], logs = [], endTimer = 0, flash = [0, 0], shake = 0, muted = false, hover = null, scoutInfo = null;
  let audio = null;

  // ---------- 사운드 ----------
  function beep(f, d, type, vol) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), a = audio.createGain();
      o.type = type || 'sine'; o.frequency.value = f; a.gain.value = vol || 0.04;
      o.connect(a); a.connect(audio.destination); o.start();
      a.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d); o.stop(audio.currentTime + d);
    } catch (e) { /* 오디오 불가 환경 */ }
  }
  const sfx = {
    buy: () => beep(520, .08, 'triangle'), merge: () => { beep(660, .12, 'square', .05); setTimeout(() => beep(990, .2, 'square', .05), 110); },
    hit: () => beep(180, .04, 'sawtooth', .015), nex: () => beep(90, .25, 'sawtooth', .06),
    win: () => [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, .2, 'triangle', .06), i * 120)),
    lose: () => [330, 262, 196].forEach((f, i) => setTimeout(() => beep(f, .25, 'sawtooth', .05), i * 140)),
  };

  // ---------- 유틸 ----------
  function skillDesc(def) {
    const s = def.skill; if (!s) return '스킬 없음';
    const m = { shield: `방어막 ${s.v}`, barrier: `주변 아군 방어막 ${s.v}`, heal: `가장 약한 아군 ${s.v} 회복`, haste: `주변 아군 공속 +${Math.round(s.v * 100)}% (${s.dur}초)`,
      stun: `대상 ${s.v} 피해 + ${s.dur}초 기절`, aoe: `범위 ${s.v} 피해`, blink: '적 후방(넥서스 근처)으로 점멸' };
    return `${m[s.k] || s.k} · 마나 ${s.mana}`;
  }
  const tagNames = (d) => d.tags.map((t) => ROLE_NAMES[t]).join('/');
  function log(msg) { logs.push(msg); if (logs.length > 40) logs.shift(); $('#log').innerHTML = logs.slice(-14).reverse().map((l) => `<div>${l}</div>`).join(''); }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 1700);
  }
  function modal(html, onMount) {
    const m = $('#modal'); m.innerHTML = `<div class="dlg">${html}</div>`; m.classList.remove('hidden'); if (onMount) onMount(m);
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
  const modalOpen = () => !$('#modal').classList.contains('hidden');
  function myMatch() { const p = g.pairOf(0); return p.b === 0 ? { a: 0, b: p.a, kind: p.kind, ghost: p.ghost } : p; }

  // ---------- 렌더: DOM ----------
  function renderAll() {
    if (!g) return;
    const me = g.me;
    $('#roundInfo').textContent = `라운드 ${g.round}/${CFG.MAX_ROUNDS}${g.isNeutral() ? ' · 중립전' : ''}`;
    $('#resMin').textContent = me.minerals; $('#resGas').textContent = me.gas; $('#resTech').textContent = me.tech;
    $('#resPop').textContent = `${g.popCount(me)}/${g.cap(me)}`;
    const r = me.nexusHp / me.maxHp; $('#myNexBar').style.width = Math.max(0, r * 100) + '%';
    $('#myNexTxt').textContent = `${me.nexusHp} / ${me.maxHp}`;
    $('.bar').classList.toggle('low', r < 0.3);
    $('#vignette').classList.toggle('crit', r < 0.3 && me.alive);
    renderPlayers(); renderOpp(); renderSyn(); renderAugs(); renderShop(); renderBench(); renderButtons();
  }
  function renderPlayers() {
    const m = g.pairs.length && mode !== 'menu' ? myMatch() : null;
    const list = g.players.slice().sort((a, b) => (b.alive - a.alive) || (a.alive ? b.nexusHp - a.nexusHp : a.rank - b.rank));
    $('#players').innerHTML = list.map((p) => {
      const cls = [p.human ? 'me' : '', p.alive ? '' : 'dead', m && m.kind === 'pvp' && m.b === p.id ? 'opp' : ''].join(' ');
      return `<li class="${cls}"><b>${p.name}</b> <span style="color:${RACES[p.race].color}">${RACES[p.race].icon}</span>
        <span style="float:right">${p.alive ? p.nexusHp : '탈락 ' + p.rank + '위'}</span>
        <div class="mini"><i style="width:${Math.max(0, p.nexusHp / p.maxHp * 100)}%"></i></div></li>`;
    }).join('');
  }
  function renderOpp() {
    if (!g.pairs.length) return;
    const m = myMatch();
    let h = '';
    if (m.kind === 'neutral') h = '<b>중립 군단</b><br><span class="dim">처치 시 미네랄 +4와 유닛 1기. 패배 시 넥서스 피해 120.</span>';
    else if (m.kind === 'ghost') h = `<b>${g.players[m.ghost].name}의 잔상</b><br><span class="dim">홀수 인원 보정. 상대 넥서스는 영향받지 않습니다.</span>`;
    else {
      const o = g.players[m.b];
      h = `<b>${o.name}</b> <span style="color:${RACES[o.race].color}">${RACES[o.race].name}</span><br>넥서스 ${o.nexusHp}/${o.maxHp}`;
      if (o.gambit) h += '<br><span style="color:var(--bad)">⚠ 상대가 저격을 선언했습니다</span>';
    }
    if (scoutInfo) h += `<hr style="border-color:var(--line)"><b>정찰 결과</b><br>` + scoutInfo;
    else if (g.phase === 'prep') h += '<br><span class="dim">정찰(⛽1)로 편성을 확인하세요.</span>';
    $('#oppBox').innerHTML = h;
  }
  function renderSyn() {
    const list = g.boardUnits(g.me);
    const syn = S.computeSynergies(list);
    const rows = Object.keys(SYNERGIES).map((k) => {
      const s = SYNERGIES[k], c = syn[k];
      if (!c.count) return '';
      const cls = c.level === 2 ? 'max' : c.level === 1 ? 'on' : '';
      const nextTxt = c.level < 2 ? ` (${s.steps[c.level]}에서 발동)` : '';
      return `<div class="syn-row ${cls}" title="${s.desc.join(' / ')}"><span>${s.name} ${c.count}</span><span>${c.level ? s.desc[c.level - 1] : nextTxt}</span></div>`;
    }).join('');
    $('#syn').innerHTML = rows || '<span class="dim">보드에 유닛을 배치하세요</span>';
  }
  function renderAugs() {
    $('#augs').innerHTML = g.me.augments.length ? g.me.augments.map((id) => { const a = AUG_BY_ID[id]; return `<div title="${a.desc}"><span class="tag">${a.cat}</span>${a.name}</div>`; }).join('') : '<span class="dim">라운드 ' + CFG.AUG_ROUNDS.join(', ') + '에 선택</span>';
  }
  function renderShop() {
    const me = g.me;
    $('#shop').innerHTML = me.shop.map((id, i) => {
      if (!id) return '<div class="card empty"></div>';
      const d = UNIT_BY_ID[id], poor = me.minerals < d.cost;
      return `<div class="card ${d.race} ${poor ? 'poor' : ''}" data-i="${i}">
        <span class="cost">◆${d.cost}</span><span class="nm">${d.name}</span>
        <span class="meta" style="color:${RACES[d.race].color}">${RACES[d.race].name} · ${tagNames(d)}</span>
        <span class="st">HP ${d.hp} · 공 ${d.atk} · 사거리 ${d.range}</span></div>`;
    }).join('');
    document.querySelectorAll('.card[data-i]').forEach((el) => {
      const i = +el.dataset.i;
      el.onclick = () => buy(i);
      el.onmouseenter = () => inspectDef(UNIT_BY_ID[me.shop[i]], 1);
    });
  }
  function slotHtml(u) {
    if (!u) return '';
    const d = UNIT_BY_ID[u.id];
    return `<span class="stars">${'★'.repeat(u.star)}</span><div class="u" style="color:${RACES[d.race].color}">${d.name}<small>${tagNames(d)}</small></div>`;
  }
  function renderBench() {
    const me = g.me;
    $('#bench').innerHTML = me.bench.map((u, i) => {
      const cls = u ? UNIT_BY_ID[u.id].race : '';
      const s = sel && sel.zone === 'bench' && sel.i === i ? 'sel' : '';
      return `<div class="slot ${cls} ${s}" data-i="${i}">${slotHtml(u)}</div>`;
    }).join('');
    document.querySelectorAll('#bench .slot').forEach((el) => {
      const i = +el.dataset.i;
      el.onclick = () => clickLoc({ zone: 'bench', i });
      el.onmouseenter = () => { const u = me.bench[i]; if (u) inspectDef(UNIT_BY_ID[u.id], u.star); };
    });
  }
  function renderButtons() {
    const me = g.me, prep = mode === 'prep';
    $('#btnReroll').disabled = !prep || me.minerals < CFG.REROLL;
    const tc = CFG.TECH_COST[me.tech + 1];
    $('#btnTech').textContent = me.tech >= 5 ? '테크 최대' : `테크업 (⛽${tc})`;
    $('#btnTech').disabled = !prep || me.tech >= 5 || me.gas < tc;
    $('#btnExpand').disabled = !prep || me.expansions >= CFG.MAX_EXPAND || me.minerals < CFG.EXPAND_COST;
    $('#btnExpand').textContent = `확장 ${me.expansions}/${CFG.MAX_EXPAND} (◆${CFG.EXPAND_COST})`;
    $('#btnScout').disabled = !prep || me.gas < 1 || me.scouted || g.pairOf(0).kind === 'neutral';
    $('#btnGambit').disabled = !prep || g.isNeutral();
    $('#btnGambit').classList.toggle('on', me.gambit);
    $('#btnGambit').textContent = me.gambit ? '저격 선언 중!' : '저격 선언';
    $('#btnSell').disabled = !prep || !sel;
    $('#btnGo').disabled = !prep;
  }
  function inspectDef(d, star) {
    if (!d) return;
    const m = STAR[star] || 1;
    $('#inspect').innerHTML = `<b style="color:${RACES[d.race].color}">${d.name}</b> ${'★'.repeat(star)} <span class="dim">(◆${d.cost})</span><br>
      ${RACES[d.race].name} · ${tagNames(d)}<br>HP ${Math.round(d.hp * m)} · 공격 ${Math.round(d.atk * CFG.ATK_SCALE * m)} · 공속 ${(1 / d.as).toFixed(2)}/s<br>
      사거리 ${d.range} · 방어 ${d.armor} · 이동 ${d.ms}<br>넥서스 피해 ×${d.nx}${d.tags.includes('infil') ? ' · <b>자동 저격</b>' : ''}<br>
      <span class="dim">${skillDesc(d)}</span>`;
  }

  // ---------- 행동 ----------
  function afterAction(res, okSound) {
    if (res && res.ok === false && res.msg) toast(res.msg);
    if (res && res.ok && okSound) sfx[okSound]();
    if (res && res.merges && res.merges.length) {
      sfx.merge();
      res.merges.forEach((m) => { const d = UNIT_BY_ID[m.id]; log(`<b>승급!</b> ${d.name} ★${m.star}`); toast(`✨ ${d.name} ★${m.star} 승급!`); });
    }
    sel = null; renderAll();
  }
  function buy(i) { if (mode !== 'prep') return; const r = g.buy(g.me, i); afterAction(r, 'buy'); }
  function clickLoc(loc) {
    if (mode !== 'prep') return;
    const u = g.get(g.me, loc);
    if (!sel) { if (u) { sel = loc; renderAll(); inspectDef(UNIT_BY_ID[u.id], u.star); } return; }
    if (sel.zone === loc.zone && sel.i === loc.i && sel.x === loc.x && sel.y === loc.y) { sel = null; renderAll(); return; }
    const r = g.move(g.me, sel, loc);
    sel = null; afterAction(r);
  }
  $('#btnReroll').onclick = () => afterAction(g.reroll(g.me), 'buy');
  $('#btnTech').onclick = () => { const r = g.techUp(g.me); afterAction(r, 'merge'); if (r.ok) log(`테크 ${g.me.tech} 달성 · 인구수 ${g.cap(g.me)}`); };
  $('#btnExpand').onclick = () => { const r = g.expand(g.me); afterAction(r, 'buy'); if (r.ok) log('확장 기지 건설: 수입 증가 / 넥서스 방벽 -300'); };
  $('#btnSell').onclick = () => { if (sel) { afterAction(g.sell(g.me, sel), 'buy'); } };
  $('#btnGambit').onclick = () => { g.me.gambit = !g.me.gambit; renderAll(); if (g.me.gambit) toast('저격 선언: 수비 제외 유닛이 넥서스를 노립니다. 패배 시 피해 ×1.5'); };
  $('#btnScout').onclick = () => {
    const me = g.me; if (me.gas < 1 || me.scouted) return;
    me.gas -= 1; me.scouted = true;
    const m = myMatch(), { B } = g.setupsFor(m);
    const cnt = {};
    B.units.forEach((u) => { cnt[u.id] = (cnt[u.id] || 0) + 1; });
    scoutInfo = Object.keys(cnt).map((id) => `${UNIT_BY_ID[id].name}×${cnt[id]}`).join(', ') + `<br>유닛 ${B.units.length}기`;
    renderAll();
  };
  $('#btnGo').onclick = () => { if (mode === 'prep') startBattle(); };
  $('#btnMute').onclick = () => { muted = !muted; $('#btnMute').textContent = muted ? '🔇' : '🔊'; };
  $('#btnHelp').onclick = showHelp;
  document.addEventListener('keydown', (e) => {
    if (mode !== 'prep' || modalOpen()) return;
    if (e.key === ' ') { e.preventDefault(); startBattle(); }
    if (e.key === 'd' || e.key === 'D') $('#btnReroll').click();
    if (e.key === 'f' || e.key === 'F') $('#btnTech').click();
    if (e.key === 'e' || e.key === 'E') $('#btnSell').click();
  });

  // ---------- 캔버스 입력 ----------
  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * W, y = (ev.clientY - r.top) / r.height * H;
    return { cx: Math.floor(x / CELL), gy: Math.floor(y / CELL) - 1 };
  }
  cv.addEventListener('click', (ev) => {
    if (mode !== 'prep') return;
    const { cx, gy } = cellAt(ev);
    if (cx < 0 || cx >= CFG.COLS || gy < CFG.ROWS / 2 || gy >= CFG.ROWS) return;
    clickLoc({ zone: 'board', x: cx, y: gy - CFG.ROWS / 2 });
  });
  cv.addEventListener('mousemove', (ev) => {
    const { cx, gy } = cellAt(ev); hover = { cx, gy };
    if (!g) return;
    if (mode === 'prep' && gy >= CFG.ROWS / 2 && gy < CFG.ROWS && cx >= 0 && cx < CFG.COLS) {
      const u = g.me.board[gy - CFG.ROWS / 2][cx]; if (u) inspectDef(UNIT_BY_ID[u.id], u.star);
    } else if (mode === 'battle' && bt) {
      const u = bt.units.find((q) => q.alive && Math.round(q.x) === cx && Math.round(q.y) === gy);
      if (u) inspectDef(u.def, u.star);
    }
  });

  // ---------- 라운드 흐름 ----------
  function newGame(hard) {
    g = new G.Game((Date.now() & 0xffffff) | 1, hard);
    logs = []; closeModal(); nextRound();
  }
  function nextRound() {
    g.startRound(); mode = 'prep'; sel = null; scoutInfo = null; prepLeft = CFG.PREP_TIME; fx = []; bt = null;
    const li = g.me.lastIncome;
    log(`<b>라운드 ${g.round}</b> 수입 ◆${li.base}${li.streak ? ' +연속' + li.streak : ''}${li.interest ? ' +이자' + li.interest : ''}`);
    $('#overlay').innerHTML = g.isNeutral() ? '<div><div class="big" style="font-size:30px;color:var(--warn)">중립 라운드</div></div>' : '';
    setTimeout(() => { if (mode === 'prep') $('#overlay').innerHTML = ''; }, 1500);
    renderAll(); renderHud();
    if (g.pending.augment) showAugment();
  }
  function showAugment() {
    const pa = g.pending.augment;
    const cards = pa.offers.map((id) => { const a = AUG_BY_ID[id];
      return `<div class="aug ${a.rarity}" data-id="${id}"><div class="r">${a.rarity.toUpperCase()} · ${a.cat}</div><div class="n">${a.name}</div><div>${a.desc}</div></div>`; }).join('');
    modal(`<h2>증강 선택</h2><div class="dim">하나를 선택하세요. (리롤 1회)</div><div class="row">${cards}</div>
      <button id="augReroll" ${pa.rerolled ? 'disabled' : ''}>리롤</button>`, (m) => {
      m.querySelectorAll('.aug').forEach((el) => (el.onclick = () => {
        g.takeAugment(g.me, el.dataset.id); g.pending.augment = null; log(`증강: <b>${AUG_BY_ID[el.dataset.id].name}</b>`);
        sfx.merge(); closeModal(); renderAll();
      }));
      const rb = m.querySelector('#augReroll');
      rb.onclick = () => { pa.offers = g.augmentOffers(g.me); pa.rerolled = true; showAugment(); };
    });
  }
  function autoFillIfEmpty() {
    const me = g.me;
    if (g.popCount(me) === 0 && me.bench.some((u) => u)) { const gm = me.gambit; g.aiPlace(me); me.gambit = gm; renderAll(); toast('배치된 유닛이 없어 자동 배치했습니다'); }
  }
  function startBattle() {
    autoFillIfEmpty();
    bt = g.humanBattle(); mode = 'battle'; speed = 1; acc = 0; fx = []; endTimer = 0; flash = [0, 0]; shake = 0; sel = null; scoutInfo = null;
    $('#overlay').innerHTML = ''; renderAll(); renderHud();
    if (g.me.gambit) log('<b>저격 선언!</b>');
  }
  function renderHud() {
    const h = $('#hud');
    if (mode === 'battle' && bt) {
      h.innerHTML = `<span id="hudL"></span><span><button data-sp="1">1x</button> <button data-sp="2">2x</button> <button data-sp="4">4x</button> <button id="btnSkip">건너뛰기 ⏭</button></span>`;
      h.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => (speed = +b.dataset.sp)));
      $('#btnSkip').onclick = () => { let n = 0; while (!bt.over && n++ < 2000) S.step(bt); endTimer = 99; };
    } else h.innerHTML = '<span id="hudL" class="dim">▼ 아래쪽이 내 배치 구역입니다. 클릭해서 유닛을 선택 후 이동하세요.</span><span></span>';
  }
  function updateHudBattle() {
    const el = $('#hudL'); if (!el || !bt) return;
    const mine = bt.units.filter((u) => u.alive && u.side === 0).length, foe = bt.units.filter((u) => u.alive && u.side === 1).length;
    const t = Math.min(CFG.BATTLE_MAX, bt.t), ber = bt.t > CFG.BERSERK_AT;
    const phase = bt.t < CFG.BATTLE_START_DELAY ? '준비' : ber ? `<b style="color:var(--bad)">광폭화 공속×${S.berserkMul(bt).toFixed(1)}</b>` : '교전';
    el.innerHTML = `<b style="color:var(--good)">아군 ${mine}</b> vs <b style="color:var(--bad)">적 ${foe}</b> · ${phase} · ${t.toFixed(0)}s/${CFG.BATTLE_MAX}s`;
  }

  const REASON = { wipe: '상대 유닛 전멸', nexus: '넥서스 파괴', time: '시간 판정(남은 유닛 가치)', 'time-nexus': '시간 판정(넥서스 HP 비율)', 'wipe-nexus': '동시 전멸 → 넥서스 HP 비율', draw: '무승부' };
  function endBattle() {
    const r = bt.result;
    g.finishRound(r); mode = 'result';
    const me = g.me, rep = me.report;
    const outcome = rep ? rep.outcome : r.winner === 0 ? 'win' : r.winner === -1 ? 'draw' : 'lose';
    (outcome === 'win' ? sfx.win : outcome === 'lose' ? sfx.lose : () => 0)();
    log(`R${g.round} ${outcome === 'win' ? '승리' : outcome === 'lose' ? '패배' : '무승부'} (${REASON[r.reason]})`);
    renderAll();
    if (rep && rep.emergency) toast('🚨 넥서스 위기! 긴급 보급 ◆10 지급');
    showResult(outcome, r, rep);
  }
  function lossAdvice(r, rep) {
    const out = [];
    if (r.reason === 'nexus') out.push('넥서스가 직접 파괴되었습니다. 수비 시너지·방벽·반격 포탑·방어형 증강을 고려하세요.');
    if (rep.taken > 800) out.push(`상대 침투/공성에게 넥서스가 ${Math.round(rep.taken)} 피해를 입었습니다. 전열 유닛을 늘려 길을 막아보세요.`);
    if (rep.survivors === 0 && rep.oppSurvivors >= 3) out.push('전멸당했습니다. 인구수를 채우고 승급(★)을 우선하세요.');
    if (rep.gambit) out.push('저격 선언 실패로 패배 피해가 ×1.5 적용되었습니다.');
    if (r.reason.startsWith('time')) out.push('55초 안에 승부를 내지 못했습니다. 공성/침투 유닛이나 화력을 보강하세요.');
    if (!out.length) out.push('상대 전력이 앞섰습니다. 시너지와 증강 조합을 점검해보세요.');
    return out;
  }
  function showResult(outcome, r, rep) {
    const over = g.phase === 'over';
    const title = outcome === 'win' ? '<span style="color:var(--good)">승리</span>' : outcome === 'lose' ? '<span style="color:var(--bad)">패배</span>' : '무승부';
    let adv = '';
    if (outcome === 'lose' && rep) adv = `<h3>패인 리포트</h3><ul>${lossAdvice(r, rep).map((x) => `<li>${x}</li>`).join('')}</ul>`;
    const mvp = r.mvp ? `${r.mvp.def.name} ★${r.mvp.star} (피해 ${Math.round(r.mvp.dmgDealt + r.mvp.nexDealt)})` : '-';
    const tbl = rep ? `<table class="t"><tr><td>상대</td><td>${rep.opp}</td></tr>
      <tr><td>결과</td><td>${REASON[r.reason]} · ${r.time.toFixed(1)}초</td></tr>
      <tr><td>넥서스 직격</td><td>내가 ${Math.round(rep.dealt)} / 받음 ${Math.round(rep.taken)}</td></tr>
      <tr><td>생존 유닛</td><td>${rep.survivors} vs ${rep.oppSurvivors}</td></tr>
      ${rep.extra ? `<tr><td>패배 피해</td><td>-${rep.extra} 넥서스</td></tr>` : ''}
      ${rep.bonus ? `<tr><td>저격 보너스</td><td>◆+${rep.bonus}</td></tr>` : ''}
      ${rep.reward ? `<tr><td>보상</td><td>${rep.reward}</td></tr>` : ''}
      <tr><td>MVP</td><td>${mvp}</td></tr></table>` : '';
    modal(`<h2>R${g.round} ${title}</h2>${tbl}${adv}
      <div class="row"><button class="primary" id="nextBtn">${over ? '최종 결과 ▶' : '다음 라운드 ▶'}</button></div>`, (m) => {
      m.querySelector('#nextBtn').onclick = () => { if (over) showOver(); else { closeModal(); nextRound(); } };
    });
  }
  function titleFor(me) {
    const syn = S.computeSynergies(g.boardUnits(me)), t = [];
    const ids = me.augments;
    if (me.expansions >= 2) t.push('빠른 멀티 거부자'.replace('거부자', '선호자'));
    if (syn.infil.level === 2) t.push('그림자 암살단');
    if (syn.siege.level === 2) t.push('공성 사령관');
    if (syn.guard.level === 2) t.push('철벽 수호자');
    if (ids.includes('turret') || ids.includes('prism_fort')) t.push('요새 지배자');
    ['union', 'swarm', 'sanct'].forEach((r) => { if (syn[r].level === 2) t.push(RACES[r].name + ' 대원수'); });
    return t.length ? t.slice(0, 2).join(' · ') : '떠오르는 지휘관';
  }
  function showOver() {
    const me = g.me, win = g.winner && g.winner.human;
    const rows = g.players.slice().sort((a, b) => a.rank - b.rank).map((p) => `<tr><td>${p.rank}위</td><td>${p.human ? '<b>나</b>' : p.name}</td><td>${RACES[p.race].name}</td><td>${p.nexusHp}</td></tr>`).join('');
    modal(`<h2>${win ? '🏆 최후의 1인!' : `탈락 — ${me.rank}위`}</h2><div>칭호: <b>${titleFor(me)}</b> · 도달 라운드 ${g.round}</div>
      <table class="t"><tr><th>순위</th><th>플레이어</th><th>주 종족</th><th>넥서스</th></tr>${rows}</table>
      <div class="row"><button id="again" class="primary">다시 하기</button></div>`, (m) => { m.querySelector('#again').onclick = showMenu; });
  }
  function showHelp() {
    modal(`<h2>게임 방법</h2><ul>
      <li><b>승리 조건</b>: 1:1 전투에서 <b>상대 유닛 전멸</b> 또는 <b>상대 넥서스 파괴</b>. 전멸 승리하면 패자 넥서스에 피해, 넥서스가 0이 되면 탈락합니다.</li>
      <li><b>전투 1분 이내</b>: 3초 준비 → 30초부터 <b>광폭화(공격속도만 증가)</b> → 55초 시간 판정(남은 유닛 가치 → 넥서스 HP 비율 → 무승부).</li>
      <li><b>준비 단계(30초)</b>: 상점에서 유닛 구매, 같은 유닛 3개 → ★ 승급. 클릭으로 선택 후 칸을 눌러 이동/교체.</li>
      <li><b>자원</b>: ◆미네랄(구매/리롤/확장), ⛽가스(테크업/정찰). 10당 이자(최대 3). 연승·연패 보너스.</li>
      <li><b>넥서스 공략</b>: 침투 유닛은 넥서스로 직행, <b>저격 선언</b>을 하면 수비 외 유닛 모두 넥서스를 노립니다(패배 시 피해 ×1.5, 승리 시 보너스). 초반 ${CFG.GRACE_ROUNDS}라운드는 직격 무효.</li>
      <li><b>수비</b>: 전열로 길 막기, 수비 시너지, 방벽/포탑 증강. 확장은 수입이 늘지만 방벽 -300.</li>
      <li><b>증강</b>: 라운드 ${CFG.AUG_ROUNDS.join('/')}에 3택1. 중립전: 라운드 ${CFG.NEUTRAL_ROUNDS.join('/')}.</li>
      <li>단축키: Space 전투 시작, D 리롤, F 테크업, E 판매.</li></ul>
      <div class="row"><button class="primary" id="ok">닫기</button></div>`, (m) => (m.querySelector('#ok').onclick = closeModal));
  }
  function showMenu() {
    mode = 'menu';
    modal(`<h2>⬡ 넥서스 오토배틀러</h2>
      <p>스타크래프트식 운영(미네랄/가스/테크/확장) + 오토체스 자동 전투 + 증강 선택.<br>
      8인 서바이벌, 매 라운드 <b>1:1 전투(1분 이내)</b>. 유닛을 전멸시키거나 <b>넥서스를 파괴</b>하세요.</p>
      <div class="row"><button class="primary" id="n">보통으로 시작</button><button id="h">어려움 (AI 수입 +2)</button><button id="hp">도움말</button></div>`, (m) => {
      m.querySelector('#n').onclick = () => newGame(false);
      m.querySelector('#h').onclick = () => newGame(true);
      m.querySelector('#hp').onclick = () => { showHelp(); const ok = $('#ok'); ok.onclick = showMenu; };
    });
  }

  // ---------- 렌더: 캔버스 ----------
  function px(gx) { return gx * CELL + CELL / 2; }
  function py(gy) { return (gy + 1) * CELL + CELL / 2; }
  function disp(u) {
    if (!bt) return { x: u.x, y: u.y };
    const dur = Math.max(0.08, 1 / u.ms), f = Math.min(1, (bt.t - (u.movedAt || -9)) / dur);
    return { x: u.px + (u.x - u.px) * f, y: u.py + (u.y - u.py) * f };
  }
  function drawNexus(side, n, label) {
    const cx = W / 2, cy = side === 0 ? (CFG.ROWS + 1) * CELL + CELL / 2 : CELL / 2;
    const f = flash[side] > 0;
    ctx.save(); ctx.translate(cx, cy);
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); } ctx.closePath();
    ctx.fillStyle = f ? '#fff' : side === 0 ? '#1d4a7c' : '#7c1d2c'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = side === 0 ? '#5ee1ff' : '#ff6b7a'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, 1);
    ctx.restore();
    if (n) {
      const bw = 150, yy = side === 0 ? cy - 36 : cy + 28;
      ctx.fillStyle = '#05070d'; ctx.fillRect(cx - bw / 2, yy, bw, 9);
      ctx.fillStyle = '#43d68a'; ctx.fillRect(cx - bw / 2, yy, bw * Math.max(0, n.hp / n.maxHp), 9);
      if (n.shield > 0) { ctx.fillStyle = '#7fd4ff'; ctx.fillRect(cx - bw / 2, yy - 4, bw * Math.min(1, n.shield / n.maxShield), 3); }
      ctx.fillStyle = '#cfe'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.max(0, Math.round(n.hp))}${n.shield > 0 ? ' +' + Math.round(n.shield) : ''}${n.grace ? ' 무적' : ''}`, cx + 34, cy);
    } else if (label) { ctx.fillStyle = '#cfe'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx + 34, cy); }
  }
  function drawUnit(u, x, y) {
    const d = u.def, r = 24, col = RACES[d.race].color;
    ctx.save();
    ctx.globalAlpha = u.stun > 0 ? 0.55 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#0b1020'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = u.side === 0 ? '#43d68a' : '#ff5d6c'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r - 5, 0, 7); ctx.fillStyle = col + '55'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.name[0], x, y);
    ctx.fillStyle = '#ffd24a'; ctx.font = '11px sans-serif'; ctx.fillText('★'.repeat(u.star), x, y - r - 6);
    if (u.haste > 0) { ctx.strokeStyle = '#ffb54a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
    // 체력/방어막/마나
    const bw = 46, bx = x - bw / 2, by = y + r + 3;
    ctx.fillStyle = '#05070d'; ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = u.side === 0 ? '#43d68a' : '#ff5d6c'; ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), 6);
    if (u.shield > 0) { ctx.fillStyle = '#e6f6ff'; ctx.fillRect(bx, by - 3, bw * Math.min(1, u.shield / u.maxHp), 3); }
    if (d.skill) { ctx.fillStyle = '#05070d'; ctx.fillRect(bx, by + 7, bw, 3); ctx.fillStyle = '#4aa3ff'; ctx.fillRect(bx, by + 7, bw * Math.min(1, u.mana / d.skill.mana), 3); }
    ctx.restore();
  }
  function drawBoard() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    ctx.clearRect(-10, -10, W + 20, H + 20);
    for (let gy = 0; gy < CFG.ROWS; gy++) for (let x = 0; x < CFG.COLS; x++) {
      const mine = gy >= CFG.ROWS / 2;
      ctx.fillStyle = ((x + gy) % 2 ? '#10172a' : '#0d1322');
      ctx.fillRect(x * CELL, (gy + 1) * CELL, CELL, CELL);
      ctx.fillStyle = mine ? 'rgba(74,163,255,.07)' : 'rgba(255,93,108,.07)'; ctx.fillRect(x * CELL, (gy + 1) * CELL, CELL, CELL);
    }
    ctx.strokeStyle = '#243051'; ctx.lineWidth = 1;
    ctx.strokeRect(0, CELL, W, CFG.ROWS * CELL);
    ctx.fillStyle = '#4a5a86'; ctx.fillRect(0, (CFG.ROWS / 2 + 1) * CELL - 1, W, 2);

    if (mode === 'prep' || mode === 'menu' || (mode === 'result' && !bt)) {
      // 내 보드
      if (g) {
        const me = g.me;
        me.board.forEach((row, y) => row.forEach((u, x) => {
          const sc = sel && sel.zone === 'board' && sel.x === x && sel.y === y;
          if (sc) { ctx.fillStyle = 'rgba(94,225,255,.25)'; ctx.fillRect(x * CELL, (CFG.ROWS / 2 + y + 1) * CELL, CELL, CELL); }
          if (u) drawUnit({ def: UNIT_BY_ID[u.id], star: u.star, side: 0, hp: 1, maxHp: 1, shield: 0, mana: 0, stun: 0, haste: 0 }, px(x), py(CFG.ROWS / 2 + y));
        }));
        if (sel) { ctx.fillStyle = 'rgba(94,225,255,.08)'; ctx.fillRect(0, (CFG.ROWS / 2 + 1) * CELL, W, CFG.ROWS / 2 * CELL); }
        // 정찰 표시
        if (me.scouted && g.pairs.length) {
          const { B } = g.setupsFor(myMatch());
          B.units.forEach((u) => { const gp = S.toGlobal(1, u.x, u.y); drawUnit({ def: UNIT_BY_ID[u.id], star: u.star || 1, side: 1, hp: 1, maxHp: 1, shield: 0, mana: 0, stun: 0, haste: 0 }, px(gp.gx), py(gp.gy)); });
        }
        const m = g.pairs.length ? myMatch() : null;
        const opp = m && m.kind === 'pvp' ? g.players[m.b] : null;
        drawNexus(1, opp ? { hp: opp.nexusHp, maxHp: opp.maxHp, shield: 0, maxShield: 1 } : null, m && m.kind === 'neutral' ? '(중립: 넥서스 없음)' : '');
        drawNexus(0, { hp: me.nexusHp, maxHp: me.maxHp, shield: 0, maxShield: 1 });
      }
    } else if (bt) {
      drawNexus(1, bt.nex[1], bt.nex[1] ? '' : '(중립: 넥서스 없음)');
      drawNexus(0, bt.nex[0]);
      bt.units.forEach((u) => { if (u.alive) { const p = disp(u); drawUnit(u, px(p.x), py(p.y)); } });
      // 효과
      fx.forEach((e) => {
        const a = Math.max(0, e.life / e.max);
        ctx.globalAlpha = a;
        if (e.type === 'line') { ctx.strokeStyle = e.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); }
        else if (e.type === 'ring') { ctx.strokeStyle = e.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x1, e.y1, 10 + (1 - a) * 26, 0, 7); ctx.stroke(); }
        else if (e.type === 'text') { ctx.fillStyle = e.col; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(e.text, e.x1, e.y1 - (1 - a) * 22); }
        ctx.globalAlpha = 1;
      });
    }
    ctx.restore();
  }
  const SK = { shield: '방어막', barrier: '방벽', heal: '치유', haste: '가속', stun: '기절', aoe: '폭발', blink: '점멸' };
  function consumeEvents() {
    const byId = bt.byId;
    for (const e of bt.events) {
      if (e.type === 'atk' || e.type === 'atkn') {
        const f = byId[e.from]; if (!f || !f.alive) continue;
        const a = disp(f);
        let x2, y2;
        if (e.type === 'atk') { const t = byId[e.to]; if (!t) continue; const q = disp(t); x2 = px(q.x); y2 = py(q.y); }
        else { const n = bt.nex[e.side]; x2 = W / 2; y2 = e.side === 0 ? (CFG.ROWS + 1) * CELL + CELL / 2 : CELL / 2; flash[e.side] = 0.12; if (Math.random() < 0.3) sfx.nex(); }
        fx.push({ type: 'line', x1: px(a.x), y1: py(a.y), x2, y2, col: f.side === 0 ? '#9dffd0' : '#ff9aa5', life: 0.12, max: 0.12 });
        if (Math.random() < 0.15) sfx.hit();
      } else if (e.type === 'die') {
        const u = byId[e.id]; if (u) fx.push({ type: 'ring', x1: px(u.x), y1: py(u.y), col: u.side === 0 ? '#43d68a' : '#ff5d6c', life: 0.4, max: 0.4 });
      } else if (e.type === 'skill') {
        const u = byId[e.id]; if (u) { const p = disp(u); fx.push({ type: 'text', x1: px(p.x), y1: py(p.y) - 34, text: SK[e.k] || '', col: '#ffe08a', life: 0.7, max: 0.7 }); }
      } else if (e.type === 'turret') {
        const t = byId[e.to]; if (t) fx.push({ type: 'ring', x1: px(t.x), y1: py(t.y), col: '#ffb54a', life: 0.3, max: 0.3 });
      } else if (e.type === 'nhit') { /* 위에서 처리 */ }
    }
    bt.events.length = 0;
  }

  // ---------- 메인 루프 ----------
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (g && mode === 'prep' && !modalOpen()) {
      prepLeft -= dt;
      $('#timerInfo').textContent = `준비 ${Math.max(0, Math.ceil(prepLeft))}s`;
      if (prepLeft <= 0) startBattle();
    } else if (mode === 'battle' && bt) {
      acc += dt * speed;
      while (acc >= S.TICK && !bt.over) { S.step(bt); acc -= S.TICK; }
      consumeEvents(); updateHudBattle();
      $('#timerInfo').textContent = bt.t < CFG.BATTLE_START_DELAY ? `시작 ${Math.ceil(CFG.BATTLE_START_DELAY - bt.t)}` : `전투 ${bt.t.toFixed(0)}s`;
      if (bt.t < CFG.BATTLE_START_DELAY) $('#overlay').innerHTML = `<div class="big">${Math.ceil(CFG.BATTLE_START_DELAY - bt.t)}</div>`;
      else if ($('#overlay').firstChild && !bt.over) $('#overlay').innerHTML = '';
      if (bt.over) {
        if (endTimer === 0) {
          const r = bt.result;
          const msg = r.winner === 0 ? '승리!' : r.winner === -1 ? '무승부' : '패배';
          $('#overlay').innerHTML = `<div><div class="big" style="color:${r.winner === 0 ? 'var(--good)' : r.winner === -1 ? '#fff' : 'var(--bad)'}">${r.reason === 'nexus' ? '넥서스 파괴!' : msg}</div><div class="sub">${REASON[r.reason]}</div></div>`;
          if (r.reason === 'nexus') shake = 14;
        }
        endTimer += dt * (endTimer === 99 ? 1 : 1);
        if (endTimer > 1.8 || endTimer === 99) { endBattle(); $('#overlay').innerHTML = ''; endTimer = 0; }
      }
    }
    flash = flash.map((f) => Math.max(0, f - dt));
    shake = Math.max(0, shake - dt * 30);
    fx = fx.filter((e) => (e.life -= dt) > 0);
    if (g || mode === 'menu') drawBoard();
    requestAnimationFrame(frame);
  }
  // 신규 시작
  drawBoard(); showMenu(); requestAnimationFrame(frame);
  window.__SC_DEBUG = { get g() { return g; }, get bt() { return bt; }, get mode() { return mode; }, startBattle, nextRound, skip: () => { while (bt && !bt.over) S.step(bt); } };
})();
