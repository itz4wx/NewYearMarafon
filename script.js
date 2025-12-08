// --- Game Config & State ---
const CONFIG = {
    starfall: {
        duration: 60, // seconds
        winScore: 50,
        cooldown: 5 * 60 * 1000, // 5 minutes in ms
        reward: 10,
        baseSpeed: 3,
        speedIncrement: 0.5, // Speed increase every 10 sec
        spawnRate: 60 // frames between spawns (approx 1 sec at 60fps)
    }
};

const STATE = {
    balance: 0,
    games: {
        starfall: {
            lastPlayed: 0
        }
    }
};

// --- App Controller ---
const app = {
    init: () => {
        app.loadState();
        app.createSnow();
        app.updateUI();
        app.startCooldownTicker();
    },

    loadState: () => {
        const saved = localStorage.getItem('newyear_marathon_save');
        if (saved) {
            const parsed = JSON.parse(saved);
            STATE.balance = parsed.balance || 0;
            STATE.games = parsed.games || STATE.games;
        }
    },

    saveState: () => {
        localStorage.setItem('newyear_marathon_save', JSON.stringify(STATE));
    },

    createSnow: () => {
        const container = document.getElementById('snowContainer');
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
        
        if (now - lastPlayed < CONFIG[gameId].cooldown) {
            return;
        }

        app.switchScreen('screen-game-loader');
        
        // Simulate loading time
        setTimeout(() => {
            if (gameId === 'starfall') {
                starfallGame.start();
            }
        }, 2000);
    },

    finishGame: (gameId, score, win) => {
        const resultTitle = document.getElementById('result-title');
        const resultImg = document.getElementById('result-ded-img');
        const resultMsg = document.getElementById('result-message');
        const rewardBox = document.getElementById('reward-box');

        if (win) {
            STATE.balance += CONFIG[gameId].reward;
            STATE.games[gameId].lastPlayed = Date.now();
            app.saveState();

            resultTitle.innerText = "Победа!";
            resultTitle.style.color = "#ffd700";
            resultImg.src = "dedpobeda.png";
            resultMsg.innerText = "Ты отлично справился! Дети получат свои звездочки.";
            rewardBox.style.display = "inline-flex";
        } else {
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

// --- Starfall Game Engine ---
const starfallGame = {
    canvas: null,
    ctx: null,
    isActive: false,
    score: 0,
    timeLeft: 0,
    width: 0,
    height: 0,
    loopId: null,
    
    // Entities
    player: { x: 0, y: 0, w: 60, h: 60, targetX: 0 },
    stars: [],
    
    // Images
    imgStar: new Image(),
    imgSock: new Image(),

    init: () => {
        starfallGame.canvas = document.getElementById('gameCanvas');
        starfallGame.ctx = starfallGame.canvas.getContext('2d');
        
        // Load images
        starfallGame.imgStar.src = 'star.png';
        starfallGame.imgSock.src = 'nosok.png';
        
        // Touch/Mouse events
        const updatePlayerTarget = (clientX) => {
            const rect = starfallGame.canvas.getBoundingClientRect();
            let x = clientX - rect.left - starfallGame.player.w / 2;
            
            // Clamp target
            if (x < 0) x = 0;
            if (x > starfallGame.width - starfallGame.player.w) x = starfallGame.width - starfallGame.player.w;
            
            starfallGame.player.targetX = x;
        };

        starfallGame.canvas.addEventListener('mousemove', (e) => {
            if (starfallGame.isActive) updatePlayerTarget(e.clientX);
        });

        starfallGame.canvas.addEventListener('touchmove', (e) => {
            if (starfallGame.isActive) {
                e.preventDefault();
                updatePlayerTarget(e.touches[0].clientX);
            }
        }, { passive: false });

        starfallGame.canvas.addEventListener('touchstart', (e) => {
             if (starfallGame.isActive) {
                e.preventDefault();
                updatePlayerTarget(e.touches[0].clientX);
            }
        }, { passive: false });
    },

    resize: () => {
        const container = document.getElementById('screen-game');
        const maxWidth = container.clientWidth > 500 ? 500 : container.clientWidth - 20;
        starfallGame.width = maxWidth;
        starfallGame.height = window.innerHeight * 0.65;
        
        starfallGame.canvas.width = starfallGame.width;
        starfallGame.canvas.height = starfallGame.height;

        // Reset player Y
        starfallGame.player.y = starfallGame.height - starfallGame.player.h - 10;
        
        // Keep player in bounds if resized
        if (starfallGame.player.x > starfallGame.width - starfallGame.player.w) {
            starfallGame.player.x = starfallGame.width - starfallGame.player.w;
        }
    },

    start: () => {
        app.switchScreen('screen-game');
        starfallGame.init();
        
        // Reset player size
        starfallGame.player.w = 60;
        starfallGame.player.h = 60;
        
        starfallGame.resize();
        
        starfallGame.score = 0;
        starfallGame.timeLeft = CONFIG.starfall.duration;
        starfallGame.isActive = true;
        starfallGame.stars = [];
        
        // Initial Player Pos
        starfallGame.player.x = starfallGame.width / 2 - starfallGame.player.w / 2;
        starfallGame.player.targetX = starfallGame.player.x;

        starfallGame.loop();
        
        // Timer Loop
        const timerInt = setInterval(() => {
            if (!starfallGame.isActive) {
                clearInterval(timerInt);
                return;
            }
            starfallGame.timeLeft--;
            document.getElementById('game-time').innerText = starfallGame.timeLeft;
            document.getElementById('game-score').innerText = starfallGame.score;

            if (starfallGame.timeLeft <= 0) {
                starfallGame.end();
                clearInterval(timerInt);
            }
        }, 1000);
    },

    spawnStar: () => {
        const size = 30;
        starfallGame.stars.push({
            x: Math.random() * (starfallGame.width - size),
            y: -size,
            size: size,
            speed: CONFIG.starfall.baseSpeed + (60 - starfallGame.timeLeft) / 10 * CONFIG.starfall.speedIncrement
        });
    },

    update: () => {
        // Smooth Movement (Lerp)
        const lerpSpeed = 0.2;
        starfallGame.player.x += (starfallGame.player.targetX - starfallGame.player.x) * lerpSpeed;

        // Spawn
        if (Math.random() < 0.05 + (60 - starfallGame.timeLeft) * 0.003) {
             starfallGame.spawnStar();
        }

        // Update Stars
        for (let i = starfallGame.stars.length - 1; i >= 0; i--) {
            let s = starfallGame.stars[i];
            s.y += s.speed;

            // Collision with Sock Opening (Top part of the sock)
            // Assuming sock image is roughly rectangular, we want stars to fall "in"
            // So we check if the star's bottom center hits the top opening of the sock
            const starBottomX = s.x + s.size / 2;
            const starBottomY = s.y + s.size;
            
            // Hitbox for the opening: Top 30% of the sock, slightly inset horizontally
            const sockTop = starfallGame.player.y;
            const sockOpeningHeight = starfallGame.player.h * 0.4; 
            const sockLeft = starfallGame.player.x + starfallGame.player.w * 0.2;
            const sockRight = starfallGame.player.x + starfallGame.player.w * 0.8;

            if (
                starBottomY > sockTop &&
                starBottomY < sockTop + sockOpeningHeight &&
                starBottomX > sockLeft &&
                starBottomX < sockRight
            ) {
                // Caught!
                starfallGame.score++;
                starfallGame.stars.splice(i, 1);
                document.getElementById('game-score').innerText = starfallGame.score;

                // Grow Sock
                starfallGame.player.w += 1;
                starfallGame.player.h += 1;
                // Re-center slightly to keep smoothness
                starfallGame.player.x -= 0.5;
                starfallGame.player.y = starfallGame.height - starfallGame.player.h - 10;

            } else if (s.y > starfallGame.height) {
                // Missed
                starfallGame.stars.splice(i, 1);
            }
        }
    },

    draw: () => {
        // Clear
        starfallGame.ctx.clearRect(0, 0, starfallGame.width, starfallGame.height);

        // Draw Player (Sock)
        if (starfallGame.imgSock.complete) {
            starfallGame.ctx.drawImage(starfallGame.imgSock, starfallGame.player.x, starfallGame.player.y, starfallGame.player.w, starfallGame.player.h);
        } else {
            starfallGame.ctx.fillStyle = '#ff3d3d';
            starfallGame.ctx.fillRect(starfallGame.player.x, starfallGame.player.y, starfallGame.player.w, starfallGame.player.h);
        }

        // Draw Stars
        starfallGame.ctx.fillStyle = '#ffd700';
        starfallGame.ctx.shadowBlur = 10;
        starfallGame.ctx.shadowColor = "white";
        
        starfallGame.stars.forEach(s => {
            if (starfallGame.imgStar.complete) {
                starfallGame.ctx.drawImage(starfallGame.imgStar, s.x, s.y, s.size, s.size);
            } else {
                starfallGame.ctx.beginPath();
                starfallGame.ctx.arc(s.x + s.size/2, s.y + s.size/2, s.size/2, 0, Math.PI * 2);
                starfallGame.ctx.fill();
            }
        });
        
        starfallGame.ctx.shadowBlur = 0;
    },

    loop: () => {
        if (!starfallGame.isActive) return;

        starfallGame.update();
        starfallGame.draw();
        requestAnimationFrame(starfallGame.loop);
    },

    end: () => {
        starfallGame.isActive = false;
        const won = starfallGame.score >= CONFIG.starfall.winScore;
        app.finishGame('starfall', starfallGame.score, won);
    }
};

// Initialize
window.onload = app.init;
window.onresize = () => {
    if(starfallGame.isActive) starfallGame.resize();
};
