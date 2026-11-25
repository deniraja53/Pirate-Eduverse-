# Panduan Lengkap Menghubungkan Google Sheets & Google Apps Script — Pirate Academy 3D

Panduan langkah demi langkah ini disusun khusus untuk guru menggunakan Windows atau Chromebook/Mac agar bank soal (`BankSoal`), nilai siswa (`RekapNilai`), riwayat sinkronisasi (`LogSinkronisasi`), dan konfigurasi (`Pengaturan`) di **Pirate Academy 3D** terhubung secara real-time ke Google Sheets milik Anda.

---

## Langkah 1 — Membuat Google Spreadsheet Baru
1. Buka browser (Chrome / Edge) dan masuk ke akun Google Anda.
2. Kunjungi **[https://sheets.new](https://sheets.new)** atau buka Google Drive Anda lalu klik **+ Baru > Google Spreadsheet**.
3. Klik judul di kiri atas (*Spreadsheet tanpa judul*) dan ubah namanya menjadi:
   `Database Pirate Academy 3D`
4. Biarkan tab spreadsheet ini tetap terbuka. Salin tautan (URL) spreadsheet dari bilah alamat browser jika Anda ingin menampilkannya sebagai tombol pintas di Portal Guru.

---

## Langkah 2 — Membuka Editor Google Apps Script
1. Pada menu bagian atas Google Spreadsheet, klik:
   **Ekstensi** → **Apps Script**
   *(Dalam bahasa Inggris: **Extensions** → **Apps Script**).*
2. Tab baru akan terbuka berisi editor kode `Code.gs`.
3. Blok seluruh kode bawaan (`function myFunction() { ... }`) di `Code.gs` (tekan `Ctrl + A`), lalu tekan `Delete`/`Backspace` hingga editor benar-benar kosong.

---

## Langkah 3 — Menempelkan Kode `Code.gs`
1. Buka Portal Guru di Pirate Academy 3D → masuk ke menu **Google Sheets** → klik tombol **Salin Code.gs** (atau salin seluruh isi file `Code.gs` dari proyek ini).
2. Kembali ke editor Apps Script, tempelkan seluruh kode tersebut ke `Code.gs` (`Ctrl + V`).
3. Pastikan nama proyek Apps Script diubah menjadi **Pirate Academy Sync API** (klik *Proyek tanpa judul* di kiri atas).
4. Klik ikon **Simpan** (disket) atau tekan `Ctrl + S`.

---

## Langkah 4 — Menjalankan Setup Awal Spreadsheet (Wajib)
1. Di toolbar atas editor Apps Script (sebelah kanan tombol *Debug*), klik dropdown pemilihan fungsi dan pilih **`setupSpreadsheet`**.
2. Klik tombol **Run (Jalankan)**.
3. Saat pertama kali dijalankan, Google akan meminta izin akses:
   - Klik **Tinjau izin (Review permissions)**.
   - Pilih akun Google Anda.
   - Jika muncul layar *"Google belum memverifikasi aplikasi ini"*: klik **Lanjutan (Advanced)** → klik **Buka Pirate Academy Sync API (tidak aman)** → klik **Izinkan (Allow)**.
4. Tunggu beberapa detik hingga muncul `Execution completed` di panel *Execution Log*.
5. Kembali ke tab Google Spreadsheet Anda — sekarang otomatis sudah terbuat **6 tab sheet**:
   - `BankSoal`
   - `RekapNilai`
   - `Siswa`
   - `Hasil`
   - `LogSinkronisasi`
   - `Pengaturan`

*(Opsional)* Anda juga dapat memilih fungsi `testConnection` lalu klik **Run** untuk memverifikasi status skrip di log.

---

## Langkah 5 — Deploy Web App (Mendapatkan URL Sinkronisasi)
1. Di pojok kanan atas editor Apps Script, klik tombol **Terapkan (Deploy)** → pilih **Penerapan baru (New deployment)**.
2. Klik ikon roda gigi di sebelah *"Pilih jenis"* → pilih **Aplikasi web (Web app)**.
3. Isi konfigurasi berikut dengan tepat:
   - **Deskripsi**: `Pirate Academy V11 API`
   - **Jalankan sebagai (Execute as)**: **Saya (Me)** *(email akun Google Anda)*
   - **Yang memiliki akses (Who has access)**: **Siapa saja (Anyone)**
     *(Wajib memilih "Siapa saja" agar server aplikasi Pirate Academy dapat mengirim data sinkronisasi secara otomatis tanpa terhalang halaman login Google).*
4. Klik **Terapkan (Deploy)**.
5. Salin **URL Aplikasi Web** yang muncul (berformat `https://script.google.com/macros/s/.../exec`), lalu klik **Selesai**.

> **Penting saat memperbarui kode di masa depan:**  
> Jika suatu saat Anda mengubah kode `Code.gs`, jangan hanya menekan Simpan. Klik **Terapkan > Kelola penerapan (Manage deployments)** → klik ikon pensil (**Edit**) → pada bagian **Versi**, pilih **Versi baru (New version)** → klik **Terapkan**.

---

## Langkah 6 — Menghubungkan ke Portal Guru & Menguji Koneksi
1. Masuk ke **Portal Guru** di aplikasi Pirate Academy 3D.
2. Buka menu **Pengaturan Integrasi** atau **Google Sheets**.
3. Tempelkan URL Web App (`/exec`) pada kolom **URL Google Apps Script Web App**.
4. *(Opsional)* Tempelkan juga URL/ID Google Spreadsheet Anda pada kolom **Link / ID Spreadsheet** agar tombol **Buka Google Sheets** aktif.
5. Klik **Simpan Pengaturan**, lalu klik **Uji Koneksi**.
6. Jika berhasil, status berubah menjadi hijau (**Terhubung**) dan log tercatat di sheet `LogSinkronisasi`.

---

## Keamanan Tambahan (Opsional): Token Rahasia Bersama
Agar hanya server Pirate Academy milik Anda yang bisa menulis ke spreadsheet:
1. Di editor Apps Script, buka **Pengaturan Proyek (ikon roda gigi di menu kiri)** → gulir ke **Properti Skrip (Script Properties)** → klik **Tambahkan properti skrip**.
2. Isi Properti: `PIRATE_SYNC_TOKEN`, Nilai: kata sandi acak buatan Anda sendiri (misal `rahasia-sdn1-2026`). Klik **Simpan properti skrip**.
3. Masukkan token yang sama pada kolom **Token Rahasia Apps Script (Opsional)** di menu **Pengaturan Integrasi** Portal Guru, lalu klik **Simpan**.

---

## Mengatasi Masalah Umum (Troubleshooting)
- **Error HTTP 401 / 403 atau halaman login HTML muncul:**  
  Pastikan pada menu *Terapkan > Kelola penerapan*, opsi **Yang memiliki akses** disetel ke **Siapa saja (Anyone)** dan **Jalankan sebagai** disetel ke **Saya (Me)**.
- **Perubahan `Code.gs` tidak berpengaruh / respons bukan JSON valid:**  
  Pastikan Anda membuat **Versi baru (New version)** di menu *Kelola penerapan*, lalu gunakan URL `/exec` terbaru.
- **Gambar soal di Google Sheets berupa link, bukan gambar langsung:**  
  Demi menjaga performa dan batas sel Google Sheets, gambar soal disimpan di server dan dicatat alamat URL-nya pada kolom `Gambar_URL`.
- **Nama/teks diawali tanda `=` atau `+` otomatis berubah di Sheets:**  
  `Code.gs` dan server secara otomatis menambahkan tanda petik tunggal (`'`) di depan simbol rumus berbahaya (`=`, `+`, `-`, `@`) untuk mencegah serangan *formula injection*.
