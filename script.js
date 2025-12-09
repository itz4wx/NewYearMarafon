(function () {
    'use strict';

    // --- Security Utilities ---
    const SECURITY = {
        salt: 'HO-HO-HO-SECURE-SALT-2025',
        hash: (str) => {
            let hash = 0;
            if (str.length === 0) return hash;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return Math.abs(hash).toString(16);
        },
        save: (dataObj) => {
            try {
                const json = JSON.stringify(dataObj);
                const signature = SECURITY.hash(json + SECURITY.salt);
                const packageObj = { d: json, s: signature };
                return btoa(JSON.stringify(packageObj));
            } catch (e) {
                console.error("Save error", e);
                return null;
            }
        },
        load: (encodedStr) => {
            try {
                const decoded = atob(encodedStr);
                const packageObj = JSON.parse(decoded);
                if (!packageObj.d || !packageObj.s) return null;
                const checkSig = SECURITY.hash(packageObj.d + SECURITY.salt);
                if (checkSig !== packageObj.s) {
                    console.warn("Save file tampering detected!");
                    return null;
                }
                return JSON.parse(packageObj.d);
            } catch (e) {
                console.error("Load error", e);
                return null;
            }
        }
    };

    // --- Game Config ---
    const CONFIG = {
        starfall: {
            duration: 60,
            baseWinScore: 50,
            winScoreStep: 2,
            baseCooldown: 5 * 60 * 1000,
            cooldownStep: 10 * 1000, // +10 sec per level
            baseReward: 10,
            levelRewardStep: 2,
            baseSpeed: 200, // Pixels per second (was 5 per frame)
            speedLevelFactor: 20,
            baseParasiteChance: 0.2,
            parasiteChanceStep: 0.05
        },

        roulette: {
            cooldown: 24 * 60 * 60 * 1000,
            spinDuration: 6000,
            rewards: [
                { id: 'snow10', name: '10 Снежинок', type: 'currency', val: 10, weight: 400, img: 'zima.png', sell: 0 },
                { id: 'snow500', name: '500 Снежинок', type: 'currency', val: 500, weight: 50, img: 'zima.png', sell: 0 },
                { id: 'snow1000', name: '1000 Снежинок', type: 'currency', val: 1000, weight: 10, img: 'zima.png', sell: 0 },
                { id: 'spin', name: 'Доп. Прокрут', type: 'extra_spin', val: 1, weight: 100, img: 'perekrut.png', sell: 50 },
                { id: 'kaka', name: 'Какашка', type: 'junk', val: 0, weight: 300, img: 'kaka.png', sell: 0 },
                { id: 'boost', name: 'Супер-Усиление', type: 'buff', val: 1, weight: 50, img: 'star.png', sell: 200 },
                { id: 'cookie1', name: '1 Снежинка', type: 'currency', val: 1, weight: 80, img: 'zima.png', sell: 0 }, // Changed from Cookie
                { id: 'tg25', name: '25 TG Stars', type: 'special', val: 25, weight: 5, img: 'star.png', sell: 1000 },
                { id: 'cup_hint', name: 'Подсказка в стаканчиках', type: 'buff_cup_hint', val: 1, weight: 1, img: 'pods.png', sell: 300 },
                // Random fillers
                { id: 'snow_rnd', name: 'Случайные Снежинки', type: 'currency', val: 0, weight: 20, img: 'zima.png', sell: 0 }
            ]
        },
        cups: {
            baseCooldown: 5 * 60 * 1000, // 5 min
            cooldownPerLevel: 10 * 1000, // +10s starting lvl 3
            baseReward1: 15, // 1/3
            baseReward2: 30, // 2/3
            baseReward3: 80, // 3/3
            rewardGrowth: 10 // +10 per level
        }
    };

    // --- Secure Storage ---
    // Hides balance and critical data behind a closure with checksum validation
    const SecureStore = (() => {
        let _balance = 0;
        let _salt = SECURITY.salt;
        let _checksum = SECURITY.hash("0" + _salt);

        const validate = () => {
            if (SECURITY.hash(_balance + _salt) !== _checksum) {
                console.warn("Security Breach Detected: Balance Integrity Fail");
                _balance = 0; // Reset on tampering
                _checksum = SECURITY.hash(_balance + _salt);
                return false;
            }
            return true;
        };

        const updateChecksum = () => {
            _checksum = SECURITY.hash(_balance + _salt);
        };

        return {
            getBalance: () => {
                validate();
                return _balance;
            },
            addBalance: (amount) => {
                if (!validate()) return 0;
                _balance += amount;
                updateChecksum();
                return _balance;
            },
            setBalance: (amount) => {
                _balance = amount;
                updateChecksum();
            },
            // Helper for save/load
            serialize: () => _balance,
        };
    })();

    const STATE = {
        // balance removed, use SecureStore
        cookies: 0,
        inventory: [],
        games: {
            starfall: {
                lastPlayed: 0,
                level: 1,
                buff: false // Super boost active?
            },
            cups: {
                lastPlayed: 0,
                level: 1,
                hints: 0,
                hintActive: false
            },

            roulette: {
                lastPlayed: 0,
                nextFreeSpin: 0,
                extraSpins: 0
            }
        },
        // Router state helper
        currentHash: ''
    };

    let sessionGameStartTime = 0;
    let isGameRunning = false;
    let lastTime = 0; // For Delta Time

    // --- Sound Manager ---
    const soundManager = {
        playlist: ['muz1.mp3', 'muz2.mp3', 'muz3.mp3', 'muz4.mp3', 'muz5.mp3', 'muz6.mp3', 'muz7.mp3'],
        bgm: null,
        isMuted: false,
        recentTracks: [], // History queue to prevent repeats
        userInteracted: false,

        init: () => {
            // Force sound ON. Ignore text execution or saved state.
            soundManager.isMuted = false;
            localStorage.setItem('isMuted', 'false');

            // Click Sound Setup
            const handleInteraction = () => {
                if (!soundManager.userInteracted) {
                    soundManager.userInteracted = true;
                    soundManager.playPlaylist();
                }
            };

            document.addEventListener('click', (e) => {
                handleInteraction();
                // Play click for buttons or interactables
                const target = e.target.closest('button, .card-status, .game-card, .btn-nice, .btn-main');
                if (target) {
                    soundManager.playClick();
                }
            });

            document.addEventListener('touchstart', handleInteraction, { once: true });
        },

        playClick: () => {
            // Always play
            const audio = new Audio('knopka.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => { });
        },

        // Toggle mute removed.
        // updateMuteIcon removed.

        playPlaylist: () => {
            // Always play if not already playing
            if (soundManager.bgm && !soundManager.bgm.paused) return;

            let nextIndex;
            let attempts = 0;
            // Try to find a track not in the last 3 played
            do {
                nextIndex = Math.floor(Math.random() * soundManager.playlist.length);
                attempts++;
            } while (soundManager.recentTracks.includes(nextIndex) && attempts < 20);

            // Update history
            soundManager.recentTracks.push(nextIndex);
            if (soundManager.recentTracks.length > 3) {
                soundManager.recentTracks.shift();
            }

            const src = soundManager.playlist[nextIndex];

            if (soundManager.bgm) {
                soundManager.bgm.pause();
                soundManager.bgm.src = "";
            }

            soundManager.bgm = new Audio(src);
            soundManager.bgm.volume = 0.3;
            soundManager.bgm.play().catch(e => {
                console.log("Autoplay blocked, waiting for interaction", e);
            });

            soundManager.bgm.onended = () => {
                soundManager.playPlaylist(); // Next track
            };
        }
    };

    // --- Starfall Game Engine ---
    const starfallGame = {
        canvas: null,
        ctx: null,
        isActive: false,
        score: 0,
        targetScore: 50,
        timeLeft: 0,
        width: 0,
        height: 0,
        player: { x: 0, y: 0, w: 60, h: 60, targetX: 0, targetY: 0 },
        entities: [],
        imgStar: new Image(),
        imgSock: new Image(),
        imgKaka: new Image(),
        imgSopli: new Image(),
        imgVirus: new Image(),

        init: () => {
            starfallGame.canvas = document.getElementById('gameCanvas');
            starfallGame.ctx = starfallGame.canvas.getContext('2d');
            starfallGame.imgStar.src = 'star.png';
            starfallGame.imgSock.src = 'nosok.png';
            starfallGame.imgKaka.src = 'kaka.png';
            starfallGame.imgSopli.src = 'sopli.png';
            starfallGame.imgVirus.src = 'virus.png';

            const handleMove = (e) => {
                if (starfallGame.isActive) {
                    const rect = starfallGame.canvas.getBoundingClientRect();
                    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    if (e.touches) e.preventDefault();

                    let x = clientX - rect.left - starfallGame.player.w / 2;
                    let y = clientY - rect.top - starfallGame.player.h / 2;

                    // Clamp
                    x = Math.max(0, Math.min(x, starfallGame.width - starfallGame.player.w));
                    y = Math.max(0, Math.min(y, starfallGame.height - starfallGame.player.h));

                    starfallGame.player.targetX = x;
                    starfallGame.player.targetY = y;
                }
            };
            starfallGame.canvas.addEventListener('mousemove', handleMove);
            starfallGame.canvas.addEventListener('touchmove', handleMove, { passive: false });
            starfallGame.canvas.addEventListener('touchstart', handleMove, { passive: false });
        },

        resize: () => {
            const container = document.getElementById('screen-game');
            if (!container) return;
            starfallGame.width = Math.min(container.clientWidth - 40, 500);
            starfallGame.height = window.innerHeight * 0.7;
            if (starfallGame.canvas) {
                starfallGame.canvas.width = starfallGame.width;
                starfallGame.canvas.height = starfallGame.height;
            }
        },

        prepare: () => {
            app.switchScreen('screen-game');
            document.body.className = 'bg-starfall';
            if (!starfallGame.canvas) starfallGame.init();

            starfallGame.resize();
            starfallGame.player.w = 90; // Increased from 60
            starfallGame.player.h = 90; // Increased from 60

            // Difficulty Calculation
            const level = STATE.games.starfall.level;
            const isBuff = STATE.games.starfall.buff;

            if (isBuff) {
                // Buff mode: 3 mins, max 500 stars, easier
                starfallGame.timeLeft = 180;
                starfallGame.targetScore = 500;
            } else {
                starfallGame.timeLeft = CONFIG.starfall.duration;
                // Difficulty increase:
                // Lvl 1-3: +2 per level
                // Lvl 4: +5 (59)
                // Lvl 5: +9 (68)
                // Lvl 6+: +10 per level
                let target = CONFIG.starfall.baseWinScore;
                if (level > 1) target += Math.min(level - 1, 2) * CONFIG.starfall.winScoreStep; // Lvl 2, 3 add 2 each

                if (level >= 4) target += 5;
                if (level >= 5) target += 9;
                if (level >= 6) target += (level - 5) * 10;

                starfallGame.targetScore = target;
            }

            starfallGame.score = 0;
            starfallGame.isActive = false;
            starfallGame.entities = [];

            starfallGame.player.x = starfallGame.width / 2 - 30;
            starfallGame.player.y = starfallGame.height - 80;
            starfallGame.player.targetX = starfallGame.player.x;
            starfallGame.player.targetY = starfallGame.player.y;

            document.getElementById('game-level').innerText = level;
            document.getElementById('game-score').innerText = 0;
            document.getElementById('game-target').innerText = starfallGame.targetScore;
            document.getElementById('game-time').innerText = starfallGame.timeLeft;

            starfallGame.draw();
            starfallGame.startCountdown();
        },

        startCountdown: () => {
            const countdownEl = document.getElementById('game-countdown');
            let count = 3;
            const showNum = (num) => {
                countdownEl.innerText = num;
                countdownEl.classList.remove('active');
                void countdownEl.offsetWidth;
                countdownEl.classList.add('active');
            };
            showNum(3);
            const int = setInterval(() => {
                count--;
                if (count > 0) showNum(count);
                else {
                    clearInterval(int);
                    countdownEl.innerText = '';
                    countdownEl.classList.remove('active');
                    starfallGame.start();
                }
            }, 1000);
        },

        start: () => {
            starfallGame.isActive = true;
            isGameRunning = true;
            sessionGameStartTime = Date.now();
            lastTime = performance.now();
            requestAnimationFrame(starfallGame.loop);

            const timerInt = setInterval(() => {
                if (!starfallGame.isActive) { clearInterval(timerInt); return; }
                starfallGame.timeLeft--;
                document.getElementById('game-time').innerText = starfallGame.timeLeft;
                if (starfallGame.timeLeft <= 0) {
                    starfallGame.end(false);
                    clearInterval(timerInt);
                }
            }, 1000);
        },

        spawnEntity: () => {
            const size = 35; // Reduced from 55 (and orig 30) for better playability
            const rand = Math.random();
            const level = STATE.games.starfall.level;
            const isBuff = STATE.games.starfall.buff;

            // Dynamic Parasite Chance
            let parasiteChance = CONFIG.starfall.baseParasiteChance + (level - 1) * CONFIG.starfall.parasiteChanceStep;
            if (isBuff) parasiteChance = 0.05; // Very low in buff mode

            let type = 'star';
            if (rand < parasiteChance) {
                const pType = Math.random();
                if (pType < 0.33) type = 'kaka';
                else if (pType < 0.66) type = 'sopli';
                else type = 'virus';
            }

            // Speed
            let speed = CONFIG.starfall.baseSpeed + (level - 1) * CONFIG.starfall.speedLevelFactor;
            if (isBuff) speed *= 0.7; // Slower in buff mode

            starfallGame.entities.push({
                x: Math.random() * (starfallGame.width - size),
                y: -size,
                size: size,
                type: type,
                speed: speed
            });
        },

        update: (dt) => {
            const lerp = 0.2; // Lerp is frame independent enough for UI smoothing usually, or can be adjusted
            starfallGame.player.x += (starfallGame.player.targetX - starfallGame.player.x) * lerp;
            starfallGame.player.y += (starfallGame.player.targetY - starfallGame.player.y) * lerp;

            // Spawn Rate - make independent of framerate?
            // Currently spawn check is per frame. Ideally should be time based accumulator.
            // Simplified: dt is in seconds. 
            const isBuff = STATE.games.starfall.buff;
            let spawnRate = 3 + (STATE.games.starfall.level * 0.2); // Spawns per second
            if (isBuff) spawnRate = 6;

            // Random check adjusted for dt
            if (Math.random() < spawnRate * dt) starfallGame.spawnEntity();

            for (let i = starfallGame.entities.length - 1; i >= 0; i--) {
                let s = starfallGame.entities[i];
                s.y += s.speed * dt;

                const p = starfallGame.player;
                if (s.x < p.x + p.w && s.x + s.size > p.x && s.y < p.y + p.h && s.y + s.size > p.y) {
                    starfallGame.entities.splice(i, 1);
                    if (s.type === 'star') {
                        starfallGame.score++;
                    } else {
                        starfallGame.score = Math.max(0, starfallGame.score - 5);
                        const scoreEl = document.getElementById('game-score');
                        if (scoreEl) {
                            scoreEl.classList.add('score-damage');
                            setTimeout(() => scoreEl.classList.remove('score-damage'), 1000);
                        }
                    }
                    document.getElementById('game-score').innerText = starfallGame.score;

                    if (starfallGame.score >= starfallGame.targetScore) {
                        starfallGame.end(true);
                        return;
                    }
                } else if (s.y > starfallGame.height) {
                    starfallGame.entities.splice(i, 1);
                }
            }
        },

        draw: () => {
            starfallGame.ctx.clearRect(0, 0, starfallGame.width, starfallGame.height);

            // Only draw sock if game is active or we want to show it (not during countdown start)
            // User requested: "Bug fix: sock appears during countdown".
            // We only draw player if isGameRunning is true.
            if (isGameRunning && starfallGame.imgSock.complete) {
                starfallGame.ctx.drawImage(starfallGame.imgSock, starfallGame.player.x, starfallGame.player.y, starfallGame.player.w, starfallGame.player.h);
            }

            starfallGame.entities.forEach(s => {
                let img = starfallGame.imgStar;
                if (s.type === 'kaka') img = starfallGame.imgKaka;
                if (s.type === 'sopli') img = starfallGame.imgSopli;
                if (s.type === 'virus') img = starfallGame.imgVirus;

                if (img.complete) starfallGame.ctx.drawImage(img, s.x, s.y, s.size, s.size);
                else {
                    starfallGame.ctx.fillStyle = s.type === 'star' ? '#ffd700' : '#00ff00';
                    starfallGame.ctx.beginPath();
                    starfallGame.ctx.arc(s.x + s.size / 2, s.y + s.size / 2, s.size / 2, 0, Math.PI * 2);
                    starfallGame.ctx.fill();
                }
            });
        },

        loop: (timestamp) => {
            if (!starfallGame.isActive) return;
            const dt = (timestamp - lastTime) / 1000;
            lastTime = timestamp;

            starfallGame.update(dt);
            starfallGame.draw();
            requestAnimationFrame(starfallGame.loop);
        },

        end: (win) => {
            starfallGame.isActive = false;
            isGameRunning = false;
            // Clear buff if used
            if (STATE.games.starfall.buff) STATE.games.starfall.buff = false;
            app.finishGame('starfall', starfallGame.score, win);
        }
    };

    // --- Roulette Engine ---
    const rouletteGame = {
        isSpinning: false,
        items: [],
        idleInterval: null,
        idleOffset: 0,

        init: () => {
            const track = document.getElementById('roulette-track');
            track.innerHTML = '';
            // Create a long strip for scrolling
            const rewards = CONFIG.roulette.rewards;
            rouletteGame.items = [];

            // Generate pool based on weights for random fill, but for visual track we just repeat list
            // Create many items to simulate infinite scroll
            let lastRareIndex = -10; // Track last rare item position

            for (let i = 0; i < 100; i++) {
                let r = rewards[Math.floor(Math.random() * rewards.length)];

                // Check for clumping of rare items
                const isRare = (r.id === 'snow1000' || r.id === 'tg25' || r.id === 'boost' || r.id === 'cup_hint' || r.type === 'special' || r.type === 'buff');

                if (isRare) {
                    const distance = i - lastRareIndex;
                    // If too close (within 5 items), 80% chance to reroll to something common
                    if (distance < 5) {
                        if (Math.random() < 0.8) {
                            // Reroll to junk or small currency
                            const common = rewards.filter(x => x.type === 'junk' || x.val <= 10);
                            r = common[Math.floor(Math.random() * common.length)];
                        } else {
                            // Allowed to exist (20% chance)
                            lastRareIndex = i;
                        }
                    } else {
                        lastRareIndex = i;
                    }
                }

                rouletteGame.items.push(r);
                const el = document.createElement('div');
                el.className = 'roulette-item';

                // Special Highlights
                if (r.id === 'snow1000' || r.id === 'tg25' || r.id === 'boost' || r.id === 'cup_hint') {
                    el.classList.add('super-rare');
                    // Add gold border custom if needed, or rely on super-rare class
                } else if (r.type === 'special' || r.type === 'buff') {
                    el.classList.add('rare');
                }

                if (r.id === 'cup_hint') {
                    el.style.border = '2px solid #ffd700';
                    el.style.boxShadow = '0 0 15px #ffd700';
                }

                // Explicitly ensure snow10 never gets borders even if logic changes elsewhere
                if (r.id === 'snow10') {
                    el.classList.remove('rare', 'super-rare');
                    el.style.border = 'none';
                    el.style.boxShadow = 'none';
                }

                el.innerHTML = `<img src="${r.img}"><span>${r.name}</span>`;
                track.appendChild(el);
            }

            // Start in the middle to show content on left
            const itemWidth = window.innerWidth <= 480 ? 100 : 110;
            const startOffset = 20 * itemWidth; // Start at item 20
            track.style.transition = 'none';
            track.style.transform = `translateX(-${startOffset}px)`;
            track.dataset.currentOffset = startOffset;
            rouletteGame.idleOffset = startOffset;

            rouletteGame.startIdleSpin();
        },

        startIdleSpin: () => {
            if (rouletteGame.idleInterval) clearInterval(rouletteGame.idleInterval);
            rouletteGame.idleInterval = setInterval(() => {
                if (rouletteGame.isSpinning) return;
                const track = document.getElementById('roulette-track');
                if (!track) return;

                // Slow scroll
                rouletteGame.idleOffset += 0.5; // pixels per tick
                track.style.transform = `translateX(-${rouletteGame.idleOffset}px)`;

                // Reset to avoid running out
                const maxOffset = 80 * (window.innerWidth <= 480 ? 100 : 110);
                if (rouletteGame.idleOffset > maxOffset) {
                    rouletteGame.idleOffset = 20 * (window.innerWidth <= 480 ? 100 : 110); // Reset to start
                }
            }, 20); // 50fps
        },

        stopIdleSpin: () => {
            if (rouletteGame.idleInterval) clearInterval(rouletteGame.idleInterval);
        },

        spin: () => {
            if (rouletteGame.isSpinning) return;
            rouletteGame.stopIdleSpin();

            // Check availability
            const now = Date.now();
            const canSpin = (STATE.games.roulette.extraSpins > 0) || (now >= STATE.games.roulette.nextFreeSpin);

            if (!canSpin) return;

            if (STATE.games.roulette.extraSpins > 0) STATE.games.roulette.extraSpins--;
            else STATE.games.roulette.nextFreeSpin = now + CONFIG.roulette.cooldown;

            app.saveState();
            app.updateUI();

            rouletteGame.isSpinning = true;
            const track = document.getElementById('roulette-track');
            const itemWidth = window.innerWidth <= 480 ? 100 : 110;

            // Determine result
            const totalWeight = CONFIG.roulette.rewards.reduce((acc, r) => acc + r.weight, 0);
            let rnd = Math.random() * totalWeight;
            let result = null;
            for (let r of CONFIG.roulette.rewards) {
                if (rnd < r.weight) { result = r; break; }
                rnd -= r.weight;
            }
            if (!result) result = CONFIG.roulette.rewards[0];

            // Handle random snowflake amount
            if (result.id === 'snow_rnd') {
                result.val = Math.floor(Math.random() * 300) + 1;
                result.name = `${result.val} Снежинок`;
            }

            // Setup winning item in the track
            // We spin forward by ~40 items from current position
            const currentOffset = parseFloat(track.dataset.currentOffset || 0);
            const currentItemIndex = Math.floor(currentOffset / itemWidth);
            const targetIndex = currentItemIndex + 40 + Math.floor(Math.random() * 5); // Add random variation

            // Ensure we have enough items, if not append more
            const allItems = track.querySelectorAll('.roulette-item');
            if (targetIndex >= allItems.length) {
                // Should not happen with 100 items if we reset, but let's be safe
                // In a real app we'd append dynamically. For now 100 is enough for one spin? 
                // 20 start + 40 spin = 60. 100 is fine.
            }

            const targetEl = allItems[targetIndex];
            if (targetEl) {
                targetEl.innerHTML = `<img src="${result.img}"><span>${result.name}</span>`;
                targetEl.className = 'roulette-item'; // Reset classes

                if (result.id === 'snow1000' || result.id === 'tg25' || result.id === 'boost' || result.id === 'cup_hint') {
                    targetEl.classList.add('super-rare');
                } else if (result.type === 'special' || result.type === 'buff') {
                    targetEl.classList.add('rare');
                }
            }

            // Animation
            // Center the target item
            // offset = (targetIndex * itemWidth) - (containerWidth / 2) + (itemWidth / 2)
            const containerWidth = track.parentElement.clientWidth;
            const targetOffset = (targetIndex * itemWidth) - (containerWidth / 2) + (itemWidth / 2);

            // Start Spin
            track.style.transition = `transform ${CONFIG.roulette.spinDuration}ms cubic-bezier(0.1, 0, 0.2, 1)`;
            track.style.transform = `translateX(-${targetOffset}px)`;
            track.dataset.currentOffset = targetOffset;

            setTimeout(() => {
                rouletteGame.isSpinning = false;
                app.showRouletteReward(result);
                // Resume idle spin (maybe reset offset to match current?)
                // Actually we just start incrementing from where we are
                rouletteGame.idleOffset = parseFloat(track.dataset.currentOffset);
                rouletteGame.startIdleSpin();
            }, CONFIG.roulette.spinDuration + 500);
        }
    };

    // --- Cups Game Engine ---
    const cupsGame = {
        container: null,
        message: null,
        cups: [], // Array of DOM elements
        positions: [], // Array of X coordinates
        currentLevel: 1,
        round: 0,
        correctGuesses: 0,
        targetCupIndex: 0, // 0, 1, 2 - where the item IS
        isAnimating: false,
        isActive: false, // New flag for session tracking
        timerInterval: null,
        timeLeft: 10,

        init: () => {
            cupsGame.container = document.getElementById('cups-area');
            cupsGame.message = document.getElementById('cups-message');
        },

        prepare: () => {
            app.switchScreen('screen-cups-intro');
            // Intro is handled by HTML, wait for "Start" click
        },

        start: () => {
            if (!cupsGame.container) cupsGame.init();
            app.switchScreen('screen-cups-game');
            document.body.className = 'bg-cups';
            cupsGame.isActive = true; // Mark session active
            cupsGame.currentLevel = STATE.games.cups.level;
            cupsGame.round = 0;
            cupsGame.correctGuesses = 0;
            cupsGame.updateStats();

            // Reset Timer Display
            const timerEl = document.getElementById('cups-time');
            if (timerEl) timerEl.innerText = 10;

            cupsGame.startRound();
        },

        updateStats: () => {
            document.getElementById('cups-round').innerText = `${cupsGame.round + 1}/3`;
            document.getElementById('cups-level-display').innerText = cupsGame.currentLevel;
        },

        startRound: () => {
            if (cupsGame.round >= 3) {
                cupsGame.endGame();
                return;
            }

            cupsGame.isAnimating = true;
            cupsGame.updateStats();
            cupsGame.container.innerHTML = '';
            cupsGame.message.innerText = "Следи за предметом!";

            // Reset Timer Display Immediately
            const timerEl = document.getElementById('cups-time');
            if (timerEl) timerEl.innerText = "10";

            // New round - reset active hint state for safety, or keep?
            // "Updated timer... round starts... hint player will have until he uses it."
            // If he uses it, it's consumed. If he doesn't, does he keep it? 
            // "Button with hint... writes 0 and not clickable"
            // So if he has hints in inventory, badge > 0.
            // When he clicks, hintActive = true.
            // Reset active hint at start of round (it applies to the specific shuffle).
            STATE.games.cups.hintActive = false;
            cupsGame.updateHintButton();

            // Determine assets
            // Level 1: sk1, Lvl 2: sk2, Lvl 3: sk3, Lvl 4: sk1...
            const cupImgSrc = `sk${(cupsGame.currentLevel - 1) % 3 + 1}.png`;
            // Item: led or prnik. Alternate.
            const itemImgSrc = (cupsGame.currentLevel + cupsGame.round) % 2 === 0 ? 'led.png' : 'prnik.png';

            // Calculate positions
            // Container width ~ 350-400px (mobile vs desktop).
            // We use % for responsive.
            const posPercents = [5, 35, 65]; // Center points? No, left positions.
            // 3 cups.

            cupsGame.cups = [];
            // Create Cups
            for (let i = 0; i < 3; i++) {
                const wrapper = document.createElement('div');
                wrapper.className = 'cup-wrapper';
                wrapper.style.left = posPercents[i] + '%';
                wrapper.dataset.index = i; // Logical index

                // Inner HTML
                wrapper.innerHTML = `
                    <img src="${itemImgSrc}" class="cup-item" style="display: none;">
                    <img src="${cupImgSrc}" class="cup-img">
                `;

                cupsGame.container.appendChild(wrapper);
                cupsGame.cups.push({
                    el: wrapper,
                    posIndex: i, // Current visual position index (0,1,2)
                    hasItem: false
                });

                wrapper.addEventListener('click', () => cupsGame.handleClick(i));
            }

            // Pick target
            cupsGame.targetCupIndex = Math.floor(Math.random() * 3);
            cupsGame.cups[cupsGame.targetCupIndex].hasItem = true;

            // Show item in target cup (hidden initially, we animate reveal)
            const targetWrapper = cupsGame.cups[cupsGame.targetCupIndex].el;
            targetWrapper.querySelector('.cup-item').style.display = 'block';

            // Animation Sequence
            // 1. Show big item overlay
            setTimeout(() => {
                cupsGame.animateReveal(itemImgSrc, targetWrapper);
            }, 500);
        },

        animateReveal: (itemSrc, targetEl) => {
            // Create overlay if not exists
            let overlay = document.getElementById('cups-reveal-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'cups-reveal-overlay';
                overlay.className = 'reveal-overlay';
                overlay.innerHTML = `<img src="" class="reveal-item">`;
                document.body.appendChild(overlay);
            }

            const img = overlay.querySelector('img');
            img.src = itemSrc;

            overlay.classList.add('active');

            setTimeout(() => {
                // Shrink and move to target
                // We can't easily tween to the exact cup position with CSS classes alone efficiently without complex calculations.
                // Simplified: Fade out overlay, lift target cup to show item.

                overlay.classList.remove('active');

                // Lift cup
                targetEl.classList.add('lift');

                setTimeout(() => {
                    targetEl.classList.remove('lift');
                    setTimeout(() => {
                        cupsGame.shuffle();
                    }, 500);
                }, 1000);
            }, 1500);
        },

        shuffle: () => {
            cupsGame.message.innerText = "Перемешиваю...";

            // Duration: 10 seconds fixed
            const DURATION = 10000;
            const startTime = Date.now();

            // Speed based on level
            // Speed based on level
            // Lvl 1: Faster (~850ms). Lvl 12: Super Fast (~200ms).
            const level = cupsGame.currentLevel;
            const speed = Math.max(200, 850 - ((level - 1) * 75));

            const posPercents = [5, 35, 65];

            const doSwap = () => {
                if (Date.now() - startTime >= DURATION) {
                    cupsGame.isAnimating = false;
                    cupsGame.message.innerText = "Где предмет?";
                    cupsGame.startTimer();
                    return;
                }

                // Pick 2 random distinct indices
                let a = Math.floor(Math.random() * 3);
                let b = Math.floor(Math.random() * 3);
                while (a === b) b = Math.floor(Math.random() * 3);

                // Swap visual positions in array logic
                const cupA = cupsGame.cups.find(c => c.posIndex === a);
                const cupB = cupsGame.cups.find(c => c.posIndex === b);

                // Swap posIndex
                cupA.posIndex = b;
                cupB.posIndex = a;

                // Animate
                cupA.el.style.left = posPercents[b] + '%';
                cupB.el.style.left = posPercents[a] + '%';

                setTimeout(doSwap, speed);
            };

            doSwap();
        },

        startTimer: () => {
            cupsGame.timeLeft = 10;
            const timerEl = document.getElementById('cups-time');
            if (timerEl) timerEl.innerText = cupsGame.timeLeft;

            if (cupsGame.timerInterval) clearInterval(cupsGame.timerInterval);

            cupsGame.timerInterval = setInterval(() => {
                cupsGame.timeLeft--;
                if (timerEl) timerEl.innerText = cupsGame.timeLeft;

                if (cupsGame.timeLeft <= 0) {
                    cupsGame.stopTimer();
                    cupsGame.handleTimeout();
                }
            }, 1000);
        },

        stopTimer: () => {
            if (cupsGame.timerInterval) clearInterval(cupsGame.timerInterval);
        },

        handleTimeout: () => {
            cupsGame.isAnimating = true; // Block clicks
            cupsGame.message.innerText = "Время вышло!";

            // Show correct answer
            const correctCup = cupsGame.cups.find(c => c.hasItem);
            correctCup.el.classList.add('lift');
            correctCup.el.classList.add('wrong'); // Mark as red/wrong context

            setTimeout(() => {
                cupsGame.showRoundResult(false);
            }, 1500);
        },

        handleClick: (originalIndex) => {
            if (cupsGame.isAnimating) return;
            cupsGame.stopTimer();

            const cupObj = cupsGame.cups[originalIndex];

            cupsGame.isAnimating = true; // Block clicks
            cupObj.el.classList.add('lift');

            let isWin = false;
            if (cupObj.hasItem) {
                cupObj.el.classList.add('correct');
                cupsGame.correctGuesses++;
                isWin = true;
            } else {
                cupObj.el.classList.add('wrong');
                // Show where it was
                const correctCup = cupsGame.cups.find(c => c.hasItem);
                setTimeout(() => correctCup.el.classList.add('lift'), 500);
            }

            setTimeout(() => {
                cupsGame.showRoundResult(isWin);
            }, 1500);
        },

        showRoundResult: (win) => {
            const modal = document.getElementById('cups-round-result');
            const title = document.getElementById('cups-round-title');
            const img = document.getElementById('cups-round-img');
            const msg = document.getElementById('cups-round-msg');

            if (win) {
                title.innerText = "Верно!";
                img.src = "dedpobeda.png";
                msg.innerText = "Молодец! Так держать!";
            } else {
                title.innerText = "Ошибочка...";
                img.src = "dedlose.png";
                msg.innerText = "Не расстраивайся, повезет в следующий раз!";
            }

            modal.classList.add('active');

            setTimeout(() => {
                modal.classList.remove('active');
                cupsGame.round++;
                cupsGame.startRound();
            }, 2500);
        },

        endGame: () => {
            cupsGame.isAnimating = false;
            cupsGame.isActive = false; // Session over
            let win = false;
            let reward = 0;
            const level = cupsGame.currentLevel;

            // Rewards
            // 0/3: 0
            // 1/3: 15 + (lvl-1)*10
            // 2/3: 30 + (lvl-1)*10
            // 3/3: 80 + (lvl-1)*10

            const bonus = (level - 1) * CONFIG.cups.rewardGrowth;

            if (cupsGame.correctGuesses === 1) reward = CONFIG.cups.baseReward1 + bonus;
            else if (cupsGame.correctGuesses === 2) reward = CONFIG.cups.baseReward2 + bonus;
            else if (cupsGame.correctGuesses === 3) reward = CONFIG.cups.baseReward3 + bonus;

            if (reward > 0) {
                SecureStore.addBalance(reward);
                win = true;

                if (STATE.games.cups.level < 12) STATE.games.cups.level++;
                else STATE.games.cups.level = 1;

                // Win = Cooldown too (Requested by user)
                STATE.games.cups.lastPlayed = Date.now();

                // Reset Hint
                STATE.games.cups.hintActive = false;
            } else {
                // Lose = Cooldown
                STATE.games.cups.lastPlayed = Date.now();
                STATE.games.cups.hintActive = false;
            }

            app.saveState();

            // Show Result
            app.finishCupGame(cupsGame.correctGuesses, reward);
        },

        updateHintButton: () => {
            const btn = document.getElementById('btn-cups-hint');
            const badge = document.getElementById('cups-hint-count');
            const count = STATE.games.cups.hints || 0;

            if (badge) badge.innerText = count;

            if (count > 0 && !STATE.games.cups.hintActive) {
                btn.classList.remove('disabled');
            } else {
                btn.classList.add('disabled');
            }
        },

        useHint: () => {
            // User says: "On the button will be written digit... till he uses it."
            // Assuming usage is allowed during the round (shuffle or guess).
            // Check if game is in progress?
            if (!cupsGame.isAnimating && cupsGame.timeLeft <= 0) return;
            // We allow usage even during shuffle for better feedback

            if (STATE.games.cups.hints > 0 && !STATE.games.cups.hintActive) {
                STATE.games.cups.hints--;
                STATE.games.cups.hintActive = true;
                cupsGame.updateHintButton();

                // Show Arrow
                // Check if cups exist
                if (cupsGame.cups && cupsGame.cups[cupsGame.targetCupIndex]) {
                    const hintEl = document.createElement('div');
                    hintEl.className = 'cup-hint-arrow';
                    cupsGame.cups[cupsGame.targetCupIndex].el.appendChild(hintEl);
                }

                app.saveState();
            }
        }
    };



    // --- App Controller ---
    const app = {
        init: () => {
            soundManager.init();
            app.loadState();
            app.createSnow();
            app.updateUI();
            app.startTicks();
            app.bindEvents();
            app.initListAnimation();

            // Initial Route
            app.handleHash();
            if (!window.location.hash) {
                // Default to loading if no hash
                window.location.hash = 'loading';
            }

            // Preload Images
            const preloadLose = new Image(); preloadLose.src = 'dedlose.png';
            const preloadWin = new Image(); preloadWin.src = 'dedpobeda.png';


        },

        initListAnimation: () => {
            const list = document.querySelector('.games-grid');
            if (!list) return;

            const handleScroll = () => {
                const viewportHeight = list.clientHeight;
                const items = Array.from(list.querySelectorAll('.game-card'));
                const listRect = list.getBoundingClientRect();

                items.forEach((item, index) => {
                    const rect = item.getBoundingClientRect();
                    // Calculate position relative to container
                    // We want logic based on "how close to bottom".
                    // But we have to be careful with "getBoundingClientRect" inside scroll loops if performance matters.
                    // Ideally we use offsetTop.

                    const relativeTop = item.offsetTop - list.scrollTop;
                    const triggerY = viewportHeight - 140; // Stack starts 140px from bottom

                    // Enforce Z-Index reverse order so lower items go behind
                    item.style.zIndex = 100 - index;

                    if (relativeTop > triggerY) {
                        const diff = relativeTop - triggerY;

                        // Scale down: 1.0 -> 0.85 approx
                        const scale = Math.max(0.85, 1 - (diff * 0.001));

                        // Translate up: Squish them together
                        const translateY = -diff * 0.85;

                        // Opacity: Fade out slightly deep in stack
                        const opacity = Math.max(0.6, 1 - (diff * 0.002));

                        // Brightness check (darken lower items)
                        // Using filter might be heavy, lets stick to opacity for now as per design "hide under".

                        item.style.transform = `translateY(${translateY}px) scale(${scale})`;
                        item.style.opacity = opacity;
                    } else {
                        // Reset if in main view
                        item.style.transform = 'translateY(0) scale(1)';
                        item.style.opacity = '1';
                    }
                });
            };

            list.addEventListener('scroll', handleScroll);
            // Also trigger on resize or init
            window.addEventListener('resize', handleScroll);
            setTimeout(handleScroll, 100); // Initial
        },



        showFloatingText: (text, color) => {
            const el = document.createElement('div');
            el.className = 'floating-text';
            el.innerText = text;
            el.style.color = color;
            el.style.left = '50%';
            el.style.top = '40%';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 1000);
        },



        bindEvents: () => {
            // Using hash navigation
            document.getElementById('btn-start-adventure').addEventListener('click', () => { window.location.hash = 'menu'; });
            document.getElementById('timer-starfall').addEventListener('click', () => app.tryStartGame('starfall'));

            document.getElementById('timer-roulette').addEventListener('click', () => { window.location.hash = 'roulette'; });
            document.getElementById('btn-rules-starfall').addEventListener('click', () => app.showRules('starfall'));
            document.getElementById('btn-close-rules').addEventListener('click', app.closeRules);
            document.getElementById('btn-result-menu').addEventListener('click', () => { window.location.hash = 'menu'; });

            document.getElementById('btn-spin').addEventListener('click', rouletteGame.spin);
            document.getElementById('btn-roulette-back').addEventListener('click', () => { window.location.hash = 'menu'; });



            // Hash Change Listener (The Router)
            window.addEventListener('hashchange', app.handleHash);

            document.getElementById('btn-claim-reward').addEventListener('click', app.claimReward);
            document.getElementById('btn-sell-reward').addEventListener('click', app.sellReward);



            // Result Screen Next Level
            document.getElementById('btn-next-level').addEventListener('click', (e) => {
                const btn = e.target; // or use currentTarget
                if (btn.dataset.locked === "true") return; // Block click if locked

                // Determine which game we are in?
                // Currently only Cups uses this logic based on request
                app.switchScreen('screen-game-loader');
                setTimeout(() => {
                    cupsGame.start();
                }, 2000);
            });

            // Cups Events
            document.getElementById('btn-cups-hint').addEventListener('click', cupsGame.useHint);
            document.getElementById('timer-cups').addEventListener('click', () => app.tryStartGame('cups'));
            document.getElementById('btn-rules-cups').addEventListener('click', () => app.showRules('cups'));
            document.getElementById('btn-start-cups').addEventListener('click', () => {
                app.switchScreen('screen-game-loader');
                // Optional: Customize loader text
                const tip = document.getElementById('game-tip');
                if (tip) tip.innerText = "Совет: Следи за стаканчиком очень внимательно!";

                // setTimeout(() => {
                //     cupsGame.start();
                // }, 2000);
                window.location.hash = 'cups-game';
            });
            document.getElementById('btn-cups-back').addEventListener('click', () => { window.location.hash = 'menu'; });

            window.addEventListener('resize', () => {
                if (document.getElementById('screen-game').classList.contains('active-screen')) starfallGame.resize();
            });
        },

        loadState: () => {
            const saved = localStorage.getItem('newyear_marathon_save_v2');
            if (saved) {
                const parsed = SECURITY.load(saved);
                if (parsed) {
                    if (parsed.balance !== undefined) SecureStore.setBalance(parsed.balance);
                    STATE.cookies = parsed.cookies || 0;
                    if (parsed.games) {
                        STATE.games.starfall = { ...STATE.games.starfall, ...parsed.games.starfall };
                        STATE.games.roulette = { ...STATE.games.roulette, ...parsed.games.roulette };
                        STATE.games.cups = { ...STATE.games.cups, ...parsed.games.cups };
                    }
                }
            }
        },

        saveState: () => {
            // Create a copy to save, injecting balance
            const saveObj = { ...STATE, balance: SecureStore.getBalance() };
            const encryptedData = SECURITY.save(saveObj);
            if (encryptedData) localStorage.setItem('newyear_marathon_save_v2', encryptedData);
        },

        createSnow: () => {
            const container = document.getElementById('snowContainer');
            if (!container) return;
            for (let i = 0; i < 30; i++) {
                const flake = document.createElement('div');
                flake.className = 'snowflake';
                flake.style.left = Math.random() * 100 + '%';
                flake.style.animationDuration = Math.random() * 3 + 2 + 's';
                flake.style.animationDelay = Math.random() * 2 + 's';
                container.appendChild(flake);
            }
        },

        switchScreen: (screenId) => {
            // Pure UI Switch
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
            const screen = document.getElementById(screenId);
            if (screen) screen.classList.add('active-screen');

            // Backgrounds
            document.body.className = '';
            if (screenId === 'screen-game') document.body.classList.add('bg-starfall');
            if (screenId === 'screen-roulette') document.body.classList.add('bg-roulette');
            if (screenId === 'screen-cups-game') document.body.classList.add('bg-cups');

        },

        handleHash: () => {
            const hash = window.location.hash.replace('#', '');

            // Anti-Cheat / Clean up
            if (app.resultInterval) { clearInterval(app.resultInterval); app.resultInterval = null; }

            // Check for mid-game exit
            if (hash !== 'starfall' && starfallGame.isActive) {
                // Punishment: Set cooldown
                STATE.games.starfall.lastPlayed = Date.now();
                starfallGame.isActive = false;
                app.saveState();
                // Optionally show toast? No, silent punishment or user figures it out.
            }
            if (hash !== 'cups-game' && cupsGame.isActive) {
                // Punishment: Set cooldown
                STATE.games.cups.lastPlayed = Date.now();
                STATE.games.cups.hintActive = false;
                cupsGame.isActive = false;
                app.saveState();
            }

            if (hash !== 'starfall') starfallGame.isActive = false;
            if (hash !== 'cups-game') {
                cupsGame.isAnimating = false;
                // cupsGame.isActive = false; // Removed this line to let logic above handle it solely? 
                // Actually logic above sets it to false if punishment. 
                // But if we just punish, we also need to ensure it's false for normal nav.
                // Safe to set false here again or just let the block above handle it.
                // If we came from cups-game and finished normally, isActive is ALREADY false (set in endGame).
                // So the block above (hash !== 'cups-game' && cupsGame.isActive) ONLY triggers if we exited mid-game.
                // So we don't need to force set it false here blindly, or we can to be safe.
                cupsGame.isActive = false;
            }

            switch (hash) {
                case 'loading':
                case '':
                    app.switchScreen('screen-loading');
                    break;
                case 'menu':
                    app.updateUI();
                    app.switchScreen('screen-menu');
                    break;
                case 'starfall':
                    // If manually typed, we prepare. If via button, tryStartGame checked cooldown.
                    // We can just prepare() here. Logic checks can be added if strict.
                    starfallGame.prepare(); // prepare calls switchScreen('screen-game') - wait, we should just let prepare do it.
                    // Note: prepare() calls app.switchScreen('screen-game'). That's fine.
                    break;
                case 'roulette':
                    rouletteGame.init();
                    app.switchScreen('screen-roulette');
                    app.updateUI();
                    break;
                case 'cups':
                    app.switchScreen('screen-cups-intro');
                    break;
                case 'cups-game':
                    cupsGame.start();
                    break;

                case 'result':
                    app.switchScreen('screen-result');
                    break;
                default:
                    app.switchScreen('screen-menu');
            }
        },

        showMenu: () => {
            window.location.hash = 'menu';
        },

        openRoulette: () => {
            window.location.hash = 'roulette';
        },

        showRules: (gameId) => {
            const modal = document.getElementById('modal-rules');
            const textContainer = document.getElementById('rules-text');
            if (gameId === 'starfall') {
                textContainer.innerHTML = `
                    <ol>
                        <li><b>Цель:</b> Собери звезды в носок. Чем выше уровень, тем больше нужно звезд!</li>
                        <li><b>Управление:</b> Перемещай носок по экрану.</li>
                        <li><b>Опасности:</b> Избегай вирусов и мусора! Они отнимают очки.</li>
                        <li><b>Победа:</b> Набери нужное количество очков до истечения времени.</li>
                    </ol>
                `;
            }
            if (gameId === 'cups') {
                textContainer.innerHTML = `
                    <ol>
                        <li><b>Цель:</b> Угадай, под каким стаканчиком спрятан предмет.</li>
                        <li><b>Уровни:</b> 12 уровней, с каждым уровнем стаканчики перемешиваются быстрее.</li>
                        <li><b>Награды:</b> Угадай 1, 2 или 3 раза за игру чтобы получить снежинки!</li>
                    </ol>
                 `;
            }
            modal.classList.add('active');
        },

        closeRules: () => {
            document.getElementById('modal-rules').classList.remove('active');
        },

        updateUI: () => {
            document.getElementById('user-balance').innerText = SecureStore.getBalance();

            // Starfall Timer
            const starBtn = document.getElementById('timer-starfall');
            const starDiff = Date.now() - STATE.games.starfall.lastPlayed;
            const currentCooldown = CONFIG.starfall.baseCooldown + (STATE.games.starfall.level - 1) * CONFIG.starfall.cooldownStep;
            const starRem = currentCooldown - starDiff;

            // Update Menu Level Badge
            const levelBadge = document.getElementById('menu-starfall-level');
            if (levelBadge) levelBadge.innerText = STATE.games.starfall.level;

            if (starRem > 0) {
                starBtn.classList.add('cooldown');
                // text updated by tick
            } else {
                starBtn.classList.remove('cooldown');
                starBtn.innerText = 'ИГРАТЬ';
            }

            // Cups Timer
            const cupsBtn = document.getElementById('timer-cups');
            if (cupsBtn) {
                const cupsDiff = Date.now() - STATE.games.cups.lastPlayed;
                let cupsCooldown = CONFIG.cups.baseCooldown;
                if (STATE.games.cups.level >= 3) {
                    cupsCooldown += (STATE.games.cups.level - 2) * CONFIG.cups.cooldownPerLevel;
                }
                const cupsRem = cupsCooldown - cupsDiff;

                const cupsLvlBadge = document.getElementById('menu-cups-level');
                if (cupsLvlBadge) cupsLvlBadge.innerText = STATE.games.cups.level;

                if (cupsRem > 0) {
                    cupsBtn.classList.add('cooldown');
                } else {
                    cupsBtn.classList.remove('cooldown');
                    cupsBtn.innerText = 'ИГРАТЬ';
                }
            }

            // Roulette Timer
            const rouBtn = document.getElementById('btn-spin');
            const rouTimer = document.getElementById('roulette-timer-display');
            const rouRem = STATE.games.roulette.nextFreeSpin - Date.now();
            const hasExtra = STATE.games.roulette.extraSpins > 0;

            if (hasExtra) {
                rouBtn.style.display = 'inline-block';
                rouTimer.style.display = 'none';
                rouBtn.innerText = `КРУТИТЬ (${STATE.games.roulette.extraSpins})`;
                rouBtn.classList.remove('cooldown');
            } else if (rouRem > 0) {
                rouBtn.style.display = 'none';
                rouTimer.style.display = 'block';
                const h = Math.floor(rouRem / 3600000);
                const m = Math.floor((rouRem % 3600000) / 60000);
                const s = Math.floor((rouRem % 60000) / 1000);
                rouTimer.innerHTML = `До следующей игры:<br>${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;

                // Update Menu Button too
                document.getElementById('timer-roulette').innerText = `${h}:${m < 10 ? '0' : ''}${m}`;
            } else {
                rouBtn.style.display = 'inline-block';
                rouTimer.style.display = 'none';
                rouBtn.innerText = 'КРУТИТЬ БЕСПЛАТНО';
                rouBtn.classList.remove('cooldown');
                document.getElementById('timer-roulette').innerText = 'КРУТИТЬ';
            }
        },

        startTicks: () => {
            setInterval(() => {
                const now = Date.now();

                // Countdown to New Year - REMOVED per request
                /*
                // Countdown logic...
                */

                // Starfall
                const currentCooldown = CONFIG.starfall.baseCooldown + (STATE.games.starfall.level - 1) * CONFIG.starfall.cooldownStep;
                const sRem = currentCooldown - (now - STATE.games.starfall.lastPlayed);
                if (sRem > 0) {
                    const m = Math.floor(sRem / 60000);
                    const s = Math.floor((sRem % 60000) / 1000);
                    const el = document.getElementById('timer-starfall');
                    if (el) el.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                } else {
                    const el = document.getElementById('timer-starfall');
                    if (el && el.innerText.includes(':')) app.updateUI();
                }

                // Cups Timer
                let cupsCooldown = CONFIG.cups.baseCooldown;
                if (STATE.games.cups.level >= 3) {
                    cupsCooldown += (STATE.games.cups.level - 2) * CONFIG.cups.cooldownPerLevel;
                }
                const cRem = cupsCooldown - (now - STATE.games.cups.lastPlayed);
                if (cRem > 0) {
                    const m = Math.floor(cRem / 60000);
                    const s = Math.floor((cRem % 60000) / 1000);
                    const el = document.getElementById('timer-cups');
                    if (el) el.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                } else {
                    const el = document.getElementById('timer-cups');
                    if (el && el.innerText.includes(':')) app.updateUI();
                }

                // Roulette
                if (STATE.games.roulette.extraSpins === 0) {
                    const rRem = STATE.games.roulette.nextFreeSpin - now;
                    if (rRem > 0) {
                        // Update in-game timer
                        const h = Math.floor(rRem / 3600000);
                        const m = Math.floor((rRem % 3600000) / 60000);
                        const s = Math.floor((rRem % 60000) / 1000);
                        const display = document.getElementById('roulette-timer-display');
                        if (display) display.innerHTML = `До следующей игры:<br>${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;

                        // Update Menu Button
                        const el = document.getElementById('timer-roulette');
                        if (el) el.innerText = `${h}:${m < 10 ? '0' : ''}${m}`;
                    } else {
                        // Check if we need to show button
                        const btn = document.getElementById('btn-spin');
                        if (btn && btn.style.display === 'none') app.updateUI();
                    }
                }
            }, 1000);
        },

        tryStartGame: (gameId) => {
            const now = Date.now();
            if (gameId === 'starfall') {
                const currentCooldown = CONFIG.starfall.baseCooldown + (STATE.games.starfall.level - 1) * CONFIG.starfall.cooldownStep;
                if (now - STATE.games.starfall.lastPlayed < currentCooldown) return;
                window.location.hash = 'starfall';
                // app.switchScreen('screen-game-loader'); // Skipping loader for URL nav, or add hash for loader
                // setTimeout(() => starfallGame.prepare(), 2000); 
                // Simplified: Direct go
            }
            if (gameId === 'cups') {
                let cooldown = CONFIG.cups.baseCooldown;
                if (STATE.games.cups.level >= 3) cooldown += (STATE.games.cups.level - 2) * CONFIG.cups.cooldownPerLevel;
                if (now - STATE.games.cups.lastPlayed < cooldown) return;
                window.location.hash = 'cups';
            }
        },

        finishGame: (gameId, score, win) => {
            const resultTitle = document.getElementById('result-title');
            const resultImg = document.getElementById('result-ded-img');
            const resultMsg = document.getElementById('result-message');
            const rewardBox = document.getElementById('reward-box');

            if (win) {
                const level = STATE.games[gameId].level;
                const reward = CONFIG[gameId].baseReward + (level - 1) * CONFIG[gameId].levelRewardStep;
                SecureStore.addBalance(reward);
                STATE.games[gameId].lastPlayed = Date.now();

                // Max level 12 logic
                if (STATE.games[gameId].level >= 12) {
                    STATE.games[gameId].level = 1;
                } else {
                    STATE.games[gameId].level++;
                }

                resultTitle.innerText = "Победа!";
                // Ensure image is correct immediately, even if previous was lose
                resultImg.src = "dedpobeda.png";
                resultMsg.innerText = `Уровень ${STATE.games[gameId].level} открыт!`;
                rewardBox.innerHTML = `<span>+${reward}</span> <img src="zima.png" class="currency-icon">`;
                rewardBox.style.display = "inline-flex";
            } else {
                STATE.games[gameId].lastPlayed = Date.now();
                resultTitle.innerText = "Ох-ох...";
                resultImg.src = "dedlose.png";
                resultMsg.innerText = "Не сдавайся! Попробуй еще раз.";
                rewardBox.style.display = "none";
            }
            app.saveState();

            // Starfall: Always hide next level button (handled by menu/cooldown)
            document.getElementById('btn-next-level').style.display = 'none';

            window.location.hash = 'result';
        },

        finishCupGame: (correctGuesses, reward) => {
            const resultTitle = document.getElementById('result-title');
            const resultImg = document.getElementById('result-ded-img');
            const resultMsg = document.getElementById('result-message');
            const rewardBox = document.getElementById('reward-box');

            if (correctGuesses >= 1) {
                // Win
                resultTitle.innerText = "Хорошая работа!";
                resultImg.src = "dedpobeda.png";
                resultMsg.innerText = `Ты угадал ${correctGuesses} из 3!`;
                rewardBox.innerHTML = `<span>+${reward}</span> <img src="zima.png" class="currency-icon">`;
                rewardBox.style.display = "inline-flex";

                // Allow Next Level
                document.getElementById('btn-next-level').style.display = 'inline-block';
            } else {
                // Lose
                resultTitle.innerText = "Эх...";
                resultImg.src = "dedlose.png";
                resultMsg.innerText = "Попробуй позже, может повезет больше!";
                rewardBox.style.display = "none";

                document.getElementById('btn-next-level').style.display = 'none';
            }

            // If Next Level is allowed (Win), we should show "To next level: Ready" or just the button.
            // Since we removed cooldown for win, we show button.
            // The user asked: "Instead of 'next level' button make a button 'To next level: and timer'"
            // BUT also said "Fix bug... can't propose next round because CD is running".
            // So by removing CD, we solve the "can't play" issue.
            // The button "To next level: timer" is only needed if there IS a timer.
            // If I remove the timer for winners, I can just keep the "Next Level" button as is, 
            // maybe rename it to "Следующий уровень" (it is already named that in HTML).
            // I will assume standard "Next Level" button is fine if it works.

            // Handle Next Level Button with Timer
            if (correctGuesses >= 1) {
                const btn = document.getElementById('btn-next-level');
                btn.style.display = 'inline-block';
                btn.classList.add('cooldown');

                // Calculate wait time
                let cooldown = CONFIG.cups.baseCooldown;
                if (STATE.games.cups.level >= 3) cooldown += (STATE.games.cups.level - 2) * CONFIG.cups.cooldownPerLevel;

                const updateBtn = () => {
                    const diff = Date.now() - STATE.games.cups.lastPlayed;
                    const rem = cooldown - diff;

                    if (rem <= 0) {
                        btn.innerText = "Следующий Уровень >>>";
                        btn.classList.remove('cooldown');
                        btn.dataset.locked = "false";
                        if (app.resultInterval) clearInterval(app.resultInterval);
                    } else {
                        const m = Math.floor(rem / 60000);
                        const s = Math.floor((rem % 60000) / 1000);
                        btn.innerText = `До след. уровня: ${m}:${s < 10 ? '0' : ''}${s}`;
                        btn.dataset.locked = "true";
                    }
                };

                btn.dataset.locked = "true";
                updateBtn();

                if (app.resultInterval) clearInterval(app.resultInterval);
                app.resultInterval = setInterval(updateBtn, 1000);

                // Override click behavior for this button? 
                // The existing listener handles switchScreen.
                // We need to prevent it if locked.
            }

            window.location.hash = 'result';
        },

        // Roulette Result Handling
        currentReward: null,
        showRouletteReward: (reward) => {
            app.currentReward = reward;
            const modal = document.getElementById('modal-roulette-reward');
            const display = document.getElementById('roulette-reward-display');
            const sellBtn = document.getElementById('btn-sell-reward');
            const modalTitle = modal.querySelector('h3');

            // Modern, Clean UI - No Ded Moroz Image
            let bgClass = 'bg-reward-common';
            let titleText = "Поздравляем!";

            if (reward.type === 'junk') {
                titleText = "Эх...";
            } else if (reward.id === 'boost') {
                titleText = "ВОЛШЕБСТВО!";
            } else if (reward.val >= 500 || reward.type === 'extra_spin') {
                titleText = "СУПЕР ПРИЗ!";
            }

            modalTitle.innerText = titleText;

            // Premium HTML Structure
            display.innerHTML = `
                <div class="prize-glow-container">
                    <div class="prize-rays"></div>
                    <div class="prize-halo"></div>
                    <img src="${reward.img}" class="reward-main-img premium-drop">
                    <div class="prize-sparkles"></div>
                </div>
                <h3 class="premium-reward-name">${reward.name}</h3>
                <p class="premium-reward-desc">${reward.type === 'junk' ? 'Ничего, повезет в любви!' : 'Отличный улов!'}</p>
            `;

            if (reward.sell > 0) {
                sellBtn.style.display = 'inline-block';
                document.getElementById('sell-price').innerText = reward.sell;
            } else {
                sellBtn.style.display = 'none';
            }

            modal.classList.add('active');
        },

        claimReward: () => {
            const r = app.currentReward;
            if (r.type === 'currency') SecureStore.addBalance(r.val);
            if (r.type === 'extra_spin') STATE.games.roulette.extraSpins += r.val;
            if (r.type === 'buff') STATE.games.starfall.buff = true;
            if (r.type === 'item') STATE.cookies += r.val; // Assuming item is cookie
            if (r.id === 'cup_hint') STATE.games.cups.hints = (STATE.games.cups.hints || 0) + 1;

            app.saveState();
            app.closeRouletteModal();
        },

        sellReward: () => {
            const r = app.currentReward;
            if (r.sell > 0) {
                SecureStore.addBalance(r.sell);
                app.saveState();
                app.closeRouletteModal();
            }
        },

        closeRouletteModal: () => {
            document.getElementById('modal-roulette-reward').classList.remove('active');
            window.location.hash = 'menu';
        }
    };

    window.addEventListener('load', app.init);
})();