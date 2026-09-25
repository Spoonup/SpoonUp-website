import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { escapeLikePattern } from './security.js';
dotenv.config({ override: false });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TIMEOUT_MS = 10000;
const UNIQUE_VIOLATION = '23505';

let supabase = null;

// Every PostgREST call gets a hard timeout so a slow database cannot pin a request
// until the platform kills it.
function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
}

if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { fetch: fetchWithTimeout }
    });
    console.log('⚡ Connected to Supabase PostgreSQL at:', supabaseUrl);
  } catch (err) {
    console.warn('⚠️ Could not initialize Supabase client:', err.message);
  }
} else {
  console.log('ℹ️ Running in Local Database Mode (Supabase environment variables not set).');
}

export function isSupabaseActive() {
  return Boolean(supabase);
}

function mapSupabaseSettings(data) {
  return {
    eventName: data.event_name,
    currencySymbol: data.currency_symbol,
    adminUsername: data.admin_username || '',
    adminPassword: data.admin_password || '',
    counterName: data.counter_name,
    upiId: data.upi_id || '',
    upiPhone: data.upi_phone || ''
  };
}

export async function fetchSupabaseSettings() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  // A failure here must surface, not silently fall back to a different settings store.
  if (error) throw error;
  return mapSupabaseSettings(data);
}

export async function updateSupabaseSettings(updates) {
  if (!supabase) return null;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.eventName) payload.event_name = updates.eventName;
  if (updates.currencySymbol) payload.currency_symbol = updates.currencySymbol;
  if (updates.adminUsername) payload.admin_username = updates.adminUsername;
  if (updates.adminPassword) payload.admin_password = updates.adminPassword;
  if (updates.counterName) payload.counter_name = updates.counterName;
  if (updates.upiId !== undefined) payload.upi_id = updates.upiId;
  if (updates.upiPhone !== undefined) payload.upi_phone = updates.upiPhone;

  const { data, error } = await supabase
    .from('settings')
    .update(payload)
    .eq('id', 1)
    .select()
    .single();

  if (error) throw error;
  return mapSupabaseSettings(data);
}

function mapSupabaseProduct(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: Number(p.price),
    description: p.description,
    imageUrl: p.image_url,
    isAvailable: p.is_available,
    deliverLater: Boolean(p.deliver_later),
    gstRate: Number(p.gst_rate ?? 5),
    fulfillmentKind: p.fulfillment_kind || (p.deliver_later ? 'DELIVERY_IN_DAYS' : 'IMMEDIATE'),
    leadTimeDays: p.lead_time_days == null ? null : Number(p.lead_time_days),
    prepMinutes: p.prep_minutes == null ? null : Number(p.prep_minutes),
    subscribable: Boolean(p.subscribable),
    sellableOnce: p.sellable_once !== false,
    createdAt: p.created_at
  };
}

export async function fetchSupabaseProducts() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapSupabaseProduct);
}

export async function insertSupabaseProduct(product) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('products')
    .insert([{
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      description: product.description,
      image_url: product.imageUrl,
      is_available: product.isAvailable,
      deliver_later: Boolean(product.deliverLater),
      gst_rate: product.gstRate ?? 5,
      fulfillment_kind: product.fulfillmentKind || 'IMMEDIATE',
      lead_time_days: product.leadTimeDays ?? null,
      prep_minutes: product.prepMinutes ?? null,
      subscribable: Boolean(product.subscribable),
      sellable_once: product.sellableOnce !== false,
      created_at: product.createdAt,
      updated_at: new Date().toISOString()
    }])
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseProduct(data);
}

export async function updateSupabaseProduct(id, updates) {
  if (!supabase) return null;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.price !== undefined) payload.price = updates.price;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.imageUrl !== undefined) payload.image_url = updates.imageUrl;
  if (updates.isAvailable !== undefined) payload.is_available = updates.isAvailable;
  if (updates.deliverLater !== undefined) payload.deliver_later = Boolean(updates.deliverLater);
  if (updates.fulfillmentKind !== undefined) payload.fulfillment_kind = updates.fulfillmentKind;
  if (updates.leadTimeDays !== undefined) payload.lead_time_days = updates.leadTimeDays;
  if (updates.prepMinutes !== undefined) payload.prep_minutes = updates.prepMinutes;
  if (updates.subscribable !== undefined) payload.subscribable = Boolean(updates.subscribable);
  if (updates.sellableOnce !== undefined) payload.sellable_once = updates.sellableOnce !== false;
  if (updates.gstRate !== undefined) payload.gst_rate = updates.gstRate;

  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseProduct(data);
}

