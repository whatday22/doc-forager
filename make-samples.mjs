/* 生成测试样本：一个覆盖全部边界情况的 .docx，外加模拟 Scrapling 输出的 JSONL / CSV / MD */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = '测试样本';
fs.mkdirSync(OUT, { recursive: true });

/* ---------- ZIP 打包 ---------- */
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, eocd]);
}

/* ---------- WordprocessingML 片段 ---------- */
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const T = s => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const P = (s, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${T(s)}</w:p>`;
const LI = (s, numId, ilvl) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${T(s)}</w:p>`;
const TC = (body, span, vMerge) => {
  let pr = '';
  if (span > 1) pr += `<w:gridSpan w:val="${span}"/>`;
  if (vMerge) pr += `<w:vMerge${vMerge === 'restart' ? ' w:val="restart"' : ''}/>`;
  return `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${body}</w:tc>`;
};
const TR = cells => `<w:tr>${cells.join('')}</w:tr>`;
const cellP = s => P(s);
const CELL = (s, span, vMerge) => TC(cellP(s), span, vMerge);
const TBL = rows => `<w:tbl>${rows.map(TR).join('')}</w:tbl>`;

// 嵌套表格：外层第 3 行第 1 格内嵌一张 2×2 小表
const innerTbl = TBL([
  [CELL('子项A'), CELL('子值 41')],
  [CELL('子项B'), CELL('子值 58')]
]);

const body = [
  P('2024 年度经营分析报告', 'Heading1'),
  P('本报告由财务部编制，涵盖全年营收、毛利率、用户数与市场规模等核心指标。'),

  P('一、营收概况', 'Heading2'),
  P('2024 年公司营收达到 12.8 亿元，同比增长 23.5%。增长主要来自华东与华南区域。'),
  LI('营收结构优化，毛利率提升至 42.1%', 1, 0),
  LI('用户数突破 860 万，同比新增 190 万', 1, 0),
  LI('市场规模扩大至 320 亿元', 1, 0),
  LI('其中企业客户占比 61%', 1, 1),
  LI('个人客户占比 39%', 1, 1),

  P('二、区域明细', 'Heading2'),
  TBL([
    [CELL('区域', 2), CELL('上半年'), CELL('下半年'), CELL('全年合计')],
    [CELL('华东区', 0, 'restart'), CELL('3.2'), CELL('4.1'), CELL('7.3')],
    [CELL('', 0, 'continue'), CELL('2.1'), CELL('2.8'), CELL('4.9')],
    [CELL('合计'), CELL('5.3'), CELL('6.9'), CELL('12.2')],
  ]),
  P('上表华东区为两行合并；表头"区域"横向跨两列。'),

  P('三、成本结构（含嵌套表格）', 'Heading2'),
  TBL([
    [CELL('项目'), CELL('金额（亿元）'), CELL('说明')],
    [CELL('主营业务成本'), CELL('7.4'), TC(cellP('明细见下表') + innerTbl)],
    [CELL('期间费用'), CELL('1.9'), CELL('含研发与销售')],
  ]),

  P('四、附注与符号', 'Heading2'),
  `<w:p>${T('毛利率口径见脚注')}<w:r><w:footnoteReference w:id="2"/></w:r>${T('，历史数据来源见尾注')}<w:r><w:endnoteReference w:id="1"/></w:r>${T('。')}</w:p>`,
  `<w:p>${T('此处口径需与去年保持一致')}<w:r><w:commentReference w:id="1"/></w:r>${T('。')}</w:p>`,
  `<w:p><w:r>${T('符号测试：勾选 ')}<w:sym w:font="Wingdings" w:char="F0FC"/>${T(' 方框 ')}<w:sym w:font="Wingdings" w:char="F0A8"/>${T(' 普通字符 ')}<w:sym w:font="Arial" w:char="0041"/>${T(' 结束')}</w:r></w:p>`,
  `<w:p><w:r>${T('连字符测试：不可断 ')}<w:noBreakHyphen/>${T(' 与软 ')}<w:softHyphen/>${T('连字符')}</w:r></w:p>`,

  P('五、噪声段（用于验证 过滤 指令）', 'Heading2'),
  P('本页底部含广告位、免责声明、版权所有、订阅推送等导航性内容，与主题无关。'),
  P('相关推荐：点击这里立即优惠，下载APP 查看更多。'),

  '<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>',
].join('');

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${P('页眉：年度经营分析报告（内部资料）')}</w:hdr>`;
const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${P('页脚：财务部编制 · 请勿外传')}</w:ftr>`;
const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}>` +
  `<w:footnote w:id="-1">${P('分隔符')}</w:footnote><w:footnote w:id="0">${P('分隔符')}</w:footnote>` +
  `<w:footnote w:id="2">${P('毛利率 =（营收 − 成本）÷ 营收，已经外部审计确认。')}</w:footnote></w:footnotes>`;
const endnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes ${NS}>` +
  `<w:endnote w:id="-1">${P('分隔符')}</w:endnote><w:endnote w:id="0">${P('分隔符')}</w:endnote>` +
  `<w:endnote w:id="1">${P('数据来源：国家统计局 2024 年国民经济公报。')}</w:endnote></w:endnotes>`;
