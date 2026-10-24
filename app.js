/**
 * ROUTINE TRACKER - JAVASCRIPT ENGINE
 * Clean, human, easy-to-use interval & timestamp workout companion.
 */

const STORAGE_KEYS = {
  ROUTINE: 'routine_tracker_data_v3',
  HISTORY: 'routine_tracker_history_v3',
  SETTINGS: 'routine_tracker_settings_v3'
};

const DEFAULT_ROUTINE = [
  {
    id: 'ex_1',
    name: 'Primary Exercise (Timed)',
    notes: '30s prep • 3 min exercise • 1 min rest between reps/sets',
    mode: 'timed',
    prepSeconds: 30,
    workSeconds: 180, // 3 minutes
    restSeconds: 60,  // 1 minute
    targetSets: 3,
    targetReps: 3
  },
  {
    id: 'ex_2',
    name: 'Follow-up Exercise (Untimed)',
    notes: 'Untimed routine. Logs exact start time and tracks total minutes.',
    mode: 'untimed',
    prepSeconds: 0,
    workSeconds: 0,
    restSeconds: 0,
    targetSets: 3,
    targetReps: 3
  }
];

let routine = loadRoutine();
let historyLogs = loadHistory();
let settings = loadSettings();

let sessionState = {
  exIndex: 0,
  currentSet: 1,
  currentRep: 1,
  phase: 'ready', // 'ready' (prep 30s) -> 'work' (3m) -> 'break' (1m)
  timeRemaining: 30,
  isRunning: false,
  timerInterval: null,
  totalElapsedSeconds: 0,
  sessionTimerInterval: null,
  // Untimed tracking
  untimedStartTime: null,
  untimedElapsedSeconds: 0,
  untimedInterval: null,
  untimedSetsDone: 1,
  untimedRepsDone: 1
};

let audioCtx = null;

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initEventListeners();
  initInlineAdjusters();
  initRestModal();
  initAccordion();
  initCalendar();
  applySettings();
  renderWeeklyStreak();
  renderQueuePreview();
  loadCurrentExerciseUI();
  renderEditorList();
  renderStatsTab();
  initAudio();
});

function loadRoutine() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ROUTINE);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
}

function saveRoutine() {
  localStorage.setItem(STORAGE_KEYS.ROUTINE, JSON.stringify(routine));
  document.getElementById('routineCountBadge').textContent = routine.length;
}

function loadHistory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [];
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(historyLogs));
}

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return { sound: true, discreet: false };
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

// ============================================================================
// Audio Feedback (Gentle, Crisp Web Audio)
// ============================================================================
function initAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  } catch (e) {}
}

function ensureAudioReady() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, type = 'sine', duration = 0.12, gainVal = 0.15) {
  if (!settings.sound || !audioCtx) return;
  try {
    ensureAudioReady();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function soundCountdownTick() {
  playTone(600, 'sine', 0.08, 0.15);
}

function soundPhaseStart() {
  if (!settings.sound || !audioCtx) return;
  playTone(523.25, 'triangle', 0.14, 0.2); // C5
  setTimeout(() => playTone(659.25, 'triangle', 0.18, 0.2), 110); // E5
}

function soundRestStart() {
  if (!settings.sound || !audioCtx) return;
  playTone(440, 'sine', 0.18, 0.15); // A4
  setTimeout(() => playTone(349.23, 'sine', 0.25, 0.15), 140); // F4
}

function soundWorkoutComplete() {
  if (!settings.sound || !audioCtx) return;
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, idx) => {
    setTimeout(() => playTone(freq, 'triangle', 0.25, 0.25), idx * 120);
  });
}

// ============================================================================
// Routine Execution & Timers
// ============================================================================
function loadCurrentExerciseUI() {
  if (routine.length === 0) return;
  const ex = routine[sessionState.exIndex];
  if (!ex) return;

  // Header info
  document.getElementById('currentStepBadge').textContent = `Exercise ${sessionState.exIndex + 1} of ${routine.length}`;
  document.getElementById('currentExerciseName').textContent = ex.name;

  const isTimed = ex.mode === 'timed';
  const timedDisplay = document.getElementById('timedDisplay');
  const untimedDisplay = document.getElementById('untimedDisplay');
  const timedAdjusters = document.getElementById('timedAdjusters');

  if (isTimed) {
    timedDisplay.style.display = 'block';
    untimedDisplay.style.display = 'none';
    timedAdjusters.style.display = 'block';

    sessionState.phase = 'ready';
    sessionState.timeRemaining = ex.prepSeconds > 0 ? ex.prepSeconds : ex.workSeconds;
    updatePhaseUI();
    renderSetsRepsText();
  } else {
    timedDisplay.style.display = 'none';
    untimedDisplay.style.display = 'block';
    timedAdjusters.style.display = 'none';

    sessionState.untimedStartTime = null;
    sessionState.untimedElapsedSeconds = 0;
    sessionState.untimedSetsDone = sessionState.currentSet;
    sessionState.untimedRepsDone = sessionState.currentRep;

    document.getElementById('untimedStartTimeDisplay').textContent = 'Press START to record time';
    document.getElementById('untimedElapsedDigits').textContent = '00:00:00';
    document.getElementById('untimedSetCount').textContent = sessionState.untimedSetsDone;
    document.getElementById('untimedRepCount').textContent = sessionState.untimedRepsDone;
  }

  updateInlineAdjusterDisplays();
  updateMainActionBtnUI();
  renderQueuePreview();
}

