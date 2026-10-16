// 明星97 主板：LZHUF 解码、EXP 文件、AY-3-8910、主板（内存/端口/调色板/转轮渲染/输入/存档）、拨码字段
// 直译自 Ladystar97 的 Lzhuf.cs / ExpFile.cs / Ay8910.cs / Board.cs / DipFields.cs
'use strict';

// ---------------- LZHUF ----------------
const Lzhuf = (() => {
  const N = 4096, F = 60, THRESHOLD = 2, N_CHAR = 256 - THRESHOLD + F, T = N_CHAR * 2 - 1, R = T - 1, MAX_FREQ = 0x8000;
  const hex = s => Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
  const d_code = hex(
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0101010101010101010101010101010102020202020202020202020202020202' +
    '0303030303030303030303030303030304040404040404040505050505050505' +
    '0606060606060606070707070707070708080808080808080909090909090909' +
    '0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0d0d0d0d0e0e0e0e0f0f0f0f' +
    '1010101011111111121212121313131314141414151515151616161617171717' +
    '181819191a1a1b1b1c1c1d1d1e1e1f1f20202121222223232424252526262727' +
    '282829292a2a2b2b2c2c2d2d2e2e2f2f303132333435363738393a3b3c3d3e3f');
  const d_len = hex(
    '0303030303030303030303030303030303030303030303030303030303030303' +
    '0404040404040404040404040404040404040404040404040404040404040404' +
    '0404040404040404040404040404040405050505050505050505050505050505' +
    '0505050505050505050505050505050505050505050505050505050505050505' +
    '0505050505050505050505050505050506060606060606060606060606060606' +
    '0606060606060606060606060606060606060606060606060606060606060606' +
    '0707070707070707070707070707070707070707070707070707070707070707' +
    '0707070707070707070707070707070708080808080808080808080808080808');
  class Lzhuf {
    constructor(data, pos) {
      this.data = data; this.pos = pos; this.getbuf = 0; this.getlen = 0;
      this.freq = new Uint16Array(T + 1); this.prnt = new Int16Array(T + N_CHAR); this.son = new Int16Array(T);
    }
    get position() { return (this.pos - ((this.getlen / 8) | 0) + 3) & ~3; }
    fill() { while (this.getlen <= 8) { const c = this.pos < this.data.length ? this.data[this.pos] : 0; this.pos++; this.getbuf |= (c << (8 - this.getlen)) & 0xffff; this.getlen += 8; } }
    getBit() { this.fill(); const i = this.getbuf; this.getbuf = (this.getbuf << 1) & 0xffff; this.getlen--; return (i >> 15) & 1; }
    getByte() { this.fill(); const i = this.getbuf; this.getbuf = (this.getbuf << 8) & 0xffff; this.getlen -= 8; return (i >> 8) & 0xff; }
    startHuff() {
      const { freq, son, prnt } = this;
      for (let i = 0; i < N_CHAR; i++) { freq[i] = 1; son[i] = i + T; prnt[i + T] = i; }
      let a = 0, j = N_CHAR;
      while (j <= R) { freq[j] = freq[a] + freq[a + 1]; son[j] = a; prnt[a] = j; prnt[a + 1] = j; a += 2; j++; }
      freq[T] = 0xffff; prnt[R] = 0;
    }
    reconst() {
      const { freq, son, prnt } = this;
      let j = 0;
      for (let i = 0; i < T; i++) if (son[i] >= T) { freq[j] = (freq[i] + 1) >> 1; son[j] = son[i]; j++; }
      let a = 0; j = N_CHAR;
      while (j < T) {
        let k = a + 1; const f = freq[a] + freq[k]; freq[j] = f;
        k = j - 1; while (f < freq[k]) k--; k++;
        const l = j - k;
        freq.copyWithin(k + 1, k, k + l); freq[k] = f;
        son.copyWithin(k + 1, k, k + l); son[k] = a;
        a += 2; j++;
      }
      for (let i = 0; i < T; i++) { const k = son[i]; if (k >= T) prnt[k] = i; else { prnt[k] = i; prnt[k + 1] = i; } }
    }
    update(c) {
      const { freq, son, prnt } = this;
      if (freq[R] === MAX_FREQ) this.reconst();
      c = prnt[c + T];
      do {
        const k = ++freq[c];
        let l = c + 1;
        if (k > freq[l]) {
          while (k > freq[++l]);
          l--;
          freq[c] = freq[l]; freq[l] = k;
          const i = son[c]; prnt[i] = l; if (i < T) prnt[i + 1] = l;
          const j = son[l]; son[l] = i; prnt[j] = c; if (j < T) prnt[j + 1] = c;
          son[c] = j; c = l;
        }
        c = prnt[c];
      } while (c !== 0);
    }
    decodeChar() { let c = this.son[R]; while (c < T) { c += this.getBit(); c = this.son[c]; } c -= T; this.update(c); return c; }
    decodePosition() { let i = this.getByte(); const c = d_code[i] << 6; let j = d_len[i]; for (j -= 2; j > 0; j--) i = (i << 1) + this.getBit(); return c | (i & 0x3f); }
    decode() {
      const d = this.data, p = this.pos;
      const textsize = (d[p] | d[p + 1] << 8 | d[p + 2] << 16 | d[p + 3] << 24) >>> 0; this.pos += 4;
      this.startHuff();
      const text = new Uint8Array(N).fill(0x20), out = new Uint8Array(textsize);
      let r = N - F, count = 0;
      while (count < textsize) {
        const c = this.decodeChar();
        if (c < 256) { out[count++] = c; text[r] = c; r = (r + 1) & (N - 1); }
        else {
          const i = (r - this.decodePosition() - 1) & (N - 1), j = c - 255 + THRESHOLD;
          for (let k = 0; k < j && count < textsize; k++) { const b = text[(i + k) & (N - 1)]; out[count++] = b; text[r] = b; r = (r + 1) & (N - 1); }
        }
      }
      return out;
    }
  }
  return Lzhuf;
})();