export async function deleteSupabaseProduct(id) {
  if (!supabase) return null;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
  return true;
}

function mapSupabaseOrder(data) {
  if (!data) return null;
  return {
    id: data.id,
    orderNumber: data.order_number,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    items: data.items,
    subtotalAmount: Number(data.subtotal_amount ?? data.total_amount),
    taxAmount: Number(data.tax_amount ?? 0),
    totalAmount: Number(data.total_amount),
    status: data.status,
    notes: data.notes,
    counterName: data.counter_name,
    accessToken: data.access_token,
    userId: data.user_id || null,
    fulfillmentType: data.fulfillment_type || 'immediate',
    parentOrderId: data.parent_order_id || null,
    subOrderType:
      data.sub_order_type || (data.fulfillment_type === 'delivery' ? 'DELIVERY_IN_DAYS' : 'IMMEDIATE'),
    scheduledFor: data.scheduled_for || null,
    expectedShipDate: data.expected_ship_date || null,
    subscriptionId: data.subscription_id || null,
    subscriptionDeliveryId: data.subscription_delivery_id || null,
    paymentGroupId: data.payment_group_id || null,
    paymentMethod: data.payment_method || 'counter',
    paymentStatus: data.payment_status || 'unpaid',
    razorpayOrderId: data.razorpay_order_id || '',
    razorpayPaymentId: data.razorpay_payment_id || '',
    deliveryAddress: data.delivery_address || null,
    trackingLink: data.tracking_link || '',
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
}

export async function fetchSupabaseOrders({ limit = 500, since = null } = {}) {
  if (!supabase) return null;
  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (since) query = query.gte('updated_at', since);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapSupabaseOrder);
}

export async function fetchSupabaseOrdersByIds(ids) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('id', ids)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapSupabaseOrder);
}

export async function fetchSupabaseOrderById(id) {
  if (!supabase) return null;
  const trimmed = String(id || '').trim();
  if (!trimmed) return null;

  const { data: byId, error: errId } = await supabase
    .from('orders')
    .select('*')
    .eq('id', trimmed)
    .maybeSingle();
  if (errId) throw errId;
  if (byId) return mapSupabaseOrder(byId);

  if (/^\d+$/.test(trimmed)) {
    const { data: byNum, error: errNum } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', parseInt(trimmed, 10))
      .maybeSingle();
    if (errNum) throw errNum;
    if (byNum) return mapSupabaseOrder(byNum);
  }

  return null;
}

export async function insertSupabaseOrder(order) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('orders')
    .insert([{
      id: order.id,
      customer_name: order.customerName,
      customer_phone: order.customerPhone,
      items: order.items,
      subtotal_amount: order.subtotalAmount,
      tax_amount: order.taxAmount,
      total_amount: order.totalAmount,
      status: order.status,
      notes: order.notes,
      counter_name: order.counterName,
      access_token: order.accessToken,
      user_id: order.userId || null,
      fulfillment_type: order.fulfillmentType || 'immediate',
      parent_order_id: order.parentOrderId || null,
      sub_order_type: order.subOrderType || null,
      scheduled_for: order.scheduledFor || null,
      expected_ship_date: order.expectedShipDate || null,
      subscription_id: order.subscriptionId || null,
      subscription_delivery_id: order.subscriptionDeliveryId || null,
      payment_group_id: order.paymentGroupId || null,
      payment_method: order.paymentMethod || 'counter',
      payment_status: order.paymentStatus || 'unpaid',
      razorpay_order_id: order.razorpayOrderId || null,
      razorpay_payment_id: order.razorpayPaymentId || null,
      delivery_address: order.deliveryAddress || null,
      tracking_link: order.trackingLink || '',
      created_at: order.createdAt,
      updated_at: order.updatedAt
    }])
    .select()
    .single();
  if (error) {
    // The partial unique index on (razorpay_payment_id, fulfillment_type) means a
    // concurrent worker already created this order: return theirs instead of failing.
    if (error.code === UNIQUE_VIOLATION && order.razorpayPaymentId) {
      const existing = await fetchSupabaseOrdersByRazorpayPaymentId(order.razorpayPaymentId);
      const match = existing.find(o => o.fulfillmentType === (order.fulfillmentType || 'immediate'));
      if (match) return match;
    }
    throw error;
  }
  return mapSupabaseOrder(data);
}

export async function updateSupabaseOrderStatus(id, status) {
  if (!supabase) return null;
  return updateSupabaseOrder(id, { status });
}

