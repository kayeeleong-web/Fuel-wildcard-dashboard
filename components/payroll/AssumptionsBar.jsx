'use client';

import { useState } from 'react';

/** One small editable assumption input — commits on blur, like every other editable
 *  cell on this tab. Percent values are stored/edited as plain numbers (7.5 = 7.5%). */
export function AssumptionField({ label, value, onCommit, suffix = '%' }) {
  const [draft, setDraft] = useState(value ?? '');

  return (
    <label className="pr-assumption">
      <span className="pr-assumption-label">{label}</span>
      <span className="pr-assumption-input-wrap">
        <input
          type="text"
          inputMode="decimal"
          className="pr-input pr-input-assumption"
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(String(draft).replace(/[^0-9.-]/g, ''));
            const safe = Number.isFinite(n) ? n : 0;
            setDraft(safe);
            onCommit(safe);
          }}
        />
        <span className="pr-assumption-suffix">{suffix}</span>
      </span>
    </label>
  );
}

/**
 * Assumptions strip at the top of the Payroll tab — Tax Rate / Benefits / Bonus
 * Attainment / Yearly Merit Increase, matching the top-left block of Kayee's source
 * sheet. Tax Rate + Benefits feed every roster member's default loaded-cost formula;
 * Bonus Attainment feeds every bonus's monthly flow. Yearly Merit Increase is carried
 * over as a reference field only (it's blank/unused in the source sheet too) — this tab
 * doesn't auto-escalate future months from it, since that would mean inventing *when*
 * in the year a raise lands; edit the specific month's cell directly for a real raise,
 * same as the source sheet already requires.
 */
export function AssumptionsBar({ assumptions, onChange }) {
  return (
    <div className="payroll-assumptions">
      <AssumptionField
        label="Tax Rate"
        value={assumptions.taxRate}
        onCommit={(v) => onChange({ ...assumptions, taxRate: v })}
      />
      <AssumptionField
        label="Benefits"
        value={assumptions.benefits}
        onCommit={(v) => onChange({ ...assumptions, benefits: v })}
      />
      <AssumptionField
        label="Bonus Attainment"
        value={assumptions.bonusAttainment}
        onCommit={(v) => onChange({ ...assumptions, bonusAttainment: v })}
      />
      <AssumptionField
        label="Yrly Merit Increase"
        value={assumptions.yearlyMeritIncrease}
        onCommit={(v) => onChange({ ...assumptions, yearlyMeritIncrease: v })}
      />
      <div className="pr-assumption-note">
        Does not include contractors. Loaded cost = Base ÷ 12 × (1 + Tax Rate + Benefits).
      </div>
    </div>
  );
}
