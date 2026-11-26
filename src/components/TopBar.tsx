import React from 'react';
import { FolderOpen, FolderSearch, Loader2, Upload } from 'lucide-react';

export type AppView = 'workspace' | 'ledger';

interface TopBarProps {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  onTriggerUpload: () => void;
  onTriggerFolderScan: () => void;
  onChangeSavedFolder?: () => void;
  savedFolderName?: string | null;
  isFolderScanning?: boolean;
  folderScanLabel?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onChangeView,
  onTriggerUpload,
  onTriggerFolderScan,
  onChangeSavedFolder,
  savedFolderName,
  isFolderScanning = false,
  folderScanLabel,
}) => {
  const navItems: Array<{ id: AppView; label: string }> = [
    { id: 'workspace', label: 'مساحة الفحص' },
    { id: 'ledger', label: 'سجل الكتب' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 h-16">
        {/* Zone 1: Brand Wordmark (single text element) */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            onChangeView('workspace');
          }}
          className="font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-900"
        >
          مرصاد الوثائق
        </a>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="التنقل الرئيسي"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeView(item.id)}
                className={`relative py-2 whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-900 ${
                  isActive
                    ? 'text-blue-900 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[17px] h-0.5 bg-blue-900"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Automated Folder-to-Excel + Primary Upload */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center">
            <button
              type="button"
              onClick={onTriggerFolderScan}
              disabled={isFolderScanning}
              title={
                savedFolderName
                  ? `مسح المجلد المحفوظ (${savedFolderName}) واستخراج الكتب إلى Excel تلقائياً`
                  : 'اختيار مجلد لمرة واحدة لاستخراج الكتب الرسمية وتنزيل Excel تلقائياً'
              }
              className={`inline-flex min-h-[40px] items-center gap-2 bg-emerald-700 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white transition-colors duration-150 hover:bg-emerald-800 disabled:opacity-75 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                savedFolderName && onChangeSavedFolder && !isFolderScanning
                  ? 'rounded-r-lg'
                  : 'rounded-lg'
              }`}
            >
              {isFolderScanning ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <FolderSearch className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {isFolderScanning
                  ? folderScanLabel || 'جاري المسح...'
                  : savedFolderName
                  ? `مسح «${savedFolderName}» → Excel`
                  : 'مسح مجلد → Excel'}
              </span>
            </button>

            {savedFolderName && onChangeSavedFolder && !isFolderScanning && (
              <button
                type="button"
                onClick={onChangeSavedFolder}
                title="تغيير المجلد المحفوظ"
                aria-label="تغيير المجلد المحفوظ"
                className="inline-flex min-h-[40px] items-center justify-center rounded-l-lg border-r border-emerald-600 bg-emerald-700 px-2.5 text-white hover:bg-emerald-800 cursor-pointer"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onTriggerUpload}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-900 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">رفع كتاب رسمي</span>
            <span className="sm:hidden">رفع</span>
          </button>
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav
        aria-label="التنقل على الجوال"
        className="flex md:hidden items-center justify-around border-t border-slate-100 px-4 py-1.5 text-xs font-medium"
      >
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeView(item.id)}
              className={`min-h-[36px] px-3 py-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive ? 'text-blue-900 font-semibold underline underline-offset-4' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
