(function() {
    'use strict';

    // --- Security Utilities ---
    const SECURITY = {
        salt: 'HO-HO-HO-SECURE-SALT-2025', // Salt for simple signature
        
        // Simple hash function for integrity check
        hash: (str) => {
            let hash = 0;
            if (str.length === 0) return hash;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash).toString(16);
        },

        // Encode data + signature to Base64
        save: (dataObj) => {
            try {
                const json = JSON.stringify(dataObj);
                const signature = SECURITY.hash(json + SECURITY.salt);
                const packageObj = { d: json, s: signature };
                return btoa(JSON.stringify(packageObj)); // Base64 encode
            } catch (e) {
                console.error("Save error", e);
                return null;
            }
        },

        // Decode and verify signature
        load: (encodedStr) => {
            try {
                const decoded = atob(encodedStr);
                const packageObj = JSON.parse(decoded);
                
                if (!packageObj.d || !packageObj.s) return null;

                // Verify integrity
                const checkSig = SECURITY.hash(packageObj.d + SECURITY.salt);
                if (checkSig !== packageObj.s) {
                    console.warn("Save file tampering detected!");
                    return null; // Invalid signature
                }

                return JSON.parse(packageObj.d);
            } catch (e) {
                console.error("Load error", e);
                return null;
            }
        }
    };

    // --- Game Config & State ---
    const CONFIG = {
        starfall: {
            duration: 60, // seconds
            winScore: 50,
            cooldown: 5 * 60 * 1000, // 5 minutes in ms
            baseReward: 10,
            levelRewardStep: 2,
            baseSpeed: 3,
            speedIncrement: 0.5,
            spawnRate: 60
        }
    };

    const STATE = {
        balance: 0,
        games: {
            starfall: {
                lastPlayed: 0,
                level: 1
            }
        }
    };

    // --- Security & Session State ---
    let sessionGameStartTime = 0;
    let isGameRunning = false;

    // --- Starfall Game Engine ---
    const starfallGame = {
        canvas: null,
        ctx: null,
        isActive: false,
        score: 0,
        timeLeft: 0,
        width: 0,
        height: 0,
        
        // Entities
        player: { x: 0, y: 0, w: 60, h: 60, targetX: 0, targetY: 0 },
        entities: [],
        
        // Images
        imgStar: new Image(),
        imgSock: new Image(),
        imgKaka: new Image(),
        imgSopli: new Image(),
        imgVirus: new Image(),

        init: () => {
            starfallGame.canvas = document.getElementById('gameCanvas');
            starfallGame.ctx = starfallGame.canvas.getContext('2d');
            
            // Load images
            starfallGame.imgStar.src = 'star.png';
            starfallGame.imgSock.src = 'nosok.png';
            starfallGame.imgKaka.src = 'kaka.png';
            starfallGame.imgSopli.src = 'sopli.png';
            starfallGame.imgVirus.src = 'virus.png';
            
            // Touch/Mouse events
            const updatePlayerTarget = (clientX, clientY) => {
                const rect = starfallGame.canvas.getBoundingClientRect();
                let x = clientX - rect.left - starfallGame.player.w / 2;
                let y = clientY - rect.top - starfallGame.player.h / 2;
                
                // Clamp target
                if (x < 0) x = 0;
                if (x > starfallGame.width - starfallGame.player.w) x = starfallGame.width - starfallGame.player.w;
                if (y < 0) y = 0;
                if (y > starfallGame.height - starfallGame.player.h) y = starfallGame.height - starfallGame.player.h;
                
                starfallGame.player.targetX = x;
                starfallGame.player.targetY = y;
            };

            const handleMove = (e) => {
                 if (starfallGame.isActive) {
                    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    if(e.touches) e.preventDefault(); // Prevent scrolling on touch
                    updatePlayerTarget(clientX, clientY);
                 }
            };

            starfallGame.canvas.addEventListener('mousemove', handleMove);
            starfallGame.canvas.addEventListener('touchmove', handleMove, { passive: false });
            starfallGame.canvas.addEventListener('touchstart', handleMove, { passive: false });
        },

        resize: () => {
            const container = document.getElementById('screen-game');
            if (!container) return;
            const maxWidth = container.clientWidth > 500 ? 500 : container.clientWidth - 20;
            starfallGame.width = maxWidth;
            starfallGame.height = window.innerHeight * 0.7; // Adjusted height
            
            if (starfallGame.canvas) {
                starfallGame.canvas.width = starfallGame.width;
                starfallGame.canvas.height = starfallGame.height;
            }

            // Keep player in bounds if resized
            if (starfallGame.player.x > starfallGame.width - starfallGame.player.w) {
                starfallGame.player.x = starfallGame.width - starfallGame.player.w;
            }
            if (starfallGame.player.y > starfallGame.height - starfallGame.player.h) {
                starfallGame.player.y = starfallGame.height - starfallGame.player.h;
            }
        },

        prepare: () => {
            app.switchScreen('screen-game');
            if (!starfallGame.canvas) starfallGame.init();
            
            // Reset player size
            starfallGame.player.w = 60;
            starfallGame.player.h = 60;
            
            starfallGame.resize();
            
            starfallGame.score = 0;
            starfallGame.timeLeft = CONFIG.starfall.duration;
            starfallGame.isActive = false; 
            starfallGame.entities = [];
            
            // Initial Player Pos
            starfallGame.player.x = starfallGame.width / 2 - starfallGame.player.w / 2;
            starfallGame.player.y = starfallGame.height - starfallGame.player.h - 10;
            starfallGame.player.targetX = starfallGame.player.x;
            starfallGame.player.targetY = starfallGame.player.y;

            // Update UI info
            document.getElementById('game-level').innerText = STATE.games.starfall.level;
            document.getElementById('game-score').innerText = 0;
            document.getElementById('game-time').innerText = starfallGame.timeLeft;

            // Draw initial sock
            starfallGame.draw();
            
            // Start Countdown
            starfallGame.startCountdown();
        },

        startCountdown: () => {
            const countdownEl = document.getElementById('game-countdown');
            let count = 3;
            
            const showNum = (num) => {
                countdownEl.innerText = num;
                countdownEl.classList.remove('active');
                void countdownEl.offsetWidth; // trigger reflow
                countdownEl.classList.add('active');
            };

            showNum(3);

            const countInterval = setInterval(() => {
                count--;
                if (count > 0) {
                    showNum(count);
                } else {
                    clearInterval(countInterval);
                    countdownEl.innerText = '';
                    countdownEl.classList.remove('active');
                    starfallGame.start();
                }
            }, 1000);
        },

        start: () => {
            starfallGame.isActive = true;
            isGameRunning = true;
            sessionGameStartTime = Date.now(); // Security timestamp
            starfallGame.entities = []; 
            starfallGame.loop();
            
            // Timer Loop
            const timerInt = setInterval(() => {
                if (!starfallGame.isActive) {
                    clearInterval(timerInt);
                    return;
                }
                starfallGame.timeLeft--;
                document.getElementById('game-time').innerText = starfallGame.timeLeft;
                
                if (starfallGame.timeLeft <= 0) {
                    starfallGame.end(false); 
                    clearInterval(timerInt);
                }
            }, 1000);
        },

        spawnEntity: () => {
            const size = 30;
            const rand = Math.random();
            let type = 'star';
            
            // 20% chance for parasite
            if (rand < 0.2) {
                const parasiteType = Math.random();
                if (parasiteType < 0.33) type = 'kaka';
                else if (parasiteType < 0.66) type = 'sopli';
                else type = 'virus';
            }

            starfallGame.entities.push({
                x: Math.random() * (starfallGame.width - size),
                y: -size,
                size: size,
                type: type,
                speed: CONFIG.starfall.baseSpeed + (60 - starfallGame.timeLeft) / 10 * CONFIG.starfall.speedIncrement
            });
        },

        update: () => {
            // Smooth Movement (Lerp)
            const lerpSpeed = 0.2;
            starfallGame.player.x += (starfallGame.player.targetX - starfallGame.player.x) * lerpSpeed;
            starfallGame.player.y += (starfallGame.player.targetY - starfallGame.player.y) * lerpSpeed;

            // Spawn
            if (Math.random() < 0.05 + (60 - starfallGame.timeLeft) * 0.003) {
                 starfallGame.spawnEntity();
            }

            // Update Entities
            for (let i = starfallGame.entities.length - 1; i >= 0; i--) {
                let s = starfallGame.entities[i];
                s.y += s.speed;

                // Hitbox collision
                const p = starfallGame.player;
                if (
                    s.x < p.x + p.w &&
                    s.x + s.size > p.x &&
                    s.y < p.y + p.h &&
                    s.y + s.size > p.y
                ) {
                    // Collision
                    starfallGame.entities.splice(i, 1);
                    
                    if (s.type === 'star') {
                        starfallGame.score++;
                        // Grow Sock slightly
                        if (starfallGame.player.w < 100) {
                            starfallGame.player.w += 0.5;
                            starfallGame.player.h += 0.5;
                        }
                    } else {
                        starfallGame.score = Math.max(0, starfallGame.score - 5);
                        // Shrink sock
                        starfallGame.player.w = Math.max(40, starfallGame.player.w - 5);
                        starfallGame.player.h = Math.max(40, starfallGame.player.h - 5);
                    }

                    // Update Score UI
                    document.getElementById('game-score').innerText = starfallGame.score;

                    // Check Win
                    if (starfallGame.score >= CONFIG.starfall.winScore) {
                        starfallGame.end(true);
                        return;
                    }

                } else if (s.y > starfallGame.height) {
                    // Missed
                    starfallGame.entities.splice(i, 1);
                }
            }
        },

        draw: () => {
            // Clear
            starfallGame.ctx.clearRect(0, 0, starfallGame.width, starfallGame.height);

            // Draw Player (Sock)
            if (starfallGame.imgSock.complete) {
                starfallGame.ctx.drawImage(starfallGame.imgSock, starfallGame.player.x, starfallGame.player.y, starfallGame.player.w, starfallGame.player.h);
            }

            // Draw Entities
            starfallGame.entities.forEach(s => {
                let img = starfallGame.imgStar;
                if (s.type === 'kaka') img = starfallGame.imgKaka;
                if (s.type === 'sopli') img = starfallGame.imgSopli;
                if (s.type === 'virus') img = starfallGame.imgVirus;

                if (img.complete) {
                    starfallGame.ctx.drawImage(img, s.x, s.y, s.size, s.size);
                } else {
                    // Fallback
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
            app.finishGame('starfall', starfallGame.score, win);
        }
    };

    // --- App Controller ---
    const app = {
        init: () => {
            app.loadState();
            app.createSnow();
            app.updateUI();
            app.startCooldownTicker();
            app.bindEvents();
        },

        bindEvents: () => {
            document.getElementById('btn-start-adventure').addEventListener('click', app.showMenu);
            document.getElementById('timer-starfall').addEventListener('click', () => app.tryStartGame('starfall'));
            document.getElementById('btn-rules-starfall').addEventListener('click', () => app.showRules('starfall'));
            document.getElementById('btn-close-rules').addEventListener('click', app.closeRules);
            document.getElementById('btn-result-menu').addEventListener('click', app.showMenu);

            window.addEventListener('resize', () => {
                if(document.getElementById('screen-game').classList.contains('active-screen')) {
                    starfallGame.resize();
                }
            });
        },

        loadState: () => {
            const saved = localStorage.getItem('newyear_marathon_save');
            if (saved) {
                // Try simple JSON (legacy support) first or Encrypted
                let parsed = null;
                
                // Attempt to parse as new format (Base64)
                parsed = SECURITY.load(saved);
                
                // Fallback for old save files (plain JSON) - One time migration
                if (!parsed) {
                    try {
                        parsed = JSON.parse(saved);
                        // If it lacks our security fields, it's legacy or tampered.
                        // We will accept it once and then save in new format.
                    } catch (e) {
                        console.error("Save file corrupted");
                    }
                }

                if (parsed) {
                    STATE.balance = parsed.balance || 0;
                    if (parsed.games) {
                        STATE.games.starfall = { 
                            ...STATE.games.starfall, 
                            ...parsed.games.starfall 
                        };
                        if (!STATE.games.starfall.level) STATE.games.starfall.level = 1;
                    }
                }
            }
        },

        saveState: () => {
            const encryptedData = SECURITY.save(STATE);
            if (encryptedData) {
                localStorage.setItem('newyear_marathon_save', encryptedData);
            }
        },

        createSnow: () => {
            const container = document.getElementById('snowContainer');
            if (!container) return;
            const snowflakeCount = 30;
            for (let i = 0; i < snowflakeCount; i++) {
                const flake = document.createElement('div');
                flake.className = 'snowflake';
                flake.style.left = Math.random() * 100 + '%';
                flake.style.width = Math.random() * 5 + 2 + 'px';
                flake.style.height = flake.style.width;
                flake.style.animationDuration = Math.random() * 3 + 2 + 's';
                flake.style.animationDelay = Math.random() * 2 + 's';
                container.appendChild(flake);
            }
        },

        switchScreen: (screenId) => {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
            document.getElementById(screenId).classList.add('active-screen');
        },

        showMenu: () => {
            app.updateUI();
            app.switchScreen('screen-menu');
        },

        showRules: (gameId) => {
            const modal = document.getElementById('modal-rules');
            const textContainer = document.getElementById('rules-text');
            
            let rulesHtml = '';
            if (gameId === 'starfall') {
                rulesHtml = `
                    <ol>
                        <li><b>Цель:</b> Собери 50 звезд в носок.</li>
                        <li><b>Управление:</b> Перемещай носок по всей территории пальцем или мышкой.</li>
                        <li><b>Опасности:</b> Избегай "паразитов" (кака, сопли, вирусы)! Если соберешь их, потеряешь 5 звезд.</li>
                        <li><b>Победа:</b> Собери 50 звезд, чтобы победить и повысить уровень!</li>
                        <li><b>Время:</b> У тебя есть 60 секунд.</li>
                    </ol>
                `;
            }
            
            textContainer.innerHTML = rulesHtml;
            modal.classList.add('active');
        },

        closeRules: () => {
            document.getElementById('modal-rules').classList.remove('active');
        },

        updateUI: () => {
            document.getElementById('user-balance').innerText = STATE.balance;
            
            // Update Starfall Card
            const btnText = document.getElementById('timer-starfall');
            const now = Date.now();
            const diff = now - STATE.games.starfall.lastPlayed;
            const remaining = CONFIG.starfall.cooldown - diff;

            if (remaining > 0) {
                btnText.classList.add('cooldown');
                // Timer text updated by ticker
            } else {
                btnText.classList.remove('cooldown');
                btnText.innerText = 'ИГРАТЬ';
            }
        },

        startCooldownTicker: () => {
            setInterval(() => {
                const btnText = document.getElementById('timer-starfall');
                const now = Date.now();
                const diff = now - STATE.games.starfall.lastPlayed;
                const remaining = CONFIG.starfall.cooldown - diff;

                if (remaining > 0) {
                    const minutes = Math.floor(remaining / 60000);
                    const seconds = Math.floor((remaining % 60000) / 1000);
                    btnText.innerText = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                    btnText.classList.add('cooldown');
                } else if (btnText.classList.contains('cooldown')) {
                    app.updateUI(); // Refresh to "PLAY"
                }
            }, 1000);
        },

        tryStartGame: (gameId) => {
            const now = Date.now();
            const lastPlayed = STATE.games[gameId].lastPlayed;
            
            // SECURITY: Double check Cooldown before starting
            if (now - lastPlayed < CONFIG[gameId].cooldown) {
                console.warn("Attempt to bypass cooldown detected.");
                return;
            }

            app.switchScreen('screen-game-loader');
            
            // Simulate loading time
            setTimeout(() => {
                if (gameId === 'starfall') {
                    starfallGame.prepare();
                }
            }, 2000);
        },

        finishGame: (gameId, score, win) => {
            const resultTitle = document.getElementById('result-title');
            const resultImg = document.getElementById('result-ded-img');
            const resultMsg = document.getElementById('result-message');
            const rewardBox = document.getElementById('reward-box');

            // SECURITY: Game time validation
            const gameDuration = Date.now() - sessionGameStartTime;
            const minPossibleTime = 5000; // Minimum 5 seconds to win (impossible to win faster)

            // If player 'won' instantly or manipulated state to skip logic
            if (win && gameDuration < minPossibleTime) {
                console.error("Cheating detected: Game won too fast.");
                win = false; // Revoke win
            }

            if (win) {
                const level = STATE.games[gameId].level;
                const reward = CONFIG[gameId].baseReward + (level - 1) * CONFIG[gameId].levelRewardStep;
                
                STATE.balance += reward;
                STATE.games[gameId].lastPlayed = Date.now();
                STATE.games[gameId].level++;
                app.saveState();

                resultTitle.innerText = "Победа!";
                resultTitle.style.color = "#ffd700";
                resultImg.src = "dedpobeda.png";
                resultMsg.innerText = `Ты собрал все звезды! Твой уровень повышен до ${STATE.games[gameId].level}.`;
                rewardBox.innerHTML = `<span>+${reward}</span> <img src="zima.png" class="currency-icon">`;
                rewardBox.style.display = "inline-flex";
            } else {
                // If they lose, we still update cooldown
                STATE.games[gameId].lastPlayed = Date.now();
                app.saveState();

                resultTitle.innerText = "Ох-ох...";
                resultTitle.style.color = "#ccc";
                resultImg.src = "dedlose.png";
                resultMsg.innerText = "Не расстраивайся! Попробуй снова через 5 минут.";
                rewardBox.style.display = "none";
            }

            app.switchScreen('screen-result');
            app.updateUI();
        }
    };

    // Initialize logic
    window.addEventListener('load', app.init);

})();