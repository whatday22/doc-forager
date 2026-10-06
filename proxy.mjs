#!/usr/bin/env node
/**
 * DOC-FORAGER 觅食虫 · 可选本地中继（真实抓取模式用）
 * ------------------------------------------------------------------
 * 浏览器直连目标站点会被 CORS 挡住。这个 30 行的小服务把请求代理一层，
 * 并补上 Access-Control-Allow-Origin，让 index.html 能真正抓到真实网页。
 *
 * 启动：   node proxy.mjs
 * 然后在 HUD 顶栏把「中继」切到 —— 本地代理 8787
 *
 * 安全约束（面向本机使用的合理默认）：
 *   · 只允许 http / https
 *   · 解析 DNS 并拒绝内网 / 环回 / 链路本地地址（SSRF 基本防护）
 *   · 单次响应体积上限 4 MB，超时 15 s
 *   · 只监听 127.0.0.1，不对外暴露
 *
 * 注意：redirect 跟随不重新校验目标地址，本地开发够用；若要公网部署请补重定向校验。
 */
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const HERE = path.dirname(fileURLToPath(import.meta.url));

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;              // link-local
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] >= 224) return true;                               // 组播/保留
    return false;
  }
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fc') || s.startsWith('fd')) return true;    // 唯一本地地址
  if (s.startsWith('fe80')) return true;                        // 链路本地
  if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7));  // IPv4 映射
  return false;
}

async function assertPublic(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new Error('拒绝访问内网/环回地址: ' + bare);
    return;
  }
  if (/^localhost$/i.test(bare)) throw new Error('拒绝访问 localhost');
  const recs = await dns.lookup(bare, { all: true });
  if (!recs.length) throw new Error('DNS 解析失败: ' + bare);
  for (const r of recs) {
    if (isPrivateIp(r.address)) throw new Error('拒绝访问内网地址: ' + bare + ' → ' + r.address);
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Cache-Control': 'no-store',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'GET') { res.writeHead(405, CORS); return res.end('method not allowed'); }

  const here = new URL(req.url, 'http://' + HOST + ':' + PORT);
  const target = here.searchParams.get('url');

  /* 不带 ?url= 时，把 index.html 托管在同源下。
     这样页面跑在 http://127.0.0.1:8787 而不是 file://，
     浏览器对 file:// 页面发起 fetch 的限制就完全不存在了 —— 真实抓取最稳的方式。 */
  if (!target) {
    if (here.pathname === '/' || here.pathname === '/index.html') {
      let page;
      try { page = fs.readFileSync(path.join(HERE, 'index.html')); }
      catch { res.writeHead(404, CORS); return res.end('index.html not found next to proxy.mjs'); }
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS));
      return res.end(page);
    }
    res.writeHead(404, CORS);
    return res.end('use / for the HUD, or /?url=<target> to proxy a page');
  }

  let u;
  try { u = new URL(target); } catch { res.writeHead(400, CORS); return res.end('malformed url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    res.writeHead(400, CORS); return res.end('only http/https allowed');
  }

  const started = Date.now();
  try {
    await assertPublic(u.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const upstream = await fetch(u, {
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NeuroCrawler/2.4; local-relay)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      res.writeHead(413, CORS);
      return res.end('upstream body exceeds ' + (MAX_BYTES / 1048576) + ' MB');
    }
    console.log('[200] ' + buf.length + 'B ' + (Date.now() - started) + 'ms  ' + u.href);
    res.writeHead(200, Object.assign({
      'Content-Type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
      'X-Upstream-Status': String(upstream.status),
      'X-Relay-Ms': String(Date.now() - started),
    }, CORS));
    res.end(buf);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn('[ERR] ' + msg + '  ' + u.href);
    res.writeHead(502, CORS);
    res.end('relay error: ' + msg);
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ◈ 觅食虫 DOC-FORAGER 本地中继已就绪');
  console.log('');
  console.log('    ① 推荐：直接打开这个地址用（页面与中继同源，无任何跨域限制）');
  console.log('       http://' + HOST + ':' + PORT + '/');
  console.log('       然后在页面顶栏把「中继」切到 —— 本地代理 ' + PORT);
  console.log('');
  console.log('    ② 也可以单独当代理用');
  console.log('       http://' + HOST + ':' + PORT + '/?url=<被代理的网址>');
  console.log('');
  console.log('    停止   Ctrl+C');
  console.log('');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。换端口：  $env:PORT=8788; node proxy.mjs');
  } else {
    console.error('中继启动失败: ' + e.message);
  }
  process.exit(1);
});
