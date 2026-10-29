'use strict';
/* ============================================================
   赛球弹珠竞速 · Marble Rush —— 微信小游戏版
   由 H5 单文件版移植：游戏核心复用，UI 改为 Canvas 绘制。
   ============================================================ */

/* ================= 平台：画布 / 屏幕 / 存储 / 音频 ================= */
const SYS = wx.getSystemInfoSync();
const cw = SYS.windowWidth;
const ch = SYS.windowHeight;
const dpr = Math.min(SYS.pixelRatio || 1, 2);
const canvas = wx.createCanvas();
canvas.width = Math.round(cw * dpr);
canvas.height = Math.round(ch * dpr);
const ctx = canvas.getContext('2d');

const IS_TOUCH = true;
let touchSeen = true;

const store = {
  get(key, def) {
    try {
      const v = wx.getStorageSync(key);
      return (v === '' || v === undefined || v === null) ? def : v;
    } catch (e) { return def; }
  },
  set(key, val) { try { wx.setStorageSync(key, val); } catch (e) { /* 忽略 */ } },
};

let AC = null, master = null, muted = false, lastThock = 0;
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended' && AC.resume) AC.resume(); return; }
  try {
    AC = wx.createWebAudioContext();
    if (AC) {
      master = AC.createGain();
      master.gain.value = settings.vol;
      master.connect(AC.destination);
    }
  } catch (e) { AC = null; }
}
function applyVolume() { if (master) master.gain.value = settings.vol; }

/* ================= 工具 ================= */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fmtT(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); }

/* ================= 音效 ================= */
function tone(f0, f1, dur, type, vol, delay) {
  if (!AC || muted) return;
  try {
    const t = AC.currentTime + (delay || 0);
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(f0, 1), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  } catch (e) { /* 音频失败不影响游戏 */ }
}
function sndImpact(imp) {
  const now = Date.now();
  if (now - lastThock < 45) return; lastThock = now;
  const v = Math.min(0.5, imp / 900);
  tone(150 + imp * 0.15, 55, 0.09, 'triangle', v);
  tone(900, 300, 0.03, 'square', v * 0.25);
}
const sndBumper = () => tone(220, 700, 0.16, 'square', 0.22);
const sndHole = () => tone(520, 70, 0.5, 'sawtooth', 0.18);
const sndBeep = () => tone(440, 440, 0.12, 'sine', 0.3);
const sndGo = () => tone(660, 990, 0.3, 'square', 0.3);
function sndFinish(win) {
  const seq = win ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
  seq.forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.3, i * 0.13));
}

/* ================= 设置（本地保存） ================= */
let settings = { ctrl: 'btn', vol: 0.45, mute: false };
let settingsOpen = false;
function loadSettings() {
  const s = store.get('marbleSettings', null);
  if (s && typeof s === 'object') {
    if (s.ctrl === 'btn') settings.ctrl = 'btn';
    if (typeof s.vol === 'number') settings.vol = clamp(s.vol, 0, 1);
    settings.mute = !!s.mute;
  }
  muted = settings.mute;
}
function saveSettings() { store.set('marbleSettings', settings); }

/* ================= 常量 ================= */
const W = 880;
const WALL = 26;
const SEG = 345;
const R = 19;
const GY = 560;
const DRAG = 1.05;
const MAXV = 950;
const GOLD = '#ffd54a', CYAN = '#6cd0ff';
const BALL_POOL = [
  { name: '你', color: '#ffd54a' },
  { name: '赤焰', color: '#ff5d5d' },
  { name: '碧波', color: '#4da3ff' },
  { name: '紫电', color: '#b06cff' },
  { name: '翠影', color: '#52e0a0' },
  { name: '橙旋', color: '#ff9d3d' },
  { name: '白霜', color: '#dfe8ff' },
  { name: '青岚', color: '#35d0e8' },
  { name: '粉黛', color: '#ff7ac8' },
  { name: '琥珀', color: '#cd8b45' },
];
let ballCount = 6;
let customNames = BALL_POOL.map(e => e.name);
function saveRoster() { store.set('marbleRoster', { c: ballCount, n: customNames }); }
function loadRoster() {
  const r = store.get('marbleRoster', null);
  if (r && Array.isArray(r.n)) {
    ballCount = clamp(+r.c || 6, 1, 10);
    customNames = BALL_POOL.map((e, i) => (typeof r.n[i] === 'string' && r.n[i].trim()) ? r.n[i].slice(0, 6) : e.name);
  }
}
const LENGTHS = {
  short: { label: '短道', len: 17000 },
  medium: { label: '中道', len: 32000 },
  long: { label: '长道', len: 40000 },
  xl: { label: '超长', len: 54000 },
};
const AILVLS = {
  easy: { label: '简单', scale: 0.35, spd: 0.88, ai: [0.50, 0.57, 0.64, 0.70, 0.76] },
  normal: { label: '普通', scale: 0.65, spd: 0.97, ai: [0.70, 0.76, 0.82, 0.87, 0.91] },
  hard: { label: '困难', scale: 0.85, spd: 1.12, ai: [0.90, 0.93, 0.95, 0.965, 0.98] },
  nightmare: { label: '噩梦', scale: 1.00, spd: 1.20, ai: [0.97, 0.98, 0.985, 0.99, 0.995] },
};

/* ================= 关卡模式（50 关，难度从噩梦起步递增） ================= */
const MAX_LEVEL = 50;
function levelConfig(lv) {
  const t = (clamp(lv, 1, MAX_LEVEL) - 1) / (MAX_LEVEL - 1);   // 0..1
  return {
    label: '第 ' + lv + ' 关',
    scale: 0.92 + t * 0.43,         // 第 1 关略低于噩梦，第 50 关超过噩梦
    spd: 1.18 + t * 0.32,           // 人机速度：第 1 关略低于噩梦，逐关提升
    ai: [0.950 + t * 0.030, 0.960 + t * 0.025, 0.970 + t * 0.020, 0.980 + t * 0.015, 0.988 + t * 0.012],
    len: Math.round(lerp(19000, 27000, t)),   // 约 1 分钟赛道
    level: lv,
  };
}
const LEVEL_BALLS = 6;   // 关卡模式固定 6 颗球
function activeDiff() {
  return mode === 'level' ? levelConfig(currentLevel) : AILVLS[diffKey];
}
function loadLevels() {
  const p = store.get('marbleLevels', null);
  if (p && typeof p === 'object') {
    levelProgress.unlocked = clamp(+p.unlocked || 1, 1, MAX_LEVEL);
    levelProgress.best = (p.best && typeof p.best === 'object') ? p.best : {};
  }
}
function saveLevels() { store.set('marbleLevels', levelProgress); }
// 把关卡进度上传到微信托管数据（好友排行榜用）
function uploadLevelStats() {
  const keys = Object.keys(levelProgress.best);
  const cleared = keys.length;
  let fastest = 0;
  for (const k of keys) {
    const t = +levelProgress.best[k] || 0;
    if (t > 0 && (!fastest || t < fastest)) fastest = t;
  }
  try {
    if (wx.setUserCloudStorage) {
      wx.setUserCloudStorage({
        KVDataList: [
          { key: 'lv', value: String(cleared) },
          { key: 'best', value: String(Math.round(fastest * 100) / 100) },
        ],
      });
    }
  } catch (e) { /* 未登录/测试号时忽略 */ }
}

/* ================= 邀请好友（同赛道异步对战） ================= */
function parseInvite(query) {
  if (!query || !query.seed) return false;
  const s = +query.seed;
  if (!s) return false;
  inviteSeed = s;
  if (query.len && LENGTHS[query.len]) lenKey = query.len;
  if (query.ai && AILVLS[query.ai]) diffKey = query.ai;
  if (query.c) ballCount = clamp(+query.c, 1, 10);
  inviteTime = +query.t || 0;
  inviteLastTime = 0;
  inviteFrom = query.from || '';
  ghostSamples = query.g ? decodeGhost(query.g) : [];
  if (!inviteTime && ghostSamples.length) inviteTime = 0;
  mode = 'invite';
  screen = 'invite';
  return true;
}
function enterInvite() {
  mode = 'invite';
  if (!inviteSeed) inviteSeed = (Math.random() * 1e9) | 0;
  inviteLastTime = 0;
  inviteTime = 0;
  ghostSamples = [];
  screen = 'invite';
}
function shareChallenge() {
  if (!inviteSeed) inviteSeed = (Math.random() * 1e9) | 0;
  let q = 'seed=' + inviteSeed + '&len=' + lenKey + '&ai=' + diffKey + '&c=' + ballCount +
          '&t=' + (inviteLastTime ? Math.round(inviteLastTime * 100) / 100 : '') + '&from=invite';
  // 幽灵轨迹：控制总长度，超长就只带成绩不带影子
  if (inviteGhostStr && (q.length + inviteGhostStr.length + 4) < 950) q += '&g=' + inviteGhostStr;
  try {
    wx.shareAppMessage({
      title: inviteLastTime
        ? '我在赛球弹珠竞速跑出 ' + fmtT(inviteLastTime) + '，来同一条赛道挑战我！'
        : '赛球弹珠竞速 · 同一条赛道，来和我比时间！',
      imageUrl: 'images/share.png',
      query: q,
    });
  } catch (e) { /* 忽略 */ }
}
function startInviteRace() {
  if (!inviteSeed) inviteSeed = (Math.random() * 1e9) | 0;
  screen = 'menu';
  startRace(false);
}

/* ================= 全局状态 ================= */
let state = 'menu';
let paused = false;
let mode = 'level';              // level | invite | spectate
let screen = 'menu';             // menu | levels | invite
let currentLevel = 1;
let levelProgress = { unlocked: 1, best: {} };
let levelPage = 0;
let inviteSeed = 0, inviteTime = 0, inviteLastTime = 0;
let inviteFrom = '';
let ghostSamples = [];          // 好友幽灵轨迹
let ghostRecord = [];           // 本局录制
let ghostRecT = 0;
let inviteGhostStr = '';        // 压缩后的轨迹（分享卡携带）

