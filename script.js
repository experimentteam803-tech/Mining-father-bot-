import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, push, get, query, orderByChild, equalTo, remove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const WebApp = window.Telegram.WebApp;
WebApp.ready();

// Safely get Telegram user data
let telegramUser = null;
try {
    telegramUser = WebApp.initDataUnsafe.user;
    if (!telegramUser || !telegramUser.id) {
        WebApp.showAlert("Could not verify your Telegram account. Please try restarting the app through Telegram.", () => WebApp.close());
        throw new Error("Missing Telegram User ID");
    }
} catch (error) {
    console.error("Critical Error:", error);
    WebApp.showAlert("A critical error occurred while loading your profile. Please restart the app.", () => WebApp.close());
    throw new Error("App halted due to missing user data.");
}

const TELEGRAM_USER_ID = telegramUser.id.toString();
const USER_NAME = telegramUser.first_name + (telegramUser.last_name ? ' ' + telegramUser.last_name : '');
document.getElementById('username').innerText = USER_NAME;
document.getElementById('refLink').innerText = `https://t.me/MiningFather1Bot?start=${TELEGRAM_USER_ID}`;

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCcgl31JqffVd8bW8G23UurFhxH8IFlEfM",
    authDomain: "mining-bot-276d0.firebaseapp.com",
    projectId: "mining-bot-276d0",
    storageBucket: "mining-bot-276d0.firebasestorage.app",
    messagingSenderId: "263688973305",
    appId: "1:263688973305:web:bf3eab880a03dde0ec2b28",
    measurementId: "G-2FWW2SVSLR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Database References
const DB_NODE_PATH = 'users/' + TELEGRAM_USER_ID;
const ADMIN_SETTINGS_REF = ref(database, 'admin_settings');
const TASKS_REF = ref(database, 'tasks');
const WITHDRAWALS_REF = ref(database, 'withdrawals');
const GLOBAL_POPUP_REF = ref(database, 'global_popup');
const WITHDRAWAL_SETTINGS_REF = ref(database, 'withdrawal_settings');
const WATCH_ADS_REF = ref(database, 'admin_settings/watch_ads');

// Global State Variables
window.coins = 0;
window.dailyMinedTimestamp = 0;
window.miningEndTime = 0;
window.adsWatched = 0;
window.adsWatchedTimestamp = 0;
window.watchAdsState = {}; 
window.dbRef = ref(database, DB_NODE_PATH);
let miningInterval = null;
let remainingTimeInterval = null;
let incrementCounter = 0;
let COINS_PER_INCREMENT = 0.1;
const MINING_RATE_MS = 450; 
const INTL_COINS_PER_INCREMENT = 0.125; 
const ONE_HOUR_MS = 3600000;
const TWO_HOURS_MS = 7200000;
const MIN_WITHDRAWAL_COINS = 30000; 
const MIN_INTL_WITHDRAWAL_COINS = 100000;
const REFERRAL_BONUS = 500;
window.ADS_REQUIRED = 10;
window.AD_REWARD_COINS = 5;
const WITHDRAWAL_ADS_REQUIRED = 10;
let withdrawalAdsWatched = 0;
let isInitialLoadComplete = false;
let withdrawalSettings = { upi: {}, paypal: {}, crypto: {} };
let userCountry = ''; 
let watchAdConfig = {};

// Referral System Variables
window.referrerId = null; 
let commissionToAward = 0; 
const COMMISSION_RATE = 0.05;
let referralDataLoaded = false; 

// DOM Elements
const mineButton = document.getElementById('mineBtn');
const watchAdBtn = document.getElementById('watchAdBtn');
const adStatusDisplay = document.getElementById('adStatus');
const mineCircle = document.getElementById('mineCircle');
const miningEffectContainer = document.getElementById('miningEffectContainer');
const countdownDisplay = document.getElementById('miningCountdown');
const withdrawalModal = document.getElementById('withdrawalModal');
const submitWithdrawalBtn = document.getElementById('submitWithdrawalBtn');
const taskDetailModal = document.getElementById('taskDetailModal');
const closeTaskModalBtn = document.getElementById('closeTaskModal');
let allTasks = {};
const paypalModal = document.getElementById('paypalModal');
const cryptoModal = document.getElementById('cryptoModal');
const submitPaypalBtn = document.getElementById('submitPaypalBtn');
const submitCryptoBtn = document.getElementById('submitCryptoBtn');
const preMiningSound = document.getElementById('preMiningSound');
const miningSound = document.getElementById('miningSound');
const clickSound = document.getElementById('clickSound');
const successSound = document.getElementById('successSound');

let hasInteracted = false;