export async function updateSupabaseOrder(id, updates) {
  if (!supabase) return null;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.paymentStatus !== undefined) payload.payment_status = updates.paymentStatus;
  if (updates.trackingLink !== undefined) payload.tracking_link = updates.trackingLink;
  if (updates.deliveryAddress !== undefined) payload.delivery_address = updates.deliveryAddress;

  const { data, error } = await supabase
    .from('orders')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseOrder(data);
}

export async function fetchSupabaseOrdersByUserId(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSupabaseOrder);
}

function mapSupabaseUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at
  };
}

export async function insertSupabaseUser(user) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users')
    .insert([{
      id: user.id,
      username: user.username,
      password_hash: user.passwordHash,
      email: user.email,
      phone: user.phone,
      created_at: user.createdAt
    }])
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseUser(data);
}

export async function fetchSupabaseUserByUsername(username) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('username', escapeLikePattern(username))
    .maybeSingle();
  if (error) throw error;
  return mapSupabaseUser(data);
}

export async function fetchSupabaseUserByEmail(email) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', escapeLikePattern(email))
    .maybeSingle();
  if (error) throw error;
  return mapSupabaseUser(data);
}

export async function fetchSupabaseUserById(id) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return mapSupabaseUser(data);
}

export async function insertSupabaseUserSession(session) {
  if (!supabase) return null;
  const { error } = await supabase.from('user_sessions').insert([{
    token: session.token,
    user_id: session.userId,
    expires_at: session.expiresAt
  }]);
  if (error) throw error;
  return session;
}

export async function fetchSupabaseUserSession(token) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { token: data.token, userId: data.user_id, expiresAt: data.expires_at };
}

export async function deleteExpiredSupabaseUserSessions(nowIso) {
  if (!supabase) return 0;
  const { error, count } = await supabase
    .from('user_sessions')
    .delete({ count: 'exact' })
    .lt('expires_at', nowIso);
  if (error) throw error;
  return count || 0;
}

export async function deleteSupabaseUserSession(token) {
  if (!supabase) return null;
  const { error } = await supabase.from('user_sessions').delete().eq('token', token);
  if (error) throw error;
  return true;
}

function mapSupabaseCheckout(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    items: row.items,
    notes: row.notes || '',
    paymentMethod: row.payment_method,
    subtotalAmount: Number(row.subtotal_amount ?? row.amount),
    taxAmount: Number(row.tax_amount ?? 0),
    amount: Number(row.amount),
    status: row.status,
    razorpayOrderId: row.razorpay_order_id || '',
    razorpayPaymentId: row.razorpay_payment_id || '',
    deliveryAddress: row.delivery_address || null,
    createdOrders: row.created_orders || [],
    cartSnapshot: row.cart_snapshot || null,
    parentOrderId: row.parent_order_id || null,
    platform: row.platform || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function insertSupabaseCheckout(checkout) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('checkouts')
    .insert([{
      id: checkout.id,
      user_id: checkout.userId || null,
      customer_name: checkout.customerName,
      customer_phone: checkout.customerPhone,
      items: checkout.items,
      notes: checkout.notes || '',
      payment_method: checkout.paymentMethod,
      subtotal_amount: checkout.subtotalAmount,
      tax_amount: checkout.taxAmount,
      amount: checkout.amount,
      status: checkout.status,
      razorpay_order_id: checkout.razorpayOrderId || null,
      razorpay_payment_id: checkout.razorpayPaymentId || null,
      delivery_address: checkout.deliveryAddress || null,
      created_orders: checkout.createdOrders || [],
      cart_snapshot: checkout.cartSnapshot || null,
      parent_order_id: checkout.parentOrderId || null,
      platform: checkout.platform || null,
      created_at: checkout.createdAt,
      updated_at: checkout.updatedAt
    }])
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseCheckout(data);
}

export async function fetchSupabaseCheckoutById(id) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('checkouts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return mapSupabaseCheckout(data);
}

export async function fetchSupabaseCheckoutByRazorpayOrderId(razorpayOrderId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('checkouts')
    .select('*')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();
  if (error) throw error;
  return mapSupabaseCheckout(data);
}

export async function fetchSupabaseOrdersByRazorpayPaymentId(paymentId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('razorpay_payment_id', paymentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapSupabaseOrder);
}

