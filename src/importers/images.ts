import path from 'node:path';
import convertHeic from 'heic-convert';

export interface NormalizedImage {
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

export class ImageImportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ImageImportError';
  }
}

export function imageMime(data: Buffer): NormalizedImage['mime'] | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return undefined;
}

const heicBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

export function isHeic(data: Buffer): boolean {
  if (data.length < 12 || data.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  const declaredSize = data.readUInt32BE(0);
  const end = Math.min(data.length, declaredSize >= 12 ? declaredSize : data.length, 256);
  if (heicBrands.has(data.subarray(8, 12).toString('ascii'))) return true;
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (heicBrands.has(data.subarray(offset, offset + 4).toString('ascii'))) return true;
  }
  return false;
}

export async function normalizeImage(data: Buffer, filename: string): Promise<NormalizedImage> {
  const mime = imageMime(data);
  if (mime) return { bytes: data, mime };

  const heicExtension = /\.(?:heic|heif)$/i.test(path.extname(filename));
  if (!heicExtension && !isHeic(data)) {
    throw new ImageImportError(
      'unsupported-image-format',
      'Das Bildformat wird nicht unterstützt. Unterstützt sind PNG, JPEG, GIF, WebP und HEIC/HEIF; SVG wird aus Sicherheitsgründen nicht ausgeführt.',
    );
  }

  try {
    const converted = Buffer.from(await convertHeic({ buffer: data, format: 'JPEG', quality: 0.92 }));
    if (imageMime(converted) !== 'image/jpeg') throw new Error('Ungültige JPEG-Ausgabe.');
    return { bytes: converted, mime: 'image/jpeg' };
  } catch {
    throw new ImageImportError(
      'image-conversion-failed',
      'Das HEIC/HEIF-Bild konnte nicht in JPEG umgewandelt werden. Die Datei ist möglicherweise beschädigt oder verwendet eine nicht unterstützte HEIF-Variante.',
    );
  }
}
