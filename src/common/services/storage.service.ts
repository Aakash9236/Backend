import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BadRequestError } from '../errors';
import { logger } from '../../config/logger.config';

export interface StorageUploadResult {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface IStorageService {
  uploadFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    subfolder?: string
  ): Promise<StorageUploadResult>;
  getFile(storageKey: string): Promise<{ buffer: Buffer; mimeType: string }>;
  deleteFile(storageKey: string): Promise<boolean>;
  validateFile(file: { mimetype: string; size: number }): void;
}

export class LocalStorageService implements IStorageService {
  private baseDir: string;
  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  private readonly maxSizeBytes = 5 * 1024 * 1024; // 5 MB

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.resolve(process.cwd(), 'uploads');
    this.ensureDirectoryExists(this.baseDir);
    this.ensureDirectoryExists(path.join(this.baseDir, 'documents'));
    this.ensureDirectoryExists(path.join(this.baseDir, 'profiles'));
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Validate file mime-type and size limits
   */
  public validateFile(file: { mimetype: string; size: number }): void {
    if (!file) {
      throw new BadRequestError('File must be provided.');
    }

    if (!this.allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestError(
        `Invalid file type (${file.mimetype}). Allowed types: JPG, PNG, WEBP, PDF.`
      );
    }

    if (file.size > this.maxSizeBytes) {
      throw new BadRequestError(
        `File size exceeds maximum permitted limit of ${this.maxSizeBytes / (1024 * 1024)}MB.`
      );
    }
  }

  /**
   * Generates a collision-resistant, cryptographically secure storage key
   */
  private generateStorageKey(originalName: string, subfolder: string): string {
    const rawExt = path.extname(originalName).toLowerCase();
    const safeExt = rawExt && /^\.[a-z0-9]+$/i.test(rawExt) ? rawExt : '.bin';
    const randomUuid = crypto.randomUUID();
    const timestamp = Date.now();
    const fileName = `${timestamp}_${randomUuid}${safeExt}`;
    return path.posix.join(subfolder, fileName);
  }

  /**
   * Safely resolves storage path within baseDir to prevent path traversal attacks
   */
  private resolveSafePath(storageKey: string): string {
    // Normalize path separators to prevent directory traversal
    const normalizedKey = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.resolve(this.baseDir, normalizedKey);

    // Verify target path starts with base directory
    if (!absolutePath.startsWith(this.baseDir)) {
      logger.error(`[Storage Security] Path traversal attempt detected: ${storageKey}`);
      throw new BadRequestError('Invalid or insecure storage key reference.');
    }

    return absolutePath;
  }

  /**
   * Upload file to local storage
   */
  public async uploadFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    subfolder = 'documents'
  ): Promise<StorageUploadResult> {
    this.validateFile({ mimetype: mimeType, size: fileBuffer.length });

    const storageKey = this.generateStorageKey(originalName, subfolder);
    const destinationPath = this.resolveSafePath(storageKey);
    const parentDir = path.dirname(destinationPath);

    this.ensureDirectoryExists(parentDir);

    await fs.promises.writeFile(destinationPath, fileBuffer);
    logger.info(`[Storage] File safely stored at key: ${storageKey}`);

    return {
      storageKey,
      originalName,
      mimeType,
      sizeBytes: fileBuffer.length,
    };
  }

  /**
   * Retrieve file from storage
   */
  public async getFile(storageKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const filePath = this.resolveSafePath(storageKey);

    if (!fs.existsSync(filePath)) {
      throw new BadRequestError('Requested file does not exist in storage.');
    }

    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.pdf') mimeType = 'application/pdf';

    return { buffer, mimeType };
  }

  /**
   * Delete file from storage
   */
  public async deleteFile(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(storageKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch (err) {
      logger.warn(`[Storage] Failed to delete file at key: ${storageKey}`, err);
      return false;
    }
  }
}

export const storageService = new LocalStorageService();
