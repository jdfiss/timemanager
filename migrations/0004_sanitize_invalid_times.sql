-- Legacy model output occasionally stored clock-only or malformed values such as "12:00".
-- Remove only values that cannot be valid ISO date-times; ambiguous historical timestamps are left intact.
UPDATE items
SET remind_at = NULL
WHERE remind_at IS NOT NULL
  AND (
    remind_at NOT LIKE '____-__-__T__:__:%'
    OR julianday(remind_at) IS NULL
  );

UPDATE items
SET due_at = NULL
WHERE due_at IS NOT NULL
  AND (
    due_at NOT LIKE '____-__-__T__:__:%'
    OR julianday(due_at) IS NULL
  );
