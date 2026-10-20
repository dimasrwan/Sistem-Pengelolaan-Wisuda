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
   PRESENSI QR TAMU (POS MASUK & POS KELUAR)
   Admin dan Panitia
   ========================= */

function resolveWisudawanFromQr_(qrPayload, explicitPeriodId) {
  if (qrPayload == null) return null;

  var text = '';
  var payloadPeriod = '';

  if (typeof qrPayload === 'object') {
    text = String(
      qrPayload.ID_Wisudawan ||
      qrPayload.NIM ||
      qrPayload.id ||
      qrPayload.ID_Tamu ||
      qrPayload.idTamu ||
      qrPayload.idWisudawan ||
      qrPayload.nim ||
      qrPayload.code ||
      ''
    ).trim();
    if (qrPayload.ID_Periode || qrPayload.periodId || qrPayload.idPeriode) {
      payloadPeriod = String(qrPayload.ID_Periode || qrPayload.periodId || qrPayload.idPeriode).trim();
    }
  } else {
    text = String(qrPayload).trim();
    if (text.charAt(0) === '{' && text.charAt(text.length - 1) === '}') {
      try {
        var parsed = JSON.parse(text);
        return resolveWisudawanFromQr_(parsed, explicitPeriodId);
      } catch (e) {
        // Bukan JSON valid, lanjutkan sebagai teks biasa
      }
    }
  }

  if (!text) return null;

  // Bersihkan format awalan umum: TAMU:, TAMU-, WSD:, NIM:
  var cleanId = text;
  if (/^TAMU[:\-_]/i.test(cleanId)) {
    cleanId = cleanId.replace(/^TAMU[:\-_]\s*/i, '').trim();
  } else if (/^WSD[:\-_]/i.test(cleanId)) {
    cleanId = cleanId.replace(/^WSD[:\-_]\s*/i, function (match) {
      return match.indexOf(':') >= 0 ? '' : match;
    }).trim();
  } else if (/^NIM[:\-_]/i.test(cleanId)) {
    cleanId = cleanId.replace(/^NIM[:\-_]\s*/i, '').trim();
  }

  var normId = normalize_(cleanId);
  if (!normId) return null;

  var targetPeriod = resolveTargetPeriodId_(explicitPeriodId);

  // Jika QR menyertakan ID_Periode dan berbeda dengan periode aktif, tolak
  if (payloadPeriod && targetPeriod && normalize_(payloadPeriod) !== normalize_(targetPeriod)) {
    return {
      student: null,
      error: 'PERIOD_MISMATCH',
      message: 'Periode QR undangan (' + payloadPeriod + ') tidak sesuai dengan periode wisuda aktif (' + targetPeriod + ').'
    };
  }

  var allStudents = getRows_(CONFIG.SHEETS.STUDENTS);

  // Utamakan pencarian pada periode aktif
  var activeStudents = targetPeriod
    ? allStudents.filter(function (row) {
        return normalize_(findValue_(row, ['ID_Periode', 'ID Periode'])) === normalize_(targetPeriod);
      })
    : allStudents;

  var matchedStudent = activeStudents.find(function (row) {
    var studentId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
    var nim = normalize_(findValue_(row, ['NIM']));
    return (studentId && studentId === normId) || (nim && nim === normId);
  });

  // Jika tidak ditemukan di periode aktif, periksa apakah wisudawan dari periode lain
  if (!matchedStudent) {
    var otherPeriodStudent = allStudents.find(function (row) {
      var studentId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
      var nim = normalize_(findValue_(row, ['NIM']));
      return (studentId && studentId === normId) || (nim && nim === normId);
    });

    if (otherPeriodStudent) {
      var studentPeriod = findValue_(otherPeriodStudent, ['ID_Periode', 'ID Periode']);
      return {
        student: null,
        error: 'PERIOD_MISMATCH',
        message: 'Wisudawan ini terdaftar pada periode lain (' + studentPeriod + '), bukan periode aktif saat ini.'
      };
    }
  }

  // Jika masih belum cocok, cek apakah kode adalah ID_Tamu pada DATA_TAMU lama
  if (!matchedStudent) {
    try {
      var guestRows = getRows_(CONFIG.SHEETS.GUESTS);
      var guest = guestRows.find(function (row) {
        return normalize_(findValue_(row, ['ID_Tamu', 'ID Tamu'])) === normId;
      });
      if (guest) {
        var refId = normalize_(findValue_(guest, ['ID_Wisudawan', 'NIM', 'Nomor_Identitas_Terbatas']));
        if (refId) {
          matchedStudent = activeStudents.find(function (row) {
            var studentId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
            var nim = normalize_(findValue_(row, ['NIM']));
            return (studentId && studentId === refId) || (nim && nim === refId);
          });
        }
      }
    } catch (e) {}
  }

  if (!matchedStudent) return null;

  return {
    student: matchedStudent,
    targetPeriodId: targetPeriod || findValue_(matchedStudent, ['ID_Periode', 'ID Periode'])
  };
}

