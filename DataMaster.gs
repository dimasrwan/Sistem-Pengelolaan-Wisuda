function normalizeDay_(val) {
  if (val == null) return '';
  const text = String(val).trim().toLowerCase();
  if (!text) return '';

  // 1. Cek pola angka spesifik HANYA hari 1, 2, atau 3 (misal: "1", "hari 1", "hari ke-1", "hari ke 1")
  const numMatch = text.match(/^(?:hari(?:\s*ke)?[\s\-_]*)?([1-3])$/i);
  if (numMatch) {
    return numMatch[1];
  }

  // 2. Pemetaan nama hari resmi UIN Ar-Raniry Gelombang III 2026:
  // Harus mengunci keseluruhan string (^...$) agar tidak menerima teks tambahan seperti "Selasa palsu"
  // Hari 1: Selasa / Selasa, 6 Oktober 2026
  if (/^(?:hari\s*)?selasa(?:[,\s\-]+0?6\s+oktober(?:\s+2026)?)?$/i.test(text)) return '1';

  // Hari 2: Rabu / Rabu, 7 Oktober 2026
  if (/^(?:hari\s*)?rabu(?:[,\s\-]+0?7\s+oktober(?:\s+2026)?)?$/i.test(text)) return '2';

  // Hari 3: Kamis / Kamis, 8 Oktober 2026
  if (/^(?:hari\s*)?kamis(?:[,\s\-]+0?8\s+oktober(?:\s+2026)?)?$/i.test(text)) return '3';

  // Nilai 10, 0, 4, teks sembarang, dan nama hari dengan kata tambahan (misal: "Selasa palsu") ditolak
  return '';
}

function extractCanonicalDay_(row) {
  if (!row) return '';
  // Utamakan field Hari_Ke
  const hariKe = findValue_(row, ['Hari_Ke', 'Hari Ke']);
  if (hariKe != null && String(hariKe).trim() !== '') {
    return normalizeDay_(hariKe);
  }
  // Field Hari hanya digunakan jika Hari_Ke tidak ada
  const hari = findValue_(row, ['Hari']);
  if (hari != null && String(hari).trim() !== '') {
    return normalizeDay_(hari);
  }
  return '';
}

function resolveTargetPeriodId_(explicitPeriodId) {
  if (explicitPeriodId != null && String(explicitPeriodId).trim() !== '') {
    return normalize_(explicitPeriodId);
  }
  try {
    const active = typeof getActivePeriod_ === 'function' ? getActivePeriod_() : null;
    return active && active.id ? normalize_(active.id) : '';
  } catch (e) {
    return '';
  }
}

