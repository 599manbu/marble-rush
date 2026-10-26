# 赛球 · Marble Rush —— 微信小游戏移植准备

当前仓库主线是**单文件 H5 版**（根目录 `index.html`，浏览器双击即玩）。
微信"小游戏"没有浏览器 DOM/BOM，`index.html` 不能直接上传，需要按下面的清单移植。
本目录已配好开发者工具工程：**用微信开发者工具 → 导入 → 选择 `weapp/` 目录（游客模式 AppID）即可看到占位画面**，验证工具链通畅。

## 工程文件

| 文件 | 作用 |
|---|---|
| `project.config.json` | 开发者工具工程配置；上线前把 `appid` 换成自己的（现在是游客模式 `touristappid`） |
| `game.json` | 小游戏配置：竖屏 |
| `game.js` | 占位入口（画一屏文字），移植时从这里接管 |
| `上线资料.md` | **名称 / 简称 / 简介 / 头像 / 服务类目**，注册时直接复制 |
| `assets/icon-144.png` | 小程序头像（144×144，上传用） |
| `assets/icon-512.png` | 高清图标（宣传素材） |
| `assets/icon-source.html` | 图标源文件，改配色后重新截图即可 |

## 移植清单（H5 → 小游戏）

主循环、物理、AI、赛道生成、Canvas 渲染都是纯 JS，基本可以直接复用；
**所有依赖 DOM/BOM 的部分**需要改造：

1. **UI 层全部改为 Canvas 绘制**：主菜单（模式/赛道/难度/数量/命名）、结算面板、设置面板、返回确认弹窗，目前都是 DOM 元素（`#menu`、`#results`、`#settings`），小游戏里没有 `document`。
2. **文字输入**：选手命名用 `wx.showKeyboard()` + `wx.onKeyboardInput()` 实现。
3. **存储**：`localStorage` → `wx.getStorageSync()` / `wx.setStorageSync()`（命名、最佳成绩、设置三处 key）。
4. **音频**：`new AudioContext()` → `wx.createWebAudioContext()`（基础库 ≥ 2.19.0）。
   若真机上振荡器（Oscillator）兼容不佳，兜底方案是预生成音频文件 + `wx.createInnerAudioContext()`。
5. **触控**：canvas 的 pointer 事件 → `wx.onTouchStart / onTouchMove / onTouchEnd`（触点数据结构相近，摇杆与按钮逻辑可平移）。
6. **屏幕**：`window.innerWidth/innerHeight`、`devicePixelRatio`、`resize` → `wx.getSystemInfoSync()` + `wx.onWindowResize()`。
7. **离屏 canvas**：名字标签缓存用了 `document.createElement('canvas')` → 小游戏里再次调用 `wx.createCanvas()` 即为离屏画布。
8. **其它**：`matchMedia('(pointer:coarse)')` 在小游戏里恒为触屏；`requestAnimationFrame` 小游戏全局自带，无需改动。

建议做法：H5 版里把"平台差异"收拢成一个小适配层（storage / audio / input / screen 四个模块），H5 与小游戏各写一份实现，游戏主体保持一份代码。

## 上线步骤（微信公众平台）

1. **注册小程序账号**：[mp.weixin.qq.com](https://mp.weixin.qq.com) 注册，类目选**小游戏**。
   个人主体可以发布小游戏（部分类目/能力受限）；企业主体可选择的类目与资质要求更多。
2. **获取 AppID**：填入 `weapp/project.config.json` 的 `appid`。
3. **微信开发者工具**导入 `weapp/`，完成移植后用"预览"扫码真机测试。
4. **自审自查**：按平台要求完成游戏内容自审（未成年人保护、隐私协议、用户实名等，以平台最新指引为准）。
5. **备案**：新注册的小程序/小游戏需完成 **ICP 备案**（主体备案 + 小程序备案）才能上线，在公众平台内提交。
6. **上传 → 提交审核 → 发布**：工具里"上传"代码，公众平台提交审核，通过后发布。

## 注意事项

- 游戏类目、虚拟支付、广告变现（流量主）等资质要求**以微信公众平台最新政策为准**；个人主体通常不能开通虚拟支付。
- 主包体积上限 4MB，本游戏纯代码远小于限制，无需分包。
- 提审前把游戏内所有测试文案、体验说明清理干净。

> 以上平台规则随时间变化，提交前务必以 mp.weixin.qq.com 公告与审核指南为准。
