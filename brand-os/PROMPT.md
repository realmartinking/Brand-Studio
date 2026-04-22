# Промпт для Claude Code — Brand OS Obsidian Vault

Скопируй целиком и вставь в Claude Code после `cd ~/Brand-Studio && claude`.

---

```
Создай полную структуру Brand OS в Obsidian vault по пути:
~/Brand-Studio/brand-os/

НЕ УДАЛЯЙ ничего если папка уже существует — только создавай новое.

## Структура папок

Brand OS/
├── Axes/                    (18 файлов — определения осей)
├── Attractors/              (30 файлов — первые аттракторы)
├── Brands/                  (пока пусто, создай README.md)
├── Clients/                 (пока пусто, создай README.md)
├── Stimulus-Templates/
│   ├── base/                (пока пусто, создай README.md)
│   └── contextual/          (пока пусто, создай README.md)
└── _templates/              (3 шаблона Obsidian)

---

## 1. Папка Axes/ — 18 файлов

Каждый файл = одна ось. Формат имени: `XX-kebab-name.md` (01-self-community.md и т.д.)

Для каждой оси используй YAML frontmatter + описание. Вот полная спецификация:

### Narrative axes (8):

**01-self-community.md**
```yaml
---
type: axis
id: self-community
layer: narrative
index: 1
pole_left: Self
pole_right: Community
pole_left_value: 0.0
pole_right_value: 1.0
---
```
- **Self (0.0):** Brand celebrates the individual. "You are unique." Personal expression, customization, one-of-a-kind. Examples: Moleskine, Aston Martin.
- **Community (1.0):** Brand celebrates belonging. "We are together." Shared values, collective identity. Examples: Patagonia, IKEA.
- **Visual markers:** Self → asymmetry, unique details, "I" language. Community → repetition, pattern, "we" language, crowd imagery.

**02-control-release.md**
- Control (0.0): Order, precision, predictability. Everything in its place. Examples: Muji, German engineering.
- Release (1.0): Spontaneity, chaos, surrender. Let it happen. Examples: Burning Man, Supreme drops.
- Visual markers: Control → grid, monospace, clean edges. Release → broken grid, organic, irregular.

**03-roots-horizon.md**
- Roots (0.0): Tradition, heritage, craftsmanship, proven. "We've always done it this way." Examples: Hermès, aged whiskey.
- Horizon (1.0): Future, innovation, disruption, untested. "What's next." Examples: Tesla, SpaceX.
- Visual markers: Roots → serif, warm materials, patina. Horizon → sans-serif, gradients, glass.

**04-body-mind.md**
- Body (0.0): Sensual, tactile, physical pleasure, taste, texture. Examples: Lush, artisan bakeries.
- Mind (1.0): Intellectual, conceptual, ideas over sensations. Examples: Aesop, The Economist.
- Visual markers: Body → textures, close-up photography, warm. Mind → clean, text-heavy, diagrams.

**05-all-few.md**
- For all (0.0): Democratic, accessible, inclusive. Examples: IKEA, Uniqlo.
- For few (1.0): Exclusive, selective, filtering. Examples: Soho House, by-invitation brands.
- Visual markers: For all → bright, open, simple. For few → muted, gates, codes.

**06-loud-quiet.md**
- Loud (0.0): Expressive, visible, attention-seeking. Examples: Supreme, Balenciaga.
- Quiet (1.0): Restrained, understated, whisper. Examples: The Row, Aesop.
- Visual markers: Loud → big type, color clash, oversize. Quiet → small type, tone-on-tone, whitespace.

**07-serious-playful.md**
- Serious (0.0): Weight, gravity, significance. Examples: law firms, Swiss banks.
- Playful (1.0): Light, humorous, joyful. Examples: Innocent Drinks, Mailchimp.
- Visual markers: Serious → dark palette, heavy weight, formal type. Playful → pastel/bright, rounded, lowercase.

**08-nature-technology.md**
- Nature (0.0): Organic, raw, unprocessed, earth. Examples: Patagonia, farm-to-table.
- Technology (1.0): Synthetic, digital, engineered. Examples: Tesla, Dyson.
- Visual markers: Nature → earth tones, organic shapes, raw textures. Technology → metallics, grids, clean surfaces.

### Sensory axes (6):

**09-geometry.md** — Angular (0.0) ↔ Rounded (1.0)
- Angular: Sharp corners, straight lines. Activates amygdala (attention/alertness). Examples: Prada, Zaha Hadid.
- Rounded: Soft corners, curves, circular. Activates insula (comfort/safety). Examples: Chanel, Apple edges.

**10-contrast.md** — High (0.0) ↔ Low (1.0)
- High: Black/white, thick/thin, loud differences. Tension. Examples: didone typography, Vogue.
- Low: Subtle differences, tone-on-tone, harmony. Calm. Examples: Muji, Kinfolk.

**11-rhythm.md** — Fast (0.0) ↔ Slow (1.0)
- Fast: Short intervals, quick transitions, dense info. Energy. Examples: Vice, fast-fashion.
- Slow: Long pauses, breathing room, minimal info per moment. Examples: Aesop stores, slow food.

**12-density.md** — Dense (0.0) ↔ Spacious (1.0)
- Dense: Packed, layered, rich, maximal. Examples: baroque, Japanese konbini packaging.
- Spacious: Open, empty, minimal, essential. Examples: Apple stores, Scandinavian design.

**13-temperature.md** — Warm (0.0) ↔ Cool (1.0)
- Warm: Earth tones, amber, wood, leather, candlelight. Proximity. Examples: craft coffee, Brunello Cucinelli.
- Cool: Blue, gray, steel, glass, daylight. Distance. Examples: Apple, fintech.

**14-weight.md** — Heavy (0.0) ↔ Light (1.0)
- Heavy: Thick strokes, dense materials, gravity. Gravitas. Examples: stone architecture, blackletter.
- Light: Thin strokes, transparent materials, air. Elegance. Examples: Cartier, light serifs.

### Ritual axes (4):

**15-distance.md** — Intimate (0.0) ↔ Formal (1.0)
- Intimate: First name, personal touch, warmth. Examples: neighborhood café, handwritten note.
- Formal: Title, protocol, distance. Examples: Savile Row, private banking.

**16-speed.md** — Instant (0.0) ↔ Ceremonial (1.0)
- Instant: Click-buy-done. No friction. Examples: Amazon, fast food.
- Ceremonial: Ritual, stages, anticipation. Examples: tea ceremony, Tiffany box opening.

**17-participation.md** — Passive (0.0) ↔ Co-created (1.0)
- Passive: Consume as delivered. No input. Examples: luxury hotels, fine dining.
- Co-created: Customer shapes the experience. Examples: Build-a-Bear, custom suit fitting.

**18-repeatability.md** — Routine (0.0) ↔ Event (1.0)
- Routine: Daily use, habit, automatic. Examples: morning coffee, toothpaste.
- Event: Occasion, celebration, one-time. Examples: wedding dress, Dom Pérignon.

---

## 2. Папка _templates/ — 3 файла

**attractor-template.md:**
```yaml
---
type: attractor
id: "{{kebab-id}}"
cluster: "{{cluster}}"
self_community: 0.5
control_release: 0.5
roots_horizon: 0.5
body_mind: 0.5
all_few: 0.5
loud_quiet: 0.5
serious_playful: 0.5
nature_technology: 0.5
geometry: 0.5
contrast: 0.5
rhythm: 0.5
density: 0.5
temperature: 0.5
weight: 0.5
distance: 0.5
speed: 0.5
participation: 0.5
repeatability: 0.5
segment_modifier: []
geography_modifier: [global]
tags: []
---