function getCallList(filters) {
  requireRole_(['Admin']);
  filters = filters || {};

  const callRows = getRows_(CONFIG.SHEETS.CALL_LIST);
  const studentRows = getRows_(CONFIG.SHEETS.STUDENTS);

  // Isolasi periode eksplisit atau periode aktif
  const periodFilter = resolveTargetPeriodId_(filters.period);

  // Jika periode belum dipilih dan tidak ada periode aktif valid, jangan gabungkan data lintas periode
  if (!periodFilter) {
    return [];
  }

  // Penanganan validasi filter hari:
  // - Jika hari tidak diberikan: dayFilter = '' (semua hari di periode tersebut)
  // - Jika hari diberikan tetapi tidak valid: jangan dialihkan diam-diam, kembalikan hasil kosong []
  let dayFilter = '';
  if (filters.day !== undefined && filters.day !== null && String(filters.day).trim() !== '') {
    dayFilter = normalizeDay_(filters.day);
    if (!dayFilter) {
      return [];
    }
  }

  // 1. Terapkan filter periode pada DATA_WISUDAWAN untuk lookup mahasiswa
  const studentById = {};
  studentRows.filter(function (st) {
    const p = normalize_(findValue_(st, ['ID_Periode', 'ID Periode', 'Periode']));
    return Boolean(p && p === periodFilter);
  }).forEach(function (st) {
    const id = normalize_(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']));
    if (id) studentById[id] = st;
  });

  return callRows.filter(function (row) {
    // Filter Periode: record dengan ID_Periode kosong atau berbeda harus dikeluarkan
    const rowPeriod = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (!rowPeriod || rowPeriod !== periodFilter) return false;

    // Filter Hari: normalisasi dan bandingkan secara kanonis (misal "1", "2", "3")
    if (dayFilter) {
      const canonicalDay = extractCanonicalDay_(row);
      if (!canonicalDay || canonicalDay !== dayFilter) return false;
    }

    return true;
  }).map(function (row) {
    const rawIdWisudawan = String(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
    // Relasi eksklusif hanya melalui ID_Wisudawan
    const st = rawIdWisudawan ? (studentById[normalize_(rawIdWisudawan)] || null) : null;

    // Nama diambil dari field Nama_Wisudawan di DAFTAR_PANGGIL atau fallback ke Nama_Lengkap di DATA_WISUDAWAN jika berelasi
    const nama = String(findValue_(row, ['Nama_Wisudawan', 'Nama Wisudawan', 'Nama_Lengkap', 'Nama']) ||
      (st ? findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) : '')).trim();

    // NIM diambil HANYA dari sheet DATA_WISUDAWAN melalui relasi ID_Wisudawan yang valid. Jangan gunakan ID_Wisudawan sebagai NIM.
    const nim = st ? String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim() : '';

    const fakultas = String(findValue_(row, ['Fakultas']) || (st ? findValue_(st, ['Fakultas']) : '')).trim();
    const prodi = String(findValue_(row, ['Program_Studi', 'Program Studi', 'Prodi']) || (st ? findValue_(st, ['Program_Studi', 'Program Studi']) : '')).trim();
    const jk = String(findValue_(row, ['Jenis_Kelamin', 'JK']) || (st ? findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']) : '')).trim();
    const tmpLahir = String(findValue_(row, ['Tempat_Lahir']) || (st ? findValue_(st, ['Tempat_Lahir', 'Tempat Lahir']) : '')).trim();
    const tglLahir = String(findValue_(row, ['Tanggal_Lahir', 'Tgl_Lahir']) || (st ? findValue_(st, ['Tanggal_Lahir', 'Tgl Lahir']) : '')).trim();
    const ipk = String(findValue_(row, ['IPK']) || (st ? findValue_(st, ['IPK']) : '')).trim();
    const predikat = String(findValue_(row, ['Predikat']) || (st ? findValue_(st, ['Predikat']) : '')).trim();
    const seatCode = String(findValue_(row, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim();
    const day = extractCanonicalDay_(row);

    return {
      ID_Panggil: findValue_(row, ['ID_Panggil', 'ID Panggil']),
      Urutan_Panggil: findValue_(row, ['Urutan_Panggil', 'Urutan Panggil', 'Urutan', 'No']),
      ID_Wisudawan: rawIdWisudawan,
      Nama_Lengkap: nama,
      Nama_Wisudawan: nama,
      NIM: nim,
      Fakultas: fakultas,
      Program_Studi: prodi,
      Jenis_Kelamin: jk,
      Tempat_Lahir: tmpLahir,
      Tanggal_Lahir: tglLahir,
      IPK: ipk,
      Predikat: predikat,
      Nomor_Kursi: seatCode,
      Hari_Ke: day,
      Status_Panggil: findValue_(row, ['Status_Panggil', 'Status Panggil']) || 'Belum Dipanggil',
      Waktu_Panggil: findValue_(row, ['Waktu_Panggil', 'Waktu Panggil'])
    };
  });
}


function getSeatMap(filters) {
  requireRole_(['Admin']);
  filters = filters || {};

  const periodFilter = resolveTargetPeriodId_(filters.period);

  // Penanganan validasi filter hari:
  // - Jika hari tidak diberikan: gunakan default Hari Pertama ('1')
  // - Jika hari diberikan tetapi tidak valid: jangan dialihkan diam-diam ke Hari Pertama, kembalikan hasil kosong yang jelas
  let dayFilter = '1';
  if (filters.day !== undefined && filters.day !== null && String(filters.day).trim() !== '') {
    dayFilter = normalizeDay_(filters.day);
    if (!dayFilter) {
      return {
        day: '',
        period: periodFilter,
        total: 0,
        allocated: 0,
        needsVerification: 0,
        seats: [],
        error: 'Hari tidak valid. Hari pelaksanaan wisuda hanya 1, 2, atau 3.'
      };
    }
  }

  const rawSeatRows = getRows_(CONFIG.SHEETS.SEATS);
  const rawStudentRows = getRows_(CONFIG.SHEETS.STUDENTS);
  const rawCallRows = getRows_(CONFIG.SHEETS.CALL_LIST);

  // 1. Terapkan filter periode pada DATA_WISUDAWAN
  // Jika periode belum dipilih / tidak valid, jangan bangun lookup dari gabungan periode
  const studentById = {};
  if (periodFilter) {
    rawStudentRows.filter(function (st) {
      const p = normalize_(findValue_(st, ['ID_Periode', 'ID Periode', 'Periode']));
      return Boolean(p && p === periodFilter);
    }).forEach(function (st) {
      const id = normalize_(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']));
      if (id) studentById[id] = st;
    });
  }

  // 2. Terapkan filter periode dan hari pada DAFTAR_PANGGIL
  const callBySeat = {};
  if (periodFilter) {
    rawCallRows.filter(function (cl) {
      const p = normalize_(findValue_(cl, ['ID_Periode', 'ID Periode', 'Periode']));
      if (!p || p !== periodFilter) return false;

      if (dayFilter) {
        const canonicalDay = extractCanonicalDay_(cl);
        if (!canonicalDay || canonicalDay !== dayFilter) return false;
      }
      return true;
    }).forEach(function (cl) {
      const seat = normalize_(findValue_(cl, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']));
      if (seat) callBySeat[seat] = cl;
    });
  }

  // 3. Terapkan filter periode dan hari pada DENAH_KURSI
  const sheetSeatByCode = {};
  if (periodFilter) {
    rawSeatRows.filter(function (sr) {
      const p = normalize_(findValue_(sr, ['ID_Periode', 'ID Periode', 'Periode']));
      if (!p || p !== periodFilter) return false;

      if (dayFilter) {
        const canonicalDay = extractCanonicalDay_(sr);
        if (!canonicalDay || canonicalDay !== dayFilter) return false;
      }
      return true;
    }).forEach(function (sr) {
      const code = String(findValue_(sr, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim();
      if (code) sheetSeatByCode[code] = sr;
    });
  }

  // 4. Siapkan koordinat fisik denah resmi (UIN Ar-Raniry)
  const officialLayouts = getOfficialDayLayouts_();
  const dayLayout = officialLayouts[dayFilter] || [];

  // 5. Susun data kursi dan tentukan status alokasi yang tepat
  const result = dayLayout.map(function (item) {
    const code = item[0];
    const baris = item[1];
    const isKanan = item[2];
    const kolom = item[3];
    const blok = isKanan === 1 ? 'Kanan' : 'Kiri';

    const sheetRow = sheetSeatByCode[code] || null;
    const callRow = callBySeat[normalize_(code)] || null;

    let idWisudawan = '';
    if (sheetRow) idWisudawan = String(findValue_(sheetRow, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
    if (!idWisudawan && callRow) idWisudawan = String(findValue_(callRow, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();

    // Relasi mahasiswa HANYA melalui ID_Wisudawan
    const st = idWisudawan ? (studentById[normalize_(idWisudawan)] || null) : null;

    let nama = '';
    if (st) nama = findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']);
    if (!nama && sheetRow) nama = findValue_(sheetRow, ['Nama_Lengkap', 'Nama_Wisudawan', 'Nama']);
    if (!nama && callRow) nama = findValue_(callRow, ['Nama_Wisudawan', 'Nama_Lengkap', 'Nama']);

    // NIM diambil HANYA dari DATA_WISUDAWAN via relasi ID_Wisudawan yang valid
    const nim = st ? String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim() : '';

    const fakultas = st ? findValue_(st, ['Fakultas']) :
      (sheetRow ? findValue_(sheetRow, ['Fakultas']) :
      (callRow ? findValue_(callRow, ['Fakultas']) : inferFacultyFromSeatCode_(code)));
    const prodi = st ? findValue_(st, ['Program_Studi', 'Program Studi']) :
      (callRow ? findValue_(callRow, ['Program_Studi', 'Program Studi']) : '');
    const jk = st ? findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']) :
      (callRow ? findValue_(callRow, ['Jenis_Kelamin', 'JK']) : '');

    // 6. Penentuan Status Kursi Sesuai Kaidah Audit:
    // - Terdaftar: alokasi memiliki ID_Wisudawan yang valid dan relasinya ditemukan di DATA_WISUDAWAN
    // - Kosong: tidak ada peserta yang dialokasikan
    // - Perlu Verifikasi: ada referensi alokasi atau ID peserta tetapi relasinya tidak ditemukan / tidak konsisten
    let statusKursi = 'Kosong';
    const sheetStatus = sheetRow ? normalize_(findValue_(sheetRow, ['Status_Kursi', 'Status'])) : '';
    const isMarkedOccupied = ['terisi', 'terdaftar', 'dialokasikan', 'allocated', 'occupied'].indexOf(sheetStatus) !== -1;
    const hasAllocationReference = Boolean(idWisudawan || nama || callRow || isMarkedOccupied);

    if (!hasAllocationReference) {
      statusKursi = 'Kosong';
    } else if (idWisudawan && st) {
      statusKursi = 'Terdaftar';
    } else {
      statusKursi = 'Perlu Verifikasi';
    }

    return {
      ID_Kursi: sheetRow ? findValue_(sheetRow, ['ID_Kursi', 'ID Kursi']) : ('KRS-' + code),
      ID_Wisudawan: idWisudawan,
      Nama_Lengkap: nama,
      Nama_Wisudawan: nama,
      NIM: nim,
      Fakultas: fakultas,
      Program_Studi: prodi,
      Jenis_Kelamin: jk,
      Blok: blok,
      Baris: baris,
      Kolom: kolom,
      Nomor_Kursi: code,
      Status_Kursi: statusKursi,
      Hari_Ke: dayFilter
    };
  });

  return {
    day: dayFilter,
    period: periodFilter,
    total: result.length,
    allocated: result.filter(function (s) { return s.Status_Kursi === 'Terdaftar'; }).length,
    needsVerification: result.filter(function (s) { return s.Status_Kursi === 'Perlu Verifikasi'; }).length,
    seats: result
  };
}

function inferDayFromSeatCode_(seatCode) {
  if (!seatCode) return '';
  const parts = String(seatCode).trim().split('-');
  const unit = parts[1] || '';
  if (['S3', 'S2', 'S', 'U', 'D'].indexOf(unit) !== -1) return '1';
  if (unit === 'T') return '2';
  if (['A', 'E', 'ST', 'IP', 'P'].indexOf(unit) !== -1) return '3';
  return '';
}

function inferFacultyFromSeatCode_(seatCode) {
  if (!seatCode) return '';
  const parts = String(seatCode).trim().split('-');
  const unit = parts[1] || '';
  const map = {
    'S3': 'Pascasarjana - S3',
    'S2': 'Pascasarjana - S2',
    'S': "Fakultas Syari'ah dan Hukum",
    'U': 'Fakultas Ushuluddin dan Filsafat',
    'D': 'Fakultas Dakwah dan Komunikasi',
    'T': 'Fakultas Tarbiyah dan Keguruan',
    'A': 'Fakultas Adab dan Humaniora',
    'E': 'Fakultas Ekonomi dan Bisnis Islam',
    'ST': 'Fakultas Sains dan Teknologi',
    'IP': 'Fakultas Ilmu Sosial dan Ilmu Pemerintahan',
    'P': 'Fakultas Psikologi'
  };
  return map[unit] || unit;
}


function getBestGraduates() {
  requireRole_(['Admin']);
  return getRows_(CONFIG.SHEETS.BEST);
}


function getGuests() {
  requireRole_(['Admin']);
  return getRows_(CONFIG.SHEETS.GUESTS).slice(0, 500);
}

/* =========================
   IMPORT DATA WISUDAWAN
   Hanya Admin
   ========================= */