function updatePhaseUI() {
  const ex = routine[sessionState.exIndex];
  if (!ex) return;

  const tag = document.getElementById('phaseTag');
  const tagText = document.getElementById('phaseTagText');
  const timerDigits = document.getElementById('timerDigits');
  const timerSublabel = document.getElementById('timerSublabel');

  const chipPrep = document.getElementById('chipPrep');
  const chipWork = document.getElementById('chipWork');
  const chipBreak = document.getElementById('chipBreak');

  tag.classList.remove('phase-ready', 'phase-work', 'phase-break');
  chipPrep.classList.remove('active');
  chipWork.classList.remove('active');
  chipBreak.classList.remove('active');

  if (sessionState.phase === 'ready') {
    tag.classList.add('phase-ready');
    tagText.textContent = `Get Ready (${ex.prepSeconds}s)`;
    timerSublabel.textContent = 'Prep countdown (Auto-starts exercise)';
    chipPrep.classList.add('active');
  } else if (sessionState.phase === 'work') {
    tag.classList.add('phase-work');
    tagText.textContent = `Exercise (${formatMinSec(ex.workSeconds)})`;
    timerSublabel.textContent = 'Active exercise (Auto-starts break when done)';
    chipWork.classList.add('active');
  } else if (sessionState.phase === 'break') {
    tag.classList.add('phase-break');
    tagText.textContent = `Rest Break (${formatMinSec(ex.restSeconds)})`;
    timerSublabel.textContent = 'Rest & relax (Auto-starts next rep when done)';
    chipBreak.classList.add('active');
  }

  timerDigits.textContent = formatTimer(sessionState.timeRemaining);
}

function renderSetsRepsText() {
  const ex = routine[sessionState.exIndex];
  if (!ex) return;

  document.getElementById('setCounterBadge').textContent = `${sessionState.currentSet} of ${ex.targetSets}`;
  document.getElementById('repCounterBadge').textContent = `${sessionState.currentRep} of ${ex.targetReps}`;
}

