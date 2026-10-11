import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldIgnoreGroupMessage } from '../src/group-routing.ts';

const groupId = '-1001234567890';
const groupMessage = (text, entities = []) => ({
  message_id: 1,
  date: 1,
  chat: { id: Number(groupId), type: 'supergroup' },
  text,
  entities,
});

test('the configured group accepts unaddressed text', () => {
  assert.equal(shouldIgnoreGroupMessage(groupMessage('買牛奶'), groupId), false);
});

test('mentions and bot-specific commands are left for other bots', () => {
  assert.equal(shouldIgnoreGroupMessage(groupMessage('@OtherBot 查天氣', [
    { type: 'mention', offset: 0, length: 9 },
  ]), groupId), true);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('/weather@OtherBot 台北'), groupId), true);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('請 @OtherBot 查天氣'), groupId), true);
});

test('other groups are ignored while private chat remains available', () => {
  assert.equal(shouldIgnoreGroupMessage(groupMessage('買牛奶'), '-100999'), true);
  assert.equal(shouldIgnoreGroupMessage(groupMessage('買牛奶')), true);
  assert.equal(shouldIgnoreGroupMessage({
    ...groupMessage('買牛奶'), chat: { id: 123, type: 'private' },
  }), false);
});
