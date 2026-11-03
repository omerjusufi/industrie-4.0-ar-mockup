/*
 * Live-Daten P-101 Vibration
 *
 * Holt die Vibrationswerte, die Node-RED vom OPC-UA-Server (Milo) liest, auf drei Wegen:
 *   - WebSocket   (Aufgabe 2): wss://<gateway>/ws/p101
 *   - MQTT        (Aufgabe 4): wss://broker.hivemq.com:8884/mqtt, Topic /bbk-lf7/18/power-house/vibration
 *   - REST        (Aufgabe 7/8): https://<gateway>/api/p101/vibration?minutes=5 (Verlauf aus SQLite)
 *                 (Aufgabe 5):   https://<gateway>/api/p101/vibration/avg?minutes=5 (Durchschnitt)
 *
 * <gateway> ist die Adresse von Node-RED, z. B. der localhost.run-Tunnel (xyz.lhr.life).
 * Die Tunnel-Adresse wechselt. Der Pi meldet die aktuelle Adresse per MQTT (retained) unter
 * bbk/25it1/rpi18/gateway, die Seite übernimmt sie automatisch (abschaltbar unter "Verbindung einstellen").
 * Adressen zum Ausprobieren:
 *   live.html?gateway=xyz.lhr.life
 *   live.html?gateway=http://10.149.41.230:1880   (nur wenn die Seite selbst über http geöffnet ist)
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var DEFAULTS = {
    gateway: '',
    auto: true,              // Gateway-Adresse automatisch aus MQTT übernehmen
    broker: 'wss://broker.hivemq.com:8884/mqtt',
    topic: '/bbk-lf7/18/power-house/vibration'
  };
  // Frühere Standard-Topics: im Browser gespeicherte Einstellungen damit auf das neue Topic umstellen
  var OLD_TOPICS = ['bbk/25it1/rpi18/p101/vibration'];
  var GATEWAY_TOPIC = 'bbk/25it1/rpi18/gateway';
  var CHANNEL_NAMES = { 'ch-ws': 'WebSocket', 'ch-mqtt': 'MQTT' };
  var WS_PATH = '/ws/p101';
  var REST_PATH = '/api/p101/vibration';
  var AVG_PATH = '/api/p101/vibration/avg';
  var STALE_MS = 10000;      // ohne neuen Wert gilt die Anzeige als veraltet
  var STORE_KEY = 'p101-live-config';

  var cfg = loadConfig();
  var minutes = 5;
  var latest = null;         // neuester Messwert über alle Kanäle
  var lastBy = {};           // letzter Messwert je Kanal (ch-ws, ch-mqtt)
  var ws = null, wsTimer = null, wsDelay = 2000, wsFails = 0;
  var mq = null;
  var restTimer = null, restSeries = [];

  /* ---------- Einstellungen ---------- */

  function loadConfig() {
    var c = Object.assign({}, DEFAULTS);
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      ['gateway', 'broker', 'topic'].forEach(function (k) { if (typeof saved[k] === 'string') c[k] = saved[k]; });
      if (typeof saved.auto === 'boolean') c.auto = saved.auto;
      if (OLD_TOPICS.indexOf(c.topic) >= 0) c.topic = DEFAULTS.topic;
    } catch (e) { /* ohne Speicher geht es auch */ }
    var q = new URLSearchParams(location.search);
    ['gateway', 'broker', 'topic'].forEach(function (k) { if (q.get(k)) c[k] = q.get(k); });
    return c;
  }

  function saveConfig() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* egal */ }
  }

  // "xyz.lhr.life" → "https://xyz.lhr.life", "http://10.149.41.230:1880/" → "http://10.149.41.230:1880"
  function gatewayBase() {
    var s = (cfg.gateway || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) { return null; }
  }

  // Von einer https-Seite (GitHub Pages) blockiert der Browser http- und ws-Verbindungen
  function blockedByMixedContent(url) {
    return location.protocol === 'https:' && /^(http|ws):/i.test(url);
  }

  /* ---------- Anzeige ---------- */

  function fmt(v, digits) {
    return Number(v).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('de-DE');
  }
  function zoneOf(sample) {
    var lim = sample.limits || { high: 4.5, highHigh: 7.1 };
    if (sample.value >= lim.highHigh) return 'alarm';
    if (sample.value >= lim.high) return 'warn';
    return 'ok';
  }
  var ZONE_TEXT = { ok: 'Normal (unter 4,5 mm/s)', warn: 'Warnung (ab 4,5 mm/s)', alarm: 'Alarm (ab 7,1 mm/s)' };

  function setChannel(id, state, status, addr) {
    var el = $(id);
    el.dataset.state = state;
    el.querySelector('.status').textContent = status;
    if (addr !== undefined) el.querySelector('.addr').textContent = addr;
  }
  function setChannelValue(id, sample) {
    var el = $(id);
    el.querySelector('.last .v').textContent = fmt(sample.value, 3) + ' mm/s';
    el.querySelector('.last .t').textContent = clock(sample.timestamp);
  }

  // Neuer Messwert von WebSocket oder MQTT
  function onSample(sample, channelId) {
    if (!sample || typeof sample.value !== 'number') return;
    setChannelValue(channelId, sample);
    lastBy[channelId] = { timestamp: sample.timestamp, at: Date.now() };
    if (!latest || new Date(sample.timestamp) >= new Date(latest.sample.timestamp)) {
      latest = { sample: sample, at: Date.now() };
      renderHero();
    }
  }

  // Über welche Kanäle ist der angezeigte Wert gerade angekommen?
  function deliveredVia() {
    return Object.keys(CHANNEL_NAMES).filter(function (id) {
      var l = lastBy[id];
      return l && l.timestamp === latest.sample.timestamp && Date.now() - l.at < STALE_MS;
    }).map(function (id) { return CHANNEL_NAMES[id]; });
  }

  function renderHero() {
    var hero = $('hero');
    if (!latest) return;
    var s = latest.sample;
    var age = Date.now() - latest.at;
    var stale = age > STALE_MS;
    hero.dataset.zone = stale ? 'none' : zoneOf(s);
    $('value').textContent = fmt(s.value, 2);
    $('zone').textContent = stale ? 'Keine aktuellen Daten' : ZONE_TEXT[zoneOf(s)];
    var via = deliveredVia();
    $('meta').textContent = 'Stand ' + clock(s.timestamp) +
      (via.length ? ' · empfangen über ' + via.join(' und ') : '') +
      (stale ? ' · letzter Wert vor ' + Math.round(age / 1000) + ' s' : '');
    $('marker').style.left = Math.min(100, Math.max(0, s.value / 20 * 100)) + '%';
  }
  setInterval(renderHero, 1000);

  /* ---------- WebSocket (Aufgabe 2) ---------- */

  function connectWs() {
    clearTimeout(wsTimer);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    var base = gatewayBase();
    if (!base) { setChannel('ch-ws', 'off', 'Gateway-Adresse fehlt', ''); return; }
    var url = base.replace(/^http/i, 'ws') + WS_PATH;
    if (blockedByMixedContent(url)) {
      setChannel('ch-ws', 'err', 'Von https aus nur über wss (Tunnel) möglich', url);
      return;
    }
    setChannel('ch-ws', 'wait', 'verbinde …', url);
    try { ws = new WebSocket(url); } catch (e) { setChannel('ch-ws', 'err', 'Adresse ungültig', url); return; }
    ws.onopen = function () { wsDelay = 2000; wsFails = 0; setChannel('ch-ws', 'on', 'verbunden'); };
    ws.onmessage = function (ev) {
      try { onSample(JSON.parse(ev.data), 'ch-ws'); } catch (e) { /* keine JSON-Nachricht */ }
    };
    ws.onerror = function () { setChannel('ch-ws', 'err', 'Verbindungsfehler'); };
    ws.onclose = function () {
      wsFails++;
      var grund = wsFails >= 2 ? 'nicht erreichbar (Tunnel aus oder Adresse veraltet)' : 'getrennt';
      setChannel('ch-ws', wsFails >= 2 ? 'err' : 'wait', grund + ', neuer Versuch in ' + Math.round(wsDelay / 1000) + ' s');
      wsTimer = setTimeout(connectWs, wsDelay);
      wsDelay = Math.min(wsDelay * 2, 30000);
    };
  }

  /* ---------- MQTT (Aufgabe 4) ---------- */

  function connectMqtt() {
    if (mq) { mq.end(true); mq = null; }
    if (!window.mqtt) { setChannel('ch-mqtt', 'err', 'MQTT-Bibliothek nicht geladen', cfg.broker); return; }
    if (blockedByMixedContent(cfg.broker)) {
      setChannel('ch-mqtt', 'err', 'Von https aus nur über wss möglich', cfg.broker);
      return;
    }
    setChannel('ch-mqtt', 'wait', 'verbinde …', cfg.broker + ' · ' + cfg.topic);
    mq = window.mqtt.connect(cfg.broker, {
      clientId: 'p101-web-' + Math.random().toString(16).slice(2, 10),
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });
    mq.on('connect', function () {
      setChannel('ch-mqtt', 'on', 'verbunden, abonniert');
      mq.subscribe(cfg.topic, { qos: 0 });
      mq.subscribe(GATEWAY_TOPIC, { qos: 1 });   // aktuelle Tunnel-Adresse vom Pi (retained)
    });
    mq.on('reconnect', function () { setChannel('ch-mqtt', 'wait', 'verbinde neu …'); });
    mq.on('offline', function () {
      setChannel('ch-mqtt', 'err', 'keine Verbindung zum Broker (Port 8884 gesperrt?)');
    });
    mq.on('error', function (e) { setChannel('ch-mqtt', 'err', 'Fehler: ' + e.message); });
    mq.on('message', function (topic, payload) {
      if (topic === GATEWAY_TOPIC) { onGatewayAnnounced(payload.toString()); return; }
      try { onSample(JSON.parse(payload.toString()), 'ch-mqtt'); } catch (e) { /* keine JSON-Nachricht */ }
    });
  }

  // Der Pi meldet bei jedem Tunnel-Start die neue Adresse, z. B. {"gateway":"abc123.lhr.life","since":"…"}.
  // Eine leere Nachricht heißt: Tunnel ist aus.
  var announced = null;
  function onGatewayAnnounced(text) {
    var gw = '';
    try { gw = text ? String(JSON.parse(text).gateway || '') : ''; } catch (e) { return; }
    announced = gw || null;
    fillForm();
    if (!cfg.auto) return;
    if (!gw) {
      setChannel('ch-ws', 'err', 'Tunnel auf dem Pi ist aus');
      setChannel('ch-rest', 'err', 'Tunnel auf dem Pi ist aus');
      return;
    }
    if (gw === cfg.gateway) return;
    cfg.gateway = gw;
    saveConfig();
    fillForm();
    connectWs();
    loadHistory();
  }

  /* ---------- REST-Verlauf (Aufgabe 7 und 8) und Durchschnitt (Aufgabe 5) ---------- */

  function refreshMs() { return minutes <= 5 ? 5000 : minutes <= 15 ? 10000 : 30000; }

  function loadHistory() {
    clearTimeout(restTimer);
    var base = gatewayBase();
    if (!base) {
      setChannel('ch-rest', 'off', 'Gateway-Adresse fehlt', '');
      drawChart([]);
      return;
    }
    var url = base + REST_PATH + '?minutes=' + minutes;
    if (blockedByMixedContent(url)) {
      setChannel('ch-rest', 'err', 'Von https aus nur über https (Tunnel) möglich', url);
      drawChart([]);
      return;
    }
    $('ch-rest').querySelector('.addr').textContent = url;
    fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        restSeries = (j.data || []).map(function (d) { return { t: new Date(d.timestamp).getTime(), v: d.value }; });
        setChannel('ch-rest', 'on', j.count + ' Werte · alle ' + refreshMs() / 1000 + ' s aktualisiert');
        var last = j.data && j.data[j.data.length - 1];
        if (last) setChannelValue('ch-rest', last);
        drawChart(restSeries);
      })
      .catch(function (e) {
        setChannel('ch-rest', 'err', 'Abfrage fehlgeschlagen (' + e.message + ')');
      })
      .then(function () { restTimer = setTimeout(loadHistory, refreshMs()); });
    loadAverage(base);
  }

  // Durchschnitt rechnet der Pi per SQL aus (AVG über die letzten Minuten)
  function loadAverage(base) {
    var el = $('avg');
    fetch(base + AVG_PATH + '?minutes=' + minutes, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        el.textContent = j.count
          ? 'Ø ' + fmt(j.average, 2) + ' mm/s · min ' + fmt(j.min, 2) + ' · max ' + fmt(j.max, 2) + ' (' + j.count + ' Werte)'
          : 'Ø noch keine Werte';
      })
      .catch(function () { el.textContent = 'Ø nicht verfügbar'; });
  }

  /* ---------- Diagramm (SVG) ---------- */

  function niceStep(span, count) {
    var raw = span / count, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
  }

  function drawChart(series) {
    var box = $('chart');
    var W = Math.max(280, box.clientWidth), H = Math.max(200, box.clientHeight);
    var m = { l: 46, r: 14, t: 14, b: 26 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var now = Date.now(), t0 = now - minutes * 60000;
    var pts = series.filter(function (p) { return p.t >= t0; });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';

    if (!pts.length) {
      svg += '<text class="empty" x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle">Noch keine Verlaufsdaten</text></svg>';
      box.innerHTML = svg;
      return;
    }

    var vs = pts.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    var pad = Math.max((hi - lo) * 0.15, 0.1);
    lo = Math.max(0, lo - pad); hi = hi + pad;
    var step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;

    var x = function (t) { return m.l + (t - t0) / (now - t0) * iw; };
    var y = function (v) { return m.t + (1 - (v - lo) / (hi - lo)) * ih; };

    // Gitter und y-Achse
    for (var v = lo; v <= hi + step / 2; v += step) {
      svg += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      svg += '<text class="axis" x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v, step < 0.1 ? 2 : 1) + '</text>';
    }
    // x-Achse: Uhrzeiten
    var xStep = (minutes <= 5 ? 1 : minutes <= 15 ? 3 : 10) * 60000;
    for (var t = Math.ceil(t0 / xStep) * xStep; t <= now; t += xStep) {
      var d = new Date(t);
      svg += '<text class="axis" x="' + x(t) + '" y="' + (H - 6) + '" text-anchor="middle">' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</text>';
    }
    // Alarmgrenzen, falls im sichtbaren Bereich
    [[4.5, 'lim-warn', 'Warnung 4,5'], [7.1, 'lim-alarm', 'Alarm 7,1']].forEach(function (g) {
      if (g[0] >= lo && g[0] <= hi) {
        svg += '<line class="' + g[1] + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(g[0]) + '" y2="' + y(g[0]) + '"/>';
        svg += '<text class="lim-label" fill="currentColor" x="' + (W - m.r - 4) + '" y="' + (y(g[0]) - 4) + '" text-anchor="end">' + g[2] + '</text>';
      }
    });
    // Linie, bei Lücken über 5 s unterbrochen
    var segs = [], cur = [];
    pts.forEach(function (p, i) {
      if (i && p.t - pts[i - 1].t > 5000) { segs.push(cur); cur = []; }
      cur.push(p);
    });
    segs.push(cur);
    segs.forEach(function (s) {
      var d = s.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
      svg += '<path class="area" d="' + d + ' L' + x(s[s.length - 1].t).toFixed(1) + ' ' + y(lo) + ' L' + x(s[0].t).toFixed(1) + ' ' + y(lo) + ' Z"/>';
      svg += '<path class="line" d="' + d + '"/>';
    });
    var e = pts[pts.length - 1];
    svg += '<circle class="end" cx="' + x(e.t) + '" cy="' + y(e.v) + '" r="4.5"/></svg>';
    box.innerHTML = svg;
    box.setAttribute('aria-label', 'Vibration der letzten ' + minutes + ' Minuten, ' + pts.length +
      ' Werte zwischen ' + fmt(Math.min.apply(null, vs), 2) + ' und ' + fmt(Math.max.apply(null, vs), 2) + ' mm/s');
  }
  window.addEventListener('resize', function () { drawChart(restSeries); });

  /* ---------- Bedienung ---------- */

  document.querySelectorAll('.seg-ctl button').forEach(function (b) {
    b.addEventListener('click', function () {
      minutes = parseInt(b.dataset.min, 10);
      document.querySelectorAll('.seg-ctl button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $('minutes-label').textContent = minutes;
      loadHistory();
    });
  });

  function fillForm() {
    $('gw').value = cfg.gateway;
    $('auto').checked = cfg.auto;
    $('broker').value = cfg.broker;
    $('topic').value = cfg.topic;
    $('auto-info').textContent = announced
      ? 'Vom Pi gemeldet: ' + announced
      : 'Noch keine Adresse vom Pi gemeldet (Topic ' + GATEWAY_TOPIC + ').';
    var base = gatewayBase(), w = $('cfg-warn');
    if (base && blockedByMixedContent(base)) {
      w.textContent = 'Diese Seite läuft über https. Der Browser erlaubt dann keine http-Adresse. Nutze die https-Adresse des localhost.run-Tunnels.';
      w.hidden = false;
    } else {
      w.hidden = true;
    }
  }

  function connectAll() {
    fillForm();
    connectWs();
    connectMqtt();
    loadHistory();
    // Einstellungen nur aufklappen, wenn auch über MQTT keine Adresse kommt
    setTimeout(function () { if (!gatewayBase()) $('settings').open = true; }, 8000);
  }

  $('cfg').addEventListener('submit', function (e) {
    e.preventDefault();
    cfg.auto = $('auto').checked;
    cfg.gateway = $('gw').value.trim();
    cfg.broker = $('broker').value.trim() || DEFAULTS.broker;
    cfg.topic = $('topic').value.trim() || DEFAULTS.topic;
    saveConfig();
    connectAll();
  });
  $('btn-reset').addEventListener('click', function () {
    cfg.broker = DEFAULTS.broker;
    cfg.topic = DEFAULTS.topic;
    fillForm();
  });

  connectAll();
})();
