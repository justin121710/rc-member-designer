/* 團隊專案資料夾範本產生器（多人共用方案 A，規則見 docs/TEAM_FOLDER.md）
   產生 docs/team-folder/範本/{案號}_{案名}/：各層資料夾＋說明.txt，00_管理/專案狀態表.xlsx。
   用法：node build.js [輸出資料夾]   （預設 ./範本）
   需要 exceljs（docs/tutorial 或 tests 的 node_modules 已有）。 */
'use strict';
const fs = require('fs'), path = require('path');
function need(mod){
  for(const base of [__dirname, path.join(__dirname, '../tutorial'), path.join(__dirname, '../../tests')]){
    try{ return require(require.resolve(mod, {paths: [base]})); }catch(e){}
  }
  throw new Error(`找不到 ${mod}：請先在 docs/tutorial 或 tests 執行 npm install`);
}
const ExcelJS = need('exceljs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '範本'));
const ROOT = path.join(OUT, '{案號}_{案名}');

/* ---------- 資料夾與說明檔（UTF-8 BOM＋CRLF，Windows 記事本可直接開） ---------- */
const DIRS = [
  ['', `本資料夾為一個設計案。請把資料夾改名為「{案號}_{案名}」，例：T113-05_某某橋。
規則：構件 ID ＝ Midas 結構群組名稱 ＝ RC 構件設計工具的「構件名稱」（英數與底線，例 P1_COL）。
所有檔名規則、流程與檢核見 00_管理/專案狀態表.xlsx 的「說明」頁。`],
  ['00_管理', `專案狀態表.xlsx：構件狀態、模型版次、審查紀錄、說明（規則全文）。
網路磁碟上開啟 Excel 時，第二個人會是唯讀：開啟、更新、存檔後立刻關閉。
公司系統支援共同編輯時（SharePoint、OneDrive 等）請線上編輯。`],
  ['01_線形與建模', `midas-curve-gen 線形檔：{案號}_線形_{nn}.mct（參數內嵌，可再開啟修改）。
Midas 工作模型（.mcb）。只有分析負責人編輯。`],
  ['02_分析發行', `每次重跑 Midas 分析並發出新內力表，就建一個版次資料夾 R01、R02…
內含：{案號}_模型_R{nn}.mct（完整 .mct，含 *SECTION、*MATERIAL、*THICKNESS、*GROUP）、
      {案號}_BeamForce_R{nn}.txt、{案號}_PlateForce_R{nn}.txt（分檔時加範圍，如 _P1-P4）。
發行後在專案狀態表「模型版次」頁加一列，並把該 R 資料夾設為唯讀，不再修改。`],
  ['02_分析發行/R01', `第 1 版分析結果（範例）。發行後不再修改。`],
  ['03_構件設計', `每個構件一個資料夾，資料夾名＝構件 ID（例 P1_COL）。
資料夾內只放「目前這一版」：RC 構件設計工具預設檔名的案件檔、計算書 PDF、Excel，三者檔名帶相同的 8 碼雜湊
（＝計算書表頭「輸入 SHA-256」前 8 碼）。被取代的版本移到該構件的「舊版」資料夾。
編輯前在狀態表「編輯中」填名字（或放一個空檔 _編輯中_{姓名}.txt），完成後清除。`],
  ['03_構件設計/P1_COL', `範例構件資料夾（可刪除）。
目前版本例：P1_COL_案件_0817a9f0.json、P1_COL_RC橋墩橋塔斷面設計檢核計算書_0817a9f0.pdf`],
  ['03_構件設計/P1_COL/舊版', `被取代的案件檔、計算書。`],
  ['04_審查', `每個構件一個資料夾。StructAudit-AI 審查報告（{構件}_審查報告_{雜湊8}_SR-…）與
調整後案件檔（{構件}_案件_{雜湊8}_審查調整.json），雜湊為被審查那一版。
審查時取 03_構件設計 同一組雜湊的 PDF 與案件檔；配對結果須為「已核對」。`],
  ['05_送審定版', `每次送審一個批次資料夾（例 S01_20261120）。
計算書複製進來後改名 {案號}_{構件ID}_計算書_D{nn}.pdf，並設為唯讀。`],
  ['99_參考', `規範、來函、會議紀錄等。`],
];
const txt = s => '﻿' + s.replace(/\r?\n/g, '\r\n') + '\r\n';
fs.rmSync(ROOT, {recursive: true, force: true});
for(const [d, note] of DIRS){
  const dir = path.join(ROOT, d); fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, '說明.txt'), txt(note));
}

