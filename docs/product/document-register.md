# Реестр проектных документов

Дата: 2026-10-24. Служебный перечень; не новый набор требований.
Начало содержательного чтения — [Идея продукта «Коллекции и подборки»](product-design.md),
обзор связей — [иерархия документов](README.md#иерархия-документов).

## Охват и правила чтения

В реестре 144 проектных Markdown-файла, включая сам реестр.
Код, данные измерений, внешние зависимости и внутренние файлы Git не включены.
Действующий содержательный корпус включает 20 документов и два корня:
идею продукта «Коллекции и подборки» и самостоятельную Теговую платформу,
которую использует приложение.

Роль документа и статус его утверждения — разные признаки. Имя файла
DRAFT или PROPOSAL не отменяет уже принятые разделы и не утверждает остальные.
Корни представляют самостоятельные продукты; положение дочерних документов
задано полем «Родитель» и обратными ссылками, а не каталогами файлов.
Ссылки на основания сохраняют происхождение решений, но не создают вторую
действующую версию правила. Неуточнённые вопросы остаются неуточнёнными.

## Содержательные документы — 20

Структура продуктов, расширений и контрактов. Степень завершённости спецификаций указана в [статусе документов](README.md#готовность-документов). Исторические редакции и снятые варианты находятся вне действующей иерархии.

- [Предметная модель основы продукта](../../CONTEXT.md) — `CONTEXT.md`; родитель: «Идея продукта „Коллекции и подборки“».
- [Согласованная сборка и публикация результатов: проект контракта](../concepts/selection-hierarchy/coherent-result-contract.DRAFT.md) — `docs/concepts/selection-hierarchy/coherent-result-contract.DRAFT.md`; родитель: «Навигация и получение результатов».
- [Составной интерфейс: действия, аргументы и итоги](../concepts/selection-hierarchy/dag-navigator-actions.DRAFT.md) — `docs/concepts/selection-hierarchy/dag-navigator-actions.DRAFT.md`; родитель: «Верхнеуровневый интерфейс Навигатора».
- [Навигатор: компактная модель поведения](../concepts/selection-hierarchy/dag-navigator-behavior-model.DRAFT.md) — `docs/concepts/selection-hierarchy/dag-navigator-behavior-model.DRAFT.md`; родитель: «Верхнеуровневый интерфейс Навигатора».
- [Навигатор: границы и правила интеграции](../concepts/selection-hierarchy/dag-navigator-contract.DRAFT.md) — `docs/concepts/selection-hierarchy/dag-navigator-contract.DRAFT.md`; родитель: «Верхнеуровневый интерфейс Навигатора».
- [Доступ к данным составного интерфейса](../concepts/selection-hierarchy/dag-navigator-data-access.DRAFT.md) — `docs/concepts/selection-hierarchy/dag-navigator-data-access.DRAFT.md`; родитель: «Верхнеуровневый интерфейс Навигатора».
- [Сохранение правки и завершение актуализации](../concepts/selection-hierarchy/dag-navigator-known-changes.PROPOSAL.md) — `docs/concepts/selection-hierarchy/dag-navigator-known-changes.PROPOSAL.md`; родитель: «Согласованная сборка и публикация результатов».
- [Целостный результат: логическая схема составного интерфейса](../concepts/selection-hierarchy/dag-navigator-result-schema.DRAFT.md) — `docs/concepts/selection-hierarchy/dag-navigator-result-schema.DRAFT.md`; родитель: «Верхнеуровневый интерфейс Навигатора».
- [Верхнеуровневый интерфейс Навигатора: сводка](../concepts/selection-hierarchy/dag-navigator-upper-interface.DRAFT.md) — `docs/concepts/selection-hierarchy/dag-navigator-upper-interface.DRAFT.md`; родитель: «Навигация и получение результатов».
- [Общий контракт истории посещений](../concepts/selection-hierarchy/navigation-history-contract.DRAFT.md) — `docs/concepts/selection-hierarchy/navigation-history-contract.DRAFT.md`; родитель: «Навигация и получение результатов».
- [Общий контракт выдачи результатов](../concepts/selection-hierarchy/results-view-contract.DRAFT.md) — `docs/concepts/selection-hierarchy/results-view-contract.DRAFT.md`; родитель: «Навигация и получение результатов».
- [Ручной ввод тегов](../concepts/selection-hierarchy/tag-input-contract.DRAFT.md) — `docs/concepts/selection-hierarchy/tag-input-contract.DRAFT.md`; родитель: «Навигация и получение результатов».
- [Сравнение элементов](comparison.md) — `docs/product/comparison.md`; родитель: «Идея продукта „Коллекции и подборки“».
- [Продолжение работы](comparison/continuation.md) — `docs/product/comparison/continuation.md`; родитель: «Сравнение элементов».
- [Спецификация MVP](mvp-scope.md) — `docs/product/mvp-scope.md`; родитель: «Идея продукта „Коллекции и подборки“».
- [Технический проект MVP](mvp-technical-design.md) — `docs/product/mvp-technical-design.md`; родитель: «Спецификация MVP».
- [Навигация и получение результатов](navigation-and-results.md) — `docs/product/navigation-and-results.md`; родитель: «Идея продукта „Коллекции и подборки“».
- [Идея продукта «Коллекции и подборки»](product-design.md) — `docs/product/product-design.md`.
- [Теговая платформа](tag-platform.md) — `docs/product/tag-platform.md`; самостоятельный продуктовый корень, используемый приложением «Коллекции и подборки».
- [Глоссарий тегов](tag-glossary.md) — `docs/product/tag-glossary.md`; родитель: «Идея продукта „Коллекции и подборки“».

## Альтернативная предметная модель — 1

Альтернатива без коллекций; не включена в действующую модель продукта.

- [Иерархия подборок](../concepts/selection-hierarchy/CONTEXT.md) — `docs/concepts/selection-hierarchy/CONTEXT.md`.

## Исследования и свидетельства — 34

Планы, измерения, обзоры и оценки. Их выводы используются с исходными ограничениями; это не автоматически принятые требования продукта.

Ограничение доступности: 33 ссылки внутри исследования living-tags-glossary.md
ведут в соседние репозитории living-tags-core и living-tags-saas, отсутствующие
по указанным путям в этом рабочем дереве. Исследование сохранено без переписывания;
при повторном использовании этих свидетельств потребуются исходные репозитории.
Это не разрывы связей внутри текущей документации продукта.

- [Грубая карта применимости: ограниченный остаток исследования](../research/dag-navigator-applicability-budget.PLAN.md) — `docs/research/dag-navigator-applicability-budget.PLAN.md`.
- [Согласованная основа классов применимости](../research/dag-navigator-applicability-classes.DRAFT.md) — `docs/research/dag-navigator-applicability-classes.DRAFT.md`.
- [DAG-навигация: частичная карта применимости](../research/dag-navigator-applicability-map.md) — `docs/research/dag-navigator-applicability-map.md`.
- [Реалистичные применения: практическая сводка](../research/dag-navigator-applicability-practical-summary.md) — `docs/research/dag-navigator-applicability-practical-summary.md`.
- [Первичное сопоставление классов с профилями](../research/dag-navigator-applicability-profile-assessment.DRAFT.md) — `docs/research/dag-navigator-applicability-profile-assessment.DRAFT.md`.
- [Профили применения: черновик для классификации](../research/dag-navigator-applicability-scenarios.DRAFT.md) — `docs/research/dag-navigator-applicability-scenarios.DRAFT.md`.
- [Четыре читателя: согласованность сохраняется, отклик и очередь растут](../research/dag-navigator-concurrency-C1.md) — `docs/research/dag-navigator-concurrency-C1.md`.
- [Десять пространств: перенос измерен, конкурентная серия частична](../research/dag-navigator-concurrency-C2.md) — `docs/research/dag-navigator-concurrency-C2.md`.
- [Конкуренция и разделение пространств: ограниченный этап](../research/dag-navigator-concurrency-stage.PLAN.md) — `docs/research/dag-navigator-concurrency-stage.PLAN.md`.
- [DAG-навигатор: свежесть чтения и масштабируемость](../research/dag-navigator-freshness-scalability.md) — `docs/research/dag-navigator-freshness-scalability.md`.
- [DAG-навигатор: контекст известных изменений и существующие практики](../research/dag-navigator-known-changes-patterns.md) — `docs/research/dag-navigator-known-changes-patterns.md`.
- [DAG-навигатор: допуск к миллионной ступени](../research/dag-navigator-million-admission.PLAN.md) — `docs/research/dag-navigator-million-admission.PLAN.md`.
- [DAG-навигатор: рост числа сохранённых фильтров](../research/dag-navigator-saved-filter-growth.PLAN.md) — `docs/research/dag-navigator-saved-filter-growth.PLAN.md`.
- [Форма DAG: цепочки, ромбы и длинные фильтры](../research/dag-navigator-scaling-catalog-shape.md) — `docs/research/dag-navigator-scaling-catalog-shape.md`.
- [Плотность тегов: первая группа и остановка допуска](../research/dag-navigator-scaling-density-groups.md) — `docs/research/dag-navigator-scaling-density-groups.md`.
- [DAG-навигатор: границы возможного масштабирования](../research/dag-navigator-scaling-envelope.md) — `docs/research/dag-navigator-scaling-envelope.md`.
- [DAG-навигатор: план измерения границ масштабирования](../research/dag-navigator-scaling-experiment.PLAN.md) — `docs/research/dag-navigator-scaling-experiment.PLAN.md`.
- [Две многомерные точки: размеры и коррелированные теги](../research/dag-navigator-scaling-exploration.md) — `docs/research/dag-navigator-scaling-exploration.md`.
- [DAG-навигатор: рост базы 10k → 100k при фиксированном словаре](../research/dag-navigator-scaling-growth-100k.md) — `docs/research/dag-navigator-scaling-growth-100k.md`.
- [DAG-навигатор: завершение миллионной серии](../research/dag-navigator-scaling-million-completed.md) — `docs/research/dag-navigator-scaling-million-completed.md`.
- [DAG-навигатор: миллион элементов, неполная серия](../research/dag-navigator-scaling-million.md) — `docs/research/dag-navigator-scaling-million.md`.
- [DAG-навигатор: первая измеренная точка, 10 тысяч элементов](../research/dag-navigator-scaling-pilot-10k.md) — `docs/research/dag-navigator-scaling-pilot-10k.md`.
- [DAG-навигатор: много сохранённых подборок при небольшой базе](../research/dag-navigator-scaling-saved-filters.md) — `docs/research/dag-navigator-scaling-saved-filters.md`.
- [DAG-навигатор: рост полного ответа при фиксированной базе](../research/dag-navigator-scaling-width-10k.md) — `docs/research/dag-navigator-scaling-width-10k.md`.
- [PostgreSQL: один подготовленный корпус, чтение без записи](../research/dag-navigator-storage-D1.md) — `docs/research/dag-navigator-storage-D1.md`.
- [PostgreSQL: согласованное чтение во время изменений](../research/dag-navigator-storage-D2.md) — `docs/research/dag-navigator-storage-D2.md`.
- [DAG-навигатор: первоисточники для PostgreSQL-кандидата](../research/dag-navigator-storage-primary-sources.md) — `docs/research/dag-navigator-storage-primary-sources.md`.
- [Локальное хранилище и изменения: подготовка ограниченного этапа](../research/dag-navigator-storage-stage.PLAN.md) — `docs/research/dag-navigator-storage-stage.PLAN.md`.
- [Что взять из `living-tags-*` для глоссария «Коллекций»](../research/living-tags-glossary.md) — `docs/research/living-tags-glossary.md`.
- [MVP: порядок расходов до выбора бюджета](../research/mvp-infrastructure-cost-envelope.DRAFT.md) — `docs/research/mvp-infrastructure-cost-envelope.DRAFT.md`.
- [Технический фундамент демонстрационного продукта «Коллекции»](../research/product-prototype-foundation.md) — `docs/research/product-prototype-foundation.md`.
- [Переиспользование общей пагинации](../research/results-view-reuse-options.md) — `docs/research/results-view-reuse-options.md`.
- [Selectel: один VPS для MVP](../research/selectel-selfhost-price-sources-2026-10.md) — `docs/research/selectel-selfhost-price-sources-2026-10.md`.
- [Self-hosted VPS и Yandex Cloud для демонстрационного продукта «Коллекции»](../research/self-hosted-and-yandex-product-foundation.md) — `docs/research/self-hosted-and-yandex-product-foundation.md`.

## Карты работ и записи согласований — 61

Служебные маршруты, вопросы и история решений. Статус каждого вопроса указан в нём; папка .scratch сама по себе не означает, что все материалы устарели.

- [Исследовать технический фундамент демонстрационного продукта](../../.scratch/collections-product-prototype/issues/00-research-product-foundation.md) — `.scratch/collections-product-prototype/issues/00-research-product-foundation.md`.
- [Выбрать технический фундамент демонстрационного продукта](../../.scratch/collections-product-prototype/issues/01-choose-product-foundation.md) — `.scratch/collections-product-prototype/issues/01-choose-product-foundation.md`.
- [Собрать сохраняющий данные walking skeleton](../../.scratch/collections-product-prototype/issues/02-build-persistent-walking-skeleton.md) — `.scratch/collections-product-prototype/issues/02-build-persistent-walking-skeleton.md`.
- [Спецификация демонстрационного продуктового прототипа «Коллекции»](../../.scratch/collections-product-prototype/issues/03-specify-demonstration-product.md) — `.scratch/collections-product-prototype/issues/03-specify-demonstration-product.md`.
- [Исследовать self-hosted VPS и Yandex Cloud как фундамент продукта](../../.scratch/collections-product-prototype/issues/04-research-self-hosted-yandex-foundation.md) — `.scratch/collections-product-prototype/issues/04-research-self-hosted-yandex-foundation.md`.
- [Демонстрационный продуктовый прототип «Коллекций»](../../.scratch/collections-product-prototype/map.md) — `.scratch/collections-product-prototype/map.md`.
- [Определить продуктовый центр «Коллекций»](../../.scratch/collections/issues/00-product-center.md) — `.scratch/collections/issues/00-product-center.md`.
- [Найти основной интерфейс коллекции](../../.scratch/collections/issues/01-collection-workspace.md) — `.scratch/collections/issues/01-collection-workspace.md`.
- [Спроектировать разметку и глоссарий тегов](../../.scratch/collections/issues/02-tagging-glossary.md) — `.scratch/collections/issues/02-tagging-glossary.md`.
- [Спроектировать возвращение к незавершённым сортировкам](../../.scratch/collections/issues/03-unfinished-sorting.md) — `.scratch/collections/issues/03-unfinished-sorting.md`.
- [Спроектировать изменение коллекции во время сортировки](../../.scratch/collections/issues/04-version-changes.md) — `.scratch/collections/issues/04-version-changes.md`.
- [Спроектировать продолжение и пересмотр порядка](../../.scratch/collections/issues/05-order-continuation.md) — `.scratch/collections/issues/05-order-continuation.md`.
- [Связать коллекцию с игровым интерфейсом сортировки](../../.scratch/collections/issues/06-sorting-integration.md) — `.scratch/collections/issues/06-sorting-integration.md`.
- [Собрать работающий PoC «Коллекций»](../../.scratch/collections/issues/07-build-poc.md) — `.scratch/collections/issues/07-build-poc.md`.
- [Провести первую интерактивную проверку PoC «Коллекций»](../../.scratch/collections/issues/08-review-poc.md) — `.scratch/collections/issues/08-review-poc.md`.
- [Проверить реализуемость линейного порядка с равноценностью](../../.scratch/collections/issues/09-linear-order-feasibility.md) — `.scratch/collections/issues/09-linear-order-feasibility.md`.
- [Спроектировать быстрый просмотр коллекций и срезов](../../.scratch/collections/issues/10-collection-slice-quick-browse.md) — `.scratch/collections/issues/10-collection-slice-quick-browse.md`.
- [Заменить крестик на галочку при сохранении закрытием](../../.scratch/collections/issues/11-save-confirmation-icon.md) — `.scratch/collections/issues/11-save-confirmation-icon.md`.
- [Интерактивный PoC «Коллекций»](../../.scratch/collections/map.md) — `.scratch/collections/map.md`.
- [Формализовать принятую предметную часть DAG-навигатора](../../.scratch/dag-navigation-lab/formalize-dag-contract.TASK.md) — `.scratch/dag-navigation-lab/formalize-dag-contract.TASK.md`.
- [Собрать изолированную лабораторию навигатора](../../.scratch/dag-navigation-lab/issues/00-build-isolated-navigator-lab.md) — `.scratch/dag-navigation-lab/issues/00-build-isolated-navigator-lab.md`.
- [Проверить постоянно видимые результаты с выезжающим DAG-фильтром](../../.scratch/dag-navigation-lab/issues/01-results-first-drawer.md) — `.scratch/dag-navigation-lab/issues/01-results-first-drawer.md`.
- [Уточнить публичный контракт DAG-навигатора](../../.scratch/dag-navigation-lab/issues/02-define-navigator-contract.md) — `.scratch/dag-navigation-lab/issues/02-define-navigator-contract.md`.
- [Оценить свежесть чтения и масштабируемость](../../.scratch/dag-navigation-lab/issues/03-assess-freshness-scalability.md) — `.scratch/dag-navigation-lab/issues/03-assess-freshness-scalability.md`.
- [Определить границы возможного масштабирования](../../.scratch/dag-navigation-lab/issues/04-assess-scaling-envelope.md) — `.scratch/dag-navigation-lab/issues/04-assess-scaling-envelope.md`.
- [Подготовить малый эталон и индексный кандидат](../../.scratch/dag-navigation-lab/issues/05-build-small-scaling-rig.md) — `.scratch/dag-navigation-lab/issues/05-build-small-scaling-rig.md`.
- [Измерить первый профиль на 10 тысячах элементов](../../.scratch/dag-navigation-lab/issues/06-measure-first-scaling-profile.md) — `.scratch/dag-navigation-lab/issues/06-measure-first-scaling-profile.md`.
- [Проверить рост базы при фиксированном словаре](../../.scratch/dag-navigation-lab/issues/07-measure-fixed-vocabulary-growth.md) — `.scratch/dag-navigation-lab/issues/07-measure-fixed-vocabulary-growth.md`.
- [Измерить рост полного ответа при фиксированной базе](../../.scratch/dag-navigation-lab/issues/08-measure-response-width.md) — `.scratch/dag-navigation-lab/issues/08-measure-response-width.md`.
- [Подготовить безопасную миллионную ступень](../../.scratch/dag-navigation-lab/issues/09-prepare-million-profile.md) — `.scratch/dag-navigation-lab/issues/09-prepare-million-profile.md`.
- [Проверить миллионный профиль с порционным эталоном](../../.scratch/dag-navigation-lab/issues/10-measure-million-profile.md) — `.scratch/dag-navigation-lab/issues/10-measure-million-profile.md`.
- [Устранить ложный отказ надзора и завершить миллионную серию](../../.scratch/dag-navigation-lab/issues/11-complete-million-series.md) — `.scratch/dag-navigation-lab/issues/11-complete-million-series.md`.
- [Подготовить профиль роста сохранённых фильтров](../../.scratch/dag-navigation-lab/issues/12-prepare-saved-filter-growth.md) — `.scratch/dag-navigation-lab/issues/12-prepare-saved-filter-growth.md`.
- [Измерить рост числа сохранённых фильтров](../../.scratch/dag-navigation-lab/issues/13-measure-saved-filter-growth.md) — `.scratch/dag-navigation-lab/issues/13-measure-saved-filter-growth.md`.
- [Проверить устранимость замедления широкого каталога подборок](../../.scratch/dag-navigation-lab/issues/14-assess-wide-catalog-cost.md) — `.scratch/dag-navigation-lab/issues/14-assess-wide-catalog-cost.md`.
- [Устранить гонку выхода в старом измерительном надзоре](../../.scratch/dag-navigation-lab/issues/15-legacy-supervision-exit-race.md) — `.scratch/dag-navigation-lab/issues/15-legacy-supervision-exit-race.md`.
- [Ограничить остаток исследования применимости уже затраченным бюджетом](../../.scratch/dag-navigation-lab/issues/16-bound-applicability-study.md) — `.scratch/dag-navigation-lab/issues/16-bound-applicability-study.md`.
- [Оценить сочетания данных ограниченным статическим набором](../../.scratch/dag-navigation-lab/issues/17-coarse-static-profiles.md) — `.scratch/dag-navigation-lab/issues/17-coarse-static-profiles.md`.
- [Оценить локальное хранилище и изменения в ограниченном бюджете](../../.scratch/dag-navigation-lab/issues/18-coarse-storage-and-writes.md) — `.scratch/dag-navigation-lab/issues/18-coarse-storage-and-writes.md`.
- [Оценить конкуренцию и разделение пространств двумя профилями](../../.scratch/dag-navigation-lab/issues/19-coarse-concurrency.md) — `.scratch/dag-navigation-lab/issues/19-coarse-concurrency.md`.
- [Свести грубую карту применимости в пределах бюджета](../../.scratch/dag-navigation-lab/issues/20-summarize-applicability.md) — `.scratch/dag-navigation-lab/issues/20-summarize-applicability.md`.
- [Определить классы применимости относительно требований сценариев](../../.scratch/dag-navigation-lab/issues/21-define-applicability-classes.md) — `.scratch/dag-navigation-lab/issues/21-define-applicability-classes.md`.
- [Сопоставить классы с имеющимися профилями](../../.scratch/dag-navigation-lab/issues/22-relate-profiles-to-classes.md) — `.scratch/dag-navigation-lab/issues/22-relate-profiles-to-classes.md`.
- [Определить общий контракт выдачи результатов](../../.scratch/dag-navigation-lab/issues/23-define-results-view-contract.md) — `.scratch/dag-navigation-lab/issues/23-define-results-view-contract.md`.
- [Определить общий контракт истории посещений](../../.scratch/dag-navigation-lab/issues/24-define-navigation-history-contract.md) — `.scratch/dag-navigation-lab/issues/24-define-navigation-history-contract.md`.
- [Определить общий контракт согласованной сборки результатов](../../.scratch/dag-navigation-lab/issues/25-define-coherent-result-contract.md) — `.scratch/dag-navigation-lab/issues/25-define-coherent-result-contract.md`.
- [Изолированная лаборатория DAG-навигации](../../.scratch/dag-navigation-lab/map.md) — `.scratch/dag-navigation-lab/map.md`.
- [Выбрать направления для проверки DAG-навигации](../../.scratch/dag-navigation/issues/00-choose-navigation-directions.md) — `.scratch/dag-navigation/issues/00-choose-navigation-directions.md`.
- [Mobile-first навигация по DAG подборок](../../.scratch/dag-navigation/map.md) — `.scratch/dag-navigation/map.md`.
- [Определить состав и границы MVP](../../.scratch/mvp-design/issues/00-define-mvp-scope.md) — `.scratch/mvp-design/issues/00-define-mvp-scope.md`.
- [Завершить проектирование MVP продукта](../../.scratch/mvp-design/map.md) — `.scratch/mvp-design/map.md`.
- [Контрольная точка перед новым навигационным концептом DAG](../../.scratch/selection-hierarchy-prototype/checkpoint-2026-09-05.md) — `.scratch/selection-hierarchy-prototype/checkpoint-2026-09-05.md`.
- [Определить пустое личное пространство](../../.scratch/selection-hierarchy-prototype/issues/00-define-empty-personal-space.md) — `.scratch/selection-hierarchy-prototype/issues/00-define-empty-personal-space.md`.
- [Интерактивный прототип «Иерархии подборок»](../../.scratch/selection-hierarchy-prototype/map.md) — `.scratch/selection-hierarchy-prototype/map.md`.
- [Определить границу существования данных без коллекции](../../.scratch/selection-hierarchy/issues/00-define-existence-boundary.md) — `.scratch/selection-hierarchy/issues/00-define-existence-boundary.md`.
- [Определить наследование критериев и область порядка](../../.scratch/selection-hierarchy/issues/01-define-ordering-scope.md) — `.scratch/selection-hierarchy/issues/01-define-ordering-scope.md`.
- [Различить совпадающие критерии разных родителей](../../.scratch/selection-hierarchy/issues/02-resolve-inherited-criterion-identity.md) — `.scratch/selection-hierarchy/issues/02-resolve-inherited-criterion-identity.md`.
- [Определить способы формирования подборки](../../.scratch/selection-hierarchy/issues/03-define-selection-membership.md) — `.scratch/selection-hierarchy/issues/03-define-selection-membership.md`.
- [Определить выразительность фильтров](../../.scratch/selection-hierarchy/issues/04-define-filter-expressiveness.md) — `.scratch/selection-hierarchy/issues/04-define-filter-expressiveness.md`.
- [Определить жизненный цикл пользовательской иерархии подборок](../../.scratch/selection-hierarchy/issues/05-define-user-hierarchy-lifecycle.md) — `.scratch/selection-hierarchy/issues/05-define-user-hierarchy-lifecycle.md`.
- [Иерархия подборок](../../.scratch/selection-hierarchy/map.md) — `.scratch/selection-hierarchy/map.md`.

## Прототипы, прежний интерфейс и референсы — 5

Описание экспериментальных реализаций и исторические материалы. Поведение прототипа не заменяет действующее продуктовое правило.

- [Интерфейс прежнего продуктового прототипа](../archive/collection-interface.PROTOTYPE.md) — `docs/archive/collection-interface.PROTOTYPE.md`.
- [DAG navigator lab: minimal contract](../../prototypes/dag-navigation-lab.CONTRACT.md) — `prototypes/dag-navigation-lab.CONTRACT.md`.
- [Вычислительный стенд — PROTOTYPE](../../prototypes/dag-scaling.PROTOTYPE/README.md) — `prototypes/dag-scaling.PROTOTYPE/README.md`.
- [Прототипы продукта «Коллекции и подборки»](../../prototypes/README.md) — `prototypes/README.md`.
- [Референсы из `to-ili-eto`](../../references/legacy.md) — `references/legacy.md`.

## Служебные указатели, правила и состояние работы — 10

Организуют работу и чтение документов. Не являются дополнительными возможностями продукта.

- [Project workflow](../../AGENTS.md) — `AGENTS.md`.
- [Экспресс-бэклог](../../BACKLOG.md) — `BACKLOG.md`.
- [Контексты продукта «Коллекции и подборки»](../../CONTEXT-MAP.md) — `CONTEXT-MAP.md`.
- [Задание на независимый аудит документации](../agents/document-audit.md) — `docs/agents/document-audit.md`.
- [Issue tracker: Local Markdown](../agents/issue-tracker.md) — `docs/agents/issue-tracker.md`.
- [Реестр проектных документов](document-register.md) — `docs/product/document-register.md`.
- [Проектирование продукта: документы и текущая работа](README.md) — `docs/product/README.md`.
- [Оценка применимости DAG-навигатора](../../GLOSSARY.md) — `GLOSSARY.md`.
- [HANDOFF](../../HANDOFF.md) — `HANDOFF.md`.
- [Коллекции и подборки](../../README.md) — `README.md`.

## Архивные редакции вне действующей иерархии — 13

Только для проверки происхождения решений; не источники действующих требований.

- [Снимок идеи продукта перед пользовательскими правками от 2026-10-21](../../.scratch/document-snapshots/product-design_before-user-edits_2026-10-21_02-49-59.md) — `.scratch/document-snapshots/product-design_before-user-edits_2026-10-21_02-49-59.md`; неизменяемый снимок, восемь относительных ссылок сохранены в исходном виде и не разрешаются из каталога снимка.
- [Предметная модель основы продукта](../archive/2026-10-15/product-core.md) — `docs/archive/2026-10-15/product-core.md`.
- [Верхнеуровневый интерфейс Навигатора: сводка](../archive/2026-10-15/dag-navigator-upper-interface.DRAFT.md) — `docs/archive/2026-10-15/dag-navigator-upper-interface.DRAFT.md`.
- [Составной интерфейс: действия, аргументы и итоги](../archive/2026-10-15/dag-navigator-actions.DRAFT.md) — `docs/archive/2026-10-15/dag-navigator-actions.DRAFT.md`.
- [Целостный результат: логическая схема составного интерфейса](../archive/2026-10-15/dag-navigator-result-schema.DRAFT.md) — `docs/archive/2026-10-15/dag-navigator-result-schema.DRAFT.md`.
- [Доступ к данным составного интерфейса](../archive/2026-10-15/dag-navigator-data-access.DRAFT.md) — `docs/archive/2026-10-15/dag-navigator-data-access.DRAFT.md`.
- [Навигатор: компактная модель поведения](../archive/2026-10-15/dag-navigator-behavior-model.DRAFT.md) — `docs/archive/2026-10-15/dag-navigator-behavior-model.DRAFT.md`.
- [Общий контракт выдачи результатов](../archive/2026-10-15/results-view-contract.DRAFT.md) — `docs/archive/2026-10-15/results-view-contract.DRAFT.md`.
- [Общий контракт истории посещений](../archive/2026-10-15/navigation-history-contract.DRAFT.md) — `docs/archive/2026-10-15/navigation-history-contract.DRAFT.md`.
- [Согласованная сборка и публикация результатов: проект контракта](../archive/2026-10-15/coherent-result-contract.DRAFT.md) — `docs/archive/2026-10-15/coherent-result-contract.DRAFT.md`.
- [Сохранение правки и завершение актуализации](../archive/2026-10-15/dag-navigator-known-changes.PROPOSAL.md) — `docs/archive/2026-10-15/dag-navigator-known-changes.PROPOSAL.md`.
- [DAG-навигатор: проект контракта](../archive/2026-10-15/dag-navigator-contract.DRAFT.md) — `docs/archive/2026-10-15/dag-navigator-contract.DRAFT.md`.
- [Архив проектных материалов](../archive/README.md) — `docs/archive/README.md`.
