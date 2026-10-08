import type { Env, ClassificationResult } from './types';
import { parseRepeatHint } from './timeparse';
import { parseTimeIntent } from './time-intent';

const SYSTEM_PROMPT = `你是一個個人記事分類助手。根據使用者的訊息，判斷它屬於哪種類型並提取結構化資訊。

你必須回傳一個 JSON 物件，格式如下：
{
  "type": "task" | "goal" | "idea" | "reminder" | "inbox",
  "title": "簡短標題（10字以內）",
  "tags": ["相關標籤"],
  "confidence": 0.0到1.0的信心度,
  "repeat_freq": "daily" | "weekly" | null，訊息裡有「每天/每日」或「每週/每星期/每禮拜」等重複意圖才填，否則 null,
  "repeat_count": 重複提醒的次數（數字），訊息說「提醒到完成/為止」或沒講次數則 null（代表無限，直到使用者標記完成）
}

分類規則：
- task：需要採取行動的短期事項（「要做」「去買」「處理」「完成」）
- goal：長期目標、願景、計劃（「目標」「希望」「計劃」「年底前要」「長期」「夢想」「打算」），通常是需要較長時間才能完成的事
- reminder：帶有時間意圖的事項（「明天提醒我」「下午三點」「週五前」「等等 7 點」「待會」「晚上 8 點」），只要訊息暗示在某個時間點要做某件事就算 reminder
- idea：靈感、想法、假設（「我覺得」「可能可以」「如果」「有個想法」）
- inbox：無法判斷以上任何類型

不要計算、猜測或回傳任何日期時間；時間會由獨立的規則解析器處理。

如果不確定分類，就設 confidence 為低值（0.3 以下），讓使用者自己選。

只回傳 JSON，不要有其他文字。`;

export async function classify(
  env: Env,
  text: string,
  nowIso = new Date().toISOString(),
): Promise<ClassificationResult> {
  let response: unknown;
  try {
    response = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `使用者訊息：${text}`,
        },
      ],
    });
  } catch {
    return fallback(text, nowIso);
  }

  const resp = response as Record<string, unknown>;

  let parsed: Record<string, unknown>;
  if (resp.response && typeof resp.response === 'object') {
    parsed = resp.response as Record<string, unknown>;
  } else {
    const raw = typeof resp.response === 'string'
      ? resp.response
      : (resp as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback(text, nowIso);
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback(text, nowIso);
    }
  }

  try {
    // 規則引擎優先於小模型自己填的重複欄位，中文的「每天/每週 + 次數」判斷比較穩定可靠。
    const repeatHint = parseRepeatHint(text);
    const repeat_freq: ClassificationResult['repeat_freq'] = repeatHint
      ? repeatHint.freq
      : ['daily', 'weekly'].includes(String(parsed.repeat_freq))
        ? (String(parsed.repeat_freq) as 'daily' | 'weekly')
        : null;
    const repeat_count = repeatHint
      ? repeatHint.count
      : typeof parsed.repeat_count === 'number'
        ? parsed.repeat_count
        : null;

    const timeIntent = parseTimeIntent(text, nowIso);
    let remind_at: string | null = null;
    let due_at: string | null = null;
    let time_issue: string | null = null;
    let type: ClassificationResult['type'] = ['task', 'goal', 'idea', 'reminder', 'inbox'].includes(String(parsed.type))
      ? (String(parsed.type) as ClassificationResult['type'])
      : 'inbox';
    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

    if (timeIntent.status === 'resolved') {
      if (timeIntent.role === 'deadline') {
        due_at = timeIntent.instant;
        if (type === 'inbox' || type === 'reminder') type = 'task';
      } else {
        remind_at = timeIntent.instant;
        type = 'reminder';
      }
      confidence = Math.max(confidence, 0.8);
    } else if (timeIntent.status === 'ambiguous') {
      time_issue = timeIntent.reason;
      type = 'reminder';
      confidence = Math.max(confidence, 0.8);
    }

    return {
      type,
      title: String(parsed.title || text.slice(0, 30)),
      content: text,
      remind_at,
      due_at,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      confidence,
      repeat_freq,
      repeat_count,
      time_issue,
    };
  } catch {
    return fallback(text, nowIso);
  }
}

function fallback(text: string, nowIso = new Date().toISOString()): ClassificationResult {
  const timeIntent = parseTimeIntent(text, nowIso);
  const repeatHint = parseRepeatHint(text);
  const result: ClassificationResult = {
    type: 'inbox',
    title: text.slice(0, 30),
    content: text,
    remind_at: null,
    due_at: null,
    tags: [],
    confidence: 0,
    repeat_freq: repeatHint?.freq ?? null,
    repeat_count: repeatHint?.count ?? null,
    time_issue: null,
  };

  if (timeIntent.status === 'resolved') {
    if (timeIntent.role === 'deadline') {
      result.type = 'task';
      result.due_at = timeIntent.instant;
    } else {
      result.type = 'reminder';
      result.remind_at = timeIntent.instant;
    }
    result.confidence = 0.8;
  } else if (timeIntent.status === 'ambiguous') {
    result.type = 'reminder';
    result.confidence = 0.8;
    result.time_issue = timeIntent.reason;
  }
  return result;
}
