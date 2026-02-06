# TASKS

## Правило работы (обязательно)
- Двигаться только по задачам из этого файла сверху вниз.
- Любые новые идеи сначала добавлять сюда, потом делать.
- Текущий приоритет: `placement + progress tracking`.
- Не переключаться на UI/контентные улучшения вне текущего приоритета.

## Сейчас в работе
- Завершить placement-поток до полностью проверенного состояния.

## Уже сделано (placement/progress)
- Добавлена модель `PlacementSession` в Prisma и миграция:
  - `prisma/migrations/20260207015000_placement_sessions/migration.sql`
  - `prisma/schema.prisma` (relation у `Student`, модель `PlacementSession`)
- Добавлен placement domain layer:
  - `src/lib/placement.ts`
  - `src/lib/placement.test.ts`
- Добавлены placement API routes:
  - `src/app/api/placement/start/route.ts`
  - `src/app/api/placement/[id]/route.ts`
  - `src/app/api/placement/[id]/task/route.ts`
  - `src/app/api/placement/[id]/answer/route.ts`
  - `src/app/api/placement/[id]/finish/route.ts`
- Добавлена UI-страница placement:
  - `src/app/placement/page.tsx`
- Интеграции placement в основной flow:
  - `src/app/home/page.tsx` (`placementNeeded`)
  - `src/app/task/page.tsx` (предложение пройти placement)
  - `src/app/api/attempts/[id]/route.ts` (`flow.isPlacement`, `placementSessionId`)
  - `src/app/results/page.tsx` (кнопка возврата в placement)
  - `src/lib/progress.ts` (`placementNeeded`)
- Worker:
  - автосабмит placement-ответа после обработки attempt
  - авто-finish placement при закрытии всех вопросов
  - запись метрик/навыков в daily/mastery уже интегрирована

## Сделано случайно вне приоритета (не placement)
- Изменены файлы:
  - `src/lib/taskTemplates.ts`
  - `src/app/task/page.tsx`
  - `src/lib/evaluator.ts`
  - `src/app/results/page.tsx`
  - `.env.example`
- Статус: оставить как есть, пока не мешает placement.

## Следующие шаги (строго по порядку)
1. ✅ Проверить placement scoring на реальных observed metrics от attempt (speech/task/language + derived metrics).
2. ✅ Прогнать e2e-сценарий placement на БД (через lib/script):
   - старт placement
   - запись ответа
   - завершение processing
   - автообновление session index
   - автоfinish после последнего вопроса
3. ✅ Проверить обновление `LearnerProfile` и `StudentSkillMastery` после finish.
4. ✅ Проверить `/api/progress`:
   - корректный `placementNeeded`
   - навыки `delta7/delta28/reliability/sampleCount`
5. ✅ Добавить/уточнить tests для placement flow (unit coverage scoring/result).
6. ✅ Повторный прогон качества:
   - `npm test`
   - `npm run lint`
   - `npm run build`
7. ⏳ Только после этого перейти к следующему блоку roadmap.

## Блокеры / вопросы
- Нет блокеров.
- Примечание: baseline `studentSkillDaily` теперь записывается при `finishPlacement`, чтобы прогресс не был пустым сразу после placement.