// ---------------- EXP 文件 ----------------
function loadExp(buf) {
  const raw = new Uint8Array(buf.slice(0));
  for (let i = 0; i < raw.length; i++) raw[i] ^= i & 0xff;
  const blocks = []; let pos = 0;
  for (let b = 0; b < 3; b++) {
    const lz = new Lzhuf(raw, pos); blocks[b] = lz.decode(); pos = lz.position;
    const chk = (raw[pos] | raw[pos + 1] << 8 | raw[pos + 2] << 16 | raw[pos + 3] << 24) >>> 0; pos += 4;
    let sum = 0; for (const x of blocks[b]) sum = (sum + x) >>> 0;
    if (sum !== chk) throw new Error('LDST97_F.EXP 第 ' + b + ' 块校验和错误（文件不对或已损坏）');
  }
  const z80 = new Uint8Array(0x10000); z80.set(blocks[0].subarray(0, 0x10000));
  const reel = new Uint8Array(0x800 * 256); reel.set(blocks[1].subarray(0, reel.length));
  const fg = new Uint8Array(0x2000 * 64); fg.set(blocks[2].subarray(0, fg.length));
  return { z80Image: z80, reelTiles: reel, fgTiles: fg };
}

// ---------------- AY-3-8910 ----------------
class Ay8910 {
  constructor(clock, sampleRate) {
    this.cyclesPerSample = clock / sampleRate;
    this.regs = new Uint8Array(16); this.sel = 0; this.portA = 0xff; this.portB = 0xff;
    this.toneCounter = [0, 0, 0]; this.toneOut = [false, false, false]; this.accum = 0;
    this.noiseCounter = 0; this.noiseRng = 1; this.noiseOut = false;
    this.envCounter = 0; this.envStep = 0; this.envHold = false; this.envAlt = false; this.envAttack = false; this.envHolding = false; this.envVol = 0;
    this.volTable = [0.0, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0];
  }
  reset() { this.regs.fill(0); this.sel = 0; this.envVol = 0; this.envHolding = false; }
  selectRegister(r) { this.sel = r & 0x0f; }
  write(v) {
    this.regs[this.sel] = v;
    if (this.sel === 13) {
      this.envHold = !!(v & 1); this.envAlt = !!(v & 2); this.envAttack = !!(v & 4);
      if (!(v & 8)) { this.envHold = true; this.envAlt = this.envAttack; }
      this.envStep = 0; this.envHolding = false; this.envCounter = 0; this.envVol = this.envAttack ? 0 : 15;
    }
  }
  read() { if (this.sel === 14) return this.portA; if (this.sel === 15) return this.portB; return this.regs[this.sel]; }
  period(r) { return Math.max(1, this.regs[r] | (this.regs[r + 1] & 0x0f) << 8); }
  clock(cycles) {
    for (let ch = 0; ch < 3; ch++) {
      const period = this.period(ch * 2) * 8;
      this.toneCounter[ch] += cycles;
      while (this.toneCounter[ch] >= period) { this.toneCounter[ch] -= period; this.toneOut[ch] = !this.toneOut[ch]; }
    }
    const np = Math.max(1, this.regs[6] & 0x1f) * 16;
    this.noiseCounter += cycles;
    while (this.noiseCounter >= np) {
      this.noiseCounter -= np;
      const bit = ((this.noiseRng >>> 0) ^ (this.noiseRng >>> 3)) & 1;
      this.noiseRng = ((this.noiseRng >>> 1) | (bit << 16)) >>> 0;
      this.noiseOut = (this.noiseRng & 1) !== 0;
    }
    const ep = Math.max(1, this.regs[11] | this.regs[12] << 8) * 16;
    this.envCounter += cycles;
    while (this.envCounter >= ep) {
      this.envCounter -= ep;
      if (this.envHolding) continue;
      this.envStep++;
      if (this.envStep >= 16) {
        this.envStep = 0;
        if (this.envHold) { this.envHolding = true; if (this.envAlt) this.envAttack = !this.envAttack; }
        else if (this.envAlt) this.envAttack = !this.envAttack;
      }
      this.envVol = this.envHolding ? (this.envAttack ? 15 : 0) : (this.envAttack ? this.envStep : 15 - this.envStep);
    }
  }
  /** 生成 count 个浮点样本（-1..1）到 buffer */
  render(buffer, offset, count) {
    for (let i = 0; i < count; i++) {
      this.accum += this.cyclesPerSample;
      const cyc = this.accum | 0; this.accum -= cyc;
      this.clock(cyc);
      let mix = 0; const mixer = this.regs[7];
      for (let ch = 0; ch < 3; ch++) {
        const tEn = (mixer & (1 << ch)) === 0, nEn = (mixer & (8 << ch)) === 0;
        const on = (!tEn || this.toneOut[ch]) && (!nEn || this.noiseOut);
        if (!on) continue;
        const vr = this.regs[8 + ch];
        mix += this.volTable[(vr & 0x10) ? this.envVol : (vr & 0x0f)];
      }
      buffer[offset + i] = mix / 3.0 * 0.37;
    }
  }
}

