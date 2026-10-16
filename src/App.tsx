import React, { useState } from 'react';
import {
  ActiveTab,
  DeepSeekConfig,
  MasteryStatus,
  VocabularyCard,
  WritingEvaluationReport,
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

  const [writingReports, setWritingReports] = useLocalStorage<
    WritingEvaluationReport[]
  >('ielts_studio_writing_reports_v1', []);

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

  const handleSaveWritingReport = (report: WritingEvaluationReport) => {
    setWritingReports((prev) => [report, ...prev]);
  };

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
            reports={writingReports}
            onSaveReport={handleSaveWritingReport}
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
