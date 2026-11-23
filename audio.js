/**
 * Hyphan Breath — Offline Cinematic Breath & Soundscape Engine
 * Features:
 * - Stereo 2-channel seamless pink-ish noise buffer (equal-power crossfade)
 * - Procedural stereo reverb + master dynamics compressor
 * - Multi-formant human breath air + fixed-pitch D-key sub swells (zero cartoon pitch-bends)
 * - Rising D-key harmonic chimes for the final 3 breaths
 * - Singing-bowl gongs, 30s retention chimes, cohesive D-key ambient drone
 * - Optional calm Web Speech API voice cues for eyes-closed practice
 */
class BreathAudioEngine {
  constructor() {
    this.ctx = null;
    this.compressor = null;
    this.masterGain = null;
    this.dryBus = null;
    this.reverbSend = null;
    this.reverb = null;
    this.reverbReturn = null;
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
      const now = this.ctx.currentTime;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, now);
      this.compressor.knee.setValueAtTime(18, now);
      this.compressor.ratio.setValueAtTime(4, now);
      this.compressor.attack.setValueAtTime(0.005, now);
      this.compressor.release.setValueAtTime(0.15, now);
      this.compressor.connect(this.ctx.destination);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0.0001 : this.volume, now);
      this.masterGain.connect(this.compressor);

      this.dryBus = this.ctx.createGain();
      this.dryBus.gain.setValueAtTime(1.0, now);
      this.dryBus.connect(this.masterGain);

      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.setValueAtTime(1.0, now);

      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this._createReverbImpulse(2.4, 2.8);

      this.reverbReturn = this.ctx.createGain();
      this.reverbReturn.gain.setValueAtTime(0.42, now);

      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.reverbReturn);
      this.reverbReturn.connect(this.masterGain);

      this.noiseBuffer = this._createSeamlessStereoNoiseBuffer(3.5);
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

  _routeToMix(node, dryLevel = 1.0, wetLevel = 0.2) {
    const now = this.ctx.currentTime;
    const dryGain = this.ctx.createGain();
    dryGain.gain.setValueAtTime(dryLevel, now);
    node.connect(dryGain);
    dryGain.connect(this.dryBus);

    if (wetLevel > 0) {
      const wetGain = this.ctx.createGain();
      wetGain.gain.setValueAtTime(wetLevel, now);
      node.connect(wetGain);
      wetGain.connect(this.reverbSend);
    }
  }

  /**
   * Builds a warm, dark 2-channel stereo impulse response for the ConvolverNode.
   */
  _createReverbImpulse(durationSec = 2.4, decay = 2.8) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        const sample = (Math.random() * 2 - 1) * env;
        lp = lp * 0.65 + sample * 0.35;
        data[i] = lp;
      }
    }
    return impulse;
  }

  /**
   * Generates a 2-channel stereo 3-pole pink-ish noise buffer with an equal-power
   * 0.4s crossfade at the loop boundary so loops are seamless and wide in stereo.
   */
  _createSeamlessStereoNoiseBuffer(seconds = 3.5) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * seconds);
    const fadeSamples = Math.floor(sampleRate * 0.4);
    const rawLen = length + fadeSamples;
    const buffer = this.ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(rawLen);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < rawLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
      }

      const data = buffer.getChannelData(ch);
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
    if (!this.ctx || this.muted) return;
    this.playInhale(1.4, 10);
    this.playGong(293.66, 0.08, 2.2);
    if (this.voiceEnabled) {
      this.speak("Audio ready");
    }
  }

  playCountdownTick(isFinal = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const freq = isFinal ? 440.0 : 293.66;
    const osc = this.ctx.createOscillator();
    const overtone = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const overGain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    overtone.type = "sine";
    overtone.frequency.setValueAtTime(freq * 2.0, now);

    overGain.gain.setValueAtTime(0.22, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(isFinal ? 0.13 : 0.1, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isFinal ? 0.65 : 0.42));

    osc.connect(gain);
    overtone.connect(overGain);
    overGain.connect(gain);
    this._routeToMix(gain, 0.7, 0.45);

    osc.start(now);
    overtone.start(now);
    osc.stop(now + 0.7);
    overtone.stop(now + 0.7);
  }

  /**
   * Realistic stereo multi-formant inhale with a fixed-pitch D-key sub swell.
   * @param {number} durationSec
   * @param {number} remainingBreaths - 1 means final breath, 2..3 means last-3-breaths cue
   */
  playInhale(durationSec = 1.7, remainingBreaths = 10) {
    if (this.muted || !this.breathSoundsEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const dur = Math.max(0.55, durationSec);
    const offset = Math.random() * 2.5;

    // 1. Stereo multi-formant breath air
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(110, now);

    const chestFilter = this.ctx.createBiquadFilter();
    chestFilter.type = "bandpass";
    chestFilter.Q.setValueAtTime(0.85, now);
    chestFilter.frequency.setValueAtTime(380, now);
    chestFilter.frequency.exponentialRampToValueAtTime(640, now + dur * 0.85);

    const chestGain = this.ctx.createGain();
    chestGain.gain.setValueAtTime(0.34, now);

    const airFilter = this.ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.Q.setValueAtTime(0.65, now);
    airFilter.frequency.setValueAtTime(1250, now);
    airFilter.frequency.exponentialRampToValueAtTime(2150, now + dur * 0.85);

    const airGain = this.ctx.createGain();
    airGain.gain.setValueAtTime(0.22, now);

    const breathEnv = this.ctx.createGain();
    breathEnv.gain.setValueAtTime(0.0001, now);
    breathEnv.gain.linearRampToValueAtTime(1.0, now + dur * 0.52);
    breathEnv.gain.linearRampToValueAtTime(0.75, now + dur * 0.84);
    breathEnv.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    noise.connect(hp);
    hp.connect(chestFilter);
    hp.connect(airFilter);
    chestFilter.connect(chestGain);
    airFilter.connect(airGain);
    chestGain.connect(breathEnv);
    airGain.connect(breathEnv);
    this._routeToMix(breathEnv, 0.9, 0.2);

    noise.start(now, offset);
    noise.stop(now + dur + 0.06);

    // 2. Fixed-pitch deep sub-chest swell (filter opens, pitch never bends)
    const subD = this.ctx.createOscillator();
    subD.type = "triangle";
    subD.frequency.setValueAtTime(73.42, now);

    const subA = this.ctx.createOscillator();
    subA.type = "sine";
    subA.frequency.setValueAtTime(110.0, now);

    const dGain = this.ctx.createGain();
    dGain.gain.setValueAtTime(0.6, now);
    const aGain = this.ctx.createGain();
    aGain.gain.setValueAtTime(0.5, now);

    const subFilter = this.ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    subFilter.Q.setValueAtTime(0.8, now);
    subFilter.frequency.setValueAtTime(100, now);
    subFilter.frequency.exponentialRampToValueAtTime(290, now + dur * 0.7);
    subFilter.frequency.exponentialRampToValueAtTime(115, now + dur);

    const subEnv = this.ctx.createGain();
    subEnv.gain.setValueAtTime(0.0001, now);
    subEnv.gain.linearRampToValueAtTime(0.085, now + dur * 0.45);
    subEnv.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    subD.connect(dGain);
    subA.connect(aGain);
    dGain.connect(subFilter);
    aGain.connect(subFilter);
    subFilter.connect(subEnv);
    this._routeToMix(subEnv, 0.85, 0.35);

    subD.start(now);
    subA.start(now);
    subD.stop(now + dur + 0.06);
    subA.stop(now + dur + 0.06);

    // 3. Calm resonant harmonic chime on the last 3 breaths
    if (remainingBreaths <= 3) {
      const chimeFreq = remainingBreaths === 3 ? 293.66 : remainingBreaths === 2 ? 329.63 : 440.0;
      const chime = this.ctx.createOscillator();
      const cGain = this.ctx.createGain();
      chime.type = "sine";
      chime.frequency.setValueAtTime(chimeFreq, now);

      cGain.gain.setValueAtTime(0.0001, now);
      cGain.gain.linearRampToValueAtTime(0.06, now + 0.03);
      cGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.43);

      chime.connect(cGain);
      this._routeToMix(cGain, 0.5, 0.7);
      chime.start(now);
      chime.stop(now + 1.5);

      if (remainingBreaths === 1) {
        const fifth = this.ctx.createOscillator();
        const fGain = this.ctx.createGain();
        fifth.type = "sine";
        fifth.frequency.setValueAtTime(220.0, now);

        fGain.gain.setValueAtTime(0.0001, now);
        fGain.gain.linearRampToValueAtTime(0.05, now + 0.03);
        fGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.43);

        fifth.connect(fGain);
        this._routeToMix(fGain, 0.5, 0.7);
        fifth.start(now);
        fifth.stop(now + 1.5);
      }
    }
  }

  /**
   * Realistic warm passive "haaaah" exhale release with grounding sub.
   */
  playExhale(durationSec = 1.4) {
    if (this.muted || !this.breathSoundsEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const dur = Math.max(0.45, durationSec);
    const offset = Math.random() * 2.5;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(95, now);

    const chestFilter = this.ctx.createBiquadFilter();
    chestFilter.type = "bandpass";
    chestFilter.Q.setValueAtTime(0.7, now);
    chestFilter.frequency.setValueAtTime(540, now);
    chestFilter.frequency.exponentialRampToValueAtTime(240, now + dur * 0.9);

    const chestGain = this.ctx.createGain();
    chestGain.gain.setValueAtTime(0.32, now);

    const airFilter = this.ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.Q.setValueAtTime(0.6, now);
    airFilter.frequency.setValueAtTime(1350, now);
    airFilter.frequency.exponentialRampToValueAtTime(580, now + dur * 0.9);

    const airGain = this.ctx.createGain();
    airGain.gain.setValueAtTime(0.15, now);

    const breathEnv = this.ctx.createGain();
    breathEnv.gain.setValueAtTime(0.0001, now);
    breathEnv.gain.linearRampToValueAtTime(1.0, now + dur * 0.14);
    breathEnv.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    noise.connect(hp);
    hp.connect(chestFilter);
    hp.connect(airFilter);
    chestFilter.connect(chestGain);
    airFilter.connect(airGain);
    chestGain.connect(breathEnv);
    airGain.connect(breathEnv);
    this._routeToMix(breathEnv, 0.9, 0.22);

    noise.start(now, offset);
    noise.stop(now + dur + 0.06);

    // Soft grounding D2 sub (fixed pitch)
    const sub = this.ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(73.42, now);

    const subEnv = this.ctx.createGain();
    subEnv.gain.setValueAtTime(0.0001, now);
    subEnv.gain.linearRampToValueAtTime(0.055, now + dur * 0.14);
    subEnv.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    sub.connect(subEnv);
    this._routeToMix(subEnv, 0.85, 0.3);
    sub.start(now);
    sub.stop(now + dur + 0.06);
  }

  playGong(baseFreq = 146.83, volume = 0.16, decay = 4.2) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const partials = [
      { mult: 1, gain: volume },
      { mult: 1.005, gain: volume * 0.48 },
      { mult: 2.0, gain: volume * 0.26 },
      { mult: 2.756, gain: volume * 0.18 },
      { mult: 5.404, gain: volume * 0.06 }
    ];

    partials.forEach((p, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq * p.mult, now);

      const pDecay = decay / (1 + idx * 0.42);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(p.gain, now + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, now + pDecay);

      osc.connect(g);
      this._routeToMix(g, 0.75, 0.65);
      osc.start(now);
      osc.stop(now + pDecay + 0.06);
    });
  }

  playMilestone() {
    this.playGong(293.66, 0.085, 2.6);
  }

  startDrone() {
    if (this.muted) return;
    this.init();
    if (!this.ctx || this.droneNodes) return;

    const now = this.ctx.currentTime;
    const busGain = this.ctx.createGain();
    busGain.gain.setValueAtTime(0.0001, now);
    busGain.gain.linearRampToValueAtTime(0.075, now + 2.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260, now);

    const specs = [
      { freq: 73.42, type: "triangle", gain: 0.45 },
      { freq: 110.0, type: "sine", gain: 0.5 },
      { freq: 146.83, type: "sine", gain: 0.42 },
      { freq: 147.2, type: "sine", gain: 0.36 }
    ];

    const oscs = specs.map((s) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = s.type;
      osc.frequency.setValueAtTime(s.freq, now);
      g.gain.setValueAtTime(s.gain, now);
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      return osc;
    });

    filter.connect(busGain);
    this._routeToMix(busGain, 0.75, 0.55);

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

  /**
   * Epic continuous recovery inhale: wide rushing stereo breath + fixed-pitch D power/add9 swell.
   */
  startRecoveryInhale() {
    if (this.muted || !this.breathSoundsEnabled) return;
    this.init();
    if (!this.ctx || this.recoveryInhaleNodes) return;

    const now = this.ctx.currentTime;
    const stopDry = this.ctx.createGain();
    stopDry.gain.setValueAtTime(1.0, now);
    stopDry.connect(this.dryBus);

    const stopWet = this.ctx.createGain();
    stopWet.gain.setValueAtTime(1.0, now);
    stopWet.connect(this.reverbSend);

    // 1. Continuous stereo breath air
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(100, now);

    const chestFilter = this.ctx.createBiquadFilter();
    chestFilter.type = "bandpass";
    chestFilter.Q.setValueAtTime(0.85, now);
    chestFilter.frequency.setValueAtTime(440, now);
    chestFilter.frequency.exponentialRampToValueAtTime(880, now + 2.6);

    const chestGain = this.ctx.createGain();
    chestGain.gain.setValueAtTime(0.34, now);

    const airFilter = this.ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.Q.setValueAtTime(0.65, now);
    airFilter.frequency.setValueAtTime(1200, now);
    airFilter.frequency.exponentialRampToValueAtTime(2050, now + 2.6);

    const airGain = this.ctx.createGain();
    airGain.gain.setValueAtTime(0.22, now);

    const breathGain = this.ctx.createGain();
    breathGain.gain.setValueAtTime(0.0001, now);
    breathGain.gain.linearRampToValueAtTime(0.95, now + 0.65);
    breathGain.gain.linearRampToValueAtTime(0.75, now + 2.8);

    const breathDry = this.ctx.createGain();
    breathDry.gain.setValueAtTime(0.9, now);
    const breathWet = this.ctx.createGain();
    breathWet.gain.setValueAtTime(0.28, now);

    noise.connect(hp);
    hp.connect(chestFilter);
    hp.connect(airFilter);
    chestFilter.connect(chestGain);
    airFilter.connect(airGain);
    chestGain.connect(breathGain);
    airGain.connect(breathGain);
    breathGain.connect(breathDry);
    breathGain.connect(breathWet);
    breathDry.connect(stopDry);
    breathWet.connect(stopWet);
    noise.start(now, Math.random() * 2.5);

    // 2. Epic fixed-pitch Hans-Zimmer-style D chord filter swell
    const chordSpecs = [
      { freq: 73.42, type: "sawtooth", gain: 0.22 },
      { freq: 73.78, type: "sawtooth", gain: 0.22 },
      { freq: 110.0, type: "triangle", gain: 0.28 },
      { freq: 146.83, type: "triangle", gain: 0.24 },
      { freq: 220.0, type: "sine", gain: 0.20 }
    ];

    const padFilter = this.ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.Q.setValueAtTime(1.1, now);
    padFilter.frequency.setValueAtTime(120, now);
    padFilter.frequency.exponentialRampToValueAtTime(1100, now + 2.8);

    const padGain = this.ctx.createGain();
    padGain.gain.setValueAtTime(0.0001, now);
    padGain.gain.linearRampToValueAtTime(0.22, now + 1.6);

    const padDry = this.ctx.createGain();
    padDry.gain.setValueAtTime(0.75, now);
    const padWet = this.ctx.createGain();
    padWet.gain.setValueAtTime(0.65, now);

    const chordOscs = chordSpecs.map((spec) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.freq, now);
      g.gain.setValueAtTime(spec.gain, now);
      osc.connect(g);
      g.connect(padFilter);
      osc.start(now);
      return osc;
    });

    padFilter.connect(padGain);
    padGain.connect(padDry);
    padGain.connect(padWet);
    padDry.connect(stopDry);
    padWet.connect(stopWet);

    this.recoveryInhaleNodes = {
      sources: [noise, ...chordOscs],
      stopDry,
      stopWet
    };
  }

  stopRecoveryInhale() {
    if (!this.recoveryInhaleNodes || !this.ctx) return;
    const { sources, stopDry, stopWet } = this.recoveryInhaleNodes;
    this.recoveryInhaleNodes = null;

    const now = this.ctx.currentTime;
    try {
      [stopDry, stopWet].forEach((g) => {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      });
      sources.forEach((src) => src.stop(now + 0.4));
    } catch (_) {}
  }
}

window.BreathAudioEngine = BreathAudioEngine;
