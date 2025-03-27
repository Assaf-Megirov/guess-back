const logger = require('../utils/logger');
const Game = require('../models/Game');
const GameState = require('../types/gameState');
const { loadDictionary, loadLetterTreeSync, getNextTierCombos } = require('../utils/wordUtils');

const games = new Map();
const connectedPlayers = new Map();
const words = loadDictionary();
const letterTree = loadLetterTreeSync();

const POINTS_PER_LETTER = 10;

/**
 * Initializes game-related socket events
 * @param {Object} socket - The socket instance for the connected client
 * @example
 * const io = getIO();
 * io.on('connection', (socket) => {
 *   initializeGameSocket(socket);
 * });
 */
function initializeGameSocket(gameNamespace, authMiddleware) {
    logger.info(`Game Namespace initialized`);

    gameNamespace.use(authMiddleware);
    //expects: auth: token: string | query: gameId: string
    gameNamespace.on("connection", (socket) => {
        const gameId = socket.handshake.query.gameId
        const userId = socket.userId;
        logger.info(`User ${userId} connected to game ${gameId}`);

        //add players to the map at this game
        if(!connectedPlayers.has(gameId)){
            connectedPlayers.set(gameId, new Set());
        }
        connectedPlayers.get(gameId).add(userId);
        
        const game = games.get(gameId);
        if(game && connectedPlayers.get(gameId).size === game.players.length){
            logger.info(`All players connected to game ${gameId}. Starting game...`);
            game.state = GameState.IN_PROGRESS;
            Game.findByIdAndUpdate(gameId, { state: GameState.IN_PROGRESS })
            .then(() => {
                gameNamespace.to(gameId).emit('game_started', { gameId });
            })
            .catch(err => {
                logger.error(`Error updating game state: ${err}`);
            });
        }
        socket.join(gameId);

        socket.on("move", (data) =>{
            const {valid, reason} = isValidWord(games.get(gameId).playerData.get(userId).letters);
            if(!valid){
                gameNamespace.to(gameId).emit("invalid", {by: userId, reason: reason});
            }else{
                const currentGame = games.get(gameId);
                if(++currentGame.playerData.get(userId).points > POINTS_PER_LETTER){
                    //increase the letters for all opponents
                    currentGame.playerData.forEach((data, playerId) => {
                        if (playerId !== userId) {
                            data.letters = incrementLetters(data.letters);
                        }
                    });
                }
                gameNamespace.to(gameId).emit("valid", {by: userId, GameState: currentGame});
            }
        });

        socket.on("written", (data) => {
            games.get(gameId).playerData.get(userId).written = data.written;
            gameNamespace.to(gameId).emit("game_state", games.get(gameId));
        });

        /**
         * Handles game end event
         * @event end_game
         * @param {Object} data - Game end data
         * @example Client: socket.emit('end_game', { gameId: '12345' });
         */
        socket.on('end_game', (data) => {
            logger.info(`Game ended by user: ${socket.userId} for game: ${data.gameId}`);
            //TODO: end game
        });

        /**
         * Handles socket disconnection
         * @event disconnect
         */
        socket.on('disconnect', () => {
            logger.info(`Game socket disconnected for user: ${socket.userId}`);
            if(connectedPlayers.has(gameId)){
                connectedPlayers.get(gameId).delete(userId);
                const game = games.get(gameId);
                if(game && game.state === GameState.IN_PROGRESS){
                    //TODO: handle mid game disconnection
                }
            }
        });
    })
}

/**
 * Creates a new game with the specified players and saves it to the database and the map.
 * 
 * @async
 * @function createGame
 * @param {string} player1Id - The ID of the first player.
 * @param {string} player2Id - The ID of the second player.
 * @returns {Promise<string>} Promise that resolves with the ID of the newly created game.
 * @throws Will throw an error if there is an issue creating the game.
 */
async function createGame(player1Id, player2Id) { //TODO: add support for more than one player here by changing the number of players in the array
    try {
        const newGame = new Game({
            players: [
                { user: player1Id },
                { user: player2Id }
            ],
            state: GameState.NOT_STARTED //waiting for players to join
        });
        const savedGame = await newGame.save();
        const gameId = savedGame._id.toString();
        //TODO: define a gamestate type and use here
        games.set(gameId, {
            id: gameId,
            players: [player1Id, player2Id],
            state: GameState.NOT_STARTED,
            playerData: new Map(),
            elapsedTime: 0
        });
        games.get(gameId).players.forEach(playerId => {
            games.get(gameId).playerData.set(playerId, {
                points: 0,
                letters: "",
                written: ""
            })
        });
        logger.info(`Game created with ID: ${gameId}`);
        return gameId;
    } catch (err) {
        logger.error(`Error creating game: ${err}`);
        throw err;
    }
}

/**
 * Checks if a given word is valid: is it an english word, does it contain at least one instance of all the letters given
 *
 * @param {string} word - The word to validate.
 * @param {string} letters - The letters that the word must contain.
 * @returns {{valid: boolean, reason: string}} An object indicating whether the word is valid and the reason if it is not.
 */
function isValidWord(word, letters){
    const lowerWord = word.toLowerCase();
    const lowerLetters = letters.toLowerCase();

    if(!words.has(lowerWord)){
        return {valid: false, reason: `${word} is not a word!`};
    }
    for (const char of lowerLetters) {
        if (!lowerWord.includes(char)) {
          return {valid: false, reason: `${word} does'nt contain the letter: ${char}!`};
        }
    }
    return {valid: true, reason: ''};
}

function incrementLetters(letters){
    const lowerLetters = letters.toLowerCase();
    const possibleCombos = getNextTierCombos(letterTree, lowerLetters);
    if(!possibleCombos || possibleCombos.length === 0){
        throw new Error('No combinations for: ' + lowerLetters);
    }
    const randomIndex = Math.floor(Math.random() * possibleCombos.length);
    return possibleCombos[randomIndex];
}

module.exports = {
    initializeGameSocket,
    createGame
};