const CONFIG = {
  SPREADSHEET_ID: '1mNWtlCvxUwvQTDWplbKnPTZFL8vBhS20s_W2GTmWPOk',
  APP_NAME: 'Sistem Pengelolaan Wisuda',
  UNIVERSITY: 'UIN Ar-Raniry',
  LOGO_URL: 'https://raw.githubusercontent.com/dimasrwan/wisuda-qr-scanner/main/LOGO%20UIN.png',
  SHEETS: {
    USERS: 'PENGGUNA',
    STUDENTS: 'DATA_WISUDAWAN',
    CALL_LIST: 'DAFTAR_PANGGIL',
    SEATS: 'DENAH_KURSI',
    PERIOD: 'PERIODE_WISUDA',
    BEST: 'LULUSAN_TERBAIK',
    GUESTS: 'DATA_TAMU',
    GUEST_ATTENDANCE: 'PRESENSI_TAMU',
    LOG: 'LOG_AKTIVITAS'
  }
};


function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.APP_NAME + ' | ' + CONFIG.UNIVERSITY)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
