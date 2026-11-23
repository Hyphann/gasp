(() => {
  "use strict";

  const STORAGE_KEYS = {
    SETTINGS: "arctic_breath_settings_v1",
    HISTORY: "arctic_breath_history_v1",
    SAFETY_SEEN: "arctic_breath_safety_seen_v1"
  };

  const PACE_MIN_SEC = 1.8; // fastest (slider far right)
  const PACE_MAX_SEC = 5.0; // slowest (slider far left)
  const LEGACY_PACE_SEC = { slow: 4.0, standard: 3.2, fast: 2.5 };

  function clampBreathSec(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n)) return 3.2;
    return Math.round(Math.min(PACE_MAX_SEC, Math.max(PACE_MIN_SEC, n)) * 10) / 10;
  }

  function sliderValToBreathSec(sliderVal) {
    return clampBreathSec(PACE_MIN_SEC + PACE_MAX_SEC - Number(sliderVal));
  }

  function breathSecToSliderVal(breathSec) {
    return (PACE_MIN_SEC + PACE_MAX_SEC - clampBreathSec(breathSec)).toFixed(1);
  }

  function getBreathDurations(breathSec) {
    const sec = clampBreathSec(breathSec);
    return {
      inhaleMs: Math.round(sec * 550),
      exhaleMs: Math.round(sec * 450)
    };
  }

  const RING_CIRCUMFERENCE = 2 * Math.PI * 160; // matches SVG r="160"

  const defaultSettings = {
    rounds: 3,
    breaths: 30,
    breathSec: 3.2,
    recoverySec: 15,
    volume: 85,
    breathAudio: true,
    voiceCues: false,
    drone: true,
    milestones: true,
    muted: false,
    nightMode: false
  };

  let settings = loadSettings();
  let history = loadHistory();
  const audio = new window.BreathAudioEngine();

  // Wake Lock reference (keeps iPad screen awake during retention)
  let wakeLock = null;

  // Session runtime state
  let session = null;
  let rafId = null;

  // DOM References
  const dom = {
    navPills: document.querySelectorAll(".nav-pill"),
    views: {
      home: document.getElementById("view-home"),
      session: document.getElementById("view-session"),
      summary: document.getElementById("view-summary"),
      history: document.getElementById("view-history")
    },
    nightModeBtn: document.getElementById("nightModeBtn"),
    soundToggleBtn: document.getElementById("soundToggleBtn"),
    soundOnIcon: document.getElementById("soundOnIcon"),
    soundOffIcon: document.getElementById("soundOffIcon"),
    safetyInfoBtn: document.getElementById("safetyInfoBtn"),
    safetyModal: document.getElementById("safetyModal"),
    closeSafetyBtn: document.getElementById("closeSafetyBtn"),
    ackSafetyBtn: document.getElementById("ackSafetyBtn"),
    confirmModal: document.getElementById("confirmModal"),
    cancelConfirmBtn: document.getElementById("cancelConfirmBtn"),
    confirmClearBtn: document.getElementById("confirmClearBtn"),

    // Home stats & settings
    heroRecipePill: document.getElementById("heroRecipePill"),
    startSessionBtn: document.getElementById("startSessionBtn"),
    homeBestHold: document.getElementById("homeBestHold"),
    homeSessionCount: document.getElementById("homeSessionCount"),
    homeTotalRounds: document.getElementById("homeTotalRounds"),
    roundsSlider: document.getElementById("roundsSlider"),
    roundsValue: document.getElementById("roundsValue"),
    breathsSlider: document.getElementById("breathsSlider"),
    breathsValue: document.getElementById("breathsValue"),
    recoverySlider: document.getElementById("recoverySlider"),
    recoveryValue: document.getElementById("recoveryValue"),
    paceDesc: document.getElementById("paceDesc"),
    paceSlider: document.getElementById("paceSlider"),
    volumeSlider: document.getElementById("volumeSlider"),
    volumeValue: document.getElementById("volumeValue"),
    testSoundBtn: document.getElementById("testSoundBtn"),
    breathAudioToggle: document.getElementById("breathAudioToggle"),
    voiceToggle: document.getElementById("voiceToggle"),
    droneToggle: document.getElementById("droneToggle"),
    milestoneToggle: document.getElementById("milestoneToggle"),
    breathChips: document.querySelectorAll('[data-preset="breaths"] .chip'),
    stepperButtons: document.querySelectorAll(".stepper-btn"),

    // Active session
    sessionRoundBadge: document.getElementById("sessionRoundBadge"),
    sessionPhaseBadge: document.getElementById("sessionPhaseBadge"),
    roundDots: document.getElementById("roundDots"),
    sessionStage: document.getElementById("sessionStage"),
    stageProgressRing: document.getElementById("stageProgressRing"),
    breathingOrb: document.getElementById("breathingOrb"),
    stagePrompt: document.getElementById("stagePrompt"),
    stagePrimary: document.getElementById("stagePrimary"),
    stageSecondary: document.getElementById("stageSecondary"),
    retentionEndBtn: document.getElementById("retentionEndBtn"),
    sessionPaceWrap: document.getElementById("sessionPaceWrap"),
    sessionPaceSlider: document.getElementById("sessionPaceSlider"),
    sessionPaceValue: document.getElementById("sessionPaceValue"),
    pauseResumeBtn: document.getElementById("pauseResumeBtn"),
    skipPhaseBtn: document.getElementById("skipPhaseBtn"),
    endSessionBtn: document.getElementById("endSessionBtn"),

    // Summary
    summaryPrBadge: document.getElementById("summaryPrBadge"),
    summarySubtitle: document.getElementById("summarySubtitle"),
    summaryBestHold: document.getElementById("summaryBestHold"),
    summaryAvgHold: document.getElementById("summaryAvgHold"),
    summaryTotalHold: document.getElementById("summaryTotalHold"),
    summaryRoundBars: document.getElementById("summaryRoundBars"),
    newSessionBtn: document.getElementById("newSessionBtn"),
    viewHistoryBtn: document.getElementById("viewHistoryBtn"),

    // History
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    historyChartWrap: document.getElementById("historyChartWrap"),
    historyChart: document.getElementById("historyChart"),
    historyList: document.getElementById("historyList")
  };

  /* ==================== Persistence ==================== */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = { ...defaultSettings, ...parsed };
        if (parsed.breathSec == null && parsed.pace && LEGACY_PACE_SEC[parsed.pace]) {
          merged.breathSec = LEGACY_PACE_SEC[parsed.pace];
        }
        merged.breathSec = clampBreathSec(merged.breathSec);
        return merged;
      }
    } catch (_) {}
    return { ...defaultSettings };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (_) {}
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch (_) {}
  }

  /* ==================== Formatting ==================== */
  function formatTime(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  /* ==================== Wake Lock ==================== */
  async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch (_) {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session && !session.paused) {
      acquireWakeLock();
    }
  });

  /* ==================== Navigation & UI Sync ==================== */
  function switchView(viewName) {
    document.body.classList.toggle("in-session", viewName === "session");

    Object.entries(dom.views).forEach(([name, el]) => {
      el.classList.toggle("active", name === viewName);
    });
    dom.navPills.forEach((pill) => {
      const active = pill.dataset.view === viewName;
      pill.classList.toggle("active", active);
      pill.setAttribute("aria-selected", String(active));
    });

    if (viewName === "home") {
      renderHomeStats();
    } else if (viewName === "history") {
      renderHistory();
    }
  }

  function syncSettingsUI() {
    dom.roundsSlider.value = settings.rounds;
    dom.roundsValue.textContent = `${settings.rounds} ${settings.rounds === 1 ? "round" : "rounds"}`;

    dom.breathsSlider.value = settings.breaths;
    dom.breathsValue.textContent = `${settings.breaths} breaths`;
    dom.breathChips.forEach((chip) => {
      chip.classList.toggle("active", Number(chip.dataset.value) === settings.breaths);
    });

    dom.recoverySlider.value = settings.recoverySec;
    dom.recoveryValue.textContent = `${settings.recoverySec} sec`;

    const paceLabel = `${settings.breathSec.toFixed(1)}s / breath`;
    const sliderVal = breathSecToSliderVal(settings.breathSec);
    dom.paceDesc.textContent = paceLabel;
    dom.paceSlider.value = sliderVal;
    dom.sessionPaceValue.textContent = paceLabel;
    dom.sessionPaceSlider.value = sliderVal;

    dom.heroRecipePill.textContent =
      `${settings.rounds} ${settings.rounds === 1 ? "round" : "rounds"} · ${settings.breaths} breaths · ${settings.breathSec.toFixed(1)}s pace`;

    dom.volumeSlider.value = settings.volume;
    dom.volumeValue.textContent = `${settings.volume}%`;
    dom.breathAudioToggle.checked = settings.breathAudio;
    dom.voiceToggle.checked = settings.voiceCues;
    dom.droneToggle.checked = settings.drone;
    dom.milestoneToggle.checked = settings.milestones;

    audio.setVolume(settings.volume / 100);
    audio.setBreathSoundsEnabled(settings.breathAudio);
    audio.setVoiceEnabled(settings.voiceCues);
    audio.setMuted(settings.muted);

    dom.soundOnIcon.classList.toggle("hidden", settings.muted);
    dom.soundOffIcon.classList.toggle("hidden", !settings.muted);

    document.body.classList.toggle("night-mode", settings.nightMode);
    dom.nightModeBtn.classList.toggle("active", settings.nightMode);
  }

  function renderHomeStats() {
    const best = history.reduce((max, item) => Math.max(max, item.bestHoldSec || 0), 0);
    const totalRounds = history.reduce((sum, item) => sum + (item.holds ? item.holds.length : 0), 0);

    dom.homeBestHold.textContent = best > 0 ? formatTime(best) : "—";
    dom.homeSessionCount.textContent = String(history.length);
    dom.homeTotalRounds.textContent = String(totalRounds);
  }

  function renderRoundDots(total, currentIdx) {
    dom.roundDots.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const dot = document.createElement("span");
      dot.className = "round-dot";
      if (i < currentIdx) dot.classList.add("done");
      else if (i === currentIdx) dot.classList.add("current");
      dom.roundDots.appendChild(dot);
    }
  }

  function setRingProgress(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    dom.stageProgressRing.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    dom.stageProgressRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
  }

  function setOrbScale(scale) {
    dom.breathingOrb.style.transform = `scale(${scale.toFixed(4)})`;
  }

  /* ==================== Breathing Session Engine ==================== */
  function startSession() {
    audio.init();
    acquireWakeLock();

    const pace = getBreathDurations(settings.breathSec);
    session = {
      startedAt: Date.now(),
      totalRounds: settings.rounds,
      breathsPerRound: settings.breaths,
      inhaleMs: pace.inhaleMs,
      exhaleMs: pace.exhaleMs,
      recoveryMs: settings.recoverySec * 1000,
      roundIndex: 0,
      phase: "countdown", // countdown | breathing | retention | recovery_inhale | recovery | rest
      phaseStartMs: performance.now(),
      paused: false,
      pauseStartedMs: 0,
      holds: [],
      lastCountdownSec: -1,
      breathCount: 1,
      breathSubPhase: "inhale",
      breathSubStartMs: 0,
      lastMilestoneCount: 0
    };

    dom.pauseResumeBtn.textContent = "Pause";
    switchView("session");
    enterPhase("countdown");
    startLoop();
  }

  function enterPhase(phase) {
    if (!session) return;
    const now = performance.now();
    session.phase = phase;
    session.phaseStartMs = now;

    dom.sessionStage.classList.remove("phase-breathing", "phase-final-three", "phase-retention", "phase-recovery");
    dom.retentionEndBtn.classList.add("hidden");
    dom.sessionPaceWrap.classList.toggle("hidden", phase !== "breathing");

    const roundNum = session.roundIndex + 1;
    dom.sessionRoundBadge.textContent = `Round ${roundNum} of ${session.totalRounds}`;
    renderRoundDots(session.totalRounds, session.roundIndex);

    if (phase === "countdown") {
      audio.stopDrone();
      audio.stopRecoveryInhale();
      session.lastCountdownSec = -1;
      dom.sessionPhaseBadge.textContent = "Prepare";
      dom.skipPhaseBtn.classList.add("hidden");
      dom.stagePrompt.textContent = "Get Ready";
      dom.stageSecondary.textContent = "Relax your shoulders & jaw";
      setRingProgress(0);
      setOrbScale(0.65);
    } else if (phase === "breathing") {
      audio.stopDrone();
      audio.stopRecoveryInhale();
      dom.sessionStage.classList.add("phase-breathing");
      dom.sessionPhaseBadge.textContent = "Power Breathing";
      dom.skipPhaseBtn.classList.remove("hidden");
      dom.skipPhaseBtn.textContent = "Skip to Hold";
      session.breathCount = 1;
      session.breathSubPhase = "inhale";
      session.breathSubStartMs = now;
      const remaining = session.breathsPerRound - session.breathCount + 1;
      dom.sessionStage.classList.toggle("phase-final-three", remaining <= 3);
      dom.stagePrompt.textContent = remaining === 1 ? "Final Breath In" : "Breathe In";
      dom.stagePrimary.textContent = `1 / ${session.breathsPerRound}`;
      dom.stageSecondary.textContent = "Deep into belly, then chest";
      audio.playInhale(session.inhaleMs / 1000, remaining);
      if (roundNum > 1) {
        audio.speak(`Round ${roundNum}`);
      }
    } else if (phase === "retention") {
      audio.stopRecoveryInhale();
      dom.sessionStage.classList.add("phase-retention");
      dom.sessionPhaseBadge.textContent = "Breath Retention";
      dom.skipPhaseBtn.classList.add("hidden");
      dom.retentionEndBtn.classList.remove("hidden", "is-hold");
      dom.retentionEndBtn.querySelector(".retention-tap-title").textContent = "Breathe In";
      dom.stagePrompt.textContent = "Hold on Exhale";
      dom.stagePrimary.textContent = "0:00";
      dom.stageSecondary.textContent = "Relax completely and observe";
      session.lastMilestoneCount = 0;
      setOrbScale(0.56);
      setRingProgress(0);
      audio.playGong(216, 0.16, 3.8);
      audio.speak("Let go and hold");
      if (settings.drone) audio.startDrone();
    } else if (phase === "recovery_inhale") {
      audio.stopDrone();
      dom.sessionStage.classList.add("phase-recovery");
      dom.sessionPhaseBadge.textContent = "Recovery Inhale";
      dom.skipPhaseBtn.classList.add("hidden");
      dom.retentionEndBtn.classList.remove("hidden");
      dom.retentionEndBtn.classList.add("is-hold");
      dom.retentionEndBtn.querySelector(".retention-tap-title").textContent =
        `Start ${settings.recoverySec}s Hold`;
      dom.stagePrompt.textContent = "Deep Breath In";
      dom.stagePrimary.textContent = "Inhale";
      dom.stageSecondary.textContent = "Fill your lungs fully, then tap to hold";
      setRingProgress(0);
      audio.startRecoveryInhale();
      audio.speak("Deep breath in");
    } else if (phase === "recovery") {
      audio.stopDrone();
      audio.stopRecoveryInhale();
      dom.sessionStage.classList.add("phase-recovery");
      dom.sessionPhaseBadge.textContent = "Recovery Hold";
      dom.skipPhaseBtn.classList.remove("hidden");
      dom.skipPhaseBtn.textContent = "Skip Recovery";
      dom.stagePrompt.textContent = "Hold Full Breath";
      dom.stagePrimary.textContent = String(settings.recoverySec);
      dom.stageSecondary.textContent = "Hold gently at the top";
      setOrbScale(1.16);
      setRingProgress(1);
      audio.playGong(324, 0.15, 3.0);
      audio.speak("Hold");
    } else if (phase === "rest") {
      audio.stopDrone();
      audio.stopRecoveryInhale();
      dom.sessionPhaseBadge.textContent = "Release";
      dom.skipPhaseBtn.classList.add("hidden");
      dom.stagePrompt.textContent = "Let Go";
      dom.stagePrimary.textContent = "Relax";
      dom.stageSecondary.textContent = `Round ${roundNum + 1} begins in a moment`;
      setRingProgress(0);
      audio.playExhale(2.2);
      audio.speak("Let go and relax");
    }
  }

  function startLoop() {
    cancelAnimationFrame(rafId);
    const tick = (now) => {
      if (!session) return;
      if (!session.paused) {
        updateSession(now);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function updateSession(now) {
    const elapsed = now - session.phaseStartMs;

    if (session.phase === "countdown") {
      const totalMs = 3000;
      const remainingSec = Math.ceil((totalMs - elapsed) / 1000);
      if (remainingSec !== session.lastCountdownSec && remainingSec > 0) {
        session.lastCountdownSec = remainingSec;
        dom.stagePrimary.textContent = String(remainingSec);
        audio.playCountdownTick(remainingSec === 1);
      }
      setRingProgress(elapsed / totalMs);
      if (elapsed >= totalMs) {
        enterPhase("breathing");
      }
      return;
    }

    if (session.phase === "breathing") {
      const subElapsed = now - session.breathSubStartMs;
      const isInhale = session.breathSubPhase === "inhale";
      const subDur = isInhale ? session.inhaleMs : session.exhaleMs;
      const t = Math.min(1, subElapsed / subDur);

      const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
      const minScale = 0.56;
      const maxScale = 1.14;
      const scale = isInhale
        ? minScale + (maxScale - minScale) * eased
        : maxScale - (maxScale - minScale) * eased;
      setOrbScale(scale);

      const breathFrac = (session.breathCount - 1 + (isInhale ? t * 0.55 : 0.55 + t * 0.45)) / session.breathsPerRound;
      setRingProgress(breathFrac);

      if (subElapsed >= subDur) {
        if (isInhale) {
          session.breathSubPhase = "exhale";
          session.breathSubStartMs = now;
          const isLast = session.breathCount >= session.breathsPerRound;
          dom.stagePrompt.textContent = isLast ? "Let Go & Hold" : "Let Go";
          dom.stageSecondary.textContent = isLast
            ? "Exhale naturally, then stop breathing"
            : "Passive release — don't force it";
          audio.playExhale(session.exhaleMs / 1000);
        } else {
          if (session.breathCount >= session.breathsPerRound) {
            enterPhase("retention");
          } else {
            session.breathCount += 1;
            session.breathSubPhase = "inhale";
            session.breathSubStartMs = now;
            const remaining = session.breathsPerRound - session.breathCount + 1;
            const isLast = remaining === 1;
            dom.sessionStage.classList.toggle("phase-final-three", remaining <= 3);

            dom.stagePrompt.textContent = isLast ? "Final Breath In" : "Breathe In";
            dom.stagePrimary.textContent = `${session.breathCount} / ${session.breathsPerRound}`;
            if (isLast) {
              dom.stageSecondary.textContent = "Fully in, then let go into retention";
              audio.speak("Last breath");
            } else if (remaining <= 3) {
              dom.stageSecondary.textContent = `${remaining} breaths left`;
              if (remaining === 3) audio.speak("Three more breaths");
            } else {
              dom.stageSecondary.textContent = "Deep into belly, then chest";
            }
            audio.playInhale(session.inhaleMs / 1000, remaining);
          }
        }
      }
      return;
    }

    if (session.phase === "retention") {
      const sec = elapsed / 1000;
      dom.stagePrimary.textContent = formatTime(sec);

      const pulse = 0.56 + 0.045 * Math.sin(sec * 1.1);
      setOrbScale(pulse);
      setRingProgress((sec % 60) / 60);

      const milestone = Math.floor(sec / 30);
      if (milestone > session.lastMilestoneCount && milestone > 0) {
        session.lastMilestoneCount = milestone;
        if (settings.milestones) {
          audio.playMilestone();
        }
        // Announce full minutes when Voice Prompts are enabled
        if (settings.voiceCues && milestone % 2 === 0) {
          const mins = milestone / 2;
          audio.speak(mins === 1 ? "One minute" : `${mins} minutes`);
        }
      }
      return;
    }

    if (session.phase === "recovery_inhale") {
      const rampMs = 2400;
      const t = Math.min(1, elapsed / rampMs);
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
      const shimmer = t >= 1 ? 0.02 * Math.sin((elapsed - rampMs) / 500) : 0;
      setOrbScale(0.56 + (1.16 - 0.56) * eased + shimmer);
      setRingProgress(eased);
      return;
    }

    if (session.phase === "recovery") {
      const t = Math.min(1, elapsed / session.recoveryMs);
      const remaining = Math.ceil((session.recoveryMs - elapsed) / 1000);
      dom.stagePrimary.textContent = String(Math.max(0, remaining));
      setRingProgress(1 - t);

      const pulse = 1.16 + 0.015 * Math.sin(elapsed / 650);
      setOrbScale(pulse);

      if (elapsed >= session.recoveryMs) {
        completeRound();
      }
      return;
    }

    if (session.phase === "rest") {
      const restMs = 3000;
      const t = Math.min(1, elapsed / restMs);
      const scale = 1.16 - (1.16 - 0.62) * (0.5 - 0.5 * Math.cos(Math.PI * t));
      setOrbScale(scale);

      if (elapsed >= restMs) {
        session.roundIndex += 1;
        enterPhase("breathing");
      }
    }
  }

  function finishRetention() {
    if (!session || session.phase !== "retention") return;
    if (session.paused) togglePause();
    const holdSec = Math.round((performance.now() - session.phaseStartMs) / 1000);
    session.holds.push(holdSec);
    enterPhase("recovery_inhale");
  }

  function startRecoveryHold() {
    if (!session || session.phase !== "recovery_inhale") return;
    if (session.paused) togglePause();
    audio.stopRecoveryInhale();
    enterPhase("recovery");
  }

  function handlePrimaryTapAction() {
    if (!session) return;
    if (session.phase === "retention") {
      finishRetention();
    } else if (session.phase === "recovery_inhale") {
      startRecoveryHold();
    }
  }

  function completeRound() {
    if (!session) return;
    if (session.roundIndex + 1 < session.totalRounds) {
      enterPhase("rest");
    } else {
      finishSession();
    }
  }

  function togglePause() {
    if (!session) return;
    const now = performance.now();
    if (!session.paused) {
      session.paused = true;
      session.pauseStartedMs = now;
      dom.pauseResumeBtn.textContent = "Resume";
      audio.stopDrone();
      audio.stopRecoveryInhale();
      audio.cancelSpeech();
    } else {
      const pausedDur = now - session.pauseStartedMs;
      session.phaseStartMs += pausedDur;
      session.breathSubStartMs += pausedDur;
      session.paused = false;
      dom.pauseResumeBtn.textContent = "Pause";
      if (session.phase === "retention" && settings.drone) {
        audio.startDrone();
      } else if (session.phase === "recovery_inhale") {
        audio.startRecoveryInhale();
      }
    }
  }

  function skipCurrentPhase() {
    if (!session) return;
    if (session.paused) togglePause();
    if (session.phase === "breathing") {
      enterPhase("retention");
    } else if (session.phase === "recovery") {
      completeRound();
    }
  }

  function abortSession() {
    if (!session) return;
    cancelAnimationFrame(rafId);
    audio.stopDrone();
    audio.stopRecoveryInhale();
    audio.cancelSpeech();
    releaseWakeLock();

    const completedHolds = session.holds;
    if (completedHolds.length > 0) {
      finishSession();
    } else {
      session = null;
      switchView("home");
    }
  }

  function finishSession() {
    cancelAnimationFrame(rafId);
    audio.stopDrone();
    audio.stopRecoveryInhale();
    releaseWakeLock();
    audio.playGong(264, 0.16, 4.2);
    audio.speak("Session complete");

    const totalDurationSec = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
    const holds = session.holds.slice();
    const bestHoldSec = holds.length ? Math.max(...holds) : 0;
    const totalHoldSec = holds.reduce((a, b) => a + b, 0);
    const avgHoldSec = holds.length ? Math.round(totalHoldSec / holds.length) : 0;

    const prevBest = history.reduce((m, item) => Math.max(m, item.bestHoldSec || 0), 0);
    const isNewPR = bestHoldSec > 0 && bestHoldSec > prevBest;

    const record = {
      id: Date.now(),
      date: new Date().toISOString(),
      rounds: holds.length,
      breathsPerRound: session.breathsPerRound,
      breathSec: settings.breathSec,
      holds,
      bestHoldSec,
      avgHoldSec,
      totalDurationSec
    };

    if (holds.length > 0) {
      history.unshift(record);
      if (history.length > 100) history = history.slice(0, 100);
      saveHistory();
    }

    renderSummary(record, totalHoldSec, isNewPR);
    session = null;
    switchView("summary");
  }

  /* ==================== Summary & History Rendering ==================== */
  function renderSummary(record, totalHoldSec, isNewPR) {
    dom.summaryPrBadge.classList.toggle("hidden", !isNewPR);
    dom.summarySubtitle.textContent =
      `${record.rounds} ${record.rounds === 1 ? "round" : "rounds"} · ${record.breathsPerRound} breaths · ${formatTime(record.totalDurationSec)} total`;

    dom.summaryBestHold.textContent = formatTime(record.bestHoldSec);
    dom.summaryAvgHold.textContent = formatTime(record.avgHoldSec);
    dom.summaryTotalHold.textContent = formatTime(totalHoldSec);

    dom.summaryRoundBars.innerHTML = "";
    const maxHold = Math.max(1, ...record.holds);
    record.holds.forEach((sec, idx) => {
      const row = document.createElement("div");
      row.className = "round-bar-row";
      const pct = Math.max(6, Math.round((sec / maxHold) * 100));
      row.innerHTML = `
        <span class="round-bar-label">Round ${idx + 1}</span>
        <div class="round-bar-track"><div class="round-bar-fill" style="width:${pct}%"></div></div>
        <span class="round-bar-time">${formatTime(sec)}</span>
      `;
      dom.summaryRoundBars.appendChild(row);
    });
  }

  function renderHistory() {
    dom.clearHistoryBtn.classList.toggle("hidden", history.length === 0);

    if (history.length === 0) {
      dom.historyChartWrap.classList.add("hidden");
      dom.historyList.innerHTML = `<div class="empty-state">No sessions recorded yet. Complete your first breathing session to track retention progress.</div>`;
      return;
    }

    const recent = history.slice(0, 12).reverse();
    const maxBest = Math.max(1, ...recent.map((r) => r.bestHoldSec || 0));
    dom.historyChartWrap.classList.remove("hidden");
    dom.historyChart.innerHTML = recent
      .map((r) => {
        const pct = Math.max(10, Math.round(((r.bestHoldSec || 0) / maxBest) * 100));
        return `
          <div class="chart-col" title="${formatDate(r.date)} — Best ${formatTime(r.bestHoldSec)}">
            <span class="chart-val">${formatTime(r.bestHoldSec)}</span>
            <div class="chart-bar" style="height:${pct}%"></div>
          </div>
        `;
      })
      .join("");

    dom.historyList.innerHTML = history
      .map((r) => {
        const chips = (r.holds || [])
          .map((sec, idx) => `<span class="hold-chip">R${idx + 1}: ${formatTime(sec)}</span>`)
          .join("");
        return `
          <div class="history-item">
            <div>
              <div class="history-date">${formatDate(r.date)}</div>
              <div class="history-meta">${r.rounds} rounds · ${r.breathsPerRound} breaths · Best ${formatTime(r.bestHoldSec)}</div>
            </div>
            <div class="history-holds">${chips}</div>
          </div>
        `;
      })
      .join("");
  }

  /* ==================== Event Bindings ==================== */
  dom.navPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      if (session) return;
      switchView(pill.dataset.view);
    });
  });

  dom.nightModeBtn.addEventListener("click", () => {
    settings.nightMode = !settings.nightMode;
    saveSettings();
    syncSettingsUI();
  });

  dom.soundToggleBtn.addEventListener("click", () => {
    settings.muted = !settings.muted;
    saveSettings();
    syncSettingsUI();
  });

  function openSafetyModal() {
    dom.safetyModal.classList.remove("hidden");
  }

  function closeSafetyModal() {
    dom.safetyModal.classList.add("hidden");
    try {
      localStorage.setItem(STORAGE_KEYS.SAFETY_SEEN, "1");
    } catch (_) {}
  }

  dom.safetyInfoBtn.addEventListener("click", openSafetyModal);
  dom.closeSafetyBtn.addEventListener("click", closeSafetyModal);
  dom.ackSafetyBtn.addEventListener("click", closeSafetyModal);
  dom.safetyModal.addEventListener("click", (e) => {
    if (e.target === dom.safetyModal) closeSafetyModal();
  });

  // Confirm Clear History Modal
  function openConfirmModal() {
    dom.confirmModal.classList.remove("hidden");
  }

  function closeConfirmModal() {
    dom.confirmModal.classList.add("hidden");
  }

  dom.clearHistoryBtn.addEventListener("click", openConfirmModal);
  dom.cancelConfirmBtn.addEventListener("click", closeConfirmModal);
  dom.confirmModal.addEventListener("click", (e) => {
    if (e.target === dom.confirmModal) closeConfirmModal();
  });
  dom.confirmClearBtn.addEventListener("click", () => {
    history = [];
    saveHistory();
    renderHistory();
    renderHomeStats();
    closeConfirmModal();
  });

  // Settings controls
  dom.roundsSlider.addEventListener("input", () => {
    settings.rounds = Number(dom.roundsSlider.value);
    saveSettings();
    syncSettingsUI();
  });

  dom.breathsSlider.addEventListener("input", () => {
    settings.breaths = Number(dom.breathsSlider.value);
    saveSettings();
    syncSettingsUI();
  });

  dom.recoverySlider.addEventListener("input", () => {
    settings.recoverySec = Number(dom.recoverySlider.value);
    saveSettings();
    syncSettingsUI();
  });

  dom.breathChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.breaths = Number(chip.dataset.value);
      saveSettings();
      syncSettingsUI();
    });
  });

  function setBreathingPaceSec(newBreathSec) {
    settings.breathSec = clampBreathSec(newBreathSec);
    saveSettings();
    syncSettingsUI();

    if (session) {
      const next = getBreathDurations(settings.breathSec);
      if (session.phase === "breathing") {
        const refNow = session.paused ? session.pauseStartedMs : performance.now();
        const isInhale = session.breathSubPhase === "inhale";
        const oldDur = isInhale ? session.inhaleMs : session.exhaleMs;
        const newDur = isInhale ? next.inhaleMs : next.exhaleMs;
        const progress = Math.max(0, Math.min(1, (refNow - session.breathSubStartMs) / oldDur));
        session.breathSubStartMs = refNow - progress * newDur;
      }
      session.inhaleMs = next.inhaleMs;
      session.exhaleMs = next.exhaleMs;
    }
  }

  dom.paceSlider.addEventListener("input", () => {
    setBreathingPaceSec(sliderValToBreathSec(dom.paceSlider.value));
  });

  dom.sessionPaceSlider.addEventListener("input", () => {
    setBreathingPaceSec(sliderValToBreathSec(dom.sessionPaceSlider.value));
  });

  dom.stepperButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      const delta = Number(btn.dataset.delta);
      if (target === "rounds") {
        settings.rounds = Math.min(10, Math.max(1, settings.rounds + delta));
      } else if (target === "breaths") {
        settings.breaths = Math.min(60, Math.max(15, settings.breaths + delta));
      } else if (target === "recovery") {
        settings.recoverySec = Math.min(30, Math.max(10, settings.recoverySec + delta));
      }
      saveSettings();
      syncSettingsUI();
    });
  });

  // Audio mix controls
  dom.volumeSlider.addEventListener("input", () => {
    settings.volume = Number(dom.volumeSlider.value);
    saveSettings();
    syncSettingsUI();
  });

  dom.testSoundBtn.addEventListener("click", () => {
    if (settings.muted) {
      settings.muted = false;
      saveSettings();
      syncSettingsUI();
    }
    audio.playTestTone();
  });

  dom.breathAudioToggle.addEventListener("change", () => {
    settings.breathAudio = dom.breathAudioToggle.checked;
    saveSettings();
    syncSettingsUI();
  });

  dom.voiceToggle.addEventListener("change", () => {
    settings.voiceCues = dom.voiceToggle.checked;
    saveSettings();
    syncSettingsUI();
  });

  dom.droneToggle.addEventListener("change", () => {
    settings.drone = dom.droneToggle.checked;
    saveSettings();
  });

  dom.milestoneToggle.addEventListener("change", () => {
    settings.milestones = dom.milestoneToggle.checked;
    saveSettings();
  });

  // Session actions
  dom.startSessionBtn.addEventListener("click", startSession);
  dom.retentionEndBtn.addEventListener("click", handlePrimaryTapAction);
  dom.sessionStage.addEventListener("click", handlePrimaryTapAction);
  dom.pauseResumeBtn.addEventListener("click", togglePause);
  dom.skipPhaseBtn.addEventListener("click", skipCurrentPhase);
  dom.endSessionBtn.addEventListener("click", abortSession);

  // Summary actions
  dom.newSessionBtn.addEventListener("click", () => switchView("home"));
  dom.viewHistoryBtn.addEventListener("click", () => switchView("history"));

  // Keyboard support (great for iPad Magic Keyboard / folio)
  document.addEventListener("keydown", (e) => {
    if (!session) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (session.phase === "retention" || session.phase === "recovery_inhale") {
        handlePrimaryTapAction();
      } else {
        togglePause();
      }
    }
  });

  /* ==================== Service Worker Registration ==================== */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  /* ==================== Initialize ==================== */
  syncSettingsUI();
  renderHomeStats();

  try {
    if (!localStorage.getItem(STORAGE_KEYS.SAFETY_SEEN)) {
      openSafetyModal();
    }
  } catch (_) {}
})();
