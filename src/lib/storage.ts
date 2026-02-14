import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";

function getS3Client() {
  const endpoint = config.storage.endpoint;
  const region = config.storage.region;
  const accessKeyId = config.storage.accessKeyId;
  const secretAccessKey = config.storage.secretAccessKey;

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
  const bucket = config.storage.bucket;
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
  const bucket = config.storage.bucket;
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
  const bucket = config.storage.bucket;
  if (!bucket) throw new Error("S3_BUCKET is not set");

  const client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: objectKey,
  });

  await client.send(command);
}

export async function buildObjectUrl(objectKey: string) {
  const bucket = config.storage.bucket;
  const publicBase = config.storage.publicBaseUrl;
  if (publicBase) return `${publicBase}/${objectKey}`;
  if (!bucket) throw new Error("S3_BUCKET is not set");
  return `https://${bucket}.s3.amazonaws.com/${objectKey}`;
}

export async function getObjectBuffer(objectKey: string) {
  const bucket = config.storage.bucket;
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
