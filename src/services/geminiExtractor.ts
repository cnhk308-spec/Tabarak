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

const headerHandwritingSchema = {
  type: Type.OBJECT,
  properties: {
    headerFound: {
      type: Type.BOOLEAN,
      description: 'true إذا ظهر حقل العدد أو التاريخ في هذه الصورة، وإلا false.',
    },
    digitStrokesLeftToRight: {
      type: Type.ARRAY,
      description:
        'افحص خط اليد في حقل (العدد :) بدقة متناهية خانةً بخانة من أقصى اليسار إلى أقصى اليمين حتى تلامس النقطتين (:). لا تتخطَّ أي رقم وسطي (مثل ٨ أو ٠) ولا تسقط أي رقم طرفي ملاصق لـ (:).',
      items: {
        type: Type.OBJECT,
        properties: {
          char: {
            type: Type.STRING,
            description: 'الرقم أو الحرف أو الشرطة المائلة الواحدة فقط في هذه الخانة.',
          },
          visualShape: {
            type: Type.STRING,
            description:
              'وصف موجز لضربة القلم الظاهرة (مثلاً: دائرة ٥، نقطة ٠، ثمانية مفتوحة للأسفل ∧، ستة معقوفة لليسار ┐، سبعة ∨).',
          },
        },
        required: ['char', 'visualShape'],
      },
    },
    colonEdgeCheck: {
      type: Type.STRING,
      description:
        'تحقق بصري نهائي: اذكر الرقم الملاصق تماماً ليسار النقطتين (:)، وتأكد من عدم سقوط أي رقم بين الخانات.',
    },
    issueNumberRaw: {
      type: Type.STRING,
      description:
        'العدد الكامل مطابقاً تماماً لتسلسل char في digitStrokesLeftToRight بدون حذف أو دمج أي خانة.',
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
      description: 'قراءة بديلة محتملة في حال الشك في ضربة قلم، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'إحداثيات مربع الإحاطة لقيمة العدد المكتوبة (0 إلى 1000).',
    },
    dateStrokesSummary: {
      type: Type.STRING,
      description: 'وصف موجز لضربات القلم في حقل (التاريخ :) من اليسار لليمين.',
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
    'digitStrokesLeftToRight',
    'colonEdgeCheck',
    'issueNumberRaw',
    'issueNumberNormalized',
    'issueNumberConfidence',
    'issueNumberBox',
    'dateStrokesSummary',
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

const HANDWRITING_RULES = `قواعد تفصيلية صارمة لقراءة الأرقام المكتوبة بخط اليد:
1. ركّز على كل ضربة حبر قلمية في سطر (العدد :) وسطر (التاريخ :) وتجاهل أرقام الهواتف أو رموز النماذج.
2. امسح الحبر المكتوب في حقل (العدد :) ببطء من اليسار إلى اليمين خانةً بخانة داخل digitStrokesLeftToRight، وصف شكل كل رقم على حدة:
   - لا تقفز فوق رقم وسطي (مثلاً: في ٥٠٨٦ توجد 4 خانات متميزة: [٥ دائرة] ثم [٠ نقطة] ثم [٨ مثلث مفتوح للأسفل ∧] ثم [٦ معقوفة لليسار وملاصقة للنقطتين :]).
   - لا تسقط الرقم الأخير على اليمين الملاصق للنقطتين (:) ولا تدمج رقمين متجاورين في رقم واحد!
3. تمييز الأشكال اليدوية الهندية (٠١٢٣٤٥٦٧٨٩):
   - (٠): نقطة حبر واضحة أو دائرة صغيرة جداً بين الأرقام.
   - (٥): حلقة مغلقة أو شكل قلب أكبر وأوضح من نقطة (٠).
   - (٨): شكل مثلث/ثنية مفتوح للأسفل (∧)، و(٧): مفتوح للأعلى (∨). انتبه جداً لـ (٨) بين (٠) و(٦) أو (٨) بجانب (٥)!
   - (٦): رأسه/خطه العلوي يتجه لليسار ثم ينزل عمودياً (┐)، بينما (٢): يتجه رأسه لليمين ثم ينزل (┌).
   - (٤): تعرّج مزدوج يتجه لليمين؛ (٣): ثلاث أسنان علوية؛ (٩): حلقة علوية مع ذيل؛ (١): خط عمودي مفرد (يختلف عن الشرطة المائلة الفاصلة /).
4. للأرقام الغربية اليدوية (0123456789): ميّز بدقة بين 0 و5 و6 و8 و9 و2 و7.
5. انقل الخانات من digitStrokesLeftToRight إلى issueNumberRaw كاملة بالترتيب دون إسقاط أي خانة.`;

const HEADER_OCR_INSTRUCTION = `أنت مدقق بصري متخصص حصرياً في تحليل وقراءة خط اليد في حقلَي (العدد) و(التاريخ) للكتب الرسمية العربية.
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بدقة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

function resolveIssueNumber(rawIssue: string, strokes?: unknown): string {
  const cleanRaw = (rawIssue || '').trim();
  if (!Array.isArray(strokes) || strokes.length === 0) return cleanRaw;

  const chars = strokes
    .map((item) => {
      if (typeof item === 'string') return item.trim();
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
      text: `ركز بالتفصيل على قراءة خط اليد في حقل (العدد :) وحقل (التاريخ :). صف كل خانة وضربة قلم من اليسار لليمين داخل digitStrokesLeftToRight دون تخطي أي رقم وسطي أو رقم ملاصق للنقطتين (:).${hintLine}`,
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

  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';

  if (cleanHeaderBase64) {
    const [initialHeader, bodyResult] = await Promise.all([
      runHeaderHandwritingOcrBrowser(
        ai,
        cleanHeaderBase64,
        headerMimeType,
        params.precisionMode,
        hintLine
      ),
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
        params.precisionMode,
        hintLine
      );
      boxReferenceImage = 'full_image';
    }

    const issueRaw = resolveIssueNumber(
      headerResult.issueNumberRaw || '',
      headerResult.digitStrokesLeftToRight
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
    params.precisionMode,
    hintLine
  );
  const issueRaw = resolveIssueNumber(
    headerResult.issueNumberRaw || '',
    headerResult.digitStrokesLeftToRight
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
