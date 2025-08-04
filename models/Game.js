const mongoose = require('mongoose');
const GameState = require('../types/gameState');

const Schema = mongoose.Schema;

//the reuired fields only says that there needs to be either a user reference or a guestId
const winnerSchema = new Schema({
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function() {
        return !this.guestId;
      }
    },
    guestId: {
      type: String,
      required: function() {
        return !this.user;
      }
    }
}, { _id: false });

const gameSchema = new Schema({
    gameCode: {
        type: String,
        required: false
    },
    gameDuration: {
        type: Number, //time the game will take in milliseconds
        default: 2 * 60 * 1000, //2 minutes
        min: 10 * 1000, //10 seconds
        max: 60 * 60 * 1000, //60 minutes
        set: function(value) {
            return Math.floor(value);
        }
    },
    letterAddFrequency: {
        type: Number, //time between letter additions in milliseconds
        default: 10, //by default the game will add a letter every 10 points
        min: 0, //0 means that the game will not add letters
        max: 999,
        set: function(value) {
            return Math.floor(value);
        }
    },
    victoryThreshold: {
        type: Number, //the number of points needed to win the game, if the game is not over by the time the threshold is reached, the game will end with the player with the most points winning
        default: 100,
        min: 0, //0 means that the game will continue until the time runs out
        max: 999,
        set: function(value) {
            return Math.floor(value);
        }
    },
    players: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: function() {
                return !this.guestId;
            }
        },
        guestId: {
            type: String,
            required: function() {
                return !this.user;
            }
        },
        points: {
            type: Number,
            default: 0
        },
        letters: { //the last letters that player had, example: "ths" (the player had the letters: t, h, s)
            type: String,
            default: ""
        }
    }],
    state: {
        type: String,
        enum: Object.values(GameState),
        required: true
    },
    timeElapsed: {
        type: Number, //time the game took in milliseconds
        default: 0
    },
    winner: winnerSchema,
    endTime: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

gameSchema.pre('save', function(next) { //ensure that the updated date is accurate
    this.updatedAt = Date.now();
    next();
});

const Game = mongoose.model('Game', gameSchema);
const Winner = mongoose.model('Winner', winnerSchema);

module.exports = {Game, Winner};