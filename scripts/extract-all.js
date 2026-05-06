/* eslint-disable */
// Главный экстрактор всех iPhone-позиций.
//   ПРАЙС_ЛИСТ → главная таблица (B=модель, C=код, D=гарантия, E=услуга, F=цена, G=диапазон)
//   БД_УСЛУГИ_РО → цена работы (B=модель, E=услуга, I=гарантия, K=длительность, P=стоимость)
//   БД_ЗАПЧАСТИ → запчасть (B=наименование, E=модель, F=категория, I=iCom, L=MOS, M=макс,
//                            N=наценка, P=прайс, Q=ремонлайн, C=ID, D=гарантия)
//   БД_МОЙ СКЛАД → выгрузка (B=модель, C=код, D=цена, F=время, H=гарантия, I=ссылка, J=описание)

const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");

const wb = xlsx.readFile(path.join(__dirname, "..", ".data", "sheet.xlsx"));

const v = (ws, addr) => {
  const c = ws[addr];
  return c == null ? undefined : c.v;
};
const num = (x) =>
  x === undefined || x === "" || x === null ? undefined : Number(x);
const str = (x) =>
  x === undefined || x === null ? "" : String(x).trim();

// ── 1. БД_УСЛУГИ_РО → key "model::service" → labor
const labors = new Map();
{
  const ws = wb.Sheets["БД_УСЛУГИ_РО"];
  const ref = xlsx.utils.decode_range(ws["!ref"]);
  for (let r = 3; r <= ref.e.r + 1; r++) {
    const model = str(v(ws, "B" + r));
    const name = str(v(ws, "E" + r));
    const price = num(v(ws, "P" + r));
    if (!name || price === undefined) continue;
    const key = `${model}::${name}`.toLowerCase();
    if (!labors.has(key)) {
      labors.set(key, {
        model,
        name,
        price,
        warranty: num(v(ws, "I" + r)),
        duration: str(v(ws, "K" + r)),
        row: r,
      });
    }
  }
}

// ── 2. БД_ЗАПЧАСТИ → массив записей
const parts = [];
{
  const ws = wb.Sheets["БД_ЗАПЧАСТИ"];
  const ref = xlsx.utils.decode_range(ws["!ref"]);
  for (let r = 5; r <= ref.e.r + 1; r++) {
    const name = str(v(ws, "B" + r));
    if (!name) continue;
    parts.push({
      row: r,
      name,
      partId: str(v(ws, "C" + r)),
      partWarranty: num(v(ws, "D" + r)),
      model: str(v(ws, "E" + r)),
      category: str(v(ws, "F" + r)),
      iCom: num(v(ws, "I" + r)),
      mos: num(v(ws, "L" + r)),
      purchase: num(v(ws, "M" + r)),
      markupPct:
        num(v(ws, "N" + r)) !== undefined
          ? Math.round(num(v(ws, "N" + r)) * 1000) / 10
          : undefined,
      retail: num(v(ws, "P" + r)),
      remonlineRetail: num(v(ws, "Q" + r)),
    });
  }
}

// ── 3. БД_МОЙ СКЛАД → индекс по коду
const myskladByCode = new Map();
{
  const ws = wb.Sheets["БД_МОЙ СКЛАД"];
  const ref = xlsx.utils.decode_range(ws["!ref"]);
  for (let r = 3; r <= ref.e.r + 1; r++) {
    const code = v(ws, "C" + r);
    if (code === undefined || code === "") continue;
    myskladByCode.set(str(code), {
      row: r,
      model: str(v(ws, "B" + r)),
      price: num(v(ws, "D" + r)),
      service: str(v(ws, "E" + r)),
      time: str(v(ws, "F" + r)),
      priceFrom: v(ws, "G" + r),
      warranty: str(v(ws, "H" + r)),
      url: str(v(ws, "I" + r)),
      description: str(v(ws, "J" + r)),
    });
  }
}

// ── 4. РЕМОНТ_ЯБЛОК (конкурент)
const competitor = new Map();
{
  const ws = wb.Sheets["РЕМОНТ_ЯБЛОК"];
  if (ws) {
    const ref = xlsx.utils.decode_range(ws["!ref"]);
    // Сканируем все колонки чтобы найти ту, где код, и ту, где цена
    for (let r = 3; r <= ref.e.r + 1; r++) {
      // ищем код в колонках B,C,D и цену в E,F,G,H
      for (const cc of ["B", "C", "D"]) {
        const code = v(ws, cc + r);
        if (!code) continue;
        for (const pc of ["E", "F", "G", "H"]) {
          const p = num(v(ws, pc + r));
          if (p && p > 100) {
            competitor.set(str(code), p);
            break;
          }
        }
      }
    }
  }
}

