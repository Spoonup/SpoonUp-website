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

  const { data, error } = await supabase
    .from('checkouts')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapSupabaseCheckout(data);
}
