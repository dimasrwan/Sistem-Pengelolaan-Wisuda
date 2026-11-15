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
  const explicitOrder = Number(findValue_(row, ['Urutan_Panggil', 'Urutan Panggil']));
  if (!isNaN(explicitOrder) && explicitOrder > 0) {
    return explicitOrder;
  }
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

  // 3. Siapkan koordinat fisik denah resmi atau geometri dinamis
  const periodConfig = resolvePeriodAllocationConfig_(periodFilter);
  const isDynamicMode = Boolean(periodConfig && periodConfig.isValid && periodConfig.mode === 'dynamic_expand');
  const blockedCoordinates = (typeof getBuildingLayoutSpec_ === 'function')
    ? (getBuildingLayoutSpec_().blockedCoordinates || [])
    : [];

  let officialLayouts = {};
  if (!isDynamicMode) {
    if (typeof getOfficialDayLayouts_ === 'function') {
      try {
        officialLayouts = getOfficialDayLayouts_() || {};
      } catch (errLayout) {
        Logger.log('[getSeatMap] Peringatan memanggil getOfficialDayLayouts_: ' + errLayout.message);
      }
    } else if (typeof OFFICIAL_DAY_LAYOUTS_ !== 'undefined') {
      officialLayouts = OFFICIAL_DAY_LAYOUTS_ || {};
    }
  }
  const dayLayout = isDynamicMode ? [] : ((officialLayouts && officialLayouts[dayFilter]) || []);

  // 4. Susun data kursi dan tentukan status alokasi yang tepat
  const layoutSeatCodes = {};
  const result = [];
  const femaleRowsSet = {};
  const maleRowsSet = {};

  if (isDynamicMode) {
    const sheetSeatByCoord = {};
    Object.keys(sheetSeatByCode).forEach(function (code) {
      const r = sheetSeatByCode[code];
      const bRow = Number(findValue_(r, ['Baris'])) || 0;
      const bBlok = String(findValue_(r, ['Blok']) || '').trim().toLowerCase();
      const bIsKanan = bBlok === 'kanan' ? 1 : (bBlok === 'kiri' ? 0 : -1);
      const bCol = Number(findValue_(r, ['Kolom'])) || 0;
      if (bRow > 0 && bIsKanan !== -1 && bCol > 0) {
        sheetSeatByCoord[bRow + ':' + bIsKanan + ':' + bCol] = r;
      }
    });

    const buildingGrid = (typeof getBuildingSeatGrid_ === 'function') ? getBuildingSeatGrid_() : [];
    buildingGrid.forEach(function (cell) {
      const sheetRow = sheetSeatByCoord[cell.row + ':' + cell.isKanan + ':' + cell.col] || null;
      const code = sheetRow
        ? String(findValue_(sheetRow, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim()
        : '';
      if (code) layoutSeatCodes[code] = true;

      let idWisudawan = sheetRow ? String(findValue_(sheetRow, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim() : '';
      const st = idWisudawan ? (studentById[normalize_(idWisudawan)] || null) : null;

      let nama = '';
      if (st) nama = findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']);
      if (!nama && sheetRow) nama = findValue_(sheetRow, ['Nama_Lengkap', 'Nama_Wisudawan', 'Nama']);

      const nim = st ? String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim() : '';
      const fakultas = st ? findValue_(st, ['Fakultas']) :
        (sheetRow ? findValue_(sheetRow, ['Fakultas']) : (code ? inferFacultyFromSeatCode_(code) : ''));
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
        const gClass = classifyGenderForSort_(jk);
        if (gClass === 'Perempuan') femaleRowsSet[cell.row] = true;
        else if (gClass === 'Laki-laki') maleRowsSet[cell.row] = true;
      } else {
        statusKursi = 'Perlu Verifikasi';
      }

      const isSelf = Boolean(
        (studentSeatCode && code && code.toUpperCase() === studentSeatCode.toUpperCase()) ||
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
        selfSeat.Blok = cell.blok;
        selfSeat.Baris = cell.row;
        selfSeat.Kolom = cell.col;
        selfSeat.Koordinat_Tersedia = true;
      }

      result.push({
        ID_Kursi: sheetRow ? findValue_(sheetRow, ['ID_Kursi', 'ID Kursi']) : '',
        ID_Wisudawan: idWisudawan,
        Nama_Lengkap: nama,
        Nama_Wisudawan: nama,
        NIM: nim,
        Fakultas: fakultas,
        Program_Studi: prodi,
        Jenis_Kelamin: jk,
        Blok: cell.blok,
        Baris: cell.row,
        Kolom: cell.col,
        Nomor_Kursi: code,
        Status_Kursi: statusKursi,
        Hari_Ke: dayFilter,
        isSelf: isSelf
      });
    });
  } else if (dayLayout.length > 0) {
  // Kasus A: Tata letak fisik resmi tersedia untuk hari ini (legacy_2026)
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

  const femaleRowNums = Object.keys(femaleRowsSet).map(Number).sort(function (a, b) { return a - b; });
  const maleRowNums = Object.keys(maleRowsSet).map(Number).sort(function (a, b) { return a - b; });
  const bufferRowNums = [];
  if (isDynamicMode && femaleRowNums.length > 0 && maleRowNums.length > 0) {
    const maxF = femaleRowNums[femaleRowNums.length - 1];
    const minM = maleRowNums[0];
    for (let r = maxF + 1; r < minM; r++) {
      if (r !== 13) bufferRowNums.push(r);
    }
  }

  const response = {
    day: dayFilter,
    period: periodFilter,
    allocationMode: (periodConfig && periodConfig.mode) || 'legacy_2026',
    blockedCoordinates: blockedCoordinates,
    sectorInfo: {
      femaleRows: femaleRowNums,
      bufferRows: bufferRowNums,
      maleRows: maleRowNums
    },
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


const BACKEND_ORDERED_PRODIS_ = {
  'Pascasarjana - S3': [
    'S3 Fiqh Modern', 'S3 Pendidikan Agama Islam', 'S3 Ekonomi Syariah', 'S3 Studi Islam'
  ],
  'Pascasarjana - S2': [
    'S2 Ilmu Agama Islam', 'S2 Hukum Keluarga', 'S2 Pendidikan Agama Islam',
    'S2 Pendidikan Bahasa Arab', "S2 Ilmu Al-Qur'an dan Tafsir",
    'S2 Komunikasi dan Penyiaran Islam', 'S2 Ekonomi Syariah'
  ],
  "Fakultas Syari'ah dan Hukum": [
    'S1 Hukum Keluarga', 'S1 Hukum Ekonomi Syariah', 'S1 Hukum Pidana Islam',
    'S1 Hukum Tata Negara', 'S1 Perbandingan Mazhab', 'S1 Ilmu Hukum'
  ],
  'Fakultas Ushuluddin dan Filsafat': [
    "S1 Ilmu Al-Qur'an dan Tafsir", 'S1 Ilmu Hadis', 'S1 Aqidah dan Filsafat Islam',
    'S1 Studi Agama-Agama', 'S1 Sosiologi Agama'
  ],
  'Fakultas Dakwah dan Komunikasi': [
    'S1 Komunikasi dan Penyiaran Islam', 'S1 Bimbingan Konseling Islam',
    'S1 Manajemen Dakwah', 'S1 Pengembangan Masyarakat Islam',
    'S1 Kesejahteraan Sosial', 'S1 Manajemen Haji dan Umrah'
  ],
  'Fakultas Tarbiyah dan Keguruan': [
    'S1 Pendidikan Agama Islam', 'S1 Pendidikan Bahasa Arab', 'S1 Pendidikan Bahasa Inggris',
    'S1 Manajemen Pendidikan Islam', 'S1 Pendidikan Matematika', 'S1 Pendidikan Biologi',
    'S1 Pendidikan Kimia', 'S1 Pendidikan Fisika', 'S1 Pendidikan Guru Madrasah Ibtidaiyah',
    'S1 Pendidikan Islam Anak Usia Dini', 'S1 Bimbingan dan Konseling',
    'S1 Pendidikan Teknik Elektro', 'S1 Pendidikan Teknologi Informasi'
  ],
  'Fakultas Adab dan Humaniora': [
    'S1 Bahasa dan Sastra Arab', 'S1 Sejarah dan Kebudayaan Islam', 'S1 Ilmu Perpustakaan'
  ],
  'Fakultas Ekonomi dan Bisnis Islam': [
    'S1 Ekonomi Syariah', 'S1 Perbankan Syariah', 'S1 Ilmu Ekonomi',
    'S1 Manajemen Bisnis Syariah', 'D4 Manajemen Industri Halal'
  ],
  'Fakultas Sains dan Teknologi': [
    'S1 Arsitektur', 'S1 Teknik Lingkungan', 'S1 Biologi', 'S1 Kimia',
    'S1 Teknologi Informasi', 'S1 Teknik Fisika'
  ],
  'Fakultas Ilmu Sosial dan Ilmu Pemerintahan': [
    'S1 Ilmu Politik', 'S1 Ilmu Administrasi Negara'
  ],
  'Fakultas Psikologi': [
    'S1 Psikologi'
  ]
};

function getProdiRankForSort_(prodi, faculty) {
  if (!prodi) return 999;
  const normProdi = normalize_(prodi).replace(/[^a-z0-9]/g, '');

  for (const fac in BACKEND_ORDERED_PRODIS_) {
    const list = BACKEND_ORDERED_PRODIS_[fac];
    for (let i = 0; i < list.length; i++) {
      const normRef = normalize_(list[i]).replace(/[^a-z0-9]/g, '');
      if (normProdi === normRef || normProdi.indexOf(normRef) !== -1 || normRef.indexOf(normProdi) !== -1) {
        return i;
      }
    }
  }
  return 999;
}

function isFemaleGenderForSort_(value) {
  if (!value) return false;
  if (typeof normalizeGender_ === 'function') {
    const norm = normalizeGender_(value);
    if (norm === 'Perempuan') return true;
    if (norm === 'Laki-laki') return false;
  }
  const text = String(value).trim().toLowerCase();
  return text === 'perempuan' || text === 'p' || text === 'wanita' || text === 'female';
}

function isMaleGenderForSort_(value) {
  if (!value) return false;
  if (typeof normalizeGender_ === 'function') {
    const norm = normalizeGender_(value);
    if (norm === 'Laki-laki') return true;
    if (norm === 'Perempuan') return false;
  }
  const text = String(value).trim().toLowerCase();
  return text === 'laki-laki' || text === 'laki - laki' || text === 'l' || text === 'pria' || text === 'male';
}

function classifyGenderForSort_(value) {
  if (isFemaleGenderForSort_(value)) return 'Perempuan';
  if (isMaleGenderForSort_(value)) return 'Laki-laki';
  return 'Ambigu';
}

/**
 * Urutan resmi unit fakultas/pascasarjana untuk alokasi kursi & daftar panggil.
 */
const OFFICIAL_FACULTY_UNIT_ORDER_ = ['S3', 'S2', 'S', 'U', 'D', 'T', 'A', 'E', 'ST', 'IP', 'P'];

/**
 * Konfigurasi alokasi periode tersimpan internal (tanpa mengubah skema sheet PERIODE_WISUDA).
 * Periode 2026 tetap menggunakan mode 'legacy_2026' (OFFICIAL_DAY_LAYOUTS_).
 * Periode baru wajib didaftarkan di sini sebelum sinkronisasi operasional dijalankan.
 */
const PERIOD_ALLOCATION_CONFIGS_ = {
  'WISUDA-GIII-2026': {
    mode: 'legacy_2026',
    layoutSource: 'OFFICIAL_DAY_LAYOUTS_',
    totalDays: 3,
    days: {
      '1': ['S3', 'S2', 'S', 'U', 'D'],
      '2': ['T'],
      '3': ['A', 'E', 'ST', 'IP', 'P']
    }
  }
};

function resolvePeriodAllocationConfig_(periodId, overrideConfig) {
  if (overrideConfig && typeof overrideConfig === 'object') {
    return overrideConfig;
  }
  const key = String(periodId || '').trim().toUpperCase();
  if (!key) {
    return {
      mode: 'unconfigured',
      isValid: false,
      error: 'ID Periode kosong; konfigurasi alokasi tidak dapat ditentukan.'
    };
  }
  const cfg = PERIOD_ALLOCATION_CONFIGS_[key];
  if (!cfg) {
    return {
      mode: 'unconfigured',
      isValid: false,
      periodId: key,
      error: 'Konfigurasi pembagian hari/fakultas untuk periode "' + periodId + '" belum terdaftar pada PERIOD_ALLOCATION_CONFIGS_.'
    };
  }
  return Object.assign({ isValid: true, periodId: key }, cfg);
}

function inferUnitAndDayFromFacultyAndJenjang_(fac, jenjang, periodConfig) {
  const f = normalize_(fac || '');
  const j = String(jenjang || '').toUpperCase().trim();

  let unit = '';
  if (f.indexOf('pascasarjana') !== -1 || j === 'S3' || f.indexOf('s3') !== -1 || j === 'S2' || f.indexOf('s2') !== -1) {
    if (j === 'S3' || f.indexOf('s3') !== -1) unit = 'S3';
    else unit = 'S2';
  } else if (f.indexOf('syari') !== -1 || f === 'fsh') {
    unit = 'S';
  } else if (f.indexOf('ushuluddin') !== -1 || f === 'fuf') {
    unit = 'U';
  } else if (f.indexOf('dakwah') !== -1 || f === 'fdk') {
    unit = 'D';
  } else if (f.indexOf('tarbiyah') !== -1 || f === 'ftk') {
    unit = 'T';
  } else if (f.indexOf('adab') !== -1 || f === 'fah') {
    unit = 'A';
  } else if (f.indexOf('ekonomi') !== -1 || f.indexOf('febi') !== -1 || f.indexOf('bisnis') !== -1) {
    unit = 'E';
  } else if (f.indexOf('sains') !== -1 || f.indexOf('teknologi') !== -1 || f.indexOf('fst') !== -1) {
    unit = 'ST';
  } else if (f.indexOf('sosial') !== -1 || f.indexOf('pemerintahan') !== -1 || f.indexOf('fisip') !== -1) {
    unit = 'IP';
  } else if (f.indexOf('psikologi') !== -1 || f === 'fpsi') {
    unit = 'P';
  }

  if (!unit) {
    return {
      unit: '',
      day: '',
      isValid: false,
      reason: 'Fakultas/Jenjang "' + (fac || '-') + '" (' + (jenjang || '-') + ') tidak dikenali.'
    };
  }

  if (periodConfig && periodConfig.days) {
    for (const dayKey of ['1', '2', '3']) {
      const unitsInDay = periodConfig.days[dayKey] || [];
      if (unitsInDay.indexOf(unit) !== -1) {
        return { unit: unit, day: dayKey, isValid: true };
      }
    }
    return {
      unit: unit,
      day: '',
      isValid: false,
      reason: 'Unit "' + unit + '" belum dipetakan ke Hari 1/2/3 pada konfigurasi periode.'
    };
  }

  // Pemetaan default resmi (digunakan untuk legacy_2026)
  const legacyDayByUnit = {
    'S3': '1', 'S2': '1', 'S': '1', 'U': '1', 'D': '1',
    'T': '2',
    'A': '3', 'E': '3', 'ST': '3', 'IP': '3', 'P': '3'
  };
  return { unit: unit, day: legacyDayByUnit[unit] || '', isValid: Boolean(legacyDayByUnit[unit]) };
}

/**
 * Menghitung jumlah baris aktual yang diperlukan untuk menampung `requiredCount` kursi
 * berdasarkan kapasitas fisik valid per baris (34 untuk Baris 1-12 & 14-22; 28 untuk Baris 23-25)
 * sesuai arah alokasi baris (`orderedRowNums`). Tidak pernah menggunakan pembagian tetap / 34.
 */
function calculateActualRowsNeeded_(requiredCount, orderedRowNums, seatsByRow) {
  const rows = [];
  const rowCapacities = {};
  let accumulatedCapacity = 0;

  for (let i = 0; i < orderedRowNums.length && accumulatedCapacity < requiredCount; i++) {
    const rowNum = orderedRowNums[i];
    const rowCap = (seatsByRow[rowNum] || []).length;
    if (rowCap <= 0) continue;
    rows.push(rowNum);
    rowCapacities[rowNum] = rowCap;
    accumulatedCapacity += rowCap;
  }

  return {
    sufficient: accumulatedCapacity >= requiredCount,
    rows: rows,
    rowCount: rows.length,
    totalCapacity: accumulatedCapacity,
    rowCapacities: rowCapacities
  };
}

/**
 * Mengevaluasi kandidat pembagian sektor Perempuan (dari Baris 1 ke belakang) dan
 * Laki-laki (dari Baris 25 ke depan) beserta validasi buffer berbasis kapasitas aktual baris.
 */
function evaluateSectorSplitCandidate_(fCount, mCount, activeRowNums, seatsByRow) {
  const totalActiveRows = activeRowNums.length;
  const frontOrder = activeRowNums.slice(); // 1..12, 14..25
  const backOrder = activeRowNums.slice().reverse(); // 25..14, 12..1

  const femaleReq = calculateActualRowsNeeded_(fCount, frontOrder, seatsByRow);
  const maleReq = calculateActualRowsNeeded_(mCount, backOrder, seatsByRow);

  if (!femaleReq.sufficient || !maleReq.sufficient) {
    return {
      isValid: false,
      reason: 'Kapasitas fisik gedung tidak mencukupi (Perempuan butuh ' + fCount + ' kursi, Laki-laki butuh ' + mCount + ' kursi).'
    };
  }

  // Pertahankan urutan arah alokasi: Perempuan dari Baris 1 ke belakang, Laki-laki dari Baris 25 ke depan
  const femaleRows = femaleReq.rows.slice();
  const maleRows = maleReq.rows.slice();

  // Pastikan sektor tidak tumpang tindih
  const femaleSet = {};
  femaleRows.forEach(function (r) { femaleSet[r] = true; });
  for (let i = 0; i < maleRows.length; i++) {
    if (femaleSet[maleRows[i]]) {
      return {
        isValid: false,
        femaleRows: femaleRows,
        maleRows: maleRows,
        bufferRows: [],
        bufferSeatCapacity: 0,
        reason: 'Sektor Perempuan (' + femaleRows.length + ' baris) dan sektor Laki-laki (' + maleRows.length + ' baris) saling bertumpukan pada Baris ' + maleRows[i] + '.'
      };
    }
  }

  const bothGendersPresent = fCount > 0 && mCount > 0;
  let bufferRows = [];
  let bufferSeatCapacity = 0;
  const bufferRowCapacities = {};

  if (bothGendersPresent) {
    // Baris buffer adalah seluruh baris kursi valid aktif (tidak termasuk Baris 13) di antara kedua sektor
    const femaleEndIdx = femaleRows.length;
    const maleStartIdx = totalActiveRows - maleRows.length;
    if (maleStartIdx <= femaleEndIdx) {
      return {
        isValid: false,
        femaleRows: femaleRows,
        maleRows: maleRows,
        bufferRows: [],
        bufferSeatCapacity: 0,
        reason: 'Tidak tersedia minimal 1 baris kursi valid penuh sebagai buffer antara sektor Perempuan (butuh ' +
          femaleRows.length + ' baris untuk ' + fCount + ' wisudawati) dan sektor Laki-laki (butuh ' +
          maleRows.length + ' baris untuk ' + mCount + ' wisudawan); Baris 13 adalah lorong dan bukan buffer.'
      };
    }
    bufferRows = activeRowNums.slice(femaleEndIdx, maleStartIdx);
    bufferRows.forEach(function (r) {
      const cap = (seatsByRow[r] || []).length;
      bufferRowCapacities[r] = cap;
      bufferSeatCapacity += cap;
    });

    if (bufferRows.length < 1 || bufferSeatCapacity <= 0) {
      return {
        isValid: false,
        femaleRows: femaleRows,
        maleRows: maleRows,
        bufferRows: bufferRows,
        bufferSeatCapacity: bufferSeatCapacity,
        reason: 'Kapasitas baris buffer tidak memenuhi syarat minimal 1 baris kursi valid penuh.'
      };
    }
  }

  return {
    isValid: true,
    femaleRows: femaleRows,
    femaleRowCapacity: femaleReq.totalCapacity,
    maleRows: maleRows,
    maleRowCapacity: maleReq.totalCapacity,
    bufferRows: bufferRows,
    bufferSeatCapacity: bufferSeatCapacity,
    bufferRowCapacities: bufferRowCapacities
  };
}

/**
 * Menghitung alokasi kursi dinamis untuk satu hari wisuda (Cross-Aisle + Buffer >= 1 baris kursi valid).
 * Aturan:
 * - Baris 13 adalah lorong horizontal (bukan kursi dan bukan buffer).
 * - Sektor Perempuan dari Baris 1 ke belakang; Sektor Laki-laki dari Baris 25 ke depan.
 * - Jika kedua gender ada, wajib ada >= 1 baris kursi valid penuh kosong sebagai buffer.
 * - Dalam setiap baris, urutan kursi RIGHT FIRST (Kanan 17->1, lalu Kiri 17->1).
 * - Koordinat terhalang (blockedCoordinates) tidak pernah ditempati.
 */
function computeDynamicSectorAllocation_(dayStudents, periodConfig, dayKey) {
  const grid = (typeof getBuildingSeatGrid_ === 'function') ? getBuildingSeatGrid_() : [];
  if (!grid.length) {
    return {
      success: false,
      day: String(dayKey || ''),
      error: 'Grid geometri gedung kosong (getBuildingSeatGrid_ tidak tersedia).',
      allocations: []
    };
  }

  // Kelompokkan kursi valid berdasarkan nomor baris aktif (1..12, 14..25)
  const seatsByRow = {};
  const activeRowNums = [];
  grid.forEach(function (seat) {
    if (!seatsByRow[seat.row]) {
      seatsByRow[seat.row] = [];
      activeRowNums.push(seat.row);
    }
    seatsByRow[seat.row].push(seat);
  });
  activeRowNums.sort(function (a, b) { return a - b; });

  const totalActiveRows = activeRowNums.length; // 24
  const totalDayCapacity = grid.length; // 798

  // Urutan unit fakultas untuk hari ini
  const configuredUnits = (periodConfig && periodConfig.days && periodConfig.days[String(dayKey)]) || [];
  const unitOrder = OFFICIAL_FACULTY_UNIT_ORDER_.filter(function (u) {
    return configuredUnits.length === 0 || configuredUnits.indexOf(u) !== -1;
  });
  configuredUnits.forEach(function (u) {
    if (unitOrder.indexOf(u) === -1) unitOrder.push(u);
  });

  const females = [];
  const males = [];
  const invalidStudents = [];

  (dayStudents || []).forEach(function (st) {
    const fac = String(findValue_(st, ['Fakultas']) || '').trim();
    const jenjang = String(findValue_(st, ['Jenjang']) || '').trim();
    const uInfo = inferUnitAndDayFromFacultyAndJenjang_(fac, jenjang, periodConfig);
    const jkVal = findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']);
    const genderClass = classifyGenderForSort_(jkVal);

    if (!uInfo.isValid) {
      invalidStudents.push({ student: st, reason: uInfo.reason });
      return;
    }
    if (genderClass !== 'Perempuan' && genderClass !== 'Laki-laki') {
      invalidStudents.push({ student: st, reason: 'Gender tidak terverifikasi ("' + (jkVal || 'kosong') + '").' });
      return;
    }
    const entry = { student: st, unit: uInfo.unit, gender: genderClass };
    if (genderClass === 'Perempuan') females.push(entry);
    else males.push(entry);
  });

  if (invalidStudents.length > 0) {
    return {
      success: false,
      day: String(dayKey || ''),
      error: invalidStudents.map(function (x) { return x.reason; }).join('; '),
      invalidStudents: invalidStudents,
      allocations: []
    };
  }

  const sortEntryFn = function (a, b) {
    const uIdxA = unitOrder.indexOf(a.unit);
    const uIdxB = unitOrder.indexOf(b.unit);
    const rankUA = uIdxA === -1 ? 999 : uIdxA;
    const rankUB = uIdxB === -1 ? 999 : uIdxB;
    if (rankUA !== rankUB) return rankUA - rankUB;

    const pA = String(findValue_(a.student, ['Program_Studi', 'Program Studi']) || '');
    const pB = String(findValue_(b.student, ['Program_Studi', 'Program Studi']) || '');
    const facA = String(findValue_(a.student, ['Fakultas']) || '');
    const facB = String(findValue_(b.student, ['Fakultas']) || '');
    const rankPA = getProdiRankForSort_(pA, facA);
    const rankPB = getProdiRankForSort_(pB, facB);
    if (rankPA !== rankPB) return rankPA - rankPB;

    const nimA = String(findValue_(a.student, ['NIM', 'Nomor Induk Mahasiswa']) || '');
    const nimB = String(findValue_(b.student, ['NIM', 'Nomor Induk Mahasiswa']) || '');
    return nimA.localeCompare(nimB);
  };

  females.sort(sortEntryFn);
  males.sort(sortEntryFn);

  const fCount = females.length;
  const mCount = males.length;

  const splitEval = evaluateSectorSplitCandidate_(fCount, mCount, activeRowNums, seatsByRow);
  if (!splitEval.isValid) {
    return {
      success: false,
      day: String(dayKey || ''),
      error: splitEval.reason + ' (Hari ' + dayKey + ').',
      femaleRowsNeeded: (splitEval.femaleRows || []).length,
      maleRowsNeeded: (splitEval.maleRows || []).length,
      bufferRowCount: (splitEval.bufferRows || []).length,
      bufferSeatCapacity: splitEval.bufferSeatCapacity || 0,
      allocations: []
    };
  }

  const femaleRows = splitEval.femaleRows;
  const bufferRows = splitEval.bufferRows;
  const maleRows = splitEval.maleRows;

  const femaleSeats = [];
  femaleRows.forEach(function (r) {
    seatsByRow[r].forEach(function (s) { femaleSeats.push(s); });
  });

  const maleSeats = [];
  maleRows.forEach(function (r) {
    seatsByRow[r].forEach(function (s) { maleSeats.push(s); });
  });

  // Penomoran kursi per unit dalam hari tersebut (1-S3, 2-S3, ..., 1-S, ...)
  const unitCounters = {};
  const allocations = [];
  let callSeq = 0;

  function pushAllocation(entry, seat) {
    unitCounters[entry.unit] = (unitCounters[entry.unit] || 0) + 1;
    const seatCode = unitCounters[entry.unit] + '-' + entry.unit;
    callSeq++;
    allocations.push({
      student: entry.student,
      unit: entry.unit,
      gender: entry.gender,
      day: String(dayKey),
      seatCode: seatCode,
      row: seat.row,
      isKanan: seat.isKanan,
      blok: seat.blok,
      col: seat.col,
      callOrder: callSeq
    });
  }

  for (let i = 0; i < females.length; i++) {
    pushAllocation(females[i], femaleSeats[i]);
  }
  for (let j = 0; j < males.length; j++) {
    pushAllocation(males[j], maleSeats[j]);
  }

  const validation = validateAllocationResult_({
    day: String(dayKey),
    totalExpected: fCount + mCount,
    femaleRows: femaleRows,
    bufferRows: bufferRows,
    maleRows: maleRows,
    allocations: allocations
  });

  if (!validation.isValid) {
    return {
      success: false,
      day: String(dayKey || ''),
      error: 'Validasi alokasi dinamis gagal: ' + validation.errors.join('; '),
      allocations: []
    };
  }

  return {
    success: true,
    day: String(dayKey),
    totalStudents: allocations.length,
    femaleCount: fCount,
    maleCount: mCount,
    femaleRows: femaleRows,
    bufferRows: bufferRows,
    bufferSeatCapacity: splitEval.bufferSeatCapacity,
    bufferRowCapacities: splitEval.bufferRowCapacities,
    maleRows: maleRows,
    remainingSeats: totalDayCapacity - allocations.length,
    allocations: allocations
  };
}

function validateAllocationResult_(result) {
  const errors = [];
  const allocations = (result && result.allocations) || [];
  if (typeof result.totalExpected === 'number' && allocations.length !== result.totalExpected) {
    errors.push('Jumlah hasil alokasi (' + allocations.length + ') != jumlah peserta (' + result.totalExpected + ').');
  }

  const bufferRowSet = {};
  if (Array.isArray(result.bufferRows)) {
    result.bufferRows.forEach(function (r) { bufferRowSet[Number(r)] = true; });
  }

  const seenCoords = {};
  const seenSeatCodes = {};
  const rowGenders = {};
  let maxFemaleRow = 0;
  let minMaleRow = 999;

  allocations.forEach(function (a) {
    if (a.row === 13) {
      errors.push('Kursi "' + a.seatCode + '" berada di Baris 13 (Lorong Horizontal).');
    }
    if (bufferRowSet[a.row]) {
      errors.push('Kursi "' + a.seatCode + '" menempati Baris ' + a.row + ' yang ditetapkan sebagai buffer.');
    }
    if (typeof isBlockedSeatCoordinate_ === 'function' && isBlockedSeatCoordinate_(a.row, a.isKanan, a.col)) {
      errors.push('Kursi "' + a.seatCode + '" menempati koordinat terhalang (Baris ' + a.row + ', ' + a.blok + ' Kolom ' + a.col + ').');
    }
    const coordKey = a.row + ':' + a.isKanan + ':' + a.col;
    if (seenCoords[coordKey]) {
      errors.push('Koordinat kursi ganda pada ' + coordKey + '.');
    }
    seenCoords[coordKey] = true;

    if (seenSeatCodes[a.seatCode]) {
      errors.push('Kode kursi ganda "' + a.seatCode + '".');
    }
    seenSeatCodes[a.seatCode] = true;

    if (!rowGenders[a.row]) rowGenders[a.row] = {};
    rowGenders[a.row][a.gender] = true;

    if (a.gender === 'Perempuan' && a.row > maxFemaleRow) maxFemaleRow = a.row;
    if (a.gender === 'Laki-laki' && a.row < minMaleRow) minMaleRow = a.row;
  });

  Object.keys(rowGenders).forEach(function (r) {
    if (Object.keys(rowGenders[r]).length > 1) {
      errors.push('Baris ' + r + ' mencampur gender Perempuan dan Laki-laki.');
    }
  });

  if (maxFemaleRow > 0 && minMaleRow < 999) {
    if (maxFemaleRow >= minMaleRow) {
      errors.push('Sektor Perempuan (maks baris ' + maxFemaleRow + ') bertabrakan dengan sektor Laki-laki (min baris ' + minMaleRow + ').');
    } else {
      // Hitung baris kursi valid penuh di antara maxFemaleRow dan minMaleRow (tidak menghitung Baris 13)
      let validBufferRows = 0;
      for (let r = maxFemaleRow + 1; r < minMaleRow; r++) {
        if (r !== 13) validBufferRows++;
      }
      if (validBufferRows < 1) {
        errors.push('Tidak ada minimal 1 baris kursi valid penuh sebagai buffer antara Baris ' + maxFemaleRow + ' dan Baris ' + minMaleRow + '.');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Memvalidasi status sinkronisasi wisudawan secara komprehensif silang-sheet (cross-sheet validation).
 * Peserta HANYA dianggap 'penuh' (Fully Synced) jika:
 * 1. Memiliki entri DAFTAR_PANGGIL yang valid untuk ID_Periode dan ID_Wisudawan yang benar.
 * 2. Memiliki entri DENAH_KURSI yang valid untuk periode dan wisudawan yang sama.
 * 3. Nomor kursi di DAFTAR_PANGGIL sama persis dengan DENAH_KURSI.
 * 4. Nomor kursi terdaftar pada layout resmi UIN Ar-Raniry (OFFICIAL_DAY_LAYOUTS_).
 * 5. Unit dan sektor gender kursi sesuai dengan data fakultas dan jenis kelamin wisudawan.
 * 6. Tidak ditemukan konflik ID, NIM, nomor panggil, kursi, atau sektor gender.
 * 7. Tidak berada di Baris 13 (Lorong Tengah).
 */
function validateStudentSyncStatus_(st, existingCallByStudentId, existingCallByNim, existingSeatByStudentId, existingSeatByNim, officialLayouts, duplicateMeta, periodConfig) {
  const idWsd = String(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
  const idWsdNorm = normalize_(idWsd);
  const nim = String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
  const nimNorm = normalize_(nim);
  const fac = String(findValue_(st, ['Fakultas']) || '').trim();
  const jenjang = String(findValue_(st, ['Jenjang']) || '').trim();
  const targetPeriodNorm = normalize_(findValue_(st, ['ID_Periode', 'ID Periode', 'Periode']));
  const rawJk = findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']);
  const genderClass = classifyGenderForSort_(rawJk);

  const callRow = (idWsdNorm && existingCallByStudentId[idWsdNorm]) || (nimNorm && existingCallByNim[nimNorm]) || null;
  const seatRow = (idWsdNorm && existingSeatByStudentId[idWsdNorm]) || (nimNorm && existingSeatByNim[nimNorm]) || null;

  if (!callRow && !seatRow) {
    return {
      status: 'belum_tersinkron',
      callRow: null,
      seatRow: null,
      issues: []
    };
  }

  if (callRow && !seatRow) {
    const seatCode = String(findValue_(callRow, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
    return {
      status: 'parsial',
      callRow: callRow,
      seatRow: null,
      seatCode: seatCode,
      issues: ['Tercatat di DAFTAR_PANGGIL (Nomor Kursi: ' + (seatCode || '-') + ') namun tidak memiliki entri di DENAH_KURSI.']
    };
  }

  if (!callRow && seatRow) {
    const seatCode = String(findValue_(seatRow, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
    return {
      status: 'parsial',
      callRow: null,
      seatRow: seatRow,
      seatCode: seatCode,
      issues: ['Tercatat di DENAH_KURSI (Nomor Kursi: ' + (seatCode || '-') + ') namun tidak memiliki entri di DAFTAR_PANGGIL.']
    };
  }

  // Keduanya ada: Lakukan validasi silang (cross-sheet validation)
  const issues = [];

  // 1. Validasi kecocokan ID_Periode
  const callPeriod = normalize_(findValue_(callRow, ['ID_Periode', 'ID Periode', 'Periode']));
  const seatPeriod = normalize_(findValue_(seatRow, ['ID_Periode', 'ID Periode', 'Periode']));
  if (targetPeriodNorm) {
    if (callPeriod && callPeriod !== targetPeriodNorm) {
      issues.push('ID Periode DAFTAR_PANGGIL ("' + callPeriod + '") tidak sesuai periode data induk ("' + targetPeriodNorm + '").');
    }
    if (seatPeriod && seatPeriod !== targetPeriodNorm) {
      issues.push('ID Periode DENAH_KURSI ("' + seatPeriod + '") tidak sesuai periode data induk ("' + targetPeriodNorm + '").');
    }
  }

  // 2. Validasi kecocokan ID_Wisudawan dan NIM
  const callIdWsd = normalize_(findValue_(callRow, ['ID_Wisudawan', 'ID Wisudawan']));
  const seatIdWsd = normalize_(findValue_(seatRow, ['ID_Wisudawan', 'ID Wisudawan']));
  if (idWsdNorm && callIdWsd && callIdWsd !== idWsdNorm) {
    issues.push('Konflik ID Wisudawan: DAFTAR_PANGGIL ("' + callIdWsd + '") != data induk ("' + idWsdNorm + '").');
  }
  if (idWsdNorm && seatIdWsd && seatIdWsd !== idWsdNorm) {
    issues.push('Konflik ID Wisudawan: DENAH_KURSI ("' + seatIdWsd + '") != data induk ("' + idWsdNorm + '").');
  }
  if (callIdWsd && seatIdWsd && callIdWsd !== seatIdWsd) {
    issues.push('Konflik ID Wisudawan antar-sheet: DAFTAR_PANGGIL ("' + callIdWsd + '") != DENAH_KURSI ("' + seatIdWsd + '").');
  }

  const callNim = normalize_(findValue_(callRow, ['NIM', 'Nomor Induk Mahasiswa']));
  const seatNim = normalize_(findValue_(seatRow, ['NIM', 'Nomor Induk Mahasiswa']));
  if (nimNorm && callNim && callNim !== nimNorm) {
    issues.push('Konflik NIM: DAFTAR_PANGGIL ("' + callNim + '") != data induk ("' + nimNorm + '").');
  }
  if (nimNorm && seatNim && seatNim !== nimNorm) {
    issues.push('Konflik NIM: DENAH_KURSI ("' + seatNim + '") != data induk ("' + nimNorm + '").');
  }
  if (callNim && seatNim && callNim !== seatNim) {
    issues.push('Konflik NIM antar-sheet: DAFTAR_PANGGIL ("' + callNim + '") != DENAH_KURSI ("' + seatNim + '").');
  }

  // 3. Validasi nomor kursi antar-sheet
  const callSeat = String(findValue_(callRow, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
  const seatMapSeat = String(findValue_(seatRow, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();

  if (!callSeat && !seatMapSeat) {
    issues.push('Nomor kursi kosong pada DAFTAR_PANGGIL dan DENAH_KURSI.');
  } else if (callSeat !== seatMapSeat) {
    issues.push('Ketidakcocokan nomor kursi antar-sheet: DAFTAR_PANGGIL mencatat "' + callSeat + '", sedangkan DENAH_KURSI mencatat "' + seatMapSeat + '".');
  }

  const activeSeatCode = seatMapSeat || callSeat;
  const expectedUnitInfo = inferUnitAndDayFromFacultyAndJenjang_(fac, jenjang, periodConfig);

  let seatDay = extractCanonicalDay_(seatRow) || extractCanonicalDay_(callRow) || inferDayFromSeatCode_(activeSeatCode);
  if (!seatDay) seatDay = expectedUnitInfo.day;

  const isDynamicMode = Boolean(periodConfig && periodConfig.mode === 'dynamic_expand');

  if (isDynamicMode) {
    const rowNum = Number(findValue_(seatRow, ['Baris'])) || 0;
    const blokStr = String(findValue_(seatRow, ['Blok']) || '').trim().toLowerCase();
    const isKananVal = blokStr === 'kanan' ? 1 : (blokStr === 'kiri' ? 0 : -1);
    const colNum = Number(findValue_(seatRow, ['Kolom'])) || 0;

    if (!rowNum || isKananVal === -1 || !colNum) {
      issues.push('Koordinat kursi (Blok/Baris/Kolom) untuk "' + activeSeatCode + '" tidak lengkap pada DENAH_KURSI.');
    } else {
      if (rowNum === 13) {
        issues.push('Kursi "' + activeSeatCode + '" berada di Baris 13 (Lorong Tengah).');
      }
      if (typeof isBlockedSeatCoordinate_ === 'function' && isBlockedSeatCoordinate_(rowNum, isKananVal, colNum)) {
        issues.push('Kursi "' + activeSeatCode + '" menempati koordinat terhalang permanen.');
      }
    }
    if (genderClass === 'Ambigu') {
      issues.push('Gender wisudawan kosong atau tidak terverifikasi ("' + (rawJk || 'kosong') + '"), tidak dapat memverifikasi kesesuaian sektor kursi.');
    }
    if (!expectedUnitInfo.isValid) {
      issues.push(expectedUnitInfo.reason || 'Fakultas/unit wisudawan tidak dikenali.');
    } else {
      const seatUnit = (activeSeatCode.split('-')[1] || '').toUpperCase();
      if (seatUnit && expectedUnitInfo.unit && seatUnit !== expectedUnitInfo.unit.toUpperCase()) {
        issues.push('Unit kursi "' + seatUnit + '" tidak sesuai dengan unit fakultas wisudawan "' + expectedUnitInfo.unit + '".');
      }
    }
  } else {
    // 4. Validasi keberadaan di layout resmi denah 2D (legacy_2026)
    const dayLayout = (officialLayouts && officialLayouts[seatDay]) || [];
    const layoutItem = dayLayout.find(function (s) { return String(s[0] || '').trim().toUpperCase() === activeSeatCode; });

    if (!layoutItem) {
      issues.push('Nomor kursi "' + activeSeatCode + '" tidak terdaftar pada denah fisik resmi UIN Ar-Raniry (Hari ' + seatDay + ').');
    } else {
      const row = layoutItem[1];
      if (row === 13) {
        issues.push('Kursi "' + activeSeatCode + '" berada di Baris 13 (Lorong Tengah).');
      }
      if (genderClass === 'Ambigu') {
        issues.push('Gender wisudawan kosong atau tidak terverifikasi ("' + (rawJk || 'kosong') + '"), tidak dapat memverifikasi kesesuaian sektor kursi.');
      } else if (genderClass === 'Perempuan' && row > 12) {
        issues.push('Wisudawati ditempatkan di baris belakang / sektor laki-laki (Baris ' + row + ', Kursi ' + activeSeatCode + ').');
      } else if (genderClass === 'Laki-laki' && row < 14) {
        issues.push('Wisudawan ditempatkan di baris depan / sektor perempuan (Baris ' + row + ', Kursi ' + activeSeatCode + ').');
      }

      const seatUnit = (activeSeatCode.split('-')[1] || '').toUpperCase();
      if (seatUnit && expectedUnitInfo.unit && seatUnit !== expectedUnitInfo.unit.toUpperCase()) {
        issues.push('Unit kursi "' + seatUnit + '" tidak sesuai dengan unit fakultas wisudawan "' + expectedUnitInfo.unit + '".');
      }
    }
  }

  // 5. Validasi duplikasi jika metadata konflik tersedia
  if (duplicateMeta) {
    const seatKey = seatDay + ':' + activeSeatCode;
    if (duplicateMeta.seatCounts && duplicateMeta.seatCounts[seatKey] > 1) {
      issues.push('Kursi "' + activeSeatCode + '" (Hari ' + seatDay + ') dialokasikan ganda kepada lebih dari 1 peserta.');
    }
    const callSeq = String(findValue_(callRow, ['Urutan_Panggil', 'Urutan Panggil']) || '').trim();
    if (callSeq && duplicateMeta.callSeqCounts && duplicateMeta.callSeqCounts[seatDay + ':' + callSeq] > 1) {
      issues.push('Nomor urutan panggil "' + callSeq + '" (Hari ' + seatDay + ') terduplikasi pada DAFTAR_PANGGIL.');
    }
    if (idWsdNorm && duplicateMeta.callStudentCounts && duplicateMeta.callStudentCounts[idWsdNorm] > 1) {
      issues.push('ID Wisudawan "' + idWsd + '" tercatat ganda pada DAFTAR_PANGGIL.');
    }
    if (idWsdNorm && duplicateMeta.seatStudentCounts && duplicateMeta.seatStudentCounts[idWsdNorm] > 1) {
      issues.push('ID Wisudawan "' + idWsd + '" tercatat ganda pada DENAH_KURSI.');
    }
  }

  if (issues.length > 0) {
    return {
      status: 'konflik',
      callRow: callRow,
      seatRow: seatRow,
      seatCode: activeSeatCode,
      issues: issues
    };
  }

  return {
    status: 'penuh',
    callRow: callRow,
    seatRow: seatRow,
    seatCode: activeSeatCode,
    issues: []
  };
}

function appendMappedRowsToSheet_(sheet, objectsList, defaultHeaders) {
  let lastCol = sheet.getLastColumn();
  let lastRow = sheet.getLastRow();

  if (lastCol === 0 || lastRow === 0) {
    sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    lastCol = defaultHeaders.length;
    lastRow = 1;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, lastCol)
    .getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });

  const mappedHeaders = existingHeaders.slice();

  // Pastikan kolom penting tersedia jika belum ada di sheet
  defaultHeaders.forEach(function (defH) {
    const normDef = normalize_(defH).replace(/[^a-z0-9]/g, '');
    const exists = mappedHeaders.some(function (exH) {
      return normalize_(exH).replace(/[^a-z0-9]/g, '') === normDef;
    });
    if (!exists) {
      mappedHeaders.push(defH);
      sheet.getRange(1, mappedHeaders.length).setValue(defH);
    }
  });

  const finalColCount = sheet.getLastColumn();
  const currentHeaders = sheet.getRange(1, 1, 1, finalColCount)
    .getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });

  const rowsToWrite = objectsList.map(function (obj) {
    return currentHeaders.map(function (header) {
      const key = normalize_(header).replace(/[^a-z0-9]/g, '');
      for (const prop in obj) {
        if (normalize_(prop).replace(/[^a-z0-9]/g, '') === key) {
          return obj[prop] == null ? '' : safeSheetValue_(obj[prop]);
        }
      }
      return '';
    });
  });

  if (rowsToWrite.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToWrite.length, currentHeaders.length)
      .setValues(rowsToWrite);
  }
}

/**
 * Pemeriksaan pra-sinkronisasi (Pre-Flight Check) bersifat READ-ONLY.
 * Tidak mengubah, memindahkan, atau menghapus data produksi Google Sheets.
 * Mengaudit kesiapan data wisudawan sebelum sinkronisasi daftar panggil dan denah kursi.
 */
function preflightCheckPeriodOperations(periodId) {
  requireRole_(['Admin']);
  periodId = String(periodId || '').trim();
  if (!periodId) {
    periodId = resolveTargetPeriodId_('');
  }
  if (!periodId) {
    throw new Error('Periode wisuda tujuan belum ditentukan.');
  }

  const allPeriods = (typeof getRows_ === 'function') ? getRows_(CONFIG.SHEETS.PERIOD) : [];
  const targetPeriodRow = allPeriods.find(function (p) {
    return normalize_(findValue_(p, ['ID_Periode', 'ID Periode'])) === normalize_(periodId);
  });
  const periodName = targetPeriodRow
    ? String(findValue_(targetPeriodRow, ['Nama_Periode', 'Nama Periode', 'Nama']) || periodId).trim()
    : periodId;

  // 1. Baca data wisudawan (READ-ONLY)
  const allStudents = getRows_(CONFIG.SHEETS.STUDENTS);
  const periodStudents = allStudents.filter(function (row) {
    const p = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    const statusData = normalize_(findValue_(row, ['Status_Data', 'Status Data', 'Status']));
    return p === normalize_(periodId) && statusData !== 'nonaktif';
  });

  // 2. Baca data eksisting DAFTAR_PANGGIL dan DENAH_KURSI (READ-ONLY)
  const existingCalls = getRows_(CONFIG.SHEETS.CALL_LIST);
  const existingSeats = getRows_(CONFIG.SHEETS.SEATS);

  // Sumber kapasitas resmi dari SeatLayoutData.gs & konfigurasi mode periode
  const periodConfig = resolvePeriodAllocationConfig_(periodId);
  const isDynamicMode = Boolean(periodConfig && periodConfig.isValid && periodConfig.mode === 'dynamic_expand');
  const officialSummary = (typeof getOfficialCapacitySummary_ === 'function')
    ? getOfficialCapacitySummary_()
    : null;
  const buildingSummary = (typeof getBuildingCapacitySummary_ === 'function')
    ? getBuildingCapacitySummary_()
    : null;
  const officialLayouts = (typeof getOfficialDayLayouts_ === 'function')
    ? getOfficialDayLayouts_()
    : (typeof OFFICIAL_DAY_LAYOUTS_ !== 'undefined' ? OFFICIAL_DAY_LAYOUTS_ : {});

  // Hash map data periode lain untuk audit isolasi
  let otherPeriodsCallCount = 0;
  let otherPeriodsSeatCount = 0;
  const otherPeriodsMap = {};

  existingCalls.forEach(function (r) {
    const p = normalize_(findValue_(r, ['ID_Periode', 'ID Periode', 'Periode']));
    if (p && p !== normalize_(periodId)) {
      otherPeriodsCallCount++;
      otherPeriodsMap[p] = true;
    }
  });

  existingSeats.forEach(function (r) {
    const p = normalize_(findValue_(r, ['ID_Periode', 'ID Periode', 'Periode']));
    if (p && p !== normalize_(periodId)) {
      otherPeriodsSeatCount++;
      otherPeriodsMap[p] = true;
    }
  });

  // 3. Audit peserta yang sudah tersinkron pada periode target
  const existingCallByStudentId = {};
  const existingCallByNim = {};
  const existingSeatByStudentId = {};
  const existingSeatByNim = {};
  const occupiedSeats = {};
  const seatPlacementsList = [];

  const duplicateMeta = {
    seatCounts: {},
    callSeqCounts: {},
    callStudentCounts: {},
    seatStudentCounts: {}
  };

  const duplicateCallSeqErrors = [];

  existingCalls.forEach(function (r) {
    const p = normalize_(findValue_(r, ['ID_Periode', 'ID Periode', 'Periode']));
    if (p === normalize_(periodId)) {
      const idWsd = normalize_(findValue_(r, ['ID_Wisudawan', 'ID Wisudawan']));
      const nim = normalize_(findValue_(r, ['NIM', 'Nomor Induk Mahasiswa']));
      const seat = String(findValue_(r, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
      let day = extractCanonicalDay_(r) || inferDayFromSeatCode_(seat) || '1';
      const seq = String(findValue_(r, ['Urutan_Panggil', 'Urutan Panggil']) || '').trim();

      if (idWsd) {
        existingCallByStudentId[idWsd] = r;
        duplicateMeta.callStudentCounts[idWsd] = (duplicateMeta.callStudentCounts[idWsd] || 0) + 1;
      }
      if (nim) existingCallByNim[nim] = r;
      if (seq) {
        const key = day + ':' + seq;
        duplicateMeta.callSeqCounts[key] = (duplicateMeta.callSeqCounts[key] || 0) + 1;
        if (duplicateMeta.callSeqCounts[key] > 1) {
          duplicateCallSeqErrors.push('Nomor urutan panggil ' + seq + ' (Hari ' + day + ') tercatat ganda pada DAFTAR_PANGGIL.');
        }
      }
    }
  });

  const seenSeatInPeriod = {};
  const duplicateSeatErrors = [];

  existingSeats.forEach(function (r) {
    const p = normalize_(findValue_(r, ['ID_Periode', 'ID Periode', 'Periode']));
    const seat = String(findValue_(r, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
    let day = extractCanonicalDay_(r) || inferDayFromSeatCode_(seat);
    if (!day) day = '1';

    if (seat) {
      occupiedSeats[day + ':' + seat] = true;
    }

    if (p === normalize_(periodId)) {
      const idWsd = normalize_(findValue_(r, ['ID_Wisudawan', 'ID Wisudawan']));
      const nim = normalize_(findValue_(r, ['NIM', 'Nomor Induk Mahasiswa']));
      const nama = findValue_(r, ['Nama_Lengkap', 'Nama_Wisudawan', 'Nama']);
      if (idWsd) {
        existingSeatByStudentId[idWsd] = r;
        duplicateMeta.seatStudentCounts[idWsd] = (duplicateMeta.seatStudentCounts[idWsd] || 0) + 1;
      }
      if (nim) existingSeatByNim[nim] = r;

      if (seat) {
        const seatKey = day + ':' + seat;
        duplicateMeta.seatCounts[seatKey] = (duplicateMeta.seatCounts[seatKey] || 0) + 1;
        if (seenSeatInPeriod[seatKey]) {
          duplicateSeatErrors.push({
            seatCode: seat,
            day: day,
            nim: nim,
            nama: nama,
            message: 'Kursi ganda: ' + seat + ' (Hari ' + day + ') telah dialokasikan lebih dari satu kali.'
          });
        }
        seenSeatInPeriod[seatKey] = true;
      }

      seatPlacementsList.push({
        seatCode: seat,
        day: day,
        idWisudawan: idWsd,
        nim: nim,
        gender: findValue_(r, ['Jenis_Kelamin', 'Jenis Kelamin']),
        row: findValue_(r, ['Baris'])
      });
    }
  });

  // 4. Deteksi duplikasi di DATA_WISUDAWAN periode target
  const seenIds = {};
  const seenNims = {};
  const duplicateErrors = [];

  periodStudents.forEach(function (st) {
    const idWsd = String(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
    const nim = String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
    const nama = String(findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) || '').trim();
    const statusNim = normalize_(findValue_(st, ['Status_NIM', 'Status NIM']));
    const isDummy = statusNim === 'dummy' || !nim || String(nim).startsWith('99');

    if (idWsd) {
      if (seenIds[idWsd]) {
        duplicateErrors.push('Duplikasi ID_Wisudawan: ' + idWsd + ' (' + nama + ')');
      }
      seenIds[idWsd] = true;
    }

    if (nim && !isDummy) {
      if (seenNims[nim]) {
        duplicateErrors.push('Duplikasi NIM: ' + nim + ' (' + nama + ')');
      }
      seenNims[nim] = true;
    }
  });

  // 5. Audit Validasi Status Sinkronisasi, Gender & Pengelompokan Unit/Hari
  const ambiguousGenderList = [];
  const invalidUnitList = [];
  const validStudents = [];
  const fullySyncedStudents = [];
  const partialSyncList = [];
  const syncConflictList = [];
  const newStudentsToSync = [];

  const breakdownByDayAndUnit = {
    '1': {},
    '2': {},
    '3': {}
  };

  periodStudents.forEach(function (st) {
    const idWsd = String(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
    const nim = String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
    const rawJk = findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']);
    const fac = String(findValue_(st, ['Fakultas']) || '').trim();
    const jenjang = String(findValue_(st, ['Jenjang']) || '').trim();
    const prodi = String(findValue_(st, ['Program_Studi', 'Program Studi']) || '').trim();
    const nama = String(findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) || '').trim();

    const genderClass = classifyGenderForSort_(rawJk);
    const expectedUnitInfo = inferUnitAndDayFromFacultyAndJenjang_(fac, jenjang, periodConfig);

    // Jalankan validasi silang komprehensif (cross-sheet validation)
    const syncValidation = validateStudentSyncStatus_(
      st,
      existingCallByStudentId,
      existingCallByNim,
      existingSeatByStudentId,
      existingSeatByNim,
      officialLayouts,
      duplicateMeta,
      periodConfig
    );

    if (syncValidation.status === 'penuh') {
      fullySyncedStudents.push(st);
    } else if (syncValidation.status === 'parsial') {
      partialSyncList.push({
        id_wisudawan: idWsd,
        nim: nim,
        nama: nama,
        fakultas: fac,
        program_studi: prodi,
        seatCode: syncValidation.seatCode,
        detail: syncValidation.issues.join('; ')
      });
    } else if (syncValidation.status === 'konflik') {
      syncConflictList.push({
        id_wisudawan: idWsd,
        nim: nim,
        nama: nama,
        fakultas: fac,
        program_studi: prodi,
        seatCode: syncValidation.seatCode,
        issues: syncValidation.issues
      });
    } else {
      // belum_tersinkron
      newStudentsToSync.push(st);
    }

    if (genderClass === 'Ambigu') {
      ambiguousGenderList.push({
        id_wisudawan: idWsd,
        nim: nim,
        nama: nama,
        fakultas: fac,
        program_studi: prodi,
        raw_gender: String(rawJk || '(kosong)'),
        syncStatus: syncValidation.status
      });
    } else if (!expectedUnitInfo.isValid) {
      invalidUnitList.push({
        id_wisudawan: idWsd,
        nim: nim,
        nama: nama,
        fakultas: fac,
        program_studi: prodi,
        reason: expectedUnitInfo.reason || 'Fakultas/Jenjang tidak dikenali atau belum dipetakan.'
      });
    } else {
      validStudents.push(st);
      const day = expectedUnitInfo.day;
      const unit = expectedUnitInfo.unit;

      if (!breakdownByDayAndUnit[day]) breakdownByDayAndUnit[day] = {};
      if (!breakdownByDayAndUnit[day][unit]) {
        breakdownByDayAndUnit[day][unit] = {
          day: day,
          unit: unit,
          faculty: fac,
          total: 0,
          female: 0,
          male: 0,
          fullySynced: 0,
          partialSync: 0,
          conflict: 0,
          newToSync: 0
        };
      }

      breakdownByDayAndUnit[day][unit].total++;
      if (genderClass === 'Perempuan') breakdownByDayAndUnit[day][unit].female++;
      else if (genderClass === 'Laki-laki') breakdownByDayAndUnit[day][unit].male++;

      if (syncValidation.status === 'penuh') {
        breakdownByDayAndUnit[day][unit].fullySynced++;
      } else if (syncValidation.status === 'parsial') {
        breakdownByDayAndUnit[day][unit].partialSync++;
      } else if (syncValidation.status === 'konflik') {
        breakdownByDayAndUnit[day][unit].conflict++;
      } else {
        breakdownByDayAndUnit[day][unit].newToSync++;
      }
    }
  });

  // 6. Simulasi Alokasi & Audit Kapasitas Tersisa (Dry-Run Allocation)
  const capacityAuditByUnit = [];
  let totalRemainingSeats = 0;
  const overflowList = [];

  if (!periodConfig || !periodConfig.isValid) {
    // Konfigurasi periode belum terdaftar; blocker ditambahkan pada langkah 8.
  } else if (isDynamicMode) {
    const validDayCap = buildingSummary ? buildingSummary.validSeatsPerDay : 798;
    for (const day of ['1', '2', '3']) {
      const dayStudents = validStudents.filter(function (st) {
        const fac = String(findValue_(st, ['Fakultas']) || '').trim();
        const j = String(findValue_(st, ['Jenjang']) || '').trim();
        const u = inferUnitAndDayFromFacultyAndJenjang_(fac, j, periodConfig);
        return u.isValid && u.day === day;
      });

      const allocRes = computeDynamicSectorAllocation_(dayStudents, periodConfig, day);
      if (!allocRes.success) {
        overflowList.push({
          day: day,
          unit: (periodConfig.days && periodConfig.days[day] ? periodConfig.days[day].join(', ') : 'Hari ' + day),
          gender: 'Sektor',
          overflowCount: dayStudents.length,
          message: allocRes.error
        });
      } else {
        totalRemainingSeats += allocRes.remainingSeats;
        capacityAuditByUnit.push({
          day: day,
          unit: (periodConfig.days && periodConfig.days[day] ? periodConfig.days[day].join(', ') : 'Hari ' + day),
          capacityOfficialTotal: validDayCap,
          femaleCount: allocRes.femaleCount,
          maleCount: allocRes.maleCount,
          femaleRows: allocRes.femaleRows,
          bufferRows: allocRes.bufferRows,
          maleRows: allocRes.maleRows,
          remainingSeats: allocRes.remainingSeats
        });
      }
    }
  } else {
    for (const day of ['1', '2', '3']) {
      const dayLayout = officialLayouts[day] || [];
      const dayUnits = (officialSummary && officialSummary.days[day] && officialSummary.days[day].units) || {};

      for (const unit in dayUnits) {
        const uStats = dayUnits[unit];
        const unitSeats = dayLayout.filter(function (s) { return (s[0] || '').split('-')[1] === unit; });
        const fSeats = unitSeats.filter(function (s) { return s[1] <= 12; });
        const mSeats = unitSeats.filter(function (s) { return s[1] >= 14; });

        const vacantF = fSeats.filter(function (s) { return !occupiedSeats[day + ':' + s[0].toUpperCase()]; });
        const vacantM = mSeats.filter(function (s) { return !occupiedSeats[day + ':' + s[0].toUpperCase()]; });

        let newFCount = 0;
        let newMCount = 0;

        newStudentsToSync.forEach(function (st) {
          const fac = String(findValue_(st, ['Fakultas']) || '').trim();
          const j = String(findValue_(st, ['Jenjang']) || '').trim();
          const u = inferUnitAndDayFromFacultyAndJenjang_(fac, j, periodConfig);
          if (u.day === day && u.unit === unit) {
            const g = classifyGenderForSort_(findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']));
            if (g === 'Perempuan') newFCount++;
            else if (g === 'Laki-laki') newMCount++;
          }
        });

        const remF = Math.max(0, vacantF.length - newFCount);
        const remM = Math.max(0, vacantM.length - newMCount);
        const overflowF = Math.max(0, newFCount - vacantF.length);
        const overflowM = Math.max(0, newMCount - vacantM.length);

        totalRemainingSeats += (remF + remM);

        if (overflowF > 0) {
          overflowList.push({
            day: day,
            unit: unit,
            gender: 'Perempuan',
            overflowCount: overflowF,
            message: 'Kekurangan ' + overflowF + ' kursi perempuan di unit ' + unit + ' Hari ' + day + ' (Tersedia: ' + vacantF.length + ', Butuh: ' + newFCount + ')'
          });
        }
        if (overflowM > 0) {
          overflowList.push({
            day: day,
            unit: unit,
            gender: 'Laki-laki',
            overflowCount: overflowM,
            message: 'Kekurangan ' + overflowM + ' kursi laki-laki di unit ' + unit + ' Hari ' + day + ' (Tersedia: ' + vacantM.length + ', Butuh: ' + newMCount + ')'
          });
        }

        capacityAuditByUnit.push({
          day: day,
          unit: unit,
          capacityOfficialTotal: uStats.total,
          capacityOfficialFemale: uStats.female,
          capacityOfficialMale: uStats.male,
          vacantFemaleAvailable: vacantF.length,
          vacantMaleAvailable: vacantM.length,
          newFemaleRequested: newFCount,
          newMaleRequested: newMCount,
          remainingFemale: remF,
          remainingMale: remM,
          overflowFemale: overflowF,
          overflowMale: overflowM
        });
      }
    }
  }

  // 7. Audit Integritas Penempatan yang Sudah Ada vs Layout Resmi / Geometri Gedung
  const placementAnomalies = [];
  if (!isDynamicMode) {
    seatPlacementsList.forEach(function (p) {
      const seatItem = (officialLayouts[p.day] || []).find(function (s) { return s[0].toUpperCase() === p.seatCode; });
      if (!seatItem) {
        placementAnomalies.push({
          seatCode: p.seatCode,
          day: p.day,
          reason: 'Kode kursi tidak ditemukan pada layout resmi Hari ' + p.day
        });
      } else {
        const row = seatItem[1];
        if (row === 13) {
          placementAnomalies.push({
            seatCode: p.seatCode,
            day: p.day,
            reason: 'Kursi berada di Baris 13 (Lorong Tengah)'
          });
        }
        const g = classifyGenderForSort_(p.gender);
        if (g === 'Perempuan' && row > 12) {
          placementAnomalies.push({
            seatCode: p.seatCode,
            day: p.day,
            reason: 'Wisudawati ditempatkan di baris belakang (Baris ' + row + ')'
          });
        } else if (g === 'Laki-laki' && row < 14) {
          placementAnomalies.push({
            seatCode: p.seatCode,
            day: p.day,
            reason: 'Wisudawan ditempatkan di baris depan (Baris ' + row + ')'
          });
        }
      }
    });
  }

  // 8. Evaluasi Kelayakan & Rekomendasi (Strict Blocker Policy)
  const blockers = [];
  const warnings = [];

  if (!periodConfig || !periodConfig.isValid) {
    blockers.push((periodConfig && periodConfig.error) || ('Konfigurasi alokasi untuk periode "' + periodId + '" belum tersedia.'));
  }
  if (invalidUnitList.length > 0) {
    blockers.push('Terdapat ' + invalidUnitList.length + ' wisudawan dengan Fakultas/Jenjang tidak dikenali atau belum dipetakan ke hari wisuda.');
  }

  if (periodStudents.length === 0) {
    blockers.push('Tidak ada data wisudawan aktif pada periode ' + periodName + '.');
  }
  if (duplicateErrors.length > 0) {
    blockers.push('Ditemukan ' + duplicateErrors.length + ' konflik identitas (ID_Wisudawan / NIM) di DATA_WISUDAWAN.');
  }
  if (duplicateSeatErrors.length > 0) {
    blockers.push('Ditemukan ' + duplicateSeatErrors.length + ' konflik kursi ganda pada penempatan eksisting.');
  }
  if (duplicateCallSeqErrors.length > 0) {
    blockers.push('Ditemukan ' + duplicateCallSeqErrors.length + ' konflik nomor urutan panggil ganda di DAFTAR_PANGGIL.');
  }
  if (ambiguousGenderList.length > 0) {
    blockers.push('Terdapat ' + ambiguousGenderList.length + ' wisudawan dengan data gender kosong atau tidak dikenali. Data ini TIDAK BOLEH dialokasikan otomatis dan memerlukan perbaikan admin.');
  }
  if (partialSyncList.length > 0) {
    blockers.push('Terdapat ' + partialSyncList.length + ' peserta dengan sinkronisasi parsial (hanya tercatat di DAFTAR_PANGGIL atau DENAH_KURSI saja). Harus diselesaikan Admin sebelum sinkronisasi.');
  }
  if (syncConflictList.length > 0) {
    blockers.push('Terdapat ' + syncConflictList.length + ' peserta dengan alokasi bertentangan (konflik nomor kursi antar-sheet, kursi di luar layout resmi, atau pelanggaran sektor gender).');
  }
  if (placementAnomalies.length > 0) {
    blockers.push('Ditemukan ' + placementAnomalies.length + ' penempatan eksisting yang tidak sesuai OFFICIAL_DAY_LAYOUTS_ atau melanggar sektor gender.');
  }
  if (overflowList.length > 0) {
    blockers.push('Terdapat ' + overflowList.length + ' kelompok peserta yang melampaui kapasitas resmi gedung (' + overflowList.map(function (o) { return o.message; }).join('; ') + ').');
  }

  // Gabungkan seluruh daftar yang tidak tertampung untuk tindakan Admin
  const unallocatedList = [];
  ambiguousGenderList.forEach(function (ag) {
    unallocatedList.push({
      id_wisudawan: ag.id_wisudawan,
      nim: ag.nim,
      nama: ag.nama,
      fakultas: ag.fakultas,
      program_studi: ag.program_studi,
      reason: 'Gender kosong atau belum terverifikasi ("' + ag.raw_gender + '"). Ditahan untuk pemeriksaan Admin.'
    });
  });
  partialSyncList.forEach(function (ps) {
    unallocatedList.push({
      id_wisudawan: ps.id_wisudawan,
      nim: ps.nim,
      nama: ps.nama,
      fakultas: ps.fakultas,
      program_studi: ps.program_studi,
      reason: 'Sinkronisasi Parsial: ' + ps.detail
    });
  });
  syncConflictList.forEach(function (sc) {
    unallocatedList.push({
      id_wisudawan: sc.id_wisudawan,
      nim: sc.nim,
      nama: sc.nama,
      fakultas: sc.fakultas,
      program_studi: sc.program_studi,
      reason: 'Konflik Alokasi (' + sc.seatCode + '): ' + sc.issues.join('; ')
    });
  });
  overflowList.forEach(function (ov) {
    unallocatedList.push({
      id_wisudawan: '-',
      nim: '-',
      nama: 'Peserta Kelebihan Kuota',
      fakultas: ov.unit,
      program_studi: ov.unit,
      reason: ov.message
    });
  });

  const isReadyForSync = blockers.length === 0;

  let recommendation = '';
  if (isReadyForSync && warnings.length === 0) {
    recommendation = 'Periode SIAP DISINKRONKAN. Seluruh data valid, gender terverifikasi 100%, kapasitas mencukupi, tidak ada kursi ganda atau penempatan tidak valid, dan isolasi periode lain terjamin aman.';
  } else if (isReadyForSync) {
    recommendation = 'Periode DAPAT DISINKRONKAN DENGAN CATATAN. Tidak ada kesalahan pemblokir data induk, namun perhatikan peringatan operasional.';
  } else {
    recommendation = 'PERIODE BELUM LAYAK DISINKRONKAN (DITEMUKAN ' + blockers.length + ' BLOCKER). Perbaikan dan peninjauan Admin mutlak diperlukan sebelum sinkronisasi dapat dijalankan.';
  }

  return {
    success: true,
    statusText: isReadyForSync ? 'SIAP DISINKRONKAN' : 'BELUM SIAP (TERDAPAT BLOCKER)',
    periodId: periodId,
    periodName: periodName,
    allocationMode: (periodConfig && periodConfig.mode) || 'unconfigured',
    summary: {
      totalStudents: periodStudents.length,
      fullySyncedCount: fullySyncedStudents.length,
      partialSyncCount: partialSyncList.length,
      syncConflictCount: syncConflictList.length,
      alreadySynced: fullySyncedStudents.length,
      newToSync: newStudentsToSync.length,
      ambiguousGenderCount: ambiguousGenderList.length,
      invalidUnitCount: invalidUnitList.length,
      duplicateIdentityCount: duplicateErrors.length,
      duplicateSeatCount: duplicateSeatErrors.length,
      duplicateCallSeqCount: duplicateCallSeqErrors.length,
      placementAnomalyCount: placementAnomalies.length,
      overflowCount: overflowList.length,
      totalRemainingSeats: totalRemainingSeats,
      officialTotalCapacity: isDynamicMode ? (buildingSummary ? buildingSummary.totalCapacity : 2394) : (officialSummary ? officialSummary.grandTotal.total : 1633),
      otherPeriodsCallCount: otherPeriodsCallCount,
      otherPeriodsSeatCount: otherPeriodsSeatCount
    },
    breakdownByDayAndUnit: breakdownByDayAndUnit,
    capacityAuditByUnit: capacityAuditByUnit,
    ambiguousGenderList: ambiguousGenderList,
    partialSyncList: partialSyncList,
    syncConflictList: syncConflictList,
    duplicateErrors: duplicateErrors,
    duplicateSeatErrors: duplicateSeatErrors,
    overflowList: overflowList,
    unallocatedList: unallocatedList,
    placementAnomalies: placementAnomalies,
    blockers: blockers,
    warnings: warnings,
    isReadyForSync: isReadyForSync,
    recommendation: recommendation
  };
}

/**
 * Sinkronisasi data wisudawan hasil impor ke DAFTAR_PANGGIL dan DENAH_KURSI.
 * Aturan resmi:
 * 1. Perempuan terlebih dahulu, lalu laki-laki.
 * 2. Penomoran dan kode kursi fisik mengikuti urutan resmi denah 2D gedung.
 * 3. Idempoten: data yang sudah memiliki nomor panggil/kursi tidak digandakan.
 * 4. Status pemanggilan eksisting tidak direset.
 */
function syncPeriodOperations(periodId) {
  const session = requireRole_(['Admin']);
  periodId = String(periodId || '').trim();
  if (!periodId) {
    periodId = resolveTargetPeriodId_('');
  }
  if (!periodId) {
    throw new Error('Periode wisuda tujuan belum ditentukan.');
  }

  const allPeriods = (typeof getRows_ === 'function') ? getRows_(CONFIG.SHEETS.PERIOD) : [];
  const targetPeriodRow = allPeriods.find(function (p) {
    return normalize_(findValue_(p, ['ID_Periode', 'ID Periode'])) === normalize_(periodId);
  });
  const periodName = targetPeriodRow
    ? String(findValue_(targetPeriodRow, ['Nama_Periode', 'Nama Periode', 'Nama']) || periodId).trim()
    : periodId;

  // 1. Jalankan Pre-Flight Check terlebih dahulu (Safety Blocker Guard).
  // Jangan pernah melakukan perubahan pada spreadsheet jika ada blocker!
  const preflight = preflightCheckPeriodOperations(periodId);
  if (!preflight || !preflight.isReadyForSync) {
    const blockers = (preflight && preflight.blockers) || ['Pemeriksaan kelayakan operasional gagal.'];
    return {
      success: false,
      periodId: periodId,
      periodName: periodName,
      totalStudents: (preflight && preflight.summary && preflight.summary.totalStudents) || 0,
      alreadySynced: (preflight && preflight.summary && preflight.summary.fullySyncedCount) || 0,
      partialSyncCount: (preflight && preflight.summary && preflight.summary.partialSyncCount) || 0,
      conflictCount: (preflight && preflight.summary && preflight.summary.syncConflictCount) || 0,
      newlySynced: 0,
      unallocatedCount: (preflight && preflight.unallocatedList && preflight.unallocatedList.length) || blockers.length,
      unallocatedList: (preflight && preflight.unallocatedList) || blockers.map(function (b) { return { reason: b }; }),
      blockers: blockers,
      message: 'Sinkronisasi dibatalkan demi keamanan data: Ditemukan ' + blockers.length + ' blocker pada audit pre-flight. Selesaikan permasalahan data berikut terlebih dahulu: ' + blockers.join(' | ')
    };
  }

  // 2. Ambil data wisudawan aktif untuk periode ini
  const allStudents = getRows_(CONFIG.SHEETS.STUDENTS);
  const periodStudents = allStudents.filter(function (row) {
    const p = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    const statusData = normalize_(findValue_(row, ['Status_Data', 'Status Data', 'Status']));
    return p === normalize_(periodId) && statusData !== 'nonaktif';
  });

  if (!periodStudents.length) {
    return {
      success: false,
      periodId: periodId,
      periodName: periodName,
      totalStudents: 0,
      alreadySynced: 0,
      newlySynced: 0,
      message: 'Tidak ada data wisudawan aktif pada periode ' + periodName + '.'
    };
  }

  // 3. Ambil data eksisting di DAFTAR_PANGGIL dan DENAH_KURSI
  const callSheet = getSheet_(CONFIG.SHEETS.CALL_LIST);
  const seatSheet = getSheet_(CONFIG.SHEETS.SEATS);

  const existingCalls = getRows_(CONFIG.SHEETS.CALL_LIST);
  const existingSeats = getRows_(CONFIG.SHEETS.SEATS);

  const existingCallByStudentId = {};
  const existingCallByNim = {};
  const occupiedSeats = {};

  const duplicateMeta = {
    seatCounts: {},
    callSeqCounts: {},
    callStudentCounts: {},
    seatStudentCounts: {}
  };

  existingCalls.forEach(function (row) {
    const p = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (p === normalize_(periodId)) {
      const idWsd = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
      const nim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
      const seat = String(findValue_(row, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
      let day = extractCanonicalDay_(row) || inferDayFromSeatCode_(seat);
      const seq = String(findValue_(row, ['Urutan_Panggil', 'Urutan Panggil']) || '').trim();
      if (idWsd) {
        existingCallByStudentId[idWsd] = row;
        duplicateMeta.callStudentCounts[idWsd] = (duplicateMeta.callStudentCounts[idWsd] || 0) + 1;
      }
      if (nim) existingCallByNim[nim] = row;
      if (seq && day) {
        const key = day + ':' + seq;
        duplicateMeta.callSeqCounts[key] = (duplicateMeta.callSeqCounts[key] || 0) + 1;
      }
      if (seat && day) occupiedSeats[day + ':' + seat] = true;
    }
  });

  const existingSeatByStudentId = {};
  const existingSeatByNim = {};

  existingSeats.forEach(function (row) {
    const p = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (p === normalize_(periodId)) {
      const idWsd = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
      const nim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
      const seat = String(findValue_(row, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
      let day = extractCanonicalDay_(row) || inferDayFromSeatCode_(seat);
      if (idWsd) {
        existingSeatByStudentId[idWsd] = row;
        duplicateMeta.seatStudentCounts[idWsd] = (duplicateMeta.seatStudentCounts[idWsd] || 0) + 1;
      }
      if (nim) existingSeatByNim[nim] = row;
      if (seat && day) {
        occupiedSeats[day + ':' + seat] = true;
        duplicateMeta.seatCounts[day + ':' + seat] = (duplicateMeta.seatCounts[day + ':' + seat] || 0) + 1;
      }
    }
  });

  // 4. Validasi status sinkronisasi komprehensif (cross-sheet validation)
  const fullySyncedStudents = [];
  const partialSyncStudents = [];
  const conflictedStudents = [];
  const toAllocateStudents = [];

  let officialLayouts = {};
  if (typeof getOfficialDayLayouts_ === 'function') {
    try { officialLayouts = getOfficialDayLayouts_() || {}; } catch (e) {}
  } else if (typeof OFFICIAL_DAY_LAYOUTS_ !== 'undefined') {
    officialLayouts = OFFICIAL_DAY_LAYOUTS_ || {};
  }

  const periodConfig = resolvePeriodAllocationConfig_(periodId);
  const isDynamicMode = Boolean(periodConfig && periodConfig.isValid && periodConfig.mode === 'dynamic_expand');

  periodStudents.forEach(function (st) {
    const syncVal = validateStudentSyncStatus_(
      st,
      existingCallByStudentId,
      existingCallByNim,
      existingSeatByStudentId,
      existingSeatByNim,
      officialLayouts,
      duplicateMeta,
      periodConfig
    );

    if (syncVal.status === 'penuh') {
      fullySyncedStudents.push(st);
    } else if (syncVal.status === 'parsial') {
      partialSyncStudents.push({ st: st, validation: syncVal });
    } else if (syncVal.status === 'konflik') {
      conflictedStudents.push({ st: st, validation: syncVal });
    } else {
      toAllocateStudents.push(st);
    }
  });

  // Jika terdapat data parsial atau konflik, jangan lanjutkan penulisan otomatis!
  if (partialSyncStudents.length > 0 || conflictedStudents.length > 0) {
    const errorDetails = [];
    partialSyncStudents.forEach(function (item) {
      errorDetails.push('Parsial: ' + findValue_(item.st, ['NIM']) + ' - ' + findValue_(item.st, ['Nama_Lengkap', 'Nama']) + ' (' + item.validation.issues.join('; ') + ')');
    });
    conflictedStudents.forEach(function (item) {
      errorDetails.push('Konflik: ' + findValue_(item.st, ['NIM']) + ' - ' + findValue_(item.st, ['Nama_Lengkap', 'Nama']) + ' (' + item.validation.issues.join('; ') + ')');
    });

    return {
      success: false,
      periodId: periodId,
      periodName: periodName,
      totalStudents: periodStudents.length,
      alreadySynced: fullySyncedStudents.length,
      partialSyncCount: partialSyncStudents.length,
      conflictCount: conflictedStudents.length,
      newlySynced: 0,
      unallocatedCount: partialSyncStudents.length + conflictedStudents.length,
      unallocatedList: errorDetails.map(function (err) { return { reason: err }; }),
      message: 'Sinkronisasi dibatalkan demi keamanan data: Ditemukan ' + (partialSyncStudents.length + conflictedStudents.length) + ' data eksisting berstatus parsial atau konflik penempatan. Periksa hasil audit pre-flight dan selesaikan terlebih dahulu.'
    };
  }

  if (!toAllocateStudents.length) {
    return {
      success: true,
      periodId: periodId,
      periodName: periodName,
      totalStudents: periodStudents.length,
      alreadySynced: fullySyncedStudents.length,
      newlySynced: 0,
      unallocatedCount: 0,
      unallocatedList: [],
      message: 'Seluruh ' + periodStudents.length + ' wisudawan pada ' + periodName + ' sudah tersinkronisasi penuh dan valid ke Daftar Panggil dan Denah Kursi.'
    };
  }

  const newCallRowsData = [];
  const newSeatRowsData = [];
  const unallocatedList = [];

  let day1Count = 0;
  let day2Count = 0;
  let day3Count = 0;

  if (isDynamicMode) {
    // Mode Dinamis (Cross-Aisle + Buffer >= 1 baris kursi valid): All-or-nothing per periode
    const studentsByDay = { '1': [], '2': [], '3': [] };
    for (let i = 0; i < toAllocateStudents.length; i++) {
      const st = toAllocateStudents[i];
      const fac = findValue_(st, ['Fakultas']);
      const jenjang = findValue_(st, ['Jenjang']);
      const inferred = inferUnitAndDayFromFacultyAndJenjang_(fac, jenjang, periodConfig);
      if (!inferred.isValid || !studentsByDay[inferred.day]) {
        return {
          success: false,
          periodId: periodId,
          periodName: periodName,
          totalStudents: periodStudents.length,
          alreadySynced: fullySyncedStudents.length,
          newlySynced: 0,
          unallocatedCount: 1,
          unallocatedList: [{ reason: inferred.reason || 'Unit/hari wisudawan tidak valid.' }],
          message: 'Sinkronisasi dibatalkan (0 baris ditulis): ' + (inferred.reason || 'Unit/hari wisudawan tidak valid.')
        };
      }
      studentsByDay[inferred.day].push(st);
    }

    const dynamicResultsByDay = {};
    for (const dayKey of ['1', '2', '3']) {
      const allocRes = computeDynamicSectorAllocation_(studentsByDay[dayKey], periodConfig, dayKey);
      if (!allocRes.success) {
        return {
          success: false,
          periodId: periodId,
          periodName: periodName,
          totalStudents: periodStudents.length,
          alreadySynced: fullySyncedStudents.length,
          newlySynced: 0,
          unallocatedCount: studentsByDay[dayKey].length,
          unallocatedList: [{ day: dayKey, reason: allocRes.error }],
          message: 'Sinkronisasi dibatalkan (0 baris ditulis) karena Hari ' + dayKey + ' gagal alokasi: ' + allocRes.error
        };
      }
      dynamicResultsByDay[dayKey] = allocRes;
    }

    ['1', '2', '3'].forEach(function (dayKey) {
      const allocs = dynamicResultsByDay[dayKey].allocations || [];
      allocs.forEach(function (a) {
        const st = a.student;
        const idWsd = String(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) || ('WSD-' + Utilities.getUuid().slice(0, 8).toUpperCase())).trim();
        const nim = String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
        const nama = String(findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) || '').trim();
        const fac = String(findValue_(st, ['Fakultas']) || '').trim();
        const prodi = String(findValue_(st, ['Program_Studi', 'Program Studi']) || '').trim();
        const tmpLahir = String(findValue_(st, ['Tempat_Lahir', 'Tempat Lahir']) || '').trim();
        const tglLahir = String(findValue_(st, ['Tanggal_Lahir', 'Tanggal Lahir']) || '').trim();
        const ipk = String(findValue_(st, ['IPK']) || '').trim();
        const predikat = String(findValue_(st, ['Predikat']) || '').trim();

        if (dayKey === '1') day1Count++;
        else if (dayKey === '2') day2Count++;
        else if (dayKey === '3') day3Count++;

        newCallRowsData.push({
          id_panggil: 'PGL-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
          id_periode: periodId,
          id_wisudawan: idWsd,
          nim: nim,
          nama_wisudawan: nama,
          fakultas: fac,
          program_studi: prodi,
          jenis_kelamin: a.gender,
          tempat_lahir: tmpLahir,
          tanggal_lahir: tglLahir,
          ipk: ipk,
          predikat: predikat,
          nomor_kursi: a.seatCode,
          hari_ke: dayKey,
          urutan_panggil: a.callOrder,
          status_panggil: 'Belum Dipanggil',
          waktu_panggil: ''
        });

        newSeatRowsData.push({
          id_kursi: 'KRS-' + a.seatCode,
          id_periode: periodId,
          hari_ke: dayKey,
          nomor_kursi: a.seatCode,
          id_wisudawan: idWsd,
          nama_lengkap: nama,
          fakultas: fac,
          jenis_kelamin: a.gender,
          blok: a.blok,
          baris: a.row,
          kolom: a.col,
          status_kursi: 'Terdaftar'
        });
      });
    });
  } else {
    // 4. Kelompokkan toAllocateStudents berdasarkan Hari & Unit (legacy_2026)
    const groups = {};
    toAllocateStudents.forEach(function (st) {
      const fac = findValue_(st, ['Fakultas']);
      const jenjang = findValue_(st, ['Jenjang']);
      const rawSeat = String(findValue_(st, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim();

      let day = '';
      let unit = '';

      if (rawSeat) {
        day = inferDayFromSeatCode_(rawSeat);
        unit = rawSeat.split('-')[1] || '';
      }
      if (!day || !unit) {
        const inferred = inferUnitAndDayFromFacultyAndJenjang_(fac, jenjang, periodConfig);
        day = inferred.day;
        unit = inferred.unit;
      }

      if (!day || !unit) {
        day = '1';
        unit = 'S';
      }

      const key = day + ':' + unit;
      if (!groups[key]) groups[key] = [];
      groups[key].push(st);
    });

    // 5. Alokasikan kursi untuk setiap kelompok (menggunakan officialLayouts)
    const seatOrderMap = (typeof buildSeatOrderIndexMap_ === 'function') ? buildSeatOrderIndexMap_() : {};

    for (const groupKey in groups) {
    const parts = groupKey.split(':');
    const day = parts[0];
    const unit = parts[1];
    const studentsInGroup = groups[groupKey];

    // Pisahkan wisudawan berdasarkan gender untuk penempatan fisik resmi:
    // Baris 1-12: Khusus wisudawati (perempuan)
    // Baris 14-25: Khusus wisudawan (laki-laki)
    const femalesInGroup = [];
    const malesInGroup = [];

    studentsInGroup.forEach(function (st) {
      const jkVal = findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']);
      const genderClass = classifyGenderForSort_(jkVal);
      if (genderClass === 'Perempuan') {
        femalesInGroup.push(st);
      } else if (genderClass === 'Laki-laki') {
        malesInGroup.push(st);
      } else {
        const idWsd = String(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
        const nim = String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
        const nama = String(findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) || '').trim();
        const fac = String(findValue_(st, ['Fakultas']) || '').trim();

        unallocatedList.push({
          id_wisudawan: idWsd,
          nim: nim,
          nama: nama,
          fakultas: fac,
          unit: unit,
          day: day,
          jenis_kelamin: String(jkVal || '(kosong)'),
          reason: 'Data gender kosong atau belum terverifikasi (' + (jkVal || 'kosong') + '). Ditahan untuk pemeriksaan Admin; tidak dapat dialokasikan otomatis.'
        });
      }
    });

    const sortFn = function (a, b) {
      const pA = String(findValue_(a, ['Program_Studi', 'Program Studi']) || '');
      const pB = String(findValue_(b, ['Program_Studi', 'Program Studi']) || '');
      const facA = String(findValue_(a, ['Fakultas']) || '');
      const rankA = getProdiRankForSort_(pA, facA);
      const rankB = getProdiRankForSort_(pB, facA);
      if (rankA !== rankB) return rankA - rankB;

      const nimA = String(findValue_(a, ['NIM', 'Nomor Induk Mahasiswa']) || '');
      const nimB = String(findValue_(b, ['NIM', 'Nomor Induk Mahasiswa']) || '');
      return nimA.localeCompare(nimB);
    };

    femalesInGroup.sort(sortFn);
    malesInGroup.sort(sortFn);

    // Ambil seluruh kursi resmi unit ini pada hari terkait
    const dayLayout = (officialLayouts[day] || []).slice();
    const unitSeats = dayLayout.filter(function (s) {
      const u = (s[0] || '').split('-')[1];
      return u === unit;
    });

    // Urutkan kursi berdasarkan tata letak fisik
    unitSeats.sort(function (a, b) {
      if (a[1] !== b[1]) return a[1] - b[1]; // Baris ascending
      if (a[2] !== b[2]) return b[2] - a[2]; // Kanan (1) before Kiri (0)
      return b[3] - a[3]; // Kolom 17 down to 1
    });

    // Saring kursi perempuan (baris depan: 1..12) dan laki-laki (baris belakang: 14..25)
    const unitFemaleSeats = unitSeats.filter(function (s) { return s[1] <= 12; });
    const unitMaleSeats = unitSeats.filter(function (s) { return s[1] >= 14; });

    const vacantFemaleSeats = unitFemaleSeats.filter(function (s) {
      const seatCode = String(s[0] || '').trim().toUpperCase();
      return !occupiedSeats[day + ':' + seatCode];
    });

    const vacantMaleSeats = unitMaleSeats.filter(function (s) {
      const seatCode = String(s[0] || '').trim().toUpperCase();
      return !occupiedSeats[day + ':' + seatCode];
    });

    // Helper untuk alokasi satu peserta ke satu kursi
    function allocateStudentToSeat(st, chosenSeat, genderLabel) {
      const idWsd = String(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) || ('WSD-' + Utilities.getUuid().slice(0, 8).toUpperCase())).trim();
      const nim = String(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
      const nama = String(findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) || '').trim();
      const fac = String(findValue_(st, ['Fakultas']) || '').trim();
      const prodi = String(findValue_(st, ['Program_Studi', 'Program Studi']) || '').trim();
      const rawJk = findValue_(st, ['Jenis_Kelamin', 'Jenis Kelamin']);
      const jk = genderLabel || ((typeof normalizeGender_ === 'function' ? normalizeGender_(rawJk) : '') || (isFemaleGenderForSort_(rawJk) ? 'Perempuan' : 'Laki-laki'));
      const tmpLahir = String(findValue_(st, ['Tempat_Lahir', 'Tempat Lahir']) || '').trim();
      const tglLahir = String(findValue_(st, ['Tanggal_Lahir', 'Tanggal Lahir']) || '').trim();
      const ipk = String(findValue_(st, ['IPK']) || '').trim();
      const predikat = String(findValue_(st, ['Predikat']) || '').trim();

      if (chosenSeat) {
        const seatCode = chosenSeat[0];
        const baris = chosenSeat[1];
        const blok = chosenSeat[2] === 1 ? 'Kanan' : 'Kiri';
        const kolom = chosenSeat[3];

        occupiedSeats[day + ':' + seatCode.toUpperCase()] = true;

        if (day === '1') day1Count++;
        else if (day === '2') day2Count++;
        else if (day === '3') day3Count++;

        const urutanPanggil = seatOrderMap[day + ':' + seatCode.toUpperCase()] || '';

        newCallRowsData.push({
          id_panggil: 'PGL-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
          id_periode: periodId,
          id_wisudawan: idWsd,
          nim: nim,
          nama_wisudawan: nama,
          fakultas: fac,
          program_studi: prodi,
          jenis_kelamin: jk,
          tempat_lahir: tmpLahir,
          tanggal_lahir: tglLahir,
          ipk: ipk,
          predikat: predikat,
          nomor_kursi: seatCode,
          hari_ke: day,
          urutan_panggil: urutanPanggil,
          status_panggil: 'Belum Dipanggil',
          waktu_panggil: ''
        });

        newSeatRowsData.push({
          id_kursi: 'KRS-' + seatCode,
          id_periode: periodId,
          hari_ke: day,
          nomor_kursi: seatCode,
          id_wisudawan: idWsd,
          nama_lengkap: nama,
          fakultas: fac,
          jenis_kelamin: jk,
          blok: blok,
          baris: baris,
          kolom: kolom,
          status_kursi: 'Terdaftar'
        });
      } else {
        const capacityDesc = (genderLabel === 'Perempuan' ? 'wisudawati (depan)' : 'wisudawan (belakang)') +
          ' unit ' + unit + ' pada Hari ' + day + ' penuh (' +
          (genderLabel === 'Perempuan' ? unitFemaleSeats.length : unitMaleSeats.length) + ' kursi)';

        unallocatedList.push({
          id_wisudawan: idWsd,
          nim: nim,
          nama: nama,
          fakultas: fac,
          unit: unit,
          day: day,
          jenis_kelamin: jk,
          reason: 'Kapasitas kursi fisik ' + capacityDesc
        });
      }
    }

    // 1. Alokasikan Wisudawati (Perempuan) terlebih dahulu
    let femaleSeatIdx = 0;
    femalesInGroup.forEach(function (st) {
      const explicitSeat = String(findValue_(st, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
      let chosenSeat = null;

      if (explicitSeat && !occupiedSeats[day + ':' + explicitSeat]) {
        const found = unitSeats.find(function (s) { return s[0].toUpperCase() === explicitSeat; });
        chosenSeat = found || [explicitSeat, 99, 1, 99];
      } else if (femaleSeatIdx < vacantFemaleSeats.length) {
        chosenSeat = vacantFemaleSeats[femaleSeatIdx++];
      }

      allocateStudentToSeat(st, chosenSeat, 'Perempuan');
    });

    // 2. Alokasikan Wisudawan (Laki-laki)
    let maleSeatIdx = 0;
    malesInGroup.forEach(function (st) {
      const explicitSeat = String(findValue_(st, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim().toUpperCase();
      let chosenSeat = null;

      if (explicitSeat && !occupiedSeats[day + ':' + explicitSeat]) {
        const found = unitSeats.find(function (s) { return s[0].toUpperCase() === explicitSeat; });
        chosenSeat = found || [explicitSeat, 99, 1, 99];
      } else if (maleSeatIdx < vacantMaleSeats.length) {
        chosenSeat = vacantMaleSeats[maleSeatIdx++];
      }

      allocateStudentToSeat(st, chosenSeat, 'Laki-laki');
    });
    }
  }

  // 6. Penulisan ke Google Sheets dengan LockService
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    if (newCallRowsData.length > 0) {
      appendMappedRowsToSheet_(callSheet, newCallRowsData, [
        'ID_Panggil', 'ID_Periode', 'ID_Wisudawan', 'NIM', 'Nama_Wisudawan',
        'Fakultas', 'Program_Studi', 'Jenis_Kelamin', 'Tempat_Lahir',
        'Tanggal_Lahir', 'IPK', 'Predikat', 'Nomor_Kursi', 'Hari_Ke',
        'Status_Panggil', 'Waktu_Panggil'
      ]);
    }

    if (newSeatRowsData.length > 0) {
      appendMappedRowsToSheet_(seatSheet, newSeatRowsData, [
        'ID_Kursi', 'ID_Periode', 'Hari_Ke', 'Nomor_Kursi', 'ID_Wisudawan',
        'Nama_Lengkap', 'Fakultas', 'Jenis_Kelamin', 'Blok', 'Baris',
        'Kolom', 'Status_Kursi'
      ]);
    }

    SpreadsheetApp.flush();

    logActivity_(
      session,
      'SINKRONISASI DAFTAR PANGGIL & KURSI',
      'OPERASIONAL',
      'Periode ' + periodId + '; Baru dialokasikan: ' + newCallRowsData.length + '; Sudah ada: ' + fullySyncedStudents.length + '; Belum teralokasi: ' + unallocatedList.length
    );

    return {
      success: true,
      periodId: periodId,
      periodName: periodName,
      totalStudents: periodStudents.length,
      alreadySynced: fullySyncedStudents.length,
      newlySynced: newCallRowsData.length,
      day1Count: day1Count,
      day2Count: day2Count,
      day3Count: day3Count,
      unallocatedCount: unallocatedList.length,
      unallocatedList: unallocatedList,
      message: 'Sinkronisasi berhasil! ' + newCallRowsData.length + ' wisudawan baru berhasil dialokasikan ke Daftar Panggil dan Denah Kursi. (' + fullySyncedStudents.length + ' peserta sudah terdaftar sebelumnya).'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Data Lulusan Terbaik terintegrasi dengan DATA_WISUDAWAN.
 * Menghubungkan penerima penghargaan melalui NIM atau ID_Wisudawan stabil.
 */
function getBestGraduates(filters) {
  requireRole_(['Admin']);
  filters = filters || {};
  const periodFilter = resolveTargetPeriodId_(filters.period);

  const bestRows = getRows_(CONFIG.SHEETS.BEST);
  const allStudents = getRows_(CONFIG.SHEETS.STUDENTS);

  const studentsByNim = {};
  const studentsById = {};

  allStudents.forEach(function (st) {
    const stPeriod = normalize_(findValue_(st, ['ID_Periode', 'ID Periode', 'Periode']));
    if (periodFilter && stPeriod && stPeriod !== periodFilter) return;

    const nim = normalize_(findValue_(st, ['NIM', 'Nomor Induk Mahasiswa']));
    const idWsd = normalize_(findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']));

    if (nim) {
      if (!studentsByNim[nim]) studentsByNim[nim] = [];
      studentsByNim[nim].push(st);
    }
    if (idWsd) {
      studentsById[idWsd] = st;
    }
  });

  const filteredBestRows = bestRows.filter(function (row) {
    const rowPeriod = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (periodFilter && rowPeriod && rowPeriod !== periodFilter) {
      return false;
    }
    return true;
  });

  return filteredBestRows.map(function (row) {
    const nim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    const idWsd = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));

    const matchedList = (nim && studentsByNim[nim]) || (idWsd && studentsById[idWsd] ? [studentsById[idWsd]] : []);

    let st = null;
    let statusVerifikasi = 'Terhubung ke Data Induk';
    let isValid = true;

    if (matchedList.length === 1) {
      st = matchedList[0];
      statusVerifikasi = 'Terhubung ke Data Induk';
      isValid = true;
    } else if (matchedList.length > 1) {
      st = matchedList[0];
      statusVerifikasi = 'Duplikasi NIM di Data Induk (' + matchedList.length + ' wisudawan)';
      isValid = false;
    } else {
      statusVerifikasi = periodFilter
        ? 'NIM Tidak Terdaftar pada Periode Ini'
        : 'NIM Belum Terdaftar di Data Induk';
      isValid = false;
    }

    const nama = st ? findValue_(st, ['Nama_Lengkap', 'Nama Wisudawan', 'Nama']) : findValue_(row, ['Nama', 'Nama_Lengkap', 'Nama Lengkap']);
    const fakultas = st ? findValue_(st, ['Fakultas']) : findValue_(row, ['Fakultas']);
    const prodi = st ? findValue_(st, ['Program_Studi', 'Program Studi']) : findValue_(row, ['Program_Studi', 'Program Studi']);
    const ipk = findValue_(row, ['IPK']) || (st ? findValue_(st, ['IPK']) : '');
    const predikat = findValue_(row, ['Predikat', 'Keterangan']) || (st ? findValue_(st, ['Predikat']) : '');

    return {
      Peringkat: findValue_(row, ['Peringkat', 'Ranking', 'No']) || '—',
      NIM: findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']) || (st ? findValue_(st, ['NIM']) : '—'),
      Nama: nama || '—',
      Nama_Lengkap: nama || '—',
      Fakultas: fakultas || '—',
      Program_Studi: prodi || '—',
      IPK: ipk || '—',
      Predikat: predikat || '—',
      Catatan: findValue_(row, ['Catatan', 'Keterangan']) || '—',
      Status_Verifikasi: statusVerifikasi,
      Is_Valid: isValid,
      ID_Wisudawan: st ? findValue_(st, ['ID_Wisudawan', 'ID Wisudawan']) : (idWsd || ''),
      ID_Periode: findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']) || periodFilter
    };
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
