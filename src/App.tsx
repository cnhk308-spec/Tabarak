import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderSearch, Loader2, X } from 'lucide-react';
import { AppView, TopBar } from './components/TopBar';
import { DocumentQueueSidebar } from './components/DocumentQueueSidebar';
import { DocumentCanvas } from './components/DocumentCanvas';
import { ExtractionPanel } from './components/ExtractionPanel';
import { LedgerTableView } from './components/LedgerTableView';
import { AccuracyGuideView } from './components/AccuracyGuideView';
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
  TOP_HEADER_BOX,
  TOP_RIGHT_BOX,
  compressImageDataUrl,
  convertToEasternDigits,
  convertToWesternDigits,
  cropRegionDataUrl,
  enhanceHandwritingCropDataUrl,
  enhanceInkContrastDataUrl,
  expandBoundingBox,
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

function clampValidBox(box: BoundingBox | null | undefined): BoundingBox | null {
  if (!box) return null;
  const ymin = Math.max(0, Math.min(999, Math.round(box.ymin)));
  const xmin = Math.max(0, Math.min(999, Math.round(box.xmin)));
  const ymax = Math.max(1, Math.min(1000, Math.round(box.ymax)));
  const xmax = Math.max(1, Math.min(1000, Math.round(box.xmax)));
  if (xmax - xmin < 8 || ymax - ymin < 6) return null;
  return { ymin, xmin, ymax, xmax };
}

