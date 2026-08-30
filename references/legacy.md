# Референсы из `to-ili-eto`

Предыдущий репозиторий — `https://github.com/aiaiai-copilot/to-ili-eto`. Его материалы являются исследовательскими референсами, а не требованиями продукта «Коллекции».

## Использовать

- [Игровой интерфейс сравнения](https://github.com/aiaiai-copilot/to-ili-eto/blob/236a27ce1f3573d8149eac41b30b57e1a84241a4/prototypes/comparison-game-ui.PROTOTYPE.html), commit `236a27c`: двухпанельный touch-first цикл, выбор объекта тапом, равноценность, откладывание, полноэкранный просмотр и лаконичный прогресс.
- [Транзитивный источник пар](https://github.com/aiaiai-copilot/to-ili-eto/commit/5505c9efe6d7b9a352e6642928d7aac2a16129c5), commit `5505c9e`: известные транзитивные отношения не требуют повторного выбора.
- [Алгоритмический прогресс](https://github.com/aiaiai-copilot/to-ili-eto/commit/895ae5beb9fd54f4525c47fd7d1305f3a2a58718), commit `895ae5b`: источник сообщает монотонную долю выполненной работы.
- [Оценка числа сравнений](https://github.com/aiaiai-copilot/to-ili-eto/commit/0e447cdf32332b528185ae61c2db99297ac2e379), commit `0e447cd`: ожидаемое и максимальное число сравнений до начала задачи.

## Только исторический материал

- Локальная ветка `prototype/collection-workspace`, commit `c9c4fba`, файл `/Users/alexanderlapygin/Projects/to-ili-eto/.worktrees/collection-workspace-prototype/prototypes/collection-workspace.PROTOTYPE.html`: интерфейс до перехода к сохранённым фильтрам и общему порядку. Не использовать как выбранную компоновку.
- Локальный архивный checkpoint `c1cc271` и `/Users/alexanderlapygin/Projects/to-ili-eto/MIGRATION.md`: rationale и точная граница переноса.

## Не наследовать

- независимые порядки отдельных задач;
- постоянную навигацию «В процессе / Начать / Готовые»;
- компоновку B «Мастерская» и прежнюю левую панель;
- старые карты `wayfinder`, `HANDOFF.md`, ветки и git-историю.
