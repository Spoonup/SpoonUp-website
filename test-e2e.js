import assert from 'assert';

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

// Protected routes only accept a session token issued by /api/admin/login.
async function adminLogin() {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
  });
  assert.strictEqual(res.status, 200, 'Admin login must succeed with the configured credentials');
  const data = await res.json();
  assert.ok(data.token && data.token.startsWith('adm_'));
  return data.token;
}

async function runTests() {
  console.log('🚀 Running Comprehensive Event Order System Tests...\n');
  const ADMIN_TOKEN = await adminLogin();

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
  assert.ok(order.subtotalAmount > 0);
  assert.ok(order.taxAmount > 0);
  assert.strictEqual(
    Number(order.totalAmount.toFixed(2)),
    Number((order.subtotalAmount + order.taxAmount).toFixed(2))
  );
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
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ status: 'preparing' })
  });
  assert.strictEqual(statusRes.status, 200);
  let updated = await statusRes.json();
  assert.strictEqual(updated.status, 'preparing');
  console.log('   ✓ Status updated to PREPARING');

  // Preparing -> Ready
  statusRes = await fetch(`${BASE_URL}/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ status: 'ready' })
  });
  assert.strictEqual(statusRes.status, 200);
  updated = await statusRes.json();
  assert.strictEqual(updated.status, 'ready');
  console.log('   ✓ Status updated to READY (WhatsApp message triggerable)');

  // 6. Test WhatsApp Message Structure
  const waPhone = updated.customerPhone.replace(/\D/g, '');
  const itemsText = updated.items.map(i => `  • ${i.quantity}x ${i.name}`).join('\n');
  const location = updated.counterName || 'Main Shop';
  const sampleMsg = `*SpoonUp* ✨ *Order Ready for Pickup!* 🟢\n\nHi *${updated.customerName}*, your order is freshly prepared and ready for pickup.\n\n🧾 *Order #${updated.orderNumber}*\n${itemsText}\n\n✅ *Total:* ₹${updated.totalAmount} (Paid)\n📍 *Pickup:* ${location}\n\n_Real Food. Real Nutrition. Real Goodness._\n_Please show this message at ${location} to collect your order. Enjoy!_ ✨`;
  const waUrl = `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(sampleMsg)}`;
  assert.ok(waUrl.includes('https://api.whatsapp.com/send?phone=919876543210'));
  console.log('   ✓ WhatsApp URL Generated cleanly with minimal emojis:\n     ', waUrl.slice(0, 80) + '...');

  // 7. Ready -> Completed
  statusRes = await fetch(`${BASE_URL}/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
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
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
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
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ isAvailable: false })
  });
  assert.strictEqual(toggleRes.status, 200);
  const toggled = await toggleRes.json();
  assert.strictEqual(toggled.isAvailable, false);
  console.log('   ✓ Toggled product stock to Sold Out');

  // 9. Check Stats & CSV Export
  console.log('\n7. Testing Admin Analytics & CSV Export...');
  const statsRes = await fetch(`${BASE_URL}/api/stats`, {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  assert.strictEqual(statsRes.status, 200);
  const stats = await statsRes.json();
  assert.ok(stats.totalOrders >= 1);
  assert.ok(stats.baseRevenue >= 0);
  assert.ok(stats.taxCollected >= 0);
  console.log(`   ✓ Stats: Total Orders: ${stats.totalOrders}, Revenue: ₹${stats.totalRevenue}`);

  const csvRes = await fetch(`${BASE_URL}/api/orders/export/csv`, {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  assert.strictEqual(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes('Order Number,Date,Time,Customer Name'));
  assert.ok(csvText.includes('Aarav Patel'));
  console.log('   ✓ CSV Export verified with order data');

  console.log('\n8. Testing customer signup, login, and order linking...');
  const unique = `user${Date.now()}`;
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: unique,
      password: 'secretpass',
      email: `${unique}@spoonup.test`,
      phone: '+919876543299'
    })
  });
  assert.strictEqual(signupRes.status, 201);
  const signup = await signupRes.json();
  assert.ok(signup.token.startsWith('usr_'));
  assert.strictEqual(signup.user.username, unique);

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: unique, password: 'secretpass' })
  });
  assert.strictEqual(loginRes.status, 200);
  const login = await loginRes.json();

  const linkedOrderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-token': login.token },
    body: JSON.stringify({
      customerName: 'Profile User',
      customerPhone: '+919876543299',
      items: [{ id: products[0].id, quantity: 1 }]
    })
  });
  assert.strictEqual(linkedOrderRes.status, 201);
  const linkedOrder = await linkedOrderRes.json();
  assert.strictEqual(linkedOrder.userId, signup.user.id);

  const myOrdersRes = await fetch(`${BASE_URL}/api/me/orders`, {
    headers: { 'x-user-token': login.token }
  });
  assert.strictEqual(myOrdersRes.status, 200);
  const myOrders = await myOrdersRes.json();
  assert.ok(myOrders.some(o => o.id === linkedOrder.id));
  console.log('   ✓ Account orders are linked to the user profile');

  console.log('\n9. Testing guest phone requirement and deliver-later split...');
  const guestNoPhone = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Guest Person',
      items: [{ id: products[0].id, quantity: 1 }]
    })
  });
  assert.strictEqual(guestNoPhone.status, 400);

  const laterProdRes = await fetch(`${BASE_URL}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({
      name: 'Event Hamper',
      category: 'Merchandise',
      price: 250,
      deliverLater: true
    })
  });
  assert.strictEqual(laterProdRes.status, 201);
  const laterProd = await laterProdRes.json();
  assert.strictEqual(laterProd.deliverLater, true);

  const splitRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Split Guest',
      customerPhone: '+919111122233',
      items: [
        { id: products[0].id, quantity: 1 },
        { id: laterProd.id, quantity: 1 }
      ],
      deliveryAddress: {
        line1: '12 Event Road',
        city: 'Pune',
        state: 'MH',
        pincode: '411001'
      }
    })
  });
  assert.strictEqual(splitRes.status, 201);
  const split = await splitRes.json();
  assert.strictEqual(split.orders.length, 2);
  const types = split.orders.map(o => o.fulfillmentType).sort();
  assert.deepStrictEqual(types, ['delivery', 'immediate']);
  const delivery = split.orders.find(o => o.fulfillmentType === 'delivery');
  assert.strictEqual(delivery.deliveryAddress.city, 'Pune');

  const shipRes = await fetch(`${BASE_URL}/api/orders/${delivery.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ status: 'shipped', trackingLink: 'https://example.com/track/1' })
  });
  assert.strictEqual(shipRes.status, 200);
  const shipped = await shipRes.json();
  assert.strictEqual(shipped.status, 'shipped');
  assert.ok(shipped.trackingLink.includes('example.com'));
  console.log('   ✓ Mixed cart splits into kitchen + delivery orders');

  console.log('\n10. Testing counter checkout prepare + complete...');
  const prepareRes = await fetch(`${BASE_URL}/api/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Checkout Guest',
      customerPhone: '+919700011122',
      items: [{ id: products[0].id, quantity: 1 }],
      paymentMethod: 'counter'
    })
  });
  assert.strictEqual(prepareRes.status, 200);
  const prepared = await prepareRes.json();
  assert.ok(prepared.checkoutId);
  assert.strictEqual(prepared.needsDeliveryAddress, false);

  const completeRes = await fetch(`${BASE_URL}/api/checkout/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkoutId: prepared.checkoutId })
  });
  assert.strictEqual(completeRes.status, 201);
  const completed = await completeRes.json();
  assert.ok(completed.order.id);
  assert.strictEqual(completed.order.paymentMethod, 'counter');
  assert.strictEqual(completed.orders.length, 1);
  console.log('   ✓ Counter checkout session creates a kitchen order');

  const onlinePrepare = await fetch(`${BASE_URL}/api/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Online Guest',
      customerPhone: '+919700011133',
      items: [{ id: products[0].id, quantity: 1 }],
      paymentMethod: 'online'
    })
  });
  assert.strictEqual(onlinePrepare.status, 200);
  const onlinePrepared = await onlinePrepare.json();
  const fakeComplete = await fetch(`${BASE_URL}/api/checkout/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      checkoutId: onlinePrepared.checkoutId,
      razorpayPaymentId: 'pay_fake',
      razorpayOrderId: onlinePrepared.razorpayOrderId,
      razorpaySignature: 'deadbeef'
    })
  });
  assert.strictEqual(fakeComplete.status, 400);
  console.log('   ✓ Online checkout without a verified payment is rejected');

  console.log('\n🎉 ALL BACKEND & WORKFLOW TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
