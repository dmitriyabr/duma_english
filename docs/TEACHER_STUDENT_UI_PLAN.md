# План: интерфейс учителя и ученика

Ветка: `feature/teacher-student-ui`  
Дата: 2026-02-07

## 1. Текущее состояние

### Учитель (Admin)
- **Сейчас:** `/admin` с HTTP Basic Auth — не нормальный интерфейс.
- **Нужно:** отдельный кабинет учителя с обычной страницей входа (email + пароль), сессией и полноценным UI.

### Ученик
- **Вход:** `/login` — **персональный код** (один код на ученика, выдаёт учитель) + возрастная группа. По коду однозначно находится ученик; при повторном входе с тем же кодом — тот же профиль.
- **Сессия:** JWT в cookie (`session`), в payload: `studentId`, `classId`.
- **После входа:** `/home` → `/task` → `/record` → `/results`, `/progress`. Всё завязано на `getStudentFromRequest()` и `getStudentProgress(studentId)`.

### Данные (Prisma)
- **Teacher** → **Class** (один ко многим). **Class** → **ClassCode** (коды входа), **Student** (ученики).
- **Student:** Attempt, AttemptGseEvidence, StudentGseMastery, LearnerProfile, GseStageProjection, PlannerDecisionLog, PromotionAudit, ProgressDaily и др.
- **Progress API** уже возвращает богатый GSE-профиль: stage, placement/promotion, streak, recentAttempts, nodeProgress (mastered/inProgress/observed/candidate/verified, verificationQueue, nextTargetNodes), overdueNodes, uncertainNodes, promotionReadiness, mastery по навыкам и т.д.

## 2. Цели

### Учитель
1. **Создавать классы** — уже есть; встроено в дашборд.
2. **Создавать учеников** — явное добавление ученика в класс (имя); при создании ученику автоматически выдаётся **персональный код** для входа.
3. **Генерировать коды** — **один код на ученика**; показывать/копировать в таблице класса; для учеников без кода — кнопка «Сгенерировать код».
4. **Видеть в классе учеников** — список учеников с персональным кодом, стадией, последней попыткой.
5. **Профиль ученика** — по каждому ученику:
   - обновления (последние попытки, даты, баллы);
   - динамика в целом (stage, streak, тренды по навыкам);
   - статистика по последним изменённым GSE-узлам (недавние evidence, mastery changes, verification queue, overdue и т.д.).

### Ученик
- Вход **только по персональному коду** (выдаёт учитель). Имя не вводится — ученик всегда попадает в свой профиль. Дальше поток без изменений (home → task → record → results, progress).

## 3. Авторизация учителя (нормальный интерфейс)

**Без Basic Auth.** Обычный веб-вход и сессия, как у ученика.

- **Вход:** страница `/teacher/login` — email и пароль. Кнопка «Войти».
- **Регистрация:** страница `/teacher/signup` — email, пароль, имя. Создаёт запись Teacher с хешем пароля.
- **Сессия:** отдельная cookie (например `teacher_session`), JWT с `teacherId`. TTL как у ученика (или короче).
- **Выход:** кнопка «Выйти» в кабинете, очистка cookie и редирект на `/teacher/login`.
- **Защита маршрутов:** все `/teacher/*` (кроме login/signup) и все `/api/teacher/*` требуют валидной сессии учителя; иначе 401 или редирект на логин.

**Схема БД:** у модели `Teacher` добавить поля `email` (unique), `passwordHash`. Имя оставить для отображения. При первом деплое или миграции существующих учителей без email можно либо завести скрипт, либо не поддерживать старых (только новые через signup).

## 4. План реализации

### Фаза 0: Авторизация учителя

| # | Задача | Описание |
|---|--------|----------|
| 0.1 | Схема Teacher | Добавить `email` (unique), `passwordHash` в модель Teacher. Миграция. |
| 0.2 | Хеширование паролей | Библиотека (bcrypt или argon2), хелперы hashPassword / verifyPassword. |
| 0.3 | API входа/регистрации | POST `/api/auth/teacher/login` (email, password) → JWT в cookie `teacher_session`. POST `/api/auth/teacher/signup` (email, password, name) → создание Teacher, затем логин. POST `/api/auth/teacher/logout` — очистка cookie. |
| 0.4 | Сессия учителя | `getTeacherFromRequest()` — читает cookie `teacher_session`, верифицирует JWT, возвращает `{ teacherId }` или null. Использовать во всех API учителя. |
| 0.5 | UI входа | Страницы `/teacher/login` и `/teacher/signup`: форма, нормальный дизайн (тот же стиль, что и логин ученика). Редирект на `/teacher` после успешного входа. |

### Фаза 1: API для учителя

| # | Задача | Описание |
|---|--------|----------|
| 1.1 | GET `/api/teacher/classes` | Список классов текущего учителя (`getTeacherFromRequest()` → teacherId → Class по teacherId). |
| 1.2 | GET `/api/teacher/classes/[classId]` | Класс: метаданные, список учеников, активные коды. Проверка: class.teacherId === teacherId. |
| 1.3 | POST `/api/teacher/classes` | Создать класс (название). teacherId из сессии. |
| 1.4 | POST `/api/teacher/classes/[classId]/students` | Создать ученика в классе: `{ displayName }`. |
| 1.5 | POST `/api/teacher/classes/[classId]/codes` | Сгенерировать новый код для класса. |
| 1.6 | GET `/api/teacher/students/[studentId]` | Профиль ученика для учителя (полный progress + последние попытки). Проверка: ученик в классе этого учителя. |

