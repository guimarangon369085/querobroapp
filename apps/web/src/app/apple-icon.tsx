import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const contentType = 'image/png';
export const size = { width: 180, height: 180 };

export default async function AppleIcon() {
  const bytes = await readFile(join(process.cwd(), 'public/querobroa-brand/icons/home-shortcut-stack-v2-180.png'));
  return new Response(bytes, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  });
}