function formatStudentInfo_(student) {
  if (!student) return null;
  return {
    id: String(findValue_(student, ['ID_Wisudawan', 'ID Wisudawan']) || '').trim(),
    nim: String(findValue_(student, ['NIM']) || '').trim() || '—',
    name: String(findValue_(student, ['Nama_Lengkap', 'Nama Lengkap', 'Nama']) || '').trim(),
    faculty: String(findValue_(student, ['Fakultas']) || '').trim() || '—',
    prodi: String(findValue_(student, ['Program_Studi', 'Program Studi']) || '').trim() || '—',
    seat: String(findValue_(student, ['Nomor_Kursi', 'Nomor Kursi']) || '').trim() || '—',
    periodId: String(findValue_(student, ['ID_Periode', 'ID Periode']) || '').trim()
  };
}

function getGuestAttendanceSheetInfo_() {
  var sheet = getSheet_(CONFIG.SHEETS.GUEST_ATTENDANCE);
  var values = sheet.getDataRange().getDisplayValues();

  if (values.length === 0) {
    var defaultHeaders = ['ID_Presensi', 'ID_Periode', 'ID_Tamu', 'Waktu_Checkin', 'Metode_Presensi', 'Petugas', 'Status', 'Waktu_Keluar'];
    sheet.appendRow(defaultHeaders);
    return {
      sheet: sheet,
      values: [defaultHeaders],
      headers: defaultHeaders.map(normalize_),
      colMap: {
        id_presensi: 0,
        id_periode: 1,
        id_tamu: 2,
        waktu_checkin: 3,
        metode_presensi: 4,
        petugas: 5,
        status: 6,
        waktu_keluar: 7
      }
    };
  }

  var rawHeaders = values[0].slice();
  var headers = rawHeaders.map(normalize_);

  // Pastikan kolom Waktu_Keluar tersedia di baris header tanpa menghapus kolom lama
  var waktuKeluarIdx = headers.indexOf('waktu_keluar');
  if (waktuKeluarIdx < 0) {
    sheet.getRange(1, rawHeaders.length + 1).setValue('Waktu_Keluar');
    rawHeaders.push('Waktu_Keluar');
    headers.push('waktu_keluar');
  }

  var colMap = {};
  headers.forEach(function (h, idx) {
    colMap[h] = idx;
  });

  return {
    sheet: sheet,
    values: values,
    headers: headers,
    colMap: colMap
  };
}

