import React from 'react';
import { Camera, Crop, Sparkles, CheckSquare, ArrowLeft } from 'lucide-react';

interface AccuracyGuideViewProps {
  onReturnToWorkspace: () => void;
}

export const AccuracyGuideView: React.FC<AccuracyGuideViewProps> = ({
  onReturnToWorkspace,
}) => {
  const tips = [
    {
      index: '01.',
      title: 'التصوير العمودي والإضاءة المتساوية',
      body: 'احرص على تصوير ترويسة الكتاب بشكل عمودي مباشر دون ميلان حاد أو ظلال تغطي الحبر اليدوي، فكلما كانت حدود الأرقام واضحة زادت دقة التمييز بين (٢) و(٣) أو (٠) و(٥).',
      icon: Camera,
    },
    {
      index: '02.',
      title: 'استخدام التحديد اليدوي للمنطقة',
      body: 'إذا كان الكتاب يحتوي على أختام كثيرة أو جداول قريبة من الترويسة، فعّل أداة «تحديد منطقة يدوياً» وارسم مربعاً حول سطر العدد والتاريخ فقط ليتم قصه وتكبيره قبل القراءة.',
      icon: Crop,
    },
    {
      index: '03.',
      title: 'تفعيل تحسين الحبر الباهت',
      body: 'في النسخ المصورة بالماسح الضوئي (Scanner) أو ذات الحبر الجاف الباهت، فعّل خيار «تحسين الحبر» ثم أعد التحليل لرفع التباين وإبراز ضربات القلم بدقة.',
      icon: Sparkles,
    },
    {
      index: '04.',
      title: 'العدسة المكبرة والاعتماد النهائي',
      body: 'يعرض لوح النتائج صورة مقصوصة ومكبرة تلقائياً لموضع العدد وموضع التاريخ فوق كل حقل، مما يتيح للمدقق مطابقة الأرقام بالعين المجردة خلال ثوانٍ قبل التصدير.',
      icon: CheckSquare,
    },
  ];

  return (
    <section className="mx-auto max-w-4xl py-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 text-balance">
              إرشادات الوصول إلى أعلى دقة في قراءة خط اليد
            </h1>
            <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
              تعتمد قراءة الأرقام والتواريخ اليدوية في الكتب الرسمية على وضوح ضربات القلم وتحييد التشويش الناتج عن الأختام والطيات الورقية.
            </p>
          </div>
          <button
            type="button"
            onClick={onReturnToWorkspace}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>العودة إلى مساحة الفحص</span>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          {tips.map((tip) => {
            const Icon = tip.icon;
            return (
              <div key={tip.index} className="space-y-2.5">
                <div className="flex items-center gap-2.5 text-slate-900">
                  <Icon className="h-4 w-4 text-blue-900 shrink-0" aria-hidden="true" />
                  <h2 className="font-display text-base font-bold">
                    {tip.index} {tip.title}
                  </h2>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  {tip.body}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 border-t border-slate-200 pt-6">
          <h3 className="font-display text-sm font-bold text-slate-900">
            تنسيقات الأرقام والتواريخ المدعومة
          </h3>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-600">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5">
              <div className="font-semibold text-slate-900">الأرقام الهندية والقياسية</div>
              <div dir="ltr" className="mt-1 font-mono text-slate-700">
                ١٢٨٥ / 1285 · م/٤/٢٣٠
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5">
              <div className="font-semibold text-slate-900">صيغ التواريخ المختلطة</div>
              <div dir="ltr" className="mt-1 font-mono text-slate-700">
                14/11/2025 · ٢٠٢٥-١١-١٤
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5">
              <div className="font-semibold text-slate-900">اختصارات السنة والبادئات</div>
              <div dir="ltr" className="mt-1 font-mono text-slate-700">
                25/11/4 · ق.م/12/890
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
