import { OFFICIAL_BUSINESS_PUBLIC_PROFILE, formatCnpj } from '@querobroapp/shared';

type BusinessBankProfile = {
  bankName: string;
  bankCode: string;
  branch: string;
  accountNumber: string;
  accountHolder: string;
};

type BusinessRuntimeProfile = typeof OFFICIAL_BUSINESS_PUBLIC_PROFILE & {
  bank: BusinessBankProfile;
};

function readEnv(value: string | undefined, fallback: string) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function readBusinessRuntimeProfile(): BusinessRuntimeProfile {
  const legalName = readEnv(process.env.BUSINESS_LEGAL_NAME, OFFICIAL_BUSINESS_PUBLIC_PROFILE.legalName);
  const cnpj = readEnv(process.env.BUSINESS_CNPJ, OFFICIAL_BUSINESS_PUBLIC_PROFILE.cnpj).replace(/\D/g, '');
  const cnpjDisplay = formatCnpj(cnpj);
  const officialPhoneDigits = readEnv(
    process.env.BUSINESS_OFFICIAL_PHONE,
    OFFICIAL_BUSINESS_PUBLIC_PROFILE.officialPhoneDigits
  ).replace(/\D/g, '');
  const pixKey = readEnv(process.env.BUSINESS_PIX_KEY, OFFICIAL_BUSINESS_PUBLIC_PROFILE.pixKey);
  const city = readEnv(process.env.BUSINESS_CITY, OFFICIAL_BUSINESS_PUBLIC_PROFILE.city);
  const state = readEnv(process.env.BUSINESS_STATE, OFFICIAL_BUSINESS_PUBLIC_PROFILE.state);
  const postalCode = readEnv(process.env.BUSINESS_POSTAL_CODE, OFFICIAL_BUSINESS_PUBLIC_PROFILE.postalCode);
  const pickupAddressLine1 = readEnv(
    process.env.BUSINESS_PICKUP_ADDRESS_LINE1,
    OFFICIAL_BUSINESS_PUBLIC_PROFILE.pickupAddressLine1
  );
  const pickupAddressLine2 = readEnv(
    process.env.BUSINESS_PICKUP_ADDRESS_LINE2,
    OFFICIAL_BUSINESS_PUBLIC_PROFILE.pickupAddressLine2
  );
  const neighborhood = readEnv(
    process.env.BUSINESS_NEIGHBORHOOD,
    OFFICIAL_BUSINESS_PUBLIC_PROFILE.neighborhood
  );
  const officialPhoneDisplay =
    readEnv(process.env.BUSINESS_OFFICIAL_PHONE_DISPLAY, '') ||
    (officialPhoneDigits === OFFICIAL_BUSINESS_PUBLIC_PROFILE.officialPhoneDigits
      ? OFFICIAL_BUSINESS_PUBLIC_PROFILE.officialPhoneDisplay
      : `+${officialPhoneDigits}`);
  const officialWhatsAppUrl = `https://wa.me/${officialPhoneDigits}`;
  const pickupAddressDisplay = `${pickupAddressLine1} - ${pickupAddressLine2} - ${neighborhood} - ${city}/${state} - CEP ${postalCode}`;

  return {
    brandName: readEnv(process.env.BUSINESS_BRAND_NAME, OFFICIAL_BUSINESS_PUBLIC_PROFILE.brandName),
    legalName,
    cnpj,
    cnpjDisplay,
    officialPhoneDigits,
    officialPhoneDisplay,
    officialWhatsAppUrl,
    pixKey,
    pickupAddressLine1,
    pickupAddressLine2,
    neighborhood,
    city,
    state,
    postalCode,
    pickupAddressDisplay,
    bank: {
      bankName: readEnv(process.env.BUSINESS_BANK_NAME, 'Nu Pagamentos S.A. - Instituicao de Pagamento'),
      bankCode: readEnv(process.env.BUSINESS_BANK_CODE, '260'),
      branch: readEnv(process.env.BUSINESS_BANK_BRANCH, '0001'),
      accountNumber: readEnv(process.env.BUSINESS_BANK_ACCOUNT, '770733822-0'),
      accountHolder: readEnv(process.env.BUSINESS_BANK_ACCOUNT_HOLDER, legalName)
    }
  };
}

export type { BusinessRuntimeProfile };
