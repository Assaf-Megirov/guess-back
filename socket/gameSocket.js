const logger = require('../utils/logger');
const {Game, Winner} = require('../models/Game');

const GameState = require('../types/gameState');
const mongoose = require('mongoose');
const { loadDictionary, loadLetterTreeSync, getNextTierCombos } = require('../utils/wordUtils');
const { getUsernameFromId } = require('../utils/userUtils');

const games = new Map();
const gameCodes = new Map(); //maps gameCodes to gameIds
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
        let gameId = socket.gameId;
        const gameCode = socket.gameCode;
        const userId = socket.userId;
        logger.info(`User ${userId} connected to game ${gameId}`);
        if(!gameId && !gameCode){
            logger.warn(`Socket connection rejected - no gameId or gameCode provided`);
            return socket.disconnect('Authentication error: No gameId or gameCode provided');
        }
        if(!gameId){
            gameId = gameCodes.get(gameCode);
        }
        if(!connectedPlayers.has(gameId)){
            connectedPlayers.set(gameId, new Set());
        }
        connectedPlayers.get(gameId).add(userId); //add player to the map at this game
        const game = games.get(gameId);
        if(!game){
            logger.warn(`Game ${gameId} not found`);
            return socket.disconnect('Game not found');
        }
        if(game && connectedPlayers.get(gameId).size === game.players.length){
            logger.info(`All players connected to game ${gameId}. Starting game...`);
            game.state = GameState.IN_PROGRESS;

            game.startTime = Date.now();
            game.elapsedTime = 0;
            if(gameTimers.has(gameId)){
                clearInterval(gameTimers.get(gameId));
                logger.info(`Cleared elapsed time tracking for game ${gameId}`);
                gameTimers.delete(gameId);
            }
            gameTimers.set(gameId, setInterval(async () => {
                const currentGame = games.get(gameId);
                if (currentGame) {
                    currentGame.elapsedTime = Math.floor((Date.now() - currentGame.startTime) / 1000);

                    if(currentGame.elapsedTime >= GAME_END_TIME){
                        logger.info(`Game ${gameId} ended after ${currentGame.elapsedTime} seconds`);
                        await endGame(gameId, gameNamespace);
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
                    const serializableGame = {
                        ...game,
                        playerData: Object.fromEntries(game.playerData)
                    };
                    gameNamespace.to(gameId).emit("game_state", serializableGame);
                }, GAME_START_DELAY);
            })
            .catch(err => {
                logger.error(`Error updating game state: ${err}`);
            });
        }
        socket.join(gameId);

        socket.on("move", (data) =>{
            logger.info(`User ${userId} submitted move: ${data}`);
            const {valid, reason} = isValidWord( data,games.get(gameId).playerData.get(userId).letters, games.get(gameId).playerData.get(userId).words);
            if(!valid){
                gameNamespace.to(gameId).emit("invalid", {by: userId, reason: reason});
                logger.info(`Move from user ${userId} is invalid because: ${reason}`);
            }else{
                const currentGame = games.get(gameId);
                const currentPoints = ++currentGame.playerData.get(userId).points;
                const currentIncreases = currentGame.playerData.get(userId).letterIncreases;
                if( currentPoints > POINTS_PER_LETTER * (currentIncreases+1)){
                    currentGame.playerData.get(userId).letterIncreases = currentIncreases + 1;
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
                    if(game && game.gameCode && gameCodes.has(game.gameCode)){
                        gameCodes.delete(game.gameCode);
                        logger.info(`Cleared game code for game ${gameId} after all players disconnected`);
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
 * @param {string[]} playerIds - array of player IDs
 * @returns {Promise<string>} Promise that resolves with the ID of the newly created game.
 * @throws Will throw an error if there is an issue creating the game.
 */
async function createGame(playerIds) { //TODO: add support for more than one player here by changing the number of players in the array
    try {
        const gameCode = generateUniqueGameCode(Array.from(gameCodes.keys()));
        const players = playerIds.map(id => {
            const isInvalidObjectId = !mongoose.Types.ObjectId.isValid(id) && id.startsWith('guest');
            // what the fuck is this shit (i assume to prevent random ids from being used as guest ids)
            // if (!isInvalidObjectId && !id.startsWith('guest')) { 
            //     throw new Error('Invalid player ID');
            // }
            return isInvalidObjectId ? { guestId: id } : { user: id };
        });

        const newGame = new Game({
            gameCode: gameCode,
            players: players,
            state: GameState.NOT_STARTED //waiting for players to join
        });
        const savedGame = await newGame.save();
        const gameId = savedGame._id.toString();

        games.set(gameId, {
            id: gameId,
            gameCode: gameCode,
            players: playerIds,
            state: GameState.NOT_STARTED,
            playerData: new Map(),
            elapsedTime: 0
        });

        for (const playerId of playerIds) {
            const username = await getUsernameFromId(playerId);//this handles both user and guest ids

            logger.info(`Adding playerData ${playerId} with username ${username} to game ${gameId}`);
            games.get(gameId).playerData.set(playerId, {
                points: 0,
                letters: "",
                written: "",
                words: [],
                username: username,
                letterIncreases: 0
            });
        }

        gameCodes.set(gameCode, gameId);
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

function generateGameCode(length = 4){
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}
function generateUniqueGameCode(existingCodes, length=6) {
    let code = generateGameCode(length);
    while (existingCodes.includes(code)) {
        code = generateGameCode(length);
    }
    return code;
}

async function endGame(gameId, namespace) {
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
            await Promise.all(
                Array.from(game.playerData.entries()).map(async ([id, data]) => {
                    const username = await getUsernameFromId(id);
                    return [id, { points: data.points, username }];
                })
            )
        )
    };
    namespace.to(gameId).emit('game_ended', gameResults);
    if(winner && winner.startsWith('guest')){
        winner = new Winner({ guestId: winner });
    }else if(winner){
        winner = new Winner({ user: winner });
    }
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
 * @param {string[]} usedWords - An array of words that have already been used in the game.
 * @returns {{valid: boolean, reason: string}} An object indicating whether the word is valid and the reason if it is not.
 */
function isValidWord(word, letters, usedWords){
    if(!word || !letters){
        return {valid: false, reason: 'Word and letters are required!'};
    }
    if (typeof word !== 'string' || typeof letters !== 'string' || !/^[a-zA-Z]+$/.test(word) || !/^[a-zA-Z]+$/.test(letters)) {
        return {valid: false, reason: 'Word and letters must be strings and only contain letters'};
    }
    const lowerWord = word.toLowerCase();
    const lowerLetters = letters.toLowerCase();
    if(!words.has(lowerWord)){
        return {valid: false, reason: `${word} is not a word!`};
    }
    if(usedWords && usedWords.includes(lowerWord)){
        return {valid: false, reason: `${word} has already been used!`};
    }
    for (const char of lowerLetters) {
        if (!lowerWord.includes(char)) {
          return {valid: false, reason: `${word} doesnt contain the letter: ${char}!`};
        }
    }
    return {valid: true, reason: ''};
}

function incrementLetters(letters){
    const lowerLetters = letters.toLowerCase();
    const possibleCombos = getNextTierCombos(letterTree, lowerLetters);
    if(!possibleCombos || possibleCombos.length === 0){
        // If there are no possible combos, return the current letters
        return letters;
    }
    const randomIndex = Math.floor(Math.random() * possibleCombos.length);
    return possibleCombos[randomIndex];
}

module.exports = {
    initializeGameSocket,
    createGame
};