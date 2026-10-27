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
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  deriveConciseMeaning,
} from './lib/geminiEvaluator';
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
        fullMeaning?: string;
        synonyms?: string[];
      }
    > = {
      categories: {
        phonetic: '/ˈkætəɡəriz/',
        pos: 'n.',
        meaning: '类别，种类，分组',
        fullMeaning: 'n. 类别，种类，统计分组（category 的复数，Task 1 图表首段改写与分类对比核心词）',
        synonyms: ['classifications', 'types'],
      },
      category: {
        phonetic: '/ˈkætəɡəri/',
        pos: 'n.',
        meaning: '类别，种类，范畴',
        fullMeaning: 'n. 类别，种类，范畴 (fall into the category of 属于…类别)',
        synonyms: ['classification', 'type'],
      },
      'scenic spots': {
        phonetic: '',
        pos: 'phrase',
        meaning: '风景名胜，旅游景点',
        fullMeaning: 'phrase 风景名胜，自然或人文旅游景点（替换 tourist places 的地道词组）',
        synonyms: ['tourist attractions', 'landmarks'],
      },
      trajectory: {
        phonetic: '/trəˈdʒektəri/',
        pos: 'n.',
        meaning: '轨迹，发展态势，趋势',
        fullMeaning: 'n. 发展轨迹，演变态势 (upward/downward trajectory)；弹道，轨道',
        synonyms: ['trend', 'path', 'course'],
      },
      proportion: {
        phonetic: '/prəˈpɔːʃn/',
        pos: 'n. / v.',
        meaning: '比例，份额，占比',
        fullMeaning: 'n. 比例，份额，占比 (a large proportion of)；均衡 (in proportion to) | v. 使成比例，使相称',
        synonyms: ['percentage', 'share', 'ratio'],
      },
      address: {
        phonetic: '/əˈdres/',
        pos: 'v. / n.',
        meaning: '解决，处理；演说；地址',
        fullMeaning: 'v. 解决，处理 (address the issue)；向…发表演说；称呼 | n. 地址；正式演讲',
        synonyms: ['tackle', 'resolve', 'handle'],
      },
      project: {
        phonetic: '/ˈprɒdʒekt/',
        pos: 'n. / v.',
        meaning: '项目，工程；预测，预计',
        fullMeaning: 'n. 项目，工程，课题 | v. 预测，预计（Task 1 未来趋势核心词 be projected to）；投射，展现',
        synonyms: ['forecast', 'predict', 'scheme'],
      },
      figure: {
        phonetic: '/ˈfɪɡə(r)/',
        pos: 'n. / v.',
        meaning: '数字，数据；图表；认为',
        fullMeaning: 'n. 数字，统计数据（Task 1 核心词）；图表；人物，身材 | v. 认为，认定；计算，弄懂 (figure out)',
        synonyms: ['statistic', 'number', 'data'],
      },
      account: {
        phonetic: '/əˈkaʊnt/',
        pos: 'n. / v.',
        meaning: '账户；描述；占比，解释',
        fullMeaning: 'n. 账户；描述，叙述；解释 (on account of 由于) | v. 占…比例，解释说明 (account for)；认为是',
        synonyms: ['constitute', 'comprise', 'represent'],
      },
      inform: {
        phonetic: '/ɪnˈfɔːm/',
        pos: 'v.',
        meaning: '通知，告知；影响；提供依据',
        fullMeaning: 'v. 通知，告知 (inform sb of sth)；为…提供依据，影响（决策或态度）；检举，告发 (inform on)；赋予特征',
        synonyms: ['notify', 'apprise', 'influence'],
      },
      significantly: {
        phonetic: '/sɪɡˈnɪfɪkəntli/',
        pos: 'adv.',
        meaning: '显著地，大幅地；意味深长地',
        fullMeaning: 'adv. 显著地，大幅度地（Task 1 核心程度副词）；有重大意义地，意味深长地',
        synonyms: ['considerably', 'markedly', 'substantially'],
      },
      dramatically: {
        phonetic: '/drəˈmætɪkli/',
        pos: 'adv.',
        meaning: '急剧地，显著地；戏剧性地',
        fullMeaning: 'adv. 急剧地，显著地（修饰剧烈上升或下跌）；戏剧性地，引人注目地',
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
        const defaultCard = DEFAULT_IELTS_VOCABULARY.find(
          (d) => d.id === card.id || d.word.trim().toLowerCase() === lower
        );
        const needsDualMeaningUpgrade =
          Boolean(
            defaultCard &&
              (card.chineseMeaning !== defaultCard.chineseMeaning ||
                card.fullMeaning !== defaultCard.fullMeaning)
          ) ||
          Boolean(
            known?.fullMeaning &&
              (card.fullMeaning !== known.fullMeaning ||
                card.chineseMeaning.includes('|'))
          ) ||
          Boolean(
            !card.fullMeaning &&
              (card.chineseMeaning.includes('|') ||
                card.chineseMeaning.length > 22)
          );

        return (
          hasFakePhonetic ||
          hasFakePos ||
          Boolean(needsKnownPhoneticFix) ||
          Boolean(hasPollutedSynonym) ||
          Boolean(needsKnownSynonymFix) ||
          Boolean(needsDualMeaningUpgrade) ||
          missingCategory
        );
      });

    if (needsCleanup) {
      setVocabCards((prev) => {
        const defaultCardByWord = new Map<string, VocabularyCard>();
        const defaultCategoryByWord = new Map<
          string,
          'writing' | 'task1' | 'task2'
        >();
        for (const def of DEFAULT_IELTS_VOCABULARY) {
          defaultCardByWord.set(def.word.trim().toLowerCase(), def);
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
          const defaultCard = defaultCardByWord.get(lower);
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
            : defaultCard &&
              defaultCard.partOfSpeech.includes('/') &&
              !card.partOfSpeech.includes('/')
            ? defaultCard.partOfSpeech
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

          const isLongCurrentMeaning =
            card.chineseMeaning.includes('|') ||
            card.chineseMeaning.length > 22;

          const nextConciseMeaning = defaultCard
            ? defaultCard.chineseMeaning
            : known?.meaning
            ? known.meaning
            : isLongCurrentMeaning
            ? deriveConciseMeaning(card.chineseMeaning)
            : card.meaning || card.chineseMeaning;

          const nextFullMeaning = defaultCard?.fullMeaning
            ? defaultCard.fullMeaning
            : known?.fullMeaning
            ? known.fullMeaning
            : card.fullMeaning
            ? card.fullMeaning
            : isLongCurrentMeaning
            ? card.chineseMeaning
            : undefined;

          return {
            ...card,
            phonetic: nextPhonetic,
            partOfSpeech: nextPos,
            meaning: nextConciseMeaning,
            chineseMeaning: nextConciseMeaning,
            fullMeaning: nextFullMeaning,
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
      model: 'deepseek-v4-pro',
    }
  );

  // Automatic localStorage migration: upgrade legacy 'deepseek-chat' / 'deepseek-reasoner' aliases to 'deepseek-v4-pro'
  useEffect(() => {
    if (
      aiConfig.model !== 'deepseek-v4-flash' &&
      aiConfig.model !== 'deepseek-v4-pro'
    ) {
      setAiConfig((prev) => ({
        ...prev,
        model: 'deepseek-v4-pro',
      }));
    }
  }, [aiConfig.model, setAiConfig]);

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
      let addedOrUpdatedCount = 0;
      setVocabCards((prev) => {
        const updatedPrev = [...prev];
        const existingIndexByWord = new Map<string, number>();
        updatedPrev.forEach((c, idx) => {
          existingIndexByWord.set(c.word.trim().toLowerCase(), idx);
        });

        const createdCards: VocabularyCard[] = [];
        for (const item of newCardsData) {
          const normalized = item.word.trim().toLowerCase();
          if (!normalized) continue;
          const existingIdx = existingIndexByWord.get(normalized);
          if (existingIdx !== undefined) {
            // Upgrade existing card in place with dual-layer meaning + fullMeaning & phonetics
            const existingCard = updatedPrev[existingIdx];
            const nextConcise =
              item.meaning || item.chineseMeaning || existingCard.chineseMeaning;
            updatedPrev[existingIdx] = {
              ...existingCard,
              phonetic: item.phonetic || existingCard.phonetic,
              partOfSpeech: item.partOfSpeech || existingCard.partOfSpeech,
              meaning: nextConcise,
              chineseMeaning: nextConcise,
              fullMeaning: item.fullMeaning || existingCard.fullMeaning,
              englishDefinition:
                item.englishDefinition || existingCard.englishDefinition,
              paraphrasing:
                item.paraphrasing?.length
                  ? item.paraphrasing
                  : existingCard.paraphrasing,
              synonyms:
                item.synonyms?.length ? item.synonyms : existingCard.synonyms,
              exampleSentence:
                item.exampleSentence || existingCard.exampleSentence,
              exampleTranslation:
                item.exampleTranslation || existingCard.exampleTranslation,
            };
            addedOrUpdatedCount += 1;
            continue;
          }
          existingIndexByWord.set(normalized, -1);
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
          addedOrUpdatedCount += 1;
        }
        return createdCards.length > 0
          ? [...createdCards, ...updatedPrev]
          : updatedPrev;
      });
      return addedOrUpdatedCount;
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