export async function claimSupabaseCheckout(id, fromStatuses, toStatus) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('checkouts')
    .update({ status: toStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', fromStatuses)
    .select()
    .maybeSingle();
  if (error) throw error;
  return mapSupabaseCheckout(data);
}

export async function updateSupabaseCheckout(id, updates) {
  if (!supabase) return null;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.razorpayPaymentId !== undefined) payload.razorpay_payment_id = updates.razorpayPaymentId;
  if (updates.deliveryAddress !== undefined) payload.delivery_address = updates.deliveryAddress;
  if (updates.createdOrders !== undefined) payload.created_orders = updates.createdOrders;
  if (updates.cartSnapshot !== undefined) payload.cart_snapshot = updates.cartSnapshot;
  if (updates.parentOrderId !== undefined) payload.parent_order_id = updates.parentOrderId;
  if (updates.platform !== undefined) payload.platform = updates.platform;

  const { data, error } = await supabase
    .from('checkouts')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseCheckout(data);
}

// ----------------- PARENT ORDERS, ITEMS, SUBSCRIPTIONS, WALLET -----------------
// Same snake_case ↔ camelCase contract as the tables above. Every read throws on
// error rather than falling back to local JSON, so a schema problem surfaces as a
// 5xx with a tagged log line instead of silently wrong data.

const UNIQUE_VIOLATION_CODE = UNIQUE_VIOLATION;

function mapParentOrder(d) {
  if (!d) return null;
  return {
    id: d.id,
    orderNumber: d.order_number,
    userId: d.user_id || null,
    customerName: d.customer_name,
    customerPhone: d.customer_phone,
    platform: d.platform || 'WEB',
    source: d.source || 'CUSTOMER',
    itemsSubtotal: Number(d.items_subtotal ?? 0),
    taxTotal: Number(d.tax_total ?? 0),
    calculatedTotal: Number(d.calculated_total ?? 0),
    couponId: d.coupon_id || null,
    couponCode: d.coupon_code || null,
    couponDiscount: Number(d.coupon_discount ?? 0),
    platformAdjustment: Number(d.platform_adjustment ?? 0),
    negotiatedTotal: d.negotiated_total == null ? null : Number(d.negotiated_total),
    negotiatedDiscount: Number(d.negotiated_discount ?? 0),
    payableTotal: Number(d.payable_total ?? 0),
    paymentMethod: d.payment_method || 'counter',
    paymentStatus: d.payment_status || 'unpaid',
    razorpayOrderId: d.razorpay_order_id || '',
    razorpayPaymentId: d.razorpay_payment_id || '',
    createdByAdmin: d.created_by_admin || null,
    notes: d.notes || '',
    createdAt: d.created_at,
    updatedAt: d.updated_at
  };
}

function parentOrderRow(p) {
  return {
    id: p.id,
    user_id: p.userId,
    customer_name: p.customerName,
    customer_phone: p.customerPhone,
    platform: p.platform,
    source: p.source,
    items_subtotal: p.itemsSubtotal,
    tax_total: p.taxTotal,
    calculated_total: p.calculatedTotal,
    coupon_id: p.couponId,
    coupon_code: p.couponCode,
    coupon_discount: p.couponDiscount,
    platform_adjustment: p.platformAdjustment,
    negotiated_total: p.negotiatedTotal,
    payable_total: p.payableTotal,
    payment_method: p.paymentMethod,
    payment_status: p.paymentStatus,
    razorpay_order_id: p.razorpayOrderId || '',
    razorpay_payment_id: p.razorpayPaymentId || '',
    created_by_admin: p.createdByAdmin || null,
    notes: p.notes || '',
    created_at: p.createdAt,
    updated_at: p.updatedAt
  };
}

export async function insertSupabaseParentOrder(parentOrder) {
  const { data, error } = await supabase
    .from('parent_orders')
    .insert(parentOrderRow(parentOrder))
    .select()
    .single();
  if (error) throw error;
  return mapParentOrder(data);
}

