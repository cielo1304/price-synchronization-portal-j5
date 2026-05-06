const xlsx = require("xlsx");
const wb = xlsx.readFile("/vercel/share/v0-project/.data/sheet.xlsx", { cellFormula: true });

function dumpHeaders(name, headerRow = 1, rows = 5) {
  const ws = wb.Sheets[name];
  if (!ws) return console.log("NO SHEET", name);
  const range = xlsx.utils.decode_range(ws["!ref"]);
  console.log(`\n=== ${name} (${range.e.r + 1} rows, ${range.e.c + 1} cols) ===`);
  // Заголовки могут быть в первой строке. Дампим первые N строк.
  for (let r = 0; r < Math.min(rows, range.e.r + 1); r++) {
    const cells = [];
    for (let c = 0; c <= Math.min(range.e.c, 25); c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const v = cell ? cell.v : "";
      const colLetter = xlsx.utils.encode_col(c);
      cells.push(`${colLetter}=${String(v).slice(0, 30)}`);
    }
    console.log(`row ${r + 1}: ${cells.join(" | ")}`);
  }
}

dumpHeaders("БД_УСЛУГИ_РО", 1, 6);
dumpHeaders("БД_ЗАПЧАСТИ", 1, 6);
dumpHeaders("ПРАЙС_ЛИСТ", 1, 8);
dumpHeaders("БД_МОЙ СКЛАД", 1, 6);
