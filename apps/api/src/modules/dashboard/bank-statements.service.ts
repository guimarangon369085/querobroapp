import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { roundMoney } from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';

const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';
const STATEMENT_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const STATEMENT_STALE_AFTER_DAYS = 9;

type StatementDirection = 'INFLOW' | 'OUTFLOW';
type StatementKind = 'PIX_IN' | 'PIX_OUT' | 'DEBIT_PURCHASE' | 'REFUND' | 'OTHER';
type StatementCategory =
  | 'SALES'
  | 'UNMATCHED_INFLOW'
  | 'MARKETPLACE_REFUND'
  | 'INGREDIENTS'
  | 'DELIVERY'
  | 'PACKAGING'
  | 'SOFTWARE'
  | 'MARKETPLACE'
  | 'OWNER'
  | 'OTHER_EXPENSE'
  | 'OTHER_INFLOW';

type ParsedStatementTransaction = {
  externalId: string;
  bookedAt: Date;
  amount: number;
  description: string;
  normalizedDescription: string;
  counterpartyName: string | null;
  direction: StatementDirection;
  transactionKind: StatementKind;
  category: StatementCategory;
  isOperational: boolean;
  raw: Record<string, unknown>;
};

type ExtractedStatementPayload = {
  buffer: Buffer;
  fileName: string;
  fileKind: 'CSV' | 'OFX';
  emailSubject: string | null;
};

type ExistingStatementTransaction = {
  matchedPaymentId: number | null;
  matchedOrderId: number | null;
  classificationCode: string | null;
  manualClassification: boolean;
  manualMatch: boolean;
  category: string;
  isOperational: boolean;
};

type BankStatementImportStatus = 'RUNNING' | 'ATTENTION' | 'PENDING';

type BankStatementLatestImportSummary = {
  status: BankStatementImportStatus;
  importedAt: string | null;
  fileName: string | null;
  fileKind: string | null;
  source: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  matchedPaymentsCount: number;
  unmatchedInflowsCount: number;
  inflowTotal: number;
  outflowTotal: number;
};

type BankStatementDailyEntry = {
  date: string;
  bankInflow: number;
  matchedRevenue: number;
  actualExpenses: number;
  ingredientExpenses: number;
  deliveryExpenses: number;
  packagingExpenses: number;
  softwareExpenses: number;
  marketplaceAdjustments: number;
  netCashFlow: number;
  unmatchedInflows: number;
};

type BankStatementCategoryEntry = {
  key: StatementCategory;
  label: string;
  amount: number;
  count: number;
  tone: 'positive' | 'neutral' | 'warning';
};

type BankStatementUnmatchedInflow = {
  externalId: string;
  date: string;
  amount: number;
  counterpartyName: string | null;
  description: string;
};

type BankStatementDashboardSummary = {
  latestImport: BankStatementLatestImportSummary;
  dailySeries: BankStatementDailyEntry[];
  categories: BankStatementCategoryEntry[];
  unmatchedInflows: BankStatementUnmatchedInflow[];
};

type BankStatementImportResult = {
  ok: true;
  import: BankStatementLatestImportSummary;
};

type BankStatementClassificationOptionSummary = {
  id: number;
  code: string;
  label: string;
  baseCategory: StatementCategory;
  tone: 'positive' | 'neutral' | 'warning';
  isOperational: boolean;
  active: boolean;
  system: boolean;
  sortOrder: number;
};

type BankStatementReviewTransaction = {
  id: number;
  latestImportId: number | null;
  externalId: string;
  bookedAt: string;
  amount: number;
  description: string;
  counterpartyName: string | null;
  direction: StatementDirection;
  transactionKind: StatementKind;
  category: StatementCategory;
  classificationCode: string | null;
  manualClassification: boolean;
  manualMatch: boolean;
  isOperational: boolean;
  matchedPaymentId: number | null;
  matchedOrderId: number | null;
  matchedPaymentLabel: string | null;
};

type BankStatementReviewSummary = {
  latestImport: BankStatementLatestImportSummary;
  transactions: BankStatementReviewTransaction[];
  classificationOptions: BankStatementClassificationOptionSummary[];
};

type BankStatementMatchCandidate = {
  matchType: 'PAYMENT' | 'ORDER';
  paymentId: number | null;
  orderId: number;
  publicNumber: number;
  customerName: string;
  amount: number;
  createdAt: string;
  dueAt: string | null;
  nameScore: number;
  current: boolean;
  label: string;
};

type StatementOrderRevenueCandidate = {
  orderId: number;
  publicNumber: number;
  customerName: string;
  nameScore: number;
  strongFirstAndLast: boolean;
  exactFirstAndLast: boolean;
  sharedStrongTokenCount: number;
  timingScore: number;
  totalScore: number;
  scheduledAt: Date | null;
  createdAt: Date;
};

type UpdateStatementTransactionInput = {
  classificationCode?: string | null;
  matchedPaymentId?: number | null;
  matchedOrderId?: number | null;
};

type UpsertClassificationOptionInput = {
  label: string;
  baseCategory: StatementCategory;
  active?: boolean;
};

const CATEGORY_LABELS: Record<StatementCategory, string> = {
  SALES: 'Recebimentos conciliados',
  UNMATCHED_INFLOW: 'Entradas sem match',
  MARKETPLACE_REFUND: 'Reembolsos / ajustes',
  INGREDIENTS: 'Insumos',
  DELIVERY: 'Fretes',
  PACKAGING: 'Embalagens',
  SOFTWARE: 'Software',
  MARKETPLACE: 'Marketplace',
  OWNER: 'Sócios / capital',
  OTHER_EXPENSE: 'Outras saídas',
  OTHER_INFLOW: 'Outras entradas',
};

const CATEGORY_TONES: Record<StatementCategory, 'positive' | 'neutral' | 'warning'> = {
  SALES: 'positive',
  UNMATCHED_INFLOW: 'warning',
  MARKETPLACE_REFUND: 'neutral',
  INGREDIENTS: 'warning',
  DELIVERY: 'warning',
  PACKAGING: 'warning',
  SOFTWARE: 'neutral',
  MARKETPLACE: 'warning',
  OWNER: 'neutral',
  OTHER_EXPENSE: 'warning',
  OTHER_INFLOW: 'neutral',
};

const DEFAULT_CLASSIFICATION_OPTIONS: Array<{
  code: string;
  label: string;
  baseCategory: StatementCategory;
  tone: 'positive' | 'neutral' | 'warning';
  isOperational: boolean;
  sortOrder: number;
}> = [
  {
    code: 'SALES',
    label: 'Venda conciliada',
    baseCategory: 'SALES',
    tone: 'positive',
    isOperational: true,
    sortOrder: 10,
  },
  {
    code: 'UNMATCHED_INFLOW',
    label: 'Entrada sem match',
    baseCategory: 'UNMATCHED_INFLOW',
    tone: 'warning',
    isOperational: true,
    sortOrder: 20,
  },
  {
    code: 'MARKETPLACE_REFUND',
    label: 'Reembolso marketplace',
    baseCategory: 'MARKETPLACE_REFUND',
    tone: 'neutral',
    isOperational: true,
    sortOrder: 30,
  },
  {
    code: 'INGREDIENTS',
    label: 'Insumos',
    baseCategory: 'INGREDIENTS',
    tone: 'warning',
    isOperational: true,
    sortOrder: 40,
  },
  {
    code: 'DELIVERY',
    label: 'Frete',
    baseCategory: 'DELIVERY',
    tone: 'warning',
    isOperational: true,
    sortOrder: 50,
  },
  {
    code: 'PACKAGING',
    label: 'Embalagem',
    baseCategory: 'PACKAGING',
    tone: 'warning',
    isOperational: true,
    sortOrder: 60,
  },
  {
    code: 'SOFTWARE',
    label: 'Software',
    baseCategory: 'SOFTWARE',
    tone: 'neutral',
    isOperational: true,
    sortOrder: 70,
  },
  {
    code: 'MARKETPLACE',
    label: 'Marketplace',
    baseCategory: 'MARKETPLACE',
    tone: 'warning',
    isOperational: true,
    sortOrder: 80,
  },
  {
    code: 'OWNER',
    label: 'Sócios / capital',
    baseCategory: 'OWNER',
    tone: 'neutral',
    isOperational: false,
    sortOrder: 90,
  },
  {
    code: 'OTHER_EXPENSE',
    label: 'Outra saída',
    baseCategory: 'OTHER_EXPENSE',
    tone: 'warning',
    isOperational: true,
    sortOrder: 100,
  },
  {
    code: 'OTHER_INFLOW',
    label: 'Outra entrada',
    baseCategory: 'OTHER_INFLOW',
    tone: 'neutral',
    isOperational: true,
    sortOrder: 110,
  },
];

