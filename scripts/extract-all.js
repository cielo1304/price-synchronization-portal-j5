// Извлекает все услуги iPhone из таблицы и складывает их в JSON,
// чтобы каталог портала собирался из реальных данных без ручного ввода.
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");

const wb = xlsx.readFile(path.join(__dirname, "..", ".data", "sheet.xlsx"), {
  cellFormula: true,
});

function sheetRows(name) {
  const ws = wb.Sheets[name];
  if (!ws) return { ws: null, range: null };
  const range = xlsx.utils.decode_range(ws["!ref"]);
  return { ws, range };
}

function getCell(ws, r, col) {
  const addr = xlsx.utils.encode_cell({ r: r - 1, c: col });
  return ws[addr];
}
function getVal(ws, r, col) {
  const c = getCell(ws, r, col);
  return c == null ? null : c.v;
}
function getStr(ws, r, col) {
  const v = getVal(ws, r, col);
  return v == null ? "" : String(v).trim();
}

// ---------- Услуги ----------
// БД_УСЛУГИ_РО: B = код, F = наименование услуги, P = цена работы, K = гарантия (?)
// Сначала просто пройдём по всем строкам, найдём все коды i*-* и рядом цену из P.
const services = [];
{
  const { ws, range } = sheetRows("БД_УСЛУГИ_РО");
  if (!ws) {
    console.error("Нет листа БД_УСЛУГИ_РО");
    process.exit(1);
  }
  // Колонки A..Z по индексам (0-based)
  const COL = { code: 1, name: 5, labor: 15 }; // B, F, P
  for (let r = 2; r <= range.e.r + 1; r++) {
    const code = getStr(ws, r, COL.code);
    const name = getStr(ws, r, COL.name);
    const labor = getVal(ws, r, COL.labor);
    if (!code) continue;
    // Только iPhone-услуги: коды [i<число><суф>-...]
    const m = code.match(/^\[?(i([0-9]{1,2})([a-z]{0,4}))-([A-Z0-9]+)\]?$/i);
    if (!m) continue;
    const family = m[1].toLowerCase(); // i16, i15p, i14, i5s ...
    const subkey = m[4].toUpperCase(); // DIS, BAT, GLB, DOK, MIC ...
    const laborNum =
      typeof labor === "number" ? labor : Number(String(labor).replace(/\s/g, "").replace(",", "."));
    services.push({
      row: r,
      rawCode: code,
      family,
      subkey,
      name,
      laborPrice: Number.isFinite(laborNum) ? laborNum : null,
      laborSheetRef: `БД_УСЛУГИ_РО!P${r}`,
    });
  }
}

// ---------- Запчасти ----------
// БД_ЗАПЧАСТИ: B = наименование, I = закупка max/выбранная, M = наценка %, Q = итог рознице.
// Для нас интересны строки, где есть закупка (I) или итог (Q) и название содержит модель.
const parts = [];
{
  const { ws, range } = sheetRows("БД_ЗАПЧАСТИ");
  if (!ws) {
    console.error("Нет листа БД_ЗАПЧАСТИ");
    process.exit(1);
  }
  // Найдём заголовки автоматически: пробежим первую строку с заголовками 1..3.
  // По экстракту ранее: B=name, I=закупочная (выбранная), M=наценка%, Q=розница, ещё была колонка с источником.
  // Колонки источников: G = iComponents, H = MOS-LCD (по предыдущей инспекции).
  const COL = {
    name: 1, // B
    icomp: 6, // G iComponents цена
    moslcd: 7, // H MOS-LCD цена
    purchase: 8, // I закупочная (max из источников) — основная
    markup: 12, // M наценка %
    retail: 16, // Q итог Ремонлайну (розница)
    purchaseAlt: 14, // O — иногда там лежит закупка (в зависимости от структуры)
  };
  for (let r = 2; r <= range.e.r + 1; r++) {
    const name = getStr(ws, r, COL.name);
    if (!name) continue;
    const purchase = getVal(ws, r, COL.purchase);
    const markup = getVal(ws, r, COL.markup);
    const retail = getVal(ws, r, COL.retail);
    const icomp = getVal(ws, r, COL.icomp);
    const moslcd = getVal(ws, r, COL.moslcd);
    if (purchase == null && retail == null && icomp == null && moslcd == null) continue;

    parts.push({
      row: r,
      name,
      purchase: typeof purchase === "number" ? purchase : null,
      markup: typeof markup === "number" ? markup : null,
      retail: typeof retail === "number" ? retail : null,
      icomp: typeof icomp === "number" ? icomp : null,
      moslcd: typeof moslcd === "number" ? moslcd : null,
      sheetRefPurchase: `БД_ЗАПЧАСТИ!I${r}`,
      sheetRefMarkup: `БД_ЗАПЧАСТИ!M${r}`,
      sheetRefRetail: `БД_ЗАПЧАСТИ!Q${r}`,
      sheetRefIcomp: `БД_ЗАПЧАСТИ!G${r}`,
      sheetRefMosLcd: `БД_ЗАПЧАСТИ!H${r}`,
    });
  }
}

// ---------- Сводная статистика ----------
const families = new Map();
for (const s of services) {
  if (!families.has(s.family)) families.set(s.family, new Set());
  families.get(s.family).add(s.subkey);
}
const summary = {
  totalServices: services.length,
  totalParts: parts.length,
  byFamily: Object.fromEntries(
    Array.from(families.entries())
      .sort()
      .map(([fam, set]) => [fam, [...set].sort().join(", ")])
  ),
};

console.log("=== СВОДКА ===");
console.log(JSON.stringify(summary, null, 2));

// Покажем первые 30 услуг и первые 20 запчастей для контроля.
console.log("\n=== Первые 30 услуг ===");
for (const s of services.slice(0, 30)) {
  console.log(`${s.rawCode.padEnd(14)} ${(s.laborPrice ?? "—").toString().padStart(6)} ₽  ${s.name}`);
}

console.log("\n=== Первые 20 запчастей ===");
for (const p of parts.slice(0, 20)) {
  console.log(
    `[row ${String(p.row).padStart(4)}] purchase=${p.purchase ?? "—"} markup=${p.markup ?? "—"} retail=${p.retail ?? "—"}  ${p.name}`
  );
}

// Сохраним в JSON для последующей сборки каталога.
const outPath = path.join(__dirname, "..", ".data", "extract.json");
fs.writeFileSync(outPath, JSON.stringify({ services, parts, summary }, null, 2), "utf8");
console.log(`\nСохранено: ${outPath} (${services.length} услуг, ${parts.length} запчастей)`);
