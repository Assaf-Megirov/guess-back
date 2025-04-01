const fs = require('fs');
const path = require('path');
const wordsPath = path.join(__dirname, 'words.txt');
const letterPath = path.join(__dirname, 'letters.json')

/**
 * Loads a dictionary from a specified file path and returns a set of words.
 *
 * @param {string} [altPath=filePath] - The alternative file path to load the dictionary from. Defaults to `./words.txt`.
 * @returns {Set<string>} A set containing all the words from the dictionary file.
 */
function loadDictionary(altPath = wordsPath) {
    const resolvedPath = path.resolve(altPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Dictionary file '${altPath}' not found.`);
    }

    try {
        const data = fs.readFileSync(resolvedPath, 'utf8');
        const words = data.split(/\r?\n/).map(word => word.trim().toLowerCase()).filter(Boolean);
        console.log(`Successfully loaded dictionary from ${altPath}`);
        return new Set(words); //o(1) lookups baby!!!
    } catch (error) {
        console.error(`Error reading dictionary file: ${error.message}`);
        throw error;
    }
}

function loadLetterTreeSync(altPath = letterPath) {
    const resolvedPath = path.resolve(altPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Tree file '${altPath}' not found.`);
    }
    
    try {
      const fileContent = fs.readFileSync(resolvedPath, 'utf8');
      const tree = JSON.parse(fileContent);
      if (!tree || typeof tree !== 'object' || !tree.root) {
        console.warn("Warning: Tree structure may not be in the expected format (missing 'root' node)");
      }
      console.log(`Successfully loaded letter tree from ${altPath}`);
      return tree;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Error parsing JSON file: ${error.message}`);
      }
      throw error;
    }
}

/**
 * Given a letter tree and a current letters combination,
 * returns all possible next-tier letter combinations.
 *
 * @param {Object} tree - The letter tree loaded from JSON (e.g. { "root": { ... } }).
 * @param {string} letters - The current letters combination (e.g. "ra").
 * @returns {string[]} An array of new letter combinations (e.g. ["ras", "rab", "ram"]).
 */
function getNextTierCombos(tree, letters) {
    let currentNode = tree.root;
    if(letters === "root"){
      //give the all the direct children of the root node
      return Object.keys(currentNode);
    }
    for (const letter of letters) {
      if (!currentNode.hasOwnProperty(letter)) { //if letter doesnt exist
        return [];
      }
      currentNode = currentNode[letter];
    }
    const nextLetters = Object.keys(currentNode);
    return nextLetters.map(nextLetter => letters + nextLetter);
}

function isValidWord(word, letters, dict){
  const lowerWord = word.toLowerCase();
  const lowerLetters = letters.toLowerCase();

  if(!dict.has(lowerWord)){
      return {valid: false, reason: `${word} is not a word!`};
  }
  for (const char of lowerLetters) {
      if (!lowerWord.includes(char)) {
        return {valid: false, reason: `${word} doesnt contain the letter: ${char}!`};
      }
  }
  return {valid: true, reason: ''};
}

module.exports = {
    loadDictionary,
    loadLetterTreeSync,
    getNextTierCombos,
    isValidWord
};