export async function fetchSupabaseParentOrderById(id) {
  const { data, error } = await supabase.from('parent_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return mapParentOrder(data);
}

export async function updateSupabaseParentOrder(id, updates) {
  const row = parentOrderRow({ ...updates, updatedAt: new Date().toISOString() });
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  const { data, error } = await supabase.from('parent_orders').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return mapParentOrder(data);
}

function mapOrderItem(d) {
  if (!d) return null;
  return {
    id: d.id,
    subOrderId: d.sub_order_id,
    productId: d.product_id,
    productName: d.product_name_snapshot,
    unitPrice: Number(d.unit_price_snapshot),
    gstRate: Number(d.gst_rate_snapshot),
    quantity: Number(d.quantity),
    baseAmount: Number(d.base_amount),
    taxAmount: Number(d.tax_amount),
    lineTotal: Number(d.line_total)
  };
}

export async function insertSupabaseOrderItems(rows) {
  const { data, error } = await supabase
    .from('order_items')
    .insert(
      rows.map((r) => ({
        id: r.id,
        sub_order_id: r.subOrderId,
        product_id: r.productId,
        product_name_snapshot: r.productName,
        unit_price_snapshot: r.unitPrice,
        gst_rate_snapshot: r.gstRate,
        quantity: r.quantity,
        base_amount: r.baseAmount,
        tax_amount: r.taxAmount,
        line_total: r.lineTotal
      }))
    )
    .select();
  if (error) throw error;
  return (data || []).map(mapOrderItem);
}

export async function fetchSupabaseOrderItems(subOrderIds) {
  const { data, error } = await supabase.from('order_items').select('*').in('sub_order_id', subOrderIds);
  if (error) throw error;
  return (data || []).map(mapOrderItem);
}

function mapSubscription(d) {
  if (!d) return null;
  return {
    id: d.id,
    userId: d.user_id || null,
    productId: d.product_id,
    parentOrderId: d.parent_order_id || null,
    walletId: d.wallet_id || null,
    frequency: d.frequency,
    durationMonths: Number(d.duration_months),
    deliveryCount: Number(d.delivery_count),
    startDate: d.start_date,
    unitPrice: Number(d.unit_price_snapshot),
    gstRate: Number(d.gst_rate_snapshot),
    tierId: d.tier_id_snapshot,
    discountPercent: Number(d.discount_percent_snapshot),
    grossAmount: Number(d.gross_amount),
    discountAmount: Number(d.discount_amount),
    subtotalAmount: Number(d.subtotal_amount),
    taxAmount: Number(d.tax_amount),
    totalAmount: Number(d.total_amount),
    perDeliveryAmount: Number(d.per_delivery_amount),
    status: d.status,
    createdAt: d.created_at,
    updatedAt: d.updated_at
  };
}

function subscriptionRow(s) {
  return {
    id: s.id,
    user_id: s.userId,
    product_id: s.productId,
    parent_order_id: s.parentOrderId,
    wallet_id: s.walletId,
    frequency: s.frequency,
    duration_months: s.durationMonths,
    delivery_count: s.deliveryCount,
    start_date: s.startDate,
    unit_price_snapshot: s.unitPrice,
    gst_rate_snapshot: s.gstRate,
    tier_id_snapshot: s.tierId,
    discount_percent_snapshot: s.discountPercent,
    gross_amount: s.grossAmount,
    discount_amount: s.discountAmount,
    subtotal_amount: s.subtotalAmount,
    tax_amount: s.taxAmount,
    total_amount: s.totalAmount,
    per_delivery_amount: s.perDeliveryAmount,
    status: s.status,
    created_at: s.createdAt,
    updated_at: s.updatedAt
  };
}

export async function insertSupabaseSubscription(sub) {
  const { data, error } = await supabase.from('subscriptions').insert(subscriptionRow(sub)).select().single();
  if (error) throw error;
  return mapSubscription(data);
}

export async function fetchSupabaseSubscriptionById(id) {
  const { data, error } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return mapSubscription(data);
}

export async function fetchSupabaseSubscriptionsByUser(userId) {
  const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId);
  if (error) throw error;
  return (data || []).map(mapSubscription);
}

export async function updateSupabaseSubscription(id, updates) {
  const row = subscriptionRow({ ...updates, updatedAt: new Date().toISOString() });
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  const { data, error } = await supabase.from('subscriptions').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return mapSubscription(data);
}

function mapSubDelivery(d) {
  if (!d) return null;
  return {
    id: d.id,
    subscriptionId: d.subscription_id,
    sequenceNo: Number(d.sequence_no),
    scheduledDate: d.scheduled_date,
    status: d.status,
    subOrderId: d.sub_order_id || null,
    walletTransactionId: d.wallet_transaction_id || null,
    amountDue: Number(d.amount_due)
  };
}

export async function insertSupabaseSubscriptionDeliveries(rows) {
  const { data, error } = await supabase
    .from('subscription_deliveries')
    .insert(
      rows.map((r) => ({
        id: r.id,
        subscription_id: r.subscriptionId,
        sequence_no: r.sequenceNo,
        scheduled_date: r.scheduledDate,
        status: r.status,
        sub_order_id: r.subOrderId || null,
        wallet_transaction_id: r.walletTransactionId || null,
        amount_due: r.amountDue
      }))
    )
    .select();
  if (error) throw error;
  return (data || []).map(mapSubDelivery);
}