## {{Attractor Name}}

[1-2 sentences describing the core feeling]

## Brands in this attractor
- [[brand-1]]

## Visual code
- **Typography:**
- **Palette:**
- **Geometry:**
- **Density:**
- **Textures:**

## Verbal code
- **Tone:**
- **Phrase length:**
- **Vocabulary:**
- **Examples:**

## Industry adaptations

### Real estate
### HoReCa
### Fashion
### Tech

## When to apply

## Adjacent attractors
```

**client-card-template.md:**
```yaml
---
type: client
name: "{{Brand/Project name}}"
date: {{date}}
status: briefing
product_reality: ""
segment: ""
industry: ""
place_heritage: ""
sensory_constraints: ""
price_architecture: ""
visual_lifespan_years: 0
geography: ""
lifecycle_stage: ""
scale: ""
stage_timeline: ""
regulatory_constraints: ""
multilingual: false
founder_story: ""
audience_portrait: ""
purchase_emotion: ""
ambition_scale: ""
internal_language: {}
verbal_code: ""
competitors: []
anti_brand: ""
name_neighbors: ""
team: ""
channels: []
reading_speed: ""
tactile_touchpoint: ""
axes:
  self_community: 0.5
  control_release: 0.5
  roots_horizon: 0.5
  body_mind: 0.5
  all_few: 0.5
  loud_quiet: 0.5
  serious_playful: 0.5
  nature_technology: 0.5
  geometry: 0.5
  contrast: 0.5
  rhythm: 0.5
  density: 0.5
  temperature: 0.5
  weight: 0.5
  distance: 0.5
  speed: 0.5
  participation: 0.5
  repeatability: 0.5
