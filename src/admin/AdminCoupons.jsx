import React from 'react';

/**
 * 1f · Coupons.
 *
 * There is no coupon model on the server: no table, no endpoints, and checkout
 * does not apply one. Rather than list sample codes that cannot be created,
 * edited or redeemed, this states what exists and what it needs.
 */
export default function AdminCoupons() {
  return (
    <div className="flex flex-col gap-[18px] max-w-[720px]">
      <div>
        <h1 className="font-display text-[26px] leading-none text-ink m-0">Coupons</h1>
        <p className="text-[12.5px] text-ink-60 mt-2 mb-0">
          Discount codes for everyone, a cohort, or one person.
        </p>
      </div>

      <div className="bg-white border border-dashed border-line-20 rounded-lg p-8 text-center">
        <p className="text-[14px] font-medium text-ink m-0">Not connected yet</p>
        <p className="text-[13px] leading-[1.65] text-ink-60 mt-2 mb-0 max-w-[460px] mx-auto">
          Coupons aren&apos;t stored or redeemed anywhere yet, so there is nothing to show. The
          checkout coupon box is disabled for the same reason — applying a code there would not
          change what the customer is charged.
        </p>
      </div>

      <div className="bg-white border border-line-10 rounded-lg p-5">
        <h2 className="text-[13.5px] font-semibold text-ink m-0 mb-2.5">What this needs</h2>
        <ul className="list-none p-0 m-0 flex flex-col gap-2 text-[12.5px] leading-[1.6] text-ink-65">
          <li>A <code className="font-mono text-[11.5px] text-ink">coupons</code> table: code, kind (percent or flat), value, cap, scope, validity, usage limit.</li>
          <li>A redemption log, so a one-person or single-use code can actually be enforced.</li>
          <li>Server-side application inside <code className="font-mono text-[11.5px] text-ink">verifyCartItems</code>, so the discount is computed where prices are.</li>
          <li>Admin CRUD endpoints behind <code className="font-mono text-[11.5px] text-ink">authenticateAdmin</code>.</li>
        </ul>
        <p className="text-[11.5px] text-ink-50 m-0 mt-3">
          Discounts must be applied server-side — a client-side coupon can be edited by the buyer.
        </p>
      </div>
    </div>
  );
}