function recordGuestEntry(qrPayload, method) {
  var session = requireRole_(['Admin', 'Panitia']);
  var resolved = resolveWisudawanFromQr_(qrPayload);

  if (!resolved || !resolved.student) {
    var errorMsg = resolved && resolved.message
      ? resolved.message
      : 'QR tidak valid atau data wisudawan tidak ditemukan pada periode ini.';
    return {
      success: false,
      resultCode: 'QR_TIDAK_VALID',
      badge: 'QR TIDAK VALID',
      message: errorMsg,
      currentStatus: 'TIDAK_DIKENAL'
    };
  }

  var student = resolved.student;
  var studentInfo = formatStudentInfo_(student);
  var targetPeriodId = resolved.targetPeriodId;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var info = getGuestAttendanceSheetInfo_();
    var sheet = info.sheet;
    var values = info.values;
    var colMap = info.colMap;

    var idWisudawanIdx = colMap['id_wisudawan'] != null ? colMap['id_wisudawan'] : -1;
    var idTamuIdx = colMap['id_tamu'] != null ? colMap['id_tamu'] : (idWisudawanIdx >= 0 ? idWisudawanIdx : 2);
    var statusIdx = colMap['status'] != null ? colMap['status'] : 6;
    var periodeIdx = colMap['id_periode'] != null ? colMap['id_periode'] : 1;

    var hasActiveInside = false;
    var activeCheckinTime = '';

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var rowPeriode = normalize_(row[periodeIdx]);
      var rowIdWisudawan = idWisudawanIdx >= 0 ? normalize_(row[idWisudawanIdx]) : '';
      var rowIdTamu = idTamuIdx >= 0 ? normalize_(row[idTamuIdx]) : '';
      var rowStatus = normalize_(row[statusIdx]);

      var matchesStudent = (rowIdWisudawan && (rowIdWisudawan === normalize_(studentInfo.id) || (studentInfo.nim && studentInfo.nim !== '—' && rowIdWisudawan === normalize_(studentInfo.nim)))) ||
        (rowIdTamu && (rowIdTamu === normalize_(studentInfo.id) || (studentInfo.nim && studentInfo.nim !== '—' && rowIdTamu === normalize_(studentInfo.nim))));
      var matchesPeriod = !targetPeriodId || rowPeriode === normalize_(targetPeriodId);

      if (matchesStudent && matchesPeriod && rowStatus === 'di_dalam') {
        hasActiveInside = true;
        if (colMap['waktu_checkin'] != null) {
          activeCheckinTime = row[colMap['waktu_checkin']];
        }
        break;
      }
    }

    if (hasActiveInside) {
      return {
        success: false,
        resultCode: 'DITOLAK_TAMU_SUDAH_DI_DALAM',
        badge: 'DITOLAK — TAMU SUDAH DI DALAM GEDUNG',
        message: 'Akses ditolak. Sudah ada tamu dari wisudawan ini di dalam gedung.',
        student: studentInfo,
        currentStatus: 'DI_DALAM',
        previousCheckinTime: activeCheckinTime || ''
      };
    }


    var now = new Date();
    var timeZone = Session.getScriptTimeZone() || 'Asia/Jakarta';
    var checkinTimeStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm:ss');
    var newId = 'PRS-' + Utilities.getUuid().slice(0, 8).toUpperCase();

    var newRow = new Array(info.headers.length).fill('');
    if (colMap['id_presensi'] != null) newRow[colMap['id_presensi']] = newId;
    if (colMap['id_periode'] != null) newRow[colMap['id_periode']] = targetPeriodId;
    if (colMap['id_wisudawan'] != null) newRow[colMap['id_wisudawan']] = studentInfo.id;
    if (colMap['id_tamu'] != null) newRow[colMap['id_tamu']] = studentInfo.id;
    if (colMap['waktu_checkin'] != null) newRow[colMap['waktu_checkin']] = checkinTimeStr;
    if (colMap['metode_presensi'] != null) newRow[colMap['metode_presensi']] = method || 'QR Code';
    if (colMap['petugas'] != null) newRow[colMap['petugas']] = session.email;
    if (colMap['status'] != null) newRow[colMap['status']] = 'DI_DALAM';
    if (colMap['waktu_keluar'] != null) newRow[colMap['waktu_keluar']] = '';

    sheet.appendRow(newRow);

    logActivity_(
      session.email,
      'SCAN TAMU MASUK',
      'PRESENSI_TAMU',
      'Wisudawan: ' + studentInfo.id + ' (' + studentInfo.name + ')'
    );

    return {
      success: true,
      resultCode: 'BERHASIL_MASUK',
      badge: 'BERHASIL MASUK',
      message: 'Berhasil masuk. Tamu dari ' + studentInfo.name + ' tercatat di dalam gedung.',
      student: studentInfo,
      currentStatus: 'DI_DALAM',
      time: checkinTimeStr
    };
  } finally {
    lock.releaseLock();
  }
}

