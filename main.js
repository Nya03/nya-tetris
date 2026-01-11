// Main game controller
let multiplayer = null;
let games = new Map(); // playerId -> TetrisGame
let localGame = null;
let isMultiplayer = false;
let gameRunning = false;
let animationId = null;
let playerName = 'Player';

// DOM elements
const menuScreen = document.getElementById('menu');
const gameScreen = document.getElementById('game');
const gameOverScreen = document.getElementById('gameOver');
const gameContainer = document.getElementById('gameContainer');
const roomInfo = document.getElementById('roomInfo');
const myRoomCode = document.getElementById('myRoomCode');
const playerCount = document.getElementById('playerCount');
const playerList = document.getElementById('playerList');
const startGameBtn = document.getElementById('startGame');
const countdown = document.getElementById('countdown');
const results = document.getElementById('results');

// Event listeners
document.getElementById('singlePlayer').addEventListener('click', startSinglePlayer);
document.getElementById('hostGame').addEventListener('click', hostGame);
document.getElementById('joinGame').addEventListener('click', joinGame);
document.getElementById('backToMenu').addEventListener('click', backToMenu);
startGameBtn.addEventListener('click', () => multiplayer?.startGame());

// Keyboard input
const keys = {};
document.addEventListener('keydown', (e) => {
    if (!gameRunning || !localGame) return;

    keys[e.code] = true;

    switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
            localGame.move(-1);
            break;
        case 'ArrowRight':
        case 'KeyD':
            localGame.move(1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            localGame.softDrop();
            break;
        case 'ArrowUp':
        case 'KeyW':
        case 'KeyX':
            localGame.rotate(1);
            break;
        case 'KeyZ':
        case 'ControlLeft':
        case 'ControlRight':
            localGame.rotate(-1);
            break;
        case 'Space':
            localGame.hardDrop();
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
        case 'KeyC':
            localGame.hold();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

// Screen management
function showScreen(screen) {
    menuScreen.classList.remove('active');
    gameScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    screen.classList.add('active');
}

// Single player
function startSinglePlayer() {
    isMultiplayer = false;
    games.clear();

    localGame = new TetrisGame('local', true);
    localGame.onLinesCleared = handleLinesCleared;
    localGame.onGameOver = handleGameOver;
    localGame.onStateChange = () => renderGame(localGame.getState());

    games.set('local', localGame);

    setupGameUI(1);
    showScreen(gameScreen);

    localGame.spawnPiece();
    gameRunning = true;
    gameLoop();
}

// Multiplayer - Host
async function hostGame() {
    playerName = prompt('Enter your name:', 'Host') || 'Host';

    multiplayer = new MultiplayerManager();

    multiplayer.onPlayerJoin = (id, name) => {
        updatePlayerList();
        if (multiplayer.getPlayerCount() >= 2) {
            startGameBtn.classList.remove('hidden');
        }
    };

    multiplayer.onPlayerLeave = (id) => {
        updatePlayerList();
        games.delete(id);
        if (gameRunning) {
            checkWinCondition();
        }
    };

    multiplayer.onGameStart = (seed) => startMultiplayerGame(seed);
    multiplayer.onStateUpdate = (playerId, state) => updateRemotePlayer(playerId, state);
    multiplayer.onPlayerGameOver = (playerId) => handleGameOver(playerId);

    try {
        const code = await multiplayer.hostGame(playerName);
        myRoomCode.textContent = code;
        roomInfo.classList.remove('hidden');
        updatePlayerList();
    } catch (err) {
        alert('Failed to create room: ' + err.message);
    }
}

// Multiplayer - Join
async function joinGame() {
    const code = document.getElementById('roomCode').value.trim();
    if (!code) {
        alert('Please enter a room code');
        return;
    }

    playerName = prompt('Enter your name:', 'Player') || 'Player';

    multiplayer = new MultiplayerManager();

    multiplayer.onPlayerJoin = (id, name) => updatePlayerList();
    multiplayer.onPlayerLeave = (id) => {
        updatePlayerList();
        games.delete(id);
        if (gameRunning) {
            checkWinCondition();
        }
    };
    multiplayer.onGameStart = (seed) => startMultiplayerGame(seed);
    multiplayer.onStateUpdate = (playerId, state) => updateRemotePlayer(playerId, state);
    multiplayer.onGarbageReceived = (lines) => {
        if (localGame && !localGame.gameOver) {
            localGame.addGarbage(lines);
        }
    };
    multiplayer.onPlayerGameOver = (playerId) => handleGameOver(playerId);

    try {
        await multiplayer.joinGame(code, playerName);
        myRoomCode.textContent = code.toUpperCase();
        roomInfo.classList.remove('hidden');
    } catch (err) {
        alert('Failed to join room: ' + err.message);
        multiplayer = null;
    }
}

function updatePlayerList() {
    if (!multiplayer) return;

    const players = multiplayer.getPlayers();
    playerCount.textContent = players.size;

    playerList.innerHTML = '';
    players.forEach((info, id) => {
        const tag = document.createElement('span');
        tag.className = 'player-tag';
        tag.textContent = info.name + (info.isHost ? ' (Host)' : '');
        playerList.appendChild(tag);
    });
}

function startMultiplayerGame(seed) {
    isMultiplayer = true;
    games.clear();

    const players = multiplayer.getPlayers();
    const playerCount = players.size;

    // Create games for all players
    players.forEach((info, id) => {
        const isLocal = id === multiplayer.localPlayerId;
        const game = new TetrisGame(id, isLocal);

        if (isLocal) {
            localGame = game;
            game.onLinesCleared = handleLinesCleared;
            game.onGameOver = handleGameOver;
            game.onStateChange = (state) => {
                renderGame(state);
                multiplayer.sendStateUpdate(state);
            };
        }

        games.set(id, game);
    });

    setupGameUI(playerCount);
    showScreen(gameScreen);

    // Countdown
    let count = 3;
    countdown.classList.remove('hidden');
    countdown.textContent = count;

    const countdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
            countdown.textContent = count;
        } else if (count === 0) {
            countdown.textContent = 'GO!';
        } else {
            clearInterval(countdownInterval);
            countdown.classList.add('hidden');

            // Start all games
            games.forEach(game => game.spawnPiece());
            gameRunning = true;
            gameLoop();
        }
    }, 1000);
}

