/*
 * Simuliertes Gateway (Beispieldaten).
 *
 * Im fertigen System holt der Edge-/Gateway-Server die Werte per OPC UA
 * (nur lesend) von der SPS S7-1516 und stellt sie als REST-API bereit.
 * Für das Mockup liefert diese Datei dieselbe Datenform mit festen Beispielwerten.
 * Später ersetzt man nur den Inhalt von getStation() durch
 *   fetch('/api/stations/' + id).then(r => r.json())
 * und die App muss nicht umgebaut werden.
 */
window.Gateway = (function () {
  'use strict';

  var STATIONS = {
    '07': {
      id: '07',
      name: 'Qualitätskontrolle',
      system: 'CPS-i40',
      sensor: 'Vision Sensor CS 50 (+AM)',
      controller: 'SPS S7-1516 (+AF)'
    }
  };

  // Sollwerte der Prüfung: Kugeln je Farbe und Deckel
  var SOLL = {
    content: [
      { name: 'Rot', color: '#e5484d', soll: 3 },
      { name: 'Gelb', color: '#f5c542', soll: 2 },
      { name: 'Blau', color: '#3b82f6', soll: 4 }
    ],
    lid: { shape: 'Dreieck', color: 'Blau' }
  };

  // Istwerte je Szenario: bestanden (ok), nicht bestanden (nok), keine Verbindung (stale)
  var IST = {
    ok:    { counts: [3, 2, 4], lid: { shape: 'Dreieck', color: 'Blau' } },
    nok:   { counts: [3, 2, 3], lid: { shape: 'Kreis',   color: 'Rot'  } },
    stale: { counts: [3, 2, 4], lid: { shape: 'Dreieck', color: 'Blau' } }
  };

  var STALE_AGE_MS = 47000; // letzter Wert ist 47 s alt, wenn die Verbindung fehlt

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  function buildMeasurement(scenario, now) {
    var ist = IST[scenario];
    var measuredAt = new Date(now.getTime() - (scenario === 'stale' ? STALE_AGE_MS : 0));

    var content = SOLL.content.map(function (c, i) {
      return { name: c.name, color: c.color, ist: ist.counts[i], soll: c.soll };
    });
    var total = content.reduce(function (s, c) { return s + c.ist; }, 0);
    var totalSoll = content.reduce(function (s, c) { return s + c.soll; }, 0);
    var contentOk = content.every(function (c) { return c.ist === c.soll; });
    var lidOk = ist.lid.shape === SOLL.lid.shape && ist.lid.color === SOLL.lid.color;

    var reasons = [];
    content.forEach(function (c) {
      var diff = c.soll - c.ist;
      if (diff > 0) reasons.push(c.name + ': ' + diff + (diff === 1 ? ' Kugel fehlt' : ' Kugeln fehlen'));
      if (diff < 0) reasons.push(c.name + ': ' + (-diff) + (diff === -1 ? ' Kugel zu viel' : ' Kugeln zu viel'));
    });
    if (!lidOk) reasons.push('Deckel passt nicht zum Inhalt');

    return {
      dose: '0412',
      time: clock(measuredAt),
      pass: contentOk && lidOk,
      content: content,
      total: total,
      totalSoll: totalSoll,
      contentOk: contentOk,
      lid: { ist: ist.lid, soll: SOLL.lid, ok: lidOk },
      reasons: reasons
    };
  }

  /**
   * Liefert die aktuellen Werte einer Station oder null, wenn die Station unbekannt ist.
   * scenario: 'ok' | 'nok' | 'stale'
   */
  function getStation(id, scenario) {
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        var station = STATIONS[id];
        if (!station) { resolve(null); return; }
        var sc = IST[scenario] ? scenario : 'ok';
        resolve({
          scenario: sc,
          station: station,
          connection: { online: sc !== 'stale', ageOffsetMs: sc === 'stale' ? STALE_AGE_MS : 0 },
          measurement: buildMeasurement(sc, new Date())
        });
      }, 350); // kleine Verzögerung wie bei einer echten Abfrage
    });
  }

  function listStations() {
    return Object.keys(STATIONS).map(function (k) { return STATIONS[k]; });
  }

  return { getStation: getStation, listStations: listStations };
})();
