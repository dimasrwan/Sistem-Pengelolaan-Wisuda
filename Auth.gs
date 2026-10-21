function getCurrentEmail_() {
  return normalize_(Session.getActiveUser().getEmail());
}

/* =========================
   AUTENTIKASI DAN ROLE
   ========================= */


const ROLE_MAP_ = {
  admin: 'Admin',
  administrator: 'Admin',
  panitia: 'Panitia',
  petugas: 'Panitia',
  wisudawan: 'Wisudawan'
};


function getSession(targetRole) {
  const email = getCurrentEmail_();

  if (!email) {
    return {
      authenticated: false,
      message: 'Email akun Google tidak terdeteksi. Periksa konfigurasi deployment dan akun Google yang digunakan.'
    };
  }

  const allUsers = getRows_(CONFIG.SHEETS.USERS);
  const matchingUsers = allUsers.filter(function (row) {
    const userEmail = normalize_(findValue_(row, ['Email', 'Email_Pengguna']));
    const status = normalize_(findValue_(row, ['Status_Akun', 'Status']));

    return userEmail === email &&
      (!status || ['aktif', 'active'].includes(status));
  });

  if (!matchingUsers.length) {
    return {
      authenticated: false,
      email: email,
      message: 'Akun belum terdaftar atau tidak aktif. Hubungi administrator.'
    };
  }

  // Tentukan daftar role aktif unik untuk akun ini
  const availableRoles = [];
  const seenRoles = {};
  matchingUsers.forEach(function (row) {
    const r = normalize_(findValue_(row, ['Role', 'Peran']));
    const canonicalRole = ROLE_MAP_[r];
    if (canonicalRole && !seenRoles[canonicalRole]) {
      seenRoles[canonicalRole] = true;
      availableRoles.push(canonicalRole);
    }
  });

  if (!availableRoles.length) {
    return {
      authenticated: false,
      email: email,
      message: 'Role tidak valid pada akun Anda. Gunakan Admin, Panitia, atau Wisudawan.'
    };
  }

  // Prioritas penentuan role aktif:
  // 1. Parameter targetRole eksplisit
  // 2. Properti ACTIVE_ROLE yang tersimpan di UserProperties
  let selectedRole = targetRole ? String(targetRole).trim() : '';
  if (!selectedRole) {
    try {
      selectedRole = PropertiesService.getUserProperties().getProperty('ACTIVE_ROLE') || '';
    } catch (e) {}
  }

  // Jika akun memiliki beberapa role aktif dan belum ada role yang dipilih:
  // Kembalikan flag requiresRoleSelection agar pengguna dapat memilih role di UI
  if (!selectedRole && availableRoles.length > 1) {
    return {
      authenticated: true,
      email: email,
      requiresRoleSelection: true,
      availableRoles: availableRoles,
      message: 'Akun Anda memiliki beberapa peran aktif. Silakan pilih peran untuk melanjutkan.'
    };
  }

  // Jika hanya ada satu role atau role yang dipilih tidak cocok, gunakan role pertama yang tersedia
  if (!selectedRole) {
    selectedRole = availableRoles[0];
  }

  // Temukan baris pengguna yang cocok dengan role yang dipilih
  const selectedRoleNorm = normalize_(selectedRole);
  const user = matchingUsers.find(function (row) {
    const r = normalize_(findValue_(row, ['Role', 'Peran']));
    return (ROLE_MAP_[r] && normalize_(ROLE_MAP_[r]) === selectedRoleNorm) || r === selectedRoleNorm;
  }) || matchingUsers[0];

  const roleRaw = normalize_(findValue_(user, ['Role', 'Peran']));
  const canonicalRole = ROLE_MAP_[roleRaw] || availableRoles[0];

  // Simpan role terpilih ke UserProperties agar tetap aktif pada panggilan fungsi berikutnya
  try {
    PropertiesService.getUserProperties().setProperty('ACTIVE_ROLE', canonicalRole);
  } catch (e) {}

  // Ekstraksi ID_Wisudawan untuk akun Wisudawan:
  // 1. Cek field ID_Wisudawan / ID Mahasiswa / NIM
  // 2. Jika kosong dan role adalah Wisudawan, gunakan field ID_Pengguna (misal: "WSD-0011")
  let studentId = String(findValue_(user, [
    'ID_Wisudawan', 'ID Wisudawan', 'ID_Mahasiswa', 'ID Mahasiswa', 'NIM', 'Nomor Induk Mahasiswa'
  ]) || '').trim();

  if (!studentId && canonicalRole === 'Wisudawan') {
    studentId = String(findValue_(user, [
      'ID_Pengguna', 'ID Pengguna', 'ID_User', 'ID User'
    ]) || '').trim();
  }

  const selectedUserId = String(findValue_(user, ['ID_Pengguna', 'ID Pengguna', 'ID_User', 'ID User']) || '').trim();

  const session = {
    authenticated: true,
    email: email,
    userId: selectedUserId,
    name: String(findValue_(user, [
      'Nama_Pengguna', 'Nama_Lengkap', 'Nama'
    ]) || email),
    role: canonicalRole,
    studentId: studentId,
    ID_Wisudawan: studentId,
    availableRoles: availableRoles
  };

  logDiagnostic_('AUTH_SESSION', {
    activeRole: session.role,
    userId: selectedUserId,
    studentId: studentId,
    reason: 'Login berhasil sebagai ' + session.role
  });

  logActivity_(
    email,
    'LOGIN',
    'AUTENTIKASI',
    'Login berhasil sebagai ' + session.role + (studentId ? ' (' + studentId + ')' : '')
  );

  return session;
}


