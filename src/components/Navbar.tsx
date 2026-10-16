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
    <header className="w-full pt-7 pb-4 px-6 select-none">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        {/* Left balance spacer to keep Segmented Switch strictly centered */}
        <div className="w-9" aria-hidden="true" />

        {/* Centered Braun Recessed Segmented Switch */}
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
        </nav>

        {/* Right Tiny Mechanical Gear Button for DeepSeek API Key */}
        <div className="flex w-9 justify-end">
          <button
            type="button"
            onClick={onOpenApiKeyModal}
            title="DeepSeek API Key 设置"
            aria-label="DeepSeek API Key 设置"
            className="skeuo-btn-light relative flex h-8 w-8 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#262523]"
          >
            <Settings className="h-3.5 w-3.5" />
            {hasApiKey && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#EA5B25] ring-2 ring-[#E6E4DD]"
                title="DeepSeek API Key 已就绪"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
