import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  BuilderIntegrationsSchema,
  ReceiptOfficialItemEnum,
  type BuilderReceiptPromptPersonality,
  type BuilderReceiptStockRule,
  type BuilderSupplierPriceSource,
  type ReceiptOfficialItem
} from '@querobroapp/shared';
import { z } from 'zod';
import WebSocket, { type RawData } from 'ws';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../../prisma.service.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';

const execFileAsync = promisify(execFile);
const officialItems = [...ReceiptOfficialItemEnum.options];

const parseReceiptInputBaseSchema = z.object({
  imageBase64: z.string().trim().min(1).optional(),
  imageUrl: z.string().trim().url().optional(),
  rawText: z.string().trim().min(1).max(120_000).optional(),
  mimeType: z.string().trim().min(1).optional().default('image/jpeg'),
  providerHint: z.string().trim().min(1).max(120).optional(),
  sourceFriendly: z.string().trim().min(1).max(140).optional()
});

const parseReceiptInputSchema = parseReceiptInputBaseSchema
  .refine((data) => Boolean(data.imageBase64 || data.imageUrl || data.rawText), {
    message: 'Informe imageBase64, imageUrl ou rawText para analisar o cupom fiscal.'
  });

const ingestBatchItemSchema = parseReceiptInputBaseSchema
  .extend({
    id: z.string().trim().min(1).max(80).optional(),
    idempotencyKey: z.string().trim().min(1).max(120).optional()
  })
  .refine((data) => Boolean(data.imageBase64 || data.imageUrl || data.rawText), {
    message: 'Cada item do lote precisa de imageBase64, imageUrl ou rawText.'
  });

const ingestBatchInputSchema = z.object({
  continueOnError: z.boolean().default(true),
  items: z.array(ingestBatchItemSchema).min(1).max(25)
});

const recommendOnlineSupplierPricesSchema = z.object({
  date: z.string().trim().max(32).optional(),
  shortages: z
    .array(
      z.object({
        ingredientId: z.coerce.number().int().positive(),
        shortageQty: z.coerce.number().positive(),
        requiredQty: z.coerce.number().nonnegative().optional(),
        availableQty: z.coerce.number().nonnegative().optional(),
        name: z.string().trim().max(140).optional(),
        unit: z.string().trim().max(20).optional()
      })
    )
    .min(1)
    .max(40),
  maxSourcesPerItem: z.coerce.number().int().min(1).max(5).default(3),
  maxSearchResultsPerItem: z.coerce.number().int().min(3).max(10).default(6)
});

const parsedReceiptSchema = z.object({
  purchaseDate: z.string().trim().default(''),
  items: z
    .array(
      z.object({
        item: ReceiptOfficialItemEnum,
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().positive()
      })
    )
    .default([])
});

type ParseReceiptInput = z.output<typeof parseReceiptInputSchema>;
type IngestBatchInput = z.output<typeof ingestBatchInputSchema>;
type RecommendOnlineSupplierPricesInput = z.output<typeof recommendOnlineSupplierPricesSchema>;
type ParsedReceipt = z.output<typeof parsedReceiptSchema>;

type ChatCompletionMessage = {
  content?: string | Array<{ type?: string; text?: string }>;
  refusal?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: ChatCompletionMessage;
  }>;
};

type ResponsesOutputContent = {
  type?: string;
  text?: string;
  json?: unknown;
};

type ResponsesOutputMessage = {
  type?: string;
  content?: ResponsesOutputContent[];
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: ResponsesOutputMessage[];
  error?: {
    message?: string;
  };
};

type ParsedReceiptItem = {
  item: ReceiptOfficialItem;
  quantity: number;
  unitPrice: number;
};

type LocalItemMatchRule = {
  item: ReceiptOfficialItem;
  patterns: RegExp[];
};

type ReceiptsRuntimeConfig = {
  shortcutsEnabled: boolean;
  receiptsPrompt: string;
  receiptsPromptPersonality: BuilderReceiptPromptPersonality;
  receiptsContextHints: string;
  receiptsContextCompactionEnabled: boolean;
  receiptsContextCompactionMaxChars: number;
  receiptsModelOverride: string;
  receiptsPromptCacheEnabled: boolean;
  receiptsPromptCacheTtlMinutes: number;
  receiptsSeparator: string;
  receiptsAutoIngestEnabled: boolean;
  receiptStockRules: BuilderReceiptStockRule[];
  supplierPricesEnabled: boolean;
  supplierPriceSources: BuilderSupplierPriceSource[];
};

type ParsedReceiptRuntime = {
  purchaseDate: string;
  sourceFriendly: string;
  items: ParsedReceiptItem[];
  lines: string[];
  runtimeConfig: ReceiptsRuntimeConfig;
};

type IngestIgnoredReason =
  | 'REGRA_DESABILITADA'
  | 'REGRA_NAO_CONFIGURADA'
  | 'ITEM_ESTOQUE_NAO_ENCONTRADO'
  | 'ITEM_NAO_INGREDIENTE'
  | 'QUANTIDADE_INVALIDA';

type InventoryLookupItem = {
  id: number;
  name: string;
  category: string;
  unit: string;
  purchasePackSize: number;
  purchasePackCost?: number | null;
};

type IngestAppliedMovement = {
  movementId: number;
  officialItem: ReceiptOfficialItem;
  inventoryItemId: number;
  inventoryItemName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  sourceLabel: string;
};

type IngestIgnoredItem = {
  officialItem: ReceiptOfficialItem;
  quantity: number;
  unitPrice: number;
  reason: IngestIgnoredReason;
  detail: string;
};

type IngestSummary = {
  appliedCount: number;
  ignoredCount: number;
  appliedMovements: IngestAppliedMovement[];
  ignoredItems: IngestIgnoredItem[];
};

type ReceiptsIngestResponse = {
  purchaseDate: string;
  sourceFriendly: string;
  items: ParsedReceiptItem[];
  lineCount: number;
  lines: string[];
  clipboardText: string;
  separator: string;
  officialItems: string[];
  ingest: IngestSummary;
};

type ReceiptsIngestBatchItemResult = {
  index: number;
  id: string;
  status: 'ok' | 'error';
  appliedCount: number;
  ignoredCount: number;
  lineCount: number;
  sourceFriendly: string;
  purchaseDate: string;
  error: string;
};

type ReceiptsIngestBatchResponse = {
  processedAt: string;
  total: number;
  okCount: number;
  errorCount: number;
  results: ReceiptsIngestBatchItemResult[];
};

type SupplierPriceSyncItem = {
  sourceId: string;
  officialItem: ReceiptOfficialItem;
  inventoryItemName: string;
  supplierName: string;
  url: string;
  extractedPrice: number | null;
  applied: boolean;
  detail: string;
};

type SupplierPriceSyncResult = {
  syncedAt: string;
  appliedCount: number;
  attemptedCount: number;
  skippedCount: number;
  results: SupplierPriceSyncItem[];
};

type OnlinePriceOffer = {
  supplierName: string;
  url: string;
  title: string;
  price: number;
  estimatedTotal: number;
  neededPacks: number;
  packSize: number;
  sourceType: 'CURATED' | 'SEARCH';
  detail: string;
};

type OnlinePriceRecommendationItem = {
  ingredientId: number;
  inventoryItemId: number | null;
  name: string;
  unit: string;
  shortageQty: number;
  requiredQty: number | null;
  availableQty: number | null;
  packSize: number;
  neededPacks: number;
  query: string;
  recommendedOffer: OnlinePriceOffer | null;
  offers: OnlinePriceOffer[];
  status: 'ok' | 'no-offers' | 'item-not-found';
  detail: string;
};

type OnlinePriceRecommendationResponse = {
  generatedAt: string;
  date: string;
  itemCount: number;
  items: OnlinePriceRecommendationItem[];
};

type SearchCandidate = {
  title: string;
  url: string;
  supplierName: string;
};

type ReceiptsApiMode = 'responses' | 'responses_websocket' | 'chat_completions';

type ReceiptInferenceCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

type ExternalHostSafetyCacheEntry = {
  expiresAt: number;
  safe: boolean;
};

@Injectable()
export class ReceiptsService {
  private readonly defaultModel = process.env.OPENAI_RECEIPTS_MODEL || 'gpt-4o-mini';
  private readonly localOcrEnabled = this.resolveBooleanEnv(process.env.RECEIPTS_LOCAL_OCR_ENABLED, true);
  private readonly localOcrTimeoutMs = this.resolveLocalOcrTimeoutMs();
  private readonly localOcrMaxBufferBytes = 4 * 1024 * 1024;
  private readonly openAiBaseUrl = this.resolveOpenAiBaseUrl();
  private readonly responsesWebsocketUrl = this.resolveResponsesWebsocketUrl();
  private readonly responsesWebsocketTimeoutMs = this.resolveResponsesWebsocketTimeoutMs();
  private readonly receiptsApiMode = this.resolveReceiptsApiMode();
  private readonly fallbackToChatCompletions = this.resolveBooleanEnv(
    process.env.OPENAI_RECEIPTS_FALLBACK_TO_CHAT_COMPLETIONS,
    true
  );
  private readonly receiptsApiToken = (process.env.RECEIPTS_API_TOKEN || '').trim();
  private readonly defaultSeparator = ';';
  private readonly idempotencyScope = 'receipts-ingest-v1';
  private readonly idempotencyTtlHours = this.resolveIdempotencyTtlHours();
  private readonly onlineSearchTtlMs = 20 * 60 * 1000;
  private readonly onlinePriceTtlMs = 120 * 60 * 1000;
  private readonly externalHostSafetyTtlMs = 10 * 60 * 1000;
  private readonly onlineSearchCache = new Map<string, { expiresAt: number; results: SearchCandidate[] }>();
  private readonly onlinePriceCache = new Map<string, { expiresAt: number; price: number | null }>();
  private readonly externalHostSafetyCache = new Map<string, ExternalHostSafetyCacheEntry>();
  private readonly receiptInferenceCache = new Map<string, ReceiptInferenceCacheEntry>();
  private readonly blockedSearchDomains = [
    'duckduckgo.com',
    'google.com',
    'youtube.com',
    'youtu.be',
    'facebook.com',
    'instagram.com',
    'x.com',
    'twitter.com',
    'tiktok.com',
    'wikipedia.org',
    'linkedin.com',
    'pinterest.com'
  ];
  private readonly localItemMatchRules: LocalItemMatchRule[] = [
    {
      item: 'PAPEL MANTEIGA',
      patterns: [/\bPAPEL\s+MANT(?:EIGA)?\b/i]
    },
    {
      item: 'DOCE DE LEITE',
      patterns: [/\bDOCE\s+(?:DE\s+)?LEITE\b/i, /\bDOC(?:E)?\s+LEITE\b/i]
    },
    {
      item: 'QUEIJO DO SERRO',
      patterns: [/\bQUEIJO\b.*\bSERRO\b/i, /\bQJO\b.*\bSERRO\b/i]
    },
    {
      item: 'REQUEIJÃO DE CORTE',
      patterns: [/\bREQUEIJAO\b.*\bCORTE\b/i, /\bREQUEIJAO\b/i]
    },
    {
      item: 'FARINHA DE TRIGO',
      patterns: [/\bFARINH[AO]?\b.*\bTRIGO\b/i, /\bTRIGO\b/i]
    },
    {
      item: 'FUBÁ DE CANJICA',
      patterns: [/\bFUBA\b/i, /\bCANJICA\b/i]
    },
    {
      item: 'AÇÚCAR',
      patterns: [/\bACUCAR\b/i, /\bACUC\b/i]
    },
    {
      item: 'MANTEIGA',
      patterns: [/\bMANTEIGA\b/i, /\bMANT\b/i]
    },
    {
      item: 'LEITE',
      patterns: [/\bLEITE\b/i]
    },
    {
      item: 'OVOS',
      patterns: [/\bOVOS?\b/i]
    },
    {
      item: 'GOIABADA',
      patterns: [/\bGOIABADA\b/i, /\bGOIAB\b/i]
    },
    {
      item: 'SACOLA',
      patterns: [/\bSACOLA\b/i]
    },
    {
      item: 'CAIXA DE PLÁSTICO',
      patterns: [/\bCAIXA\b.*\bPLAST(?:ICO)?\b/i, /\bCX\b.*\bPLAST\b/i]
    }
  ];

