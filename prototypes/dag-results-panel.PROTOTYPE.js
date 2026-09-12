(function () {
  'use strict';
  // THROWAWAY: results-first host, one user-selected overlay layout, no persistence.
  var scenarios = window.dagNavigationScenarios;
  var select = document.getElementById('hostScenario');
  var drawer = document.getElementById('filterDrawer');
  var body = document.getElementById('drawerBody');
  var mount = document.getElementById('drawerNavigator');
  var workspace = document.getElementById('resultsWorkspace');
  var openButton = document.getElementById('openFilter');
  var snapshot = null;
  var navigator = null;
  var fixture = null;
  var scenarioId = '';
  var panelOpen = false;
  var page = 1;
  var pageSize = 5;
  var queryKey = null;
  var matches = [];
  var events = [];
  var lastPanelFocus = null;

  function escape(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inspect() {
    document.getElementById('hostState').textContent = JSON.stringify({
      scenario: scenarioId,
      host: { panelOpen: panelOpen, page: page, pageSize: pageSize, total: matches.length,
        visibleIds: matches.slice((page - 1) * pageSize, page * pageSize).map(function (entry) { return entry.id; }) },
      navigator: snapshot,
      events: events,
    }, null, 2);
  }

  function record(type, payload) {
    events.push({ type: type, payload: payload });
    if (events.length > 24) events.shift();
    inspect();
  }

  function renderResults() {
    var pages = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(page, pages);
    var start = (page - 1) * pageSize;
    var visible = matches.slice(start, start + pageSize);
    document.getElementById('totalCount').textContent = matches.length;
    document.getElementById('drawerCount').textContent = '· ' + matches.length;
    var summary = document.getElementById('filterSummary');
    summary.textContent = snapshot.location.tags.length ? 'Фильтр: ' + snapshot.location.tags.join(' ∩ ') : 'Все элементы · фильтр не задан';
    summary.title = summary.textContent;
    document.getElementById('resultRange').textContent = matches.length
      ? (start + 1) + '–' + Math.min(start + pageSize, matches.length) + ' из ' + matches.length
      : '0 результатов';
    document.getElementById('resultList').innerHTML = visible.map(function (entry, index) {
      return '<li class="result-row" data-result-id="' + escape(entry.id) + '"><span class="result-number">' +
        (start + index + 1) + '</span><div><h2>Элемент ' + escape(entry.id) + '</h2><div class="result-tags">' +
        entry.tags.map(function (tag) {
          return snapshot.location.tags.includes(tag) ? '<mark>' + escape(tag) + '</mark>' : '<span>' + escape(tag) + '</span>';
        }).join('') + '</div></div></li>';
    }).join('');
    document.getElementById('emptyResults').hidden = matches.length !== 0;
    document.getElementById('pageStatus').textContent = matches.length ? page + ' / ' + pages : '0 / 0';
    document.getElementById('pageStatus').setAttribute('aria-label', matches.length ? 'Страница ' + page + ' из ' + pages : 'Нет страниц');
    document.getElementById('previousPage').disabled = page === 1 || !matches.length;
    document.getElementById('nextPage').disabled = page === pages || !matches.length;
    document.querySelector('.result-list-scroll').scrollTop = 0;
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
      renderResults();
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
      ? (body.scrollTop < maximum - 1 ? 'Прокрутите фильтр ниже ↓' : '↑ Фильтр продолжается выше') : '';
  }

  function setPanel(open, reason) {
    if (panelOpen === open) return;
    if (!open && drawer.contains(document.activeElement)) lastPanelFocus = document.activeElement;
    panelOpen = open;
    drawer.dataset.open = String(open);
    drawer.inert = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    openButton.setAttribute('aria-expanded', String(open));
    openButton.textContent = 'Фильтр';
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

  var swipeStart = null;
  var grip = document.getElementById('drawerGrip');
  grip.addEventListener('pointerdown', function (event) {
    if (innerWidth > 720 || event.target.closest('button')) return;
    swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointerup', function (event) {
    if (!swipeStart || swipeStart.id !== event.pointerId) return;
    var dx = event.clientX - swipeStart.x;
    var dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (dy > 55 && dy > Math.abs(dx)) setPanel(false, 'swipe');
  });
  grip.addEventListener('pointercancel', function () { swipeStart = null; });

  var resize = new ResizeObserver(function () {
    if (navigator) navigator.refreshLayout();
    updatePanelCue();
  });
  resize.observe(body);
  var params = new URL(location.href).searchParams;
  setScenario(params.get('scenario') || 'roots', params.get('mode'));
  if (params.get('panel') === 'open') setPanel(true, 'initial');
})();