function round2(value: number) {
  return roundMoney(value);
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function slugifyClassificationCode(value: string) {
  return normalizeText(value)
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function isStatementCategory(value: string): value is StatementCategory {
  return value in CATEGORY_LABELS;
}

function deriveStatementTone(category: StatementCategory) {
  return CATEGORY_TONES[category];
}

function decodeTextBuffer(buffer: Buffer) {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return buffer.toString('latin1');
}

function splitCsvRow(line: string) {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsvDate(value: string) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    throw new BadRequestException(`Data inválida no extrato: ${value}`);
  }

  const [, day, month, year] = match;
  return new Date(`${year}-${month}-${day}T12:00:00-03:00`);
}

function parseOfxDate(value: string) {
  const digits = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!digits) {
    throw new BadRequestException(`Data OFX inválida no extrato: ${value}`);
  }

  const [, year, month, day] = digits;
  return new Date(`${year}-${month}-${day}T12:00:00-03:00`);
}

function extractEmailSubject(raw: string) {
  const match = raw.match(/^Subject:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

function extractFilenamePeriod(fileName: string) {
  const match = fileName.toUpperCase().match(/_(\d{2}[A-Z]{3}\d{4})_(\d{2}[A-Z]{3}\d{4})\./);
  if (!match) return null;

  const parseToken = (token: string) => {
    const months: Record<string, string> = {
      JAN: '01',
      FEB: '02',
      MAR: '03',
      APR: '04',
      MAY: '05',
      JUN: '06',
      JUL: '07',
      AUG: '08',
      SEP: '09',
      OCT: '10',
      NOV: '11',
      DEC: '12',
    };
    const inner = token.match(/^(\d{2})([A-Z]{3})(\d{4})$/);
    if (!inner) return null;
    const [, day, monthToken, year] = inner;
    const month = months[monthToken];
    if (!month) return null;
    return new Date(`${year}-${month}-${day}T12:00:00-03:00`);
  };

  const periodStart = parseToken(match[1]);
  const periodEnd = parseToken(match[2]);
  if (!periodStart || !periodEnd) return null;
  return { periodStart, periodEnd };
}

function parseCsvTransactions(buffer: Buffer) {
  const content = decodeTextBuffer(buffer).replace(/^\uFEFF/, '');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new BadRequestException('CSV do extrato veio vazio.');
  }

  const header = splitCsvRow(lines[0]).map((value) => normalizeText(value));
  const dateIndex = header.findIndex((value) => value === 'DATA');
  const amountIndex = header.findIndex((value) => value === 'VALOR');
  const idIndex = header.findIndex((value) => value === 'IDENTIFICADOR');
  const descriptionIndex = header.findIndex((value) => value === 'DESCRICAO');

  if (dateIndex < 0 || amountIndex < 0 || idIndex < 0 || descriptionIndex < 0) {
    throw new BadRequestException('CSV do extrato não trouxe o cabeçalho esperado.');
  }

  return lines.slice(1).map((line, rowIndex) => {
    const cells = splitCsvRow(line);
    const externalId = String(cells[idIndex] || '').trim();
    const description = String(cells[descriptionIndex] || '').trim();
    const amount = Number.parseFloat(String(cells[amountIndex] || '').replace(/\s+/g, ''));

    if (!externalId || !description || !Number.isFinite(amount)) {
      throw new BadRequestException(`Linha ${rowIndex + 2} do CSV do extrato esta incompleta.`);
    }

    return {
      externalId,
      bookedAt: parseCsvDate(String(cells[dateIndex] || '')),
      amount: round2(amount),
      description,
    };
  });
}

function parseOfxTransactions(buffer: Buffer) {
  const content = decodeTextBuffer(buffer);
  const blocks = [...content.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  if (!blocks.length) {
    throw new BadRequestException('OFX do extrato não trouxe movimentações legíveis.');
  }

  const readTag = (block: string, tag: string) => {
    const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'));
    return match?.[1]?.trim() || '';
  };

  return blocks.map((entry, rowIndex) => {
    const block = entry[1] || '';
    const externalId = readTag(block, 'FITID');
    const memo = readTag(block, 'MEMO');
    const name = readTag(block, 'NAME');
    const description = memo || name;
    const amount = Number.parseFloat(readTag(block, 'TRNAMT'));
    const postedAt = readTag(block, 'DTPOSTED');

    if (!externalId || !description || !Number.isFinite(amount) || !postedAt) {
      throw new BadRequestException(`Movimentação ${rowIndex + 1} do OFX está incompleta.`);
    }

    return {
      externalId,
      bookedAt: parseOfxDate(postedAt),
      amount: round2(amount),
      description,
    };
  });
}

function extractPreferredStatementPayload(buffer: Buffer, originalName: string) {
  const normalizedName = originalName.trim().toLowerCase();
  if (normalizedName.endsWith('.csv')) {
    return {
      buffer,
      fileName: originalName,
      fileKind: 'CSV',
      emailSubject: null,
    } as ExtractedStatementPayload;
  }

  if (normalizedName.endsWith('.ofx')) {
    return {
      buffer,
      fileName: originalName,
      fileKind: 'OFX',
      emailSubject: null,
    } as ExtractedStatementPayload;
  }

  if (!normalizedName.endsWith('.eml')) {
    throw new BadRequestException('Envie um arquivo .eml, .csv ou .ofx do extrato do Nubank.');
  }

  const raw = decodeTextBuffer(buffer);
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    throw new BadRequestException('Não foi possível localizar os anexos dentro do .eml.');
  }

  const boundary = boundaryMatch[1];
  const parts = raw.split(`--${boundary}`);
  const attachments = parts
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '--') return null;
      const [headerBlock, ...bodyChunks] = trimmed.split(/\r?\n\r?\n/);
      const body = bodyChunks.join('\n\n').trim();
      if (!/Content-Disposition:\s*attachment/i.test(headerBlock)) return null;
      const filenameMatch = headerBlock.match(/filename="?([^"\r\n;]+)"?/i);
      if (!filenameMatch) return null;
      const encodingMatch = headerBlock.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
      const fileName = filenameMatch[1].trim();
      const encoding = encodingMatch?.[1]?.trim().toLowerCase() || '';
      const payload =
        encoding === 'base64'
          ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
          : Buffer.from(body, 'utf8');
      return {
        fileName,
        payload,
      };
    })
    .filter(Boolean) as Array<{ fileName: string; payload: Buffer }>;

  const csvAttachment = attachments.find((entry) => entry.fileName.toLowerCase().endsWith('.csv'));
  if (csvAttachment) {
    return {
      buffer: csvAttachment.payload,
      fileName: csvAttachment.fileName,
      fileKind: 'CSV',
      emailSubject: extractEmailSubject(raw),
    } as ExtractedStatementPayload;
  }

  const ofxAttachment = attachments.find((entry) => entry.fileName.toLowerCase().endsWith('.ofx'));
  if (ofxAttachment) {
    return {
      buffer: ofxAttachment.payload,
      fileName: ofxAttachment.fileName,
      fileKind: 'OFX',
      emailSubject: extractEmailSubject(raw),
    } as ExtractedStatementPayload;
  }

  throw new BadRequestException('O .eml não trouxe anexo CSV nem OFX do extrato.');
}

function buildChecksum(fileKind: string, buffer: Buffer) {
  return createHash('sha256').update(fileKind).update(':').update(buffer).digest('hex');
}

function toDayKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function buildStatementImportStatus(asOf: Date, latestImport?: { periodEnd: Date | null } | null) {
  if (!latestImport) return 'PENDING' as const;
  const referenceDate = latestImport.periodEnd || null;
  if (!referenceDate) return 'ATTENTION' as const;
  const ageMs = asOf.getTime() - referenceDate.getTime();
  return ageMs <= STATEMENT_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000 ? 'RUNNING' : 'ATTENTION';
}