/* ================= 幽灵轨迹压缩（无服务器，走分享卡 query） ================= */
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64urlEncode(bytes) {
  let out = '', i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63] + B64U[(n >> 6) & 63] + B64U[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) { const n = bytes[i] << 16; out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63]; }
  else if (rem === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63] + B64U[(n >> 6) & 63]; }
  return out;
}
function b64urlDecode(str) {
  const idx = {};
  for (let i = 0; i < 64; i++) idx[B64U[i]] = i;
  const bytes = []; let buf = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const v = idx[str[i]];
    if (v === undefined) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 255); }
  }
  return bytes;
}
function encodeGhost(samples) {
  if (!samples || samples.length < 2) return '';
  let arr = samples;
  if (arr.length > 200) {
    const out = [], step = (arr.length - 1) / 199;
    for (let i = 0; i < 200; i++) out.push(arr[Math.round(i * step)]);
    arr = out;
  }
  const bytes = [];
  const y0 = clamp(Math.round(arr[0].y), 0, 65535);
  const x0 = Math.round(clamp(arr[0].x, 0, W) / W * 1023);
  bytes.push(y0 >> 8, y0 & 255, x0 >> 2, (x0 & 3) << 6);
  let prevY = arr[0].y;
  for (let i = 1; i < arr.length; i++) {
    const xq = Math.round(clamp(arr[i].x, 0, W) / W * 1023);
    let dy = Math.round(arr[i].y - prevY);
    prevY = arr[i].y;
    dy = clamp(dy, 0, 1023);
    const v = (xq << 10) | dy;
    bytes.push((v >> 12) & 255, (v >> 4) & 255, (v & 15) << 4);
  }
  return b64urlEncode(bytes);
}
function decodeGhost(str) {
  if (!str) return [];
  const bytes = b64urlDecode(str);
  if (bytes.length < 4) return [];
  const y0 = (bytes[0] << 8) | bytes[1];
  const x0 = ((bytes[2] << 2) | (bytes[3] >> 6));
  const out = [{ x: x0 / 1023 * W, y: y0 }];
  let prevY = y0;
  for (let i = 4; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 12) | (bytes[i + 1] << 4) | (bytes[i + 2] >> 4);
    const xq = (v >> 10) & 1023, dy = v & 1023;
    prevY += dy;
    out.push({ x: xq / 1023 * W, y: prevY });
  }
  return out;
}
function drawGhostBall() {
  if (mode !== 'invite' || !ghostSamples.length || !inviteTime) return;
  const p = clamp(raceTime / inviteTime, 0, 1) * (ghostSamples.length - 1);
  const i0 = Math.floor(p), i1 = Math.min(ghostSamples.length - 1, i0 + 1);
  const k = p - i0;
  const x = lerp(ghostSamples[i0].x, ghostSamples[i1].x, k);
  const y = lerp(ghostSamples[i0].y, ghostSamples[i1].y, k);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#6cd0ff';
  ctx.shadowColor = '#6cd0ff'; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(x, y, R * 0.92, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(200,240,255,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, R * 0.92, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#cfefff';
  ctx.textAlign = 'center';
  ctx.fillText('好友', x, y - R - 8);
  ctx.restore();
}
let rankFrom = 'menu';
let simTime = 0, raceTime = 0, countdownT = 0, goT = -99, lastCount = 99;
let seed = (Math.random() * 1e9) | 0, lenKey = 'medium', diffKey = 'normal';
let trackLen = LENGTHS.medium.len;
let track = null, balls = [], players = [];
let menuCam = 0;
let particles = [];
let finishWaitEnd = 0, resultsFinal = false, lastResUpdate = 0;
let clickTargets = [];
let spectateSplit = false;
let backPrompt = false;
let editingName = -1;

/* ================= 赛道生成 ================= */
function pat_gate(y, d, out, rng) {
  const gap = lerp(200, 136, d) + rng() * 22;
  const gx = lerp(WALL + gap / 2 + 40, W - WALL - gap / 2 - 40, rng());
  const th = 26;
  const wl = (gx - gap / 2) - WALL, wr = (W - WALL) - (gx + gap / 2);
  if (wl > 8) out.push({ type: 'rect', x: WALL, y, w: wl, h: th });
  if (wr > 8) out.push({ type: 'rect', x: gx + gap / 2, y, w: wr, h: th });
  return th;
}
function pat_slalom(y, d, out, rng) {
  const n = 3 + Math.round(d * 1.5);
  for (let i = 0; i < n; i++) {
    const left = i % 2 === 0;
    out.push({ type: 'bumper', cx: left ? lerp(W * 0.28, W * 0.42, rng()) : lerp(W * 0.58, W * 0.72, rng()), cy: y + 45 + i * 130, r: 28 });
  }
  return 45 + (n - 1) * 130 + 30;
}
function pat_pinball(y, d, out, rng) {
  const rows = 3 + (d > 0.45 ? 1 : 0) + (d > 0.8 ? 1 : 0);
  const x0 = WALL + 80, step = (W - 2 * WALL - 160) / 5;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 6; c++) {
      if (rng() < 0.25) continue;
      out.push({ type: 'peg', cx: x0 + c * step + (r % 2 ? step / 2 : 0), cy: y + 45 + r * 112, r: 11 });
    }
  return 45 + (rows - 1) * 112 + 30;
}
function pat_windmill(y, d, out, rng) {
  const len = lerp(210, 340, d);
  const spd = (1.2 + 1.6 * d) * (rng() < 0.5 ? -1 : 1);
  const two = d > 0.30 && rng() < 0.6;
  const len2 = two ? lerp(190, 290, d) : 0;
  out.push({ type: 'rot', mode: 'spin', cx: lerp(W * 0.35, W * 0.65, rng()), cy: y + 75, len, thick: 18, speed: spd, phase: rng() * TAU });
  if (two) out.push({ type: 'rot', mode: 'spin', cx: lerp(W * 0.30, W * 0.40, rng()), cy: y + 75 + 90, len: len2, thick: 18, speed: -spd, phase: rng() * TAU });
  return 75 + (two ? 90 + len2 / 2 : len / 2) + 40;
}
function pat_pistons(y, d, out, rng) {
  const mk = (side, yy, amp, speed, phase) => ({ type: 'piston', side, y: yy, h: 34, amp, min: 36, speed, phase });
  if (rng() < 0.35) {
    const amp = 130 + 60 * d;
    out.push({ type: 'rect', x: W / 2 - 70, y: y + 20, w: 140, h: 150 });
    out.push(mk('L', y + 55, amp, 1.7, 0));
    out.push(mk('R', y + 55, amp, 1.7, Math.PI));
    return 210;
  } else {
    let side = rng() < 0.5 ? 'L' : 'R';
    const n = 2 + (d > 0.40 ? 1 : 0) + (d > 0.75 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      out.push(mk(side, y + i * 150, 130 + 90 * d, 1.3 + 0.8 * d, rng() * TAU));
      side = side === 'L' ? 'R' : 'L';
    }
    return (n - 1) * 150 + 70;
  }
}
function pat_holes(y, d, out, rng) {
  const n = 2 + Math.round(d * 2);
  for (let i = 0; i < n; i++)
    out.push({ type: 'hole', cx: lerp(WALL + 105, W - WALL - 105, rng()), cy: y + 50 + i * 100 + (rng() - 0.5) * 36, r: 26 + 16 * d });
  return 50 + (n - 1) * 100 + 60;
}
function pat_funnel(y, d, out, rng) {
  const g = lerp(215, 175, d) + rng() * 18;
  const c = W / 2 + (rng() - 0.5) * 150;
  const L = 330;
  out.push({ type: 'rot', mode: 'static', cx: c - g / 2 - L * 0.42, cy: y + 85, len: L, thick: 20, angle: 0.55 });
  out.push({ type: 'rot', mode: 'static', cx: c + g / 2 + L * 0.42, cy: y + 85, len: L, thick: 20, angle: -0.55 });
  return 290;
}
function pat_hammer(y, d, out, rng) {
  const len = 260 + 90 * d, speed = 1.5 + 0.9 * d;
  out.push({ type: 'rot', mode: 'swing', cx: WALL + 6, cy: y + 55, len, thick: 18, center: 0.35, amp: 0.85, speed, phase: rng() * TAU });
  if (d > 0.50 && rng() < 0.55)
    out.push({ type: 'rot', mode: 'swing', cx: W - WALL - 6, cy: y + 55, len, thick: 18, center: Math.PI - 0.35, amp: 0.85, speed, phase: rng() * TAU });
  return 55 + len / 2 + 40;
}
function pat_double(y, d, out, rng) {
  pat_gate(y, Math.min(1, d + 0.1), out, rng);
  pat_windmill(y + 190, d, out, rng);
  return 190 + 75 + lerp(210, 340, d) / 2 + 40;
}
function pat_zigzag(y, d, out, rng) {
  const n = 2 + (d > 0.65 ? 1 : 0);
  let side = rng() < 0.5;
  for (let i = 0; i < n; i++) {
    const gap = lerp(215, 158, d) + rng() * 16;
    const gx = side ? lerp(WALL + gap / 2 + 38, W * 0.30, rng())
                    : lerp(W * 0.70, W - WALL - gap / 2 - 38, rng());
    const wl = (gx - gap / 2) - WALL, wr = (W - WALL) - (gx + gap / 2);
    if (wl > 8) out.push({ type: 'rect', x: WALL, y: y + i * 230, w: wl, h: 26 });
    if (wr > 8) out.push({ type: 'rect', x: gx + gap / 2, y: y + i * 230, w: wr, h: 26 });
    side = !side;
  }
  return (n - 1) * 230 + 60;
}
const PATS = { gate: pat_gate, slalom: pat_slalom, pinball: pat_pinball, windmill: pat_windmill,
  pistons: pat_pistons, holes: pat_holes, funnel: pat_funnel, hammer: pat_hammer,
  double: pat_double, zigzag: pat_zigzag };

function genTrack(sd, scaleD, len) {
  const rng = mulberry32(sd);
  const out = [];
  const pick = arr => { let s = 0; for (const a of arr) s += a[1]; let r = rng() * s; for (const a of arr) { r -= a[1]; if (r <= 0) return a[0]; } return arr[0][0]; };
  let y = 560;
  const d = Math.min(scaleD, 1.35);
  let lastKind = '';
  while (y < len - 650) {
    let kind = pick([['gate', 0.9], ['slalom', 0.9], ['pinball', 0.9], ['windmill', 1], ['funnel', 0.65],
      ['pistons', d > 0.06 ? 1 : 0.20], ['holes', d > 0.12 ? 0.9 : 0.15], ['hammer', d > 0.22 ? 1 : 0.08],
      ['double', d > 0.4 ? 0.8 : 0], ['zigzag', 0.55]]);
    if (kind === lastKind)
      kind = pick([['gate', 0.9], ['slalom', 0.9], ['pinball', 0.9], ['windmill', 1], ['funnel', 0.65],
        ['pistons', d > 0.06 ? 1 : 0.20], ['holes', d > 0.12 ? 0.9 : 0.15], ['hammer', d > 0.22 ? 1 : 0.08],
        ['double', d > 0.4 ? 0.8 : 0], ['zigzag', 0.55]]);
    lastKind = kind;
    const h = PATS[kind](y, d, out, rng) || 60;
    y += Math.max(330, h + 150 + rng() * 60);
  }
  out.sort((a, b) => ((a.y ?? a.cy) - (b.y ?? b.cy)));
  for (const o of out) {
    if (o.type === 'rect') { o._cy = o.y + o.h / 2; o._r = Math.hypot(o.w, o.h) / 2 + 12; }
    else if (o.type === 'piston') { o._cy = o.y + o.h / 2; o._r = o.min + o.amp + o.h; }
    else if (o.type === 'rot') { o._cy = o.cy; o._r = o.len / 2 + 22; }
    else { o._cy = o.cy; o._r = o.r + 12; }
  }
  out.sort((a, b) => a._cy - b._cy);
  return { obstacles: out };
}

/* ================= 机关运动学 ================= */
function angleOmega(o, t) {
  if (o.mode === 'spin') return [o.phase + o.speed * t, o.speed];
  if (o.mode === 'swing') { const ph = t * o.speed + o.phase; return [o.center + o.amp * Math.sin(ph), o.amp * o.speed * Math.cos(ph)]; }
  return [o.angle, 0];
}
function ensureKin(o) {
  if (o._kt === simTime) return;
  o._kt = simTime;
  if (o.type === 'rot') { const r = angleOmega(o, simTime); o._a = r[0]; o._w = r[1]; }
  else if (o.type === 'piston') {
    const ph = simTime * o.speed + o.phase, k = 0.5 + 0.5 * Math.sin(ph);
    const reach = o.min + o.amp * k;
    o._vx = o.amp * 0.5 * o.speed * Math.cos(ph) * (o.side === 'L' ? 1 : -1);
    o._rect = o.side === 'L' ? { x: WALL, y: o.y, w: reach, h: o.h } : { x: W - WALL - reach, y: o.y, w: reach, h: o.h };
    o._rect._owner = o;
  }
}
function obsWindow(y0, y1) {
  const obs = track.obstacles;
  const lo0 = y0 - 360, hi0 = y1 + 360;
  let lo = 0, hi = obs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (obs[m]._cy < lo0) lo = m + 1; else hi = m; }
  const i0 = lo;
  hi = obs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (obs[m]._cy <= hi0) lo = m + 1; else hi = m; }
  return [i0, lo];
}
function rotNearest(o, px, py) {
  const c = Math.cos(o._a), s = Math.sin(o._a);
  const dx = px - o.cx, dy = py - o.cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const qx = clamp(lx, -o.len / 2, o.len / 2), qy = clamp(ly, -o.thick / 2, o.thick / 2);
  return [o.cx + qx * c - qy * s, o.cy + qx * s + qy * c, lx, ly];
}

/* ================= 弹珠 ================= */
function makeBalls() {
  const jr = mulberry32(seed ^ 0x5f3759df);
  const n = mode === 'level' ? LEVEL_BALLS : Math.max(1, ballCount);
  const roster = BALL_POOL.map((e, i) => ({ name: customNames[i].trim() || e.name, color: e.color }));
  players = [];
  balls = [];
  if (mode === 'spectate') {
    for (let i = 0; i < n; i++)
      balls.push(mkBall(false, -1, roster[i].name, roster[i].color, 0.93 + jr() * 0.06, i, n, jr));
    players = [balls[0]];
    return balls;
  }
  const arr = activeDiff().ai, lo = arr[0], hi = arr[arr.length - 1];
  const pSlots = [Math.floor((n - 1) / 2)];
  const aiDefs = roster.slice(pSlots.length);
  let ai = 0;
  for (let i = 0; i < n; i++) {
    const ps = pSlots.indexOf(i);
    if (ps >= 0) {
      balls.push(mkBall(true, ps, roster[ps].name, roster[ps].color, 1, i, n, jr));
      players.push(balls[balls.length - 1]);
    } else {
      const d = aiDefs[ai % aiDefs.length];
      const t = n - pSlots.length > 1 ? ai / (n - pSlots.length - 1) : 0;
      const skill = clamp(hi - (hi - lo) * t + (jr() - 0.5) * 0.04, 0.40, 0.99);
      balls.push(mkBall(false, -1, d.name, d.color, skill, i, n, jr));
      ai++;
    }
  }
  return balls;
}
function mkBall(isP, pi, name, color, skill, slot, total, jr) {
  return { isPlayer: isP, pi, name, color, skill,
    x: lerp(WALL + 95, W - WALL - 95, total === 1 ? 0.5 : slot / (total - 1)), y: 118, vx: 0, vy: 0,
    phase: jr() * TAU, wf: 0.5 + jr() * 1.1, wa: (1 - skill) * 60 + 8, laneOff: (jr() - 0.5) * 76,
    finished: false, finishTime: 0, falls: 0, slowT: 0, stuck2: 0, falling: null, fallScale: 1,
    trail: [], spin: 0, _camY: null, _shake: 0 };
}

