CREATE TABLE IF NOT EXISTS digest_log (
    slot TEXT PRIMARY KEY,
    last_sent_date TEXT NOT NULL
);
