import React from 'react';
import { Settings } from 'lucide-react';
import { ActiveTab } from '../types/ielts';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenApiKeyModal: () => void;
  hasApiKey: boolean;
}

const tabs: { id: ActiveTab; label: string }[] = [
  { id: 'vocabulary', label: '背单词' },
  { id: 'writing', label: '写作' },
  { id: 'notes', label: '笔记' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenApiKeyModal,
  hasApiKey,
}) => (
  <header className="app-header select-none">
    <div className="app-brand">
      <span className="size-2 shrink-0 rounded-full bg-braun-orange" aria-hidden="true" />
      <span className="text-sm font-semibold tracking-tight">叶子的雅思小站</span>
      <span className="app-brand-mark font-mono text-[10px] tracking-[0.16em]">IELTS STUDIO</span>
    </div>

    <nav aria-label="主导航" className="app-nav segmented-control skeuo-groove">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelectTab(id)}
          aria-current={activeTab === id ? 'page' : undefined}
          className={activeTab === id ? 'skeuo-switch-thumb' : ''}
        >
          {label}
        </button>
      ))}
    </nav>

    <button
      type="button"
      onClick={onOpenApiKeyModal}
      title="DeepSeek API Key 设置"
      aria-label="DeepSeek API Key 设置"
      className="skeuo-btn-light relative col-start-3 row-start-1 flex size-9 items-center justify-center rounded-lg justify-self-end"
    >
      <Settings className="size-4" />
      {!hasApiKey && (
        <span
          className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-braun-orange"
          title="尚未配置 DeepSeek API Key，点击配置"
        />
      )}
    </button>
  </header>
);
