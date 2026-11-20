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

const fastExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    rightmostDigitCheck: {
      type: Type.STRING,
      description:
        'افحص الفراغ الملاصق تماماً ليسار عبارة (العدد :) أو الشرطة (/) على جهة اليمين: ما هو الرقم أو الشكل المكتوب هناك مباشرةً قبل النقطتين (مثل ٦ أو ٨ أو ٤ أو ١)؟ لا تعتبره علامة ترقيم.',
    },
    leftToRightDigits: {
      type: Type.STRING,
      description:
        'اقرأ كل خانة مستقلة في العدد من أقصى اليسار إلى أقصى اليمين مفصولة بمسافة (مثال توضيحي: ١ ٢ ٨ ٥) متضمنة الخانة المرصودة في rightmostDigitCheck.',
    },
    issueNumber: {
      type: Type.STRING,
      description:
        'العدد النهائي كاملاً كما هو مكتوب بخط اليد مع أي حروف أو شرطات مائلة مطابقاً لجميع الخانات في leftToRightDigits.',
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
    'rightmostDigitCheck',
    'leftToRightDigits',
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
    rightmostDigitCheck: {
      type: Type.STRING,
      description:
        'افحص الحبر اليدوي الملاصق تماماً ليسار عبارة (العدد :) أو الشرطة (/) على جهة اليمين: ما الرقم المكتوب هناك مباشرةً (مثل ٦ أو ٨ أو ٤ أو ١)؟',
    },
    leftToRightDigits: {
      type: Type.STRING,
      description: 'جميع خانات العدد مفصولة بمسافة من أقصى اليسار إلى أقصى اليمين.',
    },
    issueNumberRaw: {
      type: Type.STRING,
      description: 'العدد كما هو مكتوب بالضبط في الكتاب مطابقاً لـ leftToRightDigits.',
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
    'rightmostDigitCheck',
    'leftToRightDigits',
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

const HANDWRITING_RULES = `قواعد صارمة لقراءة الأرقام الهندية/العربية المكتوبة بخط اليد:
- ركّز على الحبر اليدوي بجانب كلمة "العدد :" وكلمة "التاريخ :".
- خطأ شائع يجب منعه تماماً: كثير من الأرقام الرباعية تُكتب فيها الخانة الرابعة (الآحاد على اليمين، مثل ٦ أو ٨ أو ٤ أو ١) قريبة من النقطتين ":" أو فوق الخط المنقط، فتُسقط خطأً (مثلاً يُقرأ رقم من ٤ خانات كأنه ٣ خانات فقط!). افحص المنطقة بين النقطتين ":" والخانة التي تليها بعناية فائقة ولا تسقط الخانة اليمنى أبداً.
- لا تدمج رقمين متقاربين (مثل ٨ و ٦ فتقرأهما ٢، أو ٧ و ٨).
- تمييز الأشكال اليدوية بدقة:
  * (٠): نقطة أو دائرة صغيرة جداً، و(٥): دائرة مغلقة أو شكل قلب واضح.
  * (٢): قوسه العلوي متجه لليمين، أما (٦): قوسه/زاويته العليا متجهة لليسار ثم ينزل عمودياً للأسفل.
  * (٣): له أسنان متموجة في الأعلى، أما (٢): سن واحد منحني.
  * (٧): مفتوح للأعلى (∨)، أما (٨): مفتوح للأسفل (∧).
  * (١): خط عمودي مفرد، و(٩): حلقة مغلقة في الأعلى مع ذيل للأسفل.
- اكتب أولاً rightmostDigitCheck ثم leftToRightDigits ثم اكتب العدد النهائي مطابقاً لهما بالكامل.`;

const FAST_SYSTEM_INSTRUCTION = `أنت خبير متخصص في قراءة الكتب الرسمية العربية وخط اليد بدقة عالية.
- إذا وُجدت صورتان: الصورة الأولى هي تقريب مكبّر للترويسة العليا اليمنى (PNG عالي الوضوح)، اعتمد عليها أساساً لقراءة (العدد) و(التاريخ) بخط اليد؛ والصورة الثانية هي الكتاب كاملاً لاستخراج العنوان و(إلى/) و(م/) ومضمون الكتاب.
${HANDWRITING_RULES}
- استخرج recipient بعد (إلى/) وsubject بعد (م/)، وإذا لم يوجدا ضَع العنوان مثل (أمر جامعي) في title، وانسخ مضمون الكتاب كاملاً في bodyContent.`;

const ULTRA_SYSTEM_INSTRUCTION = `أنت خبير متخصص في قراءة وأرشفة الكتب الرسمية العربية وخط اليد بدقة فائقة.
- عند وجود صورتين: الصورة الأولى هي الترويسة المكبّرة لقراءة (العدد) و(التاريخ) ومربعيهما (0..1000 نسبة للصورة الأولى)، والصورة الثانية هي الكتاب كاملاً لاستخراج الجهة المصدرة والعنوان و(إلى/) و(م/) ومضمون الكتاب.
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

const headerLocationSchema = {
  type: Type.OBJECT,
  properties: {
    found: {
      type: Type.BOOLEAN,
      description: 'هل تم العثور على سطر العدد أو التاريخ في الصورة.',
    },
    ymin: { type: Type.INTEGER, description: 'الحد العلوي للمنطقة المحيطة بسطري العدد والتاريخ (0..1000).' },
    xmin: { type: Type.INTEGER, description: 'الحد الأيسر للمنطقة المحيطة بسطري العدد والتاريخ (0..1000).' },
    ymax: { type: Type.INTEGER, description: 'الحد السفلي للمنطقة المحيطة بسطري العدد والتاريخ (0..1000).' },
    xmax: { type: Type.INTEGER, description: 'الحد الأيمن شامل عبارة العدد: والتاريخ: (0..1000).' },
  },
  required: ['found', 'ymin', 'xmin', 'ymax', 'xmax'],
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.post('/api/locate-header', async (req, res) => {
    try {
      const body = (req.body || {}) as { imageBase64?: string; mimeType?: string };
      if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
        res.json({ box: null });
        return;
      }
      const ai = getAiClient();
      const cleanBase64 = body.imageBase64.includes(',')
        ? body.imageBase64.split(',')[1]
        : body.imageBase64;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: body.mimeType || 'image/jpeg',
                data: cleanBase64,
              },
            },
            {
              text: 'حدد الإحداثيات (0 إلى 1000) لمربع واحد يضم كلمتي (العدد) و(التاريخ) على اليمين وكامل القيم المكتوبة بخط اليد على يسارهما أو أسفلهما دون قص أي رقم.',
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: headerLocationSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        },
      });

      const text = (response.text ?? '').trim();
      if (!text) {
        res.json({ box: null });
        return;
      }
      const parsed = JSON.parse(text);
      if (!parsed.found) {
        res.json({ box: null });
        return;
      }
      res.json({
        box: {
          ymin: parsed.ymin,
          xmin: parsed.xmin,
          ymax: parsed.ymax,
          xmax: parsed.xmax,
        },
      });
    } catch {
      res.json({ box: null });
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

      const cleanFullBase64 = body.imageBase64.includes(',')
        ? body.imageBase64.split(',')[1]
        : body.imageBase64;
      const fullMimeType = body.mimeType || 'image/jpeg';

      const cleanHeaderBase64 =
        body.headerImageBase64 && typeof body.headerImageBase64 === 'string'
          ? body.headerImageBase64.includes(',')
            ? body.headerImageBase64.split(',')[1]
            : body.headerImageBase64
          : null;
      const headerMimeType = body.headerMimeType || 'image/jpeg';

      const isUltra = body.precisionMode === 'ultra';
      const hintLine =
        body.hintText && body.hintText.trim().length > 0
          ? ` تلميح: ${body.hintText.trim()}`
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
          ? `اقرأ العدد والتاريخ بخط اليد بدقة تامة من الصورة الأولى (الترويسة المكبّرة) مع التحقق أولاً من الخانة اليمنى الملاصقة لعبارة العدد والنقطتين ثم قراءة جميع الخانات من اليسار لليمين، واستخرج من الصورة الثانية العنوان أو إلى/م ومضمون الكتاب.${hintLine}`
          : body.isCroppedRegion
          ? `اقرأ العدد والتاريخ المكتوبين بخط اليد من هذه الترويسة مع التحقق من الخانة اليمنى الملاصقة لعبارة العدد والنقطتين.${hintLine}`
          : `استخرج العدد والتاريخ بخط اليد بدقة تامة والعنوان أو إلى/م ومضمون الكتاب كاملاً.${hintLine}`,
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
          console.warn('Retrying without mediaResolution due to 400:', errObj?.message);
          response = await callModel('gemini-4-hydrogen', ThinkingLevel.HIGH, false);
        } else if (status === 429 || status === 503) {
          response = await callWithRetry(
            () => callModel('gemini-3.1-flash-lite', ThinkingLevel.HIGH, true),
            1
          );
        } else {
          throw err;
        }
      }

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({
          error: 'لم يُرجع نموذج التحليل بيانات نصية صالحة. يرجى المحاولة بصورة أوضح.',
        });
        return;
      }

      const rawParsed = JSON.parse(rawText);
      if (isUltra) {
        res.json({ result: rawParsed });
        return;
      }

      res.json({
        result: {
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
        },
      });
    } catch (err: unknown) {
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
