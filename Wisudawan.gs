function searchStudents(query, filters) {
  requireRole_(['Admin']);
  const q = normalize_(query || '');
  filters = filters || {};
  const students = getRows_(CONFIG.SHEETS.STUDENTS);
  return students.filter(function (row) {
    const nim = String(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']) || '');
    const statusNim = String(findValue_(row, ['Status_NIM', 'Status NIM']) || '');
    const isDummy = normalize_(statusNim) === 'dummy';
    const checks = [
      !q || Object.keys(row).some(function (key) { return normalize_(row[key]).includes(q); }),
      !filters.period || normalize_(findValue_(row, ['ID_Periode','ID Periode'])) === normalize_(filters.period),
      !filters.faculty || normalizeFacultyKey_(findValue_(row, ['Fakultas'])) === normalizeFacultyKey_(filters.faculty),
      !filters.program || normalize_(findValue_(row, ['Program_Studi','Program Studi'])) === normalize_(filters.program),
      !filters.level || normalize_(findValue_(row, ['Jenjang'])) === normalize_(filters.level),
      !filters.gender || normalizeGender_(findValue_(row, ['Jenis_Kelamin','Jenis Kelamin'])) === normalizeGender_(filters.gender),
      !filters.predicate || normalize_(findValue_(row, ['Predikat'])) === normalize_(filters.predicate),
      !filters.nimStatus || (filters.nimStatus === 'dummy' && isDummy) || (filters.nimStatus === 'asli' && !isDummy)
    ];
    return checks.every(Boolean);
  });
}

function normalizeFacultyKey_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[`’'‘‛]/g, "'")
    .replace(/\\'/g, "'")
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(/\s+/g, ' ');
}


function normalizeGender_(value) {
  if (!value) return '';
  const text = String(value).trim();

  // Hanya mengenali variasi ejaan resmi dari Laki-laki dan Perempuan
  if (/^laki[\s\-]*laki$/i.test(text)) {
    return 'Laki-laki';
  }
  if (/^perempuan$/i.test(text)) {
    return 'Perempuan';
  }

  // Nilai lain (termasuk nilai anomali berawalan huruf seperti ALaki-laki atau huruf tunggal) tidak dikenali
  return '';
}


function generateDummyNim_(usedNims) {
  usedNims = usedNims || {};
  for (let i = 1; i <= 9999999; i++) {
    const nim = '99' + String(i).padStart(7, '0');
    if (!usedNims[nim]) { usedNims[nim] = true; return nim; }
  }
  throw new Error('Rentang NIM dummy habis. Tentukan rentang baru.');
}


function inferJenjang_(jenjang, programStudi) {
  if (String(jenjang || '').trim()) return String(jenjang).trim().toUpperCase();
  const text = String(programStudi || '').trim();
  const match = text.match(/(?:^|\b)(D3|D4|S1|S2|S3)(?:\b|\s*[-–])/i);
  return match ? match[1].toUpperCase() : '';
}


function ensureStudentNimStatusColumn_() {
  const sheet = getSheet_(CONFIG.SHEETS.STUDENTS);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol ? sheet.getRange(1,1,1,lastCol).getDisplayValues()[0] : [];
  if (!headers.some(function(h){ return normalize_(h).replace(/[^a-z0-9]/g,'') === 'statusnim'; })) {
    sheet.getRange(1, lastCol + 1).setValue('Status_NIM');
  }
}
