/* 任務入口與 Midas 匯入分段（依「降低學習成本與簡化介面」報告，2026-11-08）：
   開場先問要完成哪一件事；Midas 匯入顯示 ①②③ 步驟、讀完資料收成一行摘要、底部寫明套用後果；P1 範例檔。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {openApp} = require('./helpers');

let app, page;
test.before(async () => { app = await openApp(); page = app.page; });
test.after(async () => { if(app){ assert.deepEqual(app.errors, [], '頁面不得有 JavaScript 錯誤'); await app.close(); } });

const isOpen = id => page.evaluate(i => document.getElementById(i).classList.contains('open'), id);

test('任務入口：開啟網頁先顯示四個任務，手動驗算進三步精靈、Esc 關閉', async () => {
  await page.evaluate(() => { localStorage.removeItem('rcsd.setup.noShow'); });
  await page.reload(); await page.waitForFunction(() => typeof MODEL !== 'undefined' && MODEL);
  assert.equal(await isOpen('taskOv'), true, '開場顯示任務入口');
  assert.equal(await isOpen('setupOv'), false, '不直接跳三步精靈');
  const cards = await page.$$eval('#taskOv .task-c b', xs => xs.map(x => x.textContent));
  assert.deepEqual(cards, ['從 Midas 結果開始設計', '手動驗算一個構件', '繼續已有案件', '審查已完成的設計']);
  await page.click('#taskOv [data-t="manual"]');
  assert.equal(await isOpen('taskOv'), false);
  assert.equal(await isOpen('setupOv'), true, '手動驗算 → 三步精靈');
  await page.click('#setupSkip');
  await page.evaluate(() => openTask());
  await page.keyboard.press('Escape');
  assert.equal(await isOpen('taskOv'), false, 'Esc 關閉任務入口');
});

test('任務入口：上次自動保存的構件列在最上方；名稱跳脫', async () => {
  await page.evaluate(() => { document.getElementById('memName').value = '<b>P9</b>'; document.getElementById('memName').dispatchEvent(new Event('input', {bubbles: true})); caseAutosave(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => openTask());
  const t = await page.textContent('#taskLast');
  assert.match(t, /上次的工作：<b>P9<\/b>/, '名稱以文字顯示');
  await page.click('#taskLast [data-t="resume"]');
  assert.equal(await isOpen('taskOv'), false);
  await page.evaluate(() => { document.getElementById('memName').value = ''; document.getElementById('memName').dispatchEvent(new Event('input', {bubbles: true})); });
});

test('任務入口：「從 Midas」開匯入視窗；P1 範例載入後資料收成一行、步驟到 ②', async () => {
  await page.evaluate(() => openTask());
  await page.click('#taskOv [data-t="sample"]');
  assert.equal(await isOpen('midOv'), true);
  await page.waitForFunction(() => window.midasImport.state.tbl && window.midasImport.state.tbl.ok, null, {timeout: 10000});
  const r = await page.evaluate(() => ({done: document.getElementById('midOv').classList.contains('src-done'),
    sum: document.getElementById('midSrcSum').textContent, on: document.querySelector('#midSteps .on').textContent}));
  assert.equal(r.done, true, '模型與內力表讀好後收合');
  assert.match(r.sum, /midas_pier\.mct/); assert.match(r.sum, /midas_beam_force\.txt/); assert.match(r.sum, /38 列/);
  assert.match(r.on, /確認對應/);
  await page.click('#midSrcEdit');
  assert.equal(await page.evaluate(() => document.getElementById('midOv').classList.contains('src-done')), false, '「修改」展開來源');
});

test('Midas 匯入：勾選構件後步驟到 ③，底部寫明套用與建立的後果', async () => {
  await page.check('#midGrpWrap input[data-g="0"]');
  const r = await page.evaluate(() => ({on: document.querySelector('#midSteps .on').textContent, sum: document.getElementById('midSum').textContent}));
  assert.match(r.on, /建立構件/);
  assert.match(r.sum, /套用到目前構件＝覆寫.*載重表（5 列）與斷面尺寸，名稱改為 P1_COL/);
  assert.match(r.sum, /建立到構件清單＝新增 1 個、更新 0 個（P1_COL）/);
  assert.match(await page.textContent('#midOv .mid-opts'), /交換斷面方向 B↔H（x／y 對調）/);
  await page.click('#midClose');
});

test('工作檢視：四步進度、先處理不合格項目、修改後顯示上次 → 本次並記入修改紀錄', async () => {
  await page.evaluate(() => { document.getElementById('tabPylon').click(); applyPreset('bldg60'); WB.log.pylon = []; WB.open = true; render(); });
  let t = await page.textContent('#workBar');
  assert.match(t, /資料來源：手動輸入 4 組/); assert.match(t, /配筋與檢核：全部通過/);
  // 使用者在參數表把主筋改少 → 不合格
  await page.focus('#nB'); await page.fill('#nB', '2'); await page.dispatchEvent('#nB', 'input'); await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  t = await page.textContent('#workBar');
  assert.match(t, /配筋與檢核：不合格 \d+ 項/);
  assert.match(t, /先處理（1／\d+）/);
  assert.match(t, /上次 → 本次.*每面根數 4 → 2.*撓曲 D\/C 0\.720 → 0\.826/);
  assert.equal(await page.evaluate(() => WB.log.pylon.length), 1);
  // 在「先處理」列直接改欄位：寫回參數表、記入紀錄
  const ed = await page.$('#workBar input[data-wbf="nB"]');
  if(ed){ await ed.fill('4'); await ed.press('Tab'); await page.waitForTimeout(200);
    assert.equal(await page.inputValue('#nB'), '4', '寫回參數表');
    assert.equal(await page.evaluate(() => WB.log.pylon.length), 2); }
  else { await page.fill('#nB', '4'); await page.dispatchEvent('#nB', 'input'); }
  await page.click('#workBar [data-wb="log"]');
  assert.match(await page.textContent('#wbPop'), /修改紀錄/);
  await page.click('#workBar [data-wb="log"]');
  assert.equal(await page.$('#wbPop'), null, '再按一次關閉');
});

test('工作檢視：規範係數與預設不同時顯示「有自訂設定」；可收合', async () => {
  await page.evaluate(() => { const e = document.getElementById('phiv'); e.value = '0.7'; e.dispatchEvent(new Event('input', {bubbles: true})); });
  assert.match(await page.textContent('#workBar'), /有自訂設定 1 項/);
  await page.click('#workBar [data-wb="custom"]');
  assert.match(await page.textContent('#wbPop'), /預設 0\.75/);
  await page.evaluate(() => { const e = document.getElementById('phiv'); e.value = '0.75'; e.dispatchEvent(new Event('input', {bubbles: true})); document.getElementById('wbPop') && document.getElementById('wbPop').remove(); });
  assert.doesNotMatch(await page.textContent('#workBar'), /有自訂設定/);
  await page.click('#workBar [data-wb="toggle"]');
  assert.equal(await page.$('#workBar .wb-card'), null, '收合後只剩進度列');
  await page.click('#workBar [data-wb="toggle"]');
  assert.ok(await page.$('#workBar .wb-card'));
});

test('無法重算：判定列與工作檢視列出缺少的欄位；構件清單有「下一步」；建議配筋先顯示現況', async () => {
  await page.evaluate(() => { const e = document.getElementById('B'); e.value = ''; e.dispatchEvent(new Event('input', {bubbles: true})); });
  assert.match(await page.textContent('#verdict'), /無法重算/);
  assert.match(await page.textContent('#workBar'), /無法重算（輸入不完整）/);
  await page.evaluate(() => { const e = document.getElementById('B'); e.value = '60'; e.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.evaluate(() => { MEMBERS = []; document.getElementById('memName').value = 'C9'; memAdd(); memRender(); });
  assert.match(await page.textContent('#memList'), /下一步/);
  assert.match(await page.textContent('#memList'), /勾選需確認|可預覽列印|先處理/);
  await page.evaluate(() => { MEMBERS = []; memSave(); memRender(); });
  await page.evaluate(() => { wsShow(document.getElementById('wsP'), 'opt'); optRun('pylon'); });
  assert.match(await page.textContent('#optOutP'), /目前配筋已通過全部檢核/);
});