  constructor(
    @Inject(RuntimeConfigService) private readonly runtimeConfigService: RuntimeConfigService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async parse(payload: unknown, token?: string) {
    const parsed = await this.parseReceiptPayload(payload, token);
    return this.toPublicParseResponse(parsed);
  }

  async ingest(payload: unknown, token?: string, idempotencyKey?: string): Promise<ReceiptsIngestResponse> {
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (!normalizedIdempotencyKey) {
      return this.runIngest(payload, token);
    }

    const requestHash = this.hashPayload(payload);
    const existing = await this.readIdempotencyRecord(normalizedIdempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BadRequestException(
          'Idempotency-Key reutilizada com payload diferente. Use uma nova chave para esta requisicao.'
        );
      }
      return this.parseStoredIngestResponse(existing.responseJson);
    }

    const response = await this.runIngest(payload, token);
    await this.storeIdempotencyRecord(normalizedIdempotencyKey, requestHash, response);
    return response;
  }

  async ingestBatch(payload: unknown, token?: string): Promise<ReceiptsIngestBatchResponse> {
    this.ensureReceiptsToken(token);
    const input = parseWithSchema(ingestBatchInputSchema, payload) as IngestBatchInput;
    const results: ReceiptsIngestBatchItemResult[] = [];

    for (const [index, entry] of input.items.entries()) {
      const { id, idempotencyKey, ...receiptPayload } = entry;
      const itemId = (id || `item-${index + 1}`).trim();

      try {
        const response = await this.ingest(receiptPayload, token, idempotencyKey);
        results.push({
          index,
          id: itemId,
          status: 'ok',
          appliedCount: response.ingest.appliedCount,
          ignoredCount: response.ingest.ignoredCount,
          lineCount: response.lineCount,
          sourceFriendly: response.sourceFriendly,
          purchaseDate: response.purchaseDate,
          error: ''
        });
      } catch (error) {
        results.push({
          index,
          id: itemId,
          status: 'error',
          appliedCount: 0,
          ignoredCount: 0,
          lineCount: 0,
          sourceFriendly: (entry.sourceFriendly || entry.providerHint || 'Cupom fiscal').trim(),
          purchaseDate: '',
          error: this.stringifyError(error)
        });
        if (!input.continueOnError) break;
      }
    }

    const okCount = results.filter((entry) => entry.status === 'ok').length;
    const errorCount = results.length - okCount;

    return {
      processedAt: new Date().toISOString(),
      total: results.length,
      okCount,
      errorCount,
      results
    };
  }

  async syncSupplierPrices(token?: string): Promise<SupplierPriceSyncResult> {
    this.ensureReceiptsToken(token);
    const runtimeConfig = await this.getRuntimeConfig();
    if (!runtimeConfig.supplierPricesEnabled) {
      throw new BadRequestException('Sincronizacao de preco de fornecedor esta desabilitada na configuracao interna.');
    }

    const enabledSources = runtimeConfig.supplierPriceSources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      return {
        syncedAt: new Date().toISOString(),
        appliedCount: 0,
        attemptedCount: 0,
        skippedCount: 0,
        results: []
      };
    }

    const inventoryItems = (await this.inventoryService.listItems()) as InventoryLookupItem[];
    const byNormalizedName = new Map<string, InventoryLookupItem[]>();
    for (const item of inventoryItems) {
      const key = this.normalizeLookup(item.name || '');
      if (!key) continue;
      const list = byNormalizedName.get(key) || [];
      list.push(item);
      byNormalizedName.set(key, list);
    }

    const results: SupplierPriceSyncItem[] = [];
    let appliedCount = 0;
    let skippedCount = 0;

    for (const source of enabledSources) {
      const normalizedLookup = this.normalizeLookup(source.inventoryItemName);
      const candidates = byNormalizedName.get(normalizedLookup) || [];
      const inventoryItem = candidates[0];
      if (!inventoryItem) {
        skippedCount += 1;
        results.push({
          sourceId: source.id,
          officialItem: source.officialItem,
          inventoryItemName: source.inventoryItemName,
          supplierName: source.supplierName,
          url: source.url,
          extractedPrice: null,
          applied: false,
          detail: `Item "${source.inventoryItemName}" nao encontrado no estoque.`
        });
        continue;
      }

      const extractedPrice = await this.extractSupplierPrice(source);
      const price = extractedPrice ?? source.fallbackPrice ?? null;
      if (price === null || !Number.isFinite(price) || price <= 0) {
        skippedCount += 1;
        results.push({
          sourceId: source.id,
          officialItem: source.officialItem,
          inventoryItemName: source.inventoryItemName,
          supplierName: source.supplierName,
          url: source.url,
          extractedPrice: null,
          applied: false,
          detail: 'Nao foi possivel extrair preco valido da fonte.'
        });
        continue;
      }

      const normalizedPrice = this.normalizeMoney(price);
      const shouldApply = source.applyToInventoryCost !== false;
      if (shouldApply) {
        await this.inventoryService.updateItem(inventoryItem.id, {
          purchasePackCost: normalizedPrice
        });
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }

      results.push({
        sourceId: source.id,
        officialItem: source.officialItem,
        inventoryItemName: source.inventoryItemName,
        supplierName: source.supplierName,
        url: source.url,
        extractedPrice: normalizedPrice,
        applied: shouldApply,
        detail:
          extractedPrice === null
            ? 'Preco aplicado via fallback configurado.'
            : 'Preco extraido e aplicado com sucesso.'
      });
    }

