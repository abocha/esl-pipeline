-- Legacy fixture representing a pre-hardening schema snapshot.
-- Intent: provide an upgrade target for migration integration tests.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recordings (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transcripts (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prompt_packages (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  transcript_id UUID NOT NULL,
  template_version TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE drafts (
  id UUID PRIMARY KEY,
  prompt_package_id UUID NOT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profile_revisions (
  id UUID PRIMARY KEY,
  profile_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE template_revisions (
  id UUID PRIMARY KEY,
  template_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE students (
  id UUID PRIMARY KEY,
  student TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (id, email, password_hash)
VALUES ('11111111-1111-4111-8111-111111111111', 'legacy@example.com', 'hash');

INSERT INTO profiles (id, label)
VALUES ('profiles/legacy.md', 'Legacy Profile');

INSERT INTO templates (id, label)
VALUES ('templates/legacy.md', 'Legacy Template');

INSERT INTO students (id, student)
VALUES ('22222222-2222-4222-8222-222222222222', 'Legacy Student');

INSERT INTO profile_revisions (id, profile_id, content, content_hash, created_at)
VALUES
  ('33333333-3333-4333-8333-333333333331', 'profiles/legacy.md', 'one', 'hash-1', NOW() - INTERVAL '2 days'),
  ('33333333-3333-4333-8333-333333333332', 'profiles/legacy.md', 'two', 'hash-2', NOW() - INTERVAL '1 day');

INSERT INTO template_revisions (id, template_id, content, content_hash, created_at)
VALUES
  ('44444444-4444-4444-8444-444444444441', 'templates/legacy.md', 'one', 'hash-a', NOW() - INTERVAL '2 days'),
  ('44444444-4444-4444-8444-444444444442', 'templates/legacy.md', 'two', 'hash-b', NOW() - INTERVAL '1 day');

INSERT INTO recordings (id, source, storage_uri, bytes, status)
VALUES ('55555555-5555-4555-8555-555555555551', 'upload', 's3://legacy/recording.opus', 1234, 'queued');

INSERT INTO transcripts (id, recording_id, storage_uri)
VALUES ('66666666-6666-4666-8666-666666666661', '55555555-5555-4555-8555-555555555551', 's3://legacy/transcript.json');

INSERT INTO prompt_packages (id, recording_id, transcript_id, template_version, storage_uri)
VALUES (
  '77777777-7777-4777-8777-777777777771',
  '55555555-5555-4555-8555-555555555551',
  '66666666-6666-4666-8666-666666666661',
  'v1',
  's3://legacy/prompt.json'
);

INSERT INTO drafts (id, prompt_package_id, storage_uri)
VALUES ('88888888-8888-4888-8888-888888888881', '77777777-7777-4777-8777-777777777771', 's3://legacy/draft.md');

INSERT INTO jobs (id, state, md, created_at, updated_at)
VALUES (
  '99999999-9999-4999-8999-999999999991',
  'queued',
  'fixtures/legacy.md',
  NOW() - INTERVAL '1 day',
  NOW() - INTERVAL '1 day'
);
