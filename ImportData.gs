function getStudentImportSetup() {
  requireRole_(['Admin']);

  const periodRows = getRows_(CONFIG.SHEETS.PERIOD);
  const periods = periodRows.map(function (row) {
    return {
      id: String(findValue_(row, ['ID_Periode', 'ID Periode'])).trim(),
      name: String(findValue_(row, ['Nama_Periode', 'Nama Periode', 'Nama'])).trim(),
      year: String(findValue_(row, ['Tahun'])).trim(),
      wave: String(findValue_(row, ['Gelombang', 'Gelombang_Wisuda'])).trim(),
      date: String(findValue_(row, ['Tanggal_Pelaksanaan', 'Tanggal Pelaksanaan'])).trim(),
      location: String(findValue_(row, ['Lokasi'])).trim(),
      status: String(findValue_(row, ['Status'])).trim()
    };
  }).filter(function (period) {
    return period.id;
  });

  const studentSheet = getSheet_(CONFIG.SHEETS.STUDENTS);
  const lastColumn = studentSheet.getLastColumn();

  return {
    periods: periods,
    studentHeaders: lastColumn > 0
      ? studentSheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
      : [],
    totalStudents: Math.max(0, studentSheet.getLastRow() - 1)
  };
}

/**
 * Menyamakan variasi nama header Excel dan Google Sheets.
 * Header yang belum dikenal tetap dinormalisasi sehingga kolom dengan
 * nama yang sama di sumber dan spreadsheet masih dapat dipetakan.
 */


function importFieldKey_(header) {
  const compact = normalize_(header).replace(/[^a-z0-9]/g, '');

  const aliases = {
    idwisudawan: 'id_wisudawan',
    idmahasiswa: 'id_wisudawan',
    studentrecordid: 'id_wisudawan',

    nim: 'nim',
    nimmahasiswa: 'nim',
    nomorindukmahasiswa: 'nim',
    noindukmahasiswa: 'nim',
    studentnumber: 'nim',
    studentidnumber: 'nim',

    namalengkap: 'nama_lengkap',
    nama: 'nama_lengkap',
    namamahasiswa: 'nama_lengkap',
    namawisudawan: 'nama_lengkap',
    fullname: 'nama_lengkap',
    name: 'nama_lengkap',

    jeniskelamin: 'jenis_kelamin',
    jk: 'jenis_kelamin',
    gender: 'jenis_kelamin',
    sex: 'jenis_kelamin',

    fakultas: 'fakultas',
    faculty: 'fakultas',
    fakultasunit: 'fakultas',
    unit: 'fakultas',

    programstudi: 'program_studi',
    prodi: 'program_studi',
    jurusan: 'program_studi',
    studyprogram: 'program_studi',
    academicprogram: 'program_studi',

    jenjang: 'jenjang',
    jenjangpendidikan: 'jenjang',
    programpendidikan: 'jenjang',
    degree: 'jenjang',
    level: 'jenjang',

    predikat: 'predikat',
    predikatkelulusan: 'predikat',
    yudisium: 'predikat',
    honors: 'predikat',

    idperiode: 'id_periode',
    periodeid: 'id_periode',

    statusdata: 'status_data',
    statuswisudawan: 'status_data',
    statusnim: 'status_nim',
    nimstatus: 'status_nim',

    namaperiode: 'nama_periode',
    periodname: 'nama_periode',

    tahun: 'tahun',
    year: 'tahun',

    gelombang: 'gelombang',
    gelombangwisuda: 'gelombang',
    wave: 'gelombang',
    batch: 'gelombang',

    tanggalpelaksanaan: 'tanggal_pelaksanaan',
    tanggalwisuda: 'tanggal_pelaksanaan',
    eventdate: 'tanggal_pelaksanaan',

    lokasi: 'lokasi',
    location: 'lokasi',
    status: 'status',

    tempatlahir: 'tempat_lahir',
    tanggallahir: 'tanggal_lahir',
    email: 'email'
  };

  if (aliases[compact]) return aliases[compact];

  return compact;
}


