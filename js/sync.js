/*
 * Story Outline Tool — end-to-end encrypted sync over Nostr.
 *
 * How the data is stored on relays:
 *   - Every story tab is one NIP-78 application-data event (kind 30078) with
 *     the `d` tag "story-outline-tool/tab/<tab id>". Its content is the tab,
 *     gzipped and NIP-44 encrypted to the user's own key, so only the holder
 *     of the key can read it. A deleted tab becomes `{ deletedAt }`.
 *   - One index event ("story-outline-tool/index") holds the tab order and
 *     the deleted-tab list.
 * These are replaceable events: a newer one with the same `d` tag replaces the
 * old one on the relay.
 *
 * Merging: whole tabs, newest `updatedAt` wins. A deletion wins over edits
 * made before it, and loses to edits made after it.
 *
 * Signing in, three ways:
 *   - "key": a secret key generated here or pasted in (nsec). Kept in this
 *     browser's localStorage.
 *   - "extension": a NIP-07 browser extension (needs NIP-44 support).
 *   - "bunker": a NIP-46 remote signer (bunker:// URI).
 */
(function (global) {
  'use strict';

  var NT = global.NostrTools;
  var store = global.SOT.store;

  var ACCOUNT_KEY = 'storyOutlineTool.sync';
  var KIND = 30078;
  var D_PREFIX = 'story-outline-tool/';
  var D_INDEX = D_PREFIX + 'index';
  var D_TAB = D_PREFIX + 'tab/';
  var MAX_PLAINTEXT = 65535; // NIP-44 limit
  var DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];
  var AUTO_SYNC_DELAY = 3000;
  var POLL_INTERVAL = 90 * 1000;

  // Saved in localStorage: { method, pubkey, sk?, bunker?: { pointer, clientSk }, relays, seen, lastSyncedAt }
  // `seen[d]` remembers the last version of each event this device merged or
  // published, so unchanged events are not downloaded and decrypted again.
  var account = null;
  var signer = null;
  var pool = null;
  var status = { state: 'off', message: '' };
  var listeners = [];
  var running = null;
  var rerun = false;
  var timer = 0;

  // --- helpers --------------------------------------------------------------

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    var s = atob(b64);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + str.length;
  }
  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message)); }, ms);
    })]);
  }
  function nowSeconds() { return Math.floor(Date.now() / 1000); }

  function emit() { listeners.forEach(function (fn) { fn(getStatus()); }); }
  function setStatus(state, message) {
    status = { state: state, message: message || '' };
    emit();
  }

  function saveAccount() {
    try {
      if (account) global.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
      else global.localStorage.removeItem(ACCOUNT_KEY);
    } catch (err) { /* storage unavailable: sync still works for this session */ }
  }

  function loadAccount() {
    try {
      var raw = global.localStorage.getItem(ACCOUNT_KEY);
      account = raw ? JSON.parse(raw) : null;
    } catch (err) { account = null; }
    if (account && (!account.pubkey || !account.method)) account = null;
    if (account) {
      account.seen = account.seen || {};
      account.relays = account.relays && account.relays.length ? account.relays : DEFAULT_RELAYS.slice();
    }
  }

  function relays() { return (account && account.relays) || DEFAULT_RELAYS; }

  function getPool() {
    if (!pool) pool = new NT.SimplePool();
    return pool;
  }

  // --- payloads -------------------------------------------------------------

  function gzip(text) {
    var stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }
  function gunzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  function pack(obj, label) {
    var json = JSON.stringify(obj);
    var build = global.CompressionStream
      ? gzip(json).then(function (gz) { return JSON.stringify({ v: 1, gz: bytesToBase64(gz) }); })
      : Promise.resolve(JSON.stringify({ v: 1, json: json }));
    return build.then(function (text) {
      if (new TextEncoder().encode(text).length > MAX_PLAINTEXT) {
        throw new Error('“' + (label || 'This story') + '” is too large to sync. Try shortening some chapter summaries.');
      }
      return text;
    });
  }

  function unpack(text) {
    var o = JSON.parse(text);
    if (o && typeof o.gz === 'string') return gunzip(base64ToBytes(o.gz)).then(JSON.parse);
    if (o && typeof o.json === 'string') return Promise.resolve(JSON.parse(o.json));
    return Promise.resolve(null);
  }

  // --- signers --------------------------------------------------------------

  function localSigner(skHex) {
    var sk = hexToBytes(skHex);
    var pk = NT.getPublicKey(sk);
    var ck = NT.nip44.getConversationKey(sk, pk);
    return {
      pubkey: pk,
      sign: function (t) { return Promise.resolve(NT.finalizeEvent(t, sk)); },
      encrypt: function (text) { return Promise.resolve(NT.nip44.encrypt(text, ck)); },
      decrypt: function (ct) { return Promise.resolve(NT.nip44.decrypt(ct, ck)); }
    };
  }

  function extensionSigner(pubkey) {
    var ext = global.nostr;
    if (!ext) throw new Error('No Nostr browser extension was found. Install or unlock one, then try again.');
    if (!ext.nip44) throw new Error('Your Nostr extension doesn’t support NIP-44 encryption, which sync needs.');
    return {
      pubkey: pubkey,
      sign: function (t) { return ext.signEvent(t); },
      encrypt: function (text) { return ext.nip44.encrypt(pubkey, text); },
      decrypt: function (ct) { return ext.nip44.decrypt(pubkey, ct); }
    };
  }

  function openAuthUrl(url) { global.open(url, '_blank', 'noopener'); }

  function wrapBunker(bs, pubkey) {
    return {
      pubkey: pubkey,
      sign: function (t) { return bs.signEvent(t); },
      encrypt: function (text) { return bs.nip44Encrypt(pubkey, text); },
      decrypt: function (ct) { return bs.nip44Decrypt(pubkey, ct); },
      close: function () { return bs.close(); }
    };
  }

  function getSigner() {
    if (signer) return signer;
    if (!account) throw new Error('Sync isn’t set up.');
    if (account.method === 'key') signer = localSigner(account.sk);
    else if (account.method === 'extension') signer = extensionSigner(account.pubkey);
    else if (account.method === 'bunker') {
      var bs = NT.BunkerSigner.fromBunker(hexToBytes(account.bunker.clientSk), account.bunker.pointer,
        { pool: getPool(), onauth: openAuthUrl });
      signer = wrapBunker(bs, account.pubkey);
    }
    return signer;
  }

  // --- relay I/O ------------------------------------------------------------

  function dTag(ev) {
    for (var i = 0; i < ev.tags.length; i++) if (ev.tags[i][0] === 'd') return ev.tags[i][1];
    return null;
  }

  /** Newest event per `d` tag for this app, keyed by `d`. */
  function fetchLatest(pubkey) {
    return getPool().querySync(relays(), { kinds: [KIND], authors: [pubkey] }, { maxWait: 8000 }).then(function (events) {
      var latest = {};
      events.forEach(function (ev) {
        var d = dTag(ev);
        if (!d || d.indexOf(D_PREFIX) !== 0) return;
        var cur = latest[d];
        if (!cur || ev.created_at > cur.created_at || (ev.created_at === cur.created_at && ev.id < cur.id)) latest[d] = ev;
      });
      return latest;
    });
  }

  /** Decrypt an event's payload, or null if it is empty or unreadable. */
  function open(s, ev) {
    if (!ev.content) return Promise.resolve(null);
    return s.decrypt(ev.content).then(unpack).catch(function () { return null; });
  }

  function publishEvent(s, template) {
    return s.sign(template).then(function (ev) {
      var attempts = getPool().publish(relays(), ev, { maxWait: 8000 });
      return Promise.any(attempts).catch(function () {
        throw new Error('None of the sync relays accepted the update. Check your connection and try again.');
      });
    });
  }

  function nextCreatedAt(d) {
    var prev = account.seen[d];
    return Math.max(nowSeconds(), prev ? prev.created_at + 1 : 0);
  }

  function publishPayload(s, d, payload, stamp, label) {
    var createdAt = nextCreatedAt(d);
    return pack(payload, label).then(s.encrypt).then(function (content) {
      return publishEvent(s, { kind: KIND, created_at: createdAt, tags: [['d', d]], content: content });
    }).then(function () {
      account.seen[d] = { created_at: createdAt, stamp: stamp };
      saveAccount();
    });
  }

  function stampFor(d, payload) {
    if (!payload) return null;
    if (d === D_INDEX) return hash(JSON.stringify(payload));
    if (payload.tab) return payload.tab.updatedAt;
    if (payload.deletedAt) return 'deleted:' + payload.deletedAt;
    return null;
  }

  function indexPayload(db) {
    return { tabOrder: db.tabs.map(function (t) { return t.id; }), tabOrderUpdatedAt: db.tabOrderUpdatedAt, deletedTabs: db.deletedTabs };
  }

  /**
   * Download and decrypt remote events. With `all` false, only events that
   * changed since this device last saw them are decrypted.
   */
  function readRemote(s, all) {
    return fetchLatest(s.pubkey).then(function (latest) {
      var remote = { index: null, tabs: {}, deleted: {} };
      var seen = all ? {} : account.seen;
      var jobs = Object.keys(latest).map(function (d) {
        var ev = latest[d];
        var prev = seen[d];
        if (prev && prev.created_at >= ev.created_at) return null;
        return open(s, ev).then(function (payload) {
          account.seen[d] = { created_at: ev.created_at, stamp: stampFor(d, payload) };
          if (!payload) return;
          if (d === D_INDEX) remote.index = payload;
          else if (d.indexOf(D_TAB) === 0) {
            var id = d.slice(D_TAB.length);
            if (payload.tab && payload.tab.id === id) remote.tabs[id] = payload.tab;
            else if (payload.deletedAt) remote.deleted[id] = payload.deletedAt;
          }
        });
      });
      return Promise.all(jobs).then(function () { return remote; });
    });
  }

  // --- merging --------------------------------------------------------------

  function merge(local, remote) {
    var db = JSON.parse(JSON.stringify(local));
    var tombs = db.deletedTabs || {};
    function addTomb(id, t) { if (t && (!tombs[id] || t > tombs[id])) tombs[id] = t; }
    Object.keys(remote.deleted).forEach(function (id) { addTomb(id, remote.deleted[id]); });
    if (remote.index && remote.index.deletedTabs) {
      Object.keys(remote.index.deletedTabs).forEach(function (id) { addTomb(id, remote.index.deletedTabs[id]); });
    }

    Object.keys(remote.tabs).forEach(function (id) {
      var r = remote.tabs[id];
      var i = db.tabs.findIndex(function (t) { return t.id === id; });
      if (i < 0) db.tabs.push(r);
      else if (r.updatedAt > db.tabs[i].updatedAt) db.tabs[i] = r;
    });

    db.tabs = db.tabs.filter(function (t) {
      var deletedAt = tombs[t.id];
      if (deletedAt && deletedAt >= t.updatedAt) return false;
      if (deletedAt) delete tombs[t.id]; // edited after it was deleted elsewhere: keep it
      return true;
    });
    db.deletedTabs = tombs;

    var idx = remote.index;
    if (idx && Array.isArray(idx.tabOrder) && (idx.tabOrderUpdatedAt || '') > (db.tabOrderUpdatedAt || '')) {
      var pos = {};
      idx.tabOrder.forEach(function (id, i) { pos[id] = i; });
      var before = db.tabs.slice();
      db.tabs.sort(function (a, b) {
        var pa = a.id in pos ? pos[a.id] : 1e6 + before.indexOf(a);
        var pb = b.id in pos ? pos[b.id] : 1e6 + before.indexOf(b);
        return pa - pb;
      });
      db.tabOrderUpdatedAt = idx.tabOrderUpdatedAt;
    }
    return db;
  }

  /** A device that has never been used: one empty story and nothing else. */
  function isPristine(db) {
    return db.tabs.length === 1 && !db.tabs[0].order.length && !db.tabs[0].subplots.length &&
      !Object.keys(db.deletedTabs || {}).length;
  }

  // --- sync runs ------------------------------------------------------------

  /**
   * mode "merge": combine local and remote data and upload what changed.
   * mode "pull": replace local data with what's on the relays.
   */
  function run(mode) {
    if (running) { rerun = true; return running; }
    clearTimeout(timer);
    setStatus('syncing');
    var s;
    running = Promise.resolve().then(function () {
      s = getSigner();
      return readRemote(s, mode === 'pull');
    }).then(function (remote) {
      if (mode === 'pull') {
        var pulled = merge({ tabs: [], deletedTabs: {}, tabOrderUpdatedAt: '' }, remote);
        if (!pulled.tabs.length) pulled = null;
        store.resetDatabase(pulled);
      } else {
        store.applySynced(merge(store.getDb(), remote), true);
      }
      return upload(s);
    }).then(function () {
      account.lastSyncedAt = new Date().toISOString();
      saveAccount();
      setStatus('synced');
    }, function (err) {
      setStatus('error', (err && err.message) || 'Sync failed.');
      throw err;
    }).finally(function () {
      running = null;
      if (rerun && account) { rerun = false; schedule(0); }
    });
    return running;
  }

  function upload(s) {
    var db = store.getDb();
    var seen = account.seen;
    var tasks = [];
    db.tabs.forEach(function (tab) {
      var d = D_TAB + tab.id;
      if (!seen[d] || seen[d].stamp !== tab.updatedAt) {
        tasks.push(function () { return publishPayload(s, d, { tab: tab }, tab.updatedAt, tab.name); });
      }
    });
    Object.keys(db.deletedTabs).forEach(function (id) {
      var d = D_TAB + id;
      var stamp = 'deleted:' + db.deletedTabs[id];
      // Only tabs that were synced at some point need a deletion marker.
      if (seen[d] && seen[d].stamp && seen[d].stamp !== stamp) {
        tasks.push(function () { return publishPayload(s, d, { deletedAt: db.deletedTabs[id] }, stamp); });
      }
    });
    var index = indexPayload(db);
    var indexStamp = hash(JSON.stringify(index));
    if (!seen[D_INDEX] || seen[D_INDEX].stamp !== indexStamp) {
      tasks.push(function () { return publishPayload(s, D_INDEX, index, indexStamp); });
    }
    // One at a time, so a signer extension or bunker isn't flooded with requests.
    return tasks.reduce(function (p, task) { return p.then(task); }, Promise.resolve());
  }

  function schedule(delay) {
    if (!account) return;
    clearTimeout(timer);
    timer = setTimeout(function () { run('merge').catch(function () { /* shown via status */ }); }, delay);
  }

  function connect(next, firstSigner) {
    account = next;
    account.seen = {};
    account.relays = account.relays || DEFAULT_RELAYS.slice();
    signer = firstSigner || null;
    saveAccount();
    // On a fresh device, take the synced data as-is instead of adding an empty story to it.
    return run(isPristine(store.getDb()) ? 'pull' : 'merge');
  }

  // --- public API -----------------------------------------------------------

  function getStatus() {
    return {
      state: status.state,
      message: status.message,
      connected: !!account,
      method: account ? account.method : null,
      npub: account ? NT.nip19.npubEncode(account.pubkey) : null,
      lastSyncedAt: account ? account.lastSyncedAt || null : null,
      relays: relays().slice()
    };
  }

  var Sync = {
    DEFAULT_RELAYS: DEFAULT_RELAYS,
    ACCOUNT_KEY: ACCOUNT_KEY,

    init: function () {
      if (!NT) return;
      loadAccount();
      if (account) setStatus('idle');
      store.subscribe(function (meta) {
        if (meta.synced || meta.external || meta.reset) return;
        schedule(AUTO_SYNC_DELAY);
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') schedule(0);
      });
      setInterval(function () {
        if (document.visibilityState === 'visible' && !running) schedule(0);
      }, POLL_INTERVAL);
      schedule(300);
    },

    available: function () { return !!NT; },
    subscribe: function (fn) { listeners.push(fn); },
    status: getStatus,

    /** Make a brand-new key. Nothing is saved until `useKey` is called with it. */
    generateKey: function () {
      var sk = NT.generateSecretKey();
      return { nsec: NT.nip19.nsecEncode(sk), npub: NT.nip19.npubEncode(NT.getPublicKey(sk)) };
    },

    /** Start syncing with a secret key (nsec1… or 64-char hex). */
    useKey: function (input) {
      var value = String(input || '').trim();
      var skHex;
      if (/^[0-9a-f]{64}$/i.test(value)) skHex = value.toLowerCase();
      else {
        var decoded;
        try { decoded = NT.nip19.decode(value); } catch (err) { decoded = null; }
        if (!decoded || decoded.type !== 'nsec') {
          return Promise.reject(new Error('That doesn’t look like a sync key. It should start with “nsec1”.'));
        }
        skHex = bytesToHex(decoded.data);
      }
      var s = localSigner(skHex);
      return connect({ method: 'key', sk: skHex, pubkey: s.pubkey }, s);
    },

    hasExtension: function () { return !!global.nostr; },

    useExtension: function () {
      var ext = global.nostr;
      if (!ext) return Promise.reject(new Error('No Nostr browser extension was found. Install or unlock one, then try again.'));
      return Promise.resolve(ext.getPublicKey()).then(function (pubkey) {
        var s = extensionSigner(pubkey);
        return connect({ method: 'extension', pubkey: pubkey }, s);
      });
    },

    useBunker: function (input) {
      var clientSk = NT.generateSecretKey();
      var bs;
      return NT.parseBunkerInput(String(input || '').trim()).then(function (pointer) {
        if (!pointer) throw new Error('That doesn’t look like a bunker address. It should start with “bunker://”.');
        bs = NT.BunkerSigner.fromBunker(clientSk, pointer, { pool: getPool(), onauth: openAuthUrl });
        return withTimeout(bs.connect(), 60000, 'The bunker didn’t respond. Check that it’s online and approve the connection there.')
          .then(function () { return bs.getPublicKey(); })
          .then(function (pubkey) {
            return connect({ method: 'bunker', pubkey: pubkey, bunker: { pointer: pointer, clientSk: bytesToHex(clientSk) } },
              wrapBunker(bs, pubkey));
          });
      }).catch(function (err) {
        if (bs) bs.close().catch(function () {});
        throw err;
      });
    },

    /** The nsec for a key-based account, so the user can copy it to another device. */
    getKey: function () {
      return account && account.method === 'key' ? NT.nip19.nsecEncode(hexToBytes(account.sk)) : null;
    },

    syncNow: function () { return run('merge'); },

    /** Replace local data with the synced copy. */
    pull: function () { return run('pull'); },

    setRelays: function (list) {
      if (!account) return;
      var clean = list.map(function (r) { return r.trim(); }).filter(function (r) { return /^wss?:\/\/\S+$/.test(r); });
      account.relays = clean.length ? clean : DEFAULT_RELAYS.slice();
      account.seen = {}; // new relays may not have everything: re-check all events
      saveAccount();
      emit();
      schedule(0);
    },

    /** Stop syncing on this device. Local data and synced data are both kept. */
    signOut: function () {
      clearTimeout(timer);
      if (signer && signer.close) signer.close().catch(function () {});
      signer = null;
      account = null;
      saveAccount();
      setStatus('off');
    },

    /**
     * Erase this app's data from the relays (an empty replacement for every
     * event plus a NIP-09 deletion request), then sign out on this device.
     */
    deleteRemote: function () {
      if (!account) return Promise.resolve();
      clearTimeout(timer);
      var s;
      setStatus('syncing');
      return Promise.resolve().then(function () {
        s = getSigner();
        return fetchLatest(s.pubkey);
      }).then(function (latest) {
        var ds = Object.keys(latest);
        if (!ds.length) return null;
        var t = nowSeconds();
        var chain = ds.reduce(function (p, d) {
          return p.then(function () {
            return publishEvent(s, { kind: KIND, created_at: Math.max(t, latest[d].created_at + 1), tags: [['d', d]], content: '' });
          });
        }, Promise.resolve());
        return chain.then(function () {
          return publishEvent(s, {
            kind: 5, created_at: nowSeconds(), content: 'Deleted by Story Outline Tool',
            tags: ds.map(function (d) { return ['a', KIND + ':' + s.pubkey + ':' + d]; }).concat([['k', String(KIND)]])
          });
        });
      }).then(function () {
        Sync.signOut();
      }, function (err) {
        setStatus('error', (err && err.message) || 'Deleting synced data failed.');
        throw err;
      });
    }
  };

  global.SOT = global.SOT || {};
  global.SOT.sync = Sync;
})(window);
