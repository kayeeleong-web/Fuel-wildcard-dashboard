'use client';

import { useMemo, useState } from 'react';
import { MonthInput, PayrollTable, TextInput } from '../payroll/PayrollTable';
import { AssumptionField } from '../payroll/AssumptionsBar';
import { formatPayrollAmount } from '../../lib/payroll/payrollData';
import {
  CASH_TIMINGS,
  DEAL_FIELD_DEFAULTS,
  DEAL_FIELD_LABELS,
  DEAL_STAGES,
  PAYMENT_TERMS,
  RECOGNITION_RULES,
  cogsCashWeightsForTerm,
  dealField,
  isOverriddenCsmField,
  makeDeal,
  projectAllDeals,
  stretchedCogsCashWeights,
} from '../../lib/deals/dealsData';

/**
 * Customer Revenue Projection — the deal-based framework from Kayee's Google Sheet
 * ("New" tab), rebuilt inside the Customer tab (2026-09-07, Kayee: "build out that same
 * layout in the customer tab. what we had before, we don't want it anymore").
 *
 * Top to bottom:
 *  1. Projection Summary — the four TOTAL rows the P&L / Cash Flow read (Accrual Revenue,
 *     Cash In, Accrual COGS, Cash Out), each expandable into its components.
 *  2. Deals — one block per contract line item: a header row carrying the deal's key
 *     terms (Stage, Probability, Contract Value, Term, Signing month) with an "Edit"
 *     panel for the rest (recognition rule, cash timing, payment terms, success fee,
 *     campaigns/month, price & cost per campaign, invoice lag), followed by the seven
 *     computed lines: Contract Accrual / Contract Cash / Success Fee Accrual / Success
 *     Fee Cash / Meetings Scheduled (typed, or from the CSM) / Campaign COGS (Accrual) /
 *     Campaign COGS (Cash).
 *  3. Assumptions strip — pipeline threshold, the "+2 months" recognition extension, the
 *     default cost per campaign, and the editable Campaign-COGS cash % table by term.
 *
 * Every deal field is "CSM by default, override here": the projection reads
 * overrides → CSM value → default (lib/deals/dealsData.js). With no CSM feed yet every
 * deal is manual; once the Slurp Bot import lands, a field the user has changed away
 * from the CSM value shows a "↺ CSM: …" reset link in the Edit panel.
 */

const SUMMARY_FROZEN_COLUMNS = [{ key: 'name', label: '', width: 280 }];

const DEAL_FROZEN_COLUMNS = [
  { key: 'name', label: 'Customer / Deal', width: 230 },
  { key: 'stage', label: 'Stage', width: 100 },
  { key: 'prob', label: 'Prob %', width: 62, align: 'right' },
  { key: 'value', label: 'Contract $', width: 104, align: 'right' },
  { key: 'term', label: 'Term', width: 54, align: 'right' },
  { key: 'start', label: 'Signing', width: 118 },
  { key: 'actions', label: '', width: 92, align: 'center' },
];

const DEAL_LINES = [
  { key: 'contractAccrual', label: 'Contract Accrual', hint: '→ P&L Subscription Revenue' },
  { key: 'contractCash', label: 'Contract Cash', hint: '→ Cash Flow' },
  { key: 'successFeeAccrual', label: 'Success Fee Accrual', hint: '→ P&L Transaction Revenue' },
  { key: 'successFeeCash', label: 'Success Fee Cash', hint: '→ Cash Flow' },
  { key: 'meetings', label: 'Meetings Scheduled (this month)', hint: 'from CSM · editable', count: true, editable: true },
  { key: 'cogsAccrual', label: 'Campaign COGS (Accrual)', hint: '→ P&L Cost of campaigns', negative: true },
  { key: 'cogsCash', label: 'Campaign COGS (Cash)', hint: '→ Cash Flow', negative: true },
];

function money(v, negative = false) {
  const s = formatPayrollAmount(v);
  if (!s) return '';
  return negative ? <span className="deal-neg">({s})</span> : s;
}

function count(v) {
  const n = Number(v) || 0;
  return n ? String(Math.round(n)) : '';
}

/* ------------------------------- Deal editor ------------------------------- */

