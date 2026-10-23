import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Volume2,
  Check,
  AlertCircle,
  Trash2,
  X,
  Loader2,
  Search,
} from 'lucide-react';
import {
  DeepSeekConfig,
  MasteryStatus,
  VocabularyCard,
} from '../types/ielts';
import { generateVocabularyCardsWithAI } from '../lib/geminiEvaluator';

interface VocabularyModuleProps {
  cards: VocabularyCard[];
  onUpdateStatus: (id: string, status: MasteryStatus) => void;
  aiConfig: DeepSeekConfig;
  onAddCards: (
    newCards: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>[]
  ) => number;
  onDeleteCard: (id: string) => void;
  onOpenApiKeyModal: () => void;
}

type StudyMode = 'learn' | 'recognize' | 'spell';
type SpellCheckStatus = 'idle' | 'correct' | 'wrong';
type WordBoxCategory = 'all' | 'writing' | 'task1' | 'task2';

const WORD_BOX_TABS: {
  id: WordBoxCategory;
  label: string;
}[] = [
  { id: 'all', label: '全部' },
  { id: 'writing', label: '写作积累' },
  { id: 'task1', label: 'Task 1 核心' },
  { id: 'task2', label: 'Task 2 学术' },
];

const FALLBACK_PHONETIC_DICT: Record<
  string,
  { phonetic: string; pos: string; synonyms?: string[] }
> = {
  categories: {
    phonetic: '/ˈkætəɡəriz/',
    pos: 'n.',
    synonyms: ['classifications', 'types'],
  },
  category: {
    phonetic: '/ˈkætəɡəri/',
    pos: 'n.',
    synonyms: ['classification', 'type'],
  },
  'scenic spots': {
    phonetic: '',
    pos: 'phrase',
    synonyms: ['tourist attractions', 'landmarks'],
  },
  trajectory: {
    phonetic: '/trəˈdʒektəri/',
    pos: 'n.',
    synonyms: ['trend', 'path', 'course'],
  },
  proportion: {
    phonetic: '/prəˈpɔːʃn/',
    pos: 'n.',
    synonyms: ['percentage', 'share', 'ratio'],
  },
  significantly: {
    phonetic: '/sɪɡˈnɪfɪkəntli/',
    pos: 'adv.',
    synonyms: ['considerably', 'markedly', 'substantially'],
  },
  dramatically: {
    phonetic: '/drəˈmætɪkli/',
    pos: 'adv.',
    synonyms: ['sharply', 'drastically', 'steeply'],
  },
};

const KNOWN_ERRONEOUS_SYNONYMS = new Set([
  'catogerise',
  'catogerises',
  'categorys',
  'scenery spots',
  'scenery spot',
]);

/**
 * Resolves which word-box category a card belongs to.
 */
function getCardBoxCategory(card: VocabularyCard): 'writing' | 'task1' | 'task2' {
  if (card.vocabCategory) return card.vocabCategory;
  if (card.fromWriting || card.isCustom) return 'writing';
  if (card.id.startsWith('task1-')) return 'task1';
  return 'task2';
}

/**
 * Ensures fake phonetics like "/academic/", "/phrase/", "/collocation/" are NEVER rendered.
 */
function getValidPhonetic(card: VocabularyCard): string {
  const lower = card.word.trim().toLowerCase();
  if (FALLBACK_PHONETIC_DICT[lower]) {
    return FALLBACK_PHONETIC_DICT[lower].phonetic;
  }
  const raw = (card.phonetic || '').trim();
  if (!raw) return '';
  if (/academic|phrase|collocation|expr/i.test(raw)) return '';
  if (card.word.trim().includes(' ') && !/[ˈˌɪʊɔːəɜːæʌɑːɒʃʒθðŋ]/.test(raw)) {
    return '';
  }
  return raw;
}

/**
 * Ensures fake POS tags like "acad." or "expr." are NEVER rendered.
 */
function getValidPos(card: VocabularyCard): string {
  const lower = card.word.trim().toLowerCase();
  if (FALLBACK_PHONETIC_DICT[lower]) {
    return FALLBACK_PHONETIC_DICT[lower].pos;
  }
  const raw = (card.partOfSpeech || '').trim();
  if (!raw || /^(acad\.|expr\.)$/i.test(raw)) {
    return card.word.trim().includes(' ') ? 'phrase' : 'n.';
  }
  return raw;
}

/**
 * Extracts the user's original misspelled or low-band word from a writing-ingested card.
 */