/* ================= 碰撞 ================= */
function resolveCircleRect(b, rect, vpx, vpy) {
  const cx = clamp(b.x, rect.x, rect.x + rect.w), cy = clamp(b.y, rect.y, rect.y + rect.h);
  let dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  let nx, ny, pen;
  if (d2 > 1e-6) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = R - d; }
  else {
    const dl = b.x - rect.x, dr = rect.x + rect.w - b.x, dt2 = b.y - rect.y, db = rect.y + rect.h - b.y;
    const m = Math.min(dl, dr, dt2, db);
    nx = m === dl ? -1 : m === dr ? 1 : 0; ny = m === dt2 ? -1 : m === db ? 1 : 0; pen = R + m;
  }
  b.x += nx * pen; b.y += ny * pen;
  const rvx = b.vx - (vpx || 0), rvy = b.vy - (vpy || 0);
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const e = 0.22;
    b.vx = rvx - (1 + e) * vn * nx + (vpx || 0);
    b.vy = rvy - (1 + e) * vn * ny + (vpy || 0);
    noteHit(b, rect._owner || rect);
    if (-vn > 150) onImpact(b, -vn);
  }
}
function resolveRot(b, o) {
  const [wx, wy, lx, ly] = rotNearest(o, b.x, b.y);
  const dx = b.x - wx, dy = b.y - wy, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  let nx, ny;
  if (d2 > 1e-6) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; }
  else { const sg = ly >= 0 ? 1 : -1; const s = Math.sin(o._a), c = Math.cos(o._a); nx = -sg * s; ny = sg * c; }
  b.x += nx * R; b.y += ny * R;
  const rx = wx - o.cx, ry = wy - o.cy;
  const svx = o._w * -ry, svy = o._w * rx;
  const rvx = b.vx - svx, rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const e = 0.30;
    b.vx = rvx - (1 + e) * vn * nx + svx;
    b.vy = rvy - (1 + e) * vn * ny + svy;
    noteHit(b, o);
    if (-vn > 150) onImpact(b, -vn);
  }
}
function resolveCircleObst(b, o) {
  const dx = b.x - o.cx, dy = b.y - o.cy, rr = R + o.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  b.x += nx * (rr - d); b.y += ny * (rr - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    noteHit(b, o);
    const e = o.type === 'bumper' ? 0.75 : 0.4;
    b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
    if (o.type === 'bumper') {
      b.vx += nx * 200; b.vy += ny * 200;
      o.hitT = simTime; sndBumper();
      spawnSparks(b.x, b.y, 6, '#ff9d9d');
    } else if (-vn > 200) onImpact(b, -vn);
  }
}
// 记录 AI 是否反复撞同一个障碍物（用于脱困）
function noteHit(b, o) {
  if (b.isPlayer || !o) return;
  if (b._lastObj === o && simTime - (b._lastHitT || -9) < 0.6) return;
  if (b._lastObj === o) b._hitN = (b._hitN || 0) + 1;
  else { b._hitN = 1; b._lastObj = o; }
  b._lastHitT = simTime;
}
function onImpact(b, imp) {
  if (imp > 420) spawnSparks(b.x, b.y, Math.min(10, imp / 90 | 0), '#ffe9a8');
  if (b.isPlayer) {
    if (imp > 160) sndImpact(imp);
    if (imp > 560) b._shake = Math.min(13, imp / 90);
  } else if (imp > 300) sndImpact(imp * 0.35);
}
function spawnSparks(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = 90 + Math.random() * 260;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45, ttl: 0.45, r: 2.2, color });
  }
}
function spawnConfetti(x, y) {
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * TAU, sp = 120 + Math.random() * 420;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140, life: 1.6, ttl: 1.6,
      r: 3 + Math.random() * 3, color: `hsl(${Math.random() * 360},90%,65%)` });
  }
}
function spotFree(x, y) {
  if (x < WALL + R + 2 || x > W - WALL - R - 2) return false;
  const [w0, w1] = obsWindow(y - 60, y + 60);
  for (let k = w0; k < w1; k++) {
    const o = track.obstacles[k];
    if (Math.abs(o._cy - y) > o._r + R + 10) continue;
    if (o.type === 'rect' || o.type === 'piston') {
      ensureKin(o);
      const r = o._rect || o;
      if (x > r.x - R - 2 && x < r.x + r.w + R + 2 && y > r.y - R - 2 && y < r.y + r.h + R + 2) return false;
    } else if (o.type === 'rot') {
      ensureKin(o);
      const [wx, wy] = rotNearest(o, x, y);
      if ((x - wx) ** 2 + (y - wy) ** 2 < (R + 4) ** 2) return false;
    } else if (o.type === 'peg' || o.type === 'bumper') {
      if ((x - o.cx) ** 2 + (y - o.cy) ** 2 < (R + o.r + 5) ** 2) return false;
    } else if (o.type === 'hole') {
      if ((x - o.cx) ** 2 + (y - o.cy) ** 2 < (o.r + R + 9) ** 2) return false;
    }
  }
  return true;
}

/* ================= AI ================= */
function obstacleSpan(o) {
  if (o.type === 'rect') return [o.y, o.y + o.h, o.x, o.x + o.w];
  if (o.type === 'piston') {
    const ext = o.min + o.amp * 0.55;
    return [o.y, o.y + o.h, o.side === 'L' ? WALL : W - WALL - ext, o.side === 'L' ? WALL + ext : W - WALL];
  }
  if (o.type === 'rot') {
    const hl = o.len / 2;
    return [o.cy - hl, o.cy + hl, o.cx - hl, o.cx + hl];
  }
  const r = o.r;
  return [o.cy - r, o.cy + r, o.cx - r, o.cx + r];
}
function collectRows(b, look) {
  const ahead = [];
  const [w0, w1] = obsWindow(b.y - 400, b.y + look);
  for (let k = w0; k < w1; k++) {
    const o = track.obstacles[k];
    if (o._cy - o._r > b.y + look + 60 || o._cy + o._r < b.y - 30) continue;
    const s = obstacleSpan(o);
    if (s[1] < b.y - 30 || s[0] > b.y + look) continue;
    ahead.push(s);
  }
  if (!ahead.length) return [];
  ahead.sort((p, q) => p[0] - q[0]);
  const rows = [];
  let i = 0;
  while (i < ahead.length && rows.length < 3) {
    const rowY = ahead[i][0];
    let j = i;
    while (j < ahead.length && ahead[j][0] < rowY + 60) j++;
    rows.push({ y: rowY, spans: ahead.slice(i, j) });
    i = j;
  }
  return rows;
}
function rowIntervals(row, L, Rt) {
  const spans = [];
  for (const s of row.spans) {
    const a = Math.max(s[2] - 12, L), c2 = Math.min(s[3] + 12, Rt);
    if (c2 > a) spans.push([a, c2]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  const ivs = []; let cur = L;
  for (const [s1, s2] of spans) {
    if (s1 > cur) ivs.push([cur, s1]);
    cur = Math.max(cur, s2);
  }
  if (cur < Rt) ivs.push([cur, Rt]);
  return ivs;
}
function aiForce(b) {
  const P = activeDiff();
  const isLv = mode === 'level';
  const lvT = isLv ? (currentLevel - 1) / (MAX_LEVEL - 1) : 0;
  let fx = Math.sin(simTime * b.wf + b.phase) * b.wa * 0.5;
  let fy = GY * (P.spd - 0.06 + 0.10 * b.skill) * (isLv ? 1.00 + lvT * 0.10 : 1);
  const look = 280 + 560 * b.skill;
  const L = WALL + R + 4, Rt = W - WALL - R - 4;
  const rows = collectRows(b, look);
  if (rows.length) {
    for (const r of rows) {
      r.ivs = rowIntervals(r, L, Rt);
      r.pass = r.ivs.filter(iv => iv[1] - iv[0] >= 2 * R + 8);
    }
    const depth = Math.min(rows.length, 1 + Math.round(b.skill * 2.2));
    const use = rows.slice(0, depth);
    let target = null, bestScore = 1e18;
    for (const iv of use[0].pass) {
      const c = (iv[0] + iv[1]) / 2;
      let score = Math.abs(c - b.x) + Math.abs(c - W / 2) * 0.2;
      let cur = c, dead = false;
      for (let ri = 1; ri < use.length; ri++) {
        const vGap = Math.max(40, use[ri].y - use[ri - 1].y);
        let bn = null;
        for (const jv of use[ri].pass) {
          const c2 = (jv[0] + jv[1]) / 2, dx = Math.abs(c2 - cur);
          if (dx < vGap * 1.15 + 80 && (!bn || dx < bn.dx)) bn = { c: c2, dx };
        }
        if (!bn) { dead = true; break; }
        score += bn.dx * 0.7; cur = bn.c;
      }
      if (dead) score += 2500;
      if (score < bestScore) { bestScore = score; target = c; }
    }
    if (target === null) {
      let wmax = 0;
      for (const iv of use[0].ivs) { const w = iv[1] - iv[0]; if (w > wmax) { wmax = w; target = (iv[0] + iv[1]) / 2; } }
      if (target === null) target = W / 2;
    }
    target = clamp(target + b.laneOff * (0.6 - 0.45 * b.skill) * (isLv ? 0.6 - lvT * 0.1 : 1), L + 8, Rt - 8);
    const steer = (430 + 520 * b.skill) * (isLv ? 1.05 + lvT * 0.15 : 1);
    fx += clamp((target - b.x) * 9 - b.vx * 1.4, -steer, steer);
    const rowDist = use[0].y - b.y;
    if (rowDist >= 0 && rowDist < 200 && Math.abs(target - b.x) > 140)
      fy *= lerp(isLv ? 0.68 + lvT * 0.06 : 0.55, 0.90, b.skill);
  }
  for (const o of balls) {
    if (o === b || o.falling !== null) continue;
    const dx = o.x - b.x, dy = o.y - b.y;
    if (dy > -10 && dy < 130 && Math.abs(dx) < 56)
      fx += (dx >= 0 ? -1 : 1) * 260 * (1 - dy / 130);
  }
  // 反复撞同一个障碍物：向侧方强力脱困
  if (b._lastObj && (b._hitN || 0) >= 2 && simTime - (b._lastHitT || -9) < 1.2) {
    const o = b._lastObj;
    const ocx = (o.cx !== undefined) ? o.cx : (o.x + (o.w || 0) / 2);
    const dir = b.x >= ocx ? 1 : -1;
    fx += dir * 950;
    fy *= 0.92;
  }
  if (!rows.length) fx += clamp((W / 2 - b.x) * 1.2, -180, 180);
  const m = 80;
  if (b.x < WALL + m) fx += (1 - (b.x - WALL) / m) * 520;
  if (b.x > W - WALL - m) fx -= (1 - (W - WALL - b.x) / m) * 520;
  return [clamp(fx, -1700, 1700), fy];
}

/* ================= 输入状态 ================= */
const keys1 = { left: 0, right: 0, up: 0, down: 0 };
const keys2 = { left: 0, right: 0, up: 0, down: 0 };
const joys = [{ pid: null, bx: 0, by: 0, dx: 0, dy: 0, x: 0, y: 0 }, { pid: null, bx: 0, by: 0, dx: 0, dy: 0, x: 0, y: 0 }];
const JOY_R = 58;
const btnState = [{ left: 0, right: 0 }, { left: 0, right: 0 }];
const btnPresses = new Map();
function syncBtnState() {
  btnState[0].left = btnState[0].right = 0;
  btnState[1].left = btnState[1].right = 0;
  for (const pr of btnPresses.values()) btnState[pr.p][pr.key] = 1;
}
function effKeys(b) {
  return { left: keys1.left | keys2.left, right: keys1.right | keys2.right,
    up: keys1.up | keys2.up, down: keys1.down | keys2.down };
}

/* ================= 物理 ================= */
function physics(dt) {
  for (const b of balls) {
    if (b.falling !== null) {
      b.falling -= dt; b.fallScale = Math.max(0.05, b.falling / 0.7);
      if (b.falling <= 0) {
        const h = b.fallHole;
        let ry = h.cy + h.r + R + 10;
        for (let i = 0; i < 24; i++) { if (spotFree(b.x, ry)) break; ry += 12; }
        b.x = clamp(b.x, WALL + R + 6, W - WALL - R - 6); b.y = ry;
        b.vx = 0; b.vy = 70; b.falling = null; b.fallScale = 1;
      }
      continue;
    }
    let fx = 0, fy = 0;
    if (!b.finished) {
      if (b.isPlayer) {
        const k = effKeys(b);
        const pi = 0;
        const j = joys[pi];
        let sx = (k.right - k.left);
        if (settings.ctrl === 'btn') {
          const bs = btnState[pi];
          if (bs.right > bs.left) sx = 1; else if (bs.left > bs.right) sx = -1;
        } else if (j.pid !== null && Math.abs(j.x) > 0.12) {
          sx = j.x;
        }
        fx = sx * 820;
        fy = GY;                       // 无刹车：始终向下加速
      } else { const f = aiForce(b); fx = f[0]; fy = f[1]; }
    } else { fy = GY * 0.25; }
    b.vx += fx * dt; b.vy += fy * dt;
    const drag = b.finished ? 3 : DRAG, f = Math.exp(-drag * dt);
    b.vx *= f; b.vy *= f;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAXV) { b.vx *= MAXV / sp; b.vy *= MAXV / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.spin += (sp / R) * dt * (b.vx >= 0 ? 1 : -1) * 0.6;
    if (!b.finished && b.y < trackLen) {
      b._progT = (b._progT || 0) + dt;
      if (b._progT >= 0.8) {
        const gain = b.y - (b._lastY ?? b.y);
        if (gain < 30) {
          b.stuck2++;
          if (b.stuck2 >= 2) {
            let found = null;
            search:
            for (const dist of [70, 140, 220, 320]) {
              for (let k = 0; k < 14; k++) {
                const ang = Math.random() * TAU;
                const nx = clamp(b.x + Math.cos(ang) * dist, WALL + R + 4, W - WALL - R - 4);
                const ny = b.y + Math.sin(ang) * dist;
                if (ny > b.y + 40 && spotFree(nx, ny)) { found = [nx, ny]; break search; }
              }
            }
            if (found) { b.x = found[0]; b.y = found[1]; b.vx = 0; b.vy = 140; b.trail.length = 0; }
            else { b.y += 260; b.vy = 140; b.vx *= 0.3; }
            b.stuck2 = 0;
          } else { b.vy += 320; b.vx += (Math.random() - 0.5) * 300; }
        } else b.stuck2 = Math.max(0, b.stuck2 - 1);
        b._lastY = b.y; b._progT = 0;
      }
      if (Math.abs(b.vy) < 90) {
        b.slowT += dt;
        if (b.slowT > 0.8) { b.vy += 420; b.vx += (Math.random() - 0.5) * 260; b.slowT = 0.25; }
      } else b.slowT = 0;
    } else { b.slowT = 0; b.stuck2 = 0; }
  }
  for (let it = 0; it < 2; it++) {
    for (const b of balls) {
      if (b.falling !== null) continue;
      const [w0, w1] = obsWindow(b.y - 660, b.y + 660);
      for (let k = w0; k < w1; k++) {
        const o = track.obstacles[k];
        if (Math.abs(o._cy - b.y) > o._r + 320) continue;
        if (o.type === 'rect') resolveCircleRect(b, o, 0, 0);
        else if (o.type === 'piston') { ensureKin(o); resolveCircleRect(b, o._rect, o._vx, 0); }
        else if (o.type === 'rot') { ensureKin(o); resolveRot(b, o); }
        else resolveCircleObst(b, o);
      }
      if (b.x < WALL + R) { b.x = WALL + R; if (b.vx < 0) b.vx *= -0.5; }
      if (b.x > W - WALL - R) { b.x = W - WALL - R; if (b.vx > 0) b.vx *= -0.5; }
    }
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], c = balls[j];
      if (a.falling !== null || c.falling !== null) continue;
      const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy, rr = 2 * R;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = (rr - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen; c.x += nx * pen; c.y += ny * pen;
      const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
      if (rel > 0) {
        const imp = (1 + 0.55) * rel / 2;
        a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny;
        if (Math.abs(ny) > 0.75 && rel < 140) {
          const kick = (Math.random() < 0.5 ? 1 : -1) * 130;
          a.vx += kick; c.vx -= kick;
        }
        if (rel > 240 && (a.isPlayer || c.isPlayer)) { sndImpact(rel); spawnSparks((a.x + c.x) / 2, (a.y + c.y) / 2, 4, '#fff'); }
      }
    }
  }
  for (const b of balls) {
    if (b.falling !== null || b.finished) continue;
    const [w0, w1] = obsWindow(b.y - 160, b.y + 160);
    for (let k = w0; k < w1; k++) {
      const o = track.obstacles[k];
      if (o.type !== 'hole') continue;
      if (Math.abs(o._cy - b.y) > o._r + R) continue;
      const dx = b.x - o.cx, dy = b.y - o.cy;
      if (dx * dx + dy * dy < (o.r - 4) ** 2) {
        b.falling = 0.7; b.fallHole = o; b.falls++;
        b.vx = 0; b.vy = 0;
        if (b.isPlayer) { sndHole(); b._shake = Math.max(b._shake, 6); }
        break;
      }
    }
  }
  for (const b of balls) {
    if (!b.finished && b.y >= trackLen) {
      b.finished = true; b.finishTime = raceTime;
      if (b.isPlayer) playerFinished(b);
      else if (mode === 'spectate' && state === 'race') {
        state = 'finishing';
        finishWaitEnd = raceTime + 30;
      }
    }
    if (b.y > trackLen + 520) { b.y = trackLen + 520; b.vy = Math.min(b.vy, 0); }
  }
  for (const b of balls) {
    if (b.falling !== null) { b.trail.length = 0; continue; }
    b.trail.push(b.x, b.y);
    if (b.trail.length > 34) b.trail.splice(0, 2);
  }
}

/* ================= 名次 ================= */
function standings() {
  return balls.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.y - a.y;
  });
}