function mapImportSourceRow_(sourceRow) {
  const mapped = {};

  Object.keys(sourceRow || {}).forEach(function (header) {
    const key = importFieldKey_(header);
    const value = sourceRow[header];

    mapped[key] = value == null ? '' : String(value).trim();
  });

  return mapped;
}


function analyzeStudentImport_(payload) {
  payload = payload || {};

  const periodId = String(payload.periodId || '').trim();
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];

  if (!sourceRows.length) {
    throw new Error('File tidak berisi baris data.');
  }

  if (sourceRows.length > 10000) {
    throw new Error('Maksimal 10.000 baris per sekali impor. Pisahkan file menjadi beberapa bagian.');
  }

  const period = verifyImportPeriod_(periodId);
  const periodName = String(
    findValue_(period, ['Nama_Periode', 'Nama Periode', 'Nama']) || periodId
  );

  const mappedRows = sourceRows.map(mapImportSourceRow_);
  const firstMapped = mappedRows[0] || {};

  if (!Object.prototype.hasOwnProperty.call(firstMapped, 'nim')) {
    throw new Error('Kolom NIM tidak ditemukan. Pastikan baris pertama file memuat kolom NIM.');
  }

  if (!Object.prototype.hasOwnProperty.call(firstMapped, 'nama_lengkap')) {
    throw new Error('Kolom Nama/Nama_Lengkap tidak ditemukan. Pastikan file memiliki kolom nama wisudawan.');
  }

  const existingKeys = {};
  const usedNims = {};

  getRows_(CONFIG.SHEETS.STUDENTS).forEach(function (row) {
    const rowPeriod = String(
      findValue_(row, ['ID_Periode', 'ID Periode'])
    ).trim();

    const nim = normalize_(
      findValue_(row, ['NIM', 'Nomor Induk Mahasiswa'])
    );

    if (rowPeriod === periodId && nim) {
      existingKeys[periodId + '|' + nim] = true;
    }
  });

  const seenKeys = {};
  let valid = 0;
  let duplicateExisting = 0;
  let duplicateFile = 0;
  let invalid = 0;

  const details = mappedRows.map(function (row, index) {
    const nimRaw = String(row.nim || '').trim();
    const name = String(row.nama_lengkap || '').trim();
    const nim = normalize_(nimRaw);
    const key = periodId + '|' + nim;

    let reason = '';
    let status = 'Siap diimpor';

    if (!name) {
      status = 'Tidak valid';
      reason = 'Nama kosong';
      invalid++;
    } else if (nim && seenKeys[key]) {
      status = 'Duplikat dalam file';
      reason = 'NIM yang sama muncul lebih dari sekali untuk periode ini';
      duplicateFile++;
    } else if (existingKeys[key]) {
      status = 'Sudah ada';
      reason = 'NIM sudah terdaftar pada periode yang dipilih';
      duplicateExisting++;
    } else {
      valid++;
    }

    if (nim) seenKeys[key] = true;

    return {
      rowNumber: index + 2,
      nim: nimRaw,
      name: name,
      faculty: String(row.fakultas || ''),
      program: String(row.program_studi || ''),
      level: inferJenjang_(row.jenjang, row.program_studi),
      status: status,
      reason: reason
    };
  });

  return {
    periodId: periodId,
    periodName: periodName,
    total: sourceRows.length,
    importable: valid,
    duplicateExisting: duplicateExisting,
    duplicateFile: duplicateFile,
    invalid: invalid,
    sample: details.slice(0, 30)
  };
}


function previewStudentImport(payload) {
  requireRole_(['Admin']);
  return analyzeStudentImport_(payload);
}


