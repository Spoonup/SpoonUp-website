import React, { useState, useEffect } from "react";
import {
  Store,
  QrCode,
  Printer,
  Download,
  KeyRound,
  CheckCircle2,
  Save,
  Copy,
  Check,
} from "lucide-react";
import QRCode from "qrcode";
import { adminFetch, notifyAdminSessionExpired } from "../lib/adminSession";

const MIN_PASSWORD_LENGTH = 8;

export default function AdminSettings({
  adminPin,
  settings,
  onRefreshSettings,
}) {
  const [eventName, setEventName] = useState(settings?.eventName || "");
  const [counterName, setCounterName] = useState(settings?.counterName || "");
  const [currencySymbol, setCurrencySymbol] = useState(
    settings?.currencySymbol || "₹",
  );
  const [upiId, setUpiId] = useState(settings?.upiId || "");
  const [upiPhone, setUpiPhone] = useState(settings?.upiPhone || "");
  const [adminUsername, setAdminUsername] = useState(
    settings?.adminUsername || "",
  );
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [qrDataUrl, setQrDataUrl] = useState("");
  const [menuUrl, setMenuUrl] = useState(window.location.origin);
  const [copiedLink, setCopiedLink] = useState(false);

  // Re-sync the form when fresh settings arrive from the server.
  const [syncedSettings, setSyncedSettings] = useState(settings);
  if (settings !== syncedSettings) {
    setSyncedSettings(settings);
    setEventName(settings?.eventName || "");
    setCounterName(settings?.counterName || "");
    setCurrencySymbol(settings?.currencySymbol || "₹");
    setUpiId(settings?.upiId || "");
    setUpiPhone(settings?.upiPhone || "");
    setAdminUsername(settings?.adminUsername || "");
  }

  useEffect(() => {
    QRCode.toDataURL(menuUrl, { width: 280, margin: 2 })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error(err));
  }, [menuUrl]);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const payload = {
        eventName,
        counterName,
        currencySymbol,
        upiId: upiId.trim(),
        upiPhone: upiPhone.trim(),
      };
      const usernameChanged = adminUsername.trim() && adminUsername.trim() !== (settings?.adminUsername || '');
      const changingCredential = Boolean(newPassword || usernameChanged);

      if (newPassword) {
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        if (newPassword !== confirmPassword) {
          throw new Error('The two passwords do not match');
        }
        payload.adminPassword = newPassword;
      }
      if (usernameChanged) {
        payload.adminUsername = adminUsername.trim();
      }
      if (changingCredential) {
        if (!currentPassword) {
          throw new Error('Enter your current password to change the admin login');
        }
        payload.currentPassword = currentPassword;
      }

      const res = await adminFetch("/api/settings", adminPin, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save settings");

      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      await onRefreshSettings();
      if (data.credentialChanged) {
        // Every session (including this one) was revoked by the credential change.
        setSuccessMsg(
          "Admin login updated. Please sign in again with the new credentials.",
        );
        setTimeout(notifyAdminSessionExpired, 1200);
      } else {
        setSuccessMsg("Settings updated successfully!");
      }
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
    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    let safeMenuUrl = "";
    try {
      const parsed = new URL(menuUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        safeMenuUrl = parsed.toString();
      }
    } catch {
      safeMenuUrl = "";
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Menu QR Code - ${escapeHtml(eventName || "Event")}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px; margin: 0; background: #F4F1E7; color: #1B2A18; }
            .card { max-width: 440px; margin: 0 auto; border: 2px solid #1B2A18; border-radius: 24px; padding: 36px 24px; background: #ffffff; }
            h1 { font-size: 26px; margin: 0 0 6px; color: #1B2A18; }
            p { font-size: 14px; color: #1e4f48; margin: 4px 0 16px; }
            img { width: 240px; height: 240px; margin: 8px auto; display: block; }
            .counter-badge { display: inline-block; background: #D8E2C4; color: #1B2A18; padding: 5px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; margin-bottom: 16px; border: 1px solid #BFD0A6; }
            .footer { font-size: 12px; color: #1B2A18; opacity: 0.7; margin-top: 20px; border-top: 1px solid #E4E2D9; padding-top: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${escapeHtml(eventName || "SpoonUp")}</h1>
            <div class="counter-badge">📍 ${escapeHtml(counterName || "Main Shop")}</div>
            <p><strong>Scan to view menu &amp; order from your phone!</strong><br/>You will receive a WhatsApp ping when your order is ready.</p>
            <img src="${escapeHtml(qrDataUrl)}" alt="Scan QR code to order" />
            <p style="font-size: 12px; font-family: monospace; color: #1B2A18; opacity: 0.8;">${escapeHtml(safeMenuUrl)}</p>
            <div class="footer">Cash / UPI / Card accepted at counter</div>
          </div>
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleExportCSV = async () => {
    try {
      const res = await adminFetch("/api/orders/export/csv", adminPin);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `event_orders_${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err.message || "Failed to export CSV");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Event Details */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-[#E4E2D9] space-y-5">
        <div>
          <h3 className="text-base font-bold text-[#1B2A18] flex items-center gap-2">
            <Store size={18} />
            <span>Event & Shop Configuration</span>
          </h3>
          <p className="text-xs text-[#1B2A18]/70 mt-0.5">
            Customize stall branding and the staff login.
          </p>
        </div>

        {successMsg && (
          <div className="p-2.5 bg-[#D8E2C4] border border-[#BFD0A6] text-[#1B2A18] text-xs rounded-xl flex items-center gap-2 font-semibold">
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
            <label className="block font-bold text-[#1B2A18] mb-1">
              Event Title
            </label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Festival Food Stall / College Fest"
              className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block font-bold text-[#1B2A18] mb-1">
              Shop / Pickup Location
            </label>
            <input
              type="text"
              value={counterName}
              onChange={(e) => setCounterName(e.target.value)}
              placeholder="e.g. Main Shop"
              className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block font-bold text-[#1B2A18] mb-1">
              Currency Symbol
            </label>
            <div className="flex gap-2">
              {["₹", "$", "€", "£", "AED"].map((cur) => (
                <button
                  type="button"
                  key={cur}
                  onClick={() => setCurrencySymbol(cur)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    currencySymbol === cur
                      ? "bg-[#1B2A18] text-[#FCFBF7] border-[#1B2A18]"
                      : "bg-[#F4F1E7] border-[#E4E2D9] text-[#1B2A18] hover:bg-[#D8E2C4]/60"
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-[#1B2A18] mb-1">
                UPI ID (shown to customers)
              </label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. shop@okhdfcbank"
                maxLength={80}
                className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-mono text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
              />
            </div>
            <div>
              <label className="block font-bold text-[#1B2A18] mb-1">
                UPI phone (optional)
              </label>
              <input
                type="tel"
                value={upiPhone}
                onChange={(e) => setUpiPhone(e.target.value)}
                placeholder="+91 ..."
                maxLength={24}
                className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-mono text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[#E4E2D9] space-y-3">
            <label className="block font-bold text-[#1B2A18] flex items-center gap-1">
              <KeyRound size={13} />
              <span>Admin Login</span>
            </label>
            <p className="text-[11px] text-[#1B2A18]/65 -mt-1">
              Changing either field signs out every device, including this one.
            </p>

            <div>
              <label className="block font-semibold text-[#1B2A18]/80 mb-1">Username</label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                placeholder="admin"
                maxLength={32}
                autoComplete="username"
                className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-semibold text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#1B2A18]/80 mb-1">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={`min ${MIN_PASSWORD_LENGTH} characters`}
                  maxLength={128}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-mono text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#1B2A18]/80 mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="repeat it"
                  maxLength={128}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-mono text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#1B2A18]/80 mb-1">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="required to change the login"
                maxLength={128}
                autoComplete="current-password"
                className="w-full px-3 py-2 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-mono text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
              />
            </div>
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2.5 px-4 bg-[#1B2A18] hover:bg-[#4A5D2E] disabled:opacity-50 text-[#FCFBF7] font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Save size={14} />
              <span>{isSaving ? "Saving..." : "Save Settings"}</span>
            </button>
          </div>
        </form>

        <div className="pt-3 border-t border-[#E4E2D9]">
          <p className="text-xs font-bold text-[#1B2A18] mb-1.5">
            Post-Event Accounting
          </p>
          <button
            type="button"
            onClick={handleExportCSV}
            className="w-full py-2 px-3 bg-[#F4F1E7] hover:bg-[#D8E2C4]/50 text-[#1B2A18] text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 border border-[#E4E2D9] cursor-pointer"
          >
            <Download size={14} />
            <span>Download Orders CSV Spreadsheet</span>
          </button>
        </div>
      </div>

      {/* Standee QR Card */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-[#E4E2D9] flex flex-col justify-between space-y-4">
        <div>
          <h3 className="text-base font-bold text-[#1B2A18] flex items-center gap-2">
            <QrCode size={18} />
            <span>Counter QR Standee</span>
          </h3>
          <p className="text-xs text-[#1B2A18]/70 mt-0.5">
            Display this QR code at your counter so customers can scan and
            order.
          </p>
        </div>

        <div className="bg-[#F4F1E7] border border-[#E4E2D9] rounded-2xl p-5 text-center flex flex-col items-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR Code"
              className="w-44 h-44 rounded-xl border border-[#E4E2D9] bg-white p-2"
            />
          ) : (
            <div className="w-44 h-44 bg-[#F4F1E7] rounded-xl animate-pulse" />
          )}

          <p className="font-bold text-[#1B2A18] text-xs mt-2.5">
            Scan to Order & Collect
          </p>
          <p className="text-[11px] text-[#1B2A18]/60 font-mono mt-0.5 break-all max-w-xs">
            {menuUrl}
          </p>
        </div>

        <div className="space-y-2.5 text-xs">
          <div>
            <label className="block font-bold text-[#1B2A18] mb-1">
              Customer Menu URL
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={menuUrl}
                onChange={(e) => setMenuUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs font-mono text-[#1B2A18] focus:border-[#1B2A18] focus:outline-hidden"
              />
              <button
                onClick={handleCopyLink}
                className="px-3 py-1.5 bg-white hover:bg-[#D8E2C4]/60 text-[#1B2A18] text-xs font-semibold rounded-xl flex items-center gap-1 border border-[#E4E2D9] transition cursor-pointer"
              >
                {copiedLink ? (
                  <Check size={13} className="text-[#1B2A18]" />
                ) : (
                  <Copy size={13} />
                )}
                <span>{copiedLink ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePrintQR}
            className="w-full py-2.5 px-4 bg-[#1B2A18] hover:bg-[#4A5D2E] text-[#FCFBF7] font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Printer size={14} />
            <span>Print Counter Standee Sign</span>
          </button>
        </div>
      </div>
    </div>
  );
}
