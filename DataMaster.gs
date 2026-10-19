function getCallList() {
  requireRole_(['Admin']);
  return getRows_(CONFIG.SHEETS.CALL_LIST).slice(0, 500);
}


function getSeatMap() {
  requireRole_(['Admin']);
  return getRows_(CONFIG.SHEETS.SEATS).slice(0, 1000);
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
