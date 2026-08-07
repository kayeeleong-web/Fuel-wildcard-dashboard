'use client';

import { Component } from 'react';

/**
 * Wraps ONE tab's panel so a crash rendering it can never take down the whole app.
 *
 * Every tab in DashboardApp mounts unconditionally (all six panels render at once,
 * CSS `.panel-view.active` just controls which is visible) — that's what made a
 * single uncaught error inside any ONE panel's render turn into "Application error: a
 * client-side exception has occurred" for the ENTIRE site, on every page load, for
 * every tab, not just the broken one. This happened three separate times in one day
 * (2026-08-05/06): Payroll's ramp-role migration, Assumptions' old revenue shape, and
 * finally Reports' forecast-projection pipeline — each was fixed one at a time with a
 * local try/catch in that specific spot, which only ever protects against the ONE bug
 * already found, not the next one. A per-panel error boundary is the actual fix: it
 * catches ANY render-time error in ANY panel, no matter what causes it or which panel
 * it's in, and contains the damage to just that one tab.
 *
 * This is a React class component on purpose — error boundaries (getDerivedStateFromError
 * / componentDidCatch) are not expressible as a function component; there's no hooks
 * equivalent.
 */
export class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(`"${this.props.name}" tab failed to render:`, error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="cap" style={{ padding: '40px 20px' }}>
          Something went wrong loading the {this.props.name} tab. Try refreshing the page — every other tab still
          works normally. If it keeps happening after a refresh, this browser's saved data for this tab may be out
          of date; let Fuel Finance know.
        </div>
      );
    }
    return this.props.children;
  }
}
