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

    getPeerConfig() {
        return {
            host: '0.peerjs.com',
            port: 443,
            secure: true,
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        };
    }

    async hostGame(playerName) {
        this.isHost = true;
        this.roomCode = this.generateRoomCode();

        return new Promise((resolve, reject) => {
            const peerId = 'nyatetris-' + this.roomCode;
            console.log('Hosting with peer ID:', peerId);

            this.peer = new Peer(peerId, this.getPeerConfig());

            this.peer.on('open', (id) => {
                console.log('Host peer opened with ID:', id);
                this.localPlayerId = id;
                this.players.set(id, { name: playerName, isHost: true });
                resolve(this.roomCode);
            });

            this.peer.on('connection', (conn) => {
                console.log('Incoming connection from:', conn.peer);
                this.handleConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('Host peer error:', err);
                if (err.type === 'unavailable-id') {
                    // Room code taken, try another
                    this.peer.destroy();
                    this.roomCode = this.generateRoomCode();
                    this.hostGame(playerName).then(resolve).catch(reject);
                } else {
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                console.log('Host disconnected, attempting reconnect...');
                this.peer.reconnect();
            });
        });
    }

    async joinGame(roomCode, playerName) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase().trim();

        return new Promise((resolve, reject) => {
            let resolved = false;
            let retryCount = 0;
            const maxRetries = 2;

            const attemptConnection = () => {
                this.peer = new Peer(undefined, this.getPeerConfig());

                this.peer.on('open', (id) => {
                    console.log('Joiner peer opened with ID:', id);
                    this.localPlayerId = id;

                    const hostId = 'nyatetris-' + this.roomCode;
                    console.log('Attempting connection to host:', hostId, '(attempt', retryCount + 1, ')');

                    const conn = this.peer.connect(hostId, {
                        metadata: { name: playerName },
                        reliable: true,
                        serialization: 'json'
                    });

                    const connectionTimeout = setTimeout(() => {
                        if (!resolved && !conn.open) {
                            console.log('Connection attempt timed out');
                            conn.close();
                            if (retryCount < maxRetries) {
                                retryCount++;
                                this.peer.destroy();
                                console.log('Retrying connection...');
                                setTimeout(attemptConnection, 1000);
                            } else {
                                resolved = true;
                                reject(new Error('Connection timeout - could not reach host. Check if host is still waiting.'));
                            }
                        }
                    }, 8000);

                    conn.on('open', () => {
                        clearTimeout(connectionTimeout);
                        console.log('Connection opened to host!');
                        if (!resolved) {
                            resolved = true;
                            this.handleConnection(conn);
                            resolve();
                        }
                    });

                    conn.on('error', (err) => {
                        clearTimeout(connectionTimeout);
                        console.error('Connection error:', err);
                        if (!resolved) {
                            resolved = true;
                            reject(err);
                        }
                    });
                });

                this.peer.on('error', (err) => {
                    console.error('Joiner peer error:', err.type, err);
                    if (!resolved) {
                        resolved = true;
                        if (err.type === 'peer-unavailable') {
                            reject(new Error('Room "' + this.roomCode + '" not found. Check the code and make sure host is waiting.'));
                        } else if (err.type === 'network') {
                            reject(new Error('Network error - check your internet connection'));
                        } else if (err.type === 'server-error') {
                            reject(new Error('Server error - PeerJS server may be down, try again'));
                        } else {
                            reject(new Error(err.type + ': ' + err.message));
                        }
                    }
                });
            };

            attemptConnection();
        });
    }

    handleConnection(conn) {
        const peerId = conn.peer;
        console.log('Handling connection for peer:', peerId, 'Connection open:', conn.open);

        // For incoming connections (host receiving), connection might already be open
        // For outgoing connections (joiner connecting), we call this after open event

        const setupConnection = () => {
            this.connections.set(peerId, conn);
            console.log('Connection stored for peer:', peerId);

            if (this.isHost) {
                // Send current player list to new player
                const playerList = Array.from(this.players.entries()).map(([id, info]) => ({
                    id, ...info
                }));

                console.log('Sending player list to new player:', playerList);
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
        };

        if (conn.open) {
            setupConnection();
        } else {
            conn.on('open', setupConnection);
        }

        conn.on('data', (data) => {
            console.log('Received data from', peerId, ':', data.type);
            this.handleMessage(peerId, data);
        });

        conn.on('close', () => {
            console.log('Connection closed for peer:', peerId);
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

        conn.on('error', (err) => {
            console.error('Connection error for peer:', peerId, err);
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
