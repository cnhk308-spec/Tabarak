import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';
import {
  ExtractionResult,
  HandwrittenDigitInterpretation,
  PrecisionMode,
} from '../types';

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
  fastPass?: boolean;
  fullImagePromise?: Promise<{ imageBase64: string; mimeType: string }>;
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

const digitInterpretationItemSchema = {
  type: Type.OBJECT,
  properties: {
    c: {
      type: Type.STRING,
      description: 'الرقم أو الحرف أو الشرطة المائلة الواحدة كما كُتبت في الورقة.',
    },
    w: {
      type: Type.STRING,
      description: 'المقابل القياسي باللاتينية (0-9) أو الرمز نفسه.',
    },
    k: {
      type: Type.STRING,
      description:
        'تفسير مختصر واضح لكيفية كتابة هذا الرقم بخط اليد (مثال: حلقة مفرغة، نقطة حبر صغيرة، رأس مدبب مفتوح للأسفل ∧، معقوفة لليسار بساق نازلة ┐، حلقة علوية بساق نازلة، تعرج لليمين).',
    },
  },
  required: ['c', 'w', 'k'],
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
        'مسح بصري موجز للسطر بجانب (العدد :) من (:) يساراً ثم من اليسار لليمين، مع تأكيد الخانة الملاصقة ليسار (:) مثل (٦) في (٥٠٨٦) وعدم إسقاطها.',
    },
    digits: {
      type: Type.ARRAY,
      description:
        'تحليل كافة خانات حقل (العدد :) خانةً بخانة من اليسار لليمين مع تفسير شكل كتابة كل رقم بخط اليد دون إسقاط أي خانة (يميناً أو وسطاً) أو دمج رقمين.',
      items: digitInterpretationItemSchema,
    },
    beforeColon: {
      type: Type.STRING,
      description:
        'أول رقم أو حرف في أقصى اليمين بجانب (العدد :) مباشرة — افحص يمين العدد جيداً حتى لا تسقط الخانة الأخيرة مثل (٦) في (٥٠٨٦).',
    },
    issueNumberRaw: {
      type: Type.STRING,
      description: 'العدد كاملاً بكل خاناته وحروفه وشرطاته كما كُتب بخط اليد بجانب (العدد :).',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة فقط عند وجود احتمال آخر، وإلا سلسلة فارغة.',
    },
    dateObservation: {
      type: Type.STRING,
      description:
        'ملاحظة بصرية موجزة للخانات الثلاث الكاملة (أقصى اليسار، الوسط، أقصى اليمين قرب التاريخ :) مع التأكد من وجود 3 أجزاء صالحة (يوم 1-31، شهر 1-12، سنة 4 أرقام) وعدم إسقاط (١١) أو دمج (٢/١١) في (٠٠٢) وتمييز (٩ مقابل ٨، ٦ في ٢٠٢٦).',
    },
    dateDigits: {
      type: Type.ARRAY,
      description:
        'تفسير كل رقم وشرطة مائلة في حقل (التاريخ :) خانةً بخانة بدءاً من يسار (التاريخ :) وحتى نهاية السنة (مثل ١، ١، /، ٢، /، ٢، ٠، ٢، ٦) مع وصف ضربة القلم لكل رقم وعدم دمج (١١) مع (٢) في (٠٠٢).',
      items: digitInterpretationItemSchema,
    },
    dateLeftPart: {
      type: Type.STRING,
      description:
        'الجزء الموجود في أقصى اليسار من التاريخ كما يظهر مكانياً في الصورة (غالباً السنة مثل ٢٠٢٦ أو اليوم).',
    },
    dateMiddlePart: {
      type: Type.STRING,
      description: 'الجزء الموجود في الوسط بين الفاصلين / (الشهر دائماً 1-12، وليس 0 أو 002).',
    },
    dateRightPart: {
      type: Type.STRING,
      description:
        'الجزء الموجود في أقصى اليمين الأقرب لكلمة (التاريخ :) مباشرة — افحص يمين التاريخ قرب النقطتين جيداً حتى لا تسقط اليوم مثل (١١) أو (11) أو (٩) أو (٢٧).',
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
      description: 'التاريخ كاملاً بصيغة واضحة (مثل ٢٠٢٦/٩/٩ أو ٢٠٢٦/١٠/٢٧).',
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
    'dateObservation',
    'dateDigits',
    'dateLeftPart',
    'dateMiddlePart',
    'dateRightPart',
    'dateDay',
    'dateMonth',
    'dateYear',
    'dateRaw',
    'dateConfidence',
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

const HANDWRITING_RULES = `قواعد صارمة لقراءة خط اليد وتفسير كل رقم في حقلَي (العدد :) و(التاريخ :) في الكتب الرسمية العراقية والعربية:
1. ركّز على كامل الجزء الأعلى الأيمن من الكتاب بجانب (العدد :) و(التاريخ :). تجاهل أرقام الهواتف وتواريخ الأختام والتواقيع أسفل الصفحة.
2. عدم القص أو الدمج أو إسقاط أي خانة (يميناً أو وسطاً أو مكررة):
   - امسح السطر بأكمله بدءاً من يسار النقطتين (:) وحتى نهاية الخط المنقط يساراً، وافحص يمين العدد القريب من (:) جيداً فقد تكون الخانة الأخيرة خفيفة أو مائلة فوق الخط المنقط.
   - في مثل (٥٠٨٦) تأكد من كل الخانات الأربع: (٥) حلقة، (٠) نقطة، (٨ ∧)، ثم (٦ ┐) ملاصقة ليسار (:) — لا تسقط (٦) لتقرأها (٥٠٨)، ولا (٨) لتقرأها (٥٠٦)، ولا تدمج (٨٦) في (٣) لتقرأها (٥٠٣).
   - الرقم المكرر المتجاور (مثل ٦٤٨٨) فيها ثمانيتان (∧∧) وليست واحدة.
3. النماذج شبه المطبوعة: ادمج المطبوع (مثل / / ٢٠٢) مع الرقم المكتوب بالقلم (٦).
4. تشريح وتفسير كتابة الأرقام الهندية اليدوية (٠ إلى ٩):
   - (٠): نقطة حبر دائرية/بيضوية صغيرة مصمتة دون ساق؛ لا تحوّل (٢) ذات الساق الطويلة إلى (٠).
   - (١): خط عمودي مفرد (قد يميل قليلاً)؛ والخطان المتوازيان المنفصلان (١١) يعنيان 11 وليس (٨).
   - (٢): عكفة/رأس متجه لليمين (┌) ثم ساق عمودية نازلة؛ قد يصغر الرأس بالكتابة السريعة لكنه يختلف عن (١) وعن (٦) المعقوفة لليسار.
   - (٣): ثلاث أسنان علوية بساق واحدة نازلة (أو سنّتان مقوستان متصلتان) — لا تخلطها مع (٨٦).
   - (٤): تعرّج حاد من قوسين متجهين لليمين (٤) من الأعلى للأسفل — لا تخلطها مع (٦).
   - (٥): حلقة مغلقة أو قلب مفرغ واضح الحجم أكبر من نقطة الصفر (٠).
   - (٦): قوس علوي متجه لليسار ثم ساق نازلة (┐) — خاصة قرب (:) أو في نهاية (٢٠٢٦) فلا تستبدل (٢٠٢٦) بـ (٢٠٢٤) أو (٢٠٢٨) أو (٢٠٢٩).
   - (٧): زاوية/قوس مفتوح للأعلى (∨).
   - (٨): رأس مدبب واحد مفتوح تماماً للأسفل بساقين متباعدتين (∧) دون أي حلقة علوية.
   - (٩): رأس دائري/حلقة مغلقة أو شبه مغلقة في الأعلى بساق واحدة نازلة (مثل حرف و بلا ذيل) — حتى لو تركت الكتابة السريعة فتحة طفيفة أسفل الحلقة تبقى (٩) وليست (٨).
5. للأرقام الغربية اليدوية (0-9): دقق بين 6 (حلقة سفلية) و9 (حلقة علوية) و8 (حلقتان) و0 و4 و3 و5 و2.
6. تفسير كل رقم: سجّل في digits (للعدد) وdateDigits (للتاريخ) كل خانة مع مقابلها القياسي w وتفسير شكل كتابتها k بإيجاز ووضوح.
7. قواعد التاريخ مكانياً واكتمال الخانات الثلاث (مهم جداً!):
   - يتكون التاريخ الرسمي دائماً من ٣ أجزاء منفصلة بشرطتين مائلتين (/): [يوم 1-31] و[شهر 1-12] و[سنة من 4 أرقام مثل 2026].
   - امسح السطر بالكامل بدءاً من يسار نقطتي (التاريخ :) حتى أقصى اليسار: لا تُسقط اليوم الملاصق لكلمة (التاريخ :) (مثل ١١ أو 11 أو ٩)، ولا تقرأ الشرطتين أو (١١) والخط المنقط كأصفار (٠٠)، ولا تدمج (٢ / ١١) أو (١١ / ٢) لتصبح (٠٠٢ / 002) أبداً! مثلاً: ٢٠٢٦/٢/١١ (أو ١١ / ٢ / ٢٠٢٦) هي ٣ أجزاء: السنة ٢٠٢٦، الشهر ٢، اليوم ١١.
   - لا يجوز أبداً أن يكون الشهر أو اليوم 0 أو 00 أو 002.
   - سجّل الخانات الثلاث مكانياً: dateLeftPart (أقصى اليسار، غالباً السنة) / dateMiddlePart (الوسط، الشهر دائماً) / dateRightPart (أقصى اليمين قرب التاريخ :، غالباً اليوم). لا تعكس اليوم والشهر أبداً.`;

const HEADER_OCR_INSTRUCTION = `أنت خبير تدقيق بصري متخصص في قراءة خط اليد العربي والهندي والغربي وتفسير ضربات القلم لكل رقم في ترويسات الكتب الرسمية بدقة وسرعة.
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بإيجاز ودقة، واقرأ أسفل الصفحة لاستخراج أي تاريخ مطبوع تحت التوقيع في signatureDateHint وأحدث سنة مذكورة في النص أو نسخة منه إلى في latestBodyYear.`;

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

function isValidDatePartNumber(numStr: string, maxVal: number): boolean {
  if (!numStr || numStr.length > 2) return false;
  const n = Number(numStr);
  return Number.isInteger(n) && n >= 1 && n <= maxVal;
}

function isValidMonthDayOrder(first: string, second: string): [string, string] | null {
  if (!isValidDatePartNumber(first, 31) || !isValidDatePartNumber(second, 31)) {
    return null;
  }
  const fNum = Number(first);
  const sNum = Number(second);
  if (fNum > 12 && sNum > 12) return null;
  if (fNum > 12 && sNum <= 12) return [String(sNum), String(fNum)];
  return [String(fNum), String(sNum)];
}

function resolveSpatialTriple(
  leftRaw: string,
  midRaw: string,
  rightRaw: string
): { dateRaw: string; dateNormalized: string } | null {
  const L = toWesternDigits(leftRaw).replace(/\D/g, '');
  const M = toWesternDigits(midRaw).replace(/\D/g, '');
  const R = toWesternDigits(rightRaw).replace(/\D/g, '');

  if (!L || !M || !R) return null;

  // Case A: 4-digit Year on LEFT (Arabic RTL or ISO YYYY/MM/DD)
  if (L.length === 4) {
    const md = isValidMonthDayOrder(M, R);
    if (md) {
      const [month, day] = md;
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${L}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
      };
    }
  }

  // Case B: 4-digit Year on RIGHT (Western LTR DD/MM/YYYY)
  if (R.length === 4) {
    const md = isValidMonthDayOrder(M, L);
    if (md) {
      const [month, day] = md;
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${R}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
      };
    }
  }

  // Case C: 2-digit Year on LEFT (e.g. 26 / 2 / 11)
  if (
    L.length === 2 &&
    Number(L) >= 20 &&
    isValidDatePartNumber(M, 12) &&
    isValidDatePartNumber(R, 31)
  ) {
    const fullY = Number(L) >= 40 ? `14${L}` : `20${L}`;
    return {
      dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
      dateNormalized: `${fullY}/${String(Number(M)).padStart(2, '0')}/${String(Number(R)).padStart(2, '0')}`,
    };
  }

  // Case D: 2-digit Year on RIGHT (e.g. 11 / 2 / 26)
  if (
    R.length === 2 &&
    Number(R) >= 20 &&
    isValidDatePartNumber(L, 31) &&
    isValidDatePartNumber(M, 12)
  ) {
    const fullY = Number(R) >= 40 ? `14${R}` : `20${R}`;
    return {
      dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
      dateNormalized: `${fullY}/${String(Number(M)).padStart(2, '0')}/${String(Number(L)).padStart(2, '0')}`,
    };
  }

  return null;
}

