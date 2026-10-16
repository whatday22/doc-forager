import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const FILE = path.join(process.cwd(), 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script> block found'); process.exit(1); }
const script = m[1];

// ---- 1) 语法检查（进程内编译，等价于 node --check，无需 spawn） ----
try {
  new Function(script);
  console.log('[ok] 脚本语法编译通过  (' + script.split('\n').length + ' 行)');
} catch (e) {
  console.error('[FAIL] 语法错误: ' + e.message);
  process.exit(1);
}

// ---- 2) DOM / Canvas 桩件 ----
// 统计昂贵绘制操作的调用次数，用来验证"开销不随规模增长"
const ops = { grad:0, shadow:0, stroke:0, fill:0, img:0 };
const grad = { addColorStop() {} };
function makeCtx() {
  const base = {
    measureText: () => ({ width: 42 }),
    createLinearGradient: () => { ops.grad++; return grad; },
    createRadialGradient: () => { ops.grad++; return grad; },
    drawImage: () => { ops.img++; },
    stroke: () => { ops.stroke++; },
    fill: () => { ops.fill++; },
    canvas: { width: 900, height: 520 },
  };
  return new Proxy(base, {
    get(t, k) { return (k in t) ? t[k] : () => {}; },
    set(t, k, v) { if (k === 'shadowBlur' && v > 0) ops.shadow++; t[k] = v; return true; },
  });
}
/* 记录 addEventListener 注册的处理器与 classList 状态，
   这样才能测到"鼠标碰到虫子"这类交互行为，而不是只测纯函数。 */
const listeners = new Map();
const clsState = new Map();
function clsSet(sel) { if (!clsState.has(sel)) clsState.set(sel, new Set()); return clsState.get(sel); }
function makeEl(sel) {
  return {
    _sel: sel, style: { setProperty() {} }, dataset: {}, disabled: false,
    classList: {
      add(c) { clsSet(sel).add(c); },
      remove(c) { clsSet(sel).delete(c); },
      toggle(c, on) { on ? clsSet(sel).add(c) : clsSet(sel).delete(c); },
      contains: (c) => clsSet(sel).has(c),
    },
    children: [], childElementCount: 0, firstChild: null, lastChild: null,
    value: '', textContent: '', innerHTML: '', scrollTop: 0, scrollLeft: 0,
    selectionStart: 0, selectionEnd: 0, height: 0, width: 0, offsetWidth: 172,
    addEventListener(type, fn) { listeners.set(sel + '|' + type, fn); },
    removeEventListener(type) { listeners.delete(sel + '|' + type); },
    insertBefore() { this.childElementCount++; return null; },
    removeChild() { this.childElementCount--; },
    appendChild() { this.childElementCount++; return null; },
    getBoundingClientRect: () => ({ width: 900, height: 520, top: 0, left: 0, right: 900, bottom: 520 }),
    getContext: () => makeCtx(),
    querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null, setAttribute() {}, focus() {}, blur() {},
  };
}
const elCache = new Map();
const bodyEl = makeEl('body');
const doc = {
  querySelector: (s) => { if (!elCache.has(s)) elCache.set(s, makeEl(s)); return elCache.get(s); },
  getElementById: (s) => { const k = '#' + s; if (!elCache.has(k)) elCache.set(k, makeEl(k)); return elCache.get(k); },
  querySelectorAll: () => [],
  createElement: (t) => makeEl('<' + t + '>'),
  createDocumentFragment: () => makeEl('#fragment'),
  addEventListener() {},
  body: bodyEl,
  documentElement: makeEl('html'),
  activeElement: null,
  fullscreenElement: null,
};
const win = { devicePixelRatio: 1, addEventListener() {}, innerWidth: 1920, innerHeight: 1080 };

const epilogue = `
globalThis.__T = { S, stepSim, net, addNode, addLink, parsePrompt, scoreText, buildHeat, pushHeat,
  drawHeat, drawNetwork, drawSphere, drawConf, bugStep, bugInit, synthPage, mulberry32, hashStr,
  slowTick, scoreText, frontierPush, computePrio, bestSnippet, detectType, parseAny, relColor,
  DEMO_PROMPTS, resetAll, TYPES, packets, spawnPackets, stepPackets, drawPackets, verdictOf,
  runCrawl, looksHtml, hostOf, RELAYS,
  abort: () => { abortFlag = true; },
  setPromptText: (t) => { edTa.value = t; edRender(); },
  exportSnapshot, toCSV, toMarkdown, pruneGraph, retireNode, MEM, Q, trackFrame,
  updateExportBar, buildGlowSprites, drawGlow, drawLabels, drawLinks, drawRings, drawNodes,
  syncOff, offConf, offHeat, offRings,
  // 本地文档解析与扫描
  unzip, inflateRaw, parseMarkdown, parsePlain, parseHtmlDoc, buildTable, finalizeDoc,
  parseLocalFile, runFileScan, tableToCSV, allTablesToCSV, renderTableHTML, tableHits,
  occurrencesIn, highlightSnippet, MODE_UI, applyModeLabels, syncRunBtn, DEMO_KEYWORDS,
  startRun, handleFile, parseWTable, wText, pMeta, W_NS,
  DOCX_PART, parseCSV, csvToRecords, parseJSONRecords, recordsToDoc, gapsCSV,
  updateReviewStat, wSymChar, listMarker, romanNum, cnNum, flattenValue, guessFieldRole,
  ROLE_ALIAS, openCoverage, computeCoverage: null,
  screenDocumentFromResult, isDocumentMode,
  // 彩蛋：待机时摸虫子的交互
  bug, pet, PET_TEXT, PET_RADIUS, updatePet, listeners, clsState,
  // 「选择器」指令的作用域
  scopedRoot };
`;
// rAF 必须真实驱动主循环：bugTravel() 的 Promise 由 frame() 内的 bugStep 推进，
// 空实现的 rAF 会让抓取流程永久挂起。
let frames = 0;
const raf = (cb) => setTimeout(() => { frames++; cb(performance.now()); }, 16);
const fn = new Function('window', 'document', 'performance', 'ResizeObserver',
                        'requestAnimationFrame', 'navigator', 'console', 'listeners', 'clsState',
                        script + '\n' + epilogue);
fn(win, doc, performance, class { observe() {} disconnect() {} }, raf, { userAgent: 'node' }, console,
   listeners, clsState);

const T = globalThis.__T;
let fails = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log('[ok] ' + msg);
  else { fails++; console.error('[FAIL] ' + msg + (extra !== undefined ? '  → ' + extra : '')); }
};