function Field({ label, children, hint }) {
  return (
    <label className="software-rate-field">
      {label}
      {children}
      {hint}
    </label>
  );
}

/** "↺ CSM: x" link shown when the user has overridden a CSM-supplied value. */
function CsmHint({ deal, field, onReset }) {
  if (!isOverriddenCsmField(deal, field)) return null;
  return (
    <button type="button" className="pr-schedule-add-link deal-csm-reset" onClick={onReset}>
      ↺ CSM: {String(deal.csm[field])}
    </button>
  );
}

function NumberField({ value, onCommit, placeholder, suffix }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  const display = focused ? draft : value == null || value === '' ? '' : String(value);
  return (
    <span className="deal-number-field">
      <input
        type="text"
        inputMode="decimal"
        className="pr-input pr-input-month"
        value={display}
        placeholder={placeholder}
        onFocus={(e) => {
          setDraft(value == null ? '' : String(value));
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const cleaned = String(draft).replace(/[^0-9.-]/g, '');
          onCommit(cleaned === '' ? null : Number(cleaned));
        }}
      />
      {suffix && <span className="deal-field-suffix">{suffix}</span>}
    </span>
  );
}

function DealEditor({ deal, effective, settings, onSetField, onResetField }) {
  const sel = (field, options, labelFor = (o) => o.label ?? o, valueFor = (o) => o.value ?? o) => (
    <select className="pr-input pr-select" value={dealField(deal, field)} onChange={(e) => onSetField(field, e.target.value)}>
      {options.map((o) => (
        <option key={valueFor(o)} value={valueFor(o)}>
          {labelFor(o)}
        </option>
      ))}
    </select>
  );
  return (
    <div className="deal-editor">
      <div className="software-rate-editor">
        <Field label={DEAL_FIELD_LABELS.recognitionRule} hint={<CsmHint deal={deal} field="recognitionRule" onReset={() => onResetField('recognitionRule')} />}>
          {sel('recognitionRule', RECOGNITION_RULES)}
        </Field>
        <Field label={DEAL_FIELD_LABELS.cashTiming} hint={<CsmHint deal={deal} field="cashTiming" onReset={() => onResetField('cashTiming')} />}>
          {sel('cashTiming', CASH_TIMINGS)}
        </Field>
        <Field label={DEAL_FIELD_LABELS.paymentTermsDays} hint={<CsmHint deal={deal} field="paymentTermsDays" onReset={() => onResetField('paymentTermsDays')} />}>
          <select
            className="pr-input pr-select"
            value={String(Number(dealField(deal, 'paymentTermsDays')) || 0)}
            onChange={(e) => onSetField('paymentTermsDays', Number(e.target.value))}
          >
            {PAYMENT_TERMS.map((d) => (
              <option key={d} value={String(d)}>
                {d === 0 ? 'Due at signing (net 0)' : `Net ${d}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={DEAL_FIELD_LABELS.successFeeInvoiceLag} hint={<CsmHint deal={deal} field="successFeeInvoiceLag" onReset={() => onResetField('successFeeInvoiceLag')} />}>
          <NumberField value={dealField(deal, 'successFeeInvoiceLag')} onCommit={(v) => onSetField('successFeeInvoiceLag', v ?? DEAL_FIELD_DEFAULTS.successFeeInvoiceLag)} suffix="mo" />
        </Field>
      </div>
      <div className="software-rate-editor" style={{ marginTop: 12 }}>
        <Field label={DEAL_FIELD_LABELS.campaignsPerMonth} hint={<CsmHint deal={deal} field="campaignsPerMonth" onReset={() => onResetField('campaignsPerMonth')} />}>
          <NumberField value={dealField(deal, 'campaignsPerMonth')} onCommit={(v) => onSetField('campaignsPerMonth', v ?? 0)} />
        </Field>
        <Field label={DEAL_FIELD_LABELS.perCampaignPrice} hint={<CsmHint deal={deal} field="perCampaignPrice" onReset={() => onResetField('perCampaignPrice')} />}>
          <NumberField value={dealField(deal, 'perCampaignPrice')} onCommit={(v) => onSetField('perCampaignPrice', v ?? 0)} suffix="$" />
        </Field>
        <Field label={DEAL_FIELD_LABELS.avgSuccessFee} hint={<CsmHint deal={deal} field="avgSuccessFee" onReset={() => onResetField('avgSuccessFee')} />}>
          <NumberField value={dealField(deal, 'avgSuccessFee')} onCommit={(v) => onSetField('avgSuccessFee', v ?? 0)} suffix="$" />
        </Field>
        <Field
          label={DEAL_FIELD_LABELS.campaignCostRate}
          hint={
            <span className="deal-field-note">
              blank = default ${Number(settings.defaultCampaignCostRate) || 0}
              <CsmHint deal={deal} field="campaignCostRate" onReset={() => onResetField('campaignCostRate')} />
            </span>
          }
        >
          <NumberField value={dealField(deal, 'campaignCostRate')} onCommit={(v) => onSetField('campaignCostRate', v)} suffix="$" placeholder={String(settings.defaultCampaignCostRate ?? '')} />
        </Field>
      </div>
      <div className="software-editor-hint">
        Contract value {effective.contractValueIsAuto ? 'is auto-calculated' : 'is typed in'}: {effective.contractValueIsAuto ? `${effective.campaignsPerMonth} campaigns/mo × $${effective.perCampaignPrice.toLocaleString('en-US')} × ${effective.termMonths} mo = ` : ''}
        <b>${Math.round(effective.contractValue).toLocaleString('en-US')}</b>
        {effective.contractValueIsAuto ? '' : ' (clear the Contract $ cell to go back to auto)'}. Revenue and campaign COGS are recognized over{' '}
        <b>{effective.termMonths + (Number(settings.recognitionExtensionMonths) || 0)} months</b> ({effective.termMonths} + {Number(settings.recognitionExtensionMonths) || 0}); campaign cash goes out per the {effective.termMonths}-month % table below.
        {deal.csm ? ' Fields shown come from the CSM unless you changed them here.' : ' No CSM record linked yet — every field here is manual until the Slurp Bot feed lands.'}
      </div>
    </div>
  );
}

/* --------------------------- COGS cash weight table --------------------------- */

function WeightsTable({ settings, onChange }) {
  const ext = Math.max(0, Math.round(Number(settings.recognitionExtensionMonths) || 0));
  const terms = Object.keys(settings.cogsCashWeightsByTerm || {})
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const maxLen = Math.max(...terms.map((t) => cogsCashWeightsForTerm(settings, t).length), 1);

  function setWeight(term, idx, value) {
    const row = [...cogsCashWeightsForTerm(settings, term)];
    while (row.length <= idx) row.push(0);
    row[idx] = Number(value) || 0;
    onChange({ ...settings, cogsCashWeightsByTerm: { ...settings.cogsCashWeightsByTerm, [term]: row } });
  }
  function resetTerm(term) {
    onChange({ ...settings, cogsCashWeightsByTerm: { ...settings.cogsCashWeightsByTerm, [term]: stretchedCogsCashWeights(term, ext) } });
  }

  return (
    <div className="payroll-card">
      <div className="payroll-card-head">
        <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
          Campaign COGS — cash % by contract length
        </span>
        <span className="payroll-card-sub">
          Month 1 is always 0% (nothing is paid the month a contract starts); the rest of the deal&apos;s total campaign cost goes out by these
          percentages. Each row should sum to 100%.
        </span>
      </div>
      <div className="payroll-table-wrap">
        <table className="payroll-table deal-weights-table">
          <thead>
            <tr>
              <th className="pr-frozen pr-frozen-head pr-frozen-last" style={{ width: 150, left: 0 }}>
                Contract term
              </th>
              {Array.from({ length: maxLen }, (_, i) => (
                <th key={i} style={{ width: 62 }}>
                  M{i + 1}
                </th>
              ))}
              <th style={{ width: 70 }}>Total</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {terms.map((term) => {
              const row = cogsCashWeightsForTerm(settings, term);
              const sum = Math.round(row.reduce((a, b) => a + (Number(b) || 0), 0) * 10) / 10;
              return (
                <tr key={term}>
                  <td className="pr-frozen pr-frozen-last" style={{ width: 150, left: 0 }}>
                    <b>{term} months</b> <span className="deal-field-note">→ pays over {term + ext}</span>
                  </td>
                  {Array.from({ length: maxLen }, (_, i) =>
                    i < term + ext ? (
                      <td key={i} className="pr-month-cell">
                        <WeightInput value={row[i] ?? 0} onCommit={(v) => setWeight(term, i, v)} />
                      </td>
                    ) : (
                      <td key={i} className="pr-month-cell deal-weight-na" />
                    )
                  )}
                  <td className={`pr-month-cell${Math.abs(sum - 100) > 0.05 ? ' deal-weight-bad' : ''}`}>
                    <b>{sum}%</b>
                  </td>
                  <td className="pr-month-cell">
                    <button type="button" className="btn btn-xs" onClick={() => resetTerm(term)} title="Back to the stretched default">
                      Reset
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeightInput({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const [focused, setFocused] = useState(false);
  const display = focused ? draft : `${Number(value) || 0}%`;
  return (
    <input
      type="text"
      inputMode="decimal"
      className="pr-input pr-input-month deal-weight-input"
      value={display}
      onFocus={(e) => {
        setDraft(String(Number(value) || 0));
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        onCommit(Number(String(draft).replace(/[^0-9.]/g, '')) || 0);
      }}
    />
  );
}

/* --------------------------------- Section --------------------------------- */

export function DealProjectionSection({ dealsCtl, months, todayIso }) {
  const { state, setState, hydrated } = dealsCtl;
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [openSummary, setOpenSummary] = useState({ accrual: false, cashIn: false, cashOut: false });
  const [justAddedId, setJustAddedId] = useState(null);

  const projection = useMemo(() => (state ? projectAllDeals(state) : null), [state]);

  if (!hydrated || !state || !projection) {
    return <div className="cap">Loading saved deals…</div>;
  }

  const { settings, deals } = state;
  const { perDeal, totals } = projection;

  function updateSettings(next) {
    setState({ ...state, settings: next });
  }
  function updateDeal(id, patch) {
    setState({ ...state, deals: deals.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  }
  function setField(id, field, value) {
    const deal = deals.find((d) => d.id === id);
    if (!deal) return;
    updateDeal(id, { overrides: { ...(deal.overrides || {}), [field]: value } });
  }
  function resetField(id, field) {
    const deal = deals.find((d) => d.id === id);
    if (!deal) return;
    const overrides = { ...(deal.overrides || {}) };
    delete overrides[field];
    updateDeal(id, { overrides });
  }
  function setMeetings(id, iso, n) {
    const deal = deals.find((d) => d.id === id);
    if (!deal) return;
    updateDeal(id, { meetingsByMonth: { ...(deal.meetingsByMonth || {}), [iso]: n } });
  }
  function addDeal(stage) {
    const deal = makeDeal({ overrides: { stage, probabilityPct: stage === 'Signed' ? 100 : 50, signingMonth: todayIso } });
    setState({ ...state, deals: [...deals, deal] });
    setExpandedIds((prev) => new Set(prev).add(deal.id));
    setJustAddedId(deal.id);
  }
  function removeDeal(id) {
    setState({ ...state, deals: deals.filter((d) => d.id !== id) });
  }
  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ---- Summary rows ---- */
  const sumCells = (map, negative) => Object.fromEntries(months.map((iso) => [iso, <b key={iso}>{money(map[iso], negative)}</b>]));
  const subCells = (map, negative) => Object.fromEntries(months.map((iso) => [iso, money(map[iso], negative)]));
  const accrualRevenue = {};
  for (const iso of months) accrualRevenue[iso] = (totals.contractAccrual[iso] || 0) + (totals.successFeeAccrual[iso] || 0);
  const cashIn = {};
  for (const iso of months) cashIn[iso] = (totals.contractCash[iso] || 0) + (totals.successFeeCash[iso] || 0);

  const toggleBtn = (key, label) => (
    <button type="button" className="summary-row-toggle" onClick={() => setOpenSummary((p) => ({ ...p, [key]: !p[key] }))}>
      <span className={`payroll-chevron${openSummary[key] ? ' open' : ''}`}>▸</span> <b>{label}</b>
    </button>
  );
  const summaryRows = [
    { id: 'accrual', className: 'summary-grand-total', cells: { name: toggleBtn('accrual', 'TOTAL Accrual Revenue') }, monthCells: sumCells(accrualRevenue) },
    ...(openSummary.accrual
      ? [
          { id: 'accrual-contract', className: 'summary-subtotal', cells: { name: <span className="deal-line-label">↳ Contract Accrual → Subscription Revenue</span> }, monthCells: subCells(totals.contractAccrual) },
          { id: 'accrual-fee', className: 'summary-subtotal', cells: { name: <span className="deal-line-label">↳ Success Fee Accrual → Transaction Revenue</span> }, monthCells: subCells(totals.successFeeAccrual) },
        ]
      : []),
    { id: 'cashin', className: 'summary-grand-total', cells: { name: toggleBtn('cashIn', 'TOTAL Cash In') }, monthCells: sumCells(cashIn) },
    ...(openSummary.cashIn
      ? [
          { id: 'cashin-contract', className: 'summary-subtotal', cells: { name: <span className="deal-line-label">↳ Contract Cash</span> }, monthCells: subCells(totals.contractCash) },
          { id: 'cashin-fee', className: 'summary-subtotal', cells: { name: <span className="deal-line-label">↳ Success Fee Cash</span> }, monthCells: subCells(totals.successFeeCash) },
        ]
      : []),
    { id: 'cogs', className: 'summary-grand-total', cells: { name: <b>TOTAL Accrual COGS</b> }, monthCells: sumCells(totals.cogsAccrual, true) },
    { id: 'cashout', className: 'summary-grand-total', cells: { name: <b>TOTAL Cash Out</b> }, monthCells: sumCells(totals.cogsCash, true) },
  ];

  /* ---- Deal rows ---- */
  const dealGroups = perDeal.map(({ deal, effective, active, lines }, index) => {
    const isExpanded = expandedIds.has(deal.id);
    const stage = effective.stage;
    const belowThreshold = stage === 'Pipeline' && !active;
    const headerRow = {
      id: `${deal.id}__head`,
      className: `deal-head-row${active ? '' : ' deal-inactive-row'}`,
      isExpanded,
      expandedContent: isExpanded ? (
        <DealEditor
          deal={deal}
          effective={effective}
          settings={settings}
          onSetField={(field, value) => setField(deal.id, field, value)}
          onResetField={(field) => resetField(deal.id, field)}
        />
      ) : null,
      cells: {
        name: (
          <span className="deal-name-cell">
            <span className="driver-row-num">{index + 1}</span>
            <TextInput value={deal.name} placeholder="Customer / deal name" onCommit={(v) => updateDeal(deal.id, { name: v })} focusOnMount={deal.id === justAddedId} />
          </span>
        ),
        stage: (
          <select className={`pr-input pr-select deal-stage-${String(stage).toLowerCase()}`} value={stage} onChange={(e) => setField(deal.id, 'stage', e.target.value)}>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ),
        prob: (
          <span title={belowThreshold ? `Below the ${settings.pipelineThresholdPct}% threshold — not projected yet` : undefined} className={belowThreshold ? 'deal-below-threshold' : undefined}>
            <NumberField value={dealField(deal, 'probabilityPct')} onCommit={(v) => setField(deal.id, 'probabilityPct', v ?? 0)} />
          </span>
        ),
        value: (
          <span className={effective.contractValueIsAuto ? 'deal-auto-value' : undefined} title={effective.contractValueIsAuto ? 'Auto: campaigns/mo × price per campaign × term. Type a number to override.' : 'Typed contract value — clear to go back to auto.'}>
            <NumberField
              value={effective.contractValueIsAuto ? null : effective.contractValue}
              placeholder={Math.round(effective.contractValue).toLocaleString('en-US')}
              onCommit={(v) => setField(deal.id, 'contractValue', v)}
            />
          </span>
        ),
        term: <NumberField value={dealField(deal, 'termMonths')} onCommit={(v) => setField(deal.id, 'termMonths', v ?? DEAL_FIELD_DEFAULTS.termMonths)} />,
        start: <input type="month" className="pr-input pr-input-date" value={effective.signingMonth || ''} onChange={(e) => setField(deal.id, 'signingMonth', e.target.value)} />,
        actions: (
          <span className="software-row-actions">
            <button type="button" className={`btn btn-xs${isExpanded ? ' active' : ''}`} onClick={() => toggleExpanded(deal.id)}>
              {isExpanded ? 'Close' : 'Edit'}
            </button>
            <button type="button" className="icon-btn" title="Remove deal" onClick={() => removeDeal(deal.id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              </svg>
            </button>
          </span>
        ),
      },
      monthCells: Object.fromEntries(months.map((iso) => [iso, ''])),
    };

    const lineRows = DEAL_LINES.map((line) => ({
      id: `${deal.id}__${line.key}`,
      className: `deal-line-row${line.negative ? ' deal-cogs-row' : ''}`,
      cells: {
        name: (
          <span className="deal-line-label" title={line.hint}>
            {line.label} <span className="deal-field-note">{line.hint}</span>
          </span>
        ),
      },
      monthCells: Object.fromEntries(
        months.map((iso) => {
          if (line.editable) {
            return [iso, <MonthInput key={iso} value={Number(deal.meetingsByMonth?.[iso] ?? deal.csmMeetingsByMonth?.[iso]) || 0} onCommit={(n) => setMeetings(deal.id, iso, n)} />];
          }
          const v = lines[line.key]?.[iso];
          return [iso, line.count ? count(v) : money(v, line.negative)];
        })
      ),
    }));

    return { key: deal.id, label: null, rows: [headerRow, ...lineRows] };
  });

  return (
    <>
      <PayrollTable
        title="Projection Summary"
        subtitle="What flows into the P&L (accrual rows) and the Cash Flow (cash rows) — Subscription Revenue = contract accrual, Transaction Revenue = success-fee accrual, Cost of campaigns = campaign COGS"
        tintForecast={false}
        frozenColumns={SUMMARY_FROZEN_COLUMNS}
        months={months}
        todayIso={todayIso}
        rowGroups={[{ key: 'summary', label: null, rows: summaryRows }]}
      />

      <PayrollTable
        title="Deals — Signed & Pipeline"
        subtitle={`${deals.length} deal${deals.length === 1 ? '' : 's'} · every field defaults to the CSM record and can be changed here · Pipeline deals project once Probability ≥ ${settings.pipelineThresholdPct}%`}
        tintForecast={false}
        frozenColumns={DEAL_FROZEN_COLUMNS}
        months={months}
        todayIso={todayIso}
        className="customer-driver-grid deal-grid"
        rowGroups={dealGroups.length ? dealGroups : [{ key: 'empty', label: null, rows: [] }]}
        headActions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => addDeal('Signed')}>
              + Add Signed Deal
            </button>
            <button type="button" className="btn" onClick={() => addDeal('Pipeline')}>
              + Add Pipeline Deal
            </button>
          </div>
        }
        footer={
          deals.length === 0 ? (
            <span className="cap">No deals yet — add a signed deal or a pipeline prospect above. When the CSM (Slurp Bot) feed is connected, deals will appear here automatically with their contract terms filled in.</span>
          ) : null
        }
      />

      <div className="payroll-assumptions customer-assumptions">
        <AssumptionField
          label="Pipeline threshold — project a Pipeline deal once its probability reaches"
          value={settings.pipelineThresholdPct}
          suffix="%"
          onCommit={(v) => updateSettings({ ...settings, pipelineThresholdPct: v })}
        />
        <AssumptionField
          label="Recognition extension — months added to every contract term for accrual (3-month pilot → 5)"
          value={settings.recognitionExtensionMonths}
          suffix="mo"
          onCommit={(v) => updateSettings({ ...settings, recognitionExtensionMonths: Math.max(0, Math.round(v)) })}
        />
        <AssumptionField
          label="Default cost per campaign (used when a deal has no cost of its own)"
          value={settings.defaultCampaignCostRate}
          suffix="$"
          onCommit={(v) => updateSettings({ ...settings, defaultCampaignCostRate: v })}
        />
      </div>

      <WeightsTable settings={settings} onChange={updateSettings} />
    </>
  );
}
