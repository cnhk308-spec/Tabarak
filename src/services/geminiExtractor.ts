import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';
import { ExtractionResult, PrecisionMode } from '../types';

export const GEMINI_API_KEY_STORAGE_KEY = 'mirsaad_gemini_api_key';

export function getStoredGeminiApiKey(): string {
  try {
    return (localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setStoredGeminiApiKey(apiKey: string): void {
  try {
    const trimmed = apiKey.trim();
    if (trimmed) {
      localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export interface ServerExtractParams {
  imageBase64: string;
  mimeType: string;
  headerImageBase64?: string;
  headerMimeType?: string;
  precisionMode: PrecisionMode;
  isCroppedRegion: boolean;
  hintText?: string;
}

const boxSchema = {
  type: Type.OBJECT,
  properties: {
    ymin: { type: Type.INTEGER },
    xmin: { type: Type.INTEGER },
    ymax: { type: Type.INTEGER },
    xmax: { type: Type.INTEGER },
  },
  required: ['ymin', 'xmin', 'ymax', 'xmax'],
};

const fastExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    digitsLtr: {
      type: Type.ARRAY,
      description:
        'كل رقم أو حرف أو شرطة في حقل (العدد :) مرتباً من اليسار إلى اليمين حتى النقطتين (:) بدون إسقاط الرقم الأخير الملاصق لـ (:) أو النقطة (٠)، مثال: ["٥","٠","٨","٦"].',
      items: { type: Type.STRING },
    },
    issueNumber: {
      type: Type.STRING,
      description: 'العدد الكامل مطابقاً تماماً لتسلسل digitsLtr.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة إن وجد غموض، وإلا سلسلة فارغة.',
    },
    date: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط في حقل (التاريخ :).',
    },
    title: {
      type: Type.STRING,
      description: 'العنوان المركزي مثل (أمر جامعي) عند غياب إلى/ و م/، وإلا سلسلة فارغة.',
    },
    recipient: {
      type: Type.STRING,
      description: 'النص بعد (إلى /) إن وجد، وإلا سلسلة فارغة.',
    },
    subject: {
      type: Type.STRING,
      description: 'النص بعد (م /) إن وجد، وإلا سلسلة فارغة.',
    },
    bodyContent: {
      type: Type.STRING,
      description: 'مضمون الكتاب كاملاً، وإلا سلسلة فارغة.',
    },
    confidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    calendar: {
      type: Type.STRING,
      description: 'gregorian أو hijri أو unknown',
    },
  },
  required: [
    'digitsLtr',
    'issueNumber',
    'date',
    'title',
    'recipient',
    'subject',
    'bodyContent',
    'confidence',
    'calendar',
  ],
};

const fastHeaderOnlySchema = {
  type: Type.OBJECT,
  properties: {
    digitsLtr: {
      type: Type.ARRAY,
      description:
        'كل رقم أو حرف أو شرطة في حقل (العدد :) من اليسار إلى اليمين حتى النقطتين (:) بدون إسقاط الرقم الأخير الملاصق لـ (:) أو النقطة (٠).',
      items: { type: Type.STRING },
    },
    issueNumber: {
      type: Type.STRING,
      description: 'العدد الكامل مطابقاً تماماً لتسلسل digitsLtr.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة إن وجد غموض، وإلا سلسلة فارغة.',
    },
    date: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط في حقل (التاريخ :).',
    },
    confidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    calendar: {
      type: Type.STRING,
      description: 'gregorian أو hijri أو unknown',
    },
  },
  required: ['digitsLtr', 'issueNumber', 'date', 'confidence', 'calendar'],
};

const headerHandwritingSchema = {
  type: Type.OBJECT,
  properties: {
    headerFound: {
      type: Type.BOOLEAN,
      description: 'true إذا ظهر حقل العدد أو التاريخ في هذه الصورة، وإلا false.',
    },
    colonEdgeInspection: {
      type: Type.STRING,
      description:
        'افحص الفراغ الملاصق تماماً ليسار النقطتين (:) في (العدد :): هل يوجد رقم أخير (مثل ٦ أو ٢ أو ٥ أو ٨) أو نقطة (٠) وسط الأرقام؟',
    },
    issueCharactersLeftToRight: {
      type: Type.ARRAY,
      description:
        'سرد مرتب من اليسار إلى اليمين لكل رقم أو حرف أو شرطة مائلة في قيمة العدد.',
      items: { type: Type.STRING },
    },
    issueNumberRaw: {
      type: Type.STRING,
      description:
        'العدد الكامل مطابقاً تماماً لتسلسل issueCharactersLeftToRight بدون حذف أي خانة.',
    },
    issueNumberNormalized: {
      type: Type.STRING,
      description: 'العدد بأرقام إنجليزية (0123456789) مع الحفاظ على الحروف والشرطات المائلة.',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة محتملة، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'إحداثيات مربع الإحاطة لقيمة العدد المكتوبة (0 إلى 1000).',
    },
    dateRaw: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط بخط اليد.',
    },
    dateNormalized: {
      type: Type.STRING,
      description: 'التاريخ بصيغة YYYY/MM/DD بأرقام إنجليزية.',
    },
    dateConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeDate: {
      type: Type.STRING,
      description: 'قراءة بديلة للتاريخ، وإلا سلسلة فارغة.',
    },
    calendarType: {
      type: Type.STRING,
      description: 'gregorian أو hijri أو unknown',
    },
    dateBox: {
      ...boxSchema,
      description: 'إحداثيات مربع الإحاطة لقيمة التاريخ المكتوبة (0 إلى 1000).',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد أو التاريخ مكتوبان بخط اليد.',
    },
  },
  required: [
    'headerFound',
    'colonEdgeInspection',
    'issueCharactersLeftToRight',
    'issueNumberRaw',
    'issueNumberNormalized',
    'issueNumberConfidence',
    'issueNumberBox',
    'dateRaw',
    'dateNormalized',
    'dateConfidence',
    'dateBox',
    'calendarType',
    'isHandwrittenDetected',
  ],
};

const documentBodySchema = {
  type: Type.OBJECT,
  properties: {
    issuingEntity: {
      type: Type.STRING,
      description: 'الجهة المصدرة للكتاب إن ظهرت، وإلا سلسلة فارغة.',
    },
    title: {
      type: Type.STRING,
      description: 'العنوان المركزي عند غياب إلى/ و م/، وإلا سلسلة فارغة.',
    },
    recipient: {
      type: Type.STRING,
      description: 'النص بعد (إلى /) إن وجد، وإلا سلسلة فارغة.',
    },
    subject: {
      type: Type.STRING,
      description: 'النص بعد (م /) إن وجد، وإلا سلسلة فارغة.',
    },
    bodyContent: {
      type: Type.STRING,
      description: 'مضمون الكتاب كاملاً بدقة، وإلا سلسلة فارغة.',
    },
  },
  required: ['issuingEntity', 'title', 'recipient', 'subject', 'bodyContent'],
};

const HANDWRITING_RULES = `قواعد قراءة الأرقام المكتوبة بخط اليد في الكتب الرسمية:
- اقرأ قيمة (العدد :) من اليسار إلى اليمين حتى تلامس النقطتين (:) — لا تسقط الرقم الأخير الملاصق لـ (:) أبداً (مثل قراءة ٥٠٨٦ كـ ٥٠٨).
- النقطة الصغيرة بين رقمين هي (٠) وليست فراغاً.
- (٦) يتجه رأسه لليسار ثم ينزل (┐)، و(٢) يتجه رأسه لليمين ثم ينزل (┌)، و(٧) مفتوح للأعلى (∨)، و(٨) مفتوح للأسفل (∧)، و(٥) حلقة مغلقة.
- اكتب الخانات من اليسار لليمين في digitsLtr أولاً ثم انقلها كاملة بدون نقص.`;

const FAST_SYSTEM_INSTRUCTION = `أنت خبير سريع ودقيق لقراءة الكتب الرسمية العربية وخط اليد.
- إذا وُجدت صورتان: الأولى ترويسة مكبّرة لقراءة (العدد) و(التاريخ)، والثانية الصفحة الكاملة لاستخراج العنوان أو إلى/م ومضمون الكتاب.
${HANDWRITING_RULES}`;

const HEADER_OCR_INSTRUCTION = `أنت مدقق بصري متخصص حصرياً في قراءة (العدد) و(التاريخ) المكتوبين بخط اليد من صور الكتب الرسمية العربية.
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بدقة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

function resolveIssueNumber(rawIssue: string, tokens?: unknown): string {
  const cleanRaw = (rawIssue || '').trim();
  if (!Array.isArray(tokens) || tokens.length === 0) return cleanRaw;
  const cleanTokens = tokens
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0 && t.length <= 2);
  if (cleanTokens.length === 0) return cleanRaw;
  const joined = cleanTokens.join('');
  if (!cleanRaw) return joined;
  if (toWesternDigits(joined).length > toWesternDigits(cleanRaw).length) {
    return joined;
  }
  return cleanRaw;
}

function normalizeDateString(rawDate: string): string {
  const western = toWesternDigits(rawDate).replace(/\s+/g, '');
  const parts = western.split(/[\/\-.]+/).filter(Boolean);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (c.length === 4 && Number(a) <= 31) {
      return `${c}/${b.padStart(2, '0')}/${a.padStart(2, '0')}`;
    }
    if (a.length === 4) {
      return `${a}/${b.padStart(2, '0')}/${c.padStart(2, '0')}`;
    }
    if (c.length === 2 && Number(a) <= 31) {
      const fullYear = Number(c) >= 40 ? `14${c}` : `20${c}`;
      return `${fullYear}/${b.padStart(2, '0')}/${a.padStart(2, '0')}`;
    }
  }
  return western;
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const errObj = err as { status?: number; code?: number };
      const status = errObj?.status || errObj?.code;
      const isTransient = status === 429 || status === 503 || status === 500;
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 500 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function runHeaderHandwritingOcrBrowser(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  hintLine: string
) {
  const parts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `اقرأ حقل (العدد) وحقل (التاريخ) المكتوبين بخط اليد من اليسار لليمين دون إسقاط أي رقم ملاصق للنقطتين (:).${hintLine}`,
    },
  ];

  const callModel = (
    model: string,
    thinkingLevel: ThinkingLevel,
    useHighMediaRes: boolean
  ) =>
    ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        systemInstruction: HEADER_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: headerHandwritingSchema,
        thinkingConfig: { thinkingLevel },
        ...(useHighMediaRes
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }
          : {}),
      },
    });

  let response;
  try {
    response = await callModel('gemini-4-hydrogen', ThinkingLevel.HIGH, true);
  } catch (err: unknown) {
    const errObj = err as { status?: number; code?: number; message?: string };
    const status = errObj?.status || errObj?.code;
    if (status === 400) {
      response = await callModel('gemini-4-hydrogen', ThinkingLevel.HIGH, false);
    } else if (status === 429 || status === 503) {
      response = await callWithRetry(
        () => callModel('gemini-3.1-flash-lite', ThinkingLevel.HIGH, true),
        1
      );
    } else if (status === 401 || status === 403) {
      throw new Error('مفتاح Gemini API غير صالح أو مرفوض. يرجى التحقق من المفتاح المدخل.');
    } else {
      throw new Error(
        errObj?.message
          ? `تعذر إكمال التحليل: ${errObj.message}`
          : 'حدث خطأ أثناء تحليل صورة الكتاب.'
      );
    }
  }

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('لم يُرجع نموذج التحليل بيانات نصية صالحة.');
  }

  return JSON.parse(rawText);
}

async function runBodyOcrBrowser(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  hintLine: string
) {
  const parts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `استخرج الجهة المصدرة والعنوان أو إلى/م ومضمون الكتاب كاملاً.${hintLine}`,
    },
  ];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        systemInstruction: BODY_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: documentBodySchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const rawText = (response.text ?? '').trim();
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

export async function extractDocumentWithGemini(
  params: ServerExtractParams,
  customApiKey?: string
): Promise<ExtractionResult> {
  const trimmedKey = (customApiKey || '').trim();
  if (!trimmedKey) {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : null;

    if (!res.ok || !data || data.error) {
      throw new Error(
        data?.error ||
          'تعذر الاتصال بخدمة التحليل على الخادم. اضغط على أيقونة المفتاح في أسفل يسار الشاشة لإدخال مفتاح Gemini API والعمل مباشرة.'
      );
    }

    return data.result as ExtractionResult;
  }

  const ai = new GoogleGenAI({ apiKey: trimmedKey });
  const cleanFullBase64 = params.imageBase64.includes(',')
    ? params.imageBase64.split(',')[1]
    : params.imageBase64;
  const fullMimeType = params.mimeType || 'image/jpeg';

  const cleanHeaderBase64 = params.headerImageBase64
    ? params.headerImageBase64.includes(',')
      ? params.headerImageBase64.split(',')[1]
      : params.headerImageBase64
    : null;
  const headerMimeType = params.headerMimeType || 'image/jpeg';

  const isUltra = params.precisionMode === 'ultra';
  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';

  if (!isUltra) {
    const parts: Array<
      { inlineData: { mimeType: string; data: string } } | { text: string }
    > = [];

    if (cleanHeaderBase64) {
      parts.push({
        inlineData: { mimeType: headerMimeType, data: cleanHeaderBase64 },
      });
    }
    parts.push({
      inlineData: { mimeType: fullMimeType, data: cleanFullBase64 },
    });
    parts.push({
      text: cleanHeaderBase64
        ? `اقرأ العدد والتاريخ من الترويسة الأولى من اليسار لليمين بدون إسقاط الرقم الملاصق لـ (:)، واستخرج بيانات ومضمون الكتاب من الصورة الثانية.${hintLine}`
        : `اقرأ العدد والتاريخ من اليسار لليمين بدون إسقاط أي رقم ملاصق لـ (:).${hintLine}`,
    });

    const schema = cleanHeaderBase64 ? fastExtractionSchema : fastHeaderOnlySchema;

    const callFast = (model: string, thinkingLevel: ThinkingLevel) =>
      ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          systemInstruction: FAST_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: schema,
          thinkingConfig: { thinkingLevel },
        },
      });

    let response;
    try {
      response = await callFast('gemini-4-hydrogen', ThinkingLevel.LOW);
    } catch (err: unknown) {
      const errObj = err as { status?: number; code?: number; message?: string };
      const status = errObj?.status || errObj?.code;
      if (status === 429 || status === 503) {
        response = await callWithRetry(
          () => callFast('gemini-3.1-flash-lite', ThinkingLevel.LOW),
          1
        );
      } else if (status === 401 || status === 403) {
        throw new Error('مفتاح Gemini API غير صالح أو مرفوض. يرجى التحقق من المفتاح المدخل.');
      } else {
        throw new Error(
          errObj?.message
            ? `تعذر إكمال التحليل: ${errObj.message}`
            : 'حدث خطأ أثناء تحليل صورة الكتاب.'
        );
      }
    }

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      throw new Error('لم يُرجع نموذج التحليل بيانات نصية صالحة.');
    }

    const rawParsed = JSON.parse(rawText);
    const resolvedIssue = resolveIssueNumber(
      rawParsed.issueNumber || '',
      rawParsed.digitsLtr
    );

    return {
      issueNumberRaw: resolvedIssue,
      issueNumberNormalized: toWesternDigits(resolvedIssue),
      issueNumberConfidence: rawParsed.confidence || 'medium',
      alternativeIssueNumber: rawParsed.alternativeIssueNumber || '',
      dateRaw: rawParsed.date || '',
      dateNormalized: normalizeDateString(rawParsed.date || ''),
      dateConfidence: rawParsed.confidence || 'medium',
      calendarType: rawParsed.calendar || 'unknown',
      title: rawParsed.title || '',
      recipient: rawParsed.recipient || '',
      subject: rawParsed.subject || '',
      bodyContent: rawParsed.bodyContent || '',
    };
  }

  if (cleanHeaderBase64) {
    const [initialHeader, bodyResult] = await Promise.all([
      runHeaderHandwritingOcrBrowser(ai, cleanHeaderBase64, headerMimeType, hintLine),
      runBodyOcrBrowser(ai, cleanFullBase64, fullMimeType, hintLine),
    ]);

    let headerResult = initialHeader;
    let boxReferenceImage: 'header_crop' | 'full_image' = 'header_crop';

    if (
      !headerResult.headerFound ||
      (!headerResult.issueNumberRaw?.trim() && !headerResult.dateRaw?.trim())
    ) {
      headerResult = await runHeaderHandwritingOcrBrowser(
        ai,
        cleanFullBase64,
        fullMimeType,
        hintLine
      );
      boxReferenceImage = 'full_image';
    }

    const issueRaw = resolveIssueNumber(
      headerResult.issueNumberRaw || '',
      headerResult.issueCharactersLeftToRight
    );
    const dateRaw = headerResult.dateRaw || '';

    return {
      issueNumberRaw: issueRaw,
      issueNumberNormalized: toWesternDigits(issueRaw),
      issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
      alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
      issueNumberBox: headerResult.issueNumberBox || null,
      dateRaw,
      dateNormalized: normalizeDateString(headerResult.dateNormalized || dateRaw),
      dateConfidence: headerResult.dateConfidence || 'medium',
      alternativeDate: headerResult.alternativeDate || '',
      dateBox: headerResult.dateBox || null,
      boxReferenceImage,
      calendarType: headerResult.calendarType || 'unknown',
      issuingEntity: bodyResult.issuingEntity || '',
      title: bodyResult.title || '',
      recipient: bodyResult.recipient || '',
      subject: bodyResult.subject || '',
      bodyContent: bodyResult.bodyContent || '',
      isHandwrittenDetected: Boolean(headerResult.isHandwrittenDetected),
    };
  }

  const headerResult = await runHeaderHandwritingOcrBrowser(
    ai,
    cleanFullBase64,
    fullMimeType,
    hintLine
  );
  const issueRaw = resolveIssueNumber(
    headerResult.issueNumberRaw || '',
    headerResult.issueCharactersLeftToRight
  );
  const dateRaw = headerResult.dateRaw || '';

  return {
    issueNumberRaw: issueRaw,
    issueNumberNormalized: toWesternDigits(issueRaw),
    issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
    alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
    issueNumberBox: headerResult.issueNumberBox || null,
    dateRaw,
    dateNormalized: normalizeDateString(headerResult.dateNormalized || dateRaw),
    dateConfidence: headerResult.dateConfidence || 'medium',
    alternativeDate: headerResult.alternativeDate || '',
    dateBox: headerResult.dateBox || null,
    boxReferenceImage: 'header_crop',
    calendarType: headerResult.calendarType || 'unknown',
    title: '',
    recipient: '',
    subject: '',
    bodyContent: '',
    isHandwrittenDetected: Boolean(headerResult.isHandwrittenDetected),
  };
}
