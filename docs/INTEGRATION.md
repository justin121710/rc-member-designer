# 工具整合計畫：midas-curve-gen → Midas Civil → RC 構件設計工具 → StructAudit-AI

> 本檔為四個倉庫串接的總計畫與交換格式規格（以本檔為準；其他倉庫的 README／CLAUDE.md 只放連結）。
> 需求確認日期：2026-11-07（使用者 JIN）。

## 1. 目標

讓一座 RC 橋梁（墩柱、橋塔、帽梁、橫梁、基樁、版）從「線形建模」到「設計審查」的資料不必手抄：

1. **幾何只輸入一次**：midas-curve-gen 產生的節點／元素／結構群組，就是後續內力歸屬構件的依據。
2. **內力不手抄**：Midas Civil 2022 的結果表格直接貼進 RC 構件設計工具，自動依群組歸到構件、挑出控制組合、換算成 tf、tf·m。
3. **斷面與配筋雙向**：Midas 斷面尺寸帶入設計工具；設計完成的配筋輸出成 MCT，回寫 Midas 供塑鉸／非線性分析。
4. **可追溯**：每一列設計內力都能追到「哪個群組、哪個元素、哪一端、哪個組合」，並印在計算書，供 StructAudit-AI 審查與技師核對。
5. **審查回饋閉環**：StructAudit-AI 輸出的調整後案件檔，直接在設計工具開啟重算（已可用，維持）。

不在範圍：各工具與串接無關的既有功能（不改動）；四個工具合併成單一程式（不做，維持各自獨立）。

## 2. 工作流程

```
 ① midas-curve-gen（網頁）
    線形 → 節點／元素／結構群組（每個要設計的構件一個群組，例如 P1_COL、P1_CAP、P1_PILE1）
    輸出：model.mct（*UNIT、*NODE、*ELEMENT、*GROUP）
        │
        ▼
 ② Midas Civil 2022
    匯入 model.mct → 指定斷面、材料、邊界、載重、載重組合 → 分析
    輸出 A：Tools > MCT Command Shell 或 File > Export > MCT 的完整模型 .mct（含 *SECTION、*MATERIAL、*GROUP）
    輸出 B：Results > Result Tables > Beam > Force（全選複製，或存成 Excel／CSV）
            版：Plate > Force（M2 起）
        │
        ▼
 ③ RC 構件設計工具（rc-member-designer，網頁）
    「從 Midas 匯入」：讀 .mct（群組、節點高程、斷面、材料、單位）＋內力表
      → 依群組歸屬構件 → 單位換算為 tf、tf·m → 挑控制組合（同一列共存內力，不混搭）
      → 套用到目前構件，或一次在構件清單建立多個構件
    設計配筋 → 計算書 PDF（含「內力來源」）／Excel／案件檔 .json
    輸出 C（M3）：配筋 MCT（Midas Design > Rebar Input），回到 ②
        │
        ▼
 ④ StructAudit-AI（Streamlit）
    計算書 PDF ＋ 案件檔 → 多輪詰問審查 → 審查報告 ＋ 調整後案件檔
        │
        └──► 回到 ③ 開啟調整後案件檔重算（既有功能）

 ⑤ 書稿《Midas Civil 橋梁結構分析與設計實務》第六篇新增一章，以同一例題走完 ①～④（M6）
```

## 3. 交換檔與規格

