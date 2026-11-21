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
        'امسح كل خانة في حقل (العدد :) من أقصى اليسار إلى أقصى اليمين حتى تلامس النقطتين (:). لا تتخطَّ أي رقم وسطي ولا تسقط الرقم الملاصق لـ (:).',
      items: {
        type: Type.OBJECT,
        properties: {
          c: {
            type: Type.STRING,
            description: 'الرقم أو الحرف أو الشرطة الواحدة فقط.',
          },
          k: {
            type: Type.STRING,
            description:
              'وسم الشكل بكلمة واحدة: حلقة|نقطة|∧|∨|┐|┌|تعرج|أسنان|ذيل|عمود|شرطة|حرف|غربي',
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
      description: 'العدد كاملاً مطابقاً تماماً لدمج c في digits بدون حذف أي خانة.',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'high أو medium أو low',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description: 'قراءة بديلة فقط عند الشك، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      ...boxSchema,
      description: 'مربع الإحاطة لقيمة العدد المكتوبة (0 إلى 1000).',
    },
    dateRaw: {
      type: Type.STRING,
      description: 'التاريخ كما كُتب بخط اليد بالضبط.',
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
      description: 'مربع الإحاطة لقيمة التاريخ المكتوبة (0 إلى 1000).',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد أو التاريخ بخط اليد.',
    },
  },
  required: [
    'headerFound',
    'digits',
    'beforeColon',
    'issueNumberRaw',
    'issueNumberConfidence',
    'issueNumberBox',
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

const HANDWRITING_RULES = `قواعد صارمة لقراءة خط اليد في حقلَي (العدد :) و(التاريخ :):
1. ركّز فقط على حبر خط اليد بجانب (العدد :) و(التاريخ :) وتجاهل أرقام الهواتف والرموز المطبوعة.
2. امسح حقل (العدد :) من اليسار لليمين خانةً بخانة داخل digits، ولا تقفز فوق أي رقم وسطي (مثل ٨ أو ٠) ولا تسقط الرقم الملاصق لـ (:) (تحقق منه في beforeColon).
   مثال: ٥٠٨٦ يتكون من 4 ضربات متميزة: [٥ حلقة] + [٠ نقطة] + [٨ مفتوحة للأسفل ∧] + [٦ معقوفة لليسار ┐ ملاصقة لـ :].
3. تمييز الأرقام الهندية:
   - (٠) نقطة حبر واضحة؛ (٥) حلقة مغلقة/قلب أكبر؛
   - (٨) مفتوحة للأسفل ∧؛ (٧) مفتوحة للأعلى ∨؛
   - (٦) رأسها يتجه لليسار ┐؛ (٢) رأسها يتجه لليمين ┌؛
   - (٤) تعرّج لليمين؛ (٣) ثلاث أسنان؛ (٩) حلقة وذيل؛ (١) عمودي مفرد.
4. للأرقام الغربية (0-9): ميّز بدقة بين 0 و5 و6 و8 و9 و2 و7.
5. انقل جميع خانات digits كاملة إلى issueNumberRaw دون إسقاط أي خانة.`;

const HEADER_OCR_INSTRUCTION = `أنت مدقق بصري متخصص حصرياً في قراءة خط اليد بدقة شديدة في حقلَي (العدد) و(التاريخ).
${HANDWRITING_RULES}`;

const BODY_OCR_INSTRUCTION = `استخرج الجهة المصدرة والعنوان أو (إلى /) و(م /) ومضمون الكتاب كاملاً بإيجاز ودقة.`;

function toWesternDigits(str: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '')
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

function resolveIssueNumber(rawIssue: string, digits?: unknown): string {
  const cleanRaw = (rawIssue || '').trim();
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
      const delayMs = 450 * Math.pow(2, attempt);
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
      text: `اقرأ حقل (العدد :) وحقل (التاريخ :) بخط اليد بدقة شديدة. سجّل كل خانة من اليسار لليمين في digits وتحقق من الرقم الملاصق للنقطتين (:) في beforeColon.${hintLine}`,
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
    const errObj = err as { status?: number; code?: number };
    const status = errObj?.status || errObj?.code;
    if (status === 400) {
      response = await callModel('gemini-4-hydrogen', thinkingLevel, false);
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
    headerResult.digits
  );
  const dateRaw = headerResult.dateRaw || '';

  return {
    issueNumberRaw: issueRaw,
    issueNumberNormalized: toWesternDigits(issueRaw),
    issueNumberConfidence: headerResult.issueNumberConfidence || 'medium',
    alternativeIssueNumber: headerResult.alternativeIssueNumber || '',
    issueNumberBox: headerResult.issueNumberBox || null,
    dateRaw,
    dateNormalized: normalizeDateString(dateRaw),
    dateConfidence: headerResult.dateConfidence || 'medium',
    alternativeDate: headerResult.alternativeDate || '',
    dateBox: headerResult.dateBox || null,
    boxReferenceImage,
    calendarType: headerResult.calendarType || 'unknown',
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
