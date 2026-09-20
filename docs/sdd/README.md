# sysdes — спецификации SDD

**Baseline 1.0 · 2026-09-06.** Опрос завершён: продуктовые вопросы Q-01–Q-13 и технические ответы 20A–26A зафиксированы. Пакет определяет реализацию, но не означает, что приложение уже разработано или прошло приёмку.

## Принятый результат

SPA: React + TypeScript + Vite, React Flow, Zustand; Python/FastAPI, PostgreSQL, SQLAlchemy/Alembic, серверные cookie-сессии с Argon2id/CSRF. Docker Compose: proxy/SPA + один процесс app со встроенным async worker + postgres. Вспомогательные зависимости и точные версии закрепляются lock-файлами реализации.

Один текущий холст на аккаунт, синхронизация выбора polling каждые 5 секунд. На пользователя до 1000 холстов, по одному последнему успешному AI-отчёту на каждый, без TTL. Новый результат любой из четырёх команд заменяет отчёт целиком; ошибка прежний отчёт сохраняет. Пользователь может экспортировать JSON/PNG/SVG и удалить холст с подтверждением, освобождая место.

Редактор смешивает HLD, логический ER и Sequence, учитывает свободный текст решения. Ручной save и autosave раз в 60 секунд после подтверждения записи не блокируют редактирование. Input Isolation использует локальный draft и flush перед снимком. UI/каталог/отчёты — ru/en; стартовое наполнение — по два шаблона на четыре домена, без ограничения каталога двумя. Пользовательские шаблоны и импорт — будущие итерации.

Четыре команды оценки через одну модель владельца, 10 запусков на пользователя/сутки UTC. AI возвращает строгий JSON с пунктами и доказательствами; сервер рассчитывает баллы по утверждённой рубрике. 1500 баллов соответствует 100%, rawScore может быть больше, максимальный уровень не повышается. Суточный/месячный денежные лимиты и резерв обязательны до платного вызова. Продуктовая аналитика и collector остаются вне MVP; технические SLI проверяются локально.

## Документы

| Документ | Назначение |
|---|---|
| [01-requirements.md](01-requirements.md) | 29 FR, роли, границы, сценарии создания/оценки/экспорта/удаления |
| [02-architecture.md](02-architecture.md) | Стек, альтернативы, компоненты, процессы и Compose |
| [03-canvas-model.md](03-canvas-model.md) | Типизированная семантика, ER/Sequence, тексты, layout и hash |
| [04-ai-evaluation.md](04-ai-evaluation.md) | Оценка по снимку, job lifecycle, квоты/стоимость, последний отчёт |
| [05-api-and-storage.md](05-api-and-storage.md) | HTTP, хранение, auth/reset, revisions, лимиты и удаление |
| [06-acceptance.md](06-acceptance.md) | 56 приёмочных сценариев MVP, NFR и критерии AI-качества |
| [07-decisions-and-questions.md](07-decisions-and-questions.md) | Ответы и статусы решений, история проверки Draft |
| [08-sdd-workflow.md](08-sdd-workflow.md) | Порядок реализации, изменение контрактов, Ready/Done |
| [09-technical-sli.md](09-technical-sli.md) | Минимальные локальные измерения отзывчивости |
| [10-observability-next.md](10-observability-next.md) | Deferred: продуктовые метрики, кликстрим, будущая телеметрия |
| [11-canvas-saving.md](11-canvas-saving.md) | Save-координатор, таймеры, переключение устройств и dirty-черновики |
| [12-input-isolation.md](12-input-isolation.md) | Локальный ввод, commit/flush, IME и Undo |
| [13-solution-scoring.md](13-solution-scoring.md) | Контекстные веса, частичный зачёт и нормализация к 1500 |
| [14-machine-contracts.md](14-machine-contracts.md) | Схемы, канонизация, дополнительные инварианты и проверка |
| [Принятые ADR](../adr/README.md) | Пять Accepted-решений, наблюдаемость Deferred |
| [Завершённый опрос](../decision-survey.md) | Зафиксированные ответы пользователя |
| [План реализации](../superpowers/plans/2026-09-06-sysdes-mvp.md) | 12 этапов с файлами, интерфейсами, тестами и покрытием FR |

## Машинные контракты и примеры

[OpenAPI 3.1.1](contracts/openapi.json) содержит 31 операцию и встроенные схемы для автономной проверки. Отдельные JSON Schema: [документ](contracts/canvas-document.schema.json), [JSON-экспорт](contracts/canvas-export.schema.json), [семантика](contracts/semantic-export.schema.json), [рубрика](contracts/rubric.schema.json), [вход AI](contracts/evaluation-input.schema.json), [ответ модели](contracts/provider-result.schema.json), [серверный результат v2](contracts/evaluation-result-v2.schema.json), [DTO API](contracts/api-models.schema.json).

Связанные примеры: [смешанный холст](examples/canvas-document.json), [рубрика](examples/rubric.json), [AI-вход](examples/evaluation-input.json), [общий отчёт](examples/solution-result.json), [диагностика](examples/diagnostic-result-v2.json), [manifest позитивных/негативных случаев](examples/contract-cases.json), [арифметика](examples/scoring-cases.json), [canonical hash](examples/canonical-hashes.json).

Историческая схема результата v1 и её пример сохранены для контекста Draft 0.4; в текущем API используется только v2. Публичные файлы JSON Schema первичны, копии в OpenAPI должны обновляться синхронно. Сопоставление rubric levels, refs, owner-проверки и транзакции требуют отдельной runtime-валидации по 14.

## Проверка и следующий этап

Команды и границы проверки — в [14-machine-contracts.md](14-machine-contracts.md). Верификаторы: [Python](../scripts/verify_specs.py), [JavaScript canonical bytes](../scripts/verify_canonical.mjs). Итоговый протокол — [baseline-1.0.md](../validation/baseline-1.0.md).

Можно начинать задачу 1 плана — прототип смешанного редактора и экспорта. Для выпуска приложения ещё нужно реализовать код/миграции, пройти приёмку и SLI, подготовить восемь двуязычных шаблонов с утверждёнными рубриками, настроить model ID/ключ, денежные лимиты, TLS и backup. Эти эксплуатационные значения не требуют нового продуктового опроса и не подставляются выдуманными секретами или суммами.

Baseline принят ответами пользователя; несовместимость, обнаруженная при реализации/измерениях, фиксируется изменением спецификации с проверочными примерами. Прежние проверки Draft 0.2–0.4 относятся к историческим пакетам; текущая верификация не заменяет испытание приложения.
