import { redirect } from 'next/navigation';

export default function ProductsPage() {
  redirect('/estoque?focus=bom');
}
