// Z80 CPU 内核（完整指令集，含 CB/ED/DD/FD/DDCB/FDCB 前缀）—— 直译自 Ladystar97\Z80.cs
// bus: { read(addr), write(addr, v), inp(port), out(port, v) }
'use strict';
const Z80 = (() => {
  const CF = 0x01, NF = 0x02, PF = 0x04, XF = 0x08, HF = 0x10, YF = 0x20, ZF = 0x40, SF = 0x80;
  const parity = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { let p = 0; for (let b = 0; b < 8; b++) p ^= (i >> b) & 1; parity[i] = p === 0 ? PF : 0; }
  const cyc = [
    4,10,7,6,4,4,7,4,4,11,7,6,4,4,7,4, 8,10,7,6,4,4,7,4,12,11,7,6,4,4,7,4,
    7,10,16,6,4,4,7,4,7,11,16,6,4,4,7,4, 7,10,13,6,11,11,10,4,7,11,13,6,4,4,7,4,
    4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4,
    4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4, 7,7,7,7,7,7,4,7,4,4,4,4,4,4,7,4,
    4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4,
    4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,4,4,4,4,4,4,7,4,
    5,10,10,10,10,11,7,11,5,10,10,0,10,17,7,11, 5,10,10,11,10,11,7,11,5,4,10,11,10,0,7,11,
    5,10,10,19,10,11,7,11,5,4,10,4,10,0,7,11, 5,10,10,4,10,11,7,11,5,6,10,4,10,0,7,11];
  const NODISP = -1000000;
  const sb = v => (v & 0x80) ? v - 256 : v;

  class Z80 {
    constructor(bus) {
      this.bus = bus; this.extraCycles = 0;
      this.reset();
    }
    reset() {
      this.A = this.F = this.B = this.C = this.D = this.E = this.H = this.L = this.I = this.R = 0;
      this.A2 = this.F2 = this.B2 = this.C2 = this.D2 = this.E2 = this.H2 = this.L2 = 0;
      this.IX = this.IY = 0; this.SP = 0xffff; this.PC = 0; this.IFF1 = this.IFF2 = false; this.IM = 0; this.halted = false;
    }
    incR() { this.R = (this.R & 0x80) | ((this.R + 1) & 0x7f); }
    get HL() { return this.H << 8 | this.L; } set HL(v) { this.H = (v >> 8) & 0xff; this.L = v & 0xff; }
    get BC() { return this.B << 8 | this.C; } set BC(v) { this.B = (v >> 8) & 0xff; this.C = v & 0xff; }
    get DE() { return this.D << 8 | this.E; } set DE(v) { this.D = (v >> 8) & 0xff; this.E = v & 0xff; }
    get AF() { return this.A << 8 | this.F; } set AF(v) { this.A = (v >> 8) & 0xff; this.F = v & 0xff; }
    fetch() { const v = this.bus.read(this.PC); this.PC = (this.PC + 1) & 0xffff; return v; }
    fetch16() { const v = this.bus.read(this.PC) | this.bus.read((this.PC + 1) & 0xffff) << 8; this.PC = (this.PC + 2) & 0xffff; return v; }
    read16(a) { return this.bus.read(a) | this.bus.read((a + 1) & 0xffff) << 8; }
    write16(a, v) { this.bus.write(a, v & 0xff); this.bus.write((a + 1) & 0xffff, (v >> 8) & 0xff); }
    push(v) { this.SP = (this.SP - 2) & 0xffff; this.write16(this.SP, v); }
    pop() { const v = this.read16(this.SP); this.SP = (this.SP + 2) & 0xffff; return v; }

    nmi() { this.halted = false; this.IFF2 = this.IFF1; this.IFF1 = false; this.push(this.PC); this.PC = 0x66; }
    irq(data = 0xff) {
      if (!this.IFF1) return false;
      this.halted = false; this.IFF1 = this.IFF2 = false; this.push(this.PC);
      this.PC = this.IM === 2 ? this.read16((this.I << 8 | data) & 0xffff) : 0x38;
      return true;
    }

    // ---- 标志辅助 ----
    static sz(v) { return (v === 0 ? ZF : 0) | (v & (SF | XF | YF)); }
    add8(v, c) { const A = this.A, r = A + v + c, res = r & 0xff;
      this.F = Z80.sz(res) | ((r >> 8) & CF) | ((A ^ v ^ res) & HF) | ((((A ^ v ^ 0x80) & (v ^ res)) & 0x80) ? PF : 0); this.A = res; }
    sub8(v, c) { const A = this.A, r = A - v - c, res = r & 0xff;
      this.F = Z80.sz(res) | NF | ((r >> 8) & CF) | ((A ^ v ^ res) & HF) | ((((A ^ v) & (A ^ res)) & 0x80) ? PF : 0); this.A = res; }
    cp8(v) { const A = this.A, r = A - v, res = r & 0xff;
      this.F = (res === 0 ? ZF : 0) | (res & SF) | (v & (XF | YF)) | NF | ((r >> 8) & CF) | ((A ^ v ^ res) & HF) | ((((A ^ v) & (A ^ res)) & 0x80) ? PF : 0); }
    and8(v) { this.A &= v; this.F = Z80.sz(this.A) | HF | parity[this.A]; }
    or8(v) { this.A |= v; this.F = Z80.sz(this.A) | parity[this.A]; }
    xor8(v) { this.A ^= v; this.F = Z80.sz(this.A) | parity[this.A]; }
    inc8(v) { const r = (v + 1) & 0xff; this.F = (this.F & CF) | Z80.sz(r) | ((r & 0x0f) === 0 ? HF : 0) | (r === 0x80 ? PF : 0); return r; }
    dec8(v) { const r = (v - 1) & 0xff; this.F = (this.F & CF) | Z80.sz(r) | NF | ((r & 0x0f) === 0x0f ? HF : 0) | (r === 0x7f ? PF : 0); return r; }
    add16(a, b) { const r = a + b; this.F = (this.F & (SF | ZF | PF)) | ((r >> 16) & CF) | (((a ^ b ^ r) >> 8) & HF) | ((r >> 8) & (XF | YF)); return r & 0xffff; }
    adc16(b) { const a = this.HL, c = this.F & CF, r = a + b + c, res = r & 0xffff;
      this.F = ((r >> 16) & CF) | (res === 0 ? ZF : 0) | ((res >> 8) & (SF | XF | YF)) | (((a ^ b ^ res) >> 8) & HF) | ((((a ^ b ^ 0x8000) & (b ^ res)) & 0x8000) ? PF : 0); this.HL = res; }
    sbc16(b) { const a = this.HL, c = this.F & CF, r = a - b - c, res = r & 0xffff;
      this.F = NF | ((r >> 16) & CF) | (res === 0 ? ZF : 0) | ((res >> 8) & (SF | XF | YF)) | (((a ^ b ^ res) >> 8) & HF) | ((((a ^ b) & (a ^ res)) & 0x8000) ? PF : 0); this.HL = res; }

    rlc(v) { const r = ((v << 1) | (v >> 7)) & 0xff; this.F = Z80.sz(r) | parity[r] | (v >> 7); return r; }
    rrc(v) { const r = ((v >> 1) | (v << 7)) & 0xff; this.F = Z80.sz(r) | parity[r] | (v & 1); return r; }
    rl(v) { const r = ((v << 1) | (this.F & CF)) & 0xff; this.F = Z80.sz(r) | parity[r] | (v >> 7); return r; }
    rr(v) { const r = ((v >> 1) | ((this.F & CF) << 7)) & 0xff; this.F = Z80.sz(r) | parity[r] | (v & 1); return r; }
    sla(v) { const r = (v << 1) & 0xff; this.F = Z80.sz(r) | parity[r] | (v >> 7); return r; }
    sra(v) { const r = (v >> 1) | (v & 0x80); this.F = Z80.sz(r) | parity[r] | (v & 1); return r; }
    sll(v) { const r = ((v << 1) | 1) & 0xff; this.F = Z80.sz(r) | parity[r] | (v >> 7); return r; }
    srl(v) { const r = v >> 1; this.F = Z80.sz(r) | parity[r] | (v & 1); return r; }
    bit(b, v) { const m = v & (1 << b); this.F = (this.F & CF) | HF | (m === 0 ? (ZF | PF) : 0) | (m & SF) | (v & (XF | YF)); }
    daa() {
      let a = this.A; const c = this.F & CF, h = this.F & HF, n = this.F & NF;
      let add = 0, carry = 0;
      if (h || (a & 0x0f) > 9) add = 6;
      if (c || a > 0x99) { add |= 0x60; carry = CF; }
      let newH;
      if (n) { newH = (h && (a & 0x0f) < 6) ? HF : 0; a = (a - add) & 0xff; }
      else { newH = ((a & 0x0f) > 9) ? HF : 0; a = (a + add) & 0xff; }
      this.A = a; this.F = Z80.sz(a) | parity[a] | n | newH | carry;
    }

    // 8 位寄存器索引访问：0=B 1=C 2=D 3=E 4=H 5=L 6=(HL) 7=A；st = {disp, cycles}
    getR(i, prefix, st) {
      switch (i) {
        case 0: return this.B; case 1: return this.C; case 2: return this.D; case 3: return this.E;
        case 4: return prefix === 1 ? this.IX >> 8 : prefix === 2 ? this.IY >> 8 : this.H;
        case 5: return prefix === 1 ? this.IX & 0xff : prefix === 2 ? this.IY & 0xff : this.L;
        case 6:
          if (prefix === 0) return this.bus.read(this.HL);
          if (st.disp === NODISP) { st.disp = sb(this.fetch()); st.cycles += 8; }
          return this.bus.read(((prefix === 1 ? this.IX : this.IY) + st.disp) & 0xffff);
        default: return this.A;
      }
    }
    setR(i, v, prefix, st) {
      switch (i) {
        case 0: this.B = v; break; case 1: this.C = v; break; case 2: this.D = v; break; case 3: this.E = v; break;
        case 4: if (prefix === 1) this.IX = (this.IX & 0xff) | v << 8; else if (prefix === 2) this.IY = (this.IY & 0xff) | v << 8; else this.H = v; break;
        case 5: if (prefix === 1) this.IX = (this.IX & 0xff00) | v; else if (prefix === 2) this.IY = (this.IY & 0xff00) | v; else this.L = v; break;
        case 6:
          if (prefix === 0) { this.bus.write(this.HL, v); break; }
          if (st.disp === NODISP) { st.disp = sb(this.fetch()); st.cycles += 8; }
          this.bus.write(((prefix === 1 ? this.IX : this.IY) + st.disp) & 0xffff, v); break;
        default: this.A = v; break;
      }
    }
    getRP(i, prefix) { switch (i) { case 0: return this.BC; case 1: return this.DE; case 2: return prefix === 1 ? this.IX : prefix === 2 ? this.IY : this.HL; default: return this.SP; } }
    setRP(i, v, prefix) { switch (i) { case 0: this.BC = v; break; case 1: this.DE = v; break; case 2: if (prefix === 1) this.IX = v; else if (prefix === 2) this.IY = v; else this.HL = v; break; default: this.SP = v; break; } }
    cond(cc) { const F = this.F; switch (cc) { case 0: return !(F & ZF); case 1: return !!(F & ZF); case 2: return !(F & CF); case 3: return !!(F & CF); case 4: return !(F & PF); case 5: return !!(F & PF); case 6: return !(F & SF); default: return !!(F & SF); } }

    step() {
      if (this.halted) { this.incR(); return 4 + this.extraCycles; }
      return this.exec(0) + this.extraCycles;
    }

    exec(prefix) {
      const op = this.fetch(); this.incR();
      const st = { disp: NODISP, cycles: cyc[op] + (prefix !== 0 ? 4 : 0) };
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
      if (x === 1) {
        if (op === 0x76) { this.halted = true; return st.cycles; }
        if (prefix !== 0 && (y === 6 || z === 6)) {
          if (z === 6) { const v = this.getR(6, prefix, st); this.setR(y, v, 0, st); }
          else { const v = this.getR(z, 0, st); this.setR(6, v, prefix, st); }
        } else { const v = this.getR(z, prefix, st); this.setR(y, v, prefix, st); }
        return st.cycles;
      }
      if (x === 2) { this.alu(y, this.getR(z, prefix, st)); return st.cycles; }
      if (x === 0) {
        switch (z) {
          case 0:
            switch (y) {
              case 0: break;
              case 1: { let t = this.A; this.A = this.A2; this.A2 = t; t = this.F; this.F = this.F2; this.F2 = t; break; }
              case 2: { const d = sb(this.fetch()); this.B = (this.B - 1) & 0xff; if (this.B !== 0) { this.PC = (this.PC + d) & 0xffff; st.cycles += 5; } break; }
              case 3: { const d = sb(this.fetch()); this.PC = (this.PC + d) & 0xffff; break; }
              default: { const d = sb(this.fetch()); if (this.cond(y - 4)) { this.PC = (this.PC + d) & 0xffff; st.cycles += 5; } break; }
            }
            break;
          case 1:
            if (q === 0) this.setRP(p, this.fetch16(), prefix);
            else { const hl = this.getRP(2, prefix); this.setRP(2, this.add16(hl, this.getRP(p, prefix)), prefix); }
            break;
          case 2:
            switch (y) {
              case 0: this.bus.write(this.BC, this.A); break;
              case 1: this.A = this.bus.read(this.BC); break;
              case 2: this.bus.write(this.DE, this.A); break;
              case 3: this.A = this.bus.read(this.DE); break;
              case 4: this.write16(this.fetch16(), this.getRP(2, prefix)); break;
              case 5: this.setRP(2, this.read16(this.fetch16()), prefix); break;
              case 6: this.bus.write(this.fetch16(), this.A); break;
              default: this.A = this.bus.read(this.fetch16()); break;
            }
            break;
          case 3:
            if (q === 0) this.setRP(p, (this.getRP(p, prefix) + 1) & 0xffff, prefix); else this.setRP(p, (this.getRP(p, prefix) - 1) & 0xffff, prefix);
            break;
          case 4: { const v = this.getR(y, prefix, st); this.setR(y, this.inc8(v), prefix, st); break; }
          case 5: { const v = this.getR(y, prefix, st); this.setR(y, this.dec8(v), prefix, st); break; }
          case 6: {
            if (y === 6 && prefix !== 0) { st.disp = sb(this.fetch()); st.cycles += 8; }
            const v = this.fetch(); this.setR(y, v, prefix, st); break;
          }
          default:
            switch (y) {
              case 0: { const c = this.A >> 7; this.A = ((this.A << 1) | c) & 0xff; this.F = (this.F & (SF | ZF | PF)) | c | (this.A & (XF | YF)); break; }
              case 1: { const c = this.A & 1; this.A = (this.A >> 1) | (c << 7); this.F = (this.F & (SF | ZF | PF)) | c | (this.A & (XF | YF)); break; }
              case 2: { const c = this.A >> 7; this.A = ((this.A << 1) | (this.F & CF)) & 0xff; this.F = (this.F & (SF | ZF | PF)) | c | (this.A & (XF | YF)); break; }
              case 3: { const c = this.A & 1; this.A = (this.A >> 1) | ((this.F & CF) << 7); this.F = (this.F & (SF | ZF | PF)) | c | (this.A & (XF | YF)); break; }
              case 4: this.daa(); break;
              case 5: this.A = (~this.A) & 0xff; this.F = (this.F & (SF | ZF | PF | CF)) | HF | NF | (this.A & (XF | YF)); break;
              case 6: this.F = (this.F & (SF | ZF | PF)) | CF | (this.A & (XF | YF)); break;
              default: this.F = (this.F & (SF | ZF | PF)) | ((this.F & CF) ? HF : CF) | (this.A & (XF | YF)); break;
            }
            break;
        }
        return st.cycles;
      }
      // x === 3
      switch (z) {
        case 0: if (this.cond(y)) { this.PC = this.pop(); st.cycles += 6; } break;
        case 1:
          if (q === 0) { const v = this.pop(); if (p === 3) this.AF = v; else this.setRP(p, v, prefix); }
          else switch (p) {
            case 0: this.PC = this.pop(); break;
            case 1: { let t; t = this.B; this.B = this.B2; this.B2 = t; t = this.C; this.C = this.C2; this.C2 = t; t = this.D; this.D = this.D2; this.D2 = t; t = this.E; this.E = this.E2; this.E2 = t; t = this.H; this.H = this.H2; this.H2 = t; t = this.L; this.L = this.L2; this.L2 = t; break; }
            case 2: this.PC = this.getRP(2, prefix); break;
            default: this.SP = this.getRP(2, prefix); break;
          }
          break;
        case 2: { const a = this.fetch16(); if (this.cond(y)) this.PC = a; break; }
        case 3:
          switch (y) {
            case 0: this.PC = this.fetch16(); break;
            case 1: st.cycles += this.execCB(prefix); break;
            case 2: { const port = this.fetch(); this.bus.out((this.A << 8 | port) & 0xffff, this.A); break; }
            case 3: { const port = this.fetch(); this.A = this.bus.inp((this.A << 8 | port) & 0xffff); break; }
            case 4: { const v = this.read16(this.SP); this.write16(this.SP, this.getRP(2, prefix)); this.setRP(2, v, prefix); break; }
            case 5: { const t = this.DE; this.DE = this.HL; this.HL = t; break; }
            case 6: this.IFF1 = this.IFF2 = false; break;
            default: this.IFF1 = this.IFF2 = true; break;
          }
          break;
        case 4: { const a = this.fetch16(); if (this.cond(y)) { this.push(this.PC); this.PC = a; st.cycles += 7; } break; }
        case 5:
          if (q === 0) this.push(p === 3 ? this.AF : this.getRP(p, prefix));
          else switch (p) {
            case 0: { const a = this.fetch16(); this.push(this.PC); this.PC = a; break; }
            case 1: return st.cycles + this.exec(1) - 4;
            case 2: return st.cycles + this.execED() - 4;
            default: return st.cycles + this.exec(2) - 4;
          }
          break;
        case 6: this.alu(y, this.fetch()); break;
        default: this.push(this.PC); this.PC = y * 8; break;
      }
      return st.cycles;
    }

    alu(y, v) {
      switch (y) {
        case 0: this.add8(v, 0); break; case 1: this.add8(v, this.F & CF); break; case 2: this.sub8(v, 0); break; case 3: this.sub8(v, this.F & CF); break;
        case 4: this.and8(v); break; case 5: this.xor8(v); break; case 6: this.or8(v); break; default: this.cp8(v); break;
      }
    }

    execCB(prefix) {
      const st = { disp: NODISP, cycles: 4 };
      let addr = 0;
      if (prefix !== 0) { st.disp = sb(this.fetch()); addr = ((prefix === 1 ? this.IX : this.IY) + st.disp) & 0xffff; st.cycles += 12; }
      const op = this.fetch(); this.incR();
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
      let v;
      if (prefix !== 0) v = this.bus.read(addr);
      else { v = this.getR(z, 0, st); if (z === 6) st.cycles += 4; }
      switch (x) {
        case 0:
          switch (y) { case 0: v = this.rlc(v); break; case 1: v = this.rrc(v); break; case 2: v = this.rl(v); break; case 3: v = this.rr(v); break; case 4: v = this.sla(v); break; case 5: v = this.sra(v); break; case 6: v = this.sll(v); break; default: v = this.srl(v); break; }
          break;
        case 1:
          this.bit(y, v);
          if (prefix !== 0 || z === 6) this.F = (this.F & ~(XF | YF)) | ((prefix !== 0 ? (addr >> 8) : this.H) & (XF | YF));
          return st.cycles;
        case 2: v &= ~(1 << y) & 0xff; break;
        default: v |= (1 << y); break;
      }
      if (prefix !== 0) { this.bus.write(addr, v); if (z !== 6) this.setR(z, v, 0, st); }
      else this.setR(z, v, 0, st);
      return st.cycles;
    }

    execED() {
      const op = this.fetch(); this.incR();
      let cycles = 8;
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
      const st = { disp: NODISP, cycles: 0 };
      if (x === 1) {
        switch (z) {
          case 0: { const v = this.bus.inp(this.BC); this.F = (this.F & CF) | Z80.sz(v) | parity[v]; if (y !== 6) this.setR(y, v, 0, st); cycles = 12; break; }
          case 1: { const v = y === 6 ? 0 : this.getR(y, 0, st); this.bus.out(this.BC, v); cycles = 12; break; }
          case 2: if (q === 0) this.sbc16(this.getRP(p, 0)); else this.adc16(this.getRP(p, 0)); cycles = 15; break;
          case 3: if (q === 0) this.write16(this.fetch16(), this.getRP(p, 0)); else this.setRP(p, this.read16(this.fetch16()), 0); cycles = 20; break;
          case 4: { const a = this.A; this.A = 0; this.sub8(a, 0); break; }
          case 5: this.PC = this.pop(); if (y !== 1) this.IFF1 = this.IFF2; cycles = 14; break;
          case 6: this.IM = (y === 0 || y === 1 || y === 4 || y === 5) ? 0 : (y === 2 || y === 6) ? 1 : 2; break;
          default:
            switch (y) {
              case 0: this.I = this.A; cycles = 9; break;
              case 1: this.R = this.A; cycles = 9; break;
              case 2: this.A = this.I; this.F = (this.F & CF) | Z80.sz(this.A) | (this.IFF2 ? PF : 0); cycles = 9; break;
              case 3: this.A = this.R; this.F = (this.F & CF) | Z80.sz(this.A) | (this.IFF2 ? PF : 0); cycles = 9; break;
              case 4: { const m = this.bus.read(this.HL); this.bus.write(this.HL, ((m >> 4) | (this.A << 4)) & 0xff); this.A = (this.A & 0xf0) | (m & 0x0f); this.F = (this.F & CF) | Z80.sz(this.A) | parity[this.A]; cycles = 18; break; }
              case 5: { const m = this.bus.read(this.HL); this.bus.write(this.HL, ((m << 4) | (this.A & 0x0f)) & 0xff); this.A = (this.A & 0xf0) | (m >> 4); this.F = (this.F & CF) | Z80.sz(this.A) | parity[this.A]; cycles = 18; break; }
              default: break;
            }
            break;
        }
        return cycles;
      }
      if (x === 2 && z <= 3 && y >= 4) {
        const dir = (y & 1) === 0 ? 1 : -1, rep = y >= 6;
        cycles = 16;
        switch (z) {
          case 0: {
            const v = this.bus.read(this.HL); this.bus.write(this.DE, v);
            this.HL = (this.HL + dir) & 0xffff; this.DE = (this.DE + dir) & 0xffff; this.BC = (this.BC - 1) & 0xffff;
            const n = v + this.A;
            this.F = (this.F & (SF | ZF | CF)) | (this.BC !== 0 ? PF : 0) | (n & XF) | ((n & 2) ? YF : 0);
            if (rep && this.BC !== 0) { this.PC = (this.PC - 2) & 0xffff; cycles = 21; }
            break;
          }
          case 1: {
            const v = this.bus.read(this.HL), r = this.A - v, res = r & 0xff;
            this.HL = (this.HL + dir) & 0xffff; this.BC = (this.BC - 1) & 0xffff;
            const hf = (this.A ^ v ^ res) & HF, n = res - (hf ? 1 : 0);
            this.F = (this.F & CF) | NF | (res === 0 ? ZF : 0) | (res & SF) | hf | (this.BC !== 0 ? PF : 0) | (n & XF) | ((n & 2) ? YF : 0);
            if (rep && this.BC !== 0 && res !== 0) { this.PC = (this.PC - 2) & 0xffff; cycles = 21; }
            break;
          }
          case 2: {
            const v = this.bus.inp(this.BC); this.bus.write(this.HL, v);
            this.B = (this.B - 1) & 0xff; this.HL = (this.HL + dir) & 0xffff;
            this.F = Z80.sz(this.B) | NF;
            if (rep && this.B !== 0) { this.PC = (this.PC - 2) & 0xffff; cycles = 21; }
            break;
          }
          default: {
            const v = this.bus.read(this.HL);
            this.B = (this.B - 1) & 0xff; this.bus.out(this.BC, v); this.HL = (this.HL + dir) & 0xffff;
            this.F = Z80.sz(this.B) | NF;
            if (rep && this.B !== 0) { this.PC = (this.PC - 2) & 0xffff; cycles = 21; }
            break;
          }
        }
        return cycles;
      }
      return cycles;
    }
  }
  return Z80;
})();
