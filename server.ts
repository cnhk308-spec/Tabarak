import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PrecisionMode = 'standard' | 'ultra';

interface ExtractRequestBody {
  imageBase64?: string;
  mimeType?: string;
  headerImageBase64?: string;
  headerMimeType?: string;
  precisionMode?: PrecisionMode;
  isCroppedRegion?: boolean;
  hintText?: string;
}

interface ExtractHeaderRequestBody {
  headerImageBase64?: string;
  headerMimeType?: string;
  fullImageBase64?: string;
  fullMimeType?: string;
  precisionMode?: PrecisionMode;
  hintText?: string;
}

interface ExtractBodyRequestBody {
  imageBase64?: string;
  mimeType?: string;
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
    const [a, b, c] = parts;
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

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('لم يتم تهيئة مفتاح Gemini على الخادم.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function stripDataUrlPrefix(input: string): string {
  return input.includes(',') ? input.split(',')[1] : input;
}

async function runHeaderHandwritingOcr(
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
    const status = getApiErrorStatus(err);
    if (status === 400) {
      try {
        response = await withTimeout(
          callModel('gemini-4-hydrogen', ThinkingLevel.LOW, false),
          timeoutMs
        );
      } catch {
        response = await withTimeout(
          callModel('gemini-3.1-flash-lite', null, false),
          timeoutMs
        );
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
      } catch {
        response = await withTimeout(
          callModel('gemini-3.1-flash-lite', null, false),
          timeoutMs
        );
      }
    } else {
      throw err;
    }
  }

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('لم يُرجع نموذج التحليل بيانات نصية صالحة.');
  }
  return JSON.parse(rawText);
}

async function runBodyOcr(
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
      model: 'gemini-3.1-flash-lite',
      contents: { parts },
      config: {
        systemInstruction: BODY_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: documentBodySchema,
      },
    });
    const rawText = (response.text ?? '').trim();
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    try {
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: BODY_OCR_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: documentBodySchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const fallbackText = (fallbackResponse.text ?? '').trim();
      return fallbackText ? JSON.parse(fallbackText) : {};
    } catch {
      return {};
    }
  }
}

function buildHeaderPayload(
  headerResult: Record<string, any>,
  boxReferenceImage: 'header_crop' | 'full_image'
) {
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
    isHandwrittenDetected: Boolean(headerResult.isHandwrittenDetected),
  };
}

