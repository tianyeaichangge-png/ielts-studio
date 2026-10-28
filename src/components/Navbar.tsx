import React from 'react';
import { Settings } from 'lucide-react';
import { ActiveTab } from '../types/ielts';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenApiKeyModal: () => void;
  hasApiKey: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenApiKeyModal,
  hasApiKey,
}) => {
  return (
    <header className="w-full pt-6 pb-4 px-6 select-none">
      <div className="mx-auto grid max-w-[1200px] grid-cols-3 items-center">
        {/* Left: Braun Instrument Nameplate Anchor */}
        <div className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-[#EA5B25] shadow-[0_0_0_2px_rgba(234,91,37,0.14)]"
            aria-hidden="true"
          />
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
            <span className="font-sans text-sm font-semibold tracking-tight text-[#262523]">
              叶子的雅思小站
            </span>
            <span className="hidden font-mono text-[10px] tracking-[0.18em] text-[#9A958B] md:inline">
              IELTS STUDIO
            </span>
          </div>
        </div>

        {/* Center: Core 3-Segment Symmetrical Module Switcher [ 背单词 | 写作 | 笔记 ] */}
        <div className="flex justify-center">
          <nav
            aria-label="主导航"
            className="skeuo-groove inline-flex items-center rounded-xl p-1"
          >
            <button
              type="button"
              onClick={() => onSelectTab('vocabulary')}
              className={`relative rounded-lg px-6 py-1.5 text-xs font-medium tracking-wide transition-all duration-150 ${
                activeTab === 'vocabulary'
                  ? 'skeuo-switch-thumb text-[#262523] font-semibold'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              背单词
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('writing')}
              className={`relative rounded-lg px-6 py-1.5 text-xs font-medium tracking-wide transition-all duration-150 ${
                activeTab === 'writing'
                  ? 'skeuo-switch-thumb text-[#262523] font-semibold'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              写作
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('notes')}
              className={`relative rounded-lg px-6 py-1.5 text-xs font-medium tracking-wide transition-all duration-150 ${
                activeTab === 'notes'
                  ? 'skeuo-switch-thumb text-[#262523] font-semibold'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              笔记
            </button>
          </nav>
        </div>

        {/* Right: Global Tools & Status ([ ⚙️ ] Settings Gear) */}
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onOpenApiKeyModal}
            title="DeepSeek API Key 设置"
            aria-label="DeepSeek API Key 设置"
            className="skeuo-btn-light relative flex h-8 w-8 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#262523]"
          >
            <Settings className="h-3.5 w-3.5" />
            {!hasApiKey && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#EA5B25] ring-2 ring-[#E8E4DC]"
                title="尚未配置 DeepSeek API Key，点击配置"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
