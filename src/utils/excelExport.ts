import * as XLSX from 'xlsx';
import { DocumentItem } from '../types';

export function exportDocumentsToXlsx(
  docs: DocumentItem[],
  customFileName?: string
): void {
  if (docs.length === 0) return;

  const headers = [
    'التسلسل',
    'اسم الملف',
    'العدد',
    'التاريخ',
    'التقويم',
    'الجهة المصدرة',
    'العنوان',
    'إلى (المرسل إليه)',
    'الموضوع',
    'مضمون الكتاب',
    'الحالة',
  ];

  const rows = docs.map((doc, idx) => [
    idx + 1,
    doc.fileName,
    doc.editedIssueNumber || '',
    doc.editedDate || '',
    doc.result?.calendarType === 'hijri'
      ? 'هجري'
      : doc.result?.calendarType === 'gregorian'
      ? 'ميلادي'
      : '',
    doc.editedIssuingEntity || '',
    doc.editedTitle || '',
    doc.editedRecipient || '',
    doc.editedSubject || '',
    doc.editedBodyContent || '',
    doc.userVerified ? 'معتمد' : 'مستخرج تلقائياً',
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
    { wch: 26 },
    { wch: 22 },
    { wch: 26 },
    { wch: 28 },
    { wch: 48 },
    { wch: 16 },
  ];
  worksheet['!views'] = [{ rightToLeft: true }];

  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'سجل الكتب');

  const safeName =
    customFileName ||
    `سجل_الكتب_الرسمية_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`);
}
