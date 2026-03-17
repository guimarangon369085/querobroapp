import { randomUUID } from 'node:crypto';
import { BadGatewayException, BadRequestException, GatewayTimeoutException } from '@nestjs/common';
import { normalizePhoneNumber, roundMoney } from '@querobroapp/shared';
import type {
  DeliveryDispatchInput,
  DeliveryDispatchOutput,
  DeliveryProvider,
  DeliveryQuoteInput,
  DeliveryQuoteOutput
} from './delivery-provider.js';

type LoggiMoney = {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
};

type ParsedLineAddress = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const BRAZIL_COUNTRY_LABEL = 'Brasil';
const FIXED_PICKUP_ADDRESS_LINE1 = 'Alameda Jau, 731';
const FIXED_PICKUP_CITY = 'Sao Paulo';
const FIXED_PICKUP_STATE = 'SP';
const POSTAL_CODE_PATTERN = /\b\d{5}-?\d{3}\b/;
const COGNITO_DEFAULT_REGION = 'us-east-1';

export class LoggiProvider implements DeliveryProvider {
  private accessTokenCache: { idToken: string; expiresAt: number } | null = null;

  private toMoney(value: number) {
    return roundMoney(value);
  }

  private baseUrl() {
    return String(process.env.LOGGI_API_BASE_URL || 'https://api.loggi.com')
      .trim()
      .replace(/\/+$/, '');
  }

  private authUrl() {
    const explicit = String(process.env.LOGGI_AUTH_URL || '').trim();
    if (explicit) return explicit;
    return `${this.baseUrl()}/v2/oauth2/token`;
  }

