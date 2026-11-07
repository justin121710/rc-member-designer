/* Midas 匯入（core/midas-io.js）單元測試：直接 require，不開瀏覽器。
   範例模型：P1 墩柱 3 個元素（101–103，節點 1→4 由下往上）、帽梁 2 個元素（201–202）。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const M = require('../core/midas-io.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}：實際 ${a}，期望 ${b}`);
const FIX = path.join(__dirname, 'fixtures');
const MCT = fs.readFileSync(path.join(FIX, 'midas_pier.mct'), 'utf8');
const TBL = fs.readFileSync(path.join(FIX, 'midas_beam_force.txt'), 'utf8');

test('編號清單語法', () => {
  assert.deepEqual(M.expandList('1to5by2 8, 10to11'), [1, 3, 5, 8, 10, 11]);
  assert.deepEqual(M.expandList(''), []);
});

test('單位：標題括號與換算係數', () => {
  assert.deepEqual(M.unitOf('Axial (tonf)'), {force: 'TONF', len: null});
  assert.deepEqual(M.unitOf('Moment-y (kN*m)'), {force: 'KN', len: 'M'});
  assert.deepEqual(M.unitOf('Moment-y (tf·m)'), {force: 'TF', len: 'M'});
  assert.deepEqual(M.unitOf('Moment (kgf-cm)'), {force: 'KGF', len: 'CM'});
  assert.equal(M.unitOf('Elem'), null);
  near(M.forceK('kN'), 101.97162, 1e-4, 'kN → kgf');
});

test('MCT：單位、節點、元素、群組（含續行）、斷面、材料', () => {
  const m = M.parseMct(MCT);
  assert.deepEqual(m.unit, {force: 'TONF', len: 'M'});
  assert.equal(m.counts.nodes, 7);
  assert.deepEqual(m.elems[101], {type: 'BEAM', mat: 1, sect: 1, i: 1, j: 2});
  assert.deepEqual(m.groups.map(g => g.name), ['P1_COL', 'P1_CAP']);
  assert.deepEqual(m.groups[0].elems, [101, 102, 103]);
  assert.deepEqual(m.groups[1].elems, [201, 202]);
  assert.equal(m.sects[1].shape, 'SB'); assert.deepEqual(m.sects[1].dims.slice(0, 2), [2.4, 1.8]);
  assert.equal(m.sects[3].shape, 'SR');
  assert.equal(m.mats[1].name, 'C350');
  assert.equal(M.fcFromName('C350'), 350); assert.equal(M.fcFromName("fc'=280kgf"), 280);
  assert.equal(M.fcFromName('C35'), null); assert.equal(M.fcFromName('SS400'), null);
});

test('斷面對應（m → cm）', () => {
  const m = M.parseMct(MCT);
  const r = M.sectionToRc(m.sects[1], 'M');
  assert.equal(r.secType, 'solid'); near(r.H, 240, 1e-9, 'H'); near(r.B, 180, 1e-9, 'B');
  const c = M.sectionToRc(m.sects[3], 'M'); assert.equal(c.secType, 'circle'); near(c.Dia, 150, 1e-9, 'D');
  const b = M.sectionToRc(m.sects[4], 'M'); assert.equal(b.secType, 'box'); near(b.tw, 40, 1e-9, 'tw 取最小'); assert.ok(b.note);
  assert.equal(M.sectionToRc(m.sects[5], 'M').ok, false);    // 資料庫斷面無尺寸
  assert.equal(M.sectionToRc(m.sects[1], null).ok, false);
});

test('內力表：欄位辨識、單位、Part、續列沿用元素與組合', () => {
  const t = M.parseForceTable(TBL);
  assert.ok(t.ok, t.why);
  assert.deepEqual(t.units, {force: 'TONF', len: 'M', src: {force: 'header', len: 'header'}});
  assert.deepEqual(t.loads, ['DL', 'cLCB1', 'cLCB2', 'cLCB3(max)']);
  assert.deepEqual(t.envelope, ['cLCB3(max)']);
  const r = t.rows.find(x => x.elem === 102 && x.load === 'cLCB2' && x.end === 'J');
  near(r.My, 100, 1e-9, 'My'); near(r.N, -830, 1e-9, 'N');
  // 空白元素／組合欄沿用上一列
  assert.ok(t.rows.some(x => x.elem === 201 && x.end === 'M' && Math.abs(x.frac - 0.5) < 1e-9));
  assert.ok(t.warnings.some(w => /包絡/.test(w)));
});

test('內力表：kN、mm 換算為 tf、tf·m；無單位時需 fallback', () => {
  const txt = 'Elem,Load,Part,Axial (kN),Shear-y (kN),Shear-z (kN),Torsion (kN*mm),Moment-y (kN*mm),Moment-z (kN*mm)\n'
            + '5,LC1,I[1],-9806.65,0,98.0665,0,9806650,0';
  const t = M.parseForceTable(txt);
  near(t.rows[0].N, -1000, 1e-9, 'N tf'); near(t.rows[0].Vz, 10, 1e-9, 'Vz tf'); near(t.rows[0].My, 1000, 1e-6, 'My tf·m');
  const bare = 'Elem\tLoad\tPart\tAxial\tMoment-y\n5\tLC1\tJ[2]\t-10\t3';
  const n = M.parseForceTable(bare); assert.equal(n.ok, false); assert.ok(n.needUnit);
  const f = M.parseForceTable(bare, {force: 'TONF', len: 'M'}); assert.ok(f.ok); near(f.rows[0].My, 3, 1e-12, 'fallback');
  // 單位在第二列（Excel 匯出）
  const two = M.parseForceTable([['Elem','Load','Part','Axial','Moment-y'], ['','','','tonf','tonf*m'], ['5','LC1','I[1]','-5','2']]);
  assert.ok(two.ok, two.why); near(two.rows[0].My, 2, 1e-12, '第二列單位');
  assert.equal(M.parseForceTable('隨便的文字\n1,2,3').ok, false);
});

test('柱：正負號、頂底配對、控制組合、包絡排除', () => {
  const m = M.parseMct(MCT), t = M.parseForceTable(TBL);
  const r = M.columnLoads(t, [101, 102, 103], m, {loads: ['cLCB1', 'cLCB2']});
  // 頂＝節點 4（元素 103 J 端），底＝節點 1（元素 101 I 端）
  const top2 = r.loads.find(l => l.name === 'cLCB2' && l.pos === 'top'), bot2 = r.loads.find(l => l.name === 'cLCB2' && l.pos === 'bot');
  near(top2.Pu, 820, 1e-9, 'Pu 壓為正'); near(top2.Mux, 300, 1e-9, 'Mux ← My'); near(top2.Muy, 40, 1e-9, 'Muy ← Mz');
  near(top2.Vuy, -95, 1e-9, 'Vuy ← Shear-z'); near(top2.Vux, 12, 1e-9, 'Vux ← Shear-y');
  near(bot2.Mux, -520, 1e-9, '底端 Mux');
  // cLCB2 在 102 J 端（中間節點 3）有 Pu 最大（830）→ 另列中間控制點
  assert.ok(r.loads.some(l => l.name === 'cLCB2 @E102-J' && l.pos === undefined));
  assert.ok(r.ctrl.some(c => c.why === 'P_u 最大' && c.load === 'cLCB2' && c.tag === 'E102-J'));
  // x／y 對調
  const s = M.columnLoads(t, [101, 102, 103], m, {loads: ['cLCB2'], swap: true});
  near(s.loads.find(l => l.pos === 'top').Mux, 40, 1e-9, '對調後 Mux');
  // 預設不含包絡與只列控制組合
  const d = M.columnLoads(t, [101, 102, 103], m, {});
  assert.ok(!d.loads.some(l => /max/.test(l.name)));
  assert.equal(M.deadAxial(t, [101, 102, 103], m, 'DL'), 600);
});

test('柱：沒有 .mct 時依元素編號推頂底並警示', () => {
  const t = M.parseForceTable(TBL);
  const r = M.columnLoads(t, [101, 102, 103], null, {loads: ['cLCB2']});
  near(r.loads.find(l => l.pos === 'top').Mux, 300, 1e-9, '頂');
  assert.ok(r.warnings.some(w => /沒有 \.mct/.test(w)));
});

test('梁：每組合取最大正負彎矩、剪力、扭矩；控制組合；正負號切換', () => {
  const m = M.parseMct(MCT), t = M.parseForceTable(TBL);
  const r = M.beamLoads(t, [201, 202], m, {loads: ['DL', 'cLCB1', 'cLCB2']});
  const c1 = r.loads.find(l => l.name === 'cLCB1');
  near(c1.Mpos, 150, 1e-9, 'M⁺'); near(c1.Mneg, 480, 1e-9, 'M⁻'); near(c1.Vu, 210, 1e-9, 'V'); near(c1.Tu, 8, 1e-9, 'T');
  assert.ok(!r.loads.some(l => l.name === 'DL'), 'DL 不控制');
  assert.ok(r.ctrl.some(c => c.why === 'M_u⁻ 最大' && c.load === 'cLCB1'));
  const f = M.beamLoads(t, [201, 202], m, {loads: ['cLCB1'], sagPos: false});
  near(f.loads[0].Mpos, 480, 1e-9, '切換後 M⁺'); near(f.loads[0].Mneg, 150, 1e-9, '切換後 M⁻');
  const all = M.beamLoads(t, [201, 202], m, {loads: ['DL', 'cLCB1', 'cLCB2'], all: true});
  assert.equal(all.loads.length, 3);
  assert.ok(r.warnings.some(w => /側向彎矩/.test(w)));
});

test('載重指紋', () => {
  const a = [{name: 'A', Pu: 1, Mux: 2}], b = [{name: 'A', Pu: 1, Mux: 2.0004}], c = [{name: 'A', Pu: 1, Mux: 2.1}];
  assert.equal(M.loadsKey(a), M.loadsKey(b)); assert.notEqual(M.loadsKey(a), M.loadsKey(c));
});
