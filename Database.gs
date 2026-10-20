var _cachedSpreadsheet_ = null;

function getSpreadsheet_() {
  if (!_cachedSpreadsheet_) {
    _cachedSpreadsheet_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return _cachedSpreadsheet_;
}



function getSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  return sheet;
}


function normalize_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}


function getRows_(sheetName) {
  const values = getSheet_(sheetName).getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function (h) {
    return String(h).trim();
  });

  return values.slice(1)
    .filter(function (row) {
      return row.some(function (cell) {
        return String(cell).trim() !== '';
      });
    })
    .map(function (row) {
      const item = {};
      headers.forEach(function (header, index) {
        item[header] = row[index] == null ? '' : row[index];
      });
      return item;
    });
}


function findValue_(row, candidates) {
  if (!row) return '';

  const keys = Object.keys(row);
  for (let i = 0; i < candidates.length; i++) {
    const target = normalize_(candidates[i]);
    const key = keys.find(function (k) {
      return normalize_(k) === target;
    });

    if (key !== undefined && String(row[key]).trim() !== '') {
      return row[key];
    }
  }

  return '';
}


function safeSheetValue_(value) {
  const text = String(value == null ? '' : value).trim();

  // Mencegah isi file yang menyerupai rumus diperlakukan sebagai formula.
  return /^[=+@]/.test(text) || /^-[=+@]/.test(text)
    ? "'" + text
    : text;
}

/* =========================
   UBAH STATUS DAFTAR PANGGIL
   ========================= */
