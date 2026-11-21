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

export interface BodyExtractFields {
  issuingEntity: string;
  title: string;
  recipient: string;
  subject: string;
  bodyContent: string;
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

const headerHandwritingSchema = {
  type: Type.OBJECT,
  properties: {
    headerFound: {
      type: Type.BOOLEAN,
      description: 'true إذا ظهر العدد أو التاريخ في الصورة، وإلا false.',
    },
    digits: {
      type: Type.ARRAY,
      description:
        'امسح كل خانة في حقل (العدد :) من أقصى اليسار إلى أقصى اليمين حتى تلامس النقطتين (:). لا تتخطَّ أي رقم وسطي ولا تسقط الرقم الملاصق لـ (:).',
      items: {
        type: Type.OBJECT,
        properties: {
          c: {
            type: Type.STRING,
            description: 'الرقم أو الحرف أو الشرطة الواحدة فقط.',
          },
          k: {
            type: Type.STRING,
            description:
              'وسم الشكل بكلمة واحدة: حلقة|نقطة|∧|∨|┐|┌|تعرج|أسنان|ذيل|عمود|شرطة|حرف|غربي',
          },
        },
        required: ['c', 'k'],
      },
    },
    beforeColon: {
      type: Type.STRING,
      description: 'الرقم أو الحرف الملاصق تماماً ليسار النقطتين (:) في حقل العدد.',
    },
    issueNumberRaw: {
      type: Type.STRING,
      description: 'العدد كاملاً مطابقاً تماماً لدمج c في digits بدون حذف أي خانة.',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة فقط عند الشك، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'مربع الإحاطة لقيمة العدد المكتوبة (0 إلى 1000).',
    },
    dateRaw: {
      type: Type.STRING,
      description: 'التاريخ كما كُتب بخط اليد بالضبط.',
    },
    dateConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeDate: {
      type: Type.STRING,
      description: 'قراءة بديلة للتاريخ عند الشك، وإلا سلسلة فارغة.',
    },
    calendarType: {
      type: Type.STRING,
      description: 'gregorian أو hijri أو unknown',
    },
    dateBox: {
      ...boxSchema,
      description: 'مربع الإحاطة لقيمة التاريخ المكتوبة (0 إلى 1000).',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد أو التاريخ بخط اليد.',
    },
  },
  required: [
    'headerFound',
    'digits',
    'beforeColon',
    'issueNumberRaw',
    'issueNumberConfidence',
    'issueNumberBox',
    'dateRaw',
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

const HANDWRITING_RULES = `قواعد صارمة لقراءة خط اليد في حقلَي (العدد :) و(التاريخ :):
1. ركّز فقط على حبر خط اليد بجانب (العدد :) و(التاريخ :) وتجاهل أرقام الهواتف والرموز المطبوعة.
2. امسح حقل (العدد :) من اليسار لليمين خانةً بخانة داخل digits، ولا تقفز فوق أي رقم وسطي (مثل ٨ أو ٠) ولا تسقط الرقم الملاصق لـ (:) (تحقق منه في beforeColon).
   مثال: ٥٠٨٦ يتكون من 4 ضربات متميزة: [٥ حلقة] + [٠ نقطة] + [٨ مفتوحة للأسفل ∧] + [٦ معقوفة لليسار ┐ ملاصقة لـ :].
3. تمييز الأرقام الهندية:
   - (٠) نقطة حبر واضحة؛ (٥) حلقة مغلقة/قلب أكبر؛
   - (٨) مفتوحة للأسفل ∧؛ (٧) مفتوحة للأعلى ∨؛
   - (٦) رأسها يتجه لليسار ┐؛ (٢) رأسها يتجه لليمين ┌؛
   - (٤) تعرّج لليمين؛ (٣) ثلاث أسنان؛ (٩) حلقة وذيل؛ (١) عمودي مفرد.
4. للأرقام الغربية (0-9): ميّز بدقة بين 0 و5 و6 و8 و9 و2 و7.
5. انقل جميع خانات digits كاملة إلى issueNumberRaw دون إسقاط أي خانة.`;

const HEADER_OCR_INSTRUCTION = `أنت مدقق بصري متخصص حصرياً في قراءة خط اليد بدقة شديدة في حقلَي (العدد) و(التاريخ).
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بإيجاز ودقة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

function resolveIssueNumber(rawIssue: string, digits?: unknown): string {
  const cleanRaw = (rawIssue || '').trim();
  if (!Array.isArray(digits) || digits.length === 0) return cleanRaw;

  const chars = digits
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'c' in item) {
        const ch = (item as { c?: unknown }).c;
        return typeof ch === 'string' ? ch.trim() : '';
      }
      if (item && typeof item === 'object' && 'char' in item) {
        const ch = (item as { char?: unknown }).char;
        return typeof ch === 'string' ? ch.trim() : '';
      }
      return '';
    })
    .filter((c) => c.length > 0 && c.length <= 2);

  if (chars.length === 0) return cleanRaw;
  const joined = chars.join('');
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

function stripDataUrlPrefix(input: string): string {
  return input.includes(',') ? input.split(',')[1] : input;
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
      const delayMs = 450 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function runHeaderHandwritingOcrBrowser(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  precisionMode: PrecisionMode,
  hintLine: string
) {
  const thinkingLevel =
    precisionMode === 'ultra' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM;

  const parts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `اقرأ حقل (العدد :) وحقل (التاريخ :) بخط اليد بدقة شديدة. سجّل كل خانة من اليسار لليمين في digits وتحقق من الرقم الملاصق للنقطتين (:) في beforeColon.${hintLine}`,
    },
  ];

  const callModel = (
    model: string,
    level: ThinkingLevel,
    useHighMediaRes: boolean
  ) =>
    ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        systemInstruction: HEADER_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: headerHandwritingSchema,
        thinkingConfig: { thinkingLevel: level },
        ...(useHighMediaRes
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }
          : {}),
      },
    });

  let response;
  try {
    response = await callModel('gemini-4-hydrogen', thinkingLevel, true);
  } catch (err: unknown) {
    const errObj = err as { status?: number; code?: number; message?: string };
    const status = errObj?.status || errObj?.code;
    if (status === 400) {
      response = await callModel('gemini-4-hydrogen', thinkingLevel, false);
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
): Promise<BodyExtractFields> {
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
      model: 'gemini-3.1-flash-lite',
      contents: { parts },
      config: {
        systemInstruction: BODY_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: documentBodySchema,
      },
    });
    const rawText = (response.text ?? '').trim();
    const parsed = rawText ? JSON.parse(rawText) : {};
    return {
      issuingEntity: parsed.issuingEntity || '',
      title: parsed.title || '',
      recipient: parsed.recipient || '',
      subject: parsed.subject || '',
      bodyContent: parsed.bodyContent || '',
    };
  } catch {
    try {
      const fallback = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: BODY_OCR_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: documentBodySchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const fallbackText = (fallback.text ?? '').trim();
      const parsed = fallbackText ? JSON.parse(fallbackText) : {};
      return {
        issuingEntity: parsed.issuingEntity || '',
        title: parsed.title || '',
        recipient: parsed.recipient || '',
        subject: parsed.subject || '',
        bodyContent: parsed.bodyContent || '',
      };
    } catch {
      return {
        issuingEntity: '',
        title: '',
        recipient: '',
        subject: '',
        bodyContent: '',
      };
    }
  }
}

function buildHeaderExtractionResult(
  headerResult: Record<string, any>,
  boxReferenceImage: 'header_crop' | 'full_image'
): ExtractionResult {
  const issueRaw = resolveIssueNumber(
    headerResult.issueNumberRaw || '',
    headerResult.digits
  );
  const dateRaw = headerResult.dateRaw || '';

  return {
    issueNumberRaw: issueRaw,
    issueNumberNormalized: toWesternDigits(issueRaw),
    issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
    alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
    issueNumberBox: headerResult.issueNumberBox || null,
    dateRaw,
    dateNormalized: normalizeDateString(dateRaw),
    dateConfidence: headerResult.dateConfidence || 'medium',
    alternativeDate: headerResult.alternativeDate || '',
    dateBox: headerResult.dateBox || null,
    boxReferenceImage,
    calendarType: headerResult.calendarType || 'unknown',
    issuingEntity: '',
    title: '',
    recipient: '',
    subject: '',
    bodyContent: '',
    isHandwrittenDetected: Boolean(headerResult.isHandwrittenDetected),
  };
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok || !data || data.error) {
    throw new Error(
      data?.error ||
        'تعذر الاتصال بخدمة التحليل على الخادم. اضغط على أيقونة المفتاح في أسفل يسار الشاشة لإدخال مفتاح Gemini API والعمل مباشرة.'
    );
  }
  return data.result as T;
}

export async function extractHeaderOnlyWithGemini(
  params: {
    imageBase64: string;
    mimeType: string;
    precisionMode: PrecisionMode;
    hintText?: string;
  },
  customApiKey?: string
): Promise<ExtractionResult> {
  const trimmedKey = (customApiKey || '').trim();
  if (!trimmedKey) {
    return postJson<ExtractionResult>('/api/extract-header', {
      headerImageBase64: params.imageBase64,
      headerMimeType: params.mimeType,
      precisionMode: params.precisionMode,
      hintText: params.hintText,
    });
  }

  const ai = new GoogleGenAI({ apiKey: trimmedKey });
  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';
  const raw = await runHeaderHandwritingOcrBrowser(
    ai,
    stripDataUrlPrefix(params.imageBase64),
    params.mimeType || 'image/jpeg',
    params.precisionMode,
    hintLine
  );
  return buildHeaderExtractionResult(raw, 'header_crop');
}

export async function extractDocumentProgressive(
  params: ServerExtractParams,
  customApiKey?: string,
  callbacks?: {
    onHeaderReady?: (headerResult: ExtractionResult) => void;
  }
): Promise<ExtractionResult> {
  const trimmedKey = (customApiKey || '').trim();
  const hasSeparateHeader = Boolean(params.headerImageBase64);

  if (!trimmedKey) {
    if (!hasSeparateHeader) {
      const headerOnly = await postJson<ExtractionResult>('/api/extract-header', {
        headerImageBase64: params.imageBase64,
        headerMimeType: params.mimeType,
        precisionMode: params.precisionMode,
        hintText: params.hintText,
      });
      callbacks?.onHeaderReady?.(headerOnly);
      return headerOnly;
    }

    const headerPromise = postJson<ExtractionResult>('/api/extract-header', {
      headerImageBase64: params.headerImageBase64,
      headerMimeType: params.headerMimeType,
      fullImageBase64: params.imageBase64,
      fullMimeType: params.mimeType,
      precisionMode: params.precisionMode,
      hintText: params.hintText,
    }).then((headerRes) => {
      callbacks?.onHeaderReady?.(headerRes);
      return headerRes;
    });

    const bodyPromise = postJson<BodyExtractFields>('/api/extract-body', {
      imageBase64: params.imageBase64,
      mimeType: params.mimeType,
      hintText: params.hintText,
    }).catch(
      (): BodyExtractFields => ({
        issuingEntity: '',
        title: '',
        recipient: '',
        subject: '',
        bodyContent: '',
      })
    );

    const [headerRes, bodyRes] = await Promise.all([headerPromise, bodyPromise]);
    return {
      ...headerRes,
      ...bodyRes,
    };
  }

  const ai = new GoogleGenAI({ apiKey: trimmedKey });
  const cleanFullBase64 = stripDataUrlPrefix(params.imageBase64);
  const fullMimeType = params.mimeType || 'image/jpeg';
  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';

  if (!hasSeparateHeader) {
    const rawHeader = await runHeaderHandwritingOcrBrowser(
      ai,
      cleanFullBase64,
      fullMimeType,
      params.precisionMode,
      hintLine
    );
    const headerOnly = buildHeaderExtractionResult(rawHeader, 'header_crop');
    callbacks?.onHeaderReady?.(headerOnly);
    return headerOnly;
  }

  const cleanHeaderBase64 = stripDataUrlPrefix(params.headerImageBase64!);
  const headerMimeType = params.headerMimeType || 'image/jpeg';

  const headerPromise = (async () => {
    let rawHeader = await runHeaderHandwritingOcrBrowser(
      ai,
      cleanHeaderBase64,
      headerMimeType,
      params.precisionMode,
      hintLine
    );
    let boxReferenceImage: 'header_crop' | 'full_image' = 'header_crop';

    if (
      !rawHeader.headerFound ||
      (!rawHeader.issueNumberRaw?.trim() && !rawHeader.dateRaw?.trim())
    ) {
      rawHeader = await runHeaderHandwritingOcrBrowser(
        ai,
        cleanFullBase64,
        fullMimeType,
        params.precisionMode,
        hintLine
      );
      boxReferenceImage = 'full_image';
    }

    const headerRes = buildHeaderExtractionResult(rawHeader, boxReferenceImage);
    callbacks?.onHeaderReady?.(headerRes);
    return headerRes;
  })();

  const bodyPromise = runBodyOcrBrowser(
    ai,
    cleanFullBase64,
    fullMimeType,
    hintLine
  );

  const [headerRes, bodyRes] = await Promise.all([headerPromise, bodyPromise]);
  return {
    ...headerRes,
    ...bodyRes,
  };
}

export async function extractDocumentWithGemini(
  params: ServerExtractParams,
  customApiKey?: string
): Promise<ExtractionResult> {
  return extractDocumentProgressive(params, customApiKey);
}