function primeAudio() { if (!hasInteracted) { hasInteracted = true;[preMiningSound, miningSound, clickSound, successSound].forEach(s => s.play().then(() => s.pause()).catch(() => {})); } }
function playClickSound() { if (hasInteracted) { clickSound.currentTime = 0; clickSound.play().catch(e => {}); } }
function playSuccessSound() { if (hasInteracted) { successSound.currentTime = 0; successSound.play().catch(e => {}); } }
function stopAllMiningSounds() { preMiningSound.pause(); preMiningSound.currentTime = 0; miningSound.pause(); miningSound.currentTime = 0; }
function updateSoundState() {
    if (!hasInteracted) return;
    const miningIsActive = window.miningEndTime > Date.now();
    const isReadyToMine = window.canMineAgain() && window.adsWatched >= window.ADS_REQUIRED;
    const homeSectionIsVisible = document.getElementById('home').style.display !== 'none';
    if (miningIsActive) { if (miningSound.paused) { preMiningSound.pause(); preMiningSound.currentTime = 0; miningSound.play().catch(e => {}); } }
    else if (homeSectionIsVisible && isReadyToMine) { if (preMiningSound.paused) { miningSound.pause(); miningSound.currentTime = 0; preMiningSound.play().catch(e => {}); } }
    else { stopAllMiningSounds(); }
}

async function getUserCountry() {
    const storedCountry = localStorage.getItem('userCountryCode');
    if (storedCountry) {
        userCountry = storedCountry; 
        return storedCountry;
    }
    try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        const countryCode = data.country_code;
        if (countryCode) { localStorage.setItem('userCountryCode', countryCode); userCountry = countryCode; return countryCode; }
        return null;
    } catch (error) { console.error("Could not fetch user country:", error); return null; }
}

