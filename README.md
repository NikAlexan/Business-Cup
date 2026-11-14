# Business Cup — Resonance, тренажёр голоса

FastAPI-бэкенд и веб-клиент (React SPA, устанавливается как PWA): гостевая cookie-сессия, три контрольные записи, измерения аудио, ИИ-разбор, персональные 14 занятий, ноты и минуты практики. Регистрации и оплаты нет.

## Запуск Docker Compose

Требуются Docker с Compose v2 и OpenAI API key с доступом к указанным моделям.

```bash
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_hex(32))'
# В .env: заменить APP_SECRET на сгенерированное значение и заполнить OPENAI_API_KEY.
docker compose up --build -d
```

- Приложение: http://localhost:8080
- API: http://localhost:8080/api/v1
- Swagger UI: http://localhost:8080/docs
- Готовность: http://localhost:8080/health/ready

Compose запускает `frontend` (nginx: статика SPA и прокси `/api`, `/health`, `/docs` в `web`), `web`, `worker` и PostgreSQL. Наружу опубликован только `frontend` (`WEB_PORT`, по умолчанию 8080): фронт и API на одном origin, поэтому cookie сессии работает без CORS. Миграции Alembic применяются перед запуском web/worker; advisory lock сериализует миграторы. Общие volumes `audio_data` и `pg_data` сохраняются после обычного `docker compose down`. Команда `docker compose down -v` удаляет их.

Для локальной разработки бэкенда: `docker compose -f compose.yaml -f compose.dev.yaml up -d`. Код `app/` монтируется в контейнеры, `web` перезапускается сам при изменениях, `worker` — через `docker compose restart worker`. Образ пересобирать только после изменения зависимостей или `Dockerfile`.

По умолчанию порты приложения и базы привязаны к localhost. Для внешней демонстрации поставить HTTPS reverse proxy и настроить `ALLOWED_ORIGINS` и `COOKIE_SECURE=true`. `getUserMedia` на удалённом HTTP-адресе не предназначен для записи микрофона.

В контейнере `DATABASE_URL` указывает на Compose-сервис `db`; значение в `.env` используется для локального Python-процесса. При изменении пароля изменить `POSTGRES_PASSWORD` и локальный `DATABASE_URL` согласованно. Не менять пароль уже инициализированного volume без изменения роли в PostgreSQL.

## Веб-клиент

Разработка с hot reload (нужен Node 26; API берётся из запущенного compose через `localhost:8080`, другой адрес — `API_URL=...`):

```bash
cd frontend
npm ci
npm run dev     # http://localhost:5173
npm test        # vitest, чистые функции
npm run build   # tsc + vite build
```

Установка приложения: Chrome/Edge на ПК и Android — Settings → «Install app» или значок установки в адресной строке; iOS Safari — Share → Add to Home Screen. Микрофон и установка работают только на `localhost` или по HTTPS. Service worker кэширует только оболочку приложения; данные API и записи всегда идут из сети. Новая версия применяется по кнопке «Reload» в баннере.

```bash
docker compose logs --tail=100 web worker
docker compose restart worker
docker compose down
```

## Контракт для фронтендера

- [Postman Collection: запросы, JSON и примеры ошибок](postman/Voice-Training.postman_collection.json)
- [Postman Environment](postman/Voice-Training.postman_environment.json)
- [Подробный контракт и порядок интеграции](postman/README.md)

Все POST требуют UUID в `Idempotency-Key`. Новый ключ — новая логическая операция; сетевой повтор отправляется с прежним ключом. Для cookie на другом порту того же hostname использовать `credentials: 'include'` и разрешённый Origin. `guest_id` не является авторизацией. Чужие сущности и файлы отвечают 404.

Сквозной путь: `POST /guest-session` → `POST /assessments` → три multipart-загрузки `POST /recordings` с ожиданием jobs → `POST /assessments/{id}/submit` → дождаться jobs → `GET /assessments/{id}` и `GET /plan` → `GET /today` → попытки упражнений → `PUT /progress/{lesson_id}`.

Для прогресса используются завершённые занятия и серия календарных дней. Не более одного завершённого занятия в местную дату; пропущенные дни не удаляют план. Повторная контрольная проверка открывается через 14 календарных дней после последней успешной, независимо от пройденных занятий.

## Аудио и анализ

1. API ограничивает размер запроса и файла, проверяет сигнатуру WAV/WebM/Ogg/MP4/MP3 и сохраняет аудио в приватный volume. Один контрольный файл — до 60 секунд, три вместе — до 180 секунд; лимит файла — 25 MiB.
2. Worker декодирует FFmpeg в mono PCM 16 kHz, проверяет речь через Silero VAD ONNX, длительность, clipping и приближённое отношение речи к фону. Непригодная запись возвращает `needs_rerecord` без переноса даты следующей оценки.
3. Полная оценка рассчитывает F0 через pYIN, паузы и темп. Отдельная расшифровка сверяется с контрольным текстом; при плохом совпадении темп недоступен, а не заменён числом слов из задания.
4. Аудиомодель получает три реальных записи, тексты, измерения, цель и разрешённый каталог. JSON валидируется Pydantic; при неверном формате допускается отдельная текстовая нормализация. Несуществующие ID или несовместимые теги не принимаются.
5. Отчёт и новый план публикуются атомарно. ИИ не изменяет рассчитанные метрики. В сравнении учитываются условия записи, версия протокола и доступность каждой метрики; снижение F0 не объявляется улучшением.

