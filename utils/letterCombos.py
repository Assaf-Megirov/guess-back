from itertools import combinations
import json
import argparse

def load_word_list(word_list_path='wordlist.txt'):
    """
    Loads a word list from the specified file.
    Each word is converted to a set of letters.
    
    Args:
        word_list_path (str): The path to the word list file. The file should contain line seperated words. Defaults to 'wordlist.txt'.
        
    Returns:
        array: An array of sets, where each set contains the unique letters of each word.
    """
    with open(word_list_path, 'r') as file:
        word_list = []
        for line in file:
            word = line.strip()
            if word:
                # Convert each word to a set of letters, we can do this because we only need one instance of each letter
                word_set = set(word.lower())  # Convert to lowercase for consistency
                word_list.append(word_set)
    
    # At this point word_list is an Array of sets, each set containing the unique letters of each word
    print(f"Loaded {len(word_list)} words from the word list at {word_list_path}.")
    return word_list

def find_all_valid_letter_sets(word_list, min_valid_words, letters, max_set_size):
    """
    Find all valid letter combinations by testing all possible combinations.
    This is the clearest and most straightforward approach.
    
    Args:
        word_list: List of word sets
        min_valid_words: Minimum number of words that must contain all letters in the set
        letters: Set of available letters
        max_set_size: Maximum size of letter combinations to test
        
    Returns:
        List of valid letter sets (as frozensets for hashability)
    """
    valid_sets = []
    
    # Test combinations of each size from 1 to max_set_size
    for size in range(1, max_set_size + 1):
        print(f"Testing combinations of size {size}...")
        
        # Generate all combinations of the current size
        for letter_combination in combinations(letters, size):
            letter_set = set(letter_combination)
            
            # Count how many words contain all letters in this set
            valid_word_count = sum(1 for word_set in word_list if letter_set.issubset(word_set))
            
            if valid_word_count >= min_valid_words:
                valid_sets.append(frozenset(letter_set))
                print(f"  Found valid set: {''.join(sorted(letter_set))} ({valid_word_count} words)")
    
    print(f"Total valid sets found: {len(valid_sets)}")
    return valid_sets

def build_tree_from_valid_sets(valid_sets):
    """
    Build a tree structure from a list of valid letter sets.
    Each path in the tree represents a valid letter combination.
    
    Args:
        valid_sets: List of valid letter sets (frozensets)
        
    Returns:
        Tree dictionary with 'letter' and 'children' fields
    """
    tree = {'letter': 'root', 'children': []}
    
    # Convert frozensets back to sorted lists for consistent tree building
    valid_combinations = [sorted(letter_set) for letter_set in valid_sets]
    
    # Build tree by inserting each combination
    for combination in valid_combinations:
        current_node = tree
        
        for letter in combination:
            # Look for existing child with this letter
            child_node = None
            for child in current_node['children']:
                if child['letter'] == letter:
                    child_node = child
                    break
            
            # Create new child if it doesn't exist
            if child_node is None:
                child_node = {'letter': letter, 'children': []}
                current_node['children'].append(child_node)
                # Sort children to maintain consistent ordering
                current_node['children'].sort(key=lambda x: x['letter'])
            
            current_node = child_node
    
    return tree

def count_tree_paths(tree):
    """Count the total number of paths in the tree (for verification)."""
    if not tree['children']:
        return 1 if tree['letter'] != 'root' else 0
    
    return sum(count_tree_paths(child) for child in tree['children'])

def main(word_list_path='wordlist.txt', tree_output_path='letter_tree.json', 
         percentage_threshold=0.025, char_start='a', char_end='z', max_letter_set_size=4, purge_incomplete=True):
    """
    Main function using the "gather valid sets first, then build tree" approach.
    
    This approach is:
    1. More readable - clear separation of concerns
    2. More efficient - no wasted tree building or pruning
    3. Easier to debug - you can inspect valid_sets before building the tree
    4. More flexible - easy to modify validation logic or tree structure independently
    
    Args:
        word_list_path (str): Path to the word list file
        tree_output_path (str): Path to save the output tree JSON
        percentage_threshold (float): Minimum percentage of words that must contain the letter set
        char_start (str): Start of alphabet range
        char_end (str): End of alphabet range  
        max_letter_set_size (int): Maximum size of letter combinations to test
    """
    word_list = load_word_list(word_list_path)
    
    total_words = len(word_list)
    min_valid_words = int(total_words * percentage_threshold)
    letters = [chr(i) for i in range(ord(char_start), ord(char_end) + 1)]
    
    print(f"Searching for letter sets with at least {min_valid_words} valid words ({percentage_threshold*100}% of {total_words})")
    
    valid_sets = find_all_valid_letter_sets(word_list, min_valid_words, letters, max_letter_set_size)
    
    if purge_incomplete:
        # Purge any sets that are less then the maximum size
        # This is done to ensure every path in tree can lead to a max size set, such that each letter set we give to the user can be expanded up to the max
        valid_sets = [s for s in valid_sets if len(s) == max_letter_set_size]
        
    print("Building tree structure...")
    tree = build_tree_from_valid_sets(valid_sets)
    
    path_count = count_tree_paths(tree)
    print(f"Tree built with {path_count} total paths")
    
    with open(tree_output_path, 'w') as f:
        json.dump(tree, f, indent=2)
    
    print(f"Tree saved to {tree_output_path}")
    return tree, valid_sets

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate letter combination trees from a word list.")
    parser.add_argument('-word_list_path', type=str, default='wordlist.txt', help='Path to the word list file')
    parser.add_argument('-tree_output_path', type=str, default='letter_tree.json', help='Path to save the output tree JSON')
    parser.add_argument('-percentage_threshold', type=float, default=0.025, help='Minimum percentage of words that must contain the letter set')
    parser.add_argument('-char_start', type=str, default='a', help='Start of alphabet range')
    parser.add_argument('-char_end', type=str, default='z', help='End of alphabet range')
    parser.add_argument('-max_letter_set_size', type=int, default=4, help='Maximum size of letter combinations to test')
    parser.add_argument('-no_purge_incomplete', action='store_false', dest='purge_incomplete', help='Do NOT purge sets less than max size (default: purge)')

    args = parser.parse_args()

    main(
        word_list_path=args.word_list_path,
        tree_output_path=args.tree_output_path,
        percentage_threshold=args.percentage_threshold,
        char_start=args.char_start,
        char_end=args.char_end,
        max_letter_set_size=args.max_letter_set_size,
        purge_incomplete=args.purge_incomplete
    )