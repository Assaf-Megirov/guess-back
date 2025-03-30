const logger = require('../utils/logger');
const Game = require('../models/Game');
const GameState = require('../types/gameState');
const { loadDictionary, loadLetterTreeSync, getNextTierCombos } = require('../utils/wordUtils');

const games = new Map();
const connectedPlayers = new Map();
const gameTimers = new Map();
const words = loadDictionary();
const letterTree = loadLetterTreeSync();

const POINTS_PER_LETTER = 10;
const GAME_START_DELAY = 2000;
const ELAPSED_TIME_INTERVAL = 1000; //1 second
const GAME_END_TIME = 1 * 60 //1 minutes

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
        const gameId = socket.gameId;
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

            game.startTime = Date.now();
            game.elapsedTime = 0;
            gameTimers.set(gameId, setInterval(() => {
                const currentGame = games.get(gameId);
                if (currentGame) {
                    currentGame.elapsedTime = Math.floor((Date.now() - currentGame.startTime) / 1000);

                    if(currentGame.elapsedTime >= GAME_END_TIME){
                        logger.info(`Game ${gameId} ended after ${currentGame.elapsedTime} seconds`);
                        endGame(gameId, gameNamespace);
                        clearInterval(gameTimers.get(gameId));
                        gameTimers.delete(gameId);
                    }
                }
            }, ELAPSED_TIME_INTERVAL));

            Game.findByIdAndUpdate(gameId, { state: GameState.IN_PROGRESS })
            .then(() => {
                setTimeout(() => {  //add delay to allow for all players to register for events before emitting them
                    distributeLetters(game);
                    gameNamespace.to(gameId).emit('game_started', { gameId });
                    logger.info(`Game ${gameId} started after delay`);
                }, GAME_START_DELAY);
            })
            .catch(err => {
                logger.error(`Error updating game state: ${err}`);
            });
        }
        socket.join(gameId);

        socket.on("move", (data) =>{
            logger.info(`User ${userId} submitted move: ${data}`);
            const {valid, reason} = isValidWord( data,games.get(gameId).playerData.get(userId).letters);
            if(!valid){
                gameNamespace.to(gameId).emit("invalid", {by: userId, reason: reason});
                logger.info(`Move from user ${userId} is invalid because: ${reason}`);
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
                currentGame.playerData.get(userId).words.push(data);
                gameNamespace.to(gameId).emit("valid", {by: userId, GameState: currentGame});
                logger.info(`Move from user ${userId} is valid`);
            }
        });

        socket.on("written", (data) => {
            logger.info(`User ${userId} wrote: ${data}`);
            games.get(gameId).playerData.get(userId).written = data;
            const game = games.get(gameId);
            const serializableGame = {
            ...game,
            playerData: Object.fromEntries(game.playerData)
            };
            gameNamespace.to(gameId).emit("game_state", serializableGame);
        });

        /**
         * Handles game end event
         * @event end_game
         * @param {Object} data - Game end data
         * @example Client: socket.emit('end_game', { gameId: '12345' });
         */
        socket.on('end_game', (data) => {
            logger.info(`Game ended by user: ${socket.userId} for game: ${data.gameId}`);
            //TODO: end game and clear intervals
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
                if(connectedPlayers.get(gameId).size === 0) {
                    if (gameTimers.has(gameId)) {
                        clearInterval(gameTimers.get(gameId));
                        gameTimers.delete(gameId);
                        logger.info(`Cleared elapsed time tracking for game ${gameId} after all players disconnected`);
                    }
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
            logger.info(`Adding playerData ${playerId} to game ${gameId}`);
            games.get(gameId).playerData.set(playerId, {
                points: 0,
                letters: "",
                written: "",
                words: []
            })
        });
        logger.info(`GameData: ${JSON.stringify({
            ...games.get(gameId),
            playerData: Array.from(games.get(gameId).playerData.entries())
        })}`);
        logger.info(`Game created with ID: ${gameId}`);
        return gameId;
    } catch (err) {
        logger.error(`Error creating game: ${err}`);
        throw err;
    }
}

function endGame(gameId, namespace) {
    const game = games.get(gameId);
    if (!game) return;

    game.state = GameState.FINISHED;
    let winner = null;
    let highestScore = -1;
    game.playerData.forEach((data, playerId) => {
        if (data.points > highestScore) {
            highestScore = data.points;
            winner = playerId;
        }
    });
    const gameResults = {
        gameId: gameId,
        elapsedTime: game.elapsedTime,
        winner: winner,
        scores: Object.fromEntries(
            Array.from(game.playerData.entries()).map(([id, data]) => [id, data.points])
        )
    };
    namespace.to(gameId).emit('game_ended', gameResults);
    Game.findByIdAndUpdate(gameId, { 
        state: GameState.FINISHED,
        winner: winner,
        endTime: new Date()
    })
    .then(() => {
        logger.info(`Game ${gameId} ended with gameResults: ${JSON.stringify(gameResults)} and database updated`);
    })
    .catch(err => {
        logger.error(`Error updating game end state: ${err}`);
    });
}

/**
 * Distributes initial letters to players
 * 
 * @param {GameState} gameState 
 */
function distributeLetters(gameState){
    gameState.playerData.forEach((data, playerId) => {
        const possibleCombos = getNextTierCombos(letterTree, "root");
        logger.info(`Possible combos for player ${playerId}: ${possibleCombos}`);
        const randomIndex = Math.floor(Math.random() * possibleCombos.length);
        logger.info(`Random index for player ${playerId}: ${randomIndex}`);
        data.letters = possibleCombos[randomIndex];
        logger.info(`Initial letters for player ${playerId}: ${data.letters}`);
    });
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