/* ================= 流程控制 ================= */
function bestKey() { return 'marbleBest_' + lenKey + '_' + diffKey; }
function bestText() {
  if (mode === 'level') {
    const b = levelProgress.best[currentLevel];
    return '第 ' + currentLevel + ' 关最佳：' + (b ? fmtT(+b) : '--:--.-');
  }
  if (mode === 'invite') return inviteTime ? '好友成绩：' + fmtT(inviteTime) : '邀请好友，同赛道比时间';
  return '全 AI 观赛模式 · 不计成绩';
}
let resultsVisible = false;
let resTitleText = '完赛！';
let resNoteText = '';

function startRace(newSeed) {
  ensureAudio();
  if (mode === 'invite' && inviteSeed) seed = inviteSeed;
  else if (newSeed) seed = (Math.random() * 1e9) | 0;
  trackLen = mode === 'level' ? levelConfig(currentLevel).len : LENGTHS[lenKey].len;
  track = genTrack(seed, activeDiff().scale, trackLen);
  balls = makeBalls();
  ghostRecord = mode === 'invite' && players[0] ? [{ x: players[0].x, y: players[0].y }] : [];
  ghostRecT = 0;
  raceTime = 0; countdownT = 3.0; lastCount = 99; goT = -99;
  state = 'countdown'; paused = false; resultsFinal = false;
  settingsOpen = false; resultsVisible = false; backPrompt = false;
  screen = 'menu';
  ghostRecord = []; ghostRecT = 0;
  btnPresses.clear(); syncBtnState();
  for (const j of joys) { j.pid = null; j.dx = j.dy = j.x = j.y = 0; }
  particles.length = 0;
}
function goMenu() {
  state = 'menu'; paused = false; backPrompt = false;
  settingsOpen = false; resultsVisible = false;
  screen = 'menu';
  btnPresses.clear(); syncBtnState();
  particles.length = 0;
}
function playerFinished(b) {
  const st = standings(); const rank = st.indexOf(b) + 1;
  sndFinish(rank === 1);
  if (rank === 1) spawnConfetti(b.x, b.y);
  if (state !== 'finishing') {
    state = 'finishing';
    finishWaitEnd = raceTime + 8;
    resultsVisible = true;
    resTitleText = '完赛！';
    resNoteText = '其余弹珠仍在冲刺，名次实时更新……';
    for (const j of joys) { j.pid = null; j.dx = j.dy = j.x = j.y = 0; }
    btnPresses.clear(); syncBtnState();
  }
}
function renderResults(final) {
  const st = standings();
  if (final) {
    resultsFinal = true; state = 'results';
    const winner = st[0];
    if (mode === 'spectate') {
      resTitleText = '🏆 ' + winner.name + ' 夺冠！';
      resNoteText = '再来一局重新观赛，或换一条新赛道。';
    } else if (mode === 'level') {
      const p = players[0];
      const rank = st.indexOf(p) + 1;
      if (rank === 1) {
        resTitleText = '🏆 第 ' + currentLevel + ' 关通过！';
        const prev = levelProgress.best[currentLevel];
        if (!prev || p.finishTime < prev) levelProgress.best[currentLevel] = p.finishTime;
        if (currentLevel < MAX_LEVEL && levelProgress.unlocked < currentLevel + 1)
          levelProgress.unlocked = currentLevel + 1;
        saveLevels();
        uploadLevelStats();
        resNoteText = currentLevel >= MAX_LEVEL
          ? '全部 50 关通关，恭喜！用时 ' + fmtT(p.finishTime)
          : '用时 ' + fmtT(p.finishTime) + '，已解锁第 ' + (currentLevel + 1) + ' 关';
      } else {
        resTitleText = '挑战失败';
        resNoteText = '第 ' + currentLevel + ' 关需要拿到第 1 名才能解锁下一关，再试一次吧！';
      }
    } else if (mode === 'invite') {
      const p = players[0];
      const t = p.finished ? p.finishTime : 0;
      inviteLastTime = t || inviteLastTime;
      inviteGhostStr = encodeGhost(ghostRecord);
      if (inviteTime > 0 && t > 0) {
        const diff = Math.abs(t - inviteTime);
        if (t < inviteTime) {
          resTitleText = '🏆 你赢了！';
          resNoteText = '你的用时 ' + fmtT(t) + '，好友用时 ' + fmtT(inviteTime) + '，快了 ' + fmtT(diff);
        } else {
          resTitleText = '惜败！';
          resNoteText = '你的用时 ' + fmtT(t) + '，好友用时 ' + fmtT(inviteTime) + '，慢了 ' + fmtT(diff);
        }
      } else {
        resTitleText = '挑战完成';
        resNoteText = t > 0 ? '用时 ' + fmtT(t) + '，把成绩分享给好友一起比一比吧！' : '再来一局试试。';
      }
    } else {
      resTitleText = winner.isPlayer ? '🏆 冠军！' : '完赛！';
      const r = st.indexOf(players[0]) + 1;
      resNoteText = r === 1 ? '你击败了所有对手！' : '你获得了第 ' + r + ' 名，再试一次冲击冠军吧！';
      const prev = store.get(bestKey(), 0);
      const p = players[0];
      if (p.finished && (!prev || p.finishTime < +prev)) store.set(bestKey(), p.finishTime);
    }
    resultsVisible = true;
  }
}

/* ================= 绘制基础 ================= */
function pathRoundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function fillRoundRect(x, y, w, h, r, fill, stroke, lw) {
  pathRoundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}
function textCentered(text, x, y, font, color) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}
function wrapText(text, x, y, maxW, lineH, font, color) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let line = '', yy = y;
  for (const ch2 of text) {
    if (ctx.measureText(line + ch2).width > maxW && line) {
      ctx.fillText(line, x, yy); line = ch2; yy += lineH;
    } else line += ch2;
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}

