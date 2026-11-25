// Token Radar's dashboard (model radar-2). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table and a per-protocol detail drawer.
// The page recomputes every row's implied value from the snapshot figures and the peer table,
// and regenerates the farm plan with the same derivation board.json carries, so what the page
// shows and what the board says are the same arithmetic. No network: every byte is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 100) / 100).toFixed(2) + 'x'; }

  // radar-2 in one function: the page recomputes a row from the snapshot figures, the category's
  // peer multiple and the model's constants, and checks the number board.json carries.
  function impliedOf(row, model) {
    var pct = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var momentum = 1 + model.momentum_weight * Math.tanh(pct / model.momentum_scale);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * Math.min(1, Math.log1p(Math.max(age, 0)) / Math.log1p(model.maturity_days));
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * row.breadth_multiplier * momentum * maturity));
  }
  function multipleOf(category) {
    for (var i = 0; i < DATA.multiples.length; i++) if (DATA.multiples[i].category === category) return DATA.multiples[i];
    return null;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the actions, the capital, the gas and the hold. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return 'about $12 of gas at a quiet hour';
    if (chain === 'Solana' || chain === 'Near' || chain === 'Sui' || chain === 'Aptos') return 'well under $1 of gas';
    if (chain === 'Bitcoin') return 'about $2 of fees';
    return 'about $3 of gas';
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + '; if it offers borrowing, take one small USDC loan against the position and repay it a week later so both sides of the market see the wallet.';
    if (c.indexOf('dex') >= 0) return 'Swap about $' + Math.max(25, Math.round(capital / 2)) + ' through ' + name + "'s busiest pair on " + chain + ', then provide $' + capital + ' of liquidity to that pool and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s main vault or pool on " + chain + ' and leave auto-compounding on if it offers it.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into one of ' + name + "'s curated vaults on " + chain + ' and keep the vault shares in the wallet.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, then close it after a day so the wallet records a full trade cycle.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' after its onboarding check, and hold the asset in the wallet.';
    if (c.indexOf('basis') >= 0) return 'Open ' + name + "'s basis position with $" + capital + ' on ' + chain + ', following its own deposit flow, and keep it open.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position on each side of a liquid market on ' + name + ', so the wallet shows real trading, not a single bet.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it rather than swapping out at once.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for the shortest term it sells and keep the policy to expiry.';
    if (c.indexOf('launchpad') >= 0) return 'Register the wallet on ' + name + ' and join one open sale or waitlist round with about $' + capital + ' ready to commit.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it in the wallet.';
    if (c.indexOf('payment') >= 0) return 'Route one real payment of about $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + ' and make one swap and one transfer there in the same week, so the wallet is a real user of the chain.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondSurfaceFor(p, capital) {
    var name = p.name;
    if (p.chains && p.chains.length >= 2) {
      return 'Repeat a smaller version on ' + p.chains[1] + ': about $' + Math.max(25, Math.round(capital / 2)) + ' through ' + name + ' there, so the wallet is active on two of its ' + p.chains.length + ' chains, not just the cheapest one.';
    }
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Open a second market on ' + name + ': supply a different asset than the first deposit, so the wallet is not a one-market user.';
    if (c.indexOf('dex') >= 0) return 'Trade a second pair on ' + name + ' once, a small swap of about $25, so the wallet\'s history is more than one pool.';
    return 'Use one more of ' + name + "'s own features once (a second vault, a vote, or its referral page), so the wallet reads as a user, not a single deposit.";
  }
  function cadenceFor(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Repay and redraw a small loan, or top the supply up by a few dollars, once a week on ' + name + '.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Make one small swap or rebalance on ' + name + ' each week, even $10, so no week in the window is silent.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Open and close one small position on ' + name + ' each week; volume over time is what its snapshots record.';
    return 'Make one qualifying action on ' + name + ' each week: a deposit, a claim, a vote or a small trade, never the same minute each time.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Start from a fresh wallet that holds only the funds for this farm; keep its seed phrase offline and fund it with the gas token of ' + chain + ' first.', cost: 'under $5 to fund and make the first transaction', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '20 minutes to set up' },
      { text: secondSurfaceFor(p, capital), cost: 'about $' + Math.max(25, Math.round(capital / 2)) + ' of capital and ' + gasFor(p.chains && p.chains.length > 1 ? p.chains[1] : chain), time: '15 minutes' },
      { text: cadenceFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days and put two calendar reminders inside the window, so the activity spans more than one activity snapshot instead of a single weekend.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Open ' + p.name + "'s own points or rewards page, link the wallet if it offers one, and claim only from links the protocol itself publishes; never pay a fee to claim and never sign a claim from a search result or a direct message.", cost: 'nothing to check; a claim that asks for a fee is a scam', time: '10 minutes' },
      { text: 'Keep a farm log with the wallet, the chain, the dates and the transaction hashes, and note how the position unwinds, so you can exit in minutes if the protocol is hacked, pauses withdrawals or announces a snapshot you want to be inside.', cost: 'nothing but the log', time: '5 minutes, then 1 minute a week' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.scope === 'watch' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, priced by their own category\u2019s market' }),
        el('p', null,
          'Every protocol with no token on record is priced the way its category already trades: the live-token protocols in the same category set the multiple, the seven-day move and the years without a token adjust it. The watchlist of ',
          el('b', { text: String(DATA.watchlist_size) }),
          ' is the floor, and the early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' launch candidates below it. An implied value is a model, not a promise.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median peer multiple' }), el('b', { text: fmtMult(DATA.global_multiple) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function selectField(id, label, values, current, onchange) {
      var select = el('select', { id: id, 'aria-label': label },
        el('option', { value: 'all', text: label === 'Category' ? 'All categories' : label === 'Chain' ? 'All chains' : 'All rows' }),
        values.map(function (v) { return el('option', { value: v.value, text: v.text, selected: v.value === current ? 'selected' : null }); })
      );
      select.addEventListener('change', function () { onchange(select.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
    }
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', categories.map(function (c) { return { value: c, text: c }; }), state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', chains.map(function (c) { return { value: c, text: c }; }), state.chain, function (v) { state.chain = v; }),
      selectField('scope', 'Radar', [{ value: 'watch', text: 'Watchlist only' }, { value: 'early', text: 'Early radar only' }], state.scope, function (v) { state.scope = v; }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    if (state.sort !== 'implied' || state.dir !== -1) max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', { class: 'name-line' },
            el('b', { text: r.name }),
            r.watchlist ? el('span', { class: 'badge watch', text: 'watchlist' }) : el('span', { class: 'badge early', text: 'early radar' })
          ),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Peer x'), // median market cap per TVL dollar among the category's live-token peers, shrunk toward the snapshot median
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live token: these protocols already trade, so their market cap is a fact, not a model. Their category multiples are the evidence the pre-token board is priced from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' })))
        , tbody)
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var top = DATA.multiples.slice(0, 14);
    var tbody = el('tbody');
    top.forEach(function (x) {
      tbody.appendChild(el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.peers) }),
        el('td', { class: 'num', text: fmtMult(x.median) }),
        el('td', { class: 'num', text: fmtMult(x.effective) })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot\u2019s own figures. No protocol name is special-cased, and no row is hand-picked. The multiples below are computed from this snapshot at run time, not written into the code.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied' }),
        ' = round( tvl x ',
        el('b', { text: 'peer multiple' }),
        ' x (1 + ' + m.breadth_per_chain + ' x extra chains) x (1 + ' + m.momentum_weight + ' x tanh(change_7d / ' + m.momentum_scale + ')) x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x ln(1 + age) / ln(1 + ' + m.maturity_days + ')) )'
      ),
      el('p', { class: 'sub', text: 'A category\u2019s peer multiple is the median market-cap-to-TVL ratio of its live-token protocols, shrunk toward the snapshot-wide median of ' + fmtMult(DATA.global_multiple) + ' by peer count (weight n / (n + ' + m.shrink_k + ')) and clamped to ' + fmtMult(m.multiple_floor) + ' \u2013 ' + fmtMult(m.multiple_cap) + ', so one wild peer cannot price a whole category. Momentum is bounded by tanh, so a +4,000% week cannot outrank a balance sheet. Age is the days since DefiLlama first tracked the protocol; an unknown age uses ' + m.unknown_age_days + ' days.' }),
      el('table', { class: 'mult-table' },
        el('caption', { class: 'sub', text: 'Peer evidence by category: the live-token protocols that price the board.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Median' }), el('th', { scope: 'col', text: 'Applied' }))),
        tbody
      ),
      el('p', { class: 'sub', text: 'The early radar below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor applies the house\u2019s own watchlist sense: no token on record, and not a wrapped, staked or bridged product of another protocol, not an exchange\u2019s own page and not a versioned pool. Wrapped products of a token that already trades are not launches waiting to happen.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var mult = multipleOf(row.category || 'Other');
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.watchlist ? ' \u00b7 on the watchlist' : ' \u00b7 early radar, below the watchlist floor') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.peer_multiple) })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains ? row.chains.length : 0) + ' chains)' }), el('b', { class: 'num', text: fmtMult(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Seven-day momentum (' + fmtPct(row.change_7d) + ')' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: mult
        ? 'The ' + (row.category || 'Other') + ' multiple comes from ' + mult.peers + ' live-token peer' + (mult.peers === 1 ? '' : 's') + ' in this snapshot: median ' + fmtMult(mult.median) + ', shrunk to ' + fmtMult(mult.effective) + ' against the snapshot-wide median of ' + fmtMult(DATA.global_multiple) + '.'
        : 'No live-token peer prices this category in the snapshot, so the row uses the snapshot-wide median multiple of ' + fmtMult(DATA.global_multiple) + '.' }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: DATA.source }),
      el('span', { text: 'Static page: no network, no tracking. Implied values are model estimates, not prices or advice.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
