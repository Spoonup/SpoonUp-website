import React, { useState } from 'react';
import { 
  Plus, 
  Edit3, 
  Trash2, 
  X, 
  AlertCircle,
  UploadCloud
} from 'lucide-react';

const FALLBACK_IMAGE = 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-1.jpg';

export default function AdminProducts({ products, onRefreshProducts, adminPin, settings }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Food');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [gstRate, setGstRate] = useState('5');
  const [isAvailable, setIsAvailable] = useState(true);
  const [deliverLater, setDeliverLater] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const currency = settings?.currencySymbol || '₹';

  const authHeaders = {
    'Content-Type': 'application/json',
    'x-admin-pin': adminPin
  };

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    setCategory('Food');
    setPrice('');
    setDescription('');
    setImageUrl('');
    setImageFile(null);
    setGstRate('5');
    setIsAvailable(true);
    setDeliverLater(false);
    setError('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (prod) => {
    setEditingProduct(prod);
    setName(prod.name);
    setCategory(prod.category || 'Food');
    setPrice(String(prod.price));
    setDescription(prod.description || '');
    setImageUrl(prod.imageUrl || '');
    setImageFile(null);
    setGstRate(String(prod.gstRate ?? 5));
    setIsAvailable(prod.isAvailable !== false);
    setDeliverLater(Boolean(prod.deliverLater));
    setError('');
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a product title');
      return;
    }
    if (isNaN(Number(price)) || Number(price) < 0) {
      setError('Please enter a valid price');
      return;
    }
    if (!editingProduct && !imageFile) {
      setError('Please select a product image to upload');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      let savedImageUrl = imageUrl;
      if (imageFile) {
        const uploadRes = await fetch('/api/products/images', {
          method: 'POST',
          headers: {
            'Content-Type': imageFile.type,
            'x-file-name': imageFile.name,
            'x-admin-pin': adminPin
          },
          body: imageFile
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Failed to upload image');
        savedImageUrl = uploadData.imageUrl;
      }

      const payload = {
        name: name.trim(),
        category: category.trim(),
        price: Number(price),
        description: description.trim(),
        isAvailable,
        deliverLater,
        gstRate: Number(gstRate)
      };
      if (savedImageUrl) payload.imageUrl = savedImageUrl;

      const url = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
      const method = editingProduct ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save product');
      }

      await onRefreshProducts();
      setIsModalOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStock = async (product) => {
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ isAvailable: !product.isAvailable })
      });
      if (res.ok) {
        onRefreshProducts();
      }
    } catch (err) {
      alert('Error updating stock');
    }
  };

  const handleDelete = async (productId) => {
    if (!window.confirm('Delete this product from menu?')) return;

    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
        headers: { 'x-admin-pin': adminPin }
      });
      if (res.ok) {
        onRefreshProducts();
      }
    } catch (err) {
      alert('Error deleting product');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e8e5dc] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#013e37]">Product Catalog & Menu</h2>
          <p className="text-xs text-[#013e37]/70 mt-0.5">
            Add items or toggle "Sold Out" instantly during the event.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="px-4 py-2 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] font-semibold text-xs sm:text-sm rounded-full transition flex items-center gap-1.5 cursor-pointer"
        >
          <Plus size={16} />
          <span>Add New Product</span>
        </button>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {products.map((product) => {
          const isAvailable = product.isAvailable;

          return (
            <div
              key={product.id}
              className={`bg-white rounded-2xl border transition-all flex flex-col justify-between overflow-hidden ${
                !isAvailable ? 'opacity-65 bg-[#faf9f5] border-[#e8e5dc]' : 'border-[#e8e5dc]'
              }`}
            >
              <div>
                <div className="relative h-36 bg-[#faf9f5] overflow-hidden">
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = FALLBACK_IMAGE;
                    }}
                  />
                  <div className="absolute top-2.5 right-2.5">
                    <button
                      onClick={() => handleToggleStock(product)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition border ${
                        isAvailable 
                          ? 'bg-[#013e37] text-[#ffefb3] border-[#013e37]' 
                          : 'bg-white text-rose-700 border-rose-300'
                      }`}
                      title="Click to toggle stock"
                    >
                      {isAvailable ? 'In Stock' : 'Sold Out'}
                    </button>
                  </div>
                  <div className="absolute bottom-2.5 left-2.5">
                    <span className="px-2 py-0.5 rounded-md bg-[#ffefb3] text-[#013e37] text-[10px] font-bold border border-[#f0de99]">
                      {product.category || 'General'}
                    </span>
                    {product.deliverLater && (
                      <span className="ml-1 px-2 py-0.5 rounded-md bg-white text-[#013e37] text-[10px] font-bold border border-[#013e37]/20">
                        Later
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-[#013e37] text-sm leading-snug">
                      {product.name}
                    </h3>
                    <span className="font-black text-[#013e37] text-sm shrink-0">
                      {currency}{product.price}
                    </span>
                  </div>
                  <p className="text-xs text-[#013e37]/70 mt-1 line-clamp-2 leading-relaxed">
                    {product.description || 'No description.'}
                  </p>
                </div>
              </div>

              {/* Bottom Card Actions */}
              <div className="p-2.5 px-3.5 bg-[#faf9f5] border-t border-[#e8e5dc] flex items-center justify-between">
                <button
                  onClick={() => handleToggleStock(product)}
                  className="text-xs font-semibold text-[#013e37]/80 hover:text-[#013e37] transition cursor-pointer"
                >
                  Set to {isAvailable ? 'Sold Out' : 'Available'}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(product)}
                    className="p-1 text-[#013e37]/60 hover:text-[#013e37] hover:bg-[#ffefb3]/60 rounded-lg transition cursor-pointer"
                    title="Edit Item"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(product.id)}
                    className="p-1 text-[#013e37]/40 hover:text-rose-600 rounded-lg transition cursor-pointer"
                    title="Delete Item"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-[#e8e5dc] overflow-hidden animate-in fade-in duration-150 max-h-[90vh] flex flex-col">
            <div className="p-4 bg-[#013e37] text-[#ffefb3] flex items-center justify-between">
              <h3 className="font-bold text-base">
                {editingProduct ? 'Edit Product' : 'Add New Menu Item'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-[#ffefb3]/80 hover:text-[#ffefb3] p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-3.5 text-xs">
              {error && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-[#013e37] mb-1">
                  Product Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Masala Chai, Cold Brew"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#013e37] mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    placeholder="Beverages, Food..."
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#013e37] mb-1">
                    Price ({currency}) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    placeholder="e.g. 120"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs font-mono font-bold text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#013e37] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Ingredients or description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-[#013e37] mb-1">
                  Product Image *
                </label>
                <label className="flex items-center justify-center gap-2 w-full px-3 py-3 bg-[#faf9f5] border border-dashed border-[#013e37]/30 rounded-xl cursor-pointer hover:bg-[#ffefb3]/30">
                  <UploadCloud size={16} />
                  <span>{imageFile ? imageFile.name : 'Choose image (JPG, PNG, WebP or GIF)'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                  />
                </label>
                {imageUrl && !imageFile && (
                  <p className="text-[10px] text-[#013e37]/60 mt-1">Current image will be kept unless you choose a new file.</p>
                )}
                <p className="text-[10px] text-[#013e37]/60 mt-1">Images are stored and served from Google Cloud Storage.</p>
              </div>

              <div>
                <label className="block font-bold text-[#013e37] mb-1">
                  GST Rate (%)
                </label>
                <select
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                  className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs text-[#013e37]"
                >
                  {[0, 5, 12, 18, 28, 40].map((rate) => (
                    <option key={rate} value={rate}>{rate}%</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#013e37]/60 mt-1">Default restaurant/takeaway rate is 5%. Confirm packaged-goods classification with your GST advisor.</p>
              </div>

              <div className="pt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="modalIsAvailable"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#013e37]"
                />
                <label htmlFor="modalIsAvailable" className="font-bold text-[#013e37] cursor-pointer">
                  In stock & available to order
                </label>
              </div>

              <div className="pt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="modalDeliverLater"
                  checked={deliverLater}
                  onChange={(e) => setDeliverLater(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#013e37]"
                />
                <label htmlFor="modalDeliverLater" className="font-bold text-[#013e37] cursor-pointer">
                  Deliver later (ships after the event)
                </label>
              </div>

              <div className="pt-3 border-t border-[#e8e5dc] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-[#013e37]/70 hover:bg-[#faf9f5] rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-[#013e37] hover:bg-[#06554c] disabled:opacity-50 text-[#ffefb3] text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  {isSaving ? 'Saving...' : editingProduct ? 'Update Product' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
