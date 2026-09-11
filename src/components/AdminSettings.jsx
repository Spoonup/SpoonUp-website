import React, { useState, useEffect } from 'react';
import { 
  Store, 
  QrCode, 
  Printer, 
  Download, 
  KeyRound, 
  CheckCircle2, 
  Save, 
  Copy, 
  Check
} from 'lucide-react';
import QRCode from 'qrcode';

export default function AdminSettings({ adminPin, settings, onRefreshSettings }) {
  const [eventName, setEventName] = useState(settings?.eventName || '');
  const [counterName, setCounterName] = useState(settings?.counterName || '');
  const [currencySymbol, setCurrencySymbol] = useState(settings?.currencySymbol || '₹');
  const [newPin, setNewPin] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [menuUrl, setMenuUrl] = useState(window.location.origin);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (settings) {
      setEventName(settings.eventName || '');
      setCounterName(settings.counterName || '');
      setCurrencySymbol(settings.currencySymbol || '₹');
    }
  }, [settings]);

  useEffect(() => {
    QRCode.toDataURL(menuUrl, { width: 280, margin: 2 })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error(err));
  }, [menuUrl]);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      const payload = {
        eventName,
        counterName,
        currencySymbol
      };
      if (newPin.trim()) {
        if (newPin.trim().length < 4) {
          throw new Error('PIN must be at least 4 digits');
        }
        payload.adminPin = newPin.trim();
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': adminPin
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');

      setSuccessMsg('Settings updated successfully!');
      setNewPin('');
      await onRefreshSettings();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(menuUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handlePrintQR = () => {
    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    let safeMenuUrl = '';
    try {
      const parsed = new URL(menuUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        safeMenuUrl = parsed.toString();
      }
    } catch {
      safeMenuUrl = '';
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Menu QR Code - ${escapeHtml(eventName || 'Event')}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px; margin: 0; background: #faf9f5; color: #013e37; }
            .card { max-width: 440px; margin: 0 auto; border: 2px solid #013e37; border-radius: 24px; padding: 36px 24px; background: #ffffff; }
            h1 { font-size: 26px; margin: 0 0 6px; color: #013e37; }
            p { font-size: 14px; color: #1e4f48; margin: 4px 0 16px; }
            img { width: 240px; height: 240px; margin: 8px auto; display: block; }
            .counter-badge { display: inline-block; background: #ffefb3; color: #013e37; padding: 5px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; margin-bottom: 16px; border: 1px solid #f0de99; }
            .footer { font-size: 12px; color: #013e37; opacity: 0.7; margin-top: 20px; border-top: 1px solid #e8e5dc; padding-top: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${escapeHtml(eventName || 'SpoonUp')}</h1>
            <div class="counter-badge">📍 ${escapeHtml(counterName || 'Main Shop')}</div>
            <p><strong>Scan to view menu &amp; order from your phone!</strong><br/>You will receive a WhatsApp ping when your order is ready.</p>
            <img src="${escapeHtml(qrDataUrl)}" alt="Scan QR code to order" />
            <p style="font-size: 12px; font-family: monospace; color: #013e37; opacity: 0.8;">${escapeHtml(safeMenuUrl)}</p>
            <div class="footer">Cash / UPI / Card accepted at counter</div>
          </div>
          <script>window.onload = function() { window.print(); }<\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleExportCSV = async () => {
    try {
      const res = await fetch('/api/orders/export/csv', {
        headers: { 'x-admin-pin': adminPin }
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `event_orders_${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to export CSV');
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Event Details */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-[#e8e5dc] space-y-5">
        <div>
          <h3 className="text-base font-bold text-[#013e37] flex items-center gap-2">
            <Store size={18} />
            <span>Event & Shop Configuration</span>
          </h3>
          <p className="text-xs text-[#013e37]/70 mt-0.5">Customize stall branding and security PIN.</p>
        </div>

        {successMsg && (
          <div className="p-2.5 bg-[#ffefb3] border border-[#f0de99] text-[#013e37] text-xs rounded-xl flex items-center gap-2 font-semibold">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
            ⚠️ {errorMsg}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-[#013e37] mb-1">
              Event Title
            </label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Festival Food Stall / College Fest"
              className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block font-bold text-[#013e37] mb-1">
              Shop / Pickup Location
            </label>
            <input
              type="text"
              value={counterName}
              onChange={(e) => setCounterName(e.target.value)}
              placeholder="e.g. Main Shop"
              className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block font-bold text-[#013e37] mb-1">
              Currency Symbol
            </label>
            <div className="flex gap-2">
              {['₹', '$', '€', '£', 'AED'].map(cur => (
                <button
                  type="button"
                  key={cur}
                  onClick={() => setCurrencySymbol(cur)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    currencySymbol === cur
                      ? 'bg-[#013e37] text-[#ffefb3] border-[#013e37]'
                      : 'bg-[#faf9f5] border-[#e8e5dc] text-[#013e37] hover:bg-[#ffefb3]/60'
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-[#013e37] mb-1 flex items-center gap-1">
              <KeyRound size={13} />
              <span>Change Admin PIN (Optional)</span>
            </label>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="Enter new 4-digit PIN"
              maxLength={8}
              className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs font-mono tracking-widest text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2.5 px-4 bg-[#013e37] hover:bg-[#06554c] disabled:opacity-50 text-[#ffefb3] font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Save size={14} />
              <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </form>

        <div className="pt-3 border-t border-[#e8e5dc]">
          <p className="text-xs font-bold text-[#013e37] mb-1.5">Post-Event Accounting</p>
          <button
            type="button"
            onClick={handleExportCSV}
            className="w-full py-2 px-3 bg-[#faf9f5] hover:bg-[#ffefb3]/50 text-[#013e37] text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 border border-[#e8e5dc] cursor-pointer"
          >
            <Download size={14} />
            <span>Download Orders CSV Spreadsheet</span>
          </button>
        </div>
      </div>

      {/* Standee QR Card */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-[#e8e5dc] flex flex-col justify-between space-y-4">
        <div>
          <h3 className="text-base font-bold text-[#013e37] flex items-center gap-2">
            <QrCode size={18} />
            <span>Counter QR Standee</span>
          </h3>
          <p className="text-xs text-[#013e37]/70 mt-0.5">
            Display this QR code at your counter so customers can scan and order.
          </p>
        </div>

        <div className="bg-[#faf9f5] border border-[#e8e5dc] rounded-2xl p-5 text-center flex flex-col items-center">
          {qrDataUrl ? (
            <img 
              src={qrDataUrl} 
              alt="QR Code" 
              className="w-44 h-44 rounded-xl border border-[#e8e5dc] bg-white p-2"
            />
          ) : (
            <div className="w-44 h-44 bg-[#faf9f5] rounded-xl animate-pulse" />
          )}

          <p className="font-bold text-[#013e37] text-xs mt-2.5">
            Scan to Order & Collect
          </p>
          <p className="text-[11px] text-[#013e37]/60 font-mono mt-0.5 break-all max-w-xs">
            {menuUrl}
          </p>
        </div>

        <div className="space-y-2.5 text-xs">
          <div>
            <label className="block font-bold text-[#013e37] mb-1">
              Customer Menu URL
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={menuUrl}
                onChange={(e) => setMenuUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs font-mono text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
              />
              <button
                onClick={handleCopyLink}
                className="px-3 py-1.5 bg-white hover:bg-[#ffefb3]/60 text-[#013e37] text-xs font-semibold rounded-xl flex items-center gap-1 border border-[#e8e5dc] transition cursor-pointer"
              >
                {copiedLink ? <Check size={13} className="text-[#013e37]" /> : <Copy size={13} />}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePrintQR}
            className="w-full py-2.5 px-4 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Printer size={14} />
            <span>Print Counter Standee Sign</span>
          </button>
        </div>
      </div>
    </div>
  );
}
