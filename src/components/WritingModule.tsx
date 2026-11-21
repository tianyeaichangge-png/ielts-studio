import { useAutosizeTextarea } from '../hooks/useAutosizeTextarea';
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
  Copy,
  Volume2,
} from 'lucide-react';
import {
  DeepSeekConfig,
  GrammarCorrectionItem,
  HighlightMarkerColor,
  LexicalUpgradeItem,
  ParagraphKeyCorrection,
  Task1ChartType,
  Task1DraftState,
  Task1TopicBankItem,
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
  BUILTIN_TASK1_TOPIC_BANK,
  inferTask1ChartType,
  MASTER_WRITING_PROMPTS,
  MasterWritingPrompt,
  resolveTask1ChartImage,
  TASK1_CHART_TYPE_ENGLISH,
} from '../lib/samplePrompts';
import {
  removeHighlightFromList,
  renderTextWithHighlights,
  upsertHighlightInList,
} from '../lib/textHighlightUtils';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { detectTask1ChartType, identifyTask1ChartTypeWithAI } from '../lib/task1ChartClassification';
import { MicroPracticeView } from './MicroPracticeView';
import { WritingWorkspace } from './WritingWorkspace';
import { SelectionHighlightPopover } from './SelectionHighlightPopover';

interface WritingModuleProps {
  aiConfig: DeepSeekConfig;
  task1Reports: WritingEvaluationReport[];
  task2Reports: WritingEvaluationReport[];
  onSaveReport: (report: WritingEvaluationReport) => void;
  onUpdateReport?: (report: WritingEvaluationReport) => void;
  onDeleteReport: (reportId: string, taskType: WritingTaskType) => void;
  vocabCards: VocabularyCard[];
  onIngestVocab: (
    newCard: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>
  ) => void;
  onExcerptToNotes?: (payload: {
    sourceKey: string;
    markdownBlock: string;
  }) => void;
  excerptedKeys?: Set<string>;
  onOpenApiKeyModal?: () => void;
}

type ViewMode = 'draft' | 'history';