function setupGameUI(playerCount) {
    gameContainer.innerHTML = '';
    gameContainer.className = `players-${playerCount}`;

    games.forEach((game, playerId) => {
        const isLocal = game.isLocal;
        const playerInfo = multiplayer?.getPlayers().get(playerId);
        const name = playerInfo?.name || (isLocal ? 'You' : 'Player');

        const boardEl = createPlayerBoard(playerId, name, isLocal);
        gameContainer.appendChild(boardEl);
    });

    // Add controls hint
    const hint = document.createElement('div');
    hint.className = 'controls-hint';
    hint.innerHTML = `
        <kbd>←→</kbd> Move &nbsp;
        <kbd>↑</kbd> Rotate &nbsp;
        <kbd>↓</kbd> Soft drop &nbsp;
        <kbd>Space</kbd> Hard drop &nbsp;
        <kbd>Shift</kbd> Hold
    `;
    gameContainer.appendChild(hint);
}

function createPlayerBoard(playerId, name, isLocal) {
    const container = document.createElement('div');
    container.className = 'player-board';
    container.id = `board-${playerId}`;

    const nameEl = document.createElement('div');
    nameEl.className = 'player-name' + (isLocal ? ' you' : '');
    nameEl.textContent = name;
    container.appendChild(nameEl);

    const wrapper = document.createElement('div');
    wrapper.className = 'board-wrapper';

    // Hold piece
    const holdPanel = document.createElement('div');
    holdPanel.className = 'side-panel';

    const holdBox = document.createElement('div');
    holdBox.className = 'hold-piece';
    holdBox.innerHTML = `<div class="panel-label">Hold</div><div class="mini-grid" id="hold-${playerId}"></div>`;
    holdPanel.appendChild(holdBox);

    wrapper.appendChild(holdPanel);

    // Main board
    const board = document.createElement('div');
    board.className = 'tetris-board';
    board.id = `tetris-${playerId}`;

    for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            board.appendChild(cell);
        }
    }
    wrapper.appendChild(board);

    // Next pieces + stats
    const rightPanel = document.createElement('div');
    rightPanel.className = 'side-panel';

    const nextBox = document.createElement('div');
    nextBox.className = 'next-piece';
    nextBox.innerHTML = `<div class="panel-label">Next</div><div class="mini-grid" id="next-${playerId}"></div>`;
    rightPanel.appendChild(nextBox);

    const stats = document.createElement('div');
    stats.className = 'stats';
    stats.id = `stats-${playerId}`;
    stats.innerHTML = `
        <div>Score: <span class="stat-value" id="score-${playerId}">0</span></div>
        <div>Lines: <span class="stat-value" id="lines-${playerId}">0</span></div>
        <div>Level: <span class="stat-value" id="level-${playerId}">1</span></div>
    `;
    rightPanel.appendChild(stats);

    wrapper.appendChild(rightPanel);
    container.appendChild(wrapper);

    return container;
}

