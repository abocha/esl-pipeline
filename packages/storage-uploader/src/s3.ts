import { readFile } from 'node:fs/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { basename } from 'node:path';

export async function uploadToS3(
  localPath: string,
  bucket: string,
  key: string,
  options: {
    public?: boolean;
    presignExpiresIn?: number;
    region?: string;
  } = {}
): Promise<{ url: string; key: string; etag?: string; isPresigned?: boolean; expiresAt?: string }> {
  const s3Client = new S3Client({
    region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
  });

  const fileContent = await readFile(localPath);
  const contentType = localPath.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';

  const putCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
    ...(options.public ? { ACL: 'public-read' } : {}),
  });

  const result = await s3Client.send(putCommand);

  let url: string;
  let isPresigned: boolean | undefined;
  let expiresAt: string | undefined;

  if (options.presignExpiresIn) {
    const presignCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    url = await getSignedUrl(s3Client, presignCommand, {
      expiresIn: options.presignExpiresIn,
    });
    isPresigned = true;
    expiresAt = new Date(Date.now() + (options.presignExpiresIn * 1000)).toISOString();
  } else {
    url = `https://${bucket}.s3.amazonaws.com/${key}`;
    isPresigned = false;
  }

  return {
    url,
    key,
    etag: result.ETag,
    isPresigned,
    expiresAt,
  };
}