function sanitizeCounterpartyName(value?: string | null) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function extractCounterpartyName(description: string, direction: StatementDirection) {
  const inlineMatch = description.match(
    /^(?:Transfer[êe]ncia recebida(?: pelo Pix)?|Reembolso recebido pelo Pix|Transfer[êe]ncia enviada pelo Pix)\s*-\s*(.+?)\s+-\s+[•*]/i,
  );
  if (inlineMatch?.[1]) {
    return sanitizeCounterpartyName(inlineMatch[1]);
  }

  const parts = description.split(' - ').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const normalizedLead = normalizeText(parts[0]);

  if (
    direction === 'INFLOW' &&
    parts.length >= 2 &&
    (/^TRANSFERENCIA RECEBIDA/i.test(normalizedLead) || /^REEMBOLSO/i.test(normalizedLead))
  ) {
    return sanitizeCounterpartyName(parts[1]);
  }

  if (
    direction === 'OUTFLOW' &&
    parts.length >= 2 &&
    /^TRANSFERENCIA ENVIADA PELO PIX/i.test(normalizedLead)
  ) {
    return sanitizeCounterpartyName(parts[1]);
  }

  return null;
}

function inferOperationalCategory(normalizedDescription: string) {
  if (
    normalizedDescription.includes('COMPRA NO DEBITO - UBER') ||
    normalizedDescription.includes('DL*UBERRIDES')
  ) {
    return 'DELIVERY' as StatementCategory;
  }

  if (
    normalizedDescription.includes('PAO DE ACUCAR') ||
    normalizedDescription.includes('CASA SANTA LUZIA')
  ) {
    return 'INGREDIENTS' as StatementCategory;
  }

  if (
    normalizedDescription.includes('BUYPACK') ||
    normalizedDescription.includes('DESCARTAVEIS')
  ) {
    return 'PACKAGING' as StatementCategory;
  }

  if (normalizedDescription.includes('ZAPT TECNOLOGIA')) {
    return 'SOFTWARE' as StatementCategory;
  }

  if (normalizedDescription.includes('PIX MARKETPLACE')) {
    return 'MARKETPLACE' as StatementCategory;
  }

  return null;
}

