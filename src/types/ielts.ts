export type MasteryStatus = 'unlearned' | 'vague' | 'mastered';

export type ActiveTab = 'vocabulary' | 'writing';

export interface VocabularyCard {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  chineseMeaning: string;
  englishDefinition: string;
  paraphrasing: string[];
  exampleSentence: string;
  exampleTranslation: string;
  topicTag: string;
  status: MasteryStatus;
  reviewCount: number;
  lastReviewedAt?: string;
  isCustom?: boolean;
  fromWriting?: boolean;
}

export type WritingTaskType = 'task1' | 'task2';

export type TimerMode = 'task2-40m' | 'task1-20m' | 'free';

export interface CriterionEvaluation {
  band: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

export interface LexicalUpgradeItem {
  original: string;
  upgraded: string;
  chineseMeaning?: string;
  contextExplanation: string;
}

export interface GrammarCorrectionItem {
  original: string;
  corrected: string;
  keyExpression?: string;
  chineseMeaning?: string;
  errorType: string;
  explanation: string;
}

export interface WritingEvaluationReport {
  id: string;
  createdAt: string;
  taskType: WritingTaskType;
  topicTag?: string;
  prompt: string;
  chartImageDataUrl?: string | null;
  essay: string;
  wordCount: number;
  overallBand: number;
  trTa: CriterionEvaluation;
  cc: CriterionEvaluation;
  lr: CriterionEvaluation & {
    paraphrasingUpgrades: LexicalUpgradeItem[];
  };
  gra: CriterionEvaluation & {
    errorCorrections: GrammarCorrectionItem[];
  };
  improvedSampleParagraph: string;
  examinerSummary: string;
  reasoningSummary?: string;
  sourceMode: 'deepseek' | 'gemini' | 'demo-engine';
}

export interface WritingDraftState {
  taskType: WritingTaskType;
  topicTag: string;
  prompt: string;
  chartImageDataUrl?: string | null;
  essay: string;
  gradedReportId?: string | null;
}

export type DeepSeekModel = 'deepseek-chat' | 'deepseek-reasoner';

export interface DeepSeekConfig {
  apiKey: string;
  endpoint: string;
  model: DeepSeekModel | string;
}
