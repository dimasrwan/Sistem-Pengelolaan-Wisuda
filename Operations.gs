function updateCallStatus(callId, newStatus) {
  const session = requireRole_(['Admin']);

  const allowed = [
    'Belum Dipanggil',
    'Siap Dipanggil',
    'Sudah Dipanggil'
  ];

  if (allowed.indexOf(newStatus) === -1) {
    throw new Error('Status pemanggilan tidak valid.');
  }

  const sheet = getSheet_(CONFIG.SHEETS.CALL_LIST);
  const values = sheet.getDataRange().getDisplayValues();

  if (values.length < 2) {
    throw new Error('Daftar panggil masih kosong.');
  }

  const headers = values[0].map(normalize_);
  const idIndex = headers.indexOf('id_panggil');
  const statusIndex = headers.indexOf('status_panggil');

  if (idIndex < 0 || statusIndex < 0) {
    throw new Error('Kolom ID_Panggil atau Status_Panggil tidak ditemukan.');
  }

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idIndex]).trim() === String(callId).trim()) {
      sheet.getRange(r + 1, statusIndex + 1).setValue(newStatus);

      logActivity_(
        session.email,
        'UBAH STATUS PANGGIL',
        'DAFTAR PANGGIL',
        String(callId) + ' -> ' + newStatus
      );

      return {
        success: true,
        message: 'Status pemanggilan berhasil diperbarui.'
      };
    }
  }

  throw new Error('ID panggil tidak ditemukan.');
}

/* =========================
   LAPORAN
   ========================= */


function getReportData() {
  requireRole_(['Admin']);

  return {
    students: getRows_(CONFIG.SHEETS.STUDENTS),
    calls: getRows_(CONFIG.SHEETS.CALL_LIST),
    seats: getRows_(CONFIG.SHEETS.SEATS),
    bestGraduates: getRows_(CONFIG.SHEETS.BEST),
    guests: getRows_(CONFIG.SHEETS.GUESTS),
    guestAttendance: getRows_(CONFIG.SHEETS.GUEST_ATTENDANCE)
  };
}

/* =========================
   PRESENSI QR TAMU
   Admin dan Panitia
   ========================= */


function recordGuestAttendance(guestId, method) {
  const session = requireRole_(['Admin', 'Panitia']);
  const id = String(guestId || '').trim();

  if (!id) {
    throw new Error('ID tamu tidak boleh kosong.');
  }

  const guests = getRows_(CONFIG.SHEETS.GUESTS);
  const guest = guests.find(function (row) {
    return String(findValue_(row, ['ID_Tamu', 'ID Tamu'])).trim() === id;
  });

  if (!guest) {
    return {
      success: false,
      message: 'QR tidak dikenal. Data tamu tidak ditemukan.'
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const attendanceSheet = getSheet_(CONFIG.SHEETS.GUEST_ATTENDANCE);
    const attendance = getRows_(CONFIG.SHEETS.GUEST_ATTENDANCE);

    const alreadyRecorded = attendance.some(function (row) {
      const rowGuestId = String(
        findValue_(row, ['ID_Tamu', 'ID Tamu'])
      ).trim();

      const status = normalize_(findValue_(row, ['Status']));

      return rowGuestId === id &&
        status !== 'dibatalkan' &&
        status !== 'keluar';
    });

    if (alreadyRecorded) {
      return {
        success: false,
        duplicate: true,
        message: 'Tamu ini sudah tercatat masuk. Periksa undangan sebelum melanjutkan.'
      };
    }

    attendanceSheet.appendRow([
      Utilities.getUuid(),
      findValue_(guest, ['ID_Periode']),
      id,
      new Date(),
      method || 'QR Code',
      session.email,
      'Hadir'
    ]);

    logActivity_(
      session.email,
      'PRESENSI TAMU',
      'PRESENSI QR',
      'ID tamu: ' + id
    );

    return {
      success: true,
      message: 'Presensi berhasil dicatat untuk ' +
        findValue_(guest, ['Nama_Tamu', 'Nama Tamu'])
    };
  } finally {
    lock.releaseLock();
  }
}
