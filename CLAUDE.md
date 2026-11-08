# 專案規則

**Git：每次修改完成後直接 commit 並 push 到 main，不另開分支、不需再詢問**（與 midas-civil-book、midas-curve-gen 相同；回覆使用者一律用台灣繁體中文）。
推送前先跑相關測試（`cd tests && npm test`，或至少改動相關的測試檔）。

## 操作教學與常見問題 PDF 於合併到 main 時重建

- `docs/RC構件設計工具_操作教學.pdf` 與 `docs/RC構件設計工具_常見問題.pdf` 由 `docs/tutorial/build.js` 分別依 `docs/tutorial/tutorial.html`、`docs/tutorial/faq.html` 建置（共用截圖）；說明見 `docs/tutorial/README.md`。
- **提交時不要自行重建或提交 PDF 與 `stamp.txt`**（每份約 6～7 MB，會讓儲存庫快速變大）。推送到 main 後，GitHub Actions（`tutorial-pdf.yml`）會重建並以機器人提交推回 main；下次推送前先 `git pull --rebase origin main` 取回機器人提交。
- 修改 `index.html`、`calc-xlsx.js` 或教學原稿時，若介面、操作步驟、檢核項目或規範條文有變，仍須同步修改 `docs/tutorial/tutorial.html` 與 `docs/tutorial/faq.html` 的說明文字（必要時在 `build.js` 增加截圖）；`README.md` 亦同。
- 要確認原稿能正確建置時可在本機 `cd docs/tutorial && npm run build`，但建置產物不要提交（`git checkout -- docs/*.pdf docs/tutorial/stamp.txt`）。
- 教學與常見問題中的公式與符號一律用 KaTeX（`\( … \)`），與網頁、計算書、Excel 的 LaTeX 風格一致。

## 規範依據

- 規範原文 PDF 在 `specs/`（索引與核對狀態見 `specs/README.md`）。新增或修改任何規範檢核時，以原文核對條號、公式與係數，並更新 `specs/README.md` 的核對狀態。
- 建築依《建築物混凝土結構設計規範》112 年版（土木401-112）。橋梁：長細效應與保護層依《公路橋梁設計規範》；容量設計剪力、剪力（φ = 0.85、V_c）、圍束筋、主筋比、材料依《公路橋梁耐震設計規範》；斷面撓曲強度與彎矩 φ 維持 112 年版。

## 工具串接

- 與 midas-curve-gen、Midas Civil、StructAudit-AI、書稿的串接規格見 `docs/INTEGRATION.md`；「從 Midas 匯入」的解析在 `core/midas-io.js`（測試 `tests/midas.test.js`、`tests/midas-ui.test.js`）。
- 計算書「內力來源」段落的文字由 StructAudit-AI `utils/calcbook.py` 擷取；改寫該段文字（`rpLoadSrc`）或案件檔 `loadsrc` 欄位時，同步修改 StructAudit-AI 並重產其示範檔（`examples/make_sample_midas.js`）。
- 匯入對話框或計算書版面改變時，重拍書稿截圖 `shots/f_rcmd_import.png`、`shots/f_rcmd_src.png`（書稿第 66 章）。
- 載重指紋 v2（`loadsKey`）與 StructAudit-AI `loads_key` 必須一致：`tests/fixtures/loads_key_vectors.json` 與其 `tests/data/` 的同名檔是同一份，改規則時兩邊一起改。
- `inputHash`（計算書表頭「輸入 SHA-256」）不計 `saved`、`members`、`conf`、`review`；StructAudit-AI `utils/pairing.py` 以同一規則重算配對，改快照欄位時要同步。
- 案件檔 `review` 區塊由 StructAudit-AI 寫入（契約 `docs/INTEGRATION.md` §3.4）：開啟時通知並重算，計算書列「審查修正紀錄」。
