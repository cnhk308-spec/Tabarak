export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type PrecisionMode = 'standard' | 'ultra';

export type ScanRegion = 'top-right' | 'full';

export type DigitPreference = 'western' | 'eastern' | 'raw';

export type CalendarType = 'gregorian' | 'hijri' | 'unknown';

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ExtractionResult {
  issueNumberRaw: string;
  issueNumberNormalized: string;
  issueNumberConfidence: ConfidenceLevel;
  alternativeIssueNumber?: string;
  issueNumberBox?: BoundingBox | null;

  dateRaw: string;
  dateNormalized: string;
  dateConfidence: ConfidenceLevel;
  alternativeDate?: string;
  calendarType: CalendarType;
  dateBox?: BoundingBox | null;

  issuingEntity?: string;
  title?: string;
  recipient?: string;
  subject?: string;
  bodyContent?: string;
  handwritingNotes?: string;
  isHandwrittenDetected?: boolean;
  boxReferenceImage?: 'header_crop' | 'full_image';
}

export type DocumentStatus = 'pending' | 'processing' | 'extracted' | 'verified' | 'error';

export interface DocumentItem {
  id: string;
  fileName: string;
  fileSize: number;
  imageDataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  uploadedAt: number;
  status: DocumentStatus;
  precisionMode: PrecisionMode;
  extractionDurationMs?: number;
  errorMessage?: string;
  result?: ExtractionResult;
  editedIssueNumber: string;
  editedDate: string;
  editedIssuingEntity: string;
  editedTitle: string;
  editedRecipient: string;
  editedSubject: string;
  editedBodyContent: string;
  userVerified: boolean;
}
