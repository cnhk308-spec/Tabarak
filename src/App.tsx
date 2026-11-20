import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppView, TopBar } from './components/TopBar';
import { DocumentQueueSidebar } from './components/DocumentQueueSidebar';
import { DocumentCanvas } from './components/DocumentCanvas';
import { ExtractionPanel } from './components/ExtractionPanel';
import { LedgerTableView } from './components/LedgerTableView';
import { AccuracyGuideView } from './components/AccuracyGuideView';
import {
  BoundingBox,
  DigitPreference,
  DocumentItem,
  ExtractionResult,
  PrecisionMode,
  ScanRegion,
} from './types';
import {
  TOP_RIGHT_BOX,
  convertToEasternDigits,
  convertToWesternDigits,
  cropRegionDataUrl,
  enhanceInkContrastDataUrl,
  generateSampleOfficialLetterFile,
  loadImageFile,
  rotateImageDataUrl,
} from './utils/imageProcessing';

function formatExtractedValue(
  raw: string,
  normalized: string,
  pref: DigitPreference
): string {
  const base = normalized || raw || '';
  if (pref === 'raw') return raw || normalized || '';
  if (pref === 'eastern') return convertToEasternDigits(base);
  return convertToWesternDigits(base);
}

function mapCroppedBoxToFullImage(
  innerBox: BoundingBox | null | undefined,
  cropBox: BoundingBox
): BoundingBox | null {
  if (!innerBox) return null;
  const cropW = cropBox.xmax - cropBox.xmin;
  const cropH = cropBox.ymax - cropBox.ymin;
  return {
    xmin: Math.round(cropBox.xmin + (innerBox.xmin / 1000) * cropW),
    xmax: Math.round(cropBox.xmin + (innerBox.xmax / 1000) * cropW),
    ymin: Math.round(cropBox.ymin + (innerBox.ymin / 1000) * cropH),
    ymax: Math.round(cropBox.ymin + (innerBox.ymax / 1000) * cropH),
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('workspace');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>('standard');
  const [scanRegion, setScanRegion] = useState<ScanRegion>('top-right');
  const [digitPreference, setDigitPreference] = useState<DigitPreference>('western');
  const [hintText, setHintText] = useState<string>('');
  const [enhanceContrast, setEnhanceContrast] = useState<boolean>(false);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [isGeneratingSample, setIsGeneratingSample] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeDocument = useMemo(
    () => documents.find((d) => d.id === activeId) ?? null,
    [documents, activeId]
  );

  const runExtraction = useCallback(
    async (
      docId: string,
      imageDataUrl: string,
      mimeType: string,
      mode: PrecisionMode,
      options?: {
        isCroppedRegion?: boolean;
        cropOriginBox?: BoundingBox;
        applyContrast?: boolean;
        regionOverride?: ScanRegion;
      }
    ) => {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, status: 'processing', precisionMode: mode, errorMessage: undefined }
            : d
        )
      );

      const startedAt = performance.now();
      try {
        const effectiveRegion = options?.regionOverride ?? scanRegion;
        let payloadDataUrl = imageDataUrl;
        let resolvedMimeType = mimeType;
        let isCropped = Boolean(options?.isCroppedRegion);
        let originBox = options?.cropOriginBox;

        if (!isCropped && effectiveRegion === 'top-right') {
          payloadDataUrl = await cropRegionDataUrl(imageDataUrl, TOP_RIGHT_BOX, 0, {
            maxDim: 1000,
            format: 'image/jpeg',
            quality: 0.92,
            contrastFilter: false,
          });
          resolvedMimeType = 'image/jpeg';
          isCropped = true;
          originBox = TOP_RIGHT_BOX;
        }

        if (options?.applyContrast) {
          payloadDataUrl = await enhanceInkContrastDataUrl(payloadDataUrl);
          resolvedMimeType = 'image/jpeg';
        }

        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: payloadDataUrl,
            mimeType: resolvedMimeType,
            precisionMode: mode,
            isCroppedRegion: isCropped,
            hintText,
          }),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'تعذر الاتصال بخدمة التحليل.');
        }

        const result = data.result as ExtractionResult;

        if (isCropped && originBox) {
          result.issueNumberBox = mapCroppedBoxToFullImage(
            result.issueNumberBox,
            originBox
          );
          result.dateBox = mapCroppedBoxToFullImage(
            result.dateBox,
            originBox
          );
        }

        const durationMs = Math.round(performance.now() - startedAt);

        setDocuments((prev) =>
          prev.map((d) => {
            if (d.id !== docId) return d;
            return {
              ...d,
              status: 'extracted',
              extractionDurationMs: durationMs,
              result,
              editedIssueNumber: formatExtractedValue(
                result.issueNumberRaw,
                result.issueNumberNormalized,
                digitPreference
              ),
              editedDate: formatExtractedValue(
                result.dateRaw,
                result.dateNormalized,
                digitPreference
              ),
              editedIssuingEntity: result.issuingEntity || '',
              editedRecipient: result.recipient || '',
              editedSubject: result.subject || '',
              userVerified: false,
            };
          })
        );
      } catch (err: any) {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  status: 'error',
                  errorMessage: err?.message || 'حدث خطأ أثناء تحليل الصورة.',
                }
              : d
          )
        );
      }
    },
    [digitPreference, hintText, scanRegion]
  );

  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;

      setActiveView('workspace');

      for (const file of files) {
        try {
          const loaded = await loadImageFile(file);
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const newDoc: DocumentItem = {
            id,
            fileName: file.name || 'صورة_كتاب_رسمي.png',
            fileSize: file.size,
            imageDataUrl: loaded.dataUrl,
            mimeType: loaded.mimeType,
            width: loaded.width,
            height: loaded.height,
            uploadedAt: Date.now(),
            status: 'processing',
            precisionMode,
            editedIssueNumber: '',
            editedDate: '',
            editedIssuingEntity: '',
            editedRecipient: '',
            editedSubject: '',
            userVerified: false,
          };

          setDocuments((prev) => [newDoc, ...prev]);
          setActiveId(id);

          // Trigger server extraction immediately
          void runExtraction(id, loaded.dataUrl, loaded.mimeType, precisionMode, {
            applyContrast: enhanceContrast,
          });
        } catch {
          // Ignore unreadable individual file
        }
      }
    },
    [enhanceContrast, precisionMode, runExtraction]
  );

  // Clipboard paste support (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void handleFilesSelected(imageFiles);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFilesSelected]);

  const handleTriggerUpload = () => {
    fileInputRef.current?.click();
  };

  const handleLoadSample = async () => {
    setIsGeneratingSample(true);
    try {
      const sampleFile = await generateSampleOfficialLetterFile();
      await handleFilesSelected([sampleFile]);
    } finally {
      setIsGeneratingSample(false);
    }
  };

  const handleRemoveDocument = (id: string) => {
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleRotate90 = async () => {
    if (!activeDocument) return;
    try {
      const rotated = await rotateImageDataUrl(activeDocument.imageDataUrl, 90);
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === activeDocument.id
            ? {
                ...d,
                imageDataUrl: rotated.dataUrl,
                mimeType: 'image/jpeg',
                width: rotated.width,
                height: rotated.height,
              }
            : d
        )
      );
      await runExtraction(
        activeDocument.id,
        rotated.dataUrl,
        'image/jpeg',
        precisionMode,
        { applyContrast: enhanceContrast }
      );
    } catch {
      // Ignore rotation failure
    }
  };

  const handleExtractCroppedBox = async (box: BoundingBox) => {
    if (!activeDocument) return;
    try {
      const croppedUrl = await cropRegionDataUrl(activeDocument.imageDataUrl, box, 0, {
        maxDim: 1300,
        format: 'image/png',
      });
      await runExtraction(activeDocument.id, croppedUrl, 'image/png', precisionMode, {
        isCroppedRegion: true,
        cropOriginBox: box,
        applyContrast: enhanceContrast,
      });
    } catch {
      // Ignore crop failure
    }
  };

  const handleRetryDocument = (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;
    void runExtraction(doc.id, doc.imageDataUrl, doc.mimeType, doc.precisionMode, {
      applyContrast: enhanceContrast,
    });
  };

  const handleReanalyzeUltra = (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;
    void runExtraction(doc.id, doc.imageDataUrl, doc.mimeType, 'ultra', {
      applyContrast: enhanceContrast,
    });
  };

  const handleUpdateField = (
    id: string,
    field: 'editedIssueNumber' | 'editedDate' | 'editedIssuingEntity' | 'editedRecipient' | 'editedSubject',
    value: string
  ) => {
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, [field]: value, userVerified: false } : d
      )
    );
  };

  const handleVerifyDocument = (id: string) => {
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              userVerified: !d.userVerified,
              status: !d.userVerified ? 'verified' : 'extracted',
            }
          : d
      )
    );
  };

  const handleChangeDigitPreference = (pref: DigitPreference) => {
    setDigitPreference(pref);
    setDocuments((prev) =>
      prev.map((d) => {
        if (!d.result || d.userVerified) return d;
        return {
          ...d,
          editedIssueNumber: formatExtractedValue(
            d.result.issueNumberRaw,
            d.result.issueNumberNormalized,
            pref
          ),
          editedDate: formatExtractedValue(
            d.result.dateRaw,
            d.result.dateNormalized,
            pref
          ),
        };
      })
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeView={activeView}
        onChangeView={setActiveView}
        onTriggerUpload={handleTriggerUpload}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFilesSelected(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 py-5 space-y-6">
        {activeView === 'workspace' && (
          <>
            <div className="flex flex-col lg:flex-row items-stretch gap-5">
              <DocumentQueueSidebar
                documents={documents}
                activeId={activeId}
                precisionMode={precisionMode}
                scanRegion={scanRegion}
                hintText={hintText}
                onChangePrecisionMode={setPrecisionMode}
                onChangeScanRegion={(region) => {
                  setScanRegion(region);
                  if (activeDocument && activeDocument.status !== 'processing') {
                    void runExtraction(
                      activeDocument.id,
                      activeDocument.imageDataUrl,
                      activeDocument.mimeType,
                      precisionMode,
                      { applyContrast: enhanceContrast, regionOverride: region }
                    );
                  }
                }}
                onChangeHintText={setHintText}
                onSelectDocument={setActiveId}
                onRemoveDocument={handleRemoveDocument}
                onTriggerUpload={handleTriggerUpload}
                onLoadSample={handleLoadSample}
                isGeneratingSample={isGeneratingSample}
              />

              <DocumentCanvas
                documentItem={activeDocument}
                scanRegion={scanRegion}
                enhanceContrast={enhanceContrast}
                showBoxes={showBoxes}
                onToggleContrast={() => setEnhanceContrast((v) => !v)}
                onToggleBoxes={() => setShowBoxes((v) => !v)}
                onRotate90={handleRotate90}
                onExtractCroppedBox={handleExtractCroppedBox}
                onDropFiles={handleFilesSelected}
                onTriggerUpload={handleTriggerUpload}
                onLoadSample={handleLoadSample}
                isGeneratingSample={isGeneratingSample}
              />

              <ExtractionPanel
                documentItem={activeDocument}
                digitPreference={digitPreference}
                onChangeDigitPreference={handleChangeDigitPreference}
                onUpdateField={handleUpdateField}
                onVerifyDocument={handleVerifyDocument}
                onRetry={handleRetryDocument}
                onReanalyzeUltra={handleReanalyzeUltra}
              />
            </div>

            {documents.length > 0 && (
              <LedgerTableView
                documents={documents}
                onInspectDocument={(id) => {
                  setActiveId(id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onDeleteDocument={handleRemoveDocument}
                onTriggerUpload={handleTriggerUpload}
                compact
              />
            )}
          </>
        )}

        {activeView === 'ledger' && (
          <LedgerTableView
            documents={documents}
            onInspectDocument={(id) => {
              setActiveId(id);
              setActiveView('workspace');
            }}
            onDeleteDocument={handleRemoveDocument}
            onTriggerUpload={handleTriggerUpload}
          />
        )}

        {activeView === 'guide' && (
          <AccuracyGuideView
            onReturnToWorkspace={() => setActiveView('workspace')}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 sm:px-6 py-4 text-xs text-slate-500">
          <span>مرصاد الوثائق — أداة فحص وأرشفة الكتب الرسمية</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveView('workspace')}
              className="hover:text-slate-900 cursor-pointer"
            >
              مساحة الفحص
            </button>
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className="hover:text-slate-900 cursor-pointer"
            >
              سجل الكتب
            </button>
            <button
              type="button"
              onClick={() => setActiveView('guide')}
              className="hover:text-slate-900 cursor-pointer"
            >
              إرشادات الدقة
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
