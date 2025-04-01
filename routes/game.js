const express = require('express');
const mongoose = require('mongoose');
const Game = require('../models/Game');
const logger = require('../utils/logger');
const router = express.Router();

function validateCodeSyntax(code) {
    const regex = /^[a-zA-Z0-9]{4}$/;
    return regex.test(code);
}



/**
 * Validate a game code and check if the game exists.
 * @route GET /validate/:code
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.code - Game code to validate
 * @param {Object} res - Express response object
 * @returns {Object} JSON response indicating if the game code is valid and if the game exists
 */
router.get('/validate/:code', async (req, res) => {
    const { code } = req.params;

    if (!validateCodeSyntax(code)) {
        return res.status(400).json({ error: 'Invalid game code' });
    }
    try {
        const game = await Game.findOne({ gameCode: code });
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        res.json({ valid: true });
    } catch (error) {
        logger.error('Error validating game:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/create', async (req, res) => {
    
});