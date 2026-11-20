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

// Dedicated schema strictly for handwritten header numbers (العدد & التاريخ)
const headerHandwritingSchema = {
  type: Type.OBJECT,
  properties: {
    headerFound: {
      type: Type.BOOLEAN,
      description: 'true إذا ظهر حقل العدد أو التاريخ في هذه الصورة، وإلا false.',
    },
    issueCharactersLeftToRight: {
      type: Type.ARRAY,
      description:
        'سرد مرتب تماماً من اليسار إلى اليمين لكل رقم أو حرف أو شرطة مائلة مكتوبة في قيمة العدد (مثال: ["٥","٠","٨","٦"]). افحص بشدة أي نقطة (٠) بين الأرقام وأي رقم طرفي ملاصق للنقطتين (:).',
      items: { type: Type.STRING },
    },
    edgeDigitCheck: {
      type: Type.STRING,
      description:
        'تحقق سريع: هل توجد نقطة (٠) بين الأرقام؟ وهل يوجد رقم في أقصى اليمين ملاصق للنقطتين (:)؟',
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
      description: 'قراءة بديلة محتملة في حال الشك في خانة، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'إحداثيات مربع الإحاطة لقيمة العدد المكتوبة (0 إلى 1000).',
    },
    dateCharactersLeftToRight: {
      type: Type.ARRAY,
      description:
        'سرد مرتب من اليسار إلى اليمين لأرقام وشرطات التاريخ كما كُتب بخط اليد.',
      items: { type: Type.STRING },
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
    'issueCharactersLeftToRight',
    'edgeDigitCheck',
    'issueNumberRaw',
    'issueNumberNormalized',
    'issueNumberConfidence',
    'issueNumberBox',
    'dateCharactersLeftToRight',
    'dateRaw',
    'dateNormalized',
    'dateConfidence',
    'dateBox',
    'calendarType',
    'isHandwrittenDetected',
  ],
};

// Dedicated schema strictly for full-page body, title, recipient, subject, and issuing entity
const documentBodySchema = {
  type: Type.OBJECT,
  properties: {
    issuingEntity: {
      type: Type.STRING,
      description: 'الجهة المصدرة للكتاب إن ظهرت في الترويسة، وإلا سلسلة فارغة.',
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
  },
  required: ['issuingEntity', 'title', 'recipient', 'subject', 'bodyContent'],
};

const HANDWRITING_RULES = `قواعد قراءة الأرقام المكتوبة بخط اليد في الكتب الرسمية بدقة تامة:
1. ابحث فقط عن القيمة المكتوبة في حقل (العدد :) وحقل (التاريخ :) — تجاهل أرقام الهواتف أو رموز النماذج أو أرقام الصفحات في أسفل الصفحة.
2. اتجاه قراءة الأرقام: اقرأ الأرقام داخل كل خانة من اليسار إلى اليمين (الخانة الأولى في أقصى اليسار ثم التي تليها نحو اليمين حتى النقطتين :).
3. لا تسقط أبداً الرقم الملاصق للنقطتين (:) في أقصى اليمين ولا أي رقم فوق الخط المنقط (......) ولا تدمج رقمين متقاربين في رقم واحد.
4. للأرقام الهندية اليدوية (٠١٢٣٤٥٦٧٨٩):
   - (٠): نقطة حبر صغيرة أو دائرة دقيقة بين الأرقام (مثل النقطة في ٥٠٨٦) — إذا وُجدت نقطة حبر في فجوة بين رقمين فهي (٠) وليست غباراً.
   - (٥): دائرة مغلقة أو شكل قلب أكبر وضوحاً من نقطة (٠).
   - (٦) مقابل (٢): الرقم (٦) يتجه رأسه/خطه العلوي إلى اليسار ثم ينزل عمودياً (┐)، بينما (٢) ينحني رأسه إلى اليمين ثم ينزل (┌).
   - (٧) مقابل (٨): الرقم (٧) مفتوح للأعلى (∨)، بينما (٨) مفتوح للأسفل (∧).
   - (٤): تعرّج مزدوج يتجه لليمين؛ (٣): ثلاث أسنان علوية؛ (٩): حلقة علوية مع ذيل نازل؛ (١): خط عمودي مفرد.
   - ميّز بين (١) القصير العمودي وبين الشرطة المائلة الفاصلة (/).
5. للأرقام الغربية اليدوية (0123456789): ميّز بدقة بين 0 و5 و6 و8 و9 و2 و7.
6. صف الخانات خانةً بخانة من اليسار إلى اليمين في issueCharactersLeftToRight ثم اجمعها مطابقة تماماً في issueNumberRaw.`;

const HEADER_OCR_INSTRUCTION = `أنت مدقق بصري متخصص حصرياً في قراءة (العدد) و(التاريخ) المكتوبين بخط اليد من صور الكتب الرسمية العربية.
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `أنت خبير أرشفة لقراءة نص الكتب الرسمية العربية.
- استخرج الجهة المصدرة (issuingEntity) من ترويسة الكتاب.
- استخرج المرسل إليه بعد (إلى /) في recipient، والموضوع بعد (م /) في subject.
- إذا لم يوجد (إلى /) و(م /)، ضع العنوان المركزي مثل (أمر جامعي) أو (أمر إداري) في title.
- انسخ مضمون الكتاب كاملاً بدقة في bodyContent.`;

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

async function runHeaderHandwritingOcr(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  precisionMode: PrecisionMode,
  hintLine: string
) {
  const isUltra = precisionMode === 'ultra';
  const targetThinking = isUltra ? ThinkingLevel.XHIGH : ThinkingLevel.HIGH;

  const parts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `اقرأ فقط حقل (العدد) وحقل (التاريخ) المكتوبين بخط اليد من هذه الصورة، خانةً بخانة من اليسار إلى اليمين، مع تحديد مربعيهما.${hintLine}`,
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
        seed: 42,
        ...(useHighMediaRes
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }
          : {}),
      },
    });

  let response;
  try {
    response = await callModel('gemini-4-hydrogen', targetThinking, true);
  } catch (err: unknown) {
    const errObj = err as { status?: number; code?: number; message?: string };
    const status = errObj?.status || errObj?.code;
    if (status === 400) {
      console.warn('Retrying header OCR without mediaResolution due to 400:', errObj?.message);
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
    throw new Error('لم يُرجع نموذج التحليل بيانات نصية صالحة. يرجى المحاولة بصورة أوضح.');
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
      text: `استخرج الجهة المصدرة والعنوان أو إلى/م ومضمون الكتاب كاملاً بدقة.${hintLine}`,
    },
  ];

  const callModel = (model: string, thinkingLevel: ThinkingLevel) =>
    ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        systemInstruction: BODY_OCR_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: documentBodySchema,
        thinkingConfig: { thinkingLevel },
        seed: 42,
      },
    });

  try {
    const response = await callModel('gemini-4-hydrogen', ThinkingLevel.LOW);
    const rawText = (response.text ?? '').trim();
    return rawText ? JSON.parse(rawText) : {};
  } catch (err: unknown) {
    const errObj = err as { status?: number; code?: number };
    const status = errObj?.status || errObj?.code;
    if (status === 429 || status === 503) {
      const response = await callWithRetry(
        () => callModel('gemini-3.1-flash-lite', ThinkingLevel.LOW),
        1
      );
      const rawText = (response.text ?? '').trim();
      return rawText ? JSON.parse(rawText) : {};
    }
    return {};
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

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
      const headerMimeType = body.headerMimeType || 'image/png';

      const precisionMode: PrecisionMode =
        body.precisionMode === 'ultra' ? 'ultra' : 'standard';
      const hintLine =
        body.hintText && body.hintText.trim().length > 0
          ? ` تلميح: ${body.hintText.trim()}`
          : '';

      if (cleanHeaderBase64) {
        // Full-page mode: run dedicated crisp header handwriting OCR + body OCR in parallel
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

        // Fallback to full page if the letter puts العدد/التاريخ outside the top-right crop
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

        const issueRaw = headerResult.issueNumberRaw || '';
        const dateRaw = headerResult.dateRaw || '';

        res.json({
          result: {
            issueNumberRaw: issueRaw,
            issueNumberNormalized: toWesternDigits(
              headerResult.issueNumberNormalized || issueRaw
            ),
            issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
            alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
            issueNumberBox: headerResult.issueNumberBox || null,
            dateRaw,
            dateNormalized: normalizeDateString(
              headerResult.dateNormalized || dateRaw
            ),
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
          },
        });
        return;
      }

      // Cropped region mode (top-right only or user-drawn canvas box)
      const headerResult = await runHeaderHandwritingOcr(
        ai,
        cleanFullBase64,
        fullMimeType,
        precisionMode,
        hintLine
      );

      const issueRaw = headerResult.issueNumberRaw || '';
      const dateRaw = headerResult.dateRaw || '';

      res.json({
        result: {
          issueNumberRaw: issueRaw,
          issueNumberNormalized: toWesternDigits(
            headerResult.issueNumberNormalized || issueRaw
          ),
          issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
          alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
          issueNumberBox: headerResult.issueNumberBox || null,
          dateRaw,
          dateNormalized: normalizeDateString(
            headerResult.dateNormalized || dateRaw
          ),
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
