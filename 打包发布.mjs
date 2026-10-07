#!/usr/bin/env node
/**
 * 打包发布 —— 把「要发到 GitHub 的那一份」整理到 ./发布包/doc-forager/
 *
 * 用法：  node 打包发布.mjs
 *
 * 做的事：
 *   1. 跑自测，不过就拒绝打包
 *   2. 按白名单式排除法复制工作区（排除 .git / 备份 / 测试输出 / 临时脚本等）
 *   3. 核对必需文件一个不少，给出体积报告
 *
 * 换了截图之后重跑一次即可，输出目录每次都会重建。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT = path.join('发布包', 'doc-forager');
const C = { r: '\x1b[0m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', b: '\x1b[1m' };
const log = (s = '') => console.log(s);

/* ---------- 1. 自测 ---------- */
log(C.b + '① 跑自测' + C.r);
const t = spawnSync(process.execPath, ['selftest.mjs'], { stdio: 'inherit' });
if (t.status !== 0) {
  log('');
  log(C.y + '✘ 自测没有通过，拒绝打包。先修好再跑一次。' + C.r);
  process.exit(1);
}
log(C.g + '✔ 自测通过' + C.r);
log('');

/* ---------- 2. 收集要发布的文件 ---------- */
// 目录级排除
const SKIP_DIR = new Set(['.git', 'node_modules', '备份', 'backup', '测试输出', '发布包', 'dist', 'build']);
// 文件级排除：本地专用的东西
const SKIP_FILE = new Set(['发布到GitHub.md', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

const files = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), r);
    } else {
      if (SKIP_FILE.has(e.name)) continue;
      if (e.name.startsWith('._')) continue;        // 临时诊断脚本
      if (/\.(tmp|log)$/i.test(e.name)) continue;
      files.push(r);
    }
  }
})('.', '');
files.sort();

/* ---------- 3. 必需文件核对 ---------- */
const REQUIRED = [
  'index.html', 'README.md', 'LICENSE', '.gitignore', '.gitattributes',
  'selftest.mjs', 'proxy.mjs', '测试指南.md', 'make-samples.mjs', 'verify-samples.mjs',
  'docs/README.md', 'docs/shot-01-local-file.png', 'docs/shot-02-idle.png',
  'docs/shot-03-simulate.png', 'docs/shot-04-real-crawl.png', 'docs/shot-05-export.png',
  '测试样本/经营分析报告.docx', '测试样本/产品说明.md',
  '测试样本/scrapling_output.jsonl', '测试样本/scrapling_output.json', '测试样本/scrapling_output.csv'
];
const missing = REQUIRED.filter(f => !files.includes(f));
if (missing.length) {
  log(C.y + '✘ 缺少必需文件，拒绝打包：' + C.r);
  for (const m of missing) log('   ' + m);
  process.exit(1);
}
log(C.b + '② 复制文件' + C.r);
log(C.g + '✔ 必需文件齐全（' + REQUIRED.length + ' 项）' + C.r);

/* ---------- 4. 复制 ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
let total = 0;
for (const f of files) {
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(f, dst);
  total += fs.statSync(dst).size;
}
log(C.g + '✔ 已复制 ' + files.length + ' 个文件' + C.r);
log('');

/* ---------- 5. 体积报告 ---------- */
log(C.b + '③ 体积' + C.r);
const byDir = new Map();
for (const f of files) {
  const d = path.dirname(f) === '.' ? '(根目录)' : path.dirname(f);
  byDir.set(d, (byDir.get(d) || 0) + fs.statSync(path.join(OUT, f)).size);
}
for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) {
  log('   ' + d.padEnd(18) + (n / 1024).toFixed(0).padStart(7) + ' KB');
}
log('   ' + '合计'.padEnd(18) + (total / 1024).toFixed(0).padStart(7) + ' KB');
log('');
if (total > 15 * 1024 * 1024) {
  log(C.y + '   ⚠ 超过 15 MB，建议压一下截图（见 docs/README.md）' + C.r);
}

/* ---------- 6. 说明文件 ---------- */
fs.writeFileSync(path.join('发布包', '如何发布.txt'), `这个文件夹里有两样东西，别搞混
================================================

  doc-forager/        ← 要发布的那一份（干净副本）
  如何发布.txt         ← 本文件


doc-forager/ 是什么
------------------------------------------------
它是一份**快照**：里面正好是会被推到 GitHub 的那些文件，
已经排除了 .git / 备份 / 测试输出 / 临时脚本 / 发布指南。
你可以拿它来：
  · 核对"到底会发出去什么"
  · 打包成 zip 发给别人
  · 或者你想换个地方重新 git init 时，直接用它

**但正常的推送不需要用它** —— git 仓库在上一层（爬虫/ 目录）里，
已经在根目录完成了初始化和首次提交。


实际推送怎么做
------------------------------------------------
在【爬虫】目录（不是这个文件夹）里执行：

  git remote add origin https://github.com/<你的用户名>/doc-forager.git
  git branch -M main
  git push -u origin main

完整的 7 个阶段、命令、仓库装修、排错表，看上一层目录的
《发布到GitHub.md》。


改了东西之后
------------------------------------------------
在【爬虫】目录里重跑一次：

  node 打包发布.mjs

它会先跑自测（不过就拒绝打包），然后重建这个文件夹。
所以这个文件夹永远是最新的，不用手动同步。


当前的体积分布
------------------------------------------------
${[...byDir].sort((a, b) => b[1] - a[1]).map(([d, n]) => '  ' + d.padEnd(20) + (n / 1024).toFixed(0).padStart(6) + ' KB').join('\n')}
  ${'合计'.padEnd(20)}${(total / 1024).toFixed(0).padStart(6)} KB
  文件数 ${files.length}

体积几乎全在 docs/ 的截图上。想瘦身就用 TinyPNG 压一下，
保持文件名不变，README 不用改。
`, 'utf8');

/* ---------- 7. 待办提示 ---------- */
log(C.b + '④ 发布包位置' + C.r);
log('   ' + C.c + path.resolve(OUT) + C.r);
log('   ' + C.d + '（同级的《如何发布.txt》说明了它和 git 仓库的关系）' + C.r);
log('');
log(C.b + '接下来' + C.r);
log('   1. 打开 ' + C.c + 'docs/README.md' + C.r + ' 看那四张截图是否需要重拍');
log('   2. 重拍后用同名文件覆盖 ' + C.c + 'docs/' + C.r + ' 下的旧图，再跑一次本脚本');
log('   3. 按 ' + C.c + '发布到GitHub.md' + C.r + ' 的阶段 3~4 建仓库并推送');
log('');
