import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderSearch, Loader2, X } from 'lucide-react';
import { AppView, TopBar } from './components/TopBar';
import { DocumentQueueSidebar } from './components/DocumentQueueSidebar';
import { DocumentCanvas } from './components/DocumentCanvas';
import { ExtractionPanel } from './components/ExtractionPanel';
import { LedgerTableView } from './components/LedgerTableView';
import { GeminiKeyButton } from './components/GeminiKeyButton';
import {
  extractDocumentProgressive,
  extractHeaderOnlyWithGemini,
  getStoredGeminiApiKey,
  setStoredGeminiApiKey,
} from './services/geminiExtractor';
import {
  BoundingBox,
  DigitPreference,
  DocumentItem,
  ExtractionResult,
  PrecisionMode,
  ScanRegion,
} from './types';
import { exportDocumentsToXlsx } from './utils/excelExport';
import {
  DirectoryHandleLike,
  canUseNativeDirectoryPicker,
  collectImagesFromDirectoryHandle,
  ensureDirectoryReadPermission,
  getSavedDirectoryHandle,
  isMobileBrowser,
  isOfficialLetterResult,
  isSupportedImageFile,
  saveDirectoryHandle,
} from './utils/folderScanner';
import {
  TOP_RIGHT_BOX,
  compressImageDataUrl,
  convertToEasternDigits,
  convertToWesternDigits,
  cropRegionDataUrl,
  enhanceInkContrastDataUrl,
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

function extractYearNumber(value?: string): number | null {
  if (!value) return null;
  const western = convertToWesternDigits(value);
  const match = western.match(/\b(1[3-5]\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSameCalendarEra(y1: number, y2: number): boolean {
  return (y1 >= 1900 && y2 >= 1900) || (y1 < 1900 && y2 < 1900);
}

function isTransientExtractionError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('ضغطاً') ||
    msg.includes('مشغولة') ||
    msg.includes('حد الطلبات') ||
    msg.includes('network') ||
    msg.includes('failed to fetch')
  );
}

function isCharacterSubsequence(shorter: string, longer: string): boolean {
  if (!shorter || shorter.length >= longer.length) return false;
  let sIdx = 0;
  for (let lIdx = 0; lIdx < longer.length && sIdx < shorter.length; lIdx++) {
    if (shorter[sIdx] === longer[lIdx]) {
      sIdx++;
    }
  }
  return sIdx === shorter.length;
}

function isValidCalendarDate(value?: string): boolean {
  if (!value) return false;
  const western = convertToWesternDigits(value).trim();
  const m = western.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return (
    year >= 1300 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  );
}

function reconcileZoomedHeaderResult(
  prev: ExtractionResult,
  zoomIssue: ExtractionResult | null,
  zoomDate: ExtractionResult | null,
  options?: { forceDateOverride?: boolean }
): ExtractionResult {
  let next: ExtractionResult = { ...prev };

  const zoomedIssueRaw = (zoomIssue?.issueNumberRaw || '').trim();
  if (zoomIssue && zoomedIssueRaw) {
    const prevRaw = prev.issueNumberRaw || '';
    const prevCompact = convertToWesternDigits(prevRaw).replace(/\s+/g, '');
    const zoomCompact = convertToWesternDigits(zoomedIssueRaw).replace(/\s+/g, '');
    const zoomMissedCharsFromPrev =
      prevCompact.length > zoomCompact.length &&
      isCharacterSubsequence(zoomCompact, prevCompact);

    if (zoomedIssueRaw !== prevRaw) {
      if (
        (zoomIssue.issueNumberConfidence === 'low' &&
          prev.issueNumberConfidence === 'high') ||
        (zoomMissedCharsFromPrev && prev.issueNumberConfidence !== 'low')
      ) {
        next.alternativeIssueNumber = zoomedIssueRaw;
      } else {
        next = {
          ...next,
          issueNumberRaw: zoomedIssueRaw,
          issueNumberNormalized: zoomIssue.issueNumberNormalized,
          issueNumberConfidence: zoomIssue.issueNumberConfidence,
          issueDigits:
            zoomIssue.issueDigits && zoomIssue.issueDigits.length > 0
              ? zoomIssue.issueDigits
              : prev.issueDigits,
          alternativeIssueNumber: prevRaw || prev.alternativeIssueNumber || '',
        };
      }
    } else {
      if (zoomIssue.issueNumberConfidence === 'high') {
        next.issueNumberConfidence = 'high';
      }
      if (zoomIssue.issueDigits && zoomIssue.issueDigits.length > 0) {
        next.issueDigits = zoomIssue.issueDigits;
      }
    }
  }

  const zoomedDateRaw = (zoomDate?.dateRaw || '').trim();
  const zoomedDateNorm = (zoomDate?.dateNormalized || '').trim();
  if (zoomDate && (zoomedDateRaw || zoomedDateNorm)) {
    const prevRaw = prev.dateRaw || '';
    const prevNorm = prev.dateNormalized || '';
    const prevValid = isValidCalendarDate(prevNorm);
    const zoomValid = isValidCalendarDate(zoomedDateNorm);
    const isDifferent =
      (zoomedDateNorm && zoomedDateNorm !== prevNorm) ||
      (zoomedDateRaw && zoomedDateRaw !== prevRaw);

    if (isDifferent) {
      const currCalYear = new Date().getFullYear();
      const prevYear = extractYearNumber(prevNorm || prevRaw);
      const zoomYear = extractYearNumber(zoomedDateNorm || zoomedDateRaw);
      const wouldDowngradeCurrentYear =
        !options?.forceDateOverride &&
        prevYear === currCalYear &&
        zoomYear !== null &&
        zoomYear !== currCalYear;

      // Never replace a valid 3-part date with a malformed date (e.g. 2026/002),
      // and ALWAYS allow a valid 3-part date to fix a malformed date.
      const rejectZoomForInvalidity = prevValid && !zoomValid;
      const forceAcceptValidFix = !prevValid && zoomValid;

      if (
        !forceAcceptValidFix &&
        (rejectZoomForInvalidity ||
          wouldDowngradeCurrentYear ||
          (!options?.forceDateOverride &&
            zoomDate.dateConfidence === 'low' &&
            prev.dateConfidence === 'high'))
      ) {
        next.alternativeDate = zoomedDateNorm || zoomedDateRaw;
      } else {
        next = {
          ...next,
          dateRaw: zoomedDateRaw || prevRaw,
          dateNormalized: zoomedDateNorm || prevNorm,
          dateConfidence:
            zoomDate.dateConfidence === 'low' &&
            (options?.forceDateOverride || forceAcceptValidFix)
              ? 'medium'
              : zoomDate.dateConfidence,
          dateDigits:
            zoomDate.dateDigits && zoomDate.dateDigits.length > 0
              ? zoomDate.dateDigits
              : prev.dateDigits,
          calendarType:
            zoomDate.calendarType !== 'unknown'
              ? zoomDate.calendarType
              : prev.calendarType,
          alternativeDate: prevNorm || prevRaw || prev.alternativeDate || '',
        };
      }
    } else {
      if (zoomDate.dateConfidence === 'high') {
        next.dateConfidence = 'high';
      }
      if (zoomDate.dateDigits && zoomDate.dateDigits.length > 0) {
        next.dateDigits = zoomDate.dateDigits;
      }
    }
  }

  return next;
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('workspace');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>('ultra');
  const [scanRegion, setScanRegion] = useState<ScanRegion>('full');
  const [digitPreference, setDigitPreference] = useState<DigitPreference>('western');
  const [hintText, setHintText] = useState<string>('');
  const [enhanceContrast, setEnhanceContrast] = useState<boolean>(false);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [apiKey, setApiKey] = useState<string>(() => getStoredGeminiApiKey());
  const [savedFolderName, setSavedFolderName] = useState<string | null>(null);
  const [folderScanState, setFolderScanState] = useState<{
    active: boolean;
    current: number;
    total: number;
    officialCount: number;
    skippedCount: number;
    folderName: string;
    phaseMessage?: string;
    doneMessage?: string;
    errorMessage?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const activeRunTokensRef = useRef<Record<string, number>>({});
  const documentsRef = useRef<DocumentItem[]>(documents);
  documentsRef.current = documents;

  useEffect(() => {
    if (canUseNativeDirectoryPicker()) {
      void getSavedDirectoryHandle().then((handle) => {
        if (handle?.name) {
          setSavedFolderName(handle.name);
        }
      });
    }
    if (folderInputRef.current && !isMobileBrowser()) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

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
        baseDoc?: DocumentItem;
        forceSingleUltraPass?: boolean;
      }
    ): Promise<DocumentItem | null> => {
      const runToken = (activeRunTokensRef.current[docId] || 0) + 1;
      activeRunTokensRef.current[docId] = runToken;
      const isStale = () => activeRunTokensRef.current[docId] !== runToken;

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: 'processing',
                isBodyLoading: false,
                isHeaderVerifying: false,
                precisionMode: mode,
                errorMessage: undefined,
              }
            : d
        )
      );

      const startedAt = performance.now();
      const useFastPass = !options?.forceSingleUltraPass;
      try {
        const effectiveRegion = options?.regionOverride ?? scanRegion;
        let payloadDataUrl = imageDataUrl;
        let resolvedMimeType = mimeType;
        let headerImageBase64: string | undefined;
        let headerMimeType: string | undefined;
        let isCropped = Boolean(options?.isCroppedRegion);
        let originBox = options?.cropOriginBox;
        let headerBoxOrigin: BoundingBox | null = null;
        let fullImagePromise:
          | Promise<{ imageBase64: string; mimeType: string }>
          | undefined;

        if (!isCropped && effectiveRegion === 'top-right') {
          payloadDataUrl = await cropRegionDataUrl(imageDataUrl, TOP_RIGHT_BOX, 0, {
            minDim: useFastPass ? 1100 : 1500,
            maxDim: useFastPass ? 1350 : 2100,
            format: useFastPass ? 'image/jpeg' : 'image/png',
            quality: 0.93,
            contrastFilter: false,
          });
          resolvedMimeType = useFastPass ? 'image/jpeg' : 'image/png';
          isCropped = true;
          originBox = TOP_RIGHT_BOX;
        } else if (!isCropped && effectiveRegion === 'full') {
          // Prepare compact fast crop first (~25ms) so header extraction starts immediately (<2s target)
          headerImageBase64 = await cropRegionDataUrl(imageDataUrl, TOP_RIGHT_BOX, 0, {
            minDim: useFastPass ? 1100 : 1500,
            maxDim: useFastPass ? 1350 : 2100,
            format: useFastPass ? 'image/jpeg' : 'image/png',
            quality: 0.93,
            contrastFilter: false,
          });
          headerMimeType = useFastPass ? 'image/jpeg' : 'image/png';
          headerBoxOrigin = TOP_RIGHT_BOX;

          fullImagePromise = compressImageDataUrl(imageDataUrl, 1450, 0.85).then(
            async (compressed) => {
              const finalFull = options?.applyContrast
                ? await enhanceInkContrastDataUrl(compressed)
                : compressed;
              payloadDataUrl = finalFull;
              resolvedMimeType = 'image/jpeg';
              return { imageBase64: finalFull, mimeType: 'image/jpeg' };
            }
          );
        }

        if (options?.applyContrast) {
          if (headerImageBase64) {
            headerImageBase64 = await enhanceInkContrastDataUrl(headerImageBase64);
            headerMimeType = 'image/jpeg';
          } else {
            payloadDataUrl = await enhanceInkContrastDataUrl(payloadDataUrl);
            resolvedMimeType = 'image/jpeg';
          }
        }

        const mapResultBoxes = (res: ExtractionResult): ExtractionResult => ({
          ...res,
          issueNumberBox: null,
          dateBox: null,
          headerRegionBox:
            isCropped && originBox
              ? originBox
              : res.boxReferenceImage === 'full_image'
              ? { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 }
              : headerBoxOrigin || TOP_RIGHT_BOX,
        });

        const expectsBody = effectiveRegion === 'full' && !isCropped;
        let ultraZoomPromise: Promise<void> | null = null;
        const tracker: {
          headerResult: ExtractionResult | null;
          editedIssue: string;
          editedDate: string;
          durationMs?: number;
        } = {
          headerResult: null,
          editedIssue: '',
          editedDate: '',
        };

        const runZoomVerify = async (
          sourceHeader: ExtractionResult,
          cfg: {
            verifyIssue: boolean;
            verifyDate: boolean;
            zoomPrecision?: PrecisionMode;
            extraDateHint?: string;
            forceDateOverride?: boolean;
          }
        ) => {
          if (!cfg.verifyIssue && !cfg.verifyDate) return;

          const effectiveZoomMode: PrecisionMode = cfg.zoomPrecision ?? 'ultra';
          const baseHint = hintText ? `${hintText} — ` : '';
          const strokeHint =
            'اقرأ كامل الجزء الأعلى الأيمن من الورقة بالكامل وفسّر شكل كل رقم في digits وdateDigits. تحقق مرتين من اليمين لليسار ثم من اليسار لليمين: لا تسقط الخانة الأخيرة القريبة من (:) مثل ٦ في ٥٠٨٦->٥٠٨، ولا تدمج (٨٦) في (٣) مثل ٥٠٨٦->٥٠٣، وميّز (٩) ذات الحلقة العلوية عن (٨ ∧)، وتأكد من (٦) في نهاية (٢٠٢٦) دون استبدالها بـ (٢٠٢٤) أو (٢٠٢٨) أو (٢٠٢٩).';

          let verifyImg = payloadDataUrl;
          let verifyMime = resolvedMimeType;

          if (!isCropped && sourceHeader.boxReferenceImage !== 'full_image') {
            const rawTopRight = await cropRegionDataUrl(imageDataUrl, TOP_RIGHT_BOX, 0, {
              minDim: 1500,
              maxDim: 2100,
              format: 'image/png',
              contrastFilter: false,
            });
            if (options?.applyContrast) {
              verifyImg = await enhanceInkContrastDataUrl(rawTopRight);
              verifyMime = 'image/jpeg';
            } else {
              verifyImg = rawTopRight;
              verifyMime = 'image/png';
            }
          }

          const combined = await extractHeaderOnlyWithGemini(
            {
              imageBase64: verifyImg,
              mimeType: verifyMime,
              precisionMode: effectiveZoomMode,
              fastPass: false,
              hintText: `${baseHint}قراءة كاملة وعالية الدقة للجزء الأعلى الأيمن من الورقة تضم الترويسة والعدد والتاريخ معاً. ${strokeHint} اقرأ التاريخ مكانياً (يسار/وسط/يمين) بدون عكس اليوم والشهر.${cfg.extraDateHint ? ` ${cfg.extraDateHint}` : ''}`,
            },
            apiKey
          );

          const zoomIssueRes: ExtractionResult | null = cfg.verifyIssue ? combined : null;
          const zoomDateRes: ExtractionResult | null = cfg.verifyDate ? combined : null;

          if (isStale()) return;

          if (tracker.headerResult) {
            const reconciled = reconcileZoomedHeaderResult(
              tracker.headerResult,
              zoomIssueRes,
              zoomDateRes,
              { forceDateOverride: cfg.forceDateOverride }
            );
            tracker.headerResult = reconciled;
            tracker.editedIssue = formatExtractedValue(
              reconciled.issueNumberRaw,
              reconciled.issueNumberNormalized,
              digitPreference
            );
            tracker.editedDate = formatExtractedValue(
              reconciled.dateRaw,
              reconciled.dateNormalized,
              digitPreference
            );
          }

          setDocuments((prev) =>
            prev.map((d) => {
              if (d.id !== docId || !d.result || d.userVerified) return d;
              const updatedResult = reconcileZoomedHeaderResult(
                d.result,
                zoomIssueRes,
                zoomDateRes,
                { forceDateOverride: cfg.forceDateOverride }
              );
              return {
                ...d,
                result: updatedResult,
                editedIssueNumber: formatExtractedValue(
                  updatedResult.issueNumberRaw,
                  updatedResult.issueNumberNormalized,
                  digitPreference
                ),
                editedDate: formatExtractedValue(
                  updatedResult.dateRaw,
                  updatedResult.dateNormalized,
                  digitPreference
                ),
              };
            })
          );
        };

        const executeProgressiveWithRecovery = async () => {
          const paramsPayload = {
            imageBase64: payloadDataUrl,
            mimeType: resolvedMimeType,
            headerImageBase64,
            headerMimeType,
            precisionMode: mode,
            fastPass: useFastPass,
            fullImagePromise,
            isCroppedRegion: isCropped,
            hintText,
          };
          const callbacksPayload = {
            onHeaderReady: (rawHeaderResult: ExtractionResult) => {
              if (isStale()) return;
              const headerMapped = mapResultBoxes(rawHeaderResult);
              const headerDurationMs = Math.round(performance.now() - startedAt);
              const nextIssue = formatExtractedValue(
                headerMapped.issueNumberRaw,
                headerMapped.issueNumberNormalized,
                digitPreference
              );
              const nextDate = formatExtractedValue(
                headerMapped.dateRaw,
                headerMapped.dateNormalized,
                digitPreference
              );

              tracker.headerResult = headerMapped;
              tracker.editedIssue = nextIssue;
              tracker.editedDate = nextDate;
              tracker.durationMs = headerDurationMs;

              const hasValidDateFormat = isValidCalendarDate(
                headerMapped.dateNormalized
              );
              const isHandwritten = Boolean(headerMapped.isHandwrittenDetected);
              const detectedHeaderYear = extractYearNumber(
                headerMapped.dateNormalized || headerMapped.dateRaw
              );
              const currCalYear = new Date().getFullYear();
              const hasYearDeviation =
                isHandwritten &&
                detectedHeaderYear !== null &&
                detectedHeaderYear !== currCalYear;

              const needsZoomVerify =
                (!isCropped || originBox === TOP_RIGHT_BOX) &&
                ((mode === 'ultra' && useFastPass) ||
                  isHandwritten ||
                  headerMapped.issueNumberConfidence !== 'high' ||
                  headerMapped.dateConfidence !== 'high' ||
                  !hasValidDateFormat ||
                  hasYearDeviation);

              setDocuments((prev) =>
                prev.map((d) => {
                  if (d.id !== docId) return d;
                  return {
                    ...d,
                    status: 'extracted',
                    isBodyLoading: expectsBody,
                    isHeaderVerifying: needsZoomVerify,
                    extractionDurationMs: headerDurationMs,
                    result: headerMapped,
                    editedIssueNumber: nextIssue,
                    editedDate: nextDate,
                    userVerified: false,
                  };
                })
              );

              if (needsZoomVerify) {
                const invalidDateHint = !hasValidDateFormat
                  ? `تنبيه حاسم: القراءة الأولية للتاريخ (${headerMapped.dateNormalized || headerMapped.dateRaw || 'ناقصة'}) غير صالحة أو ناقصة جزءاً! افحص سطر (التاريخ :) كاملاً من النقطتين (:) يساراً لاستخراج الأجزاء الثلاثة كاملة (اليوم 1-31 والشهر 1-12 والسنة 4 أرقام مثل ٢٠٢٦/٢/١١)، ولا تسقط اليوم (مثل ١١ أو 11) الملاصق لـ (التاريخ :) ولا تدمج (٢/١١) في (٠٠٢).`
                  : undefined;

                ultraZoomPromise = runZoomVerify(headerMapped, {
                  verifyIssue:
                    (mode === 'ultra' && useFastPass) ||
                    isHandwritten ||
                    headerMapped.issueNumberConfidence !== 'high',
                  verifyDate:
                    (mode === 'ultra' && useFastPass) ||
                    isHandwritten ||
                    headerMapped.dateConfidence !== 'high' ||
                    !hasValidDateFormat ||
                    hasYearDeviation,
                  zoomPrecision: 'ultra',
                  extraDateHint: invalidDateHint,
                  forceDateOverride: !hasValidDateFormat,
                })
                  .catch(() => {
                    // Keep initial header reading if zoomed verification fails
                  })
                  .finally(() => {
                    if (isStale()) return;
                    setDocuments((prev) =>
                      prev.map((d) =>
                        d.id === docId ? { ...d, isHeaderVerifying: false } : d
                      )
                    );
                  });
              }
            },
          };

          try {
            return await extractDocumentProgressive(
              paramsPayload,
              apiKey,
              callbacksPayload
            );
          } catch (firstErr) {
            if (isStale() || !isTransientExtractionError(firstErr)) {
              throw firstErr;
            }
            await new Promise((r) => setTimeout(r, 2200));
            if (isStale()) {
              throw firstErr;
            }
            return await extractDocumentProgressive(
              paramsPayload,
              apiKey,
              callbacksPayload
            );
          }
        };

        const fullResult = await executeProgressiveWithRecovery();

        if (isStale()) return null;
        if (fullImagePromise) {
          await fullImagePromise;
        }
        const mappedFull = mapResultBoxes(fullResult);
        if (ultraZoomPromise) {
          await ultraZoomPromise;
        }
        if (isStale()) return null;

        // If date is still malformed after Pass 2 (e.g. 2026/002 because faint ink next to التاريخ:),
        // run one contrast-enhanced header check specifically targeting all 3 date components.
        const postVerifySnap = tracker.headerResult ?? mappedFull;
        if (!isValidCalendarDate(postVerifySnap.dateNormalized) && !isCropped) {
          try {
            const rawTopRight = await cropRegionDataUrl(imageDataUrl, TOP_RIGHT_BOX, 0, {
              minDim: 1500,
              maxDim: 2100,
              format: 'image/png',
              contrastFilter: false,
            });
            const boosted = await enhanceInkContrastDataUrl(rawTopRight);
            const rescued = await extractHeaderOnlyWithGemini(
              {
                imageBase64: rawTopRight,
                mimeType: 'image/png',
                enhancedImageBase64: boosted,
                enhancedMimeType: 'image/jpeg',
                precisionMode: 'ultra',
                fastPass: false,
                hintText:
                  'قراءة الترويسة الأولى للتاريخ غير مكتملة! افحص كامل المنطقة بجانب (التاريخ :) من النقطتين يساراً حتى آخر رقم، وأخرج ٣ أجزاء صحيحة (اليوم 1-31 والشهر 1-12 والسنة 4 أرقام مثل ٢٠٢٦/٢/١١) بدون دمج (٢/١١) في (٠٠٢).',
              },
              apiKey
            );
            if (!isStale() && isValidCalendarDate(rescued.dateNormalized)) {
              const reconciled = reconcileZoomedHeaderResult(
                postVerifySnap,
                null,
                rescued,
                { forceDateOverride: true }
              );
              tracker.headerResult = reconciled;
              tracker.editedDate = formatExtractedValue(
                reconciled.dateRaw,
                reconciled.dateNormalized,
                digitPreference
              );
              setDocuments((prev) =>
                prev.map((d) =>
                  d.id === docId && d.result && !d.userVerified
                    ? { ...d, result: reconciled, editedDate: tracker.editedDate }
                    : d
                )
              );
            }
          } catch {
            // Keep existing value if rescue retry fails
          }
        }

        // Post-body cross-check: catch misread handwritten years (e.g. 2024/2022/2028/2029 vs 2026)
        const currentHeaderSnap = tracker.headerResult ?? mappedFull;
        const headerYear = extractYearNumber(
          currentHeaderSnap.dateNormalized || currentHeaderSnap.dateRaw
        );
        const sigYear = extractYearNumber(mappedFull.signatureDateHint);
        const bodyYear = extractYearNumber(mappedFull.latestBodyYear);
        const currentCalendarYear = new Date().getFullYear();

        let expectedRefYear: number | null = null;
        let provenYear: number | null = null;
        if (
          sigYear &&
          headerYear &&
          isSameCalendarEra(sigYear, headerYear) &&
          sigYear !== headerYear &&
          (headerYear !== currentCalendarYear || sigYear > headerYear)
        ) {
          expectedRefYear = sigYear;
          provenYear = sigYear;
        } else if (
          bodyYear &&
          headerYear &&
          isSameCalendarEra(bodyYear, headerYear) &&
          ((headerYear < bodyYear && bodyYear - headerYear <= 15) ||
            (headerYear > currentCalendarYear && bodyYear <= currentCalendarYear))
        ) {
          expectedRefYear = bodyYear;
          provenYear = bodyYear;
        } else if (
          headerYear &&
          headerYear >= 1900 &&
          headerYear > currentCalendarYear &&
          headerYear - currentCalendarYear <= 10
        ) {
          expectedRefYear = currentCalendarYear;
        }

        if (expectedRefYear && !isCropped) {
          try {
            await runZoomVerify(currentHeaderSnap, {
              verifyIssue: false,
              verifyDate: true,
              zoomPrecision: 'ultra',
              extraDateHint: `السنة المتوقعة للكتاب هي (${expectedRefYear}) وفق التوقيع/المتن أو السنة الحالية، بينما القراءة الأولية أعطت (${headerYear}). دقق جيداً في الرقم الأخير من السنة المكتوبة بخط اليد ولا تستبدل (٢٠٢٦) أبداً بـ (٢٠٢٤) أو (٢٠٢٨) أو (٢٠٢٩)، وسجل اليوم والشهر والسنة بدقة مكانية.`,
              forceDateOverride: true,
            });
          } catch {
            // Keep existing reading if post-body year verification fails
          }
          if (isStale()) return null;

          // Hard safety alignment when printed signature/body dates explicitly prove a newer/exact year
          if (provenYear) {
            const afterSnap = tracker.headerResult ?? mappedFull;
            const afterNorm = afterSnap.dateNormalized || '';
            const afterRaw = afterSnap.dateRaw || '';
            const afterYear = extractYearNumber(afterNorm || afterRaw);
            const stillContradictsSig =
              sigYear !== null &&
              provenYear === sigYear &&
              afterYear !== null &&
              isSameCalendarEra(sigYear, afterYear) &&
              afterYear !== sigYear;
            const stillContradictsBody =
              bodyYear !== null &&
              provenYear === bodyYear &&
              afterYear !== null &&
              isSameCalendarEra(bodyYear, afterYear) &&
              ((afterYear < bodyYear && bodyYear - afterYear <= 15) ||
                (afterYear > currentCalendarYear && bodyYear <= currentCalendarYear));

            if ((stillContradictsSig || stillContradictsBody) && afterYear) {
              const updatedNorm = afterNorm
                ? afterNorm.replace(
                    new RegExp(`\\b${afterYear}\\b`),
                    String(provenYear)
                  )
                : '';
              const updatedRaw = afterRaw
                ? convertToWesternDigits(afterRaw).replace(
                    new RegExp(`\\b${afterYear}\\b`),
                    String(provenYear)
                  )
                : '';

              if (
                (updatedNorm && updatedNorm !== afterNorm) ||
                (updatedRaw && updatedRaw !== afterRaw)
              ) {
                const alignedHeader: ExtractionResult = {
                  ...afterSnap,
                  dateRaw: updatedRaw || afterRaw,
                  dateNormalized: updatedNorm || afterNorm,
                  dateConfidence: 'medium',
                  alternativeDate: afterNorm || afterRaw || afterSnap.alternativeDate || '',
                };
                tracker.headerResult = alignedHeader;
                tracker.editedDate = formatExtractedValue(
                  alignedHeader.dateRaw,
                  alignedHeader.dateNormalized,
                  digitPreference
                );
                setDocuments((prev) =>
                  prev.map((d) => {
                    if (d.id !== docId || !d.result || d.userVerified) return d;
                    const alignedDocResult: ExtractionResult = {
                      ...d.result,
                      dateRaw: alignedHeader.dateRaw,
                      dateNormalized: alignedHeader.dateNormalized,
                      dateConfidence: alignedHeader.dateConfidence,
                      alternativeDate: alignedHeader.alternativeDate,
                    };
                    return {
                      ...d,
                      result: alignedDocResult,
                      editedDate: tracker.editedDate,
                    };
                  })
                );
              }
            }
          }
        }

        const durationMs = Math.round(performance.now() - startedAt);
        const mergedSnapshot: ExtractionResult = tracker.headerResult
          ? {
              ...tracker.headerResult,
              issuingEntity: mappedFull.issuingEntity || '',
              title: mappedFull.title || '',
              recipient: mappedFull.recipient || '',
              subject: mappedFull.subject || '',
              bodyContent: mappedFull.bodyContent || '',
            }
          : mappedFull;

        const finalIssue =
          tracker.editedIssue ||
          formatExtractedValue(
            mergedSnapshot.issueNumberRaw,
            mergedSnapshot.issueNumberNormalized,
            digitPreference
          );
        const finalDate =
          tracker.editedDate ||
          formatExtractedValue(
            mergedSnapshot.dateRaw,
            mergedSnapshot.dateNormalized,
            digitPreference
          );

        setDocuments((prev) =>
          prev.map((d) => {
            if (d.id !== docId) return d;
            const mergedResult: ExtractionResult = d.result
              ? {
                  ...d.result,
                  issuingEntity: mappedFull.issuingEntity || '',
                  title: mappedFull.title || '',
                  recipient: mappedFull.recipient || '',
                  subject: mappedFull.subject || '',
                  bodyContent: mappedFull.bodyContent || '',
                }
              : mappedFull;
            return {
              ...d,
              status: 'extracted',
              isBodyLoading: false,
              isHeaderVerifying: false,
              extractionDurationMs: d.extractionDurationMs ?? durationMs,
              result: mergedResult,
              editedIssueNumber: d.userVerified ? d.editedIssueNumber : finalIssue,
              editedDate: d.userVerified ? d.editedDate : finalDate,
              editedIssuingEntity: mergedResult.issuingEntity || '',
              editedTitle: mergedResult.title || '',
              editedRecipient: mergedResult.recipient || '',
              editedSubject: mergedResult.subject || '',
              editedBodyContent: mergedResult.bodyContent || '',
            };
          })
        );

        const baseDoc =
          options?.baseDoc ?? documentsRef.current.find((d) => d.id === docId) ?? null;
        if (!baseDoc) return null;
        return {
          ...baseDoc,
          status: 'extracted',
          isBodyLoading: false,
          isHeaderVerifying: false,
          extractionDurationMs: tracker.durationMs ?? durationMs,
          result: mergedSnapshot,
          editedIssueNumber: finalIssue,
          editedDate: finalDate,
          editedIssuingEntity: mergedSnapshot.issuingEntity || '',
          editedTitle: mergedSnapshot.title || '',
          editedRecipient: mergedSnapshot.recipient || '',
          editedSubject: mergedSnapshot.subject || '',
          editedBodyContent: mergedSnapshot.bodyContent || '',
        };
      } catch (err: any) {
        if (isStale()) return null;
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  status: 'error',
                  isBodyLoading: false,
                  isHeaderVerifying: false,
                  errorMessage: err?.message || 'حدث خطأ أثناء تحليل الصورة.',
                }
              : d
          )
        );
        return null;
      }
    },
    [apiKey, digitPreference, hintText, scanRegion]
  );

  const processFolderImages = useCallback(
    async (rawFiles: File[], folderName: string) => {
      const imageFiles = rawFiles
        .filter(isSupportedImageFile)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

      if (imageFiles.length === 0) {
        setFolderScanState({
          active: false,
          current: 0,
          total: 0,
          officialCount: 0,
          skippedCount: 0,
          folderName,
          errorMessage: 'لم يتم العثور على ملفات صور داخل المجلد المحدد.',
        });
        return;
      }

      setActiveView('workspace');

      const queuedDocs: DocumentItem[] = [];
      for (const file of imageFiles) {
        try {
          const loaded = await loadImageFile(file);
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          queuedDocs.push({
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
            editedTitle: '',
            editedRecipient: '',
            editedSubject: '',
            editedBodyContent: '',
            userVerified: false,
          });
        } catch {
          // Skip unreadable image file
        }
      }

      if (queuedDocs.length === 0) {
        setFolderScanState({
          active: false,
          current: 0,
          total: 0,
          officialCount: 0,
          skippedCount: 0,
          folderName,
          errorMessage: 'تعذر قراءة الصور الموجودة في المجلد.',
        });
        return;
      }

      setDocuments((prev) => [...queuedDocs, ...prev]);
      setActiveId(queuedDocs[0].id);

      setFolderScanState({
        active: true,
        current: 0,
        total: queuedDocs.length,
        officialCount: 0,
        skippedCount: 0,
        folderName,
      });

      const batchResults = new Map<string, DocumentItem | null>();
      let initialOfficialCount = 0;
      let initialSkippedCount = 0;

      for (let i = 0; i < queuedDocs.length; i++) {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 220));
        }
        const doc = queuedDocs[i];
        setActiveId(doc.id);
        setFolderScanState({
          active: true,
          current: i + 1,
          total: queuedDocs.length,
          officialCount: initialOfficialCount,
          skippedCount: initialSkippedCount,
          folderName,
        });

        const extractedDoc = await runExtraction(
          doc.id,
          doc.imageDataUrl,
          doc.mimeType,
          precisionMode,
          { applyContrast: enhanceContrast, baseDoc: doc }
        );

        batchResults.set(doc.id, extractedDoc);
        if (extractedDoc && isOfficialLetterResult(extractedDoc.result)) {
          initialOfficialCount += 1;
        } else {
          initialSkippedCount += 1;
        }
      }

      // Stage 2: Complete all retries, missing fields, and review checks BEFORE Excel export
      const needsCompletionOrReview = (item: DocumentItem | null | undefined): boolean => {
        if (!item || item.status === 'error' || !item.result) return true;
        if (!isOfficialLetterResult(item.result)) return false;
        const validDate = isValidCalendarDate(item.result.dateNormalized);
        const needsIssueCheck =
          !item.editedIssueNumber.trim() || item.result.issueNumberConfidence !== 'high';
        const needsDateCheck =
          !item.editedDate.trim() || item.result.dateConfidence !== 'high' || !validDate;
        const needsBodyCheck =
          scanRegion === 'full' &&
          !item.editedBodyContent.trim() &&
          !item.editedSubject.trim() &&
          !item.editedTitle.trim();
        return needsIssueCheck || needsDateCheck || needsBodyCheck;
      };

      const reviewCandidates = queuedDocs.filter((doc) =>
        needsCompletionOrReview(batchResults.get(doc.id))
      );

      for (let rIdx = 0; rIdx < reviewCandidates.length; rIdx++) {
        const doc = reviewCandidates[rIdx];
        const prevItem = batchResults.get(doc.id);
        setActiveId(doc.id);
        setFolderScanState({
          active: true,
          current: queuedDocs.length,
          total: queuedDocs.length,
          officialCount: Array.from(batchResults.values()).filter(
            (item) => item && isOfficialLetterResult(item.result)
          ).length,
          skippedCount: 0,
          folderName,
          phaseMessage: `جاري إكمال مراجعة وتدقيق جميع المعلومات قبل تنزيل Excel (${rIdx + 1} من ${reviewCandidates.length}: ${doc.fileName})...`,
        });

        await new Promise((r) => setTimeout(r, prevItem ? 400 : 1200));
        const reviewedDoc = await runExtraction(
          doc.id,
          doc.imageDataUrl,
          doc.mimeType,
          'ultra',
          { applyContrast: enhanceContrast, baseDoc: prevItem ?? doc }
        );
        if (reviewedDoc) {
          batchResults.set(doc.id, reviewedDoc);
        }
      }

      // Sync with latest state snapshot (respecting any user edits/verifications) and ensure zero pending tasks
      const officialDocs: DocumentItem[] = [];
      let skippedCount = 0;
      for (const doc of queuedDocs) {
        const liveDoc = documentsRef.current.find((d) => d.id === doc.id);
        const batchDoc = batchResults.get(doc.id);
        const finalDoc =
          liveDoc &&
          liveDoc.status !== 'processing' &&
          !liveDoc.isBodyLoading &&
          !liveDoc.isHeaderVerifying
            ? liveDoc
            : batchDoc;

        if (finalDoc && isOfficialLetterResult(finalDoc.result)) {
          officialDocs.push(finalDoc);
        } else {
          skippedCount += 1;
        }
      }

      if (officialDocs.length > 0) {
        const safeFolderName = folderName.replace(/[\\/:*?"<>|]/g, '_');
        const excelFileName = `كشف_${safeFolderName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        exportDocumentsToXlsx(officialDocs, excelFileName);
        setFolderScanState({
          active: false,
          current: queuedDocs.length,
          total: queuedDocs.length,
          officialCount: officialDocs.length,
          skippedCount,
          folderName,
          doneMessage: `اكتمل فحص ومراجعة ${queuedDocs.length} صورة: استخراج وتدقيق ${officialDocs.length} كتاب رسمي${
            skippedCount > 0 ? ` (واستبعاد ${skippedCount} صورة غير مطابقة)` : ''
          } وتنزيل ملف Excel بنجاح.`,
        });
      } else {
        setFolderScanState({
          active: false,
          current: queuedDocs.length,
          total: queuedDocs.length,
          officialCount: 0,
          skippedCount,
          folderName,
          errorMessage: `تم فحص ${queuedDocs.length} صورة ولم يتم العثور على كتب رسمية صالحة للتصدير.`,
        });
      }
    },
    [enhanceContrast, precisionMode, runExtraction, scanRegion]
  );

  const handleTriggerFolderScan = useCallback(
    async (forceChooseNew = false) => {
      if (folderScanState?.active) return;

      if (!canUseNativeDirectoryPicker()) {
        folderInputRef.current?.click();
        return;
      }

      try {
        let dirHandle: DirectoryHandleLike | null = null;

        if (!forceChooseNew) {
          const saved = await getSavedDirectoryHandle();
          if (saved) {
            const granted = await ensureDirectoryReadPermission(saved);
            if (granted) {
              dirHandle = saved;
            }
          }
        }

        if (!dirHandle) {
          const picker = (
            window as unknown as {
              showDirectoryPicker: (opts?: { mode?: 'read' }) => Promise<DirectoryHandleLike>;
            }
          ).showDirectoryPicker;
          dirHandle = await picker({ mode: 'read' });
          await saveDirectoryHandle(dirHandle);
          setSavedFolderName(dirHandle.name);
        }

        setFolderScanState({
          active: true,
          current: 0,
          total: 0,
          officialCount: 0,
          skippedCount: 0,
          folderName: dirHandle.name,
        });

        const files = await collectImagesFromDirectoryHandle(dirHandle);
        await processFolderImages(files, dirHandle.name);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setFolderScanState((prev) => ({
          active: false,
          current: prev?.current ?? 0,
          total: prev?.total ?? 0,
          officialCount: prev?.officialCount ?? 0,
          skippedCount: prev?.skippedCount ?? 0,
          folderName: prev?.folderName ?? savedFolderName ?? 'المجلد',
          errorMessage: err?.message || 'تعذر فتح المجلد المحدد.',
        }));
      }
    },
    [folderScanState?.active, processFolderImages, savedFolderName]
  );

  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;

      setActiveView('workspace');

      const queuedDocs: DocumentItem[] = [];
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
            editedTitle: '',
            editedRecipient: '',
            editedSubject: '',
            editedBodyContent: '',
            userVerified: false,
          };
          queuedDocs.push(newDoc);
        } catch {
          // Ignore unreadable individual file
        }
      }

      if (queuedDocs.length === 0) return;

      setDocuments((prev) => [...queuedDocs, ...prev]);
      setActiveId(queuedDocs[0].id);

      for (let i = 0; i < queuedDocs.length; i++) {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 220));
        }
        const doc = queuedDocs[i];
        await runExtraction(doc.id, doc.imageDataUrl, doc.mimeType, precisionMode, {
          applyContrast: enhanceContrast,
        });
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
      forceSingleUltraPass: true,
    });
  };

  const handleUpdateField = (
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

  const folderScanLabel = folderScanState?.active
    ? folderScanState.total > 0
      ? `جاري المسح (${folderScanState.current}/${folderScanState.total})`
      : 'جاري قراءة المجلد...'
    : undefined;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeView={activeView}
        onChangeView={setActiveView}
        onTriggerUpload={handleTriggerUpload}
        onTriggerFolderScan={() => void handleTriggerFolderScan(false)}
        onChangeSavedFolder={() => void handleTriggerFolderScan(true)}
        savedFolderName={savedFolderName}
        isFolderScanning={Boolean(folderScanState?.active)}
        folderScanLabel={folderScanLabel}
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

      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const selectedFiles = Array.from(e.target.files);
            const relPath =
              (selectedFiles[0] as File & { webkitRelativePath?: string })
                ?.webkitRelativePath || '';
            const inferredFolderName =
              relPath.split('/')[0] || 'المجلد_المختار';
            e.target.value = '';
            void processFolderImages(selectedFiles, inferredFolderName);
          }
        }}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 py-5 space-y-6">
        {folderScanState && (
          <div
            role="status"
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs sm:text-sm ${
              folderScanState.active
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
                : folderScanState.errorMessage
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-emerald-300 bg-emerald-50 text-emerald-950'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {folderScanState.active ? (
                <Loader2
                  className="h-4 w-4 animate-spin text-emerald-700 shrink-0"
                  aria-hidden="true"
                />
              ) : folderScanState.errorMessage ? (
                <AlertTriangle
                  className="h-4 w-4 text-amber-700 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <CheckCircle2
                  className="h-4 w-4 text-emerald-700 shrink-0"
                  aria-hidden="true"
                />
              )}

              <div className="min-w-0">
                {folderScanState.active ? (
                  <p className="font-medium">
                    <FolderSearch
                      className="inline h-3.5 w-3.5 ml-1.5 text-emerald-700"
                      aria-hidden="true"
                    />
                    {folderScanState.phaseMessage
                      ? folderScanState.phaseMessage
                      : folderScanState.total > 0
                      ? `جاري مسح «${folderScanState.folderName}»: صورة ${folderScanState.current} من ${folderScanState.total} (تم العثور على ${folderScanState.officialCount} كتاب رسمي)... وسيتم تنزيل Excel بعد إكمال جميع المراجعات.`
                      : `جاري البحث عن صور الكتب الرسمية داخل «${folderScanState.folderName}»...`}
                  </p>
                ) : (
                  <p className="font-medium">
                    {folderScanState.doneMessage || folderScanState.errorMessage}
                  </p>
                )}
              </div>
            </div>

            {!folderScanState.active && (
              <button
                type="button"
                aria-label="إغلاق الإشعار"
                onClick={() => setFolderScanState(null)}
                className="rounded-md p-1 text-slate-500 hover:bg-white/70 hover:text-slate-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

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
                onTriggerFolderScan={() => void handleTriggerFolderScan(false)}
                onChangeSavedFolder={() => void handleTriggerFolderScan(true)}
                savedFolderName={savedFolderName}
                isFolderScanning={Boolean(folderScanState?.active)}
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
          </div>
        </div>
      </footer>

      <GeminiKeyButton
        apiKey={apiKey}
        onSaveApiKey={(nextKey) => {
          setStoredGeminiApiKey(nextKey);
          setApiKey(nextKey);
        }}
      />
    </div>
  );
}
