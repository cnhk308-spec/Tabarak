import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const extractionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    issueNumberRaw: {
      type: Type.STRING,
      description:
        'العدد كما هو مكتوب بالضبط في الكتاب (مع الحروف والشرطات المائلة إن وجدت، والأرقام كما كتبت). إذا لم يوجد اكتب سلسلة فارغة.',
    },
    issueNumberNormalized: {
      type: Type.STRING,
      description:
        'العدد بعد تحويل الأرقام الهندية/العربية (٠١٢٣٤٥٦٧٨٩) إلى أرقام قياسية (0123456789) مع الحفاظ على أي حروف أو شرطات مائلة مثل م/4/1250.',
    },
    issueNumberConfidence: {
      type: Type.STRING,
      description: 'مستوى الثقة في قراءة العدد: high أو medium أو low.',
    },
    alternativeIssueNumber: {
      type: Type.STRING,
      description:
        'قراءة بديلة محتملة في حال وجود رقم غير واضح أو متداخل مع الختم، وإلا سلسلة فارغة.',
    },
    issueNumberBox: {
      type: Type.OBJECT,
      description:
        'إحداثيات مربع الإحاطة لقيمة العدد المكتوبة (نطاق من 0 إلى 1000 نسبةً لأبعاد الصورة المرسلة).',
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
      description:
        'التاريخ كما هو مكتوب بالضبط بخط اليد في الكتاب (مثل ١٤ / ١١ / ٢٠٢٥ أو 2025/11/14).',
    },
    dateNormalized: {
      type: Type.STRING,
      description:
        'التاريخ بصيغة قياسية موحدة YYYY/MM/DD بأرقام إنجليزية (مثال: 2025/11/14). إذا تعذر تحديد اليوم أو الشهر اكتب ما أمكن بأدق شكل.',
    },
    dateConfidence: {
      type: Type.STRING,
      description: 'مستوى الثقة في قراءة التاريخ: high أو medium أو low.',
    },
    alternativeDate: {
      type: Type.STRING,
      description: 'قراءة بديلة محتملة للتاريخ إذا كان أحد الأرقام محتملاً لأكثر من قراءة، وإلا سلسلة فارغة.',
    },
    calendarType: {
      type: Type.STRING,
      description: 'نوع التقويم: gregorian (ميلادي) أو hijri (هجري) أو unknown.',
    },
    dateBox: {
      type: Type.OBJECT,
      description:
        'إحداثيات مربع الإحاطة لقيمة التاريخ المكتوبة (نطاق من 0 إلى 1000 نسبةً لأبعاد الصورة المرسلة).',
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
      description: 'اسم الوزارة أو الدائرة أو الجهة المصدرة للكتاب إن ظهر في الترويسة، وإلا سلسلة فارغة.',
    },
    title: {
      type: Type.STRING,
      description:
        'العنوان الرئيسي في منتصف الورقة مثل (أمر جامعي) أو (أمر إداري) أو (إعمام)، خصوصاً عند عدم وجود (إلى/) و(م/)، وإلا سلسلة فارغة.',
    },
    recipient: {
      type: Type.STRING,
      description: 'النص الواقع بعد عبارة (إلى /) إن وجد في منتصف الكتاب، وإلا سلسلة فارغة.',
    },
    subject: {
      type: Type.STRING,
      description: 'النص الواقع بعد عبارة (م /) إن وجد في منتصف الكتاب، وإلا سلسلة فارغة.',
    },
    bodyContent: {
      type: Type.STRING,
      description: 'مضمون الكتاب كاملاً (النص الأساسي للرسالة الرسمية) مكتوباً بدقة.',
    },
    handwritingNotes: {
      type: Type.STRING,
      description:
        'ملاحظة موجزة بالعربية حول وضوح خط اليد أو تداخل الختم أو سبب الشك في رقم معين إن وجد.',
    },
    isHandwrittenDetected: {
      type: Type.BOOLEAN,
      description: 'هل العدد والتاريخ مكتوبان بخط اليد أم مطبوعان.',
    },
  },
  required: [
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

const fastExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    issueNumber: {
      type: Type.STRING,
      description: 'العدد كما هو مكتوب بالضبط بخط اليد مع أي حروف أو شرطات مائلة.',
    },
    date: {
      type: Type.STRING,
      description: 'التاريخ كما هو مكتوب بالضبط بخط اليد.',
    },
    title: {
      type: Type.STRING,
      description:
        'العنوان الرئيسي للكتاب مثل (أمر جامعي) أو (أمر إداري) في منتصف الورقة، خاصةً إذا لم يوجد (إلى/) و(م/)، وإلا سلسلة فارغة.',
    },
    recipient: {
      type: Type.STRING,
      description: 'النص الواقع بعد عبارة (إلى /) في منتصف الكتاب إن وجد، وإلا سلسلة فارغة.',
    },
    subject: {
      type: Type.STRING,
      description: 'النص الواقع بعد عبارة (م /) في منتصف الكتاب إن وجد، وإلا سلسلة فارغة.',
    },
    bodyContent: {
      type: Type.STRING,
      description: 'مضمون الكتاب كاملاً (النص الأساسي في جسم الكتاب) منسوخاً بدقة ووضوح، وإلا سلسلة فارغة.',
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
  required: ['issueNumber', 'date', 'title', 'recipient', 'subject', 'bodyContent', 'confidence', 'calendar'],
};

const FAST_SYSTEM_INSTRUCTION = `أنت خبير متخصص في قراءة وأرشفة الكتب الرسمية العربية.
مهمتك:
1. استخرج (العدد) و(التاريخ) المكتوبين بخط اليد بدقة 100% (ميّز بدقة بين ٢ و٣، و٦ و٢، و٧ و٨، ولا تسقط أي خانة مثل ٥٠٨٦). إذا أُرفقت صورة ثانية مكبّرة للترويسة فاعتمد عليها لقراءة العدد والتاريخ.
2. في منتصف الورقة:
   - إذا وُجدت (إلى / ...) فضَعها في recipient.
   - إذا وُجدت (م / ...) فضَعها في subject.
   - إذا لم يوجد (إلى/) و(م/) أو وُجد عنوان مركزي بارز مثل (أمر جامعي) أو (أمر إداري) أو (إعمام) فضَعه في title (العنوان).
3. استخرج مضمون الكتاب كاملاً (نص المتن الرئيسي للكتاب) في bodyContent بدقة دون اختصار أو تحريف.`;

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
    let [a, b, c] = parts;
    // If DD/MM/YYYY
    if (c.length === 4 && Number(a) <= 31) {
      return `${c}/${b.padStart(2, '0')}/${a.padStart(2, '0')}`;
    }
    // If YYYY/MM/DD
    if (a.length === 4) {
      return `${a}/${b.padStart(2, '0')}/${c.padStart(2, '0')}`;
    }
    // If DD/MM/YY
    if (c.length === 2 && Number(a) <= 31) {
      const fullYear = Number(c) >= 40 ? `14${c}` : `20${c}`;
      return `${fullYear}/${b.padStart(2, '0')}/${a.padStart(2, '0')}`;
    }
  }
  return western;
}

