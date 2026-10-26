// 赛球 · Marble Rush —— 微信小游戏占位入口
// 用微信开发者工具打开本目录即可运行，验证工具链是否通畅。
// 完整移植步骤见同目录 README.md（H5 主版本在仓库根目录 index.html）。

const info = wx.getSystemInfoSync();
const canvas = wx.createCanvas();
canvas.width = info.windowWidth * info.pixelRatio;
canvas.height = info.windowHeight * info.pixelRatio;
const ctx = canvas.getContext('2d');
ctx.scale(info.pixelRatio, info.pixelRatio);

function draw() {
  const w = info.windowWidth, h = info.windowHeight;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#070b16');
  g.addColorStop(1, '#04060c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd54a';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('赛球弹珠竞速', w / 2, h / 2 - 46);
  ctx.fillStyle = '#8ea6cf';
  ctx.font = '13px sans-serif';
  ctx.fillText('MARBLE RUSH · 微信小游戏版准备中', w / 2, h / 2 - 14);
  ctx.fillStyle = '#7ec9a9';
  ctx.font = '12px sans-serif';
  ctx.fillText('工具链已就绪 · 移植清单见 weapp/README.md', w / 2, h / 2 + 14);
}
requestAnimationFrame(function loop() {
  requestAnimationFrame(loop);
  draw();
});
