/* =========================================================================
   midas-io.js — Midas Civil 結果與模型檔之解析（工具整合 M1，見 docs/INTEGRATION.md）
   不讀寫 DOM、不依賴全域狀態，網頁（<script src>，宣告全域 MidasIO）與 Node（require）共用，
   以 tests/midas.test.js 直接做單元測試。
   輸出單位：力 tf、彎矩 tf·m、長度 cm（與本工具載重表、斷面輸入一致）。
   Midas 表格與 MCT 的欄位寫法以公開資料為準，尚待實機核對（docs/INTEGRATION.md §6 V1～V6）。
   ========================================================================= */
'use strict';
const MidasIO = (() => {
  const VERSION = '2026.11-m2';

  /* ---------- 單位 ---------- */
  // 每 1 單位等於多少 kgf／cm
  const FORCE_KGF = {KGF:1, TONF:1000, TF:1000, T:1000, TON:1000, N:1/9.80665, KN:1000/9.80665, MN:1e6/9.80665, LBF:0.45359237, KIPS:453.59237, KIP:453.59237};
  const LEN_CM = {MM:0.1, CM:1, M:100, IN:2.54, FT:30.48};
  const normUnit = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[·•⋅]/g, '*');
  const forceK = u => FORCE_KGF[normUnit(u)];
  const lenK = u => LEN_CM[normUnit(u)];
  /* 標題列括號內的單位：「tonf」「kN*m」「tf·m」「kgf-cm」→ {force, len} */
  function unitOf(header){
    const m = String(header || '').match(/[(\[]([^)\]]+)[)\]]/);
    if(!m) return null;
    const parts = normUnit(m[1]).split(/[*\-.]/).filter(Boolean);
    const f = parts.find(p => FORCE_KGF[p] != null), l = parts.find(p => LEN_CM[p] != null && p !== 'T');
    if(!f && !l) return null;
    return {force: f || null, len: parts.length > 1 ? (l || null) : null};
  }

  /* ---------- Midas 編號清單 ---------- */
  // "1001to1011"、"1001to1051by2"、單獨號碼，以空白或逗號分隔（與 midas-curve-gen expandList 相同規則）
  function expandList(str){
    const out = [];
    String(str == null ? '' : str).split(/[\s,]+/).forEach(t => {
      if(!t) return;
      const m = t.match(/^(\d+)to(\d+)(?:by(\d+))?$/i);
      if(m){
        const a = +m[1], b = +m[2], by = Math.max(1, Math.round(+(m[3] || 1)) || 1);
        if(b - a > 1e6) return;
        for(let v = a; v <= b; v += by) out.push(v);
        return;
      }
      const v = Math.round(Number(t));
      if(Number.isFinite(v) && v > 0) out.push(v);
    });
    return out;
  }

  /* ---------- MCT ---------- */
  const TWO_NODE = new Set(['BEAM', 'TRUSS', 'TENSTR', 'COMPTR']);
  const num = v => { const x = Number(String(v == null ? '' : v).trim()); return Number.isFinite(x) ? x : NaN; };
  // DBUSER 斷面：資料列中第一個「形狀代碼, 1|2」之後即尺寸（2＝使用者輸入；1＝資料庫名稱）
  const SHAPES = new Set(['SB', 'SR', 'B', 'P']);
  function parseSection(f){
    const s = {id: Math.round(num(f[0])), type: (f[1] || '').toUpperCase(), name: (f[2] || '').trim(), shape: null, dims: []};
    if(s.type !== 'DBUSER') return s;
    for(let k = 3; k < f.length - 1; k++){
      const t = (f[k] || '').toUpperCase();
      if(SHAPES.has(t) && /^[12]$/.test(f[k+1])){
        s.shape = t;
        if(f[k+1] === '2') s.dims = f.slice(k+2).map(num).filter(Number.isFinite);
        else s.db = (f[k+3] || f[k+2] || '').trim();
        break;
      }
    }
    return s;
  }
  function parseMct(txt){
    const out = {unit: null, nodes: {}, elems: {}, sects: {}, thick: {}, mats: {}, groups: [], counts: {nodes:0, elems:0}};
    const raw = String(txt == null ? '' : txt).replace(/^﻿/, '').split(/\r?\n/);
    const lines = [];
    for(let i = 0; i < raw.length; i++){
      let ln = raw[i];
      while(/\\\s*$/.test(ln) && i + 1 < raw.length) ln = ln.replace(/\\\s*$/, '') + ' ' + raw[++i];
      lines.push(ln);
    }
    let cur = null;
    for(const rawLine of lines){
      const tr = rawLine.trim();
      if(!tr) continue;
      const head = tr.match(/^\*([A-Z0-9-]+)/i);
      if(head){ cur = head[1].toUpperCase(); continue; }
      const line = rawLine.replace(/;.*$/, '').trim();
      if(!line || !cur) continue;
      const f = line.split(',').map(t => t.trim());
      const id = Math.round(num(f[0]));
      if(cur === 'UNIT'){
        if(forceK(f[0]) != null && lenK(f[1]) != null) out.unit = {force: normUnit(f[0]), len: normUnit(f[1])};
      }else if(cur === 'NODE'){
        const x = num(f[1]), y = num(f[2]), z = num(f[3]);
        if(id > 0 && [x, y, z].every(Number.isFinite)){ out.nodes[id] = {x, y, z}; out.counts.nodes++; }
      }else if(cur === 'ELEMENT'){
        if(!(id > 0)) continue;
        const e = {type: (f[1] || '').toUpperCase(), mat: Math.round(num(f[2])) || 0, sect: Math.round(num(f[3])) || 0};
        if(TWO_NODE.has(e.type)){ const i = Math.round(num(f[4])), j = Math.round(num(f[5])); if(i > 0 && j > 0){ e.i = i; e.j = j; } }
        else if(e.type === 'PLATE'){ e.ns = f.slice(4, 8).map(v => Math.round(num(v))).filter(v => v > 0); e.thk = e.sect; }
        out.elems[id] = e; out.counts.elems++;
      }else if(cur === 'SECTION'){
        if(id > 0) out.sects[id] = parseSection(f);
      }else if(cur === 'THICKNESS'){
        // iTHK, TYPE, bSAME, THIK-IN, THIK-OUT, ...（TYPE＝VALUE）：取 TYPE 之後第一個正數為厚度
        // 版本間欄位略有不同（有的在 bSAME 前多一個整數欄）：有 YES／NO 時取其後第一個正數
        if(id > 0 && /^VALUE$/i.test(f[1] || '')){
          const yn = f.findIndex((v, k) => k > 1 && /^(YES|NO)$/i.test(v));
          const t = f.slice(yn > 0 ? yn + 1 : 2).map(num).find(v => v > 0); if(t) out.thick[id] = t; }
      }else if(cur === 'MATERIAL'){
        if(id > 0) out.mats[id] = {type: (f[1] || '').toUpperCase(), name: (f[2] || '').trim()};
      }else if(cur === 'GROUP'){
        const nm = (f[0] || '').trim();
        if(nm) out.groups.push({name: nm, nodes: expandList(f[1]), elems: expandList(f[2])});
      }
    }
    return out;
  }
  /* 混凝土強度建議值：材料名稱中的 210～700 三位數（例如 C280、fc'=350、350kgf） */
  function fcFromName(name){
    const m = String(name || '').match(/(?:^|[^A-Za-z0-9])(?:fc'?|f'c|c)?\s*=?\s*([2-7]\d0)(?!\d)/i);
    const v = m ? +m[1] : NaN;
    return v >= 210 && v <= 700 ? v : null;
  }
  /* Midas 斷面 → 本工具柱斷面（cm）；不支援者回傳 {ok:false, why} */
  function sectionToRc(sect, lenUnit){
    if(!sect) return {ok: false, why: '找不到斷面資料'};
    const K = lenK(lenUnit);
    if(K == null) return {ok: false, why: '.mct 沒有 *UNIT，無法換算斷面尺寸'};
    const d = (sect.dims || []).map(v => v*K);
    if(sect.type !== 'DBUSER' || !sect.shape) return {ok: false, why: `斷面型式 ${sect.type || '—'} 不支援（只讀 DBUSER 實心矩形、圓形、箱型）`};
    if(!d.length) return {ok: false, why: `斷面 ${sect.name} 取自資料庫（${sect.db || '—'}），沒有尺寸`};
    if(sect.shape === 'SB' && d.length >= 2) return {ok: true, secType: 'solid', H: d[0], B: d[1]};
    if(sect.shape === 'SR' && d.length >= 1) return {ok: true, secType: 'circle', Dia: d[0]};
    if(sect.shape === 'B' && d.length >= 4){
      const [H, B, tw, tf1, , tf2] = d, ts = [tw, tf1, tf2].filter(v => v > 0), t = Math.min(...ts);
      return {ok: true, secType: 'box', H, B, tw: t, note: Math.max(...ts) - t > 0.5 ? `箱型壁厚不等（${ts.map(v => +v.toFixed(1)).join('、')} cm），取最小值 ${+t.toFixed(1)} cm` : ''};
    }
    return {ok: false, why: `斷面形狀 ${sect.shape} 不支援`};
  }

  /* ---------- 內力表 ---------- */
  const COLS = [
    ['elem', /^(elem|element|元素|單元)/i],
    ['load', /^(load|lcb|載重|荷載|組合)/i],
    ['part', /^(part|位置|部位|point)/i],
    ['comp', /^(component|分量)/i],
    ['N',  /^(axial|fx\b|軸力|軸向)/i],
    ['Vy', /^(shear-?y|fy\b|剪力-?y)/i],
    ['Vz', /^(shear-?z|fz\b|剪力-?z)/i],
    ['T',  /^(torsion|mx\b|扭矩|扭力)/i],
    ['My', /^(moment-?y|my\b|彎矩-?y)/i],
    ['Mz', /^(moment-?z|mz\b|彎矩-?z)/i],
  ];
  const FORCE_KEYS = ['N', 'Vy', 'Vz'], MOMENT_KEYS = ['T', 'My', 'Mz'];
  function splitRows(input){
    if(Array.isArray(input)) return input.map(r => (r || []).map(c => c == null ? '' : String(c).trim()));
    const lines = String(input == null ? '' : input).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const tab = lines.some(l => l.includes('\t'));
    return lines.map(l => (tab ? l.split('\t') : l.split(/,|;/)).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  }
  /* Part 欄：I[101]、J[102]、1/4、2/4、3/4、I、J、0.25 → {end:'I'|'J'|'M', frac} */
  function parsePart(s){
    const t = String(s || '').trim();
    if(/^i\b|^i\[|^i$/i.test(t)) return {end: 'I', frac: 0};
    if(/^j\b|^j\[|^j$/i.test(t)) return {end: 'J', frac: 1};
    const m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
    if(m && +m[2] > 0){ const fr = +m[1]/+m[2]; return {end: fr <= 0 ? 'I' : fr >= 1 ? 'J' : 'M', frac: fr}; }
    const v = Number(t);
    if(Number.isFinite(v) && v >= 0 && v <= 1) return {end: v === 0 ? 'I' : v === 1 ? 'J' : 'M', frac: v};
    return null;
  }
  const isEnvelope = name => /\((max|min|all)\)\s*$/i.test(String(name || ''));
  /* 解析內力表（文字或二維陣列）。單位：標題括號 > fallback（.mct *UNIT 或手選）。
     回傳 rows（已換算 tf、tf·m）、loads（出現順序）、units、warnings、skipped */
  function parseForceTable(input, fallback){
    const rows = splitRows(input), warnings = [], skipped = [];
    let hi = -1, idx = null;
    for(let r = 0; r < Math.min(rows.length, 40) && hi < 0; r++){
      const map = {};
      rows[r].forEach((c, j) => { const h = c.replace(/\s+/g, ' ').trim(); for(const [k, re] of COLS) if(map[k] == null && re.test(h)){ map[k] = j; break; } });
      if(map.elem != null && map.load != null && (map.My != null || map.N != null)){ hi = r; idx = map; }
    }
    if(hi < 0) return {ok: false, why: '找不到標題列（需含 Elem、Load 與 Axial／Moment-y 等欄位名稱）。請連同標題列一起複製。', rows: [], loads: [], warnings, skipped};
    // 單位：本列括號，或下一列（Excel 匯出常把單位放在第二列）
    const head = rows[hi], next = rows[hi+1] || [];
    const unitRowUsed = next.length && next.every(c => !c || !Number.isFinite(Number(c))) && next.some(c => unitOf(c.includes('(') ? c : `(${c})`));
    const uAt = j => unitOf(head[j]) || (unitRowUsed ? unitOf(next[j].includes('(') ? next[j] : `(${next[j]})`) : null);
    let fU = null, lU = null;
    for(const k of FORCE_KEYS) if(idx[k] != null){ const u = uAt(idx[k]); if(u && u.force){ fU = u.force; break; } }
    for(const k of MOMENT_KEYS) if(idx[k] != null){ const u = uAt(idx[k]); if(u){ fU = fU || u.force; if(u.len){ lU = u.len; break; } } }
    const src = {force: fU ? 'header' : 'fallback', len: lU ? 'header' : 'fallback'};
    fU = fU || (fallback && fallback.force) || null;
    lU = lU || (fallback && fallback.len) || null;
    if(!fU || !lU) return {ok: false, needUnit: true, why: '表格標題沒有單位，也沒有 .mct 的 *UNIT。請在下方選擇內力表的單位。', rows: [], loads: [], warnings, skipped};
    const kF = forceK(fU)/1000, kM = forceK(fU)*lenK(lU)/1e5;     // → tf、tf·m
    const out = [], loads = [];
    let lastElem = NaN, lastLoad = '';
    for(let r = hi + 1 + (unitRowUsed ? 1 : 0); r < rows.length; r++){
      const a = rows[r];
      if(a.every(c => !c)) continue;
      // Midas 表格合併儲存格複製後，同一元素、同一組合的後續列可能空白 → 沿用上一列
      let e = Math.round(Number(a[idx.elem]));
      if(!(a[idx.elem] || '').trim()) e = lastElem;
      let ld = (a[idx.load] || '').trim() || lastLoad;
      if(!(e > 0)){ skipped.push({n: r+1, why: '元素編號不是數字'}); continue; }
      const p = idx.part != null ? parsePart(a[idx.part]) : {end: 'I', frac: 0};
      if(!p){ skipped.push({n: r+1, why: `位置「${a[idx.part]}」無法辨識`}); continue; }
      const v = {};
      let bad = false;
      for(const k of FORCE_KEYS.concat(MOMENT_KEYS)){
        if(idx[k] == null){ v[k] = 0; continue; }
        const t = (a[idx[k]] || '').replace(/,/g, '').trim(), x = t === '' ? 0 : Number(t);
        if(!Number.isFinite(x)){ bad = true; break; }
        v[k] = x*(FORCE_KEYS.includes(k) ? kF : kM);
      }
      if(bad){ skipped.push({n: r+1, why: '數值欄非數字'}); continue; }
      lastElem = e; lastLoad = ld;
      if(!loads.includes(ld)) loads.push(ld);
      out.push({elem: e, load: ld, part: (a[idx.part] || '').trim(), end: p.end, frac: p.frac, comp: idx.comp != null ? (a[idx.comp] || '').trim() : '', ...v});
    }
    if(!out.length) return {ok: false, why: '標題列以下沒有可讀的資料列。', rows: [], loads: [], warnings, skipped};
    const missing = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'].filter(k => idx[k] == null);
    if(missing.length) warnings.push(`表格缺少欄位 ${missing.join('、')}，以 0 計。`);
    if(idx.part == null) warnings.push('表格沒有 Part（位置）欄，全部視為元素 I 端。');
    const env = loads.filter(isEnvelope);
    if(env.length || out.some(r => r.comp)) warnings.push(`有包絡組合（${env.slice(0, 4).join('、') || 'Component 欄'}）：包絡各分量不是同時發生，預設不勾選；設計請用一般組合的同時內力。`);
    return {ok: true, rows: out, loads, envelope: env, units: {force: fU, len: lU, src}, warnings, skipped, cols: idx};
  }

  /* ---------- 構件幾何 ---------- */
  /* 群組（或元素清單）→ 構件：元素、節點高程、頂底節點、長度、斷面編號 */
  function memberInfo(elemIds, mct){
    const ids = [...new Set(elemIds)];
    const info = {elems: ids, nodes: [], top: null, bot: null, length: NaN, sects: [], mats: [], vertical: null, known: false};
    if(!mct) return info;
    const el = ids.map(i => [i, mct.elems[i]]).filter(([, e]) => e && e.i);
    if(!el.length) return info;
    info.known = true;
    const ns = new Set(), sects = new Set(), mats = new Set();
    let L = 0, vert = 0;
    for(const [, e] of el){
      ns.add(e.i); ns.add(e.j); sects.add(e.sect); mats.add(e.mat);
      const a = mct.nodes[e.i], b = mct.nodes[e.j];
      if(a && b){
        const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
        L += Math.hypot(dx, dy, dz);
        if(Math.abs(dz) > Math.hypot(dx, dy)) vert++;
      }
    }
    info.nodes = [...ns].filter(n => mct.nodes[n]);
    info.sects = [...sects]; info.mats = [...mats];
    info.length = L*(lenK(mct.unit && mct.unit.len) || NaN);
    info.vertical = vert*2 > el.length;
    if(info.nodes.length){
      const byZ = info.nodes.slice().sort((p, q) => mct.nodes[q].z - mct.nodes[p].z);
      info.top = byZ[0]; info.bot = byZ[byZ.length-1];
    }
    return info;
  }
  /* 內力列所在的節點（I、J 端），內部點回傳 null */
  function rowNode(r, mct){
    const e = mct && mct.elems[r.elem];
    if(!e || !e.i) return null;
    return r.end === 'I' ? e.i : r.end === 'J' ? e.j : null;
  }
  const rowTag = r => `E${r.elem}-${r.end === 'M' ? r.part || r.frac : r.end}`;

  /* ---------- 柱（墩柱、橋塔、基樁） ----------
     opts: {loads:[勾選的載重], swap:false（x／y 對調）, all:false（輸出全部組合而非控制組合）}
     回傳 {loads:[{name,Pu,Mux,Muy,Vux,Vuy,Tu,pos?}], ctrl:[{why,load,tag}], src:[{name,pos,tag}], warnings} */
  function colMap(r, swap){
    const o = {Pu: -r.N, Mux: r.My, Muy: r.Mz, Vux: r.Vy, Vuy: r.Vz, Tu: r.T};
    if(swap){ [o.Mux, o.Muy] = [o.Muy, o.Mux]; [o.Vux, o.Vuy] = [o.Vuy, o.Vux]; }
    return o;
  }
  const r3 = v => Math.round(v*1000)/1000 + 0;
  function columnLoads(table, elemIds, mct, opts){
    opts = opts || {};
    const set = new Set(elemIds), sel = new Set(opts.loads || table.loads.filter(l => !isEnvelope(l)));
    const rows = table.rows.filter(r => set.has(r.elem) && sel.has(r.load)).map(r => ({r, f: colMap(r, opts.swap)}));
    const warnings = [];
    if(!rows.length) return {loads: [], ctrl: [], src: [], warnings: ['所選構件與載重在內力表中沒有資料列。']};
    const mi = memberInfo(elemIds, mct);
    // 頂、底端：依 .mct 節點高程；沒有 .mct 時取元素編號最大者之 J 端為頂、最小者之 I 端為底（並警示）
    let atTop, atBot;
    if(mi.known && mi.top != null){
      atTop = x => rowNode(x.r, mct) === mi.top; atBot = x => rowNode(x.r, mct) === mi.bot;
      if(mi.vertical === false) warnings.push('群組內元素多半不是鉛直向，頂、底仍依節點高程判定，請確認。');
    }else{
      const eMax = Math.max(...elemIds), eMin = Math.min(...elemIds);
      atTop = x => x.r.elem === eMax && x.r.end === 'J'; atBot = x => x.r.elem === eMin && x.r.end === 'I';
      warnings.push('沒有 .mct 節點座標：頂端取最大元素編號之 J 端、底端取最小元素編號之 I 端，請確認元素方向。');
    }
    const pick = (fn, why) => { let best = null, bv = -Infinity; for(const x of rows){ const v = fn(x.f); if(v > bv + 1e-12){ bv = v; best = x; } } return best && {why, x: best, v: bv}; };
    const crit = [
      pick(f => f.Pu, 'P_u 最大'), pick(f => -f.Pu, 'P_u 最小'),
      pick(f => f.Mux, 'M_ux 正向最大'), pick(f => -f.Mux, 'M_ux 負向最大'),
      pick(f => f.Muy, 'M_uy 正向最大'), pick(f => -f.Muy, 'M_uy 負向最大'),
      pick(f => Math.hypot(f.Mux, f.Muy), '合彎矩最大'),
      pick(f => Math.abs(f.Vux), '|V_ux| 最大'), pick(f => Math.abs(f.Vuy), '|V_uy| 最大'), pick(f => Math.abs(f.Tu), '|T_u| 最大'),
    ].filter(c => c && (c.why === 'P_u 最小' ? Math.abs(c.v) > 1e-9 : c.v > 1e-9));   // 正向／負向：該方向確實出現才列（P_u 最小保留負值＝最小壓力）
    const loadsOrder = table.loads.filter(l => sel.has(l));
    const ctrlLoads = opts.all ? loadsOrder : loadsOrder.filter(l => crit.some(c => c.x.r.load === l));
    const out = [], src = [];
    const push = (x, name, pos) => { out.push({name, ...Object.fromEntries(Object.entries(x.f).map(([k, v]) => [k, r3(v)])), ...(pos ? {pos} : {})}); src.push({name, pos: pos || '', tag: rowTag(x.r)}); };
    for(const l of ctrlLoads){
      const t = rows.find(x => x.r.load === l && atTop(x)), b = rows.find(x => x.r.load === l && atBot(x));
      if(t) push(t, l, 'top');
      if(b) push(b, l, 'bot');
      if(!t || !b) warnings.push(`組合 ${l} 缺少構件${!t ? '頂' : '底'}端的資料列。`);
      // 控制點在構件中間：另列
      for(const c of crit) if(c.x.r.load === l && c.x !== t && c.x !== b && !out.some(o => o.name === `${l} @${rowTag(c.x.r)}`)) push(c.x, `${l} @${rowTag(c.x.r)}`, '');
    }
    const ctrl = crit.map(c => ({why: c.why, load: c.x.r.load, tag: rowTag(c.x.r), v: r3(c.v)}));
    if(mi.known && mi.sects.length > 1) warnings.push(`群組內有 ${mi.sects.length} 種斷面（${mi.sects.join('、')}），本工具以單一斷面設計，變斷面請分段建立構件。`);
    return {loads: out, ctrl, src, info: mi, warnings};
  }

  /* ---------- 梁（帽梁、橫梁） ----------
     opts: {loads, sagPos:true（Midas 正 M_y＝下緣受拉）, all:false} */
  function beamLoads(table, elemIds, mct, opts){
    opts = opts || {};
    const set = new Set(elemIds), sel = new Set(opts.loads || table.loads.filter(l => !isEnvelope(l)));
    const s = opts.sagPos === false ? -1 : 1;
    const per = new Map();
    let mzMax = 0, mzTag = '';
    for(const r of table.rows){
      if(!set.has(r.elem) || !sel.has(r.load)) continue;
      let a = per.get(r.load);
      if(!a){ a = {name: r.load, Mpos: 0, Mneg: 0, Vu: 0, Tu: 0, at: {}}; per.set(r.load, a); }
      const m = s*r.My;
      if(m > a.Mpos){ a.Mpos = m; a.at.Mpos = rowTag(r); }
      if(-m > a.Mneg){ a.Mneg = -m; a.at.Mneg = rowTag(r); }
      if(Math.abs(r.Vz) > a.Vu){ a.Vu = Math.abs(r.Vz); a.at.Vu = rowTag(r); }
      if(Math.abs(r.T) > a.Tu){ a.Tu = Math.abs(r.T); a.at.Tu = rowTag(r); }
      if(Math.abs(r.Mz) > mzMax){ mzMax = Math.abs(r.Mz); mzTag = `${r.load} ${rowTag(r)}`; }
    }
    const all = table.loads.filter(l => per.has(l)).map(l => per.get(l));
    const warnings = [];
    if(!all.length) return {loads: [], ctrl: [], src: [], warnings: ['所選構件與載重在內力表中沒有資料列。']};
    const crit = [];
    for(const [k, why] of [['Mpos', 'M_u⁺ 最大'], ['Mneg', 'M_u⁻ 最大'], ['Vu', 'V_u 最大'], ['Tu', 'T_u 最大']]){
      let b = null; for(const a of all) if(a[k] > 1e-9 && (!b || a[k] > b[k] + 1e-12)) b = a;
      if(b) crit.push({why, load: b.name, tag: b.at[k], v: r3(b[k])});
    }
    const pick = opts.all ? all : all.filter(a => crit.some(c => c.load === a.name));
    const out = pick.map(a => ({name: a.name, Mpos: r3(a.Mpos), Mneg: r3(a.Mneg), Vu: r3(a.Vu), Tu: r3(a.Tu)}));
    const src = pick.map(a => ({name: a.name, pos: '', tag: ['Mpos', 'Mneg', 'Vu', 'Tu'].filter(k => a.at[k]).map(k => `${k} ${a.at[k]}`).join('；')}));
    const myMax = Math.max(...all.map(a => Math.max(a.Mpos, a.Mneg)));
    if(mzMax > 0.1*myMax && mzMax > 0.01) warnings.push(`側向彎矩 M_z 達 ${r3(mzMax)} tf·m（${mzTag}），梁模組只檢核強軸彎矩，請另行檢核。`);
    const mi = memberInfo(elemIds, mct);
    if(mi.known && mi.sects.length > 1) warnings.push(`群組內有 ${mi.sects.length} 種斷面（${mi.sects.join('、')}），本工具以單一斷面設計，變斷面請分段建立構件。`);
    return {loads: out, ctrl: crit, src, info: mi, warnings};
  }

  /* 靜載重軸力 P_D（tf，壓為正）：指定載重在構件底端之軸力 */
  function deadAxial(table, elemIds, mct, loadName){
    const set = new Set(elemIds), mi = memberInfo(elemIds, mct);
    const rows = table.rows.filter(r => set.has(r.elem) && r.load === loadName);
    if(!rows.length) return null;
    let b = mi.known && mi.bot != null ? rows.find(r => rowNode(r, mct) === mi.bot) : null;
    if(!b){ const eMin = Math.min(...elemIds); b = rows.find(r => r.elem === eMin && r.end === 'I') || rows[0]; }
    return r3(-b.N);
  }

  /* ---------- 版（Plate Force，工具整合 M2） ----------
     Midas Results > Result Tables > Plate > Force（單位寬內力，建議輸出元素局部座標或同一 UCS）：
       Elem, Load, Node, Fxx, Fyy, Fxy（F/L）, Mxx, Myy, Mxy（F·L/L）, Vxx, Vyy（F/L）
     換算為 1 m 寬版帶：彎矩 tf·m（= 數值 × 力單位/1000，與長度單位無關）、剪力與膜力 tf（÷ 分母長度 → 每公尺）。 */
  const PCOLS = [
    ['elem', /^(elem|element|元素|單元)/i], ['load', /^(load|lcb|載重|荷載|組合)/i], ['node', /^(node|節點|part|位置)/i],
    ['Fxx', /^fxx/i], ['Fyy', /^fyy/i], ['Fxy', /^fxy/i], ['Mxx', /^mxx/i], ['Myy', /^myy/i], ['Mxy', /^mxy/i], ['Vxx', /^vxx/i], ['Vyy', /^vyy/i],
  ];
  /* 「tonf*m/m」「kN/m」→ {force, den}；den 為分母長度單位 */
  function unitOfPerLen(h){
    const m = String(h || '').match(/[(\[]([^)\]]+)[)\]]/);
    if(!m) return null;
    const [nu, de] = normUnit(m[1]).split('/');
    const f = nu.split(/[*\-.]/).find(p => FORCE_KGF[p] != null);
    return {force: f || null, den: de && LEN_CM[de] != null ? de : null};
  }
  const isPlateTable = input => { const rows = splitRows(input).slice(0, 40); return rows.some(r => r.some(c => /^mxx/i.test(c.trim())) && r.some(c => /^mxy/i.test(c.trim()))); };
  function parsePlateTable(input, fallback){
    const rows = splitRows(input), warnings = [], skipped = [];
    let hi = -1, idx = null;
    for(let r = 0; r < Math.min(rows.length, 40) && hi < 0; r++){
      const map = {};
      rows[r].forEach((c, j) => { const h = c.replace(/\s+/g, ' ').trim(); for(const [k, re] of PCOLS) if(map[k] == null && re.test(h)){ map[k] = j; break; } });
      if(map.elem != null && map.load != null && map.Mxx != null && map.Myy != null && map.Mxy != null){ hi = r; idx = map; }
    }
    if(hi < 0) return {ok: false, kind: 'plate', why: '找不到版內力標題列（需含 Elem、Load、Mxx、Myy、Mxy）。請連同標題列一起複製。', rows: [], loads: [], warnings, skipped};
    const head = rows[hi], next = rows[hi+1] || [];
    const unitRowUsed = next.length && next.every(c => !c || !Number.isFinite(Number(c))) && next.some(c => unitOfPerLen(c.includes('(') ? c : `(${c})`));
    const uAt = j => unitOfPerLen(head[j]) || (unitRowUsed ? unitOfPerLen(next[j].includes('(') ? next[j] : `(${next[j]})`) : null);
    let fU = null, dU = null;
    for(const k of ['Mxx', 'Vxx', 'Fxx', 'Myy', 'Vyy']) if(idx[k] != null){ const u = uAt(idx[k]); if(u){ fU = fU || u.force; if(k[0] !== 'M') dU = dU || u.den; } }
    const src = {force: fU ? 'header' : 'fallback', len: dU ? 'header' : 'fallback'};
    fU = fU || (fallback && fallback.force) || null;
    dU = dU || (fallback && fallback.len) || null;
    if(!fU || !dU) return {ok: false, kind: 'plate', needUnit: true, why: '表格標題沒有單位，也沒有 .mct 的 *UNIT。請在下方選擇內力表的單位。', rows: [], loads: [], warnings, skipped};
    const kM = forceK(fU)/1000, kF = forceK(fU)/1000*100/lenK(dU);   // 1 m 版帶：tf·m、tf
    const out = [], loads = [];
    let lastElem = NaN, lastLoad = '';
    const KEYS = ['Fxx', 'Fyy', 'Fxy', 'Mxx', 'Myy', 'Mxy', 'Vxx', 'Vyy'];
    for(let r = hi + 1 + (unitRowUsed ? 1 : 0); r < rows.length; r++){
      const a = rows[r];
      if(a.every(c => !c)) continue;
      let e = Math.round(Number(a[idx.elem]));
      if(!(a[idx.elem] || '').trim()) e = lastElem;
      const ld = (a[idx.load] || '').trim() || lastLoad;
      if(!(e > 0)){ skipped.push({n: r+1, why: '元素編號不是數字'}); continue; }
      const nodeTxt = idx.node != null ? (a[idx.node] || '').trim() : '';
      const v = {}; let bad = false;
      for(const k of KEYS){
        if(idx[k] == null){ v[k] = 0; continue; }
        const t = (a[idx[k]] || '').replace(/,/g, '').trim(), x = t === '' ? 0 : Number(t);
        if(!Number.isFinite(x)){ bad = true; break; }
        v[k] = x*(k[0] === 'M' ? kM : kF);
      }
      if(bad){ skipped.push({n: r+1, why: '數值欄非數字'}); continue; }
      lastElem = e; lastLoad = ld;
      if(!loads.includes(ld)) loads.push(ld);
      out.push({elem: e, load: ld, node: nodeTxt, ...v});
    }
    if(!out.length) return {ok: false, kind: 'plate', why: '標題列以下沒有可讀的資料列。', rows: [], loads: [], warnings, skipped};
    const missing = ['Vxx', 'Vyy'].filter(k => idx[k] == null);
    if(missing.length) warnings.push(`表格缺少欄位 ${missing.join('、')}，剪力以 0 計。`);
    const env = loads.filter(isEnvelope);
    if(env.length) warnings.push(`有包絡組合（${env.slice(0, 4).join('、')}）：包絡各分量不是同時發生，Wood-Armer 須用同時之 M_xx、M_yy、M_xy，預設不勾選。`);
    return {ok: true, kind: 'plate', rows: out, loads, envelope: env, units: {force: fU, len: dU, src}, warnings, skipped, cols: idx};
  }
  /* 依標題自動判斷梁內力或版內力 */
  const parseAnyTable = (input, fallback) => isPlateTable(input) ? parsePlateTable(input, fallback) : {kind: 'beam', ...parseForceTable(input, fallback)};

  /* Wood-Armer（正值＝下緣受拉）：回傳兩向之下層設計彎矩（≥ 0）與上層設計彎矩（≤ 0）
     下層：M_x* = M_x + |M_xy|、M_y* = M_y + |M_xy|；若 M_x* < 0 → M_x* = 0、M_y* = M_y + |M_xy²/M_x|（y 向對稱）
     上層：M_x* = M_x − |M_xy|、M_y* = M_y − |M_xy|；若 M_x* > 0 → M_x* = 0、M_y* = M_y − |M_xy²/M_x|（y 向對稱） */
  function woodArmer(mx, my, mxy){
    const a = Math.abs(mxy);
    let xb = mx + a, yb = my + a;
    if(xb < 0 && yb < 0){ xb = 0; yb = 0; }
    else if(xb < 0){ xb = 0; yb = Math.abs(mx) > 1e-12 ? my + Math.abs(mxy*mxy/mx) : my + a; }
    else if(yb < 0){ yb = 0; xb = Math.abs(my) > 1e-12 ? mx + Math.abs(mxy*mxy/my) : mx + a; }
    let xt = mx - a, yt = my - a;
    if(xt > 0 && yt > 0){ xt = 0; yt = 0; }
    else if(xt > 0){ xt = 0; yt = Math.abs(mx) > 1e-12 ? my - Math.abs(mxy*mxy/mx) : my - a; }
    else if(yt > 0){ yt = 0; xt = Math.abs(my) > 1e-12 ? mx - Math.abs(mxy*mxy/my) : mx - a; }
    return {xb: Math.max(0, xb), yb: Math.max(0, yb), xt: Math.min(0, xt), yt: Math.min(0, yt)};
  }
  /* 版：每個組合在群組內所有節點取 Wood-Armer 設計彎矩（指定方向）與 |V| 最大，再挑控制組合。
     opts: {loads, dir:'x'|'y', sagPos:true（Midas 正 M＝下緣受拉）, all:false} */
  function slabLoads(table, elemIds, mct, opts){
    opts = opts || {};
    const set = new Set(elemIds), sel = new Set(opts.loads || table.loads.filter(l => !isEnvelope(l)));
    const s = opts.sagPos === false ? -1 : 1, Y = opts.dir === 'y';
    const per = new Map();
    let fMax = 0, fTag = '';
    for(const r of table.rows){
      if(!set.has(r.elem) || !sel.has(r.load)) continue;
      let a = per.get(r.load);
      if(!a){ a = {name: r.load, Mpos: 0, Mneg: 0, Vu: 0, Tu: 0, at: {}}; per.set(r.load, a); }
      const w = woodArmer(s*r.Mxx, s*r.Myy, r.Mxy), tag = `E${r.elem}-N${r.node || '?'}`;
      const mp = Y ? w.yb : w.xb, mn = -(Y ? w.yt : w.xt), v = Math.abs(Y ? r.Vyy : r.Vxx);
      if(mp > a.Mpos){ a.Mpos = mp; a.at.Mpos = tag; }
      if(mn > a.Mneg){ a.Mneg = mn; a.at.Mneg = tag; }
      if(v > a.Vu){ a.Vu = v; a.at.Vu = tag; }
      const f = Math.abs(Y ? r.Fyy : r.Fxx);
      if(f > fMax){ fMax = f; fTag = `${r.load} ${tag}`; }
    }
    const all = table.loads.filter(l => per.has(l)).map(l => per.get(l));
    const warnings = [];
    if(!all.length) return {loads: [], ctrl: [], src: [], warnings: ['所選構件與載重在內力表中沒有資料列。']};
    const crit = [];
    for(const [k, why] of [['Mpos', 'M_u⁺ 最大（Wood-Armer）'], ['Mneg', 'M_u⁻ 最大（Wood-Armer）'], ['Vu', 'V_u 最大']]){
      let b = null; for(const a of all) if(a[k] > 1e-9 && (!b || a[k] > b[k] + 1e-12)) b = a;
      if(b) crit.push({why, load: b.name, tag: b.at[k], v: r3(b[k])});
    }
    const pick = opts.all ? all : all.filter(a => crit.some(c => c.load === a.name));
    const out = pick.map(a => ({name: a.name, Mpos: r3(a.Mpos), Mneg: r3(a.Mneg), Vu: r3(a.Vu), Tu: 0}));
    const src = pick.map(a => ({name: a.name, pos: '', tag: ['Mpos', 'Mneg', 'Vu'].filter(k => a.at[k]).map(k => `${k} ${a.at[k]}`).join('；')}));
    if(fMax > 1) warnings.push(`版有膜力 ${Y ? 'F_yy' : 'F_xx'} 達 ${r3(fMax)} tf/m（${fTag}），版模組不計軸力，請另行檢核（例如以柱模組單位寬檢核）。`);
    const mi = plateInfo(elemIds, mct);
    if(mi.known && mi.thks.length > 1) warnings.push(`群組內有 ${mi.thks.length} 種厚度，本工具以單一厚度設計，請分區建立構件。`);
    if(!mi.known && mct) warnings.push('.mct 中找不到這些版元素（PLATE），無法讀取厚度。');
    warnings.push(`設計彎矩為 ${Y ? 'y' : 'x'} 向配筋（Wood-Armer 已含 M_xy）。各元素局部座標方向須一致，否則請在 Midas 改以同一 UCS 輸出。`);
    return {loads: out, ctrl: crit, src, info: mi, warnings};
  }
  /* 版元素群組 → 厚度（cm）、材料 */
  function plateInfo(elemIds, mct){
    const info = {elems: [...new Set(elemIds)], thks: [], mats: [], thickness: NaN, known: false};
    if(!mct) return info;
    const el = info.elems.map(i => mct.elems[i]).filter(e => e && e.type === 'PLATE');
    if(!el.length) return info;
    info.known = true;
    info.thks = [...new Set(el.map(e => e.thk))]; info.mats = [...new Set(el.map(e => e.mat))];
    const t = mct.thick[info.thks[0]], K = lenK(mct.unit && mct.unit.len);
    if(t && K) info.thickness = t*K;
    return info;
  }

  /* 匯入時載重表之指紋（判斷匯入後是否被手動修改） */
  function loadsKey(loads){
    return (loads || []).map(l => [l.name, l.pos || '', ...['Pu','Mux','Muy','Vux','Vuy','Tu','Mpos','Mneg','Vu'].map(k => l[k] == null ? '' : (+l[k]).toFixed(3))].join('|')).join(';');
  }

  return {VERSION, unitOf, forceK, lenK, expandList, parseMct, parseSection, fcFromName, sectionToRc, parsePart, isEnvelope,
          parseForceTable, memberInfo, columnLoads, beamLoads, deadAxial, loadsKey,
          isPlateTable, parsePlateTable, parseAnyTable, woodArmer, slabLoads, plateInfo};
})();

if(typeof module !== 'undefined' && module.exports) module.exports = MidasIO;
