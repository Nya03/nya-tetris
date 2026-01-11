// Multiplayer networking with PeerJS
class MultiplayerManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> connection
        this.players = new Map(); // peerId -> playerInfo
        this.isHost = false;
        this.roomCode = null;
        this.localPlayerId = null;
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onGameStart = null;
        this.onStateUpdate = null;
        this.onGarbageReceived = null;
        this.onPlayerGameOver = null;
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    async hostGame(playerName) {
        this.isHost = true;
        this.roomCode = this.generateRoomCode();

        return new Promise((resolve, reject) => {
            this.peer = new Peer('nyatetris-' + this.roomCode, {
                debug: 0
            });

            this.peer.on('open', (id) => {
                this.localPlayerId = id;
                this.players.set(id, { name: playerName, isHost: true });
                resolve(this.roomCode);
            });

            this.peer.on('connection', (conn) => {
                this.handleConnection(conn);
            });

            this.peer.on('error', (err) => {
                if (err.type === 'unavailable-id') {
                    // Room code taken, try another
                    this.peer.destroy();
                    this.roomCode = this.generateRoomCode();
                    this.hostGame(playerName).then(resolve).catch(reject);
                } else {
                    reject(err);
                }
            });
        });
    }

    async joinGame(roomCode, playerName) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();

        return new Promise((resolve, reject) => {
            this.peer = new Peer(undefined, { debug: 0 });

            this.peer.on('open', (id) => {
                this.localPlayerId = id;

                const conn = this.peer.connect('nyatetris-' + this.roomCode, {
                    metadata: { name: playerName }
                });

                conn.on('open', () => {
                    this.handleConnection(conn);
                    resolve();
                });

                conn.on('error', reject);
            });

            this.peer.on('error', (err) => {
                reject(err);
            });

            setTimeout(() => reject(new Error('Connection timeout')), 10000);
        });
    }

    handleConnection(conn) {
        const peerId = conn.peer;

        conn.on('open', () => {
            this.connections.set(peerId, conn);

            if (this.isHost) {
                // Send current player list to new player
                const playerList = Array.from(this.players.entries()).map(([id, info]) => ({
                    id, ...info
                }));

                conn.send({
                    type: 'playerList',
                    players: playerList
                });

                // Add new player
                const playerName = conn.metadata?.name || 'Player';
                this.players.set(peerId, { name: playerName, isHost: false });

                // Broadcast new player to everyone
                this.broadcast({
                    type: 'playerJoin',
                    playerId: peerId,
                    playerName: playerName
                });

                if (this.onPlayerJoin) {
                    this.onPlayerJoin(peerId, playerName);
                }
            }
        });

        conn.on('data', (data) => {
            this.handleMessage(peerId, data);
        });

        conn.on('close', () => {
            this.connections.delete(peerId);
            this.players.delete(peerId);

            if (this.isHost) {
                this.broadcast({
                    type: 'playerLeave',
                    playerId: peerId
                });
            }

            if (this.onPlayerLeave) {
                this.onPlayerLeave(peerId);
            }
        });
    }

    handleMessage(fromId, data) {
        switch (data.type) {
            case 'playerList':
                // Received from host when joining
                data.players.forEach(p => {
                    this.players.set(p.id, { name: p.name, isHost: p.isHost });
                });
                if (this.onPlayerJoin) {
                    this.players.forEach((info, id) => {
                        this.onPlayerJoin(id, info.name);
                    });
                }
                break;

            case 'playerJoin':
                this.players.set(data.playerId, { name: data.playerName, isHost: false });
                if (this.onPlayerJoin) {
                    this.onPlayerJoin(data.playerId, data.playerName);
                }
                break;

            case 'playerLeave':
                this.players.delete(data.playerId);
                if (this.onPlayerLeave) {
                    this.onPlayerLeave(data.playerId);
                }
                break;

            case 'gameStart':
                if (this.onGameStart) {
                    this.onGameStart(data.seed);
                }
                break;

            case 'stateUpdate':
                if (this.onStateUpdate) {
                    this.onStateUpdate(data.playerId, data.state);
                }
                break;

            case 'garbage':
                if (this.onGarbageReceived) {
                    this.onGarbageReceived(data.lines);
                }
                break;

            case 'gameOver':
                if (this.onPlayerGameOver) {
                    this.onPlayerGameOver(data.playerId);
                }
                break;
        }

        // Host relays messages to other players
        if (this.isHost && ['stateUpdate', 'gameOver'].includes(data.type)) {
            this.broadcast(data, fromId);
        }
    }

    broadcast(data, excludeId = null) {
        this.connections.forEach((conn, peerId) => {
            if (peerId !== excludeId) {
                conn.send(data);
            }
        });
    }

    send(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn) {
            conn.send(data);
        }
    }

    sendToHost(data) {
        if (this.isHost) {
            // We are the host, handle locally
            this.handleMessage(this.localPlayerId, data);
        } else {
            // Send to host
            const hostId = 'nyatetris-' + this.roomCode;
            const conn = this.connections.get(hostId);
            if (conn) {
                conn.send(data);
            }
        }
    }

    startGame() {
        if (!this.isHost) return;

        const seed = Math.floor(Math.random() * 1000000);
        this.broadcast({ type: 'gameStart', seed });
        if (this.onGameStart) {
            this.onGameStart(seed);
        }
    }

    sendStateUpdate(state) {
        const data = {
            type: 'stateUpdate',
            playerId: this.localPlayerId,
            state: state
        };

        if (this.isHost) {
            this.broadcast(data);
        } else {
            this.sendToHost(data);
        }
    }

    sendGarbage(targetId, lines) {
        if (this.isHost) {
            this.send(targetId, { type: 'garbage', lines });
        } else {
            this.sendToHost({
                type: 'garbageSend',
                targetId,
                lines
            });
        }
    }

    sendGameOver() {
        const data = {
            type: 'gameOver',
            playerId: this.localPlayerId
        };

        if (this.isHost) {
            this.broadcast(data);
        } else {
            this.sendToHost(data);
        }
    }

    getPlayerCount() {
        return this.players.size;
    }

    getPlayers() {
        return this.players;
    }

    destroy() {
        if (this.peer) {
            this.peer.destroy();
        }
        this.connections.clear();
        this.players.clear();
    }
}
