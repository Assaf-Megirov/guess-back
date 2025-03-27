# GameSocket.js Documentation

This document provides documentation for the `gameSocket.js` file, which handles real-time game socket connections, game state management, and word validation for a multiplayer word game.

## Overview

The `gameSocket.js` file manages socket connections for a multiplayer word game where players compete using word combinations. It handles game creation, player connections, word validation, and game state updates.

## Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `connection` | Incoming | Fired when a user connects to the game namespace |
| `move` | Incoming | Received when a player makes a word submission move |
| `written` | Incoming | Received when a player updates their in-progress text |
| `end_game` | Incoming | Received when a player ends a game |
| `disconnect` | Incoming | Fired when a player disconnects from the game |
| `game_started` | Outgoing | Emitted when all players have connected and game starts |
| `invalid` | Outgoing | Emitted when a submitted word is invalid |
| `valid` | Outgoing | Emitted when a submitted word is valid |
| `game_state` | Outgoing | Emitted when the game state changes |

## Detailed Event Documentation

### Incoming Events

#### `connection`
Fired automatically when a user connects to the game namespace.
- **Data**: Connection information from socket handshake
- **Actions**: 
  - Adds player to the connected players map
  - Checks if all players are connected to potentially start the game
  - Joins the socket to the game room

#### `move`
Received when a player submits a word.
- **Data**: Move information
- **Actions**:
  - Validates the word
  - Updates points if valid
  - Potentially increases difficulty for opponents
  - Emits appropriate response event (`valid` or `invalid`)

#### `written`
Received when a player updates their current text input.
- **Data**: `{ written: string }` - The current text being typed
- **Actions**:
  - Updates the player's current text in the game state
  - Broadcasts updated game state to all players

#### `end_game`
Received when a player ends the game.
- **Data**: `{ gameId: string }` - ID of the game to end
- **Actions**: 
  - Logs the game end event
  - Note: Implementation is incomplete (marked with TODO)

#### `disconnect`
Fired automatically when a player disconnects.
- **Data**: None
- **Actions**:
  - Removes player from connected players map
  - Handles mid-game disconnection (implementation incomplete)

### Outgoing Events

#### `game_started`
Emitted when all players have connected and the game starts.
- **Data**: `{ gameId: string }` - ID of the started game

#### `invalid`
Emitted when a submitted word is invalid.
- **Data**: `{ by: string, reason: string }` - Player ID and reason for invalidity

#### `valid`
Emitted when a submitted word is valid.
- **Data**: `{ by: string, GameState: object }` - Player ID and updated game state

#### `game_state`
Emitted when the game state changes.
- **Data**: Complete game state object

## Functions

### `initializeGameSocket(gameNamespace, authMiddleware)`
Initializes socket event handlers for the game namespace.

- **Parameters**:
  - `gameNamespace` - The Socket.IO namespace for games
  - `authMiddleware` - Authentication middleware for socket connections
- **Returns**: None
- **Description**: Sets up event listeners for the game namespace and handles player connections, moves, and disconnections.

### `createGame(player1Id, player2Id)`
Creates a new game with the specified players.

- **Parameters**:
  - `player1Id` - ID of the first player
  - `player2Id` - ID of the second player
- **Returns**: Promise that resolves with the ID of the newly created game
- **Description**: 
  - Creates a new game document in the database
  - Initializes the game state in memory
  - Sets up player data with initial values

### `isValidWord(word, letters)`
Validates a word based on game rules.

- **Parameters**:
  - `word` - The word to validate
  - `letters` - The letters that must be included in the word
- **Returns**: `{ valid: boolean, reason: string }` - Validation result and reason if invalid
- **Description**: Checks if the word is in the dictionary and contains all required letters.

### `incrementLetters(letters)`
Increases the difficulty by adding more required letters.

- **Parameters**:
  - `letters` - The current set of letters
- **Returns**: New set of letters with increased difficulty
- **Description**: Uses a letter tree to find valid next-tier letter combinations.

## Data Structures

### Game Object
```javascript
{
  id: String,              // Game ID
  players: Array<String>,  // Array of player IDs
  state: GameState,        // Current game state (enum)
  playerData: Map<String, {  // Map of player data keyed by player ID
    points: Number,        // Player's current points
    letters: String,       // Letters the player must use
    written: String        // Current text being typed by the player
  }>,
  elapsedTime: Number      // Game elapsed time
}
```

### Constants

- `POINTS_PER_LETTER`: 10 - Points awarded per letter in valid words

## Dependencies

- `socketManager.js` - For getting the Socket.IO instance
- `logger.js` - For logging
- `Game.js` - Game model for database operations
- `gameState.js` - Enum for game states
- `wordUtils.js` - Utilities for word validation and letter tree operations

## Notes

- The file contains some TODOs for incomplete implementations:
  - Support for more than two players
  - Handling mid-game disconnections
  - Implementing the end game functionality
- There appears to be a duplicate export at the end of the file that should be fixed
