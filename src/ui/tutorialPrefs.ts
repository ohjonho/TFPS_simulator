// Tutorial preferences — a global on/off toggle plus a per-campaign reset of the
// "seen" flags. The guided tours (walkthrough), coachmarks, and the welcome briefing
// are one-shot per browser by default; this lets them REPLAY for each new campaign
// (resetTutorialSeen on a fresh season) and be turned off entirely in Settings.

const OFF_KEY = 'tfps:tutorials:off';
// Prefixes of the per-tour "seen" keys (ui/walkthrough.ts, ui/coachmark.ts).
const SEEN_PREFIXES = ['tfps:walk:', 'tfps:coach:'];

export function tutorialsOn(): boolean {
  try { return localStorage.getItem(OFF_KEY) !== '1'; } catch { return true; }
}

export function setTutorialsOn(on: boolean): void {
  try { if (on) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, '1'); } catch { /* ignore */ }
}

// Clear every tour's "seen" flag so the walkthroughs + coachmarks re-arm — called
// when a new campaign begins, so each playthrough gets the tutorials fresh.
export function resetTutorialSeen(): void {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && SEEN_PREFIXES.some((p) => k.startsWith(p))) remove.push(k);
    }
    remove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
