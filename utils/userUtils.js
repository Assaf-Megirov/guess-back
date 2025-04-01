const mongoose = require('mongoose');
const User = require('../models/User');
const Guest = require('../models/Guest');
const logger = require('../utils/logger');
/**
 * Retrieves the username for a given user ID.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<string>} The username of the user.
 */
async function getUsernameFromId(userId) {
    try {
        if (mongoose.Types.ObjectId.isValid(userId)) {
            const user = await User.findById(userId);
            if (user) {
                logger.debug(`Fetched username for user ID ${userId}: ${user.username}`);
                return user.username;
            }
        }
        const guest = await Guest.findOne({ guestId: userId });
        if (guest) {
            logger.debug(`Fetched username for guest ID ${userId}: ${guest.username}`);
            return guest.username;
        }
        return `Unknown-${userId}`;
    } catch (err) {
        throw new Error(`Error fetching username for ID ${userId}: ${err.message}`);
    }
}

module.exports = {
    getUsernameFromId
};