function formatTimer(totalSecs) {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatMinSec(totalSecs) {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m 00s`;
  return `${secs}s`;
}

function formatHMS(totalSecs) {
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// --- Start / Pause Execution ---
function toggleStartPause() {
  ensureAudioReady();
  if (sessionState.isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  const ex = routine[sessionState.exIndex];
  if (!ex) return;

  sessionState.isRunning = true;
  updateMainActionBtnUI();

  if (!sessionState.sessionTimerInterval) {
    sessionState.sessionTimerInterval = setInterval(() => {
      sessionState.totalElapsedSeconds++;
    }, 1000);
  }

  if (ex.mode === 'timed') {
    if (sessionState.phase === 'ready' && sessionState.timeRemaining === ex.prepSeconds) {
      soundPhaseStart();
    }
    clearInterval(sessionState.timerInterval);
    sessionState.timerInterval = setInterval(handleTimedTick, 1000);
  } else {
    if (!sessionState.untimedStartTime) {
      sessionState.untimedStartTime = new Date();
      soundPhaseStart();

      const timeStr = sessionState.untimedStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      document.getElementById('untimedStartTimeDisplay').textContent = timeStr;
    }

    clearInterval(sessionState.untimedInterval);
    sessionState.untimedInterval = setInterval(() => {
      sessionState.untimedElapsedSeconds++;
      document.getElementById('untimedElapsedDigits').textContent = formatHMS(sessionState.untimedElapsedSeconds);
    }, 1000);
  }
}

function pauseTimer() {
  sessionState.isRunning = false;
  clearInterval(sessionState.timerInterval);
  clearInterval(sessionState.untimedInterval);
  updateMainActionBtnUI();
}

function handleTimedTick() {
  if (sessionState.timeRemaining > 0) {
    sessionState.timeRemaining--;

    // 3, 2, 1 Countdown Beeps
    if (sessionState.timeRemaining <= 3 && sessionState.timeRemaining > 0) {
      soundCountdownTick();
    }

    document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
  } else {
    // Phase time hit 0: AUTOMATICALLY ADVANCE to next phase!
    advanceTimedPhase();
  }
}

function advanceTimedPhase() {
  const ex = routine[sessionState.exIndex];

  if (sessionState.phase === 'ready') {
    // Ready -> Exercise
    sessionState.phase = 'work';
    sessionState.timeRemaining = ex.workSeconds;
    soundPhaseStart();
    updatePhaseUI();
  } else if (sessionState.phase === 'work') {
    // Exercise -> Rest Break
    sessionState.phase = 'break';
    sessionState.timeRemaining = ex.restSeconds;
    soundRestStart();
    updatePhaseUI();
  } else if (sessionState.phase === 'break') {
    // Rest Break -> Next Rep / Set
    if (sessionState.currentRep < ex.targetReps) {
      sessionState.currentRep++;
      sessionState.phase = 'work';
      sessionState.timeRemaining = ex.workSeconds;
      soundPhaseStart();
      renderSetsRepsText();
      updatePhaseUI();
    } else {
      if (sessionState.currentSet < ex.targetSets) {
        sessionState.currentSet++;
        sessionState.currentRep = 1;
        sessionState.phase = 'work';
        sessionState.timeRemaining = ex.workSeconds;
        soundPhaseStart();
        renderSetsRepsText();
        updatePhaseUI();
      } else {
        pauseTimer();
        soundWorkoutComplete();
        if (sessionState.exIndex < routine.length - 1) {
          moveToNextExercise();
        } else {
          promptFinishWorkout();
        }
      }
    }
  }
}

function skipCurrentPhase() {
  const ex = routine[sessionState.exIndex];
  if (!ex || ex.mode !== 'timed') return;
  advanceTimedPhase();
}

function moveToNextExercise() {
  if (sessionState.exIndex < routine.length - 1) {
    pauseTimer();
    sessionState.exIndex++;
    sessionState.currentSet = 1;
    sessionState.currentRep = 1;
    loadCurrentExerciseUI();
  }
}

function moveToPrevExercise() {
  if (sessionState.exIndex > 0) {
    pauseTimer();
    sessionState.exIndex--;
    sessionState.currentSet = 1;
    sessionState.currentRep = 1;
    loadCurrentExerciseUI();
  }
}

function resetCurrentExercise() {
  pauseTimer();
  sessionState.currentSet = 1;
  sessionState.currentRep = 1;
  loadCurrentExerciseUI();
}

function updateMainActionBtnUI() {
  const btn = document.getElementById('mainActionBtn');
  const label = document.getElementById('mainActionLabel');
  const icon = document.getElementById('mainActionIcon');

  if (sessionState.isRunning) {
    btn.classList.add('paused');
    label.textContent = 'PAUSE';
    icon.textContent = '⏸';
  } else {
    btn.classList.remove('paused');
    label.textContent = sessionState.totalElapsedSeconds > 0 ? 'RESUME' : 'START';
    icon.textContent = '▶';
  }
}

// ============================================================================
// DIRECT ON-SCREEN ADJUSTERS & REST TIME EDITING
// ============================================================================
function updateInlineAdjusterDisplays() {
  const ex = routine[sessionState.exIndex];
  if (!ex) return;

  const restText = formatMinSec(ex.restSeconds);

  // Values in adjuster card
  document.getElementById('adjPrepVal').textContent = `${ex.prepSeconds}s`;
  document.getElementById('adjWorkVal').textContent = formatMinSec(ex.workSeconds);
  document.getElementById('adjRestVal').textContent = `${restText} ✎`;
  document.getElementById('adjSetsVal').textContent = `${ex.targetSets} Sets`;
  document.getElementById('adjRepsVal').textContent = `${ex.targetReps} Reps`;

  // Dedicated rest pill on workout card
  document.getElementById('quickRestDisplay').textContent = restText;

  // Values in flow chips
  document.getElementById('chipPrepSec').textContent = `${ex.prepSeconds}s`;
  document.getElementById('chipWorkSec').textContent = formatMinSec(ex.workSeconds);
  document.getElementById('chipBreakSec').textContent = restText;

  // Update Compact Summary line in the Accordion Header
  const summaryEl = document.getElementById('compactSummaryText');
  if (summaryEl) {
    if (ex.mode === 'timed') {
      summaryEl.textContent = `${ex.prepSeconds}s prep • ${formatMinSec(ex.workSeconds)} work • ${restText} rest • ${ex.targetSets}s × ${ex.targetReps}r`;
    } else {
      summaryEl.textContent = `Timestamp Tracker • ${ex.targetSets} sets × ${ex.targetReps} reps`;
    }
  }

  renderSetsRepsText();
}

function initAccordion() {
  const card = document.getElementById('inlineSettingsCard');
  const toggleBtn = document.getElementById('toggleInlineSettingsBtn');

  if (card && toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
  }
}

function initInlineAdjusters() {
  // Prep Adjusters (±5s)
  document.getElementById('adjPrepMinus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex && ex.prepSeconds >= 5) {
      ex.prepSeconds -= 5;
      saveRoutine();
      if (!sessionState.isRunning && sessionState.phase === 'ready') {
        sessionState.timeRemaining = ex.prepSeconds;
        document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
      }
      updateInlineAdjusterDisplays();
      updatePhaseUI();
    }
  });

  document.getElementById('adjPrepPlus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex) {
      ex.prepSeconds += 5;
      saveRoutine();
      if (!sessionState.isRunning && sessionState.phase === 'ready') {
        sessionState.timeRemaining = ex.prepSeconds;
        document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
      }
      updateInlineAdjusterDisplays();
      updatePhaseUI();
    }
  });

  // Work Time Adjusters (±30s)
  document.getElementById('adjWorkMinus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex && ex.workSeconds >= 30) {
      ex.workSeconds -= 30;
      saveRoutine();
      if (!sessionState.isRunning && sessionState.phase === 'work') {
        sessionState.timeRemaining = ex.workSeconds;
        document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
      }
      updateInlineAdjusterDisplays();
      updatePhaseUI();
    }
  });

  document.getElementById('adjWorkPlus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex) {
      ex.workSeconds += 30;
      saveRoutine();
      if (!sessionState.isRunning && sessionState.phase === 'work') {
        sessionState.timeRemaining = ex.workSeconds;
        document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
      }
      updateInlineAdjusterDisplays();
      updatePhaseUI();
    }
  });

  // Break Time Adjusters (±15s)
  document.getElementById('adjRestMinus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex && ex.restSeconds >= 15) {
      ex.restSeconds -= 15;
      saveRoutine();
      if (!sessionState.isRunning && sessionState.phase === 'break') {
        sessionState.timeRemaining = ex.restSeconds;
        document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
      }
      updateInlineAdjusterDisplays();
      updatePhaseUI();
    }
  });

  document.getElementById('adjRestPlus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex) {
      ex.restSeconds += 15;
      saveRoutine();
      if (!sessionState.isRunning && sessionState.phase === 'break') {
        sessionState.timeRemaining = ex.restSeconds;
        document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
      }
      updateInlineAdjusterDisplays();
      updatePhaseUI();
    }
  });

  // Sets Adjusters (±1)
  document.getElementById('adjSetsMinus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex && ex.targetSets > 1) {
      ex.targetSets--;
      if (sessionState.currentSet > ex.targetSets) sessionState.currentSet = ex.targetSets;
      saveRoutine();
      updateInlineAdjusterDisplays();
    }
  });

  document.getElementById('adjSetsPlus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex) {
      ex.targetSets++;
      saveRoutine();
      updateInlineAdjusterDisplays();
    }
  });

  // Reps Adjusters (±1)
  document.getElementById('adjRepsMinus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex && ex.targetReps > 1) {
      ex.targetReps--;
      if (sessionState.currentRep > ex.targetReps) sessionState.currentRep = ex.targetReps;
      saveRoutine();
      updateInlineAdjusterDisplays();
    }
  });

  document.getElementById('adjRepsPlus').addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (ex) {
      ex.targetReps++;
      saveRoutine();
      updateInlineAdjusterDisplays();
    }
  });
}

// ============================================================================
// DEDICATED REST / BREAK TIME EDITOR MODAL
// ============================================================================
function initRestModal() {
  const modal = document.getElementById('restEditModal');
  const closeBtn = document.getElementById('closeRestModalBtn');
  const cancelBtn = document.getElementById('cancelRestModalBtn');
  const saveBtn = document.getElementById('saveRestModalBtn');

  // Triggers to open rest editor
  document.getElementById('quickEditRestBtn').addEventListener('click', openRestModal);
  document.getElementById('chipBreak').addEventListener('click', openRestModal);
  document.getElementById('adjRestVal').addEventListener('click', openRestModal);

  closeBtn.addEventListener('click', closeRestModal);
  cancelBtn.addEventListener('click', closeRestModal);

  // Preset chips click
  const presetChips = document.querySelectorAll('.preset-chip');
  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      presetChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const totalSecs = parseInt(chip.dataset.secs) || 60;
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;

      document.getElementById('customRestMin').value = mins;
      document.getElementById('customRestSec').value = secs;
    });
  });

  // Save button
  saveBtn.addEventListener('click', () => {
    const ex = routine[sessionState.exIndex];
    if (!ex) return;

    const mins = parseInt(document.getElementById('customRestMin').value) || 0;
    const secs = parseInt(document.getElementById('customRestSec').value) || 0;
    const totalSecs = Math.max(5, (mins * 60) + secs);

    ex.restSeconds = totalSecs;
    saveRoutine();

    if (!sessionState.isRunning && sessionState.phase === 'break') {
      sessionState.timeRemaining = ex.restSeconds;
      document.getElementById('timerDigits').textContent = formatTimer(sessionState.timeRemaining);
    }

    updateInlineAdjusterDisplays();
    updatePhaseUI();
    closeRestModal();
  });
}

function openRestModal() {
  const ex = routine[sessionState.exIndex];
  if (!ex) return;

  const totalSecs = ex.restSeconds || 60;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  document.getElementById('customRestMin').value = mins;
  document.getElementById('customRestSec').value = secs;

  const presetChips = document.querySelectorAll('.preset-chip');
  presetChips.forEach(chip => {
    if (parseInt(chip.dataset.secs) === totalSecs) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  document.getElementById('restEditModal').style.display = 'flex';
}

function closeRestModal() {
  document.getElementById('restEditModal').style.display = 'none';
}

// ============================================================================
// Routine Order Tags
// ============================================================================
function renderQueuePreview() {
  const container = document.getElementById('queueItemList');
  container.innerHTML = '';

  routine.forEach((ex, idx) => {
    const tag = document.createElement('div');
    tag.className = `seq-tag ${idx === sessionState.exIndex ? 'active' : ''}`;
    tag.textContent = `${idx + 1}. ${ex.name}`;

    tag.addEventListener('click', () => {
      if (idx !== sessionState.exIndex) {
        pauseTimer();
        sessionState.exIndex = idx;
        sessionState.currentSet = 1;
        sessionState.currentRep = 1;
        loadCurrentExerciseUI();
      }
    });

    container.appendChild(tag);
  });
}

// ============================================================================
// Workout Complete & 5-Day Weekly Goal
// ============================================================================
function promptFinishWorkout() {
  pauseTimer();
  soundWorkoutComplete();

  const durationSecs = Math.max(sessionState.totalElapsedSeconds, 60);
  const durationMins = Math.round(durationSecs / 60);

  const logEntry = {
    id: 'log_' + Date.now(),
    date: new Date().toISOString(),
    durationMinutes: durationMins,
    exercisesCompleted: routine.map(e => e.name).join(', ')
  };

  historyLogs.unshift(logEntry);
  saveHistory();

  document.getElementById('celebrationStats').innerHTML = `
    <div><strong>${durationMins}m</strong><br><span style="color:#656c7d;font-size:0.75rem;">Time</span></div>
    <div><strong>${routine.length}</strong><br><span style="color:#656c7d;font-size:0.75rem;">Exercises</span></div>
    <div><strong>${getWeeklyCompletedCount()}/5</strong><br><span style="color:#656c7d;font-size:0.75rem;">This Week</span></div>
  `;

  document.getElementById('completionModal').style.display = 'flex';
  renderWeeklyStreak();
  renderStatsTab();
}

function getWeekRange() {
  const now = new Date();
  const currentDay = now.getDay();
  const distanceToMonday = (currentDay + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - distanceToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

function getWeeklyCompletedCount() {
  const { monday, sunday } = getWeekRange();
  const daysDoneSet = new Set();
  historyLogs.forEach(entry => {
    const entryDate = new Date(entry.date);
    if (entryDate >= monday && entryDate <= sunday) {
      daysDoneSet.add(entryDate.toDateString());
    }
  });
  return daysDoneSet.size;
}

function renderWeeklyStreak() {
  const weekDots = document.getElementById('weekDots');
  const goalLabel = document.getElementById('weeklyGoalLabel');
  const { monday } = getWeekRange();
  const dayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const todayDateStr = new Date().toDateString();

  const completedDays = new Set(historyLogs.map(item => new Date(item.date).toDateString()));

  weekDots.innerHTML = '';
  let count = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dStr = d.toDateString();
    const isCompleted = completedDays.has(dStr);
    const isToday = dStr === todayDateStr;
    if (isCompleted) count++;

    const item = document.createElement('div');
    item.className = 'day-bubble-item';
    item.innerHTML = `
      <span class="bubble-day">${dayNames[i]}</span>
      <div class="bubble-circle ${isCompleted ? 'done' : ''} ${isToday ? 'today' : ''}">
        ${isCompleted ? '✓' : ''}
      </div>
    `;
    weekDots.appendChild(item);
  }

  goalLabel.textContent = `${count} of 5 days done`;
}

function calculateCurrentStreak() {
  if (historyLogs.length === 0) return 0;
  const dates = [...new Set(historyLogs.map(l => new Date(l.date).toDateString()))].map(d => new Date(d));
  dates.sort((a, b) => b - a);

  let streak = 0;
  let check = new Date();
  check.setHours(0, 0, 0, 0);

  const hasToday = dates.some(d => d.toDateString() === check.toDateString());
  if (!hasToday) check.setDate(check.getDate() - 1);

  while (true) {
    const checkStr = check.toDateString();
    if (dates.some(d => d.toDateString() === checkStr)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function renderStatsTab() {
  const weeklyCount = getWeeklyCompletedCount();
  document.getElementById('statsWeeklyCount').innerHTML = `${weeklyCount} <span class="stat-of">/ 5 days</span>`;
  const pct = Math.min(100, Math.round((weeklyCount / 5) * 100));
  document.getElementById('statsWeeklyBar').style.width = `${pct}%`;

  const feedback = document.getElementById('weeklyGoalFeedback');
  if (weeklyCount >= 5) {
    feedback.textContent = '🎉 5-day goal reached this week! Excellent job!';
  } else {
    feedback.textContent = `${5 - weeklyCount} more day(s) needed to hit your 5-day weekly target.`;
  }

  document.getElementById('statsStreakVal').textContent = calculateCurrentStreak();
  document.getElementById('statsBestStreakVal').textContent = calculateCurrentStreak();

  // History list
  const container = document.getElementById('historyLogContainer');
  if (historyLogs.length === 0) {
    container.innerHTML = '<div style="color:#656c7d;font-size:0.85rem;padding:12px 0;">No workout logs yet.</div>';
    return;
  }

  container.innerHTML = '';
  historyLogs.forEach((log, idx) => {
    const d = new Date(log.date);
    const dateFormatted = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const timeFormatted = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="hist-left">
        <span class="hist-date">${dateFormatted} • ${timeFormatted}</span>
        <span class="hist-ex">${escapeHtml(log.exercisesCompleted)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="hist-mins">${log.durationMinutes}m</span>
        <button class="text-btn danger" style="padding:0;font-size:0.8rem;" data-idx="${idx}">✕</button>
      </div>
    `;

    item.querySelector('.text-btn.danger').addEventListener('click', () => {
      historyLogs.splice(idx, 1);
      saveHistory();
      renderWeeklyStreak();
      renderStatsTab();
    });

    container.appendChild(item);
  });
}