function mapCroppedBoxToFullImage(
  innerBox: BoundingBox | null | undefined,
  cropBox: BoundingBox
): BoundingBox | null {
  const valid = clampValidBox(innerBox);
  if (!valid) return null;
  const cropW = cropBox.xmax - cropBox.xmin;
  const cropH = cropBox.ymax - cropBox.ymin;
  return clampValidBox({
    xmin: cropBox.xmin + (valid.xmin / 1000) * cropW,
    xmax: cropBox.xmin + (valid.xmax / 1000) * cropW,
    ymin: cropBox.ymin + (valid.ymin / 1000) * cropH,
    ymax: cropBox.ymin + (valid.ymax / 1000) * cropH,
  });
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
    const prevNormLen = convertToWesternDigits(prevRaw).replace(/\s+/g, '').length;
    const zoomNormLen = convertToWesternDigits(zoomedIssueRaw).replace(/\s+/g, '').length;
    const zoomIsShorterPrefixOfPrev =
      prevNormLen > zoomNormLen &&
      convertToWesternDigits(prevRaw)
        .replace(/\s+/g, '')
        .includes(convertToWesternDigits(zoomedIssueRaw).replace(/\s+/g, ''));

    if (zoomedIssueRaw !== prevRaw) {
      if (
        (zoomIssue.issueNumberConfidence === 'low' &&
          prev.issueNumberConfidence === 'high') ||
        (zoomIsShorterPrefixOfPrev && prev.issueNumberConfidence !== 'low')
      ) {
        next.alternativeIssueNumber = zoomedIssueRaw;
      } else {
        next = {
          ...next,
          issueNumberRaw: zoomedIssueRaw,
          issueNumberNormalized: zoomIssue.issueNumberNormalized,
          issueNumberConfidence: zoomIssue.issueNumberConfidence,
          alternativeIssueNumber: prevRaw || prev.alternativeIssueNumber || '',
        };
      }
    } else if (zoomIssue.issueNumberConfidence === 'high') {
      next.issueNumberConfidence = 'high';
    }
  }

  const zoomedDateRaw = (zoomDate?.dateRaw || '').trim();
  const zoomedDateNorm = (zoomDate?.dateNormalized || '').trim();
  if (zoomDate && (zoomedDateRaw || zoomedDateNorm)) {
    const prevRaw = prev.dateRaw || '';
    const prevNorm = prev.dateNormalized || '';
    const isDifferent =
      (zoomedDateNorm && zoomedDateNorm !== prevNorm) ||
      (zoomedDateRaw && zoomedDateRaw !== prevRaw);

    if (isDifferent) {
      if (
        !options?.forceDateOverride &&
        zoomDate.dateConfidence === 'low' &&
        prev.dateConfidence === 'high'
      ) {
        next.alternativeDate = zoomedDateNorm || zoomedDateRaw;
      } else {
        next = {
          ...next,
          dateRaw: zoomedDateRaw || prevRaw,
          dateNormalized: zoomedDateNorm || prevNorm,
          dateConfidence:
            zoomDate.dateConfidence === 'low' && options?.forceDateOverride
              ? 'medium'
              : zoomDate.dateConfidence,
          calendarType:
            zoomDate.calendarType !== 'unknown'
              ? zoomDate.calendarType
              : prev.calendarType,
          alternativeDate: prevNorm || prevRaw || prev.alternativeDate || '',
        };
      }
    } else if (zoomDate.dateConfidence === 'high') {
      next.dateConfidence = 'high';
    }
  }

  return next;
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('workspace');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>('standard');
  const [scanRegion, setScanRegion] = useState<ScanRegion>('full');
  const [digitPreference, setDigitPreference] = useState<DigitPreference>('western');
  const [hintText, setHintText] = useState<string>('');
  const [enhanceContrast, setEnhanceContrast] = useState<boolean>(false);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [isGeneratingSample, setIsGeneratingSample] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>(() => getStoredGeminiApiKey());
  const [savedFolderName, setSavedFolderName] = useState<string | null>(null);
  const [folderScanState, setFolderScanState] = useState<{
    active: boolean;
    current: number;
    total: number;
    officialCount: number;
    skippedCount: number;
    folderName: string;
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
                precisionMode: mode,
                errorMessage: undefined,
              }
            : d
        )
      );

      const startedAt = performance.now();
      try {
        const effectiveRegion = options?.regionOverride ?? scanRegion;
        let payloadDataUrl = imageDataUrl;
        let resolvedMimeType = mimeType;
        let headerImageBase64: string | undefined;
        let headerMimeType: string | undefined;
        let isCropped = Boolean(options?.isCroppedRegion);
        let originBox = options?.cropOriginBox;
        let headerBoxOrigin: BoundingBox | null = null;

        if (!isCropped && effectiveRegion === 'top-right') {
          payloadDataUrl = await cropRegionDataUrl(imageDataUrl, TOP_RIGHT_BOX, 0, {
            minDim: 1100,
            maxDim: 1750,
            format: 'image/jpeg',
            quality: 0.98,
            contrastFilter: false,
          });
          resolvedMimeType = 'image/jpeg';
          isCropped = true;
          originBox = TOP_RIGHT_BOX;
        } else if (!isCropped && effectiveRegion === 'full') {
          const [compressedFull, headerJpeg] = await Promise.all([
            compressImageDataUrl(imageDataUrl, 1100, 0.78),
            cropRegionDataUrl(imageDataUrl, TOP_HEADER_BOX, 0, {
              minDim: 1150,
              maxDim: 1800,
              format: 'image/jpeg',
              quality: 0.98,
              contrastFilter: false,
            }),
          ]);
          payloadDataUrl = compressedFull;
          resolvedMimeType = 'image/jpeg';
          headerImageBase64 = headerJpeg;
          headerMimeType = 'image/jpeg';
          headerBoxOrigin = TOP_HEADER_BOX;
        }

        if (options?.applyContrast) {
          payloadDataUrl = await enhanceInkContrastDataUrl(payloadDataUrl);
          if (headerImageBase64) {
            headerImageBase64 = await enhanceInkContrastDataUrl(headerImageBase64);
            headerMimeType = 'image/jpeg';
          }
          resolvedMimeType = 'image/jpeg';
        }

        const mapResultBoxes = (res: ExtractionResult): ExtractionResult => {
          const boxOrigin =
            isCropped && originBox
              ? originBox
              : headerBoxOrigin && res.boxReferenceImage !== 'full_image'
              ? headerBoxOrigin
              : null;

          if (boxOrigin) {
            return {
              ...res,
              issueNumberBox: mapCroppedBoxToFullImage(res.issueNumberBox, boxOrigin),
              dateBox: mapCroppedBoxToFullImage(res.dateBox, boxOrigin),
            };
          }
          return {
            ...res,
            issueNumberBox: clampValidBox(res.issueNumberBox),
            dateBox: clampValidBox(res.dateBox),
          };
        };

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

        const cropZoomRegion = async (box: BoundingBox) => {
          const expanded = expandBoundingBox(box, 185, 230, 72, 72);
          const rawCrop = await cropRegionDataUrl(imageDataUrl, expanded, 0, {
            minDim: 1200,
            maxDim: 1850,
            format: 'image/png',
            contrastFilter: false,
          });
          return options?.applyContrast ? enhanceHandwritingCropDataUrl(rawCrop) : rawCrop;
        };

        const runZoomVerify = async (
          sourceHeader: ExtractionResult,
          cfg: {
            verifyIssue: boolean;
            verifyDate: boolean;
            extraDateHint?: string;
            forceDateOverride?: boolean;
          }
        ) => {
          const ib = cfg.verifyIssue ? sourceHeader.issueNumberBox : null;
          const db = cfg.verifyDate ? sourceHeader.dateBox : null;
          if (!ib && !db) return;

          let zoomIssueRes: ExtractionResult | null = null;
          let zoomDateRes: ExtractionResult | null = null;
          const baseHint = hintText ? `${hintText} — ` : '';

          if (ib && db) {
            const unionBox: BoundingBox = {
              xmin: Math.min(ib.xmin, db.xmin),
              ymin: Math.min(ib.ymin, db.ymin),
              xmax: Math.max(ib.xmax, db.xmax),
              ymax: Math.max(ib.ymax, db.ymax),
            };
            const unionCompact =
              unionBox.xmax - unionBox.xmin <= 820 &&
              unionBox.ymax - unionBox.ymin <= 460;

            if (unionCompact) {
              const stripImg = await cropZoomRegion(unionBox);
              const combined = await extractHeaderOnlyWithGemini(
                {
                  imageBase64: stripImg,
                  mimeType: 'image/png',
                  precisionMode: 'ultra',
                  hintText: `${baseHint}لقطة مكبّرة عالية الدقة للعدد والتاريخ بخط اليد. اقرأ التاريخ مكانياً (يسار/وسط/يمين) بدون عكس اليوم والشهر، ولا تحول ٢ ذي الساق العمودية إلى صفر ٠.${cfg.extraDateHint ? ` ${cfg.extraDateHint}` : ''}`,
                },
                apiKey
              );
              zoomIssueRes = combined;
              zoomDateRes = combined;
            } else {
              const [issueCrop, dateCrop] = await Promise.all([
                cropZoomRegion(ib),
                cropZoomRegion(db),
              ]);
              const [issueOnly, dateOnly] = await Promise.all([
                extractHeaderOnlyWithGemini(
                  {
                    imageBase64: issueCrop,
                    mimeType: 'image/png',
                    precisionMode: 'ultra',
                    hintText: `${baseHint}لقطة مكبّرة لحقل العدد بخط اليد شاملاً الرقم الملاصق لـ (:).`,
                  },
                  apiKey
                ),
                extractHeaderOnlyWithGemini(
                  {
                    imageBase64: dateCrop,
                    mimeType: 'image/png',
                    precisionMode: 'ultra',
                    hintText: `${baseHint}لقطة مكبّرة لحقل التاريخ بخط اليد. اقرأ الأجزاء الثلاثة مكانياً (يسار/وسط/يمين) ولا تعكس اليوم والشهر.${cfg.extraDateHint ? ` ${cfg.extraDateHint}` : ''}`,
                  },
                  apiKey
                ),
              ]);
              zoomIssueRes = issueOnly;
              zoomDateRes = dateOnly;
            }
          } else if (ib) {
            const issueCrop = await cropZoomRegion(ib);
            zoomIssueRes = await extractHeaderOnlyWithGemini(
              {
                imageBase64: issueCrop,
                mimeType: 'image/png',
                precisionMode: 'ultra',
                hintText: `${baseHint}لقطة مكبّرة لحقل العدد بخط اليد شاملاً الرقم الملاصق لـ (:).`,
              },
              apiKey
            );
          } else if (db) {
            const dateCrop = await cropZoomRegion(db);
            zoomDateRes = await extractHeaderOnlyWithGemini(
              {
                imageBase64: dateCrop,
                mimeType: 'image/png',
                precisionMode: 'ultra',
                hintText: `${baseHint}لقطة مكبّرة لحقل التاريخ بخط اليد. اقرأ الأجزاء الثلاثة مكانياً (يسار/وسط/يمين) ولا تعكس اليوم والشهر.${cfg.extraDateHint ? ` ${cfg.extraDateHint}` : ''}`,
              },
              apiKey
            );
          }

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

              setDocuments((prev) =>
                prev.map((d) => {
                  if (d.id !== docId) return d;
                  return {
                    ...d,
                    status: 'extracted',
                    isBodyLoading: expectsBody,
                    extractionDurationMs: headerDurationMs,
                    result: headerMapped,
                    editedIssueNumber: nextIssue,
                    editedDate: nextDate,
                    userVerified: false,
                  };
                })
              );

              const hasValidDateFormat = /^\d{4}\/\d{2}\/\d{2}$/.test(
                headerMapped.dateNormalized || ''
              );
              const needsZoomVerify =
                !isCropped &&
                Boolean(headerMapped.issueNumberBox || headerMapped.dateBox) &&
                (mode === 'ultra' ||
                  headerMapped.issueNumberConfidence !== 'high' ||
                  headerMapped.dateConfidence !== 'high' ||
                  !hasValidDateFormat);

              if (needsZoomVerify) {
                ultraZoomPromise = runZoomVerify(headerMapped, {
                  verifyIssue:
                    mode === 'ultra' || headerMapped.issueNumberConfidence !== 'high',
                  verifyDate:
                    mode === 'ultra' ||
                    headerMapped.dateConfidence !== 'high' ||
                    !hasValidDateFormat,
                }).catch(() => {
                  // Keep initial header reading if zoomed verification fails
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
        const mappedFull = mapResultBoxes(fullResult);
        if (ultraZoomPromise) {
          await ultraZoomPromise;
        }
        if (isStale()) return null;

        // Post-body cross-check: catch misread handwritten years (e.g. 2024/2022 vs printed 2026)
        const currentHeaderSnap = tracker.headerResult ?? mappedFull;
        const headerYear = extractYearNumber(
          currentHeaderSnap.dateNormalized || currentHeaderSnap.dateRaw
        );
        const sigYear = extractYearNumber(mappedFull.signatureDateHint);
        const bodyYear = extractYearNumber(mappedFull.latestBodyYear);

        let expectedRefYear: number | null = null;
        if (
          sigYear &&
          headerYear &&
          isSameCalendarEra(sigYear, headerYear) &&
          sigYear !== headerYear
        ) {
          expectedRefYear = sigYear;
        } else if (
          bodyYear &&
          headerYear &&
          isSameCalendarEra(bodyYear, headerYear) &&
          headerYear < bodyYear &&
          bodyYear - headerYear <= 15
        ) {
          expectedRefYear = bodyYear;
        }

        if (expectedRefYear && !isCropped && currentHeaderSnap.dateBox) {
          try {
            await runZoomVerify(currentHeaderSnap, {
              verifyIssue: false,
              verifyDate: true,
              extraDateHint: `السنة الظاهرة أسفل التوقيع أو في متن الكتاب هي (${expectedRefYear})، بينما القراءة الأولية أعطت (${headerYear}). دقق جيداً في آخر رقمين من السنة المكتوبة بخط اليد ولا تخلط بين ٦ و ٤ أو ٢، وسجل اليوم والشهر والسنة بدقة مكانية.`,
              forceDateOverride: true,
            });
          } catch {
            // Keep existing reading if post-body year verification fails
          }
          if (isStale()) return null;
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

      const officialDocs: DocumentItem[] = [];
      let skippedCount = 0;

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
          officialCount: officialDocs.length,
          skippedCount,
          folderName,
        });

        const extractedDoc = await runExtraction(
          doc.id,
          doc.imageDataUrl,
          doc.mimeType,
          precisionMode,
          { applyContrast: enhanceContrast, baseDoc: doc }
        );

        if (extractedDoc && isOfficialLetterResult(extractedDoc.result)) {
          officialDocs.push(extractedDoc);
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
          doneMessage: `تم فحص ${queuedDocs.length} صورة: استخراج ${officialDocs.length} كتاب رسمي${
            skippedCount > 0 ? ` (واستبعاد ${skippedCount} صورة غير مطابقة)` : ''
          } وتنزيل ملف Excel تلقائياً.`,
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
    [enhanceContrast, precisionMode, runExtraction]
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
                    {folderScanState.total > 0
                      ? `جاري مسح «${folderScanState.folderName}»: صورة ${folderScanState.current} من ${folderScanState.total} (تم العثور على ${folderScanState.officialCount} كتاب رسمي)... وسيتم تنزيل Excel تلقائياً فور الانتهاء.`
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
