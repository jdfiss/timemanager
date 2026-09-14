CREATE TABLE IF NOT EXISTS raw_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_message_id INTEGER,
    user_id INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_message_id INTEGER REFERENCES raw_messages(id),
    type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    due_at TEXT,
    remind_at TEXT,
    tags TEXT,
    confidence REAL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_type_status ON items(type, status);
CREATE INDEX IF NOT EXISTS idx_items_remind_at ON items(remind_at) WHERE remind_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_raw_messages_status ON raw_messages(processing_status);