function extractTripleFromDateDigits(
  rawDateDigits: unknown
): { dateRaw: string; dateNormalized: string } | null {
  if (!Array.isArray(rawDateDigits) || rawDateDigits.length === 0) return null;
  const tokens: string[] = [];
  let current = '';
  for (const item of rawDateDigits) {
    if (!item || typeof item !== 'object') continue;
    const ch = String((item as { c?: unknown }).c ?? '').trim();
    if (!ch) continue;
    if (ch === '/' || ch === '-' || ch === '\\') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  if (tokens.length !== 3) return null;

  return resolveSpatialTriple(tokens[0], tokens[1], tokens[2]);
}

function resolveDateFromSpatialParts(headerResult: Record<string, any>): {
  dateRaw: string;
  dateNormalized: string;
} {
  const cleanEdge = (v: unknown) =>
    cleanLabelNoise(String(v || ''), ['التاريخ', 'Date']).replace(
      /^[\/\\\s.،-]+|[\/\\\s.،-]+$/g,
      ''
    );
  const leftRaw = cleanEdge(headerResult.dateLeftPart);
  const midRaw = cleanEdge(headerResult.dateMiddlePart);
  const rightRaw = cleanEdge(headerResult.dateRightPart);

  const fromSpatial = resolveSpatialTriple(leftRaw, midRaw, rightRaw);
  if (fromSpatial) return fromSpatial;

  const fromDigits = extractTripleFromDateDigits(headerResult.dateDigits);
  if (fromDigits) return fromDigits;

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
    if (
      rawParts.length === 3 &&
      rawParts.every((p) => Number(p) >= 1 && (p.length <= 2 || p.length === 4))
    ) {
      return raw;
    }
  }

  if (day && month && year) {
    const dStr = toWesternDigits(day).replace(/\D/g, '');
    const mStr = toWesternDigits(month).replace(/\D/g, '');
    const yStr = toWesternDigits(year).replace(/\D/g, '');
    if (
      isValidDatePartNumber(dStr, 31) &&
      isValidDatePartNumber(mStr, 12) &&
      (yStr.length === 4 || yStr.length === 2)
    ) {
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

    if (c.length === 4) {
      const md = isValidMonthDayOrder(b, a);
      if (md) {
        const [month, day] = md;
        return `${c}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
      }
    }

    if (a.length === 4) {
      const md = isValidMonthDayOrder(b, c);
      if (md) {
        const [month, day] = md;
        return `${a}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
      }
    }

    if (
      c.length === 2 &&
      isValidDatePartNumber(a, 31) &&
      isValidDatePartNumber(b, 31)
    ) {
      const resolvedYear =
        yearHint.length === 4 && yearHint.endsWith(c)
          ? yearHint
          : Number(c) >= 40
          ? `14${c}`
          : `20${c}`;
      const md = isValidMonthDayOrder(b, a);
      if (md) {
        const [month, day] = md;
        return `${resolvedYear}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
      }
    }
  }

  const d = toWesternDigits(dateDay || '').replace(/\D/g, '');
  const m = toWesternDigits(dateMonth || '').replace(/\D/g, '');
  const y = toWesternDigits(dateYear || '').replace(/\D/g, '');
  if (isValidDatePartNumber(d, 31) && isValidDatePartNumber(m, 12) && y) {
    const fullY =
      y.length === 4 ? y : y.length === 2 ? (Number(y) >= 40 ? `14${y}` : `20${y}`) : y;
    if (fullY.length === 4) {
      return `${fullY}/${String(Number(m)).padStart(2, '0')}/${String(Number(d)).padStart(2, '0')}`;
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
  hintLine: string,
  enhancedImageBase64?: string,
  enhancedMimeType?: string,
  fastPass?: boolean
) {
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
  ];
  if (enhancedImageBase64) {
    parts.push({
      inlineData: {
        mimeType: enhancedMimeType || 'image/png',
        data: enhancedImageBase64,
      },
    });
  }
  parts.push({
    text: `${
      enhancedImageBase64
        ? 'الصورة الأولى هي الجزء الأعلى الأيمن من الكتاب بدقته الأصلية، والصورة الثانية هي نفس المنطقة مع إبراز تباين الحبر. قارن الصورتين معاً و'
        : ''
    }اقرأ حقل (العدد :) وحقل (التاريخ :) كاملاً من الجزء الأعلى الأيمن دون قص أو بتر أو دمج أي خانة، وفسّر شكل كتابة كل رقم في digits وdateDigits. تحقق مرتين من اليمين لليسار ثم من اليسار لليمين (لا تسقط ٦ قرب النقطتين مثل ٥٠٨٦->٥٠٨، ولا تدمج ٨٦ في ٣، وميّز ٩ ذات الحلقة عن ٨ ∧، وتأكد من ٦ في ٢٠٢٦).${hintLine}`,
  });

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

  const primaryLevel = fastPass
    ? ThinkingLevel.LOW
    : precisionMode === 'ultra'
    ? ThinkingLevel.HIGH
    : ThinkingLevel.LOW;

  const attemptPlan: Array<{
    model: string;
    level: ThinkingLevel | null;
    highRes: boolean;
    timeoutMs: number;
    delayBeforeMs: number;
  }> = fastPass
    ? [
        {
          model: 'gemini-4-hydrogen',
          level: ThinkingLevel.LOW,
          highRes: true,
          timeoutMs: 9000,
          delayBeforeMs: 0,
        },
        {
          model: 'gemini-3.1-flash-lite',
          level: null,
          highRes: true,
          timeoutMs: 12000,
          delayBeforeMs: 150,
        },
        {
          model: 'gemini-4-hydrogen',
          level: ThinkingLevel.LOW,
          highRes: false,
          timeoutMs: 15000,
          delayBeforeMs: 500,
        },
      ]
    : [
        {
          model: 'gemini-4-hydrogen',
          level: primaryLevel,
          highRes: true,
          timeoutMs: precisionMode === 'ultra' ? 28000 : 14000,
          delayBeforeMs: 0,
        },
        {
          model: 'gemini-4-hydrogen',
          level: ThinkingLevel.LOW,
          highRes: true,
          timeoutMs: 18000,
          delayBeforeMs: 500,
        },
        {
          model: 'gemini-3.1-flash-lite',
          level: null,
          highRes: true,
          timeoutMs: 18000,
          delayBeforeMs: 900,
        },
        {
          model: 'gemini-4-hydrogen',
          level: ThinkingLevel.LOW,
          highRes: false,
          timeoutMs: 20000,
          delayBeforeMs: 1400,
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
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
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

function mapDigitInterpretations(rawDigits: unknown): HandwrittenDigitInterpretation[] {
  if (!Array.isArray(rawDigits)) return [];
  const items: HandwrittenDigitInterpretation[] = [];
  for (const entry of rawDigits) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as { c?: unknown; char?: unknown; w?: unknown; k?: unknown };
    const char = String(obj.c ?? obj.char ?? '')
      .replace(/^[:：]+|[:：]+$/g, '')
      .trim();
    if (!char || char.length > 6) continue;
    const western = String(obj.w ?? '').trim() || toWesternDigits(char);
    const explanation = String(obj.k ?? '').trim();
    items.push({ char, western, explanation });
  }
  return items;
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
  const issueDigits = mapDigitInterpretations(headerResult.digits);
  const dateDigits = mapDigitInterpretations(headerResult.dateDigits);
  const notes = [headerResult.issueObservation, headerResult.dateObservation]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' | ');

  return {
    issueNumberRaw: issueRaw,
    issueNumberNormalized: toWesternDigits(issueRaw),
    issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
    alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
    issueNumberBox: null,
    issueDigits,
    dateRaw,
    dateNormalized,
    dateConfidence: headerResult.dateConfidence || 'medium',
    alternativeDate: headerResult.alternativeDate || '',
    dateBox: null,
    dateDigits,
    boxReferenceImage,
    calendarType: resolveCalendarType(headerResult.calendarType, dateNormalized),
    issuingEntity: '',
    title: '',
    recipient: '',
    subject: '',
    bodyContent: '',
    handwritingNotes: notes || undefined,
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
      fastPass: params.fastPass,
      hintText: params.hintText,
    });
    callbacks?.onHeaderReady?.(headerOnly);
    return headerOnly;
  }

  const resolveFullPayload = async () =>
    params.fullImagePromise
      ? await params.fullImagePromise
      : { imageBase64: params.imageBase64, mimeType: params.mimeType };

  // Start header OCR immediately without waiting for full-image compression or sending fullImageBase64 twice
  const headerPromise = (async () => {
    let headerRes = await postJson<ExtractionResult>('/api/extract-header', {
      headerImageBase64: params.headerImageBase64,
      headerMimeType: params.headerMimeType,
      precisionMode: params.precisionMode,
      fastPass: params.fastPass,
      hintText: params.hintText,
    });

    if (!headerRes.issueNumberRaw?.trim() && !headerRes.dateRaw?.trim()) {
      const fullPayload = await resolveFullPayload();
      headerRes = await postJson<ExtractionResult>('/api/extract-header', {
        headerImageBase64: fullPayload.imageBase64,
        headerMimeType: fullPayload.mimeType,
        precisionMode: params.precisionMode,
        fastPass: params.fastPass,
        hintText: params.hintText,
      });
      headerRes = { ...headerRes, boxReferenceImage: 'full_image' };
    }

    callbacks?.onHeaderReady?.(headerRes);
    return headerRes;
  })();

  const bodyPromise = resolveFullPayload()
    .then((fullPayload) =>
      postJson<BodyExtractFields>('/api/extract-body', {
        imageBase64: fullPayload.imageBase64,
        mimeType: fullPayload.mimeType,
        hintText: params.hintText,
      })
    )
    .catch(
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
    enhancedImageBase64?: string;
    enhancedMimeType?: string;
    precisionMode: PrecisionMode;
    fastPass?: boolean;
    hintText?: string;
  },
  customApiKey?: string
): Promise<ExtractionResult> {
  const trimmedKey = (customApiKey || '').trim();
  if (!trimmedKey) {
    return postJson<ExtractionResult>('/api/extract-header', {
      headerImageBase64: params.imageBase64,
      headerMimeType: params.mimeType,
      enhancedImageBase64: params.enhancedImageBase64,
      enhancedMimeType: params.enhancedMimeType,
      precisionMode: params.precisionMode,
      fastPass: params.fastPass,
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
      params.mimeType || 'image/png',
      params.precisionMode,
      hintLine,
      params.enhancedImageBase64
        ? stripDataUrlPrefix(params.enhancedImageBase64)
        : undefined,
      params.enhancedMimeType,
      params.fastPass
    );
    return buildHeaderExtractionResult(raw, 'header_crop');
  } catch (err: unknown) {
    const e = err as { isProxyDisabled?: boolean; isKeyRejected?: boolean };
    if (e?.isProxyDisabled || e?.isKeyRejected) {
      return postJson<ExtractionResult>('/api/extract-header', {
        headerImageBase64: params.imageBase64,
        headerMimeType: params.mimeType,
        enhancedImageBase64: params.enhancedImageBase64,
        enhancedMimeType: params.enhancedMimeType,
        precisionMode: params.precisionMode,
        fastPass: params.fastPass,
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
  const hintLine =
    params.hintText && params.hintText.trim().length > 0
      ? ` تلميح: ${params.hintText.trim()}`
      : '';
  const hasSeparateHeader = Boolean(params.headerImageBase64);

  const resolveFullPayload = async () => {
    const payload = params.fullImagePromise
      ? await params.fullImagePromise
      : { imageBase64: params.imageBase64, mimeType: params.mimeType };
    return {
      cleanBase64: stripDataUrlPrefix(payload.imageBase64),
      mimeType: payload.mimeType || 'image/jpeg',
    };
  };

  try {
    if (!hasSeparateHeader) {
      const fullPayload = await resolveFullPayload();
      const rawHeader = await runHeaderHandwritingOcrBrowser(
        ai,
        fullPayload.cleanBase64,
        fullPayload.mimeType,
        params.precisionMode,
        hintLine,
        undefined,
        undefined,
        params.fastPass
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
        hintLine,
        undefined,
        undefined,
        params.fastPass
      );
      let boxReferenceImage: 'header_crop' | 'full_image' = 'header_crop';

      if (
        !rawHeader.headerFound ||
        (!rawHeader.issueNumberRaw?.trim() && !rawHeader.dateRaw?.trim())
      ) {
        const fullPayload = await resolveFullPayload();
        rawHeader = await runHeaderHandwritingOcrBrowser(
          ai,
          fullPayload.cleanBase64,
          fullPayload.mimeType,
          params.precisionMode,
          hintLine,
          undefined,
          undefined,
          params.fastPass
        );
        boxReferenceImage = 'full_image';
      }

      const headerRes = buildHeaderExtractionResult(rawHeader, boxReferenceImage);
      callbacks?.onHeaderReady?.(headerRes);
      return headerRes;
    })();

    const bodyPromise = resolveFullPayload().then((fullPayload) =>
      runBodyOcrBrowser(ai, fullPayload.cleanBase64, fullPayload.mimeType, hintLine)
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