function loadUserData() {
    onValue(window.dbRef, async (snapshot) => {
        let data = snapshot.val();
        if (!data) {
            console.log("New user detected. Creating profile...");
            const newUserCountry = await getUserCountry();
            const initialData = {
                coins: 0, dailyMinedTimestamp: 0, miningEndTime: 0, adsWatched: 0,
                adsWatchedTimestamp: 0, upiId: '', telegramId: TELEGRAM_USER_ID,
                userName: USER_NAME, lastActive: Date.now(), joinDate: Date.now(),
                country: newUserCountry || 'N/A',
                watchAdsState: {}
            };
            
            const referrerId = WebApp.initDataUnsafe.start_param;
            if (referrerId && referrerId !== TELEGRAM_USER_ID) {
                initialData.referredBy = referrerId;
                const referrerRef = ref(database, 'users/' + referrerId);
                get(referrerRef).then((r) => {
                    if (r.exists()) {
                        const d = r.val(), u = {};
                        u.coins = (d.coins || 0) + REFERRAL_BONUS;
                        u.referralCount = (d.referralCount || 0) + 1;
                        u[`referredUsers/${TELEGRAM_USER_ID}`] = { userName: USER_NAME, joinDate: Date.now() };
                        const h = push(ref(database, `users/${referrerId}/coin_history`));
                        u[`coin_history/${h.key}`] = { reason: `Referral Bonus for ${USER_NAME}`, amount: REFERRAL_BONUS, timestamp: Date.now() };
                        update(referrerRef, u);
                    }
                }).catch(e => console.error("Error awarding referral bonus:", e));
            }

            try {
                await set(window.dbRef, initialData);
                console.log("User profile created.");
                updateGlobalState(initialData); 
            } catch (error) { WebApp.showAlert("Failed to create your profile. " + error.message); }
            return;
        }
        
        userCountry = data.country;
        COINS_PER_INCREMENT = data.country && data.country !== 'IN' ? INTL_COINS_PER_INCREMENT : 0.1;
        
        const updates = { lastActive: Date.now(), userName: USER_NAME };
        const fetchedCountry = await getUserCountry();
        if (fetchedCountry && data.country !== fetchedCountry) updates.country = fetchedCountry;

        if (!isInitialLoadComplete) {
            isInitialLoadComplete = true; 
            const lastSeen = data.lastActive || 0, sStart = data.dailyMinedTimestamp || 0, sEnd = data.miningEndTime || 0, now = Date.now();
            if (sStart > 0 && sEnd > lastSeen) {
                const dur = Math.min(now, sEnd) - Math.max(lastSeen, sStart);
                if (dur > 0) {
                    const offlineCoins = Math.floor(dur / MINING_RATE_MS) * (data.country && data.country !== 'IN' ? INTL_COINS_PER_INCREMENT : 0.1);
                    if (offlineCoins > 0) {
                        data.coins += offlineCoins;
                        updates.coins = data.coins; 
                        const h = push(ref(database, `users/${TELEGRAM_USER_ID}/coin_history`));
                        updates[`coin_history/${h.key}`] = { 
                            reason: 'Offline Mining', 
                            amount: parseFloat(offlineCoins.toFixed(3)), 
                            timestamp: Date.now() 
                        };
                    }
                }
            }
        }
        
        updateGlobalState(data); 

        if (Object.keys(updates).length > 2 || (updates.country && data.country !== updates.country) || updates.coins) {
             update(window.dbRef, updates);
        }

        processDataForStateUpdate();

    }, (error) => { console.error("Firebase Read Error:", error); WebApp.showAlert("Failed to load user data."); });
}
function listenForNotifications() {
    const nRef = ref(database, `users/${TELEGRAM_USER_ID}/notifications`);
    onValue(nRef, (s) => { if (s.exists()) { WebApp.showPopup({ message: s.val().message }); remove(nRef); } });
}
function listenForAdminPopups() {
    const uRef = ref(database, `users/${TELEGRAM_USER_ID}/popup`);
    onValue(uRef, (s) => { if (s.exists()) { const d = s.val(); WebApp.showPopup({ title: d.title, message: d.message, buttons: [{ type: 'ok', text: 'Close' }] }); remove(uRef); } });
    onValue(GLOBAL_POPUP_REF, (s) => { if (s.exists()) { const d = s.val(); const t = localStorage.getItem('lastGlobalPopupTimestamp') || 0; if (d.timestamp > t) { WebApp.showPopup({ title: d.title, message: d.message, buttons: [{ type: 'ok', text: 'Got it!' }] }); localStorage.setItem('lastGlobalPopupTimestamp', d.timestamp); } } });
}
function loadAdminSettings() {
    onValue(ADMIN_SETTINGS_REF, (s) => { if (s.exists()) { const d = s.val(); window.ADS_REQUIRED = d.miningAds?.required || 10; window.AD_REWARD_COINS = d.adTasks?.reward || 5; updateMiningButtonState(); updateAdStatus(); } }, e => console.error("Firebase Read Error (Admin):", e));
}
function loadWithdrawalLockSettings() {
    onValue(WITHDRAWAL_SETTINGS_REF, s => { if (s.exists()) { withdrawalSettings = s.val(); } }, e => console.error("Firebase Read Error (Withdrawal):", e));
}
function updateGlobalState(data) {
    window.coins = data.coins || 0;
    window.dailyMinedTimestamp = data.dailyMinedTimestamp || 0;
    window.miningEndTime = data.miningEndTime || 0;
    window.adsWatched = data.adsWatched || 0;
    window.adsWatchedTimestamp = data.adsWatchedTimestamp || 0;
    window.upiId = data.upiId || '';
    window.referrerId = data.referredBy || null;
    window.watchAdsState = data.watchAdsState || {};
}
function processDataForStateUpdate() {
    if (window.miningEndTime > Date.now()) resumeMiningSession(); else stopMining(false);
    if (window.dailyMinedTimestamp !== 0 && window.canMineAgain()) {
        updateDatabase({ dailyMinedTimestamp: 0, adsWatched: 0, adsWatchedTimestamp: 0 });
        window.dailyMinedTimestamp = 0; window.adsWatched = 0; window.adsWatchedTimestamp = 0;
    }
    
    updateCoinDisplays();
    updateMiningButtonState();
}
window.updateDatabase = (u) => { update(window.dbRef, u).catch(e => console.error("DB Write Error:", e)); };
function updateCoinDisplays() {
    const v = (window.coins / 3000).toFixed(2), s = Math.floor(window.coins).toLocaleString();
    document.getElementById('coinCount').innerText = s;
    document.getElementById('walletCoins').innerText = s;
    document.getElementById('walletValue').innerText = v;
}
function formatTime(ms) {
    if (ms < 0) ms = 0;
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `${h}:${m}:${s}`;
}
window.canMineAgain = () => Date.now() - window.dailyMinedTimestamp >= TWO_HOURS_MS;
window.watchAd = () => {
    if (window.adsWatched >= window.ADS_REQUIRED) { WebApp.showAlert(window.canMineAgain() ? "Ready to mine." : "Ads complete. Wait for reset."); return; }
    if (window.miningEndTime > Date.now() || (!window.canMineAgain() && window.dailyMinedTimestamp !== 0)) { WebApp.showAlert("Cannot watch ads now."); return; }
    watchAdBtn.disabled = true; watchAdBtn.innerText = '🎥 Loading...';
    try {
        if (typeof window.Adsgram === 'undefined') { throw new Error("Adsgram SDK not loaded"); }
        const AdController = window.Adsgram.init({ blockId: "18940" });
        AdController.show().then(() => {
            const newCount = window.adsWatched + 1;
            const u = { coins: window.coins + window.AD_REWARD_COINS, adsWatched: newCount, adsWatchedTimestamp: Date.now() };
            const h = push(ref(database, `users/${TELEGRAM_USER_ID}/coin_history`));
            u[`coin_history/${h.key}`] = { reason: 'Ad Reward (Mining)', amount: window.AD_REWARD_COINS, timestamp: Date.now() };
            update(window.dbRef, u).then(() => {
                window.coins += window.AD_REWARD_COINS;
                window.adsWatched = newCount;
                updateCoinDisplays(); updateAdStatus();
                if (newCount < window.ADS_REQUIRED) WebApp.showPopup({ message: `+${window.AD_REWARD_COINS} Coins! ${window.ADS_REQUIRED - newCount} more needed.` });
                else WebApp.showPopup({ message: `Congratulations! You can now start mining!` });
                playSuccessSound();
            });
        }).catch(() => WebApp.showAlert("Ad was skipped. No reward.")).finally(() => { if (window.adsWatched < window.ADS_REQUIRED) { watchAdBtn.disabled = false; watchAdBtn.innerText = '🎬 Watch Ad'; } });
    } catch (e) { WebApp.showAlert("Ad service failed."); watchAdBtn.disabled = false; watchAdBtn.innerText = '🎬 Watch Ad'; }
};
function updateAdStatus() {
    const inCooldown = !window.canMineAgain() && window.dailyMinedTimestamp !== 0;
    if (window.adsWatched >= window.ADS_REQUIRED) {
        adStatusDisplay.innerText = `Ads Complete! Mining unlocked.`;
        watchAdBtn.disabled = true; watchAdBtn.innerText = '✅ Ads Complete';
        if (inCooldown) adStatusDisplay.innerHTML = `Ads/Mining Reset in: ${formatTime((window.dailyMinedTimestamp + TWO_HOURS_MS) - Date.now())}`;
    } else {
        adStatusDisplay.innerText = `Ads Watched: ${window.adsWatched}/${window.ADS_REQUIRED}`;
        watchAdBtn.disabled = inCooldown; watchAdBtn.innerText = '🎬 Watch Ad';
    }
}
function startMiningAnimation() { for (let i = 0; i < 2; i++) { const a = document.createElement('div'); a.className = 'mining-animation'; a.style.left = (Math.random() * 50 + 25) + '%'; a.style.top = (Math.random() * 40 + 30) + '%'; mineCircle.appendChild(a); setTimeout(() => a.remove(), 1500); } }
function showMiningIncrement() { const e = document.createElement('span'); e.className = 'mining-increment'; e.innerText = `+${COINS_PER_INCREMENT.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`; e.style.left = `${Math.random()*50+25}%`; e.style.top = `${Math.random()*40+40}%`; miningEffectContainer.appendChild(e); setTimeout(() => e.remove(), 1200); }
window.stopMining = (doUpdate = true) => {
    clearInterval(miningInterval); clearInterval(remainingTimeInterval);
    if(miningEffectContainer) miningEffectContainer.innerHTML = '';
    miningInterval = null; remainingTimeInterval = null;
    mineCircle.classList.remove('mining-active-glow');
    if (window.miningEndTime !== 0) { window.miningEndTime = 0; if (doUpdate) window.updateDatabase({ miningEndTime: 0, coins: window.coins }); }
    if (doUpdate) updateMiningButtonState();
    updateSoundState();
}
function updateCountdown() {
    const rem = window.miningEndTime - Date.now();
    if (rem <= 0) { stopMining(); return; }
    mineCircle.classList.add('mining-active-glow');
    mineButton.disabled = true; mineButton.innerText = '⛏️ Mining Active'; mineButton.style.background = '#808080';
    countdownDisplay.innerText = 'Time Left: ' + formatTime(rem);
}
function resumeMiningSession() {
    if (miningInterval || window.miningEndTime - Date.now() <= 0) return;
    updateSoundState();
    clearInterval(miningInterval); clearInterval(remainingTimeInterval);
    incrementCounter = 0;
    miningInterval = setInterval(() => {
        window.coins += COINS_PER_INCREMENT;
        if (window.referrerId) commissionToAward += COINS_PER_INCREMENT * COMMISSION_RATE;
        incrementCounter++;
        if (incrementCounter % 20 === 0) {
            window.updateDatabase({ coins: window.coins });
            if (commissionToAward > 0 && window.referrerId) {
                const ref = ref(database, 'users/' + window.referrerId), comm = commissionToAward; commissionToAward = 0;
                get(ref).then(s => {
                    if (s.exists()) {
                        const d = s.val(), u = {}; u.coins = (d.coins || 0) + comm;
                        const h = push(ref(database, `users/${window.referrerId}/coin_history`));
                        u[`coin_history/${h.key}`] = { reason: `5% commission from ${USER_NAME}`, amount: parseFloat(comm.toFixed(3)), timestamp: Date.now() };
                        u[`referredUsers/${TELEGRAM_USER_ID}/commissionEarned`] = (d.referredUsers?.[TELEGRAM_USER_ID]?.commissionEarned || 0) + comm;
                        update(ref, u);
                    }
                }).catch(e => { console.error("Commission error:", e); commissionToAward += comm; });
            }
        }
        startMiningAnimation(); showMiningIncrement(); updateCoinDisplays();
    }, MINING_RATE_MS);
    remainingTimeInterval = setInterval(updateCountdown, 1000);
    updateCountdown();
}
window.startDailyMining = () => {
  if (window.adsWatched < window.ADS_REQUIRED) { WebApp.showAlert(`Watch ${window.ADS_REQUIRED} ads to start.`); return; }
  if (miningInterval || !window.canMineAgain()) { startCooldownCountdown(); return; }
  const now = Date.now(); window.dailyMinedTimestamp = now; window.miningEndTime = now + ONE_HOUR_MS;
  window.updateDatabase({ dailyMinedTimestamp: now, miningEndTime: now + ONE_HOUR_MS });
  resumeMiningSession();
}
function startCooldownCountdown() {
    stopAllMiningSounds(); clearInterval(remainingTimeInterval);
    if(miningEffectContainer) miningEffectContainer.innerHTML = '';
    remainingTimeInterval = setInterval(() => {
        const rem = (window.dailyMinedTimestamp + TWO_HOURS_MS) - Date.now();
        if (rem <= 0) {
            clearInterval(remainingTimeInterval); remainingTimeInterval = null;
            if (window.dailyMinedTimestamp !== 0) window.updateDatabase({ dailyMinedTimestamp: 0, adsWatched: 0, adsWatchedTimestamp: 0 });
            updateMiningButtonState(); return;
        }
        mineButton.disabled = true; mineButton.innerText = '⏳ Cooldown'; mineButton.style.background = '#808080';
        countdownDisplay.innerText = 'Next Mine in: ' + formatTime(rem);
        updateAdStatus();
    }, 1000);
}
function updateMiningButtonState() {
    const miningActive = window.miningEndTime > Date.now();
    const adsComplete = window.adsWatched >= window.ADS_REQUIRED;
    updateAdStatus();
    if (miningActive) updateCountdown();
    else if (!window.canMineAgain() && window.dailyMinedTimestamp !== 0) { stopAllMiningSounds(); startCooldownCountdown(); }
    else if (adsComplete) {
        if(miningEffectContainer) miningEffectContainer.innerHTML = '';
        mineCircle.classList.remove('mining-active-glow');
        mineButton.disabled = false; mineButton.innerText = '🪙 Start Mining'; mineButton.style.background = 'var(--primary-glow)';
        countdownDisplay.innerText = 'Click to start 1 hour session';
    } else {
        stopAllMiningSounds(); if(miningEffectContainer) miningEffectContainer.innerHTML = '';
        mineCircle.classList.remove('mining-active-glow');
        mineButton.disabled = true; mineButton.innerText = `🔒 Watch Ads to Unlock`; mineButton.style.background = '#808080';
        countdownDisplay.innerText = `Watch ${window.ADS_REQUIRED - window.adsWatched} more ads to start.`;
    }
    updateSoundState();
}

