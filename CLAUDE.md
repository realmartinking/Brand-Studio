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

## Важно про скиллы

Файлы в .claude/skills/ — справочники для Claude Code, приложение их НЕ читает.

Реальный контент скиллов живёт в:
- src/prompts/namingSkill.ts — константа NAMING_SKILL_INLINE
- src/prompts/styleGuide.ts — константа STUDIO_STYLE_GUIDE + БД

Если нужно обновить скилл в приложении — редактируй .ts файл, не .md.

## Skills — читай перед задачей

- Неминг: .claude/skills/NAMING_SKILL_v2.md
- Стиль и тон: .claude/skills/STUDIO_STYLE_GUIDE.md
- Навигация по боту: .claude/skills/NAVIGATION_MAP.md
- UX: .claude/skills/UX_SPECIFICATION.md
- UX реструктуризация: .claude/skills/UX_RESTRUCTURE_SPEC.md
- Фиксы брифа: .claude/skills/FIX_BRIEF_PROMPT.md
- Разовые задачи: .claude/skills/CLAUDE_CODE_PROMPT.md

## Brand OS

Vault path: ~/Brand-Studio/brand-os/
Структура: Axes/ Attractors/ Brands/ Clients/ _templates/
Скилл создания брендов: brand-os/_skills/brand-research/SKILL.md
Визуальный ресёрч: scripts/brandVisualResearch.ts (в разработке)