// ---------------- 拨码字段 ----------------
const DIP_FIELDS = [
  { name: '玩不玩比倍', sw: 1, bits: [2], labels: ['不玩', '玩'] },
  { name: '轉動速度', sw: 0, bits: [5], labels: ['快', '慢'] },
  { name: '比倍百分比', sw: 0, bits: [0, 4], labels: ['90%', '70%', '80%', '60%'] },
  { name: '猜牌百分比', sw: 1, bits: [6, 7], labels: ['90%', '80%', '70%', '60%'] },
  { name: '彩金中獎限制', sw: 1, bits: [0, 1], labels: ['90%', '80%', '70%', '60%'] },
  { name: '彩金底數', sw: 2, bits: [3, 4], labels: ['800', '600', '400', '200'] },
  { name: '彩金中獎最高分數', sw: 2, bits: [5], labels: ['20000', '10000'] },
  { name: '彩金比數', sw: 0, bits: [6], labels: ['24', '32'] },
  { name: '明星出現千分之', sw: 3, bits: [5, 6, 7], labels: ['20', '18', '16', '14', '12', '10', '8', '6'] },
  { name: '投幣分數', sw: 2, bits: [0, 1, 2], labels: ['1', '5', '10', '20', '30', '40', '50', '100'] },
  { name: '開分分數', sw: 3, bits: [0, 1, 2], labels: ['100', '200', '1000', '1500', '2000', '3000', '4000', '5000'] },
  { name: '退幣限制', sw: 1, bits: [3, 4], labels: ['0', '5000', '2000', '1000'] },
  { name: '洗分', sw: 0, bits: [7], labels: ['1', '100'] },
  { name: '最高押分', sw: 3, bits: [3, 4], labels: ['80', '72', '64', '32'] },
  { name: '最低押分', sw: 2, bits: [6, 7], labels: ['99', '80', '49', '32'] },
];
function dipGet(f, sw) { let v = 0; for (let i = 0; i < f.bits.length; i++) if (sw[f.sw] & (1 << f.bits[i])) v |= 1 << i; return v; }
function dipSet(f, sw, v) { for (let i = 0; i < f.bits.length; i++) { if (v & (1 << i)) sw[f.sw] |= 1 << f.bits[i]; else sw[f.sw] &= ~(1 << f.bits[i]) & 0xff; } }