async function loadReferralData() {
    const table = document.getElementById('referral-list-table'), totalEl = document.getElementById('total-referrals'), commEl = document.getElementById('total-commission');
    table.innerHTML = `<tr><td colspan="3" style="text-align:center; color: #888;">Loading...</td></tr>`;
    try {
        const s = await get(window.dbRef); if (!s.exists()) { table.innerHTML = `<tr><td colspan="3" style="text-align:center; color: #888;">No data.</td></tr>`; return; }
        const d = s.val(), users = d.referredUsers || {}, ids = Object.keys(users);
        if (ids.length === 0) { table.innerHTML = `<tr><td colspan="3" style="text-align:center; color: #888;">No referrals yet.</td></tr>`; totalEl.innerText = '0'; commEl.innerText = '0'; return; }
        table.innerHTML = ''; let totalComm = 0;
        ids.forEach(id => {
            const r = users[id], j = new Date(r.joinDate).toLocaleDateString(), c = r.commissionEarned || 0; totalComm += c;
            table.innerHTML += `<tr><td>${r.userName||'Unknown'}</td><td>${j}</td><td>${parseFloat(c.toFixed(3))}</td></tr>`;
        });
        totalEl.innerText = ids.length; commEl.innerText = parseFloat(totalComm.toFixed(3));
    } catch (e) { console.error("Referral load error:", e); table.innerHTML = `<tr><td colspan="3" style="text-align:center; color: #f44336;">Failed to load.</td></tr>`; }
}
window.toggleReferralTracking = () => {
    const details = document.getElementById('referral-tracking-details');
    if (details.style.display === 'none') {
        details.style.display = 'block';
        if (!referralDataLoaded) { loadReferralData(); referralDataLoaded = true; }
    } else { details.style.display = 'none'; }
}

