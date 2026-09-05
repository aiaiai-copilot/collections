# Self-hosted VPS и Yandex Cloud для демонстрационного продукта «Коллекции»

**Дата проверки:** 2026-09-04
**Назначение:** дополнить сравнение управляемых стеков вариантами PostgreSQL + NestJS + SPA на собственном VPS и на Yandex Cloud. Это исследование даёт факты и условные рекомендации, но не выбирает фундамент за пользователя.

## Краткий вывод

PostgreSQL + NestJS + SPA на своём VPS полностью соответствует продуктовой задаче. Причины исключать его технически нет. Предыдущая рекомендация Next.js + Supabase + Vercel оптимизировала другой критерий: наименьшую эксплуатационную нагрузку при наличии изолированных local/preview окружений, managed authentication, managed backups и deployment из коробки.

Self-hosted вариант меняет не продуктовую архитектуру, а владельца эксплуатационных обязанностей. Контроль, переносимость и низкий денежный счёт возрастают; обновления ОС и runtime, TLS, firewall, secrets, SMTP, monitoring, off-site backups, PITR, restore drills, deployment/rollback и изолированный test target становятся частью проекта.

Yandex Cloud даёт два существенно разных состава:

1. **Одна Compute Cloud VM с SPA, NestJS и PostgreSQL** — тот же self-hosted VPS, но с сервисами Yandex для email, object storage, DNS и наблюдаемости.
2. **Static SPA + Serverless Containers + Managed PostgreSQL + Postbox + Lockbox** — управляемый российский контур с меньшим объёмом database/runtime-операций, но более высокой ценой базы и без штатного per-PR database branching.

## Общая продуктовая архитектура

Оба новых варианта сохраняют уже утверждённые швы:

```text
SPA
  -> OpenAPI 3.1 HTTP Interface
     -> NestJS HTTP Adapter
        -> application modules
           -> Identity Interface
           -> product-shaped persistence Interfaces
              -> PostgreSQL Adapter
              -> in-memory test Adapter
```

PostgreSQL, NestJS и конкретный хостинг остаются Adapter/implementation choices. UI не получает SQL-модель, ORM types или server internals.

### OpenAPI 3.1 и NestJS

