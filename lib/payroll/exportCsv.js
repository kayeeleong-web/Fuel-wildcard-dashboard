/**
 * Tiny client-side CSV download used by the Payroll tab's "Export" buttons
 * (2026-09-17, Kayee: "give me an export button... I want to confirm with accounting,
 * one for the employee part and one for the bonus part, I want it listed out").
 * CSV rather than xlsx so there's no dependency — Excel / Google Sheets open it
 * directly. UTF-8 BOM so Excel reads names like Na'ama / Dyussembayeva correctly.
 */
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, headers, rows) {
  if (typeof window === 'undefined') return;
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** YYYY-MM-DD -> MM/DD/YYYY for the export (matches what the UI shows). */
export function csvDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : dateStr || '';
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}
