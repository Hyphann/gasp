/**
 * Hyphan Breath — Offline Web Audio & Voice Cue Engine
 * Features:
 * - Crossfaded pink-ish noise buffer (seamless continuous recovery inhale on headphones)
 * - Master volume gain bus
 * - Rising harmonic cue for the final 3 breaths of each round
 * - Singing-bowl gongs, 30s retention chimes, ambient retention drone
 * - Optional calm Web Speech API voice cues for eyes-closed practice
 */
class BreathAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = false;
    this.volume = 0.85;
    this.breathSoundsEnabled = true;
    this.voiceEnabled = false;
    this.noiseBuffer = null;
    this.droneNodes = null;
    this.recoveryInhaleNodes = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0.0001 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this._createSeamlessNoiseBuffer(3.0);
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._syncMasterGain();
    if (this.muted) {
      this.stopDrone();
      this.stopRecoveryInhale();
      this.cancelSpeech();
    }
  }

  setVolume(vol) {
    const v = Math.max(0, Math.min(1, Number(vol)));
    this.volume = Number.isFinite(v) ? v : 0.85;
    this._syncMasterGain();
  }

  setBreathSoundsEnabled(enabled) {
    this.breathSoundsEnabled = Boolean(enabled);
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) this.cancelSpeech();
  }

  _syncMasterGain() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this.muted ? 0.0001 : Math.max(0.0001, this.volume);
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.04);
  }

  /**
   * Generates a 3-pole filtered pink-ish noise buffer with an equal-power
   * crossfade at the loop boundary so looping during recovery inhale is 100% seamless.
   */
  _createSeamlessNoiseBuffer(seconds) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * seconds);
    const fadeSamples = Math.floor(sampleRate * 0.35);
    const rawLen = length + fadeSamples;
    const raw = new Float32Array(rawLen);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < rawLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.08;
    }

    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      if (i < fadeSamples) {
        const t = i / fadeSamples;
        const fadeIn = Math.sin(t * Math.PI * 0.5);
        const fadeOut = Math.cos(t * Math.PI * 0.5);
        data[i] = raw[i] * fadeIn + raw[length + i] * fadeOut;
      } else {
        data[i] = raw[i];
      }
    }
    return buffer;
  }

  /* ==================== Voice Cues (Web Speech API) ==================== */
  speak(text) {
    if (this.muted || !this.voiceEnabled) return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.92;
      utter.pitch = 0.96;
      utter.volume = Math.max(0.15, Math.min(1, this.volume));
      window.speechSynthesis.speak(utter);
    } catch (_) {
      // Ignore speech synthesis errors on restricted browsers
    }
  }

  cancelSpeech() {
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }

  /* ==================== Synthesized Cues ==================== */
  playTestTone() {
    this.init();
    if (!this.ctx) return;
    const prevMuted = this.muted;
    if (prevMuted) return;
    this.playGong(324, 0.15, 2.0);
    if (this.voiceEnabled) {
      this.speak("Audio ready");
    }
  }

  playCountdownTick(isFinal = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isFinal ? 528 : 396, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * @param {number} durationSec
   * @param {number} remainingBreaths - 1 means final breath, 2..3 means last-3-breaths cue
   */
  playInhale(durationSec = 1.7, remainingBreaths = 10) {
    if (this.muted || !this.breathSoundsEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const dur = Math.max(0.55, durationSec);
    const isFinalThree = remainingBreaths <= 3;
    const stepBoost = remainingBreaths === 1 ? 1.28 : remainingBreaths === 2 ? 1.16 : remainingBreaths === 3 ? 1.07 : 1.0;

    // 1. Filtered breath whoosh
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.setValueAtTime(1.6, now);
    filter.frequency.setValueAtTime(320 * stepBoost, now);
    filter.frequency.exponentialRampToValueAtTime(880 * stepBoost, now + dur * 0.85);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.16, now + dur * 0.35);
    nGain.gain.linearRampToValueAtTime(0.12, now + dur * 0.85);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + dur + 0.05);

    // 2. Gentle harmonic tone swell (rises subtly on final 3 breaths for eyes-closed awareness)
    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(210 * stepBoost, now);
    osc.frequency.exponentialRampToValueAtTime(300 * stepBoost, now + dur * 0.9);

    oGain.gain.setValueAtTime(0.0001, now);
    oGain.gain.linearRampToValueAtTime(isFinalThree ? 0.075 : 0.05, now + dur * 0.4);
    oGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);

    // Subtle bell shimmer on the last 3 breaths so eyes-closed users know retention is coming
    if (isFinalThree) {
      const bell = this.ctx.createOscillator();
      const bGain = this.ctx.createGain();
      bell.type = "sine";
      bell.frequency.setValueAtTime(528 * stepBoost, now);
      bGain.gain.setValueAtTime(0.0001, now);
      bGain.gain.linearRampToValueAtTime(0.04, now + 0.04);
      bGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      bell.connect(bGain);
      bGain.connect(this.masterGain);
      bell.start(now);
      bell.stop(now + 0.75);
    }
  }

  playExhale(durationSec = 1.4) {
    if (this.muted || !this.breathSoundsEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const dur = Math.max(0.45, durationSec);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.setValueAtTime(1.4, now);
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(240, now + dur * 0.9);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.13, now + dur * 0.18);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + dur + 0.05);

    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(175, now + dur * 0.9);

    oGain.gain.setValueAtTime(0.0001, now);
    oGain.gain.linearRampToValueAtTime(0.04, now + dur * 0.2);
    oGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  playGong(baseFreq = 216, volume = 0.16, decay = 3.6) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const partials = [
      { mult: 1, gain: volume },
      { mult: 1.006, gain: volume * 0.45 },
      { mult: 2.756, gain: volume * 0.22 },
      { mult: 5.404, gain: volume * 0.08 }
    ];

    partials.forEach((p, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq * p.mult, now);

      const pDecay = decay / (1 + idx * 0.45);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(p.gain, now + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, now + pDecay);

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + pDecay + 0.05);
    });
  }

  playMilestone() {
    this.playGong(432, 0.09, 2.2);
  }

  startDrone() {
    if (this.muted) return;
    this.init();
    if (!this.ctx || this.droneNodes) return;

    const now = this.ctx.currentTime;
    const busGain = this.ctx.createGain();
    busGain.gain.setValueAtTime(0.0001, now);
    busGain.gain.linearRampToValueAtTime(0.065, now + 2.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(340, now);

    const freqs = [108, 162, 216.5];
    const oscs = freqs.map((f) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now);
      osc.connect(filter);
      osc.start(now);
      return osc;
    });

    filter.connect(busGain);
    busGain.connect(this.masterGain);

    this.droneNodes = { oscs, busGain };
  }

  stopDrone() {
    if (!this.droneNodes || !this.ctx) return;
    const { oscs, busGain } = this.droneNodes;
    this.droneNodes = null;

    const now = this.ctx.currentTime;
    try {
      busGain.gain.cancelScheduledValues(now);
      busGain.gain.setValueAtTime(Math.max(0.0001, busGain.gain.value), now);
      busGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      oscs.forEach((osc) => osc.stop(now + 0.85));
    } catch (_) {}
  }

  startRecoveryInhale() {
    if (this.muted || !this.breathSoundsEnabled) return;
    this.init();
    if (!this.ctx || this.recoveryInhaleNodes) return;

    const now = this.ctx.currentTime;
    const busGain = this.ctx.createGain();
    busGain.gain.setValueAtTime(0.0001, now);
    busGain.gain.linearRampToValueAtTime(1.0, now + 0.35);
    busGain.connect(this.masterGain);

    // 1. Seamless looping filtered breath whoosh
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.setValueAtTime(1.5, now);
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(980, now + 2.8);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.18, now + 0.7);
    nGain.gain.linearRampToValueAtTime(0.13, now + 3.0);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(busGain);
    noise.start(now);

    // 2. Warm rising harmonic swell (fifth interval) that sustains gently
    const osc1 = this.ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(216, now);
    osc1.frequency.exponentialRampToValueAtTime(324, now + 2.8);

    const osc2 = this.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(324, now);
    osc2.frequency.exponentialRampToValueAtTime(432, now + 2.8);

    const oGain = this.ctx.createGain();
    oGain.gain.setValueAtTime(0.0001, now);
    oGain.gain.linearRampToValueAtTime(0.055, now + 1.0);
    oGain.gain.linearRampToValueAtTime(0.045, now + 3.0);

    osc1.connect(oGain);
    osc2.connect(oGain);
    oGain.connect(busGain);
    osc1.start(now);
    osc2.start(now);

    this.recoveryInhaleNodes = { sources: [noise, osc1, osc2], busGain };
  }

  stopRecoveryInhale() {
    if (!this.recoveryInhaleNodes || !this.ctx) return;
    const { sources, busGain } = this.recoveryInhaleNodes;
    this.recoveryInhaleNodes = null;

    const now = this.ctx.currentTime;
    try {
      busGain.gain.cancelScheduledValues(now);
      busGain.gain.setValueAtTime(Math.max(0.0001, busGain.gain.value), now);
      busGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      sources.forEach((src) => src.stop(now + 0.32));
    } catch (_) {}
  }
}

window.BreathAudioEngine = BreathAudioEngine;
