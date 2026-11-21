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
        'تحليل خانات حقل (العدد :) خانةً بخانة من اليسار لليمين (كل رقم أو حرف أو شرطة مائلة /). لا تسقط أي نقطة صفر (٠) أو رقم وسطي أو رقم ملاصق لـ (:).',
      items: {
        type: Type.OBJECT,
        properties: {
          c: {
            type: Type.STRING,
            description: 'الرقم أو الحرف أو الشرطة المائلة الواحدة.',
          },
          k: {
            type: Type.STRING,
            description:
              'وصف شكل الضربة بإيجاز (مثل: نقطة، حلقة، رأس لليمين، رأس لليسار، للأعلى، للأسفل، ذيل، تعرج، شرطة، حرف).',
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
      description: 'العدد كاملاً كما كُتب بخط اليد بجانب (العدد :) دون حذف أي خانة أو بادئة.',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة فقط عند وجود احتمال آخر، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'مربع الإحاطة لقيمة العدد المكتوبة فقط (0 إلى 1000).',
    },
    dateObservation: {
      type: Type.STRING,
      description:
        'ملاحظة بصرية قصيرة عن خانات التاريخ: اليوم، الشهر، السنة، وهل بعض أرقام السنة مطبوع مثل (٢٠٢) والباقي بخط اليد.',
    },
    dateDay: {
      type: Type.STRING,
      description: 'رقم اليوم في التاريخ كما ظهر (1-31 أو بالأرقام الهندية).',
    },
    dateMonth: {
      type: Type.STRING,
      description: 'رقم الشهر في التاريخ كما ظهر (1-12 أو بالأرقام الهندية).',
    },
    dateYear: {
      type: Type.STRING,
      description: 'السنة كاملة (4 أرقام مثل ٢٠٢٦ أو 2026، أو رقمين إذا كُتبت مختصرة).',
    },
    dateRaw: {
      type: Type.STRING,
      description: 'التاريخ كاملاً كما كُتب بالصيغة الظاهرة (مثل ٢٧/١٠/٢٠٢٦ أو ٢٠٢٦/١٠/٢٧).',
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
      description: 'مربع الإحاطة لقيمة التاريخ المكتوبة فقط (0 إلى 1000).',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد أو التاريخ مكتوب بخط اليد.',
    },
  },
  required: [
    'headerFound',
    'digits',
    'beforeColon',
    'issueNumberRaw',
    'issueNumberConfidence',
    'issueNumberBox',
    'dateObservation',
    'dateDay',
    'dateMonth',
    'dateYear',
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

const HANDWRITING_RULES = `قواعد صارمة لقراءة خط اليد في حقلَي (العدد :) و(التاريخ :) في الكتب الرسمية:
1. ركّز حصراً على القيمة المكتوبة بجانب كلمتَي (العدد :) و(التاريخ :) في ترويسة الكتاب. تجاهل أرقام الهواتف وصندوق البريد، وتجاهل التواريخ الموجودة أسفل الصفحة عند التوقيع أو الختم.
2. النماذج شبه المطبوعة: قد يكون جزء من التاريخ أو العدد مطبوعاً والباقي بخط اليد (مثل طباعة /  / ٢٠٢ وإكمال ٦ واليوم والشهر بالقلم). ادمج المطبوع والمكتوب بالقلم في القيمة النهائية الكاملة.
3. التمييز الدقيق للأرقام الهندية المكتوبة باليد (٠ إلى ٩):
   - (٠) نقطة حبر صغيرة واضحة في منتصف ارتفاع السطر: انتبه جداً لعدم إسقاط الصفر في الأعداد (مثل ١٠، ٢٠، ٣٠، ١٠٥، ٢٠٢٥، ٢٠٢٦، ١٤٤٧)، ولا تخلط بينه وبين نقاط السطر المطبوع أسفل الخط.
   - (٥) حلقة أو دائرة أو قلب مغلق واضح الحجم (أكبر وأجوف من نقطة الصفر ٠).
   - (٢) معقوفة الرأس لليمين (┌) ثم خط نازل؛ (٦) معقوفة الرأس لليسار (┐) ثم خط نازل — راجع اتجاه رأس القوس يمين أم يسار قبل الجزم بين ٢ و٦.
   - (٧) مفتوحة للأعلى (∨)؛ (٨) مفتوحة للأسفل (∧).
   - (٣) لها سنّتان أو ثلاث أسنان في أعلاها؛ (٤) متعرجة لليمين (٤)؛ (٩) حلقة علوية بذيل نازل.
   - (١) خط عمودي للرقم، بينما (/) خط مائل فاصل أطول؛ لا تحوّل الفاصل المائل (/) إلى الرقم ١.
4. للأرقام الغربية اليدوية (0-9): دقق في التمييز بين 0 و6 و8 و9، وبين 1 و7 والفاصل /، وبين 2 و3 و5، و4 و9.
5. قواعد العدد (issueNumberRaw):
   - اقرأ كافة الرموز والأرقام والحروف والشرطات المائلة المكتوبة في حقل العدد كاملةً (سواء كانت أرقاماً فقط أو تحوي بادئة حروف مثل م/٤/١٢٨٥).
   - افحص كل خانة في digits وتحقق من عدم سقوط أي رقم وسطي (خاصة النقطة ٠) أو رقم ملاصق للنقطتين (:) وسجّله في beforeColon.
6. قواعد التاريخ (dateRaw):
   - قد يُكتب التاريخ بخط اليد بصيغة (يوم/شهر/سنة) أو (سنة/شهر/يوم). ميّز السنة ذات الأربعة أرقام (مثل ٢٠٢٤، ٢٠٢٥، ٢٠٢٦، ١٤٤٦، ١٤٤٧) والشهر (١-١٢) واليوم (١-٣١) بدقة، وتأكد من عدم سقوط الصفر ٠ في خانة المئات أو الآحاد (فلا تتحول ٢٠٢٦ إلى ٢٢٦ أو ١٠ إلى ١).
   - عبّئ dateDay وdateMonth وdateYear بدقة مطابقة لـ dateRaw.`;

const HEADER_OCR_INSTRUCTION = `أنت خبير تدقيق بصري متخصص في قراءة خط اليد العربي والهندي والغربي في ترويسات الكتب الرسمية (حقل العدد وحقل التاريخ) بدقة بالغة دون تخمين.
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بإيجاز ودقة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

function cleanLabelNoise(value: string, labels: string[]): string {
  let out = (value || '').trim();
  for (const label of labels) {
    out = out.replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '');
  }
  return out.replace(/^[:：]+|[:：]+$/g, '').trim();
}

function resolveIssueNumber(
  rawIssue: string,
  digits?: unknown,
  beforeColon?: string
): string {
  const cleanRaw = cleanLabelNoise(rawIssue || '', ['العدد', 'رقم\\s*الكتاب', 'No\\.?']);
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
    .map((c) => c.replace(/^[:：]+|[:：]+$/g, '').trim())
    .filter((c) => c.length > 0 && c.length <= 6);

  if (chars.length === 0) return cleanRaw;
  const joined = chars.join('');
  if (!cleanRaw) return joined;

  const rawHasLettersOrSlash = /[ء-يA-Za-z\/\\-]/.test(cleanRaw);
  const joinedDigitsCount = toWesternDigits(joined).replace(/\D/g, '').length;
  const rawDigitsCount = toWesternDigits(cleanRaw).replace(/\D/g, '').length;

  if (!rawHasLettersOrSlash && joinedDigitsCount > rawDigitsCount) {
    return joined;
  }

  const colonChar = (beforeColon || '').replace(/^[:：\s]+|[:：\s]+$/g, '').trim();
  if (
    !rawHasLettersOrSlash &&
    colonChar &&
    /^[0-9٠-٩۰-۹]$/.test(colonChar) &&
    joined.endsWith(colonChar) &&
    !cleanRaw.endsWith(colonChar) &&
    toWesternDigits(cleanRaw + colonChar) === toWesternDigits(joined)
  ) {
    return joined;
  }

  return cleanRaw;
}

function resolveDateRaw(headerResult: Record<string, any>): string {
  const raw = cleanLabelNoise(headerResult.dateRaw || '', ['التاريخ', 'Date']);
  const day = cleanLabelNoise(String(headerResult.dateDay || ''), []);
  const month = cleanLabelNoise(String(headerResult.dateMonth || ''), []);
  const year = cleanLabelNoise(String(headerResult.dateYear || ''), []);

  if (raw) {
    const rawParts = toWesternDigits(raw)
      .split(/[\s\/\\\-.,،]+/)
      .map((p) => p.replace(/\D/g, ''))
      .filter(Boolean);
    if (rawParts.length === 3) {
      return raw;
    }
  }

  if (day && month && year) {
    const dNum = Number(toWesternDigits(day).replace(/\D/g, ''));
    const mNum = Number(toWesternDigits(month).replace(/\D/g, ''));
    const yStr = toWesternDigits(year).replace(/\D/g, '');
    if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12 && (yStr.length === 4 || yStr.length === 2)) {
      return `${day}/${month}/${year}`;
    }
  }

  return raw;
}

function normalizeDateString(
  rawDate: string,
  dateDay?: string,
  dateMonth?: string,
  dateYear?: string
): string {
  const western = toWesternDigits(rawDate || '').trim();
  const parts = western
    .split(/[\s\/\\\-.,،]+/)
    .map((p) => p.replace(/\D/g, ''))
    .filter(Boolean);

  if (parts.length === 3) {
    let [a, b, c] = parts;
    const yearHint = toWesternDigits(dateYear || '').replace(/\D/g, '');

    if (c.length === 4 && Number(a) <= 31 && Number(b) <= 31) {
      if (Number(b) > 12 && Number(a) <= 12) {
        return `${c}/${a.padStart(2, '0')}/${b.padStart(2, '0')}`;
      }
      return `${c}/${b.padStart(2, '0')}/${a.padStart(2, '0')}`;
    }

    if (a.length === 4 && Number(b) <= 31 && Number(c) <= 31) {
      if (Number(b) > 12 && Number(c) <= 12) {
        return `${a}/${c.padStart(2, '0')}/${b.padStart(2, '0')}`;
      }
      return `${a}/${b.padStart(2, '0')}/${c.padStart(2, '0')}`;
    }

    if (c.length === 2 && Number(a) <= 31 && Number(b) <= 31) {
      const resolvedYear =
        yearHint.length === 4 && yearHint.endsWith(c)
          ? yearHint
          : Number(c) >= 40
          ? `14${c}`
          : `20${c}`;
      if (Number(b) > 12 && Number(a) <= 12) {
        return `${resolvedYear}/${a.padStart(2, '0')}/${b.padStart(2, '0')}`;
      }
      return `${resolvedYear}/${b.padStart(2, '0')}/${a.padStart(2, '0')}`;
    }
  }

  const d = toWesternDigits(dateDay || '').replace(/\D/g, '');
  const m = toWesternDigits(dateMonth || '').replace(/\D/g, '');
  const y = toWesternDigits(dateYear || '').replace(/\D/g, '');
  if (d && m && y) {
    const dNum = Number(d);
    const mNum = Number(m);
    if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12) {
      const fullY =
        y.length === 4 ? y : y.length === 2 ? (Number(y) >= 40 ? `14${y}` : `20${y}`) : y;
      if (fullY.length === 4) {
        return `${fullY}/${m.padStart(2, '0')}/${d.padStart(2, '0')}`;
      }
    }
  }

  return western.replace(/\s+/g, '');
}

function resolveCalendarType(
  rawCalendarType: string | undefined,
  normalizedDate: string
): 'gregorian' | 'hijri' | 'unknown' {
  if (rawCalendarType === 'gregorian' || rawCalendarType === 'hijri') {
    return rawCalendarType;
  }
  const yearMatch = normalizedDate.match(/^(\d{4})\//);
  if (yearMatch) {
    const yr = Number(yearMatch[1]);
    if (yr >= 1900 && yr <= 2100) return 'gregorian';
    if (yr >= 1300 && yr <= 1550) return 'hijri';
  }
  return 'unknown';
}

function stripDataUrlPrefix(input: string): string {
  return input.includes(',') ? input.split(',')[1] : input;
}

function getApiErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.message === 'string') {
    const msg = e.message;
    if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
      return 503;
    }
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      return 429;
    }
    if (msg.includes('400') || msg.includes('INVALID_ARGUMENT')) {
      return 400;
    }
    if (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('API_KEY_INVALID')
    ) {
      return 403;
    }
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Request timeout'), { status: 503 }));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = getApiErrorStatus(err);
      const isTransient = status === 429 || status === 503 || status === 500;
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 350 * Math.pow(2, attempt);
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
  const parts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `اقرأ حقل (العدد :) وحقل (التاريخ :) بدقة تامة من الصورة مع التركيز الشديد على خط اليد. افحص كل خانة للعدد في digits وتحقق من الرقم الملاصق للنقطتين في beforeColon، وفصّل اليوم والشهر والسنة في dateDay وdateMonth وdateYear دون إسقاط الصفر (٠).${hintLine}`,
    },
  ];

  const callModel = (
    model: string,
    level: ThinkingLevel | null,
    useHighMediaRes: boolean
  ) =>
    ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        systemInstruction: HEADER_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: headerHandwritingSchema,
        ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
        ...(useHighMediaRes
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }
          : {}),
      },
    });

  const primaryModel = 'gemini-4-hydrogen';
  const primaryLevel =
    precisionMode === 'ultra' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM;
  const timeoutMs = precisionMode === 'ultra' ? 24000 : 19000;

  let response;
  try {
    response = await withTimeout(
      callModel(primaryModel, primaryLevel, true),
      timeoutMs
    );
  } catch (err: unknown) {
    const errObj = err as { message?: string };
    const status = getApiErrorStatus(err);
    const msg = errObj?.message || '';
    if (msg.includes('PROXY_GENERATION_DISABLED') || status === 400) {
      try {
        response = await withTimeout(
          callModel('gemini-4-hydrogen', ThinkingLevel.LOW, false),
          timeoutMs
        );
      } catch {
        try {
          response = await withTimeout(
            callModel('gemini-3.1-flash-lite', null, false),
            timeoutMs
          );
        } catch (fbErr: unknown) {
          const fbMsg = (fbErr as { message?: string })?.message || msg;
          if (fbMsg.includes('PROXY_GENERATION_DISABLED')) {
            throw Object.assign(new Error(fbMsg), { isProxyDisabled: true });
          }
          throw fbErr;
        }
      }
    } else if (status === 429 || status === 503 || status === 500) {
      try {
        response = await callWithRetry(
          () =>
            withTimeout(
              callModel('gemini-4-hydrogen', ThinkingLevel.LOW, false),
              timeoutMs
            ),
          1
        );
      } catch (hErr: unknown) {
        try {
          response = await withTimeout(
            callModel('gemini-3.1-flash-lite', null, false),
            timeoutMs
          );
        } catch (fbErr: unknown) {
          const fbStatus = getApiErrorStatus(fbErr) || getApiErrorStatus(hErr);
          if (fbStatus === 503 || fbStatus === 429) {
            throw new Error(
              'الخدمة تشهد ضغطاً مؤقتاً حالياً (503). يرجى الضغط على إعادة المحاولة بعد ثوانٍ.'
            );
          }
          throw fbErr;
        }
      }
    } else if (status === 401 || status === 403) {
      throw Object.assign(
        new Error('مفتاح Gemini API غير صالح أو مرفوض. يرجى التحقق من المفتاح المدخل أو مسحه.'),
        { isKeyRejected: true }
      );
    } else {
      throw new Error(
        msg ? `تعذر إكمال التحليل: ${msg}` : 'حدث خطأ أثناء تحليل صورة الكتاب.'
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
    headerResult.digits,
    headerResult.beforeColon
  );
  const dateRaw = resolveDateRaw(headerResult);
  const dateNormalized = normalizeDateString(
    dateRaw,
    headerResult.dateDay,
    headerResult.dateMonth,
    headerResult.dateYear
  );

  return {
    issueNumberRaw: issueRaw,
    issueNumberNormalized: toWesternDigits(issueRaw),
    issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
    alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
    issueNumberBox: headerResult.issueNumberBox || null,
    dateRaw,
    dateNormalized,
    dateConfidence: headerResult.dateConfidence || 'medium',
    alternativeDate: headerResult.alternativeDate || '',
    dateBox: headerResult.dateBox || null,
    boxReferenceImage,
    calendarType: resolveCalendarType(headerResult.calendarType, dateNormalized),
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

async function extractViaServer(
  params: ServerExtractParams,
  callbacks?: { onHeaderReady?: (headerResult: ExtractionResult) => void }
): Promise<ExtractionResult> {
  const hasSeparateHeader = Boolean(params.headerImageBase64);
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
  try {
    const raw = await runHeaderHandwritingOcrBrowser(
      ai,
      stripDataUrlPrefix(params.imageBase64),
      params.mimeType || 'image/jpeg',
      params.precisionMode,
      hintLine
    );
    return buildHeaderExtractionResult(raw, 'header_crop');
  } catch (err: unknown) {
    const e = err as { isProxyDisabled?: boolean; isKeyRejected?: boolean };
    if (e?.isProxyDisabled || e?.isKeyRejected) {
      return postJson<ExtractionResult>('/api/extract-header', {
        headerImageBase64: params.imageBase64,
        headerMimeType: params.mimeType,
        precisionMode: params.precisionMode,
        hintText: params.hintText,
      });
    }
    throw err;
  }
}

export async function extractDocumentProgressive(
  params: ServerExtractParams,
  customApiKey?: string,
  callbacks?: {
    onHeaderReady?: (headerResult: ExtractionResult) => void;
  }
): Promise<ExtractionResult> {
  const trimmedKey = (customApiKey || '').trim();
  if (!trimmedKey) {
    return extractViaServer(params, callbacks);
  }

  const ai = new GoogleGenAI({ apiKey: trimmedKey });
  const cleanFullBase64 = stripDataUrlPrefix(params.imageBase64);
  const fullMimeType = params.mimeType || 'image/jpeg';
  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';
  const hasSeparateHeader = Boolean(params.headerImageBase64);

  try {
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
  } catch (err: unknown) {
    const e = err as { isProxyDisabled?: boolean; isKeyRejected?: boolean };
    if (e?.isProxyDisabled || e?.isKeyRejected) {
      try {
        return await extractViaServer(params, callbacks);
      } catch {
        throw new Error(
          'المفتاح المحفوظ في زر المفتاح (أسفل اليسار) مقيّد أو غير صالح للاتصال المباشر. اضغط على زر المفتاح وامسحه لاستخدام الخادم، أو أدخل مفتاحاً صالحاً من Google AI Studio.'
        );
      }
    }
    throw err;
  }
}

export async function extractDocumentWithGemini(
  params: ServerExtractParams,
  customApiKey?: string
): Promise<ExtractionResult> {
  return extractDocumentProgressive(params, customApiKey);
}