/* ---------- 專案狀態表.xlsx ---------- */
const wb = new ExcelJS.Workbook();
wb.creator = 'rc-member-designer docs/team-folder/build.js';
wb.created = wb.modified = new Date(Date.UTC(2026, 10, 8));   // 固定時間：重產時內容不變
wb.calcProperties.fullCalcOnLoad = true;
const FONT = {name: '微軟正黑體', size: 11};
const HEAD = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF1F4E79'}};
const INPUT = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFFFF2CC'}};   // 下拉選單格
const THIN = {style: 'thin', color: {argb: 'FFBFBFBF'}};
const BORDER = {top: THIN, left: THIN, bottom: THIN, right: THIN};
const list = a => ({type: 'list', allowBlank: true, formulae: ['"' + a.join(',') + '"'],
  showErrorMessage: true, errorStyle: 'warning', errorTitle: '不在清單中', error: '請從清單選擇（仍要輸入可按「是」）'});
const fill = argb => ({type: 'pattern', pattern: 'solid', bgColor: {argb}});
const RED = 'FFF8CBAD', GREEN = 'FFC6EFCE', ORANGE = 'FFFFD966', YELLOW = 'FFFFF2CC';

function table(ws, title, note, cols, rows, nBody = 300){
  ws.properties.defaultRowHeight = 18;
  ws.getCell('A1').value = title; ws.getCell('A1').font = {...FONT, size: 14, bold: true};
  ws.getCell('A2').value = note; ws.getCell('A2').font = {...FONT, size: 10, color: {argb: 'FF595959'}};
  const hr = 4;
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1); col.width = c.w;
    const h = ws.getCell(hr, i + 1); h.value = c.h;
    h.font = {...FONT, bold: true, color: {argb: 'FFFFFFFF'}}; h.fill = HEAD; h.border = BORDER;
    h.alignment = {vertical: 'middle', horizontal: 'center', wrapText: true};
    if(c.tip) h.note = c.tip;
  });
  ws.getRow(hr).height = 34;
  for(let r = hr + 1; r <= hr + nBody; r++){
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1); cell.font = FONT; cell.border = BORDER;
      cell.alignment = {vertical: 'middle', wrapText: !!c.wrap, horizontal: c.align || 'left'};
      if(c.list){ cell.dataValidation = list(c.list); cell.fill = INPUT; }
      if(c.fmt) cell.numFmt = c.fmt;
      if(c.f) cell.value = {formula: c.f(r)};
    });
  }
  rows.forEach((row, k) => row.forEach((v, i) => { if(v !== undefined && v !== null && !cols[i].f){
    const cell = ws.getCell(hr + 1 + k, i + 1); cell.value = v; cell.font = {...FONT, italic: true, color: {argb: 'FF7F7F7F'}}; } }));
  ws.views = [{state: 'frozen', xSplit: 1, ySplit: hr}];
  ws.pageSetup = {paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${hr}:${hr}`};
  ws.autoFilter = {from: {row: hr, column: 1}, to: {row: hr, column: cols.length}};
  return {hr, last: hr + nBody};
}
const colL = i => String.fromCharCode(64 + i);

/* 說明 */
const HELP = [
  ['專案狀態表：使用說明', 'h1'],
  ['完整規則：rc-member-designer docs/TEAM_FOLDER.md；書稿第 66 章「團隊共用資料夾」。黃底格為下拉選單；灰色斜體列為範例，可刪除。', 'note'],
  ['1. 資料夾', 'h2'],
  ['00_管理：本表。01_線形與建模：midas-curve-gen 線形檔、Midas 工作模型（分析負責人）。02_分析發行/R{nn}：發行的完整 .mct 與內力表（發行後唯讀）。', ''],
  ['03_構件設計/{構件ID}：目前這一版的案件檔、計算書 PDF、Excel；舊版移到「舊版」。04_審查/{構件ID}：審查報告、調整後案件檔。05_送審定版/{批次}：送審計算書（唯讀）。99_參考。', ''],
  ['2. 命名', 'h2'],
  ['構件 ID ＝ Midas 結構群組名稱 ＝ RC 構件設計工具「構件名稱」（英數與底線，例 P1_COL、P1_CAP、S1_DECK）。', ''],
  ['模型與內力表：{案號}_模型_R{nn}.mct、{案號}_BeamForce_R{nn}.txt、{案號}_PlateForce_R{nn}.txt。檔名寫進計算書「內力來源」，看計算書就知道用哪一版內力。', ''],
  ['案件檔、計算書 PDF、Excel 用工具的預設檔名：{構件}_案件_{雜湊8}.json、{構件}_{計算書名稱}_{雜湊8}.pdf、{構件}_RC柱計算書_{雜湊8}.xlsx。', ''],
  ['雜湊8 ＝ 計算書表頭「輸入 SHA-256」前 8 碼；同一版輸入的檔案雜湊相同。審查報告 {構件}_審查報告_{雜湊8}_SR-…、調整後案件檔 {構件}_案件_{雜湊8}_審查調整.json（StructAudit-AI 預設檔名）。', ''],
  ['送審：{案號}_{構件ID}_計算書_D{nn}.pdf（人工改名，放 05 後設唯讀）。', ''],
  ['3. 流程', 'h2'],
  ['① 開案（組長）：本頁「構件狀態」列出構件、指派設計者與校核者。', ''],
  ['② 分析發行（分析負責人）：匯出完整 .mct 與內力表到 02_分析發行/R{nn} → 「模型版次」頁加一列 → 通知；已發行的 R 不再修改。', ''],
  ['③ 設計（設計者）：「編輯中」空白才動手並填名字 → 從共用資料夾「開啟案件」（不要接著瀏覽器裡的舊狀態做）→ 從 02 的 R 資料夾匯入 → 儲存案件＋列印 PDF（預設檔名）→ 放進構件資料夾、舊的移到「舊版」→ 更新本表（內力版次、設計版次、雜湊、D/C、判定、狀態）→ 清除「編輯中」。', ''],
  ['④ 審查（審查者）：取同一組雜湊的 PDF 與案件檔跑 StructAudit-AI，配對須「已核對」→ 報告存 04 →「審查紀錄」加一列；退回時狀態改「審查退回」。', ''],
  ['⑤ 回修：開啟調整後案件檔 → 工具通知並重算 → 存新版（新雜湊）→ 回到③。', ''],
  ['⑥ 模型改版：新 R 發行後，「內力最新」顯示「需更新」的構件要重新匯入；確認不受影響者在備註寫明理由，再把內力版次改成新版次。', ''],
  ['⑦ 送審（組長）：全部「已核可」、內力「最新」、配對「已核對」→ 複製 PDF 到 05 改名、設唯讀 → 填送審批次。', ''],
  ['4. 送審前一致性檢核', 'h2'],
  ['計算書表頭雜湊 ＝ PDF 檔名 ＝ 案件檔名 ＝ 本表「輸入雜湊」；StructAudit-AI 配對「已核對」；計算書「內力來源」的模型版次 ＝ 目前版次；計算書沒有「斷面或材料已與匯入時不同」；「匯入後載重表已修改」已在備註說明；審查的雜湊就是目前這一版。', ''],
  ['5. 注意', 'h2'],
  ['一個構件同時只有一人編輯。網路磁碟上本表開啟後他人只能唯讀：開啟、更新、存檔後立刻關閉。同步軟體產生「衝突副本」時，保留與本表雜湊一致者，另一份移到「舊版」。', ''],
  ['構件清單（工具頂列）只在自己電腦整理；共用資料夾以「一構件一案件檔」為準。工具「批次計算總表 → 匯出 CSV」最後兩欄（輸入 SHA-256、內力來源）可貼到本表。', ''],
];
{
  const ws = wb.addWorksheet('說明', {properties: {tabColor: {argb: 'FF1F4E79'}}});
  ws.getColumn(1).width = 86;
  ws.pageSetup = {paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0};
  HELP.forEach(([t, k], i) => {
    const c = ws.getCell(i + 1, 1); c.value = t; c.alignment = {wrapText: true, vertical: 'top'};
    c.font = k==='h1' ? {...FONT, size: 14, bold: true} : k==='h2' ? {...FONT, size: 12, bold: true, color: {argb: 'FF1F4E79'}}
      : k==='note' ? {...FONT, size: 10, color: {argb: 'FF595959'}} : FONT;
    ws.getRow(i + 1).height = k==='' || k==='note' ? Math.max(18, Math.ceil([...t].length / 40) * 17) : 22;
  });
}

/* 構件狀態 */
const REV = "'模型版次'!$B$2";
const STATES = ['待設計','設計中','待校核','待審查','審查退回','已核可','需更新內力','已送審'];
const MEM_COLS = [
  {h: '構件ID', w: 12, tip: 'Midas 結構群組名稱＝RC 構件設計工具「構件名稱」'},
  {h: '模組', w: 7, list: ['柱','梁','版','基樁'], align: 'center'},
  {h: '設計依據', w: 10, list: ['建築','橋梁','水工'], align: 'center'},
  {h: '設計者', w: 9}, {h: '校核者', w: 9},
  {h: '編輯中', w: 9, tip: '正在編輯的人；空白才可開始編輯，完成後清除'},
  {h: '內力版次', w: 10, align: 'center', tip: '計算書「內力來源」模型檔名的 R{nn}'},
  {h: '內力最新', w: 10, align: 'center', f: r => `IF(OR($A${r}="",$G${r}=""),"",IF($G${r}=${REV},"最新","需更新"))`,
   tip: '自動：內力版次與「模型版次」頁的目前版次比較'},
  {h: '設計版次', w: 10, align: 'center', tip: 'D01、D02…，每次送校核／送審加 1'},
  {h: '輸入雜湊', w: 18, tip: '計算書表頭「輸入 SHA-256」（至少前 8 碼，與檔名相同）'},
  {h: '撓曲 D/C', w: 8, fmt: '0.000', align: 'right'},
  {h: '判定', w: 8, list: ['PASS','FAIL','未完成'], align: 'center'},
  {h: '狀態', w: 11, list: STATES, align: 'center'},
  {h: '審查報告', w: 22, tip: 'StructAudit-AI 報告編號 SR-…'},
  {h: '配對', w: 8, list: ['已核對','不符','未驗證'], align: 'center', tip: 'StructAudit-AI 案件檔配對結果'},
  {h: '送審批次', w: 10},
  {h: '最後更新', w: 11, fmt: 'yyyy-mm-dd', align: 'center'},
  {h: '內力來源', w: 34, wrap: true, tip: '工具構件總表 CSV 的「內力來源」欄'},
  {h: '備註', w: 30, wrap: true},
];
{
  const ws = wb.addWorksheet('構件狀態', {properties: {tabColor: {argb: 'FF70AD47'}}});
  const ex = [
    ['P1_COL','柱','橋梁','王○○','李○○','','R01',null,'D01','0817a9f0',0.743,'PASS','待審查','','','',new Date(Date.UTC(2026,10,8)),'範例_模型_R01.mct／範例_BeamForce_R01.txt／群組 P1_COL','（範例，可刪除）'],
    ['P1_CAP','梁','橋梁','陳○○','李○○','陳○○','R01',null,'','','','','設計中','','','',new Date(Date.UTC(2026,10,8)),'','（範例，可刪除）'],
  ];
  const {hr, last} = table(ws, '構件狀態', '一列一個構件。黃底格為下拉選單；「內力最新」自動比對「模型版次」頁的目前版次。', MEM_COLS, ex, 200);
  const at = h => colL(MEM_COLS.findIndex(c => c.h===h) + 1);
  const cf = (h, rules) => ws.addConditionalFormatting({ref: `${at(h)}${hr+1}:${at(h)}${last}`, rules});
  const eq = (h, v, color, p) => ({type: 'expression', priority: p, formulae: [`$${at(h)}${hr+1}="${v}"`], style: {fill: fill(color)}});
  cf('內力最新', [eq('內力最新', '需更新', RED, 1), eq('內力最新', '最新', GREEN, 2)]);
  cf('判定', [eq('判定', 'FAIL', RED, 3), eq('判定', 'PASS', GREEN, 4)]);
  cf('配對', [eq('配對', '不符', RED, 5), eq('配對', '已核對', GREEN, 6)]);
  cf('狀態', [eq('狀態', '審查退回', ORANGE, 7), eq('狀態', '需更新內力', RED, 8), eq('狀態', '已核可', GREEN, 9), eq('狀態', '已送審', GREEN, 10)]);
  cf('撓曲 D/C', [{type: 'cellIs', operator: 'greaterThan', priority: 11, formulae: ['1'], style: {fill: fill(RED)}}]);
  cf('編輯中', [{type: 'expression', priority: 12, formulae: [`LEN($${at('編輯中')}${hr+1})>0`], style: {fill: fill(YELLOW)}}]);
}

/* 模型版次 */
{
  const ws = wb.addWorksheet('模型版次', {properties: {tabColor: {argb: 'FFED7D31'}}});
  const cols = [
    {h: '版次', w: 8, align: 'center'}, {h: '發行日期', w: 11, fmt: 'yyyy-mm-dd', align: 'center'},
    {h: '模型檔', w: 26}, {h: '內力表', w: 34, wrap: true}, {h: '變更內容', w: 40, wrap: true},
    {h: '可能影響的構件', w: 24, wrap: true}, {h: '發行人', w: 9}, {h: '備註', w: 24, wrap: true},
  ];
  table(ws, '模型版次', '每次重跑 Midas 分析並發出新的內力表，就加一列（R01、R02…）。已發行的版次不再修改。', cols,
    [['R01', new Date(Date.UTC(2026,10,8)), '範例_模型_R01.mct', '範例_BeamForce_R01.txt', '初版（範例，可刪除）', '全部', '林○○', '']], 60);
  // 標題列右側：目前版次＝最後一列有填的版次
  ws.getCell('A2').value = null;
  ws.getCell('A2').value = '目前版次'; ws.getCell('A2').font = {...FONT, bold: true};
  const b2 = ws.getCell('B2'); b2.value = {formula: 'IFERROR(LOOKUP(2,1/(LEN($A$5:$A$64)>0),$A$5:$A$64),"")'};
  b2.font = {...FONT, bold: true, color: {argb: 'FFC00000'}}; b2.alignment = {horizontal: 'center'}; b2.border = BORDER;
  ws.getCell('C2').value = '← 自動取最後一列的版次；「構件狀態」頁的「內力最新」以此比較。'; ws.getCell('C2').font = {...FONT, size: 10, color: {argb: 'FF595959'}};
}

/* 審查紀錄 */
{
  const ws = wb.addWorksheet('審查紀錄', {properties: {tabColor: {argb: 'FF7030A0'}}});
  const cols = [
    {h: '構件ID', w: 12}, {h: '審查版次', w: 10, align: 'center'}, {h: '設計版次', w: 10, align: 'center'},
    {h: '輸入雜湊', w: 12, tip: '被審查那一版（審查報告檔名中的 8 碼）'}, {h: '報告編號', w: 22}, {h: '審查者', w: 9},
    {h: '日期', w: 11, fmt: 'yyyy-mm-dd', align: 'center'},
    {h: '配對', w: 8, list: ['已核對','不符','未驗證'], align: 'center'},
    {h: '結論', w: 11, list: ['核可','修正後核可','退回'], align: 'center'},
    {h: '調整後案件檔', w: 30, wrap: true}, {h: '處理情形', w: 30, wrap: true}, {h: '備註', w: 20, wrap: true},
  ];
  const {hr, last} = table(ws, '審查紀錄', '每次審查一列。審查的雜湊須為當時構件資料夾裡的版本；修正後重算者以新版再審或由審查者確認。', cols,
    [['P1_COL','V01','D01','0817a9f0','SR-20261108-1030','張○○',new Date(Date.UTC(2026,10,8)),'已核對','核可','','','（範例，可刪除）']], 200);
  const at = h => colL(cols.findIndex(c => c.h===h) + 1);
  ws.addConditionalFormatting({ref: `${at('結論')}${hr+1}:${at('結論')}${last}`, rules: [
    {type: 'expression', priority: 1, formulae: [`$${at('結論')}${hr+1}="退回"`], style: {fill: fill(ORANGE)}},
    {type: 'expression', priority: 2, formulae: [`LEFT($${at('結論')}${hr+1},2)="核可"`], style: {fill: fill(GREEN)}},
    {type: 'expression', priority: 3, formulae: [`RIGHT($${at('結論')}${hr+1},2)="核可"`], style: {fill: fill(GREEN)}}]});
  ws.addConditionalFormatting({ref: `${at('配對')}${hr+1}:${at('配對')}${last}`, rules: [
    {type: 'expression', priority: 4, formulae: [`$${at('配對')}${hr+1}="不符"`], style: {fill: fill(RED)}}]});
}
wb.views = [{activeTab: 1}];

(async () => {
  const xl = path.join(ROOT, '00_管理', '專案狀態表.xlsx');
  await wb.xlsx.writeFile(xl);
  console.log('已產生', path.relative(process.cwd(), ROOT));
})();
