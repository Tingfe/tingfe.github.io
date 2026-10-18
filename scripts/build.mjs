import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const owner = 'Tingfe';
const siteRepo = `${owner.toLowerCase()}.github.io`;
const token = process.env.GITHUB_TOKEN || '';
const apiHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'tingfe-projects-site',
  ...(token ? { Authorization: `Bearer ${token}` } : {})
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

async function getPublicRepos() {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`https://api.github.com/users/${owner}/repos?type=owner&sort=pushed&per_page=100&page=${page}`, {
      headers: apiHeaders
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub API response');
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos
    .filter(repo => !repo.private && repo.name.toLowerCase() !== siteRepo)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
}

function firstReadmeParagraph(markdown) {
  const paragraphs = [];
  let current = [];
  let inCode = false;
  let title = '';
  for (const raw of markdown.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (/^#{1,6}\s/.test(line)) {
      if (!title) title = line.replace(/^#{1,6}\s*/, '').trim();
      else if (!paragraphs.length && !current.length) break;
    }
    if (inCode || /^([#>*|]|[-*+]\s|\d+\.\s|<|!\[|---)/.test(line)) {
      if (current.length) { paragraphs.push(current.join(' ')); current = []; }
      continue;
    }
    if (!line) {
      if (current.length) { paragraphs.push(current.join(' ')); current = []; }
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(current.join(' '));
  for (const paragraph of paragraphs) {
    const plain = paragraph
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ').trim();
    if (plain.length >= 25 && !/^https?:\/\//i.test(plain)) return plain.length > 190 ? `${plain.slice(0, 187)}…` : plain;
  }
  return title.length >= 8 && !/^(README|介绍|概述|Overview)$/i.test(title) ? title : '';
}

async function addReadmeDescriptions(repos) {
  for (const repo of repos.filter(item => !item.description?.trim())) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${encodeURIComponent(repo.name)}/readme`, { headers: apiHeaders });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`README request for ${repo.name} returned ${response.status}`);
    const data = await response.json();
    if (data.encoding === 'base64' && data.content) {
      const paragraph = firstReadmeParagraph(Buffer.from(data.content, 'base64').toString('utf8'));
      if (paragraph) { repo.summary = paragraph; repo.summarySource = 'README'; }
    }
  }
}

function repoCard(repo, index) {
  const description = repo.description?.trim() || repo.summary || '暂未提供说明，可打开仓库查看文件。';
  const kind = repo.fork ? 'fork' : 'original';
  const kindLabel = repo.fork ? 'Fork / 衍生' : '原创仓库';
  const language = repo.language || '未标注语言';
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(repo.pushed_at));
  const homepage = /^https?:\/\//i.test(repo.homepage || '') ? repo.homepage : '';
  return `<article class="project-card" data-kind="${kind}" data-search="${escapeHtml(`${repo.name} ${description} ${language}`.toLowerCase())}" style="--index:${index}">
    <div class="card-top"><span class="kind ${kind}">${kindLabel}</span><span class="card-no">${String(index + 1).padStart(2, '0')}</span></div>
    <div class="card-main"><h3>${escapeHtml(repo.name)}</h3><p>${escapeHtml(description)}</p>${repo.summarySource ? '<small class="summary-source">摘自公开 README</small>' : ''}</div>
    <div class="card-bottom"><span class="language"><i aria-hidden="true"></i>${escapeHtml(language)}</span><span>更新 ${escapeHtml(date)}</span></div>
    <div class="card-links"><a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${escapeHtml(repo.name)} 的 GitHub 仓库">查看仓库 <span aria-hidden="true">↗</span></a>${homepage ? `<a href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer" aria-label="访问 ${escapeHtml(repo.name)} 的项目网站">项目网站 <span aria-hidden="true">↗</span></a>` : ''}</div>
  </article>`;
}

function atlasMarkup(originals, forks) {
  const anchors = [[25, 33], [55, 22], [76, 61], [35, 77]];
  const nodes = [
    ...originals.map((repo, i) => {
      const angle = -Math.PI / 2 + (i / originals.length) * 2 * Math.PI;
      const point = originals.length <= 4 ? anchors[i] : [50 + 27 * Math.cos(angle), 50 + 30 * Math.sin(angle)];
      return { repo, x: point[0], y: point[1], index: i, kind: 'original' };
    }),
    ...forks.map((repo, i) => {
      const angle = -Math.PI / 2 + (i / forks.length) * 2 * Math.PI;
      return { repo, x: 50 + 43 * Math.cos(angle), y: 50 + 41 * Math.sin(angle), index: originals.length + i, kind: 'fork' };
    })
  ];
  const lines = nodes.map(node => {
    const target = { x: 50, y: 50 };
    return `<line x1="${node.x * 10}" y1="${node.y * 6}" x2="${target.x * 10}" y2="${target.y * 6}" class="wire ${node.kind}"/>`;
  }).join('');
  const buttons = nodes.map(node => {
    const description = node.repo.description?.trim() || node.repo.summary || '暂未提供说明，可打开仓库查看文件。';
    return `<button class="atlas-node ${node.kind}" type="button" style="--x:${node.x}%;--y:${node.y}%;--i:${node.index}" data-name="${escapeHtml(node.repo.name)}" data-description="${escapeHtml(description)}" data-language="${escapeHtml(node.repo.language || '未标注语言')}" data-kind="${node.kind}" data-url="${escapeHtml(node.repo.html_url)}" aria-label="查看 ${escapeHtml(node.repo.name)}" aria-pressed="false"><span class="node-index">${String(node.index + 1).padStart(2, '0')}</span><span class="node-title">${escapeHtml(node.repo.name)}</span></button>`;
  }).join('\n');
  return `<svg class="atlas-wires" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${buttons}`;
}

const repos = await getPublicRepos();
if (repos.length === 0) throw new Error('No public repositories returned; keeping previous deployment');
await addReadmeDescriptions(repos);
const originals = repos.filter(repo => !repo.fork);
const forks = repos.filter(repo => repo.fork);
const languages = new Set(repos.map(repo => repo.language).filter(Boolean));
const now = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai', hour12: false }).format(new Date());
let html = await readFile(path.join(root, 'site/index.html'), 'utf8');
const assetVersion = createHash('sha256').update(await readFile(path.join(root, 'site/styles.css'))).update(await readFile(path.join(root, 'site/main.js'))).update(await readFile(path.join(root, 'site/favicon.svg'))).digest('hex').slice(0, 12);
const replacements = {
  '{{ASSET_VERSION}}': assetVersion,
  '{{REPO_COUNT}}': String(repos.length),
  '{{ORIGINAL_COUNT}}': String(originals.length),
  '{{FORK_COUNT}}': String(forks.length),
  '{{LANGUAGE_COUNT}}': String(languages.size),
  '{{UPDATED_AT}}': escapeHtml(now),
  '{{ATLAS_NODES}}': atlasMarkup(originals, forks),
  '{{PROJECT_CARDS}}': originals.map(repoCard).join('\n') + forks.map((repo, i) => repoCard(repo, originals.length + i)).join('\n')
};
for (const [key, value] of Object.entries(replacements)) html = html.replaceAll(key, value);
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'index.html'), html);
await copyFile(path.join(root, 'site/styles.css'), path.join(out, 'styles.css'));
await copyFile(path.join(root, 'site/main.js'), path.join(out, 'main.js'));
await copyFile(path.join(root, 'site/favicon.svg'), path.join(out, 'favicon.svg'));
await writeFile(path.join(out, '.nojekyll'), '');
console.log(`Built ${repos.length} public repositories (${originals.length} original, ${forks.length} forks) at ${now} CST`);
