const mongoose = require('mongoose');
const GameState = require('../types/gameState');

const Schema = mongoose.Schema;

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
    players: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: function() {
                return !this.guestId; //only one is required
            }
        },
        guestId: {
            type: String,
            required: function() {
                return !this.user; //only one is required
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