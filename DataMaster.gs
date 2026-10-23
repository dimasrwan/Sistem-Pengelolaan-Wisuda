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
  const session = requireRole_(['Admin', 'Wisudawan']);
  filters = filters || {};

  // Jika dipanggil oleh role Wisudawan, hanya kembalikan data pemanggilan wisudawan tersebut
  if (session.role === 'Wisudawan') {
    return (typeof getStudentCallList_ === 'function') ? getStudentCallList_(session) : [];
  }

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

  const filtered = callRows.filter(function (row) {
    // Filter Periode: record dengan ID_Periode kosong atau berbeda harus dikeluarkan
    const rowPeriod = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (!rowPeriod || rowPeriod !== periodFilter) return false;

    // Filter Hari: normalisasi dan bandingkan secara kanonis (misal "1", "2", "3")
    if (dayFilter) {
      const canonicalDay = extractCanonicalDay_(row);
      if (!canonicalDay || canonicalDay !== dayFilter) return false;
    }

    return true;
  });

  // Urutkan daftar panggil mengikuti tata letak denah kursi fisik resmi UIN Ar-Raniry
  const seatOrderMap = buildSeatOrderIndexMap_();

  filtered.sort(function (a, b) {
    const dayA = extractCanonicalDay_(a) || inferDayFromSeatCode_(findValue_(a, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi'])) || '9';
    const dayB = extractCanonicalDay_(b) || inferDayFromSeatCode_(findValue_(b, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi'])) || '9';

    if (dayA !== dayB) {
      return dayA.localeCompare(dayB);
    }

    const orderA = getSeatOrderIndexForCallRow_(seatOrderMap, a);
    const orderB = getSeatOrderIndexForCallRow_(seatOrderMap, b);

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    const rawUrutanA = parseInt(findValue_(a, ['Urutan_Panggil', 'Urutan Panggil', 'Urutan', 'No']), 10) || 0;
    const rawUrutanB = parseInt(findValue_(b, ['Urutan_Panggil', 'Urutan Panggil', 'Urutan', 'No']), 10) || 0;
    return rawUrutanA - rawUrutanB;
  });

  // Pelacakan urutan panggilan global per hari wisuda
  const dayCounters = {};

  return filtered.map(function (row) {
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
    let day = extractCanonicalDay_(row);
    if (!day && seatCode) {
      day = inferDayFromSeatCode_(seatCode);
    }

    dayCounters[day] = (dayCounters[day] || 0) + 1;
    const globalUrutan = dayCounters[day];

    return {
      ID_Panggil: findValue_(row, ['ID_Panggil', 'ID Panggil']),
      Urutan_Panggil: globalUrutan,
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

/**
 * Membangun peta indeks urutan penempatan fisik kursi berdasarkan denah resmi (SeatLayoutData.gs).
 * Urutan pengisian fisik per hari:
 * 1. Baris ascending (1..25)
 * 2. Blok isKanan descending (Kanan = 1 mendahului Kiri = 0)
 * 3. Kolom descending (17 down to 1)
 *
 * Menghasilkan urutan pengisian:
 * - Seluruh wisudawan perempuan (S3 -> S2 -> S1)
 * - Jeda baris kosong / lorong denah
 * - Seluruh wisudawan laki-laki (S3 -> S2 -> S1)
 */
function buildSeatOrderIndexMap_() {
  let officialLayouts = {};
  if (typeof getOfficialDayLayouts_ === 'function') {
    try {
      officialLayouts = getOfficialDayLayouts_() || {};
    } catch (errLayout) {
      Logger.log('[buildSeatOrderIndexMap_] Peringatan memanggil getOfficialDayLayouts_: ' + errLayout.message);
    }
  } else if (typeof OFFICIAL_DAY_LAYOUTS_ !== 'undefined') {
    officialLayouts = OFFICIAL_DAY_LAYOUTS_ || {};
  }

  const orderMap = {};
  ['1', '2', '3'].forEach(function (dayKey) {
    const seats = (officialLayouts[dayKey] || []).slice();
    seats.sort(function (a, b) {
      // a: [Kode_Kursi, Baris, isKanan, Kolom]
      if (a[1] !== b[1]) return a[1] - b[1]; // Baris ascending
      if (a[2] !== b[2]) return b[2] - a[2]; // Kanan (1) mendahului Kiri (0)
      return b[3] - a[3]; // Kolom 17 down to 1
    });

    seats.forEach(function (s, idx) {
      const seatCode = String(s[0] || '').trim().toUpperCase();
      if (seatCode) {
        orderMap[dayKey + ':' + seatCode] = idx + 1;
        // Simpan juga tanpa prefix hari sebagai fallback
        if (orderMap[seatCode] === undefined) {
          orderMap[seatCode] = idx + 1;
        }
      }
    });
  });

  return orderMap;
}

function getSeatOrderIndexForCallRow_(seatOrderMap, row) {
  const seatCode = String(findValue_(row, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
  let day = extractCanonicalDay_(row);
  if (!day && seatCode) {
    day = inferDayFromSeatCode_(seatCode);
  }
  if (day && seatCode) {
    const key = day + ':' + seatCode;
    if (seatOrderMap[key] !== undefined) {
      return seatOrderMap[key];
    }
  }
  if (seatCode && seatOrderMap[seatCode] !== undefined) {
    return seatOrderMap[seatCode];
  }
  return 999999;
}


function getSeatMap(filters) {
  Logger.log('[getSeatMap] Mulai - filters: ' + JSON.stringify(filters || {}));
  const session = requireRole_(['Admin', 'Wisudawan']);
  filters = filters || {};

  let periodFilter = '';
  let dayFilter = '1';
  let studentProfile = null;
  let studentSeatCode = '';
  let selfSeat = null;

  if (session.role === 'Wisudawan') {
    // Penentuan profil dan jadwal terautentikasi untuk role Wisudawan
    studentProfile = (typeof getStudentProfile_ === 'function') ? getStudentProfile_(session) : null;
    if (!studentProfile) {
      Logger.log('[getSeatMap] Profil wisudawan tidak ditemukan untuk session user: ' + session.userId);
      return {
        day: '',
        period: '',
        total: 0,
        allocated: 0,
        needsVerification: 0,
        hasCoordinates: false,
        seats: [],
        error: 'Data pribadi belum terhubung ke akun ini. Admin perlu mengisi ID_Wisudawan pada sheet PENGGUNA.'
      };
    }

    const pVal = findValue_(studentProfile, ['ID_Periode', 'ID Periode', 'Periode']);
    periodFilter = pVal ? normalize_(pVal) : resolveTargetPeriodId_('');
    if (!periodFilter) {
      return {
        day: '',
        period: '',
        total: 0,
        allocated: 0,
        needsVerification: 0,
        hasCoordinates: false,
        seats: [],
        error: 'Periode wisuda untuk akun Anda belum ditentukan atau tidak aktif.'
      };
    }

    // Ambil data kursi resmi wisudawan
    let stSeats = [];
    if (typeof getStudentSeats_ === 'function') {
      try {
        stSeats = getStudentSeats_(session, studentProfile) || [];
      } catch (errStSeats) {
        Logger.log('[getSeatMap] Peringatan getStudentSeats_: ' + errStSeats.message);
      }
    }
    if (stSeats && stSeats.length > 0) {
      selfSeat = stSeats[0];
      studentSeatCode = String(selfSeat.Nomor_Kursi || '').trim();
    }
    if (!studentSeatCode) {
      studentSeatCode = String(findValue_(studentProfile, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim();
    }

    // Tentukan hari wisuda milik wisudawan secara ketat (tidak boleh dialihkan diam-diam ke hari lain)
    let sDay = '';
    if (selfSeat && selfSeat.Hari_Ke) {
      sDay = typeof normalizeDay_ === 'function' ? normalizeDay_(selfSeat.Hari_Ke) : String(selfSeat.Hari_Ke).trim();
    }
    if (!sDay && typeof extractCanonicalDay_ === 'function') {
      sDay = extractCanonicalDay_(studentProfile);
    }
    if (!sDay) {
      const rawDay = findValue_(studentProfile, ['Hari_Ke', 'Hari Ke', 'Hari']);
      sDay = typeof normalizeDay_ === 'function' ? normalizeDay_(rawDay) : String(rawDay || '').trim();
    }

    sDay = typeof normalizeDay_ === 'function' ? normalizeDay_(sDay) : sDay;
    if (!sDay || ['1', '2', '3'].indexOf(sDay) === -1) {
      return {
        day: '',
        period: periodFilter,
        total: 0,
        allocated: 0,
        needsVerification: 0,
        hasCoordinates: false,
        seats: [],
        error: 'Jadwal hari pelaksanaan wisuda belum ditentukan atau tidak valid untuk akun Anda.'
      };
    }

    dayFilter = sDay;
  } else {
    // Alur untuk role Admin
    periodFilter = resolveTargetPeriodId_(filters.period);

    if (filters.day !== undefined && filters.day !== null && String(filters.day).trim() !== '') {
      dayFilter = normalizeDay_(filters.day);
      if (!dayFilter) {
        Logger.log('[getSeatMap] Hari tidak valid: ' + filters.day);
        return {
          day: '',
          period: periodFilter,
          total: 0,
          allocated: 0,
          needsVerification: 0,
          hasCoordinates: false,
          seats: [],
          error: 'Hari tidak valid. Hari pelaksanaan wisuda hanya 1, 2, atau 3.'
        };
      }
    }

    if (!periodFilter) {
      Logger.log('[getSeatMap] Periode aktif tidak ditemukan.');
      return {
        day: dayFilter,
        period: '',
        total: 0,
        allocated: 0,
        needsVerification: 0,
        hasCoordinates: false,
        seats: [],
        error: 'Periode wisuda aktif tidak ditemukan.'
      };
    }
  }

  // Baca sheet DENAH_KURSI dan DATA_WISUDAWAN (tidak perlu membaca DAFTAR_PANGGIL untuk efisiensi)
  const rawSeatRows = getRows_(CONFIG.SHEETS.SEATS);
  const rawStudentRows = getRows_(CONFIG.SHEETS.STUDENTS);
  Logger.log('[getSeatMap] Selesai baca sheet - seatRows: ' + rawSeatRows.length + ', studentRows: ' + rawStudentRows.length);

  // 1. Terapkan filter periode pada DATA_WISUDAWAN
  const studentById = {};
  rawStudentRows.filter(function (st) {
    const p = normalize_(findValue_(st, ['ID_Periode', 'ID Periode', 'Periode']));
    return Boolean(p && p === periodFilter);
  }).forEach(function (st) {
    const id = normalize_(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']));
    if (id) studentById[id] = st;
  });

  // 2. Terapkan filter periode dan hari pada DENAH_KURSI
  const sheetSeatByCode = {};
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
  Logger.log('[getSeatMap] Selesai filter - period: ' + periodFilter + ', day: ' + dayFilter + ', seatCount: ' + Object.keys(sheetSeatByCode).length);

  // Jika tidak ada data alokasi kursi di sheet untuk periode dan hari yang dipilih, kembalikan kosong
  if (Object.keys(sheetSeatByCode).length === 0) {
    Logger.log('[getSeatMap] Tidak ada alokasi kursi untuk periode ' + periodFilter + ' dan hari ' + dayFilter);
    return {
      day: dayFilter,
      period: periodFilter,
      total: 0,
      allocated: 0,
      needsVerification: 0,
      hasCoordinates: false,
      selfSeatCode: studentSeatCode,
      selfSeat: selfSeat,
      seats: []
    };
  }

  // 3. Siapkan koordinat fisik denah resmi (UIN Ar-Raniry)
  let officialLayouts = {};
  if (typeof getOfficialDayLayouts_ === 'function') {
    try {
      officialLayouts = getOfficialDayLayouts_() || {};
    } catch (errLayout) {
      Logger.log('[getSeatMap] Peringatan memanggil getOfficialDayLayouts_: ' + errLayout.message);
    }
  } else if (typeof OFFICIAL_DAY_LAYOUTS_ !== 'undefined') {
    officialLayouts = OFFICIAL_DAY_LAYOUTS_ || {};
  }
  const dayLayout = (officialLayouts && officialLayouts[dayFilter]) || [];

  // 4. Susun data kursi dan tentukan status alokasi yang tepat
  const layoutSeatCodes = {};
  const result = [];

  // Kasus A: Tata letak fisik resmi tersedia untuk hari ini
  if (dayLayout.length > 0) {
    dayLayout.forEach(function (item) {
      const code = item[0];
      const baris = item[1];
      const isKanan = item[2];
      const kolom = item[3];
      const blok = isKanan === 1 ? 'Kanan' : 'Kiri';
      layoutSeatCodes[code] = true;

      const sheetRow = sheetSeatByCode[code] || null;
      let idWisudawan = sheetRow ? String(findValue_(sheetRow, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim() : '';
      const st = idWisudawan ? (studentById[normalize_(idWisudawan)] || null) : null;

      let nama = '';
      if (st) nama = findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']);
      if (!nama && sheetRow) nama = findValue_(sheetRow, ['Nama_Lengkap', 'Nama_Wisudawan', 'Nama']);

      const nim = st ? String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim() : '';
      const fakultas = st ? findValue_(st, ['Fakultas']) :
        (sheetRow ? findValue_(sheetRow, ['Fakultas']) : inferFacultyFromSeatCode_(code));
      const prodi = st ? findValue_(st, ['Program_Studi', 'Program Studi']) : '';
      const jk = st ? findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']) :
        (sheetRow ? findValue_(sheetRow, ['Jenis_Kelamin', 'Jenis Kelamin']) : '');

      let statusKursi = 'Kosong';
      const sheetStatus = sheetRow ? normalize_(findValue_(sheetRow, ['Status_Kursi', 'Status'])) : '';
      const isMarkedOccupied = ['terisi', 'terdaftar', 'dialokasikan', 'allocated', 'occupied'].indexOf(sheetStatus) !== -1;
      const hasAllocationReference = Boolean(idWisudawan || nama || isMarkedOccupied);

      if (!hasAllocationReference) {
        statusKursi = 'Kosong';
      } else if (idWisudawan && st) {
        statusKursi = 'Terdaftar';
      } else {
        statusKursi = 'Perlu Verifikasi';
      }

      const isSelf = Boolean(
        (studentSeatCode && code.toUpperCase() === studentSeatCode.toUpperCase()) ||
        (studentProfile && idWisudawan && normalize_(idWisudawan) === normalize_(findValue_(studentProfile, ['ID_Wisudawan', 'ID Wisudawan'])))
      );

      if (isSelf) {
        if (!selfSeat) {
          selfSeat = {
            ID_Kursi: sheetRow ? findValue_(sheetRow, ['ID_Kursi', 'ID Kursi']) : ('KRS-' + code),
            ID_Wisudawan: idWisudawan,
            Nama_Wisudawan: nama,
            NIM: nim,
            Fakultas: fakultas,
            Program_Studi: prodi,
            Nomor_Kursi: code,
            Hari_Ke: dayFilter
          };
        }
        selfSeat.Blok = blok;
        selfSeat.Baris = baris;
        selfSeat.Kolom = kolom;
        selfSeat.Koordinat_Tersedia = true;
      }

      result.push({
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
        Hari_Ke: dayFilter,
        isSelf: isSelf
      });
    });
  }

  // Kasus B: Sertakan kursi di sheet yang belum tercakup dalam dayLayout (atau seluruhnya jika dayLayout kosong)
  Object.keys(sheetSeatByCode).forEach(function (code) {
    if (layoutSeatCodes[code]) return;
    const sheetRow = sheetSeatByCode[code];
    let idWisudawan = String(findValue_(sheetRow, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
    const st = idWisudawan ? (studentById[normalize_(idWisudawan)] || null) : null;

    let nama = st ? findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) : findValue_(sheetRow, ['Nama_Lengkap', 'Nama_Wisudawan', 'Nama']);
    const nim = st ? String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim() : '';
    const fakultas = st ? findValue_(st, ['Fakultas']) : (findValue_(sheetRow, ['Fakultas']) || inferFacultyFromSeatCode_(code));
    const prodi = st ? findValue_(st, ['Program_Studi', 'Program Studi']) : '';
    const jk = st ? findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']) : findValue_(sheetRow, ['Jenis_Kelamin', 'Jenis Kelamin']);

    const blok = findValue_(sheetRow, ['Blok']);
    const baris = findValue_(sheetRow, ['Baris']);
    const kolom = findValue_(sheetRow, ['Kolom']);

    let statusKursi = 'Kosong';
    const sheetStatus = normalize_(findValue_(sheetRow, ['Status_Kursi', 'Status']));
    const isMarkedOccupied = ['terisi', 'terdaftar', 'dialokasikan', 'allocated', 'occupied'].indexOf(sheetStatus) !== -1;
    const hasAllocationReference = Boolean(idWisudawan || nama || isMarkedOccupied);

    if (!hasAllocationReference) {
      statusKursi = 'Kosong';
    } else if (idWisudawan && st) {
      statusKursi = 'Terdaftar';
    } else {
      statusKursi = 'Perlu Verifikasi';
    }

    const isSelf = Boolean(
      (studentSeatCode && code.toUpperCase() === studentSeatCode.toUpperCase()) ||
      (studentProfile && idWisudawan && normalize_(idWisudawan) === normalize_(findValue_(studentProfile, ['ID_Wisudawan', 'ID Wisudawan'])))
    );

    if (isSelf) {
      if (!selfSeat) {
        selfSeat = {
          ID_Kursi: findValue_(sheetRow, ['ID_Kursi', 'ID Kursi']) || ('KRS-' + code),
          ID_Wisudawan: idWisudawan,
          Nama_Wisudawan: nama,
          NIM: nim,
          Fakultas: fakultas,
          Program_Studi: prodi,
          Nomor_Kursi: code,
          Hari_Ke: dayFilter
        };
      }
      if (blok && baris && kolom) {
        selfSeat.Blok = blok;
        selfSeat.Baris = baris;
        selfSeat.Kolom = kolom;
        selfSeat.Koordinat_Tersedia = true;
      }
    }

    result.push({
      ID_Kursi: findValue_(sheetRow, ['ID_Kursi', 'ID Kursi']) || ('KRS-' + code),
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
      Hari_Ke: dayFilter,
      isSelf: isSelf
    });
  });

  Logger.log('[getSeatMap] Selesai pemetaan koordinat - totalSeats: ' + result.length + ', dayLayoutCount: ' + dayLayout.length);

  const response = {
    day: dayFilter,
    period: periodFilter,
    total: result.length,
    allocated: result.filter(function (s) { return s.Status_Kursi === 'Terdaftar'; }).length,
    needsVerification: result.filter(function (s) { return s.Status_Kursi === 'Perlu Verifikasi'; }).length,
    hasCoordinates: result.some(function (s) { return Boolean(s.Baris && s.Blok && s.Kolom); }),
    selfSeatCode: studentSeatCode,
    selfSeat: selfSeat,
    seats: result
  };

  Logger.log('[getSeatMap] Return response - total: ' + response.total + ', allocated: ' + response.allocated + ', needsVerification: ' + response.needsVerification + ', hasCoordinates: ' + response.hasCoordinates + ', selfSeat: ' + studentSeatCode);
  return response;
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
  const rows = getRows_(CONFIG.SHEETS.BEST);
  return rows.map(function (row) {
    const nama = findValue_(row, ['Nama', 'Nama_Lengkap', 'Nama Lengkap']);
    const predikat = findValue_(row, ['Predikat', 'Keterangan']);
    if (nama) {
      if (!row.Nama) row.Nama = nama;
      if (!row.Nama_Lengkap) row.Nama_Lengkap = nama;
    }
    if (predikat && !row.Predikat) row.Predikat = predikat;
    return row;
  });
}



function getGuests(periodFilter) {
  requireRole_(['Admin', 'Panitia']);
  return typeof getGuestAttendanceList === 'function'
    ? getGuestAttendanceList(periodFilter)
    : getRows_(CONFIG.SHEETS.GUESTS).slice(0, 500);
}

/* =========================
   IMPORT DATA WISUDAWAN
   Hanya Admin
   ========================= */
