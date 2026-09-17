import { Env, Item } from './types';
import { sendMessage } from './telegram';

const TYPE_EMOJI: Record<string, string> = {
  task: '✅', goal: '🎯', idea: '💡', reminder: '🔔', inbox: '📥',
};

const SLOTS = [
  { name: 'morning', hour: 7, greeting: '🌅 早安！以下是你目前的待辦事項：' },
  { name: 'evening', hour: 22, greeting: '🌙 晚安！今日事項回顧：' },
] as const;

function getTaiwanHour(now: Date): { hour: number; dateStr: string } {
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    hour: tw.getUTCHours(),
    dateStr: tw.toISOString().slice(0, 10),
  };
}

export async function checkDigest(env: Env): Promise<void> {
  const now = new Date();
  const { hour, dateStr } = getTaiwanHour(now);

  for (const slot of SLOTS) {
    if (hour < slot.hour) continue;

    const row = await env.DB.prepare(
      `SELECT last_sent_date FROM digest_log WHERE slot = ?`
    ).bind(slot.name).first<{ last_sent_date: string }>();

    if (row?.last_sent_date === dateStr) continue;

    await sendDigest(env, slot.greeting);

    await env.DB.prepare(
      `INSERT INTO digest_log (slot, last_sent_date) VALUES (?, ?)
       ON CONFLICT(slot) DO UPDATE SET last_sent_date = ?`
    ).bind(slot.name, dateStr, dateStr).run();
  }
}

async function sendDigest(env: Env, greeting: string): Promise<void> {
  const chatId = parseInt(env.ALLOWED_USER_ID, 10);
  if (!chatId) return;

  const { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE status IN ('active', 'notified') ORDER BY type, created_at DESC`
  ).all<Item>();

  if (!results.length) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${greeting}\n\n沒有進行中的事項 🎉`);
    return;
  }

  const grouped: Record<string, Item[]> = {};
  for (const item of results) {
    (grouped[item.type] ??= []).push(item);
  }

  const typeOrder = ['goal', 'task', 'reminder', 'idea', 'inbox'];
  const sortedEntries = Object.entries(grouped).sort(
    (a, b) => typeOrder.indexOf(a[0]) - typeOrder.indexOf(b[0])
  );

  const sections = sortedEntries.map(([type, items]) => {
    const emoji = TYPE_EMOJI[type] || '📄';
    const lines = items.map(i => {
      let line = `  ${emoji} ${i.title || '(無標題)'}`;
      if (i.status === 'notified') {
        line += ' ⏳ 待你選擇（完成／延期／刪除）';
      }
      if (type === 'goal' && i.due_at) {
        const days = daysRemaining(i.due_at);
        if (days < 0) {
          line += ` ⚠️ 已逾期 ${Math.abs(days)} 天`;
        } else if (days === 0) {
          line += ` 🔥 今天到期`;
        } else {
          line += ` ⏳ 剩 ${days} 天`;
        }
      }
      return line;
    });
    return lines.join('\n');
  });

  const msg = `${greeting}\n\n${sections.join('\n\n')}\n\n共 ${results.length} 項`;
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

function daysRemaining(dueAt: string): number {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
