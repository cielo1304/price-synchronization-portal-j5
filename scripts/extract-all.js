/* eslint-disable */
// Извлекает все позиции из вашей Google-таблицы.
// Главный лист — ПРАЙС_ЛИСТ. Формула в F каждой строки указывает,
// какая работа из БД_УСЛУГИ_РО и какая запчасть из БД_ЗАПЧАСТИ нужны.
// Пример: 'БД_УСЛУГИ_РО'!P916+'БД_ЗАПЧАСТИ'!P275

const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");

const wb = xlsx.readFile(path.join(__dirname, "..", ".data", "sheet.xlsx"), {
  cellFormula: true,
});

const v = (ws, addr) => {
  const c = ws[addr];
  return c == null ? undefined : c.v;
};
const num = (x) =>
  x === undefined || x === "" || x === null || Number.isNaN(Number(x))
    ? undefined
    : Number(x);
const str = (x) => (x == null ? "" : String(x).trim());

// Получить «жёсткое» значение и формулу
const cellFV = (ws, addr) => {
  const c = ws[addr];
  if (!c) return { v: undefined, f: undefined };
  return { v: c.v, f: c.f };
};

// Парсер формулы → ссылки на строки
const RX_LABOR = /'?БД_УСЛУГИ_РО'?!P(\d+)/i;
const RX_PART = /'?БД_ЗАПЧАСТИ'?!P(\d+)/i;
function parseRefs(f) {
  if (!f) return {};
  const lm = f.match(RX_LABOR);
  const pm = f.match(RX_PART);
  return {
    laborRow: lm ? parseInt(lm[1], 10) : undefined,
    partRow: pm ? parseInt(pm[1], 10) : undefined,
  };
}

// ── Работа из БД_УСЛУГИ_РО ────────────────────────────────────────────
const wsLabor = wb.Sheets["БД_УСЛУГИ_РО"];
function getLabor(row) {
  if (!row) return null;
  const price = num(v(wsLabor, "P" + row));
  const name = str(v(wsLabor, "F" + row)) || str(v(wsLabor, "E" + row));
  if (price === undefined && !name) return null;
  return {
    sheetRef: `БД_УСЛУГИ_РО!P${row}`,
    name,
    price: price ?? null,
    duration: str(v(wsLabor, "K" + row)) || null,
    warranty: num(v(wsLabor, "I" + row)) ?? null,
  };
}

// ── Запчасть из БД_ЗАПЧАСТИ ───────────────────────────────────────────
const wsParts = wb.Sheets["БД_ЗАПЧАСТИ"];
function getPart(row) {
  if (!row) return null;
  const name = str(v(wsParts, "B" + row));
  if (!name) return null;
  const markupRaw = num(v(wsParts, "N" + row));
  const markupPct =
    markupRaw === undefined
      ? null
      : markupRaw < 1
        ? Math.round(markupRaw * 1000) / 10
        : markupRaw;
  return {
    sheetRef: `БД_ЗАПЧАСТИ!P${row}`,
    sheetRefRetail: `БД_ЗАПЧАСТИ!Q${row}`,
    name,
    partId: str(v(wsParts, "C" + row)) || null,
    model: str(v(wsParts, "E" + row)),
    category: str(v(wsParts, "F" + row)),
    purchaseICmp: num(v(wsParts, "I" + row)) ?? null,
    purchaseMOS: num(v(wsParts, "L" + row)) ?? null,
    purchase: num(v(wsParts, "M" + row)) ?? null,
    markupPct,
    retailForPrice: num(v(wsParts, "O" + row)) ?? null,
    purchaseRO: num(v(wsParts, "P" + row)) ?? null,
    retailRO: num(v(wsParts, "Q" + row)) ?? null,
  };
}

// ── МойСклад по коду C из ПРАЙС_ЛИСТ ──────────────────────────────────
const wsMS = wb.Sheets["БД_МОЙ СКЛАД"];
const myskladByCode = new Map();
{
  const ref = xlsx.utils.decode_range(wsMS["!ref"]);
  for (let r = 3; r <= ref.e.r + 1; r++) {
    const code = v(wsMS, "C" + r);
    if (code === undefined || code === "") continue;
    myskladByCode.set(str(code), {
      row: r,
      price: num(v(wsMS, "D" + r)),
      service: str(v(wsMS, "E" + r)),
      time: str(v(wsMS, "F" + r)),
      warranty: str(v(wsMS, "H" + r)),
      url: str(v(wsMS, "I" + r)),
      description: str(v(wsMS, "J" + r)),
    });
  }
}

