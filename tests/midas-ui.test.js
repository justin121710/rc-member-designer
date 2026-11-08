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

test('版（M2）：Plate Force 在柱模組提示改用梁／版模組；梁／版模組建立單位寬版構件', async () => {
  const loadPlate = async mod => {
    await page.evaluate(m => window.midasImport.open(m), mod);
    await page.setInputFiles('#midMctFile', path.join(FIX, 'midas_slab.mct'));
    await page.waitForFunction(() => /結構群組 1/.test(document.getElementById('midMctInfo').textContent));
    await page.fill('#midTblBox', fs.readFileSync(path.join(FIX, 'midas_plate_force.txt'), 'utf8'));
    await page.click('#midTblRead');
  };
  await loadPlate('pylon');
  assert.match(await page.textContent('#midTblInfo'), /版內力/);
  await page.check('#midGrpWrap input[data-g="0"]');
  assert.match(await page.textContent('#midPrev'), /梁／版/);
  assert.equal(await page.isDisabled('#midApply'), true);
  await page.click('#midClose');
  await page.evaluate(() => document.getElementById('tabBeam').click());
  await loadPlate('beam');
  assert.equal(await page.isVisible('#midDir'), true);
  await page.check('#midGrpWrap input[data-g="0"]');
  await page.click('#midApply'); await confirm();
  const r = await page.evaluate(() => ({type: document.getElementById('bType').value, h: +document.getElementById('bh').value,
    loads: BLOADS.map(l => [l.name, l.Mpos, l.Mneg, l.Vu]), kind: LOADSRC.beam.kind}));
  assert.deepEqual(r, {type: 'slab', h: 30, loads: [['cLCB1', 11.8, 6.5, 9], ['cLCB2', 9, 4, 10]], kind: 'plate'});
  const rp = await page.evaluate(() => { buildBeamReport(BMODEL || renderBeam()); return document.getElementById('report').innerText; });
  assert.match(rp, /Wood-Armer/); assert.match(rp, /S1_DECK/);
});

test('從載重組合視窗開啟：匯入視窗在最上層可操作，Esc 只關匯入視窗', async () => {
  await page.evaluate(() => { document.querySelectorAll('.ov-shell.open').forEach(o => o.classList.remove('open')); document.getElementById('tabPylon').click(); });
  await page.click('#btnLoads'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('loadOv').classList.contains('open')), true);
  await page.click('#btnMidas'); await page.waitForTimeout(200);
  await page.click('#midTblRead', {timeout: 3000});      // 被下層視窗遮住時會逾時
  const top = await page.evaluate(() => { const b = document.getElementById('midTblRead').getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width/2, b.top + b.height/2).id; });
  assert.equal(top, 'midTblRead');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  const st = await page.evaluate(() => ({mid: document.getElementById('midOv').classList.contains('open'), load: document.getElementById('loadOv').classList.contains('open')}));
  assert.deepEqual(st, {mid: false, load: true});
  await page.keyboard.press('Escape');
});

test('流程改善：原始列→設計列、底部摘要、沿用上次匯入設定', async () => {
  await page.evaluate(() => { document.querySelectorAll('.ov-shell.open').forEach(o => o.classList.remove('open')); document.getElementById('tabPylon').click(); });
  await load('pylon');
  await page.check('#midGrpWrap input[data-g="0"]');
  const prev = await page.textContent('#midPrev');
  assert.match(prev, /原始列 → 設計列/); assert.match(prev, /極值篩選/);
  const sum = await page.textContent('#midSum');
  assert.match(sum, /內力表 38 列/); assert.match(sum, /排除 DL（單一工況）、cLCB3\(max\)（包絡）/); assert.match(sum, /極值篩選：將建立 5 列 × 1 個構件/);
  await page.check('input[name=midSel][value=all]'); await page.check('#midSwap');
  assert.match(await page.textContent('#midSum'), /全部組合/);
  await page.click('#midApply'); await confirm();
  await page.evaluate(() => window.midasImport.open('pylon'));
  assert.equal(await page.isChecked('input[name=midSel][value=all]'), true, '沿用全部組合');
  assert.equal(await page.isChecked('#midSwap'), true, '沿用 x／y 對調');
  assert.match(await page.textContent('#midSum'), /已沿用上次匯入（P1_COL）的設定/);
  await page.uncheck('#midSwap'); await page.check('input[name=midSel][value=ctrl]');
  await page.click('#midApply'); await confirm();
});