export async function fetchSupabaseSubscriptionDeliveries(subscriptionId) {
  const { data, error } = await supabase
    .from('subscription_deliveries')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .order('sequence_no', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapSubDelivery);
}

function mapWallet(d) {
  if (!d) return null;
  return {
    id: d.id,
    userId: d.user_id,
    kind: d.kind,
    subscriptionId: d.subscription_id || null,
    isWithdrawable: Boolean(d.is_withdrawable),
    status: d.status,
    createdAt: d.created_at
  };
}

export async function insertSupabaseWallet(w) {
  const { data, error } = await supabase
    .from('wallets')
    .insert({
      id: w.id,
      user_id: w.userId,
      kind: w.kind,
      subscription_id: w.subscriptionId || null,
      is_withdrawable: w.isWithdrawable,
      status: w.status,
      created_at: w.createdAt
    })
    .select()
    .single();
  if (error) throw error;
  return mapWallet(data);
}

export async function fetchSupabaseWalletById(id) {
  const { data, error } = await supabase.from('wallets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return mapWallet(data);
}

export async function fetchSupabaseWalletsByUser(userId) {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId);
  if (error) throw error;
  return (data || []).map(mapWallet);
}

function mapWalletTxn(d) {
  if (!d) return null;
  return {
    id: d.id,
    walletId: d.wallet_id,
    direction: d.direction,
    type: d.type,
    amount: Number(d.amount),
    subscriptionId: d.subscription_id || null,
    subscriptionDeliveryId: d.subscription_delivery_id || null,
    subOrderId: d.sub_order_id || null,
    parentOrderId: d.parent_order_id || null,
    reason: d.reason || '',
    idempotencyKey: d.idempotency_key,
    createdAt: d.created_at
  };
}

/**
 * Append-only. A repeat of the same idempotency key hits the unique index; we
 * return the existing row instead of failing, which is what makes a retried
 * fulfilment safe.
 */
export async function insertSupabaseWalletTransaction(txn) {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .insert({
      id: txn.id,
      wallet_id: txn.walletId,
      direction: txn.direction,
      type: txn.type,
      amount: txn.amount,
      subscription_id: txn.subscriptionId || null,
      subscription_delivery_id: txn.subscriptionDeliveryId || null,
      sub_order_id: txn.subOrderId || null,
      parent_order_id: txn.parentOrderId || null,
      reason: txn.reason || '',
      idempotency_key: txn.idempotencyKey,
      created_at: txn.createdAt
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION_CODE) {
      const { data: existing } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('idempotency_key', txn.idempotencyKey)
        .maybeSingle();
      return mapWalletTxn(existing);
    }
    throw error;
  }
  return mapWalletTxn(data);
}

export async function fetchSupabaseWalletTransactions(walletId) {
  const { data, error } = await supabase.from('wallet_transactions').select('*').eq('wallet_id', walletId);
  if (error) throw error;
  return (data || []).map(mapWalletTxn);
}

/**
 * Conditional UPDATE: the row moves only if it is still in one of `fromStatuses`.
 * PostgREST turns this into a single statement, so two concurrent callers cannot
 * both claim the same delivery.
 */
export async function claimSupabaseSubscriptionDelivery(id, fromStatuses, toStatus) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('subscription_deliveries')
    .update({ status: toStatus })
    .eq('id', id)
    .in('status', fromStatuses)
    .select()
    .maybeSingle();
  if (error) throw error;
  return mapSubDelivery(data);
}

export async function updateSupabaseSubscriptionDelivery(id, updates) {
  const payload = {};
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.subOrderId !== undefined) payload.sub_order_id = updates.subOrderId;
  if (updates.walletTransactionId !== undefined) payload.wallet_transaction_id = updates.walletTransactionId;
  if (updates.scheduledDate !== undefined) payload.scheduled_date = updates.scheduledDate;
  const { data, error } = await supabase
    .from('subscription_deliveries')
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return mapSubDelivery(data);
}

