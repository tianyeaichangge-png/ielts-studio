export type MasteryStatus = 'unlearned' | 'learning' | 'vague' | 'mastered';

export type ActiveTab = 'vocabulary' | 'writing' | 'notes';

export type NoteCategory =
  | 'Task 1 技巧'
  | 'Task 2 逻辑'
  | '句法与词伙'
  | '批改复盘'
  | '核心讲义';

export interface NoteItem {
  id: string;
  title: string;
  category: NoteCategory;
  content: string;
  isPinned?: boolean;
  updatedAt: string;
  sourceKeys?: string[];
}

export interface VocabularyCard {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning?: string;
  chineseMeaning: string;
  fullMeaning?: string;
  englishDefinition: string;
  paraphrasing: string[];
  synonyms?: string[];
  exampleSentence: string;
  exampleTranslation: string;
  topicTag: string;
  status: MasteryStatus;
  reviewCount: number;
  lastReviewedAt?: string;
  isCustom?: boolean;
  fromWriting?: boolean;
  vocabCategory?: 'writing' | 'task1' | 'task2';
}

export type WritingTaskType = 'task1' | 'task2';

export type Task1ChartType =
  | '折线图'
  | '柱状图'
  | '饼图'
  | '表格'
  | '地图'
  | '流程图';

export interface Task1TopicBankItem {
  id: string;
  prompt: string;
  chartImage: string | null;
  chartType: Task1ChartType;
  bestBand?: number | null;
  attemptCount: number;
  lastEssayId?: string | null;
  updatedAt: string;
  isBuiltIn?: boolean;
}

export interface CriterionEvaluation {
  band: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

export interface LexicalUpgradeItem {
  original: string;
  originalError?: string;
  upgraded: string;
  phonetic?: string;
  pos?: string;
  meaning?: string;
  chineseMeaning?: string;
  fullMeaning?: string;
  synonyms?: string[];
  upgradedSentence?: string;
  contextExplanation: string;
}

export interface GrammarCorrectionItem {
  original: string;
  originalError?: string;
  corrected: string;
  keyExpression?: string;
  phonetic?: string;
  pos?: string;
  meaning?: string;
  chineseMeaning?: string;
  fullMeaning?: string;
  synonyms?: string[];
  errorType: string;
  explanation: string;
}

export interface DimensionDiagnosisItem {
  score: number;
  diagnosis: string;
  strengths?: string[];
  weaknesses?: string[];
}

export interface FourDimensionsEvaluation {
  taOrTr: DimensionDiagnosisItem;
  cc: DimensionDiagnosisItem;
  lr: DimensionDiagnosisItem;
  gra: DimensionDiagnosisItem;
  overallSummary?: string;
}

export interface ParagraphKeyCorrection {
  originalError: string;
  upgradedWord: string;
  phonetic: string;
  pos: string;
  meaning: string;
  fullMeaning?: string;
  synonyms: string[];
  example: string;
}

export interface ParagraphReviewItem {
  paragraphIndex: string;
  originalText: string;
  logicAndLanguageCritique: string;
  reconstructedParagraph: string;
  keyCorrections: ParagraphKeyCorrection[];
}

export interface BreakthroughStrategyItem {
  title: string;
  actionableAdvice: string;
}

export interface ExaminerModelEssay {
  bandScore: string;
  paragraphs: string[];
  highlights: string[];
}

export interface WritingEvaluationReport {
  id: string;
  createdAt: string;
  taskType: WritingTaskType;
  firstCriterionLabel?: 'TA' | 'TR';
  topicId?: string | 'custom';
  topicTag?: string;
  chartType?: Task1ChartType;
  prompt: string;
  image?: string | null;
  chartImageDataUrl?: string | null;
  essay: string;
  wordCount: number;
  overallBand: number;
  // New 4-module structured evaluation fields
  dimensions?: FourDimensionsEvaluation;
  paragraphReviews?: ParagraphReviewItem[];
  breakthroughStrategies?: BreakthroughStrategyItem[];
  modelEssay?: ExaminerModelEssay;
  vocabularyUpgrades?: ParagraphKeyCorrection[];
  // Legacy fields retained for full backward compatibility
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

export interface Task1DraftState {
  selectedTopicId?: string | 'custom';
  viewStep?: 'catalog' | 'writing';
  prompt: string;
  image: string | null;
  content: string;
  timer: number;
  gradedReportId?: string | null;
}

export interface Task2DraftState {
  selectedTopicId: string | 'custom';
  customPrompt: string;
  content: string;
  outline?: string;
  outlinesByTopic?: Record<string, string>;
  timer: number;
  viewStep: 'catalog' | 'writing';
  gradedReportId?: string | null;
}

export type DeepSeekModel = 'deepseek-v4-flash' | 'deepseek-v4-pro';

export interface DeepSeekConfig {
  apiKey: string;
  endpoint: string;
  model: DeepSeekModel | string;
}