// ============================================================================
// Routine Editor (All Exercises Tab)
// ============================================================================
function renderEditorList() {
  const container = document.getElementById('routineEditorList');
  container.innerHTML = '';

  if (routine.length === 0) {
    container.innerHTML = '<div style="color:#656c7d;font-size:0.85rem;">No exercises yet. Click "+ Add Exercise".</div>';
    return;
  }

  routine.forEach((ex, idx) => {
    const item = document.createElement('div');
    item.className = 'clean-item';

    const timingText = ex.mode === 'timed'
      ? `Prep: ${ex.prepSeconds}s • Work: ${formatMinSec(ex.workSeconds)} • Break: ${formatMinSec(ex.restSeconds)} • ${ex.targetSets} sets × ${ex.targetReps} reps`
      : `Timestamp Tracker • ${ex.targetSets} sets × ${ex.targetReps} reps`;

    item.innerHTML = `
      <div class="item-left">
        <span class="item-num">${idx + 1}</span>
        <div>
          <div class="item-title">${escapeHtml(ex.name)}</div>
          <div class="item-meta">${timingText}</div>
        </div>
      </div>
      <div class="item-actions">
        <button class="icon-action-btn up-btn" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-action-btn down-btn" title="Move Down" ${idx === routine.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="icon-action-btn edit-btn" title="Edit">✎</button>
        <button class="icon-action-btn del delete-btn" title="Delete">✕</button>
      </div>
    `;

    item.querySelector('.up-btn').addEventListener('click', () => moveExercise(idx, -1));
    item.querySelector('.down-btn').addEventListener('click', () => moveExercise(idx, 1));
    item.querySelector('.edit-btn').addEventListener('click', () => openEditExerciseModal(ex.id));
    item.querySelector('.delete-btn').addEventListener('click', () => deleteExercise(idx));

    container.appendChild(item);
  });
}

