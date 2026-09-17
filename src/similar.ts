import { Env, Item, ClassificationResult } from './types';

const TYPE_EMOJI: Record<string, string> = {
  task: '✅', goal: '🎯', idea: '💡', reminder: '🔔', inbox: '📥',
};

export async function findSimilarItems(
  env: Env,
  result: ClassificationResult,
  originalText: string
): Promise<Item[]> {
  const keywords = extractKeywords(result, originalText);
  if (keywords.length === 0) return [];

  const conditions = keywords.map((_, i) => `(title LIKE ?${i + 1} OR content LIKE ?${i + 1} OR tags LIKE ?${i + 1})`);
  const where = conditions.join(' OR ');

  const query = `SELECT * FROM items WHERE status = 'active' AND (${where}) ORDER BY created_at DESC LIMIT 5`;

  const binds = keywords.map(k => `%${k}%`);
  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...binds).all<Item>();

  return results;
}

function extractKeywords(result: ClassificationResult, originalText: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  const add = (s: string) => {
    const trimmed = s.trim();
    if (trimmed.length >= 2 && !seen.has(trimmed)) {
      seen.add(trimmed);
      keywords.push(trimmed);
    }
  };

  if (result.title) add(result.title);

  for (const tag of result.tags) {
    add(tag);
  }

  const chunks = originalText.split(/[\s,，。！？!?、;；:：()（）\[\]【】]+/).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.length >= 2) add(chunk);
  }

  return keywords.slice(0, 5);
}

export function formatSimilarHint(items: Item[]): string {
  const lines = items.map(item => {
    const emoji = TYPE_EMOJI[item.type] || '📄';
    return `  ${emoji} #${item.id} ${item.title || '(無標題)'}`;
  });
  return `\n\n⚠️ *發現相似的項目：*\n${lines.join('\n')}`;
}