function requireRole_(allowedRoles, targetRole) {
  const session = getSession(targetRole);

  if (!session.authenticated) {
    throw new Error(session.message || 'Autentikasi gagal.');
  }

  if (session.requiresRoleSelection) {
    const matchedRole = session.availableRoles.find(function (r) {
      return allowedRoles.indexOf(r) !== -1;
    });
    if (matchedRole) {
      return getSession(matchedRole);
    }
    throw new Error('Silakan pilih peran terlebih dahulu.');
  }

  if (allowedRoles.indexOf(session.role) === -1) {
    throw new Error(
      'Akses ditolak. Role ' + session.role +
      ' tidak memiliki izin untuk fitur ini.'
    );
  }

  return session;
}


function logoutSession() {
  try {
    PropertiesService.getUserProperties().deleteProperty('ACTIVE_ROLE');
  } catch (e) {}
  return { success: true };
}


/* =========================
   DIAGNOSTIC LOGGING (AMAN)
   ========================= */

function logDiagnostic_(category, data) {
  try {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp: timestamp,
      category: category,
      activeRole: (data && data.activeRole) || '',
      userId: (data && data.userId) || '',
      studentId: (data && data.studentId) || '',
      matchedCount: data && typeof data.matchedCount === 'number' ? data.matchedCount : null,
      reason: (data && data.reason) || ''
    };

    Logger.log('[DIAGNOSTIC][' + category + '] Role=' + entry.activeRole +
      ', UserID=' + entry.userId +
      ', StudentID=' + entry.studentId +
      (entry.matchedCount !== null ? ', Matched=' + entry.matchedCount : '') +
      (entry.reason ? ', Detail=' + entry.reason : ''));

    // Simpan ringkasan sementara di UserProperties (maksimal 20 entri terakhir)
    const userProps = PropertiesService.getUserProperties();
    let logs = [];
    try {
      const raw = userProps.getProperty('DIAGNOSTIC_LOGS');
      if (raw) logs = JSON.parse(raw);
    } catch (e) { logs = []; }

    logs.push(entry);
    if (logs.length > 20) logs = logs.slice(logs.length - 20);
    userProps.setProperty('DIAGNOSTIC_LOGS', JSON.stringify(logs));
  } catch (err) {
    Logger.log('[DIAGNOSTIC_ERR] ' + err.message);
  }
}

function getDiagnosticLogs() {
  try {
    const raw = PropertiesService.getUserProperties().getProperty('DIAGNOSTIC_LOGS');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function clearDiagnosticLogs() {
  try {
    PropertiesService.getUserProperties().deleteProperty('DIAGNOSTIC_LOGS');
    return { success: true, message: 'Log diagnostik berhasil dibersihkan.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
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
