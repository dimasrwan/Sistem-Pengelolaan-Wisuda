function getCurrentEmail_() {
  return normalize_(Session.getActiveUser().getEmail());
}

/* =========================
   AUTENTIKASI DAN ROLE
   ========================= */


function getSession() {
  const email = getCurrentEmail_();

  if (!email) {
    return {
      authenticated: false,
      message: 'Email akun Google tidak terdeteksi. Periksa konfigurasi deployment dan akun Google yang digunakan.'
    };
  }

  const user = getRows_(CONFIG.SHEETS.USERS).find(function (row) {
    const userEmail = normalize_(findValue_(row, ['Email', 'Email_Pengguna']));
    const status = normalize_(findValue_(row, ['Status_Akun', 'Status']));

    return userEmail === email &&
      (!status || ['aktif', 'active'].includes(status));
  });

  if (!user) {
    return {
      authenticated: false,
      email: email,
      message: 'Akun belum terdaftar atau tidak aktif. Hubungi administrator.'
    };
  }

  const roleRaw = normalize_(findValue_(user, ['Role', 'Peran']));

  const roleMap = {
    admin: 'Admin',
    administrator: 'Admin',
    panitia: 'Panitia',
    petugas: 'Panitia',
    wisudawan: 'Wisudawan'
  };

  if (!roleMap[roleRaw]) {
    return {
      authenticated: false,
      email: email,
      message: 'Role tidak valid. Gunakan Admin, Panitia, atau Wisudawan.'
    };
  }

  const session = {
    authenticated: true,
    email: email,
    name: String(findValue_(user, [
      'Nama_Pengguna', 'Nama_Lengkap', 'Nama'
    ]) || email),
    role: roleMap[roleRaw],
    studentId: String(findValue_(user, [
      'ID_Wisudawan', 'ID Mahasiswa', 'NIM'
    ]) || '')
  };

  logActivity_(
    email,
    'LOGIN',
    'AUTENTIKASI',
    'Login berhasil sebagai ' + session.role
  );

  return session;
}


function requireRole_(allowedRoles) {
  const session = getSession();

  if (!session.authenticated) {
    throw new Error(session.message || 'Autentikasi gagal.');
  }

  if (allowedRoles.indexOf(session.role) === -1) {
    throw new Error(
      'Akses ditolak. Role ' + session.role +
      ' tidak memiliki izin untuk fitur ini.'
    );
  }

  return session;
}


function logActivity_(email, activity, moduleName, detail) {
  try {
    getSheet_(CONFIG.SHEETS.LOG).appendRow([
      Utilities.getUuid(),
      new Date(),
      email,
      activity,
      moduleName,
      detail
    ]);
  } catch (err) {
    console.warn('Log aktivitas tidak tersimpan: ' + err.message);
  }
}

/* =========================
   PERIODE WISUDA
   ========================= */
