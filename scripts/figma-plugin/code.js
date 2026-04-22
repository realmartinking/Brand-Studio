// Figma Plugin — Brand Library Creator
// main() пересобирает LOGOMARKS и создаёт SYMBOL+TEXT.
// Все остальные страницы не трогает.

async function main() {

  // ── 1. Шрифты ─────────────────────────────────────────────────────────────
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  // ── 2. Хелперы ────────────────────────────────────────────────────────────

  function rgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16) / 255,
      g: parseInt(hex.slice(3, 5), 16) / 255,
      b: parseInt(hex.slice(5, 7), 16) / 255,
    };
  }

  function fill(hex) {
    return [{ type: "SOLID", color: rgb(hex) }];
  }

  function makeText(chars, size, style, colorHex) {
    const t = figma.createText();
    t.characters = chars;
    t.fontSize = size;
    t.fontName = { family: "Inter", style: style };
    t.fills = fill(colorHex);
    return t;
  }

  // Лейбл-«таблетка» с HORIZONTAL auto-layout
  function createPill(label, fontSize, isBold, bgHex, rx, padV, padH) {
    const frame = figma.createFrame();
    frame.name = label;
    frame.cornerRadius  = rx !== null && rx !== undefined ? rx : 6;
    frame.fills         = fill(bgHex !== null && bgHex !== undefined ? bgHex : "#4A4A4A");
    frame.layoutMode    = "HORIZONTAL";
    frame.primaryAxisAlignItems  = "CENTER";
    frame.counterAxisAlignItems  = "CENTER";
    frame.paddingTop    = padV !== null && padV !== undefined ? padV : 6;
    frame.paddingBottom = padV !== null && padV !== undefined ? padV : 6;
    frame.paddingLeft   = padH !== null && padH !== undefined ? padH : 12;
    frame.paddingRight  = padH !== null && padH !== undefined ? padH : 12;
    frame.itemSpacing   = 0;
    const t = figma.createText();
    t.characters = label;
    t.fontSize   = fontSize;
    t.fontName   = { family: "Inter", style: isBold ? "Bold" : "Regular" };
    t.fills      = fill("#FFFFFF");
    frame.appendChild(t);
    frame.primaryAxisSizingMode = "AUTO";
    frame.counterAxisSizingMode = "AUTO";
    return frame;
  }

  // ── Константы карточки ─────────────────────────────────────────────────────
  const CARD_W        = 180;
  const CARD_H_VISUAL = 180;
  const CARD_TOTAL_H  = 270; // приблизительная полная высота для позиционирования в сетке

  // Карточка: VERTICAL auto-layout — visual-area + meta
  function createCard(slot, className) {
    const card = figma.createFrame();
    card.name = "slot " + slot;
    card.layoutMode = "VERTICAL";
    card.primaryAxisSizingMode  = "AUTO";
    card.counterAxisSizingMode  = "FIXED";
    card.resize(CARD_W, CARD_TOTAL_H); // ширина фиксирована, высота пересчитается AUTO
    card.fills = fill("#3D3D3D");
    card.cornerRadius = 6;
    card.clipsContent = false;
    card.itemSpacing  = 0;

    // ── visual-area ──────────────────────────────────────────────────────────
    const visualArea = figma.createFrame();
    visualArea.name = "visual-area";
    visualArea.resize(CARD_W, CARD_H_VISUAL);
    visualArea.fills = fill("#2A2A2A");
    visualArea.cornerRadius = 4;
    visualArea.layoutAlign = "STRETCH";
    visualArea.clipsContent = true;

    const visualLabel = makeText("ВИЗУАЛ", 9, "Regular", "#555555");
    visualLabel.name = "visual-label";
    visualLabel.x = 8;
    visualLabel.y = 8;
    visualArea.appendChild(visualLabel);
    card.appendChild(visualArea);

    // ── meta ─────────────────────────────────────────────────────────────────
    const meta = figma.createFrame();
    meta.name = "meta";
    meta.layoutMode = "VERTICAL";
    meta.primaryAxisSizingMode  = "AUTO";
    meta.counterAxisSizingMode  = "AUTO";
    meta.paddingTop    = 8;
    meta.paddingBottom = 8;
    meta.paddingLeft   = 8;
    meta.paddingRight  = 8;
    meta.itemSpacing   = 5;
    meta.fills = fill("#3D3D3D");
    meta.layoutAlign = "STRETCH";

    // card-title
    const titleText = makeText("название", 11, "Bold", "#FFFFFF");
    titleText.name = "card-title";
    titleText.layoutAlign = "STRETCH";
    meta.appendChild(titleText);

    // prompt-box
    const promptBox = figma.createFrame();
    promptBox.name = "prompt-box";
    promptBox.fills = fill("#252525");
    promptBox.cornerRadius = 3;
    promptBox.layoutMode = "VERTICAL";
    promptBox.primaryAxisSizingMode = "AUTO";
    promptBox.counterAxisSizingMode = "AUTO";
    promptBox.paddingTop    = 6;
    promptBox.paddingBottom = 6;
    promptBox.paddingLeft   = 6;
    promptBox.paddingRight  = 6;
    promptBox.itemSpacing   = 0;
    promptBox.layoutAlign   = "STRETCH";
    const promptText = makeText("промпт", 10, "Regular", "#AAAAAA");
    promptText.name = "card-prompt";
    promptText.layoutAlign = "STRETCH";
    promptBox.appendChild(promptText);
    meta.appendChild(promptBox);

    // card-tags
    const tagsText = makeText("тег1 · тег2", 9, "Regular", "#777777");
    tagsText.name = "card-tags";
    tagsText.layoutAlign = "STRETCH";
    meta.appendChild(tagsText);

    // card-footer
    const footer = figma.createFrame();
    footer.name = "card-footer";
    footer.fills = [];
    footer.layoutMode = "HORIZONTAL";
    footer.primaryAxisSizingMode  = "AUTO";
    footer.counterAxisSizingMode  = "AUTO";
    footer.primaryAxisAlignItems  = "SPACE_BETWEEN";
    footer.counterAxisAlignItems  = "CENTER";
    footer.layoutAlign = "STRETCH";
    const classText = makeText(className, 9, "Regular", "#666666");
    classText.name = "card-class";
    footer.appendChild(classText);
    const dotText = makeText("●", 8, "Regular", "#444444");
    dotText.name = "card-status";
    footer.appendChild(dotText);
    meta.appendChild(footer);

    card.appendChild(meta);
    return card;
  }

  // Сетка карточек — обычный фрейм без auto-layout, дети позиционируются вручную
  function createCardGrid(cols, rows, className) {
    const CARD_GAP = 12;
    const gridW = cols * CARD_W + (cols - 1) * CARD_GAP;
    const gridH = rows * CARD_TOTAL_H + (rows - 1) * CARD_GAP;

    const grid = figma.createFrame();
    grid.name = "cards-grid";
    grid.resize(gridW, gridH);
    grid.fills = [];
    grid.clipsContent = false;

    let slot = 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const card = createCard(slot, className);
        card.x = col * (CARD_W + CARD_GAP);
        card.y = row * (CARD_TOTAL_H + CARD_GAP);
        grid.appendChild(card);
        slot++;
      }
    }
    return grid;
  }

  // ── 3. Построение страницы LOGOMARKS ──────────────────────────────────────
  //
  // Dashboard (VERTICAL, AUTO) → лейбл страницы + 3 категории
  //   Категория (VERTICAL, AUTO) → header (title+desc) + classRow (HORIZONTAL)
  //     classRow → 5 секций (VERTICAL, AUTO) → лейбл класса + сетка карточек

  function buildLogomarks(page) {
    page.backgrounds = [{ type: "SOLID", color: rgb("#8C8C8C") }];

    const CATEGORIES = [
      { name: "TEXT",     desc: "Логотип построен только на типографике — без знака" },
      { name: "SYMBOL",   desc: "Самостоятельный знак без текстового сопровождения" },
      { name: "ANIMATED", desc: "Движение как часть визуальной идентичности" },
    ];
    const CLASS_NAMES = ["ЭКОНОМ", "КОМФОРТ", "БИЗНЕС", "ПРЕМИУМ", "ЛЮКС"];

    // Dashboard
    const dashboard = figma.createFrame();
    dashboard.name = "Dashboard — LOGOMARKS";
    dashboard.layoutMode = "VERTICAL";
    dashboard.primaryAxisSizingMode = "AUTO";
    dashboard.counterAxisSizingMode = "AUTO";
    dashboard.paddingTop    = 80;
    dashboard.paddingBottom = 80;
    dashboard.paddingLeft   = 60;
    dashboard.paddingRight  = 60;
    dashboard.itemSpacing   = 80;
    dashboard.x = 80;
    dashboard.y = 80;
    dashboard.fills = fill("#2A2A2A");
    dashboard.cornerRadius = 16;
    dashboard.clipsContent = false;
    page.appendChild(dashboard);

    // Лейбл страницы
    const pageLabel = createPill("MY WORK / LOGOMARKS", 13, true, "#4A4A4A", 6, 6, 12);
    dashboard.appendChild(pageLabel);

    let cardCount = 0;

    for (const cat of CATEGORIES) {
      // Фрейм категории
      const catFrame = figma.createFrame();
      catFrame.name = cat.name;
      catFrame.layoutMode = "VERTICAL";
      catFrame.primaryAxisSizingMode = "AUTO";
      catFrame.counterAxisSizingMode = "AUTO";
      catFrame.itemSpacing  = 32;
      catFrame.paddingTop   = 40;
      catFrame.paddingBottom = 40;
      catFrame.paddingLeft  = 40;
      catFrame.paddingRight = 40;
      catFrame.fills = fill("#333333");
      catFrame.cornerRadius = 12;
      catFrame.clipsContent = false;
      dashboard.appendChild(catFrame);

      // Заголовок категории: title + подпись
      const headerFrame = figma.createFrame();
      headerFrame.name = cat.name + "__header";
      headerFrame.layoutMode = "VERTICAL";
      headerFrame.primaryAxisSizingMode = "AUTO";
      headerFrame.counterAxisSizingMode = "AUTO";
      headerFrame.itemSpacing = 8;
      headerFrame.fills = [];
      headerFrame.clipsContent = false;
      catFrame.appendChild(headerFrame);

      const titleText = makeText(cat.name, 64, "Regular", "#FFFFFF");
      titleText.name = "cat-title";
      headerFrame.appendChild(titleText);

      const descText = makeText(cat.desc, 16, "Regular", "#888888");
      descText.name = "cat-desc";
      headerFrame.appendChild(descText);

      // Горизонтальный ряд секций классов
      const classRow = figma.createFrame();
      classRow.name = cat.name + "__classes";
      classRow.layoutMode = "HORIZONTAL";
      classRow.primaryAxisSizingMode = "AUTO";
      classRow.counterAxisSizingMode = "AUTO";
      classRow.itemSpacing = 16;
      classRow.fills = [];
      classRow.clipsContent = false;
      catFrame.appendChild(classRow);

      for (const className of CLASS_NAMES) {
        // Секция класса
        const section = figma.createFrame();
        section.name = className;
        section.layoutMode = "VERTICAL";
        section.primaryAxisSizingMode = "AUTO";
        section.counterAxisSizingMode = "AUTO";
        section.itemSpacing  = 16;
        section.paddingTop   = 16;
        section.paddingBottom = 16;
        section.paddingLeft  = 16;
        section.paddingRight = 16;
        section.fills = fill("#5C5C5C");
        section.cornerRadius = 8;
        section.clipsContent = false;
        classRow.appendChild(section);

        // Лейбл класса
        const classLabel = createPill(className, 14, false, "#4A4A4A", 4, 4, 10);
        section.appendChild(classLabel);

        // Сетка карточек 4 cols × 5 rows
        const grid = createCardGrid(4, 5, className);
        section.appendChild(grid);
        cardCount += 4 * 5;
      }
    }

    return cardCount; // 3 × 5 × 20 = 300
  }

  // ── 4. Построение страницы SYMBOL + TEXT ──────────────────────────────────
  //
  // Dashboard (VERTICAL, AUTO) → лейбл страницы + 5 секций
  //   Секция (VERTICAL, AUTO) → title + desc + сетка карточек

  function buildSymbolText(page) {
    page.backgrounds = [{ type: "SOLID", color: rgb("#8C8C8C") }];

    const SECTIONS = [
      { name: "ГОРИЗОНТАЛЬНЫЙ",     desc: "знак слева, текст справа" },
      { name: "ВЕРТИКАЛЬНЫЙ",       desc: "знак сверху, текст снизу" },
      { name: "ЭМБЛЕМА",            desc: "текст внутри знака или по кругу" },
      { name: "ЗНАК В БУКВЕ",       desc: "знак встроен в букву слова" },
      { name: "МОНОГРАММА + ТЕКСТ", desc: "инициалы рядом с названием" },
    ];

    // Dashboard
    const dashboard = figma.createFrame();
    dashboard.name = "Dashboard — SYMBOL + TEXT";
    dashboard.layoutMode = "VERTICAL";
    dashboard.primaryAxisSizingMode = "AUTO";
    dashboard.counterAxisSizingMode = "AUTO";
    dashboard.paddingTop    = 80;
    dashboard.paddingBottom = 80;
    dashboard.paddingLeft   = 60;
    dashboard.paddingRight  = 60;
    dashboard.itemSpacing   = 80;
    dashboard.x = 80;
    dashboard.y = 80;
    dashboard.fills = fill("#2A2A2A");
    dashboard.cornerRadius = 16;
    dashboard.clipsContent = false;
    page.appendChild(dashboard);

    // Лейбл страницы
    const pageLabel = createPill("MY WORK / SYMBOL + TEXT", 13, true, "#4A4A4A", 6, 6, 12);
    dashboard.appendChild(pageLabel);

    let cardCount = 0;

    for (const sec of SECTIONS) {
      // Фрейм секции
      const sectionFrame = figma.createFrame();
      sectionFrame.name = sec.name;
      sectionFrame.layoutMode = "VERTICAL";
      sectionFrame.primaryAxisSizingMode = "AUTO";
      sectionFrame.counterAxisSizingMode = "AUTO";
      sectionFrame.itemSpacing  = 24;
      sectionFrame.paddingTop   = 40;
      sectionFrame.paddingBottom = 40;
      sectionFrame.paddingLeft  = 40;
      sectionFrame.paddingRight = 40;
      sectionFrame.fills = fill("#333333");
      sectionFrame.cornerRadius = 12;
      sectionFrame.clipsContent = false;
      dashboard.appendChild(sectionFrame);

      // Заголовок секции
      const titleText = makeText(sec.name, 64, "Regular", "#FFFFFF");
      titleText.name = "section-title";
      sectionFrame.appendChild(titleText);

      // Подпись секции
      const descText = makeText(sec.desc, 16, "Regular", "#888888");
      descText.name = "section-desc";
      sectionFrame.appendChild(descText);

      // Сетка карточек 5 cols × 4 rows
      const grid = createCardGrid(5, 4, sec.name);
      sectionFrame.appendChild(grid);
      cardCount += 5 * 4;
    }

    return cardCount; // 5 × 20 = 100
  }

  // ── 5. Оркестрация ────────────────────────────────────────────────────────

  const allPagesBefore = figma.root.children.map(p => p.name);
  const cardCounts = {};

  // Пересобрать LOGOMARKS
  let logomarksPage = figma.root.children.find(p => p.name === "LOGOMARKS");
  if (!logomarksPage) {
    logomarksPage = figma.createPage();
    logomarksPage.name = "LOGOMARKS";
  }
  await figma.setCurrentPageAsync(logomarksPage);
  [...logomarksPage.children].forEach(n => n.remove());
  cardCounts["LOGOMARKS"] = buildLogomarks(logomarksPage);

  // Создать SYMBOL + TEXT после LOGOMARKS
  const existingSymbolText = figma.root.children.find(p => p.name === "SYMBOL + TEXT");
  if (existingSymbolText) existingSymbolText.remove();

  const symbolTextPage = figma.createPage();
  symbolTextPage.name = "SYMBOL + TEXT";
  const logomarksIdx = figma.root.children.findIndex(p => p.name === "LOGOMARKS");
  figma.root.insertChild(logomarksIdx + 1, symbolTextPage);

  await figma.setCurrentPageAsync(symbolTextPage);
  cardCounts["SYMBOL + TEXT"] = buildSymbolText(symbolTextPage);

  // Отчёт
  const untouched = allPagesBefore.filter(n => n !== "LOGOMARKS" && n !== "SYMBOL + TEXT");
  const total = cardCounts["LOGOMARKS"] + cardCounts["SYMBOL + TEXT"];

  const lines = [
    "✅ Изменено:",
    "   LOGOMARKS      — пересобрана  (" + cardCounts["LOGOMARKS"] + " карточек)",
    "   SYMBOL + TEXT  — создана      (" + cardCounts["SYMBOL + TEXT"] + " карточек)",
    "",
    "⏸  Не тронуто (" + untouched.length + "): " + (untouched.length > 0 ? untouched.join(", ") : "—"),
    "",
    "📊 Итого карточек: " + total,
  ];

  console.log(lines.join("\n"));
  figma.closePlugin(lines.join("\n"));
}

main().catch(err => {
  console.error("Fatal:", err);
  figma.closePlugin("❌ Ошибка: " + err.message);
});
