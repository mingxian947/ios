// 从 README.md 索引行生成静态站点（docs/），供 GitHub Pages 与搜索引擎抓取
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const SITE = 'https://mingxian947.github.io/ios';
const SITE_NAME = 'iOS 安全研究文章库';

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

function lastmod(file) {
  try {
    return cp.execSync(`git log -1 --format=%ad --date=short -- "${file}"`, { cwd: ROOT }).toString().trim();
  } catch (e) { return ''; }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
    if (/^https?:/i.test(url)) return '<a href="' + url + '" rel="nofollow noopener" target="_blank">' + txt + '</a>';
    if (/\.md$/i.test(url)) {
      const n = byFile[url];
      if (n) return '<a href="' + slug(n) + '.html">' + txt + '</a>';
    }
    return txt;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

// 解析 README 索引：编号、标题、文件名、摘要
const rows = [];
for (const line of read('README.md').split(/\r?\n/)) {
  const m = line.match(/^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(([^)]+\.md)\)\s*\|\s*([^|]+)\|/);
  if (m) rows.push({ num: Number(m[1]), title: m[2], file: m[3], desc: m[4].trim() });
}
rows.sort((a, b) => a.num - b.num);
const byFile = {};
const byNum = {};
for (const r of rows) { byFile[r.file] = r.num; byNum[r.num] = r; }
const slug = (n) => 'a' + String(n).padStart(2, '0');

function isTableSep(line) { return /^\|[\s:|-]+\|$/.test(line.trim()); }

function md2html(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let inCode = false, codeBuf = [];
  let listType = null, listBuf = [];
  let quoteBuf = [];

  const flushList = () => {
    if (!listType) return;
    out.push('<' + listType + '>' + listBuf.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + listType + '>');
    listBuf = []; listType = null;
  };
  const flushQuote = () => {
    if (!quoteBuf.length) return;
    out.push('<blockquote><p>' + inline(quoteBuf.join(' ')) + '</p></blockquote>');
    quoteBuf = [];
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (line.startsWith('```')) {
      if (inCode) { out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
      else { flushList(); flushQuote(); inCode = true; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(raw); i++; continue; }

    if (/^\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushList(); flushQuote();
      const head = line.split('|').slice(1, -1).map(c => c.trim());
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i].trimEnd())) {
        body.push(lines[i].trimEnd().split('|').slice(1, -1).map(c => c.trim()));
        i++;
      }
      let t = '<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
      for (const r of body) t += '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
      out.push(t + '</tbody></table>');
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList(); flushQuote();
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushList(); flushQuote(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) { quoteBuf.push(line.replace(/^>\s?/, '')); i++; continue; }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { flushQuote(); if (listType !== 'ul') { flushList(); listType = 'ul'; } listBuf.push(ul[1]); i++; continue; }
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { flushQuote(); if (listType !== 'ol') { flushList(); listType = 'ol'; } listBuf.push(ol[1]); i++; continue; }
    if (line.trim() === '') { flushList(); flushQuote(); i++; continue; }
    flushList(); flushQuote();
    out.push('<p>' + inline(line) + '</p>');
    i++;
  }
  flushList(); flushQuote();
  if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  return out.join('\n');
}

const CSS = `:root{--fg:#1b1f24;--mut:#57606a;--line:#d8dee4;--bg:#fff;--code:#f6f8fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:52rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.8rem;line-height:1.35;margin:.2em 0 .6em}h2{font-size:1.35rem;margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.3em}
h3{font-size:1.1rem;margin-top:1.6em}a{color:#0b62ce;text-decoration:none}a:hover{text-decoration:underline}
p{margin:.9em 0}hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
blockquote{margin:1.2em 0;padding:.6em 1em;border-left:4px solid #0b62ce;background:#f0f5fb;color:#24292f}
code{background:var(--code);padding:.15em .4em;border-radius:4px;font-family:ui-monospace,Consolas,monospace;font-size:.9em}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:1rem;overflow-x:auto}
pre code{background:none;padding:0;font-size:.85rem;line-height:1.55}
table{border-collapse:collapse;width:100%;margin:1.2em 0;font-size:.93rem;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.5em .7em;text-align:left;vertical-align:top}
th{background:var(--code);font-weight:600}tr:nth-child(2n) td{background:#fbfcfd}
.meta{color:var(--mut);font-size:.9rem;margin:0 0 1.5rem}.nav{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.92rem}
ul,ol{padding-left:1.6em}.contact{margin-top:2rem;padding:1rem;border:1px solid var(--line);border-radius:8px;background:var(--code)}`;

