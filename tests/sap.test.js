/* SAP2000 匯入（core/sap-io.js）單元測試：直接 require，不開瀏覽器。
   fixtures/sap_*.{txt,s2k} 由 midas_pier.mct、midas_beam_force.txt 逐列轉成 SAP2000 的寫法
   （P＝Axial、V2＝Shear-z、V3＝Shear-y、M2＝Moment-z、M3＝Moment-y、Station＝距 I 端長度），
   所以柱、梁的控制組合與換算後內力必須和 Midas 版完全相同。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const M = require('../core/midas-io.js');
const S = require('../core/sap-io.js');

const FIX = path.join(__dirname, 'fixtures');
const rd = f => fs.readFileSync(path.join(FIX, f), 'utf8');
const MCT = rd('midas_pier.mct'), TBL = rd('midas_beam_force.txt');
const S2K = rd('sap_pier.s2k'), STBL = rd('sap_frame_force.txt'), STBL2 = rd('sap_frame_force.s2k');
const strip = ls => ls.map(l => ({...l, name: l.name.replace(/\(ST\)$/, '')}));

test('SAP2000 表格：辨識、單位列、Station → I／J／中間、載重名稱', () => {
  assert.ok(S.isSapTable(STBL));
  assert.ok(!S.isSapTable(TBL), 'Midas 表格不會被當成 SAP2000');
  assert.ok(!M.parseForceTable(STBL).ok, 'Midas 解析器讀不到 SAP2000 表格（各走各的）');
  const t = S.parseForceTable(STBL);
  assert.ok(t.ok);
  assert.equal(t.prog, 'sap');
  assert.deepEqual(t.units, {force: 'TONF', len: 'M', src: {force: 'header', len: 'header'}});
  assert.deepEqual(t.loads, ['DL(ST)', 'cLCB1', 'cLCB2', 'cLCB3(max)']);
  const r = t.rows.filter(x => x.elem === 201 && x.load === 'DL(ST)');
  assert.deepEqual(r.map(x => x.end), ['I', 'M', 'J']);
  assert.equal(r[1].frac, 0.5);
  assert.ok(t.warnings.some(w => /包絡/.test(w)));
  assert.ok(t.warnings.some(w => /M_ux = M3/.test(w)));
});

test('SAP2000 .s2k 文字格式的內力表與表格版結果相同', () => {
  const a = S.parseForceTable(STBL), b = S.parseForceTable(STBL2);
  assert.ok(b.ok);
  assert.deepEqual(b.loads, a.loads);
  assert.deepEqual(b.rows, a.rows);
});

test('SAP2000 模型檔：單位、節點、元素、群組、斷面、材料', () => {
  assert.ok(S.isS2k(S2K));
  const m = S.parseModel(S2K);
  assert.deepEqual(m.unit, {force: 'TONF', len: 'M'});
  assert.equal(m.counts.nodes, 6);
  assert.deepEqual(m.elems[101], {type: 'BEAM', mat: 1, sect: 1, i: 1, j: 2});
  assert.deepEqual(m.groups.map(g => g.name), ['P1_COL', 'P1_CAP'], '「All」群組略過');
  assert.deepEqual(m.groups[0].elems, [101, 102, 103]);
  const col = M.sectionToRc(m.sects[m.elems[101].sect], m.unit.len);
  assert.deepEqual(col, {ok: true, secType: 'solid', H: 240, B: 180});
  assert.equal(M.sectionToRc(m.sects[3], 'M').secType, 'circle');
  const box = M.sectionToRc(m.sects[4], 'M');
  assert.equal(box.secType, 'box'); assert.equal(box.tw, 40);
  assert.equal(M.fcFromName(m.mats[m.elems[101].mat].name), 350);
});

test('柱：SAP2000 與 Midas 版的控制組合、頂底、內力完全相同', () => {
  const mm = M.parseMct(MCT), mt = M.parseForceTable(TBL);
  const sm = S.parseModel(S2K), st = S.parseForceTable(STBL);
  const a = M.columnLoads(mt, [101, 102, 103], mm), b = M.columnLoads(st, [101, 102, 103], sm);
  assert.deepEqual(strip(b.loads), a.loads);
  assert.deepEqual(b.ctrl.map(c => [c.why, c.load.replace(/\(ST\)$/, ''), c.v]), a.ctrl.map(c => [c.why, c.load, c.v]));
  assert.equal(M.deadAxial(st, [101, 102, 103], sm, 'DL(ST)'), M.deadAxial(mt, [101, 102, 103], mm, 'DL'));
});

test('梁：SAP2000 正 M3 = 下緣受拉，與 Midas 正 Moment-y 相同', () => {
  const mm = M.parseMct(MCT), mt = M.parseForceTable(TBL);
  const sm = S.parseModel(S2K), st = S.parseForceTable(STBL);
  const opts = {loads: ['cLCB1', 'cLCB2']};
  const a = M.beamLoads(mt, [201, 202], mm, opts), b = M.beamLoads(st, [201, 202], sm, opts);
  assert.deepEqual(b.loads, a.loads);
  assert.deepEqual(b.ctrl.map(c => [c.why, c.load, c.v]), a.ctrl.map(c => [c.why, c.load, c.v]));
});

test('SAP2000：kN、m 換算；反應譜、時間歷程、單一工況的名稱', () => {
  const tx = ['Frame\tStation\tOutputCase\tCaseType\tStepType\tP\tV2\tV3\tT\tM2\tM3',
    'Text\tm\tText\tText\tText\tKN\tKN\tKN\tKN-m\tKN-m\tKN-m',
    '1\t0\tEQX\tLinRespSpec\tMax\t10\t20\t30\t40\t50\t9.80665',
    '1\t3\tEQX\tLinRespSpec\tMax\t10\t20\t30\t40\t50\t9.80665',
    '1\t0\tTH1\tLinModHist\tStep By Step\t1\t1\t1\t1\t1\t1',
    '1\t0\tENV\tCombination\tMin\t-98.0665\t0\t0\t0\t0\t0'].join('\n');
  const t = S.parseForceTable(tx);
  assert.ok(t.ok);
  assert.deepEqual(t.loads, ['EQX(RS)', 'TH1(TH)', 'ENV(min)']);
  assert.ok(t.warnings.some(w => /反應譜/.test(w)));
  const e = t.rows.find(r => r.load === 'ENV(min)');
  assert.ok(Math.abs(e.N + 10) < 1e-9, '−98.0665 kN = −10 tf');
  assert.ok(Math.abs(t.rows[0].My - 1) < 1e-9, '9.80665 kN·m = 1 tf·m');
  assert.ok(M.isRS('EQX(RS)') && M.isEnvelope('ENV(min)'));
});

test('SAP2000：沒有單位列時需要 fallback；非數字 Frame 標籤', () => {
  const tx = ['Frame,Station,OutputCase,P,M3', 'B12,0,C1,-10,5', 'B12,6,C1,-10,-5'].join('\n');
  const t0 = S.parseForceTable(tx);
  assert.ok(!t0.ok && t0.needUnit);
  const t = S.parseForceTable(tx, {force: 'TONF', len: 'M'});
  assert.ok(t.ok);
  assert.equal(t.rows[0].label, 'B12');
  assert.ok(t.rows[0].elem > 900000000);
  assert.equal(t.rows[0].elem, S.idOf('F', 'B12'), '同一標籤在模型檔與內力表得到同一個編號');
  assert.deepEqual(t.rows.map(r => r.end), ['I', 'J']);
});
