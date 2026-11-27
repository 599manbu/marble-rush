// 好友排行榜 · 开放数据域
// 只能访问有限的社交数据 API，不能 require 主域代码。
const sharedCanvas = wx.getSharedCanvas();
const ctx = sharedCanvas.getContext('2d');

const DW = 382, DH = 520;          // 设计尺寸（主域按此比例绘制）
let list = [];
let selfData = null;
let page = 0;
let visible = false;
let loading = false;
let failed = '';
const imgCache = {};

function parseUser(u, isSelf) {
  let lv = 0, time = 0;
  (u.KVDataList || []).forEach(kv => {
    if (kv.key === 'lv') lv = parseInt(kv.value, 10) || 0;
    if (kv.key === 'best') time = parseFloat(kv.value) || 0;
    else if (kv.key === 'time' && !time) time = parseFloat(kv.value) || 0;   // 兼容旧字段
  });
  return {
    nick: isSelf ? '我' : (u.nickname || '好友'),
    avatar: u.avatarUrl || '',
    lv, time, isSelf: !!isSelf,
  };
}
function sortList() {
  list.sort((a, b) => (b.lv - a.lv) || ((a.time || 1e9) - (b.time || 1e9)));
}

function fmt(t) {
  if (!t || t <= 0) return '--:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}

function load() {
  if (loading) return;
  loading = true; failed = '';
  let left = 2;
  const done = () => { if (--left <= 0) { mergeSelf(); draw(); } };
  const keyList = ['lv', 'best', 'time'];

  wx.getFriendCloudStorage({
    keyList,
    success(res) {
      // 未通关（0 关）的玩家不显示在排行榜
      list = (res.data || []).map(u => parseUser(u, false)).filter(u => u.lv > 0);
      done();
    },
    fail(e) {
      failed = (e && e.errMsg) ? e.errMsg : '读取好友数据失败';
      list = [];
      done();
    },
  });

  // getFriendCloudStorage 不保证包含自己，单独读取自己的托管数据再合并
  if (wx.getUserCloudStorage) {
    wx.getUserCloudStorage({
      keyList,
      success(res) { selfData = parseUser(res || {}, true); done(); },
      fail() { selfData = null; done(); },
    });
  } else {
    selfData = null; done();
  }
}
function mergeSelf() {
  loading = false;
  list = (list || []).filter(u => !u.isSelf);
  if (selfData && (selfData.lv > 0 || selfData.time > 0)) {
    list.push(selfData);
  }
  sortList();
}

function getImg(url) {
  if (!url) return null;
  let im = imgCache[url];
  if (!im) {
    im = wx.createImage();
    im.onload = draw;
    im.src = url;
    imgCache[url] = im;
  }
  return im;
}

function draw() {
  const scaleX = sharedCanvas.width / DW;
  const scaleY = sharedCanvas.height / DH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
  ctx.save();
  ctx.scale(scaleX, scaleY);

  if (failed && !list.length) {
    ctx.fillStyle = '#8ea6cf';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('好友数据读取失败', DW / 2, DH / 2 - 12);
    ctx.fillStyle = '#66809f';
    ctx.font = '11px sans-serif';
    ctx.fillText('请确认已在真机微信中打开，并授权好友关系', DW / 2, DH / 2 + 12);
    ctx.restore();
    return;
  }
  if (!list.length) {
    ctx.fillStyle = '#8ea6cf';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(loading ? '正在读取好友数据…' : '还没有好友上榜', DW / 2, DH / 2 - 10);
    if (!loading) {
      ctx.fillStyle = '#66809f';
      ctx.font = '11px sans-serif';
      ctx.fillText('通关关卡后会自动上传成绩', DW / 2, DH / 2 + 14);
    }
    ctx.restore();
    return;
  }

  const PAGE_SIZE = 5, rowH = 90;
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pageCount - 1));
  const start = page * PAGE_SIZE;
  const shown = list.slice(start, start + PAGE_SIZE);
  const RINGS = ['#ffd54a', '#dfe8ff', '#cd8b45'];

  for (let i = 0; i < shown.length; i++) {
    const u = shown[i], rank = start + i + 1;
    const y = 4 + i * rowH;
    ctx.fillStyle = u.isSelf ? 'rgba(108,208,255,0.14)'
      : (i % 2 === 0 ? 'rgba(18,30,56,0.55)' : 'rgba(13,23,48,0.35)');
    ctx.fillRect(2, y, DW - 4, rowH - 8);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = rank === 1 ? RINGS[0] : rank === 2 ? RINGS[1] : rank === 3 ? RINGS[2] : '#7e97c4';
    ctx.fillText(String(rank), 22, y + 50);

    // 头像（前三名带名次框）
    const im = getImg(u.avatar);
    const ar = 22, ax = 40, ay = y + 18;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#24365e'; ctx.fill();
    if (im && im.complete && im.width > 0) {
      ctx.clip();
      ctx.drawImage(im, ax, ay, ar * 2, ar * 2);
    }
    ctx.restore();
    if (rank <= 3) {
      ctx.strokeStyle = RINGS[rank - 1]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = RINGS[rank - 1];
      ctx.beginPath(); ctx.arc(ax + ar + 18, ay + ar - 18, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#08111f'; ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(rank), ax + ar + 18, ay + ar - 17);
      ctx.textBaseline = 'alphabetic';
    }

    ctx.textAlign = 'left';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = u.isSelf ? '#6cd0ff' : '#e8f0ff';
    let nick = u.nick;
    if (nick.length > 8) nick = nick.slice(0, 8) + '…';
    ctx.fillText(nick, 96, y + 40);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#8ea6cf';
    ctx.fillText('已通关 ' + u.lv + ' 关', 96, y + 62);

    ctx.textAlign = 'right';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = rank <= 3 ? RINGS[rank - 1] : '#6cd0ff';
    ctx.fillText(fmt(u.time), DW - 12, y + 44);
    ctx.textAlign = 'left';
  }

  ctx.textAlign = 'center';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#8ea6cf';
  ctx.fillText('第 ' + (page + 1) + ' / ' + pageCount + ' 页', DW / 2, DH - 8);
  ctx.restore();
}

wx.onMessage(msg => {
  if (!msg) return;
  if (msg.type === 'show') {
    visible = true;
    page = msg.page || 0;
    if (msg.width && msg.height && (sharedCanvas.width !== msg.width || sharedCanvas.height !== msg.height)) {
      sharedCanvas.width = msg.width;
      sharedCanvas.height = msg.height;
    }
    load();
  } else if (msg.type === 'hide') {
    visible = false;
  } else if (msg.type === 'refresh') {
    load();
  } else if (msg.type === 'page') {
    page = Math.max(0, +msg.page || 0);
    draw();
  }
});

// 首次展示前先画一版占位
draw();
