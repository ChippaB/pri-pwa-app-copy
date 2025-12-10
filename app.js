// ===== SeeScan v8.4.0 - Google Sheet Part Number Map Integration =====
// v8.4.0: Migrated Part Number Map to Google Sheet PART_MAP tab with enhanced logging
// v8.3.8: Multi-Tablet Fix
// v8.3.4: Fix UNKNOWN Part Number Map errors
// v8.3.3: Update to Part Number Map + attempt to fix Serial Number drop-off bug
// v8.3.2: Added try/finally + safety timeout to prevent scanner lockup
// v8.3.1: Fixed duplicate digit-stripping bug in HIBC parsing, corrected endpoint URL
// v8.3.0: Fixed connectivity cascade failure with multiple tablets
// v8.2.4: Final offline fixes, battery status improvements
// v8.2.0: Added timestamps with relative time, DD/MM/YY format, wake-from-sleep connectivity fix

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbyZio2iE1piL2hczpUgDx26EBn0_NxAj5o9vlFG6a8JoRD9lDu-B7VOH903_ArWaF4t/exec'; 

const SHARED_SECRET = 'qk92X3vE7LrT8c59H1zUM4Bn0ySDFwGp';

let PART_NUMBER_MAP = {};

/**
 * Fetches the Part Number Map from the Google Sheet via the Apps Script doGet endpoint.
 * Returns a Promise that resolves once the map is successfully loaded.
 * Enhanced with detailed logging to help diagnose any loading issues.
 */
async function fetchPartNumberMap() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('🔄 Fetching Part Number Map from Google Sheet...');
      const res = await fetch(ENDPOINT + '?getMap=true', { 
        method: 'GET', 
        cache: 'no-cache' 
      });
      
      if (!res.ok) {
        console.error('❌ Server returned error status:', res.status, res.statusText);
        resolve(); // Resolve anyway to prevent app hang
        return;
      }
      
      const data = await res.json();
      
      if (data.status === 'OK' && data.part_map) {
        PART_NUMBER_MAP = data.part_map;
        const mapSize = Object.keys(PART_NUMBER_MAP).length;
        console.log(`✅ Part Number Map loaded successfully: ${mapSize} entries`);
        
        // Log first 3 entries for verification (helpful for debugging)
        if (mapSize > 0) {
          const sampleEntries = Object.entries(PART_NUMBER_MAP).slice(0, 3);
          console.log('📋 Sample entries:', sampleEntries);
        } else {
          console.warn('⚠️ Part Number Map is empty. Check PART_MAP sheet in Google Sheets.');
        }
        
        resolve(); // Map is ready!
      } else {
        console.error('❌ Failed to fetch part map from server. Response:', data);
        console.warn('⚠️ App will continue with empty map. GS1-128 barcodes may show as UNKNOWN.');
        resolve(); // Resolve anyway to prevent app hang
      }
    } catch (error) {
      console.error('❌ Network error during part map fetch:', error);
      console.warn('⚠️ App will continue with empty map. Check internet connection.');
      resolve(); // Resolve to prevent app hang
    }
  });
}