const TASK1_CATALOG_FILTERS = [
  { key: 'all', label: '全部' },
  { key: '折线图', label: '折线图' },
  { key: '柱状图', label: '柱状图' },
  { key: '饼图', label: '饼图' },
  { key: '表格', label: '表格' },
  { key: '组合图', label: 'Mix Charts · 组合图' },
  { key: '地图', label: '地图' },
  { key: '流程图', label: '流程图' },
] as const;

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
  onUpdateReport,
  onDeleteReport,
  vocabCards,
  onIngestVocab,
  onExcerptToNotes,
  excerptedKeys,
  onOpenApiKeyModal,
}) => {
  // 1. Strictly Isolated Dual-Track LocalStorage States (Task 1 vs Task 2) + Micro-Practice Submodule
  const [activeTaskType, setActiveTaskType] = useLocalStorage<WritingTaskType>(
    'ielts_active_task_type',
    'task2'
  );
  const [isMicroPracticeMode, setIsMicroPracticeMode] =
    useLocalStorage<boolean>('ielts_writing_micro_practice_mode_v1', false);

  // Task 1 Independent Draft ('ielts_draft_task1')
  const [task1Draft, setTask1Draft] = useLocalStorage<Task1DraftState>(
    'ielts_draft_task1',
    {
      selectedTopicId: 'custom',
      viewStep: 'catalog',
      prompt: '',
      image: null,
      content: '',
      timer: 1200,
      gradedReportId: null,
    }
  );

  // Task 1 Personal & Built-in Topic Bank ('ielts_task1_topic_bank_v1')
  const [task1TopicBank, setTask1TopicBank] = useLocalStorage<
    Task1TopicBankItem[]
  >('ielts_task1_topic_bank_v1', BUILTIN_TASK1_TOPIC_BANK);

  // Track deleted Task 1 topic IDs / normalized prompts so deleted cards are not resurrected on refresh
  const [deletedTask1Keys, setDeletedTask1Keys] = useLocalStorage<string[]>(
    'ielts_task1_deleted_keys_v1',
    []
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

  // 3. Topic Catalog Filter States (Task 1 & Task 2)
  const [selectedTask1Category, setSelectedTask1Category] = useState<
    'all' | Task1ChartType
  >('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

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
  const chartZoomButtonRef = useRef<HTMLButtonElement | null>(null);
  const timerButtonRef = useRef<HTMLButtonElement | null>(null);
  const customPromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const essayTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gradedEssayTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const reportSheetBodyRef = useRef<HTMLDivElement | null>(null);

  // Automatically backfill & sync Task 1 historical reports + built-in SVG chart topics into task1TopicBank
  useEffect(() => {
    setTask1TopicBank((prevBank) => {
      const deletedSet = new Set(deletedTask1Keys);
      const currentList: Task1TopicBankItem[] = Array.isArray(prevBank)
        ? prevBank.map((item) => ({
            ...item,
            chartType: inferTask1ChartType(item.prompt, '', item.chartType),
            attemptCount:
              typeof item.attemptCount === 'number' ? item.attemptCount : 0,
          }))
        : [];

      let mutated = !Array.isArray(prevBank);

      // 1. Ensure built-in SVG chart topics exist unless explicitly deleted by user
      for (const builtIn of BUILTIN_TASK1_TOPIC_BANK) {
        const normPrompt = builtIn.prompt.trim().toLowerCase();
        if (deletedSet.has(builtIn.id) || deletedSet.has(normPrompt)) {
          continue;
        }
        const existingIdx = currentList.findIndex(
          (c) =>
            c.id === builtIn.id || c.prompt.trim().toLowerCase() === normPrompt
        );
        if (existingIdx === -1) {
          currentList.push({ ...builtIn });
          mutated = true;
        } else if (!currentList[existingIdx].chartImage && builtIn.chartImage) {
          currentList[existingIdx] = {
            ...currentList[existingIdx],
            chartImage: builtIn.chartImage,
            isBuiltIn: true,
          };
          mutated = true;
        }
      }

      // 2. Backfill from existing Task 1 History Reports (group by normalized prompt)
      const groupedByPrompt = new Map<string, WritingEvaluationReport[]>();
      for (const r of task1Reports) {
        if (r.taskType !== 'task1' || !r.prompt?.trim()) continue;
        const key = r.prompt.trim().toLowerCase();
        const arr = groupedByPrompt.get(key) || [];
        arr.push(r);
        groupedByPrompt.set(key, arr);
      }

      for (const [normPrompt, reports] of groupedByPrompt.entries()) {
        if (deletedSet.has(normPrompt)) continue;
        // Sort reports newest first
        const sorted = [...reports].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const latest = sorted[0];
        const maxBand = Math.max(...sorted.map((r) => r.overallBand));
        const count = sorted.length;
        const firstImage =
          sorted.find((r) => r.image || r.chartImageDataUrl)?.image ||
          sorted.find((r) => r.image || r.chartImageDataUrl)
            ?.chartImageDataUrl ||
          null;
        const inferredType = inferTask1ChartType(
          latest.prompt,
          latest.essay,
          latest.chartType
        );

        const matchIdx = currentList.findIndex(
          (c) =>
            (latest.topicId &&
              latest.topicId !== 'custom' &&
              c.id === latest.topicId) ||
            c.prompt.trim().toLowerCase() === normPrompt
        );

        if (matchIdx !== -1) {
          const existing = currentList[matchIdx];
          const nextBest =
            existing.bestBand !== null && existing.bestBand !== undefined
              ? Math.max(existing.bestBand, maxBand)
              : maxBand;
          const nextCount = Math.max(existing.attemptCount || 0, count);
          const nextLastEssayId = existing.lastEssayId || latest.id;
          const nextImage = existing.chartImage || firstImage;
          const nextType =
            !existing.isBuiltIn && latest.chartType
              ? inferredType
              : existing.chartType;

          if (
            existing.bestBand !== nextBest ||
            existing.attemptCount !== nextCount ||
            existing.lastEssayId !== nextLastEssayId ||
            existing.chartImage !== nextImage ||
            existing.chartType !== nextType
          ) {
            currentList[matchIdx] = {
              ...existing,
              bestBand: nextBest,
              attemptCount: nextCount,
              lastEssayId: nextLastEssayId,
              chartImage: nextImage,
              chartType: nextType,
            };
            mutated = true;
          }
        } else {
          currentList.unshift({
            id: `t1-hist-${ latest.id }`,
            prompt: latest.prompt.trim(),
            chartImage: firstImage,
            chartType: inferredType,
            bestBand: maxBand,
            attemptCount: count,
            lastEssayId: latest.id,
            updatedAt: latest.createdAt,
            isBuiltIn: false,
          });
          mutated = true;
        }
      }

      return mutated ? currentList : prevBank;
    });
  }, [task1Reports, deletedTask1Keys, setTask1TopicBank]);

  const filteredTask1TopicBank = useMemo(() => {
    if (selectedTask1Category === 'all') return task1TopicBank;
    if (
      selectedTask1Category === '组合图' ||
      selectedTask1Category === 'mixed'
    ) {
      return task1TopicBank.filter(
        (p) => p.chartType === '组合图' || p.chartType === 'mixed'
      );
    }
    return task1TopicBank.filter((p) => p.chartType === selectedTask1Category);
  }, [task1TopicBank, selectedTask1Category]);

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
  const isTask1CustomPrompt =
    !task1Draft.selectedTopicId || task1Draft.selectedTopicId === 'custom';
  const selectedTask1TopicItem = useMemo(
    () =>
      isTask1CustomPrompt
        ? null
        : task1TopicBank.find((p) => p.id === task1Draft.selectedTopicId) ||
          null,
    [isTask1CustomPrompt, task1TopicBank, task1Draft.selectedTopicId]
  );

  const task1ResolvedTopicTag = useMemo(() => {
    if (task1Draft.chartType) return `${TASK1_CHART_TYPE_ENGLISH[task1Draft.chartType]} · ${task1Draft.chartType === 'mixed' ? '组合图' : task1Draft.chartType}`;
    if (selectedTask1TopicItem) {
      const zh =
        selectedTask1TopicItem.chartType === 'mixed'
          ? '组合图'
          : selectedTask1TopicItem.chartType;
      const en =
        TASK1_CHART_TYPE_ENGLISH[selectedTask1TopicItem.chartType] ||
        'Mixed chart';
      return `${en} · ${zh}`;
    }
    const guessed = detectTask1ChartType(task1Draft.prompt);
    if (guessed) {
      const zh = guessed === 'mixed' ? '组合图' : guessed;
      const en = TASK1_CHART_TYPE_ENGLISH[guessed] || 'Mixed chart';
      return `${en} · ${zh}`;
    }
    return 'CUSTOM CHART · 自由命题图表';
  }, [selectedTask1TopicItem, task1Draft.prompt, task1Draft.chartType]);

  // Debounce text edits; cancel previous recognition when changing input, topic or module.
  useEffect(() => {
    if (
      activeTaskType !== 'task1' ||
      isHistoryMode ||
      task1Draft.viewStep !== 'writing' ||
      selectedTask1TopicItem?.isBuiltIn ||
      task1Draft.chartTypeManuallySelected
    ) {
      return;
    }
    const controller = new AbortController();
    const prompt = task1Draft.prompt;
    const image = task1Draft.image;
    const localType = detectTask1ChartType(prompt);
    const saveType = (chartType?: Task1ChartType) => {
      if (controller.signal.aborted) return;
      setTask1Draft(prev => prev.prompt === prompt && prev.image === image
        ? { ...prev, chartType, chartTypeManuallySelected: false } : prev);
      if (chartType && task1Draft.selectedTopicId !== 'custom') {
        setTask1TopicBank(prev => prev.map(item => item.id === task1Draft.selectedTopicId && !item.isBuiltIn
          ? { ...item, chartType } : item));
      }
    };
    saveType(image ? undefined : localType);
    const needsAI = Boolean(image || (prompt.trim() && !localType));
    if (!needsAI || !aiConfig.apiKey.trim()) return;

    const timer = window.setTimeout(async () => {
      try {
        const result = await identifyTask1ChartTypeWithAI({
          prompt,
          image,
          apiKey: aiConfig.apiKey,
          endpoint: aiConfig.endpoint,
          signal: controller.signal,
        });
        saveType(result.chartType);
      } catch {
        // Classification is optional. The user can still submit for evaluation.
      }
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTaskType, isHistoryMode, task1Draft.viewStep, selectedTask1TopicItem?.isBuiltIn, task1Draft.selectedTopicId,
    task1Draft.prompt, task1Draft.image, task1Draft.chartTypeManuallySelected, aiConfig.apiKey, aiConfig.endpoint,
    setTask1Draft, setTask1TopicBank]);

  const currentStep =
    activeTaskType === 'task1'
      ? task1Draft.viewStep || 'catalog'
      : task2Draft.viewStep || 'catalog';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTaskType, currentStep, isHistoryMode, isMicroPracticeMode]);

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

  const reportReferencePaneRef = useRef<HTMLDivElement>(null);
  const reportPaneRef = useRef<HTMLDivElement>(null);
  const hasReport = Boolean(activeRightReport);

  useEffect(() => {
    reportReferencePaneRef.current?.scrollTo(0, 0);
    reportPaneRef.current?.scrollTo(0, 0);
  }, [activeRightReport?.id, isHistoryMode, isMicroPracticeMode]);

  useEffect(() => {
    if (hasReport && window.matchMedia('(max-width: 899px)').matches) {
      reportPaneRef.current?.focus({ preventScroll: true });
      reportPaneRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [hasReport, isHistoryMode, isMicroPracticeMode]);

  const handleApplyReportHighlight = useCallback(
    (selectedText: string, color: HighlightMarkerColor) => {
      if (!activeRightReport || !onUpdateReport) return;
      const nextHighlights = upsertHighlightInList(
        activeRightReport.userHighlights || [],
        selectedText,
        color
      );
      onUpdateReport({
        ...activeRightReport,
        userHighlights: nextHighlights,
      });
    },
    [activeRightReport, onUpdateReport]
  );

  const handleEraseReportHighlight = useCallback(
    (selectedText: string) => {
      if (!activeRightReport || !onUpdateReport) return;
      const nextHighlights = removeHighlightFromList(
        activeRightReport.userHighlights || [],
        selectedText
      );
      onUpdateReport({
        ...activeRightReport,
        userHighlights: nextHighlights,
      });
    },
    [activeRightReport, onUpdateReport]
  );

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
    ? task1ResolvedTopicTag
    : task2ResolvedTopicTag;

  const displayedPrompt = isHistoryMode
    ? activeHistoryReport?.prompt || ''
    : activeTaskType === 'task1'
    ? task1Draft.prompt
    : task2ResolvedPrompt;

  const task1DraftChartImage = resolveTask1ChartImage(task1Draft.image);
  const displayedChartImage = isHistoryMode
    ? resolveTask1ChartImage(
      activeHistoryReport?.image || activeHistoryReport?.chartImageDataUrl
    )
    : activeTaskType === 'task1'
    ? task1DraftChartImage
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

  const isWritingDraft =
    !isMicroPracticeMode && !isHistoryMode && currentStep !== 'catalog' && !activeRightReport;
  useAutosizeTextarea(
    customPromptTextareaRef,
    isWritingDraft && (displayedTaskType === 'task1' || isTask2CustomPrompt) ? displayedPrompt : undefined
  );
  useAutosizeTextarea(essayTextareaRef, isWritingDraft ? displayedEssay : undefined);
  useAutosizeTextarea(gradedEssayTextareaRef, activeRightReport && !isMicroPracticeMode ? displayedEssay : undefined);

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
    timerButtonRef.current?.focus();
  };

  // Handle saving an image File/Blob to Task 1 draft state ('ielts_draft_task1')
  const handleAttachChartBlob = useCallback(
    async (blob: File | Blob) => {
      try {
        const dataUrl = await convertImageFileToDataUrl(blob);
        setTask1Draft((prev) => ({
          ...prev,
          image: dataUrl,
          chartType: undefined,
          chartTypeManuallySelected: false,
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

  const closeChartPreview = useCallback(() => {
    setIsLightboxOpen(false);
    chartZoomButtonRef.current?.focus({ preventScroll: true });
  }, []);

  // Close Lightbox or History Drawer on Escape key
  useEffect(() => {
    if (!isLightboxOpen && !isHistoryDrawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLightboxOpen) closeChartPreview();
        setIsHistoryDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeChartPreview, isLightboxOpen, isHistoryDrawerOpen]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleAttachChartBlob(file);
    }
    e.target.value = '';
  };

  const handleRemoveChartImage = () => {
    if (isHistoryMode) return;
    setIsLightboxOpen(false);
    setTask1Draft((prev) => ({
      ...prev,
      image: null,
      chartType: undefined,
      chartTypeManuallySelected: false,
    }));
  };

  // Top Switch: [ Task 1 | Task 2 | 小练习 ] — ZERO DATA LOSS! Never clears any draft or timer
  const handleTopTaskTypeSwitch = (nextType: WritingTaskType) => {
    setIsMicroPracticeMode(false);
    if (isHistoryMode) {
      setViewMode('draft');
    }
    setIsHistoryDrawerOpen(false);
    setIsTimerRunning(false);
    setErrorMsg(null);
    setActiveTaskType(nextType);
    if (nextType === 'task1') {
      setTask1Draft((prev) => ({
        ...prev,
        viewStep: 'catalog',
      }));
    } else {
      setTask2Draft((prev) => ({
        ...prev,
        viewStep: 'catalog',
      }));
    }
  };

  const handleEnterMicroPractice = () => {
    setIsTimerRunning(false);
    setIsHistoryDrawerOpen(false);
    setErrorMsg(null);
    setIsMicroPracticeMode(true);
  };

  // Upsert a practiced or submitted Task 1 prompt into personal Task 1 Topic Bank ('ielts_task1_topic_bank_v1')
  const upsertTask1TopicBank = useCallback(
    (params: {
      topicId?: string | 'custom';
      prompt: string;
      chartImage: string | null;
      chartType: Task1ChartType;
      bandScore?: number;
      reportId?: string;
    }): string => {
      const cleanPrompt = params.prompt.trim();
      const normPrompt = cleanPrompt.toLowerCase();
      const nowIso = new Date().toISOString();

      // Un-mark from deleted keys if user re-submits this prompt
      setDeletedTask1Keys((prevKeys) =>
        prevKeys.filter(
          (k) =>
            k !== normPrompt &&
            (!params.topicId || k !== params.topicId)
        )
      );

      let resolvedId =
        params.topicId && params.topicId !== 'custom'
          ? params.topicId
          : `t1-user-${Date.now()}`;

      setTask1TopicBank((prevBank) => {
        const list = Array.isArray(prevBank) ? [...prevBank] : [];
        const matchIdx = list.findIndex(
          (item) =>
            (params.topicId &&
              params.topicId !== 'custom' &&
              item.id === params.topicId) ||
            item.prompt.trim().toLowerCase() === normPrompt
        );

        if (matchIdx !== -1) {
          const existing = list[matchIdx];
          resolvedId = existing.id;
          const nextBestBand =
            params.bandScore !== undefined
              ? existing.bestBand !== null && existing.bestBand !== undefined
                ? Math.max(existing.bestBand, params.bandScore)
                : params.bandScore
              : existing.bestBand ?? null;
          const nextAttemptCount =
            params.bandScore !== undefined
              ? (existing.attemptCount || 0) + 1
              : existing.attemptCount || 0;

          const updatedItem: Task1TopicBankItem = {
            ...existing,
            prompt: cleanPrompt,
            chartImage: params.chartImage || existing.chartImage || null,
            chartType: existing.isBuiltIn
              ? existing.chartType
              : params.chartType || existing.chartType,
            bestBand: nextBestBand,
            attemptCount: nextAttemptCount,
            lastEssayId: params.reportId || existing.lastEssayId || null,
            updatedAt: nowIso,
          };
          list[matchIdx] = updatedItem;
          return list;
        }

        const newItem: Task1TopicBankItem = {
          id: resolvedId,
          prompt: cleanPrompt,
          chartImage: params.chartImage || null,
          chartType: params.chartType,
          bestBand: params.bandScore ?? null,
          attemptCount: params.bandScore !== undefined ? 1 : 0,
          lastEssayId: params.reportId ?? null,
          updatedAt: nowIso,
          isBuiltIn: false,
        };
        return [newItem, ...list];
      });

      return resolvedId;
    },
    [setDeletedTask1Keys, setTask1TopicBank]
  );

  const task1ReferencePrompt = task1Report?.prompt ?? selectedTask1TopicItem?.prompt ?? '';
  const task1ReferenceImage = resolveTask1ChartImage(
    task1Report?.image ?? task1Report?.chartImageDataUrl ?? selectedTask1TopicItem?.chartImage
  );
  const hasTask1DraftChanges =
    task1Draft.content.trim() !== (task1Report?.essay.trim() ?? '') ||
    task1Draft.prompt.trim() !== task1ReferencePrompt.trim() ||
    task1DraftChartImage !== task1ReferenceImage;
  const hasTask2DraftChanges =
    task2Draft.content.trim() !== (task2Report?.essay.trim() ?? '') ||
    (isTask2CustomPrompt &&
      task2Draft.customPrompt.trim() !== (task2Report?.prompt.trim() ?? ''));

  const confirmTopicChange = (nextTopicId: string) => {
    const currentTopicId = activeTaskType === 'task1'
      ? task1Draft.selectedTopicId || 'custom'
      : task2Draft.selectedTopicId;
    const hasDraftChanges = activeTaskType === 'task1' ? hasTask1DraftChanges : hasTask2DraftChanges;
    return currentTopicId === nextTopicId || !hasDraftChanges ||
      window.confirm('每个 Task 只能保留一份草稿。换题会替换当前未提交的内容，继续吗？');
  };

  // Select "自由命题 · 新建图表作文 (Custom Chart Prompt)" from Task 1 Catalog
  const handleSelectTask1CustomPromptMode = () => {
    if (!confirmTopicChange('custom')) return;
    setIsTimerRunning(false);
    setTask1Draft((prev) => {
      const isAlreadyCustom = !prev.selectedTopicId || prev.selectedTopicId === 'custom';
      if (isAlreadyCustom && (!task1Report || hasTask1DraftChanges)) {
        return { ...prev, selectedTopicId: 'custom', viewStep: 'writing' };
      }
      return {
        ...prev,
        selectedTopicId: 'custom',
        viewStep: 'writing',
        chartType: undefined,
        chartTypeManuallySelected: false,
        prompt: '',
        image: null,
        content: '',
        timer: 1200,
        gradedReportId: null,
      };
    });
    setErrorMsg(null);
  };

  // Select a Task 1 Topic Card from Task 1 Catalog (Carries [原题目 + 原图表图片] into Dual-Column Workbench for Rewrite)
  const handleSelectTask1TopicCard = (item: Task1TopicBankItem) => {
    if (!confirmTopicChange(item.id)) return;
    setIsTimerRunning(false);
    setTask1Draft((prev) => {
      if (prev.selectedTopicId === item.id && (!task1Report || hasTask1DraftChanges)) {
        return { ...prev, viewStep: 'writing' };
      }
      return {
        ...prev,
        selectedTopicId: item.id,
        viewStep: 'writing',
        chartType: item.chartType,
        chartTypeManuallySelected: false,
        prompt: item.prompt,
        image: item.chartImage || null,
        content: '',
        timer: 1200,
        gradedReportId: null,
      };
    });
    setErrorMsg(null);
  };

  // Click 查看上次批改 on a Task 1 Topic Card
  const handleViewTask1TopicLastReport = (
    item: Task1TopicBankItem,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const normPrompt = item.prompt.trim().toLowerCase();
    let idx = -1;
    if (item.lastEssayId) {
      idx = task1Reports.findIndex((r) => r.id === item.lastEssayId);
    }
    if (idx === -1) {
      idx = task1Reports.findIndex(
        (r) =>
          r.topicId === item.id ||
          r.prompt.trim().toLowerCase() === normPrompt
      );
    }
    if (idx !== -1) {
      handleSelectHistoryRecord(idx);
    }
  };

  // Delete a Task 1 Topic Card from Task 1 Catalog
  const handleDeleteTask1TopicCard = (
    item: Task1TopicBankItem,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const normPrompt = item.prompt.trim().toLowerCase();
    setDeletedTask1Keys((prev) =>
      Array.from(new Set([...prev, item.id, normPrompt]))
    );
    setTask1TopicBank((prev) => prev.filter((c) => c.id !== item.id));
  };

  // Select "✍️ 自由命题 (Custom Prompt)" from Task 2 Catalog
  const handleSelectCustomPromptMode = () => {
    if (!confirmTopicChange('custom')) return;
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
    setErrorMsg(null);
  };

  // Select a built-in Master Prompt from Task 2 Catalog
  const handleSelectBuiltInPrompt = (item: MasterWritingPrompt) => {
    if (!confirmTopicChange(item.id)) return;
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
    setErrorMsg(null);
  };

  // Returning to the catalog preserves the active task's draft.
  const handleReturnToCatalog = () => {
    setIsTimerRunning(false);
    setErrorMsg(null);
    if (activeTaskType === 'task1') {
      setTask1Draft((prev) => ({ ...prev, viewStep: 'catalog' }));
    } else {
      setTask2Draft((prev) => ({ ...prev, viewStep: 'catalog' }));
    }
  };

  // Strictly isolated prompt text change handler
  const handlePromptChange = (newPromptText: string) => {
    if (isHistoryMode) return;
    if (activeTaskType === 'task1') {
      setTask1Draft((prev) => ({
        ...prev,
        prompt: newPromptText,
        chartType: undefined,
        chartTypeManuallySelected: false,
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
    setErrorMsg(null);
    if (activeTaskType === 'task1') {
      setIsTask1TimeUpLocked(false);
      setTask1TimedWords(null);
      setTask1Draft({
        selectedTopicId: 'custom',
        viewStep: 'catalog',
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
        outline: '',
        outlinesByTopic: {
          ...(prev.outlinesByTopic || {}),
          [prev.selectedTopicId || 'custom']: '',
        },
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
        ? task1ResolvedTopicTag
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

    const initialChartType = activeTaskType === 'task1'
      ? task1Draft.chartType ||
        (selectedTask1TopicItem?.isBuiltIn ? selectedTask1TopicItem.chartType : undefined)
      : undefined;

    // Archive known chart types immediately. Otherwise use the evaluation result.
    if (initialChartType) {
      upsertTask1TopicBank({
        topicId: task1Draft.selectedTopicId,
        prompt: activePrompt.trim(),
        chartImage: task1Draft.image || null,
        chartType: initialChartType,
      });
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
        model:
          aiConfig.model === 'deepseek-v4-flash' ||
          aiConfig.model === 'deepseek-v4-pro'
            ? aiConfig.model
            : 'deepseek-v4-pro',
      });

      const resolvedChartType: Task1ChartType | undefined =
        activeTaskType === 'task1'
          ? initialChartType || inferTask1ChartType(
              activePrompt,
              activeEssay,
              newReport.chartType
            )
          : undefined;

      const resolvedTopicTag =
        activeTaskType === 'task1' && resolvedChartType
          ? `${TASK1_CHART_TYPE_ENGLISH[resolvedChartType]} · ${resolvedChartType}`
          : activeTopicTag;

      let savedTask1TopicId: string | undefined;
      if (activeTaskType === 'task1' && resolvedChartType) {
        savedTask1TopicId = upsertTask1TopicBank({
          topicId: task1Draft.selectedTopicId,
          prompt: activePrompt.trim(),
          chartImage: task1Draft.image || null,
          chartType: resolvedChartType,
          bandScore: newReport.overallBand,
          reportId: newReport.id,
        });
      }

      const enrichedReport: WritingEvaluationReport = {
        ...newReport,
        taskType: activeTaskType,
        firstCriterionLabel: activeTaskType === 'task1' ? 'TA' : 'TR',
        topicId:
          activeTaskType === 'task1'
            ? savedTask1TopicId || task1Draft.selectedTopicId
            : task2Draft.selectedTopicId,
        topicTag: resolvedTopicTag,
        chartType: resolvedChartType,
        image: activeTaskType === 'task1' ? task1Draft.image || null : null,
        chartImageDataUrl:
          activeTaskType === 'task1' ? task1Draft.image || null : null,
      };

      onSaveReport(enrichedReport);
      if (activeTaskType === 'task1') {
        setTask1Draft((prev) => ({
          ...prev,
          selectedTopicId: savedTask1TopicId || prev.selectedTopicId,
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

  // Open the task-specific History Archive Drawer ('小作文历史记录' or '大作文历史记录')
  const handleEnterHistoryMode = () => {
    setIsTimerRunning(false);
    setErrorMsg(null);
    setIsHistoryDrawerOpen(true);
  };

  // Inspect a specific historical record in full dual-sheet view
  const handleSelectHistoryRecord = (index: number) => {
    setHistoryIndex(index);
    setViewMode('history');
    setIsHistoryDrawerOpen(false);
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
    setErrorMsg(null);
  };

  // Vocabulary Ingestion from LR Paraphrasing Upgrade Item
  const handleIngestLexicalItem = (
    item: LexicalUpgradeItem,
    report: WritingEvaluationReport
  ) => {
    const { headword, extraSynonyms } = parseUpgradedParts(item.upgraded);
    const forbiddenOriginals = new Set(
      [
        headword,
        item.original,
        item.originalError,
        ...item.original.split(/\s*[/|]\s*/),
      ]
        .filter(Boolean)
        .map((s) => String(s).trim().toLowerCase())
    );

    const rawAiSynonyms = Array.isArray(item.synonyms) ? item.synonyms : [];
    const cleanSynonyms = Array.from(
      new Set([...rawAiSynonyms, ...extraSynonyms].map((s) => String(s).trim()))
    ).filter(
      (s) =>
        s.length > 0 &&
        s.length <= 36 &&
        !forbiddenOriginals.has(s.toLowerCase())
    );

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

    const conciseMeaning =
      item.meaning ||
      item.chineseMeaning ||
      item.contextExplanation.slice(0, 20);
    onIngestVocab({
      word: headword,
      phonetic: cleanPhonetic,
      partOfSpeech: cleanPos,
      meaning: conciseMeaning,
      chineseMeaning: conciseMeaning,
      fullMeaning: item.fullMeaning || undefined,
      englishDefinition: item.contextExplanation,
      paraphrasing: cleanSynonyms,
      synonyms: cleanSynonyms,
      exampleSentence: modifiedSentence,
      exampleTranslation: '',
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

    const forbiddenOriginals = new Set(
      [targetPhrase, corr.original, corr.originalError]
        .filter(Boolean)
        .map((s) => String(s).trim().toLowerCase())
    );

    const rawAiSynonyms = Array.isArray(corr.synonyms) ? corr.synonyms : [];
    const cleanSynonyms = Array.from(
      new Set(rawAiSynonyms.map((s) => String(s).trim()))
    ).filter(
      (s) =>
        s.length > 0 &&
        s.length <= 36 &&
        !forbiddenOriginals.has(s.toLowerCase())
    );

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

    const conciseMeaning = corr.meaning || corr.chineseMeaning || corr.errorType;
    onIngestVocab({
      word: targetPhrase,
      phonetic: cleanPhonetic,
      partOfSpeech: cleanPos,
      meaning: conciseMeaning,
      chineseMeaning: conciseMeaning,
      englishDefinition: corr.explanation,
      paraphrasing: cleanSynonyms,
      synonyms: cleanSynonyms,
      exampleSentence: corr.corrected,
      exampleTranslation: '',
      topicTag: report.topicTag || '来自写作批改',
      isCustom: true,
      fromWriting: true,
    });
  };

  // Vocabulary Ingestion from Module 2 Paragraph Key Correction Item
  const handleIngestParagraphKeyCorrection = (
    item: ParagraphKeyCorrection,
    report: WritingEvaluationReport
  ) => {
    const { headword, extraSynonyms } = parseUpgradedParts(item.upgradedWord);
    const forbiddenOriginals = new Set(
      [
        headword,
        item.originalError,
        ...item.originalError.split(/\s*[/|]\s*/),
      ]
        .filter(Boolean)
        .map((s) => String(s).trim().toLowerCase())
    );

    const rawAiSynonyms = Array.isArray(item.synonyms) ? item.synonyms : [];
    const cleanSynonyms = Array.from(
      new Set([...rawAiSynonyms, ...extraSynonyms].map((s) => String(s).trim()))
    ).filter(
      (s) =>
        s.length > 0 &&
        s.length <= 36 &&
        !forbiddenOriginals.has(s.toLowerCase())
    );

    const rawPhonetic = (item.phonetic || '').trim();
    const cleanPhonetic =
      rawPhonetic && !/academic|phrase|collocation|expr/i.test(rawPhonetic)
        ? rawPhonetic
        : '';
    const rawPos = (item.pos || '').trim();
    const cleanPos =
      rawPos && !/^(acad\.|expr\.)$/i.test(rawPos)
        ? rawPos
        : headword.includes(' ')
        ? 'phrase'
        : 'n.';

    const userSentence = findMatchingSentenceInEssay(
      report.essay,
      item.originalError
    );

    const conciseMeaning = item.meaning || '高分学术表达';
    onIngestVocab({
      word: headword,
      phonetic: cleanPhonetic,
      partOfSpeech: cleanPos,
      meaning: conciseMeaning,
      chineseMeaning: conciseMeaning,
      fullMeaning: item.fullMeaning || undefined,
      englishDefinition: headword,
      paraphrasing: cleanSynonyms,
      synonyms: cleanSynonyms,
      exampleSentence: item.example || userSentence,
      exampleTranslation: '',
      topicTag: report.topicTag || '来自写作批改',
      isCustom: true,
      fromWriting: true,
      vocabCategory: 'writing',
    });
  };

  const [copiedModelEssayId, setCopiedModelEssayId] = useState<string | null>(
    null
  );
  const [speakingModelEssayId, setSpeakingModelEssayId] = useState<
    string | null
  >(null);

  const handleCopyModelEssay = (reportId: string, fullText: string) => {
    if (!fullText.trim()) return;
    navigator.clipboard?.writeText(fullText.trim()).catch(() => {});
    setCopiedModelEssayId(reportId);
    window.setTimeout(() => {
      setCopiedModelEssayId((prev) => (prev === reportId ? null : prev));
    }, 2000);
  };

  const handleSpeakModelEssay = (reportId: string, fullText: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speakingModelEssayId === reportId) {
      window.speechSynthesis.cancel();
      setSpeakingModelEssayId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(fullText);
    utterance.lang = 'en-GB';
    utterance.rate = 0.94;
    utterance.onend = () => setSpeakingModelEssayId(null);
    utterance.onerror = () => setSpeakingModelEssayId(null);
    setSpeakingModelEssayId(reportId);
    window.speechSynthesis.speak(utterance);
  };

  const isFinalFiveMinutes = secondsLeft > 0 && secondsLeft <= 300;
  const showTopTaskSwitcher =
    isMicroPracticeMode || isHistoryMode || currentStep === 'catalog';

  return (
    <div className="workspace-module">
      {/* TOP 3-SEGMENT SUB-NAVIGATION BAR: [ Task 1 | Task 2 | 小练习 ] */}
      {showTopTaskSwitcher && (
        <div className="workspace-toolbar workspace-toolbar--center select-none">
          <nav aria-label="写作导航" className="segmented-control skeuo-groove">
            <button
              type="button"
              onClick={() => handleTopTaskTypeSwitch('task1')}
              aria-pressed={!isMicroPracticeMode && displayedTaskType === 'task1'}
              className={!isMicroPracticeMode && displayedTaskType === 'task1' ? 'skeuo-switch-thumb' : ''}
            >
              Task 1
            </button>
            <button
              type="button"
              onClick={() => handleTopTaskTypeSwitch('task2')}
              aria-pressed={!isMicroPracticeMode && displayedTaskType === 'task2'}
              className={!isMicroPracticeMode && displayedTaskType === 'task2' ? 'skeuo-switch-thumb' : ''}
            >
              Task 2
            </button>
            <button
              type="button"
              onClick={handleEnterMicroPractice}
              aria-pressed={isMicroPracticeMode}
              className={isMicroPracticeMode ? 'skeuo-switch-thumb' : ''}
            >
              小练习
            </button>
          </nav>
        </div>
      )}
      {isMicroPracticeMode ? (
        <MicroPracticeView
          aiConfig={aiConfig}
          vocabCards={vocabCards}
          onIngestVocab={onIngestVocab}
          onExcerptToNotes={onExcerptToNotes}
          excerptedKeys={excerptedKeys}
          onOpenApiKeyModal={onOpenApiKeyModal}
        />
      ) : !isHistoryMode &&
        activeTaskType === 'task1' &&
        currentStep === 'catalog' ? (
        <section>

            {/* Catalog Header & Top Chart Type Filter Bar */}
            <div className="workspace-toolbar workspace-toolbar--inset">
              {/* Left Chart Type Filter Pills: 全部 | 折线图 | 柱状图 | 饼图 | 表格 | 地图 | 流程图 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {TASK1_CATALOG_FILTERS.map((cat) => {
                  const isActive = selectedTask1Category === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setSelectedTask1Category(cat.key)}
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

              {/* Right Symmetrical [ 历史批改 ] Tactile Button */}
              <button
                type="button"
                onClick={handleEnterHistoryMode}
                className="skeuo-btn-light rounded-lg px-3.5 py-1.5 font-sans text-xs font-medium text-[#262523]"
              >
                <span>历史批改</span>
                {task1Reports.length > 0 && (
                  <span className="ml-1 font-mono">
                    ({task1Reports.length})
                  </span>
                )}
              </button>
            </div>

            {/* Catalog Body: Pinned Custom Chart Prompt Card + Left-Prompt / Right-Thumbnail Topic Cards */}
            <div className="workspace-inset workspace-catalog">
              {/* PINNED TOP SPECIAL CARD: 自由命题 · 新建图表作文 (Custom Chart Prompt) */}
              <button
                type="button"
                onClick={handleSelectTask1CustomPromptMode}
                className="catalog-custom group"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 font-serif text-base font-semibold text-[#262523]">
                      <PenLine className="h-4 w-4 text-[#EA5B25]" />
                      <span>
                        自由命题 · 新建图表作文 (Custom Chart Prompt)
                      </span>
                    </span>
                  </div>

                  {isTask1CustomPrompt &&
                  !task1Report &&
                  (task1WordCount > 0 || task1Draft.prompt.trim()) ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#262523]">
                      <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                      <span>继续草稿 ({task1WordCount} words)</span>
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-[#7A7873] transition-transform group-hover:translate-x-0.5 group-hover:text-[#262523]">
                      进入书写 →
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-[#7A7873]">
                  自行粘贴剑桥真题与图表截图，AI 考官将自动识别题型并归入你的个人图表题库
                </p>
              </button>

              {/* TASK 1 TOPIC CARDS LIST: 左题干 (78%) · 右图表缩略图 (22%, max-w-[160px]) */}
              {filteredTask1TopicBank.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-[#E6E3DA] bg-[#FAF8F2]/60 py-12 text-center">
                  <p className="font-sans text-sm font-medium text-[#262523]">
                    当前「{selectedTask1Category}」分类下暂无图表题
                  </p>
                  <p className="mt-1.5 font-sans text-xs text-[#7A7873]">
                    点击上方「自由命题 · 新建图表作文」完成练习后，AI 将自动识别题型并沉淀至此。
                  </p>
                </div>
              ) : (
                <div className="catalog-grid">
                  {filteredTask1TopicBank.map((item) => {
                    const chartImage = resolveTask1ChartImage(item.chartImage);
                    const globalIdx =
                      task1TopicBank.findIndex((p) => p.id === item.id) + 1;
                    const formattedNo = String(
                      globalIdx > 0 ? globalIdx : 1
                    ).padStart(2, '0');
                    const enType =
                      TASK1_CHART_TYPE_ENGLISH[item.chartType] || 'Mixed chart';
                    const zhType =
                      item.chartType === 'mixed' ? '组合图' : item.chartType;
                    const normPrompt = item.prompt.trim().toLowerCase();
                    const matchingReports = task1Reports.filter(
                      (r) =>
                        r.topicId === item.id ||
                        r.prompt.trim().toLowerCase() === normPrompt
                    );
                    const hasReportRecord =
                      Boolean(item.lastEssayId) || matchingReports.length > 0;
                    const effectiveAttempts = Math.max(
                      item.attemptCount || 0,
                      matchingReports.length
                    );
                    const effectiveBestBand =
                      item.bestBand !== null && item.bestBand !== undefined
                        ? item.bestBand
                        : matchingReports.length > 0
                        ? Math.max(...matchingReports.map((r) => r.overallBand))
                        : null;
                    const hasActiveDraftHere =
                      !isTask1CustomPrompt &&
                      task1Draft.selectedTopicId === item.id &&
                      task1WordCount > 0 &&
                      !task1Report;

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectTask1TopicCard(item)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            handleSelectTask1TopicCard(item);
                          }
                        }}
                        className="catalog-topic catalog-topic--chart group cursor-pointer"
                      >
                        {/* Left Column (78% width): Nameplate + Band Stamp + Newsreader Prompt + Bottom Actions */}
                        <div className="min-w-0 flex-1">
                          {/* Top Monospace Nameplate + Practiced Band Score */}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold tracking-wider text-[#7A7873]">
                                NO. {formattedNo} · {enType} · {zhType}
                              </span>

                              {effectiveAttempts > 0 && (
                                <span
                                  style={{
                                    fontVariantNumeric:
                                      'lining-nums tabular-nums',
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded border border-[#E5C5B8] bg-[#FAF0EC] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#262523]"
                                >
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#EA5B25]" />
                                  {effectiveBestBand !== null && (
                                    <span>
                                      BAND {effectiveBestBand.toFixed(1)}
                                    </span>
                                  )}
                                  <span className="font-sans text-[10px] font-normal text-[#7A7873]">
                                    已练 {effectiveAttempts} 次
                                  </span>
                                </span>
                              )}

                              {hasActiveDraftHere && (
                                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#262523]">
                                  <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                                  <span>草稿 ({task1WordCount}w)</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Middle Prompt Text (Newsreader Serif) */}
                          <p
                            style={{
                              fontSize: '19px',
                              lineHeight: '1.8',
                              color: '#2C2A29',
                            }}
                            className="mt-2.5 font-serif text-[19px] leading-[1.8] text-[#2C2A29]"
                          >
                            {item.prompt}
                          </p>

                          {/* Bottom Right of Left Column: 查看上次批改 + Hover Delete Icon */}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-[11px] text-[#9E988E] transition-colors group-hover:text-[#262523]">
                              {effectiveAttempts > 0
                                ? '点击卡片进入二刷重写 →'
                                : '点击卡片进入书写 →'}
                            </span>

                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-2"
                            >
                              {hasReportRecord && (
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleViewTask1TopicLastReport(item, e)
                                  }
                                  className="rounded border border-[#D8D3C6] bg-[#EFECE3]/80 px-2.5 py-0.5 font-sans text-[11px] font-medium text-[#5C5852] transition-colors hover:border-[#EA5B25]/50 hover:bg-[#FAF0EC] hover:text-[#EA5B25]"
                                >
                                  查看上次批改
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) =>
                                  handleDeleteTask1TopicCard(item, e)
                                }
                                className="rounded p-1 text-[#B5B0A4] transition-colors hover:bg-[#EFECE3] hover:text-[#EA5B25]"
                                title="从个人图表题库中删除该题"
                                aria-label="删除该题"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Right Column (22% width, max-w-[160px]): Chart Miniature Thumbnail */}
                        <div className="catalog-thumbnail">
                          {chartImage ? (
                            <img
                              src={chartImage}
                              alt={`${zhType} preview`}
                              className="w-full rounded border border-[#E5E0D5] bg-[#FAF8F5] object-contain p-1.5"
                            />
                          ) : (
                            <div className="flex w-full flex-col items-center justify-center rounded border border-[#E5E0D5] bg-[#FAF8F5] p-1.5 text-center font-mono text-[10px] text-[#ACA79C]">
                              <span>{enType}</span>
                              <span className="mt-0.5 font-sans text-[10px]">
                                {zhType}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        </section>
      ) : !isHistoryMode &&
        activeTaskType === 'task2' &&
        currentStep === 'catalog' ? (
        <section>

            {/* Catalog Header & Top Theme Filter Bar */}
            <div className="workspace-toolbar workspace-toolbar--inset">
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

              {/* Task 2 Exclusive History Archive Entry Button (Always Visible on Right of Top Filter Bar) */}
              <button
                type="button"
                onClick={handleEnterHistoryMode}
                className="skeuo-btn-light rounded-lg px-3.5 py-1.5 font-sans text-xs font-medium text-[#262523]"
              >
                <span>历史批改</span>
                {task2Reports.length > 0 && (
                  <span className="ml-1 font-mono">
                    ({task2Reports.length})
                  </span>
                )}
              </button>
            </div>

            {/* Catalog Body: Pinned Custom Prompt Card + Built-in Master Prompts */}
            <div className="workspace-inset workspace-catalog">
              {/* PINNED TOP SPECIAL CARD: 自由命题 (Custom Prompt) */}
              <button
                type="button"
                onClick={handleSelectCustomPromptMode}
                className="catalog-custom group"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 font-serif text-base font-semibold text-[#262523]">
                      <PenLine className="h-4 w-4 text-[#EA5B25]" />
                      <span>自由命题 (Custom Prompt)</span>
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
              <div className="catalog-grid">
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
                      className="catalog-topic group"
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

                      <p
                        style={{
                          fontSize: '19px',
                          lineHeight: '1.8',
                          color: '#2C2A29',
                        }}
                        className="mt-2.5 font-serif text-[19px] leading-[1.8] text-[#2C2A29]"
                      >
                        {item.prompt}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
        </section>
      ) : !activeRightReport ? (
        /* =====================================================================
            STEP 2A: 作文写作工作台
           ===================================================================== */
        <WritingWorkspace resizable={displayedTaskType === 'task1'}>
          <div className="workspace-pane workspace-pane--reference">
            {/* Left Page Top Header */}
            <div className="pane-toolbar select-none">
              <button
                type="button"
                onClick={handleReturnToCatalog}
                className="skeuo-switch-thumb inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-semibold leading-none text-[#262523] transition-all hover:brightness-[1.01] active:translate-y-[1px]"
              >
                <span className="leading-none">← 返回</span>
              </button>
              <span className="workspace-label font-mono">
                {formatPrintedStamp(displayedTopicTag)}
              </span>
              <button
                type="button"
                aria-controls="writing-essay"
                onClick={(event) => {
                  const editor = essayTextareaRef.current;
                  if (!editor) return;
                  editor.toggleAttribute('data-pointer-focus', event.detail > 0);
                  editor.focus({ preventScroll: true });
                  editor.scrollIntoView({ block: 'start' });
                }}
                className="writing-jump ml-auto text-xs font-medium text-[#6E675E] hover:text-[#2C2A29]"
              >
                去写正文 ↓
              </button>
            </div>

            <div id="writing-reference" className="pane-scroll" role="region" aria-label="题目和图表" tabIndex={0}>

              {/* 题目要求 */}
              <div className="pane-content">
                <div className="workspace-label writing-prompt-label font-mono">
                  题目要求
                </div>
                {displayedTaskType === 'task1' || isTask2CustomPrompt ? (
                  <textarea
                    ref={customPromptTextareaRef}
                    rows={3}
                    value={displayedPrompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    placeholder={
                      displayedTaskType === 'task1'
                        ? '在此粘贴或输入你的小作文题目...'
                        : '在此粘贴或输入你的大作文题目...'
                    }
                    aria-label="作文题目"
                    className="writing-prompt block w-full resize-none overflow-hidden border-none bg-transparent font-serif placeholder:font-sans placeholder:text-[17px] placeholder:text-[#8C867E]/60 outline-none focus:outline-none focus:ring-0"
                  />
                ) : (
                  <p className="writing-prompt select-text font-serif">
                    {displayedPrompt}
                  </p>
                )}
                {displayedTaskType === 'task1' && (
                  <div className="writing-chart-section">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileInputChange}
                      className="hidden"
                    />

                    {displayedChartImage ? (
                      <button
                        ref={chartZoomButtonRef}
                        type="button"
                        onClick={() => setIsLightboxOpen(true)}
                        className="writing-chart group relative block cursor-zoom-in overflow-hidden rounded border border-[#DFDBD0] bg-white hover:border-[#C2BDB0]"
                        aria-label="放大图表"
                      >
                        <img src={displayedChartImage} alt="Task 1 Chart" />
                        <ZoomIn
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-2 right-2 size-6 rounded bg-[#FAF8F5]/90 p-1 text-[#5C5852] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex min-h-36 w-full flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-[#CFCBC0] bg-[#F3F0E6]/65 px-5 py-8 text-center text-xs text-[#7A7873] transition hover:border-[#B8B3A6] hover:bg-[#EFECE2] hover:text-[#262523]"
                      >
                        <ImagePlus className="h-6 w-6 text-[#EA5B25]" />
                        <span className="leading-relaxed">
                          直接按{' '}
                          <kbd className="font-mono font-semibold text-[#262523]">
                            Ctrl + V
                          </kbd>{' '}
                          粘贴图表截图（自动裁切多余白边）
                        </span>
                        <span className="font-mono text-[11px] text-[#9E988E]">
                          或点击此处上传本地图表图片
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="workspace-pane">
            <div className="pane-toolbar writing-timer-toolbar select-none">
              <div className="writing-timer skeuo-switch-thumb" role="group" aria-label="作文计时器">
                <button
                  ref={timerButtonRef}
                  type="button"
                  onClick={handleToggleTimer}
                  title={isTimerRunning ? '点击暂停倒计时' : '点击开始倒计时'}
                  aria-label={`${isTimerRunning ? '暂停' : '开始或继续'}倒计时，剩余 ${formatTimerDisplay(secondsLeft)}`}
                  className="inline-flex items-center gap-2 rounded-md px-2.5 font-mono text-xs font-semibold leading-none text-[#262523]"
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                      isTimerRunning
                        ? 'bg-[#EA5B25] animate-pulse shadow-[0_0_4px_rgba(234,91,37,0.65)]'
                        : isTimeUpLocked
                        ? 'bg-[#EA5B25]'
                        : 'bg-[#B8B4A9]'
                    }`}
                  />

                  <span
                    className={`leading-none tracking-wider ${
                      isTimeUpLocked || isFinalFiveMinutes
                        ? 'text-[#EA5B25]'
                        : 'text-[#262523]'
                    } ${isFinalFiveMinutes ? 'animate-pulse' : ''}`}
                  >
                    {formatTimerDisplay(secondsLeft)}
                  </span>
                </button>
                {!isTimerRunning && secondsLeft < defaultSecondsForTask && (
                  <button
                    type="button"
                    onClick={handleResetTimer}
                    title="重置回初始时间"
                    aria-label="重置回初始时间"
                    className="grid min-w-8 place-items-center rounded-md text-[#6E675E] hover:text-[#2C2A29]"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Time-Up Exam Lock Notice Banner */}
            {isTimeUpLocked && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EA5B25]/40 bg-[#F9EFEA] px-4 py-2 text-xs text-[#262523]">
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

            <div className="pane-scroll writing-manuscript" role="region" aria-label="作文编辑区">
              <div className="pane-content">
                <textarea
                  ref={essayTextareaRef}
                  id="writing-essay"
                  readOnly={isTimeUpLocked}
                  value={displayedEssay}
                  onChange={(e) => handleEssayChange(e.target.value)}
                  onPointerDown={(e) => e.currentTarget.setAttribute('data-pointer-focus', '')}
                  onBlur={(e) => e.currentTarget.removeAttribute('data-pointer-focus')}
                  placeholder="开始写作…"
                  aria-label="作文正文"
                  className={`block w-full resize-none overflow-hidden border-none bg-transparent font-serif text-[18px] leading-[1.7] text-[#2C2A29] placeholder:text-[16px] placeholder:text-[#B5B1A6] ${
                    isTimeUpLocked
                      ? 'cursor-default select-text opacity-85'
                      : ''
                  }`}
                />
              </div>
            </div>

            {/* Right Page Bottom Bar */}
            <div className="pane-toolbar pane-footer">
              {errorMsg && (
                <p role="alert" className="w-full text-xs text-[#A93812]">{errorMsg}</p>
              )}
              <button
                type="button"
                onClick={handleEnterHistoryMode}
                className="skeuo-btn-light px-3.5 font-sans text-xs font-medium"
              >
                历史批改
                {activeTaskReports.length > 0 && (
                  <span className="ml-1 font-mono">({activeTaskReports.length})</span>
                )}
              </button>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {timedCompletedWords !== null ? (
                  <span className="rounded-md border border-[#DFC5B8] bg-[#F9EFEA] px-2.5 py-1 font-mono text-xs font-semibold text-[#EA5B25]">
                    考场限时完成：{timedCompletedWords} words
                  </span>
                ) : (
                  <span className="font-mono text-xs tracking-wide text-[#7A7873]">
                    {displayedWordCount} words
                  </span>
                )}

                <button
                  type="button"
                  disabled={isEvaluating}
                  onClick={handleEvaluateDraft}
                  className="skeuo-btn-orange inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-sans text-xs font-semibold tracking-wide text-white disabled:opacity-60"
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
              </div>
            </div>
          </div>
        </WritingWorkspace>
      ) : (
        /* =====================================================================
            STEP 2B: POST-SUBMISSION / HISTORY OPEN-SPREAD DUAL-PAGE VIEW
            - Left Page (45%): Prompt + Chart Thumbnail + Candidate Essay Manuscript
            - Right Page (55%): Examiner 4-Dimension Diagnostic Score Sheet
           ===================================================================== */
        <section className="writing-report workspace-split workspace-viewport" aria-label="作文批改报告">
            {/* ===============================================================
                LEFT PAGE (45%): Compact Prompt + Chart Thumbnail + Essay Manuscript
               =============================================================== */}
            <div
              ref={reportReferencePaneRef}
              className="workspace-pane workspace-pane--reference pane-scroll justify-between"
              role="region"
              aria-label="题目和作文原稿"
              tabIndex={0}
            >
              <div>
                {/* Left Page Top Bar */}
                <div className="pane-toolbar select-none">
                  <div className="flex items-center gap-2.5">
                    {!isHistoryMode && (
                      <button
                        type="button"
                        onClick={handleReturnToCatalog}
                        className="skeuo-switch-thumb inline-flex h-7 items-center gap-1 rounded-lg px-3 text-xs font-semibold leading-none text-[#262523] transition-all hover:brightness-[1.01] active:translate-y-[1px]"
                      >
                        <span className="leading-none">← 返回</span>
                      </button>
                    )}
                    <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#7A7873] leading-none translate-y-[1px]">
                      {isHistoryMode
                        ? `ARCHIVE · ${formatPrintedStamp(displayedTopicTag)}`
                        : formatPrintedStamp(displayedTopicTag)}
                    </span>
                  </div>

                  <span className="font-mono text-xs text-[#7A7873]">
                    {displayedWordCount} words
                  </span>
                </div>

                {/* Compact Prompt Section */}
                <div className="pane-content border-b border-[#DCD6CC]">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#9E988E]">
                    PROMPT · 题目
                  </div>
                  <p
                    style={{
                      fontSize: '19px',
                      lineHeight: '1.8',
                      color: '#2C2A29',
                    }}
                    className="font-serif text-[19px] leading-[1.8] tracking-[0.01em] text-[#2C2A29] select-text"
                  >
                    {displayedPrompt}
                  </p>

                  {/* Task 1 Chart Thumbnail in Graded/History View */}
                  {displayedTaskType === 'task1' && displayedChartImage && (
                    <button
                      ref={chartZoomButtonRef}
                      type="button"
                      onClick={() => setIsLightboxOpen(true)}
                      className="group relative mt-3 block w-full max-w-[32.5rem] cursor-zoom-in overflow-hidden rounded-xl border border-[#D8D4C8] bg-white p-2 shadow-sm transition hover:border-[#C2BDB0]"
                      aria-label="放大图表"
                    >
                      <img
                        src={displayedChartImage}
                        alt="Task 1 Chart"
                        className="max-h-[260px] w-full rounded-lg bg-white object-contain"
                      />
                      <ZoomIn
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-2 right-2 size-6 rounded bg-[#FAF8F5]/90 p-1 text-[#5C5852] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    </button>
                  )}
                </div>

                {/* Candidate Essay Manuscript */}
                <div className="pane-content">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#9E988E]">
                    CANDIDATE ESSAY · 作文原稿
                  </div>
                  <textarea
                    ref={gradedEssayTextareaRef}
                    readOnly={isHistoryMode}
                    value={displayedEssay}
                    onChange={(e) => handleEssayChange(e.target.value)}
                    placeholder="在此开始沉浸式书写正文..."
                    aria-label="作文原稿"
                    style={{
                      fontSize: '20px',
                      lineHeight: '1.85',
                      color: '#2C2A29',
                    }}
                    className={`min-h-48 w-full resize-none overflow-hidden border-none bg-transparent font-serif text-[20px] leading-[1.85] text-[#2C2A29] placeholder:font-sans placeholder:text-[18px] placeholder:text-[#8C867E]/60 outline-none focus:outline-none focus:ring-0 ${
                      isHistoryMode ? 'cursor-default select-text' : ''
                    }`}
                  />
                </div>
              </div>

              {/* Left Page Footer (Draft mode allows re-submitting after edits) */}
              {!isHistoryMode && (
                <div className="pane-toolbar pane-footer">
                  <span className="font-mono text-[11px] text-[#7A7873]">
                    可直接修改上方原稿并再次交卷
                  </span>
                  <button
                    type="button"
                    disabled={isEvaluating}
                    onClick={handleEvaluateDraft}
                    className="skeuo-btn-orange inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-60"
                  >
                    {isEvaluating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>批改中</span>
                      </>
                    ) : (
                      <span>重新交卷批改</span>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* ===============================================================
                RIGHT PAGE (55%): Examiner 4-Dimension Diagnostic Score Sheet
               =============================================================== */}
            <div
              ref={reportPaneRef}
              className="workspace-pane pane-scroll"
              role="region"
              aria-label="批改详情"
              tabIndex={0}
            >
              {/* History Mode Top Bar OR Draft Graded Top Bar */}
              {isHistoryMode ? (
                <div className="pane-toolbar">
                  <div className="flex items-center gap-2 font-mono text-xs text-[#262523]">
                    <span className="hidden sm:inline-block font-mono text-[11px] font-semibold tracking-wider text-[#7A7873]">
                      {activeTaskType === 'task1'
                        ? 'TASK 1 · 小作文历史档案'
                        : 'TASK 2 · 大作文历史档案'}
                    </span>
                    <button
                      type="button"
                      disabled={
                        safeHistoryIndex >= activeTaskReports.length - 1
                      }
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
                <div className="pane-toolbar">
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
              <div className="pane-toolbar">
                <div className="flex w-full flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#7A7873]">
                      IELTS OFFICIAL DIAGNOSTIC SHEET
                    </div>
                    <div
                      style={{
                        fontVariantNumeric: 'lining-nums tabular-nums',
                      }}
                      className="mt-1 font-mono text-3xl font-bold tracking-tight text-[#262523]"
                    >
                      BAND {activeRightReport.overallBand.toFixed(1)}
                    </div>
                  </div>

                  {/* 4 Sub-scores Mechanical Stamp */}
                  <div
                    style={{
                      fontVariantNumeric: 'lining-nums tabular-nums',
                    }}
                    className="flex flex-wrap items-center gap-2 font-mono sm:gap-4"
                  >
                    <div className="text-right">
                      <div className="text-[10px] text-[#7A7873]">
                        {activeRightReport.firstCriterionLabel ||
                          (activeRightReport.taskType === 'task1'
                            ? 'TA'
                            : 'TR')}
                      </div>
                      <div className="text-sm font-semibold text-[#262523]">
                        {(
                          activeRightReport.dimensions?.taOrTr?.score ??
                          activeRightReport.trTa.band
                        ).toFixed(1)}
                      </div>
                    </div>
                    <div className="h-6 w-[1px] bg-[#DCD8CE]" />
                    <div className="text-right">
                      <div className="text-[10px] text-[#7A7873]">CC</div>
                      <div className="text-sm font-semibold text-[#262523]">
                        {(
                          activeRightReport.dimensions?.cc?.score ??
                          activeRightReport.cc.band
                        ).toFixed(1)}
                      </div>
                    </div>
                    <div className="h-6 w-[1px] bg-[#DCD8CE]" />
                    <div className="text-right">
                      <div className="text-[10px] text-[#7A7873]">LR</div>
                      <div className="text-sm font-semibold text-[#262523]">
                        {(
                          activeRightReport.dimensions?.lr?.score ??
                          activeRightReport.lr.band
                        ).toFixed(1)}
                      </div>
                    </div>
                    <div className="h-6 w-[1px] bg-[#DCD8CE]" />
                    <div className="text-right">
                      <div className="text-[10px] text-[#7A7873]">GRA</div>
                      <div className="text-sm font-semibold text-[#262523]">
                        {(
                          activeRightReport.dimensions?.gra?.score ??
                          activeRightReport.gra.band
                        ).toFixed(1)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Four-Module Examiner Report Body on Cream Paper */}
              <div
                ref={reportSheetBodyRef}
                className="pane-content relative divide-y divide-[#E6E1D8] text-xs leading-relaxed text-[#262523]"
              >
                <SelectionHighlightPopover
                  containerRef={reportSheetBodyRef}
                  isTextHighlighted={(text) =>
                    (activeRightReport.userHighlights || []).some(
                      (h) =>
                        h.text.trim().toLowerCase() ===
                        text.trim().toLowerCase()
                    )
                  }
                  onApplyHighlight={handleApplyReportHighlight}
                  onEraseHighlight={handleEraseReportHighlight}
                  aiConfig={aiConfig}
                  onIngestVocab={onIngestVocab}
                  onExcerptToNotes={onExcerptToNotes}
                  onOpenApiKeyModal={onOpenApiKeyModal}
                  sourceLabel={
                    activeRightReport.taskType === 'task1'
                      ? 'Task 1 批改报告摘录'
                      : 'Task 2 批改报告摘录'
                  }
                />

                {/* ============================================================
                    模块一：一、 雅思官方四维评分诊断 (Band Descriptors)
                   ============================================================ */}
                <section className="pb-6">
                  <h3 className="font-sans text-[13px] font-bold tracking-[0.06em] text-[#262523]">
                    一、 雅思官方四维评分诊断
                  </h3>

                  {/* 2x2 Grid of 4 Official Dimensions */}
                  <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      {
                        code:
                          activeRightReport.taskType === 'task1' ? 'TA' : 'TR',
                        name:
                          activeRightReport.taskType === 'task1'
                            ? 'Task Achievement · 任务完成'
                            : 'Task Response · 任务回应',
                        score:
                          activeRightReport.dimensions?.taOrTr?.score ??
                          activeRightReport.trTa.band,
                        diagnosis:
                          activeRightReport.dimensions?.taOrTr?.diagnosis ||
                          activeRightReport.trTa.summary,
                        strengths:
                          activeRightReport.dimensions?.taOrTr?.strengths ??
                          activeRightReport.trTa.strengths ??
                          [],
                        weaknesses:
                          activeRightReport.dimensions?.taOrTr?.weaknesses ??
                          activeRightReport.trTa.improvements ??
                          [],
                      },
                      {
                        code: 'CC',
                        name: 'Coherence & Cohesion · 连贯与衔接',
                        score:
                          activeRightReport.dimensions?.cc?.score ??
                          activeRightReport.cc.band,
                        diagnosis:
                          activeRightReport.dimensions?.cc?.diagnosis ||
                          activeRightReport.cc.summary,
                        strengths:
                          activeRightReport.dimensions?.cc?.strengths ??
                          activeRightReport.cc.strengths ??
                          [],
                        weaknesses:
                          activeRightReport.dimensions?.cc?.weaknesses ??
                          activeRightReport.cc.improvements ??
                          [],
                      },
                      {
                        code: 'LR',
                        name: 'Lexical Resource · 词汇资源',
                        score:
                          activeRightReport.dimensions?.lr?.score ??
                          activeRightReport.lr.band,
                        diagnosis:
                          activeRightReport.dimensions?.lr?.diagnosis ||
                          activeRightReport.lr.summary,
                        strengths:
                          activeRightReport.dimensions?.lr?.strengths ??
                          activeRightReport.lr.strengths ??
                          [],
                        weaknesses:
                          activeRightReport.dimensions?.lr?.weaknesses ??
                          activeRightReport.lr.improvements ??
                          [],
                      },
                      {
                        code: 'GRA',
                        name: 'Grammatical Range · 语法多样性',
                        score:
                          activeRightReport.dimensions?.gra?.score ??
                          activeRightReport.gra.band,
                        diagnosis:
                          activeRightReport.dimensions?.gra?.diagnosis ||
                          activeRightReport.gra.summary,
                        strengths:
                          activeRightReport.dimensions?.gra?.strengths ??
                          activeRightReport.gra.strengths ??
                          [],
                        weaknesses:
                          activeRightReport.dimensions?.gra?.weaknesses ??
                          activeRightReport.gra.improvements ??
                          [],
                      },
                    ].map((dim) => (
                      <div
                        key={dim.code}
                        className="rounded-xl border border-[#E6E1D8] bg-[#FAF8F3] p-3.5"
                      >
                        <div className="flex items-center justify-between border-b border-[#ECE8DF] pb-2">
                          <span className="font-mono text-[11px] font-semibold tracking-wider text-[#595650]">
                            {dim.code} · {dim.name}
                          </span>
                          <span
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="font-mono text-xs font-bold text-[#EA5B25]"
                          >
                            {dim.score.toFixed(1)}
                          </span>
                        </div>

                        <p className="mt-2 font-sans text-xs leading-relaxed text-[#262523]">
                          {renderTextWithHighlights(
                            dim.diagnosis,
                            activeRightReport.userHighlights
                          )}
                        </p>

                        {(dim.strengths.length > 0 ||
                          dim.weaknesses.length > 0) && (
                          <div className="mt-2.5 space-y-1 border-t border-dashed border-[#E6E1D8] pt-2 text-[11px]">
                            {dim.strengths.slice(0, 2).map((s, idx) => (
                              <div
                                key={`s-${idx}`}
                                className="text-[#5E5B54] leading-snug"
                              >
                                <span className="font-mono font-semibold text-[#262523]">
                                  + 亮点：
                                </span>
                                {renderTextWithHighlights(
                                  s,
                                  activeRightReport.userHighlights
                                )}
                              </div>
                            ))}
                            {dim.weaknesses.slice(0, 2).map((w, idx) => (
                              <div
                                key={`w-${idx}`}
                                className="text-[#5E5B54] leading-snug"
                              >
                                <span className="font-mono font-semibold text-[#EA5B25]">
                                  - 失分：
                                </span>
                                {renderTextWithHighlights(
                                  w,
                                  activeRightReport.userHighlights
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Overall Diagnostic Summary */}
                  {(activeRightReport.dimensions?.overallSummary ||
                    activeRightReport.examinerSummary) && (
                    <div className="mt-3.5 rounded-xl border border-[#E6E1D8] bg-[#F6F3EB]/80 px-4 py-3">
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7A7873]">
                        OVERALL SUMMARY · 考官总体优缺点综述
                      </div>
                      <p className="mt-1 font-sans text-xs leading-relaxed text-[#262523]">
                        {renderTextWithHighlights(
                          activeRightReport.dimensions?.overallSummary ||
                            activeRightReport.examinerSummary,
                          activeRightReport.userHighlights
                        )}
                      </p>
                    </div>
                  )}
                </section>

                {/* ============================================================
                    模块二：二、 逐段深度批改与逻辑重构 (Paragraph Critique & Reconstruction)
                   ============================================================ */}
                <section className="py-6">
                  <h3 className="font-sans text-[13px] font-bold tracking-[0.06em] text-[#262523]">
                    二、 逐段深度批改与逻辑重构
                  </h3>

                  {activeRightReport.paragraphReviews &&
                  activeRightReport.paragraphReviews.length > 0 ? (
                    <div className="mt-4 space-y-5">
                      {activeRightReport.paragraphReviews.map((para, pIdx) => (
                        <div
                          key={pIdx}
                          className="rounded-xl border border-[#E6E1D8] bg-[#FAF8F3] p-4 space-y-3.5"
                        >
                          {/* Paragraph Index Header */}
                          <div className="flex items-center justify-between border-b border-[#ECE8DF] pb-2">
                            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#262523]">
                              {para.paragraphIndex || `Paragraph ${pIdx + 1}`}
                            </span>
                            <span className="font-mono text-[10px] tracking-widest text-[#9E988E]">
                              PARAGRAPH CRITIQUE
                            </span>
                          </div>

                          {/* Original Paragraph Reference (subtle quote) */}
                          {para.originalText && (
                            <div className="border-l-2 border-[#DCD7CC] pl-3 font-serif text-xs italic leading-relaxed text-[#7A7873]">
                              {para.originalText}
                            </div>
                          )}

                          {/* 1. 【批注诊断】 */}
                          {para.logicAndLanguageCritique && (
                            <div>
                              <div className="font-sans text-[11px] font-semibold text-[#595650]">
                                【批注诊断】
                              </div>
                              <p className="mt-1 font-sans text-xs leading-relaxed text-[#262523]">
                                {renderTextWithHighlights(
                                  para.logicAndLanguageCritique,
                                  activeRightReport.userHighlights
                                )}
                              </p>
                            </div>
                          )}

                          {/* 2. 【考官逻辑重构段】 */}
                          {para.reconstructedParagraph && (
                            <div className="rounded-lg border border-[#E6E1D8] bg-[#F5F2EA]/75 p-3">
                              <div className="font-sans text-[11px] font-semibold text-[#262523]">
                                【考官逻辑重构段 · Band 7.5+】
                              </div>
                              <p className="mt-1.5 font-serif text-[13px] leading-[1.75] text-[#262523]">
                                {renderTextWithHighlights(
                                  para.reconstructedParagraph,
                                  activeRightReport.userHighlights
                                )}
                              </p>
                            </div>
                          )}

                          {/* 3. 【核心词汇纠错与升级】 + [ + 入库 ] */}
                          {para.keyCorrections &&
                            para.keyCorrections.length > 0 && (
                              <div className="space-y-2 pt-0.5">
                                <div className="font-sans text-[11px] font-semibold text-[#595650]">
                                  【核心词汇纠错与升级】
                                </div>
                                <div className="divide-y divide-[#ECE8DF] rounded-lg border border-[#E6E1D8] bg-[#FCFBF8] px-3.5 py-2">
                                  {para.keyCorrections.map((item, kIdx) => {
                                    const { headword } = parseUpgradedParts(
                                      item.upgradedWord
                                    );
                                    const isCollected = existingVocabSet.has(
                                      headword.trim().toLowerCase()
                                    );

                                    return (
                                      <div
                                        key={kIdx}
                                        className="flex items-start justify-between gap-3 py-2.5 first:pt-1 last:pb-1"
                                      >
                                        <div className="min-w-0 flex-1 space-y-1">
                                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                            {item.originalError && (
                                              <>
                                                <span className="font-serif text-xs text-[#9E988E] line-through">
                                                  {item.originalError}
                                                </span>
                                                <span className="font-mono text-[11px] text-[#9E988E]">
                                                  →
                                                </span>
                                              </>
                                            )}
                                            <span className="font-serif text-[13px] font-bold text-[#262523]">
                                              {item.upgradedWord}
                                            </span>
                                            {item.phonetic && (
                                              <span className="font-ipa text-[11px] text-[#8C867B]">
                                                {item.phonetic}
                                              </span>
                                            )}
                                            {item.pos && (
                                              <span className="font-mono text-[10px] text-[#8C867B]">
                                                {item.pos}
                                              </span>
                                            )}
                                            {item.meaning && (
                                              <span className="font-sans text-xs font-medium text-[#262523]">
                                                {item.meaning}
                                              </span>
                                            )}
                                          </div>

                                          {item.synonyms &&
                                            item.synonyms.length > 0 && (
                                              <div className="font-mono text-[10px] text-[#7A7873]">
                                                同义替换：
                                                <span className="font-serif text-[11px] text-[#595650]">
                                                  {item.synonyms.join(' / ')}
                                                </span>
                                              </div>
                                            )}

                                          {item.example && (
                                            <p className="font-serif text-[11.5px] italic leading-relaxed text-[#5E5B54]">
                                              “{item.example}”
                                            </p>
                                          )}
                                        </div>

                                        <button
                                          type="button"
                                          disabled={isCollected}
                                          onClick={() =>
                                            handleIngestParagraphKeyCorrection(
                                              item,
                                              activeRightReport
                                            )
                                          }
                                          className={`mt-0.5 shrink-0 rounded-md px-2.5 py-1 font-sans text-[11px] font-medium transition-all ${
                                            isCollected
                                              ? 'border border-[#D5D1C6] bg-[#EAE7DE] text-[#7A7873] cursor-default'
                                              : 'skeuo-btn-light text-[#262523] hover:text-[#EA5B25]'
                                          }`}
                                          title={
                                            isCollected
                                              ? '已入库至「写作积累」词盒'
                                              : '一键存入背单词「写作积累」词盒'
                                          }
                                        >
                                          {isCollected ? '✓ 已入库' : '+ 入库'}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Fallback for legacy historical reports without paragraphReviews */
                    <div className="mt-3.5 space-y-3">
                      {activeRightReport.lr.paraphrasingUpgrades.length > 0 && (
                        <div className="space-y-2 rounded-xl border border-[#E6E1D8] bg-[#FAF8F3] p-3.5">
                          <div className="font-sans text-[11px] font-semibold text-[#595650]">
                            【核心词汇纠错与升级】
                          </div>
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
                                    <span className="mx-2 text-[#7A7873]">
                                      →
                                    </span>
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
                                    className={`shrink-0 rounded-md px-2.5 py-0.5 font-sans text-[11px] font-medium transition-all ${
                                      isCollected
                                        ? 'border border-[#D5D1C6] bg-[#EAE7DE] text-[#7A7873] cursor-default'
                                        : 'skeuo-btn-light text-[#262523] hover:text-[#EA5B25]'
                                    }`}
                                  >
                                    {isCollected ? '✓ 已入库' : '+ 入库'}
                                  </button>
                                </div>
                              );
                            }
                          )}
                        </div>
                      )}

                      {activeRightReport.gra.errorCorrections.length > 0 && (
                        <div className="space-y-2.5 rounded-xl border border-[#E6E1D8] bg-[#FAF8F3] p-3.5">
                          <div className="font-sans text-[11px] font-semibold text-[#595650]">
                            【句子语法纠错对照】
                          </div>
                          {activeRightReport.gra.errorCorrections.map(
                            (corr, idx) => {
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
                                  className="space-y-1 border-b border-[#ECE8DF] pb-2.5 last:border-b-0 last:pb-0"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-serif text-xs text-[#9E988E] line-through">
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
                                      className={`shrink-0 rounded-md px-2.5 py-0.5 font-sans text-[11px] font-medium transition-all ${
                                        isCollected
                                          ? 'border border-[#D5D1C6] bg-[#EAE7DE] text-[#7A7873] cursor-default'
                                          : 'skeuo-btn-light text-[#262523] hover:text-[#EA5B25]'
                                      }`}
                                    >
                                      {isCollected ? '✓ 已入库' : '+ 入库'}
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
                            }
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* ============================================================
                    模块三：三、 突破分数天花板的核心策略 (Top 3 Actionable Strategies)
                   ============================================================ */}
                <section className="py-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-sans text-[13px] font-bold tracking-[0.06em] text-[#262523]">
                      三、 突破分数天花板的核心策略
                    </h3>

                    {onExcerptToNotes &&
                      (() => {
                        const reportKey = `report:${activeRightReport.id}`;
                        const isExcerpted =
                          excerptedKeys?.has(reportKey) ?? false;

                        const handleExcerptReport = () => {
                          if (isExcerpted) return;
                          const taskLabel =
                            activeRightReport.taskType === 'task1'
                              ? 'Task 1 图表作文'
                              : 'Task 2 大作文';
                          const strategies =
                            activeRightReport.breakthroughStrategies &&
                            activeRightReport.breakthroughStrategies.length > 0
                              ? activeRightReport.breakthroughStrategies
                              : [
                                  ...(activeRightReport.trTa.improvements ||
                                    []),
                                  ...(activeRightReport.cc.improvements || []),
                                  ...(activeRightReport.lr.improvements || []),
                                  ...(activeRightReport.gra.improvements || []),
                                ]
                                  .slice(0, 3)
                                  .map((advice, idx) => ({
                                    title: `核心提分维度策略 0${idx + 1}`,
                                    actionableAdvice: advice,
                                  }));

                          const strategyLines = strategies.map(
                            (st, idx) =>
                              `${idx + 1}. **${st.title}**：${st.actionableAdvice}`
                          );

                          const reconstructedLines = (
                            activeRightReport.paragraphReviews || []
                          )
                            .filter((p) => Boolean(p.reconstructedParagraph))
                            .map(
                              (p) =>
                                `- ${p.paragraphIndex} 考官重构：\n${p.reconstructedParagraph}`
                            );

                          const mdLines = [
                            `## 【${taskLabel}批改复盘】BAND ${activeRightReport.overallBand.toFixed(1)} · ${activeRightReport.topicTag || '核心提分复盘'}`,
                            `> PROMPT: ${activeRightReport.prompt}`,
                            ...strategyLines,
                            ...(reconstructedLines.length > 0
                              ? [
                                  '### 考官高分重构段落（Band 7.5+）',
                                  ...reconstructedLines,
                                ]
                              : []),
                          ];

                          onExcerptToNotes({
                            sourceKey: reportKey,
                            markdownBlock: mdLines.join('\n'),
                          });
                        };

                        return (
                          <button
                            type="button"
                            disabled={isExcerpted}
                            onClick={handleExcerptReport}
                            className={`shrink-0 rounded-md border border-[#DCD6CC] px-3 py-1 font-sans text-xs transition-all ${
                              isExcerpted
                                ? 'cursor-default bg-[#EFECE6] text-[#8C867E]'
                                : 'bg-[#FAF8F5] text-[#5C5852] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#F2EFE9] hover:text-[#2C2A29] active:translate-y-[0.5px]'
                            }`}
                          >
                            {isExcerpted ? '✓ 已摘录' : '+ 摘录至笔记'}
                          </button>
                        );
                      })()}
                  </div>

                  <div className="mt-3.5 space-y-3">
                    {(activeRightReport.breakthroughStrategies &&
                    activeRightReport.breakthroughStrategies.length > 0
                      ? activeRightReport.breakthroughStrategies
                      : [
                          ...(activeRightReport.trTa.improvements || []),
                          ...(activeRightReport.cc.improvements || []),
                          ...(activeRightReport.lr.improvements || []),
                          ...(activeRightReport.gra.improvements || []),
                        ]
                          .slice(0, 3)
                          .map((advice, idx) => ({
                            title: `核心提分维度策略 0${idx + 1}`,
                            actionableAdvice: advice,
                          }))
                    ).map((strategy, sIdx) => (
                      <div
                        key={sIdx}
                        className="flex items-start gap-3.5 rounded-xl border border-[#E6E1D8] bg-[#FAF8F3] p-3.5"
                      >
                        <span
                          style={{
                            fontVariantNumeric: 'lining-nums tabular-nums',
                          }}
                          className="mt-0.5 shrink-0 font-mono text-xs font-bold tracking-wider text-[#EA5B25]"
                        >
                          {String(sIdx + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-sans text-xs font-semibold text-[#262523]">
                            {renderTextWithHighlights(
                              strategy.title,
                              activeRightReport.userHighlights
                            )}
                          </div>
                          <p className="font-sans text-xs leading-relaxed text-[#595650]">
                            {renderTextWithHighlights(
                              strategy.actionableAdvice,
                              activeRightReport.userHighlights
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* ============================================================
                    模块四：四、 考官级完整范文 (Examiner's Band 8.0+ Model Essay)
                   ============================================================ */}
                <section className="pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-sans text-[13px] font-bold tracking-[0.06em] text-[#262523]">
                        四、 考官级完整范文
                      </h3>
                      <span
                        style={{
                          fontVariantNumeric: 'lining-nums tabular-nums',
                        }}
                        className="rounded-md border border-[#DFC5B8] bg-[#F9EFEA] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#EA5B25]"
                      >
                        {activeRightReport.modelEssay?.bandScore || 'Band 8.0+'}
                      </span>
                    </div>

                    {/* Copy & Speak Model Essay Controls */}
                    {(() => {
                      const modelParagraphs =
                        activeRightReport.modelEssay?.paragraphs &&
                        activeRightReport.modelEssay.paragraphs.length > 0
                          ? activeRightReport.modelEssay.paragraphs
                          : activeRightReport.improvedSampleParagraph
                          ? activeRightReport.improvedSampleParagraph
                              .split(/\n\s*\n/)
                              .filter(Boolean)
                          : [];
                      const fullModelText = modelParagraphs.join('\n\n');
                      if (!fullModelText) return null;

                      const isCopied =
                        copiedModelEssayId === activeRightReport.id;
                      const isSpeaking =
                        speakingModelEssayId === activeRightReport.id;

                      return (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleSpeakModelEssay(
                                activeRightReport.id,
                                fullModelText
                              )
                            }
                            className={`skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-sans text-[11px] font-medium transition-colors ${
                              isSpeaking
                                ? 'text-[#EA5B25]'
                                : 'text-[#595650] hover:text-[#262523]'
                            }`}
                            title="英式发音朗读范文"
                          >
                            <Volume2 className="h-3 w-3" />
                            <span>{isSpeaking ? '停止朗读' : '朗读范文'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleCopyModelEssay(
                                activeRightReport.id,
                                fullModelText
                              )
                            }
                            className="skeuo-btn-light inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-sans text-[11px] font-medium text-[#595650] transition-colors hover:text-[#262523]"
                            title="一键复制完整范文"
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3 w-3 text-[#EA5B25]" />
                                <span className="text-[#EA5B25]">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>复制范文</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Model Essay Paragraphs in Newsreader Serif */}
                  <div className="mt-3.5 space-y-3.5 rounded-xl border border-[#E6E1D8] bg-[#FAF8F3] p-5">
                    {(activeRightReport.modelEssay?.paragraphs &&
                    activeRightReport.modelEssay.paragraphs.length > 0
                      ? activeRightReport.modelEssay.paragraphs
                      : activeRightReport.improvedSampleParagraph
                      ? activeRightReport.improvedSampleParagraph
                          .split(/\n\s*\n/)
                          .filter(Boolean)
                      : ['暂无考官范文数据。']
                    ).map((pText, idx) => (
                      <p
                        key={idx}
                        className="font-serif text-[14px] leading-[1.85] text-[#262523]"
                      >
                        {renderTextWithHighlights(
                          pText,
                          activeRightReport.userHighlights
                        )}
                      </p>
                    ))}
                  </div>

                  {/* Model Essay Highlights */}
                  {activeRightReport.modelEssay?.highlights &&
                    activeRightReport.modelEssay.highlights.length > 0 && (
                      <div className="mt-3.5 rounded-xl border border-[#E6E1D8] bg-[#F6F3EB]/80 p-4">
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7A7873]">
                          MODEL HIGHLIGHTS · 范文高分逻辑骨架与词伙解析
                        </div>
                        <ul className="mt-2 space-y-1.5">
                          {activeRightReport.modelEssay.highlights.map(
                            (hl, hIdx) => (
                              <li
                                key={hIdx}
                                className="flex items-start gap-2 font-sans text-xs leading-relaxed text-[#262523]"
                              >
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#EA5B25]" />
                                <span>
                                  {renderTextWithHighlights(
                                    hl,
                                    activeRightReport.userHighlights
                                  )}
                                </span>
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                </section>
              </div>

              {/* Bottom Footer of Right Score Sheet */}
              <div className="flex items-center justify-between border-t border-[#ECE9E0] bg-[#F6F3EB]/60 px-8 py-3.5 text-[11px] font-mono text-[#7A7873]">
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
            </div>
        </section>
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
            <div className="pt-3">
              <div className="h-[2px] w-full bg-[#C97A63]/35" />
              <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
            </div>

            {/* Symmetrical Drawer Header Bar: Left [ ← 返回 ] Tactile Key | Center Pure Ink Title */}
            <div className="grid grid-cols-3 items-center border-b border-[#E6E2D8] px-6 py-4 select-none">
              <div className="flex items-center justify-start">
                <button
                  type="button"
                  onClick={() => setIsHistoryDrawerOpen(false)}
                  className="skeuo-switch-thumb inline-flex h-7 items-center gap-1 rounded-lg px-3 text-xs font-semibold leading-none text-[#262523] transition-all hover:brightness-[1.01] active:translate-y-[1px]"
                >
                  <span className="leading-none">← 返回</span>
                </button>
              </div>

              <div className="flex items-center justify-center text-center">
                <h2
                  id="history-drawer-title"
                  className="truncate font-sans text-xs font-semibold tracking-[0.12em] text-[#7A7873] leading-none translate-y-[1px]"
                >
                  {activeTaskType === 'task1'
                    ? '小作文历史记录'
                    : '大作文历史记录'}
                </h2>
              </div>

              <div />
            </div>

            {/* Drawer Body: Filtered History List for Current Task Only */}
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {activeTaskReports.length === 0 ? (
                <div className="py-16 text-center text-xs text-[#7A7873]">
                  暂无{activeTaskType === 'task1' ? '小作文' : '大作文'}历史批改记录
                </div>
              ) : (
                activeTaskReports.map((item, idx) => {
                  const itemImage = resolveTask1ChartImage(
                    item.image || item.chartImageDataUrl
                  );
                  const isCurrentlySelected =
                    isHistoryMode && activeHistoryReport?.id === item.id;

                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleSelectHistoryRecord(idx);
                        }
                      }}
                      onClick={() => handleSelectHistoryRecord(idx)}
                      className={`group relative cursor-pointer rounded-xl border p-4 transition-all ${
                        isCurrentlySelected
                          ? 'border-[#EA5B25]/60 bg-[#FAF6EE] shadow-[0_3px_10px_rgba(38,37,35,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]'
                          : 'border-[#E4E0D6] bg-[#FAF8F3] hover:border-[#C8C3B5] hover:bg-[#FCFBF7] hover:shadow-[0_3px_10px_rgba(38,37,35,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {/* Vintage Printed Score: 6px Braun Orange Dot + Mono Lining-Nums Bold BAND X.X */}
                        <div className="inline-flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#EA5B25]" />
                          <span
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="font-mono text-xs font-bold leading-none tracking-wider text-[#EA5B25]"
                          >
                            BAND {item.overallBand.toFixed(1)}
                          </span>
                        </div>

                        {/* Top-Right: Quiet Timestamp + Hover-Only Borderless Delete Icon */}
                        <div className="inline-flex items-center gap-2">
                          <span
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="font-mono text-[11px] leading-none text-[#9E988E]"
                          >
                            {new Date(item.createdAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteHistoryRecord(item.id, item.taskType);
                            }}
                            className="inline-flex items-center justify-center p-0.5 text-[#B5B0A4] opacity-0 transition-all hover:text-[#EA5B25] group-hover:opacity-100"
                            title="删除此条批改记录"
                            aria-label="删除此条批改记录"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
                          <p className="line-clamp-1 font-serif text-xs font-semibold leading-relaxed text-[#262523]">
                            {item.prompt}
                          </p>
                          <p className="mt-1 line-clamp-2 font-serif text-xs italic leading-relaxed text-[#8C887F]">
                            {item.essay}
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
            className="skeuo-paper workspace-dialog w-full max-w-md rounded-xl p-5 sm:p-6"
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
          onClick={closeChartPreview}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#262523]/70 p-6 backdrop-blur-[2px] cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label="放大查看图表"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`skeuo-paper workspace-dialog relative max-w-5xl cursor-default rounded-xl p-4 ${
              isWritingDraft && displayedTaskType === 'task1' ? 'writing-chart-preview' : ''
            }`}
          >
            <div className="mb-2 flex items-center justify-end gap-3">
              {!isHistoryMode && !activeRightReport && (
                <button
                  type="button"
                  onClick={handleRemoveChartImage}
                  className="mr-auto rounded-md px-2 py-1.5 text-xs text-[#6E675E] hover:bg-[#F2EFE7] hover:text-[#A93812]"
                >
                  移除图表
                </button>
              )}
              <button
                autoFocus
                type="button"
                onClick={closeChartPreview}
                className="skeuo-btn-light flex h-8 w-8 items-center justify-center rounded-lg text-[#262523]"
                title="关闭放大视图 (Esc)"
                aria-label="关闭放大视图"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={displayedChartImage}
              alt="Task 1 Chart Enlarged"
              onLoad={({ currentTarget: image }) => {
                image.style.setProperty('--chart-aspect', String(image.naturalWidth / image.naturalHeight));
              }}
              className="mx-auto max-h-[82vh] w-auto rounded-lg object-contain bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};
