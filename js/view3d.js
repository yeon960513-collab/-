/* 3D 전투 화면 (Three.js). 게임 로직은 건드리지 않고 상태를 받아 그리기만 한다.
 * 모든 모델은 코드로 만든 도형(외부 에셋 없음). 종족=체형/색, 역할=장비, 코스트=크기, ★=별 표시. */
(function (root) {
  const D = root.SC.data;
  const { CFG, RACES, UNIT_BY_ID } = D;
  const COLS = CFG.COLS, ROWS = CFG.ROWS;
  // 육각 격자(odd-r) 월드 좌표. 보드 중심이 (0,0)이 되도록 평행이동한다.
  const HEX = D.hex, CX = (COLS - 1) / 2 + 0.25, CZ = (ROWS - 1) * HEX.H / 2;
  const cellX = (col, row) => HEX.world(col, row).x - CX;
  const cellZ = (row) => HEX.world(0, row).z - CZ;
  const SKILL_NAME = { shield: '방어막', barrier: '방벽', heal: '치유', haste: '가속', stun: '기절', aoe: '폭발', blink: '점멸' };
  const SKILL_COL = { shield: 0x9fe8ff, barrier: 0x9fe8ff, heal: 0x43ff9a, haste: 0xffb54a, stun: 0xfff06a, aoe: 0xff7a4a, blink: 0xd18bff };

  function create(container) {
    const T = root.THREE;
    if (!T) return null;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.className = 'board3d';
    container.insertBefore(canvas, container.firstChild);

    const scene = new T.Scene();
    scene.background = new T.Color(0x0b0f1a);
    scene.fog = new T.Fog(0x0b0f1a, 18, 38);
    const camera = new T.PerspectiveCamera(38, 504 / 720, 0.1, 100);
    const cam = { yaw: 0, pitch: 1.02, dist: 18, tx: 0, tz: 0.1 };
    function placeCamera(shake) {
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist + (shake ? (Math.random() - .5) * shake : 0), sp * cam.dist + (shake ? (Math.random() - .5) * shake : 0), cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
      camera.lookAt(cam.tx, 0, cam.tz);
    }
    placeCamera();

    // 조명
    scene.add(new T.HemisphereLight(0xbfd4ff, 0x1a2036, 0.9));
    const sun = new T.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-6, 14, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 9, bottom: -9, near: 1, far: 40 });
    scene.add(sun);

    // ---------- 바닥 ----------
    const tiles = [];
    const HR = 0.545; // 육각형 외접 반지름 (인접 칸 간격 1.0 → 이론값 0.577, 틈을 조금 둔다)
    const tileGeo = new T.CylinderGeometry(HR, HR, 0.12, 6);
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      const mine = gy >= ROWS / 2, alt = (gx + gy) % 2;
      const c = mine ? (alt ? 0x1a2c4d : 0x203559) : (alt ? 0x4a1f2b : 0x572435);
      const m = new T.Mesh(tileGeo, new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.1, flatShading: true }));
      m.position.set(cellX(gx, gy), -0.06, cellZ(gy)); m.receiveShadow = true; m.userData.base = c;
      scene.add(m); tiles.push(m);
    }
    const frame = new T.Mesh(new T.BoxGeometry(COLS + 1.1, 0.2, (ROWS - 1) * HEX.H + 2.2), new T.MeshStandardMaterial({ color: 0x0f1627, roughness: 1 }));
    frame.position.y = -0.2; scene.add(frame);
    const mid = new T.Mesh(new T.BoxGeometry(COLS + 0.4, 0.02, 0.05), new T.MeshBasicMaterial({ color: 0x7fb4ff }));
    mid.position.set(0, 0.01, 0); scene.add(mid);
    const hexTop = new T.CylinderGeometry(HR * 1.02, HR * 1.02, 0.04, 6);
    const hoverBox = new T.Mesh(hexTop, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
    hoverBox.visible = false; scene.add(hoverBox);
    const selBox = new T.Mesh(hexTop, new T.MeshBasicMaterial({ color: 0x5ee1ff, transparent: true, opacity: 0.6 }));
    selBox.visible = false; scene.add(selBox);

    // ---------- 지형(절벽/땅굴) ----------
    const terrainGroup = new T.Group(); scene.add(terrainGroup);
    const portalMeshes = [];
    let curTerrain = '__none__';
    function setTerrain(id) {
      if (id === curTerrain) return;
      curTerrain = id;
      while (terrainGroup.children.length) { const o = terrainGroup.children.pop(); o.traverse && o.traverse((m) => { if (m.material && m.material.dispose) m.material.dispose(); }); }
      portalMeshes.length = 0;
      const def = id && D.TERRAIN_BY_ID[id]; if (!def) return;
      def.cells.forEach(([gx, gy], i) => {
        const h = 0.55 + ((gx * 7 + gy * 13) % 5) * 0.12;
        const rock = new T.Mesh(new T.CylinderGeometry(HR * 0.9, HR * 1.0, h, 6), new T.MeshStandardMaterial({ color: 0x4a4f63, roughness: 1, flatShading: true }));
        rock.position.set(cellX(gx, gy), h / 2, cellZ(gy)); rock.castShadow = true; rock.receiveShadow = true; terrainGroup.add(rock);
        const peak = new T.Mesh(new T.ConeGeometry(HR * 0.6, 0.45, 5), new T.MeshStandardMaterial({ color: 0x6d7390, roughness: 1, flatShading: true }));
        peak.position.set(cellX(gx, gy) + ((gx % 2) - 0.5) * 0.12, h + 0.2, cellZ(gy)); peak.castShadow = true; terrainGroup.add(peak);
      });
      (def.portals || []).forEach((p) => {
        [[p.in, 0xb06bff], [p.out, 0x4ae8ff]].forEach(([c, col]) => {
          const g = new T.Group(); g.position.set(cellX(c[0], c[1]), 0.06, cellZ(c[1]));
          const ring = new T.Mesh(new T.TorusGeometry(0.36, 0.05, 8, 24), new T.MeshBasicMaterial({ color: col })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
          const disc = new T.Mesh(new T.CircleGeometry(0.34, 20), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, side: T.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; g.add(disc);
          terrainGroup.add(g); portalMeshes.push({ ring, disc });
        });
      });
    }

    // ---------- 공용 헬퍼 ----------
    const labelCache = {};
    function textTexture(text, color, w, h, size) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c = cv.getContext('2d');
      c.font = `bold ${size}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(text, w / 2, h / 2);
      c.fillStyle = color; c.fillText(text, w / 2, h / 2);
      const t = new T.CanvasTexture(cv); t.minFilter = T.LinearFilter; return t;
    }
    function spriteFrom(tex, sx, sy) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      s.scale.set(sx, sy, 1); s.renderOrder = 10; return s;
    }
    function nameLabel(def, star) {
      const k = def.id + star;
      if (!labelCache[k]) labelCache[k] = textTexture(def.name + ' ' + '★'.repeat(star), star > 1 ? '#ffd24a' : '#ffffff', 256, 48, 30);
      return labelCache[k];
    }

    // ---------- 유닛 모델 ----------
    function makeModel(def, star, reg) {
      const g = new T.Group();
      const race = def.race;
      const acc = new T.Color(RACES[race].color);
      const add = (geo, color, x, y, z, o) => {
        o = o || {};
        const m = new T.MeshStandardMaterial({ color, roughness: o.rough == null ? 0.55 : o.rough, metalness: o.metal == null ? 0.25 : o.metal, flatShading: true,
          emissive: o.em || 0x000000, emissiveIntensity: o.emi == null ? 1 : o.emi, transparent: !!o.op, opacity: o.op || 1 });
        reg(m, o.em || 0x000000);
        const mesh = new T.Mesh(geo, m); mesh.position.set(x, y, z);
        if (o.rot) mesh.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
        if (o.sc) mesh.scale.set(o.sc[0], o.sc[1], o.sc[2]);
        mesh.castShadow = !o.op; g.add(mesh); return mesh;
      };
      const box = (w, h, d) => new T.BoxGeometry(w, h, d);
      const cone = (r, h, n) => new T.ConeGeometry(r, h, n || 6);
      const cyl = (r1, r2, h, n) => new T.CylinderGeometry(r1, r2, h, n || 8);
      const sph = (r) => new T.SphereGeometry(r, 10, 8);
      const tags = def.tags, has = (t) => tags.includes(t), id = def.id;
      // 전방은 -z
      if (race === 'union') {
        const steel = 0x4d6f99, dark = 0x2b3d57, light = 0x9ab9dc;
        if (id === 'tank') {
          add(box(0.2, 0.2, 0.9), dark, -0.3, 0.12, 0); add(box(0.2, 0.2, 0.9), dark, 0.3, 0.12, 0);
          add(box(0.7, 0.25, 0.8), steel, 0, 0.3, 0); add(cyl(0.28, 0.32, 0.2, 8), light, 0, 0.5, 0.05);
          add(box(0.12, 0.12, 0.95), dark, 0, 0.55, -0.55, { em: 0x4aa3ff, emi: 0.3 });
        } else if (id === 'gunship') {
          add(box(0.5, 0.2, 0.9), steel, 0, 0.45, 0); add(cone(0.22, 0.5, 4), light, 0, 0.45, -0.65, { rot: [-Math.PI / 2, 0, Math.PI / 4] });
          add(box(1.1, 0.04, 0.12), dark, 0, 0.62, 0.05); add(cyl(0.05, 0.05, 0.18, 6), dark, 0, 0.55, 0.05);
          [-1, 1].forEach((s2) => add(box(0.08, 0.08, 0.5), dark, s2 * 0.3, 0.35, -0.3, { em: 0x4aa3ff, emi: 0.6 }));
          add(box(0.3, 0.1, 0.5), 0x4aa3ff, 0, 0.3, 0.1, { em: 0x4aa3ff, emi: 0.7 });
        } else if (id === 'aagun') {
          add(box(0.7, 0.2, 0.6), dark, 0, 0.12, 0); add(box(0.4, 0.3, 0.4), steel, 0, 0.35, 0);
          [-1, 1].forEach((s2) => add(cyl(0.05, 0.07, 0.8, 6), light, s2 * 0.16, 0.8, -0.1, { rot: [-0.5, 0, 0], em: 0xff7a4a, emi: 0.4 }));
        } else if (id === 'warship') {
          add(box(1.0, 0.3, 0.8), steel, 0, 0.55, 0); add(cone(0.35, 0.8, 4), light, 0, 0.55, -0.7, { rot: [-Math.PI / 2, 0, Math.PI / 4] });
          add(box(0.5, 0.25, 0.4), dark, 0, 0.85, 0.1); add(box(0.1, 0.1, 0.7), dark, -0.3, 0.9, -0.4); add(box(0.1, 0.1, 0.7), dark, 0.3, 0.9, -0.4);
          add(box(0.9, 0.06, 0.2), 0x4aa3ff, 0, 0.35, 0.15, { em: 0x4aa3ff, emi: 0.8 });
        } else {
          add(box(0.16, 0.3, 0.16), dark, -0.12, 0.15, 0); add(box(0.16, 0.3, 0.16), dark, 0.12, 0.15, 0);
          add(box(0.46, 0.46, 0.32), has('infil') ? 0x22304a : steel, 0, 0.52, 0);
          add(box(0.3, 0.12, 0.34), 0x4aa3ff, 0, 0.58, -0.02, { em: 0x4aa3ff, emi: 0.5 });
          add(box(0.26, 0.24, 0.26), light, 0, 0.9, 0);
          add(box(0.22, 0.07, 0.04), has('infil') ? 0xff4a6a : 0x7fe3ff, 0, 0.92, -0.14, { em: has('infil') ? 0xff4a6a : 0x7fe3ff, emi: 1.2 });
          if (has('range') && id !== 'medic') add(box(0.09, 0.09, 0.6), dark, 0.3, 0.55, -0.3);
          if (id === 'medic') { add(box(0.3, 0.08, 0.04), 0x43ff9a, 0, 0.55, -0.17, { em: 0x43ff9a, emi: 1 }); add(box(0.08, 0.3, 0.04), 0x43ff9a, 0, 0.55, -0.17, { em: 0x43ff9a, emi: 1 }); }
          if (has('guard')) add(box(0.62, 0.66, 0.07), 0x7da0c8, 0, 0.55, -0.32, { em: 0x4aa3ff, emi: 0.25 });
          if (has('infil')) add(cone(0.3, 0.7, 5), 0x1a2236, 0, 0.5, 0.2, { rot: [0.35, 0, 0] });
        }
      } else if (race === 'swarm') {
        const hide = 0x6a2fa0, shell = 0x3d1a63, glow = 0xb8ff4a;
        if (id === 'mutalisk' || id === 'devourer') {
          const big = id === 'devourer' ? 1.5 : 1;
          add(sph(0.26 * big), hide, 0, 0.4, 0, { sc: [1, 0.8, 1.5] });
          [-1, 1].forEach((s2) => { add(box(0.9 * big, 0.04, 0.45 * big), 0xc79bff, s2 * 0.55 * big, 0.5, 0.05, { rot: [0, 0, s2 * 0.3], op: 0.85 }); add(cone(0.08 * big, 0.3, 5), 0xe0c6ff, s2 * 0.12, 0.4, -0.45 * big, { rot: [-Math.PI / 2, 0, 0] }); });
          add(cone(0.1 * big, 0.5, 5), shell, 0, 0.38, 0.55 * big, { rot: [Math.PI / 2, 0, 0] });
          [-1, 1].forEach((s2) => add(sph(0.045), glow, s2 * 0.1, 0.48, -0.32 * big, { em: glow, emi: 1.4 }));
          if (id === 'devourer') add(sph(0.2), glow, 0, 0.7, 0.1, { em: glow, emi: 0.9, op: 0.85 });
        } else if (id === 'spore') {
          add(cyl(0.12, 0.2, 0.3, 6), shell, 0, 0.15, 0); add(sph(0.28), hide, 0, 0.5, 0, { sc: [1, 1.1, 1] });
          for (let i = 0; i < 5; i++) add(cone(0.05, 0.4, 5), glow, Math.cos(i * 1.26) * 0.15, 0.85, Math.sin(i * 1.26) * 0.15, { em: glow, emi: 1.1, rot: [Math.sin(i * 1.26) * 0.25, 0, -Math.cos(i * 1.26) * 0.25] });
        } else if (id === 'burrower') {
          add(sph(0.3), hide, 0, 0.28, 0.25, { sc: [1, 0.8, 1.3] }); add(sph(0.26), hide, 0, 0.26, -0.05, { sc: [1, 0.8, 1.1] });
          add(cone(0.22, 0.7, 6), 0xcdb3e8, 0, 0.3, -0.5, { rot: [-Math.PI / 2, 0, 0] });
        } else {
          add(sph(0.32), has('guard') ? shell : hide, 0, 0.42, 0, { sc: [1, 0.85, 1.35] });
          [-1, 1].forEach((s) => { add(cyl(0.04, 0.03, 0.4, 5), shell, s * 0.28, 0.2, -0.15, { rot: [0, 0, s * 0.5] }); add(cyl(0.04, 0.03, 0.4, 5), shell, s * 0.28, 0.2, 0.2, { rot: [0, 0, s * 0.5] }); });
          for (let i = 0; i < 4; i++) add(cone(0.07, 0.3, 5), 0xe0c6ff, 0, 0.74 - i * 0.02, 0.3 - i * 0.22, { rot: [0.2, 0, 0] });
          [-1, 1].forEach((s) => add(sph(0.05), glow, s * 0.12, 0.55, -0.38, { em: glow, emi: 1.4 }));
          if (has('melee') && id !== 'crusher') [-1, 1].forEach((s) => add(cone(0.06, 0.4, 5), 0xe0c6ff, s * 0.22, 0.4, -0.55, { rot: [-Math.PI / 2, 0, 0] }));
          if (id === 'spitter') add(sph(0.18), glow, 0, 0.78, 0.15, { em: glow, emi: 0.9, op: 0.9 });
          if (id === 'crusher') add(new T.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x57308a, 0, 0.45, 0.05, { sc: [1, 0.8, 1.3] });
          if (id === 'queen') { [-1, 1].forEach((s) => add(box(0.8, 0.04, 0.5), 0xc79bff, s * 0.5, 0.85, 0.1, { rot: [0, 0, s * 0.35], op: 0.75 })); add(cone(0.1, 0.3, 5), 0xffd24a, 0, 1.0, -0.25, { em: 0xffd24a, emi: 0.7 }); }
          if (id === 'colossus') for (let i = 0; i < 5; i++) add(cone(0.12, 0.6, 5), 0xe0c6ff, (i - 2) * 0.2, 0.95, -0.1 + (i % 2) * 0.15, { rot: [0.1, 0, (i - 2) * 0.12] });
        }
      } else {
        const gold = 0xc9a227, pale = 0xf6e7a8, crystal = 0x7fe3ff;
        if (id === 'phoenix') {
          add(cone(0.16, 0.9, 5), gold, 0, 0.45, 0, { rot: [-Math.PI / 2, 0, 0], metal: 0.6 });
          [-1, 1].forEach((s2) => add(box(0.7, 0.03, 0.4), pale, s2 * 0.4, 0.45, 0.1, { rot: [0, s2 * -0.5, s2 * 0.15], em: crystal, emi: 0.5 }));
          add(sph(0.1), crystal, 0, 0.5, -0.25, { em: crystal, emi: 1.4 });
        } else if (id === 'carrier') {
          add(cyl(0.7, 0.55, 0.22, 8), gold, 0, 0.5, 0, { metal: 0.6, rough: 0.35 }); add(sph(0.3), crystal, 0, 0.62, 0, { em: crystal, emi: 1.0, op: 0.9 });
          for (let i = 0; i < 4; i++) add(box(0.22, 0.1, 0.34), pale, Math.cos(i * 1.57 + 0.78) * 0.55, 0.42, Math.sin(i * 1.57 + 0.78) * 0.55);
          add(new T.TorusGeometry(0.72, 0.03, 6, 24), crystal, 0, 0.5, 0, { rot: [Math.PI / 2, 0, 0], em: crystal, emi: 1.2 });
        } else if (id === 'skyguard') {
          add(cone(0.28, 0.7, 6), gold, 0, 0.35, 0, { metal: 0.6 }); add(cyl(0.03, 0.03, 1.2, 6), pale, 0.1, 0.9, -0.05, { rot: [-0.3, 0, 0] });
          add(new T.OctahedronGeometry(0.16), crystal, 0, 0.85, 0, { em: crystal, emi: 1.1 }); add(sph(0.08), 0xff7a4a, 0.12, 1.45, -0.3, { em: 0xff7a4a, emi: 1.4 });
        } else {
        const robe = id === 'stalker' ? cone(0.24, 0.9, 6) : cone(0.34, 0.8, 6);
        add(robe, gold, 0, 0.4, 0, { metal: 0.6, rough: 0.35 });
        add(new T.OctahedronGeometry(0.17), crystal, 0, 0.98, 0, { em: crystal, emi: 1.1 });
        add(new T.TorusGeometry(0.22, 0.02, 6, 16), 0xffffff, 0, 1.2, 0, { rot: [Math.PI / 2, 0, 0], em: 0xffffff, emi: 1 });
        [-1, 1].forEach((s) => add(box(0.14, 0.1, 0.22), pale, s * 0.26, 0.7, 0));
        if (id === 'zealot') [-1, 1].forEach((s) => add(box(0.05, 0.05, 0.6), crystal, s * 0.3, 0.55, -0.35, { em: crystal, emi: 1.4 }));
        if (id === 'guardian') add(box(0.6, 0.7, 0.08), crystal, 0, 0.5, -0.32, { em: crystal, emi: 0.7, op: 0.85 });
        if (id === 'stalker') add(box(0.06, 0.06, 0.7), pale, 0.22, 0.6, -0.32, { em: crystal, emi: 0.5 });
        if (id === 'templar') { add(cyl(0.02, 0.02, 1.0, 5), pale, 0.32, 0.5, 0); add(sph(0.1), 0xd18bff, 0.32, 1.02, 0, { em: 0xd18bff, emi: 1.4 }); }
        if (id === 'immortal') add(sph(0.62), crystal, 0, 0.6, 0, { op: 0.22, em: crystal, emi: 0.4 });
        if (id === 'archon') { add(sph(0.38), 0xffffff, 0, 0.65, 0, { em: 0x9fe8ff, emi: 1.3, op: 0.9 }); add(new T.TorusGeometry(0.5, 0.04, 6, 20), crystal, 0, 0.65, 0, { rot: [Math.PI / 2, 0, 0], em: crystal, emi: 1.2 }); }
        }
      }
      const scale = (0.82 + def.cost * 0.1) * (1 + 0.1 * (star - 1));
      g.scale.setScalar(scale);
      return g;
    }

    const units = {};   // key -> record
    const fxs = [];     // 이펙트
    let dmgTexts = 0;
    const barGeo = new T.PlaneGeometry(1, 1);
    const ringGeo = new T.RingGeometry(0.34, 0.42, 24);

    function makeUnit(d) {
      const root3 = new T.Group();
      const mats = [];
      const model = makeModel(d.def, d.star, (m, em) => mats.push({ m, em: new T.Color(em), ei: m.emissiveIntensity }));
      model.rotation.y = d.side === 0 ? 0 : Math.PI;
      const lift = d.def.air ? 1.15 : 0;
      model.position.y = lift;
      root3.add(model);
      if (d.def.air) { const sh = new T.Mesh(new T.CircleGeometry(0.36, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.035; root3.add(sh); }
      // 팀 링
      const ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: d.side === 0 ? 0x43d68a : 0xff5d6c, side: T.DoubleSide, transparent: true, opacity: 0.9 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; root3.add(ring);
      // UI (빌보드)
      const ui = new T.Group(); ui.position.y = 1.55 + d.def.cost * 0.05 + lift; root3.add(ui);
      const bw = 0.9;
      const bg = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: 0x05070d, depthTest: false, transparent: true, opacity: 0.85 })); bg.scale.set(bw + 0.06, 0.14, 1); bg.renderOrder = 11; ui.add(bg);
      const hp = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: d.side === 0 ? 0x43d68a : 0xff5d6c, depthTest: false })); hp.scale.set(bw, 0.1, 1); hp.position.z = 0.001; hp.renderOrder = 12; ui.add(hp);
      const sh = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: 0xe6f6ff, depthTest: false })); sh.scale.set(bw, 0.04, 1); sh.position.set(0, 0.09, 0.002); sh.renderOrder = 12; ui.add(sh);
      let mn = null;
      if (d.def.skill) { mn = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: 0x4aa3ff, depthTest: false })); mn.scale.set(bw, 0.045, 1); mn.position.set(0, -0.1, 0.002); mn.renderOrder = 12; ui.add(mn); }
      const lab = spriteFrom(nameLabel(d.def, d.star), 1.25, 0.24); lab.position.y = 0.3; ui.add(lab);
      const stun = spriteFrom(textTexture('💫', '#fff06a', 64, 64, 40), 0.4, 0.4); stun.position.y = 0.62; stun.visible = false; ui.add(stun);
      scene.add(root3);
      const rec = { lift, root: root3, model, mats, ui, hp, sh, mn, lab, stun, bw, d, flash: 0, lunge: 0, lx: 0, lz: 0, t0: Math.random() * 6, dying: 0, key: d.key, star: d.star };
      units[d.key] = rec; return rec;
    }
    function disposeUnit(rec) {
      scene.remove(rec.root);
      rec.root.traverse((o) => { if (o.material && !o.material.map) o.material.dispose && o.material.dispose(); });
    }

    // ---------- 넥서스 ----------
    function makeNexus(side) {
      const g = new T.Group();
      const col = side === 0 ? 0x3aa0ff : 0xff4a62;
      const base = new T.Mesh(new T.CylinderGeometry(1.0, 1.25, 0.25, 6), new T.MeshStandardMaterial({ color: 0x1a2236, roughness: 0.7, flatShading: true }));
      base.position.y = 0.1; base.receiveShadow = true; g.add(base);
      const crystalMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3, flatShading: true });
      const crystal = new T.Mesh(new T.OctahedronGeometry(0.62), crystalMat); crystal.scale.y = 1.6; crystal.position.y = 1.1; crystal.castShadow = true; g.add(crystal);
      [-1, 1].forEach((s) => { const p = new T.Mesh(new T.OctahedronGeometry(0.2), crystalMat); p.position.set(s * 0.95, 0.65, 0); p.scale.y = 1.5; g.add(p); });
      const dome = new T.Mesh(new T.SphereGeometry(1.35, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.15, side: T.DoubleSide, depthWrite: false }));
      dome.position.y = 0.2; g.add(dome);
      const ui = new T.Group(); ui.position.y = 2.7; g.add(ui);
      const bw = 2.2;
      const bg = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: 0x05070d, depthTest: false, transparent: true, opacity: 0.9 })); bg.scale.set(bw + 0.08, 0.26, 1); bg.renderOrder = 11; ui.add(bg);
      const hp = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: 0x43d68a, depthTest: false })); hp.scale.set(bw, 0.2, 1); hp.position.z = 0.001; hp.renderOrder = 12; ui.add(hp);
      const sh = new T.Mesh(barGeo, new T.MeshBasicMaterial({ color: 0x7fd4ff, depthTest: false })); sh.scale.set(bw, 0.07, 1); sh.position.set(0, 0.17, 0.002); sh.renderOrder = 12; ui.add(sh);
      const lab = { sprite: null, text: '' };
      g.scale.setScalar(0.72);
      g.position.set(0, 0, side === 0 ? cellZ(ROWS) + 0.45 : cellZ(-1) - 0.45);
      scene.add(g);
      return { g, crystal, crystalMat, dome, ui, hp, sh, bw, lab, flash: 0, side, col };
    }
    const nex = [makeNexus(0), makeNexus(1)];
    function setNexusLabel(n, text) {
      if (n.lab.text === text) return;
      n.lab.text = text;
      if (n.lab.sprite) { n.ui.remove(n.lab.sprite); n.lab.sprite.material.map.dispose(); n.lab.sprite.material.dispose(); }
      n.lab.sprite = spriteFrom(textTexture(text, '#e8fff4', 512, 64, 38), 3.2, 0.4); n.lab.sprite.position.y = 0.42; n.ui.add(n.lab.sprite);
    }

    // ---------- 이펙트 ----------
    function addFx(o) { scene.add(o.mesh); fxs.push(o); return o; }
    function spawnRing(x, z, color, size) {
      const m = new T.Mesh(new T.RingGeometry(0.2, 0.28, 28), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.08, z);
      addFx({ mesh: m, life: 0.5, max: 0.5, upd(f) { const s = 1 + f * (size || 3); m.scale.set(s, s, s); m.material.opacity = 1 - f; } });
    }
    function spawnText(x, y, z, text, color, size, life) {
      if (dmgTexts > 36) return;
      dmgTexts++;
      const s = spriteFrom(textTexture(text, color, 192, 64, 44), size || 0.9, (size || 0.9) / 3);
      s.position.set(x, y, z);
      addFx({ mesh: s, life: life || 0.8, max: life || 0.8, upd(f) { s.position.y = y + f * 0.7; s.material.opacity = f > 0.6 ? 1 - (f - 0.6) / 0.4 : 1; },
        done() { dmgTexts--; s.material.map.dispose(); s.material.dispose(); } });
    }
    function spawnBeam(a, b, color, w) {
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
      const m = new T.Mesh(new T.CylinderGeometry(w, w, len, 5), new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx, dy, dz).normalize());
      addFx({ mesh: m, life: 0.14, max: 0.14, upd(f) { m.material.opacity = 1 - f; } });
    }
    const WHITE = new T.Color(0xffffff);

    function onEvents(bt, evs) {
      for (const e of evs) {
        if (e.type === 'atk' || e.type === 'atkn') {
          const f = units['u' + e.from]; if (!f) continue;
          const isRanged = f.d.def.range > 1.5;
          let tx, tz, ty = 0.7, col = f.d.side === 0 ? 0xbfffd8 : 0xffb0b8;
          if (e.type === 'atk') {
            const t = units['u' + e.to]; if (!t) continue;
            tx = t.root.position.x; tz = t.root.position.z; t.flash = 0.14;
            spawnText(tx, 1.9, tz, String(e.d), '#ffffff', 0.7, 0.7);
          } else {
            const n = nex[e.side]; tx = n.g.position.x; tz = n.g.position.z; ty = 1.0; n.flash = 0.12;
            spawnText(tx + (Math.random() - .5) * 0.8, 3.2, tz, String(e.d), '#ffd24a', 0.9, 0.8);
          }
          const dx = tx - f.root.position.x, dz = tz - f.root.position.z, dl = Math.hypot(dx, dz) || 1;
          f.lunge = 0.16; f.lx = dx / dl; f.lz = dz / dl;
          f.model.rotation.y = Math.atan2(-dx, -dz); // 모델 전방(-z)을 대상 쪽으로
          if (isRanged) { const tu = e.type === 'atk' ? units['u' + e.to] : null; spawnBeam({ x: f.root.position.x, y: f.lift ? 1.9 : 0.85, z: f.root.position.z }, { x: tx, y: tu && tu.lift ? 1.7 : ty, z: tz }, col, 0.035); }
        } else if (e.type === 'die') {
          const u = units['u' + e.id]; if (u) { u.dying = 0.5; spawnRing(u.root.position.x, u.root.position.z, u.d.side === 0 ? 0x43d68a : 0xff5d6c, 2); }
        } else if (e.type === 'skill') {
          const u = units['u' + e.id]; if (!u) continue;
          const c = SKILL_COL[e.k] || 0xffffff;
          spawnRing(u.root.position.x, u.root.position.z, c, e.k === 'aoe' || e.k === 'barrier' || e.k === 'haste' ? 5 : 3);
          spawnText(u.root.position.x, 2.3, u.root.position.z, SKILL_NAME[e.k] || '', '#' + c.toString(16).padStart(6, '0'), 1.1, 0.9);
        } else if (e.type === 'tp') {
          const u = bt.byId[e.id];
          spawnRing(cellX(e.x, e.y), cellZ(e.y), 0xb06bff, 2.5);
          if (u) spawnRing(cellX(u.x, u.y), cellZ(u.y), 0x4ae8ff, 2.5);
        } else if (e.type === 'turret') {
          const t = units['u' + e.to]; if (t) { const n = nex[e.side]; spawnBeam({ x: n.g.position.x, y: 1.5, z: n.g.position.z }, { x: t.root.position.x, y: 0.7, z: t.root.position.z }, 0xffb54a, 0.06); t.flash = 0.2; }
        }
      }
    }

    // ---------- 갱신 ----------
    let time = 0, shakeAmt = 0;
    function update(st, dt) {
      time += dt;
      // 유닛 동기화
      const seen = {};
      st.units.forEach((d) => {
        seen[d.key] = true;
        let rec = units[d.key];
        if (!rec || rec.star !== d.star) { if (rec) { disposeUnit(rec); delete units[d.key]; } rec = makeUnit(d); }
        rec.d = d;
        const bob = Math.sin(time * 3 + rec.t0) * (rec.lift ? 0.08 : 0.03);
        let ox = 0, oz = 0;
        if (rec.lunge > 0) { const k = Math.sin((1 - rec.lunge / 0.16) * Math.PI) * 0.28; ox = rec.lx * k; oz = rec.lz * k; rec.lunge -= dt; }
        rec.root.position.set(d.hx - CX + ox, bob, d.hz - CZ + oz);
        if (st.mode === 'prep' && rec.model.rotation.y !== (d.side === 0 ? 0 : Math.PI)) rec.model.rotation.y = d.side === 0 ? 0 : Math.PI;
        const r = Math.max(0, d.hp / d.maxHp), bw = rec.bw;
        rec.hp.scale.x = Math.max(0.001, bw * r); rec.hp.position.x = -(bw - bw * r) / 2;
        const sr = Math.min(1, (d.shield || 0) / d.maxHp);
        rec.sh.visible = sr > 0; rec.sh.scale.x = Math.max(0.001, bw * sr); rec.sh.position.x = -(bw - bw * sr) / 2;
        if (rec.mn) { const mr = Math.min(1, d.mana / d.def.skill.mana); rec.mn.scale.x = Math.max(0.001, bw * mr); rec.mn.position.x = -(bw - bw * mr) / 2; }
        rec.stun.visible = d.stun > 0;
        rec.ui.quaternion.copy(camera.quaternion);
        // 피격 번쩍임
        const fl = rec.flash > 0 ? 1 : 0; if (rec.flash > 0) rec.flash -= dt;
        rec.mats.forEach((o) => { o.m.emissive.copy(fl ? WHITE : o.em); o.m.emissiveIntensity = fl ? 0.9 : o.ei; });
        rec.root.scale.setScalar(d.haste > 0 ? 1.06 : 1);
        rec.root.visible = true;
      });
      for (const k of Object.keys(units)) {
        const rec = units[k];
        if (seen[k]) continue;
        if (rec.dying > 0) {
          rec.dying -= dt; const s = Math.max(0.01, rec.dying / 0.5);
          rec.root.scale.setScalar(s); rec.root.position.y += dt * 0.6; rec.ui.visible = false;
          if (rec.dying <= 0) { disposeUnit(rec); delete units[k]; }
        } else { disposeUnit(rec); delete units[k]; }
      }
      // 넥서스
      st.nexus.forEach((info, side) => {
        const n = nex[side];
        n.g.visible = true;
        n.crystal.rotation.y += dt * 0.8; n.crystal.position.y = 1.1 + Math.sin(time * 2 + side) * 0.06;
        if (n.flash > 0) { n.flash -= dt; n.crystalMat.emissive.setHex(0xffffff); n.crystalMat.emissiveIntensity = 1.6; }
        else { n.crystalMat.emissive.setHex(n.col); n.crystalMat.emissiveIntensity = 0.9 + Math.sin(time * 3) * 0.1; }
        n.ui.quaternion.copy(camera.quaternion);
        if (!info) { n.hp.parent.visible = true; n.hp.scale.x = 0.001; n.sh.visible = false; n.dome.visible = false; setNexusLabel(n, st.neutralLabel || '중립 군단 (넥서스 없음)'); return; }
        const r = Math.max(0, info.hp / info.maxHp);
        n.hp.scale.x = Math.max(0.001, n.bw * r); n.hp.position.x = -(n.bw - n.bw * r) / 2;
        n.hp.material.color.setHex(r < 0.3 ? 0xff5d6c : 0x43d68a);
        const sr = info.maxShield ? Math.min(1, info.shield / info.maxShield) : 0;
        n.sh.visible = sr > 0; n.sh.scale.x = Math.max(0.001, n.bw * sr); n.sh.position.x = -(n.bw - n.bw * sr) / 2;
        n.dome.visible = true; n.dome.material.opacity = info.grace ? 0.32 : 0.05 + sr * 0.2;
        n.dome.material.color.setHex(info.grace ? 0xffe27a : 0x7fd4ff);
        setNexusLabel(n, `${side === 0 ? '내' : '적'} 넥서스 ${Math.max(0, Math.round(info.hp))}${info.shield > 0 ? ' +' + Math.round(info.shield) : ''}${info.grace ? ' 🛡무적' : ''}`);
      });
      // 선택/호버
      if (st.sel) { selBox.visible = true; selBox.position.set(cellX(st.sel.gx, st.sel.gy), 0.02, cellZ(st.sel.gy)); } else selBox.visible = false;
      if (st.hover && st.hover.gx >= 0 && st.hover.gx < COLS && st.hover.gy >= 0 && st.hover.gy < ROWS) { hoverBox.visible = true; hoverBox.position.set(cellX(st.hover.gx, st.hover.gy), 0.02, cellZ(st.hover.gy)); } else hoverBox.visible = false;
      setTerrain(st.terrain || null);
      portalMeshes.forEach((p, i) => { p.ring.rotation.z += dt * (i % 2 ? -1.6 : 1.6); p.disc.material.opacity = 0.3 + Math.sin(time * 3 + i) * 0.1; });
      // 이펙트
      for (let i = fxs.length - 1; i >= 0; i--) {
        const o = fxs[i]; o.life -= dt;
        const f = Math.min(1, 1 - o.life / o.max); o.upd(f);
        if (o.life <= 0) { scene.remove(o.mesh); if (o.mesh.geometry) o.mesh.geometry.dispose(); if (o.mesh.material && !o.done) { o.mesh.material.dispose(); } if (o.done) o.done(); fxs.splice(i, 1); }
      }
      if (st.shake) shakeAmt = Math.max(shakeAmt, st.shake);
      shakeAmt = Math.max(0, shakeAmt - dt * 1.5);
      placeCamera(shakeAmt * 0.25);
      renderer.render(scene, camera);
    }

    // ---------- 입력 ----------
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), pt = new T.Vector3(), ndc = new T.Vector2();
    function pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, pt)) return null;
      let best = null, bd = 1e9;
      for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
        const d = Math.hypot(pt.x - cellX(gx, gy), pt.z - cellZ(gy));
        if (d < bd) { bd = d; best = { gx, gy }; }
      }
      return bd <= 0.62 ? best : null;
    }
    // 드래그로 시점 회전, 휠로 확대/축소, 더블클릭으로 초기화
    let drag = null, moved = false;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; moved = false; });
    window.addEventListener('pointerup', () => { drag = null; });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { cam.yaw = Math.max(-0.9, Math.min(0.9, drag.yaw - dx * 0.006)); cam.pitch = Math.max(0.5, Math.min(1.3, drag.pitch + dy * 0.005)); }
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(11, Math.min(26, cam.dist + e.deltaY * 0.01)); }, { passive: false });
    canvas.addEventListener('dblclick', () => { cam.yaw = 0; cam.pitch = 1.02; cam.dist = 18; });

    function resize() {
      const w = container.clientWidth || 504, h = container.clientHeight || 720;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize); resize();

    return { canvas, update, onEvents, pick, resize, wasDrag: () => moved, setVisible(v) { canvas.style.display = v ? 'block' : 'none'; }, shake(v) { shakeAmt = Math.max(shakeAmt, v); } };
  }

  root.SC.view3d = { create };
})(window);