test('流程改善：斷面與匯入時不同 → 計算書提示可能需回 Midas 重分析', async () => {
  const before = await page.evaluate(() => { buildReport(MODEL || render()); return document.getElementById('report').innerText; });
  assert.doesNotMatch(before, /斷面或材料已與匯入時不同/);
  const after = await page.evaluate(() => { const el = document.getElementById('B'); el.value = '200'; el.dispatchEvent(new Event('input', {bubbles: true}));
    buildReport(render()); const t = document.getElementById('report').innerText; el.value = '180'; el.dispatchEvent(new Event('input', {bubbles: true})); render(); return t; });
  assert.match(after, /斷面或材料已與匯入時不同（外寬 180 → 200）/);
  assert.match(after, /回 Midas 重分析/);
});

test('團隊共用：案件檔名帶構件與輸入雜湊、構件總表含輸入雜湊與內力來源', async () => {
  await page.evaluate(() => document.getElementById('tabPylon').click());
  const h = await page.evaluate(() => inputHash());
  // 無頭 Chromium 對非 ASCII 的 download 屬性一律回報 "download"：改記錄 <a download> 的屬性值
  await page.evaluate(() => { const c0 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ (window.__dlNames ||= []).push(this.download); return c0.call(this); }; });
  const [dl] = await Promise.all([page.waitForEvent('download', {timeout: 30000}), page.evaluate(() => caseDownload())]);
  assert.equal(await page.evaluate(() => window.__dlNames.at(-1)), `P1_COL_案件_${h.slice(0,8)}.json`, '{構件}_案件_{輸入雜湊前 8 碼}');
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.equal(saved.values.memName, 'P1_COL');
  assert.equal(await page.evaluate(() => fileStem('RC柱斷面設計檢核計算書')), `P1_COL_RC柱斷面設計檢核計算書_${h.slice(0,8)}`, 'PDF 預設檔名同一規則');
  assert.equal(await page.evaluate(() => fileStem('X', 'a/b c')), `abc_X_${h.slice(0,8)}`, '檔名去除不合法字元');
  const [d2] = await Promise.all([page.waitForEvent('download', {timeout: 60000}), page.evaluate(() => memCsv())]);
  const rows = fs.readFileSync(await d2.path(), 'utf8').replace(/^\ufeff/, '').split('\r\n').map(l => l.split(','));
  assert.deepEqual(rows[0].slice(-2), ['輸入SHA-256', '內力來源']);
  const beam = rows.slice(1).find(r => r[1] === '梁／版');
  assert.ok(beam, '構件清單有匯入的梁');
  assert.match(beam[7], /^[0-9a-f]{16}$/);
  assert.match(beam[8], /^midas_pier\.mct／midas_beam_force\.txt|^midas_pier\.mct／貼上／群組 /);
  assert.match(await page.evaluate(() => window.__dlNames.at(-1)), /^構件總表_\d{4}-\d\d-\d\d\.csv$/);
});

test('流程改善：開啟含審查紀錄的案件 → 通知、計算書修正紀錄、雜湊不含 review', async () => {
  const d = await page.evaluate(() => { const c = caseSnapshot(); const h0 = inputHash();
    c.values.tieSize = '#5';
    c.review = {by: 'StructAudit-AI', at: '2026-11-07T12:00:00Z', source: 'P1.pdf', pairing: '已核對', status: 'pending-recalc',
      changes: [{id: 'tieSize', label: '箍筋號數', unit: '', old: '#4', new: '#5'}], analysis: ''};
    return {json: JSON.stringify(c), h0}; });
  const fp = require('path').join(require('os').tmpdir(), 'review_case.json');
  require('fs').writeFileSync(fp, d.json);
  await page.setInputFiles('#caseFile', fp);
  await page.waitForSelector('#askOv.open', {timeout: 5000});
  for(let k = 0; k < 3 && !/審查建議/.test(await page.textContent('#askTtl')); k++){   // 先處理「尚未存檔」「構件清單」等確認
    const go = await page.$('#askAct button:has-text("直接開啟")') || await page.$('#askAct button:has-text("以案件檔取代")') || await page.$('#askAct button.btn-primary');
    await go.click(); await page.waitForTimeout(500);
    await page.waitForSelector('#askOv.open', {timeout: 5000});
  }
  assert.match(await page.textContent('#askMsg'), /已以修改後的輸入重新計算|重新計算/);
  assert.match(await page.textContent('#askMsg'), /箍筋號數（tieSize）：#4 → #5/);
  await page.click('#askAct button.btn-primary');
  const r = await page.evaluate(() => { buildReport(MODEL || render()); return {rp: document.getElementById('report').innerText, st: REVIEW && REVIEW.status,
    same: (() => { const keep = REVIEW; const h1 = inputHash(); REVIEW = null; const h2 = inputHash(); REVIEW = keep; return h1 === h2; })()}; });
  assert.match(r.rp, /審查修正紀錄/); assert.match(r.rp, /審查建議不等於設計已通過/);
  assert.equal(r.st, 'recalculated');
  assert.equal(r.same, true, 'review 不計入輸入雜湊');
});
