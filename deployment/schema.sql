-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Integrations
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    UNIQUE (user_id, provider)
);

-- Emails
CREATE TABLE emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT, -- Gmail's message ID
    thread_id TEXT, -- Gmail's thread ID
    subject TEXT,
    body TEXT,
    received_time TIMESTAMPTZ NOT NULL,
    is_unread BOOLEAN DEFAULT TRUE,
    importance BOOLEAN DEFAULT FALSE,
    from_address TEXT,
    UNIQUE(user_id, message_id)
);

CREATE INDEX idx_emails_user_time ON emails(user_id, received_time DESC);
CREATE INDEX idx_emails_user_unread ON emails(user_id) WHERE is_unread = TRUE;

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT,
    sender TEXT,
    content TEXT,
    sent_time TIMESTAMPTZ NOT NULL,
    is_from_user BOOLEAN,
    conversation_id TEXT
);

CREATE INDEX idx_messages_user_time ON messages(user_id, sent_time DESC);

-- Calendar Events (hypertable)
CREATE TABLE calendar_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    google_event_id TEXT,
    title TEXT,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    location TEXT,
    attendees JSONB,
    organizer JSONB,
    status TEXT,
    html_link TEXT,
    PRIMARY KEY (start_time, id),
    UNIQUE (user_id, google_event_id, start_time)
);

SELECT create_hypertable('calendar_events', 'start_time', if_not_exists => TRUE);
CREATE INDEX idx_calendar_user_time ON calendar_events(user_id, start_time);

-- Embeddings (pgvector)
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_type TEXT,
    source_id UUID,
    content TEXT,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, source_type, source_id)
);

CREATE INDEX idx_embedding_vector ON embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Summaries
CREATE TABLE summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_type TEXT,
    source_id UUID,
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);