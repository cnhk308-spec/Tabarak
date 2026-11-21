import React, { useMemo, useState } from 'react';
import {
  Download,
  Copy,
  Check,
  Search,
  Trash2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { DocumentItem } from '../types';

interface LedgerTableViewProps {
  documents: DocumentItem[];
  onInspectDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onTriggerUpload: () => void;
  compact?: boolean;
}

export const LedgerTableView: React.FC<LedgerTableViewProps> = ({
  documents,
  onInspectDocument,
  onDeleteDocument,
  onTriggerUpload,
  compact = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'verified' | 'review'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      if (filterStatus === 'verified' && !doc.userVerified) return false;
      if (filterStatus === 'review' && doc.userVerified) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        doc.fileName.toLowerCase().includes(q) ||
        doc.editedIssueNumber.toLowerCase().includes(q) ||
        doc.editedDate.toLowerCase().includes(q) ||
        doc.editedTitle.toLowerCase().includes(q) ||
        doc.editedIssuingEntity.toLowerCase().includes(q) ||
        doc.editedRecipient.toLowerCase().includes(q) ||
        doc.editedSubject.toLowerCase().includes(q) ||
        doc.editedBodyContent.toLowerCase().includes(q)
      );
    });
  }, [documents, filterStatus, searchQuery]);

  const handleExportXlsx = () => {
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
    const rows = filteredDocs.map((doc, idx) => [
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
      doc.userVerified ? 'معتمد' : 'قيد المراجعة',
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
      { wch: 14 },
    ];
    worksheet['!views'] = [{ rightToLeft: true }];

    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(workbook, worksheet, 'سجل الكتب');

    const fileName = `سجل_الكتب_الرسمية_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const handleExportJson = () => {
    const payload = filteredDocs.map((doc, idx) => ({
      index: idx + 1,
      fileName: doc.fileName,
      issueNumber: doc.editedIssueNumber,
      date: doc.editedDate,
      calendarType: doc.result?.calendarType || 'unknown',
      title: doc.editedTitle,
      recipient: doc.editedRecipient,
      subject: doc.editedSubject,
      bodyContent: doc.editedBodyContent,
      verified: doc.userVerified,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `سجل_الكتب_الرسمية_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyRow = async (doc: DocumentItem) => {
    const text = `العدد: ${doc.editedIssueNumber || '—'} | التاريخ: ${doc.editedDate || '—'}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(doc.id);
      setTimeout(() => setCopiedId((prev) => (prev === doc.id ? null : prev)), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-base font-bold text-slate-900">
            سجل الكتب المستخرجة
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            {filteredDocs.length} من {documents.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالعدد أو التاريخ..."
              className="min-h-[36px] w-48 sm:w-56 rounded-lg border border-slate-200 bg-slate-50 pr-8 pl-3 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-900 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Filter Segmented Tabs */}
          <div
            role="group"
            aria-label="تصفية السجل"
            className="flex items-center gap-1 rounded-lg bg-slate-100 p-1"
          >
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'verified', label: 'المعتمد' },
                { id: 'review', label: 'للمراجعة' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterStatus(tab.id)}
                className={`min-h-[28px] rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterStatus === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Export Buttons */}
          {documents.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportXlsx}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>تصدير XLSX</span>
              </button>
              {!compact && (
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>JSON</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Table Body / Empty State */}
      {documents.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-slate-600">
            لم يتم تحليل أي كتب رسمية بعد. ارفع صورة كتاب ليظهر العدد والتاريخ هنا تلقائياً.
          </p>
          <button
            type="button"
            onClick={onTriggerUpload}
            className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-900 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>رفع أول كتاب</span>
          </button>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-slate-500">
          لا توجد نتائج مطابقة لبحثك الحالي.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4 w-12">#</th>
                <th className="py-2.5 px-4">الكتاب</th>
                <th className="py-2.5 px-4">العدد</th>
                <th className="py-2.5 px-4">التاريخ</th>
                <th className="py-2.5 px-4">العنوان / الموضوع</th>
                <th className="py-2.5 px-4">الحالة</th>
                <th className="py-2.5 px-4 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredDocs.map((doc, idx) => (
                <tr
                  key={doc.id}
                  className="hover:bg-slate-50/90 transition-colors h-[44px]"
                >
                  <td className="py-2.5 px-4 font-mono text-slate-400 tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={doc.imageDataUrl}
                        alt={doc.fileName}
                        referrerPolicy="no-referrer"
                        className="h-8 w-7 rounded border border-slate-200 object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate max-w-[180px]">
                          {doc.fileName}
                        </div>
                        {doc.editedRecipient && (
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            إلى: {doc.editedRecipient}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    <span dir="ltr">{doc.editedIssueNumber || '—'}</span>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-sm font-medium text-slate-800 tabular-nums">
                    <span dir="ltr">{doc.editedDate || '—'}</span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-700 max-w-[220px] truncate">
                    {doc.editedTitle || doc.editedSubject || '—'}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    {doc.userVerified ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>معتمد</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>قيد المراجعة</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopyRow(doc)}
                        title="نسخ العدد والتاريخ"
                        aria-label="نسخ العدد والتاريخ"
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        {copiedId === doc.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onInspectDocument(doc.id)}
                        title="عرض وتدقيق"
                        aria-label="عرض وتدقيق"
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteDocument(doc.id)}
                        title="حذف"
                        aria-label="حذف"
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
