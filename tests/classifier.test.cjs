const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { classify } = require('../src/classifier.ts');

function fakeEnv(overrides = {}) {
  return {
    AI: {
      async run() {
        return {
          response: JSON.stringify({
            type: 'inbox',
            title: '出題',
            tags: [],
            confidence: 0,
            repeat_freq: null,
            repeat_count: null,
            ...overrides,
          }),
        };
      },
    },
  };
}

test('AI time output is ignored and the deterministic reminder time wins', async () => {
  const env = fakeEnv({
    remind_at: '2030-01-01T00:00:00.000Z',
    due_at: '2030-01-02T00:00:00.000Z',
  });

  const result = await classify(env, '13:00出題', '2026-09-19T02:00:00.000Z');

  assert.equal(result.remind_at, '2026-09-19T05:00:00.000Z');
  assert.equal(result.due_at, null);
  assert.equal(result.type, 'reminder');
  assert.equal(result.confidence, 0.8);
  assert.equal(result.time_issue, null);
});

test('deadline language produces due_at rather than remind_at', async () => {
  const env = {
    AI: {
      async run() {
        return {
          response: JSON.stringify({
            type: 'inbox',
            title: '今日下午一點之前 出題',
            tags: [],
            confidence: 0,
            repeat_freq: null,
            repeat_count: null,
          }),
        };
      },
    },
  };

  const result = await classify(env, '今日下午一點之前 出題', '2026-09-19T02:00:00.000Z');

  assert.equal(result.remind_at, null);
  assert.equal(result.due_at, '2026-09-19T05:00:00.000Z');
  assert.equal(result.type, 'task');
  assert.equal(result.confidence, 0.8);
});

test('a clear message time becomes a reminder when the model omits the time', async () => {
  const env = fakeEnv();

  const result = await classify(env, '13:00出題', '2026-09-19T02:00:00.000Z');

  assert.equal(result.remind_at, '2026-09-19T05:00:00.000Z');
  assert.equal(result.type, 'reminder');
  assert.equal(result.confidence, 0.8);
});

test('a vague time is surfaced for confirmation instead of guessed', async () => {
  const result = await classify(fakeEnv(), '晚點提醒我出題', '2026-09-19T02:00:00.000Z');

  assert.equal(result.remind_at, null);
  assert.equal(result.due_at, null);
  assert.equal(result.type, 'reminder');
  assert.equal(result.time_issue, '「晚點」沒有明確時間');
});

test('time parsing still works when the model returns malformed output', async () => {
  const env = { AI: { async run() { return { response: 'not json' }; } } };

  const result = await classify(env, '13:00出題', '2026-09-19T02:00:00.000Z');

  assert.equal(result.remind_at, '2026-09-19T05:00:00.000Z');
  assert.equal(result.type, 'reminder');
  assert.equal(result.confidence, 0.8);
});

test('time parsing still works when the model call fails', async () => {
  const env = { AI: { async run() { throw new Error('AI unavailable'); } } };

  const result = await classify(env, '半小時後提醒我', '2026-09-19T02:00:00.000Z');

  assert.equal(result.remind_at, '2026-09-19T02:30:00.000Z');
  assert.equal(result.type, 'reminder');
});

test('relative dates are anchored to the supplied message timestamp', async () => {
  const env = fakeEnv();

  const original = await classify(env, '明天中午出題', '2026-09-19T02:00:00.000Z');
  const oneDayLater = await classify(env, '明天中午出題', '2026-09-20T02:00:00.000Z');

  assert.equal(original.remind_at, '2026-09-20T04:00:00.000Z');
  assert.equal(oneDayLater.remind_at, '2026-09-21T04:00:00.000Z');
});