function handleApiError(res: express.Response, err: unknown) {
  const errObj = err as { status?: number; code?: number; message?: string };
  const status = errObj?.status || errObj?.code;
  if (status === 429 || status === 503) {
    res.status(429).json({
      error: 'تم تجاوز حد الطلبات المؤقت. يرجى الانتظار بضع ثوانٍ ثم إعادة المحاولة.',
    });
    return;
  }
  res.status(500).json({
    error: errObj?.message || 'حدث خطأ أثناء تحليل صورة الكتاب.',
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.post('/api/extract-header', async (req, res) => {
    try {
      const body = (req.body || {}) as ExtractHeaderRequestBody;
      if (!body.headerImageBase64 || typeof body.headerImageBase64 !== 'string') {
        res.status(400).json({ error: 'بيانات صورة الترويسة غير صالحة أو مفقودة.' });
        return;
      }

      const ai = getAiClient();
      const cleanHeaderBase64 = stripDataUrlPrefix(body.headerImageBase64);
      const headerMimeType = body.headerMimeType || 'image/jpeg';
      const precisionMode: PrecisionMode =
        body.precisionMode === 'ultra' ? 'ultra' : 'standard';
      const hintLine =
        body.hintText && body.hintText.trim().length > 0
          ? ` تلميح: ${body.hintText.trim()}`
          : '';

      let headerResult = await runHeaderHandwritingOcr(
        ai,
        cleanHeaderBase64,
        headerMimeType,
        precisionMode,
        hintLine
      );
      let boxReferenceImage: 'header_crop' | 'full_image' = 'header_crop';

      if (
        body.fullImageBase64 &&
        (!headerResult.headerFound ||
          (!headerResult.issueNumberRaw?.trim() && !headerResult.dateRaw?.trim()))
      ) {
        headerResult = await runHeaderHandwritingOcr(
          ai,
          stripDataUrlPrefix(body.fullImageBase64),
          body.fullMimeType || 'image/jpeg',
          precisionMode,
          hintLine
        );
        boxReferenceImage = 'full_image';
      }

      res.json({ result: buildHeaderPayload(headerResult, boxReferenceImage) });
    } catch (err: unknown) {
      handleApiError(res, err);
    }
  });

  app.post('/api/extract-body', async (req, res) => {
    try {
      const body = (req.body || {}) as ExtractBodyRequestBody;
      if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
        res.status(400).json({ error: 'بيانات الصورة غير صالحة أو مفقودة.' });
        return;
      }

      const ai = getAiClient();
      const cleanFullBase64 = stripDataUrlPrefix(body.imageBase64);
      const fullMimeType = body.mimeType || 'image/jpeg';
      const hintLine =
        body.hintText && body.hintText.trim().length > 0
          ? ` تلميح: ${body.hintText.trim()}`
          : '';

      const bodyResult = await runBodyOcr(ai, cleanFullBase64, fullMimeType, hintLine);
      res.json({
        result: {
          issuingEntity: bodyResult.issuingEntity || '',
          title: bodyResult.title || '',
          recipient: bodyResult.recipient || '',
          subject: bodyResult.subject || '',
          bodyContent: bodyResult.bodyContent || '',
        },
      });
    } catch (err: unknown) {
      handleApiError(res, err);
    }
  });

  app.post('/api/extract', async (req, res) => {
    try {
      const body = (req.body || {}) as ExtractRequestBody;
      if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
        res.status(400).json({ error: 'بيانات الصورة غير صالحة أو مفقودة.' });
        return;
      }

      const ai = getAiClient();
      const cleanFullBase64 = stripDataUrlPrefix(body.imageBase64);
      const fullMimeType = body.mimeType || 'image/jpeg';
      const cleanHeaderBase64 =
        body.headerImageBase64 && typeof body.headerImageBase64 === 'string'
          ? stripDataUrlPrefix(body.headerImageBase64)
          : null;
      const headerMimeType = body.headerMimeType || 'image/jpeg';

      const precisionMode: PrecisionMode =
        body.precisionMode === 'ultra' ? 'ultra' : 'standard';
      const hintLine =
        body.hintText && body.hintText.trim().length > 0
          ? ` تلميح: ${body.hintText.trim()}`
          : '';

      if (cleanHeaderBase64) {
        const [initialHeader, bodyResult] = await Promise.all([
          runHeaderHandwritingOcr(
            ai,
            cleanHeaderBase64,
            headerMimeType,
            precisionMode,
            hintLine
          ),
          runBodyOcr(ai, cleanFullBase64, fullMimeType, hintLine),
        ]);

        let headerResult = initialHeader;
        let boxReferenceImage: 'header_crop' | 'full_image' = 'header_crop';

        if (
          !headerResult.headerFound ||
          (!headerResult.issueNumberRaw?.trim() && !headerResult.dateRaw?.trim())
        ) {
          headerResult = await runHeaderHandwritingOcr(
            ai,
            cleanFullBase64,
            fullMimeType,
            precisionMode,
            hintLine
          );
          boxReferenceImage = 'full_image';
        }

        res.json({
          result: {
            ...buildHeaderPayload(headerResult, boxReferenceImage),
            issuingEntity: bodyResult.issuingEntity || '',
            title: bodyResult.title || '',
            recipient: bodyResult.recipient || '',
            subject: bodyResult.subject || '',
            bodyContent: bodyResult.bodyContent || '',
          },
        });
        return;
      }

      const headerResult = await runHeaderHandwritingOcr(
        ai,
        cleanFullBase64,
        fullMimeType,
        precisionMode,
        hintLine
      );

      res.json({
        result: {
          ...buildHeaderPayload(headerResult, 'header_crop'),
          issuingEntity: '',
          title: '',
          recipient: '',
          subject: '',
          bodyContent: '',
        },
      });
    } catch (err: unknown) {
      handleApiError(res, err);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
