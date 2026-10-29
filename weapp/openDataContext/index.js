// 好友排行榜 · 开放数据域
// 只能访问有限的社交数据 API，不能 require 主域代码。
const sharedCanvas = wx.getSharedCanvas();
const ctx = sharedCanvas.getContext('2d');

const DW = 382, DH = 520;          // 设计尺寸（主域按此比例绘制）
let list = [];
let visible = false;
let loading = false;
let failed = '';
const imgCache = {};

function fmt(t) {
  if (!t || t <= 0) return '--:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}

function load() {
  if (loading) return;
  loading = true; failed = '';
  wx.getFriendCloudStorage({
    keyList: ['lv', 'best', 'time'],
    success(res) {
      loading = false;
      list = (res.data || []).map(u => {
        let lv = 0, time = 0;
        (u.KVDataList || []).forEach(kv => {
          if (kv.key === 'lv') lv = parseInt(kv.value, 10) || 0;
          // best = 最快通关用时；time 为旧字段，兼容旧数据
          if (kv.key === 'best') time = parseFloat(kv.value) || 0;
          else if (kv.key === 'time' && !time) time = parseFloat(kv.value) || 0;
        });
        return { nick: u.nickname || '好友', avatar: u.avatarUrl || '', lv, time };
      }).sort((a, b) => (b.lv - a.lv) || ((a.time || 1e9) - (b.time || 1e9)));
      draw();
    },
    fail(e) {
      loading = false;
      failed = (e && e.errMsg) ? e.errMsg : '读取好友数据失败';
      draw();
    },
  });
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

  if (failed) {
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

  const top = 6, rowH = 40;
  const count = Math.min(list.length, 12);
  for (let i = 0; i < count; i++) {
    const u = list[i];
    const y = top + i * rowH;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(18,30,56,0.55)';
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(DW, y); ctx.lineTo(DW, y + rowH - 4); ctx.lineTo(0, y + rowH - 4);
      ctx.closePath(); ctx.fill();
    }
    // 名次
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = i === 0 ? '#ffd54a' : i === 1 ? '#dfe8ff' : i === 2 ? '#ff9d3d' : '#7e97c4';
    ctx.fillText(String(i + 1), 18, y + 24);

    // 头像
    const im = getImg(u.avatar);
    const ax = 34, ay = y + 7, ar = 12;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#24365e'; ctx.fill();
    if (im && im.complete && im.width > 0) {
      ctx.clip();
      ctx.drawImage(im, ax, ay, ar * 2, ar * 2);
    }
    ctx.restore();

    // 昵称
    ctx.textAlign = 'left';
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#e8f0ff';
    let nick = u.nick;
    if (nick.length > 8) nick = nick.slice(0, 8) + '…';
    ctx.fillText(nick, 66, y + 18);

    // 关卡数与用时
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#8ea6cf';
    ctx.fillText('已通关 ' + u.lv + ' 关', 66, y + 32);
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#8ea6cf';
    ctx.fillText('最快', DW - 66, y + 15);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#6cd0ff';
    ctx.fillText(fmt(u.time), DW - 10, y + 28);
    ctx.textAlign = 'left';
  }

  ctx.textAlign = 'center';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#5b6c8c';
  ctx.fillText(list.length > 12 ? '仅显示前 12 名' : '', DW / 2, DH - 4);

  ctx.restore();
}

wx.onMessage(msg => {
  if (!msg) return;
  if (msg.type === 'show') {
    visible = true;
    if (msg.width && msg.height && (sharedCanvas.width !== msg.width || sharedCanvas.height !== msg.height)) {
      sharedCanvas.width = msg.width;
      sharedCanvas.height = msg.height;
    }
    load();
  } else if (msg.type === 'hide') {
    visible = false;
  } else if (msg.type === 'refresh') {
    load();
  }
});

// 首次展示前先画一版占位
draw();
