/* THROWAWAY UI experiment, based on checkpoint 7f583fa variant A.
 * Three structurally different navigation panels on the existing route,
 * switchable via ?variant=A|B|C. Data and all edits stay in this tab's memory.
 * Navigation choices below are hypotheses for comparison, not product decisions.
 */
(() => {
  const original = { newEntryMarkup, elementDetailMarkup, bottomNavigationAMarkup };
  const nav = {
    variant: ['A', 'B', 'C'].includes(requestedVariant) ? requestedVariant : 'A',
    names: { A: 'Над содержимым', B: 'Панель снизу', C: 'Контекст сбоку' },
    focus: [], frames: [], index: 0, expanded: false, height: 150,
    primary: 'refine', metric: 'elements', fixture: routeParams.get('fixture') === 'dag',
    session: `dag-${Date.now()}`, pendingNotice: null
  };
  state.variant = 'A';
  state.stage = 'empty';
  state.activeSelectionId = null;
  state.activeElementId = null;
  state.creationContext = null;

  const normalize = tags => parseSelectionTags(tags.join(','));
  const tagKey = tag => normalizeTagName(tag);
  const without = (tags, tag) => tags.filter(item => tagKey(item) !== tagKey(tag));
  const matches = tags => elementsForSelection({ tags });
  const blankDraft = () => ({ elementTitle: '', elementContent: '', elementTags: '', selectionName: '', selectionTags: '' });
  const sameTags = (a, b) => selectionFilterKey(a) === selectionFilterKey(b);
  const selectionByTags = tags => state.selections.find(item => sameTags(item.tags, tags));
  const clone = value => JSON.parse(JSON.stringify(value));

  activeSelection = () => {
    const saved = state.selections.find(item => item.id === state.activeSelectionId);
    if (saved) return saved;
    if (state.stage === 'selection' || (state.stage === 'element' && nav.focus.length)) {
      return { id: null, name: nav.focus.join(' + '), tags: [...nav.focus] };
    }
    return null;
  };

  function snapshot() {
    return {
      stage: state.stage, selectionId: state.activeSelectionId,
      elementId: state.activeElementId, tags: [...nav.focus],
      creationContext: state.creationContext, creationMode: state.creationMode,
      draft: clone(state.entryDraft), scroll: app.querySelector('.screen')?.scrollTop || 0
    };
  }

  function frameName(frame) {
    if (frame.stage === 'empty') return 'Всё';
    if (frame.stage === 'new-entry') return 'Добавление';
    if (frame.stage === 'element') return state.elements.find(item => item.id === frame.elementId)?.title || 'Элемент';
    return state.selections.find(item => item.id === frame.selectionId)?.name || frame.tags.join(' + ');
  }

  function restore(frame) {
    state.stage = frame.stage;
    state.activeSelectionId = frame.selectionId || null;
    state.activeElementId = frame.elementId || null;
    state.creationContext = frame.creationContext || null;
    state.creationParentId = frame.creationContext?.id || null;
    state.creationMode = frame.creationMode || 'element';
    state.entryDraft = clone(frame.draft || blankDraft());
    state.selectionRouteIds = [];
    state.entryFormError = null;
    state.notice = nav.pendingNotice;
    nav.pendingNotice = null;
    state.lastIntent = null;
    nav.focus = [...frame.tags];
    nav.expanded = false;
  }

  function currentUrl() {
    const url = new URL(location.href);
    ['path', 'stage', 'selection', 'element', 'tags'].forEach(key => url.searchParams.delete(key));
    url.searchParams.set('variant', nav.variant);
    if (nav.fixture) url.searchParams.set('fixture', 'dag');
    else url.searchParams.delete('fixture');
    if (state.stage !== 'empty') url.searchParams.set('stage', state.stage);
    if (state.activeSelectionId) url.searchParams.set('selection', state.activeSelectionId);
    else if (nav.focus.length) url.searchParams.set('tags', JSON.stringify(nav.focus));
    if (state.activeElementId) url.searchParams.set('element', state.activeElementId);
    return url;
  }

  syncVariantRoute = () => history.replaceState({ dagSession: nav.session, index: nav.index }, '', currentUrl());

  function visit(frame, replace = false) {
    nav.frames[nav.index] = snapshot();
    restore(frame);
    if (replace) nav.frames[nav.index] = clone(frame);
    else {
      nav.frames = nav.frames.slice(0, nav.index + 1);
      nav.frames.push(clone(frame));
      nav.index += 1;
    }
    history[replace ? 'replaceState' : 'pushState']({ dagSession: nav.session, index: nav.index }, '', currentUrl());
    render();
  }

  function scopeFrame(tags, selectionId = null) {
    return { stage: selectionId || tags.length ? 'selection' : 'empty', tags, selectionId, elementId: null, scroll: 0 };
  }

  function navigateTags(tags) {
    tags = normalize(tags);
    const target = tags.length ? selectionByTags(tags) : null;
    const frame = scopeFrame(tags, target?.id || null);
    if (frame.stage === state.stage && sameTags(nav.focus, tags) && frame.selectionId === state.activeSelectionId) return;
    visit(frame);
  }

  function back() { if (nav.index > 0) history.back(); }

  function finishAtOrigin(notice = null) {
    if (nav.index === 0) { nav.pendingNotice = notice; visit(scopeFrame([], null), true); return; }
    const origin = clone(nav.frames[nav.index - 1]);
    // Submitted forms must not reappear on Forward. Mutations remain in memory.
    visit(origin, true);
    nav.pendingNotice = notice;
    back();
  }

  window.addEventListener('popstate', event => {
    if (event.state?.dagSession !== nav.session || !nav.frames[event.state.index]) return;
    nav.frames[nav.index] = snapshot();
    nav.index = event.state.index;
    const frame = nav.frames[nav.index];
    restore(frame);
    syncVariantRoute();
    render();
    requestAnimationFrame(() => { const screen = app.querySelector('.screen'); if (screen) screen.scrollTop = frame.scroll || 0; });
  });

  function describeState() {
    return {
      variant: nav.variant, stage: state.stage, navigationTags: nav.focus,
      selectionId: state.activeSelectionId, elementId: state.activeElementId,
      history: nav.frames.slice(0, nav.index + 1).map(frameName),
      primaryAction: nav.primary, weight: nav.metric, cloudHeight: nav.height,
      selections: state.selections, elements: state.elements
    };
  }

  headerMarkup = () => {
    const title = state.stage === 'new-entry' ? 'Добавление' : state.stage === 'element' ? 'Элемент' : 'Мои подборки';
    const source = nav.index ? frameName(nav.frames[nav.index - 1]) : '';
    return `<header class="app-header dag-header">
      <button type="button" class="a-flow-back dag-back" data-dag-back aria-label="${escapeHTML(source ? `Назад: ${source}` : 'Назад') }" ${nav.index ? '' : 'disabled'}>←</button>
      <button type="button" class="dag-home" data-dag-all ${state.stage === 'empty' ? 'aria-current="page"' : ''}>Всё</button>
      <span class="a-header-title">${title}</span>
      ${['empty', 'selection'].includes(state.stage) ? '<button type="button" class="a-header-add" data-start-entry aria-label="Добавить элемент или подборку">＋</button>' : '<span style="width:44px"></span>'}
    </header>`;
  };

  newEntryBreadcrumbsMarkup = () => state.creationContext
    ? `<p class="dag-origin">В контексте: ${escapeHTML(state.creationContext.name)}</p>` : '';
  elementBreadcrumbsMarkup = () => `<p class="dag-origin">Из: ${escapeHTML(nav.index ? frameName(nav.frames[nav.index - 1]) : 'Всё')}</p>`;
  selectionBreadcrumbsMarkup = () => '';

  function cloudCandidates() {
    const descendants = state.stage === 'empty' ? state.selections : state.selections.filter(item => isStrictlyBroader({ tags: nav.focus }, item));
    const selected = new Set(nav.focus.map(tagKey));
    const tags = normalize(descendants.flatMap(item => item.tags)).filter(tag => !selected.has(tagKey(tag)));
    return tags.map(tag => {
      const target = normalize([...nav.focus, tag]);
      const nodes = descendants.filter(item => item.tags.some(value => tagKey(value) === tagKey(tag))).length;
      return { tag, elements: matches(target).length, nodes };
    }).sort((a, b) => b[nav.metric] - a[nav.metric] || a.tag.localeCompare(b.tag, 'ru'));
  }

  function tagMarkup(tag, selected, count, size) {
    const main = nav.primary === 'switch' ? 'switch' : selected ? 'remove' : 'add';
    const other = nav.primary === 'switch' ? selected ? 'remove' : 'add' : 'switch';
    const labels = { switch: `Только «${tag}»`, add: `Добавить тег «${tag}»`, remove: `Снять тег «${tag}»` };
    const glyphs = { switch: '↗', add: '＋', remove: '×' };
    const resultCount = action => matches(action === 'switch' ? [tag] : action === 'add' ? normalize([...nav.focus, tag]) : without(nav.focus, tag)).length;
    return `<span class="dag-tag" style="--tag-size:${size}px" data-zero="${count === 0}">
      <button class="dag-tag-main" type="button" data-dag-action="${main}" data-tag="${escapeHTML(tag)}" aria-label="${escapeHTML(labels[main])}" title="${escapeHTML(labels[main])} · ${pluralElements(resultCount(main))}">
        <span aria-hidden="true" style="font-size:12px;opacity:.6">${glyphs[main]}</span><span class="dag-tag-word">${escapeHTML(tag)}</span>${selected ? '' : `<small>${count}</small>`}
      </button>
      <button class="dag-tag-other" type="button" data-dag-action="${other}" data-tag="${escapeHTML(tag)}" aria-label="${escapeHTML(labels[other])}" title="${escapeHTML(labels[other])} · ${pluralElements(resultCount(other))}">${glyphs[other]}</button>
    </span>`;
  }

  function selectedMarkup() {
    return `<div class="dag-selected-zone"><p class="dag-panel-label"><span>ВЫБРАНО</span><span aria-hidden="true">↑</span></p><div class="dag-selected">
      ${nav.focus.length ? nav.focus.map(tag => tagMarkup(tag, true, matches(without(nav.focus, tag)).length, 13)).join('') : '<span class="dag-all-label">Все теги</span>'}
    </div></div>`;
  }

  function cloudMarkup() {
    const candidates = cloudCandidates();
    const max = Math.max(1, ...candidates.map(item => item[nav.metric]));
    return `<div class="dag-cloud-zone"><p class="dag-panel-label"><span>УТОЧНИТЬ</span><span aria-hidden="true">↓</span></p>
      <div class="dag-cloud ${nav.expanded ? 'is-expanded' : ''}" aria-label="Теги уточняющих подборок">
        ${candidates.length ? candidates.map(item => tagMarkup(item.tag, false, item[nav.metric], Math.round(13 + 11 * Math.log1p(item[nav.metric]) / Math.log1p(max)))).join('') : '<p class="dag-cloud-empty">Уточняющих подборок пока нет</p>'}
      </div>
      <button type="button" class="dag-more" data-dag-more hidden>Показать все теги</button>
    </div>`;
  }

  function legendMarkup() { return '<p class="dag-legend">＋ добавить тег · × снять · ↗ только этот тег</p>'; }
  function VariantA() { return `<section class="dag-panel" aria-label="Навигация по тегам">${selectedMarkup()}${cloudMarkup()}${legendMarkup()}</section>`; }
  function VariantB() { return `<section class="dag-panel dag-bottom-panel" aria-label="Навигация по тегам">${selectedMarkup()}${cloudMarkup()}${legendMarkup()}</section>`; }
  function VariantC() { return `<section class="dag-panel dag-columns-panel" aria-label="Навигация по тегам">${selectedMarkup()}${cloudMarkup()}${legendMarkup()}</section>`; }

  function scopeMarkup() {
    const all = state.stage === 'empty';
    const scope = activeSelection();
    const children = all ? semanticRoots() : directSemanticChildren(scope);
    const relevant = all ? state.elements : matches(nav.focus);
    const visible = elementsOutsideSelections(relevant, children);
    const title = all ? 'Мои подборки' : scope?.id ? scope.name : 'По выбранным тегам';
    const heading = `<div class="dag-heading"><h1>${escapeHTML(title)}</h1><p>${pluralElements(relevant.length)}</p></div>`;
    const content = `<div class="dag-results">${children.map(item => selectionRowMarkup(item, all)).join('')}</div>
      ${visible.length ? `<section class="dag-elements"><h2>Элементы</h2>${elementsListMarkup(visible)}</section>` : ''}
      ${!children.length && !visible.length ? `<div class="dag-empty">${all ? 'Здесь появятся ваши подборки и элементы' : 'Пока нет подходящих элементов'}${all ? '<button class="primary-action" type="button" data-start-entry>Добавить</button>' : ''}</div>` : ''}`;
    const panel = !state.selections.length && !nav.focus.length ? '' : nav.variant === 'B' ? VariantB() : nav.variant === 'C' ? VariantC() : VariantA();
    return nav.variant === 'B'
      ? `<section class="screen dag-screen">${noticeMarkup()}${heading}${content}</section>${panel}${original.bottomNavigationAMarkup()}`
      : `<section class="screen dag-screen">${noticeMarkup()}${heading}${panel}${content}</section>${original.bottomNavigationAMarkup()}`;
  }

  function fitCloud() {
    const cloud = app.querySelector('.dag-cloud');
    const more = app.querySelector('[data-dag-more]');
    if (!cloud || !more) return;
    if (nav.expanded) { more.hidden = false; more.textContent = 'Свернуть облако'; return; }
    const bottom = cloud.getBoundingClientRect().bottom;
    const overflow = [...cloud.children].filter(child => child.classList.contains('dag-tag') && child.getBoundingClientRect().bottom > bottom + 1);
    overflow.forEach(child => { child.hidden = true; });
    const hidden = overflow.length;
    more.hidden = hidden === 0;
    more.textContent = `Ещё ${hidden} тегов`;
  }

  render = () => {
    document.body.dataset.variant = 'A';
    document.body.dataset.navigation = nav.variant;
    app.style.setProperty('--cloud-height', `${nav.height}px`);
    const content = state.stage === 'new-entry' ? original.newEntryMarkup()
      : state.stage === 'element' ? original.elementDetailMarkup() : scopeMarkup();
    app.innerHTML = headerMarkup() + content;
    variantLabel.textContent = `${nav.variant} · ${nav.names[nav.variant]}`;
    stateSummary.textContent = `${state.selections.length} подборок · ${state.elements.length} элементов · в памяти`;
    renderIntent();
    requestAnimationFrame(fitCloud);
  };

  setVariant = variant => {
    nav.frames[nav.index] = snapshot();
    nav.variant = variant;
    syncVariantRoute();
    render();
    console.info('DAG prototype state', clone(describeState()));
  };
  cycleVariant = direction => setVariant(['A', 'B', 'C'][(['A', 'B', 'C'].indexOf(nav.variant) + direction + 3) % 3]);

  function loadFixture() {
    const rows = [
      ['films', 'Фильмы', 'фильм'], ['calm', 'Спокойное', 'спокойное'], ['music', 'Музыка', 'музыка'], ['books', 'Книги', 'книга'],
      ['calm-films', 'Спокойные фильмы', 'фильм, спокойное'], ['evening-films', 'Фильмы на вечер', 'фильм, вечер'],
      ['evening', 'На вечер', 'фильм, спокойное, вечер'], ['short', 'Короткий метр', 'фильм, короткое'],
      ['doc', 'Документальное кино', 'фильм, документальное'], ['japan', 'Японская анимация', 'фильм, анимация, япония'],
      ['calm-music', 'Спокойная музыка', 'музыка, спокойное'], ['piano', 'Фортепиано', 'музыка, спокойное, фортепиано'],
      ['nature', 'О природе', 'фильм, документальное, природа'], ['calm-books', 'Книги для отдыха', 'книга, спокойное'],
      ['zero', 'На французском', 'фильм, французский']
    ];
    let deep = ['фильм', 'спокойное', 'вечер'];
    ['любимое', 'выходные', 'дома', 'с друзьями', 'осень', 'субтитры', 'повторный просмотр', 'без спешки'].forEach((tag, i) => {
      deep = [...deep, tag]; rows.push([`deep-${i}`, `На вечер · ${tag}`, deep.join(', ')]);
    });
    rows.push(['long', 'Неспешные истории о путешествиях и повседневной жизни', 'фильм, истории о путешествиях и повседневной жизни']);
    state.selections = rows.map(([id, name, tags]) => ({ id, name, tags: parseSelectionTags(tags) }));
    state.elements = [
      { id: 'untagged', title: 'Заметка без тегов', content: 'Этот элемент виден в «Всё», пока нет подборки с пустым фильтром.', tags: [] },
      { id: 'animation-without-node', title: 'Анимация без уточняющей подборки', content: 'Соответствует набору фильм + анимация, но не японской анимации.', tags: ['фильм', 'анимация'] },
      { id: 'deep-element', title: 'Идеальный вечер', content: 'Один элемент входит во все подходящие подборки и считается один раз.', tags: deep }
    ];
    const titles = ['Тихий берег', 'Осенний город', 'Письма домой', 'Небольшое путешествие', 'После дождя', 'Утро в саду', 'Дальний свет', 'Лето у моря', 'История леса', 'Голоса города', 'Полчаса тишины', 'Дорога на север', 'Птицы над рекой', 'За окном', 'Первый снег', 'Японские зарисовки'];
    titles.forEach((title, i) => {
      const tags = ['фильм'];
      if (i < 10) tags.push('спокойное');
      if (i % 3 === 0) tags.push('вечер');
      if (i % 4 === 0) tags.push('документальное');
      if (i % 5 === 0) tags.push('короткое');
      if (i === 8) tags.push('природа');
      if (i === 15) tags.push('анимация', 'япония');
      state.elements.push({ id: `film-${i}`, title, content: `Демонстрационная запись «${title}».`, tags });
    });
    for (let i = 0; i < 5; i += 1) state.elements.push({ id: `music-${i}`, title: `Тихая мелодия ${i + 1}`, content: 'Запись для примера.', tags: ['музыка', 'спокойное', ...(i < 2 ? ['фортепиано'] : [])] });
    state.elements.push({ id: 'book', title: 'Книга для отдыха', content: 'Запись для примера.', tags: ['книга', 'спокойное'] });
    state.personalSpace = { elementCount: state.elements.length, selectionCount: state.selections.length };
  }

  const lab = document.createElement('dialog');
  lab.className = 'dag-lab';
  lab.setAttribute('aria-label', 'Настройки эксперимента');
  document.body.append(lab);
  const labButton = document.createElement('button');
  labButton.type = 'button'; labButton.className = 'dag-lab-button'; labButton.dataset.dagLab = '';
  labButton.setAttribute('aria-label', 'Настройки эксперимента'); labButton.textContent = '☷';
  document.querySelector('.prototype-switcher').append(labButton);
  document.querySelector('.prototype-switcher').setAttribute('aria-label', 'Варианты DAG-навигации');

  function showLab() {
    lab.innerHTML = `<h2>Эксперимент с навигацией</h2><p>Данные живут только в этой вкладке. Загрузка примера заменит текущее содержимое вкладки. Варианты A/B/C меняют только компоновку.</p>
      <div class="dag-lab-actions"><button type="button" data-fixture="dag">Загрузить пример DAG</button><button type="button" data-fixture="empty">Начать с пустого</button></div>
      <label>Высота облака<select data-lab-height>${[100, 150, 230].map(value => `<option value="${value}" ${nav.height === value ? 'selected' : ''}>${value} px</option>`).join('')}</select></label>
      <label>Размер тега<select data-lab-metric><option value="elements" ${nav.metric === 'elements' ? 'selected' : ''}>По релевантным элементам</option><option value="nodes" ${nav.metric === 'nodes' ? 'selected' : ''}>По явно заданным подборкам</option></select></label>
      <label>Обычное касание<select data-lab-primary><option value="refine" ${nav.primary === 'refine' ? 'selected' : ''}>Добавить / снять тег</option><option value="switch" ${nav.primary === 'switch' ? 'selected' : ''}>Переключиться на один тег</option></select></label>
      <p>В облаке вес по элементам считает результат добавления тега. Выбранные теги имеют одинаковый размер. ↗ переключает контекст на один тег.</p>
      <details><summary>Состояние эксперимента</summary><pre>${escapeHTML(JSON.stringify(describeState(), null, 2))}</pre></details>
      <button type="button" data-close-lab>Вернуться к панели</button>`;
    if (!lab.open) lab.showModal();
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    const handled = target.matches('[data-previous-variant], [data-next-variant], [data-dag-back], [data-dag-all], [data-dag-action], [data-dag-more], [data-dag-lab], [data-fixture], [data-close-lab], [data-start-entry], [data-cancel-new-entry], [data-open-element], [data-open-selection], [data-step-back-element], [data-step-back-selection], [data-open-selections]');
    if (!handled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.hasAttribute('data-previous-variant')) cycleVariant(-1);
    else if (target.hasAttribute('data-next-variant')) cycleVariant(1);
    else if (target.matches('[data-dag-back], [data-step-back-element], [data-step-back-selection], [data-cancel-new-entry]')) back();
    else if (target.matches('[data-dag-all], [data-open-selections]')) { if (state.stage !== 'empty') visit(scopeFrame([])); }
    else if (target.hasAttribute('data-dag-action')) {
      const tag = target.dataset.tag;
      navigateTags(target.dataset.dagAction === 'switch' ? [tag] : target.dataset.dagAction === 'add' ? [...nav.focus, tag] : without(nav.focus, tag));
    } else if (target.hasAttribute('data-dag-more')) { nav.expanded = !nav.expanded; render(); }
    else if (target.hasAttribute('data-dag-lab')) showLab();
    else if (target.hasAttribute('data-close-lab')) lab.close();
    else if (target.hasAttribute('data-fixture')) {
      nav.fixture = target.dataset.fixture === 'dag';
      if (nav.fixture) loadFixture(); else { state.elements = []; state.selections = []; state.personalSpace = { elementCount: 0, selectionCount: 0 }; }
      nav.session = `dag-${Date.now()}`; nav.index = 0; nav.frames = [scopeFrame([])];
      restore(nav.frames[0]); syncVariantRoute(); lab.close(); render();
    } else if (target.hasAttribute('data-start-entry')) {
      const parent = state.stage === 'selection' ? activeSelection() : null;
      const frame = { ...snapshot(), stage: 'new-entry', creationContext: parent ? clone(parent) : null, creationMode: 'element', draft: blankDraft(), elementId: null, scroll: 0 };
      visit(frame);
      requestAnimationFrame(() => app.querySelector('[name="elementTitle"]')?.focus());
    } else if (target.hasAttribute('data-open-selection')) {
      const selection = state.selections.find(item => item.id === target.dataset.openSelection);
      if (selection) visit(scopeFrame([...selection.tags], selection.id));
    } else if (target.hasAttribute('data-open-element')) {
      visit({ ...snapshot(), stage: 'element', elementId: target.dataset.openElement, scroll: 0 });
    }
  }, true);

  document.addEventListener('submit', event => {
    if (!event.target.matches('[data-new-entry-form], [data-element-detail-form]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const fields = event.target.elements;
    if (event.target.matches('[data-element-detail-form]')) {
      const element = activeElement();
      if (!element) return;
      const title = fields.elementTitle.value.trim();
      if (!title) { fields.elementTitle.focus(); return; }
      element.title = title;
      element.content = fields.elementContent.value.trim();
      element.tags = parseSelectionTags(fields.elementTags.value);
      finishAtOrigin({ type: 'element-updated', title: element.title });
      return;
    }
    const parent = state.creationContext;
    if (state.creationMode === 'element') {
      const title = fields.elementTitle.value.trim();
      if (!title) { fields.elementTitle.focus(); return; }
      const tags = normalize([...(parent?.tags || []), ...parseSelectionTags(fields.elementTags.value)]);
      state.elements.push({ id: nextId('element'), title, content: fields.elementContent.value.trim(), tags });
      state.personalSpace.elementCount = state.elements.length;
      finishAtOrigin({ type: 'element-created', title });
      return;
    }
    const name = fields.selectionName.value.trim();
    if (!name) { fields.selectionName.focus(); return; }
    const tags = normalize([...(parent?.tags || []), ...parseSelectionTags(fields.selectionTags.value)]);
    if (parent && !isStrictlyBroader(parent, { tags })) {
      state.entryFormError = 'Добавьте хотя бы один новый тег — фильтр должен быть конкретнее родительского.';
      render(); return;
    }
    const duplicate = selectionByTags(tags);
    if (duplicate) {
      nav.pendingNotice = { type: 'duplicate-filter' };
      visit(scopeFrame([...duplicate.tags], duplicate.id), true);
      return;
    }
    const selection = { id: nextId('selection'), name, tags };
    state.selections.push(selection);
    state.personalSpace.selectionCount = state.selections.length;
    if (parent) visit(scopeFrame(tags, selection.id), true);
    else finishAtOrigin();
  }, true);

  document.addEventListener('change', event => {
    if (event.target.hasAttribute('data-lab-height')) nav.height = Number(event.target.value);
    else if (event.target.hasAttribute('data-lab-metric')) nav.metric = event.target.value;
    else if (event.target.hasAttribute('data-lab-primary')) nav.primary = event.target.value;
    else return;
    render();
  });

  document.addEventListener('keydown', event => {
    const editing = event.target.matches('input, textarea, select, [contenteditable]');
    if (lab.open) { if (event.key === 'Escape') event.stopImmediatePropagation(); return; }
    if (editing && event.key !== 'Escape') return;
    if (['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') back();
      else cycleVariant(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }, true);

  window.addEventListener('resize', () => { if (['empty', 'selection'].includes(state.stage)) render(); });

  if (nav.fixture) loadFixture();
  const requestedSelection = state.selections.find(item => item.id === routeParams.get('selection'));
  let initialTags = [];
  try { const parsed = JSON.parse(routeParams.get('tags') || '[]'); if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) initialTags = normalize(parsed); } catch { /* An invalid prototype URL starts at Everything. */ }
  const initial = requestedSelection ? scopeFrame([...requestedSelection.tags], requestedSelection.id) : scopeFrame(initialTags, selectionByTags(initialTags)?.id && initialTags.length ? selectionByTags(initialTags).id : null);
  restore(initial); nav.frames = [snapshot()]; syncVariantRoute(); render();
  console.info('DAG prototype state', clone(describeState()));
})();
