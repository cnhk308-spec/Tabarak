import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Trash2,
  Upload,
  FileText,
} from 'lucide-react';
import { DocumentItem, PrecisionMode, ScanRegion } from '../types';
import { formatFileSize } from '../utils/imageProcessing';

interface DocumentQueueSidebarProps {
  documents: DocumentItem[];
  activeId: string | null;
  precisionMode: PrecisionMode;
  scanRegion: ScanRegion;
  hintText: string;
  onChangePrecisionMode: (mode: PrecisionMode) => void;
  onChangeScanRegion: (region: ScanRegion) => void;
  onChangeHintText: (val: string) => void;
  onSelectDocument: (id: string) => void;
  onRemoveDocument: (id: string) => void;
  onTriggerUpload: () => void;
  onLoadSample: () => void;
  isGeneratingSample: boolean;
}

export const DocumentQueueSidebar: React.FC<DocumentQueueSidebarProps> = ({
  documents,
  activeId,
  precisionMode,
  scanRegion,
  hintText,
  onChangePrecisionMode,
  onChangeScanRegion,
  onChangeHintText,
  onSelectDocument,
  onRemoveDocument,
  onTriggerUpload,
  onLoadSample,
  isGeneratingSample,
}) => {
  return (
    <aside className="flex w-full lg:w-[290px] shrink-0 flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Upload & Extraction Options */}
      <div className="p-4 border-b border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900">
            إعدادات القراءة
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            {documents.length} ملف
          </span>
        </div>

        {/* Scan Region Segmented Switch */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">
            منطقة الفحص
          </label>
          <div
            role="group"
            aria-label="منطقة الفحص"
            className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
          >
            <button
              type="button"
              onClick={() => onChangeScanRegion('full')}
              className={`min-h-[36px] rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scanRegion === 'full'
                  ? 'bg-white text-blue-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الكتاب كاملاً
            </button>
            <button
              type="button"
              onClick={() => onChangeScanRegion('top-right')}
              className={`min-h-[36px] rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scanRegion === 'top-right'
                  ? 'bg-white text-blue-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              العلوي الأيمن فقط
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            يستخرج في «الكتاب كاملاً» العدد والتاريخ والعنوان أو إلى/م ومضمون الكتاب مع تقريب مكبّر للزاوية العليا اليمنى.
          </p>
        </div>

        {/* Precision Mode Segmented Switch */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">
            مستوى التحليل
          </label>
          <div
            role="group"
            aria-label="مستوى التحليل"
            className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
          >
            <button
              type="button"
              onClick={() => onChangePrecisionMode('standard')}
              className={`min-h-[36px] rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                precisionMode === 'standard'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              سريع ودقيق
            </button>
            <button
              type="button"
              onClick={() => onChangePrecisionMode('ultra')}
              className={`min-h-[36px] rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                precisionMode === 'ultra'
                  ? 'bg-white text-blue-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              دقة فائقة
            </button>
          </div>
        </div>

        {/* Optional Context Hint */}
        <div className="space-y-1.5">
          <label
            htmlFor="extraction-hint"
            className="block text-xs font-medium text-slate-600"
          >
            تلميح اختياري للدفعة
          </label>
          <input
            id="extraction-hint"
            type="text"
            value={hintText}
            onChange={(e) => onChangeHintText(e.target.value)}
            placeholder="مثال: السنة 2025 أو البادئة م/4"
            className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-900 focus:bg-white focus:outline-none"
          />
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onTriggerUpload}
            className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>إضافة صور كتب</span>
          </button>
          <button
            type="button"
            onClick={onLoadSample}
            disabled={isGeneratingSample}
            className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-800 hover:text-blue-900 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {isGeneratingSample ? 'جاري تجهيز النموذج...' : 'تجربة بنموذج كتاب رسمي'}
            </span>
          </button>
        </div>
      </div>

      {/* Document Queue List */}
      <div className="flex-1 overflow-y-auto max-h-[460px] lg:max-h-[540px]">
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
          <span className="text-xs font-semibold text-slate-700">
            قائمة الكتب المرفوعة
          </span>
        </div>

        {documents.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              لا توجد كتب مرفوعة حالياً. ارفع صورة أو الصق مباشرة باستخدام Ctrl+V.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {documents.map((doc) => {
              const isSelected = doc.id === activeId;
              const isNeedsReview =
                doc.status === 'extracted' &&
                !doc.userVerified &&
                (doc.result?.issueNumberConfidence !== 'high' ||
                  doc.result?.dateConfidence !== 'high');

              return (
                <li key={doc.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectDocument(doc.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectDocument(doc.id);
                      }
                    }}
                    className={`group flex items-start gap-3 px-4 py-3 text-right transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-900 ${
                      isSelected
                        ? 'bg-blue-50/70'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <img
                      src={doc.imageDataUrl}
                      alt={doc.fileName}
                      referrerPolicy="no-referrer"
                      className="h-12 w-10 shrink-0 rounded border border-slate-200 object-cover bg-slate-100"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`truncate text-xs font-semibold ${
                            isSelected ? 'text-blue-950' : 'text-slate-900'
                          }`}
                        >
                          {doc.fileName}
                        </p>
                        <button
                          type="button"
                          aria-label={`حذف ${doc.fileName}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveDocument(doc.id);
                          }}
                          className="opacity-70 hover:opacity-100 text-slate-400 hover:text-red-700 p-1 rounded cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span aria-hidden="true">·</span>
                        {doc.status === 'processing' && (
                          <span className="inline-flex items-center gap-1 text-blue-800 font-medium">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            <span>جاري القراءة</span>
                          </span>
                        )}
                        {doc.status === 'error' && (
                          <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                            <XCircle className="h-3 w-3" aria-hidden="true" />
                            <span>تعذر التحليل</span>
                          </span>
                        )}
                        {(doc.status === 'extracted' || doc.status === 'verified') && (
                          <span
                            className={`inline-flex items-center gap-1 font-medium ${
                              doc.userVerified
                                ? 'text-emerald-700'
                                : isNeedsReview
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {doc.userVerified ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                <span>معتمد</span>
                              </>
                            ) : isNeedsReview ? (
                              <>
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                <span>للمراجعة</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                <span>مستخرج</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      {(doc.editedIssueNumber || doc.editedDate) && (
                        <div
                          dir="ltr"
                          className="mt-1.5 flex items-center justify-end gap-2 font-mono text-[11px] text-slate-700 tabular-nums truncate"
                        >
                          <span>{doc.editedDate || '—'}</span>
                          <span className="text-slate-300" aria-hidden="true">
                            |
                          </span>
                          <span className="font-semibold text-slate-900">
                            {doc.editedIssueNumber || '—'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};