function recordGuestExit(qrPayload, method) {
  var session = requireRole_(['Admin', 'Panitia']);
  var resolved = resolveWisudawanFromQr_(qrPayload);

  if (!resolved || !resolved.student) {
    var errorMsg = resolved && resolved.message
      ? resolved.message
      : 'QR tidak valid atau data wisudawan tidak ditemukan pada periode ini.';
    return {
      success: false,
      resultCode: 'QR_TIDAK_VALID',
      badge: 'QR TIDAK VALID',
      message: errorMsg,
      currentStatus: 'TIDAK_DIKENAL'
    };
  }

  var student = resolved.student;
  var studentInfo = formatStudentInfo_(student);
  var targetPeriodId = resolved.targetPeriodId;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var info = getGuestAttendanceSheetInfo_();
    var sheet = info.sheet;
    var values = info.values;
    var colMap = info.colMap;

    var idWisudawanIdx = colMap['id_wisudawan'] != null ? colMap['id_wisudawan'] : -1;
    var idTamuIdx = colMap['id_tamu'] != null ? colMap['id_tamu'] : (idWisudawanIdx >= 0 ? idWisudawanIdx : 2);
    var statusIdx = colMap['status'] != null ? colMap['status'] : 6;
    var periodeIdx = colMap['id_periode'] != null ? colMap['id_periode'] : 1;
    var waktuKeluarIdx = colMap['waktu_keluar'] != null ? colMap['waktu_keluar'] : -1;

    var activeRowIndex = -1;

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var rowPeriode = normalize_(row[periodeIdx]);
      var rowIdWisudawan = idWisudawanIdx >= 0 ? normalize_(row[idWisudawanIdx]) : '';
      var rowIdTamu = idTamuIdx >= 0 ? normalize_(row[idTamuIdx]) : '';
      var rowStatus = normalize_(row[statusIdx]);

      var matchesStudent = (rowIdWisudawan && (rowIdWisudawan === normalize_(studentInfo.id) || (studentInfo.nim && studentInfo.nim !== '—' && rowIdWisudawan === normalize_(studentInfo.nim)))) ||
        (rowIdTamu && (rowIdTamu === normalize_(studentInfo.id) || (studentInfo.nim && studentInfo.nim !== '—' && rowIdTamu === normalize_(studentInfo.nim))));
      var matchesPeriod = !targetPeriodId || rowPeriode === normalize_(targetPeriodId);

      if (matchesStudent && matchesPeriod && rowStatus === 'di_dalam') {
        activeRowIndex = r + 1; // 1-indexed untuk Google Sheet
        break;
      }
    }


    if (activeRowIndex < 0) {
      return {
        success: false,
        resultCode: 'DITOLAK_TIDAK_ADA_SESI_MASUK',
        badge: 'DITOLAK — TIDAK ADA SESI MASUK AKTIF',
        message: 'Ditolak — Tidak ada sesi masuk aktif untuk wisudawan ini. Tamu belum tercatat di dalam gedung.',
        student: studentInfo,
        currentStatus: 'DI_LUAR'
      };
    }

    var now = new Date();
    var timeZone = Session.getScriptTimeZone() || 'Asia/Jakarta';
    var exitTimeStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm:ss');

    sheet.getRange(activeRowIndex, statusIdx + 1).setValue('DI_LUAR');
    if (waktuKeluarIdx >= 0) {
      sheet.getRange(activeRowIndex, waktuKeluarIdx + 1).setValue(exitTimeStr);
    }

    logActivity_(
      session.email,
      'SCAN TAMU KELUAR',
      'PRESENSI_TAMU',
      'Wisudawan: ' + studentInfo.id + ' (' + studentInfo.name + ')'
    );

    return {
      success: true,
      resultCode: 'BERHASIL_KELUAR',
      badge: 'BERHASIL KELUAR',
      message: 'Berhasil keluar. Tamu dari ' + studentInfo.name + ' telah keluar gedung. Slot tamu kembali tersedia.',
      student: studentInfo,
      currentStatus: 'DI_LUAR',
      time: exitTimeStr
    };
  } finally {
    lock.releaseLock();
  }
}