  private requestTimeoutMs() {
    const parsed = Number.parseInt(String(process.env.LOGGI_REQUEST_TIMEOUT_MS || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 12_000;
    return parsed;
  }

  private clientId() {
    return String(process.env.LOGGI_CLIENT_ID || '').trim();
  }

  private clientSecret() {
    return String(process.env.LOGGI_CLIENT_SECRET || '').trim();
  }

  private bearerToken() {
    return String(process.env.LOGGI_BEARER_TOKEN || '').trim();
  }

  private refreshToken() {
    return String(process.env.LOGGI_REFRESH_TOKEN || '').trim();
  }

  private cognitoClientId() {
    return String(process.env.LOGGI_COGNITO_CLIENT_ID || '').trim();
  }

  private cognitoRegion() {
    return String(process.env.LOGGI_COGNITO_REGION || COGNITO_DEFAULT_REGION).trim() || COGNITO_DEFAULT_REGION;
  }

  private companyId() {
    return String(process.env.LOGGI_COMPANY_ID || '').trim();
  }

  private pickupType() {
    return String(process.env.LOGGI_PICKUP_TYPE || 'PICKUP_TYPE_SPOT').trim() || 'PICKUP_TYPE_SPOT';
  }

  private deliveryType() {
    return (
      String(process.env.LOGGI_DELIVERY_TYPE || 'DELIVERY_TYPE_CUSTOMER_DOOR').trim() ||
      'DELIVERY_TYPE_CUSTOMER_DOOR'
    );
  }

  private externalServiceId() {
    return String(process.env.LOGGI_EXTERNAL_SERVICE_ID || '').trim();
  }

  private pickupInstructions() {
    return String(process.env.LOGGI_PICKUP_INSTRUCTIONS || '').trim();
  }

  private pickupFederalTaxId() {
    return String(process.env.LOGGI_PICKUP_FEDERAL_TAX_ID || '').trim();
  }

  private defaultRecipientFederalTaxId() {
    return String(process.env.LOGGI_DEFAULT_RECIPIENT_FEDERAL_TAX_ID || '').trim();
  }

  private packageBaseWeightG() {
    return this.parsePositiveIntegerEnv(process.env.LOGGI_PACKAGE_BASE_WEIGHT_G, 1200);
  }

  private packageWeightPerItemG() {
    return this.parsePositiveIntegerEnv(process.env.LOGGI_PACKAGE_WEIGHT_PER_ITEM_G, 450);
  }

  private packageLengthCm() {
    return this.parsePositiveIntegerEnv(process.env.LOGGI_PACKAGE_LENGTH_CM, 32);
  }

  private packageWidthCm() {
    return this.parsePositiveIntegerEnv(process.env.LOGGI_PACKAGE_WIDTH_CM, 24);
  }

  private packageHeightCm() {
    return this.parsePositiveIntegerEnv(process.env.LOGGI_PACKAGE_HEIGHT_CM, 14);
  }

  private packageHeightStepCm() {
    return this.parsePositiveIntegerEnv(process.env.LOGGI_PACKAGE_HEIGHT_STEP_CM, 3);
  }

  private parsePositiveIntegerEnv(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  isConfigured() {
    return Boolean(
      this.baseUrl() &&
        this.companyId() &&
        ((this.clientId() && this.clientSecret()) ||
          this.bearerToken() ||
          (this.refreshToken() && this.cognitoClientId()))
    );
  }

  private quotationPath() {
    return `/v1/companies/${encodeURIComponent(this.companyId())}/quotations`;
  }

  private shipmentPath() {
    return `/v1/companies/${encodeURIComponent(this.companyId())}/async-shipments`;
  }

  private async buildHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await this.resolveAccessToken()}`
    };
  }

  private buildQuoteAddressPayload(params: {
    address: string;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    complement?: string | null;
  }) {
    const address = params.address.trim();
    if (!address) {
      throw new BadRequestException('Endereco de entrega obrigatorio para cotar Loggi.');
    }

    const widget: Record<string, unknown> = {
      address
    };
    const complement = String(params.complement || '').trim();
    if (complement) {
      widget.complement = complement.slice(0, 256);
    }
    const placeId = String(params.placeId || '').trim();
    if (placeId) {
      widget.placesApiInfo = {
        placeId,
        sessionId: randomUUID()
      };
    }
    if (Number.isFinite(params.lat) && Number.isFinite(params.lng)) {
      widget.userContext = {
        position: {
          latitude: params.lat,
          longitude: params.lng
        }
      };
    }
    return {
      widget
    };
  }

  private buildQuotePackages(input: DeliveryQuoteInput) {
    const totalUnits = Math.max(
      input.items.reduce((sum, item) => sum + Math.max(Math.floor(item.quantity || 0), 0), 0),
      1
    );
    const weightG = Math.min(this.packageBaseWeightG() + Math.max(totalUnits - 1, 0) * this.packageWeightPerItemG(), 30_000);
    const heightCm = Math.min(this.packageHeightCm() + Math.max(totalUnits - 1, 0) * this.packageHeightStepCm(), 100);
    return [
      {
        weightG,
        lengthCm: Math.min(this.packageLengthCm(), 100),
        widthCm: Math.min(this.packageWidthCm(), 100),
        heightCm,
        goodsValue: this.toLoggiMoney(input.orderTotal)
      }
    ];
  }

  private buildQuotePayload(input: DeliveryQuoteInput) {
    const payload: Record<string, unknown> = {
      shipFrom: this.buildQuoteAddressPayload({
        address: input.pickupAddress,
        complement: this.pickupInstructions() || null
      }),
      shipTo: this.buildQuoteAddressPayload({
        address: input.dropoffAddress,
        placeId: input.dropoffPlaceId,
        lat: input.dropoffLat,
        lng: input.dropoffLng
      }),
      packages: this.buildQuotePackages(input)
    };

    const externalServiceId = this.externalServiceId();
    if (externalServiceId) {
      payload.externalServiceIds = [externalServiceId];
    } else {
      payload.pickupTypes = [this.pickupType()];
    }

    return payload;
  }

  private buildShipmentPayload(input: DeliveryDispatchInput) {
    const externalServiceId = input.providerQuoteId || this.externalServiceId();
    if (!externalServiceId) {
      throw new BadRequestException(
        'LOGGI_EXTERNAL_SERVICE_ID ausente para criar o envio. Configure o servico ou recalcule o frete com um serviceId valido.'
      );
    }

    const pickupFederalTaxId = this.pickupFederalTaxId();
    if (!pickupFederalTaxId) {
      throw new BadRequestException('LOGGI_PICKUP_FEDERAL_TAX_ID ausente para criar o envio na Loggi.');
    }

    const pickupAddress = this.resolvePickupLineAddress();
    const dropoffAddress = this.parseLineAddress(input.dropoffAddress);
    if (!dropoffAddress) {
      throw new BadRequestException(
        'Endereco do destinatario incompleto para despacho Loggi. Revise rua, cidade, UF e CEP.'
      );
    }

    const recipientFederalTaxId = this.defaultRecipientFederalTaxId() || pickupFederalTaxId;
    if (!recipientFederalTaxId) {
      throw new BadRequestException(
        'Documento do destinatario ausente para criar o envio na Loggi.'
      );
    }

    const dropoffPhone = this.normalizeLoggiPhone(input.dropoffPhone);
    const pickupPhone = this.normalizeLoggiPhone(input.pickupPhone);

    return {
      pickupType: this.pickupType(),
      deliveryType: this.deliveryType(),
      externalServiceId,
      shipFrom: {
        name: input.pickupName || 'Quero Broa',
        phoneNumber: pickupPhone || undefined,
        federalTaxId: pickupFederalTaxId,
        address: {
          instructions: this.pickupInstructions() || undefined,
          lineAddress: pickupAddress
        }
      },
      shipTo: {
        name: input.dropoffName || 'Cliente',
        phoneNumber: dropoffPhone || undefined,
        federalTaxId: recipientFederalTaxId,
        address: {
          lineAddress: dropoffAddress
        }
      },
      packages: this.buildShipmentPackages(input)
    };
  }

  private resolvePickupLineAddress(): ParsedLineAddress {
    const addressLine1 =
      String(process.env.LOGGI_PICKUP_ADDRESS_LINE1 || '').trim() || FIXED_PICKUP_ADDRESS_LINE1;
    const addressLine2 = String(process.env.LOGGI_PICKUP_ADDRESS_LINE2 || '').trim();
    const city = String(process.env.LOGGI_PICKUP_CITY || '').trim() || FIXED_PICKUP_CITY;
    const state = String(process.env.LOGGI_PICKUP_STATE || '').trim().toUpperCase() || FIXED_PICKUP_STATE;
    const postalCode = String(process.env.LOGGI_PICKUP_POSTAL_CODE || '').trim();
    const country = String(process.env.LOGGI_PICKUP_COUNTRY || '').trim() || BRAZIL_COUNTRY_LABEL;
    if (!postalCode) {
      throw new BadRequestException('LOGGI_PICKUP_POSTAL_CODE ausente para criar o envio na Loggi.');
    }
    return {
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode: this.normalizePostalCode(postalCode),
      country
    };
  }

  private buildShipmentPackages(input: DeliveryDispatchInput) {
    return this.buildQuotePackages(input).map((item, index) => ({
      ...item,
      sequence: String(index + 1)
    }));
  }

  private normalizePostalCode(value: string) {
    return value.replace(/\D/g, '').slice(0, 8);
  }

  private parseLineAddress(address: string): ParsedLineAddress | null {
    const normalized = String(address || '').trim();
    if (!normalized) return null;

    const postalCodeMatch = normalized.match(POSTAL_CODE_PATTERN);
    const postalCode = postalCodeMatch ? this.normalizePostalCode(postalCodeMatch[0]) : '';
    const withoutPostal = postalCodeMatch ? normalized.replace(postalCodeMatch[0], '').replace(/\s*,\s*$/, '') : normalized;
    const withoutCountry = withoutPostal.replace(/\bBrasil\b/i, '').replace(/\s*,\s*$/, '');
    const segments = withoutCountry
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) return null;

    const cityStateSegment = [...segments].reverse().find((segment) => segment.includes(' - ')) || '';
    const cityStateMatch = cityStateSegment.match(/^(.*?)[\s-]+([A-Za-z]{2})$/);
    const city = cityStateMatch?.[1]?.trim() || '';
    const state = cityStateMatch?.[2]?.trim().toUpperCase() || '';
    if (!postalCode || !city || !state) {
      return null;
    }

    const addressSegments = segments.filter((segment) => segment !== cityStateSegment);
    const addressLine1 = addressSegments[0] || normalized.slice(0, 256);
    const addressLine2 = addressSegments.slice(1).join(', ').slice(0, 256);

    return {
      addressLine1: addressLine1.slice(0, 256),
      addressLine2,
      city: city.slice(0, 64),
      state: state.slice(0, 2),
      postalCode,
      country: BRAZIL_COUNTRY_LABEL
    };
  }

  private normalizeLoggiPhone(value?: string | null) {
    const normalized = normalizePhoneNumber(value);
    if (!normalized) return '';
    if (normalized.startsWith('55')) return normalized;
    if (normalized.length === 10 || normalized.length === 11) return `55${normalized}`;
    return normalized;
  }

  private toLoggiMoney(value: number): LoggiMoney {
    const normalized = Math.max(this.toMoney(value), 0);
    const units = Math.trunc(normalized);
    const nanos = Math.round((normalized - units) * 1_000_000_000);
    return {
      currencyCode: 'BRL',
      units,
      nanos
    };
  }

  private fromLoggiMoney(value: unknown) {
    if (!value || typeof value !== 'object') return 0;
    const money = value as LoggiMoney;
    const units = Number(money.units ?? 0);
    const nanos = Number(money.nanos ?? 0);
    if (!Number.isFinite(units) && !Number.isFinite(nanos)) return 0;
    return this.toMoney((Number.isFinite(units) ? units : 0) + (Number.isFinite(nanos) ? nanos / 1_000_000_000 : 0));
  }

  private getStringField(value: unknown, key: string) {
    if (!value || typeof value !== 'object') return '';
    const raw = (value as Record<string, unknown>)[key];
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private getArrayField(value: unknown, key: string) {
    if (!value || typeof value !== 'object') return [];
    const raw = (value as Record<string, unknown>)[key];
    return Array.isArray(raw) ? raw : [];
  }

  private selectQuotation(value: unknown) {
    const packageQuotations = this.getArrayField(value, 'packagesQuotations');
    let selected: Record<string, unknown> | null = null;
    let selectedAmount = Number.POSITIVE_INFINITY;

    for (const packageQuotation of packageQuotations) {
      const quotations = this.getArrayField(packageQuotation, 'quotations');
      for (const quotation of quotations) {
        if (!quotation || typeof quotation !== 'object') continue;
        const amount = this.fromLoggiMoney((quotation as Record<string, unknown>).price && typeof (quotation as Record<string, unknown>).price === 'object'
          ? ((quotation as Record<string, unknown>).price as Record<string, unknown>).totalAmount
          : null);
        if (amount <= 0) continue;
        if (!selected || amount < selectedAmount) {
          selected = quotation as Record<string, unknown>;
          selectedAmount = amount;
        }
      }
    }

    return selected;
  }

  private resolveQuoteExpiry(value: unknown) {
    const quotation = this.selectQuotation(value);
    const expiresAt =
      this.getStringField(quotation, 'expiresAt') ||
      this.getStringField(quotation, 'expirationTime') ||
      this.getStringField(value, 'expiresAt');
    if (!expiresAt) return null;
    const timestamp = Date.parse(expiresAt);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  private decodeJwtExpiry(token: string) {
    const normalized = token.trim();
    if (!normalized) return null;
    const parts = normalized.split('.');
    if (parts.length < 2) return null;

    try {
      const payload = JSON.parse(Buffer.from(parts[1] || '', 'base64url').toString('utf8')) as {
        exp?: number;
      };
      const exp = Number(payload.exp ?? 0);
      if (!Number.isFinite(exp) || exp <= 0) return null;
      return exp * 1000;
    } catch {
      return null;
    }
  }

  private async resolveRefreshTokenIdToken() {
    const refreshToken = this.refreshToken();
    const clientId = this.cognitoClientId();
    if (!refreshToken || !clientId) {
      throw new BadRequestException('Credenciais Cognito da Loggi ausentes para renovar o token.');
    }

    const response = await this.fetchWithTimeout(
      `https://cognito-idp.${this.cognitoRegion()}.amazonaws.com/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
        },
        body: JSON.stringify({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken
          }
        })
      },
      'Nao foi possivel renovar o token da Loggi.'
    );
    const parsed = await this.readResponseBody(response);
    if (!response.ok) {
      throw new BadGatewayException({
        message: 'Loggi recusou a renovacao do token.',
        statusCode: response.status,
        provider: 'LOGGI',
        details: parsed
      });
    }

    const authResult =
      parsed && typeof parsed === 'object'
        ? ((parsed as Record<string, unknown>).AuthenticationResult as Record<string, unknown> | undefined)
        : undefined;
    const idToken = authResult ? this.getStringField(authResult, 'IdToken') : '';
    if (!idToken) {
      throw new BadGatewayException('A renovacao do token da Loggi nao retornou IdToken.');
    }

    const expiresIn = authResult ? Number((authResult.ExpiresIn as number | string | undefined) ?? 0) : 0;
    const fallbackExpiry = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 90 ? expiresIn - 60 : 240) * 1000;
    return {
      idToken,
      expiresAt: this.decodeJwtExpiry(idToken) ?? fallbackExpiry
    };
  }

  private async resolveAccessToken() {
    const cached = this.accessTokenCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.idToken;
    }

    const staticBearer = this.bearerToken();
    const staticBearerExpiry = staticBearer ? this.decodeJwtExpiry(staticBearer) : null;
    if (staticBearer && (!staticBearerExpiry || staticBearerExpiry > Date.now() + 60_000)) {
      this.accessTokenCache = {
        idToken: staticBearer,
        expiresAt: staticBearerExpiry ?? Date.now() + 45 * 60_000
      };
      return staticBearer;
    }

    if (this.refreshToken() && this.cognitoClientId()) {
      const refreshed = await this.resolveRefreshTokenIdToken();
      this.accessTokenCache = refreshed;
      return refreshed.idToken;
    }

    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Credenciais Loggi ausentes para autenticar a cotacao.');
    }

    const response = await this.fetchWithTimeout(
      this.authUrl(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret
        })
      },
      'Nao foi possivel autenticar com a Loggi.'
    );
    const parsed = await this.readResponseBody(response);
    if (!response.ok) {
      throw new BadGatewayException({
        message: 'Loggi recusou a autenticacao.',
        statusCode: response.status,
        provider: 'LOGGI',
        details: parsed
      });
    }

    const idToken = this.getStringField(parsed, 'idToken');
    if (!idToken) {
      throw new BadGatewayException('Loggi nao retornou idToken para a cotacao.');
    }

    const expiresIn = Number.parseInt(this.getStringField(parsed, 'expiresIn'), 10);
    const ttlSeconds = Number.isFinite(expiresIn) && expiresIn > 90 ? expiresIn - 60 : 240;
    this.accessTokenCache = {
      idToken,
      expiresAt: Date.now() + ttlSeconds * 1000
    };
    return idToken;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMessage: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs());

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(timeoutMessage);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new BadGatewayException(`${timeoutMessage} (${detail})`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const raw = await response.text();
    if (!raw) return '';

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  private async request(pathname: string, body: unknown) {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl()}${pathname}`,
      {
        method: 'POST',
        headers: await this.buildHeaders(),
        body: JSON.stringify(body)
      },
      'Nao foi possivel consultar a Loggi.'
    );
    const parsed = await this.readResponseBody(response);
    if (!response.ok) {
      if ([400, 404, 409, 422].includes(response.status)) {
        throw new BadRequestException({
          message: this.resolveBadRequestMessage(parsed),
          statusCode: response.status,
          provider: 'LOGGI',
          details: parsed
        });
      }
      throw new BadGatewayException({
        message: 'Loggi respondeu com erro.',
        statusCode: response.status,
        provider: 'LOGGI',
        details: parsed
      });
    }
    return parsed;
  }

  async quote(input: DeliveryQuoteInput): Promise<DeliveryQuoteOutput> {
    const parsed = await this.request(this.quotationPath(), this.buildQuotePayload(input));
    const quotation = this.selectQuotation(parsed);
    if (!quotation) {
      throw new BadRequestException('A Loggi nao retornou nenhuma cotacao valida para este envio.');
    }

    const price = quotation.price && typeof quotation.price === 'object' ? quotation.price : null;
    const fee = this.fromLoggiMoney(price && typeof price === 'object' ? (price as Record<string, unknown>).totalAmount : null);
    const currencyCode = this.getStringField(
      price && typeof price === 'object' ? (price as Record<string, unknown>).totalAmount : null,
      'currencyCode'
    ) || 'BRL';
    const providerQuoteId = this.getStringField(quotation, 'externalServiceId') || this.externalServiceId() || null;
    const breakdownLabel =
      this.getStringField(quotation, 'freightTypeLabel') ||
      this.getStringField(quotation, 'freightType') ||
      'Loggi';

    return {
      provider: 'LOGGI',
      fee,
      currencyCode,
      source: 'LOGGI_QUOTE',
      status: 'QUOTED',
      providerQuoteId,
      expiresAt: this.resolveQuoteExpiry(parsed),
      fallbackReason: null,
      breakdownLabel,
      rawPayload: parsed
    };
  }

  async createDelivery(input: DeliveryDispatchInput): Promise<DeliveryDispatchOutput> {
    const parsed = (await this.request(this.shipmentPath(), this.buildShipmentPayload(input))) as Record<string, unknown> | null;
    const packages = Array.isArray(parsed?.packages) ? (parsed?.packages as Array<Record<string, unknown>>) : [];
    const firstPackage = packages[0] ?? null;
    const trackingId =
      this.getStringField(firstPackage, 'trackingCode') ||
      this.getStringField(firstPackage, 'barcode') ||
      this.getStringField(firstPackage, 'loggiKey') ||
      `loggi-shipment-${input.orderId || 'unknown'}`;

    return {
      provider: 'LOGGI',
      status: 'REQUESTED',
      trackingId,
      providerDeliveryId: this.getStringField(firstPackage, 'loggiKey') || null,
      providerTrackingUrl: null,
      pickupEta: null,
      dropoffEta: null,
      lastError: null,
      rawPayload: parsed
    };
  }

  private resolveBadRequestMessage(value: unknown) {
    if (value && typeof value === 'object') {
      const detail = this.getStringField(value, 'detail');
      if (detail) return `Loggi recusou os dados da cotacao: ${detail}.`;

      const message = this.getStringField(value, 'message');
      if (message) return `Loggi recusou os dados da cotacao: ${message}.`;

      const title = this.getStringField(value, 'title');
      if (title) return `Loggi recusou os dados da cotacao: ${title}.`;

      const details = this.getArrayField(value, 'details');
      for (const entry of details) {
        if (!entry || typeof entry !== 'object') continue;
        const fieldViolations = this.getArrayField(entry, 'fieldViolations');
        const descriptions = fieldViolations
          .map((violation) =>
            violation && typeof violation === 'object'
              ? this.getStringField(violation, 'description')
              : ''
          )
          .filter(Boolean);
        if (descriptions.length > 0) {
          return `Loggi recusou os dados da cotacao: ${descriptions.join(' • ')}.`;
        }
      }
    }

    return 'Loggi recusou os dados da cotacao.';
  }
}
