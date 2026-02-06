import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || "auto";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 configuration is missing");
  }

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function createPresignedUpload(objectKey: string, contentType: string) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not set");

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 10 });
  return { uploadUrl };
}

export async function uploadObject(
  objectKey: string,
  contentType: string,
  body: Buffer | Uint8Array
) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not set");

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
    Body: body,
  });
  await client.send(command);
}

export async function deleteObject(objectKey: string) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not set");

  const client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: objectKey,
  });

  await client.send(command);
}

export async function buildObjectUrl(objectKey: string) {
  const bucket = process.env.S3_BUCKET;
  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  if (publicBase) return `${publicBase}/${objectKey}`;
  if (!bucket) throw new Error("S3_BUCKET is not set");
  return `https://${bucket}.s3.amazonaws.com/${objectKey}`;
}

export async function getObjectBuffer(objectKey: string) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not set");

  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
  const response = await client.send(command);

  if (!response.Body) throw new Error("Empty S3 response");
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
