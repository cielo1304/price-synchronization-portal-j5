const XLSX = require('/tmp/xlsx-parse/node_modules/xlsx');
const wb = XLSX.readFile('/tmp/sheet.xlsx', { cellFormula: true });

function findInSheet(sheetName, columnLetter, predicate, maxCol = 22) {
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const matches = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const addr = `${columnLetter}${r + 1}`;
    const cell = ws[addr];
    const v = cell ? String(cell.v || '') : '';
    if (predicate(v)) {
      const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V'];
      const row = {};
      for (let i = 0; i < maxCol; i++) {
        const a = `${cols[i]}${r + 1}`;
        const c = ws[a];
        if (c) row[cols[i]] = { v: c.v, f: c.f };
      }
      matches.push({ row: r + 1, data: row });
    }
  }
  return matches;
}

console.log('\n=== БД_ЗАПЧАСТИ: iPhone 16 (без Pro/Plus/Max) Дисплей ===');
const parts = findInSheet('БД_ЗАПЧАСТИ', 'B', v => /iPhone 16(\s|$|\D)/i.test(v) && !/Pro|Plus|Max/i.test(v) && /дисплей|display/i.test(v));
for (const m of parts.slice(0, 15)) {
  console.log(`Row ${m.row}: B="${m.data.B?.v}" E="${m.data.E?.v}" I=${m.data.I?.v} L=${m.data.L?.v} M=${m.data.M?.v} N=${m.data.N?.v} O=${m.data.O?.v} P=${m.data.P?.v} Q=${m.data.Q?.v}`);
  if (m.data.O?.f) console.log('   O.formula=', m.data.O.f.slice(0,120));
  if (m.data.P?.f) console.log('   P.formula=', m.data.P.f.slice(0,120));
}

console.log('\n=== ПРАЙС_ЛИСТ: iPhone 16 Дисплей ===');
const prc = findInSheet('ПРАЙС_ЛИСТ', 'E', v => /iPhone 16(\s|$|\D)/i.test(v) && !/Pro|Plus|Max/i.test(v) && /дисплей/i.test(v), 14);
for (const m of prc.slice(0, 10)) {
  console.log(`Row ${m.row}: B="${m.data.B?.v}" C="${m.data.C?.v}" D=${m.data.D?.v} E="${String(m.data.E?.v).slice(0,80)}" F=${m.data.F?.v} G=${m.data.G?.v}`);
  if (m.data.F?.f) console.log('   F.formula=', m.data.F.f.slice(0,140));
}

console.log('\n=== БД_МОЙ СКЛАД: iPhone 16 Дисплей ===');
const ms = findInSheet('БД_МОЙ СКЛАД', 'B', v => /iPhone 16(\s|$|\D)/i.test(v) && !/Pro|Plus|Max/i.test(v), 14);
for (const m of ms.slice(0, 10)) {
  console.log(`Row ${m.row}: B="${m.data.B?.v}" C="${m.data.C?.v}" D=${m.data.D?.v} E="${String(m.data.E?.v).slice(0,80)}" F=${m.data.F?.v} G=${m.data.G?.v} H=${m.data.H?.v}`);
  if (m.data.D?.f) console.log('   D.formula=', m.data.D.f.slice(0,140));
}

console.log('\n=== БД_УСЛУГИ_РО: ВСЕ работы по iPhone 16 (i16-) ===');
const ro = findInSheet('БД_УСЛУГИ_РО', 'C', v => /^i16-/.test(v), 18);
for (const m of ro.slice(0, 25)) {
  console.log(`Row ${m.row}: C="${m.data.C?.v}" D="${m.data.D?.v}" E="${String(m.data.E?.v).slice(0,70)}" P=${m.data.P?.v}`);
  if (m.data.P?.f) console.log('   P.formula=', m.data.P.f.slice(0,140));
}
