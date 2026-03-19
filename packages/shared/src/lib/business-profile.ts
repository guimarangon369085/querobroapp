import { z } from 'zod';

const OFFICIAL_PHONE_DIGITS = '5511994009584';
const OFFICIAL_CNPJ_DIGITS = '65756685000146';

function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

export function formatCnpj(value?: string | null) {
  const digits = digitsOnly(String(value || ''));
  if (digits.length !== 14) return String(value || '').trim();
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export const BusinessPublicProfileSchema = z.object({
  brandName: z.string().min(1),
  legalName: z.string().min(1),
  cnpj: z.string().regex(/^\d{14}$/),
  cnpjDisplay: z.string().min(1),
  officialPhoneDigits: z.string().regex(/^\d{12,13}$/),
  officialPhoneDisplay: z.string().min(1),
  officialWhatsAppUrl: z.string().url(),
  pixKey: z.string().min(1),
  pickupAddressLine1: z.string().min(1),
  pickupAddressLine2: z.string().min(1),
  neighborhood: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2),
  postalCode: z.string().min(1),
  pickupAddressDisplay: z.string().min(1)
});

export const OFFICIAL_BUSINESS_PUBLIC_PROFILE = BusinessPublicProfileSchema.parse({
  brandName: 'QUEROBROA',
  legalName: '65.756.685 GUILHERME MARANGON',
  cnpj: OFFICIAL_CNPJ_DIGITS,
  cnpjDisplay: formatCnpj(OFFICIAL_CNPJ_DIGITS),
  officialPhoneDigits: OFFICIAL_PHONE_DIGITS,
  officialPhoneDisplay: '+55 11 99400-9584',
  officialWhatsAppUrl: `https://wa.me/${OFFICIAL_PHONE_DIGITS}`,
  pixKey: '+5511994009584',
  pickupAddressLine1: 'Alameda Jau, 731',
  pickupAddressLine2: 'Apto 62',
  neighborhood: 'Jardim Paulista',
  city: 'Sao Paulo',
  state: 'SP',
  postalCode: '01420-001',
  pickupAddressDisplay: 'Alameda Jau, 731 - Apto 62 - Jardim Paulista - Sao Paulo/SP - CEP 01420-001'
});

export function buildOfficialBusinessWhatsAppUrl(message?: string) {
  const params = new URLSearchParams();
  if (message?.trim()) {
    params.set('text', message.trim());
  }
  const query = params.toString();
  return `${OFFICIAL_BUSINESS_PUBLIC_PROFILE.officialWhatsAppUrl}${query ? `?${query}` : ''}`;
}

export type BusinessPublicProfile = z.infer<typeof BusinessPublicProfileSchema>;