/* ================= 世界渲染 ================= */
function drawWorld(yTop, yBot) {
  ctx.fillStyle = '#0d1626'; ctx.fillRect(0, yTop, W, yBot - yTop);
  ctx.fillStyle = 'rgba(140,190,255,0.028)';
  for (let gy = Math.floor(yTop / 88) * 88; gy < yBot; gy += 88) ctx.fillRect(WALL, gy, W - 2 * WALL, 2);
  ctx.strokeStyle = 'rgba(140,200,255,0.05)'; ctx.lineWidth = 10; ctx.lineCap = 'round';
  for (let gy = Math.floor(yTop / 300) * 300 + 140; gy < yBot; gy += 300) {
    ctx.beginPath();
    ctx.moveTo(W / 2 - 46, gy); ctx.lineTo(W / 2, gy + 34); ctx.lineTo(W / 2 + 46, gy);
    ctx.stroke();
  }
  ctx.fillStyle = '#16223f'; ctx.fillRect(0, yTop, WALL, yBot - yTop); ctx.fillRect(W - WALL, yTop, WALL, yBot - yTop);
  ctx.fillStyle = 'rgba(80,220,255,0.4)';
  ctx.fillRect(WALL - 3, yTop, 3, yBot - yTop); ctx.fillRect(W - WALL, yTop, 3, yBot - yTop);
  drawBand(170, '起点', 'rgba(230,240,255,0.75)', yTop, yBot);
  if (trackLen < yBot) drawFinish();
  const [dw0, dw1] = obsWindow(yTop - 200, yBot + 200);
  for (let k = dw0; k < dw1; k++) {
    const o = track.obstacles[k];
    if (o._cy < yTop - 180 || o._cy > yBot + 180) continue;
    drawObstacle(o, yTop, yBot);
  }
  for (const b of balls) {
    if (b.trail.length < 6 || b.falling !== null) continue;
    if (b.y < yTop - 80 || b.y > yBot + 80) continue;
    ctx.strokeStyle = b.color; ctx.lineCap = 'round';
    const n = b.trail.length / 2;
    for (let band = 0; band < 3; band++) {
      const i0 = Math.max(2, Math.floor(n * band / 3) * 2);
      const i1 = Math.min(b.trail.length - 2, Math.floor(n * (band + 1) / 3) * 2);
      if (i1 <= i0) continue;
      ctx.globalAlpha = ((band + 1) / 3) * 0.3;
      ctx.lineWidth = ((band + 1) / 3) * 7;
      ctx.beginPath();
      ctx.moveTo(b.trail[i0 - 2], b.trail[i0 - 1]);
      for (let i = i0; i <= i1; i += 2) ctx.lineTo(b.trail[i], b.trail[i + 1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (const b of balls) { if (b.y < yTop - 60 || b.y > yBot + 60) continue; drawBall(b); }
  drawGhostBall();
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.ttl);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawBand(y, label, color, yTop, yBot) {
  if (y + 120 < yTop || y > yBot) return;
  for (let i = 0; i < Math.ceil((W - 2 * WALL) / 22); i++)
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? color : '#12182b';
      ctx.fillRect(WALL + i * 22, y + j * 11, Math.min(22, W - WALL - (WALL + i * 22)), 11);
    }
  ctx.fillStyle = 'rgba(160,200,255,0.55)';
  ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, W / 2, y + 46);
}
function drawFinish() {
  const y = trackLen;
  for (let i = 0; i < Math.ceil((W - 2 * WALL) / 24); i++)
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#e6f0ff' : '#111a30';
      ctx.fillRect(WALL + i * 24, y + j * 24, Math.min(24, W - WALL - (WALL + i * 24)), 24);
    }
  ctx.save();
  ctx.shadowColor = '#6cd0ff'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#8fe0ff'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('终 点', W / 2, y + 72);
  ctx.restore();
}
function drawObstacle(o, yTop, yBot) {
  const oy = o._cy;
  if (oy < yTop - 180 || oy > yBot + 180) return;
  if (o.type === 'rot' || o.type === 'piston') ensureKin(o);
  if (o.type === 'rect') {
    fillRoundRect(o.x, o.y, o.w, o.h, 6, '#26375f', 'rgba(140,190,255,0.5)', 2);
  } else if (o.type === 'piston') {
    const r = o._rect; if (!r) return;
    fillRoundRect(r.x, r.y, r.w, r.h, 5, '#2c3f6e', 'rgba(140,190,255,0.4)', 2);
    ctx.fillStyle = '#ffd54a';
    if (o.side === 'L') ctx.fillRect(r.x + r.w - 4, r.y, 4, r.h); else ctx.fillRect(r.x, r.y, 4, r.h);
    ctx.strokeStyle = 'rgba(255,213,74,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const fx = o.side === 'L' ? r.x + r.w - 26 : r.x + 26, dir = o.side === 'L' ? -1 : 1;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(fx - dir * 8, r.y + r.h / 2 + k * 10 - 5); ctx.lineTo(fx + dir * 4, r.y + r.h / 2 + k * 10);
      ctx.lineTo(fx - dir * 8, r.y + r.h / 2 + k * 10 + 5); ctx.stroke();
    }
  } else if (o.type === 'rot') {
    ctx.save(); ctx.translate(o.cx, o.cy); ctx.rotate(o._a);
    const active = o.mode !== 'static';
    fillRoundRect(-o.len / 2, -o.thick / 2, o.len, o.thick, o.thick / 2,
      active ? '#ff6b9d' : '#3b4f7d', active ? 'rgba(255,209,230,0.9)' : 'rgba(160,190,240,0.5)', active ? 3 : 2);
    ctx.restore();
    ctx.fillStyle = '#ffd54a'; ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(o.cx, o.cy, 7, 0, TAU); ctx.fill(); ctx.stroke();
  } else if (o.type === 'peg') {
    ctx.fillStyle = '#a9c4f5'; ctx.strokeStyle = 'rgba(235,245,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath(); ctx.arc(o.cx - o.r * 0.3, o.cy - o.r * 0.3, o.r * 0.22, 0, TAU); ctx.fill();
  } else if (o.type === 'bumper') {
    const hit = simTime - (o.hitT || -9) < 0.25;
    if (hit) { ctx.shadowColor = '#ff5d5d'; ctx.shadowBlur = 22; }
    ctx.fillStyle = '#3a1620'; ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = hit ? '#ff8d8d' : '#ff5d5d';
    ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * 0.45, 0, TAU); ctx.fill();
  } else if (o.type === 'hole') {
    const g = ctx.createRadialGradient(o.cx, o.cy, 2, o.cx, o.cy, o.r);
    g.addColorStop(0, '#000'); g.addColorStop(0.75, '#05070f'); g.addColorStop(1, '#101a33');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,255,0.25)'; ctx.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      const a0 = simTime * 1.4 + k * Math.PI + o.cx * 0.01;
      ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * (0.4 + k * 0.28), a0, a0 + 2.1); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(140,190,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, TAU); ctx.stroke();
  }
}
const ballGradCache = {};
function ballGrad(color) {
  let g = ballGradCache[color];
  if (!g) {
    g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.15, 0, 0, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, color); g.addColorStop(1, shade(color, 0.45));
    ballGradCache[color] = g;
  }
  return g;
}
const nameCache = {};
function drawNameTag(b, hl) {
  const key = b.name + (hl ? '#h' : '');
  let c = nameCache[key];
  if (!c) {
    const w = Math.ceil(b.name.length * 13 + 10), h = 22;
    c = wx.createCanvas();
    c.width = w * 2; c.height = h * 2; c._w = w; c._h = h;
    const g = c.getContext('2d'); g.scale(2, 2);
    g.font = (hl ? 'bold ' : '') + '12px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = 'rgba(5,8,15,0.85)';
    g.strokeText(b.name, w / 2, h / 2 + 1);
    g.fillStyle = hl ? '#ffe9a8' : 'rgba(210,225,250,0.85)';
    g.fillText(b.name, w / 2, h / 2 + 1);
    nameCache[key] = c;
  }
  ctx.drawImage(c, b.x - c._w / 2, b.y - R - 10 - c._h + 5, c._w, c._h);
}
function drawBall(b) {
  const s = b.fallScale;
  if (s <= 0.06) return;
  const followed = mode === 'spectate' && players.includes(b);
  ctx.save();
  ctx.translate(b.x, b.y); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.save();
  ctx.translate(4, 7); ctx.scale(1.02, 0.92);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  ctx.restore();
  if (b.isPlayer || followed) { ctx.shadowColor = b.color; ctx.shadowBlur = 20; }
  ctx.fillStyle = ballGrad(b.color);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = shade(b.color, 0.3); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, R - 0.7, 0, TAU); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (const off of [0, Math.PI]) {
    ctx.beginPath();
    ctx.arc(Math.cos(b.spin + off) * R * 0.5, Math.sin(b.spin + off) * R * 0.5, 2.5, 0, TAU); ctx.fill();
  }
  if (Math.hypot(b.vx, b.vy) > 50) {
    ctx.save();
    ctx.rotate(Math.atan2(b.vy, b.vx));
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.beginPath();
    ctx.moveTo(R * 0.66, 0); ctx.lineTo(R * 0.2, -R * 0.4); ctx.lineTo(R * 0.33, 0); ctx.lineTo(R * 0.2, R * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(-R * 0.35, -R * 0.4, 3.4, 0, TAU); ctx.fill();
  ctx.restore();
  drawNameTag(b, b.isPlayer || followed);
  if ((b.isPlayer || followed) && state === 'race') {
    const bob = Math.sin(simTime * 5) * 3;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y - R - 30 + bob); ctx.lineTo(b.x - 7, b.y - R - 40 + bob); ctx.lineTo(b.x + 7, b.y - R - 40 + bob);
    ctx.closePath(); ctx.fill();
  }
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${r * f | 0},${g * f | 0},${b * f | 0})`;
}

/* ================= 单个视角 ================= */
function renderView(vx, vy, vw, vh, p, sIdx) {
  const sc = Math.min(vw / (W + 70), vh / 760);
  const viewW = vw / sc, viewH = vh / sc;
  const camX = W / 2 - viewW / 2;
  let cy = 0, shk = 0;
  if (!p) { cy = (menuCam % (trackLen + 600)) - 100; }
  else {
    const target = p.y + p.vy * 0.22 - viewH * 0.38;
    if (p._camY === null) p._camY = target - 60;
    p._camY += (target - p._camY) * 0.12;
    cy = clamp(p._camY, -80, trackLen + 700 - viewH);
    shk = p._shake; p._shake *= 0.88;
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
  ctx.translate(vx, vy);
  ctx.save();
  ctx.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk);
  ctx.scale(sc, sc); ctx.translate(-camX, -cy);
  drawWorld(cy - 100, cy + viewH + 100);
  ctx.restore();
  if (p) drawViewHUD(p, vx, vy, vw, vh, sIdx);
  if (state === 'countdown') drawCountdown(vx + vw / 2, vy + vh / 2);
  else if (state === 'race' && raceTime - goT < 0.9) drawGo(vx + vw / 2, vy + vh / 2);
  ctx.restore();
}
function drawViewHUD(p, vx, vy, vw, vh, sIdx) {
  sIdx = sIdx || 0;
  const st = standings();
  const rank = st.indexOf(p) + 1;
  if (mode === 'spectate' && spectateSplit) {
    const isSp = true;
    const active = sIdx === 1;
    ctx.fillStyle = 'rgba(8,14,28,0.66)';
    pathRoundRect(vx + 10, vy + 44, isSp ? 236 : 178, 56, 10); ctx.fill();
    ctx.strokeStyle = isSp && active ? 'rgba(255,213,74,0.85)' : 'rgba(90,130,200,0.35)';
    ctx.lineWidth = isSp && active ? 2 : 1; ctx.stroke(); ctx.lineWidth = 2;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(vx + 30, vy + 63, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = active ? '#e8f0ff' : '#93a7c9';
    ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
    const label = isSp ? (sIdx === 0 ? `屏1 · 榜首 ${p.name}` : `屏2 · ${p.name}`) : p.name;
    ctx.fillText(`${label}　第 ${rank} 名${isSp && active ? ' ▸点击' : ''}`, vx + 44, vy + 69);
    ctx.fillStyle = '#9fb6df'; ctx.font = '12px sans-serif';
    ctx.fillText(`${fmtT(raceTime)} · ${(Math.hypot(p.vx, p.vy) / 10).toFixed(1)} m/s`, vx + 26, vy + 90);
    return;
  }
  const spect = mode === 'spectate';
  ctx.fillStyle = 'rgba(8,14,28,0.62)';
  pathRoundRect(14, 46, spect ? 226 : 196, spect ? 124 : 108, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(90,130,200,0.35)'; ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(spect ? 36 : 30, 70, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = spect ? '#e8f0ff' : (rank === 1 ? '#ffd54a' : '#e8f0ff');
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(spect ? `观赛 · ${p.name}` : `第 ${rank} 名`, spect ? 52 : 30, spect ? 79 : 86);
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#9fb6df';
  if (spect) {
    ctx.fillText(`名次  第 ${rank} 名`, 30, 108);
    ctx.fillText(`时间  ${fmtT(raceTime)}　速度  ${(Math.hypot(p.vx, p.vy) / 10).toFixed(1)} m/s`, 30, 132);
    ctx.fillStyle = '#66809f'; ctx.font = '12px sans-serif';
    ctx.fillText('点击排名或点按画面切换视角', 30, 158);
  } else {
    ctx.fillText(`时间  ${fmtT(raceTime)}`, 30, 112);
    ctx.fillText(`速度  ${(Math.hypot(p.vx, p.vy) / 10).toFixed(1)} m/s`, 30, 138);
  }
  const bx = vw - 186;
  ctx.fillStyle = 'rgba(8,14,28,0.62)';
  pathRoundRect(bx - 14, 46, 200, 25 + balls.length * 26, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(90,130,200,0.35)'; ctx.stroke();
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#7e97c4';
  ctx.fillText('实时排名', bx, 70);
  st.forEach((b, i) => {
    const y = 94 + i * 26;
    const me = spect ? b === players[0] : b.isPlayer;
    if (me) { ctx.fillStyle = 'rgba(255,213,74,0.12)'; ctx.fillRect(bx - 8, y - 15, 184, 22); }
    if (spect) clickTargets.push({ x: bx - 8, y: y - 15, w: 184, h: 22, act: 'follow', i: balls.indexOf(b) });
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(bx, y - 5, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = me ? '#ffe9a8' : '#c3d3ef';
    ctx.font = (me ? 'bold ' : '') + '13px sans-serif';
    ctx.fillText(`${i + 1}  ${b.name}`, bx + 14, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7e97c4'; ctx.font = '12px sans-serif';
    ctx.fillText(b.finished ? fmtT(b.finishTime) : `剩${Math.max(0, (trackLen - b.y) / 10) | 0}m`, bx + 168, y);
    ctx.textAlign = 'left';
  });
}
function drawCountdown(cx, cy) {
  const n = Math.ceil(countdownT);
  const frac = countdownT - Math.floor(countdownT);
  ctx.fillStyle = 'rgba(4,8,18,0.35)'; ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(cx, cy);
  const sc = 0.8 + 0.5 * (1 - frac);
  ctx.scale(sc, sc);
  ctx.shadowColor = '#6cd0ff'; ctx.shadowBlur = 30;
  ctx.fillStyle = '#eaf4ff';
  ctx.font = 'bold 110px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(n > 0 ? n : '', 0, 0);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}
function drawGo(cx, cy) {
  const t = (raceTime - goT) / 0.9;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(0.8 + t * 0.5, 0.8 + t * 0.5);
  ctx.globalAlpha = 1 - t;
  ctx.shadowColor = '#ffd54a'; ctx.shadowBlur = 30;
  ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('GO!', 0, 0);
  ctx.restore();
  ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
}
function drawMinimap() {
  const bw = Math.min(cw * 0.62, 860), bh = 14;
  const bx = (cw - bw) / 2, by = 12;
  ctx.fillStyle = 'rgba(8,14,28,0.72)';
  pathRoundRect(bx - 10, by - 7, bw + 20, bh + 14, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(90,130,200,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  const x0 = bx + 6, x1 = bx + bw - 12, my = by + bh / 2;
  ctx.strokeStyle = 'rgba(120,160,220,0.4)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, my); ctx.lineTo(x1, my); ctx.stroke();
  ctx.fillStyle = 'rgba(200,220,255,0.6)';
  ctx.beginPath(); ctx.arc(x0, my, 3, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#e8f0ff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x1 + 7, my - 8); ctx.lineTo(x1 + 7, my + 8); ctx.stroke();
  ctx.fillStyle = '#ff5d5d';
  ctx.beginPath(); ctx.moveTo(x1 + 7, my - 8); ctx.lineTo(x1 + 16, my - 5); ctx.lineTo(x1 + 7, my - 2); ctx.closePath(); ctx.fill();
  for (const b of balls) {
    const t = clamp(b.y / trackLen, 0, 1);
    const x = lerp(x0, x1, t);
    const isCam = players.includes(b);
    if (isCam) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, my, 7.5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(x, my, 5, 0, TAU); ctx.fill();
  }
}
function drawBrand() {
  ctx.fillStyle = 'rgba(142,166,207,0.72)';
  ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('赛球弹珠竞速', 14, ch - 14);
}
function drawJoysticks() {
  for (const s of joySlots()) {
    const j = joys[s];
    const base = joyBase(s);
    const bx = base[0], by = base[1];
    ctx.globalAlpha = j.pid !== null ? 0.9 : 0.45;
    ctx.beginPath(); ctx.arc(bx, by, 66, 0, TAU);
    ctx.fillStyle = 'rgba(14,23,44,0.6)'; ctx.fill();
    ctx.strokeStyle = 'rgba(120,170,240,0.75)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + j.dx, by + j.dy, 30, 0, TAU);
    ctx.fillStyle = s === 0 ? 'rgba(255,213,74,0.85)' : 'rgba(108,208,255,0.85)';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
function drawButtons() {
  for (const bt of btnLayout()) {
    const on = btnState[bt.p][bt.key] > 0;
    ctx.globalAlpha = on ? 0.92 : 0.5;
    ctx.beginPath(); ctx.arc(bt.x, bt.y, bt.r, 0, TAU);
    ctx.fillStyle = 'rgba(14,23,44,0.62)'; ctx.fill();
    if (on) { ctx.fillStyle = bt.p === 0 ? 'rgba(255,213,74,0.20)' : 'rgba(108,208,255,0.20)'; ctx.fill(); }
    ctx.strokeStyle = bt.p === 0 ? 'rgba(255,213,74,0.8)' : 'rgba(108,208,255,0.8)';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = on ? '#ffe9a8' : (bt.p === 0 ? 'rgba(255,213,74,0.9)' : 'rgba(108,208,255,0.9)');
    ctx.font = `bold ${Math.round(bt.r * 0.8)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(bt.icon, bt.x, bt.y + 2);
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = 'alphabetic';
}
function drawBackButton() {
  const bw = 152, bh = 32, bx = cw - bw - 14, by = ch - bh - 14;
  ctx.fillStyle = 'rgba(8,14,28,0.66)';
  pathRoundRect(bx, by, bw, bh, 16); ctx.fill();
  ctx.strokeStyle = 'rgba(90,130,200,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#9fb6df'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('返回菜单', bx + bw / 2, by + 21);
  uiHits.push({ x: bx, y: by, w: bw, h: bh, act: 'back' });
}
function drawSettingsButton() {
  const bw = 86, bh = 30, bx = cw / 2 - bw / 2, by = ch - bh - 12;
  ctx.fillStyle = 'rgba(8,14,28,0.66)';
  pathRoundRect(bx, by, bw, bh, 15); ctx.fill();
  ctx.strokeStyle = 'rgba(90,130,200,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#9fb6df'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('设置', bx + bw / 2, by + 20);
  uiHits.push({ x: bx, y: by, w: bw, h: bh, act: 'open-settings' });
}
function drawBackPrompt() {
  ctx.fillStyle = 'rgba(4,8,18,0.6)'; ctx.fillRect(0, 0, cw, ch);
  const pw = 380, ph = 160, px = (cw - pw) / 2, py = (ch - ph) / 2;
  fillRoundRect(px, py, pw, ph, 14, '#0e1730', '#2b3f6b', 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8f0ff'; ctx.font = 'bold 20px sans-serif';
  ctx.fillText('返回主菜单？', cw / 2, py + 46);
  ctx.fillStyle = '#8ea6cf'; ctx.font = '14px sans-serif';
  ctx.fillText('当前比赛进度将不会保存', cw / 2, py + 74);
  const bw = 130, bh = 38, gy = py + 94;
  const nx = cw / 2 - bw - 12, yx = cw / 2 + 12;
  fillRoundRect(nx, gy, bw, bh, 10, '#0d1730', '#33508a', 1);
  ctx.fillStyle = '#9fb6df'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('取消', nx + bw / 2, gy + 24);
  uiHits.push({ x: nx, y: gy, w: bw, h: bh, act: 'prompt-no' });
  fillRoundRect(yx, gy, bw, bh, 10, 'rgba(255,213,74,0.15)', '#ffd54a', 1);
  ctx.fillStyle = '#ffd54a';
  ctx.fillText('确定返回', yx + bw / 2, gy + 24);
  uiHits.push({ x: yx, y: gy, w: bw, h: bh, act: 'prompt-yes' });
}

/* ================= Canvas UI：菜单 / 结算 / 设置 ================= */
let uiHits = [];
let uiScale = 1, uiOX = 0, uiOY = 0;
const UI_W = 430;
function pushHit(x, y, w, h, act, data) {
  uiHits.push({ x: uiOX + x * uiScale, y: uiOY + y * uiScale, w: w * uiScale, h: h * uiScale, act, data });
}
function beginUILayer(vh) {
  uiScale = Math.min(cw / UI_W, (ch - 16) / vh, 1.2);
  uiOX = (cw - UI_W * uiScale) / 2;
  uiOY = (ch - vh * uiScale) / 2;
  ctx.save();
  ctx.translate(uiOX, uiOY);
  ctx.scale(uiScale, uiScale);
}
function endUILayer() { ctx.restore(); }
function uiButton(x, y, w, h, label, active, act, data, opts) {
  opts = opts || {};
  const fill = active ? 'rgba(28,58,110,0.95)' : 'rgba(13,23,48,0.95)';
  fillRoundRect(x, y, w, h, opts.radius || h / 2, fill, active ? '#6cd0ff' : '#33508a', active ? 2 : 1);
  ctx.font = (opts.bold ? 'bold ' : '') + (opts.font || 14) + 'px sans-serif';
  ctx.fillStyle = active ? '#ffffff' : '#9fb6df';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  pushHit(x, y, w, h, act, data);
}
function drawMenuUI() {
  ctx.fillStyle = 'rgba(4,8,18,0.74)'; ctx.fillRect(0, 0, cw, ch);
  beginUILayer(780);
  const px = 14, py = 10, pw = 402, ph = 760;
  fillRoundRect(px, py, pw, ph, 18, 'rgba(10,17,34,0.92)', '#2b3f6b', 1);
  const cx = UI_W / 2;

  // 标题
  const tg = ctx.createLinearGradient(cx - 120, 0, cx + 120, 0);
  tg.addColorStop(0, '#ffd54a'); tg.addColorStop(0.45, '#ff8a5c'); tg.addColorStop(1, '#6cd0ff');
  ctx.font = 'bold 32px sans-serif'; ctx.fillStyle = tg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('赛球弹珠竞速', cx, 92);
  textCentered('MARBLE RUSH · 弹珠障碍追逐赛', cx, 118, '11px sans-serif', '#8ea6cf');

  // 简介
  wrapText('上帝视角弹珠竞速：冲下超长滑坡赛道，闪避风车、活塞、漏斗与黑洞，撞开对手抢线；赛道长度与 AI 难度自由组合。',
    px + 18, 146, pw - 36, 18, '12px sans-serif', '#c3d3ef');

  const bx0 = px + 16, bwAll = pw - 32;
  // 模式
  textCentered('模 式', cx, 212, '11px sans-serif', '#7e97c4');
  const modes = [['level', '关卡'], ['invite', '邀请'], ['spectate', '观赛']];
  const mw = (bwAll - 12) / 3;
  modes.forEach((m, i) => uiButton(bx0 + i * (mw + 6), 222, mw, 34, m[1], mode === m[0], 'mode', m[0], { font: 14 }));

  if (mode === 'level') {
    const cleared = Object.keys(levelProgress.best).length;
    textCentered('关卡模式 · 难度从噩梦起步，逐关递增', cx, 286, '11px sans-serif', '#7e97c4');
    textCentered('已解锁第 ' + levelProgress.unlocked + ' 关 · 已通关 ' + cleared + ' / ' + MAX_LEVEL,
      cx, 310, '12px sans-serif', '#ffe9a8');
    uiButton(cx - 120, 326, 240, 34, '选择关卡（第 ' + currentLevel + ' 关）', true, 'open-levels', null, { font: 13 });
  } else {
    // 赛道长度
    textCentered('赛道长度', cx, 282, '11px sans-serif', '#7e97c4');
    const lens = [['short', '短 ≈40秒'], ['medium', '中 ≈1分30'], ['long', '长 ≈2分钟'], ['xl', '超长 ≈3分钟']];
    const lw = (bwAll - 18) / 4;
    lens.forEach((l, i) => uiButton(bx0 + i * (lw + 6), 292, lw, 32, l[1], lenKey === l[0], 'len', l[0], { font: 12 }));

    // AI 难度
    textCentered('AI 难度（人机强度 · 机关密度）', cx, 346, '11px sans-serif', '#7e97c4');
    const ais = [['easy', '简单'], ['normal', '普通'], ['hard', '困难'], ['nightmare', '噩梦']];
    const aw = (bwAll - 18) / 4;
    ais.forEach((a, i) => uiButton(bx0 + i * (aw + 6), 356, aw, 32, a[1], diffKey === a[0], 'ai', a[0], { font: 12 }));
  }

  // 小球数量
  if (mode === 'level') {
    textCentered('小球数量', cx, 410, '11px sans-serif', '#7e97c4');
    textCentered('关卡模式固定 6 颗球', cx, 438, '13px sans-serif', '#ffe9a8');
  } else {
    textCentered('小球数量（1-10，颜色各不相同）', cx, 410, '11px sans-serif', '#7e97c4');
    const step = bwAll / 10;
    for (let i = 1; i <= 10; i++) {
      const ccx = bx0 + step * (i - 0.5), ccy = 434;
      const on = ballCount === i;
      ctx.beginPath(); ctx.arc(ccx, ccy, 15, 0, TAU);
      ctx.fillStyle = on ? 'rgba(28,58,110,0.95)' : 'rgba(13,23,48,0.95)';
      ctx.fill();
      ctx.strokeStyle = on ? '#6cd0ff' : '#33508a'; ctx.lineWidth = on ? 2 : 1; ctx.stroke();
      ctx.font = '13px sans-serif'; ctx.fillStyle = on ? '#fff' : '#9fb6df';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i), ccx, ccy + 1);
      ctx.textBaseline = 'alphabetic';
      pushHit(ccx - 17, ccy - 17, 34, 34, 'count', i);
    }
  }

  // 选手命名
  textCentered('选手命名（点击方框改名）', cx, 470, '11px sans-serif', '#7e97c4');
  const cols = 5, cellW = (bwAll - 4 * 6) / cols;
  const shownCount = mode === 'level' ? LEVEL_BALLS : ballCount;
  for (let i = 0; i < 10; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const nx = bx0 + c * (cellW + 6), ny = 480 + r * 36;
    const on = i < shownCount;
    fillRoundRect(nx, ny, cellW, 30, 8, '#0d1730', '#24365e', 1);
    ctx.globalAlpha = on ? 1 : 0.32;
    ctx.fillStyle = BALL_POOL[i].color;
    ctx.beginPath(); ctx.arc(nx + 11, ny + 15, 5, 0, TAU); ctx.fill();
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#e8f0ff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(customNames[i], nx + 21, ny + 16);
    ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    pushHit(nx, ny, cellW, 30, 'name', i);
  }

  // 开始 / 设置
  const sbw = Math.min(260, bwAll - 40);
  const sbx = cx - sbw / 2, sby = 560;
  const sg = ctx.createLinearGradient(sbx, sby, sbx + sbw, sby + 52);
  sg.addColorStop(0, '#ffd54a'); sg.addColorStop(1, '#ffb14a');
  fillRoundRect(sbx, sby, sbw, 52, 12, sg);
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#08111f';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(mode === 'level' ? '选择关卡 ▶' : mode === 'invite' ? '邀请好友 ▶' : '开始比赛 ▶', cx, sby + 27);
  ctx.textBaseline = 'alphabetic';
  pushHit(sbx, sby, sbw, 52, mode === 'level' ? 'open-levels' : mode === 'invite' ? 'open-invite' : 'start');

  const lbw = 118;
  uiButton(cx - 185, 628, lbw, 34, '设置', false, 'open-settings', null, { font: 13 });
  uiButton(cx - 59, 628, lbw, 34, '排行榜', false, 'open-rank', null, { font: 13 });
  uiButton(cx + 67, 628, lbw, 34, '分享好友', false, 'share', null, { font: 13 });

  textCentered(bestText(), cx, 686, '12px sans-serif', '#7e97c4');
  textCentered('关卡模式共 50 关，难度从噩梦起步逐关提升', cx, 716, '11px sans-serif', '#66809f');
  textCentered('默认左右按钮操作 · 邀请好友同赛道比用时', cx, 736, '11px sans-serif', '#66809f');
  endUILayer();
}
/* ---------- 关卡选择界面 ---------- */
function drawLevelsUI() {
  ctx.fillStyle = 'rgba(4,8,18,0.78)'; ctx.fillRect(0, 0, cw, ch);
  beginUILayer(440);
  const px = 14, py = 10, pw = 402, ph = 420;
  fillRoundRect(px, py, pw, ph, 18, 'rgba(10,17,34,0.96)', '#2b3f6b', 1);
  const cx = UI_W / 2;
  ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = '#e8f0ff'; ctx.textAlign = 'center';
  ctx.fillText('关卡模式', cx, 50);
  textCentered('难度从噩梦起步，逐关递增 · 每关约 1 分钟', cx, 76, '11px sans-serif', '#8ea6cf');

  const pageCount = Math.ceil(MAX_LEVEL / 10);
  levelPage = clamp(levelPage, 0, pageCount - 1);
  textCentered('第 ' + (levelPage + 1) + ' / ' + pageCount + ' 页', cx, 102, '11px sans-serif', '#6cd0ff');

  const cols = 5, gap = 8;
  const cellW = (pw - 32 - gap * (cols - 1)) / cols;
  for (let i = 0; i < 10; i++) {
    const lv = levelPage * 10 + i + 1;
    if (lv > MAX_LEVEL) break;
    const r = Math.floor(i / cols), c = i % cols;
    const x = px + 16 + c * (cellW + gap), y = 116 + r * 84;
    const unlocked = lv <= levelProgress.unlocked;
    const best = levelProgress.best[lv];
    fillRoundRect(x, y, cellW, 76, 10,
      unlocked ? 'rgba(13,23,48,0.98)' : 'rgba(13,23,48,0.55)',
      lv === currentLevel ? '#ffd54a' : unlocked ? '#33508a' : '#22314f', lv === currentLevel ? 2 : 1);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = unlocked ? (lv === currentLevel ? '#ffd54a' : '#e8f0ff') : '#5b6c8c';
    ctx.fillText(String(lv), x + cellW / 2, y + 32);
    ctx.font = '9px sans-serif';
    if (!unlocked) { ctx.fillStyle = '#5b6c8c'; ctx.fillText('未解锁', x + cellW / 2, y + 54); }
    else if (best) { ctx.fillStyle = '#7ec9a9'; ctx.fillText(fmtT(best), x + cellW / 2, y + 54); }
    else { ctx.fillStyle = '#9fb6df'; ctx.fillText('可挑战', x + cellW / 2, y + 54); }
    if (unlocked) pushHit(x, y, cellW, 76, 'level', lv);
  }

  const bw = 112, by = 292;
  uiButton(px + 16, by, bw, 34, '上一页', false, 'level-prev', null, { font: 13 });
  uiButton(px + pw - 16 - bw, by, bw, 34, '下一页', false, 'level-next', null, { font: 13 });
  uiButton(px + 16, 342, 140, 40, '好友排行', false, 'open-rank', null, { font: 14 });
  uiButton(px + pw - 156, 342, 140, 40, '返回', false, 'level-back', null, { font: 14 });
  endUILayer();
}

