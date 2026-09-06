/* ============================================================
   Shadow Lab - 빛과 그림자 퍼즐 게임 (v2)

   핵심 규칙:
   - 물체(상자/공)는 밀어서 원하는 자리에 "고정"시켜 놓는다.
   - 조명은 위치가 고정되어 있고, 그 자리에서 "방향"만 회전할 수 있다.
     -> 조명 아이콘을 마우스로 클릭한 채 드래그해야만 회전한다.
        (그냥 마우스를 화면 위에 올려두는 것만으로는 아무 변화 없음)
   - 퍼즐 순서: 먼저 물체를 배치하고, 그다음 조명 각도로 그림자를 완성한다.
   ============================================================ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const DEG = Math.PI / 180;

// ---------------------------------------------------------
// 기하 연산 유틸
// ---------------------------------------------------------
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function projectFar(light, p, dist) {
  const dx = p.x - light.x;
  const dy = p.y - light.y;
  const len = Math.hypot(dx, dy) || 0.0001;
  return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
}

function getObstaclePoints(obs) {
  if (obs.type === 'circle') {
    const pts = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({ x: obs.x + Math.cos(a) * obs.r, y: obs.y + Math.sin(a) * obs.r });
    }
    return pts;
  }
  return [
    { x: obs.x, y: obs.y },
    { x: obs.x + obs.w, y: obs.y },
    { x: obs.x + obs.w, y: obs.y + obs.h },
    { x: obs.x, y: obs.y + obs.h },
  ];
}

function shadowPolygonFor(light, obs) {
  const pts = getObstaclePoints(obs);
  const far = pts.map((p) => projectFar(light, p, 3000));
  return convexHull(pts.concat(far));
}

function obstacleCenter(obs) {
  if (obs.type === 'circle') return { x: obs.x, y: obs.y };
  return { x: obs.x + obs.w / 2, y: obs.y + obs.h / 2 };
}

function polygonBBox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function getBBoxOf(obj) {
  if (obj.type === 'circle') return { x: obj.x - obj.r, y: obj.y - obj.r, w: obj.r * 2, h: obj.r * 2 };
  return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// ---------------------------------------------------------
// 스테이지 정의
// 각 lamp: pivot(고정 위치), angle(초기 각도, deg), minAngle/maxAngle(회전 제한, deg),
//          halfAngle(빛이 퍼지는 반각, deg), locked(회전 불가 여부)
// ---------------------------------------------------------
const STAGES = [
  {
    name: 'Stage 1 · 조명 회전 배우기',
    goal: '조명을 클릭한 채 드래그해서 방향을 돌리세요. 고정된 상자의 그림자로 빨간 센서를 가리면 문이 열립니다. 물체는 움직일 필요가 없습니다.',
    player: { x: 60, y: 420, w: 28, h: 28 },
    movables: [],
    statics: [{ type: 'rect', x: 360, y: 250, w: 70, h: 70 }],
    sensors: [{ x: 630, y: 420, r: 22 }],
    lamps: [{ id: 'L1', pivot: { x: 120, y: 40 }, angle: 120, minAngle: 20, maxAngle: 150, halfAngle: 30 }],
    target: null,
  },
  {
    name: 'Stage 2 · 상자 밀어서 배치하기',
    goal: '조명은 고정되어 바로 아래로만 비춥니다. WASD로 상자를 밀어 그림자가 센서 위에 오도록 정확한 자리에 배치하세요.',
    player: { x: 60, y: 230, w: 28, h: 28 },
    movables: [{ type: 'rect', x: 260, y: 230, w: 60, h: 60, id: 'box' }],
    statics: [],
    sensors: [{ x: 620, y: 430, r: 22 }],
    lamps: [{ id: 'L1', pivot: { x: 420, y: 40 }, angle: 90, minAngle: 90, maxAngle: 90, halfAngle: 34, locked: true }],
    target: null,
  },
  {
    name: 'Stage 3 · 밀기 + 회전 조합',
    goal: '이번엔 상자를 밀어서 위치를 잡은 뒤, 조명 각도까지 조절해야 그림자가 센서에 닿습니다.',
    player: { x: 60, y: 420, w: 28, h: 28 },
    movables: [{ type: 'rect', x: 300, y: 320, w: 65, h: 65, id: 'box' }],
    statics: [],
    sensors: [{ x: 660, y: 130, r: 24 }],
    lamps: [{ id: 'L1', pivot: { x: 140, y: 40 }, angle: 90, minAngle: 15, maxAngle: 165, halfAngle: 30 }],
    target: null,
  },
  {
    name: 'Stage 4 · 둥근 그림자',
    goal: '공을 밀면 둥근 그림자가 생깁니다. 공의 위치와 조명 각도를 함께 조절해서 둥근 센서를 가리세요.',
    player: { x: 60, y: 420, w: 28, h: 28 },
    movables: [{ type: 'circle', x: 300, y: 400, r: 28, id: 'ball' }],
    statics: [],
    sensors: [{ x: 660, y: 140, r: 26 }],
    lamps: [{ id: 'L1', pivot: { x: 380, y: 40 }, angle: 90, minAngle: 20, maxAngle: 160, halfAngle: 32 }],
    target: null,
  },
  {
    name: 'Stage 5 · 그림자 모양 맞추기',
    goal: '상자를 밀어 위치를 잡고 조명 각도를 조절해서, 점선으로 표시된 목표 도형과 그림자 모양을 맞추세요.',
    player: { x: 60, y: 250, w: 28, h: 28 },
    movables: [{ type: 'rect', x: 300, y: 250, w: 60, h: 60, id: 'box' }],
    statics: [],
    sensors: [],
    lamps: [{ id: 'L1', pivot: { x: 330, y: 40 }, angle: 90, minAngle: 20, maxAngle: 160, halfAngle: 34 }],
    target: {
      points: [
        { x: 650, y: 170 },
        { x: 715, y: 250 },
        { x: 650, y: 330 },
        { x: 585, y: 250 },
      ],
    },
  },
  {
    name: 'Stage 6 · 최종 퍼즐 (조명 2개)',
    goal: '조명이 두 개입니다. 클릭해서 원하는 조명을 선택한 뒤 드래그로 회전시키세요 (1, 2 키로도 전환 가능). 상자와 공을 각각 알맞은 자리에 밀어두고, 두 센서를 동시에 가리세요.',
    player: { x: 60, y: 250, w: 28, h: 28 },
    movables: [
      { type: 'rect', x: 230, y: 160, w: 55, h: 55, id: 'box' },
      { type: 'circle', x: 230, y: 370, r: 26, id: 'ball' },
    ],
    statics: [],
    sensors: [
      { x: 690, y: 90, r: 20 },
      { x: 690, y: 410, r: 20 },
    ],
    lamps: [
      { id: 'L1', pivot: { x: 300, y: 30 }, angle: 90, minAngle: 15, maxAngle: 165, halfAngle: 28 },
      { id: 'L2', pivot: { x: 550, y: 30 }, angle: 90, minAngle: 15, maxAngle: 165, halfAngle: 28 },
    ],
    target: null,
  },
];

// ---------------------------------------------------------
// 게임 상태
// ---------------------------------------------------------
let stageIndex = 0;
let state = null;
let hasWon = false;
let stageStarted = false;
const keys = {};
const PLAYER_SPEED = 220;

function createLamp(cfg) {
  return {
    id: cfg.id,
    pivot: { ...cfg.pivot },
    angle: cfg.angle * DEG,
    minAngle: (cfg.minAngle ?? 0) * DEG,
    maxAngle: (cfg.maxAngle ?? 180) * DEG,
    halfAngle: (cfg.halfAngle ?? 30) * DEG,
    locked: !!cfg.locked,
    on: true,
  };
}

function loadStage(idx) {
  const cfg = STAGES[idx];
  state = {
    player: { ...cfg.player },
    movables: cfg.movables.map((m) => ({ ...m })),
    statics: cfg.statics.map((s) => ({ ...s })),
    sensors: cfg.sensors.map((s) => ({ ...s, activated: false })),
    lamps: cfg.lamps.map(createLamp),
    target: cfg.target ? { points: cfg.target.points.map((p) => ({ ...p })) } : null,
  };
  state.selectedLampId = state.lamps[0] ? state.lamps[0].id : null;
  hasWon = false;
  stageStarted = false;

  document.getElementById('stage-name').textContent = cfg.name;
  document.getElementById('instr-text').textContent = cfg.goal;
  document.getElementById('start-title').textContent = cfg.name;
  document.getElementById('start-goal').textContent = cfg.goal;
  document.getElementById('win-overlay').classList.add('hidden');
  document.getElementById('start-overlay').classList.remove('hidden');
}

// ---------------------------------------------------------
// 입력: 키보드
// ---------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (!stageStarted) return;
  if (k === 'r') {
    const lamp = state.lamps.find((l) => l.id === state.selectedLampId);
    if (lamp) lamp.on = !lamp.on;
  }
  if (k === '1' && state.lamps[0]) state.selectedLampId = state.lamps[0].id;
  if (k === '2' && state.lamps[1]) state.selectedLampId = state.lamps[1].id;
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// ---------------------------------------------------------
// 입력: 마우스로 조명 "드래그" 회전 (클릭한 상태에서만 동작)
// ---------------------------------------------------------
let draggingLampId = null;

function getCanvasMouse(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function updateLampAngleTo(lamp, mx, my) {
  let a = Math.atan2(my - lamp.pivot.y, mx - lamp.pivot.x);
  a = clamp(a, lamp.minAngle, lamp.maxAngle);
  lamp.angle = a;
}

canvas.addEventListener('mousedown', (e) => {
  if (!stageStarted) return;
  const m = getCanvasMouse(e);
  for (const lamp of state.lamps) {
    if (lamp.locked) continue;
    const d = Math.hypot(m.x - lamp.pivot.x, m.y - lamp.pivot.y);
    if (d <= 22) {
      draggingLampId = lamp.id;
      state.selectedLampId = lamp.id;
      updateLampAngleTo(lamp, m.x, m.y);
      break;
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const m = getCanvasMouse(e);
  if (draggingLampId && stageStarted) {
    const lamp = state.lamps.find((l) => l.id === draggingLampId);
    if (lamp) updateLampAngleTo(lamp, m.x, m.y);
    canvas.style.cursor = 'grabbing';
    return;
  }
  // 커서 힌트: 조명 근처에 있으면 grab 커서로 "잡을 수 있음"을 알려줌
  if (state) {
    let overLamp = false;
    for (const lamp of state.lamps) {
      if (lamp.locked) continue;
      const d = Math.hypot(m.x - lamp.pivot.x, m.y - lamp.pivot.y);
      if (d <= 22) { overLamp = true; break; }
    }
    canvas.style.cursor = overLamp ? 'grab' : 'default';
  }
});

window.addEventListener('mouseup', () => {
  draggingLampId = null;
});

// ---------------------------------------------------------
// UI 버튼
// ---------------------------------------------------------
document.getElementById('restart-btn').addEventListener('click', () => loadStage(stageIndex));
document.getElementById('next-btn').addEventListener('click', () => {
  stageIndex = (stageIndex + 1) % STAGES.length;
  loadStage(stageIndex);
});
document.querySelectorAll('#stage-select button').forEach((btn) => {
  btn.addEventListener('click', () => {
    stageIndex = parseInt(btn.dataset.stage, 10);
    loadStage(stageIndex);
  });
});
document.getElementById('start-btn').addEventListener('click', () => {
  stageStarted = true;
  document.getElementById('start-overlay').classList.add('hidden');
});
document.getElementById('help-btn').addEventListener('click', () => {
  document.getElementById('start-overlay').classList.remove('hidden');
  stageStarted = false;
});

// ---------------------------------------------------------
// 이동 및 밀기 로직
// ---------------------------------------------------------
function updatePlayer(dt) {
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy) || 1;
  dx = (dx / len) * PLAYER_SPEED * dt;
  dy = (dy / len) * PLAYER_SPEED * dt;
  moveWithPush(dx, dy);
}

function moveWithPush(dx, dy) {
  const p = state.player;
  const newP = { x: p.x + dx, y: p.y + dy, w: p.w, h: p.h };
  newP.x = clamp(newP.x, 0, W - newP.w);
  newP.y = clamp(newP.y, 0, H - newP.h);

  for (const obs of state.movables) {
    const obsBox = getBBoxOf(obs);
    if (rectsOverlap(newP, obsBox)) {
      const newObsBox = { x: obsBox.x + dx, y: obsBox.y + dy, w: obsBox.w, h: obsBox.h };
      if (newObsBox.x < 0 || newObsBox.y < 0 || newObsBox.x + newObsBox.w > W || newObsBox.y + newObsBox.h > H) return;
      for (const other of state.movables) {
        if (other === obs) continue;
        if (rectsOverlap(newObsBox, getBBoxOf(other))) return;
      }
      for (const s of state.statics) {
        if (rectsOverlap(newObsBox, getBBoxOf(s))) return;
      }
      obs.x += dx;
      obs.y += dy;
    }
  }
  state.player.x = newP.x;
  state.player.y = newP.y;
}

// ---------------------------------------------------------
// 조명별 조명범위(cone) 안에 들어온 물체 찾기
// ---------------------------------------------------------
function obstaclesInLampCone(lamp, allObstacles) {
  const list = [];
  for (const obs of allObstacles) {
    const c = obstacleCenter(obs);
    const ang = Math.atan2(c.y - lamp.pivot.y, c.x - lamp.pivot.x);
    if (Math.abs(angleDiff(ang, lamp.angle)) <= lamp.halfAngle) list.push(obs);
  }
  return list;
}

// ---------------------------------------------------------
// 그림자 매칭 (Stage 5 실루엣 퍼즐)
// ---------------------------------------------------------
function computeShadowMatch(shadowPoly, targetPoly) {
  const bb = polygonBBox(targetPoly);
  const pad = 25;
  const minX = bb.minX - pad, maxX = bb.maxX + pad;
  const minY = bb.minY - pad, maxY = bb.maxY + pad;
  const RES = 26;
  let totalTarget = 0, matched = 0, extra = 0, totalShadowSamples = 0;

  for (let i = 0; i <= RES; i++) {
    for (let j = 0; j <= RES; j++) {
      const p = { x: minX + ((maxX - minX) * i) / RES, y: minY + ((maxY - minY) * j) / RES };
      const inTarget = pointInPoly(p, targetPoly);
      const inShadow = pointInPoly(p, shadowPoly);
      if (inTarget) totalTarget++;
      if (inShadow) totalShadowSamples++;
      if (inTarget && inShadow) matched++;
      if (inShadow && !inTarget) extra++;
    }
  }
  const matchRatio = totalTarget > 0 ? matched / totalTarget : 0;
  const extraRatio = totalShadowSamples > 0 ? extra / totalShadowSamples : 0;
  return { matchRatio, extraRatio };
}

// ---------------------------------------------------------
// 렌더링
// ---------------------------------------------------------
function playerAsObstacle() {
  return { type: 'rect', x: state.player.x, y: state.player.y, w: state.player.w, h: state.player.h, isPlayer: true };
}

function drawScene() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(0, 0, W, H);

  const allObstacles = [...state.movables, ...state.statics, playerAsObstacle()];

  // 목표 실루엣 (점선)
  if (state.target) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    state.target.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // 조명 범위(콘) 표시 + 그림자 계산
  const shadowPolysByLamp = {};
  const allShadowPolysFlat = [];

  for (const lamp of state.lamps) {
    if (!lamp.on) continue;

    // 빛의 범위(쐐기 모양) 표시
    const leftDir = lamp.angle - lamp.halfAngle;
    const rightDir = lamp.angle + lamp.halfAngle;
    const far = 2000;
    const pL = { x: lamp.pivot.x + Math.cos(leftDir) * far, y: lamp.pivot.y + Math.sin(leftDir) * far };
    const pR = { x: lamp.pivot.x + Math.cos(rightDir) * far, y: lamp.pivot.y + Math.sin(rightDir) * far };
    ctx.fillStyle = 'rgba(255, 213, 74, 0.10)';
    ctx.beginPath();
    ctx.moveTo(lamp.pivot.x, lamp.pivot.y);
    ctx.lineTo(pL.x, pL.y);
    ctx.lineTo(pR.x, pR.y);
    ctx.closePath();
    ctx.fill();

    const obsInCone = obstaclesInLampCone(lamp, allObstacles);
    const polys = obsInCone.map((obs) => ({ poly: shadowPolygonFor(lamp.pivot, obs), obs, lampId: lamp.id }));
    shadowPolysByLamp[lamp.id] = polys;
    allShadowPolysFlat.push(...polys);
  }

  // 그림자 그리기 (여러 조명 그림자가 겹치면 더 어둡게)
  for (const s of allShadowPolysFlat) {
    ctx.fillStyle = 'rgba(8,8,8,0.5)';
    ctx.beginPath();
    s.poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }

  // 센서 판정: 어떤 켜진 조명이든 "직접 비추면" OFF, 비추는 조명이 있는데 "가려지면" ON
  for (const sensor of state.sensors) {
    let litByAny = false;
    let shadowedByAny = false;
    for (const lamp of state.lamps) {
      if (!lamp.on) continue;
      const ang = Math.atan2(sensor.y - lamp.pivot.y, sensor.x - lamp.pivot.x);
      if (Math.abs(angleDiff(ang, lamp.angle)) > lamp.halfAngle) continue; // 이 조명의 범위 밖
      const polysForLamp = shadowPolysByLamp[lamp.id] || [];
      let blocked = false;
      for (const s of polysForLamp) {
        if (pointInPoly({ x: sensor.x, y: sensor.y }, s.poly)) { blocked = true; break; }
      }
      if (blocked) shadowedByAny = true;
      else litByAny = true;
    }
    sensor.activated = !litByAny && shadowedByAny;

    ctx.beginPath();
    ctx.arc(sensor.x, sensor.y, sensor.r, 0, Math.PI * 2);
    ctx.fillStyle = sensor.activated ? '#43a047' : '#e53935';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  // 고정 물체
  for (const s of state.statics) {
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  // 움직이는 물체
  for (const m of state.movables) {
    if (m.type === 'circle') {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9800';
      ctx.fill();
    } else {
      ctx.fillStyle = '#a1662f';
      ctx.fillRect(m.x, m.y, m.w, m.h);
    }
  }

  // 플레이어
  ctx.fillStyle = '#4fc3f7';
  ctx.fillRect(state.player.x, state.player.y, state.player.w, state.player.h);

  // 조명 자체 (아이콘 + 방향 표시선 + 선택 표시)
  for (const lamp of state.lamps) {
    const selected = lamp.id === state.selectedLampId;

    // 방향 표시선
    if (lamp.on) {
      ctx.strokeStyle = 'rgba(255,213,74,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lamp.pivot.x, lamp.pivot.y);
      ctx.lineTo(lamp.pivot.x + Math.cos(lamp.angle) * 55, lamp.pivot.y + Math.sin(lamp.angle) * 55);
      ctx.stroke();
    }

    // 선택 표시 링
    if (selected && !lamp.locked) {
      ctx.beginPath();
      ctx.arc(lamp.pivot.x, lamp.pivot.y, 18, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 전구 본체
    ctx.beginPath();
    ctx.arc(lamp.pivot.x, lamp.pivot.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = lamp.on ? '#ffd54a' : '#666';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = lamp.locked ? '#999' : '#222';
    ctx.stroke();
  }

  checkWinCondition(allShadowPolysFlat);
}

function checkWinCondition(shadowPolys) {
  if (hasWon || !stageStarted) return;
  let won = false;

  if (state.target) {
    let bestMatch = 0, bestExtra = 1;
    for (const s of shadowPolys) {
      if (s.obs.isPlayer) continue;
      const { matchRatio, extraRatio } = computeShadowMatch(s.poly, state.target.points);
      if (matchRatio > bestMatch) {
        bestMatch = matchRatio;
        bestExtra = extraRatio;
      }
    }
    won = bestMatch >= 0.78 && bestExtra <= 0.45;
  } else if (state.sensors.length > 0) {
    won = state.sensors.every((s) => s.activated);
  }

  if (won) {
    hasWon = true;
    document.getElementById('win-overlay').classList.remove('hidden');
    document.getElementById('win-text').textContent =
      stageIndex === STAGES.length - 1 ? '🎉 모든 스테이지 클리어!' : '문이 열렸습니다!';
  }
}

// ---------------------------------------------------------
// 메인 루프
// ---------------------------------------------------------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (stageStarted && !hasWon) updatePlayer(dt);
  drawScene();

  requestAnimationFrame(loop);
}

loadStage(stageIndex);
requestAnimationFrame(loop);