function getOriginalErrorText(card: VocabularyCard): string | null {
  if (!card.fromWriting) return null;
  const candidate = (card.originalError || '').trim();
  if (
    candidate &&
    candidate.toLowerCase() !== card.word.trim().toLowerCase() &&
    candidate.length <= 42
  ) {
    return candidate;
  }
  const match = card.exampleTranslation?.match(/将\s*[“"]([^”"]+)[”"]\s*升级为/);
  if (
    match?.[1] &&
    match[1].trim().toLowerCase() !== card.word.trim().toLowerCase()
  ) {
    return match[1].trim();
  }
  return null;
}

/**
 * Returns strictly validated IELTS synonyms, ensuring originalError or misspelled words NEVER appear.
 */
function getCleanSynonyms(
  card: VocabularyCard,
  originalErrorText: string | null
): string[] {
  const lower = card.word.trim().toLowerCase();
  if (FALLBACK_PHONETIC_DICT[lower]?.synonyms) {
    return FALLBACK_PHONETIC_DICT[lower].synonyms!;
  }
  const errLower = (originalErrorText || card.originalError || '')
    .trim()
    .toLowerCase();
  const rawList = card.synonyms?.length ? card.synonyms : card.paraphrasing || [];

  return rawList
    .map((s) => String(s).trim())
    .filter((s) => {
      if (!s || s.length > 36) return false;
      const sl = s.toLowerCase();
      if (sl === lower) return false;
      if (errLower && sl === errLower) return false;
      if (KNOWN_ERRONEOUS_SYNONYMS.has(sl)) return false;
      return true;
    });
}

/**
 * Masks the target word in the example sentence with "_______" for Spelling Mode.
 */
function maskTargetWordInSentence(sentence: string, targetWord: string): string {
  if (!sentence || !targetWord) return sentence;
  const cleanTarget = targetWord.trim();
  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
  if (exactRegex.test(sentence)) {
    return sentence.replace(exactRegex, '_______');
  }
  if (cleanTarget.length >= 5 && !cleanTarget.includes(' ')) {
    const stem = cleanTarget.slice(0, Math.max(4, cleanTarget.length - 2));
    const stemEscaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stemRegex = new RegExp(`\\b${stemEscaped}[a-z]*\\b`, 'gi');
    if (stemRegex.test(sentence)) {
      return sentence.replace(stemRegex, '_______');
    }
  }
  return sentence;
}

/**
 * Synthesizes a subtle, tactile Web Audio mechanical tone for correct/wrong spelling feedback.
 */
function playFeedbackTone(type: 'correct' | 'wrong') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'correct') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.07);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.setValueAtTime(150, now + 0.08);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  } catch {
    // ignore audio context restrictions
  }
}

