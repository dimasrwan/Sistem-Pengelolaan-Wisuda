function getDashboardData(targetRole) {
  const session = requireRole_(['Admin', 'Panitia', 'Wisudawan'], targetRole);

  const result = {
    session: session,
    period: getActivePeriod_()
  };

  if (session.role === 'Panitia') {
    result.scannerOnly = true;
    return result;
  }

  if (session.role === 'Wisudawan') {
    const student = getStudentProfile_(session);

    result.student = student;
    result.callList = getStudentCallList_(session, student);
    result.seats = getStudentSeats_(session, student);

    return result;
  }

  const students = getRows_(CONFIG.SHEETS.STUDENTS);
  const calls = getRows_(CONFIG.SHEETS.CALL_LIST);
  const seats = getRows_(CONFIG.SHEETS.SEATS);
  const best = getRows_(CONFIG.SHEETS.BEST);

  result.stats = {
    totalStudents: students.length,
    totalCalls: calls.length,
    totalSeats: seats.length,
    totalBestGraduates: best.length
  };

  return result;
}

/* =========================
   DATA PRIBADI WISUDAWAN
   ========================= */


function getStudentProfile_(session) {
  const targetId = String((session && (session.studentId || session.ID_Wisudawan)) || '').trim();
  const id = normalize_(targetId);

  if (!id) {
    if (typeof logDiagnostic_ === 'function') {
      logDiagnostic_('STUDENT_PROFILE', {
        activeRole: session && session.role,
        userId: session && session.userId,
        studentId: '',
        matchedCount: 0,
        reason: 'studentId / ID_Wisudawan kosong pada session'
      });
    }
    return null;
  }

  const allStudents = getRows_(CONFIG.SHEETS.STUDENTS);
  const matched = allStudents.filter(function (row) {
    return [
      findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']),
      findValue_(row, ['NIM', 'Nomor Induk Mahasiswa'])
    ].some(function (value) {
      return normalize_(value) === id;
    });
  });

  if (!matched.length) {
    if (typeof logDiagnostic_ === 'function') {
      logDiagnostic_('STUDENT_PROFILE', {
        activeRole: session && session.role,
        userId: session && session.userId,
        studentId: targetId,
        matchedCount: 0,
        reason: 'Tidak ada baris DATA_WISUDAWAN yang cocok dengan ID/NIM: ' + targetId + ' (total baris: ' + allStudents.length + ')'
      });
    }
    return null;
  }

  const profile = matched[0];
  if (typeof logDiagnostic_ === 'function') {
    logDiagnostic_('STUDENT_PROFILE', {
      activeRole: session && session.role,
      userId: session && session.userId,
      studentId: targetId,
      matchedCount: matched.length,
      reason: 'Profil wisudawan ditemukan: ' + (findValue_(profile, ['Nama_Lengkap', 'Nama']) || targetId)
    });
  }

  return profile;
}