// ===== DATE/TIME FORMATTING HELPERS =====
function formatDateMMDDYY(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function formatTimestamp(date) {
  const d = new Date(date);
  const dateStr = formatDateMMDDYY(d);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${dateStr} ${timeStr}`;
}

function getRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec} secs ago`;
  if (diffMin === 1) return '1 min ago';
  if (diffMin < 60) return `${diffMin} mins ago`;
  if (diffHr === 1) return '1 hour ago';
  if (diffHr < 24) return `${diffHr} hours ago`;
  return formatDateMMDDYY(then);
}

// ===== HELPERS =====
function unlockAudioOnFirstTap() {
  initAudio();
  document.body.removeEventListener('touchstart', unlockAudioOnFirstTap);
}

// ===== DOM Elements =====
const $ = s => document.querySelector(s);
const statusBox = $('#status'), lastSerial = $('#lastSerial'), lastPart = $('#lastPart');
const scanInput = $('#scan'), operatorInput = $('#operator'), stationSel = $('#station');
const queueInfo = $('#queueInfo'), clearBtn = $('#clearBtn');
const historyToggle = $('#historyToggle'), historyPanel = $('#historyPanel');
const lastScanStatus = $('#lastScanStatus');
const lastScanTime = $('#lastScanTime');
const lastScanRelative = $('#lastScanRelative');
const lockBtn = $('#lockBtn'), unlockBtn = $('#unlockBtn')
const correctionModal = $('#correctionModal');
const modalContext = $('#modalContext');
const correctionText = $('#correctionText');
const btnCancelCorrection = $('#cancelCorrection');
const btnSaveCorrection = $('#saveCorrection');
let currentEditItem = null;

// Audio
let audioContext;
function initAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playBeep(freq, type = 'sine') {
  try {
    initAudio();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.frequency.value = freq; osc.type = type;
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    osc.start(); osc.stop(audioContext.currentTime + 0.1);
  } catch (e) {}
}

function playSoundSuccess() { 
  playBeep(880, 'sine'); 
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#10b981';
  setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function playSoundDuplicate() { 
  playBeep(440, 'sine'); 
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#f59e0b';
  setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function playSoundError() { 
  playBeep(220, 'sawtooth'); 
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#ef4444';
  setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function show(msg, cls) {
  statusBox.innerHTML = msg; statusBox.className = 'status show ' + cls;
  setTimeout(() => statusBox.classList.remove('show'), 2500);
}

function savePrefs() { localStorage.setItem('operator', operatorInput.value.trim()); localStorage.setItem('station', stationSel.value); }
function loadPrefs() { operatorInput.value = localStorage.getItem('operator') || ''; stationSel.value = localStorage.getItem('station') || 'MAIN'; }

function parsePN_SN(s) {
  const raw = String(s).toUpperCase().trim();

  // GS1-128 FORMAT (Starts with 01)
  if (raw.startsWith('01')) {
      const prefix = raw.substring(0, 16);
      let part = PART_NUMBER_MAP[prefix];
      let remainder = raw.substring(16);
      let serial = '';

      if (remainder.startsWith('11') || remainder.startsWith('17') || remainder.startsWith('13')) {
        remainder = remainder.substring(8);
      }

      if (remainder.startsWith('21')) {
        serial = remainder.substring(2);
      } else {
        serial = remainder;
      }

      if (serial) {
          const pfrMatch = serial.match(/^(PFR[A-Z0-9]{3,10})/i); 
          if (pfrMatch) {
              const identifiedPartId = pfrMatch[1].toUpperCase();
              part = identifiedPartId; 
              serial = serial.substring(identifiedPartId.length); 
              if (!serial) {
                  serial = identifiedPartId; 
              } else {
                  serial = serial.replace(/^[^A-Z0-9]+/, ''); 
              }
              return { part, serial }; 
          }
      }
      
      return part ? { part, serial } : { part: 'UNKNOWN', serial };
  }
  
  // HIBC FORMAT (Contains /$+)
  if (raw.includes('/$+')) {
    const parts = raw.split('/$+');
    if (parts.length < 2) return { part:'', serial:'' };
    let p = parts[0], sNum = parts[1];
    
    if (p.startsWith('+B')) {
      p = p.substring(1); 
      if (p.startsWith('B')) p = p.substring(1); 
      if (sNum.startsWith('+')) sNum = sNum.substring(1);
    } else {
      if (sNum.startsWith('+')) sNum = sNum.substring(1);
    }

    if (sNum.endsWith('/')) {
      sNum = sNum.substring(0, sNum.length - 1);
    } else if (sNum.match(/\d$/)) {
      if (p !== 'P5556100') {
        sNum = sNum.substring(0, sNum.length - 1);
      }
    }

    if (p.startsWith('446') && p.length > 4 && (p.includes('PUL') || p.endsWith('1') || p.endsWith('0'))) {
        p = p.substring(3, p.length - 1);
    }

    return { part: p, serial: sNum };
  }

  return { part: '', serial: '' };
}

function cleanSerialClient(rawSerial) {
  if (!rawSerial) return "";
  let cleaned = rawSerial.toString();
  cleaned = cleaned.replace(/[^0-9]+$/, '');
  return cleaned.trim();
}

function checkLocalDuplicate(serial) {
  const h = getHistory();
  return h.some(item => item.serial === serial && item.status !== 'ERR' && item.status !== 'ERROR');
}

function getLastScanKey() { 
  const op = operatorInput.value.trim() || 'UNNAMED';
  const st = stationSel.value || 'MAIN';
  return `lastScan_${op}_${st}`; 
}

function saveLastScan(part, serial, status) {
  const key = getLastScanKey();
  const scanData = { part, serial, status, timestamp: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(scanData));
  updateLastScanDisplay(scanData);
}

function updateLastScanDisplay(data) {
  if (!data) {
    lastPart.textContent = '—';
    lastSerial.textContent = '—';
    lastScanStatus.textContent = '';
    if (lastScanTime) lastScanTime.textContent = '';
    if (lastScanRelative) lastScanRelative.textContent = '';
    return;
  }
  
  lastPart.textContent = data.part || '—';
  lastSerial.textContent = data.serial || '—';
  lastScanStatus.textContent = data.status || '';
  
  // Apply status styling
  if (data.status === 'OK') {
    lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
  } else if (data.status === 'DUPLICATE') {
    lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
  } else {
    lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
  }
  
  // Update timestamp displays
  if (data.timestamp) {
    if (lastScanTime) lastScanTime.textContent = formatTimestamp(data.timestamp);
    if (lastScanRelative) lastScanRelative.textContent = getRelativeTime(data.timestamp);
  }
}

function loadLastScan() {
  const key = getLastScanKey();
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const data = JSON.parse(stored);
      updateLastScanDisplay(data);
      return;
    } catch (e) {}
  }
  updateLastScanDisplay(null);
}

// Update relative time every 30 seconds
setInterval(() => {
  const key = getLastScanKey();
  const stored = localStorage.getItem(key);
  if (stored && lastScanRelative) {
    try {
      const data = JSON.parse(stored);
      if (data.timestamp) {
        lastScanRelative.textContent = getRelativeTime(data.timestamp);
      }
    } catch (e) {}
  }
}, 30000);

function renderQueue() {
  queueInfo.innerHTML = '';
}

function getHistoryKey() { return `history_${operatorInput.value.trim() || 'UNNAMED'}`; }

function getHistory() { 
  try { 
    let h = JSON.parse(localStorage.getItem(getHistoryKey()) || '[]');
    // Clear history if first item is from a different day
    if (h.length > 0 && new Date(h[0].timestamp).toDateString() !== new Date().toDateString()) {
      h = [];
      localStorage.setItem(getHistoryKey(), '[]');
    }
    return h;
  } catch { 
    return []; 
  } 
}

function addToHistory(item) {
  const key = getHistoryKey();
  let h = getHistory();
  h.unshift(item);
  if (h.length > 100) h = h.slice(0, 100);
  localStorage.setItem(key, JSON.stringify(h));
  renderHistory();
}

// XSS-safe history rendering with full DD/MM/YY timestamps
function renderHistory() {
  const h = getHistory();
  historyPanel.innerHTML = '';
  if (!h.length) { historyPanel.innerHTML = '<div style="padding:12px;color:#888">No scans today.</div>'; return; }

  h.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    let statusClass = (item.status || 'ERR').toLowerCase();
    if (statusClass.includes('dup')) statusClass = 'dup';
    else if (statusClass.includes('off') || statusClass.includes('err') || statusClass.includes('pend') || statusClass.includes('queue')) statusClass = 'queued';
    else statusClass = 'ok';
    
    let badgeStyle = '';
    if (statusClass === 'ok') badgeStyle = 'background:#d1fae5; color:#065f46;';
    if (statusClass === 'dup') badgeStyle = 'background:#fef3c7; color:#92400e;';
    if (statusClass === 'queued') badgeStyle = 'background:#dbeafe; color:#1e40af;';

    const partCol = document.createElement('div');
    partCol.className = 'scan-data-col';
    partCol.innerHTML = '<div class="data-label">Ref</div><div class="history-part-num"></div>';
    partCol.querySelector('.history-part-num').textContent = item.part;
    
    const serialCol = document.createElement('div');
    serialCol.className = 'scan-data-col';
    serialCol.innerHTML = '<div class="data-label">Serial</div><div class="history-serial-num"></div>';
    serialCol.querySelector('.history-serial-num').textContent = item.serial;
    
    const statusCol = document.createElement('div');
    statusCol.className = 'scan-data-col';
    statusCol.innerHTML = '<div class="data-label">Status</div><div class="history-status"></div><div class="history-time"></div>';
    const statusEl = statusCol.querySelector('.history-status');
    statusEl.textContent = item.status;
    statusEl.style.cssText = badgeStyle;
    statusCol.querySelector('.history-time').textContent = formatTimestamp(item.timestamp);
    
    const editBtn = document.createElement('button');
    editBtn.className = 'history-edit-btn';
    editBtn.textContent = '✎';
    editBtn.dataset.part = item.part;
    editBtn.dataset.serial = item.serial;
    
    div.appendChild(partCol);
    div.appendChild(serialCol);
    div.appendChild(statusCol);
    div.appendChild(editBtn);
    
    historyPanel.appendChild(div);
  });
}

