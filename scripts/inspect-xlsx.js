const XLSX = require('/tmp/xlsx-parse/node_modules/xlsx');
const wb = XLSX.readFile('/tmp/sheet.xlsx', { cellFormula: true, cellNF: true });

function printRow(ws, rowNum, maxCol = 20) {
  const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
  const out = [];
  for (let i = 0; i < maxCol; i++) {
    const addr = `${cols[i]}${rowNum}`;
    const cell = ws[addr];
    if (!cell) continue;
    const val = cell.v !== undefined ? cell.v : '';
    const formula = cell.f ? `=${cell.f}` : '';
    out.push(`${addr}: ${JSON.stringify(val).slice(0,80)}${formula ? ' [' + formula.slice(0,80) + ']' : ''}`);
  }
  return out.join('\n  ');
}

function printSheet(name, rows, maxCol = 20) {
  const ws = wb.Sheets[name];
  console.log(`\n========== ${name} ==========`);
  for (const r of rows) {
    console.log(`Row ${r}:`);
    console.log('  ' + printRow(ws, r, maxCol));
  }
}

// Заголовки и первые несколько строк каждой таблицы
printSheet('ПРАЙС_ЛИСТ', [1, 2, 3, 4, 5], 14);
printSheet('БД_УСЛУГИ_РО', [1, 2, 3, 916, 917], 18);
printSheet('БД_ЗАПЧАСТИ', [1, 2, 3, 4], 30);
printSheet('БД_МОЙ СКЛАД', [1, 2, 3, 4], 14);
printSheet('МАТРИЦА_СТОИМОСТИ_РАБОТ', [1, 2, 3, 4, 5, 6], 24);
printSheet('НАИМЕНОВАНИЯ', [1, 2, 3, 4, 5], 30);
