import React, { useEffect, useState } from 'react';
import {
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { ConfidenceLevel, DigitPreference, DocumentItem } from '../types';
import {
  TOP_RIGHT_BOX,
  convertToEasternDigits,
  convertToWesternDigits,
  cropRegionDataUrl,
} from '../utils/imageProcessing';

interface ExtractionPanelProps {
  documentItem: DocumentItem | null;
  digitPreference: DigitPreference;
  onChangeDigitPreference: (pref: DigitPreference) => void;
  onUpdateField: (
    id: string,
    field:
      | 'editedIssueNumber'
      | 'editedDate'
      | 'editedIssuingEntity'
      | 'editedTitle'
      | 'editedRecipient'
      | 'editedSubject'
      | 'editedBodyContent',
    value: string
  ) => void;
  onVerifyDocument: (id: string) => void;
  onRetry: (id: string) => void;
  onReanalyzeUltra: (id: string) => void;
}

function renderConfidenceIndicator(level: ConfidenceLevel) {
  if (level === 'high') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>دقة عالية</span>
      </span>
    );
  }
  if (level === 'medium') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>يحتاج مراجعة</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
      <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>خط غير واضح</span>
    </span>
  );
}

export const ExtractionPanel: React.FC<ExtractionPanelProps> = ({
  documentItem,
  digitPreference,
  onChangeDigitPreference,
  onUpdateField,
  onVerifyDocument,
  onRetry,
  onReanalyzeUltra,
}) => {
  const [headerCropUrl, setHeaderCropUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHeaderCropUrl(null);

    if (!documentItem?.result) return;

    const targetRegion = documentItem.result.headerRegionBox || TOP_RIGHT_BOX;

    cropRegionDataUrl(documentItem.imageDataUrl, targetRegion, 0, {
      maxDim: 1400,
      format: 'image/png',
      contrastFilter: false,
    })
      .then((url) => {
        if (!cancelled) setHeaderCropUrl(url);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [documentItem?.id, documentItem?.imageDataUrl, documentItem?.result]);

  const handleCopy = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  if (!documentItem) {
    return (
      <aside className="w-full lg:w-[390px] shrink-0 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-base font-bold text-slate-900">
          نتائج الاستخراج والتدقيق
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          عند رفع صورة كتاب رسمي، سيظهر هنا العدد والتاريخ المستخرجان مع عدسة مكبرة لموضع خط اليد لتسهيل المطابقة البصرية الفورية.
        </p>
      </aside>
    );
  }

  const formatForPreference = (rawVal: string, normVal: string) => {
    if (digitPreference === 'raw') return rawVal || normVal;
    if (digitPreference === 'eastern') return convertToEasternDigits(normVal || rawVal);
    return convertToWesternDigits(normVal || rawVal);
  };

  return (
    <aside className="flex w-full lg:w-[390px] shrink-0 flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold text-slate-900">
            نتائج الاستخراج والتدقيق
          </h2>
          {documentItem.userVerified && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>معتمد</span>
            </span>
          )}
        </div>

        {/* Unboxed Metadata Line */}
        {documentItem.result && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>
              {documentItem.result.calendarType === 'hijri'
                ? 'التقويم الهجري'
                : documentItem.result.calendarType === 'gregorian'
                ? 'التقويم الميلادي'
                : 'تقويم غير محدد'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {documentItem.precisionMode === 'ultra' ? 'دقة فائقة' : 'وضع سريع'}
            </span>
            {typeof documentItem.extractionDurationMs === 'number' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {(documentItem.extractionDurationMs / 1000).toFixed(2)} ثانية
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Body States */}
      <div className="flex-1 p-5 space-y-6">
        {documentItem.status === 'processing' && (
          <div className="py-12 text-center space-y-3">
            <Loader2
              className="mx-auto h-7 w-7 animate-spin text-blue-900"
              aria-hidden="true"
            />
            <div className="font-display text-sm font-bold text-slate-900">
              جاري فحص ترويسة الكتاب وقراءة خط اليد...
            </div>
            <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
              يتم تحليل ضربات القلم للأرقام الهندية والقياسية وتحديد مواضع العدد والتاريخ.
            </p>
          </div>
        )}

        {documentItem.status === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>تعذر استخراج البيانات</span>
            </div>
            <p className="text-xs leading-relaxed text-red-700">
              {documentItem.errorMessage || 'حدث خطأ غير متوقع أثناء قراءة الصورة.'}
            </p>
            <button
              type="button"
              onClick={() => onRetry(documentItem.id)}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        )}

        {(documentItem.status === 'extracted' || documentItem.status === 'verified') &&
          documentItem.result && (
            <>
              {/* Digit Format Switch */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-600">
                  تنسيق عرض الأرقام
                </span>
                <div
                  role="group"
                  aria-label="تنسيق عرض الأرقام"
                  className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"
                >
                  {(
                    [
                      { id: 'western', label: 'قياسي 123' },
                      { id: 'eastern', label: 'هندي ١٢٣' },
                      { id: 'raw', label: 'كما كُتبت' },
                    ] as Array<{ id: DigitPreference; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onChangeDigitPreference(opt.id)}
                      className={`min-h-[34px] rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        digitPreference === opt.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Single Large Upper-Right Preview (الجزء الأيمن: العدد والتاريخ) */}
              {headerCropUrl && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="mb-1.5 text-[11px] font-medium text-slate-600">
                    منطقة القراءة المكبّرة (الجزء الأيمن — العدد والتاريخ):
                  </div>
                  <img
                    src={headerCropUrl}
                    alt="الجزء الأيمن من الكتاب"
                    referrerPolicy="no-referrer"
                    className="max-h-56 w-full mx-auto rounded border border-slate-200 bg-white object-contain"
                  />
                </div>
              )}

              {/* Field 1: Issue Number (العدد) */}
              <div className="space-y-2.5 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="field-issue-number"
                    className="font-display text-sm font-bold text-slate-900"
                  >
                    العدد (رقم الكتاب)
                  </label>
                  {renderConfidenceIndicator(documentItem.result.issueNumberConfidence)}
                </div>

                <div className="flex items-stretch gap-2">
                  <input
                    id="field-issue-number"
                    type="text"
                    dir="ltr"
                    value={documentItem.editedIssueNumber}
                    onChange={(e) =>
                      onUpdateField(documentItem.id, 'editedIssueNumber', e.target.value)
                    }
                    placeholder="لم يُرصد عدد"
                    className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-lg font-semibold text-slate-900 tabular-nums focus:border-blue-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy('issue', documentItem.editedIssueNumber)
                    }
                    title="نسخ العدد"
                    aria-label="نسخ العدد"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    {copiedKey === 'issue' ? (
                      <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>
                    النص الأصلي:{' '}
                    <span dir="ltr" className="font-mono text-slate-700">
                      {documentItem.result.issueNumberRaw || '—'}
                    </span>
                  </span>
                  {documentItem.result.alternativeIssueNumber &&
                    documentItem.result.alternativeIssueNumber !==
                      documentItem.editedIssueNumber && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateField(
                            documentItem.id,
                            'editedIssueNumber',
                            formatForPreference(
                              documentItem.result!.alternativeIssueNumber!,
                              documentItem.result!.alternativeIssueNumber!
                            )
                          )
                        }
                        className="text-blue-900 underline underline-offset-2 hover:text-blue-700 cursor-pointer"
                      >
                        اعتماد القراءة البديلة ({documentItem.result.alternativeIssueNumber})
                      </button>
                    )}
                </div>
              </div>

              {/* Field 2: Date (التاريخ) */}
              <div className="space-y-2.5 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="field-date"
                    className="font-display text-sm font-bold text-slate-900"
                  >
                    التاريخ
                  </label>
                  {renderConfidenceIndicator(documentItem.result.dateConfidence)}
                </div>

                <div className="flex items-stretch gap-2">
                  <input
                    id="field-date"
                    type="text"
                    dir="ltr"
                    value={documentItem.editedDate}
                    onChange={(e) =>
                      onUpdateField(documentItem.id, 'editedDate', e.target.value)
                    }
                    placeholder="لم يُرصد تاريخ"
                    className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-lg font-semibold text-slate-900 tabular-nums focus:border-blue-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy('date', documentItem.editedDate)}
                    title="نسخ التاريخ"
                    aria-label="نسخ التاريخ"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    {copiedKey === 'date' ? (
                      <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>
                    كما كُتب:{' '}
                    <span dir="ltr" className="font-mono text-slate-700">
                      {documentItem.result.dateRaw || '—'}
                    </span>
                  </span>
                  {documentItem.result.alternativeDate &&
                    documentItem.result.alternativeDate !== documentItem.editedDate && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateField(
                            documentItem.id,
                            'editedDate',
                            formatForPreference(
                              documentItem.result!.alternativeDate!,
                              documentItem.result!.alternativeDate!
                            )
                          )
                        }
                        className="text-blue-900 underline underline-offset-2 hover:text-blue-700 cursor-pointer"
                      >
                        اعتماد القراءة البديلة ({documentItem.result.alternativeDate})
                      </button>
                    )}
                </div>
              </div>

              {/* Title / Recipient / Subject / Body Section */}
              <div className="space-y-3 border-t border-slate-200 pt-4">
                {documentItem.isBodyLoading && (
                  <div className="flex items-center gap-2 text-xs text-blue-900">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                    <span>جاري استخراج مضمون الكتاب وتفاصيله...</span>
                  </div>
                )}
                <div>
                  <label
                    htmlFor="field-title"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    عنوان الكتاب (مثل: أمر جامعي، إعمام)
                  </label>
                  <input
                    id="field-title"
                    type="text"
                    value={documentItem.editedTitle}
                    onChange={(e) =>
                      onUpdateField(documentItem.id, 'editedTitle', e.target.value)
                    }
                    placeholder="يظهر تلقائياً عند غياب إلى/ و م/"
                    className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-blue-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="field-recipient"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    إلى / (المرسل إليه)
                  </label>
                  <input
                    id="field-recipient"
                    type="text"
                    value={documentItem.editedRecipient}
                    onChange={(e) =>
                      onUpdateField(documentItem.id, 'editedRecipient', e.target.value)
                    }
                    placeholder="—"
                    className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="field-subject"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    م / (موضوع الكتاب)
                  </label>
                  <input
                    id="field-subject"
                    type="text"
                    value={documentItem.editedSubject}
                    onChange={(e) =>
                      onUpdateField(documentItem.id, 'editedSubject', e.target.value)
                    }
                    placeholder="—"
                    className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="field-body-content"
                      className="block text-xs font-semibold text-slate-800"
                    >
                      مضمون الكتاب
                    </label>
                    <button
                      type="button"
                      onClick={() => handleCopy('body', documentItem.editedBodyContent)}
                      disabled={!documentItem.editedBodyContent}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-900 hover:text-blue-700 disabled:opacity-40 cursor-pointer"
                    >
                      {copiedKey === 'body' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                          <span className="text-emerald-700">تم نسخ المضمون</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>نسخ المضمون</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    id="field-body-content"
                    rows={5}
                    value={documentItem.editedBodyContent}
                    onChange={(e) =>
                      onUpdateField(documentItem.id, 'editedBodyContent', e.target.value)
                    }
                    placeholder="سيظهر هنا النص الكامل لمضمون الكتاب..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-900 focus:border-blue-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="field-entity"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    الجهة المصدرة (اختياري للأرشفة)
                  </label>
                  <input
                    id="field-entity"
                    type="text"
                    value={documentItem.editedIssuingEntity}
                    onChange={(e) =>
                      onUpdateField(
                        documentItem.id,
                        'editedIssuingEntity',
                        e.target.value
                      )
                    }
                    placeholder="—"
                    className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-900 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}
      </div>

      {/* Footer Action Bar */}
      {(documentItem.status === 'extracted' || documentItem.status === 'verified') && (
        <div className="border-t border-slate-200 bg-slate-50/70 p-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onVerifyDocument(documentItem.id)}
            className={`inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              documentItem.userVerified
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-blue-900 text-white hover:bg-blue-800'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>
              {documentItem.userVerified ? 'تم الاعتماد في السجل' : 'اعتماد وحفظ في السجل'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onReanalyzeUltra(documentItem.id)}
            className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>إعادة القراءة بوضع الدقة الفائقة</span>
          </button>
        </div>
      )}
    </aside>
  );
};
