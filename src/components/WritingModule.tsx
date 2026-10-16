import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Dices,
  ArrowLeft,
  Plus,
  Tag,
  ImagePlus,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  DeepSeekConfig,
  WritingDraftState,
  WritingEvaluationReport,
  WritingTaskType,
} from '../types/ielts';
import {
  convertImageFileToDataUrl,
  countWords,
  evaluateIeltsWriting,
  generateOfflineDiagnosticReport,
} from '../lib/geminiEvaluator';
import { MASTER_WRITING_PROMPTS } from '../lib/samplePrompts';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface WritingModuleProps {
  aiConfig: DeepSeekConfig;
  reports: WritingEvaluationReport[];
  onSaveReport: (report: WritingEvaluationReport) => void;
}

type ViewMode = 'draft' | 'history';

const DEFAULT_TASK2_PROMPT = MASTER_WRITING_PROMPTS[0];

export const WritingModule: React.FC<WritingModuleProps> = ({
  aiConfig,
  reports,
  onSaveReport,
}) => {
  // 1. Silent Real-Time Persistent Draft in localStorage (including Task 1 chartImageDataUrl)
  const [draft, setDraft] = useLocalStorage<WritingDraftState>(
    'ielts_studio_writing_draft_v2',
    {
      taskType: DEFAULT_TASK2_PROMPT.taskType,
      topicTag: DEFAULT_TASK2_PROMPT.topicTag,
      prompt: DEFAULT_TASK2_PROMPT.prompt,
      chartImageDataUrl: null,
      essay: '',
      gradedReportId: null,
    }
  );

  // 2. Strict Mode Isolation: 'draft' vs 'history'
  const [viewMode, setViewMode] = useState<ViewMode>('draft');
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // Anti-accidental-loss confirmation state
  const [confirmAction, setConfirmAction] = useState<
    null | 'random-prompt' | 'new-sheet'
  >(null);

  // Lightbox Zoom Modal for Task 1 Chart inspection
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isHistoryMode = viewMode === 'history';
  const safeHistoryIndex =
    reports.length > 0 ? Math.min(historyIndex, reports.length - 1) : 0;
  const activeHistoryReport = isHistoryMode
    ? reports[safeHistoryIndex] || null
    : null;

  // Report corresponding to the current draft (if already graded)
  const draftReport = useMemo(() => {
    if (!draft.gradedReportId) return null;
    return reports.find((r) => r.id === draft.gradedReportId) || null;
  }, [draft.gradedReportId, reports]);

  // Displayed values on the Left Sheet (isolated between Draft and History)
  const displayedTaskType = isHistoryMode
    ? activeHistoryReport?.taskType || 'task2'
    : draft.taskType;
  const displayedTopicTag = isHistoryMode
    ? activeHistoryReport?.topicTag || '历史存档 · Archive'
    : draft.topicTag;
  const displayedPrompt = isHistoryMode
    ? activeHistoryReport?.prompt || ''
    : draft.prompt;
  const displayedChartImage = isHistoryMode
    ? activeHistoryReport?.chartImageDataUrl || null
    : draft.chartImageDataUrl || null;
  const displayedEssay = isHistoryMode
    ? activeHistoryReport?.essay || ''
    : draft.essay;

  const draftWordCount = useMemo(
    () => countWords(draft.essay),
    [draft.essay]
  );
  const displayedWordCount = isHistoryMode
    ? activeHistoryReport?.wordCount ?? countWords(displayedEssay)
    : draftWordCount;

  // Handle saving an image File/Blob to draft state
  const handleAttachChartBlob = useCallback(
    async (blob: File | Blob) => {
      try {
        const dataUrl = await convertImageFileToDataUrl(blob);
        setDraft((prev) => ({
          ...prev,
          chartImageDataUrl: dataUrl,
        }));
        setErrorMsg(null);
      } catch {
        setErrorMsg('图表图片解析失败，请重试');
      }
    },
    [setDraft]
  );

  // Global Ctrl + V / Cmd + V listener for clipboard screenshot paste when in Task 1 Draft mode
  useEffect(() => {
    if (isHistoryMode || draft.taskType !== 'task1') return;

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            handleAttachChartBlob(blob);
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [isHistoryMode, draft.taskType, handleAttachChartBlob]);

  // Close Lightbox on Escape key
  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleAttachChartBlob(file);
    }
    e.target.value = '';
  };

  const handleRemoveChartImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isHistoryMode) return;
    setDraft((prev) => ({
      ...prev,
      chartImageDataUrl: null,
    }));
  };

  // Pick a random prompt for the given taskType (avoiding current prompt)
  const applyRandomPrompt = (targetTaskType: WritingTaskType) => {
    const pool = MASTER_WRITING_PROMPTS.filter(
      (p) => p.taskType === targetTaskType && p.prompt !== draft.prompt
    );
    const chosen =
      pool[Math.floor(Math.random() * pool.length)] ||
      MASTER_WRITING_PROMPTS.find((p) => p.taskType === targetTaskType) ||
      DEFAULT_TASK2_PROMPT;

    setDraft({
      taskType: targetTaskType,
      topicTag: chosen.topicTag,
      prompt: chosen.prompt,
      chartImageDataUrl: null,
      essay: '',
      gradedReportId: null,
    });
    setConfirmAction(null);
    setErrorMsg(null);
  };

  const handleRequestRandomPrompt = () => {
    if (isHistoryMode) return;
    if (draftWordCount > 10) {
      setConfirmAction('random-prompt');
    } else {
      applyRandomPrompt(draft.taskType);
    }
  };

  const handleTaskTypeSwitch = (nextType: WritingTaskType) => {
    if (isHistoryMode || nextType === draft.taskType) return;
    const isPresetPrompt = MASTER_WRITING_PROMPTS.some(
      (p) => p.prompt === draft.prompt
    );
    if (isPresetPrompt && draftWordCount === 0) {
      const firstForType = MASTER_WRITING_PROMPTS.find(
        (p) => p.taskType === nextType
      );
      if (firstForType) {
        setDraft((prev) => ({
          ...prev,
          taskType: nextType,
          topicTag: firstForType.topicTag,
          prompt: firstForType.prompt,
          gradedReportId: null,
        }));
        return;
      }
    }
    setDraft((prev) => ({
      ...prev,
      taskType: nextType,
    }));
  };

  const handlePromptChange = (newPromptText: string) => {
    if (isHistoryMode) return;
    const matchedPreset = MASTER_WRITING_PROMPTS.find(
      (p) => p.prompt.trim() === newPromptText.trim()
    );
    setDraft((prev) => ({
      ...prev,
      prompt: newPromptText,
      topicTag: matchedPreset ? matchedPreset.topicTag : '自选 · Custom',
    }));
  };

  const handleEssayChange = (newEssayText: string) => {
    if (isHistoryMode) return;
    setDraft((prev) => ({
      ...prev,
      essay: newEssayText,
    }));
  };

  const handleStartNewSheet = (force = false) => {
    if (!force && viewMode === 'draft' && draftWordCount > 10 && !draftReport) {
      setConfirmAction('new-sheet');
      return;
    }
    setViewMode('draft');
    const pool = MASTER_WRITING_PROMPTS.filter(
      (p) => p.taskType === draft.taskType && p.prompt !== draft.prompt
    );
    const nextPrompt = pool[0] || DEFAULT_TASK2_PROMPT;
    setDraft({
      taskType: draft.taskType,
      topicTag: nextPrompt.topicTag,
      prompt: nextPrompt.prompt,
      chartImageDataUrl: null,
      essay: '',
      gradedReportId: null,
    });
    setConfirmAction(null);
    setErrorMsg(null);
  };

  const handleEvaluateDraft = async () => {
    if (isHistoryMode) return;
    setErrorMsg(null);
    if (!draft.prompt.trim() || draftWordCount < 10) {
      setErrorMsg('请先填写题目与至少 10 个词的正文');
      return;
    }

    setIsEvaluating(true);
    try {
      let newReport: WritingEvaluationReport;
      if (aiConfig.apiKey.trim()) {
        newReport = await evaluateIeltsWriting({
          taskType: draft.taskType,
          prompt: draft.prompt.trim(),
          essay: draft.essay.trim(),
          apiKey: aiConfig.apiKey,
          endpoint: aiConfig.endpoint,
          model: aiConfig.model,
        });
      } else {
        await new Promise((r) => setTimeout(r, 500));
        newReport = generateOfflineDiagnosticReport(
          draft.taskType,
          draft.prompt.trim(),
          draft.essay.trim()
        );
      }

      const enrichedReport: WritingEvaluationReport = {
        ...newReport,
        topicTag: draft.topicTag,
        chartImageDataUrl:
          draft.taskType === 'task1' ? draft.chartImageDataUrl || null : null,
      };

      onSaveReport(enrichedReport);
      setDraft((prev) => ({
        ...prev,
        gradedReportId: enrichedReport.id,
      }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '批改失败，请检查 DeepSeek Key';
      setErrorMsg(msg);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleEnterHistoryMode = () => {
    if (reports.length === 0) return;
    setHistoryIndex(0);
    setViewMode('history');
    setConfirmAction(null);
    setErrorMsg(null);
  };

  const handleReturnToDraft = () => {
    setViewMode('draft');
    setConfirmAction(null);
    setErrorMsg(null);
  };

  const activeRightReport = isHistoryMode ? activeHistoryReport : draftReport;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-2">
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
        {/* LEFT SHEET: Smartisan Cream Writing Pad (Draft Mode or History Read-Only Manuscript) */}
        <section className="skeuo-paper relative flex min-h-[680px] flex-col overflow-hidden rounded-2xl">
          {/* Smartisan Vintage Double Crimson Header Rule */}
          <div className="pt-4">
            <div className="h-[2px] w-full bg-[#C97A63]/35" />
            <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
          </div>

          {/* Top Bar: Mechanical Toggle (Task 1 / Task 2) + Topic Stamp + Right Micro-Switch */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-7 pt-5 pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Task 1 / Task 2 Mechanical Switch */}
              <div className="skeuo-groove inline-flex items-center rounded-lg p-0.5">
                <button
                  type="button"
                  disabled={isHistoryMode}
                  onClick={() => handleTaskTypeSwitch('task1')}
                  className={`rounded-md px-3 py-1 font-mono text-xs transition-all ${
                    displayedTaskType === 'task1'
                      ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                      : 'text-[#7A7873] hover:text-[#262523]'
                  } ${isHistoryMode ? 'cursor-default' : ''}`}
                >
                  Task 1
                </button>
                <button
                  type="button"
                  disabled={isHistoryMode}
                  onClick={() => handleTaskTypeSwitch('task2')}
                  className={`rounded-md px-3 py-1 font-mono text-xs transition-all ${
                    displayedTaskType === 'task2'
                      ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                      : 'text-[#7A7873] hover:text-[#262523]'
                  } ${isHistoryMode ? 'cursor-default' : ''}`}
                >
                  Task 2
                </button>
              </div>

              {/* Topic Classification Stamp */}
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#D8D4C8] bg-[#F3F0E6] px-2.5 py-1 font-mono text-[11px] text-[#7A7873] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <Tag className="h-3 w-3 text-[#EA5B25]" />
                <span>{displayedTopicTag}</span>
              </span>
            </div>

            {/* Top-Right of Prompt: Random Prompt Micro-Switch (Draft) or Read-Only Badge (History) */}
            {isHistoryMode ? (
              <span className="rounded border border-[#D5D1C6] bg-[#EFECE4] px-2.5 py-1 font-mono text-[11px] text-[#7A7873]">
                历史原卷 · 只读复盘
              </span>
            ) : (
              <button
                type="button"
                onClick={handleRequestRandomPrompt}
                className="skeuo-btn-light inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#262523]"
                title="从内置雅思母题库随机切换一道真题"
              >
                <Dices className="h-3.5 w-3.5 text-[#EA5B25]" />
                <span>随机换题</span>
              </button>
            )}
          </div>

          {/* Anti-Accidental-Loss Lightweight Confirmation Bar */}
          {confirmAction && !isHistoryMode && (
            <div className="mx-7 mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#DFC5B8] bg-[#F9EFEA] px-4 py-2.5 text-xs text-[#262523] shadow-sm">
              <span>当前正文已有内容，换题将清空，是否继续？</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="skeuo-btn-light rounded-lg px-2.5 py-1 text-[11px] font-medium"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() =>
                    confirmAction === 'random-prompt'
                      ? applyRandomPrompt(draft.taskType)
                      : handleStartNewSheet(true)
                  }
                  className="skeuo-btn-orange rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                >
                  继续
                </button>
              </div>
            </div>
          )}

          {/* Prompt Input Area */}
          <div className="px-7 pb-3">
            <textarea
              rows={3}
              readOnly={isHistoryMode}
              value={displayedPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder="在此输入或粘贴雅思作文题目..."
              aria-label="作文题目"
              className={`w-full resize-none bg-transparent font-serif text-sm leading-relaxed text-[#7A7873] placeholder-[#B5B1A6] focus:text-[#262523] focus:outline-none ${
                isHistoryMode ? 'cursor-default select-text' : ''
              }`}
            />
          </div>

          {/* Task 1 Exclusive Chart Paste & Upload Slot */}
          {displayedTaskType === 'task1' && (
            <div className="px-7 pb-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInputChange}
                className="hidden"
              />

              {displayedChartImage ? (
                /* Tactile Photo Card when chart image is attached */
                <div
                  onClick={() => setIsLightboxOpen(true)}
                  className="group relative cursor-zoom-in overflow-hidden rounded-xl border border-[#D8D4C8] bg-[#F5F2EA] p-2 shadow-[0_3px_10px_rgba(38,37,35,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:border-[#C2BDB0]"
                  title="点击放大查看图表细节"
                >
                  <img
                    src={displayedChartImage}
                    alt="Task 1 Chart"
                    className="max-h-48 w-full rounded-lg object-contain bg-white/80"
                  />

                  {/* Subtle Zoom Hint Pill */}
                  <span className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-md bg-[#262523]/75 px-2 py-0.5 font-mono text-[10px] text-[#FAF8F2] opacity-0 transition-opacity group-hover:opacity-100">
                    <ZoomIn className="h-3 w-3" />
                    <span>点击放大</span>
                  </span>

                  {/* Minimalist Top-Right Delete Button [×] */}
                  {!isHistoryMode && (
                    <button
                      type="button"
                      onClick={handleRemoveChartImage}
                      className="skeuo-btn-light absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-[#7A7873] hover:text-[#EA5B25]"
                      title="移除图表"
                      aria-label="移除图表"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                /* Recessed Chart Drop/Paste Slot in Draft Mode */
                !isHistoryMode && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#CFCBC0] bg-[#F3F0E6]/65 py-3 px-4 text-xs text-[#7A7873] shadow-[inset_0_1px_3px_rgba(38,37,35,0.04)] transition hover:border-[#B8B3A6] hover:bg-[#EFECE2] hover:text-[#262523]"
                  >
                    <ImagePlus className="h-4 w-4 text-[#EA5B25]" />
                    <span>
                      直接按 <kbd className="font-mono font-semibold">Ctrl + V</kbd> 粘贴图表截图，或点击上传本地图片
                    </span>
                  </button>
                )
              )}
            </div>
          )}

          {/* Fine Dashed Divider */}
          <div className="mx-7 border-t border-dashed border-[#D5D1C6]" />

          {/* Main Essay Writing Pad */}
          <div className="flex flex-1 flex-col px-7 pt-5 pb-4">
            <textarea
              readOnly={isHistoryMode}
              value={displayedEssay}
              onChange={(e) => handleEssayChange(e.target.value)}
              placeholder="在此开始书写正文..."
              aria-label="作文正文"
              className={`w-full flex-1 resize-none bg-transparent font-serif text-[15px] leading-[1.85] text-[#262523] placeholder-[#B5B1A6] focus:outline-none ${
                isHistoryMode ? 'cursor-default select-text opacity-90' : ''
              }`}
            />
          </div>

          {/* Bottom Bar of Left Sheet */}
          <div className="flex items-center justify-between gap-4 border-t border-[#ECE9E0] bg-[#F6F3EB]/60 px-7 py-4">
            <div className="text-xs text-[#EA5B25]">
              {!isHistoryMode && errorMsg ? errorMsg : ''}
            </div>

            <div className="flex items-center gap-4">
              <span className="font-mono text-xs tracking-wide text-[#7A7873]">
                {displayedWordCount} words
              </span>

              {!isHistoryMode && (
                <button
                  type="button"
                  disabled={isEvaluating}
                  onClick={handleEvaluateDraft}
                  className="skeuo-btn-orange inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold tracking-wide disabled:opacity-60"
                >
                  {isEvaluating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>批改中</span>
                    </>
                  ) : (
                    <span>交卷批改</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT SHEET: Clean Waiting Board OR Printed Examiner Score Sheet */}
        {activeRightReport ? (
          <section className="skeuo-paper relative flex min-h-[680px] flex-col justify-between overflow-hidden rounded-2xl">
            {/* History Mode Top Bar OR Draft Graded Top Bar */}
            {isHistoryMode ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DFD5] bg-[#EFECE3] px-6 py-3">
                {/* Compact History Pager: [ < ] 02 / 05 篇 [ > ] */}
                <div className="flex items-center gap-1.5 font-mono text-xs text-[#262523]">
                  <button
                    type="button"
                    disabled={safeHistoryIndex >= reports.length - 1}
                    onClick={() =>
                      setHistoryIndex((prev) =>
                        Math.min(reports.length - 1, prev + 1)
                      )
                    }
                    className="skeuo-btn-light flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-35"
                    title="上一篇（更早）"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-1.5 text-[11px] font-semibold">
                    {String(reports.length - safeHistoryIndex).padStart(2, '0')}{' '}
                    / {String(reports.length).padStart(2, '0')} 篇
                  </span>
                  <button
                    type="button"
                    disabled={safeHistoryIndex <= 0}
                    onClick={() =>
                      setHistoryIndex((prev) => Math.max(0, prev - 1))
                    }
                    className="skeuo-btn-light flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-35"
                    title="下一篇（更新）"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Prominent Core Exit: [ ← 返回当前写作草稿 ] */}
                <button
                  type="button"
                  onClick={handleReturnToDraft}
                  className="skeuo-btn-dark inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-medium"
                >
                  <ArrowLeft className="h-3.5 w-3.5 text-[#EA5B25]" />
                  <span>返回当前写作草稿</span>
                </button>

                {/* Minimalist [ ＋ 写篇新的 ] */}
                <button
                  type="button"
                  onClick={() => handleStartNewSheet(true)}
                  className="skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#262523]"
                >
                  <Plus className="h-3.5 w-3.5 text-[#EA5B25]" />
                  <span>写篇新的</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between border-b border-[#E2DFD5] bg-[#EFECE3]/60 px-8 py-2.5">
                <span className="font-mono text-[11px] text-[#7A7873]">
                  当前草稿批改报告 ·{' '}
                  {new Date(activeRightReport.createdAt).toLocaleTimeString(
                    'zh-CN',
                    {
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleStartNewSheet(true)}
                  className="skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[#262523]"
                >
                  <Plus className="h-3.5 w-3.5 text-[#EA5B25]" />
                  <span>写篇新的</span>
                </button>
              </div>
            )}

            {/* Top Printed Mechanical Score Header */}
            <div className="border-b border-[#E2DFD5] bg-[#F5F2EA]/70 px-8 py-5">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#7A7873]">
                    IELTS OFFICIAL DIAGNOSTIC SHEET
                  </div>
                  <div className="mt-1 font-mono text-3xl font-bold tracking-tight text-[#262523]">
                    BAND {activeRightReport.overallBand.toFixed(1)}
                  </div>
                </div>

                {/* 4 Sub-scores Mechanical Stamp */}
                <div className="flex items-center gap-4 font-mono">
                  <div className="text-right">
                    <div className="text-[10px] text-[#7A7873]">
                      {activeRightReport.taskType === 'task1' ? 'TA' : 'TR'}
                    </div>
                    <div className="text-sm font-semibold text-[#262523]">
                      {activeRightReport.trTa.band.toFixed(1)}
                    </div>
                  </div>
                  <div className="h-6 w-[1px] bg-[#DCD8CE]" />
                  <div className="text-right">
                    <div className="text-[10px] text-[#7A7873]">CC</div>
                    <div className="text-sm font-semibold text-[#262523]">
                      {activeRightReport.cc.band.toFixed(1)}
                    </div>
                  </div>
                  <div className="h-6 w-[1px] bg-[#DCD8CE]" />
                  <div className="text-right">
                    <div className="text-[10px] text-[#7A7873]">LR</div>
                    <div className="text-sm font-semibold text-[#262523]">
                      {activeRightReport.lr.band.toFixed(1)}
                    </div>
                  </div>
                  <div className="h-6 w-[1px] bg-[#DCD8CE]" />
                  <div className="text-right">
                    <div className="text-[10px] text-[#7A7873]">GRA</div>
                    <div className="text-sm font-semibold text-[#262523]">
                      {activeRightReport.gra.band.toFixed(1)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Printed Examiner Feedback Body */}
            <div className="max-h-[470px] flex-1 space-y-6 overflow-y-auto px-8 py-6 text-xs leading-relaxed text-[#262523]">
              {/* Four Criteria Summaries */}
              <div className="space-y-3.5">
                <div>
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                    01 ·{' '}
                    {activeRightReport.taskType === 'task1'
                      ? 'TA 任务完成度与总体趋势概括'
                      : 'TR 任务回应与立意'}{' '}
                    ({activeRightReport.trTa.band.toFixed(1)})
                  </div>
                  <p className="mt-1 text-[#262523]">
                    {activeRightReport.trTa.summary}
                  </p>
                </div>

                <div>
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                    02 · CC 逻辑连贯与衔接 ({activeRightReport.cc.band.toFixed(1)})
                  </div>
                  <p className="mt-1 text-[#262523]">
                    {activeRightReport.cc.summary}
                  </p>
                </div>

                <div>
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                    03 · LR{' '}
                    {activeRightReport.taskType === 'task1'
                      ? '趋势词汇与静态对比表达'
                      : '词汇丰富度与同义替换'}{' '}
                    ({activeRightReport.lr.band.toFixed(1)})
                  </div>
                  <p className="mt-1 text-[#262523]">
                    {activeRightReport.lr.summary}
                  </p>
                  {activeRightReport.lr.paraphrasingUpgrades.length > 0 && (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-[#E2DFD5] bg-[#F5F2EA]/70 p-3">
                      {activeRightReport.lr.paraphrasingUpgrades.map(
                        (item, i) => (
                          <div key={i} className="font-serif text-xs">
                            <span className="text-[#7A7873] line-through">
                              {item.original}
                            </span>
                            <span className="mx-2 text-[#7A7873]">→</span>
                            <span className="font-semibold text-[#262523]">
                              {item.upgraded}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                    04 · GRA 语法多样性与句子修正 ({activeRightReport.gra.band.toFixed(1)})
                  </div>
                  <p className="mt-1 text-[#262523]">
                    {activeRightReport.gra.summary}
                  </p>
                </div>
              </div>

              {/* Sentence Corrections Comparison */}
              {activeRightReport.gra.errorCorrections.length > 0 && (
                <div className="space-y-3 border-t border-dashed border-[#D5D1C6] pt-4">
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                    SENTENCE CORRECTIONS · 句子修改对照
                  </div>
                  {activeRightReport.gra.errorCorrections.map((corr, idx) => (
                    <div
                      key={idx}
                      className="space-y-1.5 rounded-lg border border-[#E2DFD5] bg-[#F5F2EA]/60 p-3.5"
                    >
                      <p className="font-serif text-xs text-[#EA5B25] line-through">
                        {corr.original}
                      </p>
                      <p className="font-serif text-xs font-medium text-[#262523]">
                        {corr.corrected}
                      </p>
                      <p className="text-[11px] text-[#7A7873]">
                        {corr.explanation}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Footer of Right Score Sheet */}
            <div className="flex items-center justify-between border-t border-[#ECE9E0] bg-[#F6F3EB]/60 px-8 py-3 text-[11px] font-mono text-[#7A7873]">
              <span>
                {new Date(activeRightReport.createdAt).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>

              {!isHistoryMode && reports.length > 0 && (
                <button
                  type="button"
                  onClick={handleEnterHistoryMode}
                  className="skeuo-btn-light rounded-lg px-3 py-1 font-mono text-[11px] text-[#7A7873] hover:text-[#262523]"
                >
                  历史批改 ({reports.length})
                </button>
              )}
            </div>
          </section>
        ) : (
          /* Idle Draft State: Clean Recessed Blank Backplate with Bottom-Right [ 历史批改 (数量) ] */
          <section className="skeuo-recessed-board relative flex min-h-[680px] flex-col items-center justify-center rounded-2xl p-8 select-none">
            <div className="text-center font-mono text-xs tracking-[0.18em] text-[#7A7873]/60">
              READY FOR ASSESSMENT
            </div>

            {reports.length > 0 && (
              <button
                type="button"
                onClick={handleEnterHistoryMode}
                className="skeuo-btn-light absolute bottom-5 right-6 rounded-lg px-3.5 py-1.5 font-mono text-xs text-[#262523]"
              >
                历史批改 ({reports.length})
              </button>
            )}
          </section>
        )}
      </div>

      {/* Lightbox Zoom Modal for Task 1 Chart Image */}
      {isLightboxOpen && displayedChartImage && (
        <div
          onClick={() => setIsLightboxOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#262523]/70 p-6 backdrop-blur-[2px] cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label="放大查看图表"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="skeuo-paper relative max-h-[90vh] max-w-5xl overflow-auto rounded-2xl p-4 cursor-default"
          >
            <button
              type="button"
              onClick={() => setIsLightboxOpen(false)}
              className="skeuo-btn-light absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-[#262523] hover:text-[#EA5B25]"
              title="关闭放大视图 (Esc)"
              aria-label="关闭放大视图"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={displayedChartImage}
              alt="Task 1 Chart Enlarged"
              className="mx-auto max-h-[82vh] w-auto rounded-lg object-contain bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};
