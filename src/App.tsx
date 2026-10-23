import React, { useState, useCallback, useEffect } from 'react';
import {
  ActiveTab,
  DeepSeekConfig,
  MasteryStatus,
  VocabularyCard,
  WritingEvaluationReport,
  WritingTaskType,
} from './types/ielts';
import { DEFAULT_IELTS_VOCABULARY } from './lib/defaultVocabulary';
import { DEFAULT_DEEPSEEK_ENDPOINT } from './lib/geminiEvaluator';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Navbar } from './components/Navbar';
import { ApiKeyModal } from './components/ApiKeyModal';
import { VocabularyModule } from './components/VocabularyModule';
import { WritingModule } from './components/WritingModule';

export function App() {
  const [activeTab, setActiveTab] = useLocalStorage<ActiveTab>(
    'ielts_studio_active_tab_v1',
    'vocabulary'
  );

  const [vocabCards, setVocabCards] = useLocalStorage<VocabularyCard[]>(
    'ielts_studio_vocab_deck_v1',
    DEFAULT_IELTS_VOCABULARY
  );

  // Sanitize legacy ingested vocabulary cards & merge built-in Task 1 (30) + Task 2 (30) word-boxes
  useEffect(() => {
    const KNOWN_WORD_FIXES: Record<
      string,
      {
        phonetic: string;
        pos: string;
        meaning?: string;
        synonyms?: string[];
      }
    > = {
      categories: {
        phonetic: '/ˈkætəɡəriz/',
        pos: 'n.',
        meaning: '类别，种类（category 的复数）',
        synonyms: ['classifications', 'types'],
      },
      category: {
        phonetic: '/ˈkætəɡəri/',
        pos: 'n.',
        meaning: '类别，种类',
        synonyms: ['classification', 'type'],
      },
      'scenic spots': {
        phonetic: '',
        pos: 'phrase',
        meaning: '风景名胜，旅游景点',
        synonyms: ['tourist attractions', 'landmarks'],
      },
      trajectory: {
        phonetic: '/trəˈdʒektəri/',
        pos: 'n.',
        meaning: '轨迹，发展道路，趋势',
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

    const KNOWN_BAD_SYNONYMS = new Set([
      'catogerise',
      'catogerises',
      'categorys',
      'scenery spots',
      'scenery spot',
    ]);

    const existingWordsLower = new Set(
      vocabCards.map((c) => c.word.trim().toLowerCase())
    );
    const missingDefaults = DEFAULT_IELTS_VOCABULARY.filter(
      (defCard) =>
        !existingWordsLower.has(defCard.word.trim().toLowerCase()) &&
        !vocabCards.some((c) => c.id === defCard.id)
    );

    const needsCleanup =
      missingDefaults.length > 0 ||
      vocabCards.some((card) => {
        const lower = card.word.trim().toLowerCase();
        const known = KNOWN_WORD_FIXES[lower];
        const hasFakePhonetic = /\/(academic|phrase|collocation)\//i.test(
          card.phonetic || ''
        );
        const hasFakePos = /^(acad\.|expr\.)$/i.test(card.partOfSpeech || '');
        const needsKnownPhoneticFix =
          known && card.phonetic !== known.phonetic;

        // Check if paraphrasing / synonyms is polluted by originalError or known bad words
        const extractedErr =
          card.originalError?.trim().toLowerCase() ||
          card.exampleTranslation
            ?.match(/将\s*[“"]([^”"]+)[”"]\s*升级为/)?.[1]
            ?.trim()
            .toLowerCase() ||
          '';

        const currentSyns = card.paraphrasing || [];
        const hasPollutedSynonym = currentSyns.some((s) => {
          const sl = s.trim().toLowerCase();
          return (
            KNOWN_BAD_SYNONYMS.has(sl) ||
            (extractedErr && sl === extractedErr) ||
            sl === lower
          );
        });

        const needsKnownSynonymFix =
          known?.synonyms &&
          (currentSyns.length === 0 ||
            hasPollutedSynonym ||
            currentSyns.join('|') !== known.synonyms.join('|'));

        const missingCategory = !card.vocabCategory;
        return (
          hasFakePhonetic ||
          hasFakePos ||
          Boolean(needsKnownPhoneticFix) ||
          Boolean(hasPollutedSynonym) ||
          Boolean(needsKnownSynonymFix) ||
          missingCategory
        );
      });

    if (needsCleanup) {
      setVocabCards((prev) => {
        const defaultCategoryByWord = new Map<
          string,
          'writing' | 'task1' | 'task2'
        >();
        for (const def of DEFAULT_IELTS_VOCABULARY) {
          if (def.vocabCategory) {
            defaultCategoryByWord.set(
              def.word.trim().toLowerCase(),
              def.vocabCategory
            );
          }
        }

        const cleaned = prev.map((card) => {
          const lower = card.word.trim().toLowerCase();
          const known = KNOWN_WORD_FIXES[lower];
          const isFakePhonetic = /\/(academic|phrase|collocation)\//i.test(
            card.phonetic || ''
          );
          const isFakePos = /^(acad\.|expr\.)$/i.test(card.partOfSpeech || '');

          const nextPhonetic = known
            ? known.phonetic
            : isFakePhonetic || card.word.trim().includes(' ')
            ? ''
            : card.phonetic;

          const nextPos = known
            ? known.pos
            : isFakePos
            ? card.word.trim().includes(' ')
              ? 'phrase'
              : 'n.'
            : card.partOfSpeech;

          let nextOriginalError = card.originalError;
          if (!nextOriginalError && card.fromWriting) {
            const match = card.exampleTranslation?.match(
              /将\s*[“"]([^”"]+)[”"]\s*升级为/
            );
            if (match?.[1]) {
              nextOriginalError = match[1].trim();
            } else if (card.paraphrasing?.[0]) {
              nextOriginalError = card.paraphrasing[0].trim();
            }
          }

          const errLower = (nextOriginalError || '').trim().toLowerCase();
          const sanitizedSynonyms = known?.synonyms
            ? known.synonyms
            : (card.synonyms || card.paraphrasing || []).filter((s) => {
                const sl = String(s).trim().toLowerCase();
                if (!sl || sl.length > 36) return false;
                if (sl === lower) return false;
                if (errLower && sl === errLower) return false;
                if (KNOWN_BAD_SYNONYMS.has(sl)) return false;
                return true;
              });

          const resolvedCategory: 'writing' | 'task1' | 'task2' =
            card.vocabCategory ||
            (card.fromWriting || card.isCustom
              ? 'writing'
              : defaultCategoryByWord.get(lower) ||
                (card.id.startsWith('task1-') ? 'task1' : 'task2'));

          return {
            ...card,
            phonetic: nextPhonetic,
            partOfSpeech: nextPos,
            chineseMeaning:
              known?.meaning && card.chineseMeaning.startsWith('高分替换：')
                ? known.meaning
                : card.chineseMeaning,
            paraphrasing: sanitizedSynonyms,
            synonyms: sanitizedSynonyms,
            originalError: nextOriginalError,
            vocabCategory: resolvedCategory,
          };
        });

        const currentLowerSet = new Set(
          cleaned.map((c) => c.word.trim().toLowerCase())
        );
        const currentIdSet = new Set(cleaned.map((c) => c.id));
        const toAppend = DEFAULT_IELTS_VOCABULARY.filter(
          (def) =>
            !currentLowerSet.has(def.word.trim().toLowerCase()) &&
            !currentIdSet.has(def.id)
        );

        return [...cleaned, ...toAppend];
      });
    }
  }, [vocabCards, setVocabCards]);

  const [aiConfig, setAiConfig] = useLocalStorage<DeepSeekConfig>(
    'ielts_studio_deepseek_config_v1',
    {
      apiKey: '',
      endpoint: DEFAULT_DEEPSEEK_ENDPOINT,
      model: 'deepseek-chat',
    }
  );

  // Independent Task 1 & Task 2 History Archives ('ielts_history_task1' & 'ielts_history_task2')
  const [task1Reports, setTask1Reports] = useLocalStorage<
    WritingEvaluationReport[]
  >('ielts_history_task1', []);

  const [task2Reports, setTask2Reports] = useLocalStorage<
    WritingEvaluationReport[]
  >('ielts_history_task2', []);

  // Automatic compatibility migration from legacy shared history ('ielts_studio_writing_reports_v1')
  useEffect(() => {
    try {
      const legacyRaw = window.localStorage.getItem(
        'ielts_studio_writing_reports_v1'
      );
      if (!legacyRaw) return;
      const legacyList = JSON.parse(legacyRaw);
      if (Array.isArray(legacyList) && legacyList.length > 0) {
        const migratedTask1: WritingEvaluationReport[] = [];
        const migratedTask2: WritingEvaluationReport[] = [];

        for (const item of legacyList) {
          if (!item || typeof item !== 'object') continue;
          const hasImage = Boolean(item.chartImageDataUrl || item.image);
          const summaryStr = String(item?.trTa?.summary || '');
          const isT1 =
            item.taskType === 'task1' ||
            hasImage ||
            /\bTA\b|Task Achievement|图表/i.test(summaryStr);

          if (isT1) {
            migratedTask1.push({
              ...item,
              taskType: 'task1',
              firstCriterionLabel: 'TA',
              image: item.image || item.chartImageDataUrl || null,
              chartImageDataUrl: item.chartImageDataUrl || item.image || null,
            });
          } else {
            migratedTask2.push({
              ...item,
              taskType: 'task2',
              firstCriterionLabel: 'TR',
              topicId: item.topicId || 'custom',
            });
          }
        }

        if (migratedTask1.length > 0) {
          setTask1Reports((prev) => {
            const existingIds = new Set(prev.map((r) => r.id));
            const uniqueNew = migratedTask1.filter(
              (r) => !existingIds.has(r.id)
            );
            return [...prev, ...uniqueNew];
          });
        }
        if (migratedTask2.length > 0) {
          setTask2Reports((prev) => {
            const existingIds = new Set(prev.map((r) => r.id));
            const uniqueNew = migratedTask2.filter(
              (r) => !existingIds.has(r.id)
            );
            return [...prev, ...uniqueNew];
          });
        }
      }
      window.localStorage.removeItem('ielts_studio_writing_reports_v1');
    } catch {
      // ignore migration parse errors
    }
  }, [setTask1Reports, setTask2Reports]);

  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);

  const handleUpdateVocabStatus = (id: string, status: MasteryStatus) => {
    setVocabCards((prev) =>
      prev.map((card) =>
        card.id === id
          ? {
              ...card,
              status,
              reviewCount: card.reviewCount + 1,
              lastReviewedAt: new Date().toISOString(),
            }
          : card
      )
    );
  };

  const handleIngestVocabFromWriting = useCallback(
    (newCardData: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>) => {
      setVocabCards((prev) => {
        const normalizedWord = newCardData.word.trim().toLowerCase();
        const alreadyExists = prev.some(
          (c) => c.word.trim().toLowerCase() === normalizedWord
        );
        if (alreadyExists) return prev;

        const newCard: VocabularyCard = {
          ...newCardData,
          id: `writing-vocab-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          status: 'unlearned',
          reviewCount: 0,
          fromWriting: true,
          vocabCategory: 'writing',
        };
        return [newCard, ...prev];
      });
    },
    [setVocabCards]
  );

  const handleAddVocabCards = useCallback(
    (
      newCardsData: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>[]
    ): number => {
      let addedCount = 0;
      setVocabCards((prev) => {
        const existingLower = new Set(
          prev.map((c) => c.word.trim().toLowerCase())
        );
        const createdCards: VocabularyCard[] = [];
        for (const item of newCardsData) {
          const normalized = item.word.trim().toLowerCase();
          if (!normalized || existingLower.has(normalized)) continue;
          existingLower.add(normalized);
          createdCards.push({
            ...item,
            id: `custom-vocab-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`,
            status: 'unlearned',
            reviewCount: 0,
            isCustom: true,
            vocabCategory: item.vocabCategory || 'writing',
          });
        }
        addedCount = createdCards.length;
        return createdCards.length > 0 ? [...createdCards, ...prev] : prev;
      });
      return addedCount;
    },
    [setVocabCards]
  );

  const handleDeleteVocabCard = useCallback(
    (cardId: string) => {
      setVocabCards((prev) => prev.filter((c) => c.id !== cardId));
    },
    [setVocabCards]
  );

  const handleSaveWritingReport = useCallback(
    (report: WritingEvaluationReport) => {
      if (report.taskType === 'task1') {
        const normalizedT1: WritingEvaluationReport = {
          ...report,
          taskType: 'task1',
          firstCriterionLabel: 'TA',
          image: report.image || report.chartImageDataUrl || null,
          chartImageDataUrl: report.chartImageDataUrl || report.image || null,
        };
        setTask1Reports((prev) => [normalizedT1, ...prev]);
      } else {
        const normalizedT2: WritingEvaluationReport = {
          ...report,
          taskType: 'task2',
          firstCriterionLabel: 'TR',
          topicId: report.topicId || 'custom',
        };
        setTask2Reports((prev) => [normalizedT2, ...prev]);
      }
    },
    [setTask1Reports, setTask2Reports]
  );

  const handleDeleteWritingReport = useCallback(
    (reportId: string, taskType: WritingTaskType) => {
      if (taskType === 'task1') {
        setTask1Reports((prev) => prev.filter((r) => r.id !== reportId));
      } else {
        setTask2Reports((prev) => prev.filter((r) => r.id !== reportId));
      }
    },
    [setTask1Reports, setTask2Reports]
  );

  const currentTab: ActiveTab =
    activeTab === 'writing' ? 'writing' : 'vocabulary';

  return (
    <div className="desk-surface min-h-screen text-[#262523]">
      <Navbar
        activeTab={currentTab}
        onSelectTab={setActiveTab}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        hasApiKey={Boolean(aiConfig.apiKey.trim())}
      />

      <main>
        {currentTab === 'vocabulary' ? (
          <VocabularyModule
            cards={vocabCards}
            onUpdateStatus={handleUpdateVocabStatus}
            aiConfig={aiConfig}
            onAddCards={handleAddVocabCards}
            onDeleteCard={handleDeleteVocabCard}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
          />
        ) : (
          <WritingModule
            aiConfig={aiConfig}
            task1Reports={task1Reports}
            task2Reports={task2Reports}
            onSaveReport={handleSaveWritingReport}
            onDeleteReport={handleDeleteWritingReport}
            vocabCards={vocabCards}
            onIngestVocab={handleIngestVocabFromWriting}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
          />
        )}
      </main>

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        config={aiConfig}
        onSaveConfig={setAiConfig}
      />
    </div>
  );
}

export default App;