function importStudentRows(payload) {
  const session = requireRole_(['Admin']);
  const analysis = analyzeStudentImport_(payload);
  const periodId = analysis.periodId;
  const sourceRows = payload.rows;

  if (analysis.importable < 1) {
    return {
      success: false,
      imported: 0,
      skipped: analysis.total,
      message: 'Tidak ada baris valid untuk diimpor. Periksa duplikat dan data wajib.'
    };
  }

  ensureStudentNimStatusColumn_();
  const sheet = getSheet_(CONFIG.SHEETS.STUDENTS);
  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    throw new Error('Sheet DATA_WISUDAWAN belum memiliki header kolom.');
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function (h) {
      return String(h).trim();
    });

  const existingKeys = {};
  const usedNims = {};

  getRows_(CONFIG.SHEETS.STUDENTS).forEach(function (row) {
    const rowPeriod = String(findValue_(row, ['ID_Periode', 'ID Periode']) || '').trim();
    const nim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    if (nim) usedNims[nim] = true;
    if (rowPeriod === periodId && nim) existingKeys[periodId + '|' + nim] = true;
  });

  const seen = {};
  const rowsToWrite = [];
  let skipped = 0;

  sourceRows.forEach(function (sourceRow) {
    const mapped = mapImportSourceRow_(sourceRow);
    let nim = normalize_(mapped.nim);
    const name = String(mapped.nama_lengkap || '').trim();
    if (!name) { skipped++; return; }
    const isDummy = !nim;
    if (isDummy) nim = generateDummyNim_(usedNims);
    const key = periodId + '|' + nim;

    if (existingKeys[key] || seen[key]) {
      skipped++;
      return;
    }

    seen[key] = true;

    const newId = String(mapped.id_wisudawan || '').trim() ||
      'WSD-' + Utilities.getUuid().slice(0, 8).toUpperCase();

    const rowValues = headers.map(function (header) {
      const field = importFieldKey_(header);

      if (field === 'id_wisudawan') return newId;
      if (field === 'id_periode') return periodId;
      if (field === 'status_data') return mapped.status_data || 'Aktif';
      if (field === 'nim') return nim;
      if (field === 'status_nim') return isDummy ? 'Dummy' : 'Asli';
      if (field === 'jenjang') return inferJenjang_(mapped.jenjang, mapped.program_studi);

      return mapped[field] == null ? '' : safeSheetValue_(mapped[field]);
    });

    rowsToWrite.push(rowValues);
    existingKeys[key] = true;
  });

  if (!rowsToWrite.length) {
    return {
      success: false,
      imported: 0,
      skipped: skipped,
      message: 'Tidak ada data baru yang perlu disimpan; semua baris tidak valid atau sudah ada.'
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    // Memeriksa ulang data terbaru sebelum penulisan untuk mengurangi risiko duplikat.
    const rowsNow = getRows_(CONFIG.SHEETS.STUDENTS);
    const nowKeys = {};

    rowsNow.forEach(function (row) {
      const rowPeriod = String(
        findValue_(row, ['ID_Periode', 'ID Periode'])
      ).trim();

      const nimValue = normalize_(
        findValue_(row, ['NIM', 'Nomor Induk Mahasiswa'])
      );

      if (rowPeriod === periodId && nimValue) {
        nowKeys[periodId + '|' + nimValue] = true;
      }
    });

    const finalRows = rowsToWrite.filter(function (row) {
      const obj = {};

      headers.forEach(function (header, i) {
        obj[importFieldKey_(header)] = row[i];
      });

      const key = periodId + '|' + normalize_(obj.nim);

      if (nowKeys[key]) {
        skipped++;
        return false;
      }

      nowKeys[key] = true;
      return true;
    });

    if (finalRows.length) {
      const startRow = sheet.getLastRow() + 1;

      sheet.getRange(
        startRow,
        1,
        finalRows.length,
        headers.length
      ).setValues(finalRows);

      SpreadsheetApp.flush();
    }

    logActivity_(
      session.email,
      'IMPORT DATA WISUDAWAN',
      'DATA WISUDAWAN',
      'Periode ' + periodId +
        '; berhasil ' + finalRows.length +
        '; dilewati ' + skipped
    );

    return {
      success: finalRows.length > 0,
      imported: finalRows.length,
      skipped: skipped,
      periodId: periodId,
      periodName: analysis.periodName,
      message: finalRows.length + ' data berhasil diimpor ke ' +
        analysis.periodName + '. ' + skipped +
        ' baris dilewati karena duplikat atau data wajib kosong.'
    };
  } finally {
    lock.releaseLock();
  }
}
