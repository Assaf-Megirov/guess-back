const mongoose = require('mongoose');

const GuestSchema = new mongoose.Schema({
    guestId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: false
    }
});

module.exports = mongoose.model('Guest', GuestSchema);