function moveExercise(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= routine.length) return;
  const temp = routine[index];
  routine[index] = routine[target];
  routine[target] = temp;
  saveRoutine();
  renderEditorList();
  renderQueuePreview();
  loadCurrentExerciseUI();
}

function deleteExercise(index) {
  if (routine.length <= 1) {
    alert('Routine needs at least one exercise.');
    return;
  }
  if (confirm(`Remove "${routine[index].name}"?`)) {
    routine.splice(index, 1);
    if (sessionState.exIndex >= routine.length) sessionState.exIndex = routine.length - 1;
    saveRoutine();
    renderEditorList();
    renderQueuePreview();
    loadCurrentExerciseUI();
  }
}

function openAddExerciseModal() {
  document.getElementById('modalTitle').textContent = 'Add Exercise';
  document.getElementById('editExerciseId').value = '';
  document.getElementById('fName').value = '';
  document.getElementById('fNotes').value = '';
  document.getElementById('modeTimed').checked = true;
  document.getElementById('fPrep').value = 30;
  document.getElementById('fWorkMinutes').value = 3;
  document.getElementById('fWorkSeconds').value = 0;
  document.getElementById('fRestMinutes').value = 1;
  document.getElementById('fRestSeconds').value = 0;
  document.getElementById('fSets').value = 3;
  document.getElementById('fReps').value = 3;

  toggleTimedFieldsVisibility(true);
  document.getElementById('exerciseModal').style.display = 'flex';
}

