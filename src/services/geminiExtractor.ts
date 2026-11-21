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
  signatureDateHint?: string;
  latestBodyYear?: string;
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
    issueObservation: {
      type: Type.STRING,
      description:
        'مسح بصري كامل للسطر بجانب (العدد :) من علامة النقطتين (:) يساراً حتى آخر رقم أو حرف أو شرطة، مع عدّ كل الخانات حتى الخفيفة أو البعيدة.',
    },
    digits: {
      type: Type.ARRAY,
      description:
        'تحليل كافة خانات حقل (العدد :) خانةً بخانة من اليسار لليمين (كل رقم أو حرف أو شرطة مائلة /). امسح المساحة الكاملة بجانب (العدد :) ولا تسقط أي رقم ملاصق لـ (:) ولا أي خانة خفيفة أو متباعدة.',
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
      description: 'العدد كاملاً بكل خاناته وحروفه وشرطاته كما كُتب بخط اليد بجانب (العدد :) دون قص أو حذف أي خانة من اليمين أو اليسار.',
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
      description:
        'مربع الإحاطة الواسع الذي يغطي كامل السطر المكتوب بجانب (العدد :) بدءاً من علامة النقطتين (:) يميناً وحتى أقصى اليسار بعد آخر خانة مكتوبة (0 إلى 1000).',
    },
    dateObservation: {
      type: Type.STRING,
      description:
        'ملاحظة بصرية قصيرة: صف الخانات الثلاث مكانياً (أقصى اليسار، الوسط، أقصى اليمين) وهل السنة بها رقم ٤ متعرج أو ٦ معقوفة لليسار أو ٥ حلقة أو ٢ معقوفة لليمين.',
    },
    dateLeftPart: {
      type: Type.STRING,
      description:
        'الجزء الموجود في أقصى اليسار من التاريخ كما يظهر مكانياً في الصورة (غالباً السنة مثل ٢٠٢٦ أو قد يكون اليوم).',
    },
    dateMiddlePart: {
      type: Type.STRING,
      description: 'الجزء الموجود في الوسط بين الفاصلين / (وهو الشهر دائماً).',
    },
    dateRightPart: {
      type: Type.STRING,
      description:
        'الجزء الموجود في أقصى اليمين الأقرب لكلمة (التاريخ :) كما يظهر مكانياً في الصورة (غالباً اليوم مثل ٢٧ أو ٨).',
    },
    dateDay: {
      type: Type.STRING,
      description: 'رقم اليوم المستنتج (1-31).',
    },
    dateMonth: {
      type: Type.STRING,
      description: 'رقم الشهر المستنتج (1-12).',
    },
    dateYear: {
      type: Type.STRING,
      description: 'السنة الكاملة المستنتجة (4 أرقام مثل ٢٠٢٦ أو 2026).',
    },
    dateRaw: {
      type: Type.STRING,
      description: 'التاريخ كاملاً بصيغة واضحة (مثل ٢٠٢٦/١٠/٢٧ أو ٢٧/١٠/٢٠٢٦).',
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
      description:
        'مربع الإحاطة الواسع الذي يغطي كامل التاريخ المكتوب من النقطتين (:) يميناً وحتى نهاية السنة يساراً بهامش أمان مريح دون قص أي خانة (0 إلى 1000).',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد أو التاريخ مكتوب بخط اليد.',
    },
  },
  required: [
    'headerFound',
    'issueObservation',
    'digits',
    'beforeColon',
    'issueNumberRaw',
    'issueNumberConfidence',
    'issueNumberBox',
    'dateObservation',
    'dateLeftPart',
    'dateMiddlePart',
    'dateRightPart',
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
    signatureDateHint: {
      type: Type.STRING,
      description:
        'التاريخ أو السنة المطبوعة أسفل التوقيع أو الختم في نهاية الكتاب (مثل ٢٠٢٦/١١ أو ٢٠٢٦/١٠/٢٧)، وإلا سلسلة فارغة.',
    },
    latestBodyYear: {
      type: Type.STRING,
      description:
        'أحدث سنة من 4 أرقام (مثل 2026) مذكورة في نص الكتاب أو المراجع، وإلا سلسلة فارغة.',
    },
  },
  required: ['issuingEntity', 'title', 'recipient', 'subject', 'bodyContent'],
};

