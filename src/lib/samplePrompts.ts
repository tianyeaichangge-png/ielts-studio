import { WritingTaskType } from '../types/ielts';

export interface MasterWritingPrompt {
  id: string;
  taskType: WritingTaskType;
  topicTag: string;
  prompt: string;
}

export const MASTER_WRITING_PROMPTS: MasterWritingPrompt[] = [
  // 1. 科技与未来 · Technology (4 prompts)
  {
    id: 't2-tech-1',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'Some people believe that artificial intelligence and online learning platforms will soon replace classroom teachers completely, while others argue that human teachers remain irreplaceable. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-tech-2',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'More and more people today are using social media and smartphones to communicate with others rather than meeting face to face. Do the advantages of this development outweigh the disadvantages?',
  },
  {
    id: 't2-tech-3',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'In the future, all cars, buses, and trucks will be driverless. The only people travelling inside these vehicles will be passengers. Do you think the advantages of driverless vehicles outweigh the disadvantages?',
  },
  {
    id: 't2-tech-4',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'Modern technology has made it possible for many employees to work from home rather than commuting to an office every day. Do you think this is a positive or negative development for workers and employers?',
  },

  // 2. 教育公平 · Education (4 prompts)
  {
    id: 't2-edu-1',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that the true function of a university should be to give access to knowledge for its own sake. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-edu-2',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'In many countries, children from wealthier families have access to better educational resources than those from low-income households. What problems does this disparity cause, and what measures can governments take to ensure educational equity?',
  },
  {
    id: 't2-edu-3',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'Some educators believe that every child should be taught how to play a musical instrument or participate in artistic activities at school, while others argue that school time should be devoted strictly to core academic subjects. To what extent do you agree or disagree?',
  },
  {
    id: 't2-edu-4',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'Full-time university students spend most of their time studying. Some people think they should also be required to participate in community service or voluntary work. To what extent do you agree or disagree?',
  },

  // 3. 环保与生态 · Environment (4 prompts)
  {
    id: 't2-env-1',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'Some people think that the best way to solve global environmental problems is to increase the cost of fuel for cars and other vehicles. To what extent do you agree or disagree?',
  },
  {
    id: 't2-env-2',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'Plastic bags, disposable packaging, and single-use bottles are causing severe land and ocean pollution. What damage does plastic waste cause to the ecosystem, and what steps can governments and individuals take to address this issue?',
  },
  {
    id: 't2-env-3',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'Human activities have brought many animal and plant species to the brink of extinction. Some people say we should only protect species that are directly useful to humans. To what extent do you agree or disagree?',
  },
  {
    id: 't2-env-4',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'International air travel has become remarkably cheap and accessible in recent decades, yet it contributes significantly to carbon emissions. Should governments impose heavy environmental taxes on airline tickets to restrict air travel?',
  },

  // 4. 政府与经济 · Governance (4 prompts)
  {
    id: 't2-gov-1',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'Some people think that governments should spend public money on space exploration, while others argue that tax revenues should be used to solve urgent problems on Earth such as healthcare and poverty. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-gov-2',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'Economic growth is often considered the most important goal for developing nations. However, some people argue that rapid economic expansion inevitably widens the gap between the rich and the poor. To what extent do you agree or disagree?',
  },
  {
    id: 't2-gov-3',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'In many countries, the proportion of older people is steadily increasing. Does this demographic trend have more positive or negative effects on society and the national economy?',
  },
  {
    id: 't2-gov-4',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'Public museums and art galleries should be funded by government subsidies so that admission is free for all citizens. To what extent do you agree or disagree with this statement?',
  },

  // 5. 犯罪与社会 · Crime & Society (4 prompts)
  {
    id: 't2-soc-1',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'Research indicates that the majority of released prisoners commit further crimes after leaving prison. What are the main causes of this high reoffending rate, and how can rehabilitation programs be improved?',
  },
  {
    id: 't2-soc-2',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'Some people believe that there should be fixed punishments for each type of crime. Others, however, argue that the circumstances of an individual crime, and the motivation for committing it, should always be taken into account. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-soc-3',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'In many cities, the installation of CCTV surveillance cameras in public spaces has increased dramatically. While this helps deter crime, critics argue it invades personal privacy. Do the benefits of public surveillance outweigh the drawbacks?',
  },
  {
    id: 't2-soc-4',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'Juvenile delinquency is rising in many urban areas. Some people claim that parents should be held legally responsible for crimes committed by their underage children. To what extent do you agree or disagree?',
  },

  // 6. 传统文化 · Culture & Tradition (4 prompts)
  {
    id: 't2-cul-1',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'Several languages are dying out every year. Some people do not think this is important because life will be easier if there are fewer languages in the world. To what extent do you agree or disagree?',
  },
  {
    id: 't2-cul-2',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'In many rapidly modernizing cities, historic buildings are being demolished to make way for contemporary skyscrapers and commercial centers. How important is it to preserve historic architecture, and how can preservation be balanced with urban development?',
  },
  {
    id: 't2-cul-3',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'International tourism has become one of the largest industries in the world. Unfortunately, it often creates tension between visitors and local residents rather than fostering cross-cultural understanding. What are the reasons for this, and how can it be resolved?',
  },
  {
    id: 't2-cul-4',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'As global media and multinational brands become ubiquitous, young people across different countries are adopting similar lifestyles and consumer habits. Do you think the advantages of cultural globalization outweigh the loss of local traditions?',
  },

  // Task 1 Prompts (Academic Charts / Process / Maps)
  {
    id: 't1-chart-1',
    taskType: 'task1',
    topicTag: '动态折线图 · Line Graph',
    prompt:
      'The line graph shows the percentage of electricity generated from renewable sources in four countries (Germany, Sweden, the UK, and Australia) between 1990 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  },
  {
    id: 't1-chart-2',
    taskType: 'task1',
    topicTag: '静态柱状图 · Bar Chart',
    prompt:
      'The bar chart illustrates the proportion of household income spent on five categories (housing, food, transport, healthcare, and leisure) across three income groups in 2024. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  },
  {
    id: 't1-chart-3',
    taskType: 'task1',
    topicTag: '流程图 · Process Diagram',
    prompt:
      'The diagram illustrates the process by which plastic bottles are collected, sorted, and recycled into new consumer products and clothing fibers. Summarise the information by selecting and reporting the main stages.',
  },
  {
    id: 't1-chart-4',
    taskType: 'task1',
    topicTag: '地图变迁 · Map Comparison',
    prompt:
      'The two maps show the layout of a coastal town called Seaville in 1995 and how it was redeveloped into a modern tourist resort by 2025. Summarise the information by selecting and reporting the main changes.',
  },
];