// ── Категория из услуги
function guessCategory(service) {
  const s = service.toLowerCase();
  if (/диспле/.test(s)) return ["Дисплей"];
  if (/аккумул|батаре/.test(s)) return ["Аккумулятор"];
  if (/стекл.*задн|задн.*стекл/.test(s)) return ["Заднее стекло"];
  if (/стекл.*перед|перед.*стекл|переклей/.test(s)) return ["Стекло (переклей)"];
  if (/фронт.*камер|камер.*фронт|селфи/.test(s)) return ["Фронтальная камера"];
  if (/основ.*камер|камер|объектив/.test(s)) return ["Основная камера"];
  if (/разъ[её]м.*заряд|нижн.*шлейф|зарядк.*разъ/.test(s)) return ["Разъём зарядки"];
  if (/корпус/.test(s)) return ["Корпус"];
  if (/динамик/.test(s)) return ["Динамик"];
  if (/микрофон/.test(s)) return ["Микрофон"];
  if (/face.?id|фейс.?ид|true.?depth/.test(s)) return ["Face ID", "TrueDepth"];
  if (/touch.?id|тач.?ид/.test(s)) return ["Touch ID"];
  if (/кнопк.*home|кнопк.*домой/.test(s)) return ["Кнопка Home"];
  if (/кнопк.*power|кнопк.*вкл|шлейф.*power/.test(s)) return ["Кнопка Power"];
  if (/кнопк.*громк/.test(s)) return ["Кнопка громкости"];
  if (/виброзвонок|тапт/.test(s)) return ["Виброзвонок", "Taptic"];
  if (/слот.*sim|sim.*лоток/.test(s)) return ["SIM"];
  return null;
}

function findPart(model, service) {
  const cats = guessCategory(service);
  if (!cats) return null;
  // Жёсткое сопоставление: модель совпадает + категория из списка
  const candidates = parts.filter(
    (p) =>
      p.model.toLowerCase() === model.toLowerCase() &&
      cats.some((cat) => p.category.toLowerCase() === cat.toLowerCase())
  );
  if (candidates.length === 0) return null;
  // Выбираем первый с реальной закупкой
  const withPrice = candidates.find((p) => p.purchase || p.retail);
  return withPrice || candidates[0];
}

// ── 5. ПРАЙС_ЛИСТ → главная итерация
const positions = [];
const ws = wb.Sheets["ПРАЙС_ЛИСТ"];
const ref = xlsx.utils.decode_range(ws["!ref"]);
let lastModel = "";
for (let r = 3; r <= ref.e.r + 1; r++) {
  const modelCell = str(v(ws, "B" + r));
  if (modelCell) lastModel = modelCell;
  const code = v(ws, "C" + r);
  const service = str(v(ws, "E" + r));
  if (!code) continue;
  const codeStr = str(code);
  // Только iPhone-коды: i<число>...
  if (!/^i\d/i.test(codeStr)) continue;
  if (!service) continue;
  if (!/^iphone/i.test(lastModel)) continue;

  const retailPrice = num(v(ws, "F" + r));
  const range = str(v(ws, "G" + r));
  const warrantyDays = num(v(ws, "D" + r));

  // 1) labor по точному ключу
  let labor = labors.get(`${lastModel}::${service}`.toLowerCase());
  // 1b) фуззи: тот же model + первое слово услуги
  if (!labor) {
    const firstWord = service.split(/[\s,—-]/)[0].toLowerCase();
    for (const l of labors.values()) {
      if (
        l.model.toLowerCase() === lastModel.toLowerCase() &&
        l.name.toLowerCase().startsWith(firstWord) &&
        firstWord.length >= 4
      ) {
        labor = l;
        break;
      }
    }
  }

  const part = findPart(lastModel, service);
  const mysklad = myskladByCode.get(codeStr);

  positions.push({
    code: codeStr,
    model: lastModel,
    service,
    retailPrice,
    range: range || undefined,
    warrantyDays,
    labor: labor
      ? {
          price: labor.price,
          duration: labor.duration || undefined,
          sheetRef: `БД_УСЛУГИ_РО!P${labor.row}`,
        }
      : undefined,
    part: part
      ? {
          name: part.name,
          partId: part.partId || undefined,
          partWarranty: part.partWarranty,
          category: part.category,
          iCom: part.iCom,
          mos: part.mos,
          purchase: part.purchase,
          markupPct: part.markupPct,
          retail: part.retail,
          remonlineRetail: part.remonlineRetail,
          sheetRef: `БД_ЗАПЧАСТИ!P${part.row}`,
        }
      : undefined,
    mysklad: mysklad
      ? {
          url: mysklad.url || undefined,
          time: mysklad.time || undefined,
          warranty: mysklad.warranty || undefined,
          description: mysklad.description || undefined,
          priceFrom: mysklad.priceFrom,
          sheetRef: `БД_МОЙ СКЛАД!D${mysklad.row}`,
        }
      : undefined,
    competitorPrice: competitor.get(codeStr),
  });
}

// ── Группировка для отчёта
const byModel = new Map();
positions.forEach((p) => {
  if (!byModel.has(p.model)) byModel.set(p.model, []);
  byModel.get(p.model).push(p);
});

console.log(`Всего позиций: ${positions.length}`);
console.log(`Моделей: ${byModel.size}`);
console.log("");
[...byModel.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 12)
  .forEach(([m, items]) => {
    const wL = items.filter((x) => x.labor).length;
    const wP = items.filter((x) => x.part).length;
    const wM = items.filter((x) => x.mysklad).length;
    console.log(
      `${m.padEnd(28)} ${String(items.length).padStart(3)}  · работа ${String(wL).padStart(3)}  запчасть ${String(wP).padStart(3)}  МС ${String(wM).padStart(3)}`
    );
  });

const withLabor = positions.filter((p) => p.labor).length;
const withPart = positions.filter((p) => p.part).length;
const withMysklad = positions.filter((p) => p.mysklad).length;
console.log(`\n[итого]   работа ${withLabor}   запчасть ${withPart}   МС ${withMysklad}`);

const outPath = path.join(__dirname, "..", "lib", "portal-positions.json");
fs.writeFileSync(outPath, JSON.stringify(positions, null, 2), "utf8");
console.log(`\nСохранено: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