export const VocabularyModule: React.FC<VocabularyModuleProps> = ({
  cards,
  onUpdateStatus,
  aiConfig,
  onAddCards,
  onDeleteCard,
  onOpenApiKeyModal,
}) => {
  const [selectedCategory, setSelectedCategory] =
    useState<WordBoxCategory>('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [studyMode, setStudyMode] = useState<StudyMode>('learn');

  // Recognize Mode 3D flip state
  const [isFlipped, setIsFlipped] = useState(false);
  const [isFlipTransitionEnabled, setIsFlipTransitionEnabled] = useState(true);

  // Spelling Mode states
  const [typedInput, setTypedInput] = useState('');
  const [spellStatus, setSpellStatus] = useState<SpellCheckStatus>('idle');
  const [shakeKey, setShakeKey] = useState(0);
  const [hasRecordedMistakeThisCard, setHasRecordedMistakeThisCard] =
    useState(false);

  // Drawer states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [aiRawInput, setAiRawInput] = useState('');
  const [aiTargetCategory, setAiTargetCategory] = useState<
    'writing' | 'task1' | 'task2'
  >('writing');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiFeedbackMsg, setAiFeedbackMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [drawerSearchQuery, setDrawerSearchQuery] = useState('');

  const spellInputRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);

  // Counts per word-box category
  const categoryCounts = useMemo(() => {
    const counts: Record<WordBoxCategory, number> = {
      all: cards.length,
      writing: 0,
      task1: 0,
      task2: 0,
    };
    for (const card of cards) {
      const cat = getCardBoxCategory(card);
      counts[cat] += 1;
    }
    return counts;
  }, [cards]);

  // Filtered cards for the active word-box
  const filteredCards = useMemo(() => {
    if (selectedCategory === 'all') return cards;
    return cards.filter((c) => getCardBoxCategory(c) === selectedCategory);
  }, [cards, selectedCategory]);

  const total = filteredCards.length;
  const safeIndex = total > 0 ? currentIndex % total : 0;
  const activeCard = filteredCards[safeIndex] || null;

  const formattedIndex =
    total > 0 ? String(safeIndex + 1).padStart(2, '0') : '00';
  const formattedTotal = String(total).padStart(2, '0');

  const validPhonetic = useMemo(
    () => (activeCard ? getValidPhonetic(activeCard) : ''),
    [activeCard]
  );
  const validPos = useMemo(
    () => (activeCard ? getValidPos(activeCard) : ''),
    [activeCard]
  );
  const originalErrorText = useMemo(
    () => (activeCard ? getOriginalErrorText(activeCard) : null),
    [activeCard]
  );
  const cleanSynonyms = useMemo(
    () =>
      activeCard ? getCleanSynonyms(activeCard, originalErrorText) : [],
    [activeCard, originalErrorText]
  );

  // Sync AI target category when user switches word-box
  useEffect(() => {
    if (selectedCategory !== 'all') {
      setAiTargetCategory(selectedCategory);
    }
  }, [selectedCategory]);

  // Pure British English (en-GB) Web Speech API pronunciation
  const handleSpeak = useCallback((text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 0.92;
      const voices = window.speechSynthesis.getVoices();
      const gbVoice = voices.find(
        (v) =>
          v.lang === 'en-GB' ||
          v.lang.startsWith('en-GB') ||
          /UK|British/i.test(v.name)
      );
      if (gbVoice) {
        utterance.voice = gbVoice;
      }
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors
    }
  }, []);

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  // Reset card-specific states when switching card, category, or mode
  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setIsFlipTransitionEnabled(false);
    setIsFlipped(false);
    setTypedInput('');
    setSpellStatus('idle');
    setHasRecordedMistakeThisCard(false);

    if (studyMode === 'spell' && activeCard && !isDrawerOpen) {
      const speakTimer = window.setTimeout(() => {
        handleSpeak(activeCard.word);
        spellInputRef.current?.focus();
      }, 80);
      return () => window.clearTimeout(speakTimer);
    }
  }, [
    safeIndex,
    selectedCategory,
    studyMode,
    activeCard?.id,
    activeCard?.word,
    isDrawerOpen,
    handleSpeak,
  ]);

  const handleToggleFlip = useCallback(() => {
    if (studyMode !== 'recognize') return;
    setIsFlipTransitionEnabled(true);
    setIsFlipped((prev) => !prev);
  }, [studyMode]);

  const handlePrevCard = useCallback(() => {
    if (total === 0) return;
    setIsFlipTransitionEnabled(false);
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [total]);

  const handleNextCard = useCallback(() => {
    if (total === 0) return;
    setIsFlipTransitionEnabled(false);
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [total]);

  const handleDecision = useCallback(
    (status: MasteryStatus) => {
      if (!activeCard || total === 0) return;
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      onUpdateStatus(activeCard.id, status);
      setIsFlipTransitionEnabled(false);
      setIsFlipped(false);
      setTypedInput('');
      setSpellStatus('idle');
      setHasRecordedMistakeThisCard(false);
      setCurrentIndex((prev) => (prev + 1) % total);
    },
    [activeCard, onUpdateStatus, total]
  );

  // Check spelling when pressing Enter in Spelling Mode
  const handleVerifySpelling = useCallback(() => {
    if (!activeCard || total === 0) return;

    if (spellStatus === 'correct') {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      setCurrentIndex((prev) => (prev + 1) % total);
      return;
    }

    const target = activeCard.word.trim();
    const attempt = typedInput.trim();
    if (!attempt) return;

    if (attempt.toLowerCase() === target.toLowerCase()) {
      setSpellStatus('correct');
      setTypedInput(target);
      playFeedbackTone('correct');
      onUpdateStatus(
        activeCard.id,
        hasRecordedMistakeThisCard ? 'unlearned' : 'mastered'
      );

      autoAdvanceTimerRef.current = window.setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % total);
      }, 850);
    } else {
      setSpellStatus('wrong');
      setShakeKey((prev) => prev + 1);
      playFeedbackTone('wrong');
      if (!hasRecordedMistakeThisCard) {
        setHasRecordedMistakeThisCard(true);
        onUpdateStatus(activeCard.id, 'unlearned');
      }
    }
  }, [
    activeCard,
    spellStatus,
    typedInput,
    total,
    onUpdateStatus,
    hasRecordedMistakeThisCard,
  ]);

  // Tab key in Spelling Mode: Replay British English audio + reveal the next correct letter
  const handleTabHintAndReplay = useCallback(() => {
    if (!activeCard) return;
    const target = activeCard.word.trim();
    handleSpeak(target);

    if (spellStatus === 'correct') return;

    let matchLen = 0;
    while (
      matchLen < typedInput.length &&
      matchLen < target.length &&
      typedInput[matchLen].toLowerCase() === target[matchLen].toLowerCase()
    ) {
      matchLen++;
    }

    let nextLen = Math.min(target.length, matchLen + 1);
    while (nextLen < target.length && target[nextLen - 1] === ' ') {
      nextLen++;
    }

    const nextSlice = target.slice(0, nextLen);
    setTypedInput(nextSlice);
    if (spellStatus === 'wrong') {
      setSpellStatus('idle');
    }
  }, [activeCard, handleSpeak, spellStatus, typedInput]);

  // Global keyboard shortcuts in Learn & Recognize Modes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDrawerOpen || studyMode === 'spell') {
        return;
      }
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }

      if (studyMode === 'learn') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrevCard();
        } else if (e.key === 'ArrowRight' || e.code === 'Space') {
          e.preventDefault();
          handleNextCard();
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleToggleFlip();
      } else if (e.key === '1') {
        e.preventDefault();
        handleDecision('unlearned');
      } else if (e.key === '2') {
        e.preventDefault();
        handleDecision('mastered');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isDrawerOpen,
    studyMode,
    handleDecision,
    handleToggleFlip,
    handlePrevCard,
    handleNextCard,
  ]);

  // AI Smart Word Ingestion handler
  const handleAiIngestWords = async () => {
    const trimmed = aiRawInput.trim();
    if (!trimmed) {
      setAiFeedbackMsg({
        type: 'error',
        text: '请先输入英文单词或词组（多个词用逗号或换行分隔）。',
      });
      return;
    }

    if (!aiConfig.apiKey.trim()) {
      setAiFeedbackMsg({
        type: 'error',
        text: '尚未配置 DeepSeek API Key，请先在右上角设置中填入 Key。',
      });
      onOpenApiKeyModal();
      return;
    }

    setIsAiGenerating(true);
    setAiFeedbackMsg(null);
    try {
      const generatedCards = await generateVocabularyCardsWithAI({
        rawInput: trimmed,
        targetCategory: aiTargetCategory,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
        model: aiConfig.model,
      });

      const addedCount = onAddCards(generatedCards);
      setAiRawInput('');
      setSelectedCategory(aiTargetCategory);
      setCurrentIndex(0);

      if (addedCount > 0) {
        setAiFeedbackMsg({
          type: 'success',
          text: `✓ 已收录 ${addedCount} 个词条`,
        });
      } else {
        setAiFeedbackMsg({
          type: 'error',
          text: '输入的词条已存在于当前词库中。',
        });
      }
    } catch (err) {
      setAiFeedbackMsg({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'AI 添词失败，请稍后重试。',
      });
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Filtered list inside Drawer
  const drawerFilteredList = useMemo(() => {
    const q = drawerSearchQuery.trim().toLowerCase();
    return filteredCards.filter((card) => {
      if (!q) return true;
      return (
        card.word.toLowerCase().includes(q) ||
        card.chineseMeaning.toLowerCase().includes(q)
      );
    });
  }, [filteredCards, drawerSearchQuery]);

  const targetWord = activeCard ? activeCard.word.trim() : '';
  const isLongPhrase = targetWord.length > 16;
  const maskedSentence = activeCard
    ? maskTargetWordInSentence(activeCard.exampleSentence, targetWord)
    : '';

  return (
    <div className="relative flex min-h-[calc(100vh-120px)] flex-col items-center justify-center px-4 pb-16 pt-1 select-none">
      {/* =====================================================================
          TOP CATEGORY WORD-BOX FILTER BAR + [ + 词表与添词 ] (无 Emoji · 极简印刷感)
         ===================================================================== */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-1.5">
        {WORD_BOX_TABS.map((tab) => {
          const isActive = selectedCategory === tab.id;
          const count = categoryCounts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedCategory(tab.id);
                setCurrentIndex(0);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs transition-all ${
                isActive
                  ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono text-[11px] ${
                  isActive ? 'text-[#262523]' : 'text-[#9B978E]'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}

        {/* Vertical Divider | */}
        <span
          className="mx-1.5 h-3.5 w-[1px] bg-[#D0CBC0]"
          aria-hidden="true"
        />

        {/* Consolidated [ + 词表与添词 ] Button */}
        <button
          type="button"
          onClick={() => {
            setAiFeedbackMsg(null);
            setIsDrawerOpen(true);
          }}
          className="skeuo-btn-light inline-flex items-center rounded-lg px-3 py-1 font-sans text-xs font-medium text-[#262523]"
        >
          + 词表与添词
        </button>
      </div>

      {/* Tiny Braun Mechanical Counter + [ 开始抽查 → ] Shortcut in Learn Mode */}
      <div className="mb-4 flex items-center justify-center gap-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
          <span className="font-mono text-xs font-medium tracking-[0.22em] text-[#7A7873]">
            {formattedIndex} / {formattedTotal}
          </span>
        </div>

        {studyMode === 'learn' && total > 0 && (
          <button
            type="button"
            onClick={() => {
              setIsFlipTransitionEnabled(false);
              setIsFlipped(false);
              setCurrentIndex(0);
              setStudyMode('recognize');
            }}
            className="skeuo-btn-light inline-flex items-center rounded-md px-2.5 py-0.5 font-sans text-[11px] font-medium text-[#262523] hover:text-[#EA5B25]"
            title="从第 01 词开始认读抽查自测"
          >
            开始抽查 →
          </button>
        )}
      </div>

      {/* =====================================================================
          MAIN VOCABULARY CARD OR EMPTY WORD-BOX STATE
         ===================================================================== */}
      {!activeCard ? (
        <div className="relative mb-4 w-full max-w-[540px]">
          {/* Independent 2D Background Layer for Full-Size Stacked Deck Cards (z-index: 1) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[1]"
          >
            {/* Deck Layer 2: Full-Size Card (translateY(14px) scaleX(0.92), #F2EFE9) */}
            <div
              className="absolute inset-0 rounded-2xl border border-[#D7D2C6] bg-[#F2EFE9] shadow-[0_10px_24px_-6px_rgba(38,37,35,0.12),0_2px_6px_rgba(38,37,35,0.06)]"
              style={{ transform: 'translateY(14px) scaleX(0.92)' }}
            />
            {/* Deck Layer 1: Full-Size Card (translateY(7px) scaleX(0.96), #F7F4EE) */}
            <div
              className="absolute inset-0 rounded-2xl border border-[#DCD7CB] bg-[#F7F4EE] shadow-[0_6px_16px_-4px_rgba(38,37,35,0.09),0_1px_3px_rgba(38,37,35,0.05)]"
              style={{ transform: 'translateY(7px) scaleX(0.96)' }}
            />
          </div>

          <div className="skeuo-paper relative z-10 flex min-h-[380px] w-full flex-col items-center justify-center rounded-2xl px-8 py-10 text-center">
            <p className="font-sans text-lg font-semibold text-[#262523]">
              当前词盒暂无词条
            </p>
            <p className="mt-2 max-w-sm font-sans text-xs leading-relaxed text-[#7A7873]">
              可在写作批改报告中点击「+ 入库」收集高分替换词，或点击上方「+ 词表与添词」添加自定义生词。
            </p>
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="skeuo-btn-light mt-6 rounded-xl px-4 py-2 font-sans text-xs font-semibold text-[#262523]"
            >
              + 词表与添词
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* =====================================================================
              STACKED CARD DECK (2D Layer z-1) + ISOLATED 3D FLIPPER (Layer z-10)
             ===================================================================== */}
          <div className="relative mb-4 w-full max-w-[540px]">
            {/* 1. Independent 2D Background Layer: Two Full-Size Deck Cards (z-index: 1) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1]"
            >
              {/* Deck Layer 2: Full-Size Cream Card (translateY(14px) scaleX(0.92), #F2EFE9) */}
              <div
                className="absolute inset-0 rounded-2xl border border-[#D7D2C6] bg-[#F2EFE9] shadow-[0_10px_24px_-6px_rgba(38,37,35,0.12),0_2px_6px_rgba(38,37,35,0.06)]"
                style={{ transform: 'translateY(14px) scaleX(0.92)' }}
              />
              {/* Deck Layer 1: Full-Size Cream Card (translateY(7px) scaleX(0.96), #F7F4EE) */}
              <div
                className="absolute inset-0 rounded-2xl border border-[#DCD7CB] bg-[#F7F4EE] shadow-[0_6px_16px_-4px_rgba(38,37,35,0.09),0_1px_3px_rgba(38,37,35,0.05)]"
                style={{ transform: 'translateY(7px) scaleX(0.96)' }}
              />
            </div>

            {/* 2. Isolated Top 2D Compositing Boundary (z-index: 10, translateZ(0))
                   Prevents the inner 3D perspective rotation from intersecting z-index: 1 in -Z space */}
            <div
              className="relative z-10 w-full"
              style={{
                isolation: 'isolate',
                transform: 'translateZ(0)',
              }}
            >
              <div className="w-full" style={{ perspective: '1200px' }}>
                <div
                  onClick={() => {
                    if (studyMode === 'recognize') {
                      handleToggleFlip();
                    } else if (studyMode === 'spell') {
                      spellInputRef.current?.focus();
                    }
                  }}
                  className={`relative h-[390px] w-full ${
                    studyMode === 'recognize'
                      ? 'cursor-pointer'
                      : studyMode === 'spell'
                      ? 'cursor-text'
                      : 'cursor-default'
                  }`}
                  style={{
                    transformStyle: 'preserve-3d',
                    transition: isFlipTransitionEnabled
                      ? 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)'
                      : 'none',
                    transform:
                      studyMode === 'recognize' && isFlipped
                        ? 'rotateY(180deg)'
                        : 'rotateY(0deg)',
                  }}
                >
              {/* =================================================================
                  FRONT FACE (rotateY(0deg)) — Learn Mode, Recognize Front, OR Spelling Mode
                 ================================================================= */}
              <div
                className="skeuo-paper absolute inset-0 flex flex-col justify-between rounded-2xl px-8 py-8 text-center sm:px-10"
                style={{
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'rotateY(0deg)',
                  pointerEvents:
                    studyMode === 'recognize' && isFlipped ? 'none' : 'auto',
                }}
              >
                {/* TOP HEADER ROW: Pure Ink POS + Stamp | Right Mode Switcher [ 学词 | 认读 | 拼写 ] */}
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="text-xs tracking-wide text-[#9E988E]">
                    <span className="font-mono">{validPos}</span>
                    {activeCard.fromWriting && (
                      <span className="font-sans">
                        {validPos ? ' · ' : ''}来自写作批改
                      </span>
                    )}
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="skeuo-groove inline-flex items-center rounded-lg p-0.5 font-sans"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsFlipTransitionEnabled(false);
                        setIsFlipped(false);
                        setStudyMode('learn');
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        studyMode === 'learn'
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      学词
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsFlipTransitionEnabled(false);
                        setIsFlipped(false);
                        setStudyMode('recognize');
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        studyMode === 'recognize'
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      认读
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsFlipTransitionEnabled(false);
                        setIsFlipped(false);
                        setStudyMode('spell');
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        studyMode === 'spell'
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      拼写
                    </button>
                  </div>
                </div>

                {studyMode === 'learn' ? (
                  /* LEARN MODE (学词模式) — Zero-Pressure Full Overview on Front Face */
                  <div className="my-auto flex flex-col items-center py-2">
                    <h1
                      className={`font-serif font-normal tracking-tight text-[#262523] ${
                        isLongPhrase
                          ? 'text-3xl sm:text-4xl leading-snug'
                          : 'text-4xl sm:text-5xl'
                      }`}
                    >
                      {activeCard.word}
                    </h1>

                    <div className="mt-2.5 inline-flex items-center gap-2 text-[#7A7873]">
                      {validPhonetic && (
                        <span className="font-mono text-sm">
                          {validPhonetic}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleSpeak(activeCard.word, e)}
                        className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                        title="朗读英式发音 (en-GB)"
                        aria-label="朗读英式发音"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Prominent Chinese Meaning */}
                    <h2 className="mt-3.5 font-sans text-xl font-semibold tracking-tight text-[#262523]">
                      {activeCard.chineseMeaning}
                    </h2>

                    {/* Validated IELTS Synonyms */}
                    {cleanSynonyms.length > 0 && (
                      <p className="mt-2 font-sans text-xs text-[#7A7873]">
                        同义替换：
                        <span className="font-serif text-sm text-[#262523]">
                          {cleanSynonyms.join(' / ')}
                        </span>
                      </p>
                    )}

                    {/* Original Error Warning (if ingested from writing) */}
                    {originalErrorText && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#E5C5B8] bg-[#FAF0EC] px-2.5 py-0.5 font-sans text-[11px] text-[#EA5B25]">
                        <span>原词误写/原表达：</span>
                        <span className="font-mono font-semibold line-through">
                          {originalErrorText}
                        </span>
                      </div>
                    )}
                  </div>
                ) : studyMode === 'recognize' ? (
                  /* RECOGNIZE MODE — FRONT CENTER */
                  <div className="my-auto flex flex-col items-center py-6">
                    <h1
                      className={`font-serif font-normal tracking-tight text-[#262523] ${
                        isLongPhrase
                          ? 'text-3xl sm:text-4xl leading-snug'
                          : 'text-5xl'
                      }`}
                    >
                      {activeCard.word}
                    </h1>

                    <div className="mt-4 inline-flex items-center gap-2 text-[#7A7873]">
                      {validPhonetic && (
                        <span className="font-mono text-sm">
                          {validPhonetic}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleSpeak(activeCard.word, e)}
                        className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                        title="朗读英式发音 (en-GB)"
                        aria-label="朗读英式发音"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* SPELLING MODE — FRONT CENTER (Minimalist Single-Layer Underlines, No Hint Clutter) */
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      spellInputRef.current?.focus();
                    }}
                    className="my-auto flex w-full flex-col items-center py-4"
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="inline-flex items-center gap-2">
                        <span className="font-sans text-xl font-semibold tracking-tight text-[#262523]">
                          {activeCard.chineseMeaning}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleSpeak(activeCard.word, e)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-[#9B978E] transition-colors hover:text-[#EA5B25]"
                          title="重播发音 (Tab)"
                          aria-label="重播发音"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {originalErrorText && (
                        <span className="font-sans text-[11px] text-[#7A7873]">
                          原词误写：
                          <span className="ml-1 font-mono text-[#EA5B25] line-through">
                            {originalErrorText}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Borderless Paper-Direct Spelling Zone (Single Bottom Dash Only) */}
                    <div
                      key={shakeKey}
                      className={`relative mt-7 w-full max-w-md py-2 transition-all ${
                        spellStatus === 'wrong' ? 'animate-shake' : ''
                      }`}
                    >
                      <input
                        ref={spellInputRef}
                        type="text"
                        value={typedInput}
                        autoFocus
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        onChange={(e) => {
                          if (spellStatus === 'correct') return;
                          setTypedInput(e.target.value);
                          if (spellStatus === 'wrong') {
                            setSpellStatus('idle');
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleVerifySpelling();
                          } else if (e.key === 'Tab') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleTabHintAndReplay();
                          }
                        }}
                        aria-label="拼写默写输入框"
                        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
                      />

                      <div className="flex flex-wrap items-end justify-center gap-x-1.5 gap-y-3">
                        {targetWord.split('').map((targetChar, idx) => {
                          if (targetChar === ' ') {
                            return <span key={idx} className="w-3.5" />;
                          }

                          const userChar = typedInput[idx] || '';
                          const isCurrentCursor =
                            spellStatus !== 'correct' &&
                            idx === typedInput.length;
                          const isWrongCharHere =
                            spellStatus === 'wrong' &&
                            userChar.toLowerCase() !==
                              targetChar.toLowerCase();

                          return (
                            <span
                              key={idx}
                              className={`inline-flex h-9 w-[22px] items-center justify-center border-b-2 pb-1 font-mono text-xl font-semibold leading-none transition-colors ${
                                spellStatus === 'correct'
                                  ? 'border-[#2E7D5B] text-[#2E7D5B]'
                                  : isWrongCharHere
                                  ? 'border-[#EA5B25] text-[#EA5B25]'
                                  : isCurrentCursor
                                  ? 'border-[#EA5B25] text-[#262523]'
                                  : userChar
                                  ? 'border-[#262523] text-[#262523]'
                                  : 'border-[#C8C3B6] text-transparent'
                              }`}
                            >
                              {userChar}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Feedback Banner Below Slot */}
                    <div className="mt-2 min-h-[26px]">
                      {spellStatus === 'correct' && (
                        <div className="inline-flex items-center gap-1.5 font-sans text-xs font-medium text-[#2E7D5B]">
                          <Check className="h-3.5 w-3.5" />
                          <span>拼写正确</span>
                        </div>
                      )}

                      {spellStatus === 'wrong' && (
                        <div className="inline-flex items-center gap-1.5 font-sans text-xs text-[#EA5B25]">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>
                            正确拼写：
                            <strong className="ml-1 font-serif text-sm tracking-wide text-[#262523] underline decoration-[#EA5B25] underline-offset-4">
                              {targetWord}
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* FRONT BOTTOM: Pure Example Sentence Only (Zero Hint Clutter) */}
                <p className="mx-auto max-w-md font-serif text-sm italic leading-relaxed text-[#7A7873] line-clamp-3">
                  “
                  {studyMode === 'spell' && spellStatus !== 'correct'
                    ? maskedSentence
                    : activeCard.exampleSentence}
                  ”
                </p>
              </div>

              {/* =================================================================
                  BACK FACE (rotateY(180deg)) — Always Mounted in DOM for True 3D Flip
                 ================================================================= */}
              <div
                className="skeuo-paper absolute inset-0 flex flex-col justify-between rounded-2xl px-8 py-8 text-center sm:px-10"
                style={{
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  pointerEvents:
                    studyMode === 'recognize' && isFlipped ? 'auto' : 'none',
                }}
              >
                {/* BACK TOP HEADER ROW: Pure Ink POS + Stamp | Right Mode Switcher [ 学词 | 认读 | 拼写 ] */}
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="text-xs tracking-wide text-[#9E988E]">
                    <span className="font-mono">{validPos}</span>
                    {activeCard.fromWriting && (
                      <span className="font-sans">
                        {validPos ? ' · ' : ''}来自写作批改
                      </span>
                    )}
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="skeuo-groove inline-flex items-center rounded-lg p-0.5 font-sans"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsFlipTransitionEnabled(false);
                        setIsFlipped(false);
                        setStudyMode('learn');
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        studyMode === 'learn'
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      学词
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudyMode('recognize')}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        studyMode === 'recognize'
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      认读
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsFlipTransitionEnabled(false);
                        setIsFlipped(false);
                        setStudyMode('spell');
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        studyMode === 'spell'
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      拼写
                    </button>
                  </div>
                </div>

                {/* BACK CENTER: Word Echo + Prominent Meaning + Synonyms + Original Error */}
                <div className="my-auto flex flex-col items-center py-4">
                  {/* 1. 顶部小字回显英文单词与音标 */}
                  <div className="inline-flex items-center gap-2 text-[#7A7873]">
                    <span className="font-serif text-base font-medium text-[#262523]">
                      {activeCard.word}
                    </span>
                    {validPhonetic && (
                      <span className="font-mono text-xs text-[#9B978E]">
                        {validPhonetic}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleSpeak(activeCard.word, e)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-[#9B978E] transition-colors hover:text-[#EA5B25]"
                      title="朗读英式发音 (en-GB)"
                      aria-label="朗读英式发音"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* 2. 中央醒目展示中文释义 */}
                  <h2 className="mt-3.5 font-sans text-2xl font-semibold tracking-tight text-[#262523]">
                    {activeCard.chineseMeaning}
                  </h2>

                  {/* 3. 下方展示真正的雅思同义替换（Synonyms，无则隐藏） */}
                  {cleanSynonyms.length > 0 && (
                    <p className="mt-3 font-sans text-xs text-[#7A7873]">
                      同义替换：
                      <span className="font-serif text-sm text-[#262523]">
                        {cleanSynonyms.join(' / ')}
                      </span>
                    </p>
                  )}

                  {/* 4. 原词误写/原表达警示（若来自写作批改） */}
                  {originalErrorText && (
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#E5C5B8] bg-[#FAF0EC] px-3 py-1 font-sans text-xs text-[#EA5B25]">
                      <span>原词误写/原表达：</span>
                      <span className="font-mono font-semibold line-through">
                        {originalErrorText}
                      </span>
                    </div>
                  )}
                </div>

                {/* BACK BOTTOM: Pure Example Sentence Only */}
                <p className="mx-auto max-w-md font-serif text-sm italic leading-relaxed text-[#7A7873] line-clamp-3">
                  “{activeCard.exampleSentence}”
                </p>
              </div>
                </div>
              </div>
            </div>
          </div>

          {/* =====================================================================
              BOTTOM ACTION BUTTONS:
              - Learn Mode (学词): [ ← 上一词 ] (米白键) | [ 下一词 → ] (博朗橙键)
              - Recognize Mode (认读): [ 没记住 1 ] (米白键) | [ 记住了 2 ] (博朗橙键)
             ===================================================================== */}
          {studyMode === 'learn' && (
            <div className="mt-6 flex w-full max-w-[540px] items-center justify-center gap-4 font-sans">
              <button
                type="button"
                onClick={handlePrevCard}
                className="skeuo-btn-light flex flex-1 items-center justify-between rounded-xl px-5 py-3.5 text-sm font-medium text-[#262523]"
              >
                <span>← 上一词</span>
                <kbd className="font-mono text-[11px] text-[#7A7873]">←</kbd>
              </button>

              <button
                type="button"
                onClick={handleNextCard}
                className="skeuo-btn-orange flex flex-1 items-center justify-between rounded-xl px-5 py-3.5 text-sm font-semibold text-white"
              >
                <span>下一词 →</span>
                <kbd className="font-mono text-[11px] text-white/85">→</kbd>
              </button>
            </div>
          )}

          {studyMode === 'recognize' && (
            <div className="mt-6 flex w-full max-w-[540px] items-center justify-center gap-4 font-sans">
              <button
                type="button"
                onClick={() => handleDecision('unlearned')}
                className="skeuo-btn-light flex flex-1 items-center justify-between rounded-xl px-5 py-3.5 text-sm font-medium text-[#262523]"
              >
                <span>没记住</span>
                <kbd className="font-mono text-[11px] text-[#7A7873]">1</kbd>
              </button>

              <button
                type="button"
                onClick={() => handleDecision('mastered')}
                className="skeuo-btn-orange flex flex-1 items-center justify-between rounded-xl px-5 py-3.5 text-sm font-semibold text-white"
              >
                <span>记住了</span>
                <kbd className="font-mono text-[11px] text-white/85">2</kbd>
              </button>
            </div>
          )}
        </>
      )}

      {/* =====================================================================
          SLIDE-OVER DRAWER: 词典手账风词表与 AI 添词
         ===================================================================== */}
      {isDrawerOpen && (
        <div
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 z-50 flex justify-end bg-[#1E1D1B]/30 backdrop-blur-[1px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-[#DCD8CC] bg-[#FAF8F3] shadow-2xl"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-[#EBE6DF] px-5 py-3.5">
              <h2 className="font-sans text-sm font-semibold tracking-wide text-[#262523]">
                词表与添词
              </h2>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[#9B978E] transition-colors hover:text-[#262523]"
                aria-label="关闭抽屉"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Section 1: Compact AI Smart Word Ingestion (无冗余标题、无 Emoji) */}
            <div className="border-b border-[#EBE6DF] bg-[#F5F2EA] px-5 py-3.5">
              <textarea
                value={aiRawInput}
                onChange={(e) => setAiRawInput(e.target.value)}
                rows={2}
                placeholder="输入英文单词或词组（逗号或换行分隔），AI 自动生成音标与例句..."
                className="w-full resize-none rounded-lg border border-[#DCD7CA] bg-[#FAF8F3] px-3 py-2 font-sans text-xs text-[#262523] placeholder-[#A8A49B] focus:border-[#7A7873] focus:outline-none"
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-sans text-[11px] text-[#7A7873]">
                  <span>归入：</span>
                  <select
                    value={aiTargetCategory}
                    onChange={(e) =>
                      setAiTargetCategory(
                        e.target.value as 'writing' | 'task1' | 'task2'
                      )
                    }
                    className="rounded border border-[#DCD7CA] bg-[#FAF8F3] px-2 py-1 font-sans text-[11px] text-[#262523] focus:outline-none"
                  >
                    <option value="writing">写作积累</option>
                    <option value="task1">Task 1 核心</option>
                    <option value="task2">Task 2 学术</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={isAiGenerating}
                  onClick={handleAiIngestWords}
                  className="skeuo-btn-orange inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-sans text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  {isAiGenerating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-white" />
                      <span>生成中...</span>
                    </>
                  ) : (
                    <span>+ AI 入库</span>
                  )}
                </button>
              </div>

              {aiFeedbackMsg && (
                <div
                  className={`mt-2 font-mono text-[11px] ${
                    aiFeedbackMsg.type === 'success'
                      ? 'text-[#7A7873]'
                      : 'text-[#EA5B25]'
                  }`}
                >
                  {aiFeedbackMsg.text}
                </div>
              )}
            </div>

            {/* Section 2: Single-Row Pure Text Tabs + Integrated Search Bar */}
            <div className="border-b border-[#EBE6DF] px-5 pt-3 pb-2.5">
              {/* Single-Line Pure Text Category Tabs */}
              <div className="flex items-center justify-between gap-1 overflow-x-auto whitespace-nowrap pb-2">
                {WORD_BOX_TABS.map((tab) => {
                  const isActive = selectedCategory === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(tab.id);
                        setCurrentIndex(0);
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                        isActive
                          ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                          : 'text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      {tab.label}{' '}
                      <span className="font-mono text-[10px] text-[#9B978E]">
                        {categoryCounts[tab.id]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Minimal Dictionary Search Input */}
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A8A49B]" />
                <input
                  type="text"
                  value={drawerSearchQuery}
                  onChange={(e) => setDrawerSearchQuery(e.target.value)}
                  placeholder="检索词条或释义..."
                  className="w-full rounded-lg border border-[#E2DDD2] bg-[#F4F1E8] py-1.5 pl-8 pr-3 text-xs text-[#262523] placeholder-[#A8A49B] focus:border-[#B5B0A4] focus:bg-[#FAF8F3] focus:outline-none"
                />
              </div>
            </div>

            {/* Section 3: Dictionary Stationery List (信纸分割线 + 点击整行朗读 + 悬停极简删除) */}
            <div className="flex-1 overflow-y-auto px-5">
              {drawerFilteredList.length === 0 ? (
                <div className="flex h-40 items-center justify-center font-mono text-xs text-[#9B978E]">
                  暂无匹配词条
                </div>
              ) : (
                <div className="divide-y divide-[#EBE6DF]">
                  {drawerFilteredList.map((item) => {
                    const itemPhonetic = getValidPhonetic(item);
                    const itemPos = getValidPos(item);

                    return (
                      <div
                        key={item.id}
                        onClick={(e) => {
                          handleSpeak(item.word, e);
                          const idxInFiltered = filteredCards.findIndex(
                            (c) => c.id === item.id
                          );
                          if (idxInFiltered !== -1) {
                            setCurrentIndex(idxInFiltered);
                          }
                        }}
                        title="点击朗读英音并定位至该词卡"
                        className="group flex cursor-pointer items-center justify-between gap-3 py-3 transition-colors hover:bg-[#F3F0E7]/60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="font-serif text-sm font-semibold text-[#262523]">
                              {item.word}
                            </span>
                            {itemPos && (
                              <span className="font-mono text-[10px] text-[#7A7873]">
                                {itemPos}
                              </span>
                            )}
                            {itemPhonetic && (
                              <span className="font-mono text-[10px] text-[#A8A49B]">
                                {itemPhonetic}
                              </span>
                            )}
                            <Volume2 className="h-3 w-3 shrink-0 translate-y-[1px] text-[#C2BDB2] transition-colors group-hover:text-[#7A7873]" />
                            {item.status === 'mastered' && (
                              <span className="ml-1 font-mono text-[10px] text-[#9B978E]">
                                [ ✓ 已掌握 ]
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-[#7A7873]">
                            {item.chineseMeaning}
                          </p>
                        </div>

                        {/* Subtle Hover-Only Delete Icon */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteCard(item.id);
                          }}
                          className=" shrink-0 p-1 text-[#B5B0A4] opacity-0 transition-all hover:text-[#EA5B25] group-hover:opacity-100"
                          title="删除该词"
                          aria-label="删除该词"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
