/* ============================================================
   Shadow Lab - 빛과 그림자 퍼즐 게임
   핵심 아이디어: 물체를 옮기는 게 아니라 "그림자"를 이용해 퍼즐을 푼다.
   ============================================================ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ---------------------------------------------------------
// 기하 연산 유틸 (그림자 투영의 핵심)
// ---------------------------------------------------------

// 볼록 껍질(convex hull) - monotone chain 알고리즘
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// 점 p가 다각형 poly 내부에 있는지 (ray casting)
function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 빛 위치에서 점 p를 지나 멀리 투영
function projectFar(light, p, dist) {
  const dx = p.x - light.x;
  const dy = p.y - light.y;
  const len = Math.hypot(dx, dy) || 0.0001;
  return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
}

// 물체(obstacle)의 외곽 점들을 반환 (사각형 or 원)
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
  // rect
  return [
    { x: obs.x, y: obs.y },
    { x: obs.x + obs.w, y: obs.y },
    { x: obs.x + obs.w, y: obs.y + obs.h },
    { x: obs.x, y: obs.y + obs.h },
  ];
}

// 빛과 물체로부터 그림자 다각형(볼록 껍질) 계산
// -> 거리가 멀수록 그림자가 커지는 효과가 기하학적으로 자연스럽게 발생함
function shadowPolygonFor(light, obs) {
  const pts = getObstaclePoints(obs);
  const far = pts.map((p) => projectFar(light, p, 3000));
  return convexHull(pts.concat(far));
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
  if (obj.type === 'circle') {
    return { x: obj.x - obj.r, y: obj.y - obj.r, w: obj.r * 2, h: obj.r * 2 };
  }
  return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------
// 스테이지 정의
// ---------------------------------------------------------
const STAGES = [
  {
    name: 'Stage 1 · 빛 움직이기',
    instr: '마우스를 움직여 빛의 위치를 조절하세요. 고정된 상자의 그림자로 센서를 가리면 문이 열립니다.',
    player: { x: 70, y: 230, w: 30, h: 30 },
    movables: [],
    statics: [{ type: 'rect', x: 380, y: 210, w: 70, h: 70 }],
    sensors: [{ x: 690, y: 245, r: 22 }],
    light: { x: 400, y: 50 },
    target: null,
  },
  {
    name: 'Stage 2 · 상자 밀기',
    instr: 'WASD로 상자를 밀어 그림자 위치를 바꾸세요. 빛은 마우스로도 조절할 수 있습니다.',
    player: { x: 70, y: 230, w: 30, h: 30 },
    movables: [{ type: 'rect', x: 300, y: 230, w: 60, h: 60, id: 'box' }],
    statics: [],
    sensors: [{ x: 690, y: 120, r: 22 }],
    light: { x: 340, y: 40 },
    target: null,
  },
  {
    name: 'Stage 3 · 둥근 그림자',
    instr: '공을 밀어 둥근 그림자를 만들고, 그림자로 센서를 가리세요.',
    player: { x: 70, y: 400, w: 30, h: 30 },
    movables: [{ type: 'circle', x: 250, y: 400, r: 28, id: 'ball' }],
    statics: [],
    sensors: [{ x: 690, y: 150, r: 26 }],
    light: { x: 260, y: 50 },
    target: null,
  },
  {
    name: 'Stage 4 · 그림자 모양 맞추기',
    instr: '상자를 밀고 빛의 위치를 조절해서 그림자를 점선 목표 도형에 맞추세요. (일치율 필요)',
    player: { x: 70, y: 250, w: 30, h: 30 },
    movables: [{ type: 'rect', x: 300, y: 250, w: 60, h: 60, id: 'box' }],
    statics: [],
    sensors: [],
    light: { x: 320, y: 70 },
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
    name: 'Stage 5 · 최종 퍼즐',
    instr: '상자와 공을 모두 이용해서 두 센서를 동시에 활성화시키세요!',
    player: { x: 70, y: 250, w: 30, h: 30 },
    movables: [
      { type: 'rect', x: 250, y: 180, w: 55, h: 55, id: 'box' },
      { type: 'circle', x: 250, y: 370, r: 26, id: 'ball' },
    ],
    statics: [],
    sensors: [
      { x: 690, y: 90, r: 20 },
      { x: 690, y: 410, r: 20 },
    ],
    light: { x: 300, y: 30 },
    target: null,
  },
];

// ---------------------------------------------------------
// 게임 상태
// ---------------------------------------------------------
let stageIndex = 0;
let state = null;
let lightOn = true;
let hasWon = false;
const keys = {};
const mouse = { x: 400, y: 50 };
const PLAYER_SPEED = 220; // px/sec

function loadStage(idx) {
  const cfg = STAGES[idx];
  state = {
    player: { ...cfg.player },
    movables: cfg.movables.map((m) => ({ ...m })),
    statics: cfg.statics.map((s) => ({ ...s })),
    sensors: cfg.sensors.map((s) => ({ ...s, activated: false })),
    light: { ...cfg.light },
    target: cfg.target ? { points: cfg.target.points.map((p) => ({ ...p })) } : null,
  };
  lightOn = true;
  hasWon = false;
  mouse.x = cfg.light.x;
  mouse.y = cfg.light.y;
  document.getElementById('stage-name').textContent = cfg.name;
  document.getElementById('instr-text').textContent = cfg.instr;
  document.getElementById('win-overlay').classList.add('hidden');
}

// ---------------------------------------------------------
// 입력
// ---------------------------------------------------------
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r') {
    lightOn = !lightOn;
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = clamp(e.clientX - rect.left, 10, W - 10);
  mouse.y = clamp(e.clientY - rect.top, 10, H - 10);
});

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

  // 밀 수 있는 물체와 충돌 검사
  for (const obs of state.movables) {
    const obsBox = getBBoxOf(obs);
    if (rectsOverlap(newP, obsBox)) {
      const newObsBox = { x: obsBox.x + dx, y: obsBox.y + dy, w: obsBox.w, h: obsBox.h };
      // 캔버스 경계 체크
      if (newObsBox.x < 0 || newObsBox.y < 0 || newObsBox.x + newObsBox.w > W || newObsBox.y + newObsBox.h > H) {
        return; // 밀 수 없음 -> 플레이어도 멈춤
      }
      // 다른 물체와의 충돌 체크
      for (const other of state.movables) {
        if (other === obs) continue;
        if (rectsOverlap(newObsBox, getBBoxOf(other))) return;
      }
      for (const s of state.statics) {
        if (rectsOverlap(newObsBox, getBBoxOf(s))) return;
      }
      // 이동 적용
      obs.x += dx;
      obs.y += dy;
    }
  }
  state.player.x = newP.x;
  state.player.y = newP.y;
}

// ---------------------------------------------------------
// 그림자 매칭 (Stage 4 실루엣 퍼즐)
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
function drawScene() {
  ctx.clearRect(0, 0, W, H);

  // 배경 (미니멀 회색)
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
    state.target.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // 그림자 그리기
  let shadowPolys = [];
  if (lightOn) {
    for (const obs of allObstacles) {
      const poly = shadowPolygonFor(state.light, obs);
      shadowPolys.push({ poly, obs });
      ctx.fillStyle = 'rgba(10,10,10,0.72)';
      ctx.beginPath();
      poly.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }

  // 센서 업데이트 + 그리기
  for (const sensor of state.sensors) {
    let activated = false;
    if (lightOn) {
      for (const s of shadowPolys) {
        if (pointInPoly({ x: sensor.x, y: sensor.y }, s.poly)) {
          activated = true;
          break;
        }
      }
    }
    sensor.activated = activated;
    ctx.beginPath();
    ctx.arc(sensor.x, sensor.y, sensor.r, 0, Math.PI * 2);
    ctx.fillStyle = activated ? '#43a047' : '#e53935';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  // 고정 물체 (statics)
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

  // 빛
  if (lightOn) {
    const grad = ctx.createRadialGradient(state.light.x, state.light.y, 0, state.light.x, state.light.y, 40);
    grad.addColorStop(0, 'rgba(255,213,74,0.9)');
    grad.addColorStop(1, 'rgba(255,213,74,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(state.light.x, state.light.y, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(state.light.x, state.light.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd54a';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(state.light.x, state.light.y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 승리 조건 체크
  checkWinCondition(shadowPolys);
}

function playerAsObstacle() {
  return {
    type: 'rect',
    x: state.player.x,
    y: state.player.y,
    w: state.player.w,
    h: state.player.h,
    isPlayer: true,
  };
}

function checkWinCondition(shadowPolys) {
  if (hasWon) return;
  let won = false;

  if (state.target) {
    // Stage 4: 그림자 모양 매칭 (플레이어 자신의 그림자는 매칭 대상에서 제외)
    let bestMatch = 0, bestExtra = 1;
    for (const s of shadowPolys) {
      if (s.obs.isPlayer) continue;
      const { matchRatio, extraRatio } = computeShadowMatch(s.poly, state.target.points);
      if (matchRatio > bestMatch) {
        bestMatch = matchRatio;
        bestExtra = extraRatio;
      }
    }
    won = lightOn && bestMatch >= 0.78 && bestExtra <= 0.45;
  } else if (state.sensors.length > 0) {
    won = lightOn && state.sensors.every((s) => s.activated);
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

  state.light.x = mouse.x;
  state.light.y = mouse.y;

  if (!hasWon) updatePlayer(dt);
  drawScene();

  requestAnimationFrame(loop);
}

loadStage(stageIndex);
requestAnimationFrame(loop);
