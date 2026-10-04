# 넥서스 오토배틀러

스타크래프트식 운영 + 오토체스 자동 전투 + 증강 선택 + 넥서스 이중 승리 조건(유닛 전멸 / 넥서스 파괴)의 웹 게임.

- **실행(가장 쉬움)**: [dist/nexus-autobattler.html](dist/nexus-autobattler.html) 파일 1개만 내려받아 더블클릭 (크롬/엣지 권장)
- **개발용 실행**: `index.html`을 브라우저로 열기 (여러 파일이 같은 폴더에 있어야 함)
- **단일 파일 재생성**: `node tools/build-single.js`
- **기획서**: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)
- **밸런스 검증**: `node tools/test-sim.js 40` (8명 전원 AI 40판 헤드리스 시뮬레이션)
- **조작**: 상점 카드 클릭=구매 / 유닛 클릭 후 칸 클릭=이동·교체 / Space 전투 시작 / D 리롤 / F 테크업 / E 판매