const HANDWRITING_RULES = `قواعد صارمة لقراءة خط اليد في حقلَي (العدد :) و(التاريخ :) في الكتب الرسمية العراقية والعربية:
1. ركّز حصراً على القيمة الكاملة المكتوبة بجانب كلمتَي (العدد :) و(التاريخ :) في الترويسة. تجاهل أرقام الهواتف وصندوق البريد وتواريخ الأختام والتواقيع أسفل الصفحة.
2. عدم القص أو البتر إطلاقاً:
   - امسح السطر بأكمله بدءاً من يسار النقطتين (:) وحتى نهاية الخط المنقط أو المساحة الفارغة يساراً، فبعض الأرقام تكون متباعدة أو ذات حبر رمادي خفيف أو تلامس النقطتين (:).
   - إذا احتوى العدد على أكثر من جزء بالخط اليدوي (مثل أرقام وحروف عربية وشرطات مائلة: م/٤/١٢٨٥ أو ٦٤٨٨ أو ٥٨/ص) فاقرأه كاملاً دون اقتصار على جزء واحد أو إسقاط الرقم الأيمن والأيسر.
3. النماذج شبه المطبوعة: قد يكون جزء من التاريخ مطبوعاً والباقي بخط اليد (مثل /  / ٢٠٢ + ٦). ادمج المطبوع والمكتوب بالقلم.
4. التمييز الدقيق للأرقام الهندية اليدوية (٠ إلى ٩):
   - (٠) نقطة حبر فقط دون ساق عمودية؛ لا تحوّل الرقم (٢) ذي الساق العمودية الطويلة إلى صفر (فمثلاً ٢٧ فيها ساق طويلة معقوفة لليمين قبل ٧، وليست ٠٧)، ولا تخلط بين الصفر ونقاط السطر المطبوع أسفل الكتابة.
   - (٥) حلقة أو قلب مغلق أجوف واضح الحجم؛ وقد تبدو برأس مسطح أو مائل بالحبر الخفيف.
   - (٢) معقوفة الرأس لليمين (┌) ثم ساق عمودية؛ (٦) معقوفة الرأس لليسار (┐) ثم ساق عمودية.
   - انتبه للرقم الأخير من السنة (مثل ٢٠٢٦): في الخط العراقي السريع قد تُكتب ٦ بشكل قوس/زاوية لليسار مع ذيل أفقي خفيف أو ربط سريع مع ٢، فلا تخلط بين ٦ و٤ أو ٢ في نهاية السنة (٢٠٢٦).
   - (٧) مفتوحة للأعلى (∨)؛ (٨) مفتوحة للأسفل (∧)؛ (٣) أسنان علوية؛ (٤) تعرّج لليمين؛ (٩) حلقة بذيل نازل؛ (١) عمود مفرد، والفاصل (/) خط مائل أطول.
5. للأرقام الغربية اليدوية (0-9): دقق بين 0 و6 و8 و9، وبين 1 و7 و/، و2 و3 و5، و4 و9.
6. قواعد قراءة التاريخ مكانياً (مهم جداً لمنع عكس اليوم والشهر!):
   - في الكتب الرسمية العربية يُكتب التاريخ غالباً من اليمين لليسار بصيغة: [السنة يساراً] / [الشهر وسطاً] / [اليوم يميناً قرب النقطتين :].
   - سجّل الخانات الثلاث بدقة مكانية كما تراها في الصورة داخل: dateLeftPart (أقصى اليسار)، وdateMiddlePart (الوسط)، وdateRightPart (أقصى اليمين قرب التاريخ :).
   - لاحظ أن الرقم الأوسط (dateMiddlePart) هو الشهر دائماً، فإذا كانت السنة يساراً (مثل ٢٠٢٦ يساراً)، فإن dateRightPart هو اليوم وdateMiddlePart هو الشهر ولا يجوز عكسهما!
7. قواعد العدد (issueNumberRaw) ومربعات الإحاطة:
   - اقرأ كافة الأرقام والحروف والشرطات المائلة بجانب (العدد :) كاملة في issueObservation وdigits وbeforeColon بدون قص أي خانة.
   - اجعل issueNumberBox وdateBox شاملين لكل ما كُتب بجانب النقطتين (:) بهامش مريح يميناً ويساراً.`;

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

  const rawCompact = cleanRaw.replace(/\s+/g, '');
  const joinedCompact = joined.replace(/\s+/g, '');
  const rawHasLettersOrSlash = /[ء-يA-Za-z\/\\-]/.test(cleanRaw);
  const joinedDigitsCount = toWesternDigits(joinedCompact).replace(/\D/g, '').length;
  const rawDigitsCount = toWesternDigits(rawCompact).replace(/\D/g, '').length;

  if (joinedDigitsCount > rawDigitsCount && joinedCompact.length > rawCompact.length) {
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

function resolveDateFromSpatialParts(headerResult: Record<string, any>): {
  dateRaw: string;
  dateNormalized: string;
} {
  const leftRaw = cleanLabelNoise(String(headerResult.dateLeftPart || ''), []);
  const midRaw = cleanLabelNoise(String(headerResult.dateMiddlePart || ''), []);
  const rightRaw = cleanLabelNoise(String(headerResult.dateRightPart || ''), []);

  const L = toWesternDigits(leftRaw).replace(/\D/g, '');
  const M = toWesternDigits(midRaw).replace(/\D/g, '');
  const R = toWesternDigits(rightRaw).replace(/\D/g, '');

  const rawFromModel = cleanLabelNoise(headerResult.dateRaw || '', ['التاريخ', 'Date']);

  if (L && M && R) {
    // Case A: 4-digit Year on LEFT (both Arabic RTL DD/MM/YYYY and ISO YYYY/MM/DD)
    if (L.length === 4 && Number(M) <= 31 && Number(R) <= 31) {
      const mNum = Number(M);
      const rNum = Number(R);
      const [month, day] = mNum > 12 && rNum <= 12 ? [R, M] : [M, R];
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${L}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
      };
    }

    // Case B: 4-digit Year on RIGHT (Western LTR DD/MM/YYYY)
    if (R.length === 4 && Number(M) <= 31 && Number(L) <= 31) {
      const mNum = Number(M);
      const lNum = Number(L);
      const [month, day] = mNum > 12 && lNum <= 12 ? [L, M] : [M, L];
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${R}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
      };
    }

    // Case C: 2-digit Year on LEFT (e.g. 26 / 10 / 27)
    if (
      L.length === 2 &&
      Number(L) >= 20 &&
      Number(M) >= 1 &&
      Number(M) <= 12 &&
      Number(R) >= 1 &&
      Number(R) <= 31
    ) {
      const fullY = Number(L) >= 40 ? `14${L}` : `20${L}`;
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${fullY}/${M.padStart(2, '0')}/${R.padStart(2, '0')}`,
      };
    }

    // Case D: 2-digit Year on RIGHT (e.g. 27 / 10 / 26)
    if (
      R.length === 2 &&
      Number(R) >= 20 &&
      Number(L) >= 1 &&
      Number(L) <= 31 &&
      Number(M) >= 1 &&
      Number(M) <= 12
    ) {
      const fullY = Number(R) >= 40 ? `14${R}` : `20${R}`;
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${fullY}/${M.padStart(2, '0')}/${L.padStart(2, '0')}`,
      };
    }
  }

  const dateRaw = resolveDateRaw(headerResult);
  const dateNormalized = normalizeDateString(
    dateRaw,
    headerResult.dateDay,
    headerResult.dateMonth,
    headerResult.dateYear
  );
  return { dateRaw, dateNormalized };
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      text: `اقرأ حقل (العدد :) وحقل (التاريخ :) كاملاً دون قص أو بتر أي خانة من اليمين أو اليسار. امسح السطر كله من النقطتين (:) يساراً في issueObservation وdigits، وتحقق من الرقم الملاصق للنقطتين في beforeColon، واقرأ التاريخ مكانياً (يسار/وسط/يمين) دون إسقاط الصفر (٠).${hintLine}`,
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

  const primaryLevel =
    precisionMode === 'ultra' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM;

  const attemptPlan: Array<{
    model: string;
    level: ThinkingLevel | null;
    highRes: boolean;
    timeoutMs: number;
    delayBeforeMs: number;
  }> = [
    {
      model: 'gemini-4-hydrogen',
      level: primaryLevel,
      highRes: true,
      timeoutMs: precisionMode === 'ultra' ? 28000 : 22000,
      delayBeforeMs: 0,
    },
    {
      model: 'gemini-3.1-flash-lite',
      level: null,
      highRes: true,
      timeoutMs: 20000,
      delayBeforeMs: 650,
    },
    {
      model: 'gemini-4-hydrogen',
      level: ThinkingLevel.LOW,
      highRes: true,
      timeoutMs: 22000,
      delayBeforeMs: 1400,
    },
    {
      model: 'gemini-3.1-flash-lite',
      level: null,
      highRes: false,
      timeoutMs: 20000,
      delayBeforeMs: 2200,
    },
    {
      model: 'gemini-3.1-flash-lite',
      level: null,
      highRes: false,
      timeoutMs: 22000,
      delayBeforeMs: 3200,
    },
  ];

  let response;
  let lastError: unknown;

  for (let i = 0; i < attemptPlan.length; i++) {
    const step = attemptPlan[i];
    if (step.delayBeforeMs > 0) {
      await sleepMs(step.delayBeforeMs);
    }
    try {
      response = await withTimeout(
        callModel(step.model, step.level, step.highRes),
        step.timeoutMs
      );
      break;
    } catch (err: unknown) {
      lastError = err;
      const msg = (err as { message?: string })?.message || '';
      const status = getApiErrorStatus(err);

      if (msg.includes('PROXY_GENERATION_DISABLED')) {
        if (i < attemptPlan.length - 1) continue;
        throw Object.assign(new Error(msg), { isProxyDisabled: true });
      }
      if (status === 401 || status === 403) {
        throw Object.assign(
          new Error('مفتاح Gemini API غير صالح أو مرفوض. يرجى التحقق من المفتاح المدخل أو مسحه.'),
          { isKeyRejected: true }
        );
      }
      const isRetryable =
        status === 429 ||
        status === 503 ||
        status === 500 ||
        status === 400 ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch') ||
        msg.toLowerCase().includes('network');
      if (!isRetryable || i === attemptPlan.length - 1) {
        if (status === 503 || status === 429) {
          throw new Error(
            'الخدمة مشغولة حالياً بشكل مؤقت، اضغط إعادة المحاولة للمتابعة.'
          );
        }
        throw new Error(
          msg ? `تعذر إكمال التحليل: ${msg}` : 'حدث خطأ أثناء تحليل صورة الكتاب.'
        );
      }
    }
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error('تعذر إكمال التحليل مؤقتاً.');
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
): Promise<BodyExtractFields & { signatureDateHint?: string; latestBodyYear?: string }> {
  const parts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `استخرج الجهة المصدرة والعنوان أو إلى/م ومضمون الكتاب كاملاً، وأي تاريخ مطبوع أسفل التوقيع في signatureDateHint وأحدث سنة في النص في latestBodyYear.${hintLine}`,
    },
  ];

  const parseBody = (rawText: string) => {
    const parsed = rawText ? JSON.parse(rawText) : {};
    return {
      issuingEntity: parsed.issuingEntity || '',
      title: parsed.title || '',
      recipient: parsed.recipient || '',
      subject: parsed.subject || '',
      bodyContent: parsed.bodyContent || '',
      signatureDateHint: parsed.signatureDateHint || '',
      latestBodyYear: parsed.latestBodyYear || '',
    };
  };

  try {
    const response = await callWithRetry(
      () =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: { parts },
            config: {
              systemInstruction: BODY_OCR_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: documentBodySchema,
            },
          }),
          22000
        ),
      1
    );
    return parseBody((response.text ?? '').trim());
  } catch {
    try {
      await sleepMs(800);
      const fallback = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            systemInstruction: BODY_OCR_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: documentBodySchema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        22000
      );
      return parseBody((fallback.text ?? '').trim());
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
  const { dateRaw, dateNormalized } = resolveDateFromSpatialParts(headerResult);

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
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleepMs(1300 * attempt);
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : null;

    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts - 1) {
      continue;
    }

    if (!res.ok || !data || data.error) {
      throw new Error(
        data?.error ||
          'تعذر الاتصال بخدمة التحليل على الخادم. اضغط على أيقونة المفتاح في أسفل يسار الشاشة لإدخال مفتاح Gemini API والعمل مباشرة.'
      );
    }
    return data.result as T;
  }
  throw new Error('تعذر إكمال الطلب مؤقتاً، يرجى المحاولة مجدداً.');
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
