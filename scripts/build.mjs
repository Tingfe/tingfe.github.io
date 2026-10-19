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

async function githubGet(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: apiHeaders, signal: AbortSignal.timeout(20_000) });
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return response;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

async function getPublicRepos() {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const response = await githubGet(`https://api.github.com/users/${owner}/repos?type=owner&sort=pushed&per_page=100&page=${page}`);
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

async function readPublicFile(repo, fileName) {
  const filePath = fileName.split('/').map(encodeURIComponent).join('/');
  const response = await githubGet(`https://api.github.com/repos/${owner}/${encodeURIComponent(repo.name)}/contents/${filePath}`);
  if (response.status === 404) return '';
  if (!response.ok) throw new Error(`File request for ${repo.name}/${fileName} returned ${response.status}`);
  const data = await response.json();
  return data.encoding === 'base64' && data.content ? Buffer.from(data.content, 'base64').toString('utf8') : '';
}

function manifestDescription(fileName, content) {
  const clean = value => {
    if (typeof value !== 'string') return '';
    const summary = value.replace(/\s+/g, ' ').trim();
    if (!summary || /^[>|-]$/.test(summary) || /^https?:\/\//i.test(summary)) return '';
    return summary.length > 190 ? `${summary.slice(0, 187)}…` : summary;
  };
  if (/^(package|composer)\.json$/i.test(fileName)) {
    try { return clean(JSON.parse(content).description); } catch { return ''; }
  }
  if (/^(pyproject|Cargo)\.toml$/i.test(fileName)) {
    const section = fileName.toLowerCase() === 'cargo.toml' ? 'package' : 'project';
    let inProjectSection = false;
    for (const line of content.split('\n')) {
      const heading = line.match(/^\[([^\]]+)\]/);
      if (heading) inProjectSection = heading[1] === section;
      if (inProjectSection) {
        const description = line.match(/^description\s*=\s*["']([^"'\n]+)["']/)?.[1];
        if (description) return clean(description);
      }
    }
    return '';
  }
  if (/^pubspec\.yaml$/i.test(fileName)) {
    return clean(content.match(/^description:\s*["']?([^\n"']+)/m)?.[1]);
  }
  return '';
}

function isTranslationTable(content) {
  return content.split('\n').slice(0, 60).filter(line => {
    const columns = line.split('\t');
    return columns.length >= 3 && /[\u3400-\u9fff]/u.test(columns[2]);
  }).length >= 5;
}

async function summarizePublicFiles(repo) {
  const response = await githubGet(`https://api.github.com/repos/${owner}/${encodeURIComponent(repo.name)}/contents`);
  if (response.status === 404) return { text: '公开仓库暂无可分析的文件，项目用途有待补充。', source: 'FILES' };
  if (!response.ok) throw new Error(`Contents request for ${repo.name} returned ${response.status}`);
  const entries = await response.json();
  if (!Array.isArray(entries) || entries.length === 0) return { text: '公开仓库暂无可分析的文件，项目用途有待补充。', source: 'FILES' };
  const files = entries.filter(entry => entry.type === 'file');
  const names = files.map(entry => entry.name);
  for (const fileName of ['package.json', 'pyproject.toml', 'Cargo.toml', 'pubspec.yaml', 'composer.json']) {
    const file = files.find(entry => entry.name === fileName && entry.size <= 100_000);
    if (!file) continue;
    const description = manifestDescription(fileName, await readPublicFile(repo, fileName));
    if (description) return { text: description, source: 'CONFIG' };
  }
  const chineseText = files.find(entry => entry.name.toLowerCase() === 'zh.txt' && entry.size <= 150_000);
  const englishFiles = files.filter(entry => /^en\d*\.txt$/i.test(entry.name));
  if (chineseText && englishFiles.length && isTranslationTable(await readPublicFile(repo, chineseText.name))) {
    const projectName = repo.name.replace(/^vmix(\d+)_zh$/i, 'vMix $1');
    return { text: `${projectName} 的中英界面词条对照文件，包含 zh.txt 与 ${englishFiles.length} 个英文文本文件。`, source: 'FILES' };
  }
  const sample = names.slice(0, 3);
  if (sample.length) return { text: `公开文件包括 ${sample.join('、')}${names.length > sample.length ? ' 等' : ''}；仓库暂未说明项目用途。`, source: 'FILES' };
  const directories = entries.filter(entry => entry.type === 'dir').map(entry => entry.name);
  return { text: directories.length ? `公开目录包括 ${directories.slice(0, 3).join('、')}；仓库暂未说明项目用途。` : '公开仓库暂无可分析的文件，项目用途有待补充。', source: 'FILES' };
}

async function addGeneratedDescriptions(repos) {
  for (const repo of repos.filter(item => !item.description?.trim())) {
    const response = await githubGet(`https://api.github.com/repos/${owner}/${encodeURIComponent(repo.name)}/readme`);
    if (response.status !== 404) {
      if (!response.ok) throw new Error(`README request for ${repo.name} returned ${response.status}`);
      const data = await response.json();
      if (data.encoding === 'base64' && data.content) {
        const paragraph = firstReadmeParagraph(Buffer.from(data.content, 'base64').toString('utf8'));
        if (paragraph) { repo.summary = paragraph; repo.summarySource = 'README'; }
      }
    }
    if (!repo.summary) {
      const generated = await summarizePublicFiles(repo);
      repo.summary = generated.text;
      repo.summarySource = generated.source;
    }
  }
}

const summaryLabel = (source) => source === 'README' ? '摘自公开 README' : source === 'CONFIG' ? '摘自项目配置' : source === 'FILES' ? '根据公开文件生成' : '';

function repoCard(repo, index) {
  const description = repo.description?.trim() || repo.summary || '暂未提供说明，可打开仓库查看文件。';
  const kind = repo.fork ? 'fork' : 'original';
  const kindLabel = repo.fork ? 'Fork / 衍生' : '原创仓库';
  const language = repo.language || '未标注语言';
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(repo.pushed_at));
  const homepage = /^https?:\/\//i.test(repo.homepage || '') ? repo.homepage : '';
  return `<article class="project-card" data-kind="${kind}" data-search="${escapeHtml(`${repo.name} ${description} ${language}`.toLowerCase())}" style="--index:${index}">
    <div class="card-top"><span class="kind ${kind}">${kindLabel}</span><span class="card-no">${String(index + 1).padStart(2, '0')}</span></div>
    <div class="card-main"><h3>${escapeHtml(repo.name)}</h3><p>${escapeHtml(description)}</p>${repo.summarySource ? `<small class="summary-source">${summaryLabel(repo.summarySource)}</small>` : ''}</div>
    <div class="card-bottom"><span class="language"><i aria-hidden="true"></i>${escapeHtml(language)}</span><span>更新 ${escapeHtml(date)}</span></div>
    <div class="card-links"><a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${escapeHtml(repo.name)} 的 GitHub 仓库">查看仓库 <span aria-hidden="true">↗</span></a>${homepage ? `<a href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer" aria-label="访问 ${escapeHtml(repo.name)} 的项目网站">项目网站 <span aria-hidden="true">↗</span></a>` : ''}</div>
  </article>`;
}

function atlasMarkup(originals, forks) {
  return [...originals, ...forks].map((repo, index) => {
    const kind = repo.fork ? 'fork' : 'original';
    const description = repo.description?.trim() || repo.summary || '暂未提供说明，可打开仓库查看文件。';
    return `<button class="atlas-node ${kind}" type="button" data-name="${escapeHtml(repo.name)}" data-description="${escapeHtml(description)}" data-summary-source="${summaryLabel(repo.summarySource)}" data-language="${escapeHtml(repo.language || '未标注语言')}" data-kind="${kind}" data-url="${escapeHtml(repo.html_url)}" aria-label="查看 ${escapeHtml(repo.name)}" aria-pressed="false"><span class="node-index">${String(index + 1).padStart(2, '0')}</span><span class="node-title">${escapeHtml(repo.name)}</span><span class="node-kind">${kind === 'original' ? '原创' : 'Fork'}</span></button>`;
  }).join('\n');
}

function featuredCard(repo) {
  if (!repo) return '<p class="feature-empty">新的原创项目会出现在这里。</p>';
  const description = repo.description?.trim() || repo.summary || '暂未提供说明，可打开仓库查看文件。';
  return `<div class="feature-card"><span class="feature-label">公开仓库 / ${escapeHtml(repo.language || '未标注语言')}</span><h2>${escapeHtml(repo.name)}</h2><p>${escapeHtml(description)}</p>${repo.summarySource ? `<small class="summary-source">${summaryLabel(repo.summarySource)}</small>` : ''}<a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer">查看这个项目 <span aria-hidden="true">↗</span></a></div>`;
}

const repos = await getPublicRepos();
if (repos.length === 0) throw new Error('No public repositories returned; keeping previous deployment');
await addGeneratedDescriptions(repos);
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
  '{{FEATURED_CARD}}': featuredCard(originals[0]),
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