/* ---------- 好友排行榜界面 ---------- */
function enterRank() {
  screen = 'rank';
  try {
    const oc = wx.getOpenDataContext ? wx.getOpenDataContext() : null;
    if (!oc) return;
    const sc = oc.canvas;
    const w = 764, h = 1040;
    if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
    oc.postMessage({ type: 'show', width: w, height: h });
  } catch (e) { /* 测试号可能不支持 */ }
}
function drawRankUI() {
  ctx.fillStyle = 'rgba(4,8,18,0.78)'; ctx.fillRect(0, 0, cw, ch);
  beginUILayer(770);
  const px = 14, py = 10, pw = 402, ph = 750;
  fillRoundRect(px, py, pw, ph, 18, 'rgba(10,17,34,0.96)', '#2b3f6b', 1);
  const cx = UI_W / 2;
  ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = '#e8f0ff'; ctx.textAlign = 'center';
  ctx.fillText('好友排行', cx, 54);
  textCentered('按已通关关卡数排序，同关卡数比最快通关用时', cx, 80, '11px sans-serif', '#8ea6cf');

  const rx = 24, ry = 100, rw = 382, rh = 520;
  fillRoundRect(rx, ry, rw, rh, 12, 'rgba(8,14,28,0.6)', '#24365e', 1);
  let drew = false;
  try {
    const oc = wx.getOpenDataContext ? wx.getOpenDataContext() : null;
    if (oc && oc.canvas && oc.canvas.width > 0) {
      ctx.drawImage(oc.canvas, rx, ry, rw, rh);
      drew = true;
    }
  } catch (e) { /* 忽略 */ }
  if (!drew) {
    textCentered('排行榜需在小游戏真机环境中查看', cx, ry + rh / 2, '12px sans-serif', '#8ea6cf');
  }

  uiButton(cx - 150, 640, 300, 38, '刷新', false, 'rank-refresh', null, { font: 13 });
  uiButton(cx - 70, 690, 140, 38, '返回', false, 'rank-back', null, { font: 14 });
  endUILayer();
}

