(function () {
  'use strict';
  // THROWAWAY: results-first host, one user-selected overlay layout, no persistence.
  var scenarios = window.dagNavigationScenarios;
  var select = document.getElementById('hostScenario');
  var drawer = document.getElementById('filterDrawer');
  var grip = document.getElementById('drawerGrip');
  var body = document.getElementById('drawerBody');
  var mount = document.getElementById('drawerNavigator');
  var workspace = document.getElementById('resultsWorkspace');
  var openButton = document.getElementById('openFilter');
  var resultScroll = document.querySelector('.result-list-scroll');
  var resultList = document.getElementById('resultList');
  var snapshot = null;
  var navigator = null;
  var fixture = null;
  var scenarioId = '';
  var panelOpen = false;
  var page = 1;
  var pageRanges = [];
  var resultLayout = { width: 0, height: 0 };
  var resultFrame = null;
  var queryKey = null;
  var matches = [];
  var events = [];
  var lastPanelFocus = null;
  var swipeStart = null;

  function escape(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inspect() {
    var range = currentRange();
    document.getElementById('hostState').textContent = JSON.stringify({
      scenario: scenarioId,
      host: { panelOpen: panelOpen, page: page, pageCount: pageRanges.length, total: matches.length,
        visibleCount: range.end - range.start, pageRanges: pageRanges,
        visibleIds: matches.slice(range.start, range.end).map(function (entry) { return entry.id; }) },
      navigator: snapshot,
      events: events,
    }, null, 2);
  }

  function record(type, payload) {
    events.push({ type: type, payload: payload });
    if (events.length > 24) events.shift();
    inspect();
  }

  function currentRange() {
    return pageRanges[page - 1] || { start: 0, end: 0 };
  }

  function resultMarkup(entry, index) {
    return '<li class="result-row" data-result-id="' + escape(entry.id) + '"><span class="result-number">' +
      (index + 1) + '</span><div><h2>Элемент ' + escape(entry.id) + '</h2><div class="result-tags">' +
      entry.tags.map(function (tag) {
        return snapshot.location.tags.includes(tag) ? '<mark>' + escape(tag) + '</mark>' : '<span>' + escape(tag) + '</span>';
      }).join('') + '</div></div></li>';
  }

  function layoutResults(resetPage) {
    var anchor = resetPage ? 0 : currentRange().start;
    document.getElementById('totalCount').textContent = matches.length;
    document.getElementById('drawerCount').textContent = matches.length;
    document.getElementById('drawerTitle').setAttribute('aria-label', 'Результатов: ' + matches.length);
    var summary = document.getElementById('filterSummary');
    summary.textContent = snapshot.location.tags.length ? snapshot.location.tags.join(' ∩ ') : 'Все элементы';
    summary.title = summary.textContent;
    document.getElementById('emptyResults').hidden = matches.length !== 0;
    document.getElementById('resultRange').textContent = matches.length ? '1–' + matches.length + ' из ' + matches.length : '0 результатов';

    // Small synthetic fixtures: measure real wrapped rows, then render just the
    // requested page before the browser paints. The overlay never reduces this
    // results viewport. A single oversized row keeps scrolling as a fallback.
    resultScroll.scrollTop = 0;
    resultList.innerHTML = matches.map(resultMarkup).join('');
    var viewport = resultScroll.getBoundingClientRect();
    var available = resultScroll.clientHeight - (resultList.getBoundingClientRect().top - viewport.top);
    var start = 0;
    var used = 0;
    pageRanges = [];
    Array.from(resultList.children).forEach(function (row, index) {
      var height = row.getBoundingClientRect().height;
      if (index > start && used + height > available + 0.5) {
        pageRanges.push({ start: start, end: index });
        start = index;
        used = 0;
      }
      used += height;
    });
    if (matches.length) pageRanges.push({ start: start, end: matches.length });
    // Resizing keeps the previously first visible element on the current page;
    // changing the applied tags, in contrast, always starts at the first result.
    page = Math.max(1, pageRanges.findIndex(function (range) { return range.start <= anchor && anchor < range.end; }) + 1);
    resultLayout = { width: viewport.width, height: viewport.height };
    renderResults();
  }

  function renderResults() {
    page = Math.max(1, Math.min(page, pageRanges.length));
    var range = currentRange();
    document.getElementById('resultRange').textContent = matches.length
      ? (range.start + 1) + '–' + range.end + ' из ' + matches.length
      : '0 результатов';
    resultList.innerHTML = matches.slice(range.start, range.end).map(function (entry, index) {
      return resultMarkup(entry, range.start + index);
    }).join('');
    document.getElementById('pageStatus').textContent = matches.length ? page + ' / ' + pageRanges.length : '0 / 0';
    document.getElementById('pageStatus').setAttribute('aria-label', matches.length ? 'Страница ' + page + ' из ' + pageRanges.length : 'Нет страниц');
    document.getElementById('previousPage').disabled = page === 1 || !matches.length;
    document.getElementById('nextPage').disabled = page === pageRanges.length || !matches.length;
    resultScroll.scrollTop = 0;
    inspect();
  }

  function receiveState(next) {
    snapshot = next;
    var nextKey = JSON.stringify(next.location.tags);
    if (nextKey !== queryKey) {
      queryKey = nextKey;
      page = 1;
      var seen = new Set();
      matches = fixture.items.filter(function (entry) {
        if (seen.has(entry.id) || !next.location.tags.every(function (tag) { return entry.tags.includes(tag); })) return false;
        seen.add(entry.id);
        return true;
      });
      layoutResults(true);
    }
    var url = new URL(location.href);
    url.searchParams.set('mode', next.mode);
    history.replaceState(null, '', url);
    fitPanelContent();
    inspect();
  }

  function fitPanelContent() {
    var element = mount.querySelector('.navigator');
    var cloud = element.querySelector('.navigator__cloud-section');
    var style = getComputedStyle(element);
    var required = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    function outerHeight(child) {
      var css = getComputedStyle(child);
      if (css.display === 'none') return 0;
      return child.getBoundingClientRect().height + parseFloat(css.marginTop) + parseFloat(css.marginBottom);
    }
    Array.from(element.children).forEach(function (child) {
      if (child !== cloud) required += outerHeight(child);
    });
    required += outerHeight(cloud.querySelector('.cloud-heading')) + outerHeight(cloud.querySelector('.cloud-status'));
    // A usable cloud region plus its fixed controls; only dense filters need
    // outer scrolling. Do not impose a tall navigator on a simple filter.
    required += outerHeight(cloud.querySelector('.cloud-tools')) + 112;
    var minimum = Math.ceil(required) + 'px';
    if (mount.style.minHeight !== minimum) {
      mount.style.minHeight = minimum;
      if (navigator) navigator.refreshLayout();
    }
    updatePanelCue();
  }

  function updatePanelCue() {
    var maximum = body.scrollHeight - body.clientHeight;
    var cue = document.getElementById('drawerScrollCue');
    cue.textContent = maximum > cue.clientHeight + 1
      ? (body.scrollTop < maximum - 1 ? '↓' : '↑') : '';
  }

  function setPanel(open, reason) {
    if (panelOpen === open) return;
    resetDrawerDrag();
    if (!open && drawer.contains(document.activeElement)) lastPanelFocus = document.activeElement;
    panelOpen = open;
    drawer.dataset.open = String(open);
    drawer.inert = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    openButton.setAttribute('aria-expanded', String(open));
    if (open) {
      (lastPanelFocus && lastPanelFocus.isConnected ? lastPanelFocus : document.getElementById('closeFilter')).focus({ preventScroll: true });
      navigator.refreshLayout();
      updatePanelCue();
    } else {
      openButton.focus({ preventScroll: true });
    }
    record('panelChange', { open: open, reason: reason });
  }

  function setScenario(id, mode) {
    resetDrawerDrag();
    var selected = scenarios.find(function (entry) { return entry.id === id; }) || scenarios[0];
    if (navigator) navigator.destroy();
    navigator = null;
    fixture = selected.fixture;
    scenarioId = selected.id;
    select.value = selected.id;
    queryKey = null;
    events = [];
    lastPanelFocus = null;
    body.scrollTop = 0;
    var initial = JSON.parse(JSON.stringify(selected.initial));
    if (mode === 'free' || mode === 'nodes') initial.mode = mode;
    navigator = window.createDagNavigator(mount, {
      fixture: fixture, initialState: initial, onStateChange: receiveState,
      onEvent: function (event) { record(event.type, event.payload); },
    });
    navigator.refreshLayout();
    var url = new URL(location.href);
    url.searchParams.set('scenario', scenarioId);
    history.replaceState(null, '', url);
    updatePanelCue();
  }

  scenarios.forEach(function (scenario) {
    var option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.label;
    select.appendChild(option);
  });
  select.addEventListener('change', function () { setScenario(select.value); });
  document.getElementById('restartHost').addEventListener('click', function () { setScenario(scenarioId); });
  openButton.addEventListener('click', function () { setPanel(!panelOpen, 'button'); });
  document.getElementById('closeFilter').addEventListener('click', function () { setPanel(false, 'close'); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && panelOpen && !event.defaultPrevented) {
      event.preventDefault();
      setPanel(false, 'escape');
    }
  });
  workspace.addEventListener('click', function (event) {
    // A navigator action can replace its button before this event bubbles up.
    // Its original path still identifies an inside click after that rerender.
    var path = event.composedPath();
    if (panelOpen && !path.includes(drawer) && !path.includes(openButton)) setPanel(false, 'outside');
  });
  body.addEventListener('scroll', updatePanelCue, { passive: true });
  ['previousPage', 'nextPage'].forEach(function (id, index) {
    document.getElementById(id).addEventListener('click', function () {
      page += index ? 1 : -1;
      renderResults();
      record('pageChange', { page: page });
    });
  });

  function resetDrawerDrag() {
    if (!swipeStart) return;
    var id = swipeStart.id;
    swipeStart = null;
    delete drawer.dataset.dragging;
    drawer.style.removeProperty('--drawer-drag-y');
    if (grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
  }

  grip.addEventListener('pointerdown', function (event) {
    if (!panelOpen || swipeStart || innerWidth > 720 || event.button !== 0 ||
        !event.isPrimary || event.target.closest('button')) return;
    // Catch a returning panel where it is now, without jumping to its origin.
    var restTop = workspace.getBoundingClientRect().top + workspace.clientTop + drawer.offsetTop;
    var offset = Math.max(0, drawer.getBoundingClientRect().top - restTop);
    swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: offset };
    drawer.style.setProperty('--drawer-drag-y', offset + 'px');
    drawer.dataset.dragging = 'true';
    grip.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  grip.addEventListener('pointermove', function (event) {
    if (!swipeStart || swipeStart.id !== event.pointerId) return;
    var offset = Math.max(0, Math.min(drawer.offsetHeight, swipeStart.offset + event.clientY - swipeStart.y));
    drawer.style.setProperty('--drawer-drag-y', offset + 'px');
  });
  grip.addEventListener('pointerup', function (event) {
    if (!swipeStart || swipeStart.id !== event.pointerId) return;
    var dx = event.clientX - swipeStart.x;
    var dy = event.clientY - swipeStart.y;
    var offset = Math.max(0, swipeStart.offset + dy);
    var threshold = Math.min(120, Math.max(64, drawer.offsetHeight * 0.25));
    var close = offset >= threshold && dy > Math.abs(dx);
    resetDrawerDrag();
    if (close) setPanel(false, 'swipe');
    else record('panelDragReturn', { reason: 'below-threshold-or-direction', offset: Math.round(offset) });
  });
  ['pointercancel', 'lostpointercapture'].forEach(function (type) {
    grip.addEventListener(type, function (event) {
      if (!swipeStart || swipeStart.id !== event.pointerId) return;
      resetDrawerDrag();
      record('panelDragReturn', { reason: type });
    });
  });
  window.addEventListener('blur', resetDrawerDrag);
  window.addEventListener('resize', resetDrawerDrag);

  var resize = new ResizeObserver(function () {
    if (navigator) navigator.refreshLayout();
    updatePanelCue();
  });
  resize.observe(body);
  var resultsResize = new ResizeObserver(function () {
    if (!snapshot) return;
    var rect = resultScroll.getBoundingClientRect();
    if (rect.width === resultLayout.width && rect.height === resultLayout.height) return;
    if (resultFrame !== null) cancelAnimationFrame(resultFrame);
    resultFrame = requestAnimationFrame(function () {
      resultFrame = null;
      layoutResults(false);
    });
  });
  resultsResize.observe(resultScroll);
  var params = new URL(location.href).searchParams;
  setScenario(params.get('scenario') || 'roots', params.get('mode'));
  if (params.get('panel') === 'open') setPanel(true, 'initial');
})();