NestJS официально предоставляет `@nestjs/swagger`, который строит OpenAPI-документ из decorators и может сохранить его в JSON/YAML ([NestJS OpenAPI introduction](https://docs.nestjs.com/openapi/introduction)). Это удобный documentation adapter, но не повод менять принятое в spec правило source of truth.

Для этого продукта OpenAPI 3.1 остаётся **spec-first каноническим Interface**. NestJS handlers и DTO проверяются против него, а типы web-клиента генерируются из того же документа. Decorator-generated документ используется только как проверяемая производная либо не используется вовсе.

Такое ограничение практически значимо: в августе 2026 официальный `nestjs/swagger` исправлял случай, когда документ объявлялся как OpenAPI 3.1, но nullable schemas продолжали иметь 3.0-семантику ([nestjs/swagger issue 4063](https://github.com/nestjs/swagger/issues/4063)). Это не запрещает NestJS; это запрещает считать непроверенную генерацию вторым каноном.

### Identity и OTP

NestJS предоставляет authentication guards/Passport integration, но выбор и реализацию конкретного authentication flow оставляет приложению ([NestJS authentication](https://docs.nestjs.com/security/authentication)). Поэтому self-hosted состав должен реализовать:

- allowlist приглашённых email;
- одноразовый код с ограниченным сроком, хранением только безопасного verifier/hash и одноразовым погашением;
- server-side session и logout;
- нейтральный ответ для неизвестного email;
- лимиты на запрос кода и попытки проверки;
- audit события входа без сохранения кода в логах.

NestJS имеет официальный throttling module и поддерживает заменяемое storage; встроенный storage хранится в памяти, поэтому для нескольких backend instances нужен общий Adapter ([NestJS rate limiting](https://docs.nestjs.com/security/rate-limiting)). Для одного VPS in-process limiter допустим только как первый слой; ограничения попыток OTP должны также атомарно сохраняться сервером.

### Изоляция данных

Обычный PostgreSQL поддерживает Row-Level Security для `SELECT`, `INSERT`, `UPDATE` и `DELETE`; при включённом RLS без подходящей policy действует default deny. При этом superuser, `BYPASSRLS` и обычно владелец таблицы обходят policies, поэтому application connection не должен работать привилегированной ролью ([PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)).

Для всех вариантов остаются два слоя:

1. application/persistence Adapter получает `AccountId` из проверенной сессии и проводит owner scope через каждую операцию;
2. RLS является defense in depth и проверяется contract tests двумя identity.

## Вариант C: PostgreSQL + NestJS + SPA на своём VPS

### Состав

- статическая SPA-сборка за reverse proxy;
- NestJS HTTP Adapter;
- PostgreSQL;
- миграции в versioned SQL;
- отдельный transactional email provider;
- Docker Compose для воспроизводимого local/test-контура;
- off-site object storage для backup/WAL;
- metrics, logs и alerts;
- автоматизированный deployment с health check и rollback.

Docker Compose официально предназначен для описания и запуска multi-container приложений, а profiles/overrides позволяют разделять dev, test и production составы ([Compose features](https://docs.docker.com/compose/intro/features-uses/), [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/), [Compose in production](https://docs.docker.com/compose/how-tos/production/)). Это решает воспроизводимость, но не создаёт удалённое preview-хранилище автоматически.

### Что выигрываем

- один стандартный runtime и обычный PostgreSQL без authentication/database SDK в продуктовых модулях;
- полный контроль версий, сети, журналов, домена и размещения данных;
- SPA хорошо соответствует закрытому аутентифицированному продукту, которому не требуется SEO;
- NestJS естественно служит явным HTTP Adapter вокруг OpenAPI Interface;
- низкий прямой денежный счёт при малой нагрузке;
- возможность перенести контейнеры и PostgreSQL backup к другому VPS-поставщику.

### Что берём на себя

- одна VM является общей точкой отказа приложения и базы;
- обновления ОС, Docker, Node.js, PostgreSQL и reverse proxy;
- firewall, SSH, TLS renewal, secrets rotation и least-privilege роли;
- контроль свободного места и WAL, потому что переполнение может остановить PostgreSQL;
- off-site backups, retention, шифрование и регулярные restore drills;
- delivery и репутацию email provider;
- deployment/rollback и проверку миграций;
- отдельное test/preview окружение с собственными credentials и данными.

PostgreSQL PITR требует base backup и непрерывного архива WAL; документация прямо подчёркивает необходимость заранее настроить и проверить процедуру архивации. `pg_dump` не заменяет continuous-archive backup для PITR ([PostgreSQL continuous archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)). Следовательно, «snapshot диска иногда» недостаточен для заявленного восстановления.

### Preview/test

Local и CI могут поднимать отдельные PostgreSQL, backend и mail catcher в Compose. Для удалённого preview нужен один из явно автоматизированных вариантов:

- отдельный временный Compose project/VM на branch;
- постоянный staging VPS с отдельной базой и credentials;
- временный backend с отдельной PostgreSQL database/role на общем staging cluster.

Последний вариант логически изолирован, но не изолирует ошибки уровня кластера. E2E никогда не направляется на production compose project или production database.

### Стоимость

Цена зависит от VPS-поставщика. Актуальные проверяемые ориентиры для `2 vCPU / 4 GB / около 50 GB` — **650 ₽/месяц** у Selectel с 50 ГБ, IPv4 и 3 ТБ трафика; **1 140 ₽ за 30 дней** у Beget с 40 ГБ и IPv4; **1 350 ₽/месяц** у Timeweb с 50 ГБ и IPv4 без долгосрочного обязательства ([Selectel VDS prices](https://selectel.ru/services/cloud/vps-vds/), [Beget VPS](https://beget.com/ru/vps), [Timeweb Cloud servers](https://timeweb.cloud/services/cloud-servers), [Timeweb IPv4 pricing](https://timeweb.cloud/services/vps-linux)). С отдельными 30 ГБ backup/WAL и бесплатным лимитом Postbox итог составляет примерно **688–1 388 ₽/месяц**. Это не цена высокой доступности и не учитывает время оператора.

## Вариант D1: Yandex Cloud как VPS-платформа

NestJS, SPA и PostgreSQL работают на одной Compute VM. Дополнительные сервисы:

- Yandex Cloud Postbox для OTP;
- Object Storage для encrypted off-site backup/WAL;
- Certificate Manager/DNS либо reverse proxy с ACME;
- Monitoring/Logging для инфраструктурных и application сигналов;
- Lockbox либо другой секретный storage с ограниченным service account.

Yandex Postbox официально поддерживает SMTP/AWS SES-compatible API, DKIM/SPF/DMARC и прямо называет one-time login codes сценарием transactional email ([Postbox service](https://yandex.cloud/ru/services/postbox)). Первые 2 000 писем в месяц не тарифицируются ([Postbox pricing](https://yandex.cloud/ru/docs/postbox/pricing)). Начальная квота составляет 200 писем в сутки и 1 письмо в секунду; увеличение запрашивается через поддержку ([Postbox quotas](https://yandex.cloud/en/docs/postbox/concepts/limits)). Для закрытого демо этого достаточно после проверки фактического числа приглашённых.

D1 уменьшает интеграционную разрозненность и даёт рублёвый биллинг, но не снимает обязанности self-hosted PostgreSQL/NestJS и не устраняет single point of failure.

<!-- BEGIN DETAILED VPS COST COMPARISON -->

## Детальное сравнение стоимости self-hosted VPS

### Граница и допущения расчёта

Чтобы сравнение было насколько возможно одинаковым по составу, базовая конфигурация во всех строках такая:

- одна Linux VM работает 24/7;
- целевая конфигурация — `2 vCPU / 4 ГБ RAM / около 50 ГБ SSD или NVMe`; ближайший фиксированный тариф Beget содержит 40 ГБ;
- SPA, NestJS и PostgreSQL находятся на одной VM;
- объём исходящего трафика не превышает 100 ГБ в месяц;
- за пределами VM хранится 30 ГБ PostgreSQL base backup/WAL; это заданный объём хранения, а не обещание конкретной глубины PITR;
- через Yandex Cloud Postbox отправляется не более 2 000 OTP-писем в месяц;
- используются базовые метрики провайдера и локальные application logs; платная агрегация логов вынесена отдельно;
- домен, труд администратора, CI, staging и стоимость аварийного восстановления не включены.

Для сопоставимого месячного среза Beget рассчитан за 30 дней: `30 × 33 ₽` за сервер и `30 × 5 ₽` за IPv4. Selectel и Timeweb приведены по опубликованным месячным ценам готовых тарифов ([Beget VPS](https://beget.com/ru/vps), [Selectel VDS payment model](https://docs.selectel.ru/vds-servers/about/payment/), [Timeweb Cloud servers](https://timeweb.cloud/services/cloud-servers)). Годовой итог Beget учитывает 365 дней, а не условные двенадцать 30-дневных месяцев.

Цены зафиксированы на дату исследования и не являются офертой. Калькулятор Timeweb показывает итог с НДС, но публичная карточка сервера по умолчанию показывает цену с 10-процентной скидкой при выборе 12 месяцев; поэтому ниже отдельно приведена цена без обязательства и цена при годовом сроке ([Timeweb price calculator](https://timeweb.cloud/prices), [Timeweb Cloud servers](https://timeweb.cloud/services/cloud-servers)). Для Selectel и Beget используются текущие публичные цены карточек; налоговый режим и итог конкретного business account нужно подтвердить в заказе.

Важно: одинаковое число `vCPU` не гарантирует одинаковую производительность у разных провайдеров. Сравнение фиксирует опубликованные ресурсы и цену, но перед выбором всё равно нужен короткий нагрузочный тест на копии обезличенных данных.

### Тарифные входные данные

| Статья | Selectel VDS | Beget VPS | Timeweb Cloud |
|---|---:|---:|---:|
| Конфигурация | `2 vCPU / 4 ГБ / 50 ГБ NVMe` | `2 vCPU / 4 ГБ / 40 ГБ NVMe` | `2 vCPU / 4 ГБ / 50 ГБ NVMe` |
| Сервер | **650,00 ₽/мес.** | `30 × 33` = **990,00 ₽/30 дней** | **1 200,00 ₽/мес.** без срока или **1 080,00 ₽/мес.** при 12 месяцах |
| Основной публичный IPv4 | Включён | `30 × 5` = **150,00 ₽/30 дней** | **150,00 ₽/мес.** |
| VM + disk + IPv4 | **650,00 ₽** | **1 140,00 ₽** | **1 350,00 ₽** без срока или **1 230,00 ₽** при 12 месяцах |
| 30 ГБ backup/WAL в Object Storage Cold | **38,02 ₽** | **38,02 ₽** | **38,02 ₽** |
| До 2 000 OTP email через Postbox | **0 ₽** | **0 ₽** | **0 ₽** |
| Базовый итог за 30 дней | **688,02 ₽** | **1 178,02 ₽** | **1 388,02 ₽** без срока или **1 268,02 ₽** при 12 месяцах |
| Базовый итог в год | **8 256,19 ₽** | **14 326,19 ₽** за 365 дней | **16 656,19 ₽** без срока или **15 216,19 ₽** при 12 месяцах |

Основания для строк таблицы:

- Текущий Selectel `VDS 2-4-50` содержит 2 vCPU, 4 ГБ RAM и 50 ГБ local NVMe и стоит 650 ₽/месяц; в цену входят один публичный IPv4 и 3 ТБ внешнего трафика ([Selectel VDS prices](https://selectel.ru/services/cloud/vps-vds/), [Selectel VDS configurations](https://docs.selectel.ru/vds-servers/about/configurations/), [Selectel VDS product description](https://docs.selectel.ru/vds-servers/about/about-vds-server/)). После 3 ТБ текущая карточка указывает 0,8962 ₽/ГБ. У VDS нет automatic backup, private network и подключаемого load balancer; это ограничивает применение дешёвого тарифа как основы настоящего HA ([Selectel VDS product description](https://docs.selectel.ru/vds-servers/about/about-vds-server/), [Selectel VDS FAQ and traffic](https://selectel.ru/services/cloud/vps-vds/)).
- Ближайший стандартный Beget VPS содержит 2 vCPU, 4 ГБ RAM, 40 ГБ NVMe и канал 1 Гбит/с и стоит 33 ₽/день. Публичный IPv4 добавляет 5 ₽/день. В цену сервера включены автоматические файловые бэкапы, мониторинг, DNS hosting и private network; Beget указывает, что VM-бэкапы создаются раз в несколько дней и хранятся на отдельных серверах в другом дата-центре ([Beget VPS](https://beget.com/ru/vps), [Beget VPS backups](https://beget.com/ru/kb/manual/rezervnoe-kopirovanie-vps), [Beget private networks](https://beget.com/ru/kb/manual/private-network)).
- Timeweb `MSK 50` содержит 2 vCPU, 4 ГБ RAM и 50 ГБ NVMe. На странице выбраны 12 месяцев со скидкой 10%, поэтому показанные 1 080 ₽ соответствуют 1 200 ₽ без скидки: `1 080 / 0,9 = 1 200`. Каждый IPv4 стоит ещё 150 ₽/месяц; легитимный server traffic не ограничивается, но действует fair-use условие о влиянии на общую ноду ([Timeweb Cloud servers](https://timeweb.cloud/services/cloud-servers), [Timeweb IPv4 pricing](https://timeweb.cloud/services/vps-linux), [Timeweb server limits](https://timeweb.cloud/docs/cloud-servers/limitations)).
- Одинаковое для всех вариантов хранилище вне VM рассчитано как `30 × 1,2672 = 38,016 ₽/месяц` в Yandex Object Storage Cold. Запросы, извлечение и исходящий трафик при реальном restore оплачиваются отдельно ([Object Storage pricing](https://yandex.cloud/ru/docs/storage/pricing)). У Beget включённый VM-бэкап остаётся дополнительным слоем и не заменяет PostgreSQL-aware base backup + WAL с проверяемым PITR.
- Postbox не тарифицирует первые 2 000 писем каждого месяца. Следующие 8 000 стоят 80,31666666 ₽ за тысячу; например, ровно 3 000 OTP-писем добавят **80,32 ₽** к любому варианту. Письма можно отправлять через SES-compatible HTTPS API, что особенно важно там, где исходящие SMTP-порты ограничены ([Postbox pricing](https://yandex.cloud/ru/docs/postbox/pricing), [Postbox service](https://yandex.cloud/ru/services/postbox), [Selectel VDS port restrictions](https://docs.selectel.ru/vds-servers/about/about-vds-server/), [Timeweb port restrictions](https://timeweb.cloud/docs/cloud-servers/limitations)).

### Backups, мониторинг, DNS и расходы сверх базы

| Дополнение | Selectel VDS | Beget VPS | Timeweb Cloud |
|---|---|---|---|
| Provider VM backup | Automatic backup отсутствует; остаётся собственный pgBackRest/base backup + WAL в object storage | Включён файловый backup раз в несколько дней, с хранением в другом дата-центре; это не гарантирует согласованный PostgreSQL PITR | Один сохранённый полный backup 50-ГБ диска стоит `50 × 6` = **300 ₽/мес.**; сам Timeweb всё равно рекомендует удалённые копии |
| Метрики | Базовые server metrics доступны; внешняя агрегация не включена в расчёт | Включены графики и правила уведомлений по email/Telegram для CPU, RAM, disk и network | Dashboard показывает CPU, сеть и disk, включая уведомление при 95% заполнения |
| Application logs | Локальный journal/rotation: 0 ₽ дополнительного счёта, но логи теряются вместе с VM; внешний сервис считать отдельно | То же | То же |
| DNS | DNS hosting включён, но регистрация домена — отдельная услуга | DNS hosting включён, но регистрация домена — отдельная услуга | Можно оставить DNS у регистратора; регистрация домена не входит |
| TLS | Бесплатный ACME/Let's Encrypt в reverse proxy | То же | То же |

Ставка Timeweb 6 ₽ за один ГБ каждого существующего server backup и рекомендация хранить дополнительные удалённые копии приведены в документации провайдера ([Timeweb backups](https://timeweb.cloud/docs/cloud-servers/manage-servers/backup)). Beget документирует файловое восстановление целого сервера или отдельных файлов, но при удалении VPS копии перестают быть доступны в панели, а их наличие через поддержку не гарантируется; поэтому независимая PostgreSQL-копия остаётся обязательной ([Beget VPS backups](https://beget.com/ru/kb/manual/rezervnoe-kopirovanie-vps)). Selectel и Beget включают DNS hosting, но покупка домена остаётся отдельной ([Selectel VDS](https://selectel.ru/services/cloud/vps-vds/), [Beget VPS](https://beget.com/ru/vps)).

### Второй узел и что он фактически даёт

Ниже посчитан **warm standby с ручным переключением**, а не автоматически высокодоступная система. Backup-объём оставлен прежним, потому что резервируется один и тот же dataset. Второму узлу не выделяется отдельный публичный IP там, где возможна private network.

| Состав | Selectel VDS | Beget VPS | Timeweb Cloud, без срока |
|---|---:|---:|---:|
| Базовый один узел | **688,02 ₽** | **1 178,02 ₽** | **1 388,02 ₽** |
| Второй узел | +**650,00 ₽** за `2/4/50` | +**990,00 ₽** за `2/4/40` без публичного IPv4 | +**1 200,00 ₽** за `2/4/50` без публичного IPv4 |
| Warm-standby итог за 30 дней | **1 338,02 ₽** | **2 168,02 ₽** | **2 588,02 ₽** |
| Если второму узлу нужен свой IPv4 | Уже входит, но private network отсутствует | +**150,00 ₽** | +**150,00 ₽** |

Второй сервер сам по себе не создаёт HA. Нужны PostgreSQL replication и контроль lag, механизм promotion/fencing, переключение трафика, разнесение failure domains и проверяемая процедура возврата бывшего primary. У дешёвого Selectel VDS нет private network и load balancer, поэтому его двухузловой итог — только ценовая нижняя граница. Beget и Timeweb предоставляют private network, но возможность действительно разнести узлы по независимым failure domains для выбранных локаций нужно подтвердить до заказа ([Beget private networks](https://beget.com/ru/kb/manual/private-network), [Timeweb network settings](https://timeweb.cloud/docs/cloud-servers/manage-servers/network)).

### Денежный вывод

Для одного low-traffic демонстрационного экземпляра Selectel остаётся минимумом по прямому счёту: **688,02 ₽ за 30 дней**. Beget стоит на **490 ₽**, или примерно на **71%**, дороже Selectel, но даёт автоматические файловые бэкапы, мониторинг и private network в базовой цене. При этом Beget дешевле Timeweb без срока на **210 ₽ за 30 дней**; даже при годовой скидке Timeweb его сопоставимый месячный итог выше на **90 ₽**.

Поэтому для текущего демо **Beget выглядит наиболее сбалансированным VPS-вариантом**, если 40 ГБ диска достаточно: небольшая доплата относительно абсолютного минимума уменьшает объём собственной инфраструктурной обвязки. **Selectel** рационален, если приоритет — минимальный денежный счёт и команда готова сама закрыть backups/monitoring/network limitations. **Timeweb** остаётся разумной альтернативой, если нужны 50 ГБ диска и подходят его инструменты и модель оплаты.

<!-- END DETAILED VPS COST COMPARISON -->

## Вариант D2: управляемый Yandex Cloud

### Состав

- SPA в Object Storage, при необходимости за Cloud CDN и Certificate Manager; официальный tutorial поддерживает именно такую композицию ([static website with CDN](https://yandex.cloud/en/docs/cdn/tutorials/cdn-hosting/terraform));
- NestJS image в Serverless Containers;
- Managed Service for PostgreSQL в приватной cloud network;
- Postbox для OTP;
- Lockbox/Connection Manager для database и email secrets;
- Monitoring, Cloud Logging и Audit Trails;
- Terraform для production и отдельного test/preview folder.

Serverless Containers запускает обычный Docker image без Kubernetes, поддерживает revisions, autoscaling, private network, logs и metrics ([Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/), [container operations](https://yandex.cloud/en/docs/serverless-containers/operations/)). Lockbox secrets могут передаваться container service account, а managed database connection secret создаётся через Connection Manager ([Lockbox integrations](https://yandex.cloud/en/docs/lockbox/concepts/services)).

Managed PostgreSQL доступен из Serverless Containers внутри той же private network; public database endpoint не требуется ([Managed PostgreSQL connections](https://yandex.cloud/en/docs/managed-postgresql/operations/connect)).

### Backups и доступность

Managed PostgreSQL автоматически создаёт backups, хранит automatic backups по умолчанию семь дней и поддерживает PITR. Восстановление создаёт новый cluster; документация рекомендует периодически проверять восстановление и целостность данных ([Managed PostgreSQL backups](https://yandex.cloud/en/docs/managed-postgresql/concepts/backup)).

Один database host не даёт высокой доступности и не покрывается SLA. Два hosts в разных availability zones считаются highly available; три hosts дополнительно снижают риск недоступности записи при maintenance/version update ([Managed PostgreSQL high availability](https://yandex.cloud/en/docs/managed-postgresql/concepts/high-availability)).

### Preview/test

Serverless Containers revisions дают удобный deployment/rollback backend, но Managed PostgreSQL не предоставляет описанного в официальной документации per-PR branching, аналогичного Supabase Branches или Neon branches. Это вывод из состава официальных операций и требует явной инфраструктурной политики:

- для CI/local integration использовать disposable local PostgreSQL;
- для удалённого acceptance иметь отдельный Yandex folder и отдельный test cluster;
- preview UI/backend никогда не получает production database secret;
- destructive test выполняется только в disposable database/cluster.

### Стоимость

При малой нагрузке Serverless Containers может стоить близко к free tier: каждый месяц не тарифицируются первые 1 000 000 вызовов, 10 GB×hours RAM и 5 vCPU×hours; далее цена usage-based. Provisioned instances и их простой оплачиваются отдельно ([Serverless Containers pricing](https://yandex.cloud/en/docs/serverless-containers/pricing)).

Основной фиксированный расход — Managed PostgreSQL. Новые конфигурации с долей CPU ниже 100% больше не создаются; минимальная рекомендуемая production-конфигурация начинается с 2 vCPU с гарантированной долей 100%. В списке остаются, в частности, `c3-c2-m4` с 4 GB RAM и `s3-c2-m8` с 8 GB RAM ([Managed PostgreSQL host classes](https://yandex.cloud/ru/docs/managed-postgresql/concepts/instance-types)).

Чтобы не смешивать тарифы разных платформ, воспроизводимый ориентир ниже использует именно опубликованный Yandex пример для `s3-c2-m8`: 1,8792 ₽ за vCPU-час и 0,5072 ₽ за GB RAM-час. Если взять минимальные для этого класса 10 GB network HDD вместо 100 GB из примера, storage добавляет 37,44 ₽/месяц. Расчёт одного такого host:

```text
720 × (2 × 1,8792 + 8 × 0,5072) + 10 × 3,744 ≈ 5 665 ₽/месяц
```

Два таких hosts для SLA стоят примерно **11 330 ₽/месяц** до дополнительных logs, DNS, Object Storage и provisioned containers. Это проверяемый ориентир `s3-c2-m8`, а не нижняя цена сервиса: `c3-c2-m4` требует отдельного расчёта по актуальному calculator. Формула и ставки взяты из актуальной ценовой политики; фактическую конфигурацию перед покупкой нужно повторно проверить в calculator ([Managed PostgreSQL pricing](https://yandex.cloud/ru/docs/managed-postgresql/pricing)).

Postbox для закрытого демо, вероятно, остаётся в бесплатных 2 000 письмах. Static SPA и low-traffic serverless backend добавляют небольшой usage-based счёт, но не меняют порядок величины managed database.

## Сравнение четырёх направлений

| Критерий | Supabase + Vercel | Clerk + Neon + Vercel | Self-hosted VPS | Yandex managed |
|---|---|---|---|---|
| OpenAPI 3.1 | Собственный HTTP Adapter обязателен | Собственный HTTP Adapter обязателен | Естественный NestJS Adapter; spec-first обязателен | Тот же NestJS Adapter |
| OTP/invite-only | Managed Auth + SMTP | Managed Clerk | Реализуем и эксплуатируем | Реализуем; Postbox доставляет email |
| PostgreSQL | Managed Supabase | Managed Neon | Полностью свой | Managed PostgreSQL |
| RLS | Managed и тесно связано с Auth | Возможно как второй слой | Обычный PostgreSQL RLS | Обычный PostgreSQL RLS с managed-role ограничениями |
| Local Auth/DB/mail | Полный local stack | Auth остаётся внешним | Полностью local Compose | Полностью local Compose; Yandex services заменяются Adapters |
| Preview data isolation | Supabase branch | Neon branch | Строим сами | Строим отдельный folder/cluster сами |
| Backups/PITR | Managed на Pro | Managed на paid tier | Настраиваем и проверяем сами | Managed PostgreSQL |
| Single point of failure | Зависит от managed plans | Зависит от managed plans | Да для одной VM | Нет при 2+ DB hosts; serverless backend managed |
| Базовый денежный порядок | От $45 + SMTP/domain | От $20, больше для recovery/branding | Примерно 688–1 388 ₽ с 30 ГБ backup/WAL, без domain/operator time | Ориентир для `s3-c2-m8`: примерно 5 700 ₽ без DB HA или 11 300 ₽ с DB SLA + extras; `c3-c2-m4` считать отдельно |
| Главная цена | Поставщик и recurring bill | Больше поставщиков | Время и ответственность оператора | Более дорогая managed DB и ручной preview provisioning |

## Условная рекомендация

- Выбирать **self-hosted VPS**, если у проекта уже есть надёжный deployment/backup/monitoring baseline либо пользователь сознательно принимает его создание и регулярную эксплуатацию ради контроля и меньшего денежного счёта. Среди рассмотренных VPS Beget даёт лучший баланс включённых эксплуатационных функций и цены, а Selectel — минимальный прямой счёт.
- Выбирать **Supabase + Vercel**, если важнее минимизировать человеческую эксплуатацию и быстрее получить managed local/preview/Auth/RLS путь.
- Выбирать **Yandex managed**, если важны российский регион и биллинг, единый локальный поставщик email/secrets/observability и managed PostgreSQL, а более высокий фиксированный счёт базы и ручное создание preview data targets приемлемы. Для ориентира `s3-c2-m8` даёт примерно 5,7–11,3 тыс. ₽ в месяц в зависимости от HA; перед выбором следует отдельно рассчитать более компактный `c3-c2-m4`.

Архитектурно все варианты остаются заменяемыми благодаря OpenAPI 3.1, application Interfaces и PostgreSQL Adapter. Выбор определяет прежде всего операционную модель, а не продуктовые возможности.

## Зафиксированный промежуточный выбор

4 сентября 2026 года пользователь выбрал для дальнейшей спецификации **self-hosted-вариант на Beget**:

- один Beget VPS с публичным IPv4 как базовая конфигурация первого deployment;
- SPA, NestJS и PostgreSQL на этом VPS;
- OpenAPI 3.1 как канонический spec-first HTTP Interface;
- независимый PostgreSQL base backup + WAL вне VPS; включённые файловые бэкапы Beget остаются дополнительным слоем;
- transactional email и object storage за заменяемыми Adapters; Postbox и Yandex Object Storage используются в текущей модели стоимости, но не закрепляются как незаменимые поставщики;
- warm standby и автоматический failover не входят в базовый вариант.

Это промежуточный, а не необратимый выбор. Он задаёт направление спецификации и будущих tracer-bullet tickets, но не разрешает начинать реализацию до утверждения спецификации. Основания для пересмотра: нехватка 40 ГБ диска, неудовлетворительная контрольная нагрузка, невозможность выполнить будущие RPO/RTO или неприемлемая эксплуатационная ответственность.