// ---------------- 主板 ----------------
const Board = (() => {
  const hex = s => Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
  const nvLoadTbl = hex('1ed7dde63b414a36029a24c1f0bbb92a54afb69fb2fadf2ec7815587e3605c04a35d32b5382f96207e6adbff62de4d43aa303cef427df3901865d67161f5113ee5164653abd101a7050a825e0dd9b8760919a9c54b33e22ca00e40886b1afecefbc879133ac063779c00cdfd229be44f48c2a2f7d0e7b0f2d21b802dcbaeb3b1230fa821144e1f918b34938fc96feea6ebdc1d523d35cfd8cc7fb46689921729835b86373f2549c328ad8e5a0b5ff4a48ad5d4ecbd31944c95d347506db772566e7b4459580727e9ac0874fc5770459ee806671539ed03518dc6f875108c78eabc6c6984c499baa17c1cf61268da64738598f1bf26f97a0ca5e1becae09d972b');
  const nvSaveTbl = hex('694608d61f48d1c5c95049acf74c5981dc3eeb6384d3419e38515d79e992008627836c800aa5f4c6a89f0fff577b172531b52255899507a324d4640432943fa45a05342fc2ce42ba70a60654b72e856fbbd79343101abfccc4c3aba11e214bad1d3c2c66ee399bd2ece2295ce1bcc08dcd3bbeefcadb4f67de62f6c1e83528997a194aa0e3f0a21b5b9cb088ddd8aa8b37879d8ab6b826fef1e5096d68fdcf1358e77220aff88f4782523044c8a97d11767f147e9a2312bd4e0ee60de0b4faf3650b71a7e453d918618cfb7c986a5f96744578b9b2b13a01974ded2a91022d16fcf9561c6e400375d0c7df90b3d58e330cf27736ae3dea73daf51560cb6b5e2b');
  const SCREEN_W = 512, SCREEN_H = 256, GAME_H = 224, CYCLES_PER_FRAME = 50000;
  const BUTTON_NAMES = ['大', '比倍', '小', '停A', '停B', '停C', '全停', '得分', '開始', '押'];
  const BUTTON_WIDTHS = [48, 48, 64, 48, 48, 48, 64, 48, 48, 48];
  const BUTTON_X = []; { let x = 0; for (const w of BUTTON_WIDTHS) { BUTTON_X.push(x); x += w; } }
  const BUTTON_CAN_LATCH = [false, false, false, true, true, true, true, true, true, false];
  const cardPatchCave = [0x3a, 0x50, 0x82, 0xe6, 0x0f, 0xd6, 0x02, 0xfe, 0x08, 0x38, 0x07, 0xcd, 0xfa, 0x65, 0xc3, 0x00, 0x66];
  const cardPatchSites = [[0x5c9c, [0xcd, 0x20, 0x7f], [0xcd, 0x0e, 0x7f]], [0x5d3d, [0xcd, 0x20, 0x7f], [0xcd, 0x0e, 0x7f]]];
  const bandVram = [0x9a00, 0x9c00, 0x9e00], bandScroll = [0xb200, 0xb400, 0xb600], bandY = [0x20, 0x60, 0xa0];
  const fixedCols = [0x000000, 0x808080, 0xc0c0c0, 0xffffff, 0x00ffff, 0xffff00, 0x000080];

  class Board {
    constructor(exp, buttonImages) {
      this.mem = new Uint8Array(0x10000); this.mem.set(exp.z80Image);
      this.rom = new Uint8Array(0x8000); this.rom.set(exp.z80Image.subarray(0, 0x8000));
      this.reelTiles = exp.reelTiles; this.fgTiles = exp.fgTiles; this.buttonImages = buttonImages;
      this.cpu = new Z80(this); this.cpu.extraCycles = 2;   // 原版模拟器每条指令多计 2 周期
      this.ay = new Ay8910(1497669.0, 44100);
      this.pal1 = new Uint8Array(0x400); this.pal2 = new Uint8Array(0x400); this.palIdx1 = this.palIdx2 = 0; this.palEn1 = this.palEn2 = false; this.paletteDirty = true;
      this.nmiEnable = false; this.fullReelLayer = false; this.lamps = 0;
      this.in0 = this.in1 = this.in11 = this.in12 = 0xff;
      this.dsw2 = 0xe0; this.dsw10 = 0x0d; this.ay.portA = 0x87; this.ay.portB = 0x07;
      this.keyInFrames = 0; this.keyOutFrames = 0; this.svcSetting = false; this.svcAccount = false;
      this.frame = new Uint8Array(SCREEN_W * SCREEN_H); this.palette = new Uint32Array(256);
      this.buttonHeld = new Array(10).fill(false); this.buttonLatched = new Array(10).fill(false); this.buttonMinHold = new Array(10).fill(0);   // 每次按下至少保持 3 帧（浏览器按键/触摸可能在一帧内按下抬起）
      this.autoStop = false; this.frameCount = 0; this.cardFacePatched = false; this.maxBet80Patched = false;
    }
    static get SCREEN_W() { return SCREEN_W; } static get SCREEN_H() { return SCREEN_H; } static get GAME_H() { return GAME_H; }
    static get BUTTON_NAMES() { return BUTTON_NAMES; } static get BUTTON_CAN_LATCH() { return BUTTON_CAN_LATCH; }
    static get DEFAULT_DIP() { return [0xe0, 0x0d, 0x87, 0x07]; }
    get dip() { return [this.dsw2, this.dsw10, this.ay.portA, this.ay.portB]; }
    set dip(v) { this.dsw2 = v[0]; this.dsw10 = v[1]; this.ay.portA = v[2]; this.ay.portB = v[3]; }

    // ---- 电池存档 ----
    loadNvram(dat) {
      const d = new Uint8Array(0x800); if (dat) d.set(dat.subarray(0, Math.min(dat.length, 0x800))); else d.fill(0x43);
      for (let i = 0; i < 0x800; i++) this.mem[0x8000 + i] = nvLoadTbl[d[i]];
    }
    saveNvram() { const d = new Uint8Array(0x800); for (let i = 0; i < 0x800; i++) d[i] = nvSaveTbl[this.mem[0x8000 + i]]; return d; }

    // ---- 总线 ----
    read(a) {
      if (a < 0x8000) return this.rom[a];
      if (a < 0xa800) return this.mem[a];
      if (a >= 0xc000) return this.mem[a];
      if (a >= 0xb000 && a < 0xb800) return this.mem[a & 0xfe3f];
      return 0xff;
    }
    write(a, v) {
      if (a >= 0x8000 && a < 0xa800) this.mem[a] = v;
      else if (a >= 0xb000 && a < 0xb800) this.mem[a & 0xfe3f] = v;
    }
    inp(port) {
      const p = port & 0xff;
      switch (p & 0xf3) { case 0x00: return this.in0; case 0x01: return this.in1; case 0x02: return this.dsw2; case 0x10: return this.dsw10; case 0x11: return this.in11; case 0x12: return this.in12; }
      if ((p & 0xf1) === 0x31) return this.ay.read();
      switch (p) {
        case 0x52: return this.palEn2 ? 1 : 0; case 0x50: return (this.palIdx2 / 3) | 0;
        case 0x51: if (!this.palEn2) return 0xff; { const v = this.pal2[this.palIdx2] >> 2; this.palIdx2 = (this.palIdx2 + 1) & 0x3ff; return v; }
        case 0x42: return this.palEn1 ? 1 : 0; case 0x40: return (this.palIdx1 / 3) | 0;
        case 0x41: if (!this.palEn1) return 0xff; { const v = this.pal1[this.palIdx1] >> 2; this.palIdx1 = (this.palIdx1 + 1) & 0x3ff; return v; }
      }
      return 0xff;
    }
    out(port, v) {
      const p = port & 0xff;
      if ((p & 0xf0) === 0x20) { this.lamps = v; return; }
      if (p === 0x70) { this.nmiEnable = !!(v & 0x10); this.fullReelLayer = !!(v & 1); return; }
      if ((p & 0xf1) === 0x31) { this.ay.write(v); return; }
      if ((p & 0xf1) === 0x30) { this.ay.selectRegister(v); return; }
      switch (p & 0xf3) {
        case 0x52: this.palEn2 = v !== 0; return; case 0x50: this.palIdx2 = v * 3; return;
        case 0x51: if (this.palEn2) { this.pal2[this.palIdx2] = (v << 2) & 0xff; this.palIdx2 = (this.palIdx2 + 1) & 0x3ff; this.paletteDirty = true; } return;
        case 0x42: this.palEn1 = v !== 0; return; case 0x40: this.palIdx1 = v * 3; return;
        case 0x41: if (this.palEn1) { this.pal1[this.palIdx1] = (v << 2) & 0xff; this.palIdx1 = (this.palIdx1 + 1) & 0x3ff; this.paletteDirty = true; } return;
      }
    }

    /** 软复位：返回当前存档（调用方负责保存），然后重新载入并复位 CPU */
    softReset() {
      const dat = this.saveNvram(); this.loadNvram(dat);
      this.cpu.reset(); this.ay.reset();
      this.pal1.fill(0); this.pal2.fill(0); this.palEn1 = this.palEn2 = false; this.palIdx1 = this.palIdx2 = 0; this.paletteDirty = true;
      this.nmiEnable = false; this.fullReelLayer = false;
      this.buttonHeld.fill(false); this.buttonLatched.fill(false); this.buttonMinHold.fill(0);
      return dat;
    }

    runFrame() {
      let cycles = 0; const cpu = this.cpu;
      while (cycles < CYCLES_PER_FRAME) cycles += cpu.step();
      this.buildInputs();
      if (this.nmiEnable) cpu.nmi();
    }
    pressButton(i) { if (i >= 0 && i < 10) { this.buttonHeld[i] = true; this.buttonMinHold[i] = 3; } }
    releaseButton(i) { if (i >= 0 && i < 10) this.buttonHeld[i] = false; }
    toggleLatch(i) { if (i >= 0 && i < 10 && BUTTON_CAN_LATCH[i]) this.buttonLatched[i] = !this.buttonLatched[i]; }
    buttonActive(i) { return this.buttonHeld[i] || this.buttonLatched[i] || this.buttonMinHold[i] > 0; }
    buildInputs() {
      let p60 = 0xff, p61 = 0xff, p62 = 0xff, p63 = 0xff, stops = 0xff;
      if (this.keyInFrames > 0) { this.keyInFrames--; p63 &= 0xf7; }
      if (this.keyOutFrames > 0) { this.keyOutFrames--; p62 &= 0x7f; }
      if (this.svcSetting) p62 &= 0xf7;
      if (this.svcAccount) p62 &= 0xfb;
      if (this.buttonActive(0)) p63 &= 0xef;
      if (this.buttonActive(1)) p63 &= 0xdf;
      if (this.buttonActive(2)) p60 &= 0xfb;
      if (this.buttonActive(3)) stops &= 0xfe;
      if (this.buttonActive(4)) stops &= 0xfb;
      if (this.buttonActive(5)) stops &= 0xef;
      if (this.buttonActive(6)) stops &= 0x7f;
      if (this.buttonActive(7)) p63 &= 0x7f;
      if (this.buttonActive(8)) p60 &= 0xef;
      if (this.buttonActive(9)) p60 &= 0xfe;
      if (this.autoStop) { if (this.frameCount & 1) p61 &= 0xea; else p61 |= 0x15; }
      else if ((stops & 0x80) === 0) p61 &= 0xea; else p61 &= stops;
      this.frameCount++;
      for (let i = 0; i < 10; i++) if (this.buttonMinHold[i] > 0) this.buttonMinHold[i]--;
      this.in1 = p60; this.in0 = p61; this.in12 = p62; this.in11 = p63;
    }

    // ---- ROM 补丁 ----
    get cardFacePatch() { return this.cardFacePatched; }
    set cardFacePatch(value) {
      if (value === this.cardFacePatched) return;
      const rom = this.rom; let ok = true;
      for (let i = 0; i < 18; i++) if (rom[0x7f0e + i] !== 0 && !this.cardFacePatched) ok = false;
      for (const [a, o] of cardPatchSites) for (let i = 0; i < 3; i++) if (rom[a + i] !== o[i] && !this.cardFacePatched) ok = false;
      if (!ok && value) return;
      if (value) { rom.set(cardPatchCave, 0x7f0e); for (const [a, , pch] of cardPatchSites) rom.set(pch, a); }
      else { rom.fill(0, 0x7f0e, 0x7f0e + cardPatchCave.length); for (const [a, o] of cardPatchSites) rom.set(o, a); }
      this.cardFacePatched = value;
    }
    get maxBet80Patch() { return this.maxBet80Patched; }
    set maxBet80Patch(value) {
      if (value === this.maxBet80Patched) return;
      if (this.rom[0x26ce] !== 0x0e || this.rom[0x26cf] !== (this.maxBet80Patched ? 0x79 : 0x98)) return;
      this.rom[0x26cf] = value ? 0x79 : 0x98; this.maxBet80Patched = value;
    }

    // ---- 显示 ----
    updatePalette() {
      const p = this.pal1;
      for (let i = 0; i < 256; i++) this.palette[i] = (0xff << 24 | p[i * 3 + 2] << 16 | p[i * 3 + 1] << 8 | p[i * 3]) >>> 0;   // ABGR（Canvas 小端）
      for (let i = 0; i < 7; i++) { const c = fixedCols[i]; this.palette[249 + i] = (0xff << 24 | (c & 0xff) << 16 | (c & 0xff00) | (c >> 16)) >>> 0; }
      this.paletteDirty = false;
    }
    renderFrame() {
      const f = this.frame, mem = this.mem, fg = this.fgTiles;
      for (let row = 0; row < 28; row++) for (let col = 0; col < 64; col++) {
        const i = row * 64 + col, code = (mem[0x8880 + i] | mem[0x9080 + i] << 8) & 0x1fff;
        let src = code * 64, dst = row * 8 * SCREEN_W + col * 8;
        for (let y = 0; y < 8; y++) { f.set(fg.subarray(src, src + 8), dst); src += 8; dst += SCREEN_W; }
      }
      if (!this.fullReelLayer) { for (let k = 0; k < 3; k++) this.drawReelBand(bandVram[k], bandScroll[k], bandY[k], 11, 52, bandY[k] - 0x10, 56); }
      else this.drawReelBand(0x9800, 0xb000, 0x10, 0, 64, 0, 224);
      let off = 0; const bi = this.buttonImages;
      for (let i = 0; i < 10; i++) {
        const w = BUTTON_WIDTHS[i]; let img = off + (this.buttonActive(i) ? w * 32 : 0);
        for (let y = 0; y < 32; y++) { f.set(bi.subarray(img, img + w), (GAME_H + y) * SCREEN_W + BUTTON_X[i]); img += w; }
        off += w * 32 * 2;
      }
    }
    drawReelBand(vram, scroll, yBase, colStart, cols, dstY, lines) {
      const f = this.frame, mem = this.mem, rt = this.reelTiles;
      for (let c = 0; c < cols; c++) {
        const col = colStart + c;
        let bl = (yBase + this.read(scroll + col)) & 0xff;
        let idx = vram + ((bl >> 5) << 6) + col;
        let code = (mem[idx] | mem[idx + 0x800] << 8) & 0x7ff;
        let src = code * 256 + (bl & 0x1f) * 8;
        let dst = dstY * SCREEN_W + col * 8;
        for (let y = 0; y < lines; y++) {
          for (let x = 0; x < 8; x++) if (f[dst + x] === 0) f[dst + x] = rt[src + x];
          bl = (bl + 1) & 0xff;
          if ((bl & 0x1f) === 0) { idx = vram + ((bl >> 5) << 6) + col; code = (mem[idx] | mem[idx + 0x800] << 8) & 0x7ff; src = code * 256; }
          else src += 8;
          dst += SCREEN_W;
        }
      }
    }
    static hitTestButton(x, y) {
      if (y < GAME_H || y >= SCREEN_H || x < 0) return -1;
      if (x < 0x90) return (x / 0x30) | 0;
      if (x >= 0xa0 && x < 0x160) return ((x - 0x10) / 0x30) | 0;
      if (x >= 0x170 && x < 0x200) return ((x - 0x20) / 0x30) | 0;
      return -1;
    }
  }
  return Board;
})();
