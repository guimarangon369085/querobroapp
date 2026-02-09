import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { openDb } from './db.js';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

const db = await openDb();

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Produtos
app.get('/produtos', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT * FROM products ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/produtos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const row = await db.get('SELECT * FROM products WHERE id = ?', id);
    if (!row) return res.status(404).json({ error: 'produto não encontrado' });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

app.post('/produtos', async (req, res, next) => {
  try {
    const { name, description = null, price, stock = 0 } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name é obrigatório' });
    }
    if (price === undefined || Number(price) < 0) {
      return res.status(400).json({ error: 'price inválido' });
    }
    if (!Number.isInteger(Number(stock)) || Number(stock) < 0) {
      return res.status(400).json({ error: 'stock inválido' });
    }

    const result = await db.run(
      'INSERT INTO products (name, description, price, stock) VALUES (?, ?, ?, ?)',
      name.trim(),
      description,
      Number(price),
      Number(stock)
    );
    const created = await db.get('SELECT * FROM products WHERE id = ?', result.lastID);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

app.put('/produtos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const current = await db.get('SELECT * FROM products WHERE id = ?', id);
    if (!current) return res.status(404).json({ error: 'produto não encontrado' });

    const { name, description, price, stock } = req.body || {};
    const nextName = name !== undefined ? String(name).trim() : current.name;
    const nextDescription = description !== undefined ? description : current.description;
    const nextPrice = price !== undefined ? Number(price) : current.price;
    const nextStock = stock !== undefined ? Number(stock) : current.stock;

    if (!nextName) return res.status(400).json({ error: 'name inválido' });
    if (Number.isNaN(nextPrice) || nextPrice < 0) return res.status(400).json({ error: 'price inválido' });
    if (!Number.isInteger(nextStock) || nextStock < 0) return res.status(400).json({ error: 'stock inválido' });

    await db.run(
      'UPDATE products SET name = ?, description = ?, price = ?, stock = ? WHERE id = ?',
      nextName,
      nextDescription,
      nextPrice,
      nextStock,
      id
    );

    const updated = await db.get('SELECT * FROM products WHERE id = ?', id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/produtos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const result = await db.run('DELETE FROM products WHERE id = ?', id);
    if (result.changes === 0) return res.status(404).json({ error: 'produto não encontrado' });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Clientes
app.get('/clientes', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT * FROM clients ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/clientes/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const row = await db.get('SELECT * FROM clients WHERE id = ?', id);
    if (!row) return res.status(404).json({ error: 'cliente não encontrado' });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

app.post('/clientes', async (req, res, next) => {
  try {
    const { name, email = null, phone = null } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    const result = await db.run(
      'INSERT INTO clients (name, email, phone) VALUES (?, ?, ?)',
      name.trim(),
      email,
      phone
    );
    const created = await db.get('SELECT * FROM clients WHERE id = ?', result.lastID);
    res.status(201).json(created);
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'email já cadastrado' });
    }
    next(err);
  }
});

app.put('/clientes/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const current = await db.get('SELECT * FROM clients WHERE id = ?', id);
    if (!current) return res.status(404).json({ error: 'cliente não encontrado' });

    const { name, email, phone } = req.body || {};
    const nextName = name !== undefined ? String(name).trim() : current.name;
    const nextEmail = email !== undefined ? email : current.email;
    const nextPhone = phone !== undefined ? phone : current.phone;

    if (!nextName) return res.status(400).json({ error: 'name inválido' });

    await db.run(
      'UPDATE clients SET name = ?, email = ?, phone = ? WHERE id = ?',
      nextName,
      nextEmail,
      nextPhone,
      id
    );

    const updated = await db.get('SELECT * FROM clients WHERE id = ?', id);
    res.json(updated);
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'email já cadastrado' });
    }
    next(err);
  }
});

