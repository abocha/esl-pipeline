# Batch Backend Deployment Guide

This document covers production deployment of the batch backend system.

---

## Infrastructure Requirements

| Component | Purpose | Minimum Spec |
|-----------|---------|--------------|
| **PostgreSQL** | Job metadata storage | 13+, 1GB RAM |
| **Redis** | BullMQ queue, SSE pub/sub | 6+, 512MB RAM |
| **Node.js** | Runtime | 24.10+ |
| **ffmpeg** | Audio processing | Latest stable |

---

## Docker Deployment (Recommended)

### Development

```bash
docker-compose up -d
```

This starts:
- `postgres` - database
- `redis` - queue/cache
- `batch-backend` - API + worker
- `batch-frontend` - web UI

### Production

```bash
docker-compose -f docker-compose.prod.yml up -d
```

Production differences:
- No hot-reload
- Production log levels
- Healthchecks enabled

---

## Environment Configuration

Copy and configure:
```bash
cp .env.batch-backend.example .env.batch-backend
```

### Required Variables

```bash
# Database
PG_HOST=postgres
PG_PORT=5432
PG_USER=esl
PG_PASSWORD=<strong-password>
PG_DATABASE=esl_batch

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# External Services
NOTION_TOKEN=<your-token>
ELEVENLABS_API_KEY=<your-key>

# AWS (for S3 uploads)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
S3_BUCKET=<bucket-name>
```

### Optional Variables

```bash
# API Configuration
BATCH_BACKEND_HTTP_PORT=8080
BATCH_BACKEND_ENABLE_EXTENDED_API=true

# Worker Tuning
WORKER_CONCURRENCY=5
MAX_CONCURRENT_FFMPEG=3

# Manifest Storage (S3 instead of filesystem)
ESL_PIPELINE_MANIFEST_STORE=s3
ESL_PIPELINE_MANIFEST_BUCKET=<bucket>
```

See [`docs/reference/env.md`](../reference/env.md) for complete list.

---

## Database Setup

The backend auto-creates tables on startup. To manually initialize:

```sql
-- Run in PostgreSQL
CREATE DATABASE esl_batch;

-- Tables are created automatically by batch-backend
-- Schema defined in packages/batch-backend/src/infrastructure/db.ts
```

---

## Scaling

### Horizontal Scaling

- **API instances**: Run multiple behind a load balancer
- **Workers**: Run multiple worker processes
- **Redis**: Shared across all instances for queue coordination
- **PostgreSQL**: Single instance sufficient for most workloads

### Worker Configuration

```bash
# Limit concurrent jobs per worker
WORKER_CONCURRENCY=5

# Limit FFmpeg processes (ElevenLabs tier dependent)
MAX_CONCURRENT_FFMPEG=3
```

---

## Monitoring

### Logs

Structured JSON logs via Pino:
```bash
LOG_LEVEL=info  # trace|debug|info|warn|error|fatal
```

### Health Checks

```bash
curl http://localhost:8080/health
# Returns: { "status": "ok" }
```

### Metrics

The backend exposes a metrics interface for:
- Job processing times
- Queue depths
- SSE connection counts

(Prometheus/statsd integration is optional)

---

## Troubleshooting

### Redis Connection Failed

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
**Fix**: Ensure Redis is running and `REDIS_HOST` is correct.

### PostgreSQL Connection Failed

```
Error: FATAL: password authentication failed
```
**Fix**: Verify `PG_*` credentials match your database.

### FFmpeg Not Found

```
FfmpegNotFoundError: ffmpeg not found
```
**Fix**: Install ffmpeg and ensure it's on PATH or set `FFMPEG_PATH`.

### ElevenLabs Rate Limit

```
Error: 429 Too Many Requests
```
**Fix**: Reduce `MAX_CONCURRENT_FFMPEG` or upgrade your ElevenLabs tier.

---

## Security Considerations

- Run containers as non-root user
- Use strong passwords for PostgreSQL
- Enable Redis authentication in production
- Deploy behind an authenticated gateway
- Never expose the backend directly to the internet

---

## Related Documentation

- **Architecture**: [`batch-backend-ssot.md`](batch-backend-ssot.md)
- **Environment**: [`../reference/env.md`](../reference/env.md)
- **Frontend Guide**: [`BATCH_SYSTEM.md`](BATCH_SYSTEM.md)
