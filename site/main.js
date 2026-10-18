const buttons = [...document.querySelectorAll('.filter')];
const cards = [...document.querySelectorAll('.project-card')];
const search = document.querySelector('#project-search');
const empty = document.querySelector('#empty-state');
const count = document.querySelector('#result-count');
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
document.querySelector('#year').textContent = new Date().getFullYear();
updateCards();
