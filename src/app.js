// 页面逻辑：加载资源、主循环、Canvas 显示、输入、菜单、存档（localStorage）、WebAudio
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha: false });
  const VIEW_W = 512, VIEW_H = 384;             // 原版 512×256 竖向拉伸 1.5 倍
  const off = document.createElement('canvas'); off.width = 512; off.height = 256;
  const octx = off.getContext('2d');
  const imgData = octx.createImageData(512, 256);
  const pix32 = new Uint32Array(imgData.data.buffer);
  const LS = { dat: 'ldst97.dat', set: 'ldst97.settings', exp: 'ldst97.exp' };
  let board = null, running = false, lastTime = 0, acc = 0;
  let audioCtx = null, audioNode = null;
  const audioRing = new Float32Array(44100); let ringW = 0, ringR = 0, ringCount = 0;
  const frameAudio = new Float32Array(735);
  const settings = { autoStop: false, cardFace: true, maxBet80: true };

  // ---- 工具 ----
  const b64ToBytes = b64 => { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  const bytesToB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const status = msg => { $('status').textContent = msg; };
  const download = (name, bytes) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

  // ---- 设定 ----
  function loadSettings() {
    const s = lsGet(LS.set); if (!s) return;
    const v = s.split(',');
    try { board.dip = [0, 1, 2, 3].map(i => parseInt(v[i], 16)); } catch { }
    if (v.length > 4) settings.autoStop = v[4] === '1';
    if (v.length > 5) settings.cardFace = v[5] === '1';
    if (v.length > 6) settings.maxBet80 = v[6] === '1';
  }
  function settingsText() { return board.dip.map(b => b.toString(16).padStart(2, '0')).join(',') + `,${settings.autoStop ? 1 : 0},${settings.cardFace ? 1 : 0},${settings.maxBet80 ? 1 : 0}`; }
  function saveSettings() { lsSet(LS.set, settingsText()); }
  function applySettings() { board.autoStop = settings.autoStop; board.cardFacePatch = settings.cardFace; board.maxBet80Patch = settings.maxBet80; }
  function saveNvram() { if (board) lsSet(LS.dat, bytesToB64(board.saveNvram())); }

  // ---- 启动 ----
  async function fetchBytes(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return new Uint8Array(await r.arrayBuffer()); }
  async function boot() {
    let expBytes = null;
    try { expBytes = await fetchBytes('LDST97_F.EXP'); } catch { }
    if (!expBytes) { const b = lsGet(LS.exp); if (b) expBytes = b64ToBytes(b); }
    if (!expBytes) { showDrop('找不到 LDST97_F.EXP：把原版的 LDST97_F.EXP 拖到这里（或点击选择文件）。文件只保存在你的浏览器里。'); return; }
    await start(expBytes);
  }
  async function start(expBytes) {
    let exp;
    try { exp = loadExp(expBytes.buffer.slice(expBytes.byteOffset, expBytes.byteOffset + expBytes.byteLength)); }
    catch (e) { showDrop('EXP 解码失败：' + e.message + '，请换正确的 LDST97_F.EXP 再拖入。'); return; }
    lsSet(LS.exp, bytesToB64(expBytes));
    board = new Board(exp, b64ToBytes(BUTTONS_B64));
    // 存档：浏览器里的 > 同目录原版 LDST97_F.DAT > 空档
    let dat = null; const saved = lsGet(LS.dat);
    if (saved) dat = b64ToBytes(saved); else { try { dat = await fetchBytes('LDST97_F.DAT'); } catch { } }
    board.loadNvram(dat);
    loadSettings(); applySettings(); buildMenus();
    hideDrop(); running = true; lastTime = performance.now(); acc = 0;
    status('运行中 · 60 帧/秒 · 点击画面开启声音');
    if (!timer) { timer = setInterval(tick, 1000 / 60); setInterval(saveNvram, 5000); }
  }
  function showDrop(msg) { $('dropmsg').textContent = msg; $('drop').classList.remove('hidden'); }
  function hideDrop() { $('drop').classList.add('hidden'); }
  function handleFiles(files) {
    for (const f of files) {
      const name = f.name.toUpperCase();
      if (name.endsWith('.EXP')) { f.arrayBuffer().then(b => { running = false; start(new Uint8Array(b)); }); return; }
      if (name.endsWith('.DAT') && board) { f.arrayBuffer().then(b => { board.loadNvram(new Uint8Array(b)); board.softReset(); saveNvram(); status('已导入存档并复位'); }); return; }
      if (name.endsWith('.TXT') && board) { f.text().then(t => { lsSet(LS.set, t.trim()); loadSettings(); applySettings(); board.softReset(); status('已导入设定并复位'); }); return; }
    }
  }
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  $('filepick').addEventListener('change', e => handleFiles(e.target.files));
  $('drop').addEventListener('click', () => $('filepick').click());

  // ---- 主循环：用定时器按真实时间补帧（不依赖 requestAnimationFrame，避免被节流）----
  let timer = null;
  function tick() {
    if (!running || !board) return;
    const now = performance.now();
    let dt = now - lastTime; lastTime = now;
    if (dt > 100) dt = 100;
    acc += dt;
    let frames = 0;
    while (acc >= 1000 / 60 && frames < 4) { stepFrame(); acc -= 1000 / 60; frames++; }
    if (frames > 0) present();
  }
  let frameTotal = 0;
  window.LDST = { get board() { return board; }, get frames() { return frameTotal; } };   // 调试用
  function stepFrame() {
    frameTotal++;
    board.runFrame();
    board.ay.render(frameAudio, 0, 735);
    if (audioCtx) { for (let i = 0; i < 735 && ringCount < audioRing.length; i++) { audioRing[ringW] = frameAudio[i]; ringW = (ringW + 1) % audioRing.length; ringCount++; } }
  }
  function present() {
    board.renderFrame();
    if (board.paletteDirty) board.updatePalette();
    const f = board.frame, pal = board.palette;
    for (let i = 0; i < pix32.length; i++) pix32[i] = pal[f[i]];
    octx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, 512, 256, 0, 0, canvas.width, canvas.height);
  }

  // ---- 尺寸：最近邻整数 / 0.5 倍步进 ----
  function resize() {
    const wrap = $('wrap'), bar = $('bar');
    const availW = wrap.clientWidth, availH = window.innerHeight - bar.offsetHeight - 8;
    let scale = Math.min(availW / VIEW_W, availH / VIEW_H);
    if (scale >= 1) scale = Math.floor(scale * 2) / 2; else scale = Math.max(0.25, scale);   // 小屏铺满宽度
    canvas.width = Math.round(VIEW_W * scale); canvas.height = Math.round(VIEW_H * scale);
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    if (board) present();
  }
  window.addEventListener('resize', resize);

  // ---- 声音 ----
  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      audioNode = audioCtx.createScriptProcessor(2048, 0, 1);
      audioNode.onaudioprocess = e => {
        const out = e.outputBuffer.getChannelData(0);
        if (ringCount > 44100 / 4) { const drop = ringCount - 4410; ringR = (ringR + drop) % audioRing.length; ringCount -= drop; }
        for (let i = 0; i < out.length; i++) { if (ringCount > 0) { out[i] = audioRing[ringR]; ringR = (ringR + 1) % audioRing.length; ringCount--; } else out[i] = 0; }
      };
      audioNode.connect(audioCtx.destination);
      if (audioCtx.state === 'suspended') audioCtx.resume();
      status('运行中 · 声音已开启');
    } catch (e) { audioCtx = null; }
  }

  // ---- 鼠标 / 触摸：单击触动，双击锁住 ----
  let mouseButton = -1, lastClickButton = -1, lastClickTime = 0;
  function canvasToScreen(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) * 512 / r.width), y: Math.floor((e.clientY - r.top) * 256 / r.height) };
  }
  function pointerDown(e) {
    initAudio();
    if (!board) return;
    const { x, y } = canvasToScreen(e);
    const b = Board.hitTestButton(x, y);
    if (b < 0) return;
    const now = performance.now();
    if (b === lastClickButton && now - lastClickTime <= 400) { board.toggleLatch(b); lastClickButton = -1; }
    else { lastClickButton = b; lastClickTime = now; }
    mouseButton = b; board.pressButton(b);
    e.preventDefault();
  }
  function pointerUp() { if (board && mouseButton >= 0) board.releaseButton(mouseButton); mouseButton = -1; }
  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ---- 键盘 ----
  const KEYS = {
    Numpad4: 0, KeyA: 0, Numpad5: 1, KeyS: 1, Numpad6: 2, KeyD: 2,
    Numpad1: 3, KeyZ: 3, Numpad2: 4, KeyX: 4, Numpad3: 5, KeyC: 5,
    NumpadDecimal: 6, KeyV: 6, Numpad0: 7, KeyT: 7, NumpadEnter: 8, Enter: 8, Space: 8, NumpadAdd: 9, KeyB: 9,
  };
  const keysDown = new Set();
  document.addEventListener('keydown', e => {
    if (!board || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.repeat) { if (e.code in KEYS) e.preventDefault(); return; }
    switch (e.code) {
      case 'F2': board.keyInFrames = 8; e.preventDefault(); return;
      case 'F3': board.keyOutFrames = 8; e.preventDefault(); return;
      case 'F4': $('svcSetting').checked = !$('svcSetting').checked; board.svcSetting = $('svcSetting').checked; e.preventDefault(); return;
      case 'F5': $('svcAccount').checked = !$('svcAccount').checked; board.svcAccount = $('svcAccount').checked; e.preventDefault(); return;
      case 'F11': toggleFullscreen(); e.preventDefault(); return;
    }
    if (e.code in KEYS) { initAudio(); keysDown.add(e.code); board.pressButton(KEYS[e.code]); e.preventDefault(); }
  });
  document.addEventListener('keyup', e => { if (!board) return; if (e.code in KEYS) { keysDown.delete(e.code); if (![...keysDown].some(k => KEYS[k] === KEYS[e.code])) board.releaseButton(KEYS[e.code]); } });
  window.addEventListener('blur', () => { if (board) { board.buttonHeld.fill(false); keysDown.clear(); } });

  function toggleFullscreen() { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }

  // ---- 菜单 ----
  function buildMenus() {
    $('keyIn').onclick = () => { board.keyInFrames = 8; };
    $('keyOut').onclick = () => { board.keyOutFrames = 8; };
    $('svcSetting').onchange = e => { board.svcSetting = e.target.checked; };
    $('svcAccount').onchange = e => { board.svcAccount = e.target.checked; };
    $('autoStop').checked = settings.autoStop; $('autoStop').onchange = e => { settings.autoStop = e.target.checked; applySettings(); saveSettings(); };
    $('cardFace').checked = settings.cardFace; $('cardFace').onchange = e => { settings.cardFace = e.target.checked; applySettings(); saveSettings(); };
    $('maxBet80').checked = settings.maxBet80; $('maxBet80').onchange = e => { settings.maxBet80 = e.target.checked; applySettings(); saveSettings(); };
    $('softReset').onclick = () => { board.softReset(); saveNvram(); status('已软复位'); };
    $('fullscreen').onclick = toggleFullscreen;
    $('exportDat').onclick = () => download('LDST97_F.DAT', board.saveNvram());
    $('exportSet').onclick = () => download('设定.txt', new TextEncoder().encode(settingsText()));
    $('importBtn').onclick = () => $('filepick').click();
    $('clearSave').onclick = () => { if (confirm('清空浏览器里的存档和设定，恢复到原版初始状态？')) { try { localStorage.removeItem(LS.dat); localStorage.removeItem(LS.set); } catch { } location.reload(); } };
    // 机台设定
    const dipBox = $('dipFields'); dipBox.innerHTML = '';
    for (const f of DIP_FIELDS) {
      const label = document.createElement('label'); label.textContent = f.name;
      const sel = document.createElement('select');
      f.labels.forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = t; sel.appendChild(o); });
      sel.value = dipGet(f, board.dip);
      sel.onchange = () => { const sw = board.dip; dipSet(f, sw, parseInt(sel.value)); board.dip = sw; saveSettings(); board.softReset(); saveNvram(); refreshRaw(); status('机台设定已改，主板已复位'); };
      label.appendChild(sel); dipBox.appendChild(label);
    }
    const rawBox = $('rawDip'); rawBox.innerHTML = '';
    const names = ['SW1 (端口 02)', 'SW2 (端口 10)', 'SW3 (AY 端口 A)', 'SW4 (AY 端口 B)'];
    const rawInputs = [];
    names.forEach((n, i) => {
      const label = document.createElement('label'); label.textContent = n;
      const inp = document.createElement('input'); inp.size = 3; inp.maxLength = 2; inp.value = board.dip[i].toString(16).padStart(2, '0');
      inp.onchange = () => { const v = parseInt(inp.value, 16); if (isNaN(v)) { inp.value = board.dip[i].toString(16).padStart(2, '0'); return; } const sw = board.dip; sw[i] = v & 0xff; board.dip = sw; saveSettings(); board.softReset(); saveNvram(); refreshFields(); status('拨码已改，主板已复位'); };
      label.appendChild(inp); rawBox.appendChild(label); rawInputs.push(inp);
    });
    function refreshRaw() { rawInputs.forEach((inp, i) => { inp.value = board.dip[i].toString(16).padStart(2, '0'); }); }
    function refreshFields() { [...dipBox.querySelectorAll('select')].forEach((sel, i) => { sel.value = dipGet(DIP_FIELDS[i], board.dip); }); }
    $('dipDefault').onclick = () => { board.dip = Board.DEFAULT_DIP; saveSettings(); board.softReset(); saveNvram(); refreshRaw(); refreshFields(); status('已恢复默认拨码并复位'); };
    $('menuBtn').onclick = () => $('menu').classList.toggle('open');
    $('helpBtn').onclick = () => $('help').classList.toggle('hidden');
    $('helpClose').onclick = () => $('help').classList.add('hidden');
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNvram(); });
  window.addEventListener('pagehide', saveNvram);
  window.addEventListener('beforeunload', saveNvram);

  resize();
  boot();
})();