// ---- 2.5) DOM id 契约：$('#x') 与 getElementById('x') 必须都能在 HTML 里找到 ----
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const usedSel = new Set([...script.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
const usedGet = new Set([...script.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
const missingIds = [...new Set([...usedSel, ...usedGet])].filter(id => !htmlIds.has(id));
ok(missingIds.length === 0, 'JS 引用的 ' + (usedSel.size + usedGet.size) + ' 个静态 DOM id 全部存在' +
   (missingIds.length ? '  缺失: ' + missingIds.join(', ') : ''));
const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dupIds = allIds.filter((v, i) => allIds.indexOf(v) !== i);
ok(dupIds.length === 0, 'HTML id 无重复' + (dupIds.length ? '  重复: ' + [...new Set(dupIds)].join(', ') : ''));

// ---- 2.6) HTML 标签配对 ----
// 少一个 '<' 的后果很隐蔽：'</span>' 会作为字面文本渲染到界面上（曾经真的发生过 9 处）。
{
  let masked = html.replace(/<script>[\s\S]*?<\/script>/g, m => '<script>' + ' '.repeat(m.length - 17) + '</script>');
  masked = masked.replace(/<style>[\s\S]*?<\/style>/g, m => '<style>' + ' '.repeat(m.length - 15) + '</style>');
  masked = masked.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const stk = [], bad = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let tm;
  while ((tm = tagRe.exec(masked))) {
    const closing = tm[1], name = tm[2].toLowerCase();
    if (VOID.has(name) || tm[4] === '/') continue;
    if (!closing) { stk.push(name); continue; }
    const at = stk.lastIndexOf(name);
    if (at < 0) bad.push('多余的 </' + name + '>');
    else { if (at !== stk.length - 1) bad.push('<' + stk[stk.length - 1] + '> 未闭合'); stk.length = at; }
  }
  for (const s of stk) bad.push('<' + s + '> 未闭合');
  ok(bad.length === 0, 'HTML 标签全部配对' + (bad.length ? '  问题: ' + bad.slice(0, 5).join('; ') : ''));
}

// ---- 2.7) 不该出现在界面上的字面量 ----
// 闭合标签如果丢了 '<'，就会变成可见文本。单独断言一次，报错信息更直白。
{
  const leaks = [...html.matchAll(/\s\/[a-zA-Z][a-zA-Z0-9]*>/g)].map(m => m[0].trim());
  ok(leaks.length === 0, '没有裸的 "/标签>" 字面量泄漏到界面' +
     (leaks.length ? '  发现: ' + [...new Set(leaks)].slice(0, 5).join(' ') : ''));
}

// ---- 2.8) 文档里引用的本地文件都存在 ----
// 首图路径写错的话，GitHub 首页就是一个裂图，但本地看不出来 —— 所以必须机器校验。
{
  const dead = [];
  let n = 0;
  for (const md of ['README.md', 'docs/README.md', '测试指南.md']) {
    if (!fs.existsSync(md)) continue;
    const src = fs.readFileSync(md, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    const refs = new Set();
    for (const m of src.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) refs.add(m[1]);
    for (const m of src.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) refs.add(m[1]);
    for (const r of refs) {
      if (/^([a-z]+:|\/\/|#)/i.test(r)) continue;
      const clean = r.split('#')[0];
      if (!clean) continue;
      n++;
      if (!fs.existsSync(path.resolve(path.dirname(md), clean))) dead.push(md + ' → ' + r);
    }
  }
  ok(dead.length === 0, '文档里 ' + n + ' 个本地引用全部存在' +
     (dead.length ? '  失效: ' + dead.slice(0, 5).join('; ') : ''));
}

// ---- 3) 提示词解析 ----
const p = T.parsePrompt(T.DEMO_PROMPTS[0]);
ok(p.terms.length >= 8, 'parsePrompt 抽出分支数 = ' + p.terms.length);
ok(p.cfg.maxPages === 36, 'cfg.maxPages 指令解析 = ' + p.cfg.maxPages);
ok(p.cfg.maxDepth === 3, 'cfg.maxDepth 指令解析 = ' + p.cfg.maxDepth);
ok(p.cfg.seeds.some(s => s.includes('example-quantum.io')), 'cfg.seeds 解析 = ' + p.cfg.seeds.join(','));
ok(Math.abs(p.cfg.minConf - 0.45) < 1e-9, 'cfg.minConf 解析 = ' + p.cfg.minConf);
ok(p.cfg.types.length === 3, 'cfg.types 解析 = ' + p.cfg.types.join('/'));
const p2 = T.parsePrompt(T.DEMO_PROMPTS[1]);
ok(p2.cfg.maxPages === 42 && p2.cfg.maxDepth === 4, '示例2 指令解析 = 42/' + p2.cfg.maxDepth);
ok(p2.terms.some(t => /HNSW/i.test(t.term)), '示例2 保留 ASCII 术语 HNSW');
ok(p.cfg.deny.length >= 4, '否定清单解析（过滤行）= [' + p.cfg.deny.join(',') + ']');
ok(!p.terms.some(t => p.cfg.deny.includes(t.term)), '否定词未混入正向采集目标');
ok(p.terms.length >= 8, '剔除指令词后仍保留 ' + p.terms.length + ' 个采集分支');

// ---- 4) 评分器单调性 ----
const terms = p.terms;
const deny = p.cfg.deny;
const hitText = terms.map(t => t.term).join(' ') + ' 相关内容重复 ' + terms.map(t => t.term).join(' ');
const missText = '广告 注册 登录 版权 导航 首页 联系我们 优惠 下载 免责声明 '.repeat(4);
const sHitAvg = (() => { let s = 0; for (let i = 0; i < 25; i++) s += T.scoreText(hitText, '量子计算 深度解析', terms, '文本', deny).score; return s / 25; })();
const sMissAvg = (() => { let s = 0; for (let i = 0; i < 25; i++) s += T.scoreText(missText, '首页', terms, '文本', deny).score; return s / 25; })();
ok(sHitAvg > 0.7, '全命中文本 25 次均值 = ' + sHitAvg.toFixed(3) + ' (> 0.70)');
ok(sMissAvg < 0.1, '无关文本 25 次均值 = ' + sMissAvg.toFixed(3) + ' (< 0.10)');
ok(sHitAvg > sMissAvg, '评分器单调性正确');
// 噪声带宽应保持在窄区间，避免模拟结果抖动过大
let lo = 1, hi = 0;
for (let i = 0; i < 300; i++) { const v = T.scoreText(hitText, '量子计算 深度解析', terms, '文本', deny).score; lo = Math.min(lo, v); hi = Math.max(hi, v); }
ok(hi - lo < 0.12, '同输入评分抖动带宽 = ' + (hi - lo).toFixed(3) + ' (< 0.12)');

// ---- 5) 力导向仿真数值稳定性 ----
T.S.nodes.length = 0; T.S.links.length = 0; T.S.byId.clear(); T.S.nextId = 1;
T.S.top = p.top; T.S.terms = terms; T.S.cfg = p.cfg;
T.buildHeat();
const rng = T.mulberry32(T.hashStr('stability'));
const created = [];
for (let i = 0; i < 42; i++) {
  const n = T.addNode({ depth: i % 4, url: 'u' + i, title: 'T' + i, visited: true, r: rng() });
  created.push(n);
}
for (let i = 1; i < created.length; i++) {
  T.addLink(created[(rng() * i) | 0], created[i], rng());
}
for (let k = 0; k < 900; k++) T.stepSim(1 / 60);
let finite = true, inside = true, maxV = 0;
for (const n of created) {
  if (!isFinite(n.x) || !isFinite(n.y) || !isFinite(n.vx) || !isFinite(n.vy)) finite = false;
  if (n.x < 0 || n.y < 0 || n.x > T.net.w || n.y > T.net.h) inside = false;
  maxV = Math.max(maxV, Math.abs(n.vx), Math.abs(n.vy));
}
ok(finite, '900 帧后坐标/速度全部有限（无 NaN/Infinity）');
ok(inside, '900 帧后节点全部落在画布内');
ok(maxV < 60, '速度未发散  max|v| = ' + maxV.toFixed(2));
// 分层半径：深度越大平均离中心越远
const cx = T.net.w / 2, cy = T.net.h / 2;
const byD = {};
for (const n of created) (byD[n.depth] = byD[n.depth] || []).push(Math.hypot(n.x - cx, n.y - cy));
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const r0 = avg(byD[0]), r3 = avg(byD[3]);
ok(r3 > r0, '分层环状布局成立  d0=' + r0.toFixed(1) + 'px < d3=' + r3.toFixed(1) + 'px');

// ---- 6) 热力图矩阵 ----
T.S.top = p.top.slice(0, 10);
T.buildHeat();
for (let i = 0; i < 60; i++) {
  const hm = {}; for (const t of T.S.top) hm[t.term] = Math.random();
  T.pushHeat(hm);
}
ok(T.S.heatRows === 9, '热力图行数 = ' + T.S.heatRows);
ok(T.S.heatCols === 34, '热力图列数封顶 = ' + T.S.heatCols);
ok(T.S.heat.length === T.S.heatRows, '热力图行主序结构正确');
let heatBad = 0, heatWidths = new Set();
for (const row of T.S.heat) {
  heatWidths.add(row.length);
  for (const v of row) if (!isFinite(v) || v < 0 || v > 1) heatBad++;
}
ok(heatBad === 0, '热力图全部数值落在 [0,1]');
ok(heatWidths.size === 1, '热力图各行等宽 = ' + [...heatWidths].join(','));

// ---- 7) 合成页面 + 目标相关度标定 ----
T.S.terms = terms;
let synthBad = 0;
for (let i = 0; i < 200; i++) {
  const pg = T.synthPage(rng, i % 4, rng(), p.cfg);
  if (!pg.url || !pg.title || !pg.text || !pg.bytes) synthBad++;
  if (T.TYPES.indexOf(pg.type) < 0) synthBad++;
  if (pg.text.length < 1400) synthBad++;
}
ok(synthBad === 0, '200 次 synthPage 生成结构完整（url/title/text/type/bytes + 正文达标）');
// 意图相关度 target 应与真实评分吻合（否则优先级调度排的是一个无意义的数）
let calBad = [];
for (const target of [0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) {
  let acc = 0;
  for (let i = 0; i < 40; i++) {
    const pg = T.synthPage(T.mulberry32(i * 7919 + 13), 1, target, p.cfg);
    acc += T.scoreText(pg.text, pg.title, terms, pg.type, deny).score;
  }
  const got = acc / 40;
  if (Math.abs(got - target) > 0.15) calBad.push('target=' + target + '→' + got.toFixed(2));
}
ok(calBad.length === 0, '目标相关度标定误差 < 0.15' + (calBad.length ? ' 偏差: ' + calBad.join(', ') : ''));

// ---- 8) 渲染管线烟测（桩件 ctx 下不应抛错） ----
try {
  T.bugInit();
  T.spawnPackets(created[0], 6, 0.8);
  for (let i = 0; i < 30; i++) { T.bugStep(1 / 60); T.stepPackets(1 / 60); }
  T.drawNetwork(); T.drawHeat(1.5); T.drawSphere(1 / 60); T.drawConf(1.5);
  T.drawPackets({ save(){}, restore(){}, fillText(){}, set font(v){}, set globalAlpha(v){},
                  set shadowColor(v){}, set shadowBlur(v){}, set fillStyle(v){}, set textAlign(v){},
                  set textBaseline(v){} });
  console.log('[ok] 渲染管线（网络/热力/球体/折线/数码虫/数据包）无异常');
} catch (e) { fails++; console.error('[FAIL] 渲染管线抛错: ' + e.stack); }

try { T.slowTick(); console.log('[ok] slowTick DOM 更新无异常'); }
catch (e) { fails++; console.error('[FAIL] slowTick 抛错: ' + e.stack); }

// ---- 9) 相关度色标单调 ----
const cols = [0, 0.25, 0.5, 0.75, 1].map(v => T.relColor(v));
ok(new Set(cols).size === 5, '相关度色标 5 档各不相同 → ' + cols.join(' '));
ok(T.relColor(1) === 'rgb(0,255,198)', '1.00 → 青绿 ' + T.relColor(1));
ok(T.relColor(0) === 'rgb(255,46,91)', '0.00 → 红 ' + T.relColor(0));

// ---- 10) verdict 分档 ----
ok(T.verdictOf(0.9)[1] === 'HARVEST' && T.verdictOf(0.05)[1] === 'REJECT', '判定分档正确');

// ---- 11) 真实抓取的解析链路（离线，不联网） ----
ok(T.looksHtml('<!DOCTYPE html><html><body><div>x</div></body></html>'), 'looksHtml 识别 HTML');
ok(!T.looksHtml('# Title\n\nsome markdown text'), 'looksHtml 不误判 markdown');
const md = T.parseAny('# 向量索引调研\n\n[原始论文](https://example.com/paper)\n详见 https://example.com/bench 与 https://example.com/paper\n', 'https://example.com/');
ok(md.title === '向量索引调研', 'parseAny markdown 标题 = ' + JSON.stringify(md.title));
ok(md.links.length === 2, 'parseAny markdown 抽链去重 = ' + md.links.length + ' 条 → ' + md.links.map(l => l.url).join(' '));
ok(md.text.length > 5, 'parseAny markdown 正文非空');
ok(T.detectType('function foo(){ const x = 1; return x; } class A { void m(){} } import a from "b";', '') === '代码', 'detectType 识别代码');
ok(T.detectType('占比 12.5% 增长 3.4 倍 均值 0.882 样本 1200 方差 0.31 区间 1.2-9.8', '') === '数据', 'detectType 识别数据');
ok(T.detectType('这是一段普通的叙述性文本，描述了一些背景与脉络。', '') === '文本', 'detectType 识别文本');
ok(T.RELAYS.allorigins('https://a.io/p').indexOf('https%3A%2F%2Fa.io%2Fp') > 0, '中继 URL 正确编码');
ok(T.hostOf('https://a.io/x/y') === 'a.io', 'hostOf 解析主机');

// ---- 11.5) 「选择器」指令：把正文/链接的取用范围收窄到指定子树 ----
{
  const body = { tag:'body' }, main = { tag:'main' }, html = { tag:'html' };
  const doc = { body, documentElement: html, querySelector: s => (s === '.main' ? main : null) };
  const oldCfg = T.S.cfg;

  T.S.cfg = { selector: '' };
  ok(T.scopedRoot(doc, doc.body) === body, '未写「选择器」时取全文（不改变原有行为）');

  T.S.cfg = { selector: '.main' };
  ok(T.scopedRoot(doc, doc.body) === main, '「选择器」命中时收窄到该子树');

  T.S.cfg = { selector: '  .main  ' };
  ok(T.scopedRoot(doc, doc.body) === main, '「选择器」容忍首尾空格');

  T.S.cfg = { selector: '.nope' };
  const before = T.S.logs.length;
  ok(T.scopedRoot(doc, doc.body) === body, '「选择器」无匹配时回退全文');
  ok(T.S.logs.length > before &&
     /选择器无匹配/.test(JSON.stringify(T.S.logs[T.S.logs.length - 1])),
     '「选择器」无匹配时记录一次告警（避免静默什么都提不到）');
  const mid = T.S.logs.length;
  T.scopedRoot(doc, doc.body);
  ok(T.S.logs.length === mid, '同一轮内告警只记一次（不刷屏）');

  const badDoc = { body, documentElement: html, querySelector: () => { throw new Error('bad selector'); } };
  T.S.cfg = { selector: ':::bad' };
  ok(T.scopedRoot(badDoc, badDoc.body) === body, '「选择器」语法非法时回退全文而不抛错');

  T.S.cfg = oldCfg;
}

// ---- 12) 端到端：模拟模式完整抓取 ----
const E2E = `# 端到端测试
抓取 "量子计算" 商业化 落地 金融 制药
过滤 广告 导航 版权
站点 https://example-quantum.io
深度 3
上限 10
类型 文本,数据,代码
置信度 >= 0.40
延迟 0`;
T.setPromptText(E2E);
T.S.mode = 'sim';
const t0 = Date.now();
await T.runCrawl();
const dur = Date.now() - t0;
T.slowTick();

ok(T.S.visited >= 8, '端到端抓取页数 = ' + T.S.visited + ' (上限 10)');
ok(T.S.nodes.length >= T.S.visited, '图节点数 = ' + T.S.nodes.length);
ok(T.S.links.length >= T.S.visited - 1, '图边数 = ' + T.S.links.length + '（蛛网已连通）');
ok(T.S.scores.length === T.S.visited, '评分数与抓取数一致 = ' + T.S.scores.length);
ok(T.S.confSeries.length === T.S.visited, '置信度序列长度 = ' + T.S.confSeries.length);
ok(T.S.extracts.length > 0, '抽取内容条数 = ' + T.S.extracts.length);
ok(T.S.rejected > 0, '拒绝分支也被触发（红/降级路径可见）= ' + T.S.rejected);
ok(T.S.rejected / T.S.visited > 0.05 && T.S.rejected / T.S.visited < 0.85,
   '拒绝率处于可视区间 = ' + (T.S.rejected / T.S.visited * 100).toFixed(0) + '%');
const scoreSpread = Math.max(...T.S.scores) - Math.min(...T.S.scores);
ok(scoreSpread > 0.35, '相关度色阶跨度 = ' + scoreSpread.toFixed(3) + '（着色不致退化为单色）');
ok(T.S.logs.length >= T.S.visited, '决策日志条数 = ' + T.S.logs.length);
ok(T.S.bytes > 0, '累计字节 = ' + T.S.bytes);
ok(T.S.phase === 'DONE', '会话终态 = ' + T.S.phase);
ok(T.S.running === false, '抓取结束后 running 归位');
ok(T.S.discovered <= 10 * 2, '发现节点数受上限约束 = ' + T.S.discovered);
let e2eBad = 0, relBad = 0, nodeBad = 0;
for (const n of T.S.nodes) {
  if (!isFinite(n.x) || !isFinite(n.y)) e2eBad++;
  if (n.visited && (n.r < 0 || n.r > 1 || !isFinite(n.r))) relBad++;
}
for (const v of T.S.scores) if (!isFinite(v) || v < 0 || v > 1) nodeBad++;
ok(e2eBad === 0, '端到端后全部节点坐标有限（力导向未爆）');
ok(relBad === 0, '全部已访问节点相关度落在 [0,1]');
ok(nodeBad === 0, '全部评分落在 [0,1]');
ok(T.S.heatCols > 20, '热力图随抓取生长 = ' + T.S.heatCols + ' 列');
const visCount = T.S.nodes.filter(n => n.visited).length;
ok(visCount >= T.S.visited, '已访问标记节点数 = ' + visCount);
console.log('[info] 端到端耗时 ' + dur + 'ms，' + T.S.visited + ' 页 / ' + T.S.links.length + ' 边 / ' +
            T.S.extracts.length + ' 条抽取 / 平均相关度 ' +
            (T.S.scores.reduce((a, b) => a + b, 0) / T.S.scores.length).toFixed(3));

// ---- 13) 导出：三种格式的结构与转义 ----
const snap = T.exportSnapshot();
ok(snap.pages.length > 0, '导出快照页面数 = ' + snap.pages.length);
ok(snap.summary.pagesCrawled === T.S.visited, '快照页数与抓取数一致');
ok(snap.summary.pagesKept + snap.summary.pagesRejected >= snap.pages.length - 1,
   '保留+拒绝覆盖已抓页面 = ' + snap.summary.pagesKept + '+' + snap.summary.pagesRejected);
ok(snap.pages.every((p, i, a) => i === 0 || a[i-1].relevance >= p.relevance), '导出页面按相关度降序');
ok(snap.branches.length > 0 && snap.branches[0].occurrences >= snap.branches[snap.branches.length-1].occurrences,
   '分支按出现次数降序 = ' + snap.branches.length + ' 个');
ok(snap.decisions.length >= T.S.visited, '决策记录全量保留 = ' + snap.decisions.length + ' 条（渲染列表仅 90）');
ok(snap.confidenceSeries.length === T.S.visited, '置信度序列随快照导出');
ok(typeof snap.summary.avgRelevance === 'number' && snap.summary.avgRelevance > 0, '汇总平均相关度 = ' + snap.summary.avgRelevance);
ok(snap.summary.nodesArchived >= 0, '归档计数存在 = ' + snap.summary.nodesArchived);

const csv = T.toCSV(snap);
ok(csv.charCodeAt(0) === 0xFEFF, 'CSV 带 UTF-8 BOM（Excel 中文不乱码）');
const csvLines = csv.slice(1).trim().split('\r\n');
ok(csvLines[0].startsWith('url,title,type,relevance'), 'CSV 表头正确');
ok(csvLines.length === snap.pages.length + 1, 'CSV 行数 = 表头 + ' + snap.pages.length + ' 页');
// 转义：含逗号 / 引号 / 换行的字段必须被正确包裹
const tricky = T.toCSV({ pages: [{ url:'u', title:'a,b', type:'文本', relevance:1, verdict:'KEEP',
                                   depth:1, bytes:1, branches:['x"y'], snippet:'line1\nline2' }] });
ok(tricky.indexOf('"a,b"') > 0, 'CSV 逗号字段被引号包裹');
ok(tricky.indexOf('"x""y"') > 0, 'CSV 内部引号被双写转义');
ok(tricky.indexOf('"line1\nline2"') > 0, 'CSV 换行字段被引号包裹');

const mdRep = T.toMarkdown(snap);
ok(mdRep.startsWith('# DOC-FORAGER 相关度分析报告'), 'Markdown 标题正确');
ok(mdRep.indexOf('## 汇总') > 0 && mdRep.indexOf('## 提示词') > 0, 'Markdown 含汇总与提示词章节');
ok(mdRep.indexOf('## 抓取结果') > 0 && mdRep.indexOf('## 提示词分支命中') > 0, 'Markdown 含结果与分支章节');
ok(mdRep.indexOf(snap.config.seed) > 0, 'Markdown 含起始站点');
ok(mdRep.split('\n').length > 30, 'Markdown 报告行数 = ' + mdRep.split('\n').length);
ok(T.toMarkdown({ ...snap, pages: [], decisions: [], confidenceSeries: [], branches: [] }).indexOf('没有产生可导出') > 0,
   'Markdown 处理空结果不报错');

// ---- 14) 内存回收：超限图必须被压回软上限，且不留下悬空边 ----
T.S.nodes.length = 0; T.S.links.length = 0; T.S.byId.clear(); T.S.frontier.length = 0;
T.S.nextId = 1; T.S.archived = 0; T.S.terms = terms; T.S.top = p.top; T.S.cfg = p.cfg;
const gcRoot = T.addNode({ depth:0, visited:true, r:1, title:'SEED' });
for (let i = 0; i < 165; i++) {
  const n = T.addNode({ depth: 1 + (i % 3), parent: gcRoot.id, visited: true,
                        r: (i % 7) / 7, dead: (i % 3) === 0, title: 'N' + i });
  T.addLink(gcRoot, n, 0.5);
}
for (let i = 0; i < 60; i++) {
  const f = T.addNode({ depth:1, parent: gcRoot.id, visited:false, r:0 });
  f.prio = Math.random(); T.S.frontier.push(f);
}
let linksBefore = T.S.links.length;
ok(T.S.nodes.length > T.MEM.NODE_HARD, '构造超限图 = ' + T.S.nodes.length + ' 节点 / ' + linksBefore + ' 边');
const didPrune = T.pruneGraph(true);
ok(didPrune === true, 'pruneGraph 报告发生了回收');
ok(T.S.nodes.length <= T.MEM.NODE_SOFT + 2, '节点被压回软上限 = ' + T.S.nodes.length + ' ≤ ' + (T.MEM.NODE_SOFT + 2));
ok(T.S.frontier.length <= T.MEM.FRONTIER_MAX, '前沿被裁剪到上限 = ' + T.S.frontier.length + ' ≤ ' + T.MEM.FRONTIER_MAX);
ok(T.S.archived > 0, '归档计数 = ' + T.S.archived);
const idSet = new Set(T.S.nodes.map(n => n.id));
ok(T.S.links.every(l => idSet.has(l.a.id) && idSet.has(l.b.id)), '回收后没有指向已移除节点的悬空边');
ok(T.S.links.length < linksBefore, '边数随节点回收一起下降 ' + linksBefore + ' → ' + T.S.links.length);
ok(T.S.byId.size === T.S.nodes.length, 'byId 索引与节点数组同步 = ' + T.S.byId.size);
// 回收后仍能安全渲染
try {
  T.stepSim(1 / 60); T.drawNetwork(); T.drawHeat(1); T.drawConf(1); T.drawSphere(1 / 60);
  console.log('[ok] 回收后渲染管线仍然安全');
} catch (e) { fails++; console.error('[FAIL] 回收后渲染抛错: ' + e.stack); }

// ---- 15) 渲染开销不随规模增长（锁定 shadowBlur / 渐变分配不再逐元素发生） ----
// JS 是单线程：同步紧循环期间 rAF 回调不可能插入，所以这里的增量是精确的。
function measureDraw(n) {
  T.S.nodes.length = 0; T.S.links.length = 0; T.S.byId.clear();
  T.S.nextId = 1; T.S.frontier.length = 0; T.packets.length = 0;
  const r = T.addNode({ depth:0, visited:true, r:1, title:'SEED', rr:13 });
  for (let i = 1; i < n; i++) {
    const nd = T.addNode({ depth:1+(i%3), parent:r.id, visited:true, r:(i%10)/10, title:'T'+i, rr:8 });
    T.addLink(r, nd, 0.6);
  }
  T.drawNetwork();                                   // 预热：让环底纹等离屏缓存就位
  const b = { grad:ops.grad, shadow:ops.shadow, stroke:ops.stroke, fill:ops.fill, img:ops.img };
  for (let k = 0; k < 10; k++) T.drawNetwork();
  return {
    grad:  (ops.grad   - b.grad)   / 10,
    shadow:(ops.shadow - b.shadow) / 10,
    stroke:(ops.stroke - b.stroke) / 10,
    fill:  (ops.fill   - b.fill)   / 10,
    img:   (ops.img    - b.img)    / 10,
  };
}
const m20  = measureDraw(20);
const m200 = measureDraw(200);
ok(m20.grad <= 1.5 && m200.grad <= 1.5,
   '每帧渐变分配 O(1)，与节点数无关 = ' + m20.grad.toFixed(1) + ' / ' + m200.grad.toFixed(1) +
   '（修复前为 O(n)：20→20，200→200）');
ok(m200.shadow <= m20.shadow + 3,
   'shadowBlur 调用数与节点数无关 = ' + m20.shadow.toFixed(1) + ' / ' + m200.shadow.toFixed(1) +
   '（修复前为 O(n)：20→约 60，200→约 600）');
ok(m200.img > m20.img, '辉光改走预渲染贴图 drawImage，随节点线性但极廉价 = ' +
   m20.img.toFixed(0) + ' / ' + m200.img.toFixed(0));
console.log('[info] 每帧绘制调用  20节点: ' + JSON.stringify(m20) + '  200节点: ' + JSON.stringify(m200));

// ---- 16) 自适应画质：高帧时应降级，低帧时应恢复 ----
const q0 = T.Q.level;
for (let i = 0; i < 400; i++) T.trackFrame(45);       // 持续 45ms 帧时
ok(T.Q.level < q0, '持续掉帧时画质自动降级 ' + q0 + ' → ' + T.Q.level);
for (let i = 0; i < 600; i++) T.trackFrame(6);        // 恢复到 6ms
ok(T.Q.level === 2, '帧时恢复后画质回到最高档 = ' + T.Q.level);
ok(T.Q.ft > 0 && T.Q.ft < 100, '平滑帧时数值合理 = ' + T.Q.ft.toFixed(2) + 'ms');

// ---- 16) 中止路径 ----
T.setPromptText(E2E.replace('上限 10', '上限 60'));
const pending = T.runCrawl();
await new Promise(r => setTimeout(r, 900));
ok(T.S.running === true, '中止前引擎处于运行态');
T.abort();
await pending;
ok(T.S.running === false, '中止后引擎停止');
ok(T.S.visited < 60, '中止生效，未跑满 60 页 = ' + T.S.visited);
ok(T.S.phase === 'STOPPED' || T.S.phase === 'DONE', '中止终态 = ' + T.S.phase);
ok(T.S.nodes.length <= T.MEM.NODE_SOFT + 2, '收尾强制回收把图压回上限 = ' + T.S.nodes.length);

// ---- 17) 主循环长跑稳定性 ----
const framesBefore = frames;
await new Promise(r => setTimeout(r, 1200));
const ranFrames = frames - framesBefore;
ok(ranFrames > 20, 'rAF 主循环持续推进 = ' + ranFrames + ' 帧 / 1.2s');
let loopBad = 0;
for (const n of T.S.nodes) if (!isFinite(n.x) || !isFinite(n.y)) loopBad++;
ok(loopBad === 0, '长跑后节点坐标仍全部有限');
console.log('[info] 累计渲染帧 ' + frames + '，终止时图规模 ' + T.S.nodes.length + ' 节点 / ' + T.S.links.length + ' 边');

// ============================================================================
//  本地文档模式
// ============================================================================
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// 最小 DOM 形状固定装置：只实现解析代码真正用到的那几个成员
function E(local, ns, attrs, kids) {
  const n = {
    nodeType: 1, localName: local, namespaceURI: ns || W,
    childNodes: kids || [],
    getAttributeNS: (u, k) => (attrs && attrs[k] !== undefined) ? attrs[k] : null,
    getAttribute: k => {
      const kk = String(k).replace(/^w:/, '');
      return (attrs && attrs[kk] !== undefined) ? attrs[kk] : null;
    },
  };
  n.textContent = (kids || []).map(k => k.nodeType === 3 ? k.nodeValue : (k.textContent || '')).join('');
  return n;
}
const Tx = s => ({ nodeType: 3, nodeValue: s });

// ---- 17.5) ZIP 容器层：用真实 deflate 数据往返（不是打桩） ----
let CRC_T = null;
function crc32(buf){
  if(!CRC_T){
    CRC_T = new Int32Array(256);
    for(let n=0;n<256;n++){
      let c = n;
      for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_T[n] = c;
    }
  }
  let c = -1;
  for(let i=0;i<buf.length;i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function buildZip(entries){
  const parts = [], central = [];
  let offset = 0;
  for(const e of entries){
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data, 'utf8');
    const comp = e.store ? raw : zlib.deflateRawSync(raw);
    const method = e.store ? 0 : 8;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  const all = Buffer.concat([...parts, cd, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}
const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="' + T.W_NS + '"><w:body>'
  + '<w:p><w:r><w:t>财务 营收 毛利率</w:t></w:r></w:p>'
  + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  + '</w:body></w:document>';
const zipBuf = buildZip([
  { name:'[Content_Types].xml', data:'<Types/>' },
  { name:'word/document.xml',   data:docXml },
  { name:'word/styles.xml',     data:'<w:styles/>', store:true },
  { name:'docProps/app.xml',    data:'<props/>' },
]);
const zEntries = await T.unzip(zipBuf, n => n === 'word/document.xml' || n === 'word/styles.xml');
ok(zEntries.size === 2, 'unzip 只解出被请求的条目 = ' + zEntries.size);
ok(new TextDecoder().decode(zEntries.get('word/document.xml')) === docXml,
   'deflate(method 8) 经 DecompressionStream 往返一致（' + docXml.length + ' 字符）');
ok(new TextDecoder().decode(zEntries.get('word/styles.xml')) === '<w:styles/>',
   'store(method 0) 条目直接切片正确');
ok(zEntries.get('word/document.xml').length > 200,
   'UTF-8 中文按字节返回，长度正确 = ' + zEntries.get('word/document.xml').length + ' 字节');
try {
  await T.unzip(new TextEncoder().encode('this is definitely not a zip file at all').buffer, () => true);
  fails++; console.error('[FAIL] 非 ZIP 输入应当抛错');
} catch(e){ ok(/找不到中央目录/.test(e.message), '非 ZIP 输入抛出明确错误：' + e.message); }

// ---- 18) WordprocessingML 遍历：w:t / tab / br / 修订删除 / 标题级别 ----
const pHead = E('p', W, {}, [ E('pPr', W, {}, [ E('pStyle', W, { val: 'Heading2' }) ]),
                              E('r', W, {}, [ Tx('标题') ]) ]);
ok(T.pMeta(pHead).level === 2, 'pStyle=Heading2 → 标题级别 2');
ok(T.wText(pHead) === '标题', 'wText 正确收集 w:t = ' + JSON.stringify(T.wText(pHead)));
const pMix = E('p', W, {}, [ E('r', W, {}, [ Tx('a'), E('tab', W), Tx('b'), E('br', W), Tx('c') ]) ]);
ok(T.wText(pMix) === 'a\tb\nc', 'wText 处理 w:tab / w:br → ' + JSON.stringify(T.wText(pMix)));
const pDel = E('p', W, {}, [ E('del', W, {}, [ E('delText', W, {}, [ Tx('删掉的') ]) ]),
                             E('r', W, {}, [ Tx('留下的') ]) ]);
ok(T.wText(pDel) === '留下的', 'wText 跳过修订删除内容（w:delText）→ ' + JSON.stringify(T.wText(pDel)));
const pIns = E('p', W, {}, [ E('r', W, {}, [ E('instrText', W, {}, [ Tx('PAGE') ]), Tx('正文') ]) ]);
ok(T.wText(pIns) === '正文', 'wText 跳过域代码 w:instrText');

// ---- 19) 表格合并还原（gridSpan 横向 / vMerge 纵向） ----
const tc = (text, span, vMerge) => E('tc', W, {}, [
  E('tcPr', W, {}, [
    ...(span ? [ E('gridSpan', W, { val: String(span) }) ] : []),
    ...(vMerge ? [ E('vMerge', W, vMerge === 'restart' ? { val: 'restart' } : {}) ] : []),
  ]),
  E('p', W, {}, [ E('r', W, {}, [ Tx(text) ]) ]),
]);
const mkTbl = E('tbl', W, {}, [
  E('tr', W, {}, [ tc('A', 2), tc('B') ]),            // A 横跨 2 列
  E('tr', W, {}, [ tc('C', 0, 'restart'), tc('D') ]), // C 纵向起头
  E('tr', W, {}, [ tc('', 0, 'continue'), tc('E') ]), // 纵向延续（无文本）
]);
const bt = T.parseWTable(mkTbl, null).table;
ok(bt.rows === 3 && bt.cols === 3, '表格尺寸还原 = ' + bt.rows + '×' + bt.cols);
ok(JSON.stringify(bt.grid) === JSON.stringify([['A','A','B'],['C','D',''],['C','E','']]),
   '合并区域在网格里被完整铺开 = ' + JSON.stringify(bt.grid));
const spanCell = bt.cells.filter(c => c.span === 2)[0];
const rowCell  = bt.cells.filter(c => c.rowspan === 2)[0];
ok(!!spanCell && spanCell.row === 0 && spanCell.col === 0, '找到 colspan=2 的单元格');
ok(!!rowCell && rowCell.row === 1 && rowCell.col === 0 && rowCell.text === 'C', '找到 rowspan=2 的单元格（值取自起头格）');
ok(bt.cells.length === 5, '渲染用单元格数 = ' + bt.cells.length + '（3 行共 6 格，被纵向覆盖 1 格）');
const tvHtml = T.renderTableHTML(bt);
ok(tvHtml.indexOf('colspan="2"') > 0 && tvHtml.indexOf('rowspan="2"') > 0, 'HTML 渲染带 colspan/rowspan');

// ---- 20) Markdown 解析 → 统一块模型 ----
const mdSrc = [
  '# 财务报告', '',
  '这是一段正文，包含 财务 与 营收 两个关键词。', '',
  '## 明细', '',
  '| 项目 | 2023 | 2024 |',
  '| --- | ---: | ---: |',
  '| 营收 | 100 | 120 |',
  '| 毛利率 | 30% | 32% |', '',
  '普通段落二。', '',
].join('\n');
const mdBlocks = T.parseMarkdown(mdSrc);
const mdoc = T.finalizeDoc('测试.md', 'md', mdBlocks, mdSrc.length);
ok(mdoc.headings.length === 2, 'Markdown 标题数 = ' + mdoc.headings.length);
ok(mdoc.tables.length === 1, 'Markdown 表格数 = ' + mdoc.tables.length);
ok(mdoc.tables[0].rows === 3 && mdoc.tables[0].cols === 3, 'Markdown 表格尺寸 = ' + mdoc.tables[0].rows + '×' + mdoc.tables[0].cols);
ok(mdoc.tables[0].grid[1][0] === '营收' && mdoc.tables[0].grid[1][2] === '120', 'Markdown 表格内容正确');
ok(mdoc.tables[0].section === '明细', '表格归属到最近的上级标题 = ' + mdoc.tables[0].section);
ok(mdoc.tables[0].index === 1, '表格编号从 1 开始');
const financeBlock = mdoc.blocks.filter(b => b.type === 'p' && b.text.indexOf('财务') >= 0)[0];
ok(!!financeBlock && financeBlock.section === '财务报告', '段落归属章节 = ' + (financeBlock && financeBlock.section));
ok(T.parsePlain('段落一。\n\n段落二。\n\n\n段落三。').length === 3, '纯文本按空行切段');
const screenDoc = T.screenDocumentFromResult({
  virtualScreen:{ x:-1920, y:0, width:3840, height:1080 },
  blocks:[
    { text:'财务 营收', x:-1880, y:120, width:180, height:24 },
    { text:'不含关键词的屏幕文字也应完整保留', x:40, y:220, width:240, height:24 }
  ]
});
ok(screenDoc.kind === 'screen' && screenDoc.blocks.length === 2,
   '整屏 OCR 的所有文字行进入标准文档块模型');
ok(screenDoc.blocks[0].screenRect.x === -1880 && screenDoc.virtualScreen.x === -1920,
   '整屏文档保留多显示器负坐标与命中框');
let badScreenRejected = false;
try{
  T.screenDocumentFromResult({
    virtualScreen:{ x:0, y:0, width:100, height:100 },
    blocks:[{ text:'越界', x:99, y:10, width:20, height:12 }]
  });
}catch(e){ badScreenRejected = /超出虚拟桌面范围/.test(e.message); }
ok(badScreenRejected, '整屏 OCR 拒绝超出虚拟桌面边界的坐标');
try { await T.parseLocalFile('旧文档.doc', new ArrayBuffer(8)); fails++; console.error('[FAIL] .doc 应当被拒绝'); }
catch (e) { ok(/不支持 \.doc/.test(e.message), '.doc 被明确拒绝：' + e.message.slice(0, 40)); }
try { await T.parseLocalFile('x.rtf', new ArrayBuffer(8)); fails++; console.error('[FAIL] 未知扩展名应当被拒绝'); }
catch (e) { ok(/不支持的文件类型/.test(e.message), '未知扩展名被拒绝'); }

// ---- 21) 关键词定位工具 ----
const kt = T.parsePrompt('财务 营收').terms;
ok(T.occurrencesIn('财务与财务', '财务', 10).length === 2, 'occurrencesIn 统计全部出现位置');
const hs = T.highlightSnippet('前面一些文字，这里出现财务这个词，后面还有营收。', kt, 4);
ok(hs.indexOf('<mark>财务</mark>') > 0 && hs.indexOf('<mark>营收</mark>') > 0, 'highlightSnippet 标出全部关键词');
ok(T.highlightSnippet('<img src=x onerror=alert(1)>财务', kt, 40).indexOf('&lt;img') >= 0,
   'highlightSnippet 转义 HTML，不会注入');
ok(T.highlightSnippet('<img src=x onerror=alert(1)>财务', kt, 40).indexOf('<img') < 0,
   'highlightSnippet 输出里不存在未转义的标签');
const th = T.tableHits(mdoc.tables[0], kt);
ok(th.length === 1 && th[0].term === '营收' && th[0].cells === 1,
   'tableHits 逐格统计（表内只有"营收"）= ' + th.map(h => h.term + '×' + h.cells).join(' '));
const thBoth = T.tableHits({ grid: [['财务','营收'],['毛利率','财务']] }, kt);
ok(thBoth.length === 2 && thBoth[0].cells >= 1, 'tableHits 多词统计 = ' + thBoth.map(h => h.term + '×' + h.cells).join(' '));
ok(thBoth[0].term === '财务' && thBoth[0].cells === 2, 'tableHits 按出现格数降序，且计数正确');

// ---- 22) 本地文档扫描端到端 ----
T.S.mode = 'file';
T.S.file = mdoc;
T.setPromptText('# 关键词\n财务 营收 毛利率\n过滤 广告\n上限 4');
const f0 = Date.now();
await T.runFileScan();
const fMs = Date.now() - f0;
ok(T.S.phase === 'DONE', '扫描终态 = ' + T.S.phase);
ok(T.S.scannedBlocks > 0, '已扫描内容块 = ' + T.S.scannedBlocks);
ok(T.S.matches.length > 0, '关键词命中数 = ' + T.S.matches.length);
ok(T.S.tables.length === 1, '表格被完整提取 = ' + T.S.tables.length);
ok(T.S.extracts.length > 0, '抽取列表条目 = ' + T.S.extracts.length);
ok(T.S.nodes.some(n => n.depth === 1), '图里有关键词分支节点');
ok(T.S.nodes.some(n => n.depth === 2), '图里有命中位置节点');
ok(T.S.scoreN === T.S.nodes.filter(n => n.depth >= 2).length,
   '评分聚合与动画节点数一致 = ' + T.S.scoreN);
const fScores = T.S.nodes.filter(n => n.depth >= 2).map(n => n.r);
ok(fScores.every(v => v >= 0 && v <= 1), '文档命中的相关度全部落在 [0,1]');
ok(T.S.confSeries.length === fScores.length, '置信度序列长度 = ' + T.S.confSeries.length);
console.log('[info] 文档扫描 ' + fMs + 'ms，' + T.S.scannedBlocks + ' 块 / ' +
            T.S.matches.length + ' 命中 / ' + T.S.tables.length + ' 表');

// ---- 23) 确定性：同一文档 + 同一关键词必须给出同一结果 ----
const firstScores = T.S.matches.map(m => m.score);
await T.runFileScan();
const secondScores = T.S.matches.map(m => m.score);
ok(JSON.stringify(firstScores) === JSON.stringify(secondScores),
   '重复扫描结果完全一致（评分已去随机噪声）= ' + firstScores.length + ' 条');

// ---- 24) 文档模式的导出：必须包含全量命中与全部表格 ----
const fsnap = T.exportSnapshot();
ok(fsnap.mode === 'local-file', '导出模式标记 = ' + fsnap.mode);
ok(!!fsnap.source && fsnap.source.name === '测试.md', '导出带源文件信息 = ' + (fsnap.source && fsnap.source.name));
ok(fsnap.pages.length === T.S.matches.length,
   '导出命中数为全量而非动画条数 = ' + fsnap.pages.length + '（动画 ' + fsnap.summary.matchesAnimated + '）');
ok(fsnap.tables.length === 1 && fsnap.tables[0].grid.length === 3, '导出含完整表格网格');
ok(fsnap.tables[0].matchedKeywords.length > 0, '导出标注表格命中的关键词');
const tCsv = T.toCSV(fsnap);
ok(tCsv.indexOf('section') >= 0 || tCsv.indexOf('url,title') === 1, '文档模式页面 CSV 可生成');
const allT = T.allTablesToCSV();
ok(allT.charCodeAt(0) === 0xFEFF, '表格 CSV 带 UTF-8 BOM');
const tLines = allT.slice(1).trim().split('\r\n');
ok(tLines[0] === 'table_index,table_section,row,col,value', '表格 CSV 长表表头正确');
ok(tLines.length === 1 + 3 * 3, '表格 CSV 行数 = 表头 + 3×3 格 = ' + (tLines.length - 1));
const fMd = T.toMarkdown(fsnap);
ok(fMd.indexOf('## 提取到的表格') > 0, 'Markdown 报告含表格章节');
ok(fMd.indexOf('| 项目 | 2023 | 2024 |') > 0, 'Markdown 里表格被还原成表格');
ok(fMd.indexOf('## 抽取内容') > 0, 'Markdown 含文档命中明细');

// ---- 24.5) 整屏 OCR 块沿用文档评分、覆盖审计与导出 ----
T.S.mode = 'screen';
T.S.file = screenDoc;
T.setPromptText('财务 营收\n置信度 0.05');
await T.runFileScan();
const screenSnap = T.exportSnapshot();
ok(T.S.matches.length === 2 && T.S.coverage.totalChars > 0,
   '整屏 OCR 全部文字行均被保留并经过关键词评分和覆盖审计');
ok(screenSnap.mode === 'windows-screen' && screenSnap.pages[0].screenRect.x === -1880,
   '整屏扫描导出模式和负坐标命中框');
ok(screenSnap.pages.length === 2 && screenSnap.pages.some(p => p.content === '不含关键词的屏幕文字也应完整保留'),
   '整屏导出包含未命中关键词的全部 OCR 文本');
ok(T.toMarkdown(screenSnap).indexOf('## 抽取内容') > 0,
   '整屏结果可生成文档模式 Markdown 报告');
T.S.mode = 'file';
T.S.file = mdoc;

// ---- 25) 无命中时不应崩，且表格仍然全部提取 ----
T.setPromptText('完全不存在的词汇XYZ');
await T.runFileScan();
ok(T.S.matches.length === 0, '无命中时命中数为 0');
ok(T.S.tables.length === 1, '无命中时表格仍完整提取 = ' + T.S.tables.length);
ok(T.S.phase === 'DONE', '无命中也能正常收尾 = ' + T.S.phase);
const emptyMd = T.toMarkdown(T.exportSnapshot());
ok(emptyMd.indexOf('没有产生可导出') > 0, '空命中时 Markdown 有兜底文案');

// ============================================================================
//  .docx 完整性补齐
// ============================================================================
const mkCtx = extra => Object.assign({
  footnotes:{}, endnotes:{}, comments:{}, numFmt:{}, listCount:{},
  sym:0, footnoteRefs:0, endnoteRefs:0, commentRefs:0, nestedTables:0
}, extra || {});

// ---- 26) 脚注 / 尾注 / 批注：内联到引用位置，而不是丢掉或另起一节 ----
const fctx = mkCtx({
  footnotes:{ '3':'这是脚注内容' },
  endnotes:{ '1':'这是尾注内容' },
  comments:{ '2':{ author:'张三', text:'这是批注内容' } }
});
const pRef = E('p', W, {}, [
  E('r', W, {}, [ Tx('正文开始') ]),
  E('r', W, {}, [ E('footnoteReference', W, { id:'3' }) ]),
  E('commentReference', W, { id:'2' }),
  E('r', W, {}, [ E('endnoteReference', W, { id:'1' }) ]),
  E('r', W, {}, [ Tx('结尾') ])
]);
const refOut = T.wText(pRef, fctx);
ok(refOut.indexOf('这是脚注内容') >= 0, '脚注内容被内联展开');
ok(refOut.indexOf('这是尾注内容') >= 0, '尾注内容被内联展开');
ok(refOut.indexOf('这是批注内容') >= 0 && refOut.indexOf('张三') >= 0, '批注内容与作者被内联展开');
ok(refOut.indexOf('正文开始') < refOut.indexOf('这是脚注内容'), '脚注位置落在引用点之后，顺序正确');
ok(fctx.footnoteRefs === 1 && fctx.endnoteRefs === 1 && fctx.commentRefs === 1,
   '引用计数 = 脚注' + fctx.footnoteRefs + ' 尾注' + fctx.endnoteRefs + ' 批注' + fctx.commentRefs);
ok(T.wText(pRef, null).indexOf('这是脚注内容') < 0, '无 ctx 时不误展开（parseNotes 内部调用安全）');

// ---- 27) 符号字符与连字符：不再静默丢失 ----
ok(T.wText(E('r', W, {}, [ E('sym', W, { char:'0041' }) ]), null) === 'A', '普通字符集的 w:sym 正确还原');
ok(T.wText(E('r', W, {}, [ E('sym', W, { char:'F0FC' }) ]), null) === '▯',
   'Wingdings 私用区符号降级为占位符（可见，而非静默丢失）');
const hyP = E('r', W, {}, [ Tx('a'), E('noBreakHyphen', W), Tx('b'), E('softHyphen', W), Tx('c') ]);
ok(T.wText(hyP, null) === 'a-bc', '不间断连字符保留为 -，软连字符丢弃 → ' + JSON.stringify(T.wText(hyP, null)));
const symC = mkCtx();
T.wText(E('r', W, {}, [ E('sym', W, { char:'F0FC' }), E('sym', W, { char:'F0A8' }) ]), symC);
ok(symC.sym === 2, '符号字符被计数，用户能知道丢了多少 = ' + symC.sym);

// ---- 28) 列表编号：从 numbering.xml 还原 "1. " / "• " ----
const nctx = mkCtx({ numFmt: { '1': { '0':'decimal', '1':'bullet' }, '2': { '0':'chineseCounting' }, '3': { '0':'lowerRoman' } } });
const mkP = (numId, ilvl, text) => E('p', W, {}, [
  E('pPr', W, {}, [ E('numPr', W, {}, [ E('ilvl', W, { val:String(ilvl) }), E('numId', W, { val:String(numId) }) ]) ]),
  E('r', W, {}, [ Tx(text) ])
]);
ok(T.pMeta(mkP(1,0,'甲'), nctx).marker === '1. ', '有序列表 1.');
ok(T.pMeta(mkP(1,0,'乙'), nctx).marker === '2. ', '计数器递增 2.');
ok(T.pMeta(mkP(1,0,'丙'), nctx).marker === '3. ', '计数器递增 3.');
ok(T.pMeta(mkP(1,1,'子'), nctx).marker === '  • ', '二级项目符号带缩进');
ok(T.pMeta(mkP(2,0,'丁'), nctx).marker === '一、', '中文编号格式');
ok(T.pMeta(mkP(3,0,'戊'), nctx).marker === 'i) ', '小写罗马数字');
ok(T.pMeta(E('p', W, {}, [ E('r', W, {}, [ Tx('无编号') ]) ]), nctx).marker === '', '普通段落没有编号前缀');
ok(T.pMeta(mkP(1,0,'己'), null).marker === '', '无 ctx 时不报错也不加编号');
ok(T.cnNum(11) === '十一' && T.cnNum(25) === '二十五', '中文数字转换 = ' + T.cnNum(11) + '/' + T.cnNum(25));
ok(T.romanNum(9) === 'IX' && T.romanNum(14) === 'XIV', '罗马数字转换 = ' + T.romanNum(9) + '/' + T.romanNum(14));

// ---- 29) 嵌套表格：既内联进单元格，又单独提取成一张表 ----
const nctx2 = mkCtx();
const innerTbl = E('tbl', W, {}, [ E('tr', W, {}, [ tc('内1'), tc('内2') ]) ]);
const outerTbl = E('tbl', W, {}, [
  E('tr', W, {}, [ tc('外A'), tc('外B') ]),
  E('tr', W, {}, [ E('tc', W, {}, [
    E('p', W, {}, [ E('r', W, {}, [ Tx('容器') ]) ]), innerTbl
  ]), tc('外C') ]),
]);
const nr = T.parseWTable(outerTbl, nctx2);
ok(nr.nested.length === 1, '嵌套表格被单独提取成表 = ' + nr.nested.length);
ok(nr.nested[0].grid[0][0] === '内1' && nr.nested[0].grid[0][1] === '内2', '嵌套表内容完整');
ok(nr.table.rows === 2 && nr.table.cols === 2, '父表尺寸 = ' + nr.table.rows + '×' + nr.table.cols);
ok(String(nr.table.grid[1][0]).indexOf('内1') >= 0,
   '嵌套表内容同时内联进父单元格（修复"有段落时直接丢弃"）= ' + JSON.stringify(nr.table.grid[1][0]).slice(0,60));
ok(nctx2.nestedTables === 1, '嵌套表计数 = ' + nctx2.nestedTables);

// ---- 30) 多部件 docx：DOCX_PART 必须覆盖全部正文部件 ----
const zip2 = buildZip([
  { name:'word/document.xml',  data:'<w:document xmlns:w="' + T.W_NS + '"><w:body/></w:document>' },
  { name:'word/header1.xml',   data:'<w:hdr xmlns:w="' + T.W_NS + '"/>' },
  { name:'word/footer1.xml',   data:'<w:ftr xmlns:w="' + T.W_NS + '"/>' },
  { name:'word/footnotes.xml', data:'<w:footnotes xmlns:w="' + T.W_NS + '"/>' },
  { name:'word/endnotes.xml',  data:'<w:endnotes xmlns:w="' + T.W_NS + '"/>' },
  { name:'word/comments.xml',  data:'<w:comments xmlns:w="' + T.W_NS + '"/>' },
  { name:'word/numbering.xml', data:'<w:numbering xmlns:w="' + T.W_NS + '"/>' },
  { name:'word/styles.xml',    data:'<w:styles/>' },
  { name:'docProps/app.xml',   data:'<props/>' },
]);
const ze = await T.unzip(zip2, n => T.DOCX_PART.test(n));
ok(ze.size === 7, 'DOCX_PART 命中全部 7 个正文部件 = ' + ze.size);
ok(!ze.has('word/styles.xml') && !ze.has('docProps/app.xml'), '无关部件不被解压（省内存）');
ok(ze.has('word/header1.xml') && ze.has('word/footnotes.xml') && ze.has('word/numbering.xml'),
   '页眉 / 脚注 / 编号部件都在读取范围内');

// ============================================================================
//  Scrapling 导出接入
// ============================================================================
// ---- 31) JSON / JSONL / 包装对象 / CSV ----
const jarr = JSON.stringify([
  { url:'https://a.io/1', title:'财务报告 2024', body:'本年度财务营收增长 12%，毛利率提升', author:'张三', date:'2024-01-01' },
  { url:'https://a.io/2', title:'无关页面',       body:'广告 导航 版权 免责声明',              author:'李四' },
]);
const pj = T.parseJSONRecords(jarr);
ok(pj.shape === 'json-array' && pj.records.length === 2, 'JSON 数组解析 = ' + pj.shape);
const dj = T.recordsToDoc('x.json', 'json', pj, jarr.length, null);
ok(dj.isRecords === true, '识别为记录型数据源');
ok(dj.fieldRoles.body === 'content', 'body 被猜为正文');
ok(dj.fieldRoles.title === 'title', 'title 被猜为标题');
ok(dj.fieldRoles.url === 'url', 'url 被猜为链接');
ok(dj.fieldRoles.author === 'author' && dj.fieldRoles.date === 'time', 'author / date 也被识别');
ok(dj.blocks.length === 2, '一条记录一个块 = ' + dj.blocks.length);
ok(dj.blocks[0].section === '财务报告 2024', '记录用标题做标签 = ' + dj.blocks[0].section);
ok(dj.blocks[0].text.indexOf('营收增长') >= 0, '记录文本包含正文字段');
ok(dj.blocks[0].fields.length >= 5, '字段级结构保留 = ' + dj.blocks[0].fields.length + ' 个字段');
const dj2 = T.recordsToDoc('x.json', 'json', pj, jarr.length, { title:'url' });
ok(dj2.fieldRoles.title === 'url', 'DSL「字段」指令覆盖自动猜测生效');
ok(dj2.blocks[0].section === 'https://a.io/1', '覆盖后标签改用链接');
const pjl = T.parseJSONRecords('{"a":1,"text":"甲"}\n{"a":2,"text":"乙"}\n');
ok(pjl.shape === 'jsonl' && pjl.records.length === 2, 'JSONL 逐行解析 = ' + pjl.shape);
const pw = T.parseJSONRecords('{"items":[{"x":1},{"x":2}]}');
ok(pw.shape === 'json-items' && pw.records.length === 2, '识别 {items:[...]} 包装 = ' + pw.shape);
ok(T.flattenValue({ a:1, b:{ c:'x' } }, 0).indexOf('c: x') >= 0, '嵌套对象被拍平');
ok(T.flattenValue([1,2,3], 0) === '1 | 2 | 3', '数组被拍平为 | 分隔');
const csvSrc = 'title,body,url\n"含,逗号","含""引号""","https://a.io/1"\n第二行,普通正文,https://a.io/2\n';
const pc = T.csvToRecords(csvSrc);
ok(pc.records.length === 2, 'CSV 记录数 = ' + pc.records.length);
ok(pc.records[0].title === '含,逗号', 'CSV 引号包裹的逗号正确还原');
ok(pc.records[0].body === '含"引号"', 'CSV 双写引号正确还原');
ok(pc.columns.join(',') === 'title,body,url', 'CSV 表头 = ' + pc.columns.join(','));
ok(T.csvToRecords('a,b\n1,"多\n行"\n').records[0].b === '多\n行', 'CSV 字段内换行正确还原');
const djc = T.recordsToDoc('x.csv', 'csv', pc, csvSrc.length, null);
ok(djc.isRecords && djc.blocks.length === 2, 'CSV 也能归一到块模型');

// ---- 32) 覆盖率自检：必须是全文的一个精确划分 ----
T.S.mode = 'file';
T.S.file = mdoc;
T.setPromptText('# 关键词\n财务 营收 毛利率\n过滤 广告');
await T.runFileScan();
const cov = T.S.coverage;
ok(!!cov && cov.totalChars > 0, '覆盖率已计算，全文 ' + (cov && cov.totalChars) + ' 字符');
ok(cov.coveredChars > 0 && cov.coveredChars <= cov.totalChars,
   '覆盖字符数合理 = ' + cov.coveredChars + ' / ' + cov.totalChars);
ok(Math.abs(cov.ratio - cov.coveredChars / cov.totalChars) < 1e-12, '覆盖率比值与字符数一致');
ok(cov.gapCount > 0, '存在未被关键词碰到的区间 = ' + cov.gapCount + ' 段');
if (cov.gapCount <= 300) {
  const gapSum = cov.gaps.reduce((a, g) => a + g.len, 0);
  ok(cov.coveredChars + gapSum === cov.totalChars,
     '覆盖 ∪ 未覆盖 恰好等于全文，无重复无遗漏（' + cov.coveredChars + ' + ' + gapSum + ' = ' + cov.totalChars + '）');
} else {
  ok(true, '未覆盖区间超过 300 段，已截断（' + cov.gapCount + '）');
}
ok(cov.gaps.every(g => g.len > 0 && g.end > g.start), '每个未覆盖区间长度为正');
ok(cov.gaps.every((g, i, a) => i === 0 || a[i-1].len >= g.len), '未覆盖区间按字符数降序');
// 关键词确实命中的位置不应出现在未覆盖区间里
const finBlock = mdoc.blocks.filter(b => b.type === 'p' && b.text.indexOf('财务') >= 0)[0];
if (finBlock) {
  const pos = finBlock.text.indexOf('财务');
  const inside = cov.gaps.some(g => g.bi === finBlock._i && pos >= g.start && pos < g.end);
  ok(!inside, '含「财务」的位置没有被算进未覆盖区间');
}

// ---- 33) 复核标记：误报可申诉，漏报可登记 ----
T.S.review = {};
const rk0 = mdoc.blocks.filter(b => b.text && b.text.trim())[0]._i;
T.S.review[rk0] = 'ok';
T.S.review[rk0 + 1] = 'fp';
T.S.missed = [{ bi:rk0, section:'测试', start:0, end:5, len:5, preview:'abcde' }];
const rsnap = T.exportSnapshot();
ok(rsnap.review.confirmed === 1 && rsnap.review.falsePositives === 1, '复核统计 确认1 / 误报1');
ok(rsnap.review.precision === 0.5, '精确率 = ' + rsnap.review.precision);
ok(rsnap.review.missedReported.length === 1, '漏报登记进入导出');
ok(rsnap.summary.confirmed === 1 && rsnap.summary.missedReported === 1, '汇总含复核口径');
ok(!!rsnap.coverage && rsnap.coverage.coverageRatio >= 0, '导出含覆盖率对象');
ok(Array.isArray(rsnap.coverage.gaps), '导出含未覆盖区间明细');
const rmd = T.toMarkdown(rsnap);
ok(rmd.indexOf('## 覆盖率自检') > 0, 'Markdown 含覆盖率章节');
ok(rmd.indexOf('## 人工复核') > 0, 'Markdown 含人工复核章节');
ok(rmd.indexOf('精确率') > 0, 'Markdown 报出精确率');
const gcsv = T.gapsCSV();
ok(gcsv.charCodeAt(0) === 0xFEFF, '未覆盖区间 CSV 带 BOM');
ok(gcsv.slice(1).split('\r\n')[0] === 'block_index,section,char_start,char_end,length,preview',
   '未覆盖区间 CSV 表头正确');
ok(gcsv.slice(1).trim().split('\r\n').length === cov.gaps.length + 1,
   '未覆盖区间 CSV 行数 = 表头 + ' + cov.gaps.length);

// ---- 34) Scrapling 数据源端到端扫描 ----
T.S.file = dj;
T.setPromptText('财务 营收 毛利率');
await T.runFileScan();
ok(T.S.phase === 'DONE', '记录型数据源扫描终态 = ' + T.S.phase);
ok(T.S.scannedBlocks === 2, '扫描记录数 = ' + T.S.scannedBlocks);
ok(T.S.matches.length === 1, '只有含财务的记录命中 = ' + T.S.matches.length);
const recNode = T.S.nodes.filter(n => n.depth >= 2)[0];
ok(!!recNode && Array.isArray(recNode.fieldHits), '命中节点带回字段级明细');
ok(recNode.fieldHits.some(f => f.key === 'body'), '字段明细标出命中字段 body');
ok(recNode.fieldHits[0].terms.length > 0, '字段明细标出命中的关键词 = ' + recNode.fieldHits[0].terms.join(','));
const rs2 = T.exportSnapshot();
ok(rs2.mode === 'local-file' && rs2.extraction.kind === 'json', '导出标记数据源类型');
ok(rs2.extraction.fieldRoles.body === 'content', '导出含字段角色映射');
ok(rs2.source.name === 'x.json', '导出含源文件名');
ok(rs2.generator.indexOf('DOC-FORAGER') === 0, '导出含程序标识 = ' + rs2.generator);
ok(/Zong/.test(rs2.author || ''), '导出含作者署名 = ' + rs2.author);

// ---- 35) 彩蛋：待机时鼠标碰到觅食虫 ----
{
  const tipEl = doc.querySelector('#bugTip');
  const txtEl = doc.querySelector('#bugTipText');
  const moveH = T.listeners.get('#cvNet|mousemove');
  const leaveH = T.listeners.get('#cvNet|mouseleave');
  ok(typeof moveH === 'function' && typeof leaveH === 'function',
     '画布注册了 mousemove / mouseleave（彩蛋前置）');
  ok(T.PET_TEXT === '我可是赛博虫，不是草履虫！', '彩蛋文案 = ' + T.PET_TEXT);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const settle = async (n) => { for (let i = 0; i < n; i++) await sleep(17); };

  // 鼠标远在他处：不该触发
  moveH({ clientX: T.bug.x + 200, clientY: T.bug.y + 200 });
  await settle(3);
  ok(!tipEl.classList.contains('show'), '鼠标远离时不弹气泡');

  // 移到虫子身上：弹气泡并逐字显示
  moveH({ clientX: T.bug.x, clientY: T.bug.y });
  await settle(2);
  ok(tipEl.classList.contains('show'), '鼠标碰到虫子时弹出气泡');
  // 待机时虫子会自己慢慢巡游，所以要像真人一样跟着它移动鼠标
  const seq = [];
  for (let i = 0; i < 60; i++) {
    moveH({ clientX: T.bug.x, clientY: T.bug.y });
    await sleep(17);
    seq.push(txtEl.textContent.length);
    if (txtEl.textContent === T.PET_TEXT) break;
  }
  ok(seq.length > 3 && seq.every((v, i) => i === 0 || v >= seq[i - 1]), '文本逐字递增（动态显示）');
  ok(txtEl.textContent === T.PET_TEXT, '逐字显示到完整文案 = "' + txtEl.textContent + '"');

  // 运行中不可触发
  T.S.running = true;
  await settle(3);
  ok(!tipEl.classList.contains('show'), '引擎运行中不触发彩蛋');
  T.S.running = false;

  // 移开即收起
  leaveH();
  await settle(3);
  ok(!tipEl.classList.contains('show'), '移开鼠标后气泡收起');

  // 再次触碰应重新逐字
  moveH({ clientX: T.bug.x, clientY: T.bug.y });
  await settle(2);
  ok(txtEl.textContent.length < T.PET_TEXT.length && tipEl.classList.contains('show'),
     '再次触碰从文案开头重新逐字');
}

console.log(fails === 0 ? '\n===== ALL CHECKS PASSED =====' : '\n===== ' + fails + ' CHECK(S) FAILED =====');
process.exit(fails === 0 ? 0 : 1);