    return {
      syncedAt: new Date().toISOString(),
      appliedCount,
      attemptedCount: enabledSources.length,
      skippedCount,
      results
    };
  }

  async recommendOnlineSupplierPrices(
    payload: unknown,
    token?: string
  ): Promise<OnlinePriceRecommendationResponse> {
    this.ensureReceiptsToken(token);
    const input = parseWithSchema(recommendOnlineSupplierPricesSchema, payload) as RecommendOnlineSupplierPricesInput;
    const runtimeConfig = await this.getRuntimeConfig();
    const inventoryItems = (await this.inventoryService.listItems()) as InventoryLookupItem[];

    const inventoryById = new Map<number, InventoryLookupItem>();
    const inventoryByLookup = new Map<string, InventoryLookupItem[]>();
    for (const item of inventoryItems) {
      inventoryById.set(item.id, item);
      const key = this.normalizeLookup(item.name || '');
      if (!key) continue;
      const list = inventoryByLookup.get(key) || [];
      list.push(item);
      inventoryByLookup.set(key, list);
    }

    const enabledSources = runtimeConfig.supplierPriceSources.filter((source) => source.enabled);
    const items: OnlinePriceRecommendationItem[] = [];

    for (const shortage of input.shortages) {
      const fallbackName = (shortage.name || '').trim();
      const inventoryFromId = inventoryById.get(shortage.ingredientId);
      const inventoryFromName = fallbackName
        ? (inventoryByLookup.get(this.normalizeLookup(fallbackName)) || [])[0]
        : undefined;
      const inventoryItem = inventoryFromId || inventoryFromName;

      const name = (fallbackName || inventoryItem?.name || `Item ${shortage.ingredientId}`).trim();
      const unit = (shortage.unit || inventoryItem?.unit || '').trim();
      const shortageQty = this.normalizeQuantity(shortage.shortageQty);
      const requiredQty =
        shortage.requiredQty == null ? null : this.normalizeQuantity(Math.max(0, shortage.requiredQty));
      const availableQty =
        shortage.availableQty == null ? null : this.normalizeQuantity(Math.max(0, shortage.availableQty));
      const packSize = Math.max(0.001, this.normalizeQuantity(inventoryItem?.purchasePackSize || 1));
      const neededPacks = Math.max(1, Math.ceil(shortageQty / packSize));
      const query = this.buildOnlineSearchQuery(name, unit);

      const offers: OnlinePriceOffer[] = [];
      const seenUrlKeys = new Set<string>();
      const lookupSet = new Set<string>(
        [this.normalizeLookup(name), this.normalizeLookup(inventoryItem?.name || '')].filter(Boolean)
      );

      for (const source of enabledSources) {
        const sourceLookup = this.normalizeLookup(source.inventoryItemName);
        if (!lookupSet.has(sourceLookup)) continue;

        const extractedPrice = await this.extractSupplierPrice(source);
        const fallbackPrice =
          source.fallbackPrice == null || !Number.isFinite(source.fallbackPrice) || source.fallbackPrice <= 0
            ? null
            : this.normalizeMoney(source.fallbackPrice);
        const selectedPrice = extractedPrice ?? fallbackPrice;
        if (selectedPrice == null || selectedPrice <= 0) continue;

        const urlKey = this.normalizeUrlForCache(source.url);
        if (seenUrlKeys.has(urlKey)) continue;
        seenUrlKeys.add(urlKey);

        offers.push({
          supplierName: source.supplierName,
          url: source.url,
          title: source.inventoryItemName,
          price: this.normalizeMoney(selectedPrice),
          estimatedTotal: this.normalizeMoney(selectedPrice * neededPacks),
          neededPacks,
          packSize,
          sourceType: 'CURATED',
          detail:
            extractedPrice == null
              ? 'preco fallback da fonte cadastrada'
              : 'preco extraido de fonte cadastrada'
        });
      }

      const candidates = await this.searchOnlineProductCandidates(query, input.maxSearchResultsPerItem);
      for (const candidate of candidates) {
        const urlKey = this.normalizeUrlForCache(candidate.url);
        if (seenUrlKeys.has(urlKey)) continue;
        const price = await this.extractPriceFromUrl(candidate.url);
        if (price == null || price <= 0) continue;
        seenUrlKeys.add(urlKey);

        offers.push({
          supplierName: candidate.supplierName,
          url: candidate.url,
          title: candidate.title,
          price: this.normalizeMoney(price),
          estimatedTotal: this.normalizeMoney(price * neededPacks),
          neededPacks,
          packSize,
          sourceType: 'SEARCH',
          detail: 'preco extraido de busca online'
        });
      }

      offers.sort((a, b) => {
        if (a.estimatedTotal !== b.estimatedTotal) return a.estimatedTotal - b.estimatedTotal;
        if (a.price !== b.price) return a.price - b.price;
        return a.supplierName.localeCompare(b.supplierName, 'pt-BR');
      });

      const topOffers = offers.slice(0, input.maxSourcesPerItem);
      const recommendedOffer = topOffers[0] || null;
      const status: OnlinePriceRecommendationItem['status'] = !inventoryItem
        ? 'item-not-found'
        : topOffers.length > 0
        ? 'ok'
        : 'no-offers';

      const detail =
        status === 'ok'
          ? 'ofertas online encontradas'
          : status === 'item-not-found'
          ? 'item nao encontrado no cadastro de estoque; busca feita por nome informado'
          : 'nao foi possivel extrair preco online confiavel para este item';

      items.push({
        ingredientId: shortage.ingredientId,
        inventoryItemId: inventoryItem?.id ?? null,
        name,
        unit,
        shortageQty,
        requiredQty,
        availableQty,
        packSize,
        neededPacks,
        query,
        recommendedOffer,
        offers: topOffers,
        status,
        detail
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      date: (input.date || '').trim(),
      itemCount: items.length,
      items
    };
  }

  private async runIngest(payload: unknown, token?: string): Promise<ReceiptsIngestResponse> {
    const parsed = await this.parseReceiptPayload(payload, token);

    if (!parsed.runtimeConfig.receiptsAutoIngestEnabled) {
      throw new BadRequestException('Automacao de entrada de estoque por cupom esta desabilitada na configuracao interna.');
    }

    const ingest = await this.applyStockIngest(
      parsed.items,
      parsed.purchaseDate,
      parsed.runtimeConfig.receiptStockRules,
      parsed.sourceFriendly
    );

    return {
      ...this.toPublicParseResponse(parsed),
      ingest
    };
  }

  private async parseReceiptPayload(payload: unknown, token?: string): Promise<ParsedReceiptRuntime> {
    this.ensureReceiptsToken(token);

    const input = parseWithSchema(parseReceiptInputSchema, payload) as ParseReceiptInput;
    const runtimeConfig = await this.getRuntimeConfig();
    const sourceFriendly = (input.sourceFriendly || input.providerHint || 'Cupom fiscal').trim();

    if (!runtimeConfig.shortcutsEnabled) {
      throw new BadRequestException('Integracao de Atalhos desabilitada na configuracao interna.');
    }

    const localParsed = this.tryParseRawReceiptText(input.rawText || '', sourceFriendly, runtimeConfig);
    const ocrRawText = await this.extractRawTextFromImageInput(input);
    const localParsedFromImage = ocrRawText
      ? this.tryParseRawReceiptText(ocrRawText, sourceFriendly, runtimeConfig)
      : null;
    const mergedLocalParsed = this.mergeParsedReceiptRuntime(localParsed, localParsedFromImage);
    if (mergedLocalParsed) {
      return mergedLocalParsed;
    }

    if (ocrRawText) {
      input.rawText = [input.rawText || '', ocrRawText].filter(Boolean).join('\n');
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY nao configurada e rawText nao foi suficiente. Envie rawText com OCR do cupom ou configure OPENAI_API_KEY.'
      );
    }

    const modelOutput = await this.callVisionModel(
      input,
      apiKey,
      this.resolveReceiptsModel(runtimeConfig.receiptsModelOverride),
      runtimeConfig.receiptsPrompt,
      runtimeConfig.receiptsPromptPersonality,
      runtimeConfig.receiptsContextHints,
      runtimeConfig.receiptsContextCompactionEnabled,
      runtimeConfig.receiptsContextCompactionMaxChars,
      runtimeConfig.receiptsPromptCacheEnabled,
      runtimeConfig.receiptsPromptCacheTtlMinutes
    );
    const extracted = parseWithSchema(parsedReceiptSchema, modelOutput) as ParsedReceipt;
    const purchaseDate = this.normalizeDate(extracted.purchaseDate);
    const items = this.normalizeItems(extracted);
    const lines = items.map((item) =>
      [
        purchaseDate,
        item.item,
        this.formatQuantity(item.quantity),
        this.formatMoney(item.unitPrice)
      ].join(runtimeConfig.receiptsSeparator)
    );

    return {
      purchaseDate,
      sourceFriendly,
      items,
      lines,
      runtimeConfig
    };
  }

  private mergeParsedReceiptRuntime(
    primary: ParsedReceiptRuntime | null,
    secondary: ParsedReceiptRuntime | null
  ): ParsedReceiptRuntime | null {
    if (!primary) return secondary;
    if (!secondary) return primary;

    const grouped = new Map<string, ParsedReceiptItem>();
    const register = (item: ParsedReceiptItem) => {
      const key = `${item.item}|${item.unitPrice.toFixed(2)}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity = this.normalizeQuantity(Math.max(existing.quantity, item.quantity));
        return;
      }

      grouped.set(key, { ...item });
    };

    primary.items.forEach(register);
    secondary.items.forEach(register);

    const items = [...grouped.values()];
    const lines = items.map((item) =>
      [
        primary.purchaseDate || secondary.purchaseDate,
        item.item,
        this.formatQuantity(item.quantity),
        this.formatMoney(item.unitPrice)
      ].join(primary.runtimeConfig.receiptsSeparator)
    );

    return {
      purchaseDate: primary.purchaseDate || secondary.purchaseDate,
      sourceFriendly: primary.sourceFriendly || secondary.sourceFriendly,
      items,
      lines,
      runtimeConfig: primary.runtimeConfig
    };
  }

  private toPublicParseResponse(parsed: ParsedReceiptRuntime) {
    return {
      purchaseDate: parsed.purchaseDate,
      sourceFriendly: parsed.sourceFriendly,
      items: parsed.items,
      lineCount: parsed.lines.length,
      lines: parsed.lines,
      clipboardText: parsed.lines.join('\n'),
      separator: parsed.runtimeConfig.receiptsSeparator,
      officialItems
    };
  }

  private tryParseRawReceiptText(
    rawText: string,
    sourceFriendly: string,
    runtimeConfig: ReceiptsRuntimeConfig
  ): ParsedReceiptRuntime | null {
    const normalizedText = this.normalizeRawReceiptText(rawText);
    if (!normalizedText) return null;

    const textLines = normalizedText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (textLines.length === 0) return null;

    const purchaseDate = this.extractPurchaseDateFromRawLines(textLines);
    const grouped = new Map<string, ParsedReceiptItem>();

    for (let index = 0; index < textLines.length; index += 1) {
      const metrics = this.extractQuantityAndUnitPriceFromLine(textLines[index] || '');
      if (!metrics) continue;

      const context = [textLines[index - 2], textLines[index - 1], textLines[index], textLines[index + 1]]
        .filter(Boolean)
        .join(' ');
      const matchedItem = this.resolveOfficialItemFromTextContext(context, metrics.unitPrice);
      if (!matchedItem) continue;

      const key = `${matchedItem}|${metrics.unitPrice.toFixed(2)}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity = this.normalizeQuantity(existing.quantity + metrics.quantity);
        continue;
      }

      grouped.set(key, {
        item: matchedItem,
        quantity: this.normalizeQuantity(metrics.quantity),
        unitPrice: this.normalizeMoney(metrics.unitPrice)
      });
    }

    if (grouped.size === 0) return null;

    const items = [...grouped.values()].filter(
      (item) => !(item.item === 'SACOLA' && this.isLikelyCheckoutBagPrice(item.unitPrice))
    );
    if (items.length === 0) return null;
    const lines = items.map((item) =>
      [
        purchaseDate,
        item.item,
        this.formatQuantity(item.quantity),
        this.formatMoney(item.unitPrice)
      ].join(runtimeConfig.receiptsSeparator)
    );

    return {
      purchaseDate,
      sourceFriendly,
      items,
      lines,
      runtimeConfig
    };
  }

  private normalizeRawReceiptText(value: string) {
    return (value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async extractRawTextFromImageInput(input: ParseReceiptInput) {
    if (!this.localOcrEnabled) return '';
    if (process.platform !== 'darwin') return '';
    if (!input.imageBase64) return '';

    const startedAt = Date.now();
    const imageDataUrl = this.buildImageUrl(input);
    const dataUrlMatch = imageDataUrl.match(/^data:([^;,]+);base64,(.*)$/is);
    if (!dataUrlMatch) return '';

    const mimeType = (dataUrlMatch[1] || '').trim().toLowerCase();
    const base64Payload = this.sanitizeBase64(dataUrlMatch[2] || '');
    if (!base64Payload) return '';

    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(base64Payload, 'base64');
    } catch {
      return '';
    }
    if (!imageBuffer.length) return '';

    const extension = this.resolveImageExtensionFromMimeType(mimeType);
    const tempDir = await mkdtemp(join(tmpdir(), 'querobroapp-receipt-ocr-'));
    const imagePath = join(tempDir, `receipt.${extension}`);
    const scriptPath = join(tmpdir(), 'querobroapp-receipt-ocr.swift');

    try {
      await writeFile(imagePath, imageBuffer);
      await writeFile(scriptPath, this.getLocalVisionOcrSwiftScript(), 'utf8');

      const execution = await execFileAsync('swift', [scriptPath, imagePath], {
        timeout: this.localOcrTimeoutMs,
        encoding: 'utf8',
        maxBuffer: this.localOcrMaxBufferBytes
      });
      const output = this.normalizeRawReceiptText(execution.stdout || '');

      this.logReceiptsLocalOcr({
        ok: Boolean(output),
        durationMs: Date.now() - startedAt,
        source: 'imageBase64',
        chars: output.length,
        error: ''
      });

      return output;
    } catch (error) {
      this.logReceiptsLocalOcr({
        ok: false,
        durationMs: Date.now() - startedAt,
        source: 'imageBase64',
        chars: 0,
        error: this.stringifyError(error)
      });
      return '';
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private resolveImageExtensionFromMimeType(mimeType: string) {
    switch (mimeType) {
      case 'image/png':
        return 'png';
      case 'image/gif':
        return 'gif';
      case 'image/webp':
        return 'webp';
      case 'image/heic':
        return 'heic';
      case 'image/heif':
        return 'heif';
      case 'image/jpg':
      case 'image/jpeg':
      default:
        return 'jpg';
    }
  }

  private getLocalVisionOcrSwiftScript() {
    return `
import Foundation
import Vision
import CoreGraphics
import ImageIO

func readText(from imagePath: String) throws -> String {
  let imageUrl = URL(fileURLWithPath: imagePath)
  guard let source = CGImageSourceCreateWithURL(imageUrl as CFURL, nil),
        let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    return ""
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  if #available(macOS 13.0, *) {
    request.automaticallyDetectsLanguage = true
  }

  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  try handler.perform([request])

  let observations = request.results ?? []
  let lines = observations.compactMap { observation in
    observation.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines)
  }.filter { !$0.isEmpty }

  return lines.joined(separator: "\\n")
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write(Data("missing image path\\n".utf8))
  exit(2)
}

do {
  let text = try readText(from: args[1])
  FileHandle.standardOutput.write(Data(text.utf8))
} catch {
  FileHandle.standardError.write(Data("ocr error: \\(error.localizedDescription)\\n".utf8))
  exit(1)
}
`.trim();
  }

  private extractPurchaseDateFromRawLines(lines: string[]) {
    for (const line of lines) {
      const match = line.match(/\b(\d{2}[/-]\d{2}[/-](?:\d{2}|\d{4}))\b/);
      if (!match) continue;
      const dateRaw = match[1];
      const shortYear = dateRaw.match(/^(\d{2})[/-](\d{2})[/-](\d{2})$/);
      if (shortYear) {
        const year = Number(shortYear[3]);
        const fullYear = year >= 70 ? `19${shortYear[3]}` : `20${shortYear[3]}`;
        return this.normalizeDate(`${shortYear[1]}/${shortYear[2]}/${fullYear}`);
      }
      return this.normalizeDate(dateRaw);
    }
    return '';
  }

  private extractQuantityAndUnitPriceFromLine(line: string) {
    const compact = line.trim().toUpperCase();
    if (!compact) return null;

    const patterns = [
      /(\d+(?:[.,]\s*\d+)?)\s*(?:UN|UND|KG|G|L|LT|ML)\s*[Xx*]\s*(\d{1,5}[.,]\s*\d{2})/,
      /(\d+(?:[.,]\s*\d+)?)\s*[Xx*]\s*(\d{1,5}[.,]\s*\d{2})/
    ];

    for (const pattern of patterns) {
      const match = compact.match(pattern);
      if (!match) continue;
      const quantity = parseLocaleNumber(match[1]);
      const unitPrice = parseLocaleNumber(match[2]);
      if (!quantity || !unitPrice || quantity <= 0 || unitPrice <= 0) continue;
      return {
        quantity: this.normalizeQuantity(quantity),
        unitPrice: this.normalizeMoney(unitPrice)
      };
    }

    return null;
  }

  private resolveOfficialItemFromTextContext(text: string, unitPrice: number): ReceiptOfficialItem | null {
    const normalized = this.normalizeLookup(text || '');
    if (!normalized) return null;

    for (const rule of this.localItemMatchRules) {
      if (rule.patterns.some((pattern) => pattern.test(normalized))) {
        if (rule.item === 'SACOLA' && this.shouldIgnoreCheckoutBag(normalized, unitPrice)) {
          continue;
        }
        return rule.item;
      }
    }

    for (const officialItem of officialItems as ReceiptOfficialItem[]) {
      const officialNormalized = this.normalizeLookup(officialItem);
      if (officialNormalized && normalized.includes(officialNormalized)) {
        if (officialItem === 'SACOLA' && this.shouldIgnoreCheckoutBag(normalized, unitPrice)) {
          continue;
        }
        return officialItem;
      }
    }

    return null;
  }

  private shouldIgnoreCheckoutBag(normalizedContext: string, unitPrice: number) {
    if (!/\bSACOLA\b/.test(normalizedContext)) return false;

    // Packaging/replenishment signals that indicate the official consumable item.
    const hasPackagingSignals =
      /\b(KRAFT|EMBALAGEM|PACOTE|PCT|BOBINA|DELIVERY|IFOOD|ALCA|ALCAS|PAPEL)\b/.test(normalizedContext);
    if (hasPackagingSignals) return false;

    // Typical retail checkout shopping bag wording from supermarkets.
    const hasCheckoutSignals =
      /\b(VERDE|ECO|SUPERMERCADO|MERCADO|CHECKOUT|CHECK-OUT|CAIXA|SP)\b/.test(normalizedContext);
    if (hasCheckoutSignals) return true;

    // Fallback guard: supermarket checkout bag usually has symbolic low value.
    return this.isLikelyCheckoutBagPrice(unitPrice);
  }

  private isLikelyCheckoutBagPrice(unitPrice: number) {
    return Number.isFinite(unitPrice) && unitPrice > 0 && unitPrice <= 2;
  }

  private ensureReceiptsToken(token?: string) {
    if (!this.receiptsApiToken) return;
    if ((token || '').trim() === this.receiptsApiToken) return;
    throw new BadRequestException(
      'Token invalido para /receipts. Envie cabecalho x-receipts-token com RECEIPTS_API_TOKEN.'
    );
  }

  private async getRuntimeConfig(): Promise<ReceiptsRuntimeConfig> {
    const defaults = BuilderIntegrationsSchema.parse({});

    try {
      const config = await this.runtimeConfigService.getConfig();
      return {
        shortcutsEnabled: config.integrations.shortcutsEnabled,
        receiptsPrompt: (config.integrations.receiptsPrompt || '').trim(),
        receiptsPromptPersonality: config.integrations.receiptsPromptPersonality,
        receiptsContextHints: (config.integrations.receiptsContextHints || '').trim(),
        receiptsContextCompactionEnabled: config.integrations.receiptsContextCompactionEnabled !== false,
        receiptsContextCompactionMaxChars: this.normalizeContextCompactionMaxChars(
          config.integrations.receiptsContextCompactionMaxChars
        ),
        receiptsModelOverride: (config.integrations.receiptsModelOverride || '').trim(),
        receiptsPromptCacheEnabled: config.integrations.receiptsPromptCacheEnabled !== false,
        receiptsPromptCacheTtlMinutes: this.normalizePromptCacheTtlMinutes(
          config.integrations.receiptsPromptCacheTtlMinutes
        ),
        receiptsSeparator: this.normalizeSeparator(config.integrations.receiptsSeparator),
        receiptsAutoIngestEnabled: config.integrations.receiptsAutoIngestEnabled,
        receiptStockRules: this.normalizeStockRules(config.integrations.receiptStockRules),
        supplierPricesEnabled: config.integrations.supplierPricesEnabled,
        supplierPriceSources: this.normalizeSupplierPriceSources(config.integrations.supplierPriceSources)
      };
    } catch {
      return {
        shortcutsEnabled: defaults.shortcutsEnabled,
        receiptsPrompt: defaults.receiptsPrompt,
        receiptsPromptPersonality: defaults.receiptsPromptPersonality,
        receiptsContextHints: defaults.receiptsContextHints,
        receiptsContextCompactionEnabled: defaults.receiptsContextCompactionEnabled !== false,
        receiptsContextCompactionMaxChars: this.normalizeContextCompactionMaxChars(
          defaults.receiptsContextCompactionMaxChars
        ),
        receiptsModelOverride: defaults.receiptsModelOverride,
        receiptsPromptCacheEnabled: defaults.receiptsPromptCacheEnabled !== false,
        receiptsPromptCacheTtlMinutes: this.normalizePromptCacheTtlMinutes(
          defaults.receiptsPromptCacheTtlMinutes
        ),
        receiptsSeparator: this.normalizeSeparator(defaults.receiptsSeparator),
        receiptsAutoIngestEnabled: defaults.receiptsAutoIngestEnabled,
        receiptStockRules: this.normalizeStockRules(defaults.receiptStockRules),
        supplierPricesEnabled: defaults.supplierPricesEnabled,
        supplierPriceSources: this.normalizeSupplierPriceSources(defaults.supplierPriceSources)
      };
    }
  }

  private normalizeSeparator(value?: string) {
    const normalized = (value || '').trim();
    if (!normalized) return this.defaultSeparator;
    return normalized.slice(0, 4);
  }

  private normalizeContextCompactionMaxChars(value: number | undefined) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 300) return 1200;
    return Math.min(6000, Math.round(parsed));
  }

  private normalizePromptCacheTtlMinutes(value: number | undefined) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 90;
    return Math.min(1440, Math.round(parsed));
  }

  private normalizeStockRules(rules: BuilderReceiptStockRule[] | undefined): BuilderReceiptStockRule[] {
    const byOfficial = new Map<ReceiptOfficialItem, BuilderReceiptStockRule>();
    for (const rule of rules || []) {
      byOfficial.set(rule.officialItem, {
        officialItem: rule.officialItem,
        inventoryItemName: (rule.inventoryItemName || '').trim() || rule.officialItem,
        enabled: Boolean(rule.enabled),
        quantityMultiplier: this.normalizeMultiplier(rule.quantityMultiplier),
        quantityMode:
          (rule.quantityMode === 'BASE_UNIT' ? 'BASE_UNIT' : 'PURCHASE_PACK') as BuilderReceiptStockRule['quantityMode'],
        purchasePackCostMultiplier: this.normalizeMultiplier(rule.purchasePackCostMultiplier),
        applyPriceToInventoryCost: rule.applyPriceToInventoryCost !== false,
        sourceLabel: (rule.sourceLabel || '').trim()
      });
    }

    return officialItems.map((officialItem) => {
      const current = byOfficial.get(officialItem as ReceiptOfficialItem);
      if (current) return current;
      return {
        officialItem: officialItem as ReceiptOfficialItem,
        inventoryItemName: officialItem,
        enabled: this.defaultRuleEnabled(officialItem as ReceiptOfficialItem),
        quantityMultiplier: 1,
        quantityMode: 'PURCHASE_PACK' as BuilderReceiptStockRule['quantityMode'],
        purchasePackCostMultiplier: 1,
        applyPriceToInventoryCost: true,
        sourceLabel: 'Cupom fornecedor'
      };
    });
  }

  private normalizeSupplierPriceSources(sources: BuilderSupplierPriceSource[] | undefined) {
    const seen = new Set<string>();
    const normalized: BuilderSupplierPriceSource[] = [];

    for (const [index, source] of (sources || []).entries()) {
      const id = (source.id || '').trim() || `source-${index + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const url = this.normalizeExternalHttpUrl(source.url || '');
      if (!url) continue;

      const fallbackPrice =
        source.fallbackPrice == null || !Number.isFinite(source.fallbackPrice) || source.fallbackPrice <= 0
          ? null
          : this.normalizeMoney(source.fallbackPrice);

      normalized.push({
        id,
        officialItem: source.officialItem,
        inventoryItemName: (source.inventoryItemName || '').trim() || source.officialItem,
        supplierName: (source.supplierName || '').trim() || 'Fornecedor',
        url,
        priceXPath: (source.priceXPath || '').trim(),
        enabled: source.enabled !== false,
        fallbackPrice,
        applyToInventoryCost: source.applyToInventoryCost !== false
      });
    }

    return normalized.slice(0, 40);
  }

  private normalizeMultiplier(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.max(0.001, Math.min(100, Math.round((value + Number.EPSILON) * 1000) / 1000));
  }

  private defaultRuleEnabled(item: ReceiptOfficialItem) {
    return Boolean(item);
  }

  private async applyStockIngest(
    parsedItems: ParsedReceiptItem[],
    purchaseDate: string,
    rules: BuilderReceiptStockRule[],
    sourceFriendly: string
  ): Promise<IngestSummary> {
    const rulesByOfficial = new Map<ReceiptOfficialItem, BuilderReceiptStockRule>();
    for (const rule of rules) {
      rulesByOfficial.set(rule.officialItem, rule);
    }

    const inventoryItems = (await this.inventoryService.listItems()) as InventoryLookupItem[];
    const byNormalizedName = new Map<string, InventoryLookupItem[]>();

    for (const item of inventoryItems) {
      const key = this.normalizeLookup(item.name || '');
      if (!key) continue;
      const existing = byNormalizedName.get(key) || [];
      existing.push(item);
      byNormalizedName.set(key, existing);
    }

    const appliedMovements: IngestAppliedMovement[] = [];
    const ignoredItems: IngestIgnoredItem[] = [];

    for (const parsedItem of parsedItems) {
      const rule = rulesByOfficial.get(parsedItem.item);
      if (!rule) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'REGRA_NAO_CONFIGURADA',
          detail: 'Sem regra de mapeamento no bloco Integracoes.'
        });
        continue;
      }

      if (!rule.enabled) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'REGRA_DESABILITADA',
          detail: 'Regra desabilitada para este item no bloco Integracoes.'
        });
        continue;
      }

      const lookupName = (rule.inventoryItemName || '').trim() || parsedItem.item;
      const candidates = byNormalizedName.get(this.normalizeLookup(lookupName)) || [];
      const inventoryItem = candidates[0];

      if (!inventoryItem) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'ITEM_ESTOQUE_NAO_ENCONTRADO',
          detail: `Nao foi encontrado item de estoque chamado "${lookupName}".`
        });
        continue;
      }

      const baseQuantityFactor =
        rule.quantityMode === 'PURCHASE_PACK'
          ? Math.max(1, this.normalizeQuantity(inventoryItem.purchasePackSize || 1))
          : 1;
      const movementQuantity = this.normalizeQuantity(
        parsedItem.quantity * rule.quantityMultiplier * baseQuantityFactor
      );
      if (!Number.isFinite(movementQuantity) || movementQuantity <= 0) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'QUANTIDADE_INVALIDA',
          detail: 'Quantidade final invalida apos aplicar multiplicador.'
        });
        continue;
      }

      const sourceLabel = (sourceFriendly || rule.sourceLabel || 'Cupom fiscal').trim();
      const movementUnitCost = this.resolveMovementUnitCost(parsedItem, inventoryItem, rule);

      if (rule.applyPriceToInventoryCost) {
        const nextPackCost = this.normalizeMoney(parsedItem.unitPrice * rule.purchasePackCostMultiplier);
        await this.inventoryService.updateItem(inventoryItem.id, {
          purchasePackCost: nextPackCost
        });
      }

      const movement = (await this.inventoryService.createMovement({
        itemId: inventoryItem.id,
        type: 'IN',
        quantity: movementQuantity,
        reason: this.buildIngestReason(
          parsedItem,
          purchaseDate,
          rule,
          sourceLabel,
          movementQuantity,
          inventoryItem.unit
        ),
        source: 'CUPOM',
        sourceLabel,
        unitCost: movementUnitCost
      })) as { id: number };

      appliedMovements.push({
        movementId: movement.id,
        officialItem: parsedItem.item,
        inventoryItemId: inventoryItem.id,
        inventoryItemName: inventoryItem.name,
        quantity: movementQuantity,
        unitPrice: parsedItem.unitPrice,
        unitCost: movementUnitCost,
        sourceLabel
      });
    }

    return {
      appliedCount: appliedMovements.length,
      ignoredCount: ignoredItems.length,
      appliedMovements,
      ignoredItems
    };
  }

  private resolveMovementUnitCost(
    parsedItem: ParsedReceiptItem,
    inventoryItem: InventoryLookupItem,
    rule: BuilderReceiptStockRule
  ) {
    const normalizedPackCost = this.normalizeMoney(parsedItem.unitPrice * rule.purchasePackCostMultiplier);
    if (rule.quantityMode === 'PURCHASE_PACK' && inventoryItem.purchasePackSize > 0) {
      return this.normalizeMoney(normalizedPackCost / inventoryItem.purchasePackSize);
    }
    return normalizedPackCost;
  }

  private buildIngestReason(
    parsedItem: ParsedReceiptItem,
    purchaseDate: string,
    rule: BuilderReceiptStockRule,
    sourceLabel: string,
    movementQuantity: number,
    movementUnit: string
  ) {
    const dateLabel = purchaseDate || 'sem data';
    return [
      `Entrada automatica por cupom`,
      `Origem: ${sourceLabel}`,
      `Data: ${dateLabel}`,
      `Item: ${parsedItem.item}`,
      `Quantidade lancada: ${this.formatQuantity(movementQuantity)} ${movementUnit}`,
      `Pacotes no cupom: ${this.formatQuantity(parsedItem.quantity)}x`,
      `Valor unitario de compra: R$ ${this.formatMoney(parsedItem.unitPrice)}`,
      `Modo de quantidade: ${rule.quantityMode === 'PURCHASE_PACK' ? 'embalagem de compra' : 'unidade base'}`
    ].join(' • ');
  }

  private normalizeLookup(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private buildOnlineSearchQuery(itemName: string, unit: string) {
    const unitHint = unit ? `${unit}` : '';
    return [itemName, unitHint, 'comprar online brasil preco']
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
  }

  private normalizeUrlForCache(url: string) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        parsed.searchParams.delete(key);
      }
      return parsed.toString();
    } catch {
      return url.trim();
    }
  }

  private isSafeExternalHttpUrl(url: string) {
    return Boolean(this.normalizeExternalHttpUrl(url));
  }

  private async isDnsSafeExternalHttpUrl(url: string) {
    const normalizedUrl = this.normalizeExternalHttpUrl(url);
    if (!normalizedUrl) return false;

    let hostname = '';
    try {
      hostname = new URL(normalizedUrl).hostname.trim().toLowerCase();
    } catch {
      return false;
    }

    if (!hostname) return false;
    if (this.isUnsafeExternalHostname(hostname)) return false;

    const now = Date.now();
    const cached = this.externalHostSafetyCache.get(hostname);
    if (cached && cached.expiresAt > now) return cached.safe;

    const safe = await this.resolveExternalHostnameSafety(hostname);
    this.externalHostSafetyCache.set(hostname, {
      expiresAt: now + this.externalHostSafetyTtlMs,
      safe
    });
    return safe;
  }

  private async resolveExternalHostnameSafety(hostname: string) {
    if (isIP(hostname)) {
      return !this.isUnsafeExternalHostname(hostname);
    }

    try {
      const records = await lookup(hostname, { all: true, verbatim: true });
      if (!records.length) return false;
      for (const record of records) {
        if (this.isUnsafeExternalHostname(record.address)) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private normalizeExternalHttpUrl(rawUrl: string) {
    try {
      const parsed = new URL((rawUrl || '').trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      if (this.isUnsafeExternalHostname(parsed.hostname)) return '';
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return '';
    }
  }

  private isUnsafeExternalHostname(hostname: string) {
    const normalized = (hostname || '').trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
      return true;
    }

    const withoutBrackets = normalized.replace(/^\[/, '').replace(/\]$/, '').split('%')[0];
    const ipType = isIP(withoutBrackets);
    if (ipType === 4) return this.isPrivateIpv4(withoutBrackets);
    if (ipType === 6) return this.isPrivateIpv6(withoutBrackets);
    return false;
  }

  private isPrivateIpv4(value: string) {
    const parts = value.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }

    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  private isPrivateIpv6(value: string) {
    const normalized = (value || '').toLowerCase();
    if (!normalized) return true;
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('ff')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (isIP(mapped) === 4) {
        return this.isPrivateIpv4(mapped);
      }
    }
    return false;
  }

  private async searchOnlineProductCandidates(query: string, limit: number): Promise<SearchCandidate[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const now = Date.now();
    const cached = this.onlineSearchCache.get(normalizedQuery);
    if (cached && cached.expiresAt > now) {
      return cached.results.slice(0, limit);
    }

    this.cleanupOnlineCaches(now);

    const searchUrl = `https://duckduckgo.com/html/?kl=br-pt&q=${encodeURIComponent(query)}`;
    const html = await this.fetchPageHtml(searchUrl, 9000);
    if (!html) {
      this.onlineSearchCache.set(normalizedQuery, {
        expiresAt: now + this.onlineSearchTtlMs,
        results: []
      });
      return [];
    }

    const candidates: SearchCandidate[] = [];
    const seen = new Set<string>();
    const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="(?<href>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/gi;

    for (const match of html.matchAll(linkRegex)) {
      if (candidates.length >= limit) break;
      const rawHref = this.decodeHtmlEntities(match.groups?.href || '');
      const resolved = this.resolveSearchResultUrl(rawHref);
      if (!resolved || !/^https?:\/\//i.test(resolved)) continue;
      if (this.isBlockedSearchDomain(resolved)) continue;
      if (!this.isSafeExternalHttpUrl(resolved)) continue;
      if (!(await this.isDnsSafeExternalHttpUrl(resolved))) continue;

      const normalizedUrl = this.normalizeUrlForCache(resolved);
      if (!normalizedUrl || seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);

      const rawTitle = match.groups?.title || '';
      const title = this.decodeHtmlEntities(this.stripHtml(rawTitle)).slice(0, 200);
      candidates.push({
        title: title || this.supplierNameFromUrl(resolved),
        url: resolved,
        supplierName: this.supplierNameFromUrl(resolved)
      });
    }

    this.onlineSearchCache.set(normalizedQuery, {
      expiresAt: now + this.onlineSearchTtlMs,
      results: candidates
    });

    return candidates.slice(0, limit);
  }

  private resolveSearchResultUrl(href: string) {
    const raw = href.trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;

    if (raw.startsWith('/l/?')) {
      try {
        const url = new URL(raw, 'https://duckduckgo.com');
        const encoded = url.searchParams.get('uddg') || '';
        if (!encoded) return '';
        return decodeURIComponent(encoded);
      } catch {
        return '';
      }
    }

    return '';
  }

  private isBlockedSearchDomain(url: string) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return this.blockedSearchDomains.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
    } catch {
      return true;
    }
  }

  private supplierNameFromUrl(url: string) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      const parts = hostname.split('.').filter(Boolean);
      if (parts.length === 0) return 'Loja online';
      let base = parts[parts.length - 2] || parts[0];
      if (parts.length >= 3 && parts[parts.length - 2] === 'com') {
        base = parts[parts.length - 3] || base;
      }
      return base.charAt(0).toUpperCase() + base.slice(1);
    } catch {
      return 'Loja online';
    }
  }

  private stripHtml(value: string) {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private decodeHtmlEntities(value: string) {
    const base = value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');

    return base
      .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
  }

  private cleanupOnlineCaches(now = Date.now()) {
    for (const [key, entry] of this.onlineSearchCache.entries()) {
      if (entry.expiresAt <= now) this.onlineSearchCache.delete(key);
    }
    for (const [key, entry] of this.onlinePriceCache.entries()) {
      if (entry.expiresAt <= now) this.onlinePriceCache.delete(key);
    }
    for (const [key, entry] of this.externalHostSafetyCache.entries()) {
      if (entry.expiresAt <= now) this.externalHostSafetyCache.delete(key);
    }
  }

  private async extractPriceFromUrl(url: string) {
    const now = Date.now();
    const cacheKey = this.normalizeUrlForCache(url);
    const cached = this.onlinePriceCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.price;
    }

    this.cleanupOnlineCaches(now);
    const html = await this.fetchPageHtml(url, 9000);
    const price = html ? this.extractPriceFromHtml(html) : null;
    this.onlinePriceCache.set(cacheKey, {
      expiresAt: now + this.onlinePriceTtlMs,
      price
    });
    return price;
  }

  private async fetchPageHtml(url: string, timeoutMs = 9000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = this.normalizeExternalHttpUrl(url);
      if (!currentUrl) return '';
      if (!(await this.isDnsSafeExternalHttpUrl(currentUrl))) return '';

      for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        const response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7'
          }
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location') || '';
          if (!location) return '';
          const redirected = this.normalizeExternalHttpUrl(new URL(location, currentUrl).toString());
          if (!redirected) return '';
          if (!(await this.isDnsSafeExternalHttpUrl(redirected))) return '';
          currentUrl = redirected;
          continue;
        }

        if (!response.ok) return '';
        return await response.text();
      }

      return '';
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async extractSupplierPrice(source: BuilderSupplierPriceSource) {
    const html = await this.fetchPageHtml(source.url, 9000);
    if (!html) return null;
    return this.extractPriceFromHtml(html);
  }

  private extractPriceFromHtml(html: string) {
    const jsonLdPrice = html.match(/"price"\s*:\s*"?(?<value>\d+[.,]\d{2})"?/i)?.groups?.value;
    if (jsonLdPrice) {
      const parsed = this.parseMoneyValue(jsonLdPrice);
      if (parsed != null) return parsed;
    }

    const openGraphPrice = html.match(
      /(?:product:price:amount|price:amount)["']?\s*content=["'](?<value>\d+[.,]\d{2})["']/i
    )?.groups?.value;
    if (openGraphPrice) {
      const parsed = this.parseMoneyValue(openGraphPrice);
      if (parsed != null) return parsed;
    }

    const visibleMatches = Array.from(
      html.matchAll(/R\$\s*(?<value>\d{1,4}(?:\.\d{3})*(?:,\d{2})|\d+\.\d{2})/gi)
    );
    for (const match of visibleMatches) {
      const raw = match.groups?.value;
      if (!raw) continue;
      const parsed = this.parseMoneyValue(raw);
      if (parsed != null && parsed > 0.01) {
        return parsed;
      }
    }

    return null;
  }

  private parseMoneyValue(value: string) {
    const parsed = parseLocaleNumber(value);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null;
    return this.normalizeMoney(parsed);
  }

  private async callVisionModel(
    input: ParseReceiptInput,
    apiKey: string,
    model: string,
    customPrompt: string,
    promptPersonality: BuilderReceiptPromptPersonality,
    contextHints: string,
    contextCompactionEnabled: boolean,
    contextCompactionMaxChars: number,
    promptCacheEnabled: boolean,
    promptCacheTtlMinutes: number
  ) {
    const imageUrl = this.buildImageUrl(input);
    const prompts = this.buildPromptPack(
      input,
      customPrompt,
      promptPersonality,
      contextHints,
      contextCompactionEnabled,
      contextCompactionMaxChars
    );
    const cacheKey = this.buildReceiptInferenceCacheKey(model, imageUrl, prompts.systemPrompt, prompts.userPrompt);
    const startedAt = Date.now();
    const attempts: string[] = [];

    const completeSuccess = (result: unknown, resolvedMode: string, cacheHit: boolean) => {
      if (!cacheHit) {
        this.storeReceiptInferenceCache(cacheKey, result, promptCacheEnabled, promptCacheTtlMinutes);
      }

      this.logReceiptsAiCall({
        requestedMode: this.receiptsApiMode,
        resolvedMode,
        model,
        cacheHit,
        attempts,
        durationMs: Date.now() - startedAt,
        ok: true,
        error: ''
      });
      return result;
    };

    const cachedResult = this.readReceiptInferenceCache(cacheKey, promptCacheEnabled);
    if (cachedResult != null) {
      return completeSuccess(cachedResult, 'cache', true);
    }

    try {
      if (this.receiptsApiMode === 'chat_completions') {
        attempts.push('chat_completions');
        const result = await this.callVisionModelChatCompletions(
          model,
          imageUrl,
          apiKey,
          prompts.systemPrompt,
          prompts.userPrompt
        );
        return completeSuccess(result, 'chat_completions', false);
      }

      if (this.receiptsApiMode === 'responses_websocket') {
        let websocketError = '';
        attempts.push('responses_websocket');
        try {
          const result = await this.callVisionModelResponsesWebsocket(
            model,
            imageUrl,
            apiKey,
            prompts.systemPrompt,
            prompts.userPrompt
          );
          return completeSuccess(result, 'responses_websocket', false);
        } catch (error) {
          websocketError = this.stringifyError(error);
        }

        let responsesError = '';
        attempts.push('responses');
        try {
          const result = await this.callVisionModelResponses(
            model,
            imageUrl,
            apiKey,
            prompts.systemPrompt,
            prompts.userPrompt
          );
          return completeSuccess(result, 'responses', false);
        } catch (error) {
          responsesError = this.stringifyError(error);
          if (!this.fallbackToChatCompletions) {
            throw new BadRequestException(
              `Falha no modo responses_websocket e no fallback responses HTTP. websocket=${this.compactText(
                websocketError,
                220
              )} | responses=${this.compactText(responsesError, 220)}`
            );
          }
        }

        attempts.push('chat_completions');
        try {
          const result = await this.callVisionModelChatCompletions(
            model,
            imageUrl,
            apiKey,
            prompts.systemPrompt,
            prompts.userPrompt
          );
          return completeSuccess(result, 'chat_completions', false);
        } catch (fallbackError) {
          throw new BadRequestException(
            `Falha no modo responses_websocket e nos fallbacks HTTP. websocket=${this.compactText(
              websocketError,
              180
            )} | responses=${this.compactText(responsesError, 180)} | chat=${this.compactText(
              this.stringifyError(fallbackError),
              180
            )}`
          );
        }
      }

      let responsesError = '';
      attempts.push('responses');
      try {
        const result = await this.callVisionModelResponses(
          model,
          imageUrl,
          apiKey,
          prompts.systemPrompt,
          prompts.userPrompt
        );
        return completeSuccess(result, 'responses', false);
      } catch (error) {
        responsesError = this.stringifyError(error);
        if (!this.fallbackToChatCompletions) {
          throw error;
        }
      }

      attempts.push('chat_completions');
      try {
        const result = await this.callVisionModelChatCompletions(
          model,
          imageUrl,
          apiKey,
          prompts.systemPrompt,
          prompts.userPrompt
        );
        return completeSuccess(result, 'chat_completions', false);
      } catch (fallbackError) {
        throw new BadRequestException(
          `Falha no modo responses e no fallback chat/completions. responses=${this.compactText(
            responsesError,
            220
          )} | chat=${this.compactText(this.stringifyError(fallbackError), 220)}`
        );
      }
    } catch (error) {
      this.logReceiptsAiCall({
        requestedMode: this.receiptsApiMode,
        resolvedMode: '',
        model,
        cacheHit: false,
        attempts,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: this.stringifyError(error)
      });
      throw error;
    }
  }

  private async callVisionModelResponses(
    model: string,
    imageUrl: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ) {
    const body = {
      model,
      temperature: 0,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: systemPrompt
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: userPrompt
            },
            {
              type: 'input_image',
              image_url: imageUrl
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'receipt_extraction',
          strict: true,
          schema: this.getReceiptJsonSchema()
        }
      }
    };

    const data = (await this.callOpenAiJsonEndpoint('/responses', apiKey, body)) as ResponsesApiResponse;
    const payload = this.extractResponsesPayload(data);
    if (!payload) {
      if (data.error?.message) {
        throw new BadRequestException(`Modelo retornou erro: ${data.error.message}`);
      }
      throw new BadRequestException('Modelo nao retornou conteudo JSON parseavel.');
    }

    return this.parseModelJsonOutput(payload);
  }

  private async callVisionModelResponsesWebsocket(
    model: string,
    imageUrl: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ) {
    const eventBody = {
      type: 'response.create',
      model,
      temperature: 0,
      store: false,
      instructions: systemPrompt,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: userPrompt
            },
            {
              type: 'input_image',
              image_url: imageUrl
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'receipt_extraction',
          strict: true,
          schema: this.getReceiptJsonSchema()
        }
      },
      tools: []
    };

    return new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocket(this.responsesWebsocketUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });

      let settled = false;
      let aggregatedOutputText = '';

      const closeSocket = () => {
        try {
          socket.close();
        } catch {
          // no-op
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        closeSocket();
        reject(
          new BadRequestException(
            `WebSocket responses excedeu timeout de ${Math.round(this.responsesWebsocketTimeoutMs / 1000)}s.`
          )
        );
      }, this.responsesWebsocketTimeoutMs);

      const resolveOutput = (payload: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        closeSocket();
        try {
          resolve(this.parseModelJsonOutput(payload));
        } catch (error) {
          reject(error);
        }
      };

      const rejectWith = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        closeSocket();
        reject(new BadRequestException(message));
      };

      socket.on('open', () => {
        socket.send(JSON.stringify(eventBody));
      });

      socket.on('message', (rawData: RawData) => {
        const event = this.parseWebsocketEventPayload(rawData);
        if (!event) return;

        const eventType = typeof event.type === 'string' ? event.type : '';
        if (!eventType) return;

        if (eventType === 'response.output_text.delta' && typeof event.delta === 'string') {
          aggregatedOutputText += event.delta;
          return;
        }

        if (eventType === 'response.output_text.done' && typeof event.text === 'string') {
          aggregatedOutputText = event.text;
          return;
        }

        if (eventType === 'response.completed') {
          const responsePayload =
            event.response && typeof event.response === 'object'
              ? this.extractResponsesPayload(event.response as ResponsesApiResponse)
              : '';

          if (responsePayload) {
            resolveOutput(responsePayload);
            return;
          }

          if (aggregatedOutputText.trim()) {
            resolveOutput(aggregatedOutputText);
            return;
          }

          rejectWith('WebSocket responses finalizou sem retorno JSON parseavel.');
          return;
        }

        if (eventType === 'response.failed' || eventType === 'response.incomplete' || eventType === 'error') {
          rejectWith(
            `WebSocket responses retornou ${eventType}: ${this.compactText(
              this.extractWebsocketEventError(event),
              280
            )}`
          );
        }
      });

      socket.on('error', (error: Error) => {
        rejectWith(`Falha no transporte WebSocket: ${this.stringifyError(error)}`);
      });

      socket.on('close', (code: number, reasonBuffer: Buffer) => {
        if (settled) return;
        const reason = this.decodeWebsocketCloseReason(reasonBuffer);
        rejectWith(
          `Conexao WebSocket encerrada antes da conclusao (code=${code})${
            reason ? `: ${this.compactText(reason, 280)}` : ''
          }`
        );
      });
    });
  }

  private async callVisionModelChatCompletions(
    model: string,
    imageUrl: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ) {
    const body = {
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction',
          strict: true,
          schema: this.getReceiptJsonSchema()
        }
      },
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ]
    };

    const data = (await this.callOpenAiJsonEndpoint('/chat/completions', apiKey, body)) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    const contentText = this.extractMessageContent(message);

    if (!contentText) {
      if (message?.refusal) {
        throw new BadRequestException(`Modelo recusou o pedido: ${message.refusal}`);
      }
      throw new BadRequestException('Modelo nao retornou conteudo JSON parseavel.');
    }

    return this.parseModelJsonOutput(contentText);
  }

  private buildPromptPack(
    input: ParseReceiptInput,
    customPrompt: string,
    promptPersonality: BuilderReceiptPromptPersonality,
    contextHints: string,
    contextCompactionEnabled: boolean,
    contextCompactionMaxChars: number
  ) {
    const itemListText = officialItems.map((item) => `- ${item}`).join('\n');
    const providerInfo = input.providerHint ? `Fornecedor informado: ${input.providerHint}.` : '';
    const personalityPack = this.resolvePromptPersonalityPack(promptPersonality);
    const normalizedContextHints = contextCompactionEnabled
      ? this.compactPromptContextHints(contextHints, contextCompactionMaxChars)
      : this.compactText((contextHints || '').trim(), contextCompactionMaxChars);
    const baseUserPrompt = [
      'Extrair dados do cupom fiscal da imagem.',
      'Nao inclua itens fora da lista oficial.',
      'Se nao identificar data, use string vazia em purchaseDate.'
    ].join('\n');

    const systemPrompt = [
      'Voce extrai dados de cupom fiscal e responde SOMENTE em JSON valido.',
      'Itens validos (use exatamente o nome oficial):',
      itemListText,
      'Se item nao estiver na lista, ignore completamente.',
      'Retorne purchaseDate em YYYY-MM-DD quando possivel.',
      'Para cada item aceito, retorne quantity e unitPrice numericos.',
      personalityPack.system
    ]
      .filter(Boolean)
      .join('\n');

    const userPrompt = [
      personalityPack.user,
      customPrompt ? `Prompt operacional:\n${customPrompt}` : baseUserPrompt,
      normalizedContextHints ? `Contexto operacional adicional:\n${normalizedContextHints}` : '',
      providerInfo,
      'Responda SOMENTE com JSON valido no schema solicitado.'
    ]
      .filter(Boolean)
      .join('\n');

    return { systemPrompt, userPrompt };
  }

  private compactPromptContextHints(rawValue: string, maxChars: number) {
    const normalizedMaxChars = this.normalizeContextCompactionMaxChars(maxChars);
    const normalizedLines = (rawValue || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*•\s]+/, '').trim())
      .filter(Boolean);

    if (normalizedLines.length === 0) return '';

    const uniqueLines = Array.from(new Set(normalizedLines));
    const compacted: string[] = [];
    let length = 0;

    for (const line of uniqueLines) {
      const candidate = `- ${line}`;
      const extra = compacted.length > 0 ? candidate.length + 1 : candidate.length;
      if (length + extra > normalizedMaxChars) break;
      compacted.push(candidate);
      length += extra;
    }

    if (compacted.length === 0) {
      return this.compactText(uniqueLines[0] || '', normalizedMaxChars);
    }

    const droppedCount = uniqueLines.length - compacted.length;
    if (droppedCount > 0) {
      const suffix = `- ... +${droppedCount} linha(s) compactadas`;
      const suffixExtra = suffix.length + 1;
      if (length + suffixExtra <= normalizedMaxChars) {
        compacted.push(suffix);
      }
    }

    return compacted.join('\n');
  }

  private buildReceiptInferenceCacheKey(
    model: string,
    imageUrl: string,
    systemPrompt: string,
    userPrompt: string
  ) {
    const promptHash = createHash('sha256')
      .update(`${systemPrompt}\n---\n${userPrompt}`)
      .digest('hex');
    const imageHash = createHash('sha256').update(imageUrl).digest('hex');
    return `${this.receiptsApiMode}|${model}|${promptHash}|${imageHash}`;
  }

  private readReceiptInferenceCache(cacheKey: string, enabled: boolean) {
    if (!enabled) return null;
    const entry = this.receiptInferenceCache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.receiptInferenceCache.delete(cacheKey);
      return null;
    }

    return this.clonePayload(entry.payload);
  }

  private storeReceiptInferenceCache(
    cacheKey: string,
    payload: unknown,
    enabled: boolean,
    ttlMinutes: number
  ) {
    if (!enabled) return;
    const ttl = this.normalizePromptCacheTtlMinutes(ttlMinutes) * 60_000;
    this.cleanupReceiptInferenceCache();
    this.receiptInferenceCache.set(cacheKey, {
      expiresAt: Date.now() + ttl,
      payload: this.clonePayload(payload)
    });

    while (this.receiptInferenceCache.size > 500) {
      const oldestKey = this.receiptInferenceCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.receiptInferenceCache.delete(oldestKey);
    }
  }

  private cleanupReceiptInferenceCache(now = Date.now()) {
    for (const [key, entry] of this.receiptInferenceCache.entries()) {
      if (entry.expiresAt <= now) {
        this.receiptInferenceCache.delete(key);
      }
    }
  }

  private clonePayload(payload: unknown) {
    try {
      return JSON.parse(JSON.stringify(payload)) as unknown;
    } catch {
      return payload;
    }
  }

  private logReceiptsAiCall(entry: {
    requestedMode: string;
    resolvedMode: string;
    model: string;
    cacheHit: boolean;
    attempts: string[];
    durationMs: number;
    ok: boolean;
    error: string;
  }) {
    console.log(
      JSON.stringify({
        event: 'receipts_ai_call',
        ...entry,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        at: new Date().toISOString()
      })
    );
  }

  private resolvePromptPersonalityPack(promptPersonality: BuilderReceiptPromptPersonality) {
    if (promptPersonality === 'CONSERVADOR') {
      return {
        system: 'Modo conservador: quando houver duvida de leitura, prefira ignorar o item.',
        user: 'Priorize precisao alta e descarte linhas ambiguas.'
      };
    }
    if (promptPersonality === 'AGIL') {
      return {
        system: 'Modo agil: aceite abreviacoes comuns quando houver alta confianca visual.',
        user: 'Priorize cobertura, sem violar a lista oficial de itens.'
      };
    }
    return {
      system: 'Modo operacional: equilibrio entre precisao e cobertura para uso diario.',
      user: 'Priorize itens com confianca alta e mantenha resposta objetiva.'
    };
  }

  private getReceiptJsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['purchaseDate', 'items'],
      properties: {
        purchaseDate: {
          type: 'string',
          description: 'Data da compra no formato YYYY-MM-DD. Se nao encontrar, retornar string vazia.'
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'quantity', 'unitPrice'],
            properties: {
              item: {
                type: 'string',
                enum: [...officialItems]
              },
              quantity: {
                type: 'number',
                minimum: 0.000001
              },
              unitPrice: {
                type: 'number',
                minimum: 0.000001
              }
            }
          }
        }
      }
    };
  }

  private extractResponsesPayload(data: ResponsesApiResponse): string | unknown {
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    for (const outputItem of data.output || []) {
      for (const contentItem of outputItem.content || []) {
        if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
          return contentItem.text.trim();
        }
        if (contentItem.json && typeof contentItem.json === 'object') {
          return contentItem.json;
        }
      }
    }
    return '';
  }

  private parseModelJsonOutput(payload: string | unknown) {
    if (typeof payload === 'object' && payload !== null) {
      return payload;
    }
    const contentText = String(payload || '').trim();
    if (!contentText) {
      throw new BadRequestException('Modelo nao retornou JSON parseavel.');
    }

    try {
      return JSON.parse(contentText) as unknown;
    } catch {
      throw new BadRequestException(`Modelo retornou JSON invalido: ${this.compactText(contentText, 600)}`);
    }
  }

  private async callOpenAiJsonEndpoint(path: string, apiKey: string, body: unknown) {
    let response: Response;
    try {
      response = await fetch(`${this.openAiBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new InternalServerErrorException(`Falha de rede ao chamar OpenAI: ${this.stringifyError(error)}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new BadRequestException(
        `OpenAI retornou erro HTTP ${response.status}: ${this.compactText(errText, 600)}`
      );
    }

    return response.json();
  }

  private buildImageUrl(input: ParseReceiptInput) {
    if (input.imageUrl) {
      return input.imageUrl;
    }
    const raw = (input.imageBase64 || '').trim();
    if (raw.startsWith('data:')) {
      return this.normalizeDataUrl(raw);
    }
    const base64Payload = this.sanitizeBase64(raw);
    const mimeType = this.normalizeImageMimeType(input.mimeType, base64Payload);
    this.ensureSupportedMimeType(mimeType);
    return `data:${mimeType};base64,${base64Payload}`;
  }

  private normalizeDataUrl(raw: string) {
    const match = raw.match(/^data:([^;,]+);base64,(.*)$/is);
    if (!match) {
      return raw;
    }
    const mimeType = this.normalizeImageMimeType(match[1], match[2]);
    this.ensureSupportedMimeType(mimeType);
    const base64Payload = this.sanitizeBase64(match[2]);
    return `data:${mimeType};base64,${base64Payload}`;
  }

  private sanitizeBase64(value: string) {
    return value.replace(/\s+/g, '');
  }

  private normalizeImageMimeType(value: string | undefined, base64Payload: string) {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized.startsWith('image/')) {
      return normalized;
    }
    const inferred = this.inferImageMimeType(base64Payload);
    return inferred || 'image/jpeg';
  }

  private inferImageMimeType(base64Payload: string) {
    const value = this.sanitizeBase64(base64Payload);
    if (!value) return '';
    if (value.startsWith('/9j/')) return 'image/jpeg';
    if (value.startsWith('iVBORw0KGgo')) return 'image/png';
    if (value.startsWith('R0lGOD')) return 'image/gif';
    if (value.startsWith('UklGR')) return 'image/webp';
    if (value.startsWith('AAAAIGZ0eXBoZWlj') || value.startsWith('AAAAHGZ0eXBoZWlj')) return 'image/heic';
    if (value.startsWith('AAAAIGZ0eXBoZWlm') || value.startsWith('AAAAHGZ0eXBoZWlm')) return 'image/heif';
    return '';
  }

  private ensureSupportedMimeType(mimeType: string) {
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      throw new BadRequestException(
        'Formato HEIC/HEIF nao suportado neste fluxo. No Atalhos, converta a foto para JPEG antes de codificar em Base64.'
      );
    }
  }

  private extractMessageContent(message?: ChatCompletionMessage) {
    const content = message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    return '';
  }

  private resolveReceiptsModel(modelOverride: string) {
    const normalized = (modelOverride || '').trim();
    if (normalized) return normalized;
    return this.defaultModel;
  }

  private resolveReceiptsApiMode(): ReceiptsApiMode {
    const raw = (process.env.OPENAI_RECEIPTS_API_MODE || 'responses').trim().toLowerCase();
    if (raw === 'responses_websocket') return 'responses_websocket';
    if (raw === 'chat_completions') return 'chat_completions';
    return 'responses';
  }

  private resolveOpenAiBaseUrl() {
    const raw = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('OPENAI_BASE_URL invalida. Use URL absoluta com protocolo http(s).');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('OPENAI_BASE_URL deve usar http:// ou https://');
    }

    const host = parsed.hostname.toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (parsed.protocol === 'http:' && !isLocalhost) {
      throw new Error('OPENAI_BASE_URL com http:// so e permitida para localhost.');
    }

    return parsed.toString().replace(/\/+$/, '');
  }

  private resolveResponsesWebsocketUrl() {
    const base = this.openAiBaseUrl.replace(/^http/i, 'ws');
    return `${base}/responses`;
  }

  private resolveResponsesWebsocketTimeoutMs() {
    const parsed = Number(process.env.OPENAI_RECEIPTS_WEBSOCKET_TIMEOUT_MS || 25000);
    if (!Number.isFinite(parsed) || parsed < 4000) return 25000;
    return Math.min(120000, Math.round(parsed));
  }

  private parseWebsocketEventPayload(rawData: unknown) {
    try {
      if (typeof rawData === 'string') {
        const parsed = JSON.parse(rawData) as Record<string, unknown>;
        return parsed;
      }

      if (Buffer.isBuffer(rawData)) {
        const parsed = JSON.parse(rawData.toString('utf8')) as Record<string, unknown>;
        return parsed;
      }

      if (rawData instanceof Uint8Array) {
        const parsed = JSON.parse(Buffer.from(rawData).toString('utf8')) as Record<string, unknown>;
        return parsed;
      }
    } catch {
      return null;
    }

    return null;
  }

  private extractWebsocketEventError(event: Record<string, unknown>) {
    const directMessage = typeof event.message === 'string' ? event.message : '';
    const error = event.error;
    if (!error || typeof error !== 'object') {
      return directMessage || 'sem detalhes';
    }

    const errorRecord = error as Record<string, unknown>;
    const code = typeof errorRecord.code === 'string' ? errorRecord.code : '';
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : '';
    return [code, message, directMessage].filter(Boolean).join(' | ') || 'sem detalhes';
  }

  private decodeWebsocketCloseReason(value: unknown) {
    if (typeof value === 'string') return value;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
    return '';
  }

  private resolveLocalOcrTimeoutMs() {
    const parsed = Number(process.env.RECEIPTS_LOCAL_OCR_TIMEOUT_MS || 30000);
    if (!Number.isFinite(parsed) || parsed <= 0) return 30000;
    return Math.max(4000, Math.min(60000, Math.round(parsed)));
  }

  private logReceiptsLocalOcr(entry: {
    ok: boolean;
    durationMs: number;
    source: string;
    chars: number;
    error: string;
  }) {
    console.log(
      JSON.stringify({
        event: 'receipts_local_ocr',
        ok: entry.ok,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        source: entry.source,
        chars: Math.max(0, Math.round(entry.chars)),
        error: entry.error,
        at: new Date().toISOString()
      })
    );
  }

  private resolveBooleanEnv(rawValue: string | undefined, fallback: boolean) {
    if (rawValue == null) return fallback;
    const value = rawValue.trim().toLowerCase();
    if (!value) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
  }

  private normalizeItems(extracted: ParsedReceipt) {
    return extracted.items
      .map((item) => ({
        item: item.item,
        quantity: this.normalizeQuantity(item.quantity),
        unitPrice: this.normalizeMoney(item.unitPrice)
      }))
      .filter((item) => !(item.item === 'SACOLA' && this.isLikelyCheckoutBagPrice(item.unitPrice)));
  }

  private normalizeDate(raw: string) {
    const value = raw.trim();
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const br = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (br) {
      return `${br[3]}-${br[2]}-${br[1]}`;
    }
    return value;
  }

  private normalizeMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private normalizeQuantity(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private formatMoney(value: number) {
    return value.toFixed(2).replace('.', ',');
  }

  private formatQuantity(value: number) {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value
      .toFixed(3)
      .replace(/0+$/, '')
      .replace(/\.$/, '')
      .replace('.', ',');
  }

  private resolveIdempotencyTtlHours() {
    const parsed = Number(process.env.RECEIPTS_IDEMPOTENCY_TTL_HOURS || 48);
    if (!Number.isFinite(parsed) || parsed <= 0) return 48;
    return Math.min(24 * 14, Math.round(parsed));
  }

  private normalizeIdempotencyKey(value?: string) {
    const key = (value || '').trim();
    if (!key) return '';
    if (key.length > 120) {
      throw new BadRequestException('Idempotency-Key excede 120 caracteres.');
    }
    if (!/^[a-zA-Z0-9._:-]+$/.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key invalida. Use apenas letras, numeros, ponto, underscore, hifen e dois-pontos.'
      );
    }
    return key;
  }

  private hashPayload(payload: unknown) {
    const stable = this.stableStringify(payload);
    return createHash('sha256').update(stable).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
  }

  private async readIdempotencyRecord(idemKey: string) {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: this.idempotencyScope,
          idemKey
        }
      }
    });
    if (!existing) return null;

    const now = Date.now();
    if (existing.expiresAt.getTime() <= now) {
      await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
      return null;
    }

    return existing;
  }

  private parseStoredIngestResponse(responseJson: string): ReceiptsIngestResponse {
    try {
      return JSON.parse(responseJson) as ReceiptsIngestResponse;
    } catch {
      throw new InternalServerErrorException(
        'Registro de idempotencia corrompido. Gere uma nova Idempotency-Key.'
      );
    }
  }

  private async storeIdempotencyRecord(
    idemKey: string,
    requestHash: string,
    response: ReceiptsIngestResponse
  ) {
    const expiresAt = new Date(Date.now() + this.idempotencyTtlHours * 60 * 60 * 1000);
    const responseJson = JSON.stringify(response);

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          scope: this.idempotencyScope,
          idemKey,
          requestHash,
          responseJson,
          expiresAt
        }
      });
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.readIdempotencyRecord(idemKey);
    if (!existing) {
      return;
    }
    if (existing.requestHash !== requestHash) {
      throw new BadRequestException(
        'Idempotency-Key reutilizada com payload diferente. Use uma nova chave para esta requisicao.'
      );
    }
  }

  private compactText(text: string, maxLength: number) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