function updateAllWatchAdButtons() {
    if(!document.getElementById('watch-ads-container')) return;
    Object.keys(watchAdConfig).forEach(adId => {
        const ad = watchAdConfig[adId]; if (!ad.active) return;
        const adState = window.watchAdsState[adId] || { watched: 0, timestamp: 0 };
        const btn = document.getElementById(`btn_${adId}`);
        const details = document.getElementById(`details_${adId}`);
        if (!btn || !details) return;
        const cooldownMs = ad.cooldownHours * 3600000;
        const timeSince = Date.now() - adState.timestamp;
        if (adState.watched >= ad.limit && timeSince < cooldownMs) {
            btn.disabled = true; btn.innerText = "Waiting";
            details.innerText = `Next in: ${formatTime(cooldownMs - timeSince)}`;
        } else {
            let current = (adState.watched >= ad.limit && timeSince >= cooldownMs) ? 0 : adState.watched;
            btn.disabled = false; btn.innerText = "Watch";
            details.innerText = `Limit: ${current}/${ad.limit} / ${ad.cooldownHours} Hours`;
        }
    });
}

window.watchConfiguredAd = (adId) => {
    const ad = watchAdConfig[adId];
    let adState = window.watchAdsState[adId] || { watched: 0, timestamp: 0 };
    if (adState.watched >= ad.limit && Date.now() - adState.timestamp < ad.cooldownHours * 3600000) { WebApp.showAlert("Limit reached. Wait for cooldown."); return; }
    if (adState.watched >= ad.limit && Date.now() - adState.timestamp >= ad.cooldownHours * 3600000) adState = { watched: 0, timestamp: 0 };
    const btn = document.getElementById(`btn_${adId}`);
    btn.disabled = true; btn.innerText = 'Loading...';
    const adPromise = ad.provider === 'monetag' ? show_9969043('pop') : window.Adsgram.init({ blockId: ad.blockId }).show();
    adPromise.then(() => {
        const newCount = (adState.watched || 0) + 1;
        const newTimestamp = newCount >= ad.limit ? Date.now() : (adState.timestamp || 0);
        const updates = { coins: window.coins + ad.reward, [`watchAdsState/${adId}`]: { watched: newCount, timestamp: newTimestamp } };
        const historyRef = push(ref(database, `users/${TELEGRAM_USER_ID}/coin_history`));
        updates[`coin_history/${historyRef.key}`] = { reason: `Ad Reward: ${ad.title}`, amount: ad.reward, timestamp: Date.now() };
        update(window.dbRef, updates).then(() => {
            WebApp.showPopup({ message: `+${ad.reward} Coins!` });
            playSuccessSound();
            window.coins += ad.reward;
            window.watchAdsState[adId] = { watched: newCount, timestamp: newTimestamp };
            updateCoinDisplays();
            updateAllWatchAdButtons();
        });
    }).catch(() => WebApp.showAlert("Ad was skipped or failed. No reward was given.")).finally(() => { if ((window.watchAdsState[adId]?.watched || 0) < ad.limit) { btn.disabled = false; btn.innerText = 'Watch'; } });
}

