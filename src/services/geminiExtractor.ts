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

export function clearStoredGeminiApiKey(): void {
  try {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

const fastExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    handwritingAnalysis: {
      type: Type.STRING,
      description:
        'قراءة بصرية حرفية لما هو مكتوب بخط اليد في حقل العدد وحقل التاريخ: اذكر كل حرف ورقم تراه بالترتيب مع الانتباه للخانات الطرفية القريبة من النقطتين (:) أو الشرطة (/).',
    },
    digitCount: {
      type: Type.INTEGER,
      description: 'عدد الخانات الرقمية الفعلية في حقل العدد.',
    },
    issueNumber: {
      type: Type.STRING,
      description:
        'العدد المكتوب بالضبط في الصورة (بكل أرقامه وحروفه وشرطاته المائلة) مطابقاً لـ handwritingAnalysis دون إسقاط أي خانة.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة محتملة في حال وجود رقم غير واضح، وإلا سلسلة فارغة.',
    },
    date: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط بخط اليد.',
    },
    title: {
      type: Type.STRING,
      description:
        'العنوان المركزي مثل (أمر جامعي) أو (أمر إداري) عند غياب إلى/ و م/، وإلا سلسلة فارغة.',
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
    'handwritingAnalysis',
    'digitCount',
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

const ultraExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    handwritingAnalysis: {
      type: Type.STRING,
      description: 'قراءة بصرية تفصيلية لكل رقم وحرف مكتوب بخط اليد في العدد والتاريخ.',
    },
    digitCount: {
      type: Type.INTEGER,
      description: 'عدد الخانات الرقمية الفعلية في حقل العدد.',
    },
    issueNumberRaw: {
      type: Type.STRING,
      description: 'العدد كما هو مكتوب بالضبط في الكتاب مطابقاً لـ handwritingAnalysis.',
    },
    issueNumberNormalized: {
      type: Type.STRING,
      description: 'العدد بأرقام إنجليزية (0123456789) مع الحفاظ على الحروف والشرطات المائلة.',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة محتملة في حال الشك في خانة، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      type: Type.OBJECT,
      description: 'إحداثيات مربع الإحاطة لقيمة العدد في الصورة الأولى (0 إلى 1000).',
      properties: {
        ymin: { type: Type.INTEGER },
        xmin: { type: Type.INTEGER },
        ymax: { type: Type.INTEGER },
        xmax: { type: Type.INTEGER },
      },
      required: ['ymin', 'xmin', 'ymax', 'xmax'],
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
      description: 'high أو medium أو low.',
    },
    alternativeDate: {
      type: Type.STRING,
      description: 'قراءة بديلة للتاريخ، وإلا سلسلة فارغة.',
    },
    calendarType: {
      type: Type.STRING,
      description: 'gregorian أو hijri أو unknown.',
    },
    dateBox: {
      type: Type.OBJECT,
      description: 'إحداثيات مربع الإحاطة لقيمة التاريخ في الصورة الأولى (0 إلى 1000).',
      properties: {
        ymin: { type: Type.INTEGER },
        xmin: { type: Type.INTEGER },
        ymax: { type: Type.INTEGER },
        xmax: { type: Type.INTEGER },
      },
      required: ['ymin', 'xmin', 'ymax', 'xmax'],
    },
    issuingEntity: {
      type: Type.STRING,
      description: 'الجهة المصدرة للكتاب إن ظهرت، وإلا سلسلة فارغة.',
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
      description: 'مضمون الكتاب كاملاً بدقة.',
    },
    handwritingNotes: {
      type: Type.STRING,
      description: 'ملاحظة موجزة حول وضوح خط اليد إن وجد.',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد والتاريخ مكتوبان بخط اليد.',
    },
  },
  required: [
    'handwritingAnalysis',
    'digitCount',
    'issueNumberRaw',
    'issueNumberNormalized',
    'issueNumberConfidence',
    'dateRaw',
    'dateNormalized',
    'dateConfidence',
    'calendarType',
    'isHandwrittenDetected',
  ],
};

const HANDWRITING_RULES = `قواعد قراءة الأرقام الهندية/العربية المكتوبة بخط اليد بدقة تامة:
- افحص الحبر اليدوي بجانب أو أسفل كلمة "العدد :" وكلمة "التاريخ :".
- تتبّع كل رقم على حدة من طرف إلى طرف ولا تسقط أي خانة قريبة من النقطتين ":" أو فوق الخط المنقط أو متداخلة مع الشرطة "/".
- لا تدمج رقمين متقاربين في رقم واحد (مثلاً: ٨ و ٦ المتجاورتان هما رقمان منفصلان وليس ٢، و٧ و٨ منفصلتان).
- تمييز الأشكال اليدوية:
  * (٠): نقطة أو دائرة صغيرة جداً، و(٥): دائرة مغلقة أو شكل قلب واضح.
  * (٢): قوسه العلوي يتجه يميناً ثم ينزل، أما (٦): زاويته/قوسه العلوي يتجه يساراً ثم ينزل عمودياً.
  * (٣): له أسنان متموجة في الأعلى، أما (٢): قوس واحد.
  * (٧): مفتوح للأعلى (∨)، أما (٨): مفتوح للأسفل (∧).
  * (١): خط عمودي مفرد، و(٩): حلقة مغلقة في الأعلى مع ذيل للأسفل.
- لا تخمّن أو تغيّر أرقاماً واضحة؛ اكتب في handwritingAnalysis ما تراه بالضبط ثم انقل النتيجة المطابقة لحقل العدد.`;

