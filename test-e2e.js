import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:5001';
const ADMIN_PIN = '1234';

async function runTests() {
  console.log('🚀 Running Comprehensive Event Order System Tests...\n');

  // 1. Check Settings
  console.log('1. Testing GET /api/settings...');
  const settingsRes = await fetch(`${BASE_URL}/api/settings`);
  assert.strictEqual(settingsRes.status, 200);
  const settings = await settingsRes.json();
  assert.ok(settings.eventName);
  console.log('   ✓ Settings loaded:', settings.eventName);

  // 2. Check Products
  console.log('\n2. Testing GET /api/products...');
  const productsRes = await fetch(`${BASE_URL}/api/products`);
  assert.strictEqual(productsRes.status, 200);
  const products = await productsRes.json();
  assert.ok(products.length >= 6, 'Should have initial seed products');
  console.log(`   ✓ Found ${products.length} products`);

  // 3. Customer Place Order
  console.log('\n3. Testing POST /api/orders (Customer Checkout)...');
  const testOrderPayload = {
    customerName: 'Aarav Patel',
    customerPhone: '+919876543210',
    items: [
      { id: products[0].id, quantity: 2 },
      { id: products[2].id, quantity: 1 }
    ],
    notes: 'Extra spicy please!'
  };

  const orderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testOrderPayload)
  });

  assert.strictEqual(orderRes.status, 201);
  const order = await orderRes.json();
  assert.ok(order.id);
  assert.ok(order.orderNumber >= 101);
  assert.strictEqual(order.status, 'pending');
  assert.strictEqual(order.customerName, 'Aarav Patel');
  console.log(`   ✓ Order placed successfully! Token: #${order.orderNumber} (ID: ${order.id})`);

  // 4. Verify Single Order Query (for customer tracking)
  console.log('\n4. Testing GET /api/orders/:id (Live Tracker with Token)...');
  const trackRes = await fetch(`${BASE_URL}/api/orders/${order.id}`, {
    headers: { 'x-order-token': order.accessToken }
  });
  assert.strictEqual(trackRes.status, 200);
  const trackedOrder = await trackRes.json();
  assert.strictEqual(trackedOrder.orderNumber, order.orderNumber);
  console.log(`   ✓ Order status retrieved: ${trackedOrder.status}`);

  // 5. Admin Status Transitions
  console.log('\n5. Testing PATCH /api/orders/:id/status (Admin Kitchen Workflow)...');
  
  // Pending -> Preparing
  let statusRes = await fetch(`${BASE_URL}/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({ status: 'preparing' })
  });
  assert.strictEqual(statusRes.status, 200);
  let updated = await statusRes.json();
  assert.strictEqual(updated.status, 'preparing');
  console.log('   ✓ Status updated to PREPARING');

  // Preparing -> Ready
  statusRes = await fetch(`${BASE_URL}/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({ status: 'ready' })
  });
  assert.strictEqual(statusRes.status, 200);
  updated = await statusRes.json();
  assert.strictEqual(updated.status, 'ready');
  console.log('   ✓ Status updated to READY (WhatsApp message triggerable)');

  // 6. Test WhatsApp Message Structure
  const waPhone = updated.customerPhone.replace(/\D/g, '');
  const itemsText = updated.items.map(i => `  • ${i.quantity}x ${i.name}`).join('\n');
  const sampleMsg = `*SpoonUp* ✨ *Order Ready for Pickup!* 🟢\n\nHi *${updated.customerName}*, your order is freshly prepared and ready for pickup.\n\n🧾 *Order #${updated.orderNumber}*\n${itemsText}\n\n✅ *Total:* ₹${updated.totalAmount}\n📍 *Pickup Counter:* ${updated.counterName}\n\n_Real Food. Real Nutrition. Real Goodness._\n_Please show this message at the counter to collect your order. Enjoy!_ ✨`;
  const waUrl = `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(sampleMsg)}`;
  assert.ok(waUrl.includes('https://api.whatsapp.com/send?phone=919876543210'));
  console.log('   ✓ WhatsApp URL Generated cleanly with minimal emojis:\n     ', waUrl.slice(0, 80) + '...');

  // 7. Ready -> Completed
  statusRes = await fetch(`${BASE_URL}/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({ status: 'completed' })
  });
  assert.strictEqual(statusRes.status, 200);
  updated = await statusRes.json();
  assert.strictEqual(updated.status, 'completed');
  console.log('   ✓ Status updated to COMPLETED');

  // 8. Admin Product Management
  console.log('\n6. Testing Admin Product CRUD (Add & Toggle Stock)...');
  const newProductRes = await fetch(`${BASE_URL}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({
      name: 'Loaded Nachos',
      category: 'Snacks',
      price: 130,
      description: 'Crispy corn tortilla chips with warm cheese sauce & salsa.'
    })
  });
  assert.strictEqual(newProductRes.status, 201);
  const newProd = await newProductRes.json();
  assert.strictEqual(newProd.name, 'Loaded Nachos');
  console.log(`   ✓ Added new product: "${newProd.name}" (${newProd.id})`);

  // Toggle out of stock
  const toggleRes = await fetch(`${BASE_URL}/api/products/${newProd.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({ isAvailable: false })
  });
  assert.strictEqual(toggleRes.status, 200);
  const toggled = await toggleRes.json();
  assert.strictEqual(toggled.isAvailable, false);
  console.log('   ✓ Toggled product stock to Sold Out');

  // 9. Check Stats & CSV Export
  console.log('\n7. Testing Admin Analytics & CSV Export...');
  const statsRes = await fetch(`${BASE_URL}/api/stats`, {
    headers: { 'x-admin-pin': ADMIN_PIN }
  });
  assert.strictEqual(statsRes.status, 200);
  const stats = await statsRes.json();
  assert.ok(stats.totalOrders >= 1);
  console.log(`   ✓ Stats: Total Orders: ${stats.totalOrders}, Revenue: ₹${stats.totalRevenue}`);

  const csvRes = await fetch(`${BASE_URL}/api/orders/export/csv`, {
    headers: { 'x-admin-pin': ADMIN_PIN }
  });
  assert.strictEqual(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes('Order Number,Date,Time,Customer Name'));
  assert.ok(csvText.includes('Aarav Patel'));
  console.log('   ✓ CSV Export verified with order data');

  console.log('\n🎉 ALL BACKEND & WORKFLOW TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
