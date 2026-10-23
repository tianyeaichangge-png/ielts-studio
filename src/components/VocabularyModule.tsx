import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Volume2,
  Check,
  AlertCircle,
  Trash2,
  Loader2,
  Search,
  RotateCcw,
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

type VocabViewStep = 'list' | 'deck';
type DeckStudyMode = 'recognize' | 'spell';
type SpellCheckStatus = 'idle' | 'correct' | 'wrong';
type WordBoxCategory =
  | 'unmastered'
  | 'learning'
  | 'writing'
  | 'task1'
  | 'task2'
  | 'mastered';

const WORD_BOX_TABS: {
  id: WordBoxCategory;
  label: string;
}[] = [
  { id: 'unmastered', label: '全部待背' },
  { id: 'learning', label: '待攻克' },
  { id: 'writing', label: '写作积累' },
  { id: 'task1', label: 'Task 1 核心' },
  { id: 'task2', label: 'Task 2 学术' },
  { id: 'mastered', label: '已掌握' },
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
 * Resolves which source word-box a card belongs to ('writing' | 'task1' | 'task2').
 */
function getCardBoxCategory(
  card: VocabularyCard
): 'writing' | 'task1' | 'task2' {
  if (card.vocabCategory) return card.vocabCategory;
  if (card.fromWriting || card.isCustom) return 'writing';
  if (card.id.startsWith('task1-')) return 'task1';
  return 'task2';
}

function isCardLearning(card: VocabularyCard): boolean {
  return card.status === 'learning' || card.status === 'vague';
}

function isCardMastered(card: VocabularyCard): boolean {
  return card.status === 'mastered';
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
  const match = card.exampleTranslation?.match(
    /将\s*[“"]([^”"]+)[”"]\s*升级为/
  );
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
  const rawList = card.synonyms?.length
    ? card.synonyms
    : card.paraphrasing || [];

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
function maskTargetWordInSentence(
  sentence: string,
  targetWord: string
): string {
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
  // Two-level view state: 'list' (default stationery word-book view) | 'deck' (focused 3D flashcard quiz)
  const [viewStep, setViewStep] = useState<VocabViewStep>('list');
  const [selectedCategory, setSelectedCategory] =
    useState<WordBoxCategory>('unmastered');
  const [studyMode, setStudyMode] = useState<DeckStudyMode>('recognize');

  // Active study session queue (ordered array of card IDs for the current round)
  const [sessionQueue, setSessionQueue] = useState<string[]>([]);
  const [learningPulse, setLearningPulse] = useState(false);

  // Recognize Mode 3D flip state
  const [isFlipped, setIsFlipped] = useState(false);
  const [isFlipTransitionEnabled, setIsFlipTransitionEnabled] = useState(true);

  // Spelling Mode states
  const [typedInput, setTypedInput] = useState('');
  const [spellStatus, setSpellStatus] = useState<SpellCheckStatus>('idle');
  const [shakeKey, setShakeKey] = useState(0);
  const [hasRecordedMistakeThisCard, setHasRecordedMistakeThisCard] =
    useState(false);

  // List View Search & AI Smart Word Ingestion states
  const [searchQuery, setSearchQuery] = useState('');
  const [aiRawInput, setAiRawInput] = useState('');
  const [aiTargetCategory, setAiTargetCategory] = useState<
    'writing' | 'task1' | 'task2'
  >('writing');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiFeedbackMsg, setAiFeedbackMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const spellInputRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  // Real-time counts per word-box category
  const categoryCounts = useMemo(() => {
    const counts: Record<WordBoxCategory, number> = {
      unmastered: 0,
      learning: 0,
      writing: 0,
      task1: 0,
      task2: 0,
      mastered: 0,
    };
    for (const card of cards) {
      if (isCardMastered(card)) {
        counts.mastered += 1;
      } else {
        counts.unmastered += 1;
      }
      if (isCardLearning(card)) {
        counts.learning += 1;
      }
      const box = getCardBoxCategory(card);
      counts[box] += 1;
    }
    return counts;
  }, [cards]);

  // Filtered cards for the selected word-box
  const categoryCards = useMemo(() => {
    switch (selectedCategory) {
      case 'unmastered':
        return cards.filter((c) => !isCardMastered(c));
      case 'learning':
        return cards.filter((c) => isCardLearning(c));
      case 'writing':
        return cards.filter((c) => getCardBoxCategory(c) === 'writing');
      case 'task1':
        return cards.filter((c) => getCardBoxCategory(c) === 'task1');
      case 'task2':
        return cards.filter((c) => getCardBoxCategory(c) === 'task2');
      case 'mastered':
        return cards.filter((c) => isCardMastered(c));
    }
  }, [cards, selectedCategory]);

  // Cards to be studied when clicking [ 开始背词 (x) → ]
  const studyCandidateCards = useMemo(() => {
    if (selectedCategory === 'mastered') {
      return categoryCards;
    }
    const unmasteredInBox = categoryCards.filter((c) => !isCardMastered(c));
    return unmasteredInBox.length > 0 ? unmasteredInBox : categoryCards;
  }, [categoryCards, selectedCategory]);

  // Filtered cards for the stationery list view (with search query)
  const listFilteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return categoryCards;
    return categoryCards.filter(
      (c) =>
        c.word.toLowerCase().includes(q) ||
        c.chineseMeaning.toLowerCase().includes(q) ||
        (c.synonyms || c.paraphrasing || []).some((s) =>
          s.toLowerCase().includes(q)
        )
    );
  }, [categoryCards, searchQuery]);

  // Sync AI target category when user switches to a thematic word-box
  useEffect(() => {
    if (
      selectedCategory === 'writing' ||
      selectedCategory === 'task1' ||
      selectedCategory === 'task2'
    ) {
      setAiTargetCategory(selectedCategory);
    }
  }, [selectedCategory]);

  // Active card in Deck view (always the head of sessionQueue)
  const activeCard = useMemo(() => {
    if (sessionQueue.length === 0) return null;
    const headId = sessionQueue[0];
    return cards.find((c) => c.id === headId) || null;
  }, [cards, sessionQueue]);

  // Clean up any deleted card IDs from sessionQueue
  useEffect(() => {
    if (sessionQueue.length === 0) return;
    const cardIdSet = new Set(cards.map((c) => c.id));
    if (sessionQueue.some((id) => !cardIdSet.has(id))) {
      setSessionQueue((prev) => prev.filter((id) => cardIdSet.has(id)));
    }
  }, [cards, sessionQueue]);

  const remainingInQueue = sessionQueue.length;
  const formattedRemaining = String(remainingInQueue).padStart(2, '0');

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

  // Trigger a subtle orange highlight pulse on the '待攻克' tab
  const triggerLearningPulse = useCallback(() => {
    if (pulseTimerRef.current !== null) {
      window.clearTimeout(pulseTimerRef.current);
    }
    setLearningPulse(true);
    pulseTimerRef.current = window.setTimeout(() => {
      setLearningPulse(false);
    }, 750);
  }, []);

  // Pure British English (en-GB) Web Speech API pronunciation
  const handleSpeak = useCallback((text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (
      !text ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window)
    ) {
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

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  // Start Deck Study Session from current word-box (or specific card)
  const handleStartDeckStudy = useCallback(
    (startWithCardId?: string) => {
      const sourceList =
        studyCandidateCards.length > 0 ? studyCandidateCards : categoryCards;
      if (sourceList.length === 0) return;

      let ids = sourceList.map((c) => c.id);
      if (startWithCardId) {
        const idx = ids.indexOf(startWithCardId);
        if (idx > 0) {
          ids = [...ids.slice(idx), ...ids.slice(0, idx)];
        } else if (idx === -1) {
          ids = [startWithCardId, ...ids];
        }
      }

      setIsFlipTransitionEnabled(false);
      setIsFlipped(false);
      setTypedInput('');
      setSpellStatus('idle');
      setHasRecordedMistakeThisCard(false);
      setSessionQueue(ids);
      setViewStep('deck');
    },
    [studyCandidateCards, categoryCards]
  );

  // Reset card-specific states when activeCard or studyMode changes
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

    if (viewStep === 'deck' && studyMode === 'spell' && activeCard) {
      const speakTimer = window.setTimeout(() => {
        handleSpeak(activeCard.word);
        spellInputRef.current?.focus();
      }, 80);
      return () => window.clearTimeout(speakTimer);
    }
  }, [
    viewStep,
    studyMode,
    activeCard?.id,
    activeCard?.word,
    sessionQueue.length,
    handleSpeak,
  ]);

  const handleToggleFlip = useCallback(() => {
    if (studyMode !== 'recognize') return;
    setIsFlipTransitionEnabled(true);
    setIsFlipped((prev) => !prev);
  }, [studyMode]);

  /**
   * Real closed-loop decision handler:
   * - 'learning' (没记住):
   *   1. Marks card status as 'learning' -> enters '待攻克' word-box in real time.
   *   2. Re-queues current card at the END of sessionQueue so it is quizzed again in this round.
   * - 'mastered' (记住了):
   *   1. Marks card status as 'mastered' -> archives into '已掌握' word-box.
   *   2. Removes current card from sessionQueue -> remaining count decreases by 1.
   */
  const handleDecision = useCallback(
    (decision: 'learning' | 'mastered') => {
      if (!activeCard || sessionQueue.length === 0) return;
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }

      setIsFlipTransitionEnabled(false);
      setIsFlipped(false);
      setTypedInput('');
      setSpellStatus('idle');
      setHasRecordedMistakeThisCard(false);

      if (decision === 'learning') {
        onUpdateStatus(activeCard.id, 'learning');
        triggerLearningPulse();
        setSessionQueue((prev) => {
          if (prev.length <= 1) return [...prev];
          return [...prev.slice(1), prev[0]];
        });
      } else {
        onUpdateStatus(activeCard.id, 'mastered');
        setSessionQueue((prev) => prev.slice(1));
      }
    },
    [activeCard, sessionQueue.length, onUpdateStatus, triggerLearningPulse]
  );

  // Check spelling when pressing Enter in Spelling Mode
  const handleVerifySpelling = useCallback(() => {
    if (!activeCard || sessionQueue.length === 0) return;

    if (spellStatus === 'correct') {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      setSessionQueue((prev) =>
        hasRecordedMistakeThisCard
          ? prev.length <= 1
            ? [...prev]
            : [...prev.slice(1), prev[0]]
          : prev.slice(1)
      );
      return;
    }

    const target = activeCard.word.trim();
    const attempt = typedInput.trim();
    if (!attempt) return;

    if (attempt.toLowerCase() === target.toLowerCase()) {
      setSpellStatus('correct');
      setTypedInput(target);
      playFeedbackTone('correct');

      const hadMistake = hasRecordedMistakeThisCard;
      if (!hadMistake) {
        onUpdateStatus(activeCard.id, 'mastered');
      } else {
        onUpdateStatus(activeCard.id, 'learning');
        triggerLearningPulse();
      }

      autoAdvanceTimerRef.current = window.setTimeout(() => {
        setSessionQueue((prev) => {
          if (hadMistake) {
            return prev.length <= 1 ? [...prev] : [...prev.slice(1), prev[0]];
          }
          return prev.slice(1);
        });
      }, 750);
    } else {
      setSpellStatus('wrong');
      setShakeKey((prev) => prev + 1);
      playFeedbackTone('wrong');
      if (!hasRecordedMistakeThisCard) {
        setHasRecordedMistakeThisCard(true);
        onUpdateStatus(activeCard.id, 'learning');
        triggerLearningPulse();
      }
    }
  }, [
    activeCard,
    sessionQueue.length,
    spellStatus,
    typedInput,
    onUpdateStatus,
    hasRecordedMistakeThisCard,
    triggerLearningPulse,
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

  // Global keyboard shortcuts in Deck Recognize Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewStep !== 'deck' || studyMode === 'spell' || !activeCard) {
        return;
      }
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        handleToggleFlip();
      } else if (e.key === '1') {
        e.preventDefault();
        handleDecision('learning');
      } else if (e.key === '2') {
        e.preventDefault();
        handleDecision('mastered');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewStep, studyMode, activeCard, handleDecision, handleToggleFlip]);

  // AI Smart Word Ingestion handler
  const handleAiIngestWords = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = aiRawInput.trim();
    if (!trimmed) {
      setAiFeedbackMsg({
        type: 'error',
        text: '请先输入英文生词或词组（多个词用逗号分隔）。',
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

      if (addedCount > 0) {
        setAiFeedbackMsg({
          type: 'success',
          text: `✓ 已自动补全音标与例句并收录 ${addedCount} 个词条`,
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
          err instanceof Error ? err.message : 'AI 添词失败，请稍后重试。',
      });
    } finally {
      setIsAiGenerating(false);
    }
  };

  const targetWord = activeCard ? activeCard.word.trim() : '';
  const isLongPhrase = targetWord.length > 16;
  const maskedSentence = activeCard
    ? maskTargetWordInSentence(activeCard.exampleSentence, targetWord)
    : '';

  return (
    <div className="mx-auto w-[92vw] max-w-[1000px] pb-16 pt-1 select-none">
      {/* =====================================================================
          TOP WORD-BOX CATEGORY FILTER BAR (6 Clear Dimensions)
         ===================================================================== */}
      <div className="mb-5 flex flex-wrap items-center justify-center gap-1.5 font-sans">
        {WORD_BOX_TABS.map((tab) => {
          const isActive = selectedCategory === tab.id;
          const count = categoryCounts[tab.id];
          const isLearningTab = tab.id === 'learning';

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedCategory(tab.id);
                setViewStep('list');
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all duration-200 ${
                isLearningTab && learningPulse
                  ? 'scale-105 bg-[#FAF0EC] font-semibold text-[#EA5B25] ring-2 ring-[#EA5B25]/50'
                  : isActive
                  ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                  : 'text-[#7A7873] hover:text-[#262523]'
              }`}
            >
              {isLearningTab && count > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
              )}
              <span>{tab.label}</span>
              <span
                className={`font-mono text-[11px] ${
                  isLearningTab && learningPulse
                    ? 'font-bold text-[#EA5B25]'
                    : isActive
                    ? 'text-[#262523]'
                    : 'text-[#9B978E]'
                }`}
              >
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          LEVEL 1 (DEFAULT VIEW): 道林纸「词书手账列表页」（自然学词与管理态）
         ===================================================================== */}
      {viewStep === 'list' ? (
        <div className="mx-auto max-w-[900px]">
          <section className="skeuo-paper overflow-hidden rounded-2xl">
            {/* Smartisan Vintage Double Crimson Header Rule */}
            <div className="pt-4">
              <div className="h-[2px] w-full bg-[#C97A63]/35" />
              <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
            </div>

            {/* Paper Top Header Bar: Left AI Smart Add / Search Input | Right [ 开始背词 (x) → ] */}
            <div className="border-b border-[#E6E3DA] px-6 py-4 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Left: One-line AI Smart Word Ingestion Input */}
                <form
                  onSubmit={handleAiIngestWords}
                  className="flex min-w-[260px] flex-1 items-center gap-2"
                >
                  <input
                    type="text"
                    value={aiRawInput}
                    onChange={(e) => {
                      setAiRawInput(e.target.value);
                      if (aiFeedbackMsg) setAiFeedbackMsg(null);
                    }}
                    placeholder="输入生词由 AI 自动补全音标释义入库（多个词用逗号分隔）..."
                    className="w-full rounded-xl border border-[#DCD7CA] bg-[#F5F2EA] px-3.5 py-2 font-sans text-xs text-[#262523] placeholder-[#9E998E] focus:border-[#ABA598] focus:bg-[#FAF8F3] focus:outline-none"
                  />

                  <select
                    value={aiTargetCategory}
                    onChange={(e) =>
                      setAiTargetCategory(
                        e.target.value as 'writing' | 'task1' | 'task2'
                      )
                    }
                    aria-label="新词归入分类"
                    className="hidden shrink-0 rounded-xl border border-[#DCD7CA] bg-[#F5F2EA] px-2.5 py-2 font-sans text-xs text-[#7A7873] focus:outline-none sm:block"
                  >
                    <option value="writing">归入：写作积累</option>
                    <option value="task1">归入：Task 1 核心</option>
                    <option value="task2">归入：Task 2 学术</option>
                  </select>

                  <button
                    type="submit"
                    disabled={isAiGenerating}
                    className="skeuo-btn-light shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-sans text-xs font-semibold text-[#262523] disabled:opacity-60"
                  >
                    {isAiGenerating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#EA5B25]" />
                        <span>补全中...</span>
                      </>
                    ) : (
                      <span>+ AI 入库</span>
                    )}
                  </button>
                </form>

                {/* Right: Prominent Braun Signal Orange Primary Action Button [ 开始背词 (x) → ] */}
                <button
                  type="button"
                  disabled={categoryCards.length === 0}
                  onClick={() => handleStartDeckStudy()}
                  className="skeuo-btn-orange shrink-0 inline-flex items-center justify-center rounded-xl px-5 py-2 font-sans text-xs font-semibold tracking-wide text-white disabled:opacity-45"
                >
                  <span>
                    {selectedCategory === 'mastered'
                      ? '抽查巩固'
                      : '开始背词'}{' '}
                  </span>
                  <span className="ml-1 font-mono">
                    ({studyCandidateCards.length})
                  </span>
                  <span className="ml-1.5">→</span>
                </button>
              </div>

              {/* Sub-row: Quiet Filter Search + AI Feedback Message */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A8A49B]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="检索当前词盒词条或中文释义..."
                    className="w-full rounded-lg border border-[#E5E0D5] bg-[#F7F4EC] py-1.5 pl-8 pr-3 font-sans text-xs text-[#262523] placeholder-[#A8A49B] focus:border-[#C5BFB2] focus:bg-[#FAF8F3] focus:outline-none"
                  />
                </div>

                {aiFeedbackMsg ? (
                  <span
                    className={`font-sans text-xs ${
                      aiFeedbackMsg.type === 'success'
                        ? 'text-[#2E7D5B]'
                        : 'text-[#EA5B25]'
                    }`}
                  >
                    {aiFeedbackMsg.text}
                  </span>
                ) : (
                  <span className="font-sans text-[11px] text-[#9B978E]">
                    点击任意词条行即可朗读英式发音 · 点击右侧按钮进入 3D 抽认卡自测
                  </span>
                )}
              </div>
            </div>

            {/* Paper Body: Dictionary Print List */}
            <div className="max-h-[64vh] overflow-y-auto px-6 py-2 sm:px-8">
              {listFilteredCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="font-sans text-sm font-semibold text-[#262523]">
                    {selectedCategory === 'learning'
                      ? '当前「待攻克」错词池为空'
                      : selectedCategory === 'mastered'
                      ? '暂无已掌握词条'
                      : '当前词盒暂无匹配词条'}
                  </p>
                  <p className="mt-1.5 max-w-md font-sans text-xs leading-relaxed text-[#7A7873]">
                    {selectedCategory === 'learning'
                      ? '在背词抽查时点击「没记住」或拼写出错的单词，会自动归入此处供重点强化。'
                      : selectedCategory === 'mastered'
                      ? '在背词抽查时点击「记住了」或拼写一次通过的单词，会自动归档至此。'
                      : '可在上方输入框直接输入英文单词由 AI 自动生成音标与释义入库。'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#EBE6DF]">
                  {listFilteredCards.map((item, idx) => {
                    const itemPhonetic = getValidPhonetic(item);
                    const itemPos = getValidPos(item);
                    const itemOrigErr = getOriginalErrorText(item);
                    const itemSyns = getCleanSynonyms(item, itemOrigErr);
                    const itemIsLearning = isCardLearning(item);
                    const itemIsMastered = isCardMastered(item);

                    return (
                      <div
                        key={item.id}
                        onClick={(e) => handleSpeak(item.word, e)}
                        title="点击朗读英式发音 (en-GB)"
                        className="group flex cursor-pointer items-center justify-between gap-4 py-3.5 transition-colors hover:bg-[#F4F1E8]/70"
                      >
                        {/* Left & Center: Dictionary Entry Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                            <span className="w-6 shrink-0 font-mono text-[11px] text-[#ACA79C]">
                              {String(idx + 1).padStart(2, '0')}
                            </span>

                            <span className="font-serif text-base font-semibold tracking-tight text-[#262523]">
                              {item.word}
                            </span>

                            {itemPhonetic && (
                              <span className="font-ipa text-xs text-[#7A7873]">
                                {itemPhonetic}
                              </span>
                            )}

                            {itemPos && (
                              <span className="font-mono text-xs text-[#9E988E]">
                                {itemPos}
                              </span>
                            )}

                            <Volume2 className="h-3.5 w-3.5 shrink-0 translate-y-[1px] text-[#C2BDB2] transition-colors group-hover:text-[#EA5B25]" />

                            {itemIsLearning && (
                              <span className="inline-flex items-center gap-1 rounded bg-[#FAF0EC] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#EA5B25]">
                                <span className="h-1 w-1 rounded-full bg-[#EA5B25]" />
                                待攻克
                              </span>
                            )}

                            {itemIsMastered && (
                              <span className="inline-flex items-center gap-1 rounded bg-[#EEF5F1] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#2E7D5B]">
                                ✓ 已掌握
                              </span>
                            )}

                            {item.fromWriting && (
                              <span className="font-sans text-[10px] text-[#9E988E]">
                                · 来自写作批改
                              </span>
                            )}
                          </div>

                          {/* Meaning + Synonyms + Original Error on second line */}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8">
                            <span className="font-sans text-xs font-medium text-[#262523]">
                              {item.chineseMeaning}
                            </span>

                            {itemSyns.length > 0 && (
                              <span className="font-sans text-[11px] text-[#7A7873]">
                                同义替换：
                                <span className="font-serif text-xs text-[#262523]">
                                  {itemSyns.join(' / ')}
                                </span>
                              </span>
                            )}

                            {itemOrigErr && (
                              <span className="font-sans text-[11px] text-[#EA5B25]">
                                原词误写：
                                <span className="font-mono line-through">
                                  {itemOrigErr}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right Hover Actions: Quick Status Toggle + Study From Here + Delete */}
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          {itemIsMastered ? (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateStatus(item.id, 'unlearned')
                              }
                              className="skeuo-btn-light rounded-md px-2 py-1 font-sans text-[11px] text-[#7A7873] hover:text-[#262523]"
                              title="移回待背队列"
                            >
                              恢复待背
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateStatus(item.id, 'mastered')
                              }
                              className="skeuo-btn-light rounded-md px-2 py-1 font-sans text-[11px] text-[#7A7873] hover:text-[#2E7D5B]"
                              title="直接标记为已掌握"
                            >
                              标为已掌握
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onDeleteCard(item.id)}
                            className="p-1.5 text-[#B5B0A4] transition-colors hover:text-[#EA5B25]"
                            title="删除该词条"
                            aria-label="删除该词条"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        /* =====================================================================
            LEVEL 2 (FOCUSED QUIZ VIEW): 纯粹的「3D 叠纸抽认卡页」
           ===================================================================== */
        <div className="flex flex-col items-center justify-center pt-1">
          {/* Card Top Header Bar: Left [ ← 返回词表 ] | Center Progress ● 01 / xx | Right 待攻克 Counter */}
          <div className="mb-4 grid w-full max-w-[540px] grid-cols-3 items-center">
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setViewStep('list')}
                className="skeuo-btn-light inline-flex items-center rounded-lg px-3 py-1.5 font-sans text-xs font-medium text-[#262523]"
              >
                ← 返回词表
              </button>
            </div>

            <div className="flex items-center justify-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
              <span className="font-mono text-xs font-medium tracking-[0.22em] text-[#7A7873]">
                {remainingInQueue > 0 ? '01' : '00'} / {formattedRemaining}
              </span>
            </div>

            <div className="flex justify-end">
              {categoryCounts.learning > 0 && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-sans text-[11px] transition-all duration-200 ${
                    learningPulse
                      ? 'scale-105 bg-[#FAF0EC] font-semibold text-[#EA5B25] ring-1 ring-[#EA5B25]/40'
                      : 'text-[#7A7873]'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                  <span>待攻克</span>
                  <span className="font-mono">{categoryCounts.learning}</span>
                </span>
              )}
            </div>
          </div>

          {!activeCard ? (
            /* Round Completed State (All cards in current queue have been mastered!) */
            <div className="relative mb-4 w-full max-w-[540px]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[1]"
              >
                <div
                  className="absolute inset-0 rounded-2xl border border-[#D7D2C6] bg-[#F2EFE9] shadow-[0_10px_24px_-6px_rgba(38,37,35,0.12),0_2px_6px_rgba(38,37,35,0.06)]"
                  style={{ transform: 'translateY(14px) scaleX(0.92)' }}
                />
                <div
                  className="absolute inset-0 rounded-2xl border border-[#DCD7CB] bg-[#F7F4EE] shadow-[0_6px_16px_-4px_rgba(38,37,35,0.09),0_1px_3px_rgba(38,37,35,0.05)]"
                  style={{ transform: 'translateY(7px) scaleX(0.96)' }}
                />
              </div>

              <div className="skeuo-paper relative z-10 flex min-h-[380px] w-full flex-col items-center justify-center rounded-2xl px-8 py-10 text-center">
                <span className="h-2.5 w-2.5 rounded-full bg-[#EA5B25]" />
                <h2 className="mt-4 font-sans text-lg font-semibold text-[#262523]">
                  本轮待背词条已全部攻克
                </h2>
                <p className="mt-2 max-w-sm font-sans text-xs leading-relaxed text-[#7A7873]">
                  所有标记「记住了」的单词已自动归档至「已掌握」词盒。你可以返回词表查看，或开启新一轮巩固抽查。
                </p>

                <div className="mt-7 flex flex-wrap items-center justify-center gap-3 font-sans">
                  <button
                    type="button"
                    onClick={() => setViewStep('list')}
                    className="skeuo-btn-light rounded-xl px-4 py-2.5 text-xs font-medium text-[#262523]"
                  >
                    ← 返回词表
                  </button>

                  {categoryCounts.mastered > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory('mastered');
                        setViewStep('list');
                      }}
                      className="skeuo-btn-light rounded-xl px-4 py-2.5 text-xs font-medium text-[#262523]"
                    >
                      查看已掌握 ({categoryCounts.mastered})
                    </button>
                  )}

                  {categoryCards.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSessionQueue(categoryCards.map((c) => c.id));
                      }}
                      className="skeuo-btn-orange inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-xs font-semibold text-white"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>再背一轮</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* =================================================================
                  STACKED CARD DECK (2D Layer z-1) + ISOLATED 3D FLIPPER (Layer z-10)
                 ================================================================= */}
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

                {/* 2. Isolated Top 2D Compositing Boundary (z-index: 10, translateZ(0)) */}
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
                        } else {
                          spellInputRef.current?.focus();
                        }
                      }}
                      className={`relative h-[390px] w-full ${
                        studyMode === 'recognize'
                          ? 'cursor-pointer'
                          : 'cursor-text'
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
                      {/* =============================================================
                          FRONT FACE (rotateY(0deg)) — Recognize Front OR Spelling Mode
                         ============================================================= */}
                      <div
                        className="skeuo-paper absolute inset-0 flex flex-col justify-between rounded-2xl px-8 py-8 text-center sm:px-10"
                        style={{
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'rotateY(0deg)',
                          pointerEvents:
                            studyMode === 'recognize' && isFlipped
                              ? 'none'
                              : 'auto',
                        }}
                      >
                        {/* TOP HEADER ROW: Left POS + Status | Right Pure 2-Mode Switcher [ 认读 | 拼写 ] */}
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs tracking-wide text-[#9E988E]">
                            <span className="font-mono">{validPos}</span>
                            {activeCard.fromWriting && (
                              <span className="font-sans">
                                {validPos ? ' · ' : ''}来自写作批改
                              </span>
                            )}
                            {isCardLearning(activeCard) && (
                              <span className="rounded bg-[#FAF0EC] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#EA5B25]">
                                待攻克
                              </span>
                            )}
                          </div>

                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="skeuo-groove inline-flex items-center rounded-lg p-0.5 font-sans"
                          >
                            <button
                              type="button"
                              onClick={() => setStudyMode('recognize')}
                              className={`rounded-md px-3 py-1 text-[11px] transition-all ${
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
                              className={`rounded-md px-3 py-1 text-[11px] transition-all ${
                                studyMode === 'spell'
                                  ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                                  : 'text-[#7A7873] hover:text-[#262523]'
                              }`}
                            >
                              拼写
                            </button>
                          </div>
                        </div>

                        {studyMode === 'recognize' ? (
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
                                <span className="font-ipa text-sm">
                                  {validPhonetic}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) =>
                                  handleSpeak(activeCard.word, e)
                                }
                                className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                                title="朗读英式发音 (en-GB)"
                                aria-label="朗读英式发音"
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* SPELLING MODE — FRONT CENTER */
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
                                  onClick={(e) =>
                                    handleSpeak(activeCard.word, e)
                                  }
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
                                {targetWord
                                  .split('')
                                  .map((targetChar, idx) => {
                                    if (targetChar === ' ') {
                                      return (
                                        <span key={idx} className="w-3.5" />
                                      );
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

                        {/* FRONT BOTTOM: Pure Example Sentence Only */}
                        <p className="mx-auto max-w-md font-serif text-sm italic leading-relaxed text-[#7A7873] line-clamp-3">
                          “
                          {studyMode === 'spell' && spellStatus !== 'correct'
                            ? maskedSentence
                            : activeCard.exampleSentence}
                          ”
                        </p>
                      </div>

                      {/* =============================================================
                          BACK FACE (rotateY(180deg)) — Always Mounted in DOM for True 3D Flip
                         ============================================================= */}
                      <div
                        className="skeuo-paper absolute inset-0 flex flex-col justify-between rounded-2xl px-8 py-8 text-center sm:px-10"
                        style={{
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'rotateY(180deg)',
                          pointerEvents:
                            studyMode === 'recognize' && isFlipped
                              ? 'auto'
                              : 'none',
                        }}
                      >
                        {/* BACK TOP HEADER ROW: Pure Ink POS + Stamp | Right Mode Switcher [ 认读 | 拼写 ] */}
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs tracking-wide text-[#9E988E]">
                            <span className="font-mono">{validPos}</span>
                            {activeCard.fromWriting && (
                              <span className="font-sans">
                                {validPos ? ' · ' : ''}来自写作批改
                              </span>
                            )}
                            {isCardLearning(activeCard) && (
                              <span className="rounded bg-[#FAF0EC] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#EA5B25]">
                                待攻克
                              </span>
                            )}
                          </div>

                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="skeuo-groove inline-flex items-center rounded-lg p-0.5 font-sans"
                          >
                            <button
                              type="button"
                              onClick={() => setStudyMode('recognize')}
                              className={`rounded-md px-3 py-1 text-[11px] transition-all ${
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
                              className={`rounded-md px-3 py-1 text-[11px] transition-all ${
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
                              <span className="font-ipa text-xs text-[#9B978E]">
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

              {/* =================================================================
                  BOTTOM ACTION BUTTONS (Recognize Mode Only):
                  - Strictly Centered Text: [ 没记住 ] (米白键) | [ 记住了 ] (博朗橙键)
                  - Zero extra numbers or arrows!
                 ================================================================= */}
              {studyMode === 'recognize' && (
                <div className="mt-6 flex w-full max-w-[540px] items-center justify-center gap-4 font-sans">
                  <button
                    type="button"
                    onClick={() => handleDecision('learning')}
                    className="skeuo-btn-light flex flex-1 items-center justify-center rounded-xl px-5 py-3.5 text-center text-sm font-semibold text-[#262523]"
                  >
                    没记住
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDecision('mastered')}
                    className="skeuo-btn-orange flex flex-1 items-center justify-center rounded-xl px-5 py-3.5 text-center text-sm font-semibold text-white"
                  >
                    记住了
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