async function loadWatchableAds() {
    const container = document.getElementById('watch-ads-container');
    container.innerHTML = '<p style="text-align: center; color: #777;">Loading ad tasks...</p>';
    try {
        const snapshot = await get(WATCH_ADS_REF);
        if (!snapshot.exists()) { container.innerHTML = '<p style="text-align: center; color: #888;">No ad tasks available right now.</p>'; return; }
        watchAdConfig = snapshot.val(); container.innerHTML = '';
        Object.keys(watchAdConfig).forEach(adId => {
            const ad = watchAdConfig[adId];
            if (ad.active) {
                const card = document.createElement('div');
                card.className = 'watch-ad-card';
                if (ad.title.toLowerCase().includes('gold')) card.classList.add('gold');
                const adState = window.watchAdsState[adId] || { watched: 0, timestamp: 0 };
                card.innerHTML = `<div class="watch-ad-card-info"><div class="watch-ad-card-title"><span>${ad.icon || '📺'}</span> ${ad.title} (+${ad.reward})</div><div class="watch-ad-card-details" id="details_${adId}">Limit: ${adState.watched}/${ad.limit} / ${ad.cooldownHours} Hours</div></div><button class="watch-ad-card-btn" id="btn_${adId}" onclick="watchConfiguredAd('${adId}')">Watch</button>`;
                container.appendChild(card);
            }
        });
        updateAllWatchAdButtons();
        if (typeof window.watchAdTimerInterval === 'undefined') window.watchAdTimerInterval = setInterval(updateAllWatchAdButtons, 1000);
    } catch (e) { console.error("Error loading watchable ads:", e); container.innerHTML = '<p style="text-align: center; color: #f44336;">Could not load ad tasks.</p>'; }
}

window.showWithdrawalModal = () => {
    if (withdrawalSettings.upi.locked) { WebApp.showPopup({ title: 'UPI Unavailable', message: withdrawalSettings.upi.message || 'UPI withdrawals temporarily disabled.' }); return; }
    withdrawalModal.style.display = "block"; document.getElementById('upiAmount').value = ''; document.getElementById('upiId').value = window.upiId; document.getElementById('inrValueText').innerText = ''; submitWithdrawalBtn.disabled = true;
}
window.showPaypalModal = () => {
    if (withdrawalSettings.paypal.locked) { WebApp.showPopup({ title: 'PayPal Unavailable', message: withdrawalSettings.paypal.message || 'PayPal withdrawals are temporarily disabled.' }); return; }
    paypalModal.style.display = "block"; document.getElementById('paypalAmount').value = ''; document.getElementById('paypalEmail').value = ''; submitPaypalBtn.disabled = true;
}
window.showCryptoModal = () => {
    if (withdrawalSettings.crypto.locked) { WebApp.showPopup({ title: 'Crypto Unavailable', message: withdrawalSettings.crypto.message || 'Crypto withdrawals are temporarily disabled.' }); return; }
    cryptoModal.style.display = "block"; document.getElementById('cryptoAmount').value = ''; document.getElementById('cryptoAddress').value = ''; submitCryptoBtn.disabled = true;
}

