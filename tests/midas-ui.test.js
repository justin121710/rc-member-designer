/* 從 Midas 匯入（工具整合 M1，docs/INTEGRATION.md）之介面回歸測試：
   .mct ＋內力表 → 選群組 → 套用到目前構件（柱）／建立到構件清單（梁）→ 計算書內力來源 → 案件檔保存。
   解析與挑選規則之數值測試見 midas.test.js。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const {openApp, ROOT} = require('./helpers');

const FIX = path.join(__dirname, 'fixtures');
let app, page;
test.before(async () => { app = await openApp(); page = app.page; });
test.after(async () => { if(app){ assert.deepEqual(app.errors, [], '頁面不得有 JavaScript 錯誤'); await app.close(); } });

async function load(mod){
  await page.evaluate(m => window.midasImport.open(m), mod);
  await page.setInputFiles('#midMctFile', path.join(FIX, 'midas_pier.mct'));
  await page.waitForFunction(() => /結構群組 2/.test(document.getElementById('midMctInfo').textContent));
  await page.fill('#midTblBox', fs.readFileSync(path.join(FIX, 'midas_beam_force.txt'), 'utf8'));
  await page.click('#midTblRead');
}
async function confirm(){
  if(await page.isVisible('#askOv.open')){ await page.click('#askAct button.btn-primary'); await page.waitForTimeout(100); }
}

test('柱：讀 .mct 與內力表、單一工況與包絡預設不勾選、名稱不做下標', async () => {
  await load('pylon');
  assert.match(await page.textContent('#midMctInfo'), /midas_pier\.mct/);
  assert.match(await page.textContent('#midTblInfo'), /38 列.*載重 4 個.*TONF, M/);
  const ld = await page.$$eval('#midLoads input', xs => xs.map(x => x.checked));
  assert.deepEqual(ld, [false, true, true, false], 'DL（單一工況）、cLCB3(max)（包絡）不勾選');
  assert.equal(await page.$eval('#midPD', s => s.options[s.selectedIndex].text), 'DL', 'P_D 預設取 DL');
  assert.equal(await page.isDisabled('#midApply'), true, '未選構件不得套用');
  await page.check('#midGrpWrap input[data-g="0"]');
  assert.match(await page.textContent('#midGrpWrap'), /P1_COL/);
  assert.match(await page.textContent('#midPrev'), /cLCB2 @E102-J/);
});

test('柱：套用到目前構件 → 斷面、P_D、載重、內力來源寫入計算書與案件檔', async () => {
  await page.click('#midApply'); await confirm();
  const r = await page.evaluate(() => ({name: memName('memName'), sec: document.getElementById('secType').value,
    B: +document.getElementById('B').value, H: +document.getElementById('H').value, PD: +document.getElementById('brPD').value,
    loads: LOADS.map(l => [l.name, l.pos || '', l.Pu, l.Mux])}));
  assert.equal(r.name, 'P1_COL'); assert.equal(r.sec, 'solid'); assert.equal(r.B, 180); assert.equal(r.H, 240); assert.equal(r.PD, 600);
  assert.deepEqual(r.loads.find(l => l[0]==='cLCB2' && l[1]==='top'), ['cLCB2', 'top', 820, 300]);
  const rp = await page.evaluate(() => { buildReport(MODEL || render()); return document.getElementById('report').innerText; });
  assert.match(rp, /內力來源/); assert.match(rp, /P1_COL/); assert.match(rp, /E102-J/);
  assert.doesNotMatch(rp, /已修改/);
  // 手動改載重 → 計算書註明已修改
  const rp2 = await page.evaluate(() => { LOADS[0].Pu += 1; drawLoads(); buildReport(render()); const t = document.getElementById('report').innerText; LOADS[0].Pu -= 1; drawLoads(); render(); return t; });
  assert.match(rp2, /匯入後載重表已修改/);
  // 案件檔來回（含外部檔案清理）
  const rt = await page.evaluate(() => { const j = JSON.parse(JSON.stringify(caseSnapshot())); j.loadsrc.pylon.group = '<img src=x onerror=alert(1)>'; LOADSRC = {pylon:null, beam:null}; caseApply(j);
    return {g: LOADSRC.pylon.group, rows: LOADSRC.pylon.rows.length}; });
  assert.equal(rt.rows, 5);
  const html = await page.evaluate(() => { buildReport(MODEL || render()); return document.getElementById('report').innerHTML; });
  assert.doesNotMatch(html, /<img src=x/, '群組名稱須跳脫');
});

test('梁：建立到構件清單（群組選取不沿用柱）', async () => {
  await load('beam');
  assert.equal(await page.$$eval('#midGrpWrap input[data-g]:checked', xs => xs.length), 0);
  await page.check('#midGrpWrap input[data-g="1"]');
  await page.click('#midBatch'); await confirm(); await confirm();
  const m = await page.evaluate(() => MEMBERS.filter(x => x.name==='P1_CAP').map(x => ({tab: x.tab, bw: x.snap.values.bw, bh: x.snap.values.bh, bType: x.snap.values.bType,
    loads: x.snap.bloads.map(l => [l.name, l.Mpos, l.Mneg, l.Vu]), src: x.snap.loadsrc.beam.group})));
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], {tab: 'beam', bw: '220', bh: '200', bType: 'rect', loads: [['cLCB1', 150, 480, 210], ['cLCB2', 140, 450, 220]], src: 'P1_CAP'});
});
