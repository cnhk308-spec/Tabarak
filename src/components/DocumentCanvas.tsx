import React, { useRef, useState, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Contrast,
  Crop,
  Eye,
  EyeOff,
  Maximize2,
  Upload,
  Sparkles,
  Check,
  X,
  FileText,
} from 'lucide-react';
import { BoundingBox, DocumentItem, ScanRegion } from '../types';
import { TOP_RIGHT_BOX } from '../utils/imageProcessing';

interface DocumentCanvasProps {
  documentItem: DocumentItem | null;
  scanRegion: ScanRegion;
  enhanceContrast: boolean;
  showBoxes: boolean;
  onToggleContrast: () => void;
  onToggleBoxes: () => void;
  onRotate90: () => void;
  onExtractCroppedBox: (box: BoundingBox) => void;
  onDropFiles: (files: FileList | File[]) => void;
  onTriggerUpload: () => void;
  onLoadSample: () => void;
  isGeneratingSample: boolean;
}

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({
  documentItem,
  scanRegion,
  enhanceContrast,
  showBoxes,
  onToggleContrast,
  onToggleBoxes,
  onRotate90,
  onExtractCroppedBox,
  onDropFiles,
  onTriggerUpload,
  onLoadSample,
  isGeneratingSample,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [cropMode, setCropMode] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Manual crop box in percentage 0..100
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const imageWrapperRef = useRef<HTMLDivElement>(null);

  // Reset zoom and crop when switching documents
  useEffect(() => {
    setZoom(1);
    setCropMode(false);
    setCropRect(null);
    setDragStart(null);
  }, [documentItem?.id]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropFiles(e.dataTransfer.files);
    }
  };

  const getRelativePercent = (clientX: number, clientY: number) => {
    const el = imageWrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!cropMode) return;
    e.preventDefault();
    const pos = getRelativePercent(e.clientX, e.clientY);
    setDragStart(pos);
    setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!cropMode || !dragStart) return;
    const pos = getRelativePercent(e.clientX, e.clientY);
    const x = Math.min(dragStart.x, pos.x);
    const y = Math.min(dragStart.y, pos.y);
    const w = Math.abs(pos.x - dragStart.x);
    const h = Math.abs(pos.y - dragStart.y);
    setCropRect({ x, y, w, h });
  };

  const handlePointerUp = () => {
    if (!cropMode || !dragStart) return;
    setDragStart(null);
  };

  const handleConfirmCrop = () => {
    if (!cropRect || cropRect.w < 2 || cropRect.h < 2) return;
    const box: BoundingBox = {
      xmin: Math.round(cropRect.x * 10),
      ymin: Math.round(cropRect.y * 10),
      xmax: Math.round((cropRect.x + cropRect.w) * 10),
      ymax: Math.round((cropRect.y + cropRect.h) * 10),
    };
    onExtractCroppedBox(box);
    setCropMode(false);
    setCropRect(null);
  };

  if (!documentItem) {
    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-1 min-h-[540px] flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white p-8 text-center transition-colors ${
          isDraggingOver
            ? 'border-blue-900 bg-blue-50/40'
            : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        <div className="mx-auto flex max-w-md flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-blue-900">
            <Upload className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-display text-xl font-bold text-slate-900 text-balance">
            ضع صورة الكتاب الرسمي لاستخراج العدد والتاريخ
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
            اسحب صورة الكتاب وأفلتها هنا، أو الصقها مباشرة من الحافظة عبر{' '}
            <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              Ctrl + V
            </kbd>
            . يدعم النظام قراءة الخط اليدوي للأرقام الهندية والقياسية والتواريخ بدقة عالية.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onTriggerUpload}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>اختيار صورة من الجهاز</span>
            </button>

            <button
              type="button"
              onClick={onLoadSample}
              disabled={isGeneratingSample}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span>
                {isGeneratingSample ? 'جاري التحميل...' : 'تجربة بنموذج كتاب رسمي'}
              </span>
            </button>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-slate-500">
            <span>JPG / PNG / WEBP</span>
            <span aria-hidden="true">·</span>
            <span>تحديد يدوي للترويسة</span>
            <span aria-hidden="true">·</span>
            <span>تحسين وضوح الحبر</span>
          </div>
        </div>
      </div>
    );
  }

  const issueBox = documentItem.result?.issueNumberBox;
  const dateBox = documentItem.result?.dateBox;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-1 min-w-0 flex-col rounded-xl border border-slate-200 bg-white overflow-hidden"
    >
      {/* Document Inspection Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            title="تصغير"
            aria-label="تصغير الصورة"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </button>

          <span className="min-w-[52px] text-center font-mono text-xs font-medium text-slate-700 tabular-nums">
            {Math.round(zoom * 100)}%
          </span>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
            title="تكبير"
            aria-label="تكبير الصورة"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setZoom(1)}
            title="ملاءمة الشاشة"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>ملاءمة</span>
          </button>

          <div className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />

          <button
            type="button"
            onClick={onRotate90}
            disabled={documentItem.status === 'processing'}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>تدوير ٩٠°</span>
          </button>

          <button
            type="button"
            onClick={onToggleContrast}
            aria-pressed={enhanceContrast}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              enhanceContrast
                ? 'border-blue-900 bg-blue-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Contrast className="h-3.5 w-3.5" aria-hidden="true" />
            <span>تحسين الحبر</span>
          </button>

          <button
            type="button"
            onClick={onToggleBoxes}
            aria-pressed={showBoxes}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showBoxes
                ? 'border-slate-300 bg-slate-200/70 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {showBoxes ? (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>إظهار المواضع</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setCropMode((prev) => !prev);
            setCropRect(null);
            setDragStart(null);
          }}
          aria-pressed={cropMode}
          disabled={documentItem.status === 'processing'}
          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer ${
            cropMode
              ? 'border-amber-600 bg-amber-50 text-amber-900'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
          }`}
        >
          <Crop className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{cropMode ? 'إلغاء التحديد' : 'تحديد منطقة يدوياً'}</span>
        </button>
      </div>

      {/* Contextual Crop Action Bar */}
      {cropMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50/70 px-4 py-2 text-xs text-amber-950">
          <span>
            اسحب بالمؤشر لرسم مربع حول سطر العدد والتاريخ في الترويسة ثم اضغط «تحليل المنطقة المحددة».
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmCrop}
              disabled={!cropRect || cropRect.w < 2 || cropRect.h < 2}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md bg-blue-900 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>تحليل المنطقة المحددة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCropMode(false);
                setCropRect(null);
              }}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>إلغاء</span>
            </button>
          </div>
        </div>
      )}

      {/* Interactive Document Image Stage */}
      <div
        className={`relative flex-1 overflow-auto bg-slate-100/90 p-4 sm:p-6 min-h-[520px] max-h-[720px] flex items-start justify-center ${
          isDraggingOver ? 'ring-2 ring-inset ring-blue-900' : ''
        }`}
      >
        <div
          ref={imageWrapperRef}
          dir="ltr"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            width: `${Math.round(zoom * 100)}%`,
            maxWidth: zoom === 1 ? '100%' : 'none',
          }}
          className={`relative inline-block select-none bg-white shadow-sm border border-slate-200 ${
            cropMode ? 'cursor-crosshair touch-none' : 'cursor-default'
          }`}
        >
          <img
            src={documentItem.imageDataUrl}
            alt={documentItem.fileName}
            referrerPolicy="no-referrer"
            draggable={false}
            style={{
              filter: enhanceContrast
                ? 'contrast(1.42) brightness(1.05) saturate(1.15)'
                : 'none',
            }}
            className="block w-full h-auto"
          />

          {/* Top-Right Scan Zone Reference Frame */}
          {showBoxes && !cropMode && scanRegion === 'top-right' && (
            <div
              style={{
                top: `${TOP_RIGHT_BOX.ymin / 10}%`,
                left: `${TOP_RIGHT_BOX.xmin / 10}%`,
                width: `${(TOP_RIGHT_BOX.xmax - TOP_RIGHT_BOX.xmin) / 10}%`,
                height: `${(TOP_RIGHT_BOX.ymax - TOP_RIGHT_BOX.ymin) / 10}%`,
              }}
              className="pointer-events-none absolute border border-dashed border-slate-400/80 bg-blue-500/[0.02]"
            >
              <span
                dir="rtl"
                className="absolute top-1.5 left-1.5 bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
              >
                نطاق الفحص (العلوي الأيمن)
              </span>
            </div>
          )}

          {/* Detected Bounding Box Overlays */}
          {showBoxes && !cropMode && issueBox && (
            <div
              style={{
                top: `${issueBox.ymin / 10}%`,
                left: `${issueBox.xmin / 10}%`,
                width: `${Math.max(2, (issueBox.xmax - issueBox.xmin) / 10)}%`,
                height: `${Math.max(2, (issueBox.ymax - issueBox.ymin) / 10)}%`,
              }}
              className="pointer-events-none absolute border-2 border-blue-700 bg-blue-700/10"
            >
              <span
                dir="rtl"
                className="absolute -top-6 right-0 bg-blue-900 px-1.5 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
              >
                العدد
              </span>
            </div>
          )}

          {showBoxes && !cropMode && dateBox && (
            <div
              style={{
                top: `${dateBox.ymin / 10}%`,
                left: `${dateBox.xmin / 10}%`,
                width: `${Math.max(2, (dateBox.xmax - dateBox.xmin) / 10)}%`,
                height: `${Math.max(2, (dateBox.ymax - dateBox.ymin) / 10)}%`,
              }}
              className="pointer-events-none absolute border-2 border-emerald-700 bg-emerald-700/10"
            >
              <span
                dir="rtl"
                className="absolute -bottom-6 right-0 bg-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
              >
                التاريخ
              </span>
            </div>
          )}

          {/* Active Manual Crop Selection Rectangle */}
          {cropMode && cropRect && cropRect.w > 0 && cropRect.h > 0 && (
            <div
              style={{
                top: `${cropRect.y}%`,
                left: `${cropRect.x}%`,
                width: `${cropRect.w}%`,
                height: `${cropRect.h}%`,
              }}
              className="pointer-events-none absolute border-2 border-amber-600 bg-amber-500/15"
            >
              <span
                dir="rtl"
                className="absolute -top-6 right-0 inline-flex items-center gap-1 bg-amber-700 px-1.5 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
              >
                <Check className="h-2.5 w-2.5" aria-hidden="true" />
                منطقة الفحص
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom File Meta Footer (Clean unboxed metadata with middle dots) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
        <div className="flex items-center gap-2 truncate">
          <span className="font-medium text-slate-800 truncate max-w-[240px]">
            {documentItem.fileName}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums" dir="ltr">
            {documentItem.width}×{documentItem.height}
          </span>
        </div>
        <div className="text-[11px] text-slate-500">
          يمكنك لصق صورة جديدة مباشرة بالضغط على Ctrl+V
        </div>
      </div>
    </div>
  );
};