window.closeWithdrawalModal = () => { withdrawalModal.style.display = "none"; }
window.closePaypalModal = () => { paypalModal.style.display = "none"; }
window.closeCryptoModal = () => { cryptoModal.style.display = "none"; }

window.checkWithdrawalEligibility = () => {
    const amount = Number(document.getElementById('upiAmount').value);
    const inrText = document.getElementById('inrValueText');
    inrText.style.color = 'var(--primary-glow)';
    inrText.innerText = amount > 0 ? `≈ ₹${(amount / 3000).toFixed(2)}` : '';
    if (amount >= MIN_WITHDRAWAL_COINS && amount <= window.coins) {
        submitWithdrawalBtn.disabled = false;
    } else {
        submitWithdrawalBtn.disabled = true;
        if (amount > 0 && amount < MIN_WITHDRAWAL_COINS) { inrText.innerText = `Error: Min ${MIN_WITHDRAWAL_COINS} Coins.`; inrText.style.color = '#f44336'; }
        else if (amount > window.coins) { inrText.innerText = `Error: Insufficient balance.`; inrText.style.color = '#f44336'; }
    }
}

window.submitWithdrawal = async () => {
    const amount = Number(document.getElementById('upiAmount').value);
    const upiId = document.getElementById('upiId').value.trim();
    if (amount < MIN_WITHDRAWAL_COINS || amount > window.coins) { WebApp.showAlert(`Invalid amount.`); return; }
    if (upiId.length < 5 || !upiId.includes('@')) { WebApp.showAlert("Invalid UPI ID."); return; }
    if (userCountry === 'IN') {
        document.getElementById('withdrawalAdsModal').style.display = 'block';
        withdrawalAdsWatched = 0;
        document.getElementById('withdrawalAdStatus').innerText = `Ads Watched: ${withdrawalAdsWatched}/${WITHDRAWAL_ADS_REQUIRED}`;
    } else { await processWithdrawalRequest(); }
};

async function processWithdrawalRequest() {
    try {
        const amount = Number(document.getElementById('upiAmount').value);
        const upiId = document.getElementById('upiId').value.trim();
        const s = await get(ref(database, `users/${TELEGRAM_USER_ID}`)), d = s.val();
        if (userCountry !== 'IN' && (!d.completedTasks || Object.keys(d.completedTasks).length === 0)) { WebApp.showAlert("Complete at least one task to withdraw."); return; }
        await update(window.dbRef, { coins: window.coins - amount, upiId: upiId });
        await push(WITHDRAWALS_REF, { userId: TELEGRAM_USER_ID, userName: USER_NAME, amount: amount, upiId: upiId, type: 'UPI', timestamp: Date.now(), status: 'Pending' });
        playSuccessSound(); closeWithdrawalModal();
        document.getElementById('withdrawalAdsModal').style.display = 'none';
        WebApp.showAlert(`Withdrawal of ${amount} Coins submitted. Processing in 24 hours.`);
    } catch (e) { console.error("Withdrawal Error:", e); WebApp.showAlert("An error occurred."); }
}

window.watchWithdrawalAd = () => {
    const btn = document.getElementById('watchWithdrawalAdBtn');
    btn.disabled = true; btn.innerText = '🎥 Loading...';
    try {
        if (typeof window.Adsgram === 'undefined') throw new Error("Adsgram SDK not loaded");
        const AdController = window.Adsgram.init({ blockId: "int-18888" });
        AdController.show().then(() => {
            withdrawalAdsWatched++;
            document.getElementById('withdrawalAdStatus').innerText = `Ads Watched: ${withdrawalAdsWatched}/${WITHDRAWAL_ADS_REQUIRED}`;
            if (withdrawalAdsWatched >= WITHDRAWAL_ADS_REQUIRED) processWithdrawalRequest();
        }).catch(() => WebApp.showAlert("Ad was skipped. Please watch all ads to continue.")).finally(() => { if (withdrawalAdsWatched < WITHDRAWAL_ADS_REQUIRED) { btn.disabled = false; btn.innerText = '🎬 Watch Ad'; } });
    } catch (e) { WebApp.showAlert("Ad service failed. Try again."); btn.disabled = false; btn.innerText = '🎬 Watch Ad'; }
}

window.checkPaypalEligibility = () => { const a = Number(document.getElementById('paypalAmount').value); submitPaypalBtn.disabled = !(a >= MIN_INTL_WITHDRAWAL_COINS && a <= window.coins); }
window.checkCryptoEligibility = () => { const a = Number(document.getElementById('cryptoAmount').value); submitCryptoBtn.disabled = !(a >= MIN_INTL_WITHDRAWAL_COINS && a <= window.coins); }