function recordGuestAttendance(guestId, method, post) {
  if (post === 'out' || post === 'keluar') {
    return recordGuestExit(guestId, method);
  }
  return recordGuestEntry(guestId, method);
}

function getGuestAttendanceList(periodFilter) {
  requireRole_(['Admin', 'Panitia']);

  var targetPeriod = resolveTargetPeriodId_(periodFilter);
  var attendanceRows = getRows_(CONFIG.SHEETS.GUEST_ATTENDANCE);
  var studentRows = getRows_(CONFIG.SHEETS.STUDENTS);

  var studentMap = {};
  studentRows.forEach(function (s) {
    var sid = normalize_(findValue_(s, ['ID_Wisudawan', 'ID Wisudawan']));
    var snim = normalize_(findValue_(s, ['NIM']));
    if (sid) studentMap[sid] = s;
    if (snim) studentMap[snim] = s;
  });

  var list = [];
  attendanceRows.forEach(function (row) {
    var rowPeriod = normalize_(findValue_(row, ['ID_Periode', 'ID Periode']));
    if (targetPeriod && rowPeriod && rowPeriod !== normalize_(targetPeriod)) {
      return;
    }

    var idRef = String(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan', 'ID_Tamu', 'ID Tamu'])).trim();
    if (!idRef) return;

    var student = studentMap[normalize_(idRef)];
    var status = findValue_(row, ['Status']) || 'DI_LUAR';

    list.push({
      ID_Presensi: findValue_(row, ['ID_Presensi', 'ID Presensi']),
      ID_Periode: findValue_(row, ['ID_Periode', 'ID Periode']),
      ID_Wisudawan: student ? findValue_(student, ['ID_Wisudawan', 'ID Wisudawan']) : idRef,
      NIM: student ? (findValue_(student, ['NIM']) || '—') : (findValue_(row, ['NIM']) || '—'),
      Nama_Wisudawan: student ? findValue_(student, ['Nama_Lengkap', 'Nama Lengkap', 'Nama']) : (findValue_(row, ['Nama_Wisudawan', 'Nama Wisudawan']) || idTamu),
      Fakultas: student ? findValue_(student, ['Fakultas']) : '—',
      Program_Studi: student ? findValue_(student, ['Program_Studi', 'Program Studi']) : '—',
      Nomor_Kursi: student ? (findValue_(student, ['Nomor_Kursi', 'Nomor Kursi']) || '—') : '—',
      Status: status,
      Waktu_Checkin: findValue_(row, ['Waktu_Checkin', 'Waktu Checkin']) || '—',
      Waktu_Keluar: findValue_(row, ['Waktu_Keluar', 'Waktu Keluar']) || '—',
      Metode_Presensi: findValue_(row, ['Metode_Presensi', 'Metode Presensi']) || 'QR Code',
      Petugas: findValue_(row, ['Petugas']) || '—'
    });
  });

  return list.reverse();
}

