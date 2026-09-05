# Технический фундамент демонстрационного продукта «Коллекции»

Дата исследования: 2026-09-01.

## Вопрос и граница

Нужен минимальный, но не одноразовый фундамент для mobile-first web-продукта: заранее допущенный email, вход шестизначным одноразовым кодом, приватные данные пользователя, единый серверный источник истины на разных устройствах, воспроизводимые миграции и изолированное развёртывание для проверки и демонстрации. В репозитории application-стека пока нет.

Исследование сравнивает два жизнеспособных состава:

1. **Next.js + Supabase (Auth, Postgres, RLS) + Vercel** — цельный управляемый backend.
2. **Next.js + Clerk + Neon Postgres + Drizzle + Vercel** — специализированный authentication и отдельно управляемый Postgres.

Оба варианта используют TypeScript и Next.js App Router только как web-оболочку и место server-side шва. Next.js даёт Route Handlers для HTTP API, а официальная документация требует рассматривать их и Server Actions как публичные endpoints с проверкой authentication и authorization ([Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Authentication](https://nextjs.org/docs/app/guides/authentication)). Это позволяет не отдавать продуктовым UI-модулям SDK конкретной базы данных. Сам Next.js можно развернуть не только на Vercel, но и как Node.js-сервер или Docker-контейнер, поэтому выбор Vercel не делает приложение технически неотделимым от него ([Next.js deployment options](https://nextjs.org/docs/app/getting-started/deploying)).

## Вариант A: Next.js + Supabase + Vercel

### Authentication и доступ только приглашённым

Supabase нативно отправляет email OTP: шаблон с `{{ .Token }}` превращает passwordless flow в шестизначный код, который проверяется через `verifyOtp`; по умолчанию повторная отправка одному пользователю доступна через 60 секунд, а код живёт один час, срок можно уменьшить в настройках ([passwordless email login](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates)).

Для этой модели продукта не нужен публичный signup и не требуется превращать приглашение в отдельный пользовательский сценарий. Закрытый операторский инструмент может:

- создать допущенного пользователя серверным `auth.admin.createUser({ email, email_confirm: true })`; secret/service key запрещено отдавать браузеру ([admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser));
- держать `Allow new users to sign up` выключенным — тогда входить могут только существующие пользователи ([general auth configuration](https://supabase.com/docs/guides/auth/general-configuration));
- при запросе кода передавать `shouldCreateUser: false`, чтобы попытка неизвестного email никогда не создавала аккаунт ([passwordless email login](https://supabase.com/docs/guides/auth/auth-email-passwordless)).

Это точнее принятых требований, чем `inviteUserByEmail`: штатное приглашение Supabase отправляет ссылку, тогда как продукт требует вход по коду ([inviting users](https://supabase.com/docs/guides/auth/users#inviting-users)). Наличие или отсутствие аккаунта не следует раскрывать разными пользовательскими сообщениями; документация `signInWithOtp` уже предупреждает, что ошибка намеренно может не различать эти случаи ([signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp)).

Ограничение: встроенная почтовая служба Supabase предназначена только для исследования, отправляет письма лишь адресам участников команды и ограничена двумя сообщениями в час. Для реальных приглашённых пользователей нужен отдельный SMTP-поставщик и настроенные SPF/DKIM/DMARC ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). Его цена не входит в тариф Supabase.

### Приватные данные и серверное хранение

Каждая продуктовая таблица получает обязательный `account_id`/`owner_id`. На всех доступных клиенту таблицах включается Postgres RLS с политикой вида `auth.uid() IS NOT NULL AND auth.uid() = owner_id`; Supabase прямо рекомендует эту проверку и связывает Auth с RLS ([Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)). `owner_id` никогда не принимается из тела пользовательского запроса: server-side слой выводит владельца из проверенной сессии.

Серверный Postgres становится источником истины. После успешной мутации интерфейс получает подтверждённую сервером версию и обновляет запросы; другое устройство читает ту же запись из базы. Для этой межустройственной согласованности не требуется связывать React-компоненты с Supabase Realtime.

### Миграции и локальная разработка

Supabase CLI поднимает в контейнерах локальные Postgres, Auth, Storage и почтовый перехватчик; локальная среда изолирована от hosted-проектов и не расходует их квоты ([local development](https://supabase.com/docs/guides/local-development)). Письма в локальной среде не отправляются наружу, а попадают в Inbucket ([CLI config: Inbucket](https://supabase.com/docs/guides/local-development/cli/config#inbucket-enabled)).

Схема хранится в timestamped SQL migrations. `supabase db reset` воспроизводит схему и seed локально, `db push --dry-run` показывает изменения, а `db push` применяет только ещё не применённые миграции; документация отдельно предупреждает, что удалённый `db reset --linked` разрушителен и допустим только для throwaway dev/staging ([local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows), [database migrations](https://supabase.com/docs/guides/local-development/database-migrations)).

### Preview/test и deployment

Vercel разделяет Local, Preview и Production, выдаёт каждой preview deployment отдельный URL и позволяет задавать отдельные переменные среды ([Vercel environments](https://vercel.com/docs/deployments/environments), [environment variables](https://vercel.com/docs/environment-variables)).

Supabase Branches создают отдельный instance и credentials для pull request; preview-ветви удаляются после закрытия PR и по умолчанию не копируют production data ([Supabase Branching](https://supabase.com/docs/guides/deployment/branching)). Это подходящий удалённый test target: preview frontend должен получать только credentials соответствующей data-less preview branch, а не production project.

### Стоимость и эксплуатационные ограничения

- Supabase Free: $0, 50 000 MAU, 500 MB базы, но проект может приостанавливаться после недели неактивности; автоматические backups отсутствуют. Pro стоит от $25/месяц, включает 100 000 MAU, 8 GB, ежедневные backups с хранением семь дней и не приостанавливает проект ([Supabase pricing](https://supabase.com/pricing), [billing](https://supabase.com/docs/guides/platform/billing-on-supabase)).
- Branching недоступен на Free; на Pro preview-ветви тарифицируются по $0.01344 за branch-hour ([Supabase pricing comparison](https://supabase.com/pricing)).
- Vercel Hobby бесплатен, но официально ограничен личным некоммерческим использованием. Для продукта, показываемого потенциальным инвесторам, разумная безопасная трактовка — Vercel Pro за $20/месяц, а не спорное использование Hobby ([Hobby plan](https://vercel.com/docs/plans/hobby), [Vercel pricing](https://vercel.com/pricing)).
- Практический нижний бюджет надёжного публичного демо: **от $45/месяц + SMTP + домен** (Supabase Pro $25 и Vercel Pro $20). Это вывод из тарифов, а не пакетная цена поставщиков.

Сильная сторона варианта — одна платформа для Auth, Postgres, RLS, миграций и локальной реплики. Слабая — почтовая доставка требует отдельного SMTP, а точный invite-only flow нужно один раз оформить операторской командой создания пользователя.

## Вариант B: Next.js + Clerk + Neon + Drizzle + Vercel

### Authentication и доступ только приглашённым

Clerk поддерживает вход шестизначным email code; код живёт десять минут, а встроенный UI разрешает повторную отправку через 30 секунд ([authentication options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [email OTP flow](https://clerk.com/docs/guides/development/custom-flows/authentication/email-sms-otp)). В Invite-only (`restricted`) mode signup доступен только приглашённым, а ручное создание пользователей также считается допустимым способом предоставить доступ ([restricting access](https://clerk.com/docs/guides/secure/restricting-access)).

Чтобы первый вход тоже проходил именно кодом, операторскому инструменту лучше не отправлять invitation link, а заранее создать passwordless-пользователя по email. Clerk Backend API создаёт email verified по умолчанию и позволяет создать пользователя без пароля, если email-code остаётся способом входа ([createUser](https://clerk.com/docs/reference/backend/user/create-user)). После этого штатный sign-in отправляет OTP. Обычный Clerk invitation не подходит буквально: он отправляет уникальную ссылку и автоматически подтверждает email после перехода ([inviting users](https://clerk.com/docs/guides/users/inviting)).

Authentication здесь закрыт специализированным продуктом: operator может создавать пользователей через Dashboard или Backend API ([managing users](https://clerk.com/docs/guides/users/managing)), а приложение не реализует собственную доставку email.

### Приватные данные и серверное хранение

Next.js проверяет Clerk session на каждом server-side чтении и изменении, преобразует Clerk `userId` во внутренний `AccountId` и передаёт его repository. Neon connection string остаётся только на сервере; все SQL-запросы включают `account_id`, а внешние идентификаторы не используются как владельцы строк напрямую.

При необходимости второго уровня защиты Neon умеет проверять JWT/JWKS authentication provider и применять Postgres RLS с `auth.user_id()`; официальная документация перечисляет Clerk как поддерживаемый JWT provider ([Neon RLS](https://neon.com/docs/guides/row-level-security), [project RLS configuration](https://neon.com/docs/manage/projects#rls)). Для первого server-only адаптера это дополнительная защита, не обязательная зависимость UI.

### Миграции и локальная разработка

Drizzle Kit генерирует versioned SQL migration и применяет их через `drizzle-kit migrate`; SQL-файлы можно также выполнить другим инструментом, что сохраняет возможность уйти с Drizzle ([Drizzle generate](https://orm.drizzle.team/docs/drizzle-kit-generate), [migration fundamentals](https://orm.drizzle.team/docs/migrations)).

Neon Local поднимает Docker proxy с локальным Postgres endpoint, создаёт отдельную ephemeral database branch при старте и удаляет её при остановке; это всё ещё соединение с Neon cloud, а не локальная копия Postgres ([Neon Local](https://neon.com/docs/local/neon-local)). Для разработки без зависимости от Neon тот же стандартный Postgres/Drizzle adapter можно направить на локальный Postgres container.

Clerk не имеет полностью локального authentication server: приложение получает отдельные Development и Production instances; development instance ограничен 100 пользователями, имеет более мягкую security-модель и его пользователи не переносятся в production ([Clerk environments](https://clerk.com/docs/guides/development/managing-environments)). Это главный недостаток локального контура по сравнению с Supabase.

### Preview/test и deployment

Для тестов Clerk предоставляет зарезервированные `+clerk_test` email и фиксированный код `424242`, не отправляя письмо; testing tokens обходят bot detection в автоматизированном тесте ([test emails and phones](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [testing overview](https://clerk.com/docs/guides/development/testing/overview)). Preview deployment на `*.vercel.app` может использовать development keys, а production — отдельные production keys ([Clerk on Vercel](https://clerk.com/docs/guides/development/deployment/vercel)). Полноценного штатного staging instance у Clerk пока нет: для независимого долгоживущего staging нужна отдельная Clerk application и синхронизация настроек вручную ([Clerk environments](https://clerk.com/docs/guides/development/managing-environments#staging-environments)).

Neon/Vercel integration создаёт отдельную database branch для каждой preview deployment ([Neon branching](https://neon.com/docs/guides/branching-intro)). В итоге preview использует Clerk development users и отдельную Neon branch, не production identities/data.

Для production Clerk требует собственный домен и DNS records; `*.vercel.app` как production domain не поддерживается ([deploy Clerk to production](https://clerk.com/docs/guides/development/deployment/production), [Clerk on Vercel](https://clerk.com/docs/guides/development/deployment/vercel)).

### Стоимость и эксплуатационные ограничения

- Clerk Hobby: $0 до 50 000 monthly retained users; email codes и обязательные invitations включены, но остаются Clerk branding, фиксированная семидневная session и нет custom email templates. Pro стоит $20/месяц при годовой оплате или $25 помесячно и снимает эти ограничения ([Clerk pricing](https://clerk.com/pricing)).
- Neon Free: $0, 100 CU-hours и 0.5 GB на проект, branches и восстановление максимум за шесть часов. Launch тарифицирует compute по $0.106/CU-hour и storage по $0.35/GB-month, даёт до семи дней восстановления; поставщик показывает типовой intermittent workload около $15/месяц ([Neon pricing](https://neon.com/pricing)).
- Vercel Pro: $20/месяц по указанной выше причине коммерческого контекста ([Vercel pricing](https://vercel.com/pricing)).
- Практический бюджет можно начать с **$20/месяц + домен** (Vercel Pro, Clerk Hobby, Neon Free), но для семидневного восстановления и фирменного auth потребуется usage-based Neon Launch и, если важны собственные письма/отсутствие branding, Clerk Pro. Цена менее фиксирована, чем у Supabase-варианта.

Сильная сторона варианта — самый готовый invite-only/OTP experience и удобные auth test identities. Слабая — три внешние системы вместо двух, полностью локального auth нет, staging требует отдельной Clerk application, а ownership должен быть особенно последовательно проведён через server-side data layer.

## Сравнение

| Критерий | Supabase | Clerk + Neon |
|---|---|---|
| Email OTP | Нативный шестизначный код; нужен свой SMTP для реальных пользователей | Нативный шестизначный код и доставка Clerk |
| Invite-only | Оператор заранее создаёт пользователя; signup выключен | Нативный restricted mode + оператор создаёт passwordless-пользователя |
| Изоляция данных | Встроенная связка Auth + Postgres RLS | Server-side ownership; Neon RLS возможно как второй слой |
| Миграции | Versioned SQL через Supabase CLI | Versioned SQL через Drizzle Kit |
| Локальный контур | Полный локальный Postgres/Auth/mail catcher | Local Postgres возможен, но Clerk остаётся внешним development instance |
| Preview | Data-less Supabase branch + Vercel preview | Neon branch + Clerk development instance + Vercel preview |
| Восстановление | Pro: ежедневные backups, 7 дней | Launch: time travel до 7 дней |
| Поставщики | Vercel, Supabase, SMTP | Vercel, Clerk, Neon |
| Безопасный стартовый бюджет | От $45/мес. + SMTP + домен | От $20/мес. + домен; больше для Launch/Clerk Pro |
| Переносимость storage | Высокая при server-side port; база — Postgres | Высокая: standard Postgres + SQL migrations |

## Обязательный архитектурный шов для обоих вариантов

Поставщика нельзя импортировать в продуктовые модули `collections`, `items`, `groups`, `tags/search` и `sorting`. Шов должен давать вызывающему коду маленький продуктовый Interface и скрывать внутри Adapter схему, joins, транзакции, provider errors и ownership checks. Он не должен быть поверхностным зеркалом таблиц или методов SDK.

```text
mobile UI
  -> application use cases
     -> IdentityPort.currentAccount()
     -> product-shaped persistence Interfaces
        -> Supabase Adapter (production)
        -> in-memory Adapter (application tests)
```

- Внутренний `AccountId` не равен автоматически Supabase/Clerk subject. Маленькая таблица `account_identities(provider, subject, account_id)` отделяет продуктовые foreign keys от authentication vendor.
- Domain/application types не содержат `SupabaseClient`, `Clerk`, `Neon` или Drizzle types.
- Server-side adapter выводит `AccountId` из проверенной сессии; пользовательский payload не задаёт владельца.
- Interface выражает продуктовые операции и их инварианты, атомарность, ошибки и ожидаемую стоимость, а не CRUD по каждой таблице. Точная форма появится из первого вертикального среза, когда известны реальные операции, которые он должен скрыть.
- Шов сразу подтверждают два настоящих Adapter: Supabase для запущенного продукта и in-memory реализация для application tests. Neon/Postgres Adapter остаётся проверенной возможностью замены, а не кодом, который следует строить заранее.
- Начальные migrations используют переносимый Postgres SQL. Supabase-specific RLS policies хранятся рядом, но не становятся бизнес-логикой.
- UI получает DTO/use-case result и не знает имён таблиц. Замена storage adapter тогда затрагивает composition root, migrations/export и adapter tests, но не продуктовые правила и компоненты.

Этот шов не делает смену базы бесплатной: данные всё равно придётся экспортировать и перенести. Он создаёт Depth — много поведения за маленьким Interface — и предотвращает более дорогую проблему: переписывание поведения коллекций из-за того, что оно оказалось выражено вызовами SDK конкретного поставщика.

## Вывод

**Рекомендуемый фундамент первого walking skeleton: Next.js + Supabase + Vercel Pro, с Supabase только за server-side ports и с отдельным SMTP.** Это наименьший достаточно глубокий состав: один управляемый backend закрывает Auth, Postgres, RLS, migrations, локальную изоляцию и preview database, а точный invite-only/OTP flow получается без публичного signup и без magic link. Для публичного демо нужен Supabase Pro: пауза и отсутствие backups на Free противоречат цели дать заинтересованным людям нормальный опыт.

**Clerk + Neon остаётся полностью жизнеспособным резервным вариантом**, если после короткого authentication spike выяснится, что качество и скорость auth UX важнее дополнительной операционной поверхности. Он особенно силён для готового invite-only UI и безопасных auth-тестов, но не является самым малым фундаментом.

Перед реализацией следует проверить одним изолированным authentication spike только четыре факта Supabase-варианта: оператор создаёт допущенный email, неизвестный email не создаёт пользователя, приглашённый получает и вводит код через настроенный test SMTP, а две тестовые учётные записи не читают строки друг друга. Это проверка выбранного фундамента; она должна выполняться только против локального Supabase или отдельной preview branch, никогда против production.