// ── Конкурент РЕМОНТ_ЯБЛОК (best-effort) ──────────────────────────────
const competitorByCode = new Map();
{
  const ws = wb.Sheets["РЕМОНТ_ЯБЛОК"];
  if (ws) {
    const ref = xlsx.utils.decode_range(ws["!ref"]);
    for (let r = 1; r <= ref.e.r + 1; r++) {
      // ищем код в любой из B-D, цену — в любой числовой
      let code;
      for (const cc of ["A", "B", "C", "D"]) {
        const x = v(ws, cc + r);
        if (typeof x === "string" && /^i\d/i.test(x.trim())) {
          code = x.trim();
          break;
        }
      }
      if (!code) continue;
      for (const pc of ["E", "F", "G", "H", "I", "J"]) {
        const p = num(v(ws, pc + r));
        if (p && p > 100) {
          competitorByCode.set(code, p);
          break;
        }
      }
    }
  }
}

// ── Классификатор семейства ───────────────────────────────────────────
function classify(model) {
  const m = (model || "").trim();
  if (/^iphone/i.test(m)) return "iPhone";
  if (/^ipad/i.test(m)) return "iPad";
  if (/^apple ?watch|^watch/i.test(m)) return "Apple Watch";
  if (/^macbook|^imac|^mac ?mini|^mac ?pro/i.test(m)) return "Mac";
  if (/^airpods/i.test(m)) return "AirPods";
  return "Прочее";
}

// ── Главный проход по ПРАЙС_ЛИСТ ──────────────────────────────────────
const wsPrice = wb.Sheets["ПРАЙС_ЛИСТ"];
const range = xlsx.utils.decode_range(wsPrice["!ref"]);

const positions = [];
let lastModel = "";
let skipped = 0;

for (let r = 4; r <= range.e.r + 1; r++) {
  const bRaw = str(v(wsPrice, "B" + r));
  if (bRaw) lastModel = bRaw;
  const model = lastModel;
  if (!model) continue;

  const service = str(v(wsPrice, "E" + r));
  if (!service) continue;

  const code = str(v(wsPrice, "C" + r)) || null;
  const warrantyDays = num(v(wsPrice, "D" + r)) ?? null;
  const fCell = cellFV(wsPrice, "F" + r);
  const finalPrice = num(fCell.v);
  const formula = fCell.f || null;
  const rangeStr = str(v(wsPrice, "G" + r)) || null;

  const refs = parseRefs(formula);
  const labor = getLabor(refs.laborRow);
  const part = getPart(refs.partRow);

  // если ни работы, ни цены — это служебная строка
  if (!labor && finalPrice === undefined) {
    skipped++;
    continue;
  }

  positions.push({
    rowInPriceList: r,
    code,
    family: classify(model),
    model,
    service,
    warrantyDays,
    finalPrice: finalPrice ?? null,
    range: rangeStr,
    formula,
    priceListSheetRef: `ПРАЙС_ЛИСТ!F${r}`,
    priceListRangeRef: rangeStr ? `ПРАЙС_ЛИСТ!G${r}` : null,
    labor,
    part,
    mysklad: code ? myskladByCode.get(code) || null : null,
    competitorPrice: code ? (competitorByCode.get(code) ?? null) : null,
  });
}

// ── Статистика ────────────────────────────────────────────────────────
const byFamily = {};
const byModel = new Map();
for (const p of positions) {
  byFamily[p.family] = (byFamily[p.family] || 0) + 1;
  if (!byModel.has(p.model)) byModel.set(p.model, []);
  byModel.get(p.model).push(p);
}

console.log(`Всего позиций: ${positions.length}    (пропущено пустых строк: ${skipped})`);
console.log("По семействам:");
for (const [k, v] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(14)} ${v}`);
}
console.log("\nТоп-15 моделей:");
[...byModel.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 15)
  .forEach(([m, items]) => {
    const wL = items.filter((x) => x.labor).length;
    const wP = items.filter((x) => x.part).length;
    const wMS = items.filter((x) => x.mysklad).length;
    console.log(
      `  ${m.padEnd(26)} ${String(items.length).padStart(3)}  · работа ${String(wL).padStart(3)}  запчасть ${String(wP).padStart(3)}  МС ${String(wMS).padStart(3)}`
    );
  });

const wLA = positions.filter((p) => p.labor).length;
const wPA = positions.filter((p) => p.part).length;
const wMA = positions.filter((p) => p.mysklad).length;
const wFp = positions.filter((p) => p.finalPrice).length;
console.log(
  `\n[итого] финальная цена ${wFp}   работа ${wLA}   запчасть ${wPA}   МойСклад ${wMA}`
);

const outPath = path.join(__dirname, "..", "lib", "portal-positions.json");
fs.writeFileSync(outPath, JSON.stringify(positions, null, 2), "utf8");
console.log(
  `\nСохранено: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`
);
