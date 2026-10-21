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
        };
        return [newCard, ...prev];
      });
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
    <div className="min-h-screen bg-[#E6E4DD] text-[#262523]">
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