function getStudentCallList_(session, profile) {
  profile = profile || getStudentProfile_(session);
  if (!profile) return [];

  const studentId = normalize_(findValue_(profile, ['ID_Wisudawan', 'ID Wisudawan']));
  const nim = normalize_(findValue_(profile, ['NIM', 'Nomor Induk Mahasiswa']));
  const name = normalize_(findValue_(profile, ['Nama_Lengkap', 'Nama']));

  let targetPeriod = normalize_(findValue_(profile, ['ID_Periode', 'ID Periode', 'Periode']));
  if (!targetPeriod) {
    try {
      const active = typeof getActivePeriod_ === 'function' ? getActivePeriod_() : null;
      if (active && active.id) targetPeriod = normalize_(active.id);
    } catch (e) {}
  }

  const allCalls = getRows_(CONFIG.SHEETS.CALL_LIST);
  const matched = allCalls.filter(function (row) {
    const rowPeriod = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (targetPeriod && rowPeriod && rowPeriod !== targetPeriod) return false;

    const rowId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
    const rowNim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    const rowName = normalize_(findValue_(row, ['Nama_Lengkap', 'Nama', 'Nama_Wisudawan']));

    return (studentId && rowId === studentId) ||
      (nim && rowNim === nim) ||
      (!rowId && !rowNim && name && rowName === name);
  });

  return matched.map(function (row) {
    const urutan = findValue_(row, ['Urutan_Panggil', 'Urutan Panggil', 'Urutan', 'No']);
    const kelompok = findValue_(row, ['Kelompok_Panggil', 'Kelompok Panggil', 'Kelompok', 'Fakultas']) ||
      findValue_(profile, ['Fakultas', 'Kelompok']);
    const kursi = findValue_(row, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) ||
      findValue_(profile, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']);
    const status = findValue_(row, ['Status_Panggil', 'Status Panggil', 'Status']) || 'Belum Dipanggil';
    const waktu = findValue_(row, ['Waktu_Panggil', 'Waktu Panggil', 'Waktu']);
    const hari = findValue_(row, ['Hari_Ke', 'Hari Ke', 'Hari']) || findValue_(profile, ['Hari_Ke', 'Hari Ke', 'Hari']);

    return {
      ID_Panggil: findValue_(row, ['ID_Panggil', 'ID Panggil']),
      ID_Periode: findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']) || targetPeriod,
      ID_Wisudawan: findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']) || studentId,
      Nama_Wisudawan: findValue_(row, ['Nama_Wisudawan', 'Nama Wisudawan', 'Nama_Lengkap', 'Nama']) || findValue_(profile, ['Nama_Lengkap', 'Nama']),
      NIM: findValue_(profile, ['NIM', 'Nomor Induk Mahasiswa']) || findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']),
      Urutan_Panggil: urutan,
      Kelompok_Panggil: kelompok,
      Fakultas: kelompok,
      Program_Studi: findValue_(row, ['Program_Studi', 'Program Studi']) || findValue_(profile, ['Program_Studi', 'Program Studi']),
      Nomor_Kursi: kursi,
      Hari_Ke: hari,
      Status_Panggil: status,
      Waktu_Panggil: waktu
    };
  });
}


function getStudentSeats_(session, profile) {
  profile = profile || getStudentProfile_(session);
  if (!profile) return [];

  const studentId = normalize_(findValue_(profile, ['ID_Wisudawan', 'ID Wisudawan']));
  const nim = normalize_(findValue_(profile, ['NIM', 'Nomor Induk Mahasiswa']));
  const name = normalize_(findValue_(profile, ['Nama_Lengkap', 'Nama']));

  // 1. Dapatkan periode target (utamakan dari profil wisudawan, atau periode aktif)
  let targetPeriod = normalize_(findValue_(profile, ['ID_Periode', 'ID Periode', 'Periode']));
  if (!targetPeriod) {
    try {
      const active = typeof getActivePeriod_ === 'function' ? getActivePeriod_() : null;
      if (active && active.id) targetPeriod = normalize_(active.id);
    } catch (e) {}
  }

  // 2. Ambil baris alokasi kursi dari sheet DENAH_KURSI dengan filter periode dan wisudawan
  const allSeatRows = getRows_(CONFIG.SHEETS.SEATS);
  let matchingSeatRows = allSeatRows.filter(function (row) {
    const rowPeriod = normalize_(findValue_(row, ['ID_Periode', 'ID Periode', 'Periode']));
    if (targetPeriod && rowPeriod && rowPeriod !== targetPeriod) return false;

    const rowId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
    const rowNim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    const rowName = normalize_(findValue_(row, ['Nama_Lengkap', 'Nama', 'Nama_Wisudawan']));

    return (studentId && rowId === studentId) ||
      (nim && rowNim === nim) ||
      (!rowId && !rowNim && name && rowName === name);
  });

  // Jika tidak tercatat di sheet DENAH_KURSI namun tercatat di DATA_WISUDAWAN, gunakan data profil
  if (!matchingSeatRows.length) {
    const fallbackCode = String(findValue_(profile, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim();
    if (fallbackCode) {
      matchingSeatRows = [{
        ID_Kursi: 'KRS-' + fallbackCode,
        ID_Periode: targetPeriod,
        ID_Wisudawan: studentId,
        Nama_Wisudawan: findValue_(profile, ['Nama_Lengkap', 'Nama']),
        Nomor_Kursi: fallbackCode,
        Hari_Ke: findValue_(profile, ['Hari_Ke', 'Hari Ke']),
        Hari: findValue_(profile, ['Hari']),
        Status_Kursi: 'Terdaftar',
        Tanggal_Pelaksanaan: findValue_(profile, ['Tanggal_Pelaksanaan', 'Tanggal Pelaksanaan'])
      }];
    }
  }

  // 3. Ambil layout denah resmi (SeatLayoutData.gs)
  let officialLayouts = {};
  if (typeof getOfficialDayLayouts_ === 'function') {
    try {
      officialLayouts = getOfficialDayLayouts_() || {};
    } catch (e) {}
  } else if (typeof OFFICIAL_DAY_LAYOUTS_ !== 'undefined') {
    officialLayouts = OFFICIAL_DAY_LAYOUTS_ || {};
  }

  // 4. Petakan setiap kursi dengan koordinat fisik resmi gedung
  return matchingSeatRows.map(function (row) {
    const seatCode = String(findValue_(row, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || findValue_(profile, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim();

    // Tentukan hari pelaksanaan kanonikal (1, 2, atau 3)
    let day = typeof extractCanonicalDay_ === 'function' ? extractCanonicalDay_(row) : '';
    if (!day && typeof extractCanonicalDay_ === 'function') {
      day = extractCanonicalDay_(profile);
    }
    if (!day) {
      const rawDay = findValue_(row, ['Hari_Ke', 'Hari Ke', 'Hari']) || findValue_(profile, ['Hari_Ke', 'Hari Ke', 'Hari']);
      day = typeof normalizeDay_ === 'function' ? normalizeDay_(rawDay) : String(rawDay || '').trim();
    }
    if (!day) day = '1';

    // Cari koordinat fisik pada denah resmi
    const dayLayout = (officialLayouts && officialLayouts[day]) || [];
    const normCode = seatCode.toUpperCase();
    let found = dayLayout.find(function (item) {
      return String(item[0] || '').trim().toUpperCase() === normCode;
    });

    // Jika belum ditemukan di hari saat ini, periksa hari lain
    if (!found && officialLayouts) {
      const allDays = ['1', '2', '3'];
      for (let i = 0; i < allDays.length; i++) {
        if (allDays[i] === day) continue;
        const otherItems = officialLayouts[allDays[i]] || [];
        const cand = otherItems.find(function (item) {
          return String(item[0] || '').trim().toUpperCase() === normCode;
        });
        if (cand) {
          found = cand;
          day = allDays[i];
          break;
        }
      }
    }

    let blok = '';
    let baris = '';
    let kolom = '';
    let koordinatTersedia = false;
    let catatanKoordinat = '';

    const sheetBlok = String(findValue_(row, ['Blok']) || '').trim();
    const sheetBaris = String(findValue_(row, ['Baris']) || '').trim();
    const sheetKolom = String(findValue_(row, ['Kolom']) || '').trim();
    const hasSheetCoords = sheetBlok && sheetBaris && sheetKolom &&
      sheetBlok !== '—' && sheetBaris !== '—' && sheetKolom !== '—';

    if (found) {
      // Sesuai denah resmi: item = [Kode_Kursi, Baris, isKanan (1=Kanan, 0=Kiri), Kolom]
      baris = String(found[1]);
      blok = found[2] === 1 ? 'Kanan' : 'Kiri';
      kolom = String(found[3]);
      koordinatTersedia = true;
      catatanKoordinat = 'Sesuai denah fisik resmi UIN Ar-Raniry';
    } else if (hasSheetCoords) {
      blok = sheetBlok;
      baris = sheetBaris;
      kolom = sheetKolom;
      koordinatTersedia = true;
      catatanKoordinat = 'Sesuai data sheet denah kursi';
    } else {
      blok = 'Belum terpetakan';
      baris = 'Belum terpetakan';
      kolom = 'Belum terpetakan';
      koordinatTersedia = false;
      catatanKoordinat = 'Koordinat fisik belum terpetakan untuk kode kursi ' + (seatCode || '(kosong)') + ' pada jadwal Hari ' + day;
    }

    const statusKursi = findValue_(row, ['Status_Kursi', 'Status']) || 'Terdaftar';

    if (typeof logDiagnostic_ === 'function') {
      logDiagnostic_('STUDENT_SEATS', {
        activeRole: session && session.role,
        userId: session && session.userId,
        studentId: studentId,
        seatCode: seatCode,
        day: day,
        blok: blok,
        baris: baris,
        kolom: kolom,
        koordinatTersedia: koordinatTersedia,
        reason: catatanKoordinat
      });
    }

    return {
      ID_Kursi: findValue_(row, ['ID_Kursi', 'ID Kursi']) || ('KRS-' + seatCode),
      ID_Wisudawan: findValue_(profile, ['ID_Wisudawan', 'ID Wisudawan']) || findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']),
      Nama_Lengkap: findValue_(profile, ['Nama_Lengkap', 'Nama']) || findValue_(row, ['Nama_Wisudawan', 'Nama']),
      Nama_Wisudawan: findValue_(profile, ['Nama_Lengkap', 'Nama']) || findValue_(row, ['Nama_Wisudawan', 'Nama']),
      NIM: findValue_(profile, ['NIM', 'Nomor Induk Mahasiswa']) || findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']),
      Fakultas: findValue_(profile, ['Fakultas']) || findValue_(row, ['Fakultas']),
      Program_Studi: findValue_(profile, ['Program_Studi', 'Program Studi']) || findValue_(row, ['Program_Studi', 'Program Studi']),
      Jenis_Kelamin: findValue_(profile, ['Jenis_Kelamin', 'Jenis Kelamin']) || findValue_(row, ['Jenis_Kelamin', 'Jenis Kelamin']),
      Nomor_Kursi: seatCode,
      Blok: blok,
      Baris: baris,
      Kolom: kolom,
      Status_Kursi: statusKursi,
      Hari_Ke: day,
      Tanggal_Pelaksanaan: findValue_(row, ['Tanggal_Pelaksanaan', 'Tanggal Pelaksanaan']) || findValue_(profile, ['Tanggal_Pelaksanaan', 'Tanggal Pelaksanaan']),
      ID_Periode: targetPeriod,
      Koordinat_Tersedia: koordinatTersedia,
      Catatan_Koordinat: catatanKoordinat
    };
  });
}

/* =========================
   QR UNDANGAN TAMU (ROLE WISUDAWAN)
   ========================= */

function getMyGuestQrData() {
  const session = requireRole_(['Wisudawan']);
  const student = getStudentProfile_(session);

  if (!student) {
    return {
      success: false,
      code: 'NO_PROFILE',
      message: 'Data pribadi belum terhubung ke akun ini. Admin perlu mengisi ID_Wisudawan pada sheet PENGGUNA.'
    };
  }

  const idWisudawan = String(findValue_(student, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim();
  const rawNim = String(findValue_(student, ['NIM', 'Nomor Induk Mahasiswa']) || '').trim();
  const nama = String(findValue_(student, ['Nama_Lengkap', 'Nama']) || '').trim();
  const fakultas = String(findValue_(student, ['Fakultas']) || '').trim() || '—';
  const prodi = String(findValue_(student, ['Program_Studi', 'Program Studi']) || '').trim() || '—';
  const kursi = String(findValue_(student, ['Nomor_Kursi', 'Kode_Kursi', 'Kursi']) || '').trim() || '—';
  const periode = String(findValue_(student, ['ID_Periode', 'ID Periode', 'Periode']) || '').trim();

  // 1. Validasi NIM kosong / dummy
  const normNim = normalize_(rawNim);
  const isDummyNim = !rawNim || rawNim === '—' || rawNim === '-' || /^(0+|dummy|test|null|undefined)$/i.test(rawNim);

  if (!normNim || isDummyNim) {
    return {
      success: false,
      code: 'EMPTY_NIM',
      message: 'NIM resmi Anda belum tersedia pada data wisudawan sehingga QR undangan belum dapat dibuat. Silakan hubungi administrator untuk melengkapi data.',
      student: {
        idWisudawan: idWisudawan,
        nama: nama,
        nim: '',
        fakultas: fakultas,
        prodi: prodi,
        kursi: kursi,
        periode: periode
      }
    };
  }

  // 2. Validasi Ambigu / Duplikat NIM di DATA_WISUDAWAN
  const allStudents = getRows_(CONFIG.SHEETS.STUDENTS);
  const sameNimStudents = allStudents.filter(function (row) {
    const rowNim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    return rowNim && rowNim === normNim;
  });

  if (sameNimStudents.length > 1) {
    const uniqueIds = {};
    sameNimStudents.forEach(function (row) {
      const rowId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
      if (rowId) uniqueIds[rowId] = true;
    });

    if (Object.keys(uniqueIds).length > 1) {
      return {
        success: false,
        code: 'AMBIGUOUS_NIM',
        message: 'Ditemukan data duplikat untuk NIM Anda pada sistem. Silakan hubungi administrator untuk verifikasi data.',
        student: {
          idWisudawan: idWisudawan,
          nama: nama,
          nim: rawNim,
          fakultas: fakultas,
          prodi: prodi,
          kursi: kursi,
          periode: periode
        }
      };
    }
  }

  // 3. Validasi Periode
  let activePeriodId = '';
  try {
    const active = typeof getActivePeriod_ === 'function' ? getActivePeriod_() : null;
    if (active && active.id) activePeriodId = String(active.id).trim();
  } catch (e) {}

  const finalPeriod = periode || activePeriodId;

  return {
    success: true,
    code: 'OK',
    student: {
      idWisudawan: idWisudawan,
      nama: nama,
      nim: rawNim,
      fakultas: fakultas,
      prodi: prodi,
      kursi: kursi,
      periode: finalPeriod
    },
    qrPayload: 'NIM:' + rawNim,
    guestQuota: 1,
    note: 'Satu wisudawan hanya memiliki satu QR undangan tamu.'
  };
}