name_phonetics: ""
name_pronounceability: ""
without_logo_test: ""
nearest_attractor: ""
attractor_difference: ""
---
```

**brand-template.md:**
```yaml
---
type: brand
name: "{{Brand Name}}"
industry: ""
segment: ""
axes:
  self_community: 0.5
  control_release: 0.5
  roots_horizon: 0.5
  body_mind: 0.5
  all_few: 0.5
  loud_quiet: 0.5
  serious_playful: 0.5
  nature_technology: 0.5
  geometry: 0.5
  contrast: 0.5
  rhythm: 0.5
  density: 0.5
  temperature: 0.5
  weight: 0.5
  distance: 0.5
  speed: 0.5
  participation: 0.5
  repeatability: 0.5
nearest_attractor: ""
tags: []
---

## {{Brand Name}}
[Brief description of the brand's identity]

## Why this position
[What makes this brand occupy this point in attractor space]
```

---

## 3. Папка Attractors/ — 30 аттракторов

Это КЛЮЧЕВАЯ часть. Каждый аттрактор — отдельный .md файл. Имя файла = kebab-case id.

Создай ровно 30 аттракторов, покрывающих основные зоны 18-мерного пространства. Группируй в кластеры. Для каждого заполни ВСЕ 18 координат осмысленно (не 0.5 по умолчанию — реальные значения), и напиши конкретный visual code, verbal code, и industry adaptations.

### Список 30 аттракторов:

**Cluster: Minimal & Restrained**
1. `silent-confidence.md` — Тихая уверенность. Aesop, The Row, Céline old. Quiet luxury. Coordinates: quiet=0.9, serious=0.7, few=0.8, mind=0.7, control=0.7, cool=0.6, spacious=0.8, low contrast=0.8, slow=0.8, light=0.7, formal=0.6, ceremonial=0.6, passive=0.3, routine=0.3
2. `nordic-purity.md` — Скандинавская чистота. Muji, Kinfolk, HAY. Coordinates: control=0.8, nature=0.3, spacious=0.9, rounded=0.6, low contrast=0.9, cool=0.6, light=0.8, quiet=0.8, all=0.3, serious=0.4
3. `intellectual-craft.md` — Интеллектуальное ремесло. Monocle, Aesop, Dieter Rams. Coordinates: mind=0.8, control=0.8, roots=0.4, few=0.6, quiet=0.7, serious=0.6, angular=0.4, high contrast=0.3, warm=0.4, heavy=0.4

**Cluster: Heritage & Warmth**
4. `warm-heritage.md` — Тёплое наследие. Hermès, старые английские бренды, aged whiskey. Coordinates: roots=0.9, warm=0.9, body=0.7, few=0.8, serious=0.7, quiet=0.7, heavy=0.6, dense=0.4, slow=0.8, ceremonial=0.7, formal=0.6
5. `artisan-authentic.md` — Ремесленная подлинность. Craft bakeries, small-batch producers. Coordinates: roots=0.7, body=0.9, nature=0.8, warm=0.9, self=0.3, all=0.4, quiet=0.5, rounded=0.6, dense=0.4, intimate=0.2, co-created=0.5
6. `nostalgic-comfort.md` — Ностальгический уют. Grandma's house aesthetic, vintage, retro. Coordinates: roots=0.8, warm=0.9, body=0.7, community=0.6, playful=0.4, rounded=0.7, low contrast=0.7, slow=0.8, dense=0.5, intimate=0.2, routine=0.3

**Cluster: Bold & Expressive**
7. `urban-energy.md` — Городская энергия. Supreme, Off-White, streetwear. Coordinates: loud=0.1, release=0.8, horizon=0.6, self=0.3, playful=0.5, technology=0.5, angular=0.3, high contrast=0.1, fast=0.1, dense=0.2, heavy=0.3, instant=0.2, event=0.7
8. `provocateur.md` — Провокатор. Balenciaga, Vetements, MSCHF. Coordinates: loud=0.0, release=0.9, horizon=0.8, self=0.2, playful=0.6, angular=0.2, high contrast=0.0, fast=0.1, dense=0.3, heavy=0.4, few=0.7, event=0.9
9. `maximalist-joy.md` — Максималистская радость. Desigual, Marimekko, Indian wedding. Coordinates: loud=0.0, playful=0.9, body=0.8, community=0.7, all=0.3, release=0.7, rounded=0.7, high contrast=0.2, fast=0.2, dense=0.1, warm=0.3, event=0.7

**Cluster: Premium & Corporate**
10. `corporate-trust.md` — Корпоративное доверие. McKinsey, Swiss banks, big law. Coordinates: serious=0.1, control=0.9, mind=0.8, few=0.6, quiet=0.7, angular=0.3, high contrast=0.3, cool=0.7, heavy=0.3, formal=0.9, slow=0.6, passive=0.1, routine=0.2
11. `modern-premium.md` — Современный премиум. Porsche, Bang & Olufsen, Molteni&C. Coordinates: few=0.7, control=0.7, horizon=0.5, mind=0.6, quiet=0.6, serious=0.6, angular=0.3, high contrast=0.4, cool=0.5, heavy=0.4, spacious=0.6, ceremonial=0.5, passive=0.2
12. `old-money.md` — Старые деньги. Brunello Cucinelli, Loro Piana, Ralph Lauren Purple Label. Coordinates: roots=0.8, few=0.9, quiet=0.9, serious=0.7, body=0.6, warm=0.7, low contrast=0.9, slow=0.9, light=0.5, spacious=0.6, formal=0.7, ceremonial=0.7, passive=0.2

**Cluster: Tech & Future**
13. `silicon-optimism.md` — Кремниевый оптимизм. Early Google, Stripe, Linear. Coordinates: horizon=0.9, technology=0.9, mind=0.7, all=0.3, playful=0.4, control=0.6, angular=0.4, spacious=0.7, low contrast=0.6, cool=0.6, light=0.8, fast=0.2, instant=0.1, co-created=0.5
14. `cyberpunk-edge.md` — Киберпанк. Nothing phone, Teenage Engineering, early Spotify. Coordinates: horizon=0.9, technology=0.9, self=0.3, release=0.5, loud=0.3, playful=0.5, angular=0.2, high contrast=0.1, cool=0.8, dense=0.3, fast=0.1, heavy=0.4, instant=0.2, event=0.6
15. `clean-tech.md` — Чистый тех. Apple, Tesla store, Rivian. Coordinates: horizon=0.7, technology=0.8, control=0.8, mind=0.6, quiet=0.7, serious=0.5, rounded=0.7, low contrast=0.7, cool=0.7, spacious=0.9, light=0.9, slow=0.6, ceremonial=0.6, passive=0.2

**Cluster: Nature & Wellness**
16. `earth-mother.md` — Мать-земля. Patagonia, Burt's Bees, farmer's market. Coordinates: nature=0.9, body=0.8, community=0.7, roots=0.6, all=0.3, quiet=0.5, serious=0.4, rounded=0.6, low contrast=0.6, warm=0.2, dense=0.4, heavy=0.4, slow=0.7, intimate=0.2, co-created=0.6, routine=0.3
17. `zen-wellness.md` — Дзен-велнес. Headspace, calm spas, Japanese onsen. Coordinates: nature=0.4, body=0.5, mind=0.5, control=0.6, quiet=0.9, serious=0.5, rounded=0.8, low contrast=0.9, warm=0.4, spacious=0.9, light=0.9, slow=0.9, ceremonial=0.7, passive=0.2, event=0.5
18. `wild-adventure.md` — Дикое приключение. The North Face, Land Rover, Bear Grylls. Coordinates: nature=0.8, body=0.9, self=0.3, release=0.6, horizon=0.5, loud=0.3, serious=0.4, angular=0.3, high contrast=0.3, warm=0.4, dense=0.4, heavy=0.2, fast=0.2, instant=0.3, co-created=0.7, event=0.8

**Cluster: Playful & Accessible**
19. `friendly-helper.md` — Дружелюбный помощник. Mailchimp, Notion, Slack. Coordinates: all=0.2, playful=0.7, community=0.5, mind=0.5, horizon=0.5, quiet=0.4, rounded=0.7, low contrast=0.6, warm=0.4, spacious=0.6, light=0.7, fast=0.3, instant=0.2, co-created=0.7, routine=0.2
20. `pop-culture.md` — Поп-культура. McDonald's, Coca-Cola, Lego. Coordinates: all=0.1, loud=0.1, playful=0.8, community=0.7, body=0.6, release=0.4, rounded=0.8, high contrast=0.2, warm=0.3, dense=0.3, heavy=0.4, fast=0.2, instant=0.1, passive=0.2, routine=0.1
21. `indie-charm.md` — Инди-обаяние. Wes Anderson aesthetic, indie bookstores, Ace Hotel. Coordinates: self=0.3, playful=0.6, roots=0.5, body=0.5, few=0.5, quiet=0.5, nature=0.4, rounded=0.5, low contrast=0.5, warm=0.5, spacious=0.5, light=0.5, slow=0.6, intimate=0.3, co-created=0.4, event=0.5

**Cluster: Luxury & Ceremony**
22. `haute-couture.md` — Высокая мода. Chanel, Dior, haute couture ateliers. Coordinates: few=0.9, serious=0.6, body=0.7, control=0.7, roots=0.5, quiet=0.6, angular=0.4, high contrast=0.3, cool=0.5, spacious=0.6, light=0.6, slow=0.8, ceremonial=0.9, formal=0.8, passive=0.1, event=0.8
23. `dark-luxury.md` — Тёмная роскошь. Tom Ford, Saint Laurent, dark bars. Coordinates: few=0.9, serious=0.8, self=0.3, body=0.7, control=0.5, release=0.4, loud=0.3, angular=0.3, high contrast=0.2, cool=0.6, dense=0.3, heavy=0.2, slow=0.7, formal=0.6, ceremonial=0.7, event=0.7
24. `palace-grandeur.md` — Дворцовое великолепие. Versace, Dolce & Gabbana, grand hotels. Coordinates: few=0.8, loud=0.1, body=0.8, roots=0.7, serious=0.5, community=0.5, rounded=0.6, high contrast=0.2, warm=0.2, dense=0.1, heavy=0.1, slow=0.7, ceremonial=0.9, formal=0.8, passive=0.1, event=0.9

**Cluster: Constructivism & Structure**
25. `constructivist-honesty.md` — Конструктивистская честность. Brutalism, exposed materials, "form follows function." Coordinates: control=0.8, mind=0.7, serious=0.7, nature=0.4, roots=0.5, self=0.4, quiet=0.6, angular=0.1, high contrast=0.2, cool=0.5, dense=0.4, heavy=0.2, slow=0.6, formal=0.5, passive=0.3
26. `bauhaus-functional.md` — Баухаус-функционализм. Braun, Vitra, Bauhaus school. Coordinates: control=0.9, mind=0.8, horizon=0.5, all=0.3, serious=0.5, quiet=0.6, angular=0.3, high contrast=0.4, cool=0.5, spacious=0.7, light=0.6, slow=0.5, formal=0.4

**Cluster: Local & Community**
27. `neighborhood-soul.md` — Душа района. Third-wave coffee, local bookshop, community center. Coordinates: community=0.8, intimate=0.1, body=0.6, nature=0.4, roots=0.5, all=0.3, quiet=0.4, playful=0.4, rounded=0.6, low contrast=0.6, warm=0.3, dense=0.4, light=0.5, slow=0.6, co-created=0.7, routine=0.2
28. `cultural-institution.md` — Культурный институт. MoMA, Barbican, Tate. Coordinates: mind=0.9, serious=0.6, community=0.6, control=0.6, horizon=0.5, quiet=0.5, few=0.4, angular=0.3, high contrast=0.4, cool=0.5, spacious=0.7, heavy=0.4, slow=0.6, formal=0.5, ceremonial=0.5, passive=0.2, event=0.6

**Cluster: Digital Native**
29. `creator-economy.md` — Экономика креаторов. Figma, Notion, Framer. Coordinates: self=0.4, co-created=0.9, horizon=0.7, technology=0.7, mind=0.6, playful=0.5, all=0.3, quiet=0.4, rounded=0.5, low contrast=0.5, cool=0.5, spacious=0.6, light=0.7, fast=0.3, instant=0.2, routine=0.3
30. `attention-economy.md` — Экономика внимания. TikTok, YouTube, influencer brands. Coordinates: loud=0.0, fast=0.0, release=0.8, self=0.2, body=0.6, all=0.2, playful=0.7, horizon=0.6, technology=0.7, rounded=0.6, high contrast=0.1, warm=0.4, dense=0.2, light=0.5, instant=0.0, co-created=0.8, event=0.6

---

## Как заполнять каждый аттрактор

Используй шаблон из _templates/attractor-template.md. Для КАЖДОГО аттрактора:

1. **YAML frontmatter** — все 18 координат (значения указаны выше, НЕ оставляй 0.5 по умолчанию). Если координата не указана явно выше — определи её сам исходя из описания.
2. **Описание** — 2-3 предложения о том, что чувствует человек в этом аттракторе.
3. **Brands** — 3-5 реальных брендов, используй Obsidian wikilinks [[Brand Name]].
4. **Visual code** — конкретная типографика (не "serif" а "высококонтрастная антиква с тонкими горизонталями, например Didot"), палитра (конкретные температуры и насыщенности), геометрия, плотность, текстуры.
5. **Verbal code** — тон, длина фраз, словарь, 2-3 примера фраз.
6. **Industry adaptations** — для Real estate, HoReCa, Fashion, Tech. Для каждой индустрии 2-3 предложения о том, как этот аттрактор проявляется конкретно.
7. **When to apply** — какие комбинации осей указывают на этот аттрактор.
8. **Adjacent attractors** — 2-3 соседних аттрактора из списка выше, с указанием по какой оси различаются.

---

## 4. README файлы

В каждой пустой папке (Brands/, Clients/, Stimulus-Templates/base/, Stimulus-Templates/contextual/) создай README.md с кратким описанием:

**Brands/README.md:**
```
# Brands
Real brand examples with 18-axis coordinates.
Each brand file maps to its nearest attractor.
Use template: [[brand-template]]
```

**Clients/README.md:**
```
# Clients
Client cases processed through Brand OS.
Each client file contains all 30 parameters from the briefing.
Use template: [[client-card-template]]
```

**Stimulus-Templates/base/README.md:**
```
# Base Stimulus Cards
50-80 constant cards encoding pure sensory axes.
Same cards regardless of industry.
```

**Stimulus-Templates/contextual/README.md:**
```
# Contextual Stimulus Cards
Generated after blocks 1-4, adapted to specific client context.
Contains prompt templates for Recraft API generation.
```

---

## Важные правила

- Все файлы в UTF-8
- Все YAML frontmatter должен быть валидным
- Obsidian wikilinks в формате [[name]]
- Координаты всегда 0.0-1.0, один десятичный знак
- Не используй эмодзи в файлах
- Каждый аттрактор файл — полностью заполненный, НЕ заглушка
- Если по контексту не ясно какое значение оси — используй значение ближайшего к описанию полюса, не ставь 0.5
```