export async function fetchSupabaseSubscriptionDeliveryById(id) {
  const { data, error } = await supabase
    .from('subscription_deliveries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return mapSubDelivery(data);
}

export async function fetchSupabaseDueSubscriptionDeliveries(onDate, limit) {
  const { data, error } = await supabase
    .from('subscription_deliveries')
    .select('*')
    .eq('status', 'PLANNED')
    .lte('scheduled_date', onDate)
    .order('scheduled_date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapSubDelivery);
}

// ----------------- PAYMENTS, PRICING, COUPONS, REFERRALS -----------------
// These tables are plain CRUD, so they share generic helpers rather than one
// bespoke pair of functions each. Uniqueness is enforced by the database; the
// helpers surface a 23505 as a null/duplicate result so callers can branch.

export async function insertSupabaseRow(table, row, mapper) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return mapper(data);
}

export async function updateSupabaseRow(table, id, row, mapper) {
  const payload = { ...row };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return mapper(data);
}

export async function deleteSupabaseRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function selectSupabaseOne(table, match, mapper) {
  const { data, error } = await supabase.from(table).select('*').match(match).maybeSingle();
  if (error) throw error;
  return data ? mapper(data) : null;
}

export async function selectSupabaseMany(table, match, mapper) {
  let q = supabase.from(table).select('*');
  if (Object.keys(match).length) q = q.match(match);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapper);
}

export async function countSupabaseRows(table, match) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).match(match);
  if (error) throw error;
  return count || 0;
}

// ---- payments ----
export function mapPaymentRow(d) {
  if (!d) return null;
  return {
    id: d.id,
    parentOrderId: d.parent_order_id || null,
    checkoutId: d.checkout_id || null,
    gateway: d.gateway,
    gatewayOrderId: d.gateway_order_id || null,
    gatewayPaymentId: d.gateway_payment_id || null,
    amount: Number(d.amount),
    currency: d.currency,
    methodDetail: d.method_detail || '',
    status: d.status,
    failureReason: d.failure_reason || '',
    capturedAt: d.captured_at || null,
    createdAt: d.created_at,
    updatedAt: d.updated_at
  };
}

export function paymentToRow(p) {
  return {
    id: p.id,
    parent_order_id: p.parentOrderId,
    checkout_id: p.checkoutId,
    gateway: p.gateway,
    gateway_order_id: p.gatewayOrderId,
    gateway_payment_id: p.gatewayPaymentId,
    amount: p.amount,
    currency: p.currency,
    method_detail: p.methodDetail,
    status: p.status,
    failure_reason: p.failureReason,
    captured_at: p.capturedAt,
    created_at: p.createdAt,
    updated_at: p.updatedAt
  };
}

export function refundToRow(r) {
  return {
    id: r.id,
    payment_id: r.paymentId,
    gateway_refund_id: r.gatewayRefundId,
    amount: r.amount,
    is_partial: r.isPartial,
    status: r.status,
    reason: r.reason,
    created_by_admin: r.createdByAdmin,
    created_at: r.createdAt
  };
}

/** Unique gateway_event_id: a redelivered webhook returns duplicate: true. */
export async function insertSupabasePaymentEvent(event) {
  const { data, error } = await supabase
    .from('payment_events')
    .insert({
      id: event.id,
      gateway: event.gateway,
      gateway_event_id: event.gatewayEventId,
      event_type: event.eventType,
      gateway_payment_id: event.gatewayPaymentId || null,
      gateway_order_id: event.gatewayOrderId || null,
      raw_payload: event.rawPayload || null,
      received_at: event.receivedAt
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('payment_events').select('*').eq('gateway_event_id', event.gatewayEventId).maybeSingle();
      return { event: existing, duplicate: true };
    }
    throw error;
  }
  return { event: data, duplicate: false };
}

