# DAG-навигатор: первоисточники для PostgreSQL-кандидата

Дата проверки: 2026-09-28. Область: ограниченный исследовательский адаптер
PostgreSQL 17 для D1/D2 и последующих C1/C2, не выбор backend продукта.
Проверены официальная документация PostgreSQL 17, исходники `REL_17_STABLE`
и актуальная документация Docker. Контейнеры, SQL и тесты в этой работе
не запускались; продуктовые env/DSN не читались. Ниже факты источников
отделены от предложений для стенда.

## Подтверждённые факты

### 1. Снимок полного чтения

`REPEATABLE READ` фиксирует снимок при первом запросе/операторе работы
с данными, не при одном лишь `BEGIN`. Последующие чтения внутри этой
транзакции не видят более поздние коммиты. При `READ COMMITTED` два
`SELECT` одной транзакции могут видеть разные состояния. PostgreSQL
исключает phantom reads для Repeatable Read; read-only транзакции этого
уровня не имеют serialization conflicts. Это не общая гарантия
serializability бизнес-правил параллельных писателей.
[PG17: Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-REPEATABLE-READ).

Режим можно задать как `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`.
`READ ONLY` запрещает изменение постоянных таблиц и перечисленные DDL,
но не означает полного отсутствия физических записей на диск.
Изоляцию нельзя переключить после первого запроса.
[PG17: SET TRANSACTION](https://www.postgresql.org/docs/17/sql-set-transaction.html).

Экспортированный через `pg_export_snapshot()` снимок доступен для импорта
только до окончания экспортирующей транзакции.
[PG17: Snapshot Synchronization Functions](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION).

### 2. Атомарная ревизия и конкуренция

Изменения обычных строк одной транзакции становятся видимыми вместе;
rollback отменяет их вместе.
[PG17: Transactions](https://www.postgresql.org/docs/17/tutorial-transactions.html).
Счётчик sequence имеет другую семантику: изменения немедленно видимы
другим транзакциям и не откатываются при abort.
[PG17: Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html).

Обычные MVCC-чтения совместимы с записью.
[PG17: MVCC Introduction](https://www.postgresql.org/docs/17/mvcc-intro.html).
Но `SELECT` берёт `ACCESS SHARE`, конфликтующий с `ACCESS EXCLUSIVE`
(например, `TRUNCATE`, `DROP TABLE`, ряд DDL). Блокировки строк мешают
другим писателям/locker, но не обычному чтению, и обычно удерживаются
до завершения транзакции.
[PG17: Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html).
При Read Committed конкурентный `UPDATE` одной строки ждёт первого
писателя и после его commit применяет операцию к обновлённой версии,
если предикат по-прежнему совпадает.
[PG17: Read Committed](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED).

### 3. Массивы тегов и GIN

Для `text[]` применим встроенный GIN `array_ops`, поддерживающий
`@>`, `<@`, `&&` и `=`.
[PG17: Built-in GIN Operator Classes](https://www.postgresql.org/docs/17/gin.html#GIN-BUILTIN-OPCLASSES).
Семантика операторов:

| Выражение | Значение для множеств тегов |
| --- | --- |
| `tags @> required` | Каждый обязательный тег есть у элемента — AND |
| `tags <@ allowed` | Каждый тег элемента есть среди разрешённых |
| `tags && candidates` | Есть хотя бы один общий тег — OR |

Повторы не меняют результат containment; например, `{a}` и `{a,a}`
содержат друг друга. Это не означает, что SQL-агрегация по `unnest`
сама удаляет повторы.
[PG17: Array Operators](https://www.postgresql.org/docs/17/functions-array.html).

Для непустых и пустых не-NULL массивов без NULL-элементов:
`tags @> '{}'::text[]` истинно; `'{}'::text[] <@ tags` истинно;
`tags && '{}'::text[]` ложно; `tags <@ '{}'::text[]` истинно только для
пустого `tags`. Это следует из реализации `array_contain_compare`
(начальное значение `matchall` и проверка элементов).
[PG17 source: arrayfuncs.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/utils/adt/arrayfuncs.c).
GIN явно обрабатывает пустой правый операнд `@>` через поиск всех
значений, а `<@` включает пустые массивы в кандидаты и требует recheck.
Следовательно, «оператор индексируем» не означает «запрос селективен».
[PG17 source: ginarrayproc.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/access/gin/ginarrayproc.c).

При `fastupdate` изменения попадают в pending list. Чтение проверяет
и основной индекс, и этот список. Его очистка выполняется при
vacuum/autoanalyze, явной очистке или превышении порога; последнее может
сделать отдельную запись значительно медленнее. Большой список замедляет
чтения. `gin_fuzzy_search_limit > 0` допускает случайное подмножество
результатов; значение по умолчанию 0 отключает этот предел.
[PG17: GIN Implementation / Tips](https://www.postgresql.org/docs/17/gin.html#GIN-FAST-UPDATE).

### 4. Таймауты и подтверждение остановки

| Настройка PostgreSQL 17 | Что ограничивает |
| --- | --- |
| `statement_timeout` | Один SQL-оператор от поступления на сервер до завершения; несколько операторов simple-query имеют отдельные таймеры |
| `transaction_timeout` | Время транзакции; завершает сессию, включая для неявной транзакции |
| `lock_timeout` | Каждую попытку получить блокировку; не вычисление запроса |
| `idle_in_transaction_session_timeout` | Ожидание следующей команды клиента внутри открытой транзакции |

Нулевые значения отключают эти лимиты. Если `transaction_timeout`
короче или равен statement/idle-in-transaction timeout, более длинный
лимит игнорируется. Открытая idle-транзакция может удерживать видимые
старые версии строк и препятствовать их уборке.
[PG17: Client Connection Defaults](https://www.postgresql.org/docs/17/runtime-config-client.html#RUNTIME-CONFIG-CLIENT-STATEMENT).

CancelRequest идёт через отдельное соединение и не получает прямого
подтверждения; клиент должен дождаться результата исходного запроса.
Запрос отмены может прийти слишком поздно.
[PG17: Canceling Requests](https://www.postgresql.org/docs/17/protocol-flow.html#PROTOCOL-FLOW-CANCELING-REQUESTS).
Успех libpq cancellation означает отправку, не гарантированный эффект;
`PQcancelPoll` не соблюдает `connect_timeout`, его срок контролирует
приложение.
[PG17: Canceling Queries](https://www.postgresql.org/docs/17/libpq-cancel.html).
`pg_cancel_backend(pid)` возвращает успех отправки сигнала.
`pg_terminate_backend(pid, timeout > 0)` может дождаться фактического
завершения и вернуть false по таймауту; требуются соответствующие права.
[PG17: Server Signaling Functions](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL).

### 5. Локальная изоляция и носитель данных

Docker `--network none` оставляет контейнеру только loopback.
[Docker: None network driver](https://docs.docker.com/engine/network/drivers/none/).
`docker exec` запускает процесс внутри уже работающего контейнера;
`-i` сохраняет stdin.
[Docker: container exec](https://docs.docker.com/reference/cli/docker/container/exec/).
Для libpq абсолютный путь в `host` означает каталог Unix socket;
непустой `hostaddr` выбирает TCP, поэтому его нельзя бездумно наследовать.
[PG17: Connection Parameters](https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PARAMKEYWORDS).

Named volume живёт отдельно от контейнера и сохраняется при его
удалении. Docker допускает разные volume drivers, поэтому одного слова
«volume» недостаточно для утверждения о локальном носителе.
[Docker: Volumes](https://docs.docker.com/engine/storage/volumes/).
Tmpfs теряется при остановке контейнера, расходует память контейнера
и может попасть в swap. Его измерения нельзя выдавать за результаты
постоянного дискового хранения.
[Docker: tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/).
Настройки `fsync` и `synchronous_commit` меняют гарантию сохранности
после crash и цену commit; отключённый `fsync` может привести к порче,
а `synchronous_commit=off` допускает потерю последних подтверждённых
транзакций без нарушения согласованности базы.
[PG17: WAL Settings](https://www.postgresql.org/docs/17/runtime-config-wal.html#RUNTIME-CONFIG-WAL-SETTINGS).

## Выводы для ограниченного стенда — предложения, не факты замеров

1. Полное чтение выполнять на одном соединении в одной RR READ ONLY
   транзакции: сначала ревизия, затем факты узлов, все AND-счётчики,
   дополнительные теги и страница элементов; завершать транзакцию
   на всех путях выхода. Данные для сборки ответа материализовать
   до её окончания. Параллельные независимые соединения без синхронизации
   снимка эту гарантию не дают. Страница требует уникального `ORDER BY`;
   [PG17: LIMIT/OFFSET](https://www.postgresql.org/docs/17/queries-limit.html)
   отдельно предупреждает о непредсказуемом подмножестве без него.
2. Хранить `revision` обычной строкой на `space`, менять через
   `revision = revision + 1` в той же транзакции, что и данные.
   Для простого writer с `READ COMMITTED` брать эту строку первым
   `UPDATE`, затем менять данные: это сериализует писателей одного
   пространства и делает цену такой очереди явным предметом C1/C2.
   Проверять ровно одну обновлённую строку. В ревизию должны входить
   все изменяемые входы ответа; общий каталог вне этого протокола
   требует отдельного правила. Sequence не заменяет эту строку.
3. Без удержания транзакций и отдельной истории старый номер ревизии
   не даёт чтения «as of». Если новый snapshot уже видит новую ревизию,
   адаптер может отклонить старое ожидание или вернуть новое полное
   чтение согласно будущему контракту; не обещать воспроизведение
   старой страницы. Пока изменений не было, следующий запрос может
   естественно видеть тот же номер. Номер — метка состояния, не
   сохранённый PostgreSQL snapshot.
4. Зафиксировать непустые идентификаторы тегов, массивы без SQL NULL,
   NULL-элементов и повторов; отдельно сверить пустой фильтр, пустой
   элемент и отсутствующий тег. GIN не устраняет стоимость полной
   агрегации/выгрузки широкого ответа. Для точности оставить
   `gin_fuzzy_search_limit=0`; фиксировать fastupdate, состояние
   pending list, autovacuum/ANALYZE и момент подготовки индекса.
5. Задать серверные лимиты до рабочего запроса и общий deadline
   в наблюдателе. Истечение клиентского таймера или завершение процесса
   `docker exec` само по себе не считать доказательством завершения
   backend. После cancel проверять исходный результат/состояние
   конкретной тестовой сессии; не возвращать её в использование
   с незавершённой транзакцией. Бюджет очистки учитывать отдельно.
6. Комбинация `--network none` + `docker exec` с клиентом и явным Unix
   socket внутри контейнера технически совместима с источниками выше.
   Перед запуском проверить локальный Docker target, фактический mount,
   отсутствие внешних сетей и продуктовых DSN. Один выделенный локальный
   volume позволяет переиспользовать подготовленные данные/индексы;
   tmpfs пригоден только как явно названный режим. `docker exec`,
   разбор SQL-вывода и сборку ответа учитывать в полной задержке,
   отдельно от серверного SQL-времени.

Эти механизмы обосновывают кандидат для малой проверки правильности.
Они не доказывают допустимую задержку, масштаб D1/D2, независимость
разных пространств по ресурсам, отсутствие очереди писателей,
корректность произвольных DAG-изменений или пригодность для production.
Нужны измерения выбранной реализации в уже ограниченном бюджете.
