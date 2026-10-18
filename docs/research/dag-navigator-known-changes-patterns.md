# DAG-навигатор: контекст известных изменений и существующие практики

Дата: 2026-10-04. Официальные источники проверены заново через web.
Статус: исследование, не выбор backend или принятие
[предложения об интерфейсе](../concepts/selection-hierarchy/dag-navigator-known-changes.PROPOSAL.md#контекст-известных-изменений).
Исходные принятые правила берутся из [HANDOFF](../../HANDOFF.md): один
согласованный комплект; завершение пересчёта после подтверждения охвата
сохранённых изменений, известных приложению на старте цикла; ожидание
исправного, но отстающего источника отличается от отказа чтения.

## Ответ на вопрос о распространённости

**Вывод из трёх независимых реализаций:** передавать причинный контекст,
чтобы следующее чтение не опередило известные записи, — устоявшийся приём
распределённых БД. Это не изобретение данного Навигатора. Документация
Cosmos DB, MongoDB и Neo4j подтверждает его существование, но не измеряет
долю применений в индустрии и не устанавливает универсальный публичный
контракт `knownChanges`. Прямой публичный аналог непрозрачного поля
запроса есть у Neo4j Query API; другие рассматриваемые API часто скрывают
передачу внутри SDK. [Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-consistency#utilize-session-tokens),
[MongoDB](https://www.mongodb.com/docs/manual/reference/read-concern/#read-operations-and-afterclustertime),
[Neo4j Query API](https://neo4j.com/docs/query-api/current/bookmarks/).

| Пример | Как вызывающая сторона использует контекст | Граница гарантии |
| --- | --- | --- |
| Cosmos DB session token | `CosmosClient` ведёт токены автоматически; при необходимости приложение получает токен ответа и задаёт его в параметрах следующего запроса. Для web-приложения с несколькими экземплярами и балансировкой без session affinity официально описана передача через клиента. [SDK и ручная передача](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-consistency#utilize-session-tokens). | Токен — минимальная граница версии, а не запрос исторического снимка; привязан к разделу данных. Содержимое передаваемого токена нельзя изменять. При отсутствии токена в кэше для физического раздела чтение ведёт себя как eventual consistency. [Семантика session consistency](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#session-consistency). |
| MongoDB causal session | Приложение передаёт `ClientSession` операциям; драйвер подставляет `afterClusterTime`. Документация рекомендует не задавать его вручную. Между сессиями можно переносить operation time и cluster time. [Чтения](https://www.mongodb.com/docs/manual/reference/read-concern/#read-operations-and-afterclustertime), [перенос контекста](https://www.mongodb.com/docs/manual/core/read-isolation-consistency-recency/#causal-consistency). | `afterClusterTime` требует исполнения после достижения заданного времени oplog. Для устойчивых четырёх causal guarantees нужны causal session, чтения `majority` и записи `majority`. [Read concern](https://www.mongodb.com/docs/manual/reference/read-concern/#read-operations-and-afterclustertime), [условия гарантий](https://www.mongodb.com/docs/manual/core/causal-consistency-read-write-concerns/). |
| Neo4j bookmarks | Query API возвращает encoded bookmarks; запрос может явно передать список в `bookmarks`. Клиент не должен разбирать или изменять их. Сервер ждёт применения покрываемых изменений до выполнения транзакции. [Публичный HTTP API](https://neo4j.com/docs/query-api/current/bookmarks/). | В JavaScript driver `executeQuery()` и отдельная сессия ведут bookmarks автоматически. Между несколькими сессиями контекст собирают и передают явно или через общий bookmark manager. [Driver API](https://neo4j.com/docs/javascript-manual/current/bookmarks/). |

## Причинность, свои записи и общий снимок

Read-your-writes — гарантия видеть последствия предшествующих записей
сессии. Causal consistency в модели MongoDB дополнительно включает
monotonic reads, monotonic writes и writes-follow-reads; операции вне
сессии могут вмешиваться между её операциями. Поэтому причинная сессия
не замораживает единое состояние для нескольких чтений.
[MongoDB: гарантии и изоляция](https://www.mongodb.com/docs/manual/core/read-isolation-consistency-recency/#causal-consistency).

У Cosmos DB session token явно назван minimum version barrier. У MongoDB
`afterClusterTime` задаёт нижнюю границу, а `snapshot` с `atClusterTime`
выбирает конкретную точку времени. Эти два поля нельзя задать вместе;
`atClusterTime` нельзя просто добавить внутрь causal session. Для снимка
также действует ограниченное окно истории.
[Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#session-consistency),
[MongoDB: lower bound](https://www.mongodb.com/docs/manual/reference/read-concern/#read-operations-and-afterclustertime),
[MongoDB: snapshot](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/).

**Вывод для нашего требования:** цель «охватить известные изменения» и
ревизия согласованного комплекта имеют разные роли. Удовлетворение первой
не доказывает вторую. Если среди известных изменений есть записи другого
устройства или обработчика, одной гарантии «вижу собственные записи этой
сессии» недостаточно без переноса соответствующего контекста. Источники
показывают перенос для нескольких writers/сессий, но конкретное объединение
для нашего адаптера ещё предстоит определить.
[Cosmos DB: несколько writers](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#session-consistency),
[MongoDB: межсессионная причинность](https://www.mongodb.com/docs/manual/core/read-isolation-consistency-recency/#causal-consistency),
[Neo4j: несколько сессий](https://neo4j.com/docs/javascript-manual/current/bookmarks/).

## Какие обобщения были бы неточными

- **«Каждое чтение несёт такой токен».** В MongoDB вне causal session
  `afterClusterTime` не задан; первый causal read тоже не передаёт его,
  пока operation time ещё неизвестен. В Cosmos DB для раздела может не
  быть кэшированного токена. В Neo4j bookmark management можно отключить.
  [MongoDB manual](https://www.mongodb.com/docs/manual/reference/read-concern/#read-operations-and-afterclustertime),
  [MongoDB driver specification, test plan](https://github.com/mongodb/specifications/blob/master/source/causal-consistency/causal-consistency.md#test-plan),
  [Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#session-consistency),
  [Neo4j](https://neo4j.com/docs/javascript-manual/current/bookmarks/).
- **«Все causal contexts — непрозрачные строки».** Cosmos DB и Neo4j
  предписывают сохранять содержимое токенов; MongoDB API открывает
  структурированные logical timestamps и операции их продвижения.
  В драйвере именно session `operationTime` становится `afterClusterTime`,
  а `$clusterTime` также участвует в распространении логического времени.
  Это не два взаимозаменяемых названия одной ревизии.
  [Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#session-consistency),
  [Neo4j Query API](https://neo4j.com/docs/query-api/current/bookmarks/),
  [MongoDB driver specification](https://github.com/mongodb/specifications/blob/master/source/causal-consistency/causal-consistency.md#server-commands).
- **«Session требует закрепить пользователя за сервером приложения».**
  Cosmos DB прямо описывает работу без affinity через перенос токена.
  MongoDB допускает перенос времён в другую client session; Neo4j —
  передачу bookmarks между сессиями, создание которых описано как лёгкая
  операция. Это не обещание отсутствия состояния в БД/SDK и не требование
  долго удерживать серверную транзакцию между обновлениями UI.
  [Cosmos DB web tiers](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-consistency#utilize-session-tokens),
  [MongoDB](https://www.mongodb.com/docs/manual/core/read-isolation-consistency-recency/#causal-consistency),
  [Neo4j bookmarks](https://neo4j.com/docs/javascript-manual/current/bookmarks/),
  [Neo4j sessions](https://neo4j.com/docs/javascript-manual/current/transactions/#create-a-session).

## Цена и пределы переноса в Навигатор

При отставании контекст может вызвать ожидание, повтор или маршрутизацию
на другую реплику: Cosmos DB описывает retries по репликам/регионам,
MongoDB ждёт продвижения oplog, Neo4j предупреждает о влиянии bookmarks
на производительность. MongoDB driver specification отдельно объясняет,
что более новый, чем необходимо, operation time заставляет отстающую
secondary ждать дольше. Это цена гарантии, не установленный SLO нашего
продукта. [Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#session-consistency),
[MongoDB read concern](https://www.mongodb.com/docs/manual/reference/read-concern/#read-operations-and-afterclustertime),
[Neo4j](https://neo4j.com/docs/javascript-manual/current/bookmarks/),
[MongoDB rationale](https://github.com/mongodb/specifications/blob/master/source/causal-consistency/causal-consistency.md#design-rationale).

**Наш вывод, а не готовая гарантия этих БД:** маркер фиксации в исходном
хранилище ещё не доказывает готовность отдельного асинхронного индекса,
счётчиков или иной проекции. Адаптер должен доказать покрытие именно всех
зависимостей выдаваемого комплекта и его общего состояния. Область действия,
объединение контекста, восстановление после перезапуска и различение
установленного отставания с отказом остаются его обязательствами.
Обычная ошибка или timeout сами по себе не доказывают, что источник
исправен и нужно лишь ждать. Это анализ применимости механизмов выше,
не принятие нового протокола или способа обработки ошибок.

Непрозрачный `knownChanges`, сформированный и понятый адаптером, —
возможная собственная абстракция над существующим приёмом. Исследование
даёт основание обсуждать её как реалистичную; не доказывает, что её следует
вынести в публичный интерфейс Навигатора или что это единственный способ
выполнить уже принятое правило. Формат, backend, server sessions и сроки
не выбраны. Тесты, серверы, контейнеры и новые измерения не запускались.
