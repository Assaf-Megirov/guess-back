const express = require('express');
const { apiAuth } = require('../middleware/auth');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const logger = require('../utils/logger');
const router = express.Router();

router.get('/', apiAuth, async (req, res) => {
    try{
        const chats = await Chat.findUserChats(req.user.id); //this is already sanitized
        res.json(chats);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * Get messages for a chat
 * @param {string} chatId - The id of the chat
 * @param {number} page - The page number
 * @param {number} limit - The number of messages per page
 * @returns {Promise<Message[]>} A promise that resolves to an array of messages
 */
router.get('/messages', apiAuth, async (req, res) => {
    try{
        logger.info(`Getting messages for chat ${req.query.chatId}`);
        const chat = await Message.getChatMessages(req.query.chatId, req.query.page, req.query.limit);
        res.json(chat);
    } catch (error) {
        logger.error(`Error getting messages for chat ${req.query.chatId}: ${error}`);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = {router};