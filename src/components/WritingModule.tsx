import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowLeft,
  Plus,
  ImagePlus,
  X,
  ZoomIn,
  Check,
  Lock,
  PenLine,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  DeepSeekConfig,
  GrammarCorrectionItem,
  LexicalUpgradeItem,
  Task1DraftState,
  Task2DraftState,
  VocabularyCard,
  WritingEvaluationReport,
  WritingTaskType,
} from '../types/ielts';
import {
  convertImageFileToDataUrl,
  countWords,
  evaluateIeltsWriting,
} from '../lib/geminiEvaluator';
import {
  MASTER_WRITING_PROMPTS,
  MasterWritingPrompt,
} from '../lib/samplePrompts';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface WritingModuleProps {
  aiConfig: DeepSeekConfig;
  task1Reports: WritingEvaluationReport[];
  task2Reports: WritingEvaluationReport[];
  onSaveReport: (report: WritingEvaluationReport) => void;
  onDeleteReport: (reportId: string, taskType: WritingTaskType) => void;
  vocabCards: VocabularyCard[];
  onIngestVocab: (
    newCard: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>
  ) => void;
  onOpenApiKeyModal?: () => void;
}

type ViewMode = 'draft' | 'history';

const TASK2_CATALOG_FILTERS = [
  { key: 'all', label: '全部' },
  { key: '教育', label: '教育' },
  { key: '科技', label: '科技' },
  { key: '环保', label: '环境' },
  { key: '政府与社会', label: '政府与社会' },
  { key: '传统文化', label: '文化' },
] as const;

