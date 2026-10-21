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
  const id = normalize_(session.studentId);
  if (!id) return null;

  return getRows_(CONFIG.SHEETS.STUDENTS).find(function (row) {
    return [
      findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']),
      findValue_(row, ['NIM', 'Nomor Induk Mahasiswa'])
    ].some(function (value) {
      return normalize_(value) === id;
    });
  }) || null;
}


function getStudentCallList_(session, profile) {
  profile = profile || getStudentProfile_(session);
  if (!profile) return [];

  const studentId = normalize_(findValue_(profile, ['ID_Wisudawan', 'ID Wisudawan']));
  const nim = normalize_(findValue_(profile, ['NIM', 'Nomor Induk Mahasiswa']));
  const name = normalize_(findValue_(profile, ['Nama_Lengkap', 'Nama']));

  return getRows_(CONFIG.SHEETS.CALL_LIST).filter(function (row) {
    const rowId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
    const rowNim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    const rowName = normalize_(findValue_(row, ['Nama_Lengkap', 'Nama', 'Nama_Wisudawan']));

    return (studentId && rowId === studentId) ||
      (nim && rowNim === nim) ||
      (!rowId && !rowNim && name && rowName === name);
  });
}


function getStudentSeats_(session, profile) {
  profile = profile || getStudentProfile_(session);
  if (!profile) return [];

  const studentId = normalize_(findValue_(profile, ['ID_Wisudawan', 'ID Wisudawan']));
  const nim = normalize_(findValue_(profile, ['NIM', 'Nomor Induk Mahasiswa']));
  const name = normalize_(findValue_(profile, ['Nama_Lengkap', 'Nama']));

  return getRows_(CONFIG.SHEETS.SEATS).filter(function (row) {
    const rowId = normalize_(findValue_(row, ['ID_Wisudawan', 'ID Wisudawan']));
    const rowNim = normalize_(findValue_(row, ['NIM', 'Nomor Induk Mahasiswa']));
    const rowName = normalize_(findValue_(row, ['Nama_Lengkap', 'Nama', 'Nama_Wisudawan']));

    return (studentId && rowId === studentId) ||
      (nim && rowNim === nim) ||
      (!rowId && !rowNim && name && rowName === name);
  });
}

/* =========================
   DAFTAR DAN PENCARIAN
   ========================= */