Все маршруты `/api/teacher/*` требуют валидной сессии учителя (cookie `teacher_session`).

### Фаза 2: UI учителя (нормальный интерфейс)

| # | Задача | Описание |
|---|--------|----------|
| 2.1 | Дашборд учителя | `/teacher` — после входа. Шапка: имя учителя, «Выйти». Список «Мои классы» (название, кол-во учеников, последняя активность). Кнопка «Создать класс». Клик по классу → страница класса. |
| 2.2 | Страница класса | `/teacher/classes/[classId]`: название класса, список учеников (таблица или карточки: имя, дата регистрации, stage, последняя попытка, балл). Кнопки: «Добавить ученика», «Показать/скопировать код», «Сгенерировать новый код». Ссылка на каждого ученика → профиль. |
| 2.3 | Добавление ученика | Модалка или форма на странице класса: ввод имени → POST в `.../students` → обновить список. |
| 2.4 | Профиль ученика (для учителя) | `/teacher/students/[studentId]`: блок «Обновления» (последние попытки), блок «Динамика» (stage, streak, тренды), блок «GSE-узлы» (verification queue, overdue, блокеры). Единый стиль с остальным приложением. |
| 2.5 | Защита UI | Страницы `/teacher/*` (кроме login/signup): если нет сессии учителя — редирект на `/teacher/login`. Можно через middleware или проверку в layout. |

### Фаза 3: Ученик и полировка

| # | Задача | Описание |
|---|--------|----------|
| 3.1 | Логин ученика | Оставить как есть: код класса + имя + возраст. Без изменений логики. При желании — мелкие улучшения UX (подсказки, копирование кода). |
| 3.2 | Навигация | В шапке/подвале: для учителя — ссылка на «Кабинет учителя» (или автоматический редирект с `/admin` на новый дашборд). Для ученика — текущие ссылки home/task/progress. |
| 3.3 | Документация и задачи | Обновить README, TASKS.MD: описание потока учитель/ученик, ссылка на этот план. |

## 5. Статистика по «последним изменённым GSE-узлам»

Использовать уже имеющиеся данные из `getStudentProgress`:

- **nodeProgress**: nextTargetNodes, verificationQueue, mastered/inProgress/observed/verified counts.
- **overdueNodes** — узлы с просроченным повторением.
- **uncertainNodes** — узлы с высокой неопределённостью (нужно больше доказательств).
- **promotionReadiness**: blockedByNodeDescriptors, blockedBundles.

Для «последних изменённых» можно дополнительно (в API или в `getStudentProgress` при вызове для учителя):

- Последние N записей `AttemptGseEvidence` по ученику (с датой, nodeId, descriptor, signalType, impact).
- Или последние изменения в `StudentGseMastery` (по `updatedAt`) с дескриптором узла и текущим mastery/activationState.

Достаточно в первом релизе вывести на странице ученика секции: «Фокус (следующие цели)», «Очередь верификации», «Просроченные повторения», «Блокеры продвижения стадии» — всё это уже есть в progress.

## 6. Порядок выполнения (кратко)

1. **Фаза 0:** Схема Teacher (email, passwordHash), миграция, хеширование паролей, API login/signup/logout, cookie `teacher_session`, `getTeacherFromRequest()`, страницы `/teacher/login` и `/teacher/signup`. ✅
2. **Фаза 1:** API учителя (классы, класс, создание класса/ученика/кода, профиль ученика), все с проверкой сессии. ✅
3. **Фаза 2:** Дашборд `/teacher`, страница класса, добавление ученика, профиль ученика, защита маршрутов (редирект на логин при отсутствии сессии). ✅
4. **Фаза 3:** Логин ученика без изменений, навигация, документация.

## 6.1 Реализовано (2026-02-07)

- Teacher: `email`, `passwordHash` (опциональные для обратной совместимости). Миграция `20260207180000_teacher_email_password`.
- Авторизация: `bcryptjs`, `src/lib/teacherAuth.ts` (hash/verify). В `auth.ts`: `issueTeacherToken`, `setTeacherSessionCookie`, `clearTeacherSessionCookie`, `getTeacherFromRequest()`. Cookie: `teacher_session`.
- API: `POST /api/auth/teacher/login`, `POST /api/auth/teacher/signup`, `POST /api/auth/teacher/logout`, `GET /api/auth/teacher/me`.
- API учителя: `GET/POST /api/teacher/classes`, `GET /api/teacher/classes/[classId]`, `POST /api/teacher/classes/[classId]/students`, `POST /api/teacher/students/[studentId]/code` (персональный код ученика), `GET /api/teacher/students/[studentId]`.
- UI: `/teacher/login`, `/teacher/signup`, `/teacher` (дашборд), `/teacher/classes/[classId]`, `/teacher/students/[studentId]`. `TeacherGuard` в layout редиректит на `/teacher/login` при отсутствии сессии.
- Главная страница: ссылки «Teacher» ведут на `/teacher` вместо `/admin`.

## 7. Риски и ограничения

- Старые записи Teacher без email: при миграции сделать `email` опциональным или заполнить уникальным placeholder (например `legacy-{id}@internal`) и предложить учителю «Обновить профиль» для смены пароля и привязки email.
- Реализовано: **персональный код на ученика** (`Student.loginCode`). Ученик входит по полю «Ваш код», всегда попадает в свой профиль. Учитель при добавлении ученика получает код; в таблице класса — колонка «Персональный код» с копированием и «Сгенерировать код» для учеников без кода.
