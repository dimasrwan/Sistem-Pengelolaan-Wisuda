function getActivePeriod_() {
  try {
    const periods = getRows_(CONFIG.SHEETS.PERIOD);
    if (!periods.length) return null;

    const active = periods.find(function (row) {
      return ['aktif', 'active', 'berlangsung'].includes(
        normalize_(findValue_(row, ['Status']))
      );
    });

    const period = active || periods[0];

    return {
      id: String(findValue_(period, ['ID_Periode', 'ID Periode']) || ''),
      name: String(findValue_(period, ['Nama_Periode', 'Nama Periode']) || 'Periode Wisuda'),
      year: String(findValue_(period, ['Tahun']) || ''),
      wave: String(findValue_(period, ['Gelombang']) || ''),
      date: String(findValue_(period, ['Tanggal_Pelaksanaan', 'Tanggal Pelaksanaan']) || ''),
      location: String(findValue_(period, ['Lokasi']) || '')
    };
  } catch (err) {
    return null;
  }
}


function verifyImportPeriod_(periodId) {
  const id = String(periodId || '').trim();

  if (!id) {
    throw new Error('Pilih periode atau gelombang wisuda terlebih dahulu.');
  }

  const period = getRows_(CONFIG.SHEETS.PERIOD).find(function (row) {
    return String(findValue_(row, ['ID_Periode', 'ID Periode'])).trim() === id;
  });

  if (!period) {
    throw new Error('Periode yang dipilih tidak ditemukan. Muat ulang pilihan periode.');
  }

  return period;
}


function createWisudaPeriod(payload) {
  requireRole_(['Admin']);
  payload = payload || {};

  const name = String(payload.name || '').trim();
  const year = String(payload.year || '').trim();
  const wave = String(payload.wave || '').trim();
  const date = String(payload.date || '').trim();
  const location = String(payload.location || '').trim();

  if (!name || !year || !wave) {
    throw new Error('Nama periode, tahun, dan gelombang wajib diisi.');
  }

  if (!/^\d{4}$/.test(year)) {
    throw new Error('Tahun harus berisi 4 digit.');
  }

  const periodSheet = getSheet_(CONFIG.SHEETS.PERIOD);
  const lastColumn = periodSheet.getLastColumn();

  if (lastColumn < 1) {
    throw new Error('Sheet PERIODE_WISUDA belum memiliki header kolom.');
  }

  const headers = periodSheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function (h) {
      return String(h).trim();
    });

  const keyName = normalize_(name);
  const duplicate = getRows_(CONFIG.SHEETS.PERIOD).some(function (row) {
    return normalize_(findValue_(row, ['Nama_Periode', 'Nama Periode', 'Nama'])) === keyName &&
      String(findValue_(row, ['Tahun'])).trim() === year &&
      normalize_(findValue_(row, ['Gelombang', 'Gelombang_Wisuda'])) === normalize_(wave);
  });

  if (duplicate) {
    throw new Error(
      'Periode dengan nama, tahun, dan gelombang tersebut sudah ada.'
    );
  }

  const id = 'WISUDA-' + year + '-' +
    wave.toUpperCase().replace(/[^A-Z0-9]+/g, '-') + '-' +
    Utilities.getUuid().slice(0, 6).toUpperCase();

  const values = headers.map(function (header) {
    const key = importFieldKey_(header);

    if (key === 'id_periode') return id;
    if (key === 'nama_periode') return name;
    if (key === 'tahun') return year;
    if (key === 'gelombang') return wave;
    if (key === 'tanggal_pelaksanaan') return date;
    if (key === 'lokasi') return location;
    if (key === 'status') return 'Persiapan';

    return '';
  });

  periodSheet.appendRow(values);

  logActivity_(
    getCurrentEmail_(),
    'BUAT PERIODE WISUDA',
    'PERIODE WISUDA',
    id + ' - ' + name
  );

  return {
    success: true,
    period: {
      id: id,
      name: name,
      year: year,
      wave: wave,
      date: date,
      location: location,
      status: 'Persiapan'
    },
    message: 'Periode baru berhasil dibuat. Data impor berikutnya akan dikaitkan ke periode ini.'
  };
}

/* =========================
   DASHBOARD BERDASARKAN ROLE
   ========================= */
