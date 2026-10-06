/* 用 index.html 里真实的 unzip 验证样本 docx 的容器层，并做 XML 标签配对检查 */
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const grad = { addColorStop() {} };
const ctx = () => new Proxy({ measureText: () => ({ width: 42 }), createLinearGradient: () => grad,
  createRadialGradient: () => grad }, { get: (t, k) => k in t ? t[k] : () => {}, set: (t, k, v) => (t[k] = v, true) });
const el = () => ({
  style: { setProperty() {} }, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
  children: [], childElementCount: 0, value: '', textContent: '', innerHTML: '', scrollTop: 0, scrollLeft: 0,
  selectionStart: 0, selectionEnd: 0, addEventListener(){}, appendChild(){}, insertBefore(){}, removeChild(){},
  getBoundingClientRect: () => ({ width: 900, height: 520 }), getContext: ctx, querySelector: () => null,
  querySelectorAll: () => [], getAttribute: () => null, setAttribute(){}, focus(){},
});
const cache = new Map();
const doc = {
  querySelector: s => (cache.has(s) || cache.set(s, el()), cache.get(s)),
  getElementById: s => (cache.has('#' + s) || cache.set('#' + s, el()), cache.get('#' + s)),
  querySelectorAll: () => [], createElement: el, createDocumentFragment: el, addEventListener(){},
  body: el(), documentElement: el(), activeElement: null, fullscreenElement: null,
};
const fn = new Function('window','document','performance','ResizeObserver','requestAnimationFrame','navigator','console',
  script + '\nglobalThis.__U = { unzip };');
fn({ devicePixelRatio: 1, addEventListener(){} }, doc, performance, class { observe(){} }, () => {}, { userAgent: 'node' }, console);

const { unzip } = globalThis.__U;

const buf = fs.readFileSync('测试样本/经营分析报告.docx');
const b = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const want = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|numbering)\.xml$/;
const parts = await unzip(b, n => want.test(n));

const expect = ['word/document.xml','word/header1.xml','word/footer1.xml','word/footnotes.xml',
                'word/endnotes.xml','word/comments.xml','word/numbering.xml'];
console.log('解出部件:', parts.size, '/ 期望', expect.length);
for (const e of expect) console.log('  ' + (parts.has(e) ? '✔' : '✘') + ' ' + e);

const dec = new TextDecoder('utf-8');
console.log('');
console.log('XML 标签配对与内容检查:');
for (const [name, bytes] of parts) {
  const xml = dec.decode(bytes);
  // 去掉自闭合标签与声明后粗略检查配对
  const stripped = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<[^>]*\/>/g, '');
  const opens = (stripped.match(/<([A-Za-z][\w:.-]*)[^>]*>/g) || []).map(t => t.match(/^<([A-Za-z][\w:.-]*)/)[1]);
  const closes = (stripped.match(/<\/([A-Za-z][\w:.-]*)>/g) || []).map(t => t.match(/^<\/([A-Za-z][\w:.-]*)/)[1]);
  const stack = [];
  let balanced = true;
  for (const t of stripped.match(/<\/?[A-Za-z][\w:.-]*[^>]*>/g) || []) {
    const m = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(t);
    if (!m) continue;
    if (t.endsWith('/>')) continue;
    if (m[1]) { if (stack.pop() !== m[2]) { balanced = false; break; } }
    else stack.push(m[2]);
  }
  if (stack.length) balanced = false;
  console.log('  ' + (balanced ? '✔' : '✘') + ' ' + name.padEnd(24) + ' 开' + opens.length + ' 闭' + closes.length);
}

console.log('');
console.log('关键内容抽查:');
const dx = dec.decode(parts.get('word/document.xml'));
const checks = [
  ['Heading1 标题', /w:pStyle w:val="Heading1"/],
  ['Heading2 标题', /w:pStyle w:val="Heading2"/],
  ['编号列表 numId=1', /w:numId w:val="1"/],
  ['二级编号 ilvl=1', /w:ilvl w:val="1"/],
  ['横向合并 gridSpan', /w:gridSpan w:val="2"/],
  ['纵向合并 restart', /w:vMerge w:val="restart"/],
  ['纵向合并 continue', /w:vMerge\/>/],
  ['嵌套表格（2 张表）', /<w:tbl>/g],
  ['脚注引用', /w:footnoteReference w:id="2"/],
  ['尾注引用', /w:endnoteReference w:id="1"/],
  ['批注引用', /w:commentReference w:id="1"/],
  ['符号 F0FC', /w:sym w:font="Wingdings" w:char="F0FC"/],
  ['符号 F0A8', /w:char="F0A8"/],
  ['普通符号 0041', /w:char="0041"/],
  ['不可断连字符', /<w:noBreakHyphen\/>/],
  ['软连字符', /<w:softHyphen\/>/],
  ['噪声段', /免责声明/],
];
for (const [label, re] of checks) {
  const m = dx.match(re);
  const n = re.global ? (dx.match(re) || []).length : (m ? 1 : 0);
  console.log('  ' + (n ? '✔' : '✘') + ' ' + label + (re.global ? ' × ' + n : ''));
}
console.log('');
console.log('  页眉内容:', dec.decode(parts.get('word/header1.xml')).includes('页眉：年度经营分析报告') ? '✔' : '✘');
console.log('  页脚内容:', dec.decode(parts.get('word/footer1.xml')).includes('页脚：财务部编制') ? '✔' : '✘');
console.log('  脚注正文:', dec.decode(parts.get('word/footnotes.xml')).includes('外部审计确认') ? '✔' : '✘');
console.log('  尾注正文:', dec.decode(parts.get('word/endnotes.xml')).includes('国家统计局') ? '✔' : '✘');
console.log('  批注作者:', dec.decode(parts.get('word/comments.xml')).includes('张三') ? '✔' : '✘');
console.log('  编号格式:', dec.decode(parts.get('word/numbering.xml')).includes('lowerLetter') ? '✔' : '✘');