export async function markSupabasePaymentEventProcessed(gatewayEventId, result) {
  const { data, error } = await supabase
    .from('payment_events')
    .update({ result: String(result || '').slice(0, 200), processed_at: new Date().toISOString() })
    .eq('gateway_event_id', gatewayEventId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- platform pricing ----
export function mapPlatformRule(d) {
  if (!d) return null;
  return {
    id: d.id, platform: d.platform, scope: d.scope, scopeRef: d.scope_ref || null,
    adjustmentType: d.adjustment_type, adjustmentValue: Number(d.adjustment_value),
    effectiveFrom: d.effective_from, effectiveTo: d.effective_to || null,
    isActive: d.is_active !== false
  };
}
export function platformRuleToRow(r) {
  return {
    id: r.id, platform: r.platform, scope: r.scope, scope_ref: r.scopeRef,
    adjustment_type: r.adjustmentType, adjustment_value: r.adjustmentValue,
    effective_from: r.effectiveFrom, effective_to: r.effectiveTo, is_active: r.isActive
  };
}

// ---- coupons ----
export function mapCouponRow(d) {
  if (!d) return null;
  return {
    id: d.id, code: d.code, description: d.description || '',
    scope: d.scope, singleUserId: d.single_user_id || null,
    discountType: d.discount_type, discountValue: Number(d.discount_value),
    maxDiscountAmount: d.max_discount_amount == null ? null : Number(d.max_discount_amount),
    minOrderAmount: Number(d.min_order_amount || 0),
    validFrom: d.valid_from, validTo: d.valid_to || null,
    totalUsageLimit: d.total_usage_limit == null ? null : Number(d.total_usage_limit),
    perUserLimit: Number(d.per_user_limit || 1),
    isActive: d.is_active !== false,
    createdByAdmin: d.created_by_admin || null,
    createdAt: d.created_at
  };
}
export function couponToRow(c) {
  return {
    id: c.id, code: c.code, description: c.description, scope: c.scope,
    single_user_id: c.singleUserId, discount_type: c.discountType,
    discount_value: c.discountValue, max_discount_amount: c.maxDiscountAmount,
    min_order_amount: c.minOrderAmount, valid_from: c.validFrom, valid_to: c.validTo,
    total_usage_limit: c.totalUsageLimit, per_user_limit: c.perUserLimit,
    is_active: c.isActive, created_by_admin: c.createdByAdmin, created_at: c.createdAt
  };
}

export async function insertSupabaseCohortMembers(couponId, userIds) {
  const { error } = await supabase
    .from('coupon_cohort_members')
    .upsert(userIds.map((u) => ({ coupon_id: couponId, user_id: u })), { onConflict: 'coupon_id,user_id' });
  if (error) throw error;
  return userIds.length;
}

/** Unique (coupon_id, user_key): the loser of a race gets null, not a discount. */
export async function insertSupabaseCouponRedemption(r) {
  const { data, error } = await supabase
    .from('coupon_redemptions')
    .insert({
      id: r.id, coupon_id: r.couponId, user_key: r.userKey,
      parent_order_id: r.parentOrderId, discount_applied: r.discountApplied,
      redeemed_at: r.redeemedAt
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw error;
  }
  return { ...r, id: data.id };
}

// ---- referrals ----
export function mapReferralCodeRow(d) {
  if (!d) return null;
  return { id: d.id, userId: d.user_id, code: d.code, isActive: d.is_active !== false, createdAt: d.created_at };
}
export function mapReferralRow(d) {
  if (!d) return null;
  return {
    id: d.id, referrerUserId: d.referrer_user_id, referredUserId: d.referred_user_id,
    codeUsed: d.code_used, status: d.status,
    qualifyingParentOrderId: d.qualifying_parent_order_id || null,
    signedUpAt: d.signed_up_at, qualifiedAt: d.qualified_at || null
  };
}
export function referralToRow(r) {
  return {
    referrer_user_id: r.referrerUserId, referred_user_id: r.referredUserId,
    code_used: r.codeUsed, status: r.status,
    qualifying_parent_order_id: r.qualifyingParentOrderId, qualified_at: r.qualifiedAt
  };
}
export function mapReferralRuleRow(d) {
  if (!d) return null;
  return {
    id: d.id, referrerAmount: Number(d.referrer_amount), referredAmount: Number(d.referred_amount),
    qualifyingEvent: d.qualifying_event, minOrderAmount: Number(d.min_order_amount || 0),
    effectiveFrom: d.effective_from, effectiveTo: d.effective_to || null, isActive: d.is_active !== false
  };
}
export function referralRuleToRow(r) {
  return {
    id: r.id, referrer_amount: r.referrerAmount, referred_amount: r.referredAmount,
    qualifying_event: r.qualifyingEvent, min_order_amount: r.minOrderAmount,
    effective_from: r.effectiveFrom, effective_to: r.effectiveTo, is_active: r.isActive
  };
}

export async function insertSupabaseReferral(referral) {
  const { data, error } = await supabase
    .from('referrals')
    .insert({
      id: referral.id, referrer_user_id: referral.referrerUserId,
      referred_user_id: referral.referredUserId, code_used: referral.codeUsed,
      status: referral.status, signed_up_at: referral.signedUpAt
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;   // already referred
    throw error;
  }
  return mapReferralRow(data);
}

export async function insertSupabaseReferralReward(reward) {
  const { data, error } = await supabase
    .from('referral_rewards')
    .insert({
      id: reward.id, referral_id: reward.referralId,
      referrer_txn_id: reward.referrerTxnId, referred_txn_id: reward.referredTxnId,
      amount_referrer: reward.amountReferrer, amount_referred: reward.amountReferred,
      rule_snapshot: reward.ruleSnapshot, created_at: reward.createdAt
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;   // already rewarded
    throw error;
  }
  return data;
}