function page({ num, title, desc, file, body, url, crumb }) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}${num ? ' | ' + SITE_NAME : ''}</title>
<meta name="description" content="${esc(desc).slice(0, 155)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc).slice(0, 155)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<style>${CSS}</style></head>
<body><main>
${crumb}
<article>${body}</article>
</main></body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });

// 文章页
for (const r of rows) {
  const src = read(r.file);
  const contact = src.trim().split(/\r?\n/).pop();
  let body = md2html(src);
  const idx = body.lastIndexOf('<hr>');
  if (idx > 0 && contact.startsWith('咨询')) {
    body = body.slice(0, idx) + `<div class="contact">${inline(contact)}</div>`;
  }
  const crumb = `<p class="meta"><a href="index.html">${SITE_NAME}</a> · 第 ${r.num} 篇 · 防御性安全研究，不含可利用代码</p>`;
  const prev = byNum[r.num - 1], next = byNum[r.num + 1];
  const nav = `<nav class="nav">${prev ? `<a href="${slug(prev.num)}.html">← 第 ${prev.num} 篇</a>` : '<a href="index.html">← 目录</a>'} ｜ <a href="index.html">目录</a> ｜ ${next ? `<a href="${slug(next.num)}.html">第 ${next.num} 篇 →</a>` : ''}</nav>`;
  fs.writeFileSync(path.join(OUT, slug(r.num) + '.html'),
    page({ num: r.num, title: r.title, desc: r.desc, file: r.file, body: body + nav, url: `${SITE}/${slug(r.num)}.html`, crumb }));
}

// 目录页
const list = rows.map(r => `<li><a href="${slug(r.num)}.html">${esc(r.title)}</a><br><span class="meta">第 ${r.num} 篇 · ${esc(r.desc)}</span></li>`).join('\n');
const intro = md2html(read('README.md').split(/\r?\n/).slice(0, 12).join('\n').replace(/^#\s.*$/m, ''));
fs.writeFileSync(path.join(OUT, 'index.html'), page({
  num: null,
  title: SITE_NAME + '：iOS 国家级攻击链与商业间谍软件防御分析',
  desc: '中文 iOS 安全研究文章库：水坑投递、WebKit RCE、PAC 绕过、沙箱逃逸、内核提权、无文件驻留、取证检测，覆盖 Coruna 与 DarkSword 案例。',
  file: 'README.md',
  body: `<h1>${SITE_NAME}</h1>${intro}<p class="meta">共 ${rows.length} 篇 · 防御性安全研究（Defensive Security Research），不提供可利用代码</p><ol>${list}</ol>`,
  url: `${SITE}/index.html`, crumb: ''
}));

// sitemap / robots / 关闭 Jekyll
const today = new Date().toISOString().slice(0, 10);
const urls = [`\n  <url><loc>${SITE}/index.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`]
  .concat(rows.map(r => `\n  <url><loc>${SITE}/${slug(r.num)}.html</loc><lastmod>${lastmod(r.file) || today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`));
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const missing = rows.filter(r => !fs.existsSync(path.join(ROOT, r.file))).map(r => r.file);
const allMd = fs.readdirSync(ROOT).filter(f => f.endsWith('.md') && f !== 'README.md');
const unindexed = allMd.filter(f => !(f in byFile));
console.log(`生成文章页 ${rows.length} 个 + 目录页 1 个 -> docs/`);
if (missing.length) console.log('README 指向但文件缺失: ' + missing.join(', '));
if (unindexed.length) console.log('存在但未进 README 索引: ' + unindexed.join(', '));