function openEditExerciseModal(id) {
  const ex = routine.find(e => e.id === id);
  if (!ex) return;

  document.getElementById('modalTitle').textContent = 'Edit Exercise';
  document.getElementById('editExerciseId').value = ex.id;
  document.getElementById('fName').value = ex.name;
  document.getElementById('fNotes').value = ex.notes || '';

  const isTimed = ex.mode === 'timed';
  document.getElementById('modeTimed').checked = isTimed;
  document.getElementById('modeUntimed').checked = !isTimed;

  document.getElementById('fPrep').value = ex.prepSeconds || 0;
  document.getElementById('fWorkMinutes').value = Math.floor((ex.workSeconds || 180) / 60);
  document.getElementById('fWorkSeconds').value = (ex.workSeconds || 180) % 60;
  document.getElementById('fRestMinutes').value = Math.floor((ex.restSeconds || 60) / 60);
  document.getElementById('fRestSeconds').value = (ex.restSeconds || 60) % 60;

  document.getElementById('fSets').value = ex.targetSets || 3;
  document.getElementById('fReps').value = ex.targetReps || 3;

  toggleTimedFieldsVisibility(isTimed);
  document.getElementById('exerciseModal').style.display = 'flex';
}

function toggleTimedFieldsVisibility(isTimed) {
  document.getElementById('timedConfigFields').style.display = isTimed ? 'block' : 'none';
}

function handleSaveExercise(e) {
  e.preventDefault();
  const id = document.getElementById('editExerciseId').value;
  const name = document.getElementById('fName').value.trim();
  const notes = document.getElementById('fNotes').value.trim();
  const mode = document.querySelector('input[name="fMode"]:checked').value;

  const prepSeconds = parseInt(document.getElementById('fPrep').value) || 0;
  const workMins = parseInt(document.getElementById('fWorkMinutes').value) || 0;
  const workSecs = parseInt(document.getElementById('fWorkSeconds').value) || 0;
  const workSeconds = (workMins * 60) + workSecs;

  const restMins = parseInt(document.getElementById('fRestMinutes').value) || 0;
  const restSecs = parseInt(document.getElementById('fRestSeconds').value) || 0;
  const restSeconds = (restMins * 60) + restSecs;

  const targetSets = parseInt(document.getElementById('fSets').value) || 3;
  const targetReps = parseInt(document.getElementById('fReps').value) || 3;

  if (id) {
    const idx = routine.findIndex(e => e.id === id);
    if (idx !== -1) {
      routine[idx] = { ...routine[idx], name, notes, mode, prepSeconds, workSeconds, restSeconds, targetSets, targetReps };
    }
  } else {
    routine.push({
      id: 'ex_' + Date.now(),
      name, notes, mode, prepSeconds, workSeconds, restSeconds, targetSets, targetReps
    });
  }

  saveRoutine();
  closeExerciseModal();
  renderEditorList();
  renderQueuePreview();
  loadCurrentExerciseUI();
}

