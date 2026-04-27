import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const contentType = 'image/png';
export const size = { width: 512, height: 512 };

export default async function Icon() {
  const bytes = await readFile(join(process.cwd(), 'public/querobroa-brand/icons/home-shortcut-stack-v2-512.png'));
  return new Response(bytes, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  });
}
