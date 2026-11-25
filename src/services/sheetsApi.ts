/**
 * Google Apps Script Web App Integration & Updated Code.gs Template (V11 + V4)
 * Keep GOOGLE_APPS_SCRIPT_CODE synchronized 1:1 with /Code.gs
 * Created by Deni Raja99 - Pirate Academy
 */

import type { StudentSession } from '../types/game';
import { syncStudentSheetsApi, testSheetsConnectionBackendApi } from './apiClient';

export interface SheetsApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export const GOOGLE_APPS_SCRIPT_CODE = `/**
 * ============================================================================
 * PIRATE ACADEMY 3D - GOOGLE APPS SCRIPT DATABASE BACKEND (V11 + V4 COMPATIBLE)
 * Created by Deni Raja99
 * ============================================================================
 * Struktur Sheet Otomatis:
 * 1. BankSoal         : ID_Soal, Nomor, Jenis_Soal, Pertanyaan, Opsi_JSON,
 *                       Kunci_Jawaban, Penjelasan, Gambar_URL, Status, Versi,
 *                       Updated_At, ID_Paket
 * 2. RekapNilai       : ID_Sesi, ID_Siswa, Nama_Siswa, Kelas, ID_Paket,
 *                       Judul_Kuis, Soal_Selesai, Total_Nilai, Nilai_Maksimum,
 *                       Persentase, Status_Pengerjaan, Menunggu_Penilaian,
 *                       Terakhir_Sinkron
 * 3. Siswa            : studentId, Nama, Kelas, Status, Terakhir_Diperbarui
 * 4. Hasil            : resultId, Timestamp, studentId, Nama_Siswa, Kelas,
 *                       quizId, questionId, Teks_Pertanyaan, Jawaban_Siswa,
 *                       Kunci_Jawaban, Nilai, Nilai_Maksimum, Status_Penilaian,
 *                       Durasi_Pengerjaan
 * 5. LogSinkronisasi  : ID_Operasi, Jenis_Operasi, Status, Jumlah_Data,
 *                       Waktu_Mulai, Waktu_Selesai, Pesan
 * 6. Pengaturan       : Kunci_Pengaturan, Nilai, Diperbarui_Pada
 * ============================================================================
 */

const SHEETS = {
  BANK_SOAL: 'BankSoal',
  REKAP_NILAI: 'RekapNilai',
  SISWA: 'Siswa',
  HASIL: 'Hasil',
  LOG_SINKRONISASI: 'LogSinkronisasi',
  PENGATURAN: 'Pengaturan',
  REKAP_LEGACY: 'Rekap'
};

const MAX_ROWS_PER_REQUEST = 500;

function escapeFormulaCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str = String(value);
  if (!str) return '';
  if (/^[=+\\-@\\t\\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function verifyOptionalToken(providedToken) {
  const expected = PropertiesService.getScriptProperties().getProperty('PIRATE_SYNC_TOKEN');
  if (!expected) return true;
  return String(providedToken || '') === String(expected);
}

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  initSheet(ss, SHEETS.BANK_SOAL, [
    'ID_Soal', 'Nomor', 'Jenis_Soal', 'Pertanyaan', 'Opsi_JSON',
    'Kunci_Jawaban', 'Penjelasan', 'Gambar_URL', 'Status', 'Versi',
    'Updated_At', 'ID_Paket'
  ]);

  const rekapSheet = initSheet(ss, SHEETS.REKAP_NILAI, [
    'ID_Sesi', 'ID_Siswa', 'Nama_Siswa', 'Kelas', 'ID_Paket', 'Judul_Kuis',
    'Soal_Selesai', 'Total_Nilai', 'Nilai_Maksimum', 'Persentase (%)',
    'Status_Pengerjaan', 'Menunggu_Penilaian', 'Terakhir_Sinkron'
  ]);

  if (rekapSheet.getRange('O1').getValue() !== 'RINGKASAN OTOMATIS') {
    rekapSheet.getRange('O1:P1').setValues([['RINGKASAN OTOMATIS', 'NILAI']])
      .setFontWeight('bold').setBackground('#281647').setFontColor('#facc15');
    rekapSheet.getRange('O2:P6').setValues([
      ['Total Sesi Siswa', '=MAX(0, COUNTA(A2:A))'],
      ['Rata-rata Persentase (%)', '=IFERROR(AVERAGE(J2:J), 0)'],
      ['Skor Tertinggi (%)', '=IFERROR(MAX(J2:J), 0)'],
      ['Skor Terendah (%)', '=IFERROR(MIN(J2:J), 0)'],
      ['Total Sesi Selesai', '=COUNTIF(K2:K, "Selesai")']
    ]);
  }

  initSheet(ss, SHEETS.SISWA, [
    'studentId', 'Nama', 'Kelas', 'Status', 'Terakhir_Diperbarui'
  ]);

  initSheet(ss, SHEETS.HASIL, [
    'resultId', 'Timestamp', 'studentId', 'Nama_Siswa', 'Kelas', 'quizId',
    'questionId', 'Teks_Pertanyaan', 'Jawaban_Siswa', 'Kunci_Jawaban',
    'Nilai', 'Nilai_Maksimum', 'Status_Penilaian', 'Durasi_Pengerjaan'
  ]);

  initSheet(ss, SHEETS.LOG_SINKRONISASI, [
    'ID_Operasi', 'Jenis_Operasi', 'Status', 'Jumlah_Data',
    'Waktu_Mulai', 'Waktu_Selesai', 'Pesan'
  ]);

  const settingsSheet = initSheet(ss, SHEETS.PENGATURAN, [
    'Kunci_Pengaturan', 'Nilai', 'Diperbarui_Pada'
  ]);

  upsertByCompositeKey(settingsSheet, [0], ['Spreadsheet_ID'], [
    'Spreadsheet_ID',
    ss.getId(),
    new Date().toISOString()
  ]);
  upsertByCompositeKey(settingsSheet, [0], ['Versi_Script'], [
    'Versi_Script',
    'V11-PirateAcademy',
    new Date().toISOString()
  ]);

  return {
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheets: [
      SHEETS.BANK_SOAL,
      SHEETS.REKAP_NILAI,
      SHEETS.SISWA,
      SHEETS.HASIL,
      SHEETS.LOG_SINKRONISASI,
      SHEETS.PENGATURAN
    ]
  };
}

function initSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#281647')
      .setFontColor('#facc15');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function upsertByCompositeKey(sheet, keyColumnIndices, keyValues, rowData) {
  const safeRow = rowData.map(escapeFormulaCell);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const numCols = Math.max(sheet.getLastColumn(), safeRow.length);
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
        sheet.getRange(i + 2, 1, 1, safeRow.length).setValues([safeRow]);
        return 'updated';
      }
    }
  }
  sheet.appendRow(safeRow);
  return 'inserted';
}

function appendLogEntry(ss, entry) {
  const logSheet = ss.getSheetByName(SHEETS.LOG_SINKRONISASI);
  if (!logSheet) return;
  const now = new Date().toISOString();
  const opId = String(entry.idOperasi || ('op-' + Date.now()));
  upsertByCompositeKey(logSheet, [0], [opId], [
    opId,
    entry.jenisOperasi || 'Sinkronisasi',
    entry.status || 'Sukses',
    Number(entry.jumlahData || 0),
    entry.waktuMulai || now,
    entry.waktuSelesai || now,
    entry.pesan || ''
  ]);
}

function getIntegrationStatus() {
  const info = setupSpreadsheet();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bankSheet = ss.getSheetByName(SHEETS.BANK_SOAL);
  const rekapSheet = ss.getSheetByName(SHEETS.REKAP_NILAI);

  return {
    success: true,
    message: 'Pirate Academy V11 Apps Script API aktif dan siap menerima sinkronisasi!',
    spreadsheetId: info.spreadsheetId,
    spreadsheetName: info.spreadsheetName,
    sheets: info.sheets,
    bankSoalRows: bankSheet ? Math.max(0, bankSheet.getLastRow() - 1) : 0,
    rekapRows: rekapSheet ? Math.max(0, rekapSheet.getLastRow() - 1) : 0,
    timestamp: new Date().toISOString()
  };
}

function testConnection() {
  const status = getIntegrationStatus();
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

function doGet(e) {
  const providedToken = e && e.parameter && e.parameter.syncToken;
  if (!verifyOptionalToken(providedToken)) {
    return jsonResponse({
      success: false,
      message: 'Token sinkronisasi Apps Script tidak cocok (Unauthorized).'
    });
  }

  const action = (e && e.parameter && e.parameter.action) || 'status';

  if (action === 'status') {
    return jsonResponse(getIntegrationStatus());
  }

  if (action === 'getRekap') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEETS.REKAP_NILAI) || ss.getSheetByName(SHEETS.REKAP_LEGACY);
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
    if (!e || !e.postData || !e.postData.contents || !String(e.postData.contents).trim()) {
      return jsonResponse({ success: false, status: 'error', message: 'Payload POST kosong.' });
    }

    let contents;
    try {
      contents = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({
        success: false,
        status: 'error',
        message: 'Body permintaan POST bukan JSON yang valid.'
      });
    }

    if (!contents || typeof contents !== 'object') {
      return jsonResponse({
        success: false,
        status: 'error',
        message: 'Struktur payload JSON tidak valid.'
      });
    }

    if (!verifyOptionalToken(contents.syncToken)) {
      return jsonResponse({
        success: false,
        status: 'error',
        message: 'Token sinkronisasi Apps Script tidak cocok (Unauthorized).'
      });
    }

    setupSpreadsheet();
    const action = contents.action;
    const payload = contents.payload;

    if (action === 'syncPackage') {
      return handleSyncPackage(payload);
    }
    if (action === 'saveSessionV4') {
      return handleSaveSessionV4(payload);
    }
    if (action === 'saveSession') {
      return handleLegacySession(payload);
    }

    return jsonResponse({
      success: false,
      status: 'error',
      message: 'Aksi POST tidak didukung: ' + String(action || '')
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      status: 'error',
      message: 'Kesalahan Apps Script: ' + (err && err.message ? err.message : String(err))
    });
  } finally {
    lock.releaseLock();
  }
}

function handleSyncPackage(pkg) {
  if (!pkg || !Array.isArray(pkg.questions)) {
    return jsonResponse({ success: false, status: 'error', message: 'Payload BankSoal tidak valid.' });
  }
  if (pkg.questions.length > MAX_ROWS_PER_REQUEST) {
    return jsonResponse({
      success: false,
      status: 'error',
      message: 'Jumlah soal melebihi batas maksimum ' + MAX_ROWS_PER_REQUEST + ' baris per permintaan.'
    });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bankSheet = ss.getSheetByName(SHEETS.BANK_SOAL);
  const now = new Date().toISOString();
  let count = 0;

  pkg.questions.forEach(q => {
    const idSoal = q.questionId || ('soal-' + count);
    const opsiStr = q.opsiJson || q.pilihanJawaban || '-';
    upsertByCompositeKey(bankSheet, [0, 11], [idSoal, q.quizId || pkg.quizId || ''], [
      idSoal,
      Number(q.nomorSoal || (count + 1)),
      q.jenisSoal || 'multiple_choice',
      q.teksPertanyaan || '',
      opsiStr,
      q.kunciJawaban || 'Belum ditentukan',
      q.pembahasan || '',
      q.gambarUrl || '',
      q.statusPublikasi || 'Aktif',
      Number(q.versi || pkg.versi || 1),
      q.updatedAt || now,
      q.quizId || pkg.quizId || ''
    ]);
    count++;
  });

  const opLog = pkg.operationLog || {
    idOperasi: 'op-pkg-' + Date.now(),
    jenisOperasi: 'Sinkronisasi BankSoal',
    status: 'Sukses',
    jumlahData: count,
    waktuMulai: now,
    waktuSelesai: new Date().toISOString(),
    pesan: 'BankSoal disinkronkan (' + count + ' soal, quizId: ' + pkg.quizId + ')'
  };
  appendLogEntry(ss, opLog);

  return jsonResponse({
    success: true,
    status: 'ok',
    operationId: opLog.idOperasi,
    quizId: pkg.quizId || '',
    message: 'BankSoal berhasil disinkronkan (' + count + ' soal untuk paket ' + (pkg.title || pkg.quizId) + ')!',
    count: count
  });
}

function handleSaveSessionV4(payload) {
  if (!payload || !payload.sessionId) {
    return jsonResponse({ success: false, message: 'Payload sesi tidak valid.' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const siswaSheet = ss.getSheetByName(SHEETS.SISWA);
  const hasilSheet = ss.getSheetByName(SHEETS.HASIL);
  const rekapSheet = ss.getSheetByName(SHEETS.REKAP_NILAI);
  const now = new Date().toISOString();

  if (payload.siswa) {
    upsertByCompositeKey(siswaSheet, [0], [payload.siswa.studentId], [
      payload.siswa.studentId,
      payload.siswa.nama,
      payload.siswa.kelas,
      payload.siswa.status,
      payload.siswa.updatedAt || now
    ]);
  }

  let hasilCount = 0;
  if (Array.isArray(payload.hasilRows)) {
    if (payload.hasilRows.length > MAX_ROWS_PER_REQUEST) {
      return jsonResponse({ success: false, message: 'Batas baris Hasil terlampaui.' });
    }
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
      r.updatedAt || now
    ]);
  }

  appendLogEntry(ss, {
    idOperasi: 'op-ses-' + Date.now(),
    jenisOperasi: 'Sinkronisasi RekapNilai',
    status: 'Sukses',
    jumlahData: hasilCount,
    waktuMulai: now,
    waktuSelesai: new Date().toISOString(),
    pesan: 'Sesi ' + payload.sessionId + ' (' + hasilCount + ' jawaban)'
  });

  return jsonResponse({
    success: true,
    message: 'Data Siswa, Hasil (' + hasilCount + ' jawaban), dan RekapNilai tersinkronisasi tanpa duplikasi!',
    sessionId: payload.sessionId
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

function testSampleSync() {
  setupSpreadsheet();
  handleSyncPackage({
    quizId: 'SAMPLE_TEST_QUIZ',
    title: 'Uji Coba Koneksi',
    versi: 1,
    questions: [
      {
        quizId: 'SAMPLE_TEST_QUIZ',
        questionId: 'SAMPLE_Q1',
        nomorSoal: 1,
        jenisSoal: 'multiple_choice',
        teksPertanyaan: 'Contoh uji tulis BankSoal (boleh dihapus)',
        opsiJson: JSON.stringify([{ id: 'A', text: 'Benar' }, { id: 'B', text: 'Salah' }]),
        kunciJawaban: 'A',
        pembahasan: 'Ini hanya data uji koneksi.',
        gambarUrl: '',
        statusPublikasi: 'UjiCoba',
        versi: 1
      }
    ]
  });
}

function clearTestSampleData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bankSheet = ss.getSheetByName(SHEETS.BANK_SOAL);
  if (!bankSheet || bankSheet.getLastRow() < 2) return;
  const rows = bankSheet.getRange(2, 1, bankSheet.getLastRow() - 1, 1).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === 'SAMPLE_Q1') {
      bankSheet.deleteRow(i + 2);
    }
  }
}

function jsonResponse(data) {
  const normalized = Object.assign(
    {
      success: Boolean(data && data.success !== false),
      status: data && data.success !== false ? 'ok' : 'error'
    },
    data || {}
  );
  return ContentService.createTextOutput(JSON.stringify(normalized))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

export async function syncSessionToGoogleSheets(
  session: StudentSession
): Promise<SheetsApiResponse & { session?: StudentSession }> {
  return syncStudentSheetsApi(session.sessionId);
}

export async function testSheetsConnection(webAppUrl: string): Promise<SheetsApiResponse> {
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com')) {
    return {
      success: false,
      message: 'Format URL tidak valid. Harus dimulai dengan https://script.google.com/macros/s/...',
    };
  }
  return testSheetsConnectionBackendApi(webAppUrl);
}
