// Helium voice effect.
//
// Real helium doesn't change how fast your vocal folds vibrate (pitch); it
// raises the speed of sound, which pushes the vocal-tract resonances
// (formants) up. So we shift formants independently of pitch using PSOLA:
// cut the signal into one-pitch-period grains, squeeze each grain in time
// (formants up), and lay grains back down at the (optionally raised) pitch
// spacing.
(function (root) {
  'use strict';

  var MIN_F0 = 70;
  var MAX_F0 = 500;

  // Returns per-frame pitch periods in samples (0 = unvoiced).
  function detectPitch(x, sr) {
    var ds = Math.max(1, Math.round(sr / 12000)); // downsample for speed
    var dsr = sr / ds;
    var m = Math.floor(x.length / ds);
    var y = new Float32Array(m);
    for (var i = 0; i < m; i++) {
      var s = 0;
      for (var k = 0; k < ds; k++) s += x[i * ds + k];
      y[i] = s / ds;
    }

    var hop = Math.round(dsr * 0.01);
    var frame = Math.round(dsr * 0.04);
    var minLag = Math.floor(dsr / MAX_F0);
    var maxLag = Math.ceil(dsr / MIN_F0);
    var nFrames = Math.max(0, Math.floor((m - frame - maxLag) / hop) + 1);
    var periods = new Float32Array(nFrames);
    var rms = new Float32Array(nFrames);
    var corr = new Float32Array(maxLag + 1);
    var peakRms = 0;

    for (var f = 0; f < nFrames; f++) {
      var off = f * hop;
      var e0 = 0;
      for (var j = 0; j < frame; j++) e0 += y[off + j] * y[off + j];
      rms[f] = Math.sqrt(e0 / frame);
      if (rms[f] > peakRms) peakRms = rms[f];
      if (e0 <= 0) continue;

      var best = 0;
      for (var lag = minLag; lag <= maxLag; lag++) {
        var r = 0, el = 0;
        for (var j2 = 0; j2 < frame; j2++) {
          var b = y[off + j2 + lag];
          r += y[off + j2] * b;
          el += b * b;
        }
        corr[lag] = el > 0 ? r / Math.sqrt(e0 * el) : 0;
        if (corr[lag] > best) best = corr[lag];
      }
      if (best < 0.5) continue;

      // First local peak close to the best one: avoids octave-down errors.
      var pick = -1;
      for (var l2 = minLag + 1; l2 < maxLag; l2++) {
        if (corr[l2] >= 0.9 * best && corr[l2] >= corr[l2 - 1] && corr[l2] >= corr[l2 + 1]) {
          pick = l2;
          break;
        }
      }
      if (pick < 0) continue;
      var a = corr[pick - 1], c = corr[pick], d = corr[pick + 1];
      var den = a - 2 * c + d;
      var shift = den !== 0 ? 0.5 * (a - d) / den : 0;
      periods[f] = (pick + shift) * ds;
    }

    // Drop quiet frames, then median-smooth to remove stray jumps.
    var floor = Math.max(peakRms * 0.03, 1e-4);
    for (var q = 0; q < nFrames; q++) if (rms[q] < floor) periods[q] = 0;
    var smooth = new Float32Array(nFrames);
    for (var p = 0; p < nFrames; p++) {
      if (!periods[p]) continue;
      var win = [];
      for (var w = p - 2; w <= p + 2; w++) if (w >= 0 && w < nFrames && periods[w]) win.push(periods[w]);
      win.sort(function (u, v) { return u - v; });
      smooth[p] = win[win.length >> 1];
    }

    return { periods: smooth, hop: hop * ds, frameCenter: (frame * ds) >> 1 };
  }

  function periodAt(pd, t) {
    var f = Math.round((t - pd.frameCenter) / pd.hop);
    if (f < 0 || f >= pd.periods.length) return 0;
    return pd.periods[f];
  }

  // Pitch marks: one per period on waveform peaks when voiced, fixed step otherwise.
  function pitchMarks(x, sr, pd) {
    var n = x.length;
    var unvoicedStep = Math.round(sr * 0.005);
    var marks = [], periods = [], voiced = [];
    var t = 0, wasVoiced = false;
    while (t < n) {
      var P = periodAt(pd, t);
      if (P > 0) {
        var lo = wasVoiced ? t + Math.round(0.8 * P) : t;
        var hi = wasVoiced ? t + Math.round(1.2 * P) : t + Math.round(P);
        hi = Math.min(hi, n - 1);
        if (lo >= n) break;
        var bestI = lo, bestV = -Infinity;
        for (var i = lo; i <= hi; i++) if (x[i] > bestV) { bestV = x[i]; bestI = i; }
        t = bestI;
        marks.push(t); periods.push(P); voiced.push(true);
        wasVoiced = true;
        if (hi <= lo) t++;
      } else {
        t += wasVoiced ? Math.round(periods[periods.length - 1] || unvoicedStep) : unvoicedStep;
        if (t >= n) break;
        marks.push(t); periods.push(unvoicedStep); voiced.push(false);
        wasVoiced = false;
      }
    }
    return { marks: marks, periods: periods, voiced: voiced };
  }

  function sampleAt(x, pos) {
    var i = Math.floor(pos);
    if (i < 0 || i + 1 >= x.length) return 0;
    var fr = pos - i;
    return x[i] + (x[i + 1] - x[i]) * fr;
  }

  // x: Float32Array mono samples. Options:
  //   formant: how far to push resonances up (1 = none, ~1.7 = helium)
  //   pitch:   pitch multiplier (1 = unchanged)
  function helium(x, sr, opts) {
    opts = opts || {};
    var F = opts.formant || 1.7;
    var pitch = opts.pitch || 1.0;
    var n = x.length;
    var out = new Float32Array(n);
    if (n === 0) return out;

    var pd = detectPitch(x, sr);
    var pm = pitchMarks(x, sr, pd);
    var marks = pm.marks;
    if (!marks.length) return out;

    var voicedGain = Math.sqrt(F / pitch);
    var tOut = 0, mi = 0;
    while (tOut < n) {
      while (mi + 1 < marks.length && Math.abs(marks[mi + 1] - tOut) <= Math.abs(marks[mi] - tOut)) mi++;
      var c = marks[mi], P = pm.periods[mi], isVoiced = pm.voiced[mi];

      // Voiced: take one period each side of the pulse, squeeze it by F.
      // Unvoiced: overlap-add fixed grains so noise stays smooth.
      var L = isVoiced ? Math.max(2, Math.round(P / F)) : P;
      var gain = isVoiced ? voicedGain : 1;
      var center = Math.round(tOut);
      for (var j = -L; j <= L; j++) {
        var o = center + j;
        if (o < 0 || o >= n) continue;
        var w = 0.5 * (1 + Math.cos(Math.PI * j / L));
        out[o] += gain * w * sampleAt(x, c + j * F);
      }
      tOut += isVoiced ? P / pitch : P;
    }

    return loudness(out, sr);
  }

  // Bring speech up to a strong, consistent playback level. Phone mics often
  // record quietly, so level on the loudest 30% of 20 ms blocks (the speech,
  // not the pauses), then soft-clip with tanh so peaks never distort harshly.
  function loudness(x, sr) {
    var n = x.length, out = new Float32Array(n);
    var block = Math.max(1, Math.round(sr * 0.02));
    var energies = [];
    for (var b = 0; b + block <= n; b += block) {
      var e = 0;
      for (var i = b; i < b + block; i++) e += x[i] * x[i];
      energies.push(e / block);
    }
    if (!energies.length) return out;
    energies.sort(function (u, v) { return v - u; });
    var top = Math.max(1, Math.round(energies.length * 0.3)), sum = 0;
    for (var t = 0; t < top; t++) sum += energies[t];
    var speechRms = Math.sqrt(sum / top);
    if (speechRms <= 0) return out;
    var gain = Math.min(0.3 / speechRms, 40);
    for (var k = 0; k < n; k++) out[k] = Math.tanh(x[k] * gain);
    return out;
  }

  var api = { helium: helium, detectPitch: detectPitch, loudness: loudness };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Helium = api;
})(this);