function ownerKeywords() {
  return String(process.env.BANK_STATEMENT_OWNER_KEYWORDS || '')
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function classifyStatementTransaction(base: {
  externalId: string;
  bookedAt: Date;
  amount: number;
  description: string;
}) {
  const normalizedDescription = normalizeText(base.description);
  const direction: StatementDirection = base.amount >= 0 ? 'INFLOW' : 'OUTFLOW';
  const counterpartyName = extractCounterpartyName(base.description, direction);
  const normalizedCounterparty = normalizeText(counterpartyName);
  const ownerMatch =
    normalizedCounterparty && ownerKeywords().some((entry) => normalizedCounterparty.includes(entry));
  const operationalCategory = inferOperationalCategory(normalizedDescription);
  const isRefund = normalizedDescription.startsWith('ESTORNO');

  if (direction === 'INFLOW') {
    if (normalizedDescription.includes('REEMBOLSO RECEBIDO PELO PIX - PIX MARKETPLACE')) {
      return {
        normalizedDescription,
        counterpartyName,
        direction,
        transactionKind: 'REFUND' as StatementKind,
        category: 'MARKETPLACE_REFUND' as StatementCategory,
        isOperational: true,
      };
    }

    if (isRefund && operationalCategory) {
      return {
        normalizedDescription,
        counterpartyName,
        direction,
        transactionKind: 'REFUND' as StatementKind,
        category: operationalCategory,
        isOperational: true,
      };
    }

    if (
      normalizedDescription.includes('TRANSFERENCIA RECEBIDA PELO PIX') ||
      normalizedDescription.startsWith('TRANSFERENCIA RECEBIDA -')
    ) {
      return {
        normalizedDescription,
        counterpartyName,
        direction,
        transactionKind: 'PIX_IN' as StatementKind,
        category: ownerMatch ? ('OWNER' as StatementCategory) : ('UNMATCHED_INFLOW' as StatementCategory),
        isOperational: !ownerMatch,
      };
    }

    return {
      normalizedDescription,
      counterpartyName,
      direction,
      transactionKind: 'OTHER' as StatementKind,
      category: ownerMatch ? ('OWNER' as StatementCategory) : ('OTHER_INFLOW' as StatementCategory),
      isOperational: !ownerMatch,
    };
  }

  if (operationalCategory) {
    return {
      normalizedDescription,
      counterpartyName,
      direction,
      transactionKind: isRefund
        ? ('REFUND' as StatementKind)
        : normalizedDescription.includes('COMPRA NO DEBITO')
          ? ('DEBIT_PURCHASE' as StatementKind)
          : ('PIX_OUT' as StatementKind),
      category: operationalCategory,
      isOperational: true,
    };
  }

  if (normalizedDescription.startsWith('TRANSFERENCIA ENVIADA PELO PIX')) {
    return {
      normalizedDescription,
      counterpartyName,
      direction,
      transactionKind: 'PIX_OUT' as StatementKind,
      category: ownerMatch ? ('OWNER' as StatementCategory) : ('OTHER_EXPENSE' as StatementCategory),
      isOperational: !ownerMatch,
    };
  }

  return {
    normalizedDescription,
    counterpartyName,
    direction,
    transactionKind: normalizedDescription.startsWith('ESTORNO') ? ('REFUND' as StatementKind) : ('OTHER' as StatementKind),
    category: 'OTHER_EXPENSE' as StatementCategory,
    isOperational: true,
  };
}

@Injectable()
export class BankStatementsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
  ) {}

  private defaultClassificationCodeForCategory(category: StatementCategory) {
    return DEFAULT_CLASSIFICATION_OPTIONS.find((entry) => entry.baseCategory === category)?.code || category;
  }

  private formatMatchedPaymentLabel(input?: {
    orderId?: number | null;
    publicNumber?: number | null;
    customerName?: string | null;
  } | null) {
    if (!input?.orderId) return null;
    const displayNumber = input.publicNumber ?? input.orderId;
    const customerName = input.customerName || 'Cliente sem nome';
    return `Pedido #${displayNumber} · ${customerName}`;
  }

  private async ensureClassificationOptions() {
    for (const option of DEFAULT_CLASSIFICATION_OPTIONS) {
      await this.prisma.bankStatementClassificationOption.upsert({
        where: { code: option.code },
        update: {
          label: option.label,
          baseCategory: option.baseCategory,
          tone: option.tone,
          isOperational: option.isOperational,
          active: true,
          system: true,
          sortOrder: option.sortOrder,
        },
        create: {
          code: option.code,
          label: option.label,
          baseCategory: option.baseCategory,
          tone: option.tone,
          isOperational: option.isOperational,
          active: true,
          system: true,
          sortOrder: option.sortOrder,
        },
      });
    }

    const options = await this.prisma.bankStatementClassificationOption.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }, { id: 'asc' }],
    });

    return options.map((option) => ({
      ...option,
      baseCategory: isStatementCategory(option.baseCategory) ? option.baseCategory : 'OTHER_EXPENSE',
      tone:
        option.tone === 'positive' || option.tone === 'warning' || option.tone === 'neutral'
          ? option.tone
          : deriveStatementTone(
              isStatementCategory(option.baseCategory) ? option.baseCategory : 'OTHER_EXPENSE',
            ),
    }));
  }

  private serializeClassificationOption(option: Awaited<ReturnType<BankStatementsService['ensureClassificationOptions']>>[number]) {
    return {
      id: option.id,
      code: option.code,
      label: option.label,
      baseCategory: option.baseCategory,
      tone: option.tone,
      isOperational: option.isOperational,
      active: option.active,
      system: option.system,
      sortOrder: option.sortOrder,
    } satisfies BankStatementClassificationOptionSummary;
  }

  private getStatementOrderMatchLookbackDays() {
    const raw = Number(process.env.BANK_STATEMENT_ORDER_MATCH_LOOKBACK_DAYS || '');
    if (!Number.isFinite(raw) || raw <= 0) return 45;
    return Math.min(Math.floor(raw), 180);
  }

  private amountsMatch(left: number, right: number) {
    return Math.abs(round2(left) - round2(right)) <= 0.01;
  }

  private computeStatementOrderTimingScore(input: {
    createdAt: Date;
    scheduledAt?: Date | null;
    bookedAt: Date;
  }) {
    const anchors = [input.scheduledAt, input.createdAt].filter((value): value is Date => Boolean(value));
    const deltaDays = anchors.reduce((best, anchor) => {
      const current = Math.abs(anchor.getTime() - input.bookedAt.getTime()) / (24 * 60 * 60 * 1000);
      return Math.min(best, current);
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(deltaDays)) return 0.45;
    if (deltaDays <= 1) return 1;
    if (deltaDays <= 3) return 0.94;
    if (deltaDays <= 7) return 0.84;
    if (deltaDays <= 14) return 0.72;
    if (deltaDays <= 30) return 0.58;
    return 0.44;
  }

  private async findLikelyOrderRevenueCandidates(input: {
    amount: number;
    counterpartyName?: string | null;
    bookedAt: Date;
  }) {
    const counterpartyName = sanitizeCounterpartyName(input.counterpartyName);
    if (!counterpartyName) return [] as StatementOrderRevenueCandidate[];

    const lookbackStart = new Date(input.bookedAt);
    lookbackStart.setDate(lookbackStart.getDate() - this.getStatementOrderMatchLookbackDays());

    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELADO' },
        createdAt: { gte: lookbackStart },
        customerName: { not: null },
      },
      select: {
        id: true,
        publicNumber: true,
        total: true,
        createdAt: true,
        scheduledAt: true,
        customerName: true,
        payments: {
          select: {
            amount: true,
            status: true,
            paidAt: true,
          },
        },
      },
    });

    const candidates = orders
      .map((order) => {
        const nameMatch = this.paymentsService.describeHumanNameMatch(order.customerName, counterpartyName);
        const nameScore = nameMatch.score;
        if (nameScore < 0.72 && !nameMatch.strongFirstAndLast) return null;

        const paidTotal = round2(
          order.payments
            .filter((payment: { status: string; paidAt: Date | null }) => payment.status === 'PAGO' || Boolean(payment.paidAt))
            .reduce((sum: number, payment: { amount: number }) => sum + Number(payment.amount || 0), 0),
        );
        const outstandingAmount = round2(Math.max(Number(order.total || 0) - paidTotal, 0));
        const amountFit =
          this.amountsMatch(order.total || 0, input.amount)
            ? 'TOTAL'
            : outstandingAmount > 0 && this.amountsMatch(outstandingAmount, input.amount)
              ? 'OUTSTANDING'
              : null;

        if (!amountFit) return null;

        const timingScore = this.computeStatementOrderTimingScore({
          createdAt: order.createdAt,
          scheduledAt: order.scheduledAt,
          bookedAt: input.bookedAt,
        });
        const totalScore = Math.min(
          0.999,
          nameScore * 0.82 +
            timingScore * 0.12 +
            (amountFit === 'OUTSTANDING' ? 0.04 : 0.02) +
            (nameMatch.strongFirstAndLast ? 0.02 : 0) +
            (nameMatch.sharedStrongTokenCount >= 2 ? 0.01 : 0),
        );

        return {
          orderId: order.id,
          publicNumber: order.publicNumber ?? order.id,
          customerName: order.customerName || 'Cliente sem nome',
          nameScore,
          strongFirstAndLast: nameMatch.strongFirstAndLast,
          exactFirstAndLast: nameMatch.exactFirstAndLast,
          sharedStrongTokenCount: nameMatch.sharedStrongTokenCount,
          timingScore,
          totalScore,
          scheduledAt: order.scheduledAt,
          createdAt: order.createdAt,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const scoreDelta = (right?.totalScore || 0) - (left?.totalScore || 0);
        if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;
        const nameDelta = (right?.nameScore || 0) - (left?.nameScore || 0);
        if (Math.abs(nameDelta) > 0.0001) return nameDelta;
        return (right?.orderId || 0) - (left?.orderId || 0);
      }) as StatementOrderRevenueCandidate[];

    return candidates;
  }

  private chooseLikelyOrderRevenueCandidate(candidates: StatementOrderRevenueCandidate[]) {
    const top = candidates[0] || null;
    const second = candidates[1] || null;
    if (!top) return null;

    const scoreGap = second ? top.totalScore - second.totalScore : 1;
    if (top.nameScore >= 0.98 && (!second || second.nameScore < 0.94)) return top;
    if (top.exactFirstAndLast && top.nameScore >= 0.86 && top.timingScore >= 0.72 && scoreGap >= 0.03) return top;
    if (top.strongFirstAndLast && top.nameScore >= 0.82 && top.timingScore >= 0.72 && scoreGap >= 0.05) return top;
    if (top.nameScore >= 0.93 && scoreGap >= 0.06) return top;
    if (top.nameScore >= 0.86 && scoreGap >= 0.08 && top.timingScore >= 0.84) return top;
    if (top.nameScore >= 0.8 && scoreGap >= 0.12 && top.timingScore >= 0.84) return top;
    if (!second && top.strongFirstAndLast && top.nameScore >= 0.78 && top.timingScore >= 0.72) return top;
    if (!second && top.nameScore >= 0.78 && top.timingScore >= 0.84) return top;
    return null;
  }

  private async findLikelyOrderRevenueMatch(input: {
    amount: number;
    counterpartyName?: string | null;
    bookedAt: Date;
  }) {
    const candidates = await this.findLikelyOrderRevenueCandidates(input);
    return this.chooseLikelyOrderRevenueCandidate(candidates);
  }

  private buildStatementRevenueGroupKey(input: {
    amount: number;
    counterpartyName?: string | null;
    bookedAt: Date;
  }) {
    const counterpartyName = sanitizeCounterpartyName(input.counterpartyName);
    if (!counterpartyName) return null;
    return `${counterpartyName}|${round2(Math.abs(input.amount)).toFixed(2)}|${input.bookedAt.toISOString().slice(0, 10)}`;
  }

  private async planGroupedOrderRevenueMatches(
    parsedTransactions: Array<Pick<ParsedStatementTransaction, 'externalId' | 'bookedAt' | 'amount' | 'description'>>,
    existingTransactionMap: Map<string, ExistingStatementTransaction>,
  ) {
    const groups = new Map<
      string,
      Array<{
        externalId: string;
        amount: number;
        counterpartyName: string;
        bookedAt: Date;
      }>
    >();

    for (const parsed of parsedTransactions) {
      const existingEntry = existingTransactionMap.get(parsed.externalId) || null;
      if (
        existingEntry?.manualMatch ||
        existingEntry?.matchedPaymentId ||
        existingEntry?.matchedOrderId
      ) {
        continue;
      }

      const classified = classifyStatementTransaction(parsed);
      if (
        classified.direction !== 'INFLOW' ||
        classified.transactionKind !== 'PIX_IN' ||
        classified.category !== 'UNMATCHED_INFLOW' ||
        !classified.counterpartyName
      ) {
        continue;
      }

      const key = this.buildStatementRevenueGroupKey({
        amount: parsed.amount,
        counterpartyName: classified.counterpartyName,
        bookedAt: parsed.bookedAt,
      });
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push({
        externalId: parsed.externalId,
        amount: Math.abs(parsed.amount),
        counterpartyName: classified.counterpartyName,
        bookedAt: parsed.bookedAt,
      });
      groups.set(key, group);
    }

    const assignments = new Map<string, number>();

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const reference = group[0];
      if (!reference) continue;

      const candidates = await this.findLikelyOrderRevenueCandidates(reference);
      if (candidates.length !== group.length) continue;
      if (
        candidates.some(
          (candidate) => candidate.nameScore < 0.88 && !candidate.strongFirstAndLast,
        )
      )
        continue;

      const uniqueOrderIds = new Set(candidates.map((candidate) => candidate.orderId));
      if (uniqueOrderIds.size !== group.length) continue;

      const sortedTransactions = [...group].sort((left, right) => {
        const timeDelta = left.bookedAt.getTime() - right.bookedAt.getTime();
        if (timeDelta !== 0) return timeDelta;
        return left.externalId.localeCompare(right.externalId);
      });
      const sortedCandidates = [...candidates].sort((left, right) => {
        const leftAnchor = left.scheduledAt?.getTime() ?? left.createdAt.getTime();
        const rightAnchor = right.scheduledAt?.getTime() ?? right.createdAt.getTime();
        if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor;
        return left.orderId - right.orderId;
      });

      sortedTransactions.forEach((transaction, index) => {
        const candidate = sortedCandidates[index];
        if (candidate) {
          assignments.set(transaction.externalId, candidate.orderId);
        }
      });
    }

    return assignments;
  }

  private async syncImportMetrics(importId: number) {
    const [importRecord, transactions] = await Promise.all([
      this.prisma.bankStatementImport.findUnique({ where: { id: importId } }),
      this.prisma.bankStatementTransaction.findMany({
        where: { latestImportId: importId },
        select: {
          amount: true,
          matchedPaymentId: true,
          matchedOrderId: true,
          direction: true,
          transactionKind: true,
          category: true,
        },
      }),
    ]);

    if (!importRecord) {
      throw new BadRequestException('Importação do extrato não encontrada.');
    }

    const inflowTotal = round2(
      transactions
        .filter((entry) => entry.amount > 0)
        .reduce((sum, entry) => sum + entry.amount, 0),
    );
    const outflowTotal = round2(
      transactions
        .filter((entry) => entry.amount < 0)
        .reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
    );
    const matchedPaymentsCount = transactions.filter(
      (entry) => entry.matchedPaymentId != null || entry.matchedOrderId != null,
    ).length;
    const unmatchedInflowsCount = transactions.filter(
      (entry) =>
        entry.direction === 'INFLOW' &&
        entry.transactionKind === 'PIX_IN' &&
        entry.matchedPaymentId == null &&
        entry.matchedOrderId == null &&
        entry.category === 'UNMATCHED_INFLOW',
    ).length;

    await this.prisma.bankStatementImport.update({
      where: { id: importId },
      data: {
        transactionCount: transactions.length,
        matchedPaymentsCount,
        unmatchedInflowsCount,
        inflowTotal,
        outflowTotal,
      },
    });
  }

  async importUploadedStatement(file?: {
    buffer?: Buffer;
    mimetype?: string;
    originalname?: string;
    size?: number;
  }) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Selecione um arquivo de extrato para atualizar.');
    }

    if ((file.size || file.buffer.length) > STATEMENT_UPLOAD_MAX_BYTES) {
      throw new BadRequestException('O arquivo do extrato excede o limite permitido.');
    }

    const extracted = extractPreferredStatementPayload(
      file.buffer,
      file.originalname || 'extrato.eml',
    );
    const parsedTransactions =
      extracted.fileKind === 'CSV'
        ? parseCsvTransactions(extracted.buffer)
        : parseOfxTransactions(extracted.buffer);
    const classificationOptions = await this.ensureClassificationOptions();
    const classificationOptionMap = new Map(
      classificationOptions.map((option) => [option.code, option]),
    );

    if (!parsedTransactions.length) {
      throw new BadRequestException('Não encontramos movimentações no extrato enviado.');
    }

    const periodFromFile = extractFilenamePeriod(extracted.fileName);
    const sortedDates = parsedTransactions
      .map((entry) => entry.bookedAt)
      .sort((left, right) => left.getTime() - right.getTime());
    const periodStart = periodFromFile?.periodStart || sortedDates[0] || null;
    const periodEnd = periodFromFile?.periodEnd || sortedDates[sortedDates.length - 1] || null;
    const checksum = buildChecksum(extracted.fileKind, extracted.buffer);

    const existingTransactions = await this.prisma.bankStatementTransaction.findMany({
      where: {
        externalId: {
          in: parsedTransactions.map((entry) => entry.externalId),
        },
      },
      select: {
        externalId: true,
        matchedPaymentId: true,
        matchedOrderId: true,
        classificationCode: true,
        manualClassification: true,
        manualMatch: true,
        category: true,
        isOperational: true,
      },
    });
    const existingTransactionMap = new Map<string, ExistingStatementTransaction>(
      existingTransactions.map((entry) => [
        entry.externalId,
        {
          matchedPaymentId: entry.matchedPaymentId,
          matchedOrderId: entry.matchedOrderId,
          classificationCode: entry.classificationCode,
          manualClassification: entry.manualClassification,
          manualMatch: entry.manualMatch,
          category: entry.category,
          isOperational: entry.isOperational,
        },
      ]),
    );
    const groupedOrderRevenuePlans = await this.planGroupedOrderRevenueMatches(
      parsedTransactions,
      existingTransactionMap,
    );

    let matchedPaymentsCount = 0;
    let unmatchedInflowsCount = 0;
    let inflowTotal = 0;
    let outflowTotal = 0;

    const normalizedTransactions: Array<
      ParsedStatementTransaction & {
        classificationCode: string | null;
        manualClassification: boolean;
        manualMatch: boolean;
        matchedPaymentId: number | null;
        matchedOrderId: number | null;
      }
    > = [];

    for (const parsed of parsedTransactions) {
      const existingEntry = existingTransactionMap.get(parsed.externalId) || null;
      const classified = classifyStatementTransaction(parsed);
      let category = classified.category;
      let isOperational = classified.isOperational;
      let classificationCode = this.defaultClassificationCodeForCategory(category);
      let manualClassification = existingEntry?.manualClassification ?? false;
      let manualMatch = existingEntry?.manualMatch ?? false;
      let matchedPaymentId = existingEntry?.matchedPaymentId ?? null;
      let matchedOrderId = existingEntry?.matchedOrderId ?? null;

      if (manualClassification && existingEntry?.classificationCode) {
        const existingOption = classificationOptionMap.get(existingEntry.classificationCode);
        classificationCode = existingEntry.classificationCode;
        if (existingOption) {
          category = existingOption.baseCategory;
          isOperational = existingOption.isOperational;
        } else if (isStatementCategory(existingEntry.category)) {
          category = existingEntry.category;
          isOperational = existingEntry.isOperational;
        }
      }

      if (classified.direction === 'INFLOW') {
        inflowTotal = round2(inflowTotal + parsed.amount);
      } else {
        outflowTotal = round2(outflowTotal + Math.abs(parsed.amount));
      }

      if (
        !manualMatch &&
        !matchedPaymentId &&
        !matchedOrderId &&
        classified.direction === 'INFLOW' &&
        classified.transactionKind === 'PIX_IN' &&
        classified.category === 'UNMATCHED_INFLOW' &&
        classified.counterpartyName
      ) {
        const reconciliation = await this.paymentsService.reconcilePixWebhook({
          payerName: classified.counterpartyName,
          amount: Math.abs(parsed.amount),
          paidAt: parsed.bookedAt.toISOString(),
          source: 'bank-statement-import',
          sourceTransactionId: parsed.externalId,
          metadata: {
            description: parsed.description,
            fileName: extracted.fileName,
          },
        });

        if (
          reconciliation?.matched &&
          'payment' in reconciliation &&
          reconciliation.payment?.id
        ) {
          matchedPaymentId = reconciliation.payment.id;
          matchedOrderId =
            'order' in reconciliation && reconciliation.order?.id
              ? reconciliation.order.id
              : null;
          category = 'SALES';
          classificationCode = this.defaultClassificationCodeForCategory('SALES');
          matchedPaymentsCount += 1;
        } else {
          const groupedOrderId = groupedOrderRevenuePlans.get(parsed.externalId) ?? null;
          const orderMatch =
            groupedOrderId != null
              ? { orderId: groupedOrderId }
              : await this.findLikelyOrderRevenueMatch({
                  amount: Math.abs(parsed.amount),
                  counterpartyName: classified.counterpartyName,
                  bookedAt: parsed.bookedAt,
                });

          if (orderMatch) {
            matchedOrderId = orderMatch.orderId;
            category = 'SALES';
            classificationCode = this.defaultClassificationCodeForCategory('SALES');
            matchedPaymentsCount += 1;
          } else {
            unmatchedInflowsCount += 1;
          }
        }
      } else if (matchedPaymentId || matchedOrderId) {
        category = 'SALES';
        classificationCode = this.defaultClassificationCodeForCategory('SALES');
        matchedPaymentsCount += 1;
      } else if (!manualClassification) {
        classificationCode = this.defaultClassificationCodeForCategory(category);
      }

      if (category === 'OWNER') {
        isOperational = false;
      }

      normalizedTransactions.push({
        ...parsed,
        normalizedDescription: classified.normalizedDescription,
        counterpartyName: classified.counterpartyName,
        direction: classified.direction,
        transactionKind: classified.transactionKind,
        category,
        classificationCode,
        manualClassification,
        manualMatch,
        isOperational,
        raw: {
          fileName: extracted.fileName,
          emailSubject: extracted.emailSubject,
        },
        matchedPaymentId,
        matchedOrderId,
      });
    }

    matchedPaymentsCount = normalizedTransactions.filter(
      (entry) => entry.matchedPaymentId != null || entry.matchedOrderId != null,
    ).length;
    unmatchedInflowsCount = normalizedTransactions.filter(
      (entry) =>
        entry.direction === 'INFLOW' &&
        entry.transactionKind === 'PIX_IN' &&
        entry.matchedPaymentId == null &&
        entry.matchedOrderId == null &&
        entry.category === 'UNMATCHED_INFLOW',
    ).length;

    const importRecord = await this.prisma.bankStatementImport.upsert({
      where: { checksum },
      update: {
        source: 'MANUAL_UPLOAD',
        sourceLabel: 'Upload manual',
        fileName: extracted.fileName,
        fileKind: extracted.fileKind,
        emailSubject: extracted.emailSubject,
        periodStart,
        periodEnd,
        transactionCount: normalizedTransactions.length,
        matchedPaymentsCount,
        unmatchedInflowsCount,
        inflowTotal,
        outflowTotal,
      },
      create: {
        source: 'MANUAL_UPLOAD',
        sourceLabel: 'Upload manual',
        fileName: extracted.fileName,
        fileKind: extracted.fileKind,
        checksum,
        emailSubject: extracted.emailSubject,
        periodStart,
        periodEnd,
        transactionCount: normalizedTransactions.length,
        matchedPaymentsCount,
        unmatchedInflowsCount,
        inflowTotal,
        outflowTotal,
      },
    });

    for (const transaction of normalizedTransactions) {
      await this.prisma.bankStatementTransaction.upsert({
        where: { externalId: transaction.externalId },
        update: {
          latestImportId: importRecord.id,
          bookedAt: transaction.bookedAt,
          amount: transaction.amount,
          description: transaction.description,
          normalizedDescription: transaction.normalizedDescription,
          direction: transaction.direction,
          transactionKind: transaction.transactionKind,
          category: transaction.category,
          classificationCode: transaction.classificationCode,
          manualClassification: transaction.manualClassification,
          manualMatch: transaction.manualMatch,
          counterpartyName: transaction.counterpartyName,
          isOperational: transaction.isOperational,
          matchedPaymentId: transaction.matchedPaymentId,
          matchedOrderId: transaction.matchedOrderId,
          rawJson: JSON.stringify(transaction.raw),
        },
        create: {
          latestImportId: importRecord.id,
          bookedAt: transaction.bookedAt,
          amount: transaction.amount,
          externalId: transaction.externalId,
          description: transaction.description,
          normalizedDescription: transaction.normalizedDescription,
          direction: transaction.direction,
          transactionKind: transaction.transactionKind,
          category: transaction.category,
          classificationCode: transaction.classificationCode,
          manualClassification: transaction.manualClassification,
          manualMatch: transaction.manualMatch,
          counterpartyName: transaction.counterpartyName,
          isOperational: transaction.isOperational,
          matchedPaymentId: transaction.matchedPaymentId,
          matchedOrderId: transaction.matchedOrderId,
          rawJson: JSON.stringify(transaction.raw),
        },
      });
    }

    return {
      ok: true,
      import: await this.getLatestImportSummary(new Date(), importRecord.id),
    } as BankStatementImportResult;
  }

  async getReviewSummary(asOf = new Date()) {
    const [latestImport, classificationOptions] = await Promise.all([
      this.prisma.bankStatementImport.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.ensureClassificationOptions(),
    ]);

    if (!latestImport) {
      return {
        latestImport: await this.getLatestImportSummary(asOf),
        transactions: [],
        classificationOptions: classificationOptions.map((option) =>
          this.serializeClassificationOption(option),
        ),
      } satisfies BankStatementReviewSummary;
    }

    const transactions = await this.prisma.bankStatementTransaction.findMany({
      where: { latestImportId: latestImport.id },
      orderBy: [{ bookedAt: 'desc' }, { id: 'desc' }],
    });

    const matchedPaymentIds = transactions
      .map((entry) => entry.matchedPaymentId)
      .filter((entry): entry is number => typeof entry === 'number');
    const payments = matchedPaymentIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: matchedPaymentIds } },
          include: {
            order: {
              select: {
                id: true,
                publicNumber: true,
                customer: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        })
      : [];
    const paymentMap = new Map(payments.map((payment) => [payment.id, payment]));
    const matchedOrderIds = transactions
      .filter((entry) => entry.matchedOrderId && !entry.matchedPaymentId)
      .map((entry) => entry.matchedOrderId as number);
    const orders = matchedOrderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: matchedOrderIds } },
          select: {
            id: true,
            publicNumber: true,
            customer: {
              select: {
                name: true,
              },
            },
          },
        })
      : [];
    const orderMap = new Map(orders.map((order) => [order.id, order]));

    return {
      latestImport: await this.getLatestImportSummary(asOf, latestImport.id),
      classificationOptions: classificationOptions.map((option) =>
        this.serializeClassificationOption(option),
      ),
      transactions: transactions.map((transaction) => {
        const payment = transaction.matchedPaymentId
          ? paymentMap.get(transaction.matchedPaymentId) || null
          : null;
        const matchedOrder =
          !payment && transaction.matchedOrderId
            ? orderMap.get(transaction.matchedOrderId) || null
            : null;
        return {
          id: transaction.id,
          latestImportId: transaction.latestImportId,
          externalId: transaction.externalId,
          bookedAt: transaction.bookedAt.toISOString(),
          amount: round2(transaction.amount),
          description: transaction.description,
          counterpartyName: transaction.counterpartyName,
          direction: transaction.direction as StatementDirection,
          transactionKind: transaction.transactionKind as StatementKind,
          category: (isStatementCategory(transaction.category)
            ? transaction.category
            : 'OTHER_EXPENSE') as StatementCategory,
          classificationCode: transaction.classificationCode,
          manualClassification: transaction.manualClassification,
          manualMatch: transaction.manualMatch,
          isOperational: transaction.isOperational,
          matchedPaymentId: transaction.matchedPaymentId,
          matchedOrderId: transaction.matchedOrderId,
          matchedPaymentLabel: this.formatMatchedPaymentLabel({
            orderId: payment?.order?.id ?? matchedOrder?.id ?? transaction.matchedOrderId,
            publicNumber:
              payment?.order?.publicNumber ?? matchedOrder?.publicNumber ?? transaction.matchedOrderId,
            customerName: payment?.order?.customer?.name ?? matchedOrder?.customer?.name ?? null,
          }),
        } satisfies BankStatementReviewTransaction;
      }),
    } satisfies BankStatementReviewSummary;
  }

  async getTransactionMatchCandidates(transactionId: number) {
    const transaction = await this.prisma.bankStatementTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) {
      throw new BadRequestException('Lançamento do extrato não encontrado.');
    }

    if (transaction.direction !== 'INFLOW') {
      return [] satisfies BankStatementMatchCandidate[];
    }

    const paymentCandidates = await this.paymentsService.listPixReconciliationCandidates({
      amount: Math.abs(transaction.amount),
      payerName: transaction.counterpartyName,
      currentPaymentId: transaction.matchedPaymentId,
    });

    const orderCandidates = await this.findLikelyOrderRevenueCandidates({
      amount: Math.abs(transaction.amount),
      counterpartyName: transaction.counterpartyName,
      bookedAt: transaction.bookedAt,
    });

    const candidates: BankStatementMatchCandidate[] = paymentCandidates.map((candidate) => ({
      matchType: 'PAYMENT',
      paymentId: candidate.paymentId,
      orderId: candidate.orderId,
      publicNumber: candidate.publicNumber,
      customerName: candidate.customerName,
      amount: candidate.amount,
      createdAt: candidate.createdAt,
      dueAt: candidate.dueAt,
      nameScore: candidate.nameScore,
      current: candidate.current,
      label:
        this.formatMatchedPaymentLabel({
          orderId: candidate.orderId,
          publicNumber: candidate.publicNumber,
          customerName: candidate.customerName,
        }) || `Pedido #${candidate.publicNumber}`,
    }));

    const paymentOrderIds = new Set(candidates.map((candidate) => candidate.orderId));
    for (const candidate of orderCandidates) {
      if (paymentOrderIds.has(candidate.orderId)) continue;
      candidates.push({
        matchType: 'ORDER',
        paymentId: null,
        orderId: candidate.orderId,
        publicNumber: candidate.publicNumber,
        customerName: candidate.customerName,
        amount: Math.abs(transaction.amount),
        createdAt: candidate.createdAt.toISOString(),
        dueAt: candidate.scheduledAt?.toISOString() ?? null,
        nameScore: Number(candidate.nameScore.toFixed(3)),
        current:
          transaction.matchedPaymentId == null &&
          transaction.matchedOrderId != null &&
          transaction.matchedOrderId === candidate.orderId,
        label:
          this.formatMatchedPaymentLabel({
            orderId: candidate.orderId,
            publicNumber: candidate.publicNumber,
            customerName: candidate.customerName,
          }) || `Pedido #${candidate.publicNumber}`,
      });
    }

    if (
      transaction.matchedPaymentId == null &&
      transaction.matchedOrderId != null &&
      !candidates.some((candidate) => candidate.orderId === transaction.matchedOrderId)
    ) {
      const order = await this.prisma.order.findUnique({
        where: { id: transaction.matchedOrderId },
        select: {
          id: true,
          publicNumber: true,
          createdAt: true,
          scheduledAt: true,
          customerName: true,
        },
      });
      if (order) {
        candidates.unshift({
          matchType: 'ORDER',
          paymentId: null,
          orderId: order.id,
          publicNumber: order.publicNumber ?? order.id,
          customerName: order.customerName || 'Cliente sem nome',
          amount: Math.abs(transaction.amount),
          createdAt: order.createdAt.toISOString(),
          dueAt: order.scheduledAt?.toISOString() ?? null,
          nameScore: 1,
          current: true,
          label:
            this.formatMatchedPaymentLabel({
              orderId: order.id,
              publicNumber: order.publicNumber ?? order.id,
              customerName: order.customerName || 'Cliente sem nome',
            }) || `Pedido #${order.publicNumber ?? order.id}`,
        });
      }
    }

    return candidates.sort((left, right) => {
      const currentDelta = Number(right.current) - Number(left.current);
      if (currentDelta !== 0) return currentDelta;
      const typeDelta = Number(left.matchType === 'PAYMENT') - Number(right.matchType === 'PAYMENT');
      if (typeDelta !== 0) return typeDelta;
      const scoreDelta = right.nameScore - left.nameScore;
      if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;
      return right.orderId - left.orderId;
    });
  }

  async updateTransaction(transactionId: number, input: UpdateStatementTransactionInput) {
    const transaction = await this.prisma.bankStatementTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) {
      throw new BadRequestException('Lançamento do extrato não encontrado.');
    }

    const payload = input as Record<string, unknown>;
    const hasClassificationInput = Object.prototype.hasOwnProperty.call(payload, 'classificationCode');
    const hasMatchInput = Object.prototype.hasOwnProperty.call(payload, 'matchedPaymentId');
    const hasOrderMatchInput = Object.prototype.hasOwnProperty.call(payload, 'matchedOrderId');
    const hasAnyMatchInput = hasMatchInput || hasOrderMatchInput;

    const classificationOptions = await this.ensureClassificationOptions();
    const classificationOptionMap = new Map(classificationOptions.map((option) => [option.code, option]));

    const selectedClassificationCode =
      hasClassificationInput && typeof input.classificationCode === 'string' && input.classificationCode.trim()
        ? input.classificationCode.trim().toUpperCase()
        : null;
    const selectedClassification = selectedClassificationCode
      ? classificationOptionMap.get(selectedClassificationCode) || null
      : null;

    if (selectedClassificationCode && !selectedClassification) {
      throw new BadRequestException('Classificação do extrato inválida.');
    }

    let nextMatchedPaymentId = transaction.matchedPaymentId;
    let nextMatchedOrderId = transaction.matchedOrderId;

    if (hasAnyMatchInput) {
      const requestedMatch =
        typeof input.matchedPaymentId === 'number' && Number.isInteger(input.matchedPaymentId)
          ? input.matchedPaymentId
          : null;
      const requestedOrderMatch =
        typeof input.matchedOrderId === 'number' && Number.isInteger(input.matchedOrderId)
          ? input.matchedOrderId
          : null;

      if (transaction.matchedPaymentId && transaction.matchedPaymentId !== requestedMatch) {
        await this.paymentsService.reopenPixPayment(transaction.matchedPaymentId);
      }

      if (requestedMatch != null && requestedOrderMatch != null) {
        throw new BadRequestException('Escolha apenas um match por lançamento.');
      }

      if (requestedMatch != null) {
        const duplicateTransaction = await this.prisma.bankStatementTransaction.findFirst({
          where: {
            matchedPaymentId: requestedMatch,
            id: { not: transactionId },
          },
          select: { id: true },
        });

        if (duplicateTransaction) {
          throw new BadRequestException('Este pagamento já está conciliado em outro lançamento.');
        }

        const settlement = await this.paymentsService.settlePixWebhook({
          paymentId: requestedMatch,
          amount: Math.abs(transaction.amount),
          paidAt: transaction.bookedAt.toISOString(),
          source: 'bank-statement-manual',
          metadata: {
            sourceTransactionId: transaction.externalId,
            description: transaction.description,
          },
        });

        nextMatchedPaymentId = requestedMatch;
        nextMatchedOrderId = settlement.payment.orderId;
      } else if (requestedOrderMatch != null) {
        const matchedOrder = await this.prisma.order.findUnique({
          where: { id: requestedOrderMatch },
          select: { id: true },
        });

        if (!matchedOrder) {
          throw new BadRequestException('Pedido do extrato não encontrado.');
        }

        nextMatchedPaymentId = null;
        nextMatchedOrderId = matchedOrder.id;
      } else {
        nextMatchedPaymentId = null;
        nextMatchedOrderId = null;
      }
    }

    const autoClassification = classifyStatementTransaction({
      externalId: transaction.externalId,
      bookedAt: transaction.bookedAt,
      amount: transaction.amount,
      description: transaction.description,
    });

    let nextClassificationCode = transaction.classificationCode || this.defaultClassificationCodeForCategory(
      isStatementCategory(transaction.category) ? transaction.category : autoClassification.category,
    );
    let nextCategory = isStatementCategory(transaction.category)
      ? transaction.category
      : autoClassification.category;
    let nextIsOperational = transaction.isOperational;
    let nextManualClassification = transaction.manualClassification;

    if (nextMatchedPaymentId != null || nextMatchedOrderId != null) {
      const salesClassification =
        selectedClassification && selectedClassification.baseCategory === 'SALES'
          ? selectedClassification
          : classificationOptionMap.get(this.defaultClassificationCodeForCategory('SALES')) || null;
      nextClassificationCode = salesClassification?.code || this.defaultClassificationCodeForCategory('SALES');
      nextCategory = 'SALES';
      nextIsOperational = true;
      if (hasClassificationInput) {
        nextManualClassification = true;
      }
    } else if (selectedClassification) {
      nextClassificationCode = selectedClassification.code;
      nextCategory = selectedClassification.baseCategory;
      nextIsOperational = selectedClassification.isOperational;
      nextManualClassification = true;
    } else if (hasAnyMatchInput && (transaction.matchedPaymentId != null || transaction.matchedOrderId != null)) {
      nextCategory = autoClassification.category;
      nextClassificationCode = this.defaultClassificationCodeForCategory(autoClassification.category);
      nextIsOperational = autoClassification.category === 'OWNER' ? false : autoClassification.isOperational;
      nextManualClassification = false;
    }

    await this.prisma.bankStatementTransaction.update({
      where: { id: transactionId },
      data: {
        category: nextCategory,
        classificationCode: nextClassificationCode,
        manualClassification: nextManualClassification,
        manualMatch: hasAnyMatchInput ? true : transaction.manualMatch,
        isOperational: nextIsOperational,
        matchedPaymentId: nextMatchedPaymentId,
        matchedOrderId: nextMatchedOrderId,
      },
    });

    if (transaction.latestImportId) {
      await this.syncImportMetrics(transaction.latestImportId);
    }

    return this.getReviewSummary();
  }

  async createClassificationOption(input: UpsertClassificationOptionInput) {
    const classificationOptions = await this.ensureClassificationOptions();
    const codeBase = slugifyClassificationCode(input.label);
    if (!codeBase) {
      throw new BadRequestException('Informe um nome válido para a classificação.');
    }

    let code = codeBase;
    let suffix = 2;
    while (await this.prisma.bankStatementClassificationOption.findUnique({ where: { code } })) {
      code = `${codeBase}_${suffix}`;
      suffix += 1;
    }

    const highestSortOrder =
      classificationOptions.reduce((max, option) => Math.max(max, option.sortOrder), 0) || 0;

    await this.prisma.bankStatementClassificationOption.create({
      data: {
        code,
        label: input.label.trim(),
        baseCategory: input.baseCategory,
        tone: deriveStatementTone(input.baseCategory),
        isOperational: input.baseCategory === 'OWNER' ? false : true,
        active: input.active ?? true,
        system: false,
        sortOrder: highestSortOrder + 10,
      },
    });

    return this.getReviewSummary();
  }

  async updateClassificationOption(optionId: number, input: UpsertClassificationOptionInput) {
    const existingOption = await this.prisma.bankStatementClassificationOption.findUnique({
      where: { id: optionId },
    });
    if (!existingOption) {
      throw new BadRequestException('Classificação do extrato não encontrada.');
    }

    const nextBaseCategory = input.baseCategory;
    const nextIsOperational = nextBaseCategory === 'OWNER' ? false : true;

    await this.prisma.bankStatementClassificationOption.update({
      where: { id: optionId },
      data: {
        label: input.label.trim(),
        baseCategory: nextBaseCategory,
        tone: deriveStatementTone(nextBaseCategory),
        isOperational: nextIsOperational,
        active: input.active ?? existingOption.active,
      },
    });

    await this.prisma.bankStatementTransaction.updateMany({
      where: {
        classificationCode: existingOption.code,
        matchedPaymentId: null,
      },
      data: {
        category: nextBaseCategory,
        isOperational: nextIsOperational,
      },
    });

    return this.getReviewSummary();
  }

  async loadDataset() {
    const [latestImport, transactions] = await Promise.all([
      this.prisma.bankStatementImport.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.bankStatementTransaction.findMany({
        orderBy: [{ bookedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return {
      latestImport,
      transactions,
    };
  }

  async getLatestImportSummary(asOf: Date, explicitImportId?: number) {
    const latestImport = explicitImportId
      ? await this.prisma.bankStatementImport.findUnique({ where: { id: explicitImportId } })
      : await this.prisma.bankStatementImport.findFirst({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });

    if (!latestImport) {
      return {
        status: 'PENDING',
        importedAt: null,
        fileName: null,
        fileKind: null,
        source: null,
        periodStart: null,
        periodEnd: null,
        transactionCount: 0,
        matchedPaymentsCount: 0,
        unmatchedInflowsCount: 0,
        inflowTotal: 0,
        outflowTotal: 0,
      } satisfies BankStatementLatestImportSummary;
    }

    return {
      status: buildStatementImportStatus(asOf, latestImport),
      importedAt: latestImport.createdAt.toISOString(),
      fileName: latestImport.fileName,
      fileKind: latestImport.fileKind,
      source: latestImport.sourceLabel || latestImport.source,
      periodStart: latestImport.periodStart?.toISOString() || null,
      periodEnd: latestImport.periodEnd?.toISOString() || null,
      transactionCount: latestImport.transactionCount,
      matchedPaymentsCount: latestImport.matchedPaymentsCount,
      unmatchedInflowsCount: latestImport.unmatchedInflowsCount,
      inflowTotal: round2(latestImport.inflowTotal),
      outflowTotal: round2(latestImport.outflowTotal),
    } satisfies BankStatementLatestImportSummary;
  }

  buildDashboardSummary(params: {
    asOf: Date;
    startsAt?: Date;
    latestImport: Awaited<ReturnType<BankStatementsService['loadDataset']>>['latestImport'];
    transactions: Awaited<ReturnType<BankStatementsService['loadDataset']>>['transactions'];
  }) {
    const { asOf, startsAt, latestImport, transactions } = params;
    const inRange = startsAt
      ? transactions.filter((entry) => entry.bookedAt.getTime() >= startsAt.getTime())
      : transactions;

    const dailyMap = new Map<string, BankStatementDailyEntry>();
    const categoryMap = new Map<
      StatementCategory,
      { amount: number; count: number }
    >();
    const unmatchedInflows: BankStatementUnmatchedInflow[] = [];

    const ensureDay = (date: string) => {
      const current = dailyMap.get(date);
      if (current) return current;
      const next: BankStatementDailyEntry = {
        date,
        bankInflow: 0,
        matchedRevenue: 0,
        actualExpenses: 0,
        ingredientExpenses: 0,
        deliveryExpenses: 0,
        packagingExpenses: 0,
        softwareExpenses: 0,
        marketplaceAdjustments: 0,
        netCashFlow: 0,
        unmatchedInflows: 0,
      };
      dailyMap.set(date, next);
      return next;
    };

    for (const transaction of inRange) {
      const dateKey = toDayKey(transaction.bookedAt);
      const day = ensureDay(dateKey);
      day.netCashFlow = round2(day.netCashFlow + transaction.amount);

      const categoryEntry = categoryMap.get(transaction.category as StatementCategory) || {
        amount: 0,
        count: 0,
      };
      categoryEntry.amount = round2(categoryEntry.amount + transaction.amount);
      categoryEntry.count += 1;
      categoryMap.set(transaction.category as StatementCategory, categoryEntry);

      if (transaction.amount > 0) {
        day.bankInflow = round2(day.bankInflow + transaction.amount);
      }

      if (transaction.category === 'SALES') {
        day.matchedRevenue = round2(day.matchedRevenue + Math.max(transaction.amount, 0));
      }

      if (transaction.category === 'UNMATCHED_INFLOW' && transaction.amount > 0) {
        day.unmatchedInflows = round2(day.unmatchedInflows + transaction.amount);
        unmatchedInflows.push({
          externalId: transaction.externalId,
          date: dateKey,
          amount: round2(transaction.amount),
          counterpartyName: transaction.counterpartyName,
          description: transaction.description,
        });
      }

      if (!transaction.isOperational) {
        continue;
      }

      if (transaction.amount < 0) {
        day.actualExpenses = round2(day.actualExpenses + Math.abs(transaction.amount));
      }

      if (transaction.category === 'INGREDIENTS') {
        day.ingredientExpenses = round2(day.ingredientExpenses + Math.max(-transaction.amount, 0));
      }
      if (transaction.category === 'DELIVERY') {
        day.deliveryExpenses = round2(day.deliveryExpenses + Math.max(-transaction.amount, 0) - Math.max(transaction.amount, 0));
      }
      if (transaction.category === 'PACKAGING') {
        day.packagingExpenses = round2(day.packagingExpenses + Math.max(-transaction.amount, 0));
      }
      if (transaction.category === 'SOFTWARE') {
        day.softwareExpenses = round2(day.softwareExpenses + Math.max(-transaction.amount, 0));
      }
      if (transaction.category === 'MARKETPLACE' || transaction.category === 'MARKETPLACE_REFUND') {
        day.marketplaceAdjustments = round2(day.marketplaceAdjustments + transaction.amount);
      }
    }

    const categories = [...categoryMap.entries()]
      .map(([key, entry]: [StatementCategory, { amount: number; count: number }]) => ({
        key,
        label: CATEGORY_LABELS[key],
        amount: round2(entry.amount),
        count: entry.count,
        tone: CATEGORY_TONES[key],
      }))
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));

    return {
      latestImport: latestImport
        ? {
            status: buildStatementImportStatus(asOf, latestImport),
            importedAt: latestImport.createdAt.toISOString(),
            fileName: latestImport.fileName,
            fileKind: latestImport.fileKind,
            source: latestImport.sourceLabel || latestImport.source,
            periodStart: latestImport.periodStart?.toISOString() || null,
            periodEnd: latestImport.periodEnd?.toISOString() || null,
            transactionCount: latestImport.transactionCount,
            matchedPaymentsCount: latestImport.matchedPaymentsCount,
            unmatchedInflowsCount: latestImport.unmatchedInflowsCount,
            inflowTotal: round2(latestImport.inflowTotal),
            outflowTotal: round2(latestImport.outflowTotal),
          }
        : {
            status: 'PENDING',
            importedAt: null,
            fileName: null,
            fileKind: null,
            source: null,
            periodStart: null,
            periodEnd: null,
            transactionCount: 0,
            matchedPaymentsCount: 0,
            unmatchedInflowsCount: 0,
            inflowTotal: 0,
            outflowTotal: 0,
          },
      dailySeries: [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      categories,
      unmatchedInflows: unmatchedInflows
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 12),
    } satisfies BankStatementDashboardSummary;
  }
}

export { STATEMENT_UPLOAD_MAX_BYTES };
export type { BankStatementDashboardSummary };
