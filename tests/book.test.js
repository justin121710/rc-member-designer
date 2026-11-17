/* 書稿例題回歸測試：《Midas Civil 橋梁結構分析與設計實務》的手算／程式例題，與本工具的計算核心對照。
   書與工具各自獨立推導（書：附錄 C pm_check.py，SI、Python；本工具：kgf-cm、JavaScript），
   兩邊答案一致才算數。書稿改了例題或本工具改了核心，這裡會先報錯。

   1. 第 62 章（C:ch:5）變斷面空心 RC 塔柱 P–M 檢核：表 C:tab:res 的強度比
      S1 塔底 0.80／0.88、S2 斷筋點下 0.79／0.85、S3 斷筋點上 0.86／1.08、S4 塔頂下 0.57／0.65；
      期望值為書中附錄 C 程式的三位小數輸出（以 SI 35 MPa、420 MPa 與標稱值 350、4200 kgf/cm² 各算一組）。
      布筋照書的 ring()：目標間距 150 mm、沿周邊取最接近的整數等分、外內層主筋中心距混凝土面 75 mm。
      差異來源只有 β₁（書以 MPa 公式、本工具以 kgf/cm² 公式）與 E_s 換算，容許 1.5 %。
   2. 第 66 章（C:ch:9）P1 墩柱、版 Wood-Armer：數值即 tests/fixtures 的 midas_* 檔，已在 midas.test.js 驗證。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {openApp} = require('./helpers');

let app, page;
test.before(async () => { app = await openApp(); page = app.page; });
test.after(async () => { if(app){ assert.deepEqual(app.errors, [], '頁面不得有 JavaScript 錯誤'); await app.close(); } });

const MPA = 10.1971621;          // 1 MPa = 10.197 kgf/cm²
const KN = 1000/9.80665;          // 1 kN = 101.97 kgf
// 斷面（mm）、主筋直徑（mm，與書的程式相同）、兩組設計內力（kN、kN·m）、書的強度比（SI、標稱值）
const SECS = [
  {name: 'S1 塔底',     h: 2400, dO: 32.2, dI: 22.2, U: [[24000, 22000], [18000, 33000]], si: [0.804, 0.877], nom: [0.817, 0.893]},
  {name: 'S2 斷筋點下', h: 2000, dO: 32.2, dI: 22.2, U: [[22000, 15500], [16000, 23500]], si: [0.785, 0.847], nom: [0.799, 0.857]},
  {name: 'S3 斷筋點上', h: 2000, dO: 25.4, dI: 19.1, U: [[22000, 15500], [16000, 23500]], si: [0.863, 1.082], nom: [0.878, 1.103]},
  {name: 'S4 塔頂下',   h: 1600, dO: 25.4, dI: 19.1, U: [[20000, 4500],  [14500, 8000]],  si: [0.569, 0.646], nom: [0.580, 0.657]},
];

/* 書的 ring()：B×H 矩形周邊，每邊 round(L/s)+1 根，角點不重複；回傳本工具的鋼筋 {x 沿 B, y 沿 H, A}（cm、cm²） */
function ring(B, H, s, d){
  const A = Math.PI*d*d/4/100, nb = Math.max(2, Math.round(B/s) + 1), nh = Math.max(2, Math.round(H/s) + 1), pts = new Map();
  const put = (x, y) => pts.set(`${x.toFixed(3)},${y.toFixed(3)}`, {x: x/10, y: y/10, A});
  for(let i = 0; i < nb; i++){ const x = -B/2 + B*i/(nb-1); put(x, -H/2); put(x, H/2); }
  for(let j = 1; j < nh - 1; j++){ const y = -H/2 + H*j/(nh-1); put(-B/2, y); put(B/2, y); }
  return [...pts.values()];
}

for(const S of SECS){
  test(`第 62 章 ${S.name}（h = ${S.h/1000} m）：強度比與書一致`, async T => {
    const b = 1800, t = 400, cov = 75;
    const bars = ring(b - 2*cov, S.h - 2*cov, 150, S.dO).concat(ring(b - 2*t + 2*cov, S.h - 2*t + 2*cov, 150, S.dI));
    for(const [tag, fc, fy] of [['SI', 35*MPA, 420*MPA], ['標稱值', 350, 4200]]){
      const dc = await page.evaluate(({bars, B, H, tw, fc, fy, Es, U, KN}) => {
        const s = {type: 'box', B, H, tw};
        const Ag = B*H - (B - 2*tw)*(H - 2*tw), Ast = bars.reduce((a, q) => a + q.A, 0);
        const m = {...MODEL.m, fc, fy, Es, ecu: 0.003, phic: 0.65, phit: 0.90, pmaxf: 0.80, alpha: 1.0, Ag, Ast, circle: false};
        m.b1 = beta1(fc); m.ety = fy/Es;
        const cvX = pmCurve({g: geoFor(s, 'x'), bars, m, axis: 'x'}), cvY = pmCurve({g: geoFor(s, 'y'), bars, m, axis: 'y'});
        const pX = designPoly(cvX, m), pY = designPoly(cvY, m);
        // 書的彎矩方向沿深度 h → 本工具 M_ux（繞 X 軸、深度沿 H）；kN → kgf、kN·m → kgf·cm
        return U.map(([P, M]) => biaxialDC(cvX, cvY, pX, pY, m, {Pu: P*KN, Mux: M*KN*100, Muy: 0}, null).dc);
      }, {bars, B: b/10, H: S.h/10, tw: t/10, fc, fy, Es: 200000*MPA, U: S.U, KN});
      const exp = tag === 'SI' ? S.si : S.nom;
      T.diagnostic(`${tag}：工具 ${dc.map(v => v.toFixed(3)).join('／')}，書 ${exp.join('／')}`);
      dc.forEach((v, i) => assert.ok(Math.abs(v/exp[i] - 1) <= 0.015,
        `${tag} U${i+1}：工具 ${v.toFixed(3)}，書 ${exp[i].toFixed(3)}（差 ${((v/exp[i] - 1)*100).toFixed(2)} %）`));
      // 書的判定：只有 S3-U2 不合格
      dc.forEach((v, i) => assert.equal(v > 1, exp[i] > 1, `${tag} U${i+1} 的合格判定與書不同`));
    }
  });
}

test('第 62 章 S1 布筋與書相同：外層 52 根、內層 40 根、A_s = 57,828 mm²', () => {
  const o = ring(1650, 2250, 150, 32.2), i = ring(1150, 1750, 150, 22.2);
  assert.equal(o.length, 52); assert.equal(i.length, 40);
  const As = o.concat(i).reduce((a, q) => a + q.A, 0)*100;
  assert.ok(Math.abs(As - 57828) < 1, `A_s = ${As.toFixed(0)} mm²`);
});
