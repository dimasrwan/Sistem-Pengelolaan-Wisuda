SISTEM PENGELOLAAN WISUDA - STRUKTUR MODULAR

BACKEND (.gs):
- Main.gs: konfigurasi, doGet, include
- Database.gs: helper spreadsheet dan data umum
- Auth.gs: sesi dan role
- Periods.gs: periode wisuda
- Dashboard.gs: dashboard dan profil wisudawan
- Wisudawan.gs: pencarian, NIM dummy, jenjang, status NIM
- DataMaster.gs: daftar panggil, denah, lulusan terbaik, tamu
- ImportData.gs: setup, preview, validasi, dan import
- Operations.gs: status panggil, laporan, presensi tamu

HTML (.html):
- Index.html: struktur halaman dan include partial
- Styles.html: CSS
- AppState.html: state global frontend
- AppCore.html: autentikasi, navigasi, dashboard, helper umum
- StudentPages.html: halaman dan import wisudawan
- OperationsPages.html: daftar panggil, denah, lulusan terbaik, tamu, QR, laporan, helper akhir

CARA PEMASANGAN:
1. Gunakan salinan proyek Apps Script, jangan langsung timpa proyek produksi.
2. Buat semua file .gs dan .html dengan nama persis seperti di atas.
3. Salin isi setiap file ke file Apps Script dengan nama yang sama (tanpa ekstensi pada nama file di editor jika editor mengaturnya otomatis).
4. Hapus/rename file lama Code.gs dan Index.html hanya setelah semua file baru ditambahkan. Pastikan tidak ada fungsi duplikat.
5. Simpan dan uji semua role serta fitur sebelum memperbarui deployment.

Catatan: file-file disusun ulang tanpa sengaja mengubah isi fungsi. Namun tetap wajib diuji di salinan Apps Script karena pengujian statis tidak menjamin integrasi dengan spreadsheet dan deployment aktif.