function closeExerciseModal() {
  document.getElementById('exerciseModal').style.display = 'none';
}

// ============================================================================
// Settings & Private Mode
// ============================================================================
function applySettings() {
  const title = document.getElementById('appTitle');
  const stealthBtn = document.getElementById('stealthBtn');

  if (settings.discreet) {
    document.body.classList.add('theme-discreet');
    title.textContent = 'Mobility Tracker';
    stealthBtn.classList.add('active');
  } else {
    document.body.classList.remove('theme-discreet');
    title.textContent = 'Routine Tracker';
    stealthBtn.classList.remove('active');
  }

  const soundBtn = document.getElementById('soundBtn');
  if (settings.sound) {
    soundBtn.classList.add('active');
    soundBtn.textContent = '🔊 Sound';
  } else {
    soundBtn.classList.remove('active');
    soundBtn.textContent = '🔇 Mute';
  }
}

function toggleDiscreet() {
  settings.discreet = !settings.discreet;
  saveSettings();
  applySettings();
}

function toggleSound() {
  settings.sound = !settings.sound;
  saveSettings();
  applySettings();
  if (settings.sound) {
    ensureAudioReady();
    soundCountdownTick();
  }
}

// ============================================================================
// UI Navigation & Listeners
// ============================================================================
function initUI() {
  const tabs = document.querySelectorAll('.segment-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById(`tab-${target}`).classList.add('active');

      if (target === 'stats') renderStatsTab();
      if (target === 'routine') renderEditorList();
    });
  });
}

