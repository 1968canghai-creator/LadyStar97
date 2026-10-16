# 明星97 水果机 · 网页版

在浏览器里运行的明星97（LADYSTAR97）水果机模拟器：复用原版 `LDST97_F.EXP` 里的图块与 Z80 程序，不重绘任何素材，
逻辑、拨码设定、底部鼠标按钮条都与桌面版（`../Ladystar97`）一致。单个 `index.html`，无需安装。

## 怎么玩

1. 打开页面，资源文件会自动下载（约 0.5 MB）；取不到时页面会提示把**原版的 `LDST97_F.EXP`** 拖进来（或点击选择文件），
   文件只保存在你自己的浏览器里（localStorage），下次打开不用再拖。
2. 先点一下画面（浏览器要求用户点击后才能出声）。
3. 上分 F2 → 按「押」加押分（最低 49）→「開始」转动。中奖后 TAKE SCORE / DOUBLE UP 闪动时按「比倍」猜大小，或按「得分」收分。

底部按钮：鼠标或手指**单击触动，双击锁住**（再双击解锁）。键盘：

| 功能 | 键 |
|---|---|
| 大 / 比倍 / 小 | 小键盘 4 / 5 / 6，或 A / S / D |
| 停A / 停B / 停C / 全停 | 小键盘 1 / 2 / 3 / .，或 Z / X / C / V |
| 得分 / 開始 / 押 | 小键盘 0 / Enter / +，或 T / 空格 / B |
| 上分 / 洗分 | F2 / F3 |
| 设置开关 / 账目开关 | F4 / F5 |
| 全屏 | F11 |
| 手机横屏 | 横过来或菜单「横屏全屏」：顶栏自动收起、画面铺满，左上角 ☰ 打开菜单（iPhone 需手动旋转） |

「菜单」里有机台设定（15 项拨码字段，改动后主板自动复位，与原版只在复位时读开关一致）、原始拨码、
两个 ROM 修正开关（比倍完整牌面、最高押分 80 档按 80 限制）、软复位、存档导入导出。
分数和设定每 5 秒及离开页面时写入浏览器；导出的 `LDST97_F.DAT` 与 `设定.txt` 和桌面版通用，拨码说明见上级目录的 `README.md`。

## 部署

纯静态文件，放到任何 HTTP 服务器或 GitHub Pages 即可。本地测试：

```bash
python -m http.server 8097
```

然后打开 http://localhost:8097/ 。直接双击 `index.html`（file://）时无法自动读取同目录的 EXP，但拖入文件仍可用。

**关于资源文件**：`LDST97_F.EXP` / `LDST97_F.DAT` 是原版游戏的资源，本仓库不包含它们（见 `.gitignore`），
而是放在另一个仓库 [LadyStar97EXP](https://github.com/1968canghai-creator/LadyStar97EXP) 并通过 GitHub Pages 提供。
页面按 同目录 → `../LadyStar97EXP/` → `https://1968canghai-creator.github.io/LadyStar97EXP/` 的顺序查找，都取不到时才提示拖入。

## 构建

`index.html` 由 `build.py` 从 `src/` 合成：

```
src/index.template.html   页面、样式、菜单
src/z80.js                Z80 内核（直译 ../Ladystar97/Z80.cs，每条指令 +2 周期，R 只增低 7 位）
src/board.js              LZHUF 解码、EXP 解析、AY-3-8910、主板（内存/端口/调色板 DAC/转轮渲染/输入/存档）、拨码字段
src/app.js                主循环（定时器补帧，60 Hz）、Canvas 显示、输入、菜单、localStorage、WebAudio
```

底部按钮图（`../Ladystar97/buttons.bin`，原版鼠标模式的 10 个按钮）以 base64 内嵌。改了 `src/` 后运行 `python build.py` 重新生成。

## 实现要点

- 每帧 50000 个 Z80 周期后触发 NMI，60 帧/秒；画面 512×256（下 32 行为按钮条），按原版 1.5 倍竖向拉伸为 512×384，最近邻整数或 0.5 倍步进放大。
- 每次按键至少保持 3 帧，避免浏览器合成的短促按键或手机轻点落在两次采样之间。
- 主循环用 `setInterval` 按真实时间补帧，不依赖 `requestAnimationFrame`，在被节流的窗格里也能跑满 60 帧。
- 声音用 ScriptProcessorNode 输出 AY 音源，环形缓冲 1 秒，积压过多时丢弃旧样本。
