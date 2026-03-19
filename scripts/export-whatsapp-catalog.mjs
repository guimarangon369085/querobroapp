import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = new URL('..', import.meta.url);
const outputDir = new URL('../output/whatsapp-catalog/', import.meta.url);
const publicBaseUrl = String(process.env.WHATSAPP_CATALOG_PUBLIC_BASE_URL || 'https://querobroa.com.br').trim().replace(/\/+$/, '');
const orderUrl = `${publicBaseUrl}/pedido`;

const items = [
  {
    id: 'QUEROBROA-T',
    code: 'T',
    title: 'Caixa Tradicional',
    description: '1 caixa com 7 broas tradicionais.',
    price: '40.00 BRL',
    imagePath: '/querobroa-brand/cardapio/tradicional.jpg'
  },
  {
    id: 'QUEROBROA-G',
    code: 'G',
    title: 'Caixa Goiabada',
    description: '1 caixa com 7 broas de goiabada.',
    price: '50.00 BRL',
    imagePath: '/querobroa-brand/cardapio/goiabada.jpg'
  },
  {
    id: 'QUEROBROA-D',
    code: 'D',
    title: 'Caixa Doce de Leite',
    description: '1 caixa com 7 broas de doce de leite.',
    price: '52.00 BRL',
    imagePath: '/querobroa-brand/cardapio/doce-de-leite.jpg'
  },
  {
    id: 'QUEROBROA-Q',
    code: 'Q',
    title: 'Caixa Queijo do Serro',
    description: '1 caixa com 7 broas de queijo do Serro.',
    price: '52.00 BRL',
    imagePath: '/querobroa-brand/cardapio/queijo-do-serro-camadas.jpg'
  },
  {
    id: 'QUEROBROA-R',
    code: 'R',
    title: 'Caixa Requeijão de Corte',
    description: '1 caixa com 7 broas de requeijão de corte.',
    price: '52.00 BRL',
    imagePath: '/querobroa-brand/cardapio/requeijao-de-corte.jpg'
  },
  {
    id: 'QUEROBROA-MG',
    code: 'MG',
    title: 'Caixa Mista Goiabada',
    description: '1 caixa com 4 broas tradicionais e 3 de goiabada.',
    price: '45.00 BRL',
    imagePath: '/querobroa-brand/cardapio/mista-goiabada.jpg'
  },
  {
    id: 'QUEROBROA-MD',
    code: 'MD',
    title: 'Caixa Mista Doce de Leite',
    description: '1 caixa com 4 broas tradicionais e 3 de doce de leite.',
    price: '47.00 BRL',
    imagePath: '/querobroa-brand/cardapio/mista-doce-de-leite.jpg'
  },
  {
    id: 'QUEROBROA-MQ',
    code: 'MQ',
    title: 'Caixa Mista Queijo do Serro',
    description: '1 caixa com 4 broas tradicionais e 3 de queijo do Serro.',
    price: '47.00 BRL',
    imagePath: '/querobroa-brand/cardapio/mista-queijo-do-serro.jpg'
  },
  {
    id: 'QUEROBROA-MR',
    code: 'MR',
    title: 'Caixa Mista Requeijão de Corte',
    description: '1 caixa com 4 broas tradicionais e 3 de requeijão de corte.',
    price: '47.00 BRL',
    imagePath: '/querobroa-brand/cardapio/mista-requeijao-de-corte.jpg'
  }
];

function csvEscape(value) {
  const raw = String(value ?? '');
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

const rows = items.map((item) => ({
  id: item.id,
  title: item.title,
  description: item.description,
  availability: 'in stock',
  condition: 'new',
  price: item.price,
  link: `${orderUrl}?catalog=${encodeURIComponent(item.code)}`,
  image_link: `${publicBaseUrl}${item.imagePath}`,
  brand: 'QUEROBROA'
}));

const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const csv = [header.join(','), ...rows.map((row) => header.map((field) => csvEscape(row[field])).join(','))].join('\n');

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(new URL('meta-catalog.csv', outputDir), `${csv}\n`, 'utf8');
await fs.writeFile(new URL('meta-catalog.json', outputDir), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
await fs.writeFile(
  new URL('README.txt', outputDir),
  [
    'Arquivos gerados a partir do catalogo oficial da QUEROBROA.',
    '',
    `Base publica usada: ${publicBaseUrl}`,
    `Link de pedido: ${orderUrl}`,
    '',
    'Arquivos:',
    '- meta-catalog.csv',
    '- meta-catalog.json'
  ].join('\n'),
  'utf8'
);

console.log(`Catalogo exportado em ${path.resolve(new URL('.', outputDir).pathname)}`);
