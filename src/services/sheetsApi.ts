/**
 * Google Apps Script Web App Integration & Updated Code.gs Template (V4)
 * Supports 4 synchronized sheets: Siswa, BankSoal, Hasil, and Rekap
 * with idempotent upsert keys (studentId, quizId+questionId, resultId, sessionId)
 * and honest failure reporting (never returns success: true on failure).
 * Created by Deni Raja99 - Pirate Academy
 */

import type { StudentSession } from '../types/game';
import { syncStudentSheetsApi, testSheetsConnectionBackendApi } from './apiClient';

export interface SheetsApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

/**
 * Updated Google Apps Script (Code.gs) template for teachers (V4).
 * Covers: Siswa, BankSoal, Hasil, Rekap with idempotent upserts & summary formulas.
 */
export const GOOGLE_APPS_SCRIPT_CODE = `/**
 * ============================================================================
 * PIRATE ACADEMY 3D - GOOGLE APPS SCRIPT DATABASE BACKEND (V4 REAL-TIME SYNC)
 * Created by Deni Raja99
 * ============================================================================
 * Petunjuk Instalasi:
 * 1. Buka Google Sheets baru di https://sheets.new
 * 2. Beri nama spreadsheet: "Database Pirate Academy - [Nama Sekolah/Kelas]"
 * 3. Klik menu: Ekstensi > Apps Script
 * 4. Hapus semua kode bawaan dan tempelkan (Paste) seluruh kode ini.
 * 5. Klik Simpan (ikon disket / Ctrl+S).
 * 6. Klik "Terapkan" (Deploy) > "Penerapan baru" (New deployment).
 * 7. Pilih Jenis: "Aplikasi web" (Web app).
 * 8. Konfigurasi WAJIB:
 *    - Deskripsi: "Pirate Academy V4 API"
 *    - Jalankan sebagai (Execute as): "Saya" (Me)
 *    - Yang memiliki akses (Who has access): "Siapa saja" (Anyone)
 * 9. Klik "Terapkan" (Deploy) & selesaikan otorisasi izin Google.
 * 10. Salin URL Web App (/exec) ke tab Pengaturan Portal Guru, lalu klik Uji Koneksi.
 *
 * Batasan & Catatan Penting:
 * - Akses "Anyone" hanya menerima permintaan HTTPS POST/GET ke skrip ini; URL tidak
 *   perlu dibagikan ke siswa karena pengiriman dilakukan oleh server backend aplikasi.
 * - Penulisan menggunakan LockService dan ID unik (resultId, sessionId, studentId)
 *   sehingga pengiriman ulang/retry tidak pernah menggandakan baris data.
 * ============================================================================
 */

const SHEETS = {
  SISWA: 'Siswa',
  BANK_SOAL: 'BankSoal',
  HASIL: 'Hasil',
  REKAP: 'Rekap'
};

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Sheet Siswa
  initSheet(ss, SHEETS.SISWA, [
    'studentId', 'Nama', 'Kelas', 'Status', 'Terakhir Diperbarui'
  ]);

  // 2. Sheet BankSoal
  initSheet(ss, SHEETS.BANK_SOAL, [
    'quizId', 'questionId', 'Nomor Soal', 'Jenis Soal', 'Teks Pertanyaan',
    'Pilihan Jawaban', 'Kunci Jawaban', 'Bobot Nilai', 'Status Publikasi', 'Terakhir Diperbarui'
  ]);

  // 3. Sheet Hasil (Per jawaban siswa, idempoten berdasarkan resultId)
  initSheet(ss, SHEETS.HASIL, [
    'resultId', 'Timestamp', 'studentId', 'Nama Siswa', 'Kelas', 'quizId',
    'questionId', 'Teks Pertanyaan', 'Jawaban Siswa', 'Kunci Jawaban',
    'Nilai', 'Nilai Maksimum', 'Status Penilaian', 'Durasi Pengerjaan'
  ]);

  // 4. Sheet Rekap (Ringkasan per sesi + Ringkasan Otomatis di baris atas/kolom kanan)
  const rekapSheet = initSheet(ss, SHEETS.REKAP, [
    'sessionId', 'studentId', 'Nama Siswa', 'Kelas', 'quizId', 'Judul Kuis',
    'Soal Selesai', 'Total Nilai', 'Nilai Maksimum', 'Persentase (%)',
    'Status Pengerjaan', 'Menunggu Penilaian', 'Terakhir Sinkron'
  ]);

  // Tambahkan ringkasan statistik otomatis menggunakan formula Google Sheets di kolom O-P
  if (rekapSheet.getRange('O1').getValue() !== 'RINGKASAN OTOMATIS') {
    rekapSheet.getRange('O1:P1').setValues([['RINGKASAN OTOMATIS', 'NILAI']])
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#fbbf24');
    rekapSheet.getRange('O2:P6').setValues([
      ['Total Sesi Siswa', '=MAX(0, COUNTA(A2:A)-0)'],
      ['Rata-rata Persentase (%)', '=IFERROR(AVERAGE(J2:J), 0)'],
      ['Skor Tertinggi (%)', '=IFERROR(MAX(J2:J), 0)'],
      ['Skor Terendah (%)', '=IFERROR(MIN(J2:J), 0)'],
      ['Total Sesi Selesai', '=COUNTIF(K2:K, "Selesai")']
    ]);
  }
}

function initSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#fde68a');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function upsertByCompositeKey(sheet, keyColumnIndices, keyValues, rowData) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const numCols = Math.max(sheet.getLastColumn(), rowData.length);
    const existing = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    for (let i = 0; i < existing.length; i++) {
      let match = true;
      for (let k = 0; k < keyColumnIndices.length; k++) {
        const colIdx = keyColumnIndices[k];
        if (String(existing[i][colIdx]) !== String(keyValues[k])) {
          match = false;
          break;
        }
      }
      if (match) {
        sheet.getRange(i + 2, 1, 1, rowData.length).setValues([rowData]);
        return 'updated';
      }
    }
  }
  sheet.appendRow(rowData);
  return 'inserted';
}

function doGet(e) {
  setupSpreadsheet();
  const action = (e && e.parameter && e.parameter.action) || 'status';

  if (action === 'status') {
    return jsonResponse({
      success: true,
      message: 'Pirate Academy V4 Apps Script API aktif dan siap menerima sinkronisasi real-time!',
      sheets: Object.values(SHEETS),
      timestamp: new Date().toISOString()
    });
  }

  if (action === 'getRekap') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEETS.REKAP);
    if (!sheet || sheet.getLastRow() < 2) {
      return jsonResponse({ success: true, data: [] });
    }
    const data = sheet.getRange(1, 1, sheet.getLastRow(), 13).getValues();
    const headers = data[0];
    const rows = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
    return jsonResponse({ success: true, data: rows });
  }

  return jsonResponse({ success: false, message: 'Aksi GET tidak dikenal: ' + action });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    setupSpreadsheet();
    const contents = JSON.parse(e.postData.contents);
    const action = contents.action;
    const payload = contents.payload;

    if (action === 'saveSessionV4') {
      return handleSaveSessionV4(payload);
    }
    if (action === 'syncPackage') {
      return handleSyncPackage(payload);
    }
    // Kompatibilitas mundur jika masih menerima saveSession lama
    if (action === 'saveSession') {
      return handleLegacySession(payload);
    }

    return jsonResponse({ success: false, message: 'Aksi POST tidak didukung: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, message: 'Kesalahan Apps Script: ' + err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function handleSaveSessionV4(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const siswaSheet = ss.getSheetByName(SHEETS.SISWA);
  const hasilSheet = ss.getSheetByName(SHEETS.HASIL);
  const rekapSheet = ss.getSheetByName(SHEETS.REKAP);

  // 1. Upsert Siswa berdasarkan studentId (kolom A = index 0)
  if (payload.siswa) {
    upsertByCompositeKey(siswaSheet, [0], [payload.siswa.studentId], [
      payload.siswa.studentId,
      payload.siswa.nama,
      payload.siswa.kelas,
      payload.siswa.status,
      payload.siswa.updatedAt || new Date().toISOString()
    ]);
  }

  // 2. Upsert Hasil per resultId (kolom A = index 0) -> anti-duplikasi retry
  let hasilCount = 0;
  if (Array.isArray(payload.hasilRows)) {
    payload.hasilRows.forEach(row => {
      upsertByCompositeKey(hasilSheet, [0], [row.resultId], [
        row.resultId,
        row.timestamp,
        row.studentId,
        row.namaSiswa,
        row.kelas,
        row.quizId,
        row.questionId,
        row.teksPertanyaan,
        row.jawabanSiswa,
        row.kunciJawaban,
        row.nilai,
        row.nilaiMaksimum,
        row.statusPenilaian,
        row.durasiPengerjaan
      ]);
      hasilCount++;
    });
  }

  // 3. Upsert Rekap berdasarkan sessionId (kolom A = index 0)
  if (payload.rekap) {
    const r = payload.rekap;
    upsertByCompositeKey(rekapSheet, [0], [r.sessionId], [
      r.sessionId,
      r.studentId,
      r.namaSiswa,
      r.kelas,
      r.quizId,
      r.judulKuis,
      r.soalSelesai,
      r.totalNilai,
      r.nilaiMaksimum,
      r.persentase,
      r.statusPengerjaan,
      r.pendingCount,
      r.updatedAt || new Date().toISOString()
    ]);
  }

  return jsonResponse({
    success: true,
    message: 'Data Siswa, Hasil (' + hasilCount + ' jawaban), dan Rekap tersinkronisasi tanpa duplikasi!',
    sessionId: payload.sessionId
  });
}

function handleSyncPackage(pkg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bankSheet = ss.getSheetByName(SHEETS.BANK_SOAL);
  const now = new Date().toISOString();
  let count = 0;

  if (Array.isArray(pkg.questions)) {
    pkg.questions.forEach(q => {
      upsertByCompositeKey(bankSheet, [0, 1], [q.quizId, q.questionId], [
        q.quizId,
        q.questionId,
        q.nomorSoal,
        q.jenisSoal,
        q.teksPertanyaan,
        q.pilihanJawaban,
        q.kunciJawaban,
        q.bobotNilai,
        q.statusPublikasi,
        now
      ]);
      count++;
    });
  }

  return jsonResponse({
    success: true,
    message: 'BankSoal berhasil disinkronkan (' + count + ' soal untuk quizId ' + pkg.quizId + ')!'
  });
}

function handleLegacySession(session) {
  const answers = session.answers ? Object.values(session.answers) : [];
  return handleSaveSessionV4({
    sessionId: session.sessionId,
    siswa: {
      studentId: (session.student && session.student.studentId) || session.sessionId,
      nama: session.student ? session.student.name : '',
      kelas: session.student ? session.student.grade : '',
      status: session.isCompleted ? 'Selesai' : 'Aktif',
      updatedAt: new Date().toISOString()
    },
    hasilRows: answers.map(ans => ({
      resultId: ans.resultId || (session.sessionId + '::' + ans.questionId),
      timestamp: ans.answeredAt || new Date().toISOString(),
      studentId: (session.student && session.student.studentId) || session.sessionId,
      namaSiswa: session.student ? session.student.name : '',
      kelas: session.student ? session.student.grade : '',
      quizId: session.packageId,
      questionId: ans.questionId,
      teksPertanyaan: ans.questionPrompt || ('Soal #' + ans.questionNumber),
      jawabanSiswa: ans.answerText,
      kunciJawaban: ans.correctAnswerSnapshot || '-',
      nilai: ans.scoreAwarded,
      nilaiMaksimum: ans.maxPoints,
      statusPenilaian: ans.isCorrect ? 'Benar' : 'Perlu Cek',
      durasiPengerjaan: (ans.durationSeconds || 0) + ' detik'
    })),
    rekap: {
      sessionId: session.sessionId,
      studentId: (session.student && session.student.studentId) || session.sessionId,
      namaSiswa: session.student ? session.student.name : '',
      kelas: session.student ? session.student.grade : '',
      quizId: session.packageId,
      judulKuis: session.packageTitle,
      soalSelesai: session.chestsCompleted ? session.chestsCompleted.length : 0,
      totalNilai: session.totalScore,
      nilaiMaksimum: session.maxPossibleScore,
      persentase: session.percentageScore,
      statusPengerjaan: session.isCompleted ? 'Selesai' : 'Berjalan',
      pendingCount: 0,
      updatedAt: new Date().toISOString()
    }
  });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

/**
 * Trigger backend-relayed Google Sheets synchronization for a student session.
 * Never returns fake success on failure.
 */
export async function syncSessionToGoogleSheets(
  session: StudentSession
): Promise<SheetsApiResponse & { session?: StudentSession }> {
  return syncStudentSheetsApi(session.sessionId);
}

/**
 * Test connectivity with Google Apps Script Web App via backend server relay.
 */
export async function testSheetsConnection(webAppUrl: string): Promise<SheetsApiResponse> {
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com')) {
    return {
      success: false,
      message: 'Format URL tidak valid. Harus dimulai dengan https://script.google.com/macros/s/...',
    };
  }
  return testSheetsConnectionBackendApi(webAppUrl);
}
