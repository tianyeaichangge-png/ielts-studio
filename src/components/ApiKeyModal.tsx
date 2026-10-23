import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { DeepSeekConfig } from '../types/ielts';
import { DEFAULT_DEEPSEEK_ENDPOINT } from '../lib/geminiEvaluator';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: DeepSeekConfig;
  onSaveConfig: (newConfig: DeepSeekConfig) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState(config.apiKey);
  const [endpointInput, setEndpointInput] = useState(
    config.endpoint || DEFAULT_DEEPSEEK_ENDPOINT
  );
  const [selectedModel, setSelectedModel] = useState(
    config.model || 'deepseek-chat'
  );
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput(config.apiKey || '');
      setEndpointInput(config.endpoint || DEFAULT_DEEPSEEK_ENDPOINT);
      setSelectedModel(
        config.model === 'deepseek-chat' || config.model === 'deepseek-reasoner'
          ? config.model
          : 'deepseek-chat'
      );
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      apiKey: apiKeyInput.trim(),
      endpoint: endpointInput.trim() || DEFAULT_DEEPSEEK_ENDPOINT,
      model: selectedModel,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#262523]/30 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-modal-title"
    >
      <div className="skeuo-paper w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between border-b border-[#E2DFD5] pb-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
            <h2
              id="api-key-modal-title"
              className="font-sans text-sm font-semibold tracking-tight text-[#262523]"
            >
              DeepSeek API 设置
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#7A7873] hover:text-[#262523]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="deepseek-api-key"
              className="block font-mono text-[11px] uppercase tracking-wider text-[#7A7873]"
            >
              API Key
            </label>
            <div className="relative mt-1.5">
              <input
                id="deepseek-api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full rounded-xl border border-[#D5D1C6] bg-[#F4F1EA] py-2 pl-3.5 pr-10 font-mono text-xs text-[#262523] placeholder-[#B5B1A6] focus:border-[#262523] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                className="absolute inset-y-0 right-2.5 flex items-center text-[#7A7873] hover:text-[#262523]"
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="deepseek-endpoint"
              className="block font-mono text-[11px] uppercase tracking-wider text-[#7A7873]"
            >
              Endpoint
            </label>
            <input
              id="deepseek-endpoint"
              type="url"
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder={DEFAULT_DEEPSEEK_ENDPOINT}
              className="mt-1.5 w-full rounded-xl border border-[#D5D1C6] bg-[#F4F1EA] px-3.5 py-2 font-mono text-xs text-[#262523] focus:border-[#262523] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="deepseek-model"
              className="block font-mono text-[11px] uppercase tracking-wider text-[#7A7873]"
            >
              Model
            </label>
            <select
              id="deepseek-model"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[#D5D1C6] bg-[#F4F1EA] px-3.5 py-2 font-mono text-xs text-[#262523] focus:border-[#262523] focus:outline-none"
            >
              <option value="deepseek-chat">deepseek-chat (DeepSeek-V3)</option>
              <option value="deepseek-reasoner">
                deepseek-reasoner (DeepSeek-R1)
              </option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="skeuo-btn-light rounded-xl px-4 py-2 font-sans text-xs font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              className="skeuo-btn-orange rounded-xl px-5 py-2 font-sans text-xs font-semibold text-white"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
