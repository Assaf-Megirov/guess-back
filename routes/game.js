const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const { loadDictionary, loadLetterTreeSync, getNextTierCombos, isValidWord } = require('../utils/wordUtils');

const dict = loadDictionary();
const tree = loadLetterTreeSync(); //TODO: move to server wide

router.post('/validate', async (req, res) => {
    const { word, letters } = req.body;
    logger.info(`Validating word: ${word} with letters: ${letters}`);
    if (!word || !letters) {
        return res.status(400).json({ error: 'Word and letters are required', word, letters });
    }
    if (typeof word !== 'string' || typeof letters !== 'string' || !/^[a-zA-Z]+$/.test(word) || !/^[a-zA-Z]+$/.test(letters)) {
        return res.status(400).json({ error: 'Word and letters must be strings and only contain letters', word, letters });
    }
    if (word.length < letters.length) {
        return res.status(400).json({ error: 'Word length must be greater than or equal to the number of letters', word, letters });
    }
    if (word.length > 45) {
        return res.status(400).json({ error: 'Word length must be less than or equal to 45', word });
    }
    if (letters.length > 26) {
        return res.status(400).json({ error: 'Letters contains more letters than the english alphabet', letters });
    }
    try {
        const result = isValidWord(word, letters, dict);
        if (result.valid) {
            logger.info(`Word: ${word} is valid with letters: ${letters}`);
            return res.status(200).json({success: true});
        }
        logger.info(`Word: ${word} is invalid with letters: ${letters}`);
        return res.status(200).json({success: false, reason: result.reason});
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/next-combos', async (req, res) => {
    const { letters } = req.query;
    logger.info(`Getting next tier combos for letters: ${letters}`);
    let lettersFinal;
    if(!letters || letters === ""){
        lettersFinal = "root"; //default to root node
    } else {
        lettersFinal = letters;
    }
    logger.info(`lettersFinal: ${lettersFinal}`);
    if (typeof lettersFinal !== 'string' || !/^[a-zA-Z]+$/.test(lettersFinal)) {
        return res.status(400).json({ error: 'Letters must be a string and only contain letters', lettersFinal });
    }
    if (lettersFinal.length > 26) {
        return res.status(400).json({ error: 'Letters contains more letters than the english alphabet', lettersFinal });
    }
    try {
        const result = getNextTierCombos(tree, lettersFinal);
        logger.info(`Next tier combos for letters: ${lettersFinal} are: ${result}`);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
