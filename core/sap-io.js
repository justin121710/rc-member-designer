/* =========================================================================
   sap-io.js — SAP2000 結果表格與模型檔（.s2k／.$2k 文字）之解析（docs/INTEGRATION.md §8）
   輸出與 midas-io.js 相同的資料結構，匯入視窗、控制組合挑選（columnLoads／beamLoads）完全共用：
     內力表 → {ok, kind:'beam', rows:[{elem, label, load, part, end, frac, N, Vy, Vz, T, My, Mz}], loads, units, …, prog:'sap'}
     模型   → {unit, nodes, elems:{id:{type:'BEAM', i, j, sect, mat}}, sects, mats, groups, counts, prog:'sap'}
   SAP2000 構材局部軸（預設）：1 沿構材、2 在含整體 Z 的平面內（水平梁時向上）、3 = 1 × 2。
   對應到 Midas 的寫法（本工具其餘程式都以 Midas 欄位思考）：
     N = P、Vz = V2、Vy = V3、T = T、My = M3（強軸，配 V2）、Mz = M2（配 V3）。
   SAP2000 水平梁正 M3 = 下緣受拉（與本工具 Midas 預設相同）；柱的 M2／M3 方向依局部軸，匯入視窗另有 x、y 對調。
   表格欄名、單位列、StepType 寫法依 SAP2000 v20～v24 的匯出格式，尚待實機核對（INTEGRATION §6 S1～S6）。
   不讀寫 DOM；網頁（宣告全域 SapIO）與 Node（require）共用。
   ========================================================================= */
