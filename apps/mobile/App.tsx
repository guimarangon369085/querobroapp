import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import type { Customer, Order, OrderItem, Product } from '@querobroapp/shared';
import { apiFetch } from './src/lib/api';
import { formatCurrencyBR, formatPhoneBR, normalizePhone, parseCurrencyBR, titleCase } from './src/lib/format';

type TabKey = 'dashboard' | 'customers' | 'products' | 'orders';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [customerForm, setCustomerForm] = useState<Partial<Customer>>({ name: '', phone: '', address: '' });
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);

  const [productForm, setProductForm] = useState<Partial<Product>>({
    name: '',
    category: '',
    unit: 'un',
    price: 0,
    active: true
  });
  const [editingProductId, setEditingProductId] = useState<number | null>(null);

  const [orderCustomerId, setOrderCustomerId] = useState<number | null>(null);
  const [orderItems, setOrderItems] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [orderNotes, setOrderNotes] = useState('');
  const [orderProductId, setOrderProductId] = useState<number | null>(null);
  const [orderQty, setOrderQty] = useState('1');
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [showProductList, setShowProductList] = useState(false);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const orderSubtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      const price = productMap.get(item.productId)?.price ?? 0;
      return sum + price * item.quantity;
    }, 0);
  }, [orderItems, productMap]);
  const orderDiscountValue = Math.max(parseCurrencyBR(orderDiscount), 0);
  const orderTotal = Math.max(orderSubtotal - orderDiscountValue, 0);

  const loadAll = async () => {
    const [customersData, productsData, ordersData] = await Promise.all([
      apiFetch<Customer[]>('/customers'),
      apiFetch<Product[]>('/products'),
      apiFetch<Order[]>('/orders')
    ]);
    setCustomers(customersData);
    setProducts(productsData);
    setOrders(ordersData);
  };

  useEffect(() => {
    loadAll().catch((err) => Alert.alert('Erro', String(err)));
  }, []);

  const saveCustomer = async () => {
    if (!customerForm.name || customerForm.name.trim().length < 2) {
      Alert.alert('Validacao', 'Informe um nome valido.');
      return;
    }
    const payload = {
      ...customerForm,
      name: titleCase(customerForm.name || ''),
      phone: normalizePhone(customerForm.phone || '') || undefined,
      address: customerForm.address ? titleCase(customerForm.address) : undefined
    };

    if (editingCustomerId) {
      await apiFetch(`/customers/${editingCustomerId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/customers', { method: 'POST', body: JSON.stringify(payload) });
    }
    setCustomerForm({ name: '', phone: '', address: '' });
    setEditingCustomerId(null);
    await loadAll();
  };

  const editCustomer = (customer: Customer) => {
    setEditingCustomerId(customer.id!);
    setCustomerForm({
      name: customer.name,
      phone: formatPhoneBR(customer.phone ?? ''),
      address: customer.address ?? ''
    });
    setActiveTab('customers');
  };

  const removeCustomer = async (id: number) => {
    await apiFetch(`/customers/${id}`, { method: 'DELETE' });
    await loadAll();
  };

  const saveProduct = async () => {
    if (!productForm.name || productForm.name.trim().length < 2) {
      Alert.alert('Validacao', 'Informe um nome valido.');
      return;
    }
    if ((productForm.price ?? 0) < 0) {
      Alert.alert('Validacao', 'Preco nao pode ser negativo.');
      return;
    }
    const payload = {
      ...productForm,
      name: titleCase(productForm.name || ''),
      category: productForm.category ? titleCase(productForm.category) : undefined,
      unit: productForm.unit ? productForm.unit.trim().toLowerCase() : 'un',
      price: Math.round((productForm.price ?? 0) * 100) / 100
    };

    if (editingProductId) {
      await apiFetch(`/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/products', { method: 'POST', body: JSON.stringify(payload) });
    }
    setProductForm({ name: '', category: '', unit: 'un', price: 0, active: true });
    setEditingProductId(null);
    await loadAll();
  };

  const editProduct = (product: Product) => {
    setEditingProductId(product.id!);
    setProductForm({
      name: product.name,
      category: product.category ?? '',
      unit: product.unit ?? 'un',
      price: product.price,
      active: product.active
    });
    setActiveTab('products');
  };

  const removeProduct = async (id: number) => {
    await apiFetch(`/products/${id}`, { method: 'DELETE' });
    await loadAll();
  };

  const addOrderItem = () => {
    if (!orderProductId) return;
    const qty = Number(orderQty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setOrderItems((prev) => [...prev, { productId: orderProductId, quantity: qty }]);
    setOrderProductId(null);
    setProductSearch('');
    setOrderQty('1');
  };

  const createOrder = async () => {
    if (!orderCustomerId || orderItems.length === 0) {
      Alert.alert('Validacao', 'Selecione cliente e ao menos um item.');
      return;
    }
    await apiFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerId: orderCustomerId,
        items: orderItems,
        discount: orderDiscountValue,
        notes: orderNotes || undefined
      })
    });
    setOrderCustomerId(null);
    setOrderItems([]);
    setOrderDiscount('0');
    setOrderNotes('');
    setCustomerSearch('');
    await loadAll();
  };

  const selectCustomer = (customer: Customer) => {
    setOrderCustomerId(customer.id!);
    setCustomerSearch(customer.name);
    setShowCustomerList(false);
  };

  const selectProduct = (product: Product) => {
    setOrderProductId(product.id!);
    setProductSearch(product.name);
    setShowProductList(false);
  };

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );
  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>QuerobroApp</Text>
        <Text style={styles.subtitle}>Mobile ERP</Text>
      </View>

      <View style={styles.tabs}>
        {[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'customers', label: 'Clientes' },
          { key: 'products', label: 'Produtos' },
          { key: 'orders', label: 'Pedidos' }
        ].map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key as TabKey)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'dashboard' && (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.cardRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Clientes</Text>
              <Text style={styles.cardValue}>{customers.length}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Produtos</Text>
              <Text style={styles.cardValue}>{products.length}</Text>
            </View>
          </View>
          <View style={styles.cardRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Pedidos</Text>
              <Text style={styles.cardValue}>{orders.length}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Receita (total)</Text>
              <Text style={styles.cardValue}>
                {formatCurrencyBR(orders.reduce((sum, o) => sum + (o.total ?? 0), 0))}
              </Text>
            </View>
          </View>
          <Text style={styles.sectionTitle}>Ultimos pedidos</Text>
          {orders.slice(0, 3).map((order) => (
            <View key={order.id} style={styles.listItem}>
              <Text style={styles.listTitle}>Pedido #{order.id}</Text>
              <Text style={styles.listSubtitle}>
                {order.status} • {formatCurrencyBR(order.total)}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      {activeTab === 'customers' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.sectionTitle}>Cadastro rapido</Text>
          <View style={styles.formCard}>
            <TextInput
              style={styles.input}
              placeholder="Nome completo"
              value={customerForm.name || ''}
              onChangeText={(text) => setCustomerForm((prev) => ({ ...prev, name: text }))}
              onBlur={() =>
                setCustomerForm((prev) => ({ ...prev, name: titleCase(prev.name || '') }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder="Telefone"
              keyboardType="phone-pad"
              value={customerForm.phone || ''}
              onChangeText={(text) =>
                setCustomerForm((prev) => ({ ...prev, phone: formatPhoneBR(text) }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder="Endereco"
              value={customerForm.address || ''}
              onChangeText={(text) => setCustomerForm((prev) => ({ ...prev, address: text }))}
              onBlur={() =>
                setCustomerForm((prev) => ({ ...prev, address: titleCase(prev.address || '') }))
              }
            />
            <Pressable style={styles.primaryButton} onPress={saveCustomer}>
              <Text style={styles.primaryButtonText}>{editingCustomerId ? 'Atualizar' : 'Salvar'}</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Lista de clientes</Text>
          <FlatList
            data={customers}
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.listItem}>
                <View>
                  <Text style={styles.listTitle}>{item.name}</Text>
                  <Text style={styles.listSubtitle}>
                    {formatPhoneBR(item.phone) || 'Sem telefone'} • {item.address || 'Sem endereco'}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Pressable style={styles.secondaryButton} onPress={() => editCustomer(item)}>
                    <Text style={styles.secondaryButtonText}>Editar</Text>
                  </Pressable>
                  <Pressable style={styles.dangerButton} onPress={() => removeCustomer(item.id!)}>
                    <Text style={styles.dangerButtonText}>Remover</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </ScrollView>
      )}

      {activeTab === 'products' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.sectionTitle}>Cadastro rapido</Text>
          <View style={styles.formCard}>
            <TextInput
              style={styles.input}
              placeholder="Nome do produto"
              value={productForm.name || ''}
              onChangeText={(text) => setProductForm((prev) => ({ ...prev, name: text }))}
              onBlur={() =>
                setProductForm((prev) => ({ ...prev, name: titleCase(prev.name || '') }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder="Categoria"
              value={productForm.category || ''}
              onChangeText={(text) => setProductForm((prev) => ({ ...prev, category: text }))}
              onBlur={() =>
                setProductForm((prev) => ({ ...prev, category: titleCase(prev.category || '') }))
              }
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="Unidade"
                value={productForm.unit || ''}
                onChangeText={(text) => setProductForm((prev) => ({ ...prev, unit: text }))}
              />
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="Preco"
                keyboardType="decimal-pad"
                value={String(productForm.price ?? 0)}
                onChangeText={(text) => setProductForm((prev) => ({ ...prev, price: parseCurrencyBR(text) }))}
              />
            </View>
            <Pressable style={styles.primaryButton} onPress={saveProduct}>
              <Text style={styles.primaryButtonText}>{editingProductId ? 'Atualizar' : 'Salvar'}</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Lista de produtos</Text>
          <FlatList
            data={products}
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.listItem}>
                <View>
                  <Text style={styles.listTitle}>{item.name}</Text>
                  <Text style={styles.listSubtitle}>
                    {item.category || 'Sem categoria'} • {item.unit || 'un'} • {formatCurrencyBR(item.price)}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Pressable style={styles.secondaryButton} onPress={() => editProduct(item)}>
                    <Text style={styles.secondaryButtonText}>Editar</Text>
                  </Pressable>
                  <Pressable style={styles.dangerButton} onPress={() => removeProduct(item.id!)}>
                    <Text style={styles.dangerButtonText}>Remover</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </ScrollView>
      )}

      {activeTab === 'orders' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.sectionTitle}>Novo pedido</Text>
          <View style={styles.formCard}>
            <Pressable style={styles.selectInput} onPress={() => setShowCustomerList((prev) => !prev)}>
              <Text style={styles.selectLabel}>
                {orderCustomerId
                  ? customers.find((c) => c.id === orderCustomerId)?.name
                  : 'Selecionar cliente'}
              </Text>
            </Pressable>
            {showCustomerList && (
              <View style={styles.selector}>
                <TextInput
                  style={styles.input}
                  placeholder="Buscar cliente"
                  value={customerSearch}
                  onChangeText={(text) => setCustomerSearch(text)}
                />
                <FlatList
                  data={filteredCustomers}
                  keyExtractor={(item) => String(item.id)}
                  style={styles.selectorList}
                  renderItem={({ item }) => (
                    <Pressable style={styles.selectorItem} onPress={() => selectCustomer(item)}>
                      <Text>{item.name}</Text>
                    </Pressable>
                  )}
                />
              </View>
            )}

            <Pressable style={styles.selectInput} onPress={() => setShowProductList((prev) => !prev)}>
              <Text style={styles.selectLabel}>
                {orderProductId ? products.find((p) => p.id === orderProductId)?.name : 'Selecionar produto'}
              </Text>
            </Pressable>
            {showProductList && (
              <View style={styles.selector}>
                <TextInput
                  style={styles.input}
                  placeholder="Buscar produto"
                  value={productSearch}
                  onChangeText={(text) => setProductSearch(text)}
                />
                <FlatList
                  data={filteredProducts}
                  keyExtractor={(item) => String(item.id)}
                  style={styles.selectorList}
                  renderItem={({ item }) => (
                    <Pressable style={styles.selectorItem} onPress={() => selectProduct(item)}>
                      <Text>{item.name}</Text>
                    </Pressable>
                  )}
                />
              </View>
            )}

            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="Quantidade"
                keyboardType="number-pad"
                value={orderQty}
                onChangeText={(text) => setOrderQty(text)}
              />
              <Pressable style={[styles.secondaryButton, styles.halfButton]} onPress={addOrderItem}>
                <Text style={styles.secondaryButtonText}>Adicionar</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Desconto (R$)"
              keyboardType="decimal-pad"
              value={orderDiscount}
              onChangeText={(text) => setOrderDiscount(text)}
            />
            <TextInput
              style={styles.input}
              placeholder="Observacoes"
              value={orderNotes}
              onChangeText={(text) => setOrderNotes(text)}
            />

            {orderItems.length > 0 && (
              <View style={styles.summary}>
                {orderItems.map((item, index) => {
                  const product = productMap.get(item.productId);
                  const total = (product?.price ?? 0) * item.quantity;
                  return (
                    <View key={`${item.productId}-${index}`} style={styles.summaryRow}>
                      <Text>{product?.name ?? `Produto ${item.productId}`}</Text>
                      <Text>{formatCurrencyBR(total)}</Text>
                    </View>
                  );
                })}
                <View style={styles.summaryRow}>
                  <Text>Subtotal</Text>
                  <Text>{formatCurrencyBR(orderSubtotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text>Desconto</Text>
                  <Text>{formatCurrencyBR(orderDiscountValue)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text>Total</Text>
                  <Text>{formatCurrencyBR(orderTotal)}</Text>
                </View>
              </View>
            )}

            <Pressable style={styles.primaryButton} onPress={createOrder}>
              <Text style={styles.primaryButtonText}>Criar pedido</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Pedidos recentes</Text>
          <FlatList
            data={orders}
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.listItem}>
                <Text style={styles.listTitle}>Pedido #{item.id}</Text>
                <Text style={styles.listSubtitle}>
                  {item.status} • {formatCurrencyBR(item.total)}
                </Text>
                <Text style={styles.listSubtitle}>
                  Itens: {(item.items as OrderItem[] | undefined)?.length ?? 0}
                </Text>
              </View>
            )}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f4ef'
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1f1f1f'
  },
  subtitle: {
    fontSize: 14,
    color: '#6b6b6b'
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e3ded4',
    backgroundColor: '#fff'
  },
  tabActive: {
    backgroundColor: '#1f1f1f',
    borderColor: '#1f1f1f'
  },
  tabText: {
    fontSize: 12,
    color: '#1f1f1f'
  },
  tabTextActive: {
    color: '#fff'
  },
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 40
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f1f1f'
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12
  },
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ece5d8'
  },
  cardLabel: {
    fontSize: 12,
    color: '#6b6b6b'
  },
  cardValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f1f1f',
    marginTop: 4
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#ece5d8'
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e6e0d6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1f1f1f'
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'
  },
  halfInput: {
    flex: 1
  },
  halfButton: {
    flex: 1,
    alignItems: 'center'
  },
  primaryButton: {
    backgroundColor: '#1f1f1f',
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600'
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d6cfc2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  secondaryButtonText: {
    color: '#1f1f1f',
    fontSize: 12
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#f1c2c2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  dangerButtonText: {
    color: '#b23030',
    fontSize: 12
  },
  listItem: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee6d8',
    gap: 6
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f1f1f'
  },
  listSubtitle: {
    fontSize: 12,
    color: '#6b6b6b'
  },
  selectInput: {
    borderWidth: 1,
    borderColor: '#e6e0d6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff'
  },
  selectLabel: {
    color: '#1f1f1f',
    fontSize: 14
  },
  selector: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ece5d8',
    padding: 8,
    gap: 8
  },
  selectorList: {
    maxHeight: 160
  },
  selectorItem: {
    paddingVertical: 8,
    paddingHorizontal: 6
  },
  summary: {
    gap: 6,
    backgroundColor: '#f6f4ef',
    borderRadius: 12,
    padding: 12
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  }
});