const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS}>` +
  `<w:comment w:id="1" w:author="张三" w:date="2025-01-10T09:00:00Z">${P('这里的统计口径要和去年年报对齐后再定稿。')}</w:comment></w:comments>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
  `<w:abstractNum w:abstractNumId="0">` +
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
  `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>` +
  `</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;
const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
  `<Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
  `</Relationships>`;

const docx = zip([
  { name: '[Content_Types].xml', data: contentTypes },
  { name: '_rels/.rels', data: rootRels },
  { name: 'word/document.xml', data: documentXml },
  { name: 'word/_rels/document.xml.rels', data: docRels },
  { name: 'word/styles.xml', data: stylesXml },
  { name: 'word/numbering.xml', data: numberingXml },
  { name: 'word/footnotes.xml', data: footnotesXml },
  { name: 'word/endnotes.xml', data: endnotesXml },
  { name: 'word/comments.xml', data: commentsXml },
  { name: 'word/header1.xml', data: headerXml },
  { name: 'word/footer1.xml', data: footerXml },
]);
fs.writeFileSync(path.join(OUT, '经营分析报告.docx'), docx);

/* ---------- 模拟 Scrapling to_jsonl() 输出 ---------- */
const records = [
  { url:'https://shop.test/p/1001', title:'2024 年度财务报告全文', content:'本年度营收 12.8 亿元，同比增长 23.5%，毛利率提升至 42.1%，用户数突破 860 万。', author:'财务部', date:'2025-01-08' },
  { url:'https://shop.test/p/1002', title:'毛利率计算方法说明', content:'毛利率 =（营收 − 营业成本）÷ 营收。本文给出三种口径的对比与适用场景。', author:'财务部', date:'2025-01-09' },
  { url:'https://shop.test/p/1003', title:'用户增长季度简报', content:'Q4 用户数新增 62 万，其中企业客户贡献 41%。市场规模较去年同期扩大 18%。', author:'增长组', date:'2025-01-10' },
  { url:'https://shop.test/p/1004', title:'市场规模测算模型 v3', content:'基于自下而上法测算，2025 年目标市场规模 380 亿元，复合增长率 19%。', author:'战略部', date:'2025-01-11' },
  { url:'https://shop.test/p/1005', title:'区域营收拆解（华东）', content:'华东区全年营收 7.3 亿元，占公司总营收 57%，毛利率 44.6%，高于公司平均。', author:'华东大区', date:'2025-01-12' },
  { url:'https://shop.test/p/1006', title:'联系我们', content:'广告 导航 版权 免责声明 立即优惠 下载APP 订阅推送 相关推荐 返回顶部。', author:'运维', date:'2025-01-12' },
  { url:'https://shop.test/p/1007', title:'办公室搬迁通知', content:'因业务扩张，公司将于下月搬迁至新办公区，请各部门提前整理资料。', author:'行政部', date:'2025-01-13' },
  { url:'https://shop.test/p/1008', title:'2025 年营收目标与拆解', content:'2025 年营收目标 16.5 亿元，其中存量业务贡献 13 亿，新业务贡献 3.5 亿。', author:'财务部', date:'2025-01-14' },
  { url:'https://shop.test/p/1009', title:'竞品价格对比表', content:'主要竞品在华东区的定价区间为 3.1–4.8 元，我方处于中位水平，毛利率仍有优化空间。', author:'市场部', date:'2025-01-15' },
  { url:'https://shop.test/p/1010', title:'员工手册（节选）', content:'考勤制度、休假申请流程、报销标准与办公用品领用说明。', author:'人力部', date:'2025-01-15' }
];
fs.writeFileSync(path.join(OUT, 'scrapling_output.jsonl'),
  records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

/* ---------- 模拟 Scrapling to_json() 输出（带 items 包装） ---------- */
fs.writeFileSync(path.join(OUT, 'scrapling_output.json'),
  JSON.stringify({ spider:'finance_spider', count: records.length, items: records }, null, 2), 'utf8');

/* ---------- 模拟 Scrapling to_csv() 输出 ---------- */
const esc = v => /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const csvHead = ['url','title','content','author','date'];
fs.writeFileSync(path.join(OUT, 'scrapling_output.csv'),
  '\ufeff' + [csvHead.join(',')].concat(records.map(r => csvHead.map(k => esc(r[k])).join(','))).join('\r\n') + '\r\n',
  'utf8');

/* ---------- 一份 Markdown 文档 ---------- */
fs.writeFileSync(path.join(OUT, '产品说明.md'), `# 智能报表平台 产品说明

## 一、核心指标

本平台聚焦营收、毛利率与用户数三大核心指标，支持按区域与时间维度下钻。

- 营收看板：支持同比与环比
- 毛利率分析：支持三种口径切换
- 用户数趋势：按企业/个人拆分

## 二、区域数据

| 区域 | 上半年 | 下半年 | 合计 |
| --- | ---: | ---: | ---: |
| 华东 | 3.2 | 4.1 | 7.3 |
| 华南 | 2.1 | 2.8 | 4.9 |
| 华北 | 1.4 | 1.9 | 3.3 |

## 三、市场规模

2025 年目标市场规模 380 亿元，复合增长率 19%。

## 四、页脚广告

广告 导航 版权 免责声明 立即优惠 下载APP 订阅推送
`, 'utf8');

console.log('已生成到 ./' + OUT + '/');
for (const f of fs.readdirSync(OUT)) {
  console.log('  ' + f.padEnd(28) + fs.statSync(path.join(OUT, f)).size + ' 字节');
}