function formatTimerDisplay(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formats "科技与未来 · Technology" into "TECHNOLOGY · 科技与未来" for the printed header stamp
 */
function formatPrintedStamp(topicTag: string): string {
  if (!topicTag) return 'ACADEMIC WRITING';
  const parts = topicTag.split('·').map((s) => s.trim());
  if (parts.length === 2) {
    const [zh, en] = parts;
    return `${en.toUpperCase()} · ${zh}`;
  }
  return topicTag.toUpperCase();
}

/**
 * Extracts the primary vocabulary headword/phrase and synonyms from an upgraded string
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
    return (
      snippet ||
      'Mastering this expression elevates lexical resource in IELTS Writing.'
    );
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
  task1Reports,
  task2Reports,
  onSaveReport,
  onDeleteReport,
  vocabCards,
  onIngestVocab,
  onOpenApiKeyModal,
}) => {
  // 1. Strictly Isolated Dual-Track LocalStorage States (Task 1 vs Task 2)
  const [activeTaskType, setActiveTaskType] = useLocalStorage<WritingTaskType>(
    'ielts_active_task_type',
    'task2'
  );

  // Task 1 Independent Draft ('ielts_draft_task1')
  const [task1Draft, setTask1Draft] = useLocalStorage<Task1DraftState>(
    'ielts_draft_task1',
    {
      prompt: '',
      image: null,
      content: '',
      timer: 1200,
      gradedReportId: null,
    }
  );

  // Task 2 Independent Draft ('ielts_draft_task2')
  const [task2Draft, setTask2Draft] = useLocalStorage<Task2DraftState>(
    'ielts_draft_task2',
    {
      selectedTopicId: 't2-tech-ai-jobs',
      customPrompt: '',
      content: '',
      timer: 2400,
      viewStep: 'catalog',
      gradedReportId: null,
    }
  );

  // 2. Strict Mode Isolation: 'draft' vs 'history' + History Drawer
  const [viewMode, setViewMode] = useState<ViewMode>('draft');
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] =
    useState<boolean>(false);

  // 3. Topic Catalog Filter State
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // 4. Anti-Accidental-Loss Confirmation State when returning to catalog
  const [confirmBackToCatalog, setConfirmBackToCatalog] = useState(false);

  // 5. Countdown Timer Runtime Flags (Remaining seconds are stored inside task1Draft.timer / task2Draft.timer)
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [isTask1TimeUpLocked, setIsTask1TimeUpLocked] =
    useState<boolean>(false);
  const [isTask2TimeUpLocked, setIsTask2TimeUpLocked] =
    useState<boolean>(false);
  const [task1TimedWords, setTask1TimedWords] = useState<number | null>(null);
  const [task2TimedWords, setTask2TimedWords] = useState<number | null>(null);

  // Lightbox Zoom Modal for Task 1 Chart inspection
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [apiAlertModal, setApiAlertModal] = useState<{
    title: string;
    message: string;
    showConfigBtn?: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customPromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Task 2 Master Prompts filtered by category
  const task2Prompts = useMemo(
    () => MASTER_WRITING_PROMPTS.filter((p) => p.taskType === 'task2'),
    []
  );

  const filteredTask2Prompts = useMemo(() => {
    if (selectedCategory === 'all') return task2Prompts;
    if (selectedCategory === '政府与社会') {
      return task2Prompts.filter(
        (p) =>
          p.topicTag.includes('政府') || p.topicTag.includes('犯罪与社会')
      );
    }
    return task2Prompts.filter((p) => p.topicTag.includes(selectedCategory));
  }, [task2Prompts, selectedCategory]);

  // Resolve Task 2 selected topic metadata
  const isTask2CustomPrompt = task2Draft.selectedTopicId === 'custom';
  const selectedTask2MasterPrompt = useMemo(
    () =>
      isTask2CustomPrompt
        ? null
        : task2Prompts.find((p) => p.id === task2Draft.selectedTopicId) ||
          task2Prompts[0] ||
          null,
    [isTask2CustomPrompt, task2Prompts, task2Draft.selectedTopicId]
  );

  const task2ResolvedPrompt = isTask2CustomPrompt
    ? task2Draft.customPrompt
    : selectedTask2MasterPrompt?.prompt || '';

  const task2ResolvedTopicTag = isTask2CustomPrompt
    ? '自由命题 · Custom Prompt'
    : selectedTask2MasterPrompt?.topicTag || '科技与未来 · Technology';

  const isHistoryMode = viewMode === 'history';
  const currentStep =
    activeTaskType === 'task1' ? 'writing' : task2Draft.viewStep || 'catalog';

  // Strictly isolated history list for the currently active task ('task1' vs 'task2')
  const activeTaskReports =
    activeTaskType === 'task1' ? task1Reports : task2Reports;

  const safeHistoryIndex =
    activeTaskReports.length > 0
      ? Math.min(historyIndex, activeTaskReports.length - 1)
      : 0;
  const activeHistoryReport = isHistoryMode
    ? activeTaskReports[safeHistoryIndex] || null
    : null;

  // Reports corresponding to Task 1 or Task 2 draft (if already graded)
  const task1Report = useMemo(() => {
    if (!task1Draft.gradedReportId) return null;
    return (
      task1Reports.find((r) => r.id === task1Draft.gradedReportId) || null
    );
  }, [task1Draft.gradedReportId, task1Reports]);

  const task2Report = useMemo(() => {
    if (!task2Draft.gradedReportId) return null;
    return (
      task2Reports.find((r) => r.id === task2Draft.gradedReportId) || null
    );
  }, [task2Draft.gradedReportId, task2Reports]);

  const draftReport = activeTaskType === 'task1' ? task1Report : task2Report;
  const activeRightReport = isHistoryMode ? activeHistoryReport : draftReport;

  // Displayed values on the Left Sheet (Strictly isolated by activeTaskType)
  const displayedTaskType: WritingTaskType = isHistoryMode
    ? activeHistoryReport?.taskType || activeTaskType
    : activeTaskType;

  const displayedTopicTag = isHistoryMode
    ? activeHistoryReport?.topicTag ||
      (activeTaskType === 'task1'
        ? '图表小作文 · Academic Task 1'
        : '大作文历史存档 · Task 2 Archive')
    : activeTaskType === 'task1'
    ? '图表小作文 · Academic Task 1'
    : task2ResolvedTopicTag;

  const displayedPrompt = isHistoryMode
    ? activeHistoryReport?.prompt || ''
    : activeTaskType === 'task1'
    ? task1Draft.prompt
    : task2ResolvedPrompt;

  const displayedChartImage = isHistoryMode
    ? activeHistoryReport?.image ||
      activeHistoryReport?.chartImageDataUrl ||
      null
    : activeTaskType === 'task1'
    ? task1Draft.image || null
    : null;

  const displayedEssay = isHistoryMode
    ? activeHistoryReport?.essay || ''
    : activeTaskType === 'task1'
    ? task1Draft.content
    : task2Draft.content;

  const task1WordCount = useMemo(
    () => countWords(task1Draft.content),
    [task1Draft.content]
  );
  const task2WordCount = useMemo(
    () => countWords(task2Draft.content),
    [task2Draft.content]
  );
  const draftWordCount =
    activeTaskType === 'task1' ? task1WordCount : task2WordCount;

  const displayedWordCount = isHistoryMode
    ? activeHistoryReport?.wordCount ?? countWords(displayedEssay)
    : draftWordCount;

  // Active task timer values
  const defaultSecondsForTask = activeTaskType === 'task1' ? 1200 : 2400;
  const secondsLeft =
    activeTaskType === 'task1'
      ? typeof task1Draft.timer === 'number'
        ? task1Draft.timer
        : 1200
      : typeof task2Draft.timer === 'number'
      ? task2Draft.timer
      : 2400;

  const isTimeUpLocked =
    activeTaskType === 'task1' ? isTask1TimeUpLocked : isTask2TimeUpLocked;
  const timedCompletedWords =
    activeTaskType === 'task1' ? task1TimedWords : task2TimedWords;

  const setIsTimeUpLocked = (locked: boolean) => {
    if (activeTaskType === 'task1') {
      setIsTask1TimeUpLocked(locked);
    } else {
      setIsTask2TimeUpLocked(locked);
    }
  };

  // Auto-resize custom prompt textarea height smoothly
  useEffect(() => {
    const el = customPromptTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(68, el.scrollHeight)}px`;
  }, [
    displayedPrompt,
    currentStep,
    isTask2CustomPrompt,
    displayedTaskType,
    activeTaskType,
  ]);

  // Set of normalized words already in vocabCards for instant [ ✓ 已收录 ] state
  const existingVocabSet = useMemo(() => {
    return new Set(vocabCards.map((c) => c.word.trim().toLowerCase()));
  }, [vocabCards]);

  // Set of practiced prompts from Task 2 historical reports for the [ ✓ 已练 ] stamp
  const practicedPromptSet = useMemo(() => {
    return new Set(task2Reports.map((r) => r.prompt.trim()));
  }, [task2Reports]);

  const practicedTopicIdSet = useMemo(() => {
    return new Set(
      task2Reports.map((r) => r.topicId).filter(Boolean) as string[]
    );
  }, [task2Reports]);

  // Countdown Timer Tick Effect (Persists remaining seconds directly into task1Draft.timer or task2Draft.timer)
  useEffect(() => {
    if (!isTimerRunning || isHistoryMode || currentStep === 'catalog') return;

    const interval = window.setInterval(() => {
      if (activeTaskType === 'task1') {
        setTask1Draft((prev) => {
          const currentSec = typeof prev.timer === 'number' ? prev.timer : 1200;
          if (currentSec <= 1) {
            window.clearInterval(interval);
            setIsTimerRunning(false);
            setIsTask1TimeUpLocked(true);
            setTask1TimedWords(countWords(prev.content));
            return { ...prev, timer: 0 };
          }
          return { ...prev, timer: currentSec - 1 };
        });
      } else {
        setTask2Draft((prev) => {
          const currentSec = typeof prev.timer === 'number' ? prev.timer : 2400;
          if (currentSec <= 1) {
            window.clearInterval(interval);
            setIsTimerRunning(false);
            setIsTask2TimeUpLocked(true);
            setTask2TimedWords(countWords(prev.content));
            return { ...prev, timer: 0 };
          }
          return { ...prev, timer: currentSec - 1 };
        });
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    isTimerRunning,
    isHistoryMode,
    currentStep,
    activeTaskType,
    setTask1Draft,
    setTask2Draft,
  ]);

  const resetTimerForTask = useCallback(
    (type: WritingTaskType) => {
      setIsTimerRunning(false);
      if (type === 'task1') {
        setIsTask1TimeUpLocked(false);
        setTask1TimedWords(null);
        setTask1Draft((prev) => ({ ...prev, timer: 1200 }));
      } else {
        setIsTask2TimeUpLocked(false);
        setTask2TimedWords(null);
        setTask2Draft((prev) => ({ ...prev, timer: 2400 }));
      }
    },
    [setTask1Draft, setTask2Draft]
  );

  const handleToggleTimer = () => {
    if (isHistoryMode) return;
    if (isTimeUpLocked || secondsLeft === 0) {
      resetTimerForTask(activeTaskType);
      setIsTimerRunning(true);
    } else {
      setIsTimerRunning((prev) => !prev);
    }
  };

  const handleResetTimer = () => {
    if (isHistoryMode) return;
    resetTimerForTask(activeTaskType);
  };

  // Handle saving an image File/Blob to Task 1 draft state ('ielts_draft_task1')
  const handleAttachChartBlob = useCallback(
    async (blob: File | Blob) => {
      try {
        const dataUrl = await convertImageFileToDataUrl(blob);
        setTask1Draft((prev) => ({
          ...prev,
          image: dataUrl,
        }));
        setErrorMsg(null);
      } catch {
        setErrorMsg('图表图片解析失败，请重试');
      }
    },
    [setTask1Draft]
  );

  // Global Ctrl + V / Cmd + V listener for clipboard screenshot paste when in Task 1 Draft mode
  useEffect(() => {
    if (isHistoryMode || activeTaskType !== 'task1') return;

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
  }, [isHistoryMode, activeTaskType, handleAttachChartBlob]);

  // Close Lightbox or History Drawer on Escape key
  useEffect(() => {
    if (!isLightboxOpen && !isHistoryDrawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
        setIsHistoryDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, isHistoryDrawerOpen]);

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
    setTask1Draft((prev) => ({
      ...prev,
      image: null,
    }));
  };

  // Top Switch: [ Task 1 | Task 2 ] — ZERO DATA LOSS! Never clears either draft or timer
  const handleTopTaskTypeSwitch = (nextType: WritingTaskType) => {
    if (isHistoryMode) {
      setViewMode('draft');
    }
    setIsHistoryDrawerOpen(false);
    setIsTimerRunning(false);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
    setActiveTaskType(nextType);
  };

  // Select "✍️ 自由命题 (Custom Prompt)" from Task 2 Catalog
  const handleSelectCustomPromptMode = () => {
    setIsTimerRunning(false);
    setTask2Draft((prev) => {
      const isAlreadyCustom = prev.selectedTopicId === 'custom';
      return {
        ...prev,
        selectedTopicId: 'custom',
        viewStep: 'writing',
        content: isAlreadyCustom ? prev.content : '',
        timer: isAlreadyCustom ? prev.timer : 2400,
        gradedReportId: isAlreadyCustom ? prev.gradedReportId : null,
      };
    });
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
  };

  // Select a built-in Master Prompt from Task 2 Catalog
  const handleSelectBuiltInPrompt = (item: MasterWritingPrompt) => {
    setIsTimerRunning(false);
    setTask2Draft((prev) => {
      const isSameTopic = prev.selectedTopicId === item.id;
      return {
        ...prev,
        selectedTopicId: item.id,
        viewStep: 'writing',
        content: isSameTopic ? prev.content : '',
        timer: isSameTopic ? prev.timer : 2400,
        gradedReportId: isSameTopic ? prev.gradedReportId : null,
      };
    });
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
  };

  // Click [ ← 重选题目 ] from the Task 2 immersive writing pad
  const handleRequestBackToCatalog = () => {
    if (isHistoryMode) {
      setViewMode('draft');
      return;
    }
    if (task2WordCount > 10 && !task2Report) {
      setConfirmBackToCatalog(true);
      return;
    }
    setIsTimerRunning(false);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
    setTask2Draft((prev) => ({
      ...prev,
      viewStep: 'catalog',
    }));
  };

  // Confirmed clearing of Task 2 draft when clicking [ ← 重选题目 ] -> [ 继续 ]
  const handleConfirmReturnAndClear = () => {
    setIsTimerRunning(false);
    setIsTask2TimeUpLocked(false);
    setTask2TimedWords(null);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
    setTask2Draft((prev) => ({
      ...prev,
      viewStep: 'catalog',
      customPrompt: prev.selectedTopicId === 'custom' ? '' : prev.customPrompt,
      content: '',
      timer: 2400,
      gradedReportId: null,
    }));
  };

  // Strictly isolated prompt text change handler
  const handlePromptChange = (newPromptText: string) => {
    if (isHistoryMode) return;
    if (activeTaskType === 'task1') {
      setTask1Draft((prev) => ({
        ...prev,
        prompt: newPromptText,
      }));
    } else {
      setTask2Draft((prev) => ({
        ...prev,
        customPrompt: newPromptText,
      }));
    }
    if (errorMsg) setErrorMsg(null);
  };

  // Strictly isolated essay content change handler
  const handleEssayChange = (newEssayText: string) => {
    if (isHistoryMode || isTimeUpLocked) return;
    if (activeTaskType === 'task1') {
      setTask1Draft((prev) => ({
        ...prev,
        content: newEssayText,
      }));
    } else {
      setTask2Draft((prev) => ({
        ...prev,
        content: newEssayText,
      }));
    }
    if (errorMsg) setErrorMsg(null);
  };

  // Explicit [ ＋ 写篇新的 ] button after grading: clears ONLY the active task's draft
  const handleStartNewSheet = () => {
    setViewMode('draft');
    setIsTimerRunning(false);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
    if (activeTaskType === 'task1') {
      setIsTask1TimeUpLocked(false);
      setTask1TimedWords(null);
      setTask1Draft({
        prompt: '',
        image: null,
        content: '',
        timer: 1200,
        gradedReportId: null,
      });
    } else {
      setIsTask2TimeUpLocked(false);
      setTask2TimedWords(null);
      setTask2Draft((prev) => ({
        ...prev,
        viewStep: 'catalog',
        customPrompt:
          prev.selectedTopicId === 'custom' ? '' : prev.customPrompt,
        content: '',
        timer: 2400,
        gradedReportId: null,
      }));
    }
  };

  const handleEvaluateDraft = async () => {
    if (isHistoryMode) return;
    setErrorMsg(null);
    setApiAlertModal(null);

    const activePrompt =
      activeTaskType === 'task1' ? task1Draft.prompt : task2ResolvedPrompt;
    const activeEssay =
      activeTaskType === 'task1' ? task1Draft.content : task2Draft.content;
    const activeTopicTag =
      activeTaskType === 'task1'
        ? '图表小作文 · Academic Task 1'
        : task2ResolvedTopicTag;

    if (!activePrompt.trim()) {
      setErrorMsg('请先输入或粘贴作文题目，以便考官精准判分');
      customPromptTextareaRef.current?.focus();
      return;
    }
    if (draftWordCount < 1) {
      setErrorMsg('请先输入作文正文后再交卷批改');
      return;
    }

    if (!aiConfig.apiKey.trim()) {
      const missingKeyMsg =
        '尚未配置 DeepSeek API Key。请点击右上角齿轮图标填写您的 DeepSeek API Key（sk-...），系统将真实调用 DeepSeek 考官为您批改！';
      setErrorMsg(missingKeyMsg);
      setApiAlertModal({
        title: '未配置 DeepSeek API Key',
        message: missingKeyMsg,
        showConfigBtn: true,
      });
      return;
    }

    setIsTimerRunning(false);
    setIsEvaluating(true);
    try {
      const newReport = await evaluateIeltsWriting({
        taskType: activeTaskType,
        prompt: activePrompt.trim(),
        essay: activeEssay.trim(),
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
        model: aiConfig.model || 'deepseek-chat',
      });

      const enrichedReport: WritingEvaluationReport = {
        ...newReport,
        taskType: activeTaskType,
        firstCriterionLabel: activeTaskType === 'task1' ? 'TA' : 'TR',
        topicId:
          activeTaskType === 'task2' ? task2Draft.selectedTopicId : undefined,
        topicTag: activeTopicTag,
        image: activeTaskType === 'task1' ? task1Draft.image || null : null,
        chartImageDataUrl:
          activeTaskType === 'task1' ? task1Draft.image || null : null,
      };

      onSaveReport(enrichedReport);
      if (activeTaskType === 'task1') {
        setTask1Draft((prev) => ({
          ...prev,
          gradedReportId: enrichedReport.id,
        }));
      } else {
        setTask2Draft((prev) => ({
          ...prev,
          gradedReportId: enrichedReport.id,
        }));
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'DeepSeek API 请求失败，请检查 API Key 与网络连接。';
      setErrorMsg(msg);
      setApiAlertModal({
        title: 'DeepSeek 批改请求失败',
        message: msg,
        showConfigBtn: true,
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  // Open the task-specific History Archive Drawer ('TASK 1 · 小作文历史档案' or 'TASK 2 · 大作文历史档案')
  const handleEnterHistoryMode = () => {
    if (activeTaskReports.length === 0) return;
    setIsTimerRunning(false);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
    setIsHistoryDrawerOpen(true);
  };

  // Inspect a specific historical record in full dual-sheet view
  const handleSelectHistoryRecord = (index: number) => {
    setHistoryIndex(index);
    setViewMode('history');
    setIsHistoryDrawerOpen(false);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
  };

  // Single-record deletion [ 🗑️ 删除 ]
  const handleDeleteHistoryRecord = (
    reportId: string,
    taskType: WritingTaskType
  ) => {
    onDeleteReport(reportId, taskType);
    if (taskType === 'task1' && task1Draft.gradedReportId === reportId) {
      setTask1Draft((prev) => ({ ...prev, gradedReportId: null }));
    }
    if (taskType === 'task2' && task2Draft.gradedReportId === reportId) {
      setTask2Draft((prev) => ({ ...prev, gradedReportId: null }));
    }
    const remainingCount = activeTaskReports.filter(
      (r) => r.id !== reportId
    ).length;
    if (remainingCount === 0) {
      setIsHistoryDrawerOpen(false);
      if (isHistoryMode) {
        setViewMode('draft');
      }
    } else if (safeHistoryIndex >= remainingCount) {
      setHistoryIndex(Math.max(0, remainingCount - 1));
    }
  };

  const handleReturnToDraft = () => {
    setViewMode('draft');
    setIsHistoryDrawerOpen(false);
    setConfirmBackToCatalog(false);
    setErrorMsg(null);
  };

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
    const modifiedSentence = item.upgradedSentence?.trim() || userSentence;
    const rawPhonetic = (item.phonetic || '').trim();
    const cleanPhonetic =
      rawPhonetic && !/academic|phrase|collocation/i.test(rawPhonetic)
        ? rawPhonetic
        : '';
    const rawPos = (item.pos || '').trim();
    const cleanPos =
      rawPos && !/^(acad\.|expr\.)$/i.test(rawPos)
        ? rawPos
        : headword.includes(' ')
        ? 'phrase'
        : 'n.';

    onIngestVocab({
      word: headword,
      phonetic: cleanPhonetic,
      partOfSpeech: cleanPos,
      chineseMeaning:
        item.meaning ||
        item.chineseMeaning ||
        item.contextExplanation.slice(0, 32),
      englishDefinition: item.contextExplanation,
      paraphrasing:
        paraphrasingList.length > 0 ? paraphrasingList : [item.original],
      exampleSentence: modifiedSentence,
      exampleTranslation: `原句对比：${userSentence}（将 “${item.original}” 升级为 “${item.upgraded}”）`,
      topicTag: report.topicTag || '来自写作批改',
      isCustom: true,
      fromWriting: true,
      originalError: (item.originalError || item.original || '').trim(),
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

    const rawPhonetic = (corr.phonetic || '').trim();
    const cleanPhonetic =
      rawPhonetic && !/academic|phrase|collocation/i.test(rawPhonetic)
        ? rawPhonetic
        : '';
    const rawPos = (corr.pos || '').trim();
    const cleanPos =
      rawPos && !/^(acad\.|expr\.)$/i.test(rawPos)
        ? rawPos
        : targetPhrase.includes(' ')
        ? 'phrase'
        : 'n.';

    onIngestVocab({
      word: targetPhrase,
      phonetic: cleanPhonetic,
      partOfSpeech: cleanPos,
      chineseMeaning: corr.meaning || corr.chineseMeaning || corr.errorType,
      englishDefinition: corr.explanation,
      paraphrasing: [corr.original.slice(0, 48)],
      exampleSentence: corr.corrected,
      exampleTranslation: `原句对比：${corr.original}`,
      topicTag: report.topicTag || '来自写作批改',
      isCustom: true,
      fromWriting: true,
      originalError: (corr.originalError || corr.original || '').trim(),
    });
  };

  const isFinalFiveMinutes = secondsLeft > 0 && secondsLeft <= 300;
  const hasComparisonReport = Boolean(activeRightReport);
  const showTopTaskSwitcher =
    isHistoryMode || activeTaskType === 'task1' || currentStep === 'catalog';

  return (
    <div className="mx-auto max-w-6xl px-4 pb-14 pt-1">
      {/* TOP TASK SWITCHER BAR: [ Task 1 | Task 2 ] — Hidden during Task 2 immersive notepad writing */}
      {showTopTaskSwitcher && (
        <div className="mb-6 flex items-center justify-center select-none">
          <div className="skeuo-groove inline-flex items-center rounded-xl p-1">
            <button
              type="button"
              onClick={() => handleTopTaskTypeSwitch('task1')}
              className={`rounded-lg px-5 py-1 text-xs font-mono tracking-wide transition-all ${
                displayedTaskType === 'task1'
                  ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              Task 1
            </button>
            <button
              type="button"
              onClick={() => handleTopTaskTypeSwitch('task2')}
              className={`rounded-lg px-5 py-1 text-xs font-mono tracking-wide transition-all ${
                displayedTaskType === 'task2'
                  ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              Task 2
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          STEP 1: TASK 2 TOPIC DIRECTORY INDEX VIEW (大作文题目目录索引页)
         ===================================================================== */}
      {!isHistoryMode &&
      activeTaskType === 'task2' &&
      currentStep === 'catalog' ? (
        <div className="mx-auto max-w-3xl">
          <section className="skeuo-paper overflow-hidden rounded-2xl">
            {/* Smartisan Vintage Double Crimson Header Rule */}
            <div className="pt-4">
              <div className="h-[2px] w-full bg-[#C97A63]/35" />
              <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
            </div>

            {/* Catalog Header & Top Theme Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-7 py-5">
              {/* Gentle Theme Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {TASK2_CATALOG_FILTERS.map((cat) => {
                  const isActive = selectedCategory === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setSelectedCategory(cat.key)}
                      className={`rounded-lg px-3 py-1 text-xs transition-all ${
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

              {/* Task 2 Exclusive History Archive Entry Button */}
              {task2Reports.length > 0 && (
                <button
                  type="button"
                  onClick={handleEnterHistoryMode}
                  className="skeuo-btn-light rounded-lg px-3 py-1.5 font-mono text-xs text-[#262523]"
                >
                  历史批改 ({task2Reports.length})
                </button>
              )}
            </div>

            {/* Catalog Body: Pinned Custom Prompt Card + Built-in Master Prompts */}
            <div className="space-y-3.5 px-7 py-6">
              {/* PINNED TOP SPECIAL CARD: ✍️ 自由命题 (Custom Prompt) */}
              <button
                type="button"
                onClick={handleSelectCustomPromptMode}
                className="group relative w-full rounded-xl border-2 border-dashed border-[#CBC6B8] bg-[#F6F3EB]/80 p-5 text-left transition-all hover:border-[#262523]/45 hover:bg-[#F3EFE5]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 font-serif text-base font-semibold text-[#262523]">
                      <PenLine className="h-4 w-4 text-[#EA5B25]" />
                      <span>自由命题 (Custom Prompt)</span>
                    </span>
                    <span className="rounded border border-[#D8D4C8] bg-[#FAF8F2] px-2 py-0.5 font-mono text-[10px] tracking-wider text-[#7A7873]">
                      CUSTOM PROMPT
                    </span>
                  </div>

                  {isTask2CustomPrompt &&
                  (task2WordCount > 0 || task2Draft.customPrompt.trim()) ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#262523]">
                      <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                      <span>继续草稿 ({task2WordCount} words)</span>
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-[#7A7873] transition-transform group-hover:translate-x-0.5 group-hover:text-[#262523]">
                      进入书写 →
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-[#7A7873]">
                  自行输入或粘贴剑桥真题，AI 考官将根据你提供的特定题目进行针对性批改。
                </p>
              </button>

              {/* BUILT-IN MASTER PROMPT CARDS LIST */}
              <div className="space-y-3 pt-1">
                {filteredTask2Prompts.map((item) => {
                  const globalIdx =
                    task2Prompts.findIndex((p) => p.id === item.id) + 1;
                  const formattedNo = String(globalIdx).padStart(2, '0');
                  const isPracticed =
                    practicedTopicIdSet.has(item.id) ||
                    practicedPromptSet.has(item.prompt.trim());
                  const hasActiveDraftHere =
                    !isTask2CustomPrompt &&
                    task2Draft.selectedTopicId === item.id &&
                    task2WordCount > 0;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectBuiltInPrompt(item)}
                      className="group relative w-full rounded-xl border border-[#E2DFD5] bg-[#FAF8F2] p-5 text-left shadow-[0_2px_6px_rgba(38,37,35,0.03)] transition-all hover:border-[#C5C0B2] hover:bg-[#F6F3EB]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-semibold tracking-wider text-[#7A7873]">
                            NO. {formattedNo}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-[#7A7873]">
                            · {formatPrintedStamp(item.topicTag)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {hasActiveDraftHere && (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#262523]">
                              <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                              <span>草稿 ({task2WordCount}w)</span>
                            </span>
                          )}

                          {isPracticed && (
                            <span className="rounded border border-[#D5D1C6] bg-[#EFECE3] px-2 py-0.5 font-mono text-[10px] text-[#7A7873]">
                              ✓ 已练
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="mt-2.5 font-serif text-[14px] leading-relaxed text-[#262523]">
                        {item.prompt}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : (
        /* =====================================================================
            STEP 2: IMMERSIVE WRITING NOTE PAD & EXAMINER SCORE SHEET
            - Centered single sheet while writing (!hasComparisonReport)
            - Dual-sheet side-by-side comparison after submitting (hasComparisonReport)
           ===================================================================== */
        <div
          className={
            hasComparisonReport
              ? 'grid grid-cols-1 gap-7 lg:grid-cols-2 transition-all duration-300'
              : 'mx-auto max-w-3xl transition-all duration-300'
          }
        >
          {/* LEFT / CENTER SHEET: Smartisan Cream Writing Pad */}
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

            {/* Symmetrical 3-Column Light-Skeuomorphic Header Bar */}
            <div className="grid grid-cols-3 items-center gap-2 px-8 pt-5 pb-3.5 select-none">
              {/* Left Column: Unified 1:1 Tactile White Button [ ← 重选题目 ] */}
              <div className="flex items-center justify-start">
                {!isHistoryMode && displayedTaskType === 'task2' && (
                  <button
                    type="button"
                    onClick={handleRequestBackToCatalog}
                    className="skeuo-switch-thumb inline-flex h-7 items-center gap-1 rounded-lg px-3 text-xs font-semibold leading-none text-[#262523] transition-all hover:brightness-[1.01] active:translate-y-[1px]"
                  >
                    <span className="leading-none">← 重选题目</span>
                  </button>
                )}
              </div>

              {/* Center Column: Static Ink-Printed Topic Stamp (Pixel-Centered Vertically & Horizontally) */}
              <div className="flex items-center justify-center text-center min-w-0">
                <span className="truncate text-center font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#7A7873] leading-none translate-y-[1px]">
                  {isHistoryMode
                    ? `ARCHIVE · ${formatPrintedStamp(displayedTopicTag)}`
                    : formatPrintedStamp(displayedTopicTag)}
                </span>
              </div>

              {/* Right Column: Integrated Single-Piece Tactile Timer Key [ ● 40:00 ] */}
              <div className="flex items-center justify-end">
                {!isHistoryMode && (
                  <button
                    type="button"
                    onClick={handleToggleTimer}
                    title={isTimerRunning ? '点击暂停倒计时' : '点击开始倒计时'}
                    className="skeuo-switch-thumb inline-flex h-7 items-center gap-2 rounded-lg px-3 font-mono text-xs font-semibold leading-none text-[#262523] transition-all hover:brightness-[1.01] active:translate-y-[1px]"
                  >
                    {/* 6px Status Dot: Light Gray when idle/paused, Braun Signal Orange pulsing when running */}
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                        isTimerRunning
                          ? 'bg-[#EA5B25] animate-pulse shadow-[0_0_4px_rgba(234,91,37,0.65)]'
                          : isTimeUpLocked
                          ? 'bg-[#EA5B25]'
                          : 'bg-[#B8B4A9]'
                      }`}
                    />

                    {/* Monospace Bold Countdown Digits */}
                    <span
                      className={`leading-none tracking-wider ${
                        isTimeUpLocked || isFinalFiveMinutes
                          ? 'text-[#EA5B25]'
                          : 'text-[#262523]'
                      } ${isFinalFiveMinutes ? 'animate-pulse' : ''}`}
                    >
                      {formatTimerDisplay(secondsLeft)}
                    </span>

                    {/* On-Demand Borderless Reset Icon (Only shown when timer has moved and is paused) */}
                    {!isTimerRunning && secondsLeft < defaultSecondsForTask && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResetTimer();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleResetTimer();
                          }
                        }}
                        title="重置回初始时间"
                        aria-label="重置回初始时间"
                        className="ml-0.5 inline-flex items-center justify-center text-[#7A7873] transition-colors hover:text-[#EA5B25]"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Lightweight Anti-Loss Confirmation when clicking [ ← 重选题目 ] with >10 words */}
            {confirmBackToCatalog && !isHistoryMode && (
              <div className="mx-8 mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#DFC5B8] bg-[#F9EFEA] px-4 py-2.5 text-xs text-[#262523]">
                <span>当前正文已有内容，重选题目将清空当前草稿，是否继续？</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmBackToCatalog(false)}
                    className="skeuo-btn-light rounded-lg px-2.5 py-1 text-[11px] font-medium"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReturnAndClear}
                    className="skeuo-btn-orange rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                  >
                    继续
                  </button>
                </div>
              </div>
            )}

            {/* Time-Up Exam Lock Notice Banner */}
            {isTimeUpLocked && !isHistoryMode && (
              <div className="mx-8 mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#EA5B25]/40 bg-[#F9EFEA] px-4 py-2 text-xs text-[#262523]">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-[#EA5B25]" />
                  <span>
                    考场计时结束（00:00），正文已锁定，请点击右下角「交卷批改」。
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

            {/* PROMPT PRESENTATION AREA */}
            <div className="px-8 pb-4 pt-1">
              {!isHistoryMode &&
              (displayedTaskType === 'task1' || isTask2CustomPrompt) ? (
                /* Custom Prompt or Task 1: Clean borderless auto-growing textarea */
                <textarea
                  ref={customPromptTextareaRef}
                  rows={2}
                  value={displayedPrompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  placeholder={
                    displayedTaskType === 'task1'
                      ? '在此粘贴或输入你的小作文题目...'
                      : '在此粘贴或输入你的大作文题目...'
                  }
                  aria-label="作文题目"
                  className="w-full resize-none overflow-hidden bg-transparent font-serif text-[15px] leading-relaxed text-[#262523] placeholder-[#B5B1A6] focus:outline-none"
                />
              ) : (
                /* Built-in Prompt or History Manuscript: Static printed serif typography on paper */
                <p className="font-serif text-[15px] leading-relaxed text-[#262523] select-text">
                  {displayedPrompt}
                </p>
              )}
            </div>

            {/* TASK 1 EXCLUSIVE CHART PASTE & POLAROID PHOTO SLOT */}
            {displayedTaskType === 'task1' && (
              <div className="px-8 pb-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                {displayedChartImage ? (
                  /* Polaroid Photo Frame Card when chart image is attached */
                  <div
                    onClick={() => setIsLightboxOpen(true)}
                    className="group relative mx-auto cursor-zoom-in overflow-hidden rounded-xl border border-[#D8D4C8] bg-[#FAF8F2] p-3 pb-4 shadow-[0_6px_16px_rgba(38,37,35,0.08),inset_0_1px_0_rgba(255,255,255,0.95)] transition hover:border-[#C2BDB0]"
                    title="点击放大查看图表细节"
                  >
                    <img
                      src={displayedChartImage}
                      alt="Task 1 Chart"
                      className="max-h-52 w-full rounded-lg object-contain bg-white"
                    />

                    {/* Subtle Zoom Hint Pill */}
                    <span className="pointer-events-none absolute bottom-5 left-5 inline-flex items-center gap-1 rounded-md bg-[#262523]/75 px-2 py-0.5 font-mono text-[10px] text-[#FAF8F2] opacity-0 transition-opacity group-hover:opacity-100">
                      <ZoomIn className="h-3 w-3" />
                      <span>点击放大</span>
                    </span>

                    {/* Minimalist Top-Right Delete Button [×] */}
                    {!isHistoryMode && (
                      <button
                        type="button"
                        onClick={handleRemoveChartImage}
                        className="skeuo-btn-light absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-md text-[#7A7873] hover:text-[#EA5B25]"
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
            <div className="mx-8 border-t border-dashed border-[#D5D1C6]" />

            {/* Main Essay Writing Pad */}
            <div className="flex flex-1 flex-col px-8 pt-5 pb-4">
              <textarea
                readOnly={isHistoryMode || isTimeUpLocked}
                value={displayedEssay}
                onChange={(e) => handleEssayChange(e.target.value)}
                placeholder="在此开始书写正文..."
                aria-label="作文正文"
                className={`w-full flex-1 resize-none bg-transparent font-serif text-[16px] leading-[1.9] text-[#262523] placeholder-[#B5B1A6] focus:outline-none ${
                  isHistoryMode || isTimeUpLocked
                    ? 'cursor-default select-text opacity-85'
                    : ''
                }`}
              />
            </div>

            {/* Bottom Bar of Writing Sheet */}
            <div className="flex items-center justify-between gap-4 border-t border-[#ECE9E0] bg-[#F6F3EB]/60 px-8 py-4">
              <div className="flex items-center gap-3">
                {!isHistoryMode && errorMsg ? (
                  <span className="text-xs text-[#EA5B25]">{errorMsg}</span>
                ) : (
                  !isHistoryMode &&
                  activeTaskReports.length > 0 && (
                    <button
                      type="button"
                      onClick={handleEnterHistoryMode}
                      className="skeuo-btn-light rounded-lg px-3 py-1.5 font-mono text-xs text-[#262523]"
                    >
                      历史批改 ({activeTaskReports.length})
                    </button>
                  )
                )}
              </div>

              <div className="flex items-center gap-3">
                {timedCompletedWords !== null && !isHistoryMode ? (
                  <span className="rounded-md border border-[#DFC5B8] bg-[#F9EFEA] px-2.5 py-1 font-mono text-xs font-semibold text-[#EA5B25]">
                    考场限时完成：{timedCompletedWords} words
                  </span>
                ) : (
                  <span className="font-mono text-xs tracking-wide text-[#7A7873]">
                    {displayedWordCount} words
                  </span>
                )}

                {!isHistoryMode && activeTaskReports.length > 0 && errorMsg && (
                  <button
                    type="button"
                    onClick={handleEnterHistoryMode}
                    className="skeuo-btn-light rounded-lg px-3 py-1.5 font-mono text-xs text-[#262523]"
                  >
                    历史批改 ({activeTaskReports.length})
                  </button>
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

          {/* RIGHT SHEET: Printed Examiner Score Sheet (Only shown after grading or in History mode) */}
          {activeRightReport && (
            <section className="skeuo-paper relative flex min-h-[680px] flex-col justify-between overflow-hidden rounded-2xl">
              {/* History Mode Top Bar OR Draft Graded Top Bar */}
              {isHistoryMode ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DFD5] bg-[#EFECE3] px-6 py-3">
                  {/* Left: Archive Title Stamp + Compact History Pager */}
                  <div className="flex items-center gap-2 font-mono text-xs text-[#262523]">
                    <span className="hidden sm:inline-block font-mono text-[11px] font-semibold tracking-wider text-[#7A7873]">
                      {activeTaskType === 'task1'
                        ? 'TASK 1 · 小作文历史档案'
                        : 'TASK 2 · 大作文历史档案'}
                    </span>
                    <button
                      type="button"
                      disabled={safeHistoryIndex >= activeTaskReports.length - 1}
                      onClick={() =>
                        setHistoryIndex((prev) =>
                          Math.min(activeTaskReports.length - 1, prev + 1)
                        )
                      }
                      className="skeuo-btn-light flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-35"
                      title="上一篇（更早）"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsHistoryDrawerOpen(true)}
                      className="skeuo-btn-light rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      title="展开历史档案目录"
                    >
                      {String(
                        activeTaskReports.length - safeHistoryIndex
                      ).padStart(2, '0')}{' '}
                      / {String(activeTaskReports.length).padStart(2, '0')} 篇
                    </button>
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

                  {/* Right Actions: [ 🗑️ 删除 ] + [ ← 返回当前写作草稿 ] */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteHistoryRecord(
                          activeRightReport.id,
                          activeRightReport.taskType
                        )
                      }
                      className="skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#7A7873] hover:text-[#EA5B25]"
                      title="删除当前这条历史批改记录"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>删除</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleReturnToDraft}
                      className="skeuo-btn-dark inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 text-[#EA5B25]" />
                      <span>返回当前写作草稿</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between border-b border-[#E2DFD5] bg-[#EFECE3]/60 px-8 py-2.5">
                  <span className="font-mono text-[11px] text-[#7A7873]">
                    当前批改成绩单 ·{' '}
                    {new Date(activeRightReport.createdAt).toLocaleTimeString(
                      'zh-CN',
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                      }
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteHistoryRecord(
                          activeRightReport.id,
                          activeRightReport.taskType
                        )
                      }
                      className="skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[#7A7873] hover:text-[#EA5B25]"
                      title="删除此条批改记录"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>删除</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStartNewSheet}
                      className="skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[#262523]"
                    >
                      <Plus className="h-3.5 w-3.5 text-[#EA5B25]" />
                      <span>写篇新的</span>
                    </button>
                  </div>
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

                  {/* 4 Sub-scores Mechanical Stamp (First dimension fixed as TA for Task 1, TR for Task 2) */}
                  <div className="flex items-center gap-4 font-mono">
                    <div className="text-right">
                      <div className="text-[10px] text-[#7A7873]">
                        {activeRightReport.firstCriterionLabel ||
                          (activeRightReport.taskType === 'task1'
                            ? 'TA'
                            : 'TR')}
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
                        : 'TR 审题扣题与任务回应'}{' '}
                      ({activeRightReport.trTa.band.toFixed(1)})
                    </div>
                    <p className="mt-1 text-[#262523]">
                      {activeRightReport.trTa.summary}
                    </p>
                  </div>

                  <div>
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#7A7873]">
                      02 · CC 逻辑连贯与衔接 (
                      {activeRightReport.cc.band.toFixed(1)})
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
                      04 · GRA 语法多样性与句子修正 (
                      {activeRightReport.gra.band.toFixed(1)})
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
                  {new Date(activeRightReport.createdAt).toLocaleString(
                    'zh-CN',
                    {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  )}
                </span>

                {activeTaskReports.length > 0 && (
                  <button
                    type="button"
                    onClick={handleEnterHistoryMode}
                    className="skeuo-btn-light rounded-lg px-3 py-1 font-mono text-[11px] text-[#7A7873] hover:text-[#262523]"
                  >
                    历史批改 ({activeTaskReports.length})
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Task-Isolated History Archive Drawer / Modal ('TASK 1 · 小作文历史档案' / 'TASK 2 · 大作文历史档案') */}
      {isHistoryDrawerOpen && (
        <div
          onClick={() => setIsHistoryDrawerOpen(false)}
          className="fixed inset-0 z-50 flex justify-end bg-[#262523]/35 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-drawer-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="skeuo-paper flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-[#DCD8CE]"
          >
            {/* Smartisan Vintage Double Crimson Header Rule */}
            <div className="pt-3">
              <div className="h-[2px] w-full bg-[#C97A63]/35" />
              <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
            </div>

            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-[#E2DFD5] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                <h2
                  id="history-drawer-title"
                  className="font-mono text-sm font-bold tracking-wider text-[#262523]"
                >
                  {activeTaskType === 'task1'
                    ? 'TASK 1 · 小作文历史档案'
                    : 'TASK 2 · 大作文历史档案'}
                </h2>
                <span className="rounded-md border border-[#D8D4C8] bg-[#EFECE3] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#7A7873]">
                  {activeTaskReports.length} 篇
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsHistoryDrawerOpen(false)}
                className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#262523]"
                aria-label="关闭历史档案"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer Body: Filtered History List for Current Task Only */}
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {activeTaskReports.length === 0 ? (
                <div className="py-16 text-center text-xs text-[#7A7873]">
                  暂无{activeTaskType === 'task1' ? '小作文' : '大作文'}历史批改记录
                </div>
              ) : (
                activeTaskReports.map((item, idx) => {
                  const seqNo = String(activeTaskReports.length - idx).padStart(
                    2,
                    '0'
                  );
                  const firstDimName =
                    item.firstCriterionLabel ||
                    (item.taskType === 'task1' ? 'TA' : 'TR');
                  const itemImage =
                    item.image || item.chartImageDataUrl || null;
                  const isCurrentlySelected =
                    isHistoryMode && activeHistoryReport?.id === item.id;

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectHistoryRecord(idx)}
                      className={`group relative cursor-pointer rounded-xl border p-4 transition-all ${
                        isCurrentlySelected
                          ? 'border-[#EA5B25] bg-[#F7F3EA] shadow-sm'
                          : 'border-[#E2DFD5] bg-[#FAF8F2] hover:border-[#C5C0B2] hover:bg-[#F5F2EA]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                          <span className="font-semibold text-[#7A7873]">
                            #{seqNo}
                          </span>
                          <span className="rounded bg-[#262523] px-2 py-0.5 text-[11px] font-bold text-[#FAF8F2]">
                            BAND {item.overallBand.toFixed(1)}
                          </span>
                          <span className="text-[11px] text-[#7A7873]">
                            {firstDimName} {item.trTa.band.toFixed(1)} · CC{' '}
                            {item.cc.band.toFixed(1)} · LR{' '}
                            {item.lr.band.toFixed(1)} · GRA{' '}
                            {item.gra.band.toFixed(1)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-[#7A7873]">
                            {new Date(item.createdAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>

                          {/* Single-Record Delete Button [ 🗑️ 删除 ] */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteHistoryRecord(item.id, item.taskType);
                            }}
                            className="skeuo-btn-light inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] font-medium text-[#7A7873] hover:text-[#EA5B25]"
                            title="删除此条批改记录"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>删除</span>
                          </button>
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-start gap-3">
                        {item.taskType === 'task1' && itemImage && (
                          <img
                            src={itemImage}
                            alt="Task 1 Chart Thumbnail"
                            className="h-14 w-20 shrink-0 rounded-lg border border-[#DCD8CE] bg-white object-contain p-0.5"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 font-serif text-xs font-medium leading-relaxed text-[#262523]">
                            {item.prompt}
                          </p>
                          <p className="mt-1 line-clamp-1 font-serif text-[11px] text-[#7A7873]">
                            {item.essay} ({item.wordCount} words)
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* DeepSeek API Missing / Error Alert Modal */}
      {apiAlertModal && (
        <div
          onClick={() => setApiAlertModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#262523]/40 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-alert-modal-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="skeuo-paper w-full max-w-md rounded-2xl p-6"
          >
            <div className="flex items-center justify-between border-b border-[#E2DFD5] pb-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                <h3
                  id="api-alert-modal-title"
                  className="text-sm font-semibold text-[#262523]"
                >
                  {apiAlertModal.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setApiAlertModal(null)}
                className="text-[#7A7873] hover:text-[#262523]"
                aria-label="关闭提醒"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-[#262523]">
              {apiAlertModal.message}
            </p>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setApiAlertModal(null)}
                className="skeuo-btn-light rounded-xl px-4 py-2 text-xs font-medium"
              >
                知道了
              </button>
              {apiAlertModal.showConfigBtn && onOpenApiKeyModal && (
                <button
                  type="button"
                  onClick={() => {
                    setApiAlertModal(null);
                    onOpenApiKeyModal();
                  }}
                  className="skeuo-btn-orange rounded-xl px-4 py-2 text-xs font-semibold"
                >
                  去填写 DeepSeek Key
                </button>
              )}
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
