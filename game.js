// Tetris Game Engine
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;

const PIECES = {
    I: {
        shape: [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
        color: 'I'
    },
    O: {
        shape: [[1,1], [1,1]],
        color: 'O'
    },
    T: {
        shape: [[0,1,0], [1,1,1], [0,0,0]],
        color: 'T'
    },
    S: {
        shape: [[0,1,1], [1,1,0], [0,0,0]],
        color: 'S'
    },
    Z: {
        shape: [[1,1,0], [0,1,1], [0,0,0]],
        color: 'Z'
    },
    J: {
        shape: [[1,0,0], [1,1,1], [0,0,0]],
        color: 'J'
    },
    L: {
        shape: [[0,0,1], [1,1,1], [0,0,0]],
        color: 'L'
    }
};

// SRS wall kick data
const WALL_KICKS = {
    'JLSTZ': {
        '0>1': [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
        '1>0': [[0,0], [1,0], [1,-1], [0,2], [1,2]],
        '1>2': [[0,0], [1,0], [1,-1], [0,2], [1,2]],
        '2>1': [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
        '2>3': [[0,0], [1,0], [1,1], [0,-2], [1,-2]],
        '3>2': [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
        '3>0': [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
        '0>3': [[0,0], [1,0], [1,1], [0,-2], [1,-2]]
    },
    'I': {
        '0>1': [[0,0], [-2,0], [1,0], [-2,-1], [1,2]],
        '1>0': [[0,0], [2,0], [-1,0], [2,1], [-1,-2]],
        '1>2': [[0,0], [-1,0], [2,0], [-1,2], [2,-1]],
        '2>1': [[0,0], [1,0], [-2,0], [1,-2], [-2,1]],
        '2>3': [[0,0], [2,0], [-1,0], [2,1], [-1,-2]],
        '3>2': [[0,0], [-2,0], [1,0], [-2,-1], [1,2]],
        '3>0': [[0,0], [1,0], [-2,0], [1,-2], [-2,1]],
        '0>3': [[0,0], [-1,0], [2,0], [-1,2], [2,-1]]
    }
};

class TetrisGame {
    constructor(playerId, isLocal = true) {
        this.playerId = playerId;
        this.isLocal = isLocal;
        this.board = this.createBoard();
        this.currentPiece = null;
        this.currentX = 0;
        this.currentY = 0;
        this.currentRotation = 0;
        this.holdPiece = null;
        this.canHold = true;
        this.nextPieces = [];
        this.bag = [];
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.gameOver = false;
        this.lastDrop = 0;
        this.dropInterval = 1000;
        this.lockDelay = 500;
        this.lockTimer = null;
        this.onLinesCleared = null;
        this.onGameOver = null;
        this.onStateChange = null;

        this.fillBag();
        this.fillNextPieces();
    }

    createBoard() {
        return Array(BOARD_HEIGHT).fill(null).map(() => Array(BOARD_WIDTH).fill(null));
    }

    fillBag() {
        this.bag = Object.keys(PIECES).sort(() => Math.random() - 0.5);
    }

    getNextFromBag() {
        if (this.bag.length === 0) this.fillBag();
        return this.bag.pop();
    }

    fillNextPieces() {
        while (this.nextPieces.length < 3) {
            this.nextPieces.push(this.getNextFromBag());
        }
    }

    spawnPiece() {
        const pieceType = this.nextPieces.shift();
        this.fillNextPieces();

        this.currentPiece = PIECES[pieceType];
        this.currentRotation = 0;
        this.currentX = Math.floor((BOARD_WIDTH - this.currentPiece.shape[0].length) / 2);
        this.currentY = 0;
        this.canHold = true;

        if (!this.isValidPosition(this.currentX, this.currentY, this.currentPiece.shape)) {
            this.gameOver = true;
            if (this.onGameOver) this.onGameOver(this.playerId);
        }

        this.notifyStateChange();
    }

    hold() {
        if (!this.canHold || !this.currentPiece) return;

        const currentType = this.currentPiece.color;

        if (this.holdPiece) {
            const temp = this.holdPiece;
            this.holdPiece = currentType;
            this.currentPiece = PIECES[temp];
        } else {
            this.holdPiece = currentType;
            this.spawnPiece();
            return;
        }

        this.currentRotation = 0;
        this.currentX = Math.floor((BOARD_WIDTH - this.currentPiece.shape[0].length) / 2);
        this.currentY = 0;
        this.canHold = false;

        this.notifyStateChange();
    }

    rotate(direction) {
        if (!this.currentPiece) return false;

        const newRotation = (this.currentRotation + direction + 4) % 4;
        const rotated = this.getRotatedShape(this.currentPiece.shape, direction);

        const kickTable = this.currentPiece.color === 'I' ? WALL_KICKS['I'] : WALL_KICKS['JLSTZ'];
        const kickKey = `${this.currentRotation}>${newRotation}`;
        const kicks = kickTable[kickKey] || [[0,0]];

        for (const [dx, dy] of kicks) {
            if (this.isValidPosition(this.currentX + dx, this.currentY - dy, rotated)) {
                this.currentPiece = { ...this.currentPiece, shape: rotated };
                this.currentX += dx;
                this.currentY -= dy;
                this.currentRotation = newRotation;
                this.resetLockTimer();
                this.notifyStateChange();
                return true;
            }
        }
        return false;
    }

    getRotatedShape(shape, direction) {
        const n = shape.length;
        const rotated = Array(n).fill(null).map(() => Array(n).fill(0));

        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (direction === 1) { // Clockwise
                    rotated[x][n - 1 - y] = shape[y][x];
                } else { // Counter-clockwise
                    rotated[n - 1 - x][y] = shape[y][x];
                }
            }
        }
        return rotated;
    }

    move(dx) {
        if (!this.currentPiece) return false;

        if (this.isValidPosition(this.currentX + dx, this.currentY, this.currentPiece.shape)) {
            this.currentX += dx;
            this.resetLockTimer();
            this.notifyStateChange();
            return true;
        }
        return false;
    }

    softDrop() {
        if (!this.currentPiece) return false;

        if (this.isValidPosition(this.currentX, this.currentY + 1, this.currentPiece.shape)) {
            this.currentY++;
            this.score += 1;
            this.notifyStateChange();
            return true;
        }
        return false;
    }

    hardDrop() {
        if (!this.currentPiece) return;

        let dropDistance = 0;
        while (this.isValidPosition(this.currentX, this.currentY + 1, this.currentPiece.shape)) {
            this.currentY++;
            dropDistance++;
        }
        this.score += dropDistance * 2;
        this.lockPiece();
    }

    getGhostY() {
        if (!this.currentPiece) return this.currentY;

        let ghostY = this.currentY;
        while (this.isValidPosition(this.currentX, ghostY + 1, this.currentPiece.shape)) {
            ghostY++;
        }
        return ghostY;
    }

    isValidPosition(x, y, shape) {
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (shape[py][px]) {
                    const boardX = x + px;
                    const boardY = y + py;

                    if (boardX < 0 || boardX >= BOARD_WIDTH || boardY >= BOARD_HEIGHT) {
                        return false;
                    }

                    if (boardY >= 0 && this.board[boardY][boardX]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    resetLockTimer() {
        if (this.lockTimer) {
            clearTimeout(this.lockTimer);
            this.lockTimer = null;
        }
    }

    lockPiece() {
        if (!this.currentPiece) return;

        const shape = this.currentPiece.shape;
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (shape[py][px]) {
                    const boardY = this.currentY + py;
                    const boardX = this.currentX + px;
                    if (boardY >= 0) {
                        this.board[boardY][boardX] = this.currentPiece.color;
                    }
                }
            }
        }

        this.resetLockTimer();
        const linesCleared = this.clearLines();

        if (linesCleared > 0 && this.onLinesCleared) {
            this.onLinesCleared(this.playerId, linesCleared);
        }

        this.spawnPiece();
    }

    clearLines() {
        let linesCleared = 0;

        for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
            if (this.board[y].every(cell => cell !== null)) {
                this.board.splice(y, 1);
                this.board.unshift(Array(BOARD_WIDTH).fill(null));
                linesCleared++;
                y++; // Check same row again
            }
        }

        if (linesCleared > 0) {
            this.lines += linesCleared;
            this.level = Math.floor(this.lines / 10) + 1;
            this.dropInterval = Math.max(100, 1000 - (this.level - 1) * 80);

            // Scoring
            const lineScores = [0, 100, 300, 500, 800];
            this.score += lineScores[linesCleared] * this.level;
        }

        return linesCleared;
    }

    addGarbage(lines) {
        if (lines <= 0) return;

        const gapX = Math.floor(Math.random() * BOARD_WIDTH);

        for (let i = 0; i < lines; i++) {
            this.board.shift();
            const garbageLine = Array(BOARD_WIDTH).fill('garbage');
            garbageLine[gapX] = null;
            this.board.push(garbageLine);
        }

        // Check if current piece is now invalid
        if (this.currentPiece && !this.isValidPosition(this.currentX, this.currentY, this.currentPiece.shape)) {
            // Try to push up
            while (!this.isValidPosition(this.currentX, this.currentY, this.currentPiece.shape) && this.currentY > 0) {
                this.currentY--;
            }
            if (!this.isValidPosition(this.currentX, this.currentY, this.currentPiece.shape)) {
                this.gameOver = true;
                if (this.onGameOver) this.onGameOver(this.playerId);
            }
        }

        this.notifyStateChange();
    }

    update(timestamp) {
        if (this.gameOver || !this.currentPiece) return;

        if (timestamp - this.lastDrop > this.dropInterval) {
            if (!this.softDrop()) {
                // Piece can't move down, start lock timer
                if (!this.lockTimer) {
                    this.lockTimer = setTimeout(() => {
                        if (!this.isValidPosition(this.currentX, this.currentY + 1, this.currentPiece.shape)) {
                            this.lockPiece();
                        }
                        this.lockTimer = null;
                    }, this.lockDelay);
                }
            }
            this.lastDrop = timestamp;
        }
    }

    notifyStateChange() {
        if (this.onStateChange) {
            this.onStateChange(this.getState());
        }
    }

    getState() {
        return {
            playerId: this.playerId,
            board: this.board,
            currentPiece: this.currentPiece,
            currentX: this.currentX,
            currentY: this.currentY,
            ghostY: this.getGhostY(),
            holdPiece: this.holdPiece,
            nextPieces: this.nextPieces,
            score: this.score,
            lines: this.lines,
            level: this.level,
            gameOver: this.gameOver
        };
    }

    setState(state) {
        this.board = state.board;
        this.currentPiece = state.currentPiece;
        this.currentX = state.currentX;
        this.currentY = state.currentY;
        this.holdPiece = state.holdPiece;
        this.nextPieces = state.nextPieces;
        this.score = state.score;
        this.lines = state.lines;
        this.level = state.level;
        this.gameOver = state.gameOver;
    }
}
