const gameModule = require("./gameSocket");
const logger = require("../utils/logger");
const Guest = require("../models/Guest");

const lobbies = new Map(); //{lobbyCode: string, {players: {playerId: string, username: string, ready: boolean}[], admin: {playerId: string, username: string}}}
const socketToUser = new Map(); //{socketId: string, playerId: string}

function generateLobbyCode(length = 4){
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}
function generateUniqueLobbyCode(existingCodes, length=4) {
    let code = generateLobbyCode(length);
    while (existingCodes.includes(code)) {
        code = generateLobbyCode(length);
    }
    return code;
}
function validateCodeSyntax(code) {
    const regex = /^[a-zA-Z0-9]{4}$/;
    return regex.test(code);
}

function broadcastLobbyState(namespace, lobbyCode) {
    const lobby = lobbies.get(lobbyCode);
    if (lobby) {
        namespace.to(lobbyCode).emit('lobby_state', {
            code: lobbyCode,
            players: lobby.players,
            admin: lobby.admin
        });
    }
}

function initializeLobbySocket(lobbyNamespace) {
    logger.info(`Lobby Namespace initialized`);
    lobbyNamespace.on("connection", (socket) => {
        const playerId = socket.handshake.auth.playerId;
        socketToUser.set(socket.id, playerId);
        logger.info(`User ${playerId} connected to lobby namespace`);

        socket.on('create_lobby', (data) => {
            const code = generateUniqueLobbyCode(Array.from(lobbies.keys()));
            lobbies.set(code, {players: [], admin: {playerId: playerId, username: data.username}}); //the admin is still expected to join the lobby via the join_lobby event
            logger.info(`Lobby created with code ${code}`); 
            socket.emit('lobby_created', {code});
        });

        socket.on('join_lobby', async (data) => {
            const code = data.code;
            logger.info(`User ${playerId} trying to join lobby ${code}`);
            if(!validateCodeSyntax(code)){
                logger.warn(`User tried to join invalid lobby code ${code}`);
                socket.emit('invalid_lobby_code', {code});
                return;
            }
            const username = data.username;
            const lobby = lobbies.get(code);
            if(!lobby){
                logger.warn(`User ${playerId} tried to join non-existent lobby ${code}`);
                socket.emit('lobby_not_found', {code});
                return;
            }
            const playerIndex = lobby.players.findIndex(player => player.playerId === playerId);
            if(playerIndex === -1) {
                lobby.players.push({playerId, username, ready: false});
            }
            socket.join(code);
            socket.emit('joined_lobby', {code, players: lobby.players, admin: lobby.admin});
            broadcastLobbyState(lobbyNamespace, code);
            logger.info(`User ${playerId} joined lobby ${code}`);
            try{
                const guest = await Guest.findOne({guestId: playerId});
                if(guest){
                    guest.username = username;
                    await guest.save();
                }
            } catch (error) {
                logger.error(`Error saving guests ${playerId} username ${username}: ${error}`);
            }
        });

        socket.on('ready', async (data) => {
            const code = data.code;
            const playerId = data.playerId;
            if(!validateCodeSyntax(code)){
                logger.warn(`User tried to ready up in invalid lobby code ${code}`);
                socket.emit('invalid_lobby_code', {code});
                return;
            }
            const lobby = lobbies.get(code);
            if(!lobby){
                logger.warn(`User ${playerId} tried to ready up in non-existent lobby ${code}`);
                socket.emit('lobby_not_found', {code});
                return;
            }
            const playerIndex = lobby.players.findIndex(player => player.playerId === playerId);
            if(playerIndex === -1) {
                logger.warn(`User ${playerId} tried to ready up in lobby ${code} that they are not in`);
                socket.emit('lobby_not_found', {code});
                return;
            }

            lobby.players[playerIndex].ready = true;
            broadcastLobbyState(lobbyNamespace, code);
            logger.info(`User ${playerId} is ready in lobby ${code}`);

            const allPlayersReady = lobby.players.every(player => player.ready === true);
            if(allPlayersReady && lobby.players.length > 1){
                logger.info(`All players are ready in lobby ${code}, starting game...`);
                const gameId = await gameModule.createGame(lobby.players.map(player => player.playerId));
                lobbyNamespace.to(code).emit('start_game', {gameId});
                //TODO: keep lobby alive until:
                //game is over and then after a timeout(to allow for players to either leave or choose to stay)
                //check if any players have reconnected to the lobby and if not, delete the lobby
            }
        });

        socket.on('unready', (data) => {
            const code = data.code;
            const playerId = data.playerId;
            if(!validateCodeSyntax(code)){
                logger.warn(`User tried to unready in invalid lobby code ${code}`);
                socket.emit('invalid_lobby_code', {code});                
                return;
            }
            const lobby = lobbies.get(code);
            if(!lobby){
                logger.warn(`User ${playerId} tried to unready in non-existent lobby ${code}`);
                socket.emit('lobby_not_found', {code});
                return;
            }
            const playerIndex = lobby.players.findIndex(player => player.playerId === playerId);
            if(playerIndex === -1) {
                logger.warn(`User ${playerId} tried to unready in lobby ${code} that they are not in`);
                socket.emit('lobby_not_found', {code});
                return;
            }

            lobby.players[playerIndex].ready = false;
            broadcastLobbyState(lobbyNamespace, code);
            logger.info(`User ${playerId} is unready in lobby ${code}`);
        });

        socket.on('leave_lobby', (data) => {
            const code = data.code;
            const playerId = data.playerId;
            if(!validateCodeSyntax(code)){
                logger.warn(`User tried to leave invalid lobby code ${code}`);
                socket.emit('invalid_lobby_code', {code});
                return;
            }
            const lobby = lobbies.get(code);
            if(!lobby){
                logger.warn(`User ${playerId} tried to leave non-existent lobby ${code}`);
                socket.emit('lobby_not_found', {code});
                return;
            }
            const playerIndex = lobby.players.findIndex(player => player.playerId === playerId);
            if(playerIndex === -1) {
                logger.warn(`User ${playerId} tried to leave lobby ${code} that they are not in`);
                socket.emit('lobby_not_found', {code});
                return;
            }
            socket.leave(code);
            lobby.players.splice(playerIndex, 1);
            broadcastLobbyState(lobbyNamespace, code);
            logger.info(`User ${playerId} left lobby ${code}`);
        });

        socket.on('start_game', async (data) => {
            const code = data.code;
            const playerId = data.playerId;
            if(!validateCodeSyntax(code)){
                logger.warn(`User tried to start game in invalid lobby code ${code}`);
                socket.emit('invalid_lobby_code', {code});
                return;
            }
            const lobby = lobbies.get(code);
            if(!lobby){
                logger.warn(`User ${playerId} tried to start game in non-existent lobby ${code}`);
                socket.emit('lobby_not_found', {code});
                return;
            }
            if(playerId !== lobby.admin.playerId){
                logger.warn(`User ${playerId} tried to start game in lobby ${code} that they are not the admin`);
                socket.emit('not_admin', {code});
                return;
            }
            if(lobby.players.length < 2){
                logger.warn(`User ${playerId} tried to start game in lobby ${code} with less than 2 players`);
                socket.emit('not_enough_players', {code});
                return;
            }
            const gameId = await gameModule.createGame(lobby.players.map(player => player.playerId));
            lobbyNamespace.to(code).emit('start_game', {gameId});
            //TODO: keep lobby alive until:
            //game is over and then after a timeout(to allow for players to either leave or choose to stay)
            //check if any players have reconnected to the lobby and if not, delete the lobby
        });

        socket.on('disconnect', () => {
            const socketId = socket.id;
            const playerId = socketToUser.get(socketId);
            if(playerId){
                socketToUser.delete(socketId);
                lobbies.forEach((lobby, lobbyCode) => {
                    const playerIndex = lobby.players.findIndex(player => player.playerId === playerId);
                    if(playerIndex !== -1){
                        socket.leave(lobbyCode);
                        lobby.players.splice(playerIndex, 1);
                        logger.info(`User ${playerId} left lobby ${lobbyCode}`);
                        broadcastLobbyState(lobbyNamespace, lobbyCode);
                    }
                })
                logger.info(`User ${playerId} disconnected from socket ${socketId}`);
            }
        });
    });
}

module.exports = {initializeLobbySocket};