'use strict';
const SapIO = (() => {
  const VERSION = '2026.11-s1';
  const FORCE_KGF = {KGF:1, TONF:1000, TF:1000, TON:1000, N:1/9.80665, KN:1000/9.80665, MN:1e6/9.80665, LB:0.45359237, LBF:0.45359237, KIP:453.59237, KIPS:453.59237};
  const LEN_CM = {MM:0.1, CM:1, M:100, IN:2.54, FT:30.48};
  const U = s => String(s || '').toUpperCase().replace(/\s+/g, '');
  const num = v => { const x = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return Number.isFinite(x) ? x : NaN; };

  /* 非數字的 Frame／Joint 標籤（例如 B12、C3）轉成整數編號；同一個工作階段內固定，內力表與模型檔才對得上 */
  const REG = new Map();
  const idOf = (kind, label) => {
    const t = String(label == null ? '' : label).trim();
    if(/^\d+$/.test(t)) return +t;
    const k = kind + ':' + t;
    if(!REG.has(k)) REG.set(k, 900000000 + REG.size + 1);
    return REG.get(k);
  };

  /* ---------- 文字格式（.s2k／.$2k）：TABLE:  "名稱" 後面每行 Key=Value ---------- */
  function kvLine(line){
    const o = {}; const re = /([A-Za-z0-9_]+)=("([^"]*)"|\S+)/g; let m, any = false;
    while((m = re.exec(line))){ o[m[1]] = m[3] != null ? m[3] : m[2]; any = true; }
    return any ? o : null;
  }
  /* 回傳 {表名大寫: [列物件]}；續行（行尾 _）接起來 */
  function s2kTables(txt){
    const raw = String(txt == null ? '' : txt).replace(/^﻿/, '').split(/\r?\n/), out = {};
    let cur = null, buf = '';
    for(const l of raw){
      const t = l.trim();
      const h = t.match(/^TABLE:\s*"?([^"]+?)"?\s*$/i);
      if(h){ cur = h[1].trim().toUpperCase(); out[cur] = out[cur] || []; buf = ''; continue; }
      if(!cur || !t || /^END TABLE DATA/i.test(t)) continue;
      if(/\s_$/.test(t)){ buf += t.replace(/\s_$/, ' '); continue; }
      const o = kvLine(buf + t); buf = '';
      if(o) out[cur].push(o);
    }
    return out;
  }
  const isS2k = txt => /^\s*TABLE:\s*"?[A-Z]/im.test(String(txt || '')) && /=/.test(String(txt || ''));
  /* CurrUnits="KN, m, C" → {force, len} */
  function unitsOf(tbls){
    const pc = (tbls['PROGRAM CONTROL'] || [])[0];
    const s = pc && (pc.CurrUnits || pc.CURRUNITS);
    if(!s) return null;
    const [f, l] = String(s).split(',').map(U);
    return FORCE_KGF[f] != null && LEN_CM[l] != null ? {force: f, len: l} : null;
  }

  /* ---------- 內力表 ---------- */
  const COLS = {
    frame: /^frame$/i, station: /^station$/i, load: /^outputcase$/i, ctype: /^casetype$/i, step: /^steptype$/i, stepn: /^stepnum$/i,
    P: /^p$/i, V2: /^v2$/i, V3: /^v3$/i, T: /^t$/i, M2: /^m2$/i, M3: /^m3$/i,
  };
  function splitRows(input){
    if(Array.isArray(input)) return input.map(r => (r || []).map(c => c == null ? '' : String(c).trim()));
    const lines = String(input == null ? '' : input).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const tab = lines.some(l => l.includes('\t'));
    return lines.map(l => (tab ? l.split('\t') : l.split(/,|;/)).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  }
  /* 表格（Excel／複製）或 .s2k 文字 → 統一成 [{Frame, Station, OutputCase, …}] 與單位 */
  function records(input){
    if(!Array.isArray(input) && isS2k(input)){
      const T = s2kTables(input), key = Object.keys(T).find(k => /^ELEMENT FORCES - FRAMES/.test(k));
      if(!key) return null;
      return {recs: T[key], units: unitsOf(T), src: 's2k'};
    }
    const rows = splitRows(input);
    let hi = -1, map = null;
    for(let r = 0; r < Math.min(rows.length, 40) && hi < 0; r++){
      const m = {};
      rows[r].forEach((c, j) => { for(const [k, re] of Object.entries(COLS)) if(m[k] == null && re.test(c.trim())){ m[k] = j; break; } });
      if(m.frame != null && m.load != null && (m.M3 != null || m.P != null)){ hi = r; map = m; }
    }
    if(hi < 0) return null;
    // 單位列：標題下一列「Text, m, Text, …, KN, KN-m」
    const nx = rows[hi+1] || [], unitRow = nx.length && nx.some(c => /^text$/i.test(c.trim()));
    let units = null;
    if(unitRow){
      const f = U(nx[map.P != null ? map.P : map.V2] || ''), mm = U(nx[map.M3 != null ? map.M3 : map.M2] || '').split(/[-*·]/);
      if(FORCE_KGF[f] != null && LEN_CM[mm[1]] != null) units = {force: f, len: mm[1]};
    }
    const names = Object.keys(map);
    const recs = [];
    for(let r = hi + 1 + (unitRow ? 1 : 0); r < rows.length; r++){
      const a = rows[r]; if(a.every(c => !c)) continue;
      const o = {}; names.forEach(k => { o[k] = a[map[k]] != null ? a[map[k]] : ''; });
      o._n = r + 1; recs.push(o);
    }
    return {recs: recs.map(o => ({Frame: o.frame, Station: o.station, OutputCase: o.load, CaseType: o.ctype, StepType: o.step, StepNum: o.stepn,
      P: o.P, V2: o.V2, V3: o.V3, T: o.T, M2: o.M2, M3: o.M3, _n: o._n})), units, src: 'table'};
  }
  const isSapTable = input => { try{ return !!records(input); }catch(e){ return false; } };

  /* 載重名稱：組合照原名；Max／Min 包絡加 (max)／(min)；單一工況加 Midas 的工況後綴，
     匯入視窗的「包絡」「反應譜」「單一工況」判斷因此完全沿用 */
  function loadName(o){
    const c = String(o.OutputCase || '').trim(), ct = String(o.CaseType || '').trim().toUpperCase(), st = String(o.StepType || '').trim().toUpperCase();
    if(/RESPSPEC/.test(ct)) return `${c}(RS)`;
    if(st === 'MAX' || st === 'MIN') return `${c}(${st.toLowerCase()})`;
    const sn = String(o.StepNum || '').trim(), stepTag = sn && st && st !== 'MAX' && st !== 'MIN' ? ` #${sn}` : '';
    if(!ct || ct === 'COMBINATION') return c + stepTag;
    if(/HIST/.test(ct)) return `${c}(TH)${stepTag}`;
    if(/MOVING/.test(ct)) return `${c}(MV)${stepTag}`;
    if(/STAGED/.test(ct)) return `${c}(CS)${stepTag}`;
    if(/MODAL/.test(ct)) return `${c}(MODE)${stepTag}`;
    return `${c}(ST)${stepTag}`;
  }

  function parseForceTable(input, fallback){
    const warnings = [], skipped = [];
    const R = records(input);
    if(!R) return {ok: false, why: '找不到 SAP2000 Element Forces - Frames 的標題列（需含 Frame、OutputCase 與 P／M3 等欄位）。', rows: [], loads: [], warnings, skipped};
    const fU = (R.units && R.units.force) || (fallback && U(fallback.force)) || null;
    const lU = (R.units && R.units.len) || (fallback && U(fallback.len)) || null;
    if(!fU || !lU || FORCE_KGF[fU] == null || LEN_CM[lU] == null)
      return {ok: false, needUnit: true, why: '表格沒有單位列，也沒有模型檔的 CurrUnits。請在下方選擇內力表的單位。', rows: [], loads: [], warnings, skipped};
    const kF = FORCE_KGF[fU]/1000, kM = FORCE_KGF[fU]*LEN_CM[lU]/1e5;
    // 每根 Frame 的站距範圍：最小站距 = I 端、最大 = J 端
    const span = new Map();
    R.recs.forEach(o => { const s = num(o.Station), f = String(o.Frame || '').trim(); if(!f || !Number.isFinite(s)) return;
      const q = span.get(f) || {lo: Infinity, hi: -Infinity}; q.lo = Math.min(q.lo, s); q.hi = Math.max(q.hi, s); span.set(f, q); });
    const out = [], loads = [];
    R.recs.forEach((o, k) => {
      const lab = String(o.Frame || '').trim(), n = o._n || k + 1;
      if(!lab){ skipped.push({n, why: 'Frame 欄空白'}); return; }
      const s = num(o.Station), q = span.get(lab);
      if(!Number.isFinite(s) || !q){ skipped.push({n, why: 'Station 不是數字'}); return; }
      const L = q.hi - q.lo, frac = L > 1e-12 ? (s - q.lo)/L : 0;
      const end = Math.abs(s - q.lo) < 1e-9 ? 'I' : Math.abs(s - q.hi) < 1e-9 ? 'J' : 'M';
      const v = {}; let bad = false;
      for(const c of ['P', 'V2', 'V3', 'T', 'M2', 'M3']){
        const t = String(o[c] == null ? '' : o[c]).trim(), x = t === '' ? 0 : num(t);
        if(!Number.isFinite(x)){ bad = true; break; }
        v[c] = x;
      }
      if(bad){ skipped.push({n, why: '數值欄非數字'}); return; }
      const ld = loadName(o);
      if(!loads.includes(ld)) loads.push(ld);
      out.push({elem: idOf('F', lab), label: /^\d+$/.test(lab) ? '' : lab, load: ld, part: `${+s.toFixed(4)}`, end, frac,
        comp: '', N: v.P*kF, Vy: v.V3*kF, Vz: v.V2*kF, T: v.T*kM, My: v.M3*kM, Mz: v.M2*kM});
    });
    if(!out.length) return {ok: false, why: '標題列以下沒有可讀的資料列。', rows: [], loads: [], warnings, skipped};
    const env = loads.filter(l => /\((max|min)\)\s*$/i.test(l));
    if(env.length) warnings.push(`有包絡組合（${env.slice(0, 4).join('、')}）：Max／Min 各分量不是同時發生，預設不勾選；設計請用一般組合的同時內力。`);
    const rs = loads.filter(l => /\(rs\)\s*$/i.test(l));
    if(rs.length) warnings.push(`有反應譜工況（${rs.slice(0, 4).join('、')}）：各分量是振態組合後的絕對值，沒有正負號、彼此不同時，不能直接當設計內力；請用含恆載的地震組合，並分別檢核恆載軸力＋地震軸力與恆載軸力－地震軸力，預設不勾選。`);
    if([...span.values()].some(q => q.lo > 1e-9)) warnings.push('有 Frame 的最小 Station 不是 0（只輸出了部分站點？），I 端以該 Frame 出現的最小 Station 計。');
    warnings.push('SAP2000 欄位對應：P_u = −P、M_ux = M3、M_uy = M2、V_uy = V2、V_ux = V3（局部軸 2、3 與斷面 H、B 的對應請在匯入後確認，必要時勾 x／y 對調）。');
    return {ok: true, kind: 'beam', prog: 'sap', rows: out, loads, envelope: env, units: {force: fU, len: lU, src: {force: R.units ? 'header' : 'fallback', len: R.units ? 'header' : 'fallback'}}, warnings, skipped, cols: {}};
  }

  /* ---------- 模型檔（.s2k 文字）→ 與 MidasIO.parseMct 相同的結構 ---------- */
  function parseModel(txt){
    const T = s2kTables(txt), out = {unit: unitsOf(T), nodes: {}, elems: {}, sects: {}, thick: {}, mats: {}, groups: [], counts: {nodes: 0, elems: 0}, prog: 'sap'};
    (T['JOINT COORDINATES'] || []).forEach(o => {
      const id = idOf('J', o.Joint);
      const x = num(o.GlobalX != null ? o.GlobalX : o.XorR), y = num(o.GlobalY != null ? o.GlobalY : o.Y), z = num(o.GlobalZ != null ? o.GlobalZ : o.Z);
      if([x, y, z].every(Number.isFinite)){ out.nodes[id] = {x, y, z}; out.counts.nodes++; }
    });
    // 斷面：名稱 → 編號（依出現順序）
    const secId = new Map(), matId = new Map();
    const sid = nm => { if(!secId.has(nm)) secId.set(nm, secId.size + 1); return secId.get(nm); };
    const mid = nm => { if(!matId.has(nm)) matId.set(nm, matId.size + 1); return matId.get(nm); };
    (T['MATERIAL PROPERTIES 01 - GENERAL'] || []).forEach(o => { if(o.Material) out.mats[mid(o.Material)] = {type: U(o.Type), name: o.Material}; });
    const props = {};
    (T['FRAME PROPS 01 - GENERAL'] || T['FRAME SECTION PROPERTIES 01 - GENERAL'] || []).forEach(o => { if(o.SectionName) props[o.SectionName] = o; });
    Object.entries(props).forEach(([nm, o]) => {
      const sh = U(o.Shape), t3 = num(o.t3), t2 = num(o.t2), tf = num(o.tf), tw = num(o.tw);
      const s = {id: sid(nm), type: 'DBUSER', name: nm, shape: null, dims: []};
      if(/^RECTANGULAR$/.test(sh)) { s.shape = 'SB'; s.dims = [t3, t2]; }
      else if(/^CIRCLE$/.test(sh)) { s.shape = 'SR'; s.dims = [t3]; }
      else if(/^(BOX|BOX\/TUBE|TUBE)$/.test(sh)) { s.shape = 'B'; s.dims = [t3, t2, tw, tf, 0, tf]; }
      else s.type = sh || 'OTHER';
      out.sects[s.id] = s;
      if(o.Material && !matId.has(o.Material)){ out.mats[mid(o.Material)] = {type: '', name: o.Material}; }
    });
    const secOf = {}, matOfSec = nm => props[nm] && props[nm].Material ? mid(props[nm].Material) : 0;
    (T['FRAME SECTION ASSIGNMENTS'] || []).forEach(o => { secOf[String(o.Frame).trim()] = o.AnalSect || o.DesignSect || o.SectionName; });
    (T['CONNECTIVITY - FRAME'] || []).forEach(o => {
      const lab = String(o.Frame).trim(), id = idOf('F', lab), i = idOf('J', o.JointI), j = idOf('J', o.JointJ);
      const sn = secOf[lab];
      out.elems[id] = {type: 'BEAM', mat: sn ? matOfSec(sn) : 0, sect: sn ? sid(sn) : 0, i, j, ...(/^\d+$/.test(lab) ? {} : {label: lab})};
      out.counts.elems++;
    });
    const gm = new Map();
    (T['GROUPS 2 - ASSIGNMENTS'] || []).forEach(o => {
      const g = String(o.GroupName || '').trim(); if(!g || /^ALL$/i.test(g)) return;
      if(!gm.has(g)) gm.set(g, {name: g, nodes: [], elems: []});
      const t = U(o.ObjectType);
      if(t === 'FRAME') gm.get(g).elems.push(idOf('F', o.ObjectLabel));
      else if(t === 'JOINT') gm.get(g).nodes.push(idOf('J', o.ObjectLabel));
    });
    out.groups = [...gm.values()].filter(g => g.elems.length);
    return out;
  }

  return {VERSION, isS2k, s2kTables, isSapTable, parseForceTable, parseModel, loadName, idOf};
})();

if(typeof module !== 'undefined' && module.exports) module.exports = SapIO;
