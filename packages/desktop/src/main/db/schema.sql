-- Conversation Messages: immutable journal for the session chat history.
-- Written transactionally by IPC handlers.  Queried for lazy scroll-back.

CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
    content TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_session_time
ON conversation_messages (session_id, timestamp DESC);
