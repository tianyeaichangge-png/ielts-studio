import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  ArrowLeft,
  Plus,
  Tag,
  ImagePlus,
  X,
  ZoomIn,
  Play,
  Pause,
  RotateCcw,
  Clock,
  Check,
  Lock,
} from 'lucide-react';
import {
  DeepSeekConfig,
  GrammarCorrectionItem,
  LexicalUpgradeItem,
  TimerMode,
  VocabularyCard,
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
import {
  MASTER_WRITING_PROMPTS,
  MasterWritingPrompt,
} from '../lib/samplePrompts';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface WritingModuleProps {
  aiConfig: DeepSeekConfig;
  reports: WritingEvaluationReport[];
  onSaveReport: (report: WritingEvaluationReport) => void;
  vocabCards: VocabularyCard[];
  onIngestVocab: (
    newCard: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>
  ) => void;
}

type ViewMode = 'draft' | 'history';

const DEFAULT_TASK2_PROMPT = MASTER_WRITING_PROMPTS[0];

const TASK2_CATEGORY_FILTERS = [
  { key: 'all', label: '全部' },
  { key: '教育', label: '教育' },
  { key: '科技', label: '科技' },
  { key: '环保', label: '环境' },
  { key: '政府', label: '政府' },
  { key: '犯罪与社会', label: '社会' },
  { key: '传统文化', label: '文化' },
] as const;

const TASK1_CATEGORY_FILTERS = [
  { key: 'all', label: '全部' },
  { key: '折线图', label: '折线图' },
  { key: '柱状图', label: '柱状图' },
  { key: '流程图', label: '流程图' },
  { key: '地图', label: '地图' },
] as const;

const TIMER_MODE_SECONDS: Record<TimerMode, number> = {
  'task2-40m': 40 * 60,
  'task1-20m': 20 * 60,
  free: 0,
};

function formatTimerDisplay(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Extracts the primary vocabulary headword/phrase and synonyms from an upgraded string
 * such as "indispensable / paramount"
 */
function parseUpgradedParts(upgradedRaw: string): {
  headword: string;
  extraSynonyms: string[];
} {
  const parts = upgradedRaw
    .split(/\s*[/|;，,]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const headword = parts[0] || upgradedRaw.trim();
  const extraSynonyms = parts.slice(1);
  return { headword, extraSynonyms };
}

/**
 * Finds the best matching sentence from the user's essay containing the target snippet
 */
function findMatchingSentenceInEssay(
  essayText: string,
  snippet: string
): string {
  const sentences = essayText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    return snippet || 'Mastering this expression elevates lexical resource in IELTS Writing.';
  }
  const cleanSnippet = snippet
    .split(/\s*[/|]\s*/)[0]
    .trim()
    .toLowerCase();
  if (cleanSnippet && cleanSnippet.length >= 3) {
    const matched = sentences.find((s) =>
      s.toLowerCase().includes(cleanSnippet)
    );
    if (matched) return matched;
  }
  return sentences[0];
}

export const WritingModule: React.FC<WritingModuleProps> = ({
  aiConfig,
  reports,
  onSaveReport,
  vocabCards,
  onIngestVocab,
}) => {
  // 1. Silent Real-Time Persistent Draft in localStorage
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

  // 3. Braun Mechanical Timer State
  const [timerMode, setTimerMode] = useState<TimerMode>(
    draft.taskType === 'task1' ? 'task1-20m' : 'task2-40m'
  );
  const [secondsLeft, setSecondsLeft] = useState<number>(
    draft.taskType === 'task1'
      ? TIMER_MODE_SECONDS['task1-20m']
      : TIMER_MODE_SECONDS['task2-40m']
  );
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [isTimeUpLocked, setIsTimeUpLocked] = useState<boolean>(false);
  const [timedCompletedWords, setTimedCompletedWords] = useState<number | null>(
    null
  );

  // 4. Topic Index Sheet (题目目录) State
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [pendingPromptSelection, setPendingPromptSelection] =
    useState<MasterWritingPrompt | null>(null);

  // Anti-accidental-loss confirmation state for "写篇新的"
  const [confirmNewSheet, setConfirmNewSheet] = useState(false);

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

  // Set of normalized words already in vocabCards for instant [ ✓ 已收录 ] state
  const existingVocabSet = useMemo(() => {
    return new Set(vocabCards.map((c) => c.word.trim().toLowerCase()));
  }, [vocabCards]);

  // Braun Mechanical Timer Tick Effect
  useEffect(() => {
    if (!isTimerRunning || timerMode === 'free' || isHistoryMode) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setIsTimerRunning(false);
          setIsTimeUpLocked(true);
          setTimedCompletedWords(countWords(draft.essay));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isTimerRunning, timerMode, isHistoryMode, draft.essay]);

  const handleSelectTimerMode = (nextMode: TimerMode) => {
    setTimerMode(nextMode);
    setIsTimerRunning(false);
    setIsTimeUpLocked(false);
    setTimedCompletedWords(null);
    setSecondsLeft(TIMER_MODE_SECONDS[nextMode]);
  };

  const handleResetTimer = () => {
    if (timerMode === 'free') return;
    setIsTimerRunning(false);
    setIsTimeUpLocked(false);
    setTimedCompletedWords(null);
    setSecondsLeft(TIMER_MODE_SECONDS[timerMode]);
  };

  // Prompts for the current taskType
  const taskPrompts = useMemo(
    () =>
      MASTER_WRITING_PROMPTS.filter((p) => p.taskType === draft.taskType),
    [draft.taskType]
  );

  const filteredCatalogPrompts = useMemo(() => {
    if (selectedCategory === 'all') return taskPrompts;
    return taskPrompts.filter((p) => p.topicTag.includes(selectedCategory));
  }, [taskPrompts, selectedCategory]);

  const categoryFilters =
    draft.taskType === 'task1'
      ? TASK1_CATEGORY_FILTERS
      : TASK2_CATEGORY_FILTERS;

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
    if (isHistoryMode || draft.taskType !== 'task1' || isCatalogOpen) return;

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
  }, [isHistoryMode, draft.taskType, isCatalogOpen, handleAttachChartBlob]);

  // Close Lightbox or Topic Index Sheet on Escape key
  useEffect(() => {
    if (!isLightboxOpen && !isCatalogOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLightboxOpen) setIsLightboxOpen(false);
        if (isCatalogOpen) {
          setIsCatalogOpen(false);
          setPendingPromptSelection(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, isCatalogOpen]);

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

  // Apply a selected prompt from the Topic Index Sheet
  const applyPromptItem = (item: MasterWritingPrompt) => {
    setDraft({
      taskType: item.taskType,
      topicTag: item.topicTag,
      prompt: item.prompt,
      chartImageDataUrl: null,
      essay: '',
      gradedReportId: null,
    });
    const nextTimerMode: TimerMode =
      item.taskType === 'task1' ? 'task1-20m' : 'task2-40m';
    if (timerMode !== 'free') {
      setTimerMode(nextTimerMode);
      setSecondsLeft(TIMER_MODE_SECONDS[nextTimerMode]);
      setIsTimerRunning(false);
    }
    setIsTimeUpLocked(false);
    setTimedCompletedWords(null);
    setPendingPromptSelection(null);
    setIsCatalogOpen(false);
    setConfirmNewSheet(false);
    setErrorMsg(null);
  };

  const handleSelectFromCatalog = (item: MasterWritingPrompt) => {
    if (item.prompt.trim() === draft.prompt.trim()) {
      setPendingPromptSelection(null);
      setIsCatalogOpen(false);
      return;
    }

    if (draftWordCount > 10) {
      setPendingPromptSelection(item);
      return;
    }

    applyPromptItem(item);
  };

  const handleOpenCatalog = () => {
    if (isHistoryMode) return;
    setSelectedCategory('all');
    setPendingPromptSelection(null);
    setIsCatalogOpen(true);
  };

  const handleTaskTypeSwitch = (nextType: WritingTaskType) => {
    if (isHistoryMode || nextType === draft.taskType) return;
    setSelectedCategory('all');

    // Sync timer mode if timer hasn't started ticking
    if (!isTimerRunning && timerMode !== 'free') {
      const targetMode: TimerMode =
        nextType === 'task1' ? 'task1-20m' : 'task2-40m';
      setTimerMode(targetMode);
      setSecondsLeft(TIMER_MODE_SECONDS[targetMode]);
      setIsTimeUpLocked(false);
      setTimedCompletedWords(null);
    }

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
    if (isHistoryMode || isTimeUpLocked) return;
    setDraft((prev) => ({
      ...prev,
      essay: newEssayText,
    }));
  };

  const handleStartNewSheet = (force = false) => {
    if (!force && viewMode === 'draft' && draftWordCount > 10 && !draftReport) {
      setConfirmNewSheet(true);
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
    if (timerMode !== 'free') {
      setSecondsLeft(TIMER_MODE_SECONDS[timerMode]);
      setIsTimerRunning(false);
    }
    setIsTimeUpLocked(false);
    setTimedCompletedWords(null);
    setConfirmNewSheet(false);
    setErrorMsg(null);
  };

  const handleEvaluateDraft = async () => {
    if (isHistoryMode) return;
    setErrorMsg(null);
    if (!draft.prompt.trim() || draftWordCount < 10) {
      setErrorMsg('请先填写题目与至少 10 个词的正文');
      return;
    }

    setIsTimerRunning(false);
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
    setIsTimerRunning(false);
    setHistoryIndex(0);
    setViewMode('history');
    setConfirmNewSheet(false);
    setErrorMsg(null);
  };

  const handleReturnToDraft = () => {
    setViewMode('draft');
    setConfirmNewSheet(false);
    setErrorMsg(null);
  };

  const activeRightReport = isHistoryMode ? activeHistoryReport : draftReport;

  // Vocabulary Ingestion from LR Paraphrasing Upgrade Item
  const handleIngestLexicalItem = (
    item: LexicalUpgradeItem,
    report: WritingEvaluationReport
  ) => {
    const { headword, extraSynonyms } = parseUpgradedParts(item.upgraded);
    const originalTerms = item.original
      .split(/\s*[/|]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const paraphrasingList = Array.from(
      new Set([...extraSynonyms, ...originalTerms])
    ).filter((s) => s.toLowerCase() !== headword.toLowerCase());

    const userSentence = findMatchingSentenceInEssay(
      report.essay,
      item.original
    );

    onIngestVocab({
      word: headword,
      phonetic: headword.includes(' ') ? '/phrase/' : '/academic/',
      partOfSpeech: headword.includes(' ') ? 'phrase' : 'acad.',
      chineseMeaning:
        item.chineseMeaning ||
        `高分替换：${item.original}（${item.contextExplanation.slice(0, 26)}）`,
      englishDefinition: item.contextExplanation,
      paraphrasing:
        paraphrasingList.length > 0 ? paraphrasingList : [item.original],
      exampleSentence: userSentence,
      exampleTranslation: `原句语境替换：建议将 “${item.original}” 升级为 “${item.upgraded}”。`,
      topicTag: report.topicTag || '来自写作批改',
      isCustom: true,
      fromWriting: true,
    });
  };

  // Vocabulary Ingestion from GRA Sentence Correction Item
  const handleIngestCorrectionItem = (
    corr: GrammarCorrectionItem,
    report: WritingEvaluationReport
  ) => {
    const targetPhrase = (
      corr.keyExpression ||
      corr.corrected.split(',')[0] ||
      corr.corrected
    ).trim();

    onIngestVocab({
      word: targetPhrase,
      phonetic: '/collocation/',
      partOfSpeech: 'expr.',
      chineseMeaning: corr.chineseMeaning || corr.errorType,
      englishDefinition: corr.explanation,
      paraphrasing: [corr.original.slice(0, 48)],
      exampleSentence: corr.corrected,
      exampleTranslation: `原句对比：${corr.original}`,
      topicTag: report.topicTag || '来自写作批改',
      isCustom: true,
      fromWriting: true,
    });
  };

  // Warning state when <= 5 minutes left (300s) and > 0
  const isFinalFiveMinutes =
    timerMode !== 'free' && secondsLeft > 0 && secondsLeft <= 300;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-2">
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
        {/* LEFT SHEET: Smartisan Cream Writing Pad (Draft Mode or History Read-Only Manuscript) */}
        <section
          className={`skeuo-paper relative flex min-h-[680px] flex-col overflow-hidden rounded-2xl transition-shadow ${
            isTimeUpLocked && !isHistoryMode
              ? 'ring-2 ring-[#EA5B25]/45'
              : ''
          }`}
        >
          {/* Smartisan Vintage Double Crimson Header Rule */}
          <div className="pt-4">
            <div className="h-[2px] w-full bg-[#C97A63]/35" />
            <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
          </div>

          {/* Top Bar: Mechanical Toggle (Task 1 / Task 2) + Braun Mechanical Timer + Right [ 📑 题目目录 ] */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-7 pt-4 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Task 1 / Task 2 Mechanical Switch */}
              <div className="skeuo-groove inline-flex items-center rounded-lg p-0.5">
                <button
                  type="button"
                  disabled={isHistoryMode}
                  onClick={() => handleTaskTypeSwitch('task1')}
                  className={`rounded-md px-2.5 py-1 font-mono text-xs transition-all ${
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
                  className={`rounded-md px-2.5 py-1 font-mono text-xs transition-all ${
                    displayedTaskType === 'task2'
                      ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                      : 'text-[#7A7873] hover:text-[#262523]'
                  } ${isHistoryMode ? 'cursor-default' : ''}`}
                >
                  Task 2
                </button>
              </div>

              {/* BRAUN MECHANICAL TIMER MODULE */}
              {!isHistoryMode && (
                <div className="skeuo-groove inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5">
                  <Clock className="h-3 w-3 text-[#7A7873]" />
                  <select
                    aria-label="考场计时模式"
                    value={timerMode}
                    onChange={(e) =>
                      handleSelectTimerMode(e.target.value as TimerMode)
                    }
                    className="bg-transparent font-mono text-[11px] font-medium text-[#262523] focus:outline-none cursor-pointer"
                  >
                    <option value="task2-40m">40m (Task 2)</option>
                    <option value="task1-20m">20m (Task 1)</option>
                    <option value="free">自由书写</option>
                  </select>

                  {timerMode !== 'free' && (
                    <>
                      <div className="h-3.5 w-[1px] bg-[#C5C1B5]" />
                      <span
                        className={`font-mono text-xs font-bold tracking-wider px-1 ${
                          isTimeUpLocked
                            ? 'text-[#EA5B25]'
                            : isFinalFiveMinutes
                            ? 'text-[#EA5B25] animate-pulse'
                            : 'text-[#262523]'
                        }`}
                        title={
                          isFinalFiveMinutes
                            ? '剩余不足 5 分钟，建议收尾总结段并检查拼写'
                            : '考场倒计时'
                        }
                      >
                        {formatTimerDisplay(secondsLeft)}
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          if (isTimeUpLocked) {
                            handleResetTimer();
                            setIsTimerRunning(true);
                          } else {
                            setIsTimerRunning((prev) => !prev);
                          }
                        }}
                        className="skeuo-btn-light flex h-5 w-5 items-center justify-center rounded text-[#262523] hover:text-[#EA5B25]"
                        title={isTimerRunning ? '暂停计时' : '启动考场倒计时'}
                        aria-label={isTimerRunning ? '暂停计时' : '启动计时'}
                      >
                        {isTimerRunning ? (
                          <Pause className="h-2.5 w-2.5" />
                        ) : (
                          <Play className="h-2.5 w-2.5 ml-0.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleResetTimer}
                        className="skeuo-btn-light flex h-5 w-5 items-center justify-center rounded text-[#7A7873] hover:text-[#262523]"
                        title="重置计时器"
                        aria-label="重置计时器"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right: Topic Stamp + [ 📑 题目目录 ] Button */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-[#D8D4C8] bg-[#F3F0E6] px-2 py-1 font-mono text-[10px] text-[#7A7873] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <Tag className="h-2.5 w-2.5 text-[#EA5B25]" />
                <span>{displayedTopicTag}</span>
              </span>

              {isHistoryMode ? (
                <span className="rounded border border-[#D5D1C6] bg-[#EFECE4] px-2.5 py-1 font-mono text-[11px] text-[#7A7873]">
                  历史原卷 · 只读复盘
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenCatalog}
                  className="skeuo-btn-light inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#262523]"
                  title="打开分类母题目录自主挑选题目"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[#EA5B25]" />
                  <span>题目目录</span>
                  <span className="ml-0.5 rounded bg-[#E6E3DA] px-1.5 py-0.2 font-mono text-[10px] font-semibold text-[#7A7873]">
                    {taskPrompts.length}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Time-Up Exam Lock Notice Banner */}
          {isTimeUpLocked && !isHistoryMode && (
            <div className="mx-7 mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#EA5B25]/40 bg-[#F9EFEA] px-4 py-2 text-xs text-[#262523] shadow-sm">
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-[#EA5B25]" />
                <span>
                  考场倒计时结束（00:00），正文已锁定，请点击右下角「交卷批改」。
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsTimeUpLocked(false)}
                className="skeuo-btn-light shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#7A7873] hover:text-[#262523]"
              >
                解锁继续写
              </button>
            </div>
          )}

          {/* Anti-Accidental-Loss Lightweight Confirmation Bar (for New Sheet) */}
          {confirmNewSheet && !isHistoryMode && (
            <div className="mx-7 mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#DFC5B8] bg-[#F9EFEA] px-4 py-2.5 text-xs text-[#262523] shadow-sm">
              <span>当前正文已有内容，更换题目将开启新篇，是否继续？</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmNewSheet(false)}
                  className="skeuo-btn-light rounded-lg px-2.5 py-1 text-[11px] font-medium"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => handleStartNewSheet(true)}
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
                      直接按{' '}
                      <kbd className="font-mono font-semibold">Ctrl + V</kbd>{' '}
                      粘贴图表截图，或点击上传本地图片
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
              readOnly={isHistoryMode || isTimeUpLocked}
              value={displayedEssay}
              onChange={(e) => handleEssayChange(e.target.value)}
              placeholder="在此开始书写正文..."
              aria-label="作文正文"
              className={`w-full flex-1 resize-none bg-transparent font-serif text-[15px] leading-[1.85] text-[#262523] placeholder-[#B5B1A6] focus:outline-none ${
                isHistoryMode || isTimeUpLocked
                  ? 'cursor-default select-text opacity-85'
                  : ''
              }`}
            />
          </div>

          {/* Bottom Bar of Left Sheet */}
          <div className="flex items-center justify-between gap-4 border-t border-[#ECE9E0] bg-[#F6F3EB]/60 px-7 py-4">
            <div className="text-xs text-[#EA5B25]">
              {!isHistoryMode && errorMsg ? errorMsg : ''}
            </div>

            <div className="flex items-center gap-4">
              {timedCompletedWords !== null && !isHistoryMode ? (
                <span className="rounded-md border border-[#DFC5B8] bg-[#F9EFEA] px-2.5 py-1 font-mono text-xs font-semibold text-[#EA5B25]">
                  考场限时完成：{timedCompletedWords} words
                </span>
              ) : (
                <span className="font-mono text-xs tracking-wide text-[#7A7873]">
                  {displayedWordCount} words
                </span>
              )}

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

                {/* 03 · LR with One-Click [ + 入库 ] Vocabulary Ingestion */}
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
                    <div className="mt-2.5 space-y-2 rounded-lg border border-[#E2DFD5] bg-[#F5F2EA]/70 p-3">
                      {activeRightReport.lr.paraphrasingUpgrades.map(
                        (item, i) => {
                          const { headword } = parseUpgradedParts(
                            item.upgraded
                          );
                          const isCollected = existingVocabSet.has(
                            headword.trim().toLowerCase()
                          );

                          return (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-2 border-b border-[#E7E4DA] pb-2 last:border-b-0 last:pb-0"
                            >
                              <div className="min-w-0 flex-1 font-serif text-xs">
                                <span className="text-[#7A7873] line-through">
                                  {item.original}
                                </span>
                                <span className="mx-2 text-[#7A7873]">→</span>
                                <span className="font-semibold text-[#262523]">
                                  {item.upgraded}
                                </span>
                                {item.chineseMeaning && (
                                  <span className="ml-2 font-sans text-[11px] text-[#7A7873]">
                                    ({item.chineseMeaning})
                                  </span>
                                )}
                              </div>

                              <button
                                type="button"
                                disabled={isCollected}
                                onClick={() =>
                                  handleIngestLexicalItem(
                                    item,
                                    activeRightReport
                                  )
                                }
                                className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-medium transition-all ${
                                  isCollected
                                    ? 'border border-[#D5D1C6] bg-[#EAE7DE] text-[#7A7873] cursor-default'
                                    : 'skeuo-btn-light text-[#262523] hover:text-[#EA5B25]'
                                }`}
                                title={
                                  isCollected
                                    ? '已收录至背单词卡片库'
                                    : '一键加入背单词生词库'
                                }
                              >
                                {isCollected ? (
                                  <span className="inline-flex items-center gap-0.5">
                                    <Check className="h-2.5 w-2.5 text-[#EA5B25]" />
                                    <span>已收录</span>
                                  </span>
                                ) : (
                                  <span>+ 入库</span>
                                )}
                              </button>
                            </div>
                          );
                        }
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

              {/* Sentence Corrections Comparison with One-Click [ + 入库 ] */}
              {activeRightReport.gra.errorCorrections.length > 0 && (
                <div className="space-y-3 border-t border-dashed border-[#D5D1C6] pt-4">
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                    SENTENCE CORRECTIONS · 句子修改对照
                  </div>
                  {activeRightReport.gra.errorCorrections.map((corr, idx) => {
                    const targetPhrase = (
                      corr.keyExpression ||
                      corr.corrected.split(',')[0] ||
                      corr.corrected
                    ).trim();
                    const isCollected = existingVocabSet.has(
                      targetPhrase.toLowerCase()
                    );

                    return (
                      <div
                        key={idx}
                        className="space-y-1.5 rounded-lg border border-[#E2DFD5] bg-[#F5F2EA]/60 p-3.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-serif text-xs text-[#EA5B25] line-through">
                            {corr.original}
                          </p>

                          <button
                            type="button"
                            disabled={isCollected}
                            onClick={() =>
                              handleIngestCorrectionItem(
                                corr,
                                activeRightReport
                              )
                            }
                            className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-medium transition-all ${
                              isCollected
                                ? 'border border-[#D5D1C6] bg-[#EAE7DE] text-[#7A7873] cursor-default'
                                : 'skeuo-btn-light text-[#262523] hover:text-[#EA5B25]'
                            }`}
                            title={
                              isCollected
                                ? '已收录至背单词卡片库'
                                : `将核心高分表达 "${targetPhrase}" 加入生词库`
                            }
                          >
                            {isCollected ? (
                              <span className="inline-flex items-center gap-0.5">
                                <Check className="h-2.5 w-2.5 text-[#EA5B25]" />
                                <span>已收录</span>
                              </span>
                            ) : (
                              <span>+ 入库</span>
                            )}
                          </button>
                        </div>

                        <p className="font-serif text-xs font-medium text-[#262523]">
                          {corr.corrected}
                        </p>
                        <p className="text-[11px] text-[#7A7873]">
                          {corr.explanation}
                        </p>
                      </div>
                    );
                  })}
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

      {/* TOPIC INDEX SHEET MODAL (拟物风格题目目录活页卡片) */}
      {isCatalogOpen && (
        <div
          onClick={() => {
            setIsCatalogOpen(false);
            setPendingPromptSelection(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#262523]/35 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="topic-catalog-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="skeuo-paper flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
          >
            {/* Smartisan Vintage Double Crimson Header Rule */}
            <div className="pt-3.5">
              <div className="h-[2px] w-full bg-[#C97A63]/35" />
              <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
            </div>

            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#E2DFD5] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                <h2
                  id="topic-catalog-title"
                  className="text-sm font-semibold tracking-tight text-[#262523]"
                >
                  {draft.taskType === 'task1'
                    ? 'Task 1 图表作文题库目录'
                    : 'Task 2 核心母题目录'}
                </h2>
                <span className="rounded bg-[#EAE7DE] px-2 py-0.5 font-mono text-[11px] text-[#7A7873]">
                  {filteredCatalogPrompts.length} / {taskPrompts.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsCatalogOpen(false);
                  setPendingPromptSelection(null);
                }}
                className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#262523]"
                aria-label="关闭题目目录"
                title="关闭 (Esc)"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Top Category Filter Pills */}
            <div className="border-b border-[#ECE9E0] bg-[#F5F2EA]/80 px-6 py-3">
              <div className="skeuo-groove flex flex-wrap items-center gap-1 rounded-xl p-1">
                {categoryFilters.map((cat) => {
                  const isActive = selectedCategory === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.key);
                        setPendingPromptSelection(null);
                      }}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                        isActive
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Anti-Accidental-Loss Confirmation Banner inside Topic Index Sheet */}
            {pendingPromptSelection && (
              <div className="mx-6 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DFC5B8] bg-[#F9EFEA] px-4 py-3 text-xs text-[#262523] shadow-sm">
                <span>当前正文已有内容，更换题目将开启新篇，是否继续？</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPendingPromptSelection(null)}
                    className="skeuo-btn-light rounded-lg px-3 py-1 text-[11px] font-medium"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPromptItem(pendingPromptSelection)}
                    className="skeuo-btn-orange rounded-lg px-3 py-1 text-[11px] font-semibold"
                  >
                    继续
                  </button>
                </div>
              </div>
            )}

            {/* Scrollable Prompt List Cards */}
            <div className="flex-1 space-y-2.5 overflow-y-auto px-6 py-4">
              {filteredCatalogPrompts.map((item) => {
                const globalIdx =
                  taskPrompts.findIndex((p) => p.id === item.id) + 1;
                const formattedNo = String(globalIdx).padStart(2, '0');
                const isCurrentActive =
                  item.prompt.trim() === draft.prompt.trim();
                const isPendingConfirm =
                  pendingPromptSelection?.id === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectFromCatalog(item)}
                    className={`group w-full rounded-xl border p-4 text-left transition-all ${
                      isCurrentActive
                        ? 'border-[#C8C3B4] bg-[#EFECE3] shadow-[inset_0_2px_4px_rgba(38,37,35,0.07)]'
                        : isPendingConfirm
                        ? 'border-[#EA5B25]/60 bg-[#F9EFEA]'
                        : 'border-[#E2DFD5] bg-[#FAF8F2] hover:border-[#C8C3B4] hover:bg-[#F5F2EA]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        {/* Question Number */}
                        <span className="font-mono text-xs font-semibold tracking-wider text-[#7A7873]">
                          NO. {formattedNo}
                        </span>

                        {/* Topic Tag Pill */}
                        <span className="inline-flex items-center gap-1 rounded border border-[#D8D4C8] bg-[#F3F0E6] px-2 py-0.5 font-mono text-[10px] text-[#7A7873]">
                          {item.topicTag}
                        </span>
                      </div>

                      {/* Braun Signal Orange Active Indicator Dot */}
                      {isCurrentActive ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#262523]">
                          <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                          <span>当前题目</span>
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-[#7A7873] opacity-0 transition-opacity group-hover:opacity-100">
                          点击选用 →
                        </span>
                      )}
                    </div>

                    {/* Full English Prompt Text in Serif */}
                    <p className="mt-2.5 font-serif text-sm leading-relaxed text-[#262523]">
                      {item.prompt}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