window.submitPaypalWithdrawal = async () => {
    const amount = Number(document.getElementById('paypalAmount').value), email = document.getElementById('paypalEmail').value.trim();
    if (amount < MIN_INTL_WITHDRAWAL_COINS || amount > window.coins || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { WebApp.showAlert("Invalid details."); return; }
    try {
        const s = await get(ref(database, `users/${TELEGRAM_USER_ID}`)), d = s.val();
        if (!d.completedTasks || Object.keys(d.completedTasks).length === 0) { WebApp.showAlert("Complete at least one task to withdraw."); return; }
        await update(window.dbRef, { coins: window.coins - amount });
        await push(WITHDRAWALS_REF, { userId: TELEGRAM_USER_ID, userName: USER_NAME, amount: amount, paypalEmail: email, type: 'PayPal', timestamp: Date.now(), status: 'Pending' });
        playSuccessSound(); closePaypalModal(); WebApp.showAlert(`Withdrawal of ${amount} Coins to PayPal submitted.`);
    } catch (e) { console.error("PayPal Error:", e); WebApp.showAlert("An error occurred."); }
};
window.submitCryptoWithdrawal = async () => {
    const amount = Number(document.getElementById('cryptoAmount').value), address = document.getElementById('cryptoAddress').value.trim();
    if (amount < MIN_INTL_WITHDRAWAL_COINS || amount > window.coins || address.length < 26) { WebApp.showAlert("Invalid details."); return; }
    try {
        const s = await get(ref(database, `users/${TELEGRAM_USER_ID}`)), d = s.val();
        if (!d.completedTasks || Object.keys(d.completedTasks).length === 0) { WebApp.showAlert("Complete at least one task to withdraw."); return; }
        await update(window.dbRef, { coins: window.coins - amount });
        await push(WITHDRAWALS_REF, { userId: TELEGRAM_USER_ID, userName: USER_NAME, amount: amount, cryptoAddress: address, network: 'USDT_TRC20', type: 'Crypto', timestamp: Date.now(), status: 'Pending' });
        playSuccessSound(); closeCryptoModal(); WebApp.showAlert(`Withdrawal of ${amount} Coins to Crypto Wallet submitted.`);
    } catch (e) { console.error("Crypto Error:", e); WebApp.showAlert("An error occurred."); }
};
window.onclick = function(e) {
    if (e.target == withdrawalModal) closeWithdrawalModal();
    if (e.target == taskDetailModal) closeTaskModal();
    if (e.target == paypalModal) closePaypalModal();
    if (e.target == cryptoModal) closeCryptoModal();
}
window.shareReferralLink = () => {
    const link = document.getElementById('refLink').innerText;
    const text = `💰 Join CoinMine and start earning! Use my referral link: ${link}. You get 500 bonus Coins, and I get a 5% lifetime commission on your mining!`;
    WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

document.addEventListener('DOMContentLoaded', () => {
    loadWithdrawalLockSettings();
    loadAdminSettings();
    loadUserData();
    loadLiveTasks();
    loadWithdrawalHistory();
    listenForNotifications();
    listenForAdminPopups();
    document.body.addEventListener('click', primeAudio, { once: true });
    document.body.addEventListener('click', e => { if (e.target.matches('button, .nav-btn, .msg-icon, .profile, .task-item, .close-btn, .task-nav-btn')) playClickSound(); });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { 
            const p = sessionStorage.getItem('awaitingVerificationPopup');
            if (p) { WebApp.showPopup({ title: 'Task in Progress', message: 'Welcome back! Please wait about a minute for the "Verify Task" button to become active, then click it to get your reward.' }); sessionStorage.removeItem('awaitingVerificationPopup'); }
            loadLiveTasks();
        }
    });
    document.getElementById('customerCareLink').addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard.writeText(TELEGRAM_USER_ID).then(() => { WebApp.showAlert('Your User ID has been copied! Redirecting to support.'); WebApp.openTelegramLink('https://t.me/MiningFatherhelp'); }).catch(() => { WebApp.showAlert('Could not copy ID.'); WebApp.openTelegramLink('https://t.me/MiningFatherhelp'); });
    });
});

window.showSection = (sectionId, button) => {
  if (window.watchAdTimerInterval) { clearInterval(window.watchAdTimerInterval); window.watchAdTimerInterval = undefined; }
  if (sectionId === 'referral') { const d = document.getElementById('referral-tracking-details'); if (d) d.style.display = 'none'; referralDataLoaded = false; }
  if (sectionId === 'watch') loadWatchableAds();
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  const mainElement = document.querySelector('main');
  mainElement.style.display = 'flex';
  document.getElementById(sectionId).style.display = 'block';
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');
  updateSoundState();
}

window.showTaskCategory = (category, button) => {
    document.getElementById('daily-tasks').style.display = 'none';
    document.getElementById('premium-tasks').style.display = 'none';
    document.getElementById(`${category}-tasks`).style.display = 'block';
    document.querySelectorAll('.task-nav-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
}

window.showProfile = () => WebApp.showAlert(`User Profile:\nName: ${USER_NAME}\nID: ${TELEGRAM_USER_ID}`);
window.showMsg = () => WebApp.showPopup({message: 'Welcome to CoinMine!'});

</script>
</body>
</html>
