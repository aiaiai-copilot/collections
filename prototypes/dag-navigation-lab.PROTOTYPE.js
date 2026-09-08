(function () {
  'use strict';

  function normalizeTags(tags) {
    return Array.from(
      new Set(
        (tags || [])
          .map(function (tag) {
            return String(tag).trim().toLocaleLowerCase('ru');
          })
          .filter(Boolean),
      ),
    ).sort(function (left, right) {
      return left.localeCompare(right, 'ru');
    });
  }

  function sameTags(left, right) {
    var a = normalizeTags(left);
    var b = normalizeTags(right);
    return a.length === b.length && a.every(function (tag, index) {
      return tag === b[index];
    });
  }

  function isSubset(left, right) {
    var rightSet = new Set(right);
    return left.every(function (tag) {
      return rightSet.has(tag);
    });
  }

  function node(id, name, tags) {
    return { id: id, name: name, tags: normalizeTags(tags) };
  }

  function item(id, tags) {
    return { id: id, tags: normalizeTags(tags) };
  }

  function place(kind, tags, nodeId) {
    return {
      kind: kind,
      tags: normalizeTags(tags),
      nodeId: nodeId || null,
    };
  }

  function initialState(location, history, cloud) {
    return {
      location: location,
      history: history || [],
      cloud: Object.assign({ width: 100, height: 72, tagScale: 100 }, cloud || {}),
    };
  }

  function sharedCultureNodes() {
    return [
      node('films', 'Фильмы', ['фильм']),
      node('music', 'Музыка', ['музыка']),
      node('books', 'Книги', ['книга']),
      node('travel', 'Путешествия', ['путешествие']),
      node('calm', 'Спокойное', ['спокойное']),
      node('calm-films', 'Спокойные фильмы', ['фильм', 'спокойное']),
      node('evening-films', 'Фильмы на вечер', ['фильм', 'спокойное', 'вечер']),
      node('calm-music', 'Спокойная музыка', ['музыка', 'спокойное']),
      node('japan-animation', 'Японская анимация', ['фильм', 'анимация', 'япония']),
      node('family-animation', 'Семейная анимация', ['фильм', 'анимация', 'семейное']),
      node('book-travel', 'Книги о путешествиях', ['книга', 'путешествие']),
    ];
  }

  function sharedCultureItems() {
    return [
      item('e01', ['фильм', 'спокойное', 'вечер']),
      item('e02', ['фильм', 'спокойное']),
      item('e03', ['фильм', 'анимация', 'япония']),
      item('e04', ['фильм', 'анимация', 'семейное']),
      item('e05', ['фильм', 'документальное']),
      item('e06', ['музыка', 'спокойное']),
      item('e07', ['музыка', 'вечер']),
      item('e08', ['книга', 'путешествие']),
      item('e09', ['книга', 'история']),
      item('e10', ['путешествие', 'япония']),
      item('e11', ['спокойное', 'дом']),
      item('e12', ['фильм', 'спокойное', 'анимация']),
    ];
  }

  var deepNodes = [
    node('project', 'Проект', ['проект']),
    node('team', 'Команда', ['команда']),
    node('project-team', 'Командный проект', ['проект', 'команда']),
    node('research', 'Исследование проекта', ['проект', 'команда', 'исследование']),
    node('sources', 'Источники исследования', ['проект', 'команда', 'исследование', 'источники']),
    node('route-parent', 'Архив источников', [
      'проект',
      'команда',
      'исследование',
      'источники',
      'архив',
    ]),
    node('alternate-parent', 'Первичные источники', [
      'проект',
      'команда',
      'исследование',
      'источники',
      'первичные материалы',
    ]),
    node('deep-current', 'Первичный архив исследования', [
      'проект',
      'команда',
      'исследование',
      'источники',
      'архив',
      'первичные материалы',
    ]),
  ];

  var deepItems = [
    item('d01', ['проект', 'команда', 'исследование', 'источники', 'архив', 'первичные материалы']),
    item('d02', ['проект', 'команда', 'исследование', 'источники', 'архив']),
    item('d03', ['проект', 'команда', 'исследование', 'источники', 'первичные материалы']),
    item('d04', ['проект', 'команда', 'исследование']),
    item('d05', ['проект', 'команда']),
  ];

  var overflowLabels = [
    'антропология повседневности',
    'бережное потребление',
    'визуальные исследования городов',
    'документальная фотография',
    'естественная история',
    'женские голоса в архитектуре',
    'забытые промышленные маршруты',
    'инклюзивное проектирование',
    'культурная память районов',
    'локальные независимые издательства',
    'медленные путешествия без самолётов',
    'неочевидные общественные пространства',
    'опыт совместного проживания',
    'полевые заметки исследователей',
    'разговоры с хранителями архивов',
    'современное деревянное зодчество',
    'тактильные практики обучения',
    'устная история малых городов',
    'фотокниги ограниченного тиража',
    'хрупкие цифровые коллекции',
    'цвет в северной архитектуре',
    'частные музеи и домашние архивы',
    'экспериментальная типографика',
    'язык навигации в сложных зданиях',
  ];

  function overflowFixture(limit) {
    var labels = overflowLabels.slice(0, limit || overflowLabels.length);
    var nodes = [node('atlas', 'Исследовательский атлас', ['атлас'])];
    var items = [];

    labels.forEach(function (label, index) {
      nodes.push(node('atlas-' + (index + 1), 'Раздел ' + (index + 1), ['атлас', label]));
      var repeats = (index % 5) + 1;
      for (var count = 0; count < repeats; count += 1) {
        items.push(item('a' + index + '-' + count, ['атлас', label]));
      }
    });

    items.push(item('atlas-general', ['атлас']));
    return { nodes: nodes, items: items };
  }

  var rootsFixture = {
    nodes: sharedCultureNodes(),
    items: sharedCultureItems(),
  };

  var parentsFixture = {
    nodes: sharedCultureNodes().filter(function (entry) {
      return ['films', 'calm', 'calm-films', 'evening-films'].includes(entry.id);
    }),
    items: sharedCultureItems(),
  };

  var temporaryFixture = {
    nodes: [
      node('films', 'Фильмы', ['фильм']),
      node('animation', 'Анимация', ['анимация']),
      node('japan-animation', 'Японская анимация', ['фильм', 'анимация', 'япония']),
      node('family-animation', 'Семейная анимация', ['фильм', 'анимация', 'семейное']),
      node('festival-animation', 'Фестивальная анимация', [
        'фильм',
        'анимация',
        'фестивальное',
        'короткий метр',
      ]),
    ],
    items: sharedCultureItems().concat([
      item('t01', ['фильм', 'анимация', 'короткий метр', 'фестивальное']),
      item('t02', ['фильм', 'анимация', 'короткий метр']),
    ]),
  };

  var smallOverflow = overflowFixture(13);
  var largeOverflow = overflowFixture(24);

  // Unlike the independent 24-way fan-out, this scenario has two real
  // semantic branches. Its long-name shortcuts can safely disappear.
  smallOverflow.nodes.slice(1).forEach(function (entry, index) {
    entry.tags = normalizeTags(entry.tags.concat(index % 2 ? 'практика' : 'исследование'));
  });
  smallOverflow.items.forEach(function (entry) {
    var label = entry.tags.find(function (tag) { return tag !== 'атлас'; });
    if (label) entry.tags = normalizeTags(entry.tags.concat(
      overflowLabels.indexOf(label) % 2 ? 'практика' : 'исследование',
    ));
  });
  smallOverflow.nodes.push(
    node('atlas-research', 'Исследования атласа', ['атлас', 'исследование']),
    node('atlas-practice', 'Практики атласа', ['атлас', 'практика']),
  );

  var SCENARIOS = [
    {
      id: 'roots',
      label: '1 · Несколько независимых корней',
      description:
        'Старт во «Всё»: у графа несколько независимых корней. Облако строится по всей глубине, а не по одному выбранному дереву.',
      fixture: rootsFixture,
      initial: initialState(place('all', [], null), [], { width: 100, height: 76, tagScale: 100 }),
    },
    {
      id: 'parents',
      label: '2 · Несколько непосредственных родителей',
      description:
        '«Спокойные фильмы» посещены через «Фильмы». Назад вернёт к реальному маршруту; снятие тега «фильм» откроет другого родителя — «Спокойное».',
      fixture: parentsFixture,
      initial: initialState(
        place('node', ['фильм', 'спокойное'], 'calm-films'),
        [place('all', [], null), place('node', ['фильм'], 'films')],
        { width: 100, height: 64, tagScale: 100 },
      ),
    },
    {
      id: 'deep',
      label: '3 · Глубокий маршрут и фактический возврат',
      description:
        'Текущий узел имеет два широких родителя. Назад восстановит «Архив источников»; снятие «архив» откроет «Первичные источники».',
      fixture: { nodes: deepNodes, items: deepItems },
      initial: initialState(
        place(
          'node',
          ['проект', 'команда', 'исследование', 'источники', 'архив', 'первичные материалы'],
          'deep-current',
        ),
        [
          place('all', [], null),
          place('node', ['проект'], 'project'),
          place('node', ['проект', 'команда'], 'project-team'),
          place('node', ['проект', 'команда', 'исследование'], 'research'),
          place('node', ['проект', 'команда', 'исследование', 'источники'], 'sources'),
          place(
            'node',
            ['проект', 'команда', 'исследование', 'источники', 'архив'],
            'route-parent',
          ),
        ],
        { width: 100, height: 48, tagScale: 100 },
      ),
    },
    {
      id: 'temporary',
      label: '4 · Временный несохранённый набор',
      description:
        'Для набора {анимация, фильм} нет сохранённого узла. Идентичность остаётся временной, но счётчик и направления вычисляются по тем же правилам.',
      fixture: temporaryFixture,
      initial: initialState(
        place('temporary', ['фильм', 'анимация'], null),
        [place('all', [], null), place('node', ['фильм'], 'films')],
        { width: 100, height: 69, tagScale: 100 },
      ),
    },
    {
      id: 'overflow',
      label: '5 · Много длинных направлений',
      description:
        '24 независимых направления: сокращать нечего. Если все кнопки не помещаются даже в максимальной области, лаборатория явно показывает недостаток места.',
      fixture: largeOverflow,
      initial: initialState(place('node', ['атлас'], 'atlas'), [place('all', [], null)], {
        width: 58,
        height: 45,
        tagScale: 125,
      }),
    },
    {
      id: 'scale',
      label: '6 · Масштаб независимо от прямоугольника',
      description:
        'Две семантические ветви и 13 длинных направлений в глубине. Масштаб и размер меняются независимо; сокращение сохраняет пути ко всем узлам.',
      fixture: smallOverflow,
      initial: initialState(place('node', ['атлас'], 'atlas'), [place('all', [], null)], {
        width: 88,
        height: 74,
        tagScale: 100,
      }),
    },
    {
      id: 'all',
      label: '7 · Выход во «Всё» из глубокого узла',
      description:
        'Кнопка «Всё» создаёт отдельное событие и состояние вне DAG. Она не подменяет фактический возврат и не снимает теги по одному.',
      fixture: { nodes: deepNodes, items: deepItems },
      initial: initialState(
        place(
          'node',
          ['проект', 'команда', 'исследование', 'источники', 'архив', 'первичные материалы'],
          'deep-current',
        ),
        [
          place('all', [], null),
          place('node', ['проект'], 'project'),
          place(
            'node',
            ['проект', 'команда', 'исследование', 'источники', 'архив'],
            'route-parent',
          ),
        ],
        { width: 100, height: 52, tagScale: 100 },
      ),
    },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // Remove a shortcut only when the remaining directions cover every target.
  // Stable, preference-ordered pruning; not an exact minimum-area set cover.
  function chooseCoveredDirections(candidates, targets, fits) {
    var retained = candidates.slice();
    function covers(entries) {
      return targets.every(function (target) {
        return entries.some(function (entry) {
          return entry.coveredNodeIds.includes(target.id);
        });
      });
    }
    if (!covers(retained)) {
      return { entries: retained, fits: false, representable: false };
    }
    while (!fits(retained)) {
      var removable = -1;
      for (var index = retained.length - 1; index >= 0; index -= 1) {
        if (covers(retained.filter(function (_, i) { return i !== index; }))) {
          removable = index;
          break;
        }
      }
      if (removable === -1) {
        return { entries: retained, fits: false, representable: true };
      }
      retained.splice(removable, 1);
    }
    return { entries: retained, fits: true, representable: true };
  }

  function createDagNavigator(element, options) {
    var fixture = {
      nodes: options.fixture.nodes.map(function (entry) {
        return node(entry.id, entry.name, entry.tags);
      }),
      items: options.fixture.items.map(function (entry) {
        return item(entry.id, entry.tags);
      }),
    };
    var nodeById = new Map(
      fixture.nodes.map(function (entry) {
        return [entry.id, entry];
      }),
    );
    var state = clone(options.initialState);
    var visibleDirectionTags = [];
    var resizeFrame = null;
    var dragCleanup = null;
    var coverage = null;
    var layoutLimit = null;
    var actualPixels = null;

    state.location.tags = normalizeTags(state.location.tags);
    state.history = state.history.map(function (entry) {
      return place(entry.kind, entry.tags, entry.nodeId);
    });

    function exactNode(tags) {
      return fixture.nodes.find(function (entry) {
        return sameTags(entry.tags, tags);
      });
    }

    function resolveLocation(tags) {
      var normalized = normalizeTags(tags);
      if (normalized.length === 0) {
        return place('all', [], null);
      }
      var exact = exactNode(normalized);
      return exact
        ? place('node', exact.tags, exact.id)
        : place('temporary', normalized, null);
    }

    function describeLocation(location) {
      var saved = location.nodeId ? nodeById.get(location.nodeId) : null;
      return {
        kind: location.kind,
        tags: location.tags.slice(),
        nodeId: location.nodeId,
        name:
          location.kind === 'all'
            ? 'Всё'
            : saved
              ? saved.name
              : 'Несохранённый набор',
      };
    }

    function relevantCount(tags) {
      return fixture.items.filter(function (entry) {
        return isSubset(tags, entry.tags);
      }).length;
    }

    function descendantNodes() {
      var currentTags = state.location.tags;
      return fixture.nodes.filter(function (entry) {
        // An empty-filter node is distinct from "all". If supplied, report
        // that tag-addition alone cannot represent it instead of omitting it.
        return state.location.kind === 'all' ||
          (entry.tags.length > currentTags.length && isSubset(currentTags, entry.tags));
      });
    }

    function directions() {
      var currentTags = state.location.tags;
      var strictSupersets = descendantNodes();
      var candidates = new Map();

      strictSupersets.forEach(function (entry) {
        entry.tags.forEach(function (tag) {
          if (currentTags.includes(tag)) {
            return;
          }
          if (!candidates.has(tag)) {
            candidates.set(tag, new Set());
          }
          candidates.get(tag).add(entry.id);
        });
      });

      var result = Array.from(candidates.entries()).map(function (entry) {
        var tag = entry[0];
        var targetTags = normalizeTags(currentTags.concat(tag));
        return {
          tag: tag,
          relevantCount: relevantCount(targetTags),
          savedNodeCount: entry[1].size,
          coveredNodeIds: Array.from(entry[1]),
          visible: visibleDirectionTags.includes(tag),
        };
      });

      result.sort(function (left, right) {
        return (
          right.relevantCount - left.relevantCount ||
          right.savedNodeCount - left.savedNodeCount ||
          left.tag.localeCompare(right.tag, 'ru')
        );
      });
      return result;
    }

    function semanticParents() {
      var currentTags = state.location.tags;
      if (currentTags.length === 0) {
        return [];
      }
      var wider = fixture.nodes.filter(function (entry) {
        return entry.tags.length < currentTags.length && isSubset(entry.tags, currentTags);
      });

      return wider
        .filter(function (candidate) {
          return !wider.some(function (other) {
            return (
              other.id !== candidate.id &&
              candidate.tags.length < other.tags.length &&
              isSubset(candidate.tags, other.tags)
            );
          });
        })
        .map(function (entry) {
          return { id: entry.id, name: entry.name, tags: entry.tags.slice() };
        });
    }

    function snapshot() {
      var derivedDirections = directions();
      return {
        location: describeLocation(state.location),
        history: state.history.map(describeLocation),
        semanticParents: semanticParents(),
        relevantCount: relevantCount(state.location.tags),
        cloud: {
          width: state.cloud.width,
          height: state.cloud.height,
          tagScale: state.cloud.tagScale,
          visibleDirectionCount: derivedDirections.filter(function (entry) {
            return entry.visible;
          }).length,
          totalDirectionCount: derivedDirections.length,
          actualPixels: actualPixels,
          coverage: coverage,
          limit: layoutLimit,
        },
        directions: derivedDirections,
      };
    }

    function notifyState() {
      if (typeof options.onStateChange === 'function') {
        options.onStateChange(snapshot());
      }
    }

    function emit(type, payload, before) {
      var event = {
        type: type,
        payload: payload || {},
        before: before,
        after: snapshot(),
      };
      if (typeof options.onEvent === 'function') {
        options.onEvent(event);
      }
    }

    function visit(type, tags, payload) {
      var before = snapshot();
      state.history.push(clone(state.location));
      state.location = resolveLocation(tags);
      layoutLimit = null;
      render();
      emit(type, payload, before);
    }

    function cloudHeightPixels(percent) {
      var section = element.querySelector('.navigator__cloud-section');
      if (!section) return 172;
      var heading = section.querySelector('.cloud-heading');
      var status = section.querySelector('.cloud-status');
      var maximum = Math.max(0, Math.floor(section.clientHeight -
        heading.offsetHeight - 8 - status.offsetHeight - 6));
      var minimum = Math.min(172, maximum);
      return Math.round(minimum + (clamp(percent, 35, 100) - 35) / 65 * (maximum - minimum));
    }

    function identityMarkup(location) {
      var described = describeLocation(location);
      var kindLabel =
        location.kind === 'all'
          ? 'Верхний уровень · вне DAG'
          : location.kind === 'node'
            ? 'Сохранённый узел'
            : 'Временный навигационный набор';
      var idLine =
        location.kind === 'node'
          ? '<p class="navigator__node-id">id: ' + escapeHtml(location.nodeId) + '</p>'
          : '<p class="navigator__node-id">id: null</p>';

      return (
        '<div class="navigator__identity">' +
        '<span class="navigator__kind">' +
        escapeHtml(kindLabel) +
        '</span>' +
        '<h2>' +
        escapeHtml(described.name) +
        '</h2>' +
        idLine +
        '</div>'
      );
    }

    function selectedMarkup() {
      if (state.location.tags.length === 0) {
        return '<span class="selected-empty">Набор пуст: выберите направление вниз</span>';
      }
      return state.location.tags
        .map(function (tag) {
          var title = state.location.tags.length === 1
            ? 'Убрать последний тег и перейти во «Всё»'
            : 'Убрать тег и перейти к более широкому набору';
          return (
            '<button class="selected-tag" type="button" data-broaden="' +
            escapeHtml(tag) +
            '" title="' +
            escapeHtml(title) +
            '"' +
            '><span>' +
            escapeHtml(tag) +
            '</span>' +
            '<span class="selected-tag__remove" aria-hidden="true">−</span>' +
            '</button>'
          );
        })
        .join('');
    }

    function directionMarkup(derivedDirections) {
      if (derivedDirections.length === 0) {
        return '';
      }
      var counts = derivedDirections.map(function (entry) {
        return entry.relevantCount;
      });
      var minimum = Math.min.apply(Math, counts);
      var maximum = Math.max.apply(Math, counts);

      return derivedDirections
        .map(function (entry, index) {
          var weight = maximum === minimum ? 0.5 : (entry.relevantCount - minimum) / (maximum - minimum);
          return (
            '<button class="direction" type="button" data-direction-index="' +
            index +
            '" style="--weight:' +
            weight.toFixed(3) +
            '">' +
            escapeHtml(entry.tag) +
            '<small aria-label="' +
            entry.relevantCount +
            ' релевантных элементов">' +
            entry.relevantCount +
            '</small></button>'
          );
        })
        .join('');
    }

    function layoutAt(cloud) {
      var stage = element.querySelector('.cloud-stage');
      var shell = element.querySelector('.cloud-shell');
      shell.style.width = cloud.width + '%';
      shell.style.height = cloudHeightPixels(cloud.height) + 'px';
      shell.style.setProperty('--tag-scale', cloud.tagScale / 100);
      stage.querySelector('.cloud-empty').hidden = true;
      var candidates = directions();
      var targets = descendantNodes();
      var buttons = Array.from(stage.querySelectorAll('.direction'));
      return chooseCoveredDirections(candidates, targets, function (retained) {
        var tags = new Set(retained.map(function (entry) { return entry.tag; }));
        buttons.forEach(function (button, index) {
          button.hidden = !tags.has(candidates[index].tag);
        });
        var box = stage.getBoundingClientRect();
        var shellBox = shell.getBoundingClientRect();
        var tools = shell.querySelector('.cloud-tools');
        var toolsBox = tools.getBoundingClientRect();
        // Very short hosts cannot promise a usable cloud, even with no tags.
        if (box.height < 45 || toolsBox.bottom > shellBox.bottom + 0.5) return false;
        return buttons.every(function (button) {
          if (button.hidden) return true;
          var bounds = button.getBoundingClientRect();
          return bounds.left >= box.left + 10 &&
            bounds.right <= box.right - 10 &&
            bounds.top >= box.top &&
            bounds.bottom <= box.bottom - 7;
        });
      });
    }

    function showLayout(plan) {
      var stage = element.querySelector('.cloud-stage');
      var shell = element.querySelector('.cloud-shell');
      var targets = descendantNodes();
      var candidates = directions();
      visibleDirectionTags = plan.fits
        ? plan.entries.map(function (entry) { return entry.tag; })
        : [];
      stage.querySelectorAll('.direction').forEach(function (button, index) {
        button.hidden = !visibleDirectionTags.includes(candidates[index].tag);
      });
      var covered = targets.filter(function (target) {
        return plan.fits && plan.entries.some(function (entry) {
          return entry.coveredNodeIds.includes(target.id);
        });
      });
      coverage = {
        status: plan.fits ? 'complete' : plan.representable ? 'insufficient-space' : 'unrepresentable',
        totalNodeCount: targets.length,
        coveredNodeIds: covered.map(function (entry) { return entry.id; }),
        uncoveredNodeIds: targets.filter(function (entry) {
          return !covered.includes(entry);
        }).map(function (entry) { return entry.id; }),
        retainedTags: plan.entries.map(function (entry) { return entry.tag; }),
      };
      var bounds = shell.getBoundingClientRect();
      actualPixels = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
      var empty = stage.querySelector('.cloud-empty');
      empty.hidden = plan.fits && targets.length > 0;
      empty.textContent = !plan.representable
        ? 'Узел с пустым фильтром требует отдельного перехода.'
        : !plan.fits
          ? state.cloud.tagScale > 75
            ? 'Все направления не помещаются. Уменьшите масштаб; если это не поможет, нужна большая область.'
            : 'Даже при минимальном масштабе для всех направлений нужна большая область.'
          : 'Сохранённых уточнений глубже этого набора нет.';
      var status = element.querySelector('.cloud-status');
      status.dataset.status = coverage.status;
      status.textContent = !plan.fits
        ? 'Полное покрытие недоступно'
        : layoutLimit && layoutLimit.kind === 'size'
          ? 'Предел сжатия: все ветви остаются доступны'
          : layoutLimit && layoutLimit.kind === 'scale'
            ? 'Предел масштаба: все ветви остаются доступны'
            : 'Все ветви доступны';
      element.querySelector('[data-direction-count]').textContent =
        visibleDirectionTags.length + ' / ' + candidates.length;
      element.querySelector('[data-scale="reset"]').textContent = state.cloud.tagScale + '%';
      element.querySelector('[data-scale="down"]').disabled = state.cloud.tagScale <= 75;
      element.querySelector('[data-scale="up"]').disabled = state.cloud.tagScale >= 175;
    }

    function fitDirections() {
      // Scope changes and viewport changes may require a larger rectangle.
      var requested = clone(state.cloud);
      var plan = layoutAt(requested);
      if (!plan.fits && plan.representable) {
        var maximum = Object.assign({}, requested, { width: 100, height: 100 });
        var larger = layoutAt(maximum);
        if (larger.fits) {
          var low = 0;
          var high = 1;
          var accepted = maximum;
          for (var step = 0; step < 8; step += 1) {
            var fraction = (low + high) / 2;
            var trial = Object.assign({}, requested, {
              width: Math.ceil(requested.width + (100 - requested.width) * fraction),
              height: Math.ceil(requested.height + (100 - requested.height) * fraction),
            });
            if (layoutAt(trial).fits) {
              accepted = trial;
              high = fraction;
            } else low = fraction;
          }
          state.cloud = accepted;
        } else {
          state.cloud = maximum;
        }
        plan = layoutAt(state.cloud);
      }
      showLayout(plan);
    }

    function scheduleFit() {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = requestAnimationFrame(function () {
        fitDirections();
        notifyState();
        resizeFrame = null;
      });
    }

    function changeScale(nextScale) {
      var next = clamp(nextScale, 75, 175);
      if (next === state.cloud.tagScale) {
        return;
      }
      var before = snapshot();
      var from = state.cloud.tagScale;
      var trial = Object.assign({}, state.cloud, { tagScale: next });
      var plan = layoutAt(trial);
      var accepted = plan.fits || (coverage.status !== 'complete' && next < from);
      layoutLimit = accepted ? null : { kind: 'scale', requested: next };
      if (accepted) state.cloud = trial;
      showLayout(layoutAt(state.cloud));
      notifyState();
      emit('scaleChange', { from: from, requested: next, to: state.cloud.tagScale, limited: !accepted }, before);
    }

    function applyCloudSize(width, height) {
      var nextWidth = clamp(Math.round(width), 46, 100);
      var nextHeight = clamp(Math.round(height), 35, 100);
      var from = clone(state.cloud);
      var requested = Object.assign({}, from, { width: nextWidth, height: nextHeight });
      var plan = layoutAt(requested);
      var accepted = requested;
      var limited = !plan.fits;
      if (limited) {
        accepted = from;
        if (coverage.status === 'complete') {
          var low = 0;
          var high = 1;
          for (var step = 0; step < 8; step += 1) {
            var fraction = (low + high) / 2;
            var trial = Object.assign({}, from, {
              width: Math.round(from.width + (nextWidth - from.width) * fraction),
              height: Math.round(from.height + (nextHeight - from.height) * fraction),
            });
            if (layoutAt(trial).fits) {
              accepted = trial;
              low = fraction;
            } else high = fraction;
          }
        }
      }
      state.cloud = accepted;
      layoutLimit = limited ? { kind: 'size', requested: { width: nextWidth, height: nextHeight } } : null;
      showLayout(layoutAt(state.cloud));
      return { requested: { width: nextWidth, height: nextHeight }, limited: limited };
    }

    function changeCloudSize(width, height) {
      var before = snapshot();
      var result = applyCloudSize(width, height);
      notifyState();
      emit(
        'cloudResize',
        {
          from: { width: before.cloud.width, height: before.cloud.height },
          requested: result.requested,
          to: { width: state.cloud.width, height: state.cloud.height },
          limited: result.limited,
        },
        before,
      );
    }

    function startResize(pointerEvent) {
      pointerEvent.preventDefault();
      var handle = pointerEvent.currentTarget;
      var shell = element.querySelector('.cloud-shell');
      var before = snapshot();
      var startX = pointerEvent.clientX;
      var startY = pointerEvent.clientY;
      var startWidth = state.cloud.width;
      var startHeight = state.cloud.height;
      var availableWidth = shell.parentElement.clientWidth || 350;
      var availableHeightRange = Math.max(1, cloudHeightPixels(100) - cloudHeightPixels(35));
      var lastRequest = null;
      var dragFrame = null;

      handle.setPointerCapture(pointerEvent.pointerId);

      function move(event) {
        // The rectangle is centered: its right edge moves half its width delta.
        lastRequest = {
          width: startWidth + ((event.clientX - startX) / availableWidth) * 200,
          height: startHeight + ((event.clientY - startY) / availableHeightRange) * 65,
        };
        if (dragFrame !== null) return;
        dragFrame = requestAnimationFrame(function () {
          applyCloudSize(lastRequest.width, lastRequest.height);
          notifyState();
          dragFrame = null;
        });
      }

      function stop(event) {
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        dragCleanup = null;
        if (dragFrame !== null) cancelAnimationFrame(dragFrame);
        if (!lastRequest) return;
        var result = event.type === 'pointercancel'
          ? applyCloudSize(startWidth, startHeight)
          : applyCloudSize(lastRequest.width, lastRequest.height);
        notifyState();
        emit(
          'cloudResize',
          {
            from: { width: before.cloud.width, height: before.cloud.height },
            to: { width: state.cloud.width, height: state.cloud.height },
            requested: result.requested,
            limited: result.limited,
            cancelled: event.type === 'pointercancel',
          },
          before,
        );
      }

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
      dragCleanup = function () {
        if (dragFrame !== null) cancelAnimationFrame(dragFrame);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
    }

    function render() {
      visibleDirectionTags = [];
      var derivedDirections = directions();
      var historyTarget = state.history.length
        ? describeLocation(state.history[state.history.length - 1]).name
        : '';
      var backButton =
        '<button class="nav-action" type="button" data-action="back"' +
        (state.history.length ? '' : ' disabled') +
        ' title="' +
        escapeHtml(historyTarget ? 'Вернуться: ' + historyTarget : 'Фактической истории нет') +
        '">← Назад</button>';
      var allButton =
        state.location.kind === 'all'
          ? '<span aria-hidden="true"></span>'
          : '<button class="nav-action nav-action--all" type="button" data-action="all">Всё</button>';

      element.innerHTML =
        '<section class="navigator" aria-label="Изолированный DAG-навигатор">' +
        '<div class="navigator__actions">' +
        backButton +
        allButton +
        '</div>' +
        identityMarkup(state.location) +
        '<section class="navigator__selected" aria-labelledby="selectedLabel">' +
        '<div class="selected-heading">' +
        '<span class="navigator__section-label" id="selectedLabel">Выбрано</span>' +
        '<span class="selected-heading__hint">убрать тег = шире</span>' +
        '</div>' +
        '<div class="selected-tags">' +
        selectedMarkup() +
        '</div>' +
        '</section>' +
        '<section class="navigator__cloud-section" aria-labelledby="cloudLabel">' +
        '<div class="cloud-heading">' +
        '<div><span class="navigator__section-label" id="cloudLabel">Направления вниз</span>' +
        '<span class="cloud-heading__meta">добавить тег</span></div>' +
        '<span class="cloud-heading__count" data-direction-count>0 / ' +
        derivedDirections.length +
        '</span>' +
        '</div>' +
        '<p class="cloud-status" role="status">Проверяем покрытие…</p>' +
        '<div class="cloud-shell" style="--cloud-width:' +
        state.cloud.width +
        '%;--cloud-height:' +
        cloudHeightPixels(state.cloud.height) +
        'px;--tag-scale:' +
        state.cloud.tagScale / 100 +
        '">' +
        '<div class="cloud-stage">' +
        directionMarkup(derivedDirections) +
        '<p class="cloud-empty" hidden></p>' +
        '</div>' +
        '<div class="cloud-tools">' +
        '<div class="scale-control" aria-label="Масштаб названий тегов">' +
        '<button type="button" data-scale="down" aria-label="Уменьшить масштаб">−</button>' +
        '<button type="button" class="scale-control__value" data-scale="reset" title="Сбросить масштаб">' +
        state.cloud.tagScale +
        '%</button>' +
        '<button type="button" data-scale="up" aria-label="Увеличить масштаб">+</button>' +
        '</div>' +
        '<button class="resize-handle" type="button" data-resize aria-label="Изменить размер прямоугольника" title="Тянуть ↖↘ · стрелки по 5% · Home сбрасывает">↖↘</button>' +
        '</div>' +
        '</div>' +
        '</section>' +
        '<footer class="navigator__footer">' +
        '<span class="result-count"><strong>' +
        relevantCount(state.location.tags) +
        '</strong> релевантных элементов</span>' +
        '<button class="results-button" type="button" data-action="results">Показать результаты</button>' +
        '</footer>' +
        '</section>';

      element.querySelectorAll('[data-direction-index]').forEach(function (button) {
        button.addEventListener('click', function () {
          var selected = derivedDirections[Number(button.dataset.directionIndex)];
          if (selected) {
            visit('refine', state.location.tags.concat(selected.tag), { tag: selected.tag });
          }
        });
      });

      element.querySelectorAll('[data-broaden]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (button.disabled) {
            return;
          }
          var removedTag = button.dataset.broaden;
          visit(
            'broaden',
            state.location.tags.filter(function (tag) {
              return tag !== removedTag;
            }),
            { removedTag: removedTag },
          );
        });
      });

      var back = element.querySelector('[data-action="back"]');
      back.addEventListener('click', function () {
        if (!state.history.length) {
          return;
        }
        var before = snapshot();
        var from = describeLocation(state.location);
        state.location = state.history.pop();
        layoutLimit = null;
        render();
        emit('back', { from: from, restored: describeLocation(state.location) }, before);
      });

      var all = element.querySelector('[data-action="all"]');
      if (all) {
        all.addEventListener('click', function () {
          visit('all', [], {});
        });
      }

      element.querySelector('[data-action="results"]').addEventListener('click', function () {
        var before = snapshot();
        emit(
          'requestResults',
          {
            tags: state.location.tags.slice(),
            nodeId: state.location.nodeId,
            relevantCount: relevantCount(state.location.tags),
          },
          before,
        );
      });

      element.querySelector('[data-scale="down"]').addEventListener('click', function () {
        changeScale(state.cloud.tagScale - 25);
      });
      element.querySelector('[data-scale="up"]').addEventListener('click', function () {
        changeScale(state.cloud.tagScale + 25);
      });
      element.querySelector('[data-scale="reset"]').addEventListener('click', function () {
        changeScale(100);
      });

      var resizeHandle = element.querySelector('[data-resize]');
      resizeHandle.addEventListener('pointerdown', startResize);
      resizeHandle.addEventListener('keydown', function (event) {
        if (event.key === 'Home') {
          event.preventDefault();
          changeCloudSize(100, 100);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          changeCloudSize(state.cloud.width - 5, state.cloud.height);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          changeCloudSize(state.cloud.width + 5, state.cloud.height);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          changeCloudSize(state.cloud.width, state.cloud.height - 5);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          changeCloudSize(state.cloud.width, state.cloud.height + 5);
        }
      });

      fitDirections();
      notifyState();
    }

    function handleWindowResize() {
      scheduleFit();
    }

    window.addEventListener('resize', handleWindowResize);
    render();

    return {
      getState: snapshot,
      destroy: function () {
        window.removeEventListener('resize', handleWindowResize);
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame);
        }
        if (dragCleanup) {
          dragCleanup();
        }
        element.innerHTML = '';
      },
    };
  }

  window.createDagNavigator = createDagNavigator;

  var scenarioSelect = document.getElementById('scenarioSelect');
  var scenarioNote = document.getElementById('scenarioNote');
  var host = document.getElementById('navigatorHost');
  var stateInspector = document.getElementById('stateInspector');
  var lastEvent = document.getElementById('lastEvent');
  var eventLogElement = document.getElementById('eventLog');
  var activeNavigator = null;
  var eventLog = [];

  SCENARIOS.forEach(function (scenario) {
    var option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.label;
    scenarioSelect.appendChild(option);
  });

  function eventSummary(event) {
    var after = event.after.location.name;
    if (event.type === 'refine') {
      return '+' + event.payload.tag + ' → ' + after;
    }
    if (event.type === 'broaden') {
      return '−' + event.payload.removedTag + ' → ' + after;
    }
    if (event.type === 'back') {
      return 'route → ' + after;
    }
    if (event.type === 'all') {
      return 'outside DAG → Всё';
    }
    if (event.type === 'requestResults') {
      return event.payload.relevantCount + ' результатов · экран не открыт';
    }
    if (event.type === 'scaleChange') {
      return event.payload.from + '% → ' + event.payload.to + '%' +
        (event.payload.limited ? ' · предел покрытия' : '');
    }
    if (event.type === 'cloudResize') {
      return (
        event.payload.to.width +
        '% × ' +
        event.payload.to.height +
        '%' + (event.payload.limited ? ' · предел покрытия' : '')
      );
    }
    return event.type;
  }

  function renderLog() {
    eventLogElement.innerHTML = '';
    if (!eventLog.length) {
      var empty = document.createElement('li');
      empty.className = 'event-log__item';
      empty.innerHTML = '<time>—</time><span>Действий компонента пока нет</span>';
      eventLogElement.appendChild(empty);
      return;
    }

    eventLog
      .slice()
      .reverse()
      .forEach(function (entry) {
        var row = document.createElement('li');
        row.className = 'event-log__item';
        var time = document.createElement('time');
        time.textContent = entry.time;
        var text = document.createElement('span');
        text.textContent = entry.type + ' · ' + entry.summary;
        row.append(time, text);
        eventLogElement.appendChild(row);
      });
  }

  function handleEvent(event) {
    var stamped = Object.assign({ at: new Date().toISOString() }, event);
    lastEvent.textContent = JSON.stringify(stamped, null, 2);
    eventLog.push({
      time: new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      type: event.type,
      summary: eventSummary(event),
    });
    if (eventLog.length > 40) {
      eventLog.shift();
    }
    renderLog();
  }

  function updateState(snapshot) {
    stateInspector.textContent = JSON.stringify(snapshot, null, 2);
  }

  function setScenario(id, updateUrl) {
    var selected =
      SCENARIOS.find(function (scenario) {
        return scenario.id === id;
      }) || SCENARIOS[0];

    if (activeNavigator) {
      activeNavigator.destroy();
    }
    eventLog = [];
    lastEvent.textContent = '—';
    renderLog();
    scenarioSelect.value = selected.id;
    scenarioNote.textContent = selected.description;
    activeNavigator = createDagNavigator(host, {
      fixture: selected.fixture,
      initialState: clone(selected.initial),
      onStateChange: updateState,
      onEvent: handleEvent,
    });

    if (updateUrl) {
      var url = new URL(window.location.href);
      url.searchParams.set('scenario', selected.id);
      window.history.replaceState(null, '', url);
    }
  }

  scenarioSelect.addEventListener('change', function () {
    setScenario(scenarioSelect.value, true);
  });

  document.getElementById('resetScenario').addEventListener('click', function () {
    setScenario(scenarioSelect.value, false);
  });

  document.getElementById('clearLog').addEventListener('click', function () {
    eventLog = [];
    lastEvent.textContent = '—';
    renderLog();
  });

  var initialScenario = new URL(window.location.href).searchParams.get('scenario') || 'roots';
  setScenario(initialScenario, false);
})();
