# CLAUDE.md — Brand-Studio

## Структура репо
```
brand-studio/
├── src/                  — код бота (TypeScript)
├── brand-os/             — Brand OS vault (Obsidian)
├── scripts/              — утилиты и модули
├── .claude/
│   └── skills/           — справочные .md файлы для Claude Code
└── CLAUDE.md             — этот файл
```

---

## Skills — читай перед задачей

Файлы в .claude/skills/ — справочники для Claude Code, приложение их НЕ читает.

- Неминг: .claude/skills/NAMING_SKILL_v2.md
- Стиль и тон: .claude/skills/STUDIO_STYLE_GUIDE.md
- Навигация по боту: .claude/skills/NAVIGATION_MAP.md
- UX: .claude/skills/UX_SPECIFICATION.md
- UX реструктуризация: .claude/skills/UX_RESTRUCTURE_SPEC.md
- Фиксы брифа: .claude/skills/FIX_BRIEF_PROMPT.md

Важно: реальный контент скиллов в приложении живёт в:
- src/prompts/namingSkill.ts — константа NAMING_SKILL_INLINE
- src/prompts/styleGuide.ts — константа STUDIO_STYLE_GUIDE + БД
Если нужно обновить скилл в приложении — редактируй .ts файл, не .md.

---

## Brand OS — правила работы с базой

### Ключевые пути
- Vault: ~/Brand-Studio/brand-os/
- Brand briefs: ~/Brand-Studio/brand-os/brand-briefs.md
- Бренды: ~/Brand-Studio/brand-os/Brands/
- Аттракторы: ~/Brand-Studio/brand-os/Attractors/
- Шаблоны: ~/Brand-Studio/brand-os/_templates/
- Оси: ~/Brand-Studio/brand-os/Axes/
- Визуальный ресёрч: ~/Brand-Studio/scripts/brandVisualResearch.ts (в разработке)

### Скиллы Brand OS (обязательные)
- При СОЗДАНИИ файла бренда — сначала прочитай .claude/skills/brand-research/SKILL.md
- При АУДИТЕ файла бренда — сначала прочитай .claude/skills/brand-audit/SKILL.md

### Два типа данных (критично)
- Факты (владелец, сегмент, город) — из brand-briefs.md или web-search
- Визуал (типографика, палитра, лого) — ТОЛЬКО из image_search, web_fetch CSS, скриншотов
- Никогда не заполняй визуальные поля из текстовых ассоциаций ("чай = минимализм = гротеск")

### Создание файлов брендов
- Перед созданием ВСЕГДА верифицируй факты: владелец, сегмент, специализация, география
- Если не уверен в факте — пропусти поле или напиши "требует проверки"
- Координаты по 18 осям — из реального позиционирования, не по ассоциациям с названием
- Каждый бренд должен иметь nearest_attractor из существующих файлов в Attractors/
- Если бренд не попадает ни в один аттрактор — отметь в attractor_difference, предложи новый
- ОБЯЗАТЕЛЬНО используй wikilinks [[имя-аттрактора]] на nearest_attractor и 2-3 adjacent
- Никогда не используй заглушки [[brand-1]] — только реальные имена файлов

### Создание аттракторов
- Все 18 координат осмысленные — никогда не оставляй 0.5 по умолчанию
- Visual code — конкретные шрифты, цвета, текстуры, не абстракции
- Verbal code — 2-3 примера реальных фраз из этого аттрактора
- Industry adaptations — для каждой индустрии 2-3 конкретных предложения
- segment_modifier — всегда из [economy, comfort, business, premium, luxury]

### Attractor gaps
- Если расстояние > 0.3 от ближайшего аттрактора по 5+ осям — создай новый аттрактор
- Новый аттрактор — универсальный (cross-industry), не специфичный для одного бренда
- После создания — обнови adjacent attractors у соседних аттракторов

### Общие принципы
- Wikilinks в формате [[name]]
- Файлы в UTF-8, YAML frontmatter валидный
- Имена файлов в kebab-case

---

## Second Brain — правила работы с Obsidian vault

Vault path: ~/Brand-Studio/brand-os/
Заметки на русском и английском — используй язык источника.

### Структура
- raw/ — сырые материалы. Только читай, не редактируй
- wiki/ — организованные заметки. Один файл = одна тема
- wiki/INDEX.md — оглавление всех тем
- projects/ — активные проекты
- daily/ — ежедневные заметки (YYYY-MM-DD.md)
- outputs/ — брифинги, аналитика, ответы

### Правила заметок
- Перекрёстные ссылки через [[имя-файла]]
- В начале wiki-заметки — резюме 2-3 предложения
- В конце — список источников из raw/
- Имена файлов: kebab-case на английском
- Если источники противоречат — указать оба мнения
- Не выдумывать информацию которой нет в источниках
- Не удалять файлы из raw/

### YAML frontmatter
```yaml
---
title: Название темы
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft | active | archive
domain: dev | marketing | business | personal
sources: [raw/filename.md]
---
```

### Операции
- Ингест: читай → определи wiki-страницы → создай/обнови → обнови INDEX.md → покажи отчёт
- Запрос: сканируй INDEX.md → читай релевантные → отвечай с цитатами
- Аудит: найди противоречия, пробелы, устаревшее, сироты → покажи отчёт, жди подтверждения
- Брифинг: читай daily/ за 7 дней → собери задачи → сохрани в outputs/briefing-YYYY-MM-DD.md

### Context Navigation
1. ALWAYS query the knowledge graph first
2. Only read raw files if explicitly asked
3. Use graphify-out/wiki/index.md as entry point

### Важно
- Я — куратор. Ты — хранитель.
- При неуверенности — спроси, не додумывай
- Минимальные точные изменения, не масштабные реорганизации без запроса
- Если находишь неожиданную связь — сообщи, это самое ценное
