import { Env, ClassificationResult } from './types';

const SYSTEM_PROMPT = `你是一個個人記事分類助手。根據使用者的訊息，判斷它屬於哪種類型並提取結構化資訊。

你必須回傳一個 JSON 物件，格式如下：
{
  "type": "task" | "note" | "idea" | "reminder" | "inbox",
  "title": "簡短標題（10字以內）",
  "content": "完整內容描述",
  "remind_at": "ISO 8601 格式的提醒時間，沒有則 null",
  "due_at": "ISO 8601 格式的截止時間，沒有則 null",
  "tags": ["相關標籤"],
  "confidence": 0.0到1.0的信心度
}

分類規則：
- task：需要採取行動的事項（「要做」「去買」「處理」「完成」）
- reminder：帶有時間意圖的事項（「明天提醒我」「下午三點」「週五前」「等等 7 點」「待會」「晚上 8 點」），只要訊息暗示在某個時間點要做某件事就算 reminder
- idea：靈感、想法、假設（「我覺得」「可能可以」「如果」「有個想法」）
- note：記錄、筆記、資訊（「記一下」「今天學到」「某某說」）
- inbox：無法判斷以上任何類型

只回傳 JSON，不要有其他文字。`;

export async function classify(
  env: Env,
  text: string
): Promise<ClassificationResult> {
  const now = new Date().toISOString();

  const response = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `現在時間：${now}\n\n使用者訊息：${text}`,
      },
    ],
  });

  const resp = response as Record<string, unknown>;

  let parsed: Record<string, unknown>;
  if (resp.response && typeof resp.response === 'object') {
    parsed = resp.response as Record<string, unknown>;
  } else {
    const raw = typeof resp.response === 'string'
      ? resp.response
      : (resp as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback(text);
    parsed = JSON.parse(jsonMatch[0]);
  }

  try {
    return {
      type: ['task', 'note', 'idea', 'reminder', 'inbox'].includes(String(parsed.type))
        ? (String(parsed.type) as ClassificationResult['type'])
        : 'inbox',
      title: String(parsed.title || text.slice(0, 30)),
      content: String(parsed.content || text),
      remind_at: parsed.remind_at ? String(parsed.remind_at) : null,
      due_at: parsed.due_at ? String(parsed.due_at) : null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch {
    return fallback(text);
  }
}

function fallback(text: string): ClassificationResult {
  return {
    type: 'inbox',
    title: text.slice(0, 30),
    content: text,
    remind_at: null,
    due_at: null,
    tags: [],
    confidence: 0,
  };
}
