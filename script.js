(function() {
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
            baseSpeed: 5, 
            speedLevelFactor: 0.2, 
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
                { id: 'cookie1', name: '1 Пряная Печенька', type: 'item', val: 1, weight: 80, img: 'valuta.png', sell: 0 }, // Cookies not sellable
                { id: 'tg25', name: '25 TG Stars', type: 'special', val: 25, weight: 5, img: 'star.png', sell: 1000 },
                // Random fillers
                { id: 'cookie_rnd', name: 'Случайные Печеньки', type: 'item', val: 0, weight: 20, img: 'valuta.png', sell: 0 }
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

    const STATE = {
        balance: 0,
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
                level: 1
            },
            roulette: {
                lastPlayed: 0,
                nextFreeSpin: 0,
                extraSpins: 0
            }
        }
    };

    let sessionGameStartTime = 0;
    let isGameRunning = false;

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
                    if(e.touches) e.preventDefault();
                    
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
            starfallGame.width = Math.min(container.clientWidth - 20, 500);
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
            starfallGame.loop();
            
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
            const size = 55; // Increased from 30
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

        update: () => {
            const lerp = 0.2;
            starfallGame.player.x += (starfallGame.player.targetX - starfallGame.player.x) * lerp;
            starfallGame.player.y += (starfallGame.player.targetY - starfallGame.player.y) * lerp;

            // Spawn Rate
            const isBuff = STATE.games.starfall.buff;
            let spawnRate = 0.08 + (STATE.games.starfall.level * 0.005); // Increased base from 0.05
            if (isBuff) spawnRate = 0.15; // More stars in buff mode

            if (Math.random() < spawnRate) starfallGame.spawnEntity();

            for (let i = starfallGame.entities.length - 1; i >= 0; i--) {
                let s = starfallGame.entities[i];
                s.y += s.speed;

                const p = starfallGame.player;
                if (s.x < p.x + p.w && s.x + s.size > p.x && s.y < p.y + p.h && s.y + s.size > p.y) {
                    starfallGame.entities.splice(i, 1);
                    if (s.type === 'star') {
                        starfallGame.score++;
                    } else {
                        starfallGame.score = Math.max(0, starfallGame.score - 5);
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
                    starfallGame.ctx.arc(s.x + s.size/2, s.y + s.size/2, s.size/2, 0, Math.PI * 2);
                    starfallGame.ctx.fill();
                }
            });
        },

        loop: () => {
            if (!starfallGame.isActive) return;
            starfallGame.update();
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
            for (let i = 0; i < 100; i++) {
                const r = rewards[Math.floor(Math.random() * rewards.length)];
                rouletteGame.items.push(r);
                const el = document.createElement('div');
                el.className = 'roulette-item';
                
                // Special Highlights
                if (r.id === 'snow1000' || r.id === 'tg25' || r.id === 'boost') {
                    el.classList.add('super-rare');
                } else if(r.type === 'special' || r.type === 'buff') {
                    el.classList.add('rare');
                }
                
                el.innerHTML = `<img src="${r.img}"><span>${r.name}</span>`;
                track.appendChild(el);
            }

            // Start in the middle to show content on left
            const itemWidth = 110; // 100 width + 10 margin (updated for new CSS)
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
                const maxOffset = 80 * 110; // 80 items * width
                if (rouletteGame.idleOffset > maxOffset) {
                    rouletteGame.idleOffset = 20 * 110; // Reset to start
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
            const itemWidth = 110; // Updated width
            
            // Determine result
            const totalWeight = CONFIG.roulette.rewards.reduce((acc, r) => acc + r.weight, 0);
            let rnd = Math.random() * totalWeight;
            let result = null;
            for (let r of CONFIG.roulette.rewards) {
                if (rnd < r.weight) { result = r; break; }
                rnd -= r.weight;
            }
            if (!result) result = CONFIG.roulette.rewards[0];
            
            // Handle random cookie amount
            if (result.id === 'cookie_rnd') {
                result.val = Math.floor(Math.random() * 999) + 1;
                result.name = `${result.val} Печенек`;
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
                
                if (result.id === 'snow1000' || result.id === 'tg25' || result.id === 'boost') {
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
            cupsGame.currentLevel = STATE.games.cups.level;
            cupsGame.round = 0;
            cupsGame.correctGuesses = 0;
            cupsGame.updateStats();
            
            // Reset Timer Display
            const timerEl = document.getElementById('cups-time');
            if(timerEl) timerEl.innerText = 10;

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

            // Determine assets
            // Level 1: sk1, Lvl 2: sk2, Lvl 3: sk3, Lvl 4: sk1...
            const cupImgSrc = `sk${(cupsGame.currentLevel - 1) % 3 + 1}.png`;
            // Item: led or prnik. Alternate.
            const itemImgSrc = (cupsGame.currentLevel + cupsGame.round) % 2 === 0 ? 'led.png' : 'prnik.png';

            // Calculate positions
            // Container width ~ 350-400px (mobile vs desktop).
            // We use % for responsive.
            const posPercents = [10, 40, 70]; // Center points? No, left positions.
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
            // Lvl 1: Slow (~800ms). Lvl 12: Fast (~200ms).
            const level = cupsGame.currentLevel;
            const speed = Math.max(200, 900 - ((level - 1) * 60));
            
            const posPercents = [10, 40, 70];

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
             if(timerEl) timerEl.innerText = cupsGame.timeLeft;
             
             if (cupsGame.timerInterval) clearInterval(cupsGame.timerInterval);
             
             cupsGame.timerInterval = setInterval(() => {
                 cupsGame.timeLeft--;
                 if(timerEl) timerEl.innerText = cupsGame.timeLeft;
                 
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
                STATE.balance += reward;
                win = true;
                
                if (STATE.games.cups.level < 12) STATE.games.cups.level++;
                else STATE.games.cups.level = 1;

                // Win = No cooldown, proceed to next level
                STATE.games.cups.lastPlayed = 0; 
            } else {
                // Lose = Cooldown
                STATE.games.cups.lastPlayed = Date.now();
            }

            app.saveState();
            
            // Show Result
            app.finishCupGame(cupsGame.correctGuesses, reward);
        }
    };

    // --- App Controller ---
    const app = {
        init: () => {
            app.loadState();
            app.createSnow();
            app.updateUI();
            app.startTicks();
            app.bindEvents();
        },

        bindEvents: () => {
            document.getElementById('btn-start-adventure').addEventListener('click', app.showMenu);
            document.getElementById('timer-starfall').addEventListener('click', () => app.tryStartGame('starfall'));
            document.getElementById('timer-roulette').addEventListener('click', app.openRoulette);
            document.getElementById('btn-rules-starfall').addEventListener('click', () => app.showRules('starfall'));
            document.getElementById('btn-close-rules').addEventListener('click', app.closeRules);
            document.getElementById('btn-result-menu').addEventListener('click', app.showMenu);
            
            document.getElementById('btn-spin').addEventListener('click', rouletteGame.spin);
            document.getElementById('btn-roulette-back').addEventListener('click', app.showMenu);
            
            document.getElementById('btn-claim-reward').addEventListener('click', app.claimReward);
            document.getElementById('btn-sell-reward').addEventListener('click', app.sellReward);

            // Result Screen Next Level
            document.getElementById('btn-next-level').addEventListener('click', () => {
                // Determine which game we are in?
                // Currently only Cups uses this logic based on request
                app.switchScreen('screen-game-loader');
                setTimeout(() => {
                    cupsGame.start();
                }, 2000);
            });
            
            // Cups Events
            document.getElementById('timer-cups').addEventListener('click', () => app.tryStartGame('cups'));
            document.getElementById('btn-rules-cups').addEventListener('click', () => app.showRules('cups'));
            document.getElementById('btn-start-cups').addEventListener('click', () => {
                app.switchScreen('screen-game-loader');
                // Optional: Customize loader text
                const tip = document.getElementById('game-tip');
                if(tip) tip.innerText = "Совет: Следи за стаканчиком очень внимательно!";
                
                setTimeout(() => {
                    cupsGame.start();
                }, 2000);
            });
            document.getElementById('btn-cups-back').addEventListener('click', app.showMenu);

            window.addEventListener('resize', () => {
                if(document.getElementById('screen-game').classList.contains('active-screen')) starfallGame.resize();
            });
        },

        loadState: () => {
            const saved = localStorage.getItem('newyear_marathon_save_v2');
            if (saved) {
                const parsed = SECURITY.load(saved);
                if (parsed) {
                    STATE.balance = parsed.balance || 0;
                    STATE.cookies = parsed.cookies || 0;
                    if (parsed.games) {
                        STATE.games.starfall = { ...STATE.games.starfall, ...parsed.games.starfall };
                        STATE.games.roulette = { ...STATE.games.roulette, ...parsed.games.roulette };
                    }
                }
            }
        },

        saveState: () => {
            const encryptedData = SECURITY.save(STATE);
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
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
            document.getElementById(screenId).classList.add('active-screen');
            
            // Backgrounds
            document.body.className = '';
            if (screenId === 'screen-game') document.body.classList.add('bg-starfall');
            if (screenId === 'screen-roulette') document.body.classList.add('bg-roulette');
            if (screenId === 'screen-cups-game') document.body.classList.add('bg-cups');
        },

        showMenu: () => {
            app.updateUI();
            app.switchScreen('screen-menu');
        },

        openRoulette: () => {
            app.switchScreen('screen-roulette');
            rouletteGame.init();
            app.updateUI(); // Ensure buttons/timers are correct
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
            document.getElementById('user-balance').innerText = STATE.balance;
            
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
                rouTimer.innerText = `До следующей игры: ${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
                
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
                        if (display) display.innerText = `До следующей игры: ${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
                        
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
                app.switchScreen('screen-game-loader');
                setTimeout(() => starfallGame.prepare(), 2000);
            }
            if (gameId === 'cups') {
                let cooldown = CONFIG.cups.baseCooldown;
                if (STATE.games.cups.level >= 3) cooldown += (STATE.games.cups.level - 2) * CONFIG.cups.cooldownPerLevel;
                if (now - STATE.games.cups.lastPlayed < cooldown) return;
                cupsGame.prepare();
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
                STATE.balance += reward;
                STATE.games[gameId].lastPlayed = Date.now();
                
                // Max level 12 logic
                if (STATE.games[gameId].level >= 12) {
                     STATE.games[gameId].level = 1;
                } else {
                     STATE.games[gameId].level++;
                }
                
                resultTitle.innerText = "Победа!";
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
            
            app.switchScreen('screen-result');
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
            
            app.switchScreen('screen-result');
        },

        // Roulette Result Handling
        currentReward: null,
        showRouletteReward: (reward) => {
            app.currentReward = reward;
            const modal = document.getElementById('modal-roulette-reward');
            const display = document.getElementById('roulette-reward-display');
            const sellBtn = document.getElementById('btn-sell-reward');
            const modalTitle = modal.querySelector('h3');
            
            // Determine Ded Moroz mood
            let dedImg = 'dedprivet.png';
            let dedMsg = 'Неплохой улов! Поздравляю!';
            
            if (reward.type === 'junk') {
                dedImg = 'dedlose.png';
                dedMsg = 'Ой-ёй... Не расстраивайся, в следующий раз повезет!';
                modalTitle.innerText = "Эх...";
            } else if (reward.id === 'boost') {
                dedImg = 'dedpobeda.png';
                dedMsg = 'Хо-хо-хо! Это Супер-Усиление! В следующей игре Звездопад ты будешь собирать звезды быстрее, а время увеличится! Используй с умом!';
                modalTitle.innerText = "ВОЛШЕБСТВО!";
            } else if (reward.val >= 500 || reward.type === 'extra_spin' || reward.type === 'buff' || reward.type === 'special') {
                dedImg = 'dedpobeda.png';
                dedMsg = 'Вот это удача! Поздравляю!';
                modalTitle.innerText = "Поздравляем!";
            } else {
                modalTitle.innerText = "Поздравляем!";
            }
            
            display.innerHTML = `
                <div style="margin-bottom: 15px;">
                    <img src="${dedImg}" style="width: 100px; height: auto;">
                    <p style="font-size: 0.9rem; font-style: italic; margin-top: 5px; opacity: 0.9;">"${dedMsg}"</p>
                </div>
                <img src="${reward.img}" style="width: 80px; height: 80px; margin-bottom: 10px;">
                <h3 style="color: #ffd700">${reward.name}</h3>
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
            if (r.type === 'currency') STATE.balance += r.val;
            if (r.type === 'extra_spin') STATE.games.roulette.extraSpins += r.val;
            if (r.type === 'buff') STATE.games.starfall.buff = true;
            if (r.type === 'item') STATE.cookies += r.val; // Assuming item is cookie
            
            app.saveState();
            app.closeRouletteModal();
        },
        
        sellReward: () => {
            const r = app.currentReward;
            if (r.sell > 0) {
                STATE.balance += r.sell;
                app.saveState();
                app.closeRouletteModal();
            }
        },
        
        closeRouletteModal: () => {
            document.getElementById('modal-roulette-reward').classList.remove('active');
            app.showMenu();
        }
    };

    window.addEventListener('load', app.init);
})();