/* ---------- 邀请好友界面 ---------- */
function drawInviteUI() {
  ctx.fillStyle = 'rgba(4,8,18,0.78)'; ctx.fillRect(0, 0, cw, ch);
  beginUILayer(520);
  const px = 14, py = 10, pw = 402, ph = 500;
  fillRoundRect(px, py, pw, ph, 18, 'rgba(10,17,34,0.96)', '#2b3f6b', 1);
  const cx = UI_W / 2;
  ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = '#e8f0ff'; ctx.textAlign = 'center';
  ctx.fillText('邀请好友', cx, 52);
  const fromFriend = inviteTime > 0 || ghostSamples.length > 0;
  textCentered(fromFriend ? '这是好友玩过的赛道 · 挑战好友成绩' : '双方在完全相同的赛道上比用时',
    cx, 78, '11px sans-serif', fromFriend ? '#ffd54a' : '#8ea6cf');
  wrapText('点击「分享邀请卡」发给好友，对方点开卡片后会自动进入同一条赛道；跑完后把成绩再分享回去，就能比出胜负。',
    px + 24, 104, pw - 48, 18, '12px sans-serif', '#c3d3ef');

  textCentered('当前配置：' + LENGTHS[lenKey].label + ' · ' + AILVLS[diffKey].label + ' · ' + ballCount + ' 颗球',
    cx, 176, '12px sans-serif', '#ffe9a8');
  if (inviteTime > 0) textCentered('好友成绩：' + fmtT(inviteTime), cx, 196, '12px sans-serif', '#6cd0ff');
  else if (inviteLastTime > 0) textCentered('我的成绩：' + fmtT(inviteLastTime), cx, 196, '12px sans-serif', '#6cd0ff');
  if (ghostSamples.length) textCentered('好友幽灵已就位 · 比赛中会和它一起跑', cx, 214, '11px sans-serif', '#7ec9a9');

  uiButton(cx - 150, 220, 300, 50, '开始挑战 ▶', true, 'start-invite', null, { bold: true, font: 17, radius: 12 });
  uiButton(cx - 150, 282, 300, 44, '分享邀请卡给好友', false, 'share-invite', null, { radius: 10, font: 14 });
  uiButton(cx - 150, 334, 300, 36, '换一条新赛道', false, 'new-invite', null, { radius: 10, font: 13 });
  uiButton(cx - 70, 386, 140, 40, '返回', false, 'invite-back', null, { font: 14 });
  endUILayer();
}