function initEventListeners() {
  document.getElementById('stealthBtn').addEventListener('click', toggleDiscreet);
  document.getElementById('soundBtn').addEventListener('click', toggleSound);

  // Main session buttons
  document.getElementById('mainActionBtn').addEventListener('click', toggleStartPause);
  document.getElementById('prevExBtn').addEventListener('click', moveToPrevExercise);
  document.getElementById('nextExBtn').addEventListener('click', moveToNextExercise);
  document.getElementById('resetCurrentExBtn').addEventListener('click', resetCurrentExercise);
  document.getElementById('finishWorkoutBtn').addEventListener('click', promptFinishWorkout);

  // Quick skip button
  document.getElementById('skipPhaseBtn').addEventListener('click', skipCurrentPhase);

  // Untimed buttons
  document.getElementById('untimedSetInc').addEventListener('click', () => {
    sessionState.untimedSetsDone++;
    document.getElementById('untimedSetCount').textContent = sessionState.untimedSetsDone;
  });
  document.getElementById('untimedSetDec').addEventListener('click', () => {
    if (sessionState.untimedSetsDone > 1) {
      sessionState.untimedSetsDone--;
      document.getElementById('untimedSetCount').textContent = sessionState.untimedSetsDone;
    }
  });
  document.getElementById('untimedRepInc').addEventListener('click', () => {
    sessionState.untimedRepsDone++;
    document.getElementById('untimedRepCount').textContent = sessionState.untimedRepsDone;
  });
  document.getElementById('untimedRepDec').addEventListener('click', () => {
    if (sessionState.untimedRepsDone > 1) {
      sessionState.untimedRepsDone--;
      document.getElementById('untimedRepCount').textContent = sessionState.untimedRepsDone;
    }
  });

  // Modal listeners
  document.getElementById('openAddExerciseModalBtn').addEventListener('click', openAddExerciseModal);
  document.getElementById('closeModalBtn').addEventListener('click', closeExerciseModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeExerciseModal);
  document.getElementById('exerciseForm').addEventListener('submit', handleSaveExercise);
  document.getElementById('modeTimed').addEventListener('change', () => toggleTimedFieldsVisibility(true));
  document.getElementById('modeUntimed').addEventListener('change', () => toggleTimedFieldsVisibility(false));

  // Reset defaults
  document.getElementById('resetDefaultsBtn').addEventListener('click', () => {
    if (confirm('Reset back to default routine?')) {
      routine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
      saveRoutine();
      sessionState.exIndex = 0;
      sessionState.currentSet = 1;
      sessionState.currentRep = 1;
      renderEditorList();
      renderQueuePreview();
      loadCurrentExerciseUI();
    }
  });

  // Export / Import
  document.getElementById('exportRoutineBtn').addEventListener('click', () => {
    const data = { routine, historyLogs, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `routine_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importRoutineInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (Array.isArray(data.routine)) routine = data.routine;
        if (Array.isArray(data.historyLogs)) historyLogs = data.historyLogs;
        saveRoutine();
        saveHistory();
        renderEditorList();
        renderQueuePreview();
        loadCurrentExerciseUI();
        renderWeeklyStreak();
        renderStatsTab();
        alert('Data imported!');
      } catch (err) {
        alert('Invalid data file.');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('dismissCelebrationBtn').addEventListener('click', () => {
    document.getElementById('completionModal').style.display = 'none';
    sessionState.exIndex = 0;
    sessionState.currentSet = 1;
    sessionState.currentRep = 1;
    sessionState.totalElapsedSeconds = 0;
    loadCurrentExerciseUI();
  });

  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('Clear all logged workouts?')) {
      historyLogs = [];
      saveHistory();
      renderWeeklyStreak();
      renderStatsTab();
    }
  });
}

// ============================================================================
// CALENDAR WITH NOTES (Weekly Goal Tab)
// ============================================================================
const STORAGE_KEY_NOTES = 'routine_tracker_calendar_notes_v1';

let calendarState = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(), // 0-indexed
  selectedDateKey: null
};

function loadCalendarNotes() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_NOTES);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return {};
}

function saveCalendarNotes(notes) {
  localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(notes));
}

function getDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function initCalendar() {
  // Month navigation
  document.getElementById('calPrevMonthBtn').addEventListener('click', () => {
    calendarState.viewMonth--;
    if (calendarState.viewMonth < 0) {
      calendarState.viewMonth = 11;
      calendarState.viewYear--;
    }
    renderCalendar();
  });

  document.getElementById('calNextMonthBtn').addEventListener('click', () => {
    calendarState.viewMonth++;
    if (calendarState.viewMonth > 11) {
      calendarState.viewMonth = 0;
      calendarState.viewYear++;
    }
    renderCalendar();
  });

  // Calendar accordion toggle
  const calCard = document.getElementById('calendarAccordionCard');
  const calToggle = document.getElementById('toggleCalendarBtn');
  if (calCard && calToggle) {
    calToggle.addEventListener('click', () => {
      calCard.classList.toggle('expanded');
    });
  }

  // Note panel buttons
  document.getElementById('closeCalNoteBtn').addEventListener('click', closeNotePanel);

  document.getElementById('saveCalNoteBtn').addEventListener('click', () => {
    if (!calendarState.selectedDateKey) return;
    const notes = loadCalendarNotes();
    const text = document.getElementById('calNoteInput').value.trim();
    if (text) {
      notes[calendarState.selectedDateKey] = text;
    } else {
      delete notes[calendarState.selectedDateKey];
    }
    saveCalendarNotes(notes);
    renderCalendar();
    closeNotePanel();
  });

  document.getElementById('deleteCalNoteBtn').addEventListener('click', () => {
    if (!calendarState.selectedDateKey) return;
    const notes = loadCalendarNotes();
    delete notes[calendarState.selectedDateKey];
    saveCalendarNotes(notes);
    document.getElementById('calNoteInput').value = '';
    renderCalendar();
    closeNotePanel();
  });

  renderCalendar();
}

function closeNotePanel() {
  document.getElementById('calNotePanel').style.display = 'none';
  calendarState.selectedDateKey = null;
}

function renderCalendar() {
  const year = calendarState.viewYear;
  const month = calendarState.viewMonth;

  // Update month title
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('calMonthTitle').textContent = `${monthNames[month]} ${year}`;

  // Get first day of month (0=Sun, adjust to Mon start)
  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = (firstDay + 6) % 7; // Convert Sun=0 to Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Get workout dates and notes
  const completedDays = new Set(historyLogs.map(item => {
    const d = new Date(item.date);
    return getDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }));
  const notes = loadCalendarNotes();

  const today = new Date();
  const todayKey = getDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  const grid = document.getElementById('calGridCells');
  grid.innerHTML = '';

  // Empty cells before the 1st
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    grid.appendChild(empty);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = getDateKey(year, month, day);
    const isToday = dateKey === todayKey;
    const isWorkout = completedDays.has(dateKey);
    const hasNote = !!notes[dateKey];

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (isToday) cell.classList.add('today');
    if (isWorkout) cell.classList.add('workout');
    if (hasNote) cell.classList.add('has-note');

    cell.innerHTML = `
      <span class="cal-day-num">${day}</span>
      ${isWorkout ? '<span class="cal-workout-dot">✓</span>' : ''}
      ${hasNote ? '<span class="cal-note-dot">📝</span>' : ''}
    `;

    cell.addEventListener('click', () => openNotePanel(year, month, day));
    grid.appendChild(cell);
  }

  // Update calendar summary text
  const summaryEl = document.getElementById('calendarSummaryText');
  if (summaryEl) {
    const noteCount = Object.keys(notes).filter(k => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length;
    const workoutCount = [...completedDays].filter(k => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length;
    summaryEl.textContent = `${monthNames[month]} ${year} • ${workoutCount} workout(s) • ${noteCount} note(s)`;
  }
}

function openNotePanel(year, month, day) {
  const dateKey = getDateKey(year, month, day);
  calendarState.selectedDateKey = dateKey;

  const date = new Date(year, month, day);
  const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
  document.getElementById('selectedDateTitle').textContent = date.toLocaleDateString([], options);

  // Check if workout logged
  const completedDays = new Set(historyLogs.map(item => {
    const d = new Date(item.date);
    return getDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }));
  const isWorkout = completedDays.has(dateKey);
  document.getElementById('selectedDateStatus').textContent = isWorkout ? '✅ Workout Logged' : 'No Workout Logged';

  // Load existing note
  const notes = loadCalendarNotes();
  document.getElementById('calNoteInput').value = notes[dateKey] || '';

  document.getElementById('calNotePanel').style.display = 'block';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
