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

// Ultra-fast single-pass schema for standard mode
const fastExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    digitsLtr: {
      type: Type.ARRAY,
      description:
        'كل رقم أو حرف أو شرطة في حقل (العدد :) مرتباً من اليسار إلى اليمين حتى النقطتين (:) بدون إسقاط الرقم الأخير الملاصق لـ (:) أو النقطة (٠)، مثال: ["٥","٠","٨","٦"].',
      items: { type: Type.STRING },
    },
    issueNumber: {
      type: Type.STRING,
      description: 'العدد الكامل مطابقاً تماماً لتسلسل digitsLtr.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة إن وجد غموض، وإلا سلسلة فارغة.',
    },
    date: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط في حقل (التاريخ :).',
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
      description: 'مضمون الكتاب كاملاً، وإلا سلسلة فارغة.',
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
    'digitsLtr',
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

// Fast cropped-only schema when scanRegion === 'top-right' or manual box
const fastHeaderOnlySchema = {
  type: Type.OBJECT,
  properties: {
    digitsLtr: {
      type: Type.ARRAY,
      description:
        'كل رقم أو حرف أو شرطة في حقل (العدد :) من اليسار إلى اليمين حتى النقطتين (:) بدون إسقاط الرقم الأخير الملاصق لـ (:) أو النقطة (٠).',
      items: { type: Type.STRING },
    },
    issueNumber: {
      type: Type.STRING,
      description: 'العدد الكامل مطابقاً تماماً لتسلسل digitsLtr.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة إن وجد غموض، وإلا سلسلة فارغة.',
    },
    date: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط في حقل (التاريخ :).',
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
  required: ['digitsLtr', 'issueNumber', 'date', 'confidence', 'calendar'],
};

// High-precision schema for ultra mode
const headerHandwritingSchema = {
  type: Type.OBJECT,
  properties: {
    headerFound: {
      type: Type.BOOLEAN,
      description: 'true إذا ظهر حقل العدد أو التاريخ في هذه الصورة، وإلا false.',
    },
    colonEdgeInspection: {
      type: Type.STRING,
      description:
        'افحص الفراغ الملاصق تماماً ليسار النقطتين (:) في (العدد :): هل يوجد رقم أخير (مثل ٦ أو ٢ أو ٥ أو ٨) أو نقطة (٠) وسط الأرقام؟',
    },
    issueCharactersLeftToRight: {
      type: Type.ARRAY,
      description:
        'سرد مرتب من اليسار إلى اليمين لكل رقم أو حرف أو شرطة مائلة في قيمة العدد.',
      items: { type: Type.STRING },
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
      description: 'قراءة بديلة محتملة، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'إحداثيات مربع الإحاطة لقيمة العدد المكتوبة (0 إلى 1000).',
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
    'colonEdgeInspection',
    'issueCharactersLeftToRight',
    'issueNumberRaw',
    'issueNumberNormalized',
    'issueNumberConfidence',
    'issueNumberBox',
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

const HANDWRITING_RULES = `قواعد قراءة الأرقام المكتوبة بخط اليد في الكتب الرسمية:
- اقرأ قيمة (العدد :) من اليسار إلى اليمين حتى تلامس النقطتين (:) — لا تسقط الرقم الأخير الملاصق لـ (:) أبداً (مثل قراءة ٥٠٨٦ كـ ٥٠٨).
- النقطة الصغيرة بين رقمين هي (٠) وليست فراغاً.
- (٦) يتجه رأسه لليسار ثم ينزل (┐)، و(٢) يتجه رأسه لليمين ثم ينزل (┌)، و(٧) مفتوح للأعلى (∨)، و(٨) مفتوح للأسفل (∧)، و(٥) حلقة مغلقة.
- اكتب الخانات من اليسار لليمين في digitsLtr أولاً ثم انقلها كاملة بدون نقص.`;

const FAST_SYSTEM_INSTRUCTION = `أنت خبير سريع ودقيق لقراءة الكتب الرسمية العربية وخط اليد.
- إذا وُجدت صورتان: الأولى ترويسة مكبّرة لقراءة (العدد) و(التاريخ)، والثانية الصفحة الكاملة لاستخراج العنوان أو إلى/م ومضمون الكتاب.
${HANDWRITING_RULES}`;

const HEADER_OCR_INSTRUCTION = `أنت مدقق بصري متخصص حصرياً في قراءة (العدد) و(التاريخ) المكتوبين بخط اليد من صور الكتب الرسمية العربية.
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بدقة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

function resolveIssueNumber(rawIssue: string, tokens?: unknown): string {
  const cleanRaw = (rawIssue || '').trim();
  if (!Array.isArray(tokens) || tokens.length === 0) return cleanRaw;
  const cleanTokens = tokens
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0 && t.length <= 2);
  if (cleanTokens.length === 0) return cleanRaw;
  const joined = cleanTokens.join('');
  if (!cleanRaw) return joined;
  // Recover truncated trailing digit if token-by-token scan captured all digits
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
      text: `اقرأ حقل (العدد) وحقل (التاريخ) المكتوبين بخط اليد من اليسار لليمين دون إسقاط أي رقم ملاصق للنقطتين (:).${hintLine}`,
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
        ...(useHighMediaRes
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }
          : {}),
      },
    });

  let response;
  try {
    response = await callModel('gemini-4-hydrogen', ThinkingLevel.HIGH, true);
  } catch (err: unknown) {
    const errObj = err as { status?: number; code?: number };
    const status = errObj?.status || errObj?.code;
    if (status === 400) {
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
      const headerMimeType = body.headerMimeType || 'image/jpeg';

      const isUltra = body.precisionMode === 'ultra';
      const hintLine =
        body.hintText && body.hintText.trim().length > 0
          ? ` تلميح: ${body.hintText.trim()}`
          : '';

      if (!isUltra) {
        // FAST STANDARD MODE: single low-thinking call on compact images
        const parts: Array<
          { inlineData: { mimeType: string; data: string } } | { text: string }
        > = [];

        if (cleanHeaderBase64) {
          parts.push({
            inlineData: { mimeType: headerMimeType, data: cleanHeaderBase64 },
          });
        }
        parts.push({
          inlineData: { mimeType: fullMimeType, data: cleanFullBase64 },
        });
        parts.push({
          text: cleanHeaderBase64
            ? `اقرأ العدد والتاريخ من الترويسة الأولى من اليسار لليمين بدون إسقاط الرقم الملاصق لـ (:)، واستخرج بيانات ومضمون الكتاب من الصورة الثانية.${hintLine}`
            : `اقرأ العدد والتاريخ من اليسار لليمين بدون إسقاط أي رقم ملاصق لـ (:).${hintLine}`,
        });

        const schema = cleanHeaderBase64 ? fastExtractionSchema : fastHeaderOnlySchema;

        const callFast = (model: string, thinkingLevel: ThinkingLevel) =>
          ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              systemInstruction: FAST_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: schema,
              thinkingConfig: { thinkingLevel },
            },
          });

        let response;
        try {
          response = await callFast('gemini-4-hydrogen', ThinkingLevel.LOW);
        } catch (err: unknown) {
          const errObj = err as { status?: number; code?: number };
          const status = errObj?.status || errObj?.code;
          if (status === 429 || status === 503) {
            response = await callWithRetry(
              () => callFast('gemini-3.1-flash-lite', ThinkingLevel.LOW),
              1
            );
          } else {
            throw err;
          }
        }

        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          res.status(502).json({ error: 'لم يُرجع نموذج التحليل بيانات نصية صالحة.' });
          return;
        }

        const rawParsed = JSON.parse(rawText);
        const resolvedIssue = resolveIssueNumber(
          rawParsed.issueNumber || '',
          rawParsed.digitsLtr
        );

        res.json({
          result: {
            issueNumberRaw: resolvedIssue,
            issueNumberNormalized: toWesternDigits(resolvedIssue),
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
        return;
      }

      // ULTRA MODE: dedicated high-res header OCR + parallel body OCR
      if (cleanHeaderBase64) {
        const [initialHeader, bodyResult] = await Promise.all([
          runHeaderHandwritingOcr(ai, cleanHeaderBase64, headerMimeType, hintLine),
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
            hintLine
          );
          boxReferenceImage = 'full_image';
        }

        const issueRaw = resolveIssueNumber(
          headerResult.issueNumberRaw || '',
          headerResult.issueCharactersLeftToRight
        );
        const dateRaw = headerResult.dateRaw || '';

        res.json({
          result: {
            issueNumberRaw: issueRaw,
            issueNumberNormalized: toWesternDigits(issueRaw),
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

      const headerResult = await runHeaderHandwritingOcr(
        ai,
        cleanFullBase64,
        fullMimeType,
        hintLine
      );
      const issueRaw = resolveIssueNumber(
        headerResult.issueNumberRaw || '',
        headerResult.issueCharactersLeftToRight
      );
      const dateRaw = headerResult.dateRaw || '';

      res.json({
        result: {
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
