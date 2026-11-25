/**
 * Interactive Google Sheets & Apps Script Installation Guide Modal (Bahasa Indonesia)
 * Matches /GOOGLE_SHEETS_SETUP.md and lets teachers copy Code.gs in one click.
 * Created by Deni Raja99
 */

import React, { useState } from 'react';
import { BookOpen, CheckCircle2, Copy, ExternalLink, X } from 'lucide-react';
import { GOOGLE_APPS_SCRIPT_CODE } from '../services/sheetsApi';
import { sounds } from '../services/audio';

interface GoogleSheetsGuideModalProps {
  onClose: () => void;
}

export const GoogleSheetsGuideModal: React.FC<GoogleSheetsGuideModalProps> = ({ onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
    setCopied(true);
    sounds.playClick();
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80">
      <div className="px-card-gold w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b-2 border-[#6d28d9]">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-[#facc15]" />
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[#facc15]">
                PANDUAN INSTALASI GOOGLE SHEETS &amp; APPS SCRIPT
              </h3>
              <p className="text-[11px] text-[#cbb7eb]">
                Panduan lengkap langkah demi langkah (Windows / Chromebook / Browser)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-btn px-btn-pink p-1.5 cursor-pointer"
            aria-label="Tutup panduan"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Steps */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs leading-relaxed">
          <div className="px-subcard p-3.5 space-y-1.5">
            <div className="font-bold text-[#facc15] text-sm">
              1. Buat Google Spreadsheet Baru
            </div>
            <p className="text-[#f8f4ff]">
              Buka browser lalu kunjungi{' '}
              <a
                href="https://sheets.new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#facc15] underline inline-flex items-center gap-1"
              >
                https://sheets.new <ExternalLink className="w-3 h-3" />
              </a>
              . Ubah nama spreadsheet menjadi <strong>Database Pirate Academy 3D</strong>. Simpan tautan spreadsheet jika ingin menautkannya di menu Pengaturan Integrasi.
            </p>
          </div>

          <div className="px-subcard p-3.5 space-y-1.5">
            <div className="font-bold text-[#facc15] text-sm">
              2. Buka Editor Google Apps Script &amp; Tempel Code.gs
            </div>
            <p className="text-[#f8f4ff]">
              Klik menu <strong>Ekstensi &gt; Apps Script</strong> (Extensions &gt; Apps Script). Hapus seluruh kode bawaan (<kbd className="px-1.5 py-0.5 bg-[#281647] border border-[#6d28d9]">Ctrl+A</kbd> lalu <kbd className="px-1.5 py-0.5 bg-[#281647] border border-[#6d28d9]">Del</kbd>), lalu klik tombol <strong>Salin Code.gs</strong> di bawah ini dan tempelkan (<kbd className="px-1.5 py-0.5 bg-[#281647] border border-[#6d28d9]">Ctrl+V</kbd>). Simpan dengan <kbd className="px-1.5 py-0.5 bg-[#281647] border border-[#6d28d9]">Ctrl+S</kbd>.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={handleCopy}
                className="px-btn px-btn-pink px-3.5 py-1.5 text-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Code.gs Berhasil Disalin!' : 'Salin Code.gs Lengkap'}</span>
              </button>
            </div>
          </div>

          <div className="px-subcard p-3.5 space-y-1.5">
            <div className="font-bold text-[#facc15] text-sm">
              3. Jalankan Fungsi setupSpreadsheet (Sekali Saja)
            </div>
            <p className="text-[#f8f4ff]">
              Di editor Apps Script, pilih fungsi <code className="text-[#facc15]">setupSpreadsheet</code> di toolbar atas lalu klik <strong>Run</strong>. Berikan izin akses Google (klik <em>Lanjutan &gt; Buka ... (tidak aman) &gt; Izinkan</em>). Sheet otomatis terbentuk:
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {['BankSoal', 'RekapNilai', 'Siswa', 'Hasil', 'LogSinkronisasi', 'Pengaturan'].map((s) => (
                <span key={s} className="px-badge bg-[#281647] border-[#a855f7] text-[#facc15]">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="px-subcard p-3.5 space-y-1.5">
            <div className="font-bold text-[#facc15] text-sm">
              4. Deploy sebagai Aplikasi Web (Web App)
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[#f8f4ff]">
              <li>Klik <strong>Terapkan (Deploy) &gt; Penerapan baru (New deployment)</strong>.</li>
              <li>Pilih Jenis: <strong>Aplikasi web (Web app)</strong>.</li>
              <li>Jalankan sebagai (<em>Execute as</em>): <strong>Saya (Me)</strong>.</li>
              <li>Yang memiliki akses (<em>Who has access</em>): <strong>Siapa saja (Anyone)</strong>.</li>
              <li>Klik <strong>Terapkan</strong> dan salin URL yang berakhiran <code className="text-[#facc15]">/exec</code>.</li>
            </ul>
          </div>

          <div className="px-subcard p-3.5 space-y-1.5">
            <div className="font-bold text-[#facc15] text-sm">
              5. Masukkan URL ke Portal Guru &amp; Uji Koneksi
            </div>
            <p className="text-[#f8f4ff]">
              Tempel URL <code className="text-[#facc15]">https://script.google.com/macros/s/.../exec</code> di menu <strong>Pengaturan Integrasi</strong> Portal Guru, klik <strong>Simpan Pengaturan</strong>, lalu klik <strong>Uji Koneksi</strong> di tab Google Sheets.
            </p>
          </div>

          <div className="px-subcard p-3.5 space-y-1.5 border-[#ec4899]">
            <div className="font-bold text-[#f472b6] text-sm">
              Tips Pemecahan Masalah
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[#cbb7eb]">
              <li>Jika muncul pesan <em>respons bukan JSON valid</em> atau HTTP 401/403, pastikan akses deployment dipilih <strong>Siapa saja (Anyone)</strong>.</li>
              <li>Setiap kali mengubah kode <code className="text-white">Code.gs</code>, deploy ulang via <strong>Kelola penerapan &gt; Edit &gt; Versi baru</strong>.</li>
              <li>Dokumentasi versi lengkap juga tersedia di file <code className="text-white">GOOGLE_SHEETS_SETUP.md</code> dalam proyek.</li>
            </ul>
          </div>
        </div>

        <div className="p-4 border-t-2 border-[#6d28d9] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-btn px-btn-gold px-5 py-2 text-xs cursor-pointer"
          >
            Mengerti &amp; Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