const FAST_SYSTEM_INSTRUCTION = `أنت خبير متخصص في قراءة الكتب الرسمية العربية وخط اليد بدقة عالية.
- إذا وُجدت صورتان: الصورة الأولى هي تقريب للزاوية العليا اليمنى من الكتاب (PNG بدون فقدان)، اقرأ منها (العدد) و(التاريخ) بخط اليد؛ وإذا لم يظهرا فيها فاقرأهما من الصورة الثانية (الصفحة كاملة). استخدم الصورة الثانية أيضاً لاستخراج العنوان و(إلى/) و(م/) ومضمون الكتاب.
${HANDWRITING_RULES}
- استخرج recipient بعد (إلى/) وsubject بعد (م/)، وإذا لم يوجدا ضَع العنوان مثل (أمر جامعي) في title، وانسخ مضمون الكتاب كاملاً في bodyContent.`;

const ULTRA_SYSTEM_INSTRUCTION = `أنت خبير متخصص في قراءة وأرشفة الكتب الرسمية العربية وخط اليد بدقة فائقة.
- عند وجود صورتين: الصورة الأولى هي تقريب الزاوية العليا اليمنى لقراءة (العدد) و(التاريخ) ومربعيهما (0..1000 نسبة للصورة الأولى)، والصورة الثانية هي الكتاب كاملاً لاستخراج الجهة المصدرة والعنوان و(إلى/) و(م/) ومضمون الكتاب.
${HANDWRITING_RULES}
- إذا كان هناك غموض أو تداخل مع الختم خفّض مستوى الثقة واذكر قراءة بديلة وملاحظة واضحة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
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
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export interface BrowserExtractParams {
  imageBase64: string;
  mimeType: string;
  headerImageBase64?: string;
  headerMimeType?: string;
  precisionMode: PrecisionMode;
  isCroppedRegion: boolean;
  hintText?: string;
  apiKey: string;
}

export async function extractDocumentWithGeminiBrowser(
  params: BrowserExtractParams
): Promise<ExtractionResult> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey.trim() });

  const cleanFullBase64 = params.imageBase64.includes(',')
    ? params.imageBase64.split(',')[1]
    : params.imageBase64;
  const fullMimeType = params.mimeType || 'image/jpeg';

  const cleanHeaderBase64 = params.headerImageBase64
    ? params.headerImageBase64.includes(',')
      ? params.headerImageBase64.split(',')[1]
      : params.headerImageBase64
    : null;
  const headerMimeType = params.headerMimeType || 'image/png';

  const isUltra = params.precisionMode === 'ultra';
  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';

  const contentParts: Array<
    { inlineData: { mimeType: string; data: string } } | { text: string }
  > = [];

  if (cleanHeaderBase64) {
    contentParts.push({
      inlineData: {
        mimeType: headerMimeType,
        data: cleanHeaderBase64,
      },
    });
  }

  contentParts.push({
    inlineData: {
      mimeType: fullMimeType,
      data: cleanFullBase64,
    },
  });

  contentParts.push({
    text: cleanHeaderBase64
      ? `اقرأ العدد والتاريخ المكتوبين بخط اليد بدقة من الترويسة المكبّرة (الصورة الأولى) بعد فحص جميع الخانات، واستخرج من الصفحة الكاملة (الصورة الثانية) العنوان أو إلى/م ومضمون الكتاب.${hintLine}`
      : params.isCroppedRegion
      ? `اقرأ العدد والتاريخ المكتوبين بخط اليد بدقة من هذه المنطقة المقصوصة.${hintLine}`
      : `استخرج العدد والتاريخ بخط اليد بدقة والعنوان أو إلى/م ومضمون الكتاب كاملاً.${hintLine}`,
  });

  const callModel = (
    model: string,
    thinkingLevel: ThinkingLevel,
    useHighMediaRes: boolean
  ) =>
    ai.models.generateContent({
      model,
      contents: { parts: contentParts },
      config: {
        systemInstruction: isUltra ? ULTRA_SYSTEM_INSTRUCTION : FAST_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: isUltra ? ultraExtractionSchema : fastExtractionSchema,
        thinkingConfig: { thinkingLevel },
        ...(useHighMediaRes
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }
          : {}),
      },
    });

  let response;
  const targetThinking = isUltra ? ThinkingLevel.XHIGH : ThinkingLevel.HIGH;
  try {
    response = await callModel('gemini-4-hydrogen', targetThinking, true);
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
    throw new Error('لم يُرجع نموذج التحليل بيانات نصية صالحة. يرجى المحاولة بصورة أوضح.');
  }

  const rawParsed = JSON.parse(rawText);
  if (isUltra) {
    return rawParsed as ExtractionResult;
  }

  return {
    issueNumberRaw: rawParsed.issueNumber || '',
    issueNumberNormalized: toWesternDigits(rawParsed.issueNumber || ''),
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