function drawResultsUI() {
  ctx.fillStyle = 'rgba(4,8,18,0.78)'; ctx.fillRect(0, 0, cw, ch);
  beginUILayer(800);
  const px = 18, pw = 394;
  const py = 100, ph = 680;
  fillRoundRect(px, py, pw, ph, 18, 'rgba(10,17,34,0.96)', '#2b3f6b', 1);
  const cx = UI_W / 2;
  textCentered('赛球弹珠竞速', cx, py + 32, '12px sans-serif', '#6cd0ff');
  ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#e8f0ff'; ctx.textAlign = 'center';
  ctx.fillText(resTitleText, cx, py + 72);
  wrapText(resNoteText, px + 22, py + 98, pw - 44, 18, '12px sans-serif', '#8ea6cf');
  const st = standings();
  const top = py + 150;
  ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#7e97c4'; ctx.textAlign = 'left';
  ctx.fillText('名次', px + 26, top);
  ctx.fillText('选手', px + 86, top);
  ctx.textAlign = 'right';
  ctx.fillText('用时', px + pw - 90, top);
  ctx.fillText('落坑', px + pw - 30, top);
  ctx.strokeStyle = '#2b3f6b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 22, top + 8); ctx.lineTo(px + pw - 22, top + 8); ctx.stroke();
  const rowH = st.length > 6 ? 27 : 34;
  st.forEach((b, i) => {
    const y = top + 34 + i * rowH;
    const me = b.isPlayer || (mode === 'spectate' && players.includes(b));
    if (me) { ctx.fillStyle = 'rgba(255,213,74,0.10)'; ctx.fillRect(px + 16, y - 20, pw - 32, 30); }
    ctx.textAlign = 'left';
    ctx.font = '13px sans-serif'; ctx.fillStyle = me ? '#ffe9a8' : '#c3d3ef';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    ctx.fillText(medal, px + 26, y);
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(px + 92, y - 4, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = me ? '#ffe9a8' : '#c3d3ef';
    ctx.fillText(b.name, px + 104, y);
    ctx.textAlign = 'right';
    ctx.fillText(b.finished ? fmtT(b.finishTime) : '未完赛', px + pw - 90, y);
    ctx.fillText(String(b.falls), px + pw - 30, y);
  });
  ctx.textAlign = 'center';
  const by = top + 34 + Math.min(st.length, 10) * rowH + 20;
  uiButton(px + 40, by, pw - 80, 46, mode === 'level' ? '再次挑战' : mode === 'invite' ? '再来一次' : '再来一局',
    true, 'again', null, { bold: true, font: 17, radius: 12 });
  if (mode === 'level') uiButton(px + 40, by + 56, pw - 80, 38, '选择关卡', false, 'to-levels', null, { radius: 10 });
  else if (mode === 'invite') uiButton(px + 40, by + 56, pw - 80, 38, '分享成绩', false, 'share-invite', null, { radius: 10 });
  else uiButton(px + 40, by + 56, pw - 80, 38, '换新赛道', false, 'new', null, { radius: 10 });
  uiButton(px + 40, by + 102, pw - 80, 38, '返回菜单', false, 'menu', null, { radius: 10 });
  endUILayer();
}
function drawSettingsUI() {
  ctx.fillStyle = 'rgba(4,8,18,0.78)'; ctx.fillRect(0, 0, cw, ch);
  beginUILayer(660);
  const px = 20, pw = 390, py = 110, ph = 520;
  fillRoundRect(px, py, pw, ph, 18, 'rgba(10,17,34,0.96)', '#2b3f6b', 1);
  const cx = UI_W / 2;
  textCentered('赛球弹珠竞速', cx, py + 32, '12px sans-serif', '#6cd0ff');
  ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#e8f0ff'; ctx.textAlign = 'center';
  ctx.fillText('设 置', cx, py + 72);
  textCentered('操作方式与音效会自动保存在本机', cx, py + 98, '12px sans-serif', '#8ea6cf');

  textCentered('操作方式（手机触屏）', cx, py + 140, '11px sans-serif', '#7e97c4');
  const bwAll = pw - 60, bw = (bwAll - 10) / 2, bx0 = px + 30;
  uiButton(bx0, py + 152, bw, 40, '虚拟摇杆', settings.ctrl === 'joy', 'ctrl', 'joy');
  uiButton(bx0 + bw + 10, py + 152, bw, 40, '左右按钮', settings.ctrl === 'btn', 'ctrl', 'btn');
  const desc = settings.ctrl === 'btn'
    ? '按钮：屏幕下方 ◀=左转、▶=右转，按住即可转向，可左右同时按'
    : '摇杆：左下角左右推动转向，推得越满转得越急';
  wrapText(desc, px + 26, py + 222, pw - 52, 17, '11px sans-serif', '#7ec9a9');

  textCentered('音效音量', cx, py + 274, '11px sans-serif', '#7e97c4');
  const sx0 = px + 30, sx1 = px + pw - 78, sy = py + 296;
  ctx.strokeStyle = '#33508a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.stroke();
  const kx = sx0 + (sx1 - sx0) * settings.vol;
  ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(kx, sy); ctx.stroke();
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath(); ctx.arc(kx, sy, 11, 0, TAU); ctx.fill();
  ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#ffe9a8'; ctx.textAlign = 'left';
  ctx.fillText(Math.round(settings.vol * 100) + '%', sx1 + 16, sy + 5);
  pushHit(px + 20, sy - 22, pw - 40, 44, 'volume');

  const hbw = (bwAll - 10) / 2;
  uiButton(bx0, py + 334, hbw, 38, settings.mute ? '音效 关' : '音效 开', !settings.mute, 'mute', null);
  uiButton(bx0 + hbw + 10, py + 334, hbw, 38, '🔊 试听', false, 'test', null);
  uiButton(px + 50, py + 400, pw - 100, 44, '关闭 ✕', false, 'close', null, { radius: 12, font: 16 });
  endUILayer();
}

/* ================= 触控 ================= */
function joySlots() {
  if (state === 'menu' || paused || backPrompt || settingsOpen || resultsVisible) return [];
  if (mode === 'level' || mode === 'invite') return [0];
  return [];
}
function joyBase(i) { return i === 0 ? [116, ch - 128] : [cw - 116, ch - 128]; }
function joyHit(x, y) {
  for (const s of joySlots()) {
    const b = joyBase(s);
    if (Math.hypot(x - b[0], y - b[1]) < 90) return s;
  }
  return -1;
}
function joyMove(j, x, y) {
  const dx = x - j.bx, dy = y - j.by;
  const d = Math.hypot(dx, dy) || 1;
  const cl = Math.min(d, JOY_R);
  j.dx = dx / d * cl;
  j.dy = 0;                        // 只有左右转向，没有上下刹车
  j.x = j.dx / JOY_R; j.y = 0;
}
function btnSlots() {
  if (settings.ctrl !== 'btn') return false;
  if (state === 'menu' || paused || backPrompt || settingsOpen || resultsVisible) return false;
  return mode === 'level' || mode === 'invite';
}
function btnLayout() {
  const r = cw < 430 ? 46 : 54, cy = ch - (r + 66);
  return [{ p: 0, key: 'left', x: 88, y: cy, r, icon: '◀' },
          { p: 0, key: 'right', x: cw - 88, y: cy, r, icon: '▶' }];
}
function btnHit(x, y) {
  if (!btnSlots()) return null;
  for (const bt of btnLayout()) if (Math.hypot(x - bt.x, y - bt.y) < bt.r + 16) return bt;
  return null;
}
function hitTest(x, y) {
  for (let i = uiHits.length - 1; i >= 0; i--) {
    const h = uiHits[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
  }
  return null;
}
function editName(i) {
  editingName = i;
  try {
    wx.showKeyboard({ defaultValue: customNames[i] || '', maxLength: 6, multiple: false, confirmHold: false, confirmType: 'done' });
  } catch (e) { editingName = -1; }
}
function applyName(v) {
  if (editingName < 0) return;
  const t = (v || '').trim();
  customNames[editingName] = t ? t.slice(0, 6) : BALL_POOL[editingName].name;
  saveRoster();
  editingName = -1;
}
if (wx.onKeyboardConfirm) wx.onKeyboardConfirm(e => { applyName(e.value); try { wx.hideKeyboard(); } catch (err) {} });
if (wx.onKeyboardComplete) wx.onKeyboardComplete(e => { applyName(e.value); });

let sliderDragId = null;
function handleUIHit(h, x, y) {
  if (!h) return false;
  switch (h.act) {
    case 'mode': mode = h.data; return true;
    case 'len': lenKey = h.data; return true;
    case 'ai': diffKey = h.data; return true;
    case 'count': ballCount = h.data; saveRoster(); return true;
    case 'name': editName(h.data); return true;
    case 'start': if (mode === 'invite') startInviteRace(); else startRace(false); return true;
    case 'open-levels':
      mode = 'level';
      screen = 'levels';
      levelPage = Math.floor((clamp(currentLevel, 1, MAX_LEVEL) - 1) / 10);
      return true;
    case 'level':
      if (h.data <= levelProgress.unlocked) {
        currentLevel = h.data;
        mode = 'level';
        seed = 7919 * currentLevel + 12345;
        screen = 'menu';
        startRace(false);
      }
      return true;
    case 'level-prev': levelPage = Math.max(0, levelPage - 1); return true;
    case 'level-next': levelPage = Math.min(Math.ceil(MAX_LEVEL / 10) - 1, levelPage + 1); return true;
    case 'level-back': screen = 'menu'; return true;
    case 'to-levels':
      resultsVisible = false;
      state = 'menu';
      mode = 'level';
      screen = 'levels';
      levelPage = Math.floor((currentLevel - 1) / 10);
      return true;
    case 'open-invite': enterInvite(); return true;
    case 'start-invite': startInviteRace(); return true;
    case 'share-invite': shareChallenge(); return true;
    case 'new-invite': inviteSeed = (Math.random() * 1e9) | 0; inviteTime = 0; inviteLastTime = 0; ghostSamples = []; inviteGhostStr = ''; return true;
    case 'invite-back': screen = 'menu'; return true;
    case 'open-rank': rankFrom = screen; enterRank(); return true;
    case 'rank-back':
      screen = rankFrom === 'levels' ? 'levels' : 'menu';
      try { const oc = wx.getOpenDataContext && wx.getOpenDataContext(); if (oc) oc.postMessage({ type: 'hide' }); } catch (e) {}
      return true;
    case 'rank-refresh':
      try { const oc = wx.getOpenDataContext && wx.getOpenDataContext(); if (oc) oc.postMessage({ type: 'refresh' }); } catch (e) {}
      return true;
    case 'open-settings':
      settingsOpen = true;
      for (const j of joys) { j.pid = null; j.dx = j.dy = j.x = j.y = 0; }
      btnPresses.clear(); syncBtnState();
      return true;
    case 'again': startRace(false); return true;
    case 'new': startRace(true); return true;
    case 'menu': goMenu(); return true;
    case 'ctrl': settings.ctrl = h.data; btnPresses.clear(); syncBtnState(); saveSettings(); return true;
    case 'mute': settings.mute = !settings.mute; muted = settings.mute; saveSettings(); if (!settings.mute) { ensureAudio(); sndBeep(); } return true;
    case 'test': ensureAudio(); sndBeep(); return true;
    case 'share': doShare(); return true;
    case 'close': settingsOpen = false; return true;
    case 'volume': updateVolume(x); sliderDragId = -1; return true;
    case 'back': backPrompt = true; return true;
    case 'prompt-no': backPrompt = false; return true;
    case 'prompt-yes': backPrompt = false; goMenu(); return true;
    default: return false;
  }
}
function updateVolume(x) {
  const vx = (x - uiOX) / uiScale;
  const sx0 = 20 + 30, sx1 = 20 + 390 - 78;
  settings.vol = clamp((vx - sx0) / (sx1 - sx0), 0, 1);
  applyVolume(); saveSettings();
}
function onTouchStart(x, y, id) {
  ensureAudio();
  if (settingsOpen) {
    const h = hitTest(x, y);
    if (h && h.act === 'volume') { sliderDragId = id; updateVolume(x); return; }
    if (handleUIHit(h, x, y)) return;
    return;
  }
  if (state === 'menu') { handleUIHit(hitTest(x, y), x, y); return; }
  if (resultsVisible) { handleUIHit(hitTest(x, y), x, y); return; }
  if (backPrompt) { handleUIHit(hitTest(x, y), x, y); return; }
  if (settings.ctrl === 'btn') {
    const bt = btnHit(x, y);
    if (bt) { btnPresses.set(id, { p: bt.p, key: bt.key }); syncBtnState(); return; }
  }
  const s = settings.ctrl === 'btn' ? -1 : joyHit(x, y);
  if (s >= 0) {
    const j = joys[s]; const base = joyBase(s);
    j.pid = id; j.bx = base[0]; j.by = base[1];
    joyMove(j, x, y);
    return;
  }
  if (mode === 'spectate') {
    for (const t of clickTargets) {
      if (x < t.x || x > t.x + t.w || y < t.y || y > t.y + t.h) continue;
      if (t.act === 'follow') { players[0] = balls[t.i]; players[0]._camY = null; return; }
    }
  }
  const h = hitTest(x, y);
  if (h) handleUIHit(h, x, y);
}
function onTouchMove(x, y, id) {
  if (sliderDragId === id) { updateVolume(x); return; }
  for (const j of joys) {
    if (j.pid === id) { joyMove(j, x, y); return; }
  }
}
function onTouchEnd(x, y, id) {
  if (sliderDragId === id) sliderDragId = null;
  for (const j of joys) {
    if (j.pid === id) { j.pid = null; j.dx = j.dy = j.x = j.y = 0; }
  }
  if (btnPresses.delete(id)) syncBtnState();
}
wx.onTouchStart(e => { for (const t of e.changedTouches) onTouchStart(t.clientX, t.clientY, t.identifier); });
wx.onTouchMove(e => { for (const t of e.touches) onTouchMove(t.clientX, t.clientY, t.identifier); });
const touchEndHandler = e => { for (const t of e.changedTouches) onTouchEnd(t.clientX, t.clientY, t.identifier); };
wx.onTouchEnd(touchEndHandler);
wx.onTouchCancel(touchEndHandler);

/* ================= 总渲染 ================= */
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clickTargets.length = 0;
  uiHits.length = 0;
  uiScale = 1; uiOX = 0; uiOY = 0;
  const bgGrad = ctx.createLinearGradient(0, 0, 0, ch);
  bgGrad.addColorStop(0, '#070b16'); bgGrad.addColorStop(1, '#04060c');
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, cw, ch);
  if (state === 'menu' || resultsVisible) {
    renderView(0, 0, cw, ch, state === 'menu' ? null : players[0], 0);
  } else if (mode === 'spectate' && spectateSplit) {
    renderView(0, 0, cw / 2 - 2, ch, players[0], 0);
    renderView(cw / 2 + 2, 0, cw / 2 - 2, ch, players[1], 1);
    ctx.fillStyle = '#0a1122'; ctx.fillRect(cw / 2 - 4, 0, 8, ch);
    ctx.fillStyle = 'rgba(108,208,255,0.5)'; ctx.fillRect(cw / 2 - 1, 0, 2, ch);
  } else {
    renderView(0, 0, cw, ch, players[0], 0);
  }
  drawMinimap();
  drawBrand();
  if (state !== 'menu' && !settingsOpen && !resultsVisible && !backPrompt) {
    drawBackButton();
    drawSettingsButton();
  }
  if (state === 'race' && raceTime < 4 && !settingsOpen && !resultsVisible) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(195,211,239,0.85)';
    ctx.font = '13px sans-serif';
    const tip = mode === 'spectate' ? '点按排名或画面切换视角'
      : mode === 'invite' ? (inviteTime > 0
          ? '这是好友玩过的赛道 · 好友成绩 ' + fmtT(inviteTime) + '，争取跑得更快！'
          : '这是好友玩过的赛道 · 争取跑得更快！')
      : '左右转向 · 撞开对手抢线！';
    ctx.fillText(tip, cw / 2, ch - 58);
  }
  if (touchSeen && settings.ctrl !== 'btn' && !settingsOpen && !resultsVisible) drawJoysticks();
  if (btnSlots()) drawButtons();
  if (backPrompt) drawBackPrompt();
  if (state === 'menu' && !settingsOpen) {
    if (screen === 'levels') drawLevelsUI();
    else if (screen === 'invite') drawInviteUI();
    else if (screen === 'rank') drawRankUI();
    else drawMenuUI();
  }
  if (resultsVisible && !settingsOpen) drawResultsUI();
  if (settingsOpen) drawSettingsUI();
}

/* ================= 主循环 ================= */
let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  const dt = clamp((ts - lastTs) / 1000, 0, 0.05); lastTs = ts;
  if (!paused && !backPrompt && !settingsOpen) {
    simTime += dt;
    if (state === 'menu') { menuCam += dt * 80; }
    else if (state === 'countdown') {
      countdownT -= dt;
      const n = Math.ceil(countdownT);
      if (n < lastCount && n > 0) { sndBeep(); lastCount = n; }
      if (countdownT <= 0) { state = 'race'; goT = raceTime; sndGo(); }
    } else if (state === 'race' || state === 'finishing') {
      raceTime += dt;
      physics(dt / 2); physics(dt / 2);
      if (mode === 'invite' && !players[0].finished) {
        ghostRecT += dt;
        if (ghostRecT >= 0.5) {
          ghostRecT -= 0.5;
          ghostRecord.push({ x: players[0].x, y: players[0].y });
        }
      }
      if (state === 'finishing') {
        if (mode !== 'spectate' && raceTime - lastResUpdate > 0.25) { renderResults(false); lastResUpdate = raceTime; }
        const done = mode === 'spectate' ? balls.every(x => x.finished) : players.every(p => p.finished);
        if (done || raceTime > finishWaitEnd) renderResults(true);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy = p.vy * 0.985 + 120 * dt;
    }
  }
  render();
}

/* ================= 分享 ================= */
function enableShareMenu() {
  if (!wx.showShareMenu) return;
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
      fail() {
        // 部分系统/基础库不支持朋友圈参数，退回只开启“发送给朋友”
        try { wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] }); } catch (e2) {}
      },
    });
  } catch (e) {
    try { wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] }); } catch (e2) {}
  }
}
function setupShare() {
  enableShareMenu();
  if (wx.onShareAppMessage) {
    wx.onShareAppMessage(() => ({
      title: '赛球弹珠竞速 · 来和我比一场',
      imageUrl: 'images/share.png',
      query: 'from=card',
    }));
  }
  if (wx.onShareTimeline) {
    wx.onShareTimeline(() => ({
      title: '赛球弹珠竞速 · 来和我比一场',
      imageUrl: 'images/share.png',
      query: 'from=timeline',
    }));
  }
}
function doShare() {
  try {
    wx.shareAppMessage({
      title: '赛球弹珠竞速 · 来和我比一场',
      imageUrl: 'images/share.png',
      query: 'from=button',
    });
  } catch (e) { /* 非用户点击等场景会失败 */ }
}

/* ================= 启动 ================= */
loadRoster();
loadSettings();
loadLevels();
uploadLevelStats();
setupShare();
try {
  const lo = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : null;
  parseInvite(lo && lo.query);
} catch (e) { /* 忽略 */ }
if (wx.onShow) {
  wx.onShow(res => {
    enableShareMenu();
    if (parseInvite(res && res.query)) {
      state = 'menu'; resultsVisible = false; settingsOpen = false; backPrompt = false;
      screen = 'invite';
    }
  });
}
if (mode === 'level') trackLen = levelConfig(currentLevel).len;
track = genTrack(seed, activeDiff().scale, trackLen);
balls = makeBalls();
requestAnimationFrame(frame);