| 代號 | 檔案 | 產生 | 讀取 | 規格重點 |
|---|---|---|---|---|
| X1 | `.mct` 幾何 | midas-curve-gen | Midas、設計工具 | `*GROUP NAME, NODE_LIST, ELEM_LIST[, PLANE_TYPE]`；清單語法 `1to10by2`；行末 `\` 續行；群組名 ASCII |
| X2 | `.mct` 完整模型 | Midas | 設計工具 | 另讀 `*SECTION`（DBUSER：SB 實心矩形 H、B；SR 圓 D；B 箱型 H、B、tw、tf1、C、tf2）、`*MATERIAL` 名稱 |
| X3 | 內力表 | Midas | 設計工具 | 依標題列辨識欄位：Elem、Load、Part、Axial、Shear-y、Shear-z、Torsion、Moment-y、Moment-z；單位取標題括號，沒有就用 X2 的 `*UNIT` 或手選 |
| X4 | 案件檔 `.json` | 設計工具、StructAudit-AI | 設計工具、StructAudit-AI | 既有格式；新增 `loadsrc`（內力來源：檔名、群組、單位、各列來源元素／端點、匯入時載重雜湊） |
| X5 | 計算書 PDF | 設計工具 | StructAudit-AI | 新增「內力來源」段落（群組、元素、控制條件） |
| X6 | 配筋 `.mct`（M3） | 設計工具 | Midas | Rebar Input 的 MCT 語法，**待實機核對** |

### 3.1 正負號與軸向對應（X3 → 設計工具）

| Midas（元素局部座標） | 柱模組 | 梁模組 |
|---|---|---|
| Axial（拉為正） | $P_u = -N$（壓為正） | 不用 |
| Moment-y（繞局部 y，深度沿 H） | $M_{ux}$ | 正值＝下緣受拉（$M_u^+$），負值取絕對值為 $M_u^-$（可切換） |
| Moment-z | $M_{uy}$ | 只做側向彎矩警示 |
| Shear-z | $V_{uy}$（與 $M_{ux}$ 同平面） | $V_u$（取絕對值） |
| Shear-y | $V_{ux}$ | 不用 |
| Torsion | $T_u$ | $T_u$（取絕對值） |

斷面：Midas SB 的 B（局部 y 向）、H（局部 z 向）對應設計工具的 B、H；若 Beta Angle 使兩者對調，用「x／y 對調」選項。

### 3.2 控制組合挑選規則

- **柱／墩柱／橋塔／基樁**：在群組內所有元素端點（I、J，及 1/4 等內部點）× 勾選的載重中，分別找 $P_u$ 最大與最小、$M_{ux}$、$M_{uy}$ 正負最大、$|V_{ux}|$、$|V_{uy}|$、$|T_u|$、合彎矩 $\sqrt{M_{ux}^2+M_{uy}^2}$ 最大的列。
  每個控制組合輸出構件**頂、底兩端**各一列（同名，供長細效應 $M_1/M_2$ 配對）；控制點若在構件中間，另加一列「組合 @元素-位置」。
  頂底以 .mct 節點 Z 座標判定（基樁頂＝樁帽底）。
- **帽梁／橫梁**：每個組合在群組內取最大正彎矩、最大負彎矩（絕對值）、$|V|$、$|T|$ 成一列；再挑出控制 $M^+$、$M^-$、$V$、$T$ 的組合。
- **包絡組合**（名稱含 `(max)`／`(min)`／`(all)`）各分量不是同時發生，會警示並預設不勾選。
- 內力是節點（中心線）值，柱面或支承面折減須自行處理（警示）。
- 橋梁容量設計用的靜載重軸力 $P_D$：可指定一個載重（例如 `DL`）取構件底端軸力填入。

## 4. 各工具的工作項目

### RC 構件設計工具（本倉庫）
- `core/midas-io.js`：純函式（不碰 DOM），網頁與 Node 測試共用。
- 「從 Midas 匯入」對話框（柱、梁兩模組的載重卡片）：.mct（選填）＋內力表（貼上／.txt／.csv／.xlsx）→ 選群組 → 預覽 → 套用或批次建立構件。
- 案件檔 `loadsrc` 與計算書「內力來源」。
- M2：Plate Force → 單位寬版（Wood-Armer，$M_x^* = M_x + |M_{xy}|$ 等）。
- M3：配筋 MCT 輸出。

### midas-curve-gen
- 文件：建議「一個設計構件一個群組」的命名規則（M5）；不需改輸出格式。

### StructAudit-AI
- 計算書表頭擷取與 Agent 提示加入「內力來源」，審查者可核對控制組合是否漏挑（M4）。

### 書稿
- 第六篇新增一章串接教學與例題（M6），x_verify 列入待實機核對項目。

## 5. 里程碑與驗收

| 里程碑 | 內容 | 驗收標準 |
|---|---|---|
| **M1（已完成 2026-11-07）** | Midas 內力＋.mct → 設計工具（柱、梁、基樁） | `tests/midas.test.js` 10 項（解析、單位、正負號、控制組合）、`tests/midas-ui.test.js` 3 項（貼表、選群組、套用、批次建立構件、計算書內力來源、案件檔清理）；教學與常見問題補文字（截圖待合併 main 時重建，之後可在 build.js 加拍匯入視窗） |
| M2 | 版（Plate Force、Wood-Armer） | 手算例題吻合 |
| M3 | 配筋 → Midas MCT | 使用者在 Midas 2022 實機匯入成功（實機驗證） |
| M4 | StructAudit-AI 讀內力來源 | 範例計算書審查報告引用來源 |
| M5 | midas-curve-gen 群組命名指引 | README／SPEC 更新 |
| M6 | 書稿新章 | 編譯 0 overfull、0 undefined，交付 PDF |

## 6. 待實機驗證（使用者尚未提供 Midas 範例檔，先依公開資料實作）

| 編號 | 項目 | 目前假設 |
|---|---|---|
| V1 | Beam Force 表格複製的標題文字與欄位順序 | `Elem, Load, Part, Axial (tonf), Shear-y, Shear-z, Torsion, Moment-y, Moment-z`；依標題名稱辨識，不依順序 |
| V2 | Part 欄寫法 | `I[101]`、`1/4`、`2/4`、`3/4`、`J[102]` |
| V3 | 梁 Moment-y 正負號 | 正值＝下緣（−z 側）受拉；介面可切換 |
| V4 | 元素兩端內力是否同一符號慣例（連續） | 是（圖形慣例） |
| V5 | `*SECTION` DBUSER 的 SB、SR、B 資料順序 | SB：H, B；SR：D；B：H, B, tw, tf1, C, tf2 |
| V6 | 包絡組合在表格中的列名 | 名稱後綴 `(max)`／`(min)` |
| V7 | Rebar Input 的 MCT 語法 | 未知（M3 前需要範例） |

使用者提供實機檔案後：補測試案例、修正假設、刪除本表對應列。
