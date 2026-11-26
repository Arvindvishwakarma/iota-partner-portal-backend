import crypto from 'crypto';
import { env } from '../config/environment';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/error.middleware';

export class CloudinaryService {
  private getConfig() {
    const cloudName = (env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = (env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = (env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET || '').trim();
    return { cloudName, apiKey, apiSecret };
  }

  /**
   * Uploads a base64 Data URL (or passes through an existing HTTP(S) URL) to Cloudinary
   * and returns the permanent HTTPS `secure_url`.
   */
  public async uploadImage(
    imageInput: string,
    folder: string,
    publicId?: string
  ): Promise<string> {
    const trimmed = (imageInput || '').trim();
    if (!trimmed) {
      throw new AppError('Image payload is empty', 400, 'EMPTY_IMAGE');
    }

    // Pass through already-hosted HTTPS/HTTP URLs
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    const { cloudName, apiKey, apiSecret } = this.getConfig();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new AppError(
        'Cloudinary credentials are not configured on the server.',
        500,
        'CLOUDINARY_NOT_CONFIGURED'
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const params: Record<string, string> = {
      folder,
      overwrite: 'true',
      timestamp
    };
    if (publicId) {
      params.public_id = publicId;
    }

    const signatureBase =
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&') + apiSecret;

    const signature = crypto.createHash('sha1').update(signatureBase).digest('hex');

    const form = new URLSearchParams();
    form.append('file', trimmed);
    form.append('api_key', apiKey);
    form.append('timestamp', timestamp);
    form.append('folder', folder);
    form.append('overwrite', 'true');
    if (publicId) {
      form.append('public_id', publicId);
    }
    form.append('signature', signature);

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });

    const data: any = await response.json();
    if (!response.ok || !data?.secure_url) {
      logger.error('[Cloudinary Upload Failed]', data?.error || data);
      throw new AppError(
        data?.error?.message || 'Failed to upload image to Cloudinary',
        502,
        'CLOUDINARY_UPLOAD_FAILED'
      );
    }

    return data.secure_url as string;
  }
}

export const cloudinaryService = new CloudinaryService();
