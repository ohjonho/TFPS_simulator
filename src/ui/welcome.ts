// Campaign welcome screen — the intermediary between the intro story and the
// draft. A full-page (not modal) "here's how the game works" briefing: a hero
// line, the core systems as cards, a few coaching tips, and the first steps,
// then a single button into the draft. Adapts the AFL-Club-Manager welcome
// layout to OUR game (read the opponent → counter → win the season). Pure DOM;
// self-contained overlay removed on continue.

const HOST_ID = 'welcome-screen';

type Card = { title: string; body: string };

const SYSTEMS: Card[] = [
  { title: 'Draft your squad', body: 'Pick 5 players from a pool of 8. Weapon, role, traits and stats all shape how they play — there\'s no wrong start.' },
  { title: 'Read the opponent', body: 'Your Scout reads each rival\'s tendency — "leans Rush A" — before the round. The read is your edge.' },
  { title: 'Pick the counter', body: 'Each round, choose an attack or defense. Some commit a site; reading theirs and answering it is the whole game.' },
  { title: 'Run the season', body: 'A gauntlet of matches against the local circuit. Win enough to take the prize — and keep the shop\'s lights on.' },
  { title: 'Grow your team', body: 'New plays unlock as the season goes. Your roster carries the whole way, so every match builds on the last.' },
  { title: 'The recap teaches', body: 'After each round, the recap shows the matchup, how it was decided, and whether your read held — so you sharpen up.' },
];

const TIPS: Card[] = [
  { title: 'Read before you pick', body: 'The Scout\'s lean is usually right — but they\'ll deviate, so it tilts the round, it doesn\'t decide it.' },
  { title: 'Counter the site', body: '"Rush A" means stack A. When they commit a site, meet them there (or, attacking, hit the other one).' },
  { title: 'It\'s a read, not a coin flip', body: 'Every play beats something and loses to something. Match your pick to what they favor.' },
];

export function showWelcome(onContinue: () => void, onBack?: () => void): void {
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-header">
        <div class="welcome-kicker">Welcome, Coach</div>
        <h1>You're taking over a scrappy local team</h1>
        <p class="welcome-sub">One season, one shot to win the circuit and save the shop. Here's how it works.</p>
      </div>
      <h2 class="welcome-section">How the game works</h2>
      <div class="welcome-grid">
        ${SYSTEMS.map((c) => `<div class="welcome-tile"><div class="wt-title">${c.title}</div><div class="wt-body">${c.body}</div></div>`).join('')}
      </div>
      <h2 class="welcome-section">Coaching tips</h2>
      <div class="welcome-tips">
        ${TIPS.map((c) => `<div class="welcome-tip"><div class="wt-title">${c.title}</div><div class="wt-body">${c.body}</div></div>`).join('')}
      </div>
      <div class="welcome-firststeps">
        <div class="wt-title">First steps</div>
        <ol>
          <li>Draft your 5 from the pool of 8.</li>
          <li>Each round, read the Scout's lean on the opponent.</li>
          <li>Pick the counter, then watch it play out — and learn from the recap.</li>
        </ol>
      </div>
      <div class="welcome-actions">
        ${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}
        <button class="btn-primary" data-continue type="button">Draft your team &rarr;</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  host.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', () => {
    host.remove();
    onContinue();
  });
  host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => {
    host.remove();
    onBack?.();
  });
}
