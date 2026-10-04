// 문서용 표 생성 (데이터 파일이 단일 진실 공급원)
const D = require('../js/data.js');
const { UNITS, RACES, AUGMENTS, ROLE_NAMES, CFG } = D;
const sk = (u) => !u.skill ? '-' : ({shield:'방어막',barrier:'주변 방어막',heal:'치유',haste:'공속 가속',stun:'기절',aoe:'범위 피해',blink:'점멸'})[u.skill.k] + `(${u.skill.v||''}${u.skill.v?', ':''}마나${u.skill.mana})`.replace('(, ','(');
console.log('| 종족 | 유닛 | 코스트 | HP | 공격 | 공격간격(s) | 사거리 | 방어 | 이동 | 넥서스배율 | 태그 | 공중 | 공격 대상 | 스킬 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
UNITS.forEach((u) => console.log(`| ${RACES[u.race].name} | ${u.name} | ${u.cost} | ${u.hp} | ${u.atk} | ${u.as} | ${u.range} | ${u.armor} | ${u.ms} | ×${u.nx} | ${u.tags.map((t) => ROLE_NAMES[t]).join('/')} | ${u.air ? '✈' : ''} | ${u.hits === 'both' ? '지상+공중' : u.hits === 'air' ? '공중만(×' + u.aaMul + ')' : '지상만'} | ${sk(u)} |`));
console.log('\n---AUG---');
console.log('| 증강 | 등급 | 분류 | 효과 |\n|---|---|---|---|');
AUGMENTS.forEach((a) => console.log(`| ${a.name} | ${a.rarity} | ${a.cat} | ${a.desc} |`));
