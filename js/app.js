/*
 * AR-Webapp Station Qualitätskontrolle (Mockup)
 *
 * Ablauf: Scannen -> AR-Ansicht -> Details.
 *  - Station erkennen: QR-Code (jsQR liest das Kamerabild) oder Hiro-Marker (AR.js),
 *    dazu die manuelle Wahl und ein Demo-Modus ohne Kamera.
 *  - Werte holt die App über Gateway.getStation() (siehe js/data.js, aktuell simuliert).
 *
 * Adressen zum Ausprobieren:
 *   ?station=07               springt direkt zur Station
 *   ?station=07&state=nok     zeigt den Fehlerfall (ok | nok | stale)
 *   ?bg=demo                  nutzt das Demo-Bild statt der Kamera
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var SCENARIOS = ['ok', 'nok', 'stale'];
  var HIRO_STATION = '07'; // Der Hiro-Marker steht stellvertretend für den QR-Code der Station 07
  var SCAN_HINT = 'Kamera sucht den QR-Code …';

  var state = {
    view: 'scan',          // 'scan' | 'ar'
    scenario: SCENARIOS.indexOf(params.get('state')) >= 0 ? params.get('state') : 'ok',
    stationId: null,
    source: null,          // 'qr' | 'marker' | 'manual' | 'url'
    data: null,
    refreshedAt: 0,
    backdrop: 'camera',
    cameraOk: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), // false, wenn Erlaubnis oder Kamera fehlt
    busy: false
  };

  var ICON = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    bad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v8M12 18v.01"/></svg>'
  };

  /* ---------- kleine Helfer ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mk(kind) { return '<span class="mk ' + kind + '">' + ICON[kind] + '</span>'; }

  /* ---------- Ansichten ---------- */

  function setView(name) {
    state.view = name;
    document.body.dataset.view = name;
    $('view-scan').hidden = name !== 'scan';
    $('view-ar').hidden = name !== 'ar';
    $('station-chip').hidden = name !== 'ar';
    if (name !== 'ar') closeSheet();
  }

  function setScanStatus(text, kind) {
    var el = $('scan-status');
    el.textContent = text;
    el.className = 'scan-status' + (kind ? ' ' + kind : '');
    document.querySelector('.finder').classList.toggle('found', kind === 'ok');
  }

  function resetScan() {
    state.stationId = null;
    state.source = null;
    state.data = null;
    setView('scan');
    setScanStatus(scanHint());
    syncScanActions();
  }

  function scanHint() {
    if (state.backdrop !== 'demo') return SCAN_HINT;
    return state.cameraOk
      ? 'Demo-Bild aktiv. Tippe auf „Kamera verwenden“, um zu scannen.'
      : 'Keine Kamera verfügbar. Prüfe die Kamera-Erlaubnis oder wähle die Station manuell.';
  }

  // Im Demo-Bild mit funktionierender Kamera gibt es den Weg zurück zur Kamera
  function syncScanActions() {
    var backToCamera = state.backdrop === 'demo' && state.cameraOk;
    $('btn-camera').hidden = !backToCamera;
    $('btn-demo-start').hidden = backToCamera;
  }

  // "Neu scannen": zurück zur Kamera, falls vorher das Demo-Bild aktiv war
  function rescan() {
    if (state.backdrop === 'demo' && state.cameraOk) setBackdrop('camera');
    resetScan();
  }

  /* ---------- Darstellung der Messwerte ---------- */

  function bannerTexts(d) {
    var m = d.measurement;
    if (d.scenario === 'stale') {
      return { title: 'Keine aktuellen Daten', sub: 'Letzter Wert von ' + m.time + '. Die Verbindung ist unterbrochen.', kind: 'warn' };
    }
    if (m.pass) return { title: 'Prüfung bestanden', sub: 'Alle Kugeln in der richtigen Menge', kind: 'ok' };
    return { title: 'Nicht bestanden', sub: m.reasons.join(', '), kind: 'bad' };
  }

  function rowKind(d, ok) { return d.scenario === 'stale' ? 'warn' : (ok ? 'ok' : 'bad'); }

  function render() {
    var d = state.data;
    var m = d.measurement;
    var b = bannerTexts(d);
    var chips = m.content.map(function (c) {
      var bad = d.scenario !== 'stale' && c.ist !== c.soll;
      return '<span class="cchip"><i class="dot-c" style="background:' + c.color + '"></i><b class="' + (bad ? 'bad' : '') + '">' + c.ist + '/' + c.soll + '</b></span>';
    }).join('');

    document.body.dataset.state = d.scenario;
    $('station-name').textContent = 'Station ' + d.station.id + ' · ' + d.station.name;

    $('banner').innerHTML =
      '<span class="ic">' + ICON[b.kind] + '</span>' +
      '<span><strong>' + esc(b.title) + '</strong><small>' + esc(b.sub) + '</small></span>';

    $('tag').innerHTML =
      '<div class="tag-head">Dose #' + esc(m.dose) + '<span>' + esc(m.time) + '</span></div>' +
      '<div class="trow">' + mk(rowKind(d, m.contentOk)) + '<span class="k">Inhalt</span><span class="v">' + m.total + ' von ' + m.totalSoll + ' Kugeln</span></div>' +
      '<div class="trow"><span class="sp"></span><span class="k">Farben</span><span class="cchips">' + chips + '</span></div>' +
      '<p class="live js-live"><i></i><span></span></p>';

    // Ring am Hiro-Marker zeigt das Ergebnis ebenfalls
    var ringColor = { ok: '#3ddc84', nok: '#ff5c5c', stale: '#f5b942' }[d.scenario];
    $('marker-ring').setAttribute('color', ringColor);

    renderDetails(d);
    updateLive();
  }

  function renderDetails(d) {
    var m = d.measurement;
    $('sheet-title').textContent = 'Dose #' + m.dose;
    $('sheet-pill').textContent = d.scenario === 'stale' ? 'Keine Daten' : (m.pass ? 'Bestanden' : 'Nicht bestanden');

    var alertHtml = '';
    if (d.scenario === 'stale') {
      alertHtml = '<div class="alert">' + mk('warn') + '<div><strong>Keine Verbindung</strong><br>Angezeigt wird der letzte bekannte Wert von ' + esc(m.time) + '.</div></div>';
    } else if (!m.pass) {
      alertHtml = '<div class="alert">' + mk('bad') + '<div><strong>Grund</strong><br>' + esc(m.reasons.join('. ')) + '.</div></div>';
    }

    var rows = m.content.map(function (c) {
      var ok = c.ist === c.soll;
      var kind = rowKind(d, ok);
      var pct = Math.min(100, Math.round(c.ist / c.soll * 100));
      return '<div class="crow"><i class="dot-c" style="background:' + c.color + '"></i><span>' + esc(c.name) + '</span>' +
        '<span class="meter"><b class="' + (kind === 'ok' ? '' : kind) + '" style="width:' + pct + '%"></b></span>' +
        '<span class="val ' + (ok ? '' : 'bad') + '">' + c.ist + ' / ' + c.soll + '</span>' + mk(kind) + '</div>';
    }).join('');

    $('sheet-body').innerHTML =
      alertHtml +
      '<div class="card"><h3>Inhalt · Kugeln</h3>' + rows +
        '<div class="sum"><span>Gesamt</span><b>' + m.total + ' / ' + m.totalSoll + '</b></div></div>' +
      '<div class="card"><h3>Messung</h3><dl class="kv">' +
        '<dt>Zeitpunkt</dt><dd>' + esc(m.time) + '</dd>' +
        '<dt>Sensor</dt><dd>' + esc(d.station.sensor) + '</dd>' +
        '<dt>Steuerung</dt><dd>' + esc(d.station.controller) + '</dd>' +
        '<dt>Zugriff</dt><dd>nur lesend</dd></dl></div>' +
      '<p class="live js-live"><i></i><span></span></p>';
  }

  /* Verbindungsstatus und "Stand vor x s". Im Mockup meldet das Gateway alle 5 s neue Werte. */
  function updateLive() {
    var d = state.data;
    if (!d) return;
    var online = d.connection.online;
    if (online && Date.now() - state.refreshedAt >= 5000) state.refreshedAt = Date.now();
    var age = Math.max(1, Math.floor((Date.now() - state.refreshedAt) / 1000));
    var ageText = age < 60 ? age + ' s' : Math.floor(age / 60) + ' min';
    var text = (online ? 'Verbunden' : 'Keine Verbindung') + ' · Stand vor ' + ageText;
    var nodes = document.querySelectorAll('.js-live');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('off', !online);
      nodes[i].lastChild.textContent = text;
    }
  }
  window.setInterval(updateLive, 1000);

  /* ---------- Station laden ---------- */

  function showStation(id, source) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    setScanStatus('Station ' + id + ' erkannt …', 'ok');
    return window.Gateway.getStation(id, state.scenario).then(function (data) {
      if (!data) {
        setScanStatus('Station ' + id + ' ist nicht bekannt.', 'warn');
        return;
      }
      state.stationId = id;
      state.source = source;
      state.data = data;
      state.refreshedAt = Date.now() - data.connection.ageOffsetMs;
      render();
      setView('ar');
    }).then(function () { state.busy = false; }, function () { state.busy = false; });
  }

  function setScenario(sc) {
    state.scenario = sc;
    syncMenu();
    if (state.stationId) {
      window.Gateway.getStation(state.stationId, sc).then(function (data) {
        if (!data) return;
        state.data = data;
        state.refreshedAt = Date.now() - data.connection.ageOffsetMs;
        render();
      });
    } else {
      document.body.dataset.state = sc;
    }
  }

  /* ---------- QR-Code lesen ---------- */

  // Erlaubt: "CPS-I40:STATION:07" oder eine Adresse mit ?station=07
  function parseStation(text) {
    var t = String(text).trim();
    var m = /^CPS-I40:STATION:(\d{1,2})$/i.exec(t);
    var id = m ? m[1] : null;
    if (!id) {
      try { id = new URL(t).searchParams.get('station'); } catch (e) { id = null; }
    }
    if (!id || !/^\d{1,2}$/.test(id)) return null;
    return ('0' + id).slice(-2);
  }

  var lastUnknown = 0;
  function handlePayload(text) {
    var id = parseStation(text);
    if (id) { showStation(id, 'qr'); return; }
    if (Date.now() - lastUnknown > 3000) {
      lastUnknown = Date.now();
      setScanStatus('Dieser QR-Code gehört zu keiner Station.', 'warn');
    }
  }

  var scanCanvas = document.createElement('canvas');
  var scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
  function scanFrame() {
    if (state.view !== 'scan' || state.backdrop !== 'camera' || state.busy || !window.jsQR) return;
    var v = document.querySelector('video');
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    var scale = Math.min(1, 640 / v.videoWidth);
    var w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    scanCanvas.width = w;
    scanCanvas.height = h;
    scanCtx.drawImage(v, 0, 0, w, h);
    var img = scanCtx.getImageData(0, 0, w, h);
    var code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    if (code && code.data) handlePayload(code.data);
  }
  window.setInterval(scanFrame, 300);

  /* ---------- Hiro-Marker (Vorlage) ---------- */

  var hiroMarker = $('hiro-marker');
  var lostTimer = null;

  hiroMarker.addEventListener('markerFound', function () {
    console.debug('Marker found');
    window.clearTimeout(lostTimer);
    if (state.view === 'scan') showStation(HIRO_STATION, 'marker');
  });
  hiroMarker.addEventListener('markerLost', function () {
    console.debug('Marker lost');
    if (state.source !== 'marker') return;
    // kurze Wartezeit, damit die Anzeige beim Wackeln nicht flackert
    lostTimer = window.setTimeout(function () { if (state.source === 'marker') rescan(); }, 1500);
  });

  /* global functions for debugging */
  window.fireEventMarkerFound = function () { hiroMarker.dispatchEvent(new CustomEvent('markerFound')); };
  window.fireEventMarkerLost = function () { hiroMarker.dispatchEvent(new CustomEvent('markerLost')); };

  /* ---------- Hintergrund: Kamera oder Demo-Bild ---------- */

  function setBackdrop(mode) {
    state.backdrop = mode;
    $('demo-bg').hidden = mode !== 'demo';
    syncMenu();
    if (state.view === 'scan') resetScan();
  }

  // AR.js meldet einen Kamerafehler (keine Erlaubnis, keine Kamera) am window
  window.addEventListener('camera-error', function () {
    state.cameraOk = false;
    setBackdrop('demo');
    setScanStatus(scanHint(), 'warn');
  });
  if (!state.cameraOk) {
    // Kamera braucht https oder localhost
    window.addEventListener('DOMContentLoaded', function () {
      setBackdrop('demo');
      setScanStatus('Keine Kamera verfügbar (https oder localhost nötig). Wähle die Station manuell.', 'warn');
    });
  }

  /* ---------- Details-Sheet, Stationswahl, Demo-Menü ---------- */

  var lastFocus = null;
  function openSheet() {
    lastFocus = document.activeElement;
    $('scrim').hidden = false;
    $('sheet').hidden = false;
    $('sheet-body').scrollTop = 0;
    $('btn-close').focus();
  }
  function closeSheet() {
    if ($('sheet').hidden) return;
    $('scrim').hidden = true;
    $('sheet').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function openPicker() {
    var list = $('picker-list');
    list.innerHTML = '';
    window.Gateway.listStations().forEach(function (s) {
      var btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = 'Station ' + s.id + ' · ' + s.name;
      btn.addEventListener('click', function () { closePicker(); showStation(s.id, 'manual'); });
      list.appendChild(btn);
    });
    $('picker').hidden = false;
    list.firstChild.focus();
  }
  function closePicker() { $('picker').hidden = true; }

  function syncMenu() {
    var btns = document.querySelectorAll('#demo-menu button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var on = b.dataset.scenario ? b.dataset.scenario === state.scenario : b.dataset.backdrop === state.backdrop;
      b.setAttribute('aria-pressed', String(on));
      if (b.dataset.backdrop === 'camera') b.disabled = !state.cameraOk;
    }
  }
  function toggleMenu(open) {
    var menu = $('demo-menu');
    var show = typeof open === 'boolean' ? open : menu.hidden;
    menu.hidden = !show;
    $('btn-demo-menu').setAttribute('aria-expanded', String(show));
  }

  $('btn-details').addEventListener('click', openSheet);
  $('btn-close').addEventListener('click', closeSheet);
  $('scrim').addEventListener('click', closeSheet);
  $('btn-rescan').addEventListener('click', rescan);
  $('btn-camera').addEventListener('click', function () { setBackdrop('camera'); });
  $('btn-manual').addEventListener('click', openPicker);
  $('btn-picker-close').addEventListener('click', closePicker);
  $('picker').addEventListener('click', function (e) { if (e.target === $('picker')) closePicker(); });
  $('btn-demo-start').addEventListener('click', function () {
    setBackdrop('demo');
    showStation(HIRO_STATION, 'manual');
  });
  $('btn-demo-menu').addEventListener('click', function () { toggleMenu(); });
  $('demo-menu').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.scenario) setScenario(b.dataset.scenario);
    if (b.dataset.backdrop) setBackdrop(b.dataset.backdrop);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeSheet();
    closePicker();
    toggleMenu(false);
  });

  /* ---------- Start ---------- */

  window.ARApp = { showStation: showStation, handlePayload: handlePayload, parseStation: parseStation, setScenario: setScenario, resetScan: resetScan, rescan: rescan };

  syncMenu();
  if (params.get('bg') === 'demo') setBackdrop('demo');
  resetScan();
  document.body.dataset.state = state.scenario;
  if (params.get('station')) {
    var startId = parseStation(window.location.href);
    if (startId) showStation(startId, 'url');
  }
})();
