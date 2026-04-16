import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class FileStorageService {
  private s3Client: S3Client;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get('s3.bucket', 'erp-files');
    this.s3Client = new S3Client({
      endpoint: this.configService.get('s3.endpoint'),
      region: this.configService.get('s3.region', 'auto'),
      credentials: {
        accessKeyId: this.configService.get('s3.accessKey', ''),
        secretAccessKey: this.configService.get('s3.secretKey', ''),
      },
      forcePathStyle: true,
    });
  }

  async upload(
    tenantId: string,
    path: string,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = `${tenantId}/${path}`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
      }),
    );
    return key;
  }

  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
