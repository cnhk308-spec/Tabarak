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
  enhancedImageBase64?: string;
  enhancedMimeType?: string;
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
        'مسح بصري كامل للسطر بجانب (العدد :) من علامة النقطتين (:) يساراً ثم من اليسار لليمين، مع التحقق من الخانة الملاصقة ليسار (:) مثل (٦) في (٥٠٨٦) وعدم إسقاطها لتصبح (٥٠٨) وعدم دمج (٨٦) في (٣).',
    },
    digits: {
      type: Type.ARRAY,
      description:
        'تحليل كافة خانات حقل (العدد :) خانةً بخانة من اليسار لليمين (كل رقم أو حرف أو شرطة مائلة /). امسح المساحة الكاملة بجانب (العدد :) حتى النقطتين (:) ولا تسقط الخانة الأخيرة يميناً (مثل ٦ في ٥٠٨٦ -> ٥٠٨) ولا تسقط (٠) أو (٨) ولا تدمج (٨٦) في (٣).',
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
              'وصف شكل الضربة بإيجاز (مثل: نقطة، حلقة، رأس مدبب ∧ لـ ٨، قوس لليسار ┐ لـ ٦، رأس لليمين، للأعلى، للأسفل، ذيل، تعرج، شرطة، حرف).',
          },
        },
        required: ['c', 'k'],
      },
    },
    beforeColon: {
      type: Type.STRING,
      description:
        'أول رقم أو حرف مكتوب في أقصى اليمين بجانب (العدد :) مباشرة أو فوق طرف الخط المنقط الأيمن — افحص يمين العدد جيداً حتى لا تسقط الخانة الأخيرة مثل (٦) في (٥٠٨٦).',
    },
    issueNumberRaw: {
      type: Type.STRING,
      description: 'العدد كاملاً بكل خاناته وحروفه وشرطاته كما كُتب بخط اليد بجانب (العدد :) دون قص أو دمج أو حذف أي خانة.',
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
        'ملاحظة بصرية دقيقة: صف الخانات الثلاث مكانياً (أقصى اليسار، الوسط، أقصى اليمين). تأكد لكل رقم في اليوم والشهر: هل رأسه دائرة/حلقة مغلقة أو شبه مغلقة بساق واحدة نازلة فهو (٩)، أم رأس مدبب مفتوح للأسفل (∧) بدون حلقة فهو (٨)، أم خطان منفصلان (١١)؟ وصف آخر رقم في السنة يميناً.',
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
        'الجزء الموجود في أقصى اليمين الأقرب لكلمة (التاريخ :) كما يظهر مكانياً في الصورة (غالباً اليوم مثل ٢٧ أو ٩).',
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

const HANDWRITING_RULES = `قواعد صارمة لقراءة خط اليد في حقلَي (العدد :) و(التاريخ :) في الكتب الرسمية العراقية والعربية:
1. ركّز على كامل الجزء الأعلى الأيمن من الكتاب، واستخرج القيمة الكاملة المكتوبة بجانب كلمتَي (العدد :) و(التاريخ :) في الترويسة. تجاهل أرقام الهواتف وصندوق البريد وتواريخ الأختام والتواقيع أسفل الصفحة.
2. عدم القص أو الدمج أو إسقاط أي خانة (يميناً أو وسطاً أو مكررة) إطلاقاً:
   - امسح السطر بأكمله بدءاً من يسار النقطتين (:) وحتى نهاية الخط المنقط أو المساحة الفارغة يساراً، وافحص يمين العدد القريب من (:) جيداً فقد تكون الخانة الأخيرة خفيفة أو مائلة فوق الخط المنقط.
   - في (٥٠٨٦) تأكد من كل الخانات الأربع: (٥) ثم نقطة (٠) ثم رأس مدبب (٨ ∧) ثم قوس معقوف لليسار بساق نازلة قرب النقطتين (٦ ┐)؛ فلا تسقط الرقم الأخير (٦) القريب من (:) لتقرأها (٥٠٨)، ولا تسقط (٨) لتقرأها (٥٠٦)، ولا تدمج (٨) و(٦) في (٣) لتقرأها (٥٠٣) — القراءة الصحيحة هي كل الخانات الأربع (٥٠٨٦)!
   - إذا تكرر نفس الرقم مرتين متجاورتين فلا تدمجهما في رقم واحد! مثلاً (٦٤٨٨) فيها ثمانيتان متجاورتان (∧∧ = 4 سيقان مائلة)، وليست (٦٤٨).
   - إذا احتوى العدد على أكثر من جزء بالخط اليدوي (مثل م/٤/١٢٨٥ أو ٦٤٨٨ أو ٥٠٨٦) فاقرأه كاملاً بكل خاناته.
3. النماذج شبه المطبوعة: قد يكون جزء من التاريخ مطبوعاً والباقي بخط اليد (مثل /  / ٢٠٢ + ٦). ادمج المطبوع والمكتوب بالقلم.
4. التمييز الدقيق للأرقام الهندية اليدوية (٠ إلى ٩):
   - التمييز الحاسم بين (٩) و(٨):
     * الرقم (٩) له رأس دائري أو حلقة مغلقة/شبه مغلقة في الأعلى مع ساق واحدة نازلة (مثل حرف «و» بدون ذيل أو الرقم 9)، حتى لو كُتب بسرعة وبقيت فتحة طفيفة أسفل الحلقة؛ لا تقرأه أبداً كـ (٨)!
     * الرقم (٨) عبارة عن رأس مدبب واحد فقط مفتوح تماماً للأسفل بساقين متباعدتين (∧) دون أي حلقة أو انحناء علوي دائري. تأكد لكل خانة في اليوم والشهر (مثلاً ٩/٩ ليست ٨/٨ أو ٨/٩).
   - (١١) عبارة عن خطين عموديين أو مائلين متوازيين منفصلين (|| أو //) لهما رأسان في الأعلى؛ لا تدمجهما أبداً في رقم (٨).
   - (٠) نقطة حبر فقط دون ساق عمودية؛ لا تحوّل الرقم (٢) ذي الساق العمودية الطويلة إلى صفر (فمثلاً ٢٧ فيها ساق طويلة معقوفة لليمين قبل ٧، وليست ٠٧).
   - (٥) حلقة أو قلب مغلق أجوف واضح الحجم؛ وقد تبدو برأس مسطح أو مائل بالحبر الخفيف.
   - (٢) معقوفة الرأس لليمين (┌) ثم ساق عمودية؛ (٦) معقوفة الرأس لليسار (┐) ثم ساق عمودية نازلة.
   - تمييز الرقم (٦) في نهاية السنة (٢٠٢٦) عن (٤) و(٨) و(٩):
     * لا تستبدل السنة (٢٠٢٦) بـ (٢٠٢٤) أو (٢٠٢٨) أو (٢٠٢٩)! الرقم (٦) له رأس أفقي أو قوس واحد متجه لليسار ثم ساق نازلة مباشرة (┐)، حتى لو انعكف طرفه قليلاً على السطر المنقط، بينما الرقم (٤) له تعرجات حادة لليمين.
   - (٧) مفتوحة للأعلى (∨)؛ (٣) ثلاث أسنان علوية واضحة بساق واحدة؛ (٤) تعرّج واضح لليمين؛ (١) عمود مفرد، والفاصل (/) خط مائل أطول يمتد أعلى وأسفل الأرقام.
5. للأرقام الغربية اليدوية (0-9): دقق بين 6 و8 و9 و0 و4 و3، ولا تقرأ 5086 كـ 503 أو 506، ولا 9 كـ 8، ولا 2026 كـ 2024 أبداً.
6. قواعد قراءة التاريخ مكانياً (مهم جداً لمنع عكس اليوم والشهر!):
   - في الكتب الرسمية العربية يُكتب التاريخ غالباً من اليمين لليسار بصيغة: [السنة يساراً] / [الشهر وسطاً] / [اليوم يميناً قرب النقطتين :].
   - سجّل الخانات الثلاث بدقة مكانية كما تراها في الصورة داخل: dateLeftPart (أقصى اليسار)، وdateMiddlePart (الوسط)، وdateRightPart (أقصى اليمين قرب التاريخ :).
   - لاحظ أن الرقم الأوسط (dateMiddlePart) هو الشهر دائماً، فإذا كانت السنة يساراً (مثل ٢٠٢٦ يساراً)، فإن dateRightPart هو اليوم وdateMiddlePart هو الشهر ولا يجوز عكسهما!
7. قواعد العدد (issueNumberRaw):
   - اقرأ كافة الأرقام والحروف والشرطات المائلة بجانب (العدد :) كاملة في issueObservation وdigits وbeforeColon بدون قص أو دمج أي خانة.`;

const HEADER_OCR_INSTRUCTION = `أنت خبير تدقيق بصري متخصص في قراءة خط اليد العربي والهندي والغربي في ترويسات الكتب الرسمية (حقل العدد وحقل التاريخ) بدقة بالغة دون تخمين.
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

  const L = toWesternDigits(leftRaw).replace(/\D/g, '');
  const M = toWesternDigits(midRaw).replace(/\D/g, '');
  const R = toWesternDigits(rightRaw).replace(/\D/g, '');

  if (L && M && R) {
    if (L.length === 4 && Number(M) <= 31 && Number(R) <= 31) {
      const mNum = Number(M);
      const rNum = Number(R);
      const [month, day] = mNum > 12 && rNum <= 12 ? [R, M] : [M, R];
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${L}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
      };
    }

    if (R.length === 4 && Number(M) <= 31 && Number(L) <= 31) {
      const mNum = Number(M);
      const lNum = Number(L);
      const [month, day] = mNum > 12 && lNum <= 12 ? [L, M] : [M, L];
      return {
        dateRaw: `${leftRaw}/${midRaw}/${rightRaw}`,
        dateNormalized: `${R}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`,
      };
    }

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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHeaderHandwritingOcr(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  precisionMode: PrecisionMode,
  hintLine: string,
  enhancedImageBase64?: string,
  enhancedMimeType?: string
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
    }اقرأ حقل (العدد :) وحقل (التاريخ :) كاملاً من الجزء الأعلى الأيمن دون قص أو بتر أو دمج أي خانة. تحقق مرتين من اليمين إلى اليسار ثم من اليسار إلى اليمين أنك لم تسقط الخانة اليمنى القريبة من (العدد :) (مثل ٦ في ٥٠٨٦ -> ٥٠٨) ولم تدمج (٨٦) في (٣) (مثل ٥٠٨٦ -> ٥٠٣)، وميّز (٩) ذات الحلقة العلوية عن (٨ ∧)، واقرأ التاريخ مكانياً (يسار/وسط/يمين) دون إسقاط الصفر (٠).${hintLine}`,
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
      model: 'gemini-4-hydrogen',
      level: ThinkingLevel.LOW,
      highRes: true,
      timeoutMs: 22000,
      delayBeforeMs: 700,
    },
    {
      model: 'gemini-3.1-flash-lite',
      level: null,
      highRes: true,
      timeoutMs: 20000,
      delayBeforeMs: 1200,
    },
    {
      model: 'gemini-4-hydrogen',
      level: ThinkingLevel.LOW,
      highRes: false,
      timeoutMs: 22000,
      delayBeforeMs: 1800,
    },
    {
      model: 'gemini-3.1-flash-lite',
      level: null,
      highRes: false,
      timeoutMs: 22000,
      delayBeforeMs: 2600,
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
      const status = getApiErrorStatus(err);
      const msg = (err as { message?: string })?.message || '';
      const isRetryable =
        status === 429 ||
        status === 503 ||
        status === 500 ||
        status === 400 ||
        msg.toLowerCase().includes('timeout');
      if (!isRetryable || i === attemptPlan.length - 1) {
        throw err;
      }
    }
  }

  if (!response) {
    throw lastError;
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
      text: `استخرج الجهة المصدرة والعنوان أو إلى/م ومضمون الكتاب كاملاً، وأي تاريخ مطبوع أسفل التوقيع في signatureDateHint وأحدث سنة في النص في latestBodyYear.${hintLine}`,
    },
  ];

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
    const rawText = (response.text ?? '').trim();
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    try {
      await sleepMs(800);
      const fallbackResponse = await withTimeout(
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
  const { dateRaw, dateNormalized } = resolveDateFromSpatialParts(headerResult);

  return {
    issueNumberRaw: issueRaw,
    issueNumberNormalized: toWesternDigits(issueRaw),
    issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
    alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
    issueNumberBox: null,
    dateRaw,
    dateNormalized,
    dateConfidence: headerResult.dateConfidence || 'medium',
    alternativeDate: headerResult.alternativeDate || '',
    dateBox: null,
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
        hintLine,
        body.enhancedImageBase64
          ? stripDataUrlPrefix(body.enhancedImageBase64)
          : undefined,
        body.enhancedMimeType
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
          signatureDateHint: bodyResult.signatureDateHint || '',
          latestBodyYear: bodyResult.latestBodyYear || '',
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