app.delete('/clientes/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const result = await db.run('DELETE FROM clients WHERE id = ?', id);
    if (result.changes === 0) return res.status(404).json({ error: 'cliente não encontrado' });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Pedidos
app.get('/pedidos', async (req, res, next) => {
  try {
    const orders = await db.all('SELECT * FROM orders ORDER BY id DESC');
    const ids = orders.map((o) => o.id);
    let itemsByOrder = {};
    if (ids.length) {
      const items = await db.all(
        `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      itemsByOrder = items.reduce((acc, item) => {
        acc[item.order_id] = acc[item.order_id] || [];
        acc[item.order_id].push(item);
        return acc;
      }, {});
    }
    res.json(orders.map((o) => ({ ...o, items: itemsByOrder[o.id] || [] })));
  } catch (err) {
    next(err);
  }
});

app.get('/pedidos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
    if (!order) return res.status(404).json({ error: 'pedido não encontrado' });

    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', id);
    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
});

app.post('/pedidos', async (req, res, next) => {
  try {
    const { client_id, items = [] } = req.body || {};
    const clientId = parseId(client_id);
    if (!clientId) return res.status(400).json({ error: 'client_id inválido' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items é obrigatório' });
    }

    const client = await db.get('SELECT * FROM clients WHERE id = ?', clientId);
    if (!client) return res.status(404).json({ error: 'cliente não encontrado' });

    await db.exec('BEGIN');
    try {
      const orderResult = await db.run(
        'INSERT INTO orders (client_id, status, total) VALUES (?, ?, ?)',
        clientId,
        'aberto',
        0
      );
      const orderId = orderResult.lastID;

      let total = 0;
      for (const item of items) {
        const productId = parseId(item.product_id);
        const quantity = Number(item.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
          throw new Error('item inválido');
        }
        const product = await db.get('SELECT * FROM products WHERE id = ?', productId);
        if (!product) throw new Error('produto não encontrado');

        const price = Number(product.price);
        total += price * quantity;

        await db.run(
          'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
          orderId,
          productId,
          quantity,
          price
        );
      }

      await db.run('UPDATE orders SET total = ? WHERE id = ?', total, orderId);
      await db.exec('COMMIT');

      const created = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
      const createdItems = await db.all('SELECT * FROM order_items WHERE order_id = ?', orderId);
      res.status(201).json({ ...created, items: createdItems });
    } catch (err) {
      await db.exec('ROLLBACK');
      if (err.message === 'item inválido') {
        return res.status(400).json({ error: 'item inválido' });
      }
      if (err.message === 'produto não encontrado') {
        return res.status(404).json({ error: 'produto não encontrado' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

app.put('/pedidos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
    if (!order) return res.status(404).json({ error: 'pedido não encontrado' });

    const { status, items } = req.body || {};

    await db.exec('BEGIN');
    try {
      let total = order.total;
      if (Array.isArray(items)) {
        await db.run('DELETE FROM order_items WHERE order_id = ?', id);
        total = 0;
        for (const item of items) {
          const productId = parseId(item.product_id);
          const quantity = Number(item.quantity);
          if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
            throw new Error('item inválido');
          }
          const product = await db.get('SELECT * FROM products WHERE id = ?', productId);
          if (!product) throw new Error('produto não encontrado');

          const price = Number(product.price);
          total += price * quantity;

          await db.run(
            'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
            id,
            productId,
            quantity,
            price
          );
        }
      }

      const nextStatus = status !== undefined ? String(status).trim() : order.status;
      await db.run('UPDATE orders SET status = ?, total = ? WHERE id = ?', nextStatus, total, id);

      await db.exec('COMMIT');
      const updated = await db.get('SELECT * FROM orders WHERE id = ?', id);
      const updatedItems = await db.all('SELECT * FROM order_items WHERE order_id = ?', id);
      res.json({ ...updated, items: updatedItems });
    } catch (err) {
      await db.exec('ROLLBACK');
      if (err.message === 'item inválido') {
        return res.status(400).json({ error: 'item inválido' });
      }
      if (err.message === 'produto não encontrado') {
        return res.status(404).json({ error: 'produto não encontrado' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

app.delete('/pedidos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const result = await db.run('DELETE FROM orders WHERE id = ?', id);
    if (result.changes === 0) return res.status(404).json({ error: 'pedido não encontrado' });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Pagamentos
app.get('/pagamentos', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT * FROM payments ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/pagamentos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const row = await db.get('SELECT * FROM payments WHERE id = ?', id);
    if (!row) return res.status(404).json({ error: 'pagamento não encontrado' });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

app.post('/pagamentos', async (req, res, next) => {
  try {
    const { order_id, amount, method, status = 'pendente', paid_at = null } = req.body || {};
    const orderId = parseId(order_id);
    if (!orderId) return res.status(400).json({ error: 'order_id inválido' });
    if (amount === undefined || Number(amount) < 0) return res.status(400).json({ error: 'amount inválido' });
    if (!method || typeof method !== 'string') return res.status(400).json({ error: 'method é obrigatório' });

    const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) return res.status(404).json({ error: 'pedido não encontrado' });

    const result = await db.run(
      'INSERT INTO payments (order_id, amount, method, status, paid_at) VALUES (?, ?, ?, ?, ?)',
      orderId,
      Number(amount),
      method.trim(),
      String(status).trim(),
      paid_at
    );

    const created = await db.get('SELECT * FROM payments WHERE id = ?', result.lastID);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

app.put('/pagamentos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const current = await db.get('SELECT * FROM payments WHERE id = ?', id);
    if (!current) return res.status(404).json({ error: 'pagamento não encontrado' });

    const { amount, method, status, paid_at } = req.body || {};
    const nextAmount = amount !== undefined ? Number(amount) : current.amount;
    const nextMethod = method !== undefined ? String(method).trim() : current.method;
    const nextStatus = status !== undefined ? String(status).trim() : current.status;
    const nextPaidAt = paid_at !== undefined ? paid_at : current.paid_at;

    if (Number.isNaN(nextAmount) || nextAmount < 0) return res.status(400).json({ error: 'amount inválido' });
    if (!nextMethod) return res.status(400).json({ error: 'method inválido' });

    await db.run(
      'UPDATE payments SET amount = ?, method = ?, status = ?, paid_at = ? WHERE id = ?',
      nextAmount,
      nextMethod,
      nextStatus,
      nextPaidAt,
      id
    );

    const updated = await db.get('SELECT * FROM payments WHERE id = ?', id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/pagamentos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const result = await db.run('DELETE FROM payments WHERE id = ?', id);
    if (result.changes === 0) return res.status(404).json({ error: 'pagamento não encontrado' });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'erro interno' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`API rodando na porta ${port}`);
});
