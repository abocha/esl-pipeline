# S3 Cheatsheet (with `.env`)

> We keep AWS creds and bucket info in `.env`, and load it into the shell before using `aws`.
> Bucket: `esl-notion-tts` (region `ap-southeast-1`). Prefix convention: `audio/assignments/`.

## 0) Load `.env` (per shell session)

```bash
# from repo root
set -a
source .env
set +a

# sanity check
echo "$AWS_REGION" "$S3_BUCKET" "$S3_PREFIX"
aws --version
```

`.env` example:

```bash
AWS_REGION=ap-southeast-1
S3_BUCKET=esl-notion-tts
S3_PREFIX=audio/assignments

AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
# optional if using temporary credentials:
AWS_SESSION_TOKEN=
```

---

## 1) Upload

### Upload one file

```bash
aws s3 cp ./out/anna/2025-10-21_study-text.mp3 \
  "s3://$S3_BUCKET/$S3_PREFIX/anna/2025-10-21_study-text.mp3" \
  --content-type audio/mpeg
```

### Upload a whole folder (mirror structure)

```bash
aws s3 cp ./out/anna "s3://$S3_BUCKET/$S3_PREFIX/anna" \
  --recursive
```

### Keep destination in sync (add/update/delete)

```bash
aws s3 sync ./out/anna "s3://$S3_BUCKET/$S3_PREFIX/anna"
```

> If you configured public read on the prefix, the public URL format is:
> `https://$S3_BUCKET.s3.$AWS_REGION.amazonaws.com/$S3_PREFIX/anna/2025-10-21_study-text.mp3`

---

## 2) Download

### One file

```bash
aws s3 cp \
  "s3://$S3_BUCKET/$S3_PREFIX/anna/2025-10-21_study-text.mp3" \
  ./downloads/anna-2025-10-21.mp3
```

### Whole prefix/folder

```bash
aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/anna" ./downloads/anna \
  --recursive
```

---

## 3) List & inspect

```bash
# list objects under a prefix
aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/anna/"

# list the whole bucket (may be long)
aws s3 ls "s3://$S3_BUCKET" --recursive

# head object (metadata)
aws s3api head-object \
  --bucket "$S3_BUCKET" \
  --key "$S3_PREFIX/anna/2025-10-21_study-text.mp3"
```

---

## 4) Private bucket? Make a time-limited link

If the bucket is private (recommended), generate a **pre-signed URL**:

```bash
aws s3 presign \
  "s3://$S3_BUCKET/$S3_PREFIX/anna/2025-10-21_study-text.mp3" \
  --expires-in 604800   # 7 days
```

Paste that URL into Notion’s audio block.

---

## 5) Public reads (optional)

If you’ve allowed public GET on `audio/assignments/*`, the permanent URL is:

```
https://$S3_BUCKET.s3.$AWS_REGION.amazonaws.com/$S3_PREFIX/anna/2025-10-21_study-text.mp3
```

> **Never** expose your keys. Public access is controlled by the bucket policy; keep it limited to the specific prefix you need.

---

## 6) Common flags & tips

* `--content-type audio/mpeg` — set correct MIME for MP3s.
* `--exclude` / `--include` — when syncing subsets:

  ```bash
  aws s3 sync ./out "s3://$S3_BUCKET/$S3_PREFIX" --exclude "*" --include "*.mp3"
  ```

* If you prefer AWS profiles (instead of `.env`), run `aws configure --profile esl` once, then:

  ```bash
  AWS_PROFILE=esl aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/"
  ```

* In WSL, open a link in Windows browser:

  ```bash
  wslview "https://$S3_BUCKET.s3.$AWS_REGION.amazonaws.com/$S3_PREFIX/..."
  ```

---

## 7) Quick smoke test

```bash
echo "hello" > /tmp/hello.txt
aws s3 cp /tmp/hello.txt "s3://$S3_BUCKET/$S3_PREFIX/test/hello.txt"
aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/test/"
```

If you see `hello.txt` listed, you’re good.