`AUDIO_MODEL`, `TRANSCRIBE_MODEL`, `NORMALIZE_MODEL` настраиваются через `.env`. Отсутствие ключа, запрет доступа к модели, сбой и rate limit провайдера видны в статусе jobs. Синтетический отчёт вместо ошибки не создаётся. Тестовый провайдер существует только в `tests/`.

Ежедневные записи используют лёгкие проверки без полного ИИ-разбора. Только если упражнению нужен темп (E06), вызывается отдельная расшифровка и проверяется заданный диапазон WPM. Если расшифровку нельзя подтвердить, предлагается повтор. Для остальных ежедневных записей темп недоступен: число произнесённых слов не выдумывается.

Модель Silero v5.1.2 скачивается при сборке с проверкой SHA-256, не при первом пользовательском запросе. Качественная оценка тембра и дикции не является медицинским заключением. Пороги качества и версии алгоритмов сохраняются в отчёте.

## Надёжность и данные

- PostgreSQL хранит анонимные суточные счётчики бюджета, гостевые сессии, гостевые JSON-агрегаты в `resources` (оценки, записи, планы, попытки, журнал usage), jobs и ключи идемпотентности. Вложенные уроки/элементы хранятся в агрегате плана; для MVP отдельные таблицы под каждую сущность не требуются. Каталог — версионированный JSON в приложении.
- Мутации одной сессии сериализуются блокировкой строки гостя. Queue использует `FOR UPDATE SKIP LOCKED`, lease, heartbeat, ограниченные повторы и токен владельца lease. После перезапуска просроченная работа подбирается заново; старый worker не может опубликовать результат.
- Идемпотентность проверяет содержимое формы и SHA-256 файла; повтор загрузки не создаёт вторую запись. Повтор завершения занятия не начисляет прогресс дважды.
- `DELETE /guest-data` удаляет файлы и данные по FK cascade. Worker после удаления теряет право публикации. Cookie истекает. Профиль в другом браузере не восстанавливается.
- `.env`, ключи, локальная база, аудио и скачанная модель исключены из Git. В логах — ID задач и типы ошибок, без текста записи, ключей и содержимого аудио.
- Гостевые лимиты: `MAX_UPLOADS_PER_DAY`, `MAX_ASSESSMENTS_PER_DAY`; сервисные `MAX_TOTAL_UPLOADS_PER_DAY` и `MAX_TOTAL_ASSESSMENTS_PER_DAY` ограничивают число созданных jobs за UTC-день. Анонимные сервисные счётчики не сбрасываются при удалении гостя. Повторы одного job также ограничены. Это лимиты количества операций, а не точный финансовый лимит в долларах; лимит расходов дополнительно настраивается в OpenAI project. Usage хранит доступные token usage и `estimated_cost_usd=null`, стоимость не выдумывается.
- SQLite поддерживается для локальных тестов; production queue и конкурентные workers рассчитаны на PostgreSQL. Записи и ключи сохраняются до удаления гостевых данных; автоматический TTL пока не добавлен.

## Локальная разработка и проверки

Python 3.12, FFmpeg и curl должны быть установлены.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.lock
python scripts-download-vad.py
# Для отдельного локального запуска с SQLite:
export DATABASE_URL=sqlite:///./voice.db
alembic upgrade head
uvicorn app.main:app --reload
# В другом терминале с теми же настройками:
python -m app.worker
```

Compose-базу можно использовать локальным API вместо SQLite. Миграции перед первым запросом обязательны.

```bash
ruff check app tests migrations scripts*.py
ruff format --check app tests migrations scripts*.py
pytest -q
```

Тесты по умолчанию создают временную SQLite-базу и вызывают настоящий FFmpeg, VAD и pYIN. OpenAI подменяется только на границе провайдера; тестируются также HTTP payload, нормализация JSON и ошибки провайдера. Для PostgreSQL указать `TEST_DATABASE_URL` на **отдельную тестовую базу**, в имени которой есть `test`: тесты удаляют её таблицы. CI запускает этот вариант и собирает Docker-образ без секретов.

```bash
TEST_DATABASE_URL=postgresql+psycopg://voice:voice@localhost:5432/voice_test pytest -q
```

Отдельная проверка настоящего API с платными вызовами OpenAI:

```bash
python scripts-smoke.py --allow-paid-calls
```

Smoke создаёт синтезированную тестовую речь через FFmpeg/flite, проходит полный API-путь с реальными измерениями/ответом провайдера, завершает занятие и удаляет свою гостевую сессию и файлы. Он не доказывает улучшение человеческого голоса. Автоматические тесты не читают реальный API key из `.env`.

## Деморежим и границы

`DEMO_MODE=true` разрешает `demo_override=true` при создании повторной оценки. `GET /me` и отчёт явно содержат признаки демонстрации. По умолчанию режим выключен; искусственная история не подмешивается к настоящим результатам.

Фронтенд записи микрофона, проверка UI в Safari/Chrome, восстановление сессии на другом устройстве, диагностика речевых дефектов, Stripe и CMS в эту реализацию бэкенда не входят. Внутренний `AccessPolicy.check_access(subject_id, capability)` оставлен для будущей оплаты; `NoBillingAccessPolicy` разрешает возможности MVP.

Официальные источники интеграции: [Audio in Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions), [Transcriptions API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), [Silero VAD](https://github.com/snakers4/silero-vad/tree/v5.1.2), [pYIN](https://librosa.org/doc/main/generated/librosa.pyin.html).
