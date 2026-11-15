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
    namalulusan: 'nama_lengkap',
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
    periodewisuda: 'periode_wisuda',

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


/**
 * Menormalisasi nilai jenis kelamin ke format baku ("Laki-laki" atau "Perempuan").
 * Nilai kosong atau tidak dikenali mengembalikan string kosong dan TIDAK pernah ditebak dari nama.
 */
function normalizeImportGender_(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';

  if (text === 'l' || text === 'laki-laki' || text === 'laki - laki' || text === 'pria' || text === 'male') {
    return 'Laki-laki';
  }
  if (text === 'p' || text === 'perempuan' || text === 'wanita' || text === 'female') {
    return 'Perempuan';
  }

  return '';
}


function ensureStudentEmailColumn_() {
  const sheet = getSheet_(CONFIG.SHEETS.STUDENTS);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  const hasEmail = headers.some(function (h) {
    return importFieldKey_(h) === 'email';
  });
  if (!hasEmail) {
    sheet.getRange(1, lastCol + 1).setValue('Email');
  }
}


function assertImportPeriodValidStatus_(periodRow, periodId) {
  const status = normalize_(findValue_(periodRow, ['Status']));
  const blockedStatuses = ['nonaktif', 'inactive', 'ditutup', 'closed', 'arsip', 'archived', 'batal', 'cancelled'];
  if (status && blockedStatuses.indexOf(status) !== -1) {
    throw new Error('Periode "' + periodId + '" berstatus "' + String(findValue_(periodRow, ['Status'])).trim() + '" dan tidak dapat menerima impor.');
  }
}


function resolveImportPeriodContext_(payload) {
  payload = payload || {};
  const mode = payload.mode === 'multi' ? 'multi' : 'single';
  const periodMap = (payload.periodMap && typeof payload.periodMap === 'object') ? payload.periodMap : {};
  const periodCache = {};

  if (mode === 'multi') {
    const mappedKeys = Object.keys(periodMap);
    if (!mappedKeys.length) {
      throw new Error('Pemetaan Periode Wisuda belum ditentukan.');
    }

    const cleanMap = {};
    mappedKeys.forEach(function (label) {
      const targetId = String(periodMap[label] || '').trim();
      if (targetId) {
        const pRow = verifyImportPeriod_(targetId);
        assertImportPeriodValidStatus_(pRow, targetId);
        const pName = String(findValue_(pRow, ['Nama_Periode', 'Nama Periode', 'Nama']) || targetId).trim();
        periodCache[targetId] = { id: targetId, name: pName };
        cleanMap[String(label).trim()] = targetId;
      }
    });

    if (!Object.keys(cleanMap).length) {
      throw new Error('Minimal satu nilai Periode Wisuda harus dipetakan ke ID_Periode tujuan.');
    }

    return {
      mode: 'multi',
      singlePeriodId: '',
      singlePeriodName: 'Multi-Periode',
      periodMap: cleanMap,
      periodCache: periodCache
    };
  }

  const singlePeriodId = String(payload.periodId || '').trim();
  const period = verifyImportPeriod_(singlePeriodId);
  assertImportPeriodValidStatus_(period, singlePeriodId);
  const periodName = String(
    findValue_(period, ['Nama_Periode', 'Nama Periode', 'Nama']) || singlePeriodId
  ).trim();
  periodCache[singlePeriodId] = { id: singlePeriodId, name: periodName };

  return {
    mode: 'single',
    singlePeriodId: singlePeriodId,
    singlePeriodName: periodName,
    periodMap: {},
    periodCache: periodCache
  };
}


function resolveRowTargetPeriodId_(mappedRow, ctx) {
  if (ctx.mode === 'multi') {
    const rawLabel = String(mappedRow.periode_wisuda || '').trim();
    const mappedId = rawLabel ? String(ctx.periodMap[rawLabel] || '').trim() : '';
    return {
      periodId: mappedId,
      rawLabel: rawLabel
    };
  }
  return {
    periodId: ctx.singlePeriodId,
    rawLabel: ''
  };
}


