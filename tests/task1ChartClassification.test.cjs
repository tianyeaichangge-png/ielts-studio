// Run with: node --test tests/task1ChartClassification.test.cjs
// Uses the existing build dependency and Node's test runner; no real API calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');

function load(path, fetch = () => { throw new Error('Unexpected network request'); }) {
  const result = esbuild.buildSync({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'] });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require, fetch,
    AbortController, setTimeout, clearTimeout, console, window: global.testWindow });
  return module.exports;
}

test('text classification distinguishes mixed formats from multiple charts of the same format', () => {
  const { detectTask1ChartType } = load('src/lib/task1ChartClassification.ts');
  for (const text of ['Mix Charts', 'mixed charts', 'mix_chart', '组合图',
    'The bar chart and line graph show sales.', 'The pie chart and table show visitors.',
    'The graph and table show sales.', '柱状图与折线图']) {
    assert.equal(detectTask1ChartType(text), '组合图', text);
  }
  for (const [text, expected] of [
    ['Both pie charts show energy use.', '饼图'], ['Two bar charts show production.', '柱状图'],
    ['The line graph shows sales in a bar.', '折线图'], ['The table shows line items.', '表格'],
    ['The maps show two towns.', '地图'], ['The process shows how glass is made.', '流程图'],
    ['The chart below shows changes.', undefined], ['', undefined],
  ]) assert.equal(detectTask1ChartType(text), expected, text);
});

test('legacy category normalization supports Mix Charts and retains existing categories', () => {
  const { inferTask1ChartType } = load('src/lib/samplePrompts.ts');
  assert.equal(inferTask1ChartType('', '', 'Mix Charts'), '组合图');
  assert.equal(inferTask1ChartType('', '', 'mixed'), '组合图');
  assert.equal(inferTask1ChartType('Both pie charts show energy use.'), '饼图');
  assert.equal(inferTask1ChartType('A bar chart and a line graph'), '组合图');
  assert.equal(inferTask1ChartType('', '', '地图'), '地图');
});

test('image input is actually sent using the vision model and mapped to the canonical category', async () => {
  let body;
  const { identifyTask1ChartTypeWithAI } = load('src/lib/task1ChartClassification.ts', async (_, request) => {
    body = JSON.parse(request.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"category":"mixed"}' } }] }) };
  });
  const result = await identifyTask1ChartTypeWithAI({ prompt: '', image: 'data:image/webp;base64,dGVzdA==', apiKey: 'test-only' });
  assert.equal(result.chartType, '组合图');
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/webp;base64,dGVzdA==');
});

test('invalid, unknown and failed AI responses never silently become a line graph', async () => {
  for (const content of ['{}', '{"category":"unknown"}', '{"category":"constructor"}', 'not json']) {
    const { identifyTask1ChartTypeWithAI } = load('src/lib/task1ChartClassification.ts', async () => ({
      ok: true, json: async () => ({ choices: [{ message: { content } }] }),
    }));
    await assert.rejects(identifyTask1ChartTypeWithAI({ prompt: 'chart', apiKey: 'test-only' }));
  }
  const { identifyTask1ChartTypeWithAI } = load('src/lib/task1ChartClassification.ts', async () => ({ ok: false }));
  await assert.rejects(identifyTask1ChartTypeWithAI({ prompt: 'chart', apiKey: 'test-only' }), /识别失败/);
  await assert.rejects(identifyTask1ChartTypeWithAI({ prompt: 'chart', apiKey: '' }), /API Key/);
});

test('switching inputs can cancel an in-flight classification', async () => {
  const { identifyTask1ChartTypeWithAI } = load('src/lib/task1ChartClassification.ts', (_, request) => new Promise((_, reject) => {
    request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const controller = new AbortController();
  const pending = identifyTask1ChartTypeWithAI({ prompt: 'chart', apiKey: 'test-only', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /取消或超时/);
});

test('catalog and saved custom draft render the Mix Charts controls without real storage or API access', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const stored = {
    ielts_studio_active_tab_v1: 'writing', ielts_active_task_type: 'task1',
    ielts_draft_task1: { selectedTopicId: 'custom', viewStep: 'catalog', prompt: '', image: null, content: '', timer: 1200 },
  };
  global.testWindow = { localStorage: { getItem: key => key in stored ? JSON.stringify(stored[key]) : null } };
  try {
    const { App } = load('src/App.tsx');
    assert.match(renderToStaticMarkup(React.createElement(App)), /Mix Charts/);
    stored.ielts_draft_task1 = { ...stored.ielts_draft_task1, viewStep: 'writing',
      prompt: 'A pie chart and table show sales.', chartType: '组合图', chartTypeManuallySelected: true };
    const markup = renderToStaticMarkup(React.createElement(App));
    assert.match(markup, /aria-label="Task 1 题型"/);
    assert.match(markup, /aria-pressed="true"[^>]*>Mix Charts/);
  } finally { delete global.testWindow; }
});
