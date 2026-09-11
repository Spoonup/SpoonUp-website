import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config(); // Must run before reading process.env — ESM imports hoist before parent dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
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

export async function fetchSupabaseSettings() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (error) {
    console.warn('Supabase fetch settings error:', error.message);
    return null;
  }
  return {
    eventName: data.event_name,
    currencySymbol: data.currency_symbol,
    adminPin: data.admin_pin,
    counterName: data.counter_name
  };
}

export async function updateSupabaseSettings(updates) {
  if (!supabase) return null;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.eventName) payload.event_name = updates.eventName;
  if (updates.currencySymbol) payload.currency_symbol = updates.currencySymbol;
  if (updates.adminPin) payload.admin_pin = updates.adminPin;
  if (updates.counterName) payload.counter_name = updates.counterName;

  const { data, error } = await supabase
    .from('settings')
    .update(payload)
    .eq('id', 1)
    .select()
    .single();

  if (error) throw error;
  return {
    eventName: data.event_name,
    currencySymbol: data.currency_symbol,
    adminPin: data.admin_pin,
    counterName: data.counter_name
  };
}

export async function fetchSupabaseProducts() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    price: Number(p.price),
    description: p.description,
    imageUrl: p.image_url,
    isAvailable: p.is_available,
    createdAt: p.created_at
  }));
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
      created_at: product.createdAt,
      updated_at: new Date().toISOString()
    }])
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    category: data.category,
    price: Number(data.price),
    description: data.description,
    imageUrl: data.image_url,
    isAvailable: data.is_available,
    createdAt: data.created_at
  };
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

  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    category: data.category,
    price: Number(data.price),
    description: data.description,
    imageUrl: data.image_url,
    isAvailable: data.is_available,
    createdAt: data.created_at
  };
}

export async function deleteSupabaseProduct(id) {
  if (!supabase) return null;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function fetchSupabaseOrders() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(o => ({
    id: o.id,
    orderNumber: o.order_number,
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    items: o.items,
    totalAmount: Number(o.total_amount),
    status: o.status,
    notes: o.notes,
    counterName: o.counter_name,
    accessToken: o.access_token,
    createdAt: o.created_at,
    updatedAt: o.updated_at
  }));
}

function mapSupabaseOrder(data) {
  if (!data) return null;
  return {
    id: data.id,
    orderNumber: data.order_number,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    items: data.items,
    totalAmount: Number(data.total_amount),
    status: data.status,
    notes: data.notes,
    counterName: data.counter_name,
    accessToken: data.access_token,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
}

export async function fetchSupabaseOrderById(id) {
  if (!supabase) return null;
  const trimmed = String(id || '').trim();
  if (!trimmed) return null;

  // 1. Try lookup by order string ID
  const { data: byId, error: errId } = await supabase
    .from('orders')
    .select('*')
    .eq('id', trimmed)
    .maybeSingle();
  if (errId) throw errId;
  if (byId) return mapSupabaseOrder(byId);

  // 2. If numeric, also try lookup by sequential integer order_number
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
      total_amount: order.totalAmount,
      status: order.status,
      notes: order.notes,
      counter_name: order.counterName,
      access_token: order.accessToken,
      created_at: order.createdAt,
      updated_at: order.updatedAt
    }])
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    orderNumber: data.order_number,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    items: data.items,
    totalAmount: Number(data.total_amount),
    status: data.status,
    notes: data.notes,
    counterName: data.counter_name,
    accessToken: data.access_token,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
}

export async function updateSupabaseOrderStatus(id, status) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    orderNumber: data.order_number,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    items: data.items,
    totalAmount: Number(data.total_amount),
    status: data.status,
    notes: data.notes,
    counterName: data.counter_name,
    accessToken: data.access_token,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
}