// ===== CONNECTIVITY - SIMPLIFIED FOR MULTI-TABLET =====
// Trust navigator.onLine as primary indicator
// Only verify server on actual scan attempts
let isServerReachable = navigator.onLine;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_OFFLINE = 3;

function updateNetworkStatus(online) {
  const net = document.getElementById('netStatus');
  const warning = document.getElementById('offlineWarning');
  
  if (online) {
    consecutiveFailures = 0;
    isServerReachable = true;
    if (net) {
      net.textContent = 'ONLINE';
      net.style.background = '#10b981';
    }
    if (warning) warning.classList.remove('show');
  } else {
    if (net) {
      net.textContent = 'OFFLINE';
      net.style.background = '#ef4444';
    }
    if (warning) warning.classList.add('show');
  }
}

// Listen to browser online/offline events
window.addEventListener('online', () => {
  console.log('Browser reports online');
  updateNetworkStatus(true);
});

window.addEventListener('offline', () => {
  console.log('Browser reports offline');
  isServerReachable = false;
  updateNetworkStatus(false);
});

// Lightweight connectivity check - only used on wake and manual refresh
async function checkConnectivity() {
  // First check browser's online status
  if (!navigator.onLine) {
    return false;
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const res = await fetch(ENDPOINT + '?ping=1', { 
      method: 'GET', 
      cache: 'no-cache',
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    // Don't immediately mark offline - might just be slow
    return navigator.onLine; // Trust browser if server check fails
  }
}

// === Send Function with Retry ===
async function send(payload, retryCount = 0) {
  const MAX_RETRIES = 2;
  
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
      cache: 'no-cache',
      signal: AbortSignal.timeout(25000) // 25 second timeout
    });

    if (!res.ok) {
      if (retryCount < MAX_RETRIES) {
        console.log(`Server error, retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 1000));
        return send(payload, retryCount + 1);
      }
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_OFFLINE) {
        updateNetworkStatus(false);
      }
      return 'ERROR';
    }

    let data = {};
    const text = await res.text();
    try { 
      data = JSON.parse(text); 
    } catch(e) { 
      if (retryCount < MAX_RETRIES) {
        return send(payload, retryCount + 1);
      }
      return 'ERROR'; 
    }

    // Success - we're definitely online
    consecutiveFailures = 0;
    isServerReachable = true;
    updateNetworkStatus(true);

    return data.status || 'ERROR';

  } catch (e) {
    console.log(`Network error: ${e.message}, retry ${retryCount + 1}/${MAX_RETRIES}`);
    
    if (retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1500)); // Wait 1.5 seconds before retry
      return send(payload, retryCount + 1);
    }
    
    // Only mark offline after multiple consecutive failures
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_OFFLINE) {
      isServerReachable = false;
      updateNetworkStatus(false);
    }
    return 'OFFLINE';
  }
}

// Scan lock to prevent double-scanning
let isProcessing = false;
let processingTimeout = null;

function unlockScanner() {
  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }
  isProcessing = false;
  scanInput.disabled = false;
  scanInput.style.opacity = '1';
  scanInput.focus();
}

scanInput.addEventListener('keydown', async (ev) => {
  if (ev.key !== 'Enter') return;
  
  if (isProcessing) {
    playSoundError();
    return;
  }
  
  // Check browser online status first
  if (!navigator.onLine) {
    playSoundError();
    show('❌ NO INTERNET - Check WiFi', 'err');
    scanInput.value = '';
    return;
  }
  
  let raw = scanInput.value.trim(); 
  if (!raw) return;

  raw = raw.replace(/[\x00-\x1F\x7F]/g, ''); 

  if (raw.startsWith("'")) {
    raw = raw.substring(1);
  }
  
  const parsed = parsePN_SN(raw);
  const cleanedSerial = cleanSerialClient(parsed.serial);
  const cleanedPart = parsed.part;

  if (!cleanedSerial) { show('INVALID FORMAT', 'err'); playSoundError(); scanInput.value=''; return; }

  scanInput.value = '';
  clearBtn.style.display = 'none';
  
  // LOCK scanner
  isProcessing = true;
  scanInput.disabled = true;
  scanInput.style.opacity = '0.5';
  
  // SAFETY TIMEOUT: Auto-unlock after 35 seconds no matter what
  processingTimeout = setTimeout(() => {
    console.log('Safety timeout triggered - forcing unlock');
    show('⚠️ Timeout - Please retry scan', 'dup');
    playSoundError();
    unlockScanner();
  }, 35000);
  
  try {
    show('⏳ Sending...', 'queued');
    
    lastPart.textContent = cleanedPart || 'N/A';
    lastSerial.textContent = cleanedSerial;
    lastScanStatus.textContent = 'SENDING';
    lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;';
    if (lastScanTime) lastScanTime.textContent = 'Sending...';
    if (lastScanRelative) lastScanRelative.textContent = '';
    
    const payload = {
      secret: SHARED_SECRET,
      operator: operatorInput.value || 'UNNAMED',
      station: stationSel.value,
      raw_scan: raw,
      part_number: cleanedPart,
      serial_number: cleanedSerial,
      comment: $('#generalNote').value.trim()
    };

    const status = await send(payload);
    
    lastScanStatus.textContent = status;
    lastScanStatus.className = 'history-status';
    
    if (status === 'OK') {
      lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
      playSoundSuccess();
      show('✅ SAVED', 'ok');
    } else if (status === 'DUPLICATE') {
      lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
      playSoundDuplicate();
      show('⚠️ DUPLICATE', 'dup');
    } else if (status === 'OFFLINE') {
      lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
      lastScanStatus.textContent = 'OFFLINE';
      playSoundError();
      show('❌ CONNECTION LOST - Retrying failed', 'err');
    } else {
      lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
      lastScanStatus.textContent = 'FAILED';
      playSoundError();
      show('❌ FAILED - Try again', 'err');
    }

    // Save to history regardless of status
    const now = new Date();
    addToHistory({ part: cleanedPart, serial: cleanedSerial, status, timestamp: now });
    if (status === 'OK' || status === 'DUPLICATE') {
      saveLastScan(cleanedPart, cleanedSerial, status);
    }
    
  } catch (err) {
    console.error('Scan handler error:', err);
    show('❌ ERROR - Please retry', 'err');
    playSoundError();
  } finally {
    // ALWAYS unlock, no matter what happened
    unlockScanner();
  }
});

clearBtn.onclick = () => { scanInput.value=''; clearBtn.style.display='none'; scanInput.focus(); };
scanInput.oninput = () => clearBtn.style.display = scanInput.value ? 'flex' : 'none';

const clearNoteBtn = document.querySelector('#clearNoteBtn');
const generalNoteInput = $('#generalNote');

if (clearNoteBtn && generalNoteInput) {
  clearNoteBtn.onclick = () => {
    generalNoteInput.value = ''; 
    generalNoteInput.focus();
  };
}

// === BATCH COMMENT LOCK FUNCTIONALITY ===
function getBatchCommentKey() {
  const op = operatorInput.value.trim() || 'UNNAMED';
  const st = stationSel.value || 'MAIN';
  return `batchComment_${op}_${st}`;
}

function getBatchLockKey() {
  const op = operatorInput.value.trim() || 'UNNAMED';
  const st = stationSel.value || 'MAIN';
  return `batchLocked_${op}_${st}`;
}

function loadBatchComment() {
  const key = getBatchCommentKey();
  const lockKey = getBatchLockKey();
  const isLocked = localStorage.getItem(lockKey) === 'true';
  
  if (isLocked) {
    const savedComment = localStorage.getItem(key) || '';
    generalNoteInput.value = savedComment;
    updateBatchLockUI(true);
  } else {
    updateBatchLockUI(false);
  }
}

function updateBatchLockUI(locked) {
  const lockBatchBtn = document.getElementById('lockBatchBtn');
  
  if (locked) {
    generalNoteInput.disabled = true;
    generalNoteInput.style.background = '#f0f0f0';
    if (lockBatchBtn) {
      lockBatchBtn.textContent = '🔓 Unlock Comment';
      lockBatchBtn.style.background = '#f59e0b';
    }
  } else {
    generalNoteInput.disabled = false;
    generalNoteInput.style.background = '';
    if (lockBatchBtn) {
      lockBatchBtn.textContent = '🔒 Lock Comment';
      lockBatchBtn.style.background = '#10b981';
    }
  }
}

const lockBatchBtn = document.getElementById('lockBatchBtn');
if (lockBatchBtn) {
  lockBatchBtn.addEventListener('click', () => {
    const lockKey = getBatchLockKey();
    const commentKey = getBatchCommentKey();
    const currentlyLocked = localStorage.getItem(lockKey) === 'true';
    
    if (currentlyLocked) {
      localStorage.setItem(lockKey, 'false');
      updateBatchLockUI(false);
      show('🔓 Comment Unlocked', 'ok');
    } else {
      const comment = generalNoteInput.value.trim();
      localStorage.setItem(commentKey, comment);
      localStorage.setItem(lockKey, 'true');
      updateBatchLockUI(true);
      show('🔒 Comment Locked', 'ok');
    }
    playSoundSuccess();
  });
}

historyToggle.onclick = () => {
  historyPanel.classList.toggle('expanded');
  historyToggle.textContent = historyPanel.classList.contains('expanded') ? '📋 Hide History' : '📋 View Scan History';
  if (historyPanel.classList.contains('expanded')) renderHistory();
};

operatorInput.onchange = () => { savePrefs(); loadLastScan(); loadBatchComment(); renderHistory(); };
stationSel.onchange = () => { savePrefs(); loadLastScan(); loadBatchComment(); };

// REMOVED: Aggressive 30-second connectivity polling that caused cascade failures
// Now we only check on wake-from-sleep and trust navigator.onLine

// Check connectivity when tablet wakes from sleep
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    const net = document.getElementById('netStatus');
    if (net) {
      net.textContent = 'CHECKING...';
      net.style.background = '#6b7280';
    }
    
    // Quick check - trust browser first
    if (!navigator.onLine) {
      updateNetworkStatus(false);
      return;
    }
    
    // If browser says online, do a quick server check
    const online = await checkConnectivity();
    updateNetworkStatus(online);
    
    if (wakeLock !== null) {
      requestWakeLock();
    }
  }
});

// Initial status based on browser
updateNetworkStatus(navigator.onLine);

let isLocked = localStorage.getItem('isLocked') === 'true';

function updateLock() {
  const lockBtnEl = document.getElementById('lockBtn');
  const unlockBtnEl = document.getElementById('unlockBtn');
  
  if (!lockBtnEl || !unlockBtnEl) return;
  
  operatorInput.disabled = isLocked;
  stationSel.disabled = isLocked;
  
  if (isLocked) {
    lockBtnEl.style.display = 'none';
    unlockBtnEl.style.display = 'inline-flex';
  } else {
    lockBtnEl.style.display = 'inline-flex';
    unlockBtnEl.style.display = 'none';
  }
}

function attachLockHandlers() {
  const lockBtnElement = document.getElementById('lockBtn');
  const unlockBtnElement = document.getElementById('unlockBtn');
  
  if (!lockBtnElement || !unlockBtnElement) return;
  
  lockBtnElement.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    
    const opValue = operatorInput.value;
    if (!opValue || opValue.trim() === '') {
      show('❌ Select Operator First!', 'err');
      playSoundError();
      return;
    }
    
    isLocked = true;
    localStorage.setItem('isLocked', 'true');
    updateLock();
    show('🔒 Locked!', 'ok');
    playSoundSuccess();
  });
  
  unlockBtnElement.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    
    if (confirm('Unlock to change operator/station?')) {
      isLocked = false;
      localStorage.setItem('isLocked', 'false');
      updateLock();
      show('🔓 Unlocked', 'ok');
      playSoundSuccess();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachLockHandlers);
} else {
  attachLockHandlers();
}

// === HISTORY NOTE LOGIC ===
historyPanel.addEventListener('click', (e) => {
  if (e.target.classList.contains('history-edit-btn')) {
    const part = e.target.getAttribute('data-part');
    const serial = e.target.getAttribute('data-serial');
    
    currentEditItem = { part, serial };
    modalContext.textContent = `Attaching note to: ${part} / ${serial}`;
    correctionText.value = '';
    correctionModal.style.display = 'flex';
    correctionText.focus();
  }
});

btnCancelCorrection.onclick = () => {
  correctionModal.style.display = 'none';
  currentEditItem = null;
};

btnSaveCorrection.onclick = async () => {
  if (!currentEditItem || !correctionText.value.trim()) return;

  const noteContent = correctionText.value.trim();
  const originalBtnText = btnSaveCorrection.textContent;
  btnSaveCorrection.textContent = 'Saving...';
  btnSaveCorrection.disabled = true;

  const payload = {
    secret: SHARED_SECRET,
    action: 'CORRECTION',
    part_number: currentEditItem.part,
    serial_number: currentEditItem.serial,
    note: noteContent
  };

  const status = await send(payload);

  if (status === 'OK') {
    show('Note Attached', 'ok');
    correctionModal.style.display = 'none';
  } else {
    show('Error Saving Note', 'err');
  }

  btnSaveCorrection.textContent = originalBtnText;
  btnSaveCorrection.disabled = false;
};

let commentTapCount = 0;
$('#generalNote').addEventListener('click', () => {
  commentTapCount++;
  if (commentTapCount === 2) {
    $('#generalNote').value = '';
    $('#generalNote').focus();
    show('Comment Cleared', 'ok');
    playSoundSuccess();
    commentTapCount = 0;
  }
  setTimeout(() => commentTapCount = 0, 500);
});

// Init
// We wrap the init sequence in an async function to wait for the map to load.
async function initApp() {
  // Load local preferences/data first
  loadPrefs();
  loadBatchComment();  
  loadLastScan();
  renderQueue(); 
  updateLock();
  
  // CRITICAL: Await the map fetch before doing anything else that relies on the map.
  await fetchPartNumberMap(); 
  
  // You can now safely assume PART_NUMBER_MAP is loaded (or empty with a log message)
  console.log('✅ Application Initialized. Map is ready.');
  console.log(`📊 Part Number Map Status: ${Object.keys(PART_NUMBER_MAP).length} entries loaded`);
}

document.body.addEventListener('touchstart', unlockAudioOnFirstTap);
scanInput.focus();

// === BATTERY STATUS API ===
function updateBatteryInfo(battery) {
  const batteryEl = document.getElementById('batteryStatus');
  if (!batteryEl) return;

  const percentage = Math.round(battery.level * 100);
  const chargingIcon = battery.charging ? '⚡' : '🔋';
  
  batteryEl.textContent = `${chargingIcon} ${percentage}%`;
  
  if (percentage < 20 && !battery.charging) {
    batteryEl.style.background = '#ef4444';
  } else if (battery.charging) {
    batteryEl.style.background = '#10b981';
  } else {
    batteryEl.style.background = '#6b7280';
  }
}

async function startBatteryMonitoring() {
  const batteryEl = document.getElementById('batteryStatus');
  
  if ('getBattery' in navigator) {
    try {
      const battery = await navigator.getBattery();
      updateBatteryInfo(battery);
      battery.addEventListener('levelchange', () => updateBatteryInfo(battery));
      battery.addEventListener('chargingchange', () => updateBatteryInfo(battery));
    } catch (error) {
      if (batteryEl) batteryEl.textContent = '🔋 N/A';
    }
  } else {
    if (batteryEl) batteryEl.textContent = '🔋 N/A';
  }
}

startBatteryMonitoring();

// SERVICE WORKER REGISTRATION
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// WAKE LOCK
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {}
}
requestWakeLock();

// SCREEN DIMMER
let dimTimer;
let isDimmed = false;

function simpleDim() {
  if (!isDimmed) {
    const overlay = document.getElementById('dimOverlay');
    if (overlay) overlay.style.opacity = '0.85';
    isDimmed = true;
  }
}

function simpleBrighten() {
  if (isDimmed) {
    const overlay = document.getElementById('dimOverlay');
    if (overlay) overlay.style.opacity = '0';
    isDimmed = false;
  }
  resetDimTimer();
}

function resetDimTimer() {
  clearTimeout(dimTimer);
  dimTimer = setTimeout(simpleDim, 60000);
}

['mousedown', 'touchstart', 'keypress'].forEach(event => {
  document.addEventListener(event, simpleBrighten, true);
});

window.addEventListener('click', simpleBrighten);
window.addEventListener('keydown', simpleBrighten);
window.addEventListener('touchstart', simpleBrighten);

// === INITIALIZATION ===
resetDimTimer();

// Call the new async initializer function at the end of your file
initApp();