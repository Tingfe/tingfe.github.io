const buttons = [...document.querySelectorAll('.filter')];
const cards = [...document.querySelectorAll('.project-card')];
const search = document.querySelector('#project-search');
const empty = document.querySelector('#empty-state');
const count = document.querySelector('#result-count');
const nodes = [...document.querySelectorAll('.atlas-node')];
const stage = document.querySelector('#atlas-stage');
const panel = document.querySelector('.node-panel');
let activeFilter = 'all';

function updateCards() {
  const query = search.value.trim().toLocaleLowerCase();
  let visible = 0;
  for (const card of cards) {
    const show = (activeFilter === 'all' || card.dataset.kind === activeFilter) && (!query || card.dataset.search.includes(query));
    card.hidden = !show;
    if (show) visible += 1;
  }
  empty.hidden = visible !== 0;
  count.textContent = `显示 ${visible} / ${cards.length} 个公开仓库`;
}

function selectNode(node, scrollOnMobile = false) {
  nodes.forEach(item => {
    const selected = item === node;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('#panel-index').textContent = `${String(nodes.indexOf(node) + 1).padStart(2, '0')} / ${String(nodes.length).padStart(2, '0')}`;
  document.querySelector('#panel-name').textContent = node.dataset.name;
  document.querySelector('#panel-description').textContent = node.dataset.description;
  document.querySelector('#panel-language').textContent = node.dataset.language.toUpperCase();
  const kind = document.querySelector('#panel-kind');
  kind.textContent = node.dataset.kind === 'original' ? 'ORIGINAL / 原创' : 'FORK / 衍生';
  kind.classList.toggle('fork', node.dataset.kind === 'fork');
  const link = document.querySelector('#panel-link');
  link.href = node.dataset.url;
  link.setAttribute('aria-label', `打开 ${node.dataset.name} 的 GitHub 仓库`);
  if (scrollOnMobile && window.matchMedia('(max-width: 760px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

buttons.forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  buttons.forEach(item => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  updateCards();
}));
search.addEventListener('input', updateCards);
document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement !== search && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    search.focus();
  }
});
nodes.forEach((node, index) => {
  node.addEventListener('click', () => selectNode(node, true));
  node.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault(); nodes[(index + 1) % nodes.length].focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault(); nodes[(index - 1 + nodes.length) % nodes.length].focus();
    }
  });
});
if (nodes.length) selectNode(nodes[0]);
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  stage.addEventListener('pointermove', event => {
    const rect = stage.getBoundingClientRect();
    stage.style.setProperty('--px', `${((event.clientX - rect.left) / rect.width) * 100}%`);
    stage.style.setProperty('--py', `${((event.clientY - rect.top) / rect.height) * 100}%`);
  });
}
document.querySelector('#year').textContent = new Date().getFullYear();
updateCards();
