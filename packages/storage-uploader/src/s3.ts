import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { ConfigurationError } from '@esl-pipeline/contracts';

interface S3ErrorShape {
  Code?: string;
  message?: string;
}

function isAclNotSupported(error: unknown): boolean {
  const e = error as Partial<S3ErrorShape>;
  // SDK v3 S3 error shape is a ServiceException with a Code field in the body.
  return (
    e?.Code === 'AccessControlListNotSupported' ||
    /AccessControlListNotSupported/i.test(String(e?.message ?? ''))
  );
}

export async function uploadToS3(
  localPath: string,
  {
    bucket = process.env.S3_BUCKET!,
    region = process.env.AWS_REGION ?? 'ap-southeast-1',
    keyPrefix = process.env.S3_PREFIX ?? '',
    publicRead = false, // whether to attempt ACL
  }: {
    bucket?: string;
    region?: string;
    keyPrefix?: string;
    publicRead?: boolean;
  } = {},
): Promise<{ url: string; key: string; etag?: string }> {
  if (!bucket) throw new ConfigurationError('S3 bucket not configured');

  const s3 = new S3Client({ region });
  const fileContent = await readFile(localPath);
  const normalizedPrefix = keyPrefix
    ? keyPrefix.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '')
    : '';
  const key = normalizedPrefix ? `${normalizedPrefix}/${basename(localPath)}` : basename(localPath);
  const contentType = localPath.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';

  const base = {
    Bucket: bucket,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
    // no ACL by default
  };

  // Try with ACL if requested
  if (publicRead) {
    try {
      const put = new PutObjectCommand({ ...base, ACL: 'public-read' });
      const res = await s3.send(put);
      const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
      return { url, key, etag: res.ETag };
    } catch (error: unknown) {
      if (!isAclNotSupported(error)) throw error;
      // Fall back to no-ACL
      console.warn(
        '[S3] ACL not supported on this bucket (Object Ownership: Bucket owner enforced). Retrying without ACL…',
      );
    }
  }

  // No ACL path (recommended with ACLs disabled)
  const putNoAcl = new PutObjectCommand(base);
  const res = await s3.send(putNoAcl);
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return { url, key, etag: res.ETag };
}
