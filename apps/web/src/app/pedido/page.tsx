import type { Metadata } from 'next';
import { PublicOrderPage } from './public-order-page';

export const metadata: Metadata = {
  title: 'Fazer pedido | QUEROBROAPP',
  description: 'Pagina publica para o cliente montar o pedido e receber o PIX.'
};

export default function PedidoPage() {
  return <PublicOrderPage />;
}