function renderGame(state) {
    const boardEl = document.getElementById(`tetris-${state.playerId}`);
    if (!boardEl) return;

    const cells = boardEl.children;

    // Clear board
    for (let i = 0; i < cells.length; i++) {
        cells[i].className = 'cell';
    }

    // Draw placed pieces
    for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 10; x++) {
            if (state.board[y][x]) {
                const idx = y * 10 + x;
                cells[idx].classList.add(state.board[y][x]);
            }
        }
    }

    // Draw ghost piece
    if (state.currentPiece && state.ghostY !== undefined) {
        const shape = state.currentPiece.shape;
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (shape[py][px]) {
                    const boardY = state.ghostY + py;
                    const boardX = state.currentX + px;
                    if (boardY >= 0 && boardY < 20 && boardX >= 0 && boardX < 10) {
                        const idx = boardY * 10 + boardX;
                        if (!cells[idx].classList.contains(state.currentPiece.color)) {
                            cells[idx].classList.add('ghost');
                        }
                    }
                }
            }
        }
    }

    // Draw current piece
    if (state.currentPiece) {
        const shape = state.currentPiece.shape;
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (shape[py][px]) {
                    const boardY = state.currentY + py;
                    const boardX = state.currentX + px;
                    if (boardY >= 0 && boardY < 20 && boardX >= 0 && boardX < 10) {
                        const idx = boardY * 10 + boardX;
                        cells[idx].classList.remove('ghost');
                        cells[idx].classList.add(state.currentPiece.color);
                    }
                }
            }
        }
    }

    // Update hold piece
    renderMiniPiece(`hold-${state.playerId}`, state.holdPiece);

    // Update next piece
    renderMiniPiece(`next-${state.playerId}`, state.nextPieces?.[0]);

    // Update stats
    const scoreEl = document.getElementById(`score-${state.playerId}`);
    const linesEl = document.getElementById(`lines-${state.playerId}`);
    const levelEl = document.getElementById(`level-${state.playerId}`);

    if (scoreEl) scoreEl.textContent = state.score;
    if (linesEl) linesEl.textContent = state.lines;
    if (levelEl) levelEl.textContent = state.level;
}

function renderMiniPiece(elementId, pieceType) {
    const container = document.getElementById(elementId);
    if (!container) return;

    container.innerHTML = '';

    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const cell = document.createElement('div');
            cell.className = 'mini-cell';
            container.appendChild(cell);
        }
    }

    if (!pieceType) return;

    const piece = PIECES[pieceType];
    if (!piece) return;

    const shape = piece.shape;
    const cells = container.children;

    // Center the piece in 4x4 grid
    const offsetY = pieceType === 'I' ? 0 : 0;
    const offsetX = pieceType === 'O' ? 1 : pieceType === 'I' ? 0 : 0;

    for (let py = 0; py < shape.length; py++) {
        for (let px = 0; px < shape[py].length; px++) {
            if (shape[py][px]) {
                const idx = (py + offsetY) * 4 + (px + offsetX);
                if (idx < cells.length) {
                    cells[idx].classList.add(pieceType);
                }
            }
        }
    }
}

function updateRemotePlayer(playerId, state) {
    const game = games.get(playerId);
    if (game && !game.isLocal) {
        game.setState(state);
        renderGame(state);
    }
}

function handleLinesCleared(playerId, lines) {
    if (!isMultiplayer || lines < 2) return;

    // Send garbage to opponents
    const garbageLines = lines === 2 ? 1 : lines === 3 ? 2 : 4;

    games.forEach((game, id) => {
        if (id !== playerId && !game.gameOver) {
            if (game.isLocal) {
                // This shouldn't happen in normal play
            } else {
                multiplayer.sendGarbage(id, garbageLines);
            }
        }
    });
}

function handleGameOver(playerId) {
    const game = games.get(playerId);
    if (game) {
        game.gameOver = true;

        const boardContainer = document.getElementById(`board-${playerId}`);
        if (boardContainer) {
            boardContainer.classList.add('eliminated');
        }
    }

    if (playerId === localGame?.playerId) {
        if (isMultiplayer) {
            multiplayer.sendGameOver();
        }
    }

    checkWinCondition();
}

function checkWinCondition() {
    const alivePlayers = Array.from(games.values()).filter(g => !g.gameOver);

    if (!isMultiplayer && alivePlayers.length === 0) {
        endGame();
    } else if (isMultiplayer && alivePlayers.length <= 1) {
        endGame(alivePlayers[0]?.playerId);
    }
}

function endGame(winnerId = null) {
    gameRunning = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    // Build results
    let resultsHTML = '';

    if (isMultiplayer) {
        const sortedGames = Array.from(games.entries())
            .sort((a, b) => b[1].score - a[1].score);

        sortedGames.forEach(([id, game], index) => {
            const playerInfo = multiplayer?.getPlayers().get(id);
            const name = playerInfo?.name || 'Player';
            const isWinner = id === winnerId;

            resultsHTML += `<div class="result-entry ${isWinner ? 'winner' : ''}">
                ${isWinner ? '👑 ' : ''}${name}: ${game.score} pts
            </div>`;
        });
    } else {
        resultsHTML = `<div class="result-entry">Final Score: ${localGame.score}</div>
                       <div class="result-entry">Lines: ${localGame.lines}</div>
                       <div class="result-entry">Level: ${localGame.level}</div>`;
    }

    results.innerHTML = resultsHTML;
    showScreen(gameOverScreen);
}

function gameLoop(timestamp = 0) {
    if (!gameRunning) return;

    if (localGame && !localGame.gameOver) {
        localGame.update(timestamp);
    }

    animationId = requestAnimationFrame(gameLoop);
}

function backToMenu() {
    gameRunning = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    if (multiplayer) {
        multiplayer.destroy();
        multiplayer = null;
    }

    games.clear();
    localGame = null;

    roomInfo.classList.add('hidden');
    startGameBtn.classList.add('hidden');
    document.getElementById('roomCode').value = '';

    showScreen(menuScreen);
}