const SYSTEM_INSTRUCTION = `أنت خبير متخصص في قراءة وأرشفة الكتب والمخاطبات الرسمية العربية (العراقية والعربية)، ومتخصص بشكل دقيق في قراءة الأرقام والتواريخ المكتوبة بخط اليد (سواء بالأرقام الهندية الشرقية ٠١٢٣٤٥٦٧٨٩ أو الأرقام العربية الغربية 0123456789).

اتبع القواعد الصارمة التالية عند فحص الصورة:
1. افحص ترويسة الكتاب العليا (عادةً أعلى اليمين أو أعلى اليسار، وأحياناً في ختم الصادرة/الواردة) للعثور على حقل (العدد / رقم الكتاب / الرقم) وحقل (التاريخ / الموافق).
2. ركز بدقة متناهية على الحبر اليدوي (أزرق، أسود، أو أحمر) المكتوب بجانب أو أسفل كلمة "العدد" وكلمة "التاريخ".
3. انتبه للتشابه الشائع في خط اليد العربي للأرقام:
   - ميّز بدقة بين (٢) و(٣)، وبين (٠ نقطة) و(٥ دائرة)، وبين (٧) و(٨)، وبين (٦) و(٢)، وبين (١) والشرطة المائلة (/).
   - لا تدمج رقمين متجاورين ولا تسقط الخانة الأخيرة أو الأولى أبداً.
   - ميّز بين الفواصل والشرطات المائلة (/) والخطوط الأفقية (-) في رقم العدد (مثل: م/٤/١٢٠٥ أو ق.ع/٢٣١ أو 450/2/1). لا تحذف البادئات الحرفية أو الأرقام الفرعية.
4. في التاريخ:
   - اقرأ التاريخ كما كُتب بالضبط في dateRaw.
   - إذا كان التاريخ بصيغة يوم/شهر/سنة (مثل 14/11/2025 أو ١٤-١١-٢٥) فحوّله في dateNormalized إلى صيغة YYYY/MM/DD (مثل 2025/11/14).
   - حدد إن كان التقويم ميلادياً (gregorian) أم هجرياً (hijri) بناءً على السنة (مثلاً 1445–1448 هجري، 2020–2030 ميلادي) أو لفظة "هـ" / "م".
5. حدد مربعات الإحاطة (issueNumberBox و dateBox) بدقة على منطقة القيمة المكتوبة نفسها في الصورة الأولى بإحداثيات من 0 إلى 1000.
6. استخرج نص (إلى/) في recipient ونص (م/) في subject، وعند عدم وجودهما (أو وجود عنوان بارز وسط الصفحة مثل أمر جامعي أو أمر إداري) ضعه في title، واكتب مضمون الكتاب كاملاً في bodyContent بدقة.
7. لا تخمّن أبداً رقماً غير موجود. إذا كان هناك غموض أو طمس أو تداخل مع الختم، خفّض مستوى الثقة إلى medium أو low واذكر القراءة البديلة والملاحظة بوضوح.`;

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;
      const isTransient = status === 429 || status === 503 || status === 500;
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 800 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/extract', async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: 'مفتاح GEMINI_API_KEY غير متوفر في إعدادات الخادم (Secrets).',
        });
        return;
      }

      const {
        imageBase64,
        mimeType,
        headerImageBase64,
        headerMimeType,
        precisionMode,
        isCroppedRegion,
        hintText,
      } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        headerImageBase64?: string;
        headerMimeType?: string;
        precisionMode?: 'standard' | 'ultra';
        isCroppedRegion?: boolean;
        hintText?: string;
      };

      if (!imageBase64) {
        res.status(400).json({ error: 'لم يتم إرسال صورة صالحة للتحليل.' });
        return;
      }

      const cleanBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;
      const resolvedMimeType = mimeType || 'image/jpeg';

      const cleanHeaderBase64 = headerImageBase64
        ? headerImageBase64.includes(',')
          ? headerImageBase64.split(',')[1]
          : headerImageBase64
        : null;

      const isUltra = precisionMode === 'ultra';
      const primaryModel = 'gemini-4-hydrogen';
      const primaryThinking = isUltra ? ThinkingLevel.HIGH : ThinkingLevel.LOW;

      const userPromptParts = [
        cleanHeaderBase64
          ? 'الصورة الأولى هي الكتاب الرسمي كاملاً لاستخراج (العنوان مثل أمر جامعي عند عدم وجود إلى/م، و إلى/، و م/، ومضمون الكتاب كاملاً)، والصورة الثانية هي تقريب مكبّر للجزء العلوي الأيمن لقراءة العدد والتاريخ المكتوبين بخط اليد بدقة تامة.'
          : isCroppedRegion
          ? 'اقرأ العدد والتاريخ المكتوبين بخط اليد من هذه الترويسة المقصوصة.'
          : 'استخرج العدد والتاريخ المكتوبين بخط اليد والعنوان أو إلى/م ومضمون الكتاب كاملاً.',
      ];

      if (hintText && hintText.trim().length > 0) {
        userPromptParts.push(`تلميح: ${hintText.trim()}`);
      }

      const contentParts: any[] = [
        {
          inlineData: {
            mimeType: resolvedMimeType,
            data: cleanBase64,
          },
        },
      ];

      if (cleanHeaderBase64) {
        contentParts.push({
          inlineData: {
            mimeType: headerMimeType || 'image/jpeg',
            data: cleanHeaderBase64,
          },
        });
      }

      contentParts.push({
        text: userPromptParts.join(' '),
      });

      const callModel = (model: string, thinkingLevel: ThinkingLevel) =>
        ai.models.generateContent({
          model,
          contents: {
            parts: contentParts,
          },
          config: {
            systemInstruction: isUltra ? SYSTEM_INSTRUCTION : FAST_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: isUltra ? extractionResponseSchema : fastExtractionSchema,
            thinkingConfig: {
              thinkingLevel,
            },
          },
        });

      let response;
      try {
        response = await callModel(primaryModel, primaryThinking);
      } catch (primaryErr: any) {
        const status = primaryErr?.status || primaryErr?.code;
        if (status === 429 || status === 503) {
          response = await callGeminiWithRetry(
            () =>
              callModel(
                'gemini-3.1-flash-lite',
                isUltra ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM
              ),
            1
          );
        } else {
          throw primaryErr;
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
      const parsed = isUltra
        ? rawParsed
        : {
            issueNumberRaw: rawParsed.issueNumber || '',
            issueNumberNormalized: toWesternDigits(rawParsed.issueNumber || ''),
            issueNumberConfidence: rawParsed.confidence || 'medium',
            dateRaw: rawParsed.date || '',
            dateNormalized: normalizeDateString(rawParsed.date || ''),
            dateConfidence: rawParsed.confidence || 'medium',
            calendarType: rawParsed.calendar || 'unknown',
            title: rawParsed.title || '',
            recipient: rawParsed.recipient || '',
            subject: rawParsed.subject || '',
            bodyContent: rawParsed.bodyContent || '',
          };

      res.json({ result: parsed });
    } catch (error: any) {
      console.error('Extraction API Error:', error);
      const status = typeof error?.status === 'number' ? error.status : 500;
      let message = 'حدث خطأ أثناء تحليل صورة الكتاب الرسمي.';

      if (status === 400 || status === 403) {
        message =
          'تعذر المصادقة مع خدمة التحليل. يرجى التحقق من مفتاح GEMINI_API_KEY في لوحة Secrets.';
      } else if (status === 429) {
        message =
          'تم تجاوز حد الطلبات المؤقت. يرجى الانتظار بضع ثوانٍ ثم إعادة المحاولة.';
      } else if (error?.message) {
        message = `تعذر إكمال التحليل: ${error.message}`;
      }

      res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