function analyzeStudentImport_(payload) {
  payload = payload || {};

  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];

  if (!sourceRows.length) {
    throw new Error('File tidak berisi baris data.');
  }

  if (sourceRows.length > 10000) {
    throw new Error('Maksimal 10.000 baris per sekali impor. Pisahkan file menjadi beberapa bagian.');
  }

  const ctx = resolveImportPeriodContext_(payload);
  const mappedRows = sourceRows.map(mapImportSourceRow_);
  const firstMapped = mappedRows[0] || {};

  if (!Object.prototype.hasOwnProperty.call(firstMapped, 'nim')) {
    throw new Error('Kolom NIM tidak ditemukan. Pastikan baris pertama file memuat kolom NIM.');
  }

  if (!Object.prototype.hasOwnProperty.call(firstMapped, 'nama_lengkap')) {
    throw new Error('Kolom Nama/Nama_Lengkap/Nama Lulusan tidak ditemukan. Pastikan file memiliki kolom nama wisudawan.');
  }

  if (ctx.mode === 'multi' && !Object.prototype.hasOwnProperty.call(firstMapped, 'periode_wisuda')) {
    throw new Error('Kolom Periode Wisuda tidak ditemukan pada file untuk mode impor multi-periode.');
  }

  const existingKeys = {};
  getRows_(CONFIG.SHEETS.STUDENTS).forEach(function (row) {
    const rowPeriod = String(
      findValue_(row, ['ID_Periode', 'ID Periode'])
    ).trim();

    const nim = normalize_(
      findValue_(row, ['NIM', 'Nomor Induk Mahasiswa'])
    );

    if (rowPeriod && nim) {
      existingKeys[rowPeriod + '|' + nim] = true;
    }
  });

  const seenKeys = {};
  let valid = 0;
  let duplicateExisting = 0;
  let duplicateFile = 0;
  let invalid = 0;
  let genderInvalidCount = 0;
  let unmappedPeriodCount = 0;
  const genderErrors = [];
  const periodBreakdown = {};

  function ensureBreakdownBucket(pId) {
    const key = pId || '__UNMAPPED__';
    if (!periodBreakdown[key]) {
      const info = pId && ctx.periodCache[pId] ? ctx.periodCache[pId] : null;
      periodBreakdown[key] = {
        periodId: pId || '',
        periodName: info ? info.name : 'Belum Dipetakan',
        total: 0,
        importable: 0,
        duplicateExisting: 0,
        duplicateFile: 0,
        invalid: 0
      };
    }
    return periodBreakdown[key];
  }

  const details = mappedRows.map(function (row, index) {
    const nimRaw = String(row.nim || '').trim();
    const name = String(row.nama_lengkap || '').trim();
    const nim = normalize_(nimRaw);
    const rawGender = String(row.jenis_kelamin || '').trim();
    const normalizedGender = normalizeImportGender_(rawGender);
    const resolvedPeriod = resolveRowTargetPeriodId_(row, ctx);
    const targetPeriodId = resolvedPeriod.periodId;
    const key = targetPeriodId + '|' + nim;
    const bucket = ensureBreakdownBucket(targetPeriodId);
    bucket.total++;

    let reason = '';
    let status = 'Siap diimpor';

    if (!targetPeriodId) {
      status = 'Tidak valid';
      reason = resolvedPeriod.rawLabel
        ? 'Periode Wisuda "' + resolvedPeriod.rawLabel + '" belum dipetakan ke ID_Periode'
        : 'Kolom Periode Wisuda kosong';
      invalid++;
      unmappedPeriodCount++;
      bucket.invalid++;
    } else if (!name) {
      status = 'Tidak valid';
      reason = 'Nama kosong';
      invalid++;
      bucket.invalid++;
    } else if (!normalizedGender) {
      status = 'Tidak valid';
      reason = 'Jenis kelamin kosong atau tidak dikenali ("' + (rawGender || 'kosong') + '")';
      invalid++;
      genderInvalidCount++;
      bucket.invalid++;
      genderErrors.push({
        rowNumber: index + 2,
        nim: nimRaw,
        name: name,
        rawGender: rawGender || '(kosong)'
      });
    } else if (nim && seenKeys[key]) {
      status = 'Duplikat dalam file';
      reason = 'NIM yang sama muncul lebih dari sekali untuk periode ini';
      duplicateFile++;
      bucket.duplicateFile++;
    } else if (existingKeys[key]) {
      status = 'Sudah ada';
      reason = 'NIM sudah terdaftar pada periode tujuan (' + (ctx.periodCache[targetPeriodId] ? ctx.periodCache[targetPeriodId].name : targetPeriodId) + ')';
      duplicateExisting++;
      bucket.duplicateExisting++;
    } else {
      valid++;
      bucket.importable++;
    }

    if (targetPeriodId && nim) seenKeys[key] = true;

    return {
      rowNumber: index + 2,
      nim: nimRaw,
      name: name,
      gender: normalizedGender || rawGender,
      faculty: String(row.fakultas || ''),
      program: String(row.program_studi || ''),
      level: inferJenjang_(row.jenjang, row.program_studi),
      email: String(row.email || ''),
      targetPeriodId: targetPeriodId,
      targetPeriodName: (targetPeriodId && ctx.periodCache[targetPeriodId]) ? ctx.periodCache[targetPeriodId].name : (resolvedPeriod.rawLabel || ''),
      status: status,
      reason: reason
    };
  });

  const blockers = [];
  if (unmappedPeriodCount > 0) {
    blockers.push('Terdapat ' + unmappedPeriodCount + ' baris dengan nilai Periode Wisuda kosong atau belum dipetakan ke ID_Periode.');
  }
  if (genderInvalidCount > 0) {
    blockers.push('Terdapat ' + genderInvalidCount + ' baris dengan jenis kelamin kosong atau tidak dikenali (BLOCKER). Perbaiki data gender menjadi L/P/Laki-laki/Perempuan sebelum mengimpor.');
  }

  return {
    mode: ctx.mode,
    periodId: ctx.singlePeriodId,
    periodName: ctx.singlePeriodName,
    total: sourceRows.length,
    importable: valid,
    duplicateExisting: duplicateExisting,
    duplicateFile: duplicateFile,
    invalid: invalid,
    genderInvalidCount: genderInvalidCount,
    unmappedPeriodCount: unmappedPeriodCount,
    hasBlockers: blockers.length > 0,
    blockers: blockers,
    genderErrors: genderErrors.slice(0, 50),
    periodBreakdown: Object.keys(periodBreakdown).map(function (k) { return periodBreakdown[k]; }),
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
  const ctx = resolveImportPeriodContext_(payload);
  const sourceRows = payload.rows;

  if (analysis.hasBlockers) {
    return {
      success: false,
      imported: 0,
      skipped: analysis.duplicateExisting + analysis.duplicateFile,
      failed: analysis.invalid,
      writtenBreakdown: {},
      blockers: analysis.blockers,
      message: 'Impor diblokir: ' + analysis.blockers.join(' ')
    };
  }

  if (analysis.importable < 1) {
    return {
      success: false,
      imported: 0,
      skipped: analysis.duplicateExisting + analysis.duplicateFile,
      failed: analysis.invalid,
      writtenBreakdown: {},
      message: 'Tidak ada baris valid untuk diimpor. Periksa duplikat dan data wajib.'
    };
  }

  ensureStudentNimStatusColumn_();
  ensureStudentEmailColumn_();
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
    if (rowPeriod && nim) existingKeys[rowPeriod + '|' + nim] = true;
  });

  const seen = {};
  const rowsToWrite = [];
  let skipped = 0;

  sourceRows.forEach(function (sourceRow) {
    const mapped = mapImportSourceRow_(sourceRow);
    const resolvedPeriod = resolveRowTargetPeriodId_(mapped, ctx);
    const targetPeriodId = resolvedPeriod.periodId;
    let nim = normalize_(mapped.nim);
    const name = String(mapped.nama_lengkap || '').trim();
    const normalizedGender = normalizeImportGender_(mapped.jenis_kelamin);

    if (!targetPeriodId || !name || !normalizedGender) {
      skipped++;
      return;
    }

    const isDummy = !nim;
    if (isDummy) nim = generateDummyNim_(usedNims);
    const key = targetPeriodId + '|' + nim;

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
      if (field === 'id_periode') return targetPeriodId;
      if (field === 'status_data') return mapped.status_data || 'Aktif';
      if (field === 'nim') return nim;
      if (field === 'status_nim') return isDummy ? 'Dummy' : 'Asli';
      if (field === 'jenis_kelamin') return normalizedGender;
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
      failed: analysis.invalid,
      writtenBreakdown: {},
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

      if (rowPeriod && nimValue) {
        nowKeys[rowPeriod + '|' + nimValue] = true;
      }
    });

    const writtenBreakdown = {};
    const finalRows = rowsToWrite.filter(function (row) {
      const obj = {};

      headers.forEach(function (header, i) {
        obj[importFieldKey_(header)] = row[i];
      });

      const rowPeriodId = String(obj.id_periode || '').trim();
      const key = rowPeriodId + '|' + normalize_(obj.nim);

      if (!rowPeriodId || nowKeys[key]) {
        skipped++;
        return false;
      }

      nowKeys[key] = true;
      writtenBreakdown[rowPeriodId] = (writtenBreakdown[rowPeriodId] || 0) + 1;
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

    const periodSummaryText = Object.keys(writtenBreakdown).map(function (pId) {
      const pName = (ctx.periodCache[pId] && ctx.periodCache[pId].name) || pId;
      return pName + ': ' + writtenBreakdown[pId];
    }).join(', ');

    logActivity_(
      session.email,
      'IMPORT DATA WISUDAWAN',
      'DATA WISUDAWAN',
      (ctx.mode === 'multi' ? 'Multi-Periode (' + periodSummaryText + ')' : 'Periode ' + ctx.singlePeriodId) +
        '; berhasil ' + finalRows.length +
        '; dilewati ' + skipped
    );

    return {
      success: finalRows.length > 0,
      mode: ctx.mode,
      imported: finalRows.length,
      skipped: skipped,
      failed: analysis.invalid,
      periodId: ctx.singlePeriodId,
      periodName: ctx.singlePeriodName,
      writtenBreakdown: writtenBreakdown,
      message: finalRows.length + ' data berhasil diimpor' +
        (ctx.mode === 'multi' ? ' (' + periodSummaryText + ')' : ' ke ' + ctx.singlePeriodName) +
        '. ' + skipped + ' baris dilewati karena duplikat atau data wajib kosong.'
    };
  } finally {
    lock.releaseLock();
  }
}
