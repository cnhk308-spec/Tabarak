import React, { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react';

interface GeminiKeyButtonProps {
  apiKey: string;
  onSaveApiKey: (nextKey: string) => void;
}

export const GeminiKeyButton: React.FC<GeminiKeyButtonProps> = ({
  apiKey,
  onSaveApiKey,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [keySavedFlash, setKeySavedFlash] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setKeyInput(apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keyInput.trim();
    onSaveApiKey(trimmed);
    setKeySavedFlash(true);
    setTimeout(() => {
      setKeySavedFlash(false);
      setIsOpen(false);
    }, 800);
  };

  const hasCustomKey = Boolean(apiKey.trim());

  return (
    <div ref={containerRef} className="fixed bottom-4 left-4 z-40">
      {isOpen && (
        <form
          onSubmit={handleSubmit}
          className="mb-2.5 w-[290px] sm:w-[320px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="floating-gemini-key"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"
            >
              <KeyRound className="h-3.5 w-3.5 text-blue-900 shrink-0" aria-hidden="true" />
              <span>مفتاح رمز Gemini API</span>
            </label>
            <div className="flex items-center gap-2">
              {hasCustomKey && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span>محفوظ</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="إغلاق نافذة المفتاح"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex items-stretch gap-1.5">
            <input
              ref={inputRef}
              id="floating-gemini-key"
              type={showKey ? 'text' : 'password'}
              dir="ltr"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 min-h-[36px] rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-900 focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
              aria-label={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
              className="inline-flex min-h-[36px] min-w-[34px] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              {showKey ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-blue-900 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap cursor-pointer"
              >
                <span>{keySavedFlash ? 'تم الحفظ' : 'حفظ المفتاح'}</span>
              </button>
              {hasCustomKey && (
                <button
                  type="button"
                  onClick={() => {
                    setKeyInput('');
                    onSaveApiKey('');
                  }}
                  className="inline-flex min-h-[32px] items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap cursor-pointer"
                >
                  مسح
                </button>
              )}
            </div>
            <span className="text-[10px] text-slate-500 truncate">
              يُحفظ في متصفحك فقط
            </span>
          </div>
        </form>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="إعداد مفتاح Gemini API"
        aria-expanded={isOpen}
        title="مفتاح رمز Gemini API"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-200 cursor-pointer focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900 ${
          isOpen
            ? 'opacity-100 border-blue-900 bg-blue-900 text-white shadow-md'
            : hasCustomKey
            ? 'opacity-45 hover:opacity-100 border-emerald-300 bg-white/85 text-emerald-700 shadow-xs backdrop-blur-xs'
            : 'opacity-25 hover:opacity-100 border-slate-200/80 bg-white/80 text-slate-500 hover:border-slate-300 hover:text-blue-900 shadow-xs backdrop-blur-xs'
        }`}
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};
