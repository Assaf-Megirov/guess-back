const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');
const socketManager = require('../socket/socketManager');
const { apiAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * Get all friends for the authenticated user
 * @route GET /api/friends
 * @returns {Array} Array of friend objects with username, email, isOnline, and lastActive properties
 * @example
 * // Request
 * GET /api/friends
 * Authorization: Bearer <token>
 * 
 * // Response
 * [
 *   {
 *     "_id": "60d0fe4f5311236168a109ca",
 *     "username": "johndoe",
 *     "email": "john@example.com",
 *     "isOnline": true,
 *     "lastActive": "2023-07-15T10:30:45.123Z"
 *   }
 * ]
 */
router.get('/', apiAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('friends', 'username email isOnline lastActive')
      .select('friends');
    
    logger.debug('Friends list retrieved', { userId: req.user.id });
    res.json(user.friends);
  } catch (error) {
    logger.error('Error retrieving friends list:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Send a friend request to another user
 * @route POST /api/friends/add/:userId
 * @param {string} userId - ID of the user to send the friend request to
 * @returns {Object} Success message
 * @example
 * // Request
 * POST /api/friends/add/60d0fe4f5311236168a109ca
 * Authorization: Bearer <token>
 * 
 * // Response (success)
 * {
 *   "message": "Friend request sent, an outgoing friend request was sent to the target"
 * }
 * 
 * // Response (if request already exists)
 * {
 *   "message": "Friend request already sent"
 * }
 */
router.post('/add/:userId', apiAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const friend = await User.findById(userId);
    if (!friend) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (req.user.id === userId) {
      return res.status(400).json({ message: 'You cannot add yourself as a friend' });
    }
    const user = await User.findById(req.user.id);
    if (user.friends.includes(userId)) {
      return res.status(400).json({ message: 'Already friends with this user' });
    }
    if (user.outgoingFriendRequests.includes(userId)) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }
    if (user.incomingFriendRequests.includes(userId)) {
      user.friends.push(userId);
      user.incomingFriendRequests = user.incomingFriendRequests.filter(id => id.toString() !== userId);
      friend.friends.push(req.user.id);
      friend.outgoingFriendRequests = friend.outgoingFriendRequests.filter(id => id.toString() !== req.user.id);
      await user.save();
      await friend.save();
      socketManager.sendFriendRequestAcceptedNotification(userId, user);
      
      logger.info('Friend request accepted, an incoming friend request from the target was already present, so it was accepted', { 
        userId: req.user.id, 
        friendId: userId 
      });
      
      return res.status(200).json({ message: 'Friend request accepted, an incoming friend request from the target was already present, so it was accepted' });
    }

    user.outgoingFriendRequests.push(userId);
    friend.incomingFriendRequests.push(req.user.id);
    await user.save();
    await friend.save();
    socketManager.sendFriendRequestNotification(userId, user);
    logger.info('Friend request sent, an outgoing friend request was sent to the target', { 
      userId: req.user.id, 
      friendId: userId 
    });
    res.status(200).json({ message: 'Friend request sent, an outgoing friend request was sent to the target' });
  } catch (error) {
    logger.error('Error sending friend request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Accept a friend request
 * @route POST /api/friends/accept/:userId
 * @param {string} userId - ID of the user whose friend request to accept
 * @returns {Object} Success message
 * @example
 * // Request
 * POST /api/friends/accept/60d0fe4f5311236168a109ca
 * Authorization: Bearer <token>
 * 
 * // Response (success)
 * {
 *   "message": "Friend request accepted"
 * }
 * 
 * // Response (if no request exists)
 * {
 *   "message": "No friend request from this user"
 * }
 */
router.post('/accept/:userId', apiAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const friend = await User.findById(userId);
    if (!friend) {
      return res.status(404).json({ message: 'User not found' });
    }
    const user = await User.findById(req.user.id);
    if (!user.incomingFriendRequests.includes(userId)) {
      return res.status(400).json({ message: 'No friend request from this user' });
    }
    user.friends.push(userId);
    user.incomingFriendRequests = user.incomingFriendRequests.filter(id => id.toString() !== userId);
    friend.friends.push(req.user.id);
    friend.outgoingFriendRequests = friend.outgoingFriendRequests.filter(id => id.toString() !== req.user.id);
    await user.save();
    await friend.save();
    socketManager.sendFriendRequestAcceptedNotification(userId, user);

    logger.info('Friend request accepted', { 
      userId: req.user.id, 
      friendId: userId 
    });
    res.status(200).json({ message: 'Friend request accepted' });
  } catch (error) {
    logger.error('Error accepting friend request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Decline a friend request
 * @route POST /api/friends/decline/:userId
 * @param {string} userId - ID of the user whose friend request to decline
 * @returns {Object} Success message
 * @example
 * // Request
 * POST /api/friends/decline/60d0fe4f5311236168a109ca
 * Authorization: Bearer <token>
 * 
 * // Response (success)
 * {
 *   "message": "Friend request declined"
 * }
 * 
 * // Response (if no request exists)
 * {
 *   "message": "No friend request from this user"
 * }
 */
router.post('/decline/:userId', apiAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user.incomingFriendRequests.includes(userId)) {
      return res.status(400).json({ message: 'No friend request from this user' });
    }
    user.incomingFriendRequests = user.incomingFriendRequests.filter(id => id.toString() !== userId);
    await user.save();
    const friend = await User.findById(userId);
    if (friend) {
      friend.outgoingFriendRequests = friend.outgoingFriendRequests.filter(id => id.toString() !== req.user.id);
      await friend.save();
    }

    logger.info('Friend request declined', { 
      userId: req.user.id, 
      friendId: userId 
    });
    res.status(200).json({ message: 'Friend request declined' });
  } catch (error) {
    logger.error('Error declining friend request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Cancel an outgoing friend request
 * @route POST /api/friends/cancel/:userId
 * @param {string} userId - ID of the user to cancel the friend request to
 * @returns {Object} Success message
 * @example
 * // Request
 * POST /api/friends/cancel/60d0fe4f5311236168a109ca
 * Authorization: Bearer <token>
 * 
 * // Response (success)
 * {
 *   "message": "Friend request canceled"
 * }
 * 
 * // Response (if no outgoing request exists)
 * {
 *   "message": "No outgoing friend request to this user"
 * }
 */
router.post('/cancel/:userId', apiAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user.outgoingFriendRequests.includes(userId)) {
      return res.status(400).json({ message: 'No outgoing friend request to this user' });
    }

    user.outgoingFriendRequests = user.outgoingFriendRequests.filter(id => id.toString() !== userId);
    await user.save();
    const friend = await User.findById(userId);
    if (friend) {
      //remove from the incoming requests on the target
      friend.incomingFriendRequests = friend.incomingFriendRequests.filter(id => id.toString() !== req.user.id);
      await friend.save();
    }
    
    logger.info('Friend request canceled', { 
      userId: req.user.id, 
      friendId: userId 
    });
    res.status(200).json({ message: 'Friend request canceled' });
  } catch (error) {
    logger.error('Error canceling friend request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Get all incoming friend requests for the authenticated user
 * @route GET /api/friends/requests/incoming
 * @returns {Array} Array of user objects who sent friend requests
 * @example
 * // Request
 * GET /api/friends/requests/incoming
 * Authorization: Bearer <token>
 * 
 * // Response
 * [
 *   {
 *     "_id": "60d0fe4f5311236168a109ca",
 *     "username": "johndoe",
 *     "email": "john@example.com",
 *     "isOnline": true,
 *     "lastActive": "2023-07-15T10:30:45.123Z"
 *   }
 * ]
 */
router.get('/requests/incoming', apiAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('incomingFriendRequests', 'username email isOnline lastActive')
      .select('incomingFriendRequests');
    
    logger.debug('Incoming friend requests retrieved', { userId: req.user.id });
    res.json(user.incomingFriendRequests);
  } catch (error) {
    logger.error('Error retrieving incoming friend requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Get all outgoing friend requests for the authenticated user
 * @route GET /api/friends/requests/outgoing
 * @returns {Array} Array of user objects to whom friend requests were sent
 * @example
 * // Request
 * GET /api/friends/requests/outgoing
 * Authorization: Bearer <token>
 * 
 * // Response
 * [
 *   {
 *     "_id": "60d0fe4f5311236168a109ca",
 *     "username": "johndoe",
 *     "email": "john@example.com",
 *     "isOnline": true,
 *     "lastActive": "2023-07-15T10:30:45.123Z"
 *   }
 * ]
 */
router.get('/requests/outgoing', apiAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('outgoingFriendRequests', 'username email isOnline lastActive')
      .select('outgoingFriendRequests');
    
    logger.debug('Outgoing friend requests retrieved', { userId: req.user.id });
    res.json(user.outgoingFriendRequests);
  } catch (error) {
    logger.error('Error retrieving outgoing friend requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Remove a friend from the authenticated user's friend list
 * @route DELETE /api/friends/remove/:userId
 * @param {string} userId - ID of the friend to remove
 * @returns {Object} Success message
 * @example
 * // Request
 * DELETE /api/friends/remove/60d0fe4f5311236168a109ca
 * Authorization: Bearer <token>
 * 
 * // Response (success)
 * {
 *   "message": "Friend removed"
 * }
 * 
 * // Response (if not friends)
 * {
 *   "message": "Not friends with this user"
 * }
 */
router.delete('/remove/:userId', apiAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user.friends.includes(userId)) {
      return res.status(400).json({ message: 'Not friends with this user' });
    }
    
    user.friends = user.friends.filter(id => id.toString() !== userId);
    await user.save();
    const friend = await User.findById(userId);
    if (friend) {
      friend.friends = friend.friends.filter(id => id.toString() !== req.user.id);
      await friend.save();
      if (socketManager.isUserConnected(userId)) {
        const io = socketManager.getIO();
        io.to(socketManager.getSocketId(userId)).emit('friend_removed', {
          userId: req.user.id,
          username: user.username,
          timestamp: Date.now()
        });
      }
    }
    
    logger.info('Friend removed', { 
      userId: req.user.id, 
      friendId: userId 
    });
    res.status(200).json({ message: 'Friend removed' });
  } catch (error) {
    logger.error('Error removing friend:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Get friend suggestions (friends of friends + random users if needed)
 * @route GET /api/friends/suggestions
 * @param {number} [page=1] - Page number for pagination
 * @param {number} [limit=10] - Results per page
 * @returns {Object} Object containing suggestions array and pagination metadata
 * @example
 * // Request
 * GET /api/friends/suggestions?page=1&limit=10
 * Authorization: Bearer <token>
 * 
 * // Response
 * {
 *   "suggestions": [
 *     {
 *       "_id": "60d0fe4f5311236168a109ca",
 *       "username": "johndoe",
 *       "email": "john@example.com",
 *       "isOnline": true,
 *       "lastActive": "2023-07-15T10:30:45.123Z"
 *     }
 *   ],
 *   "pagination": {
 *     "total": 25,
 *     "page": 1,
 *     "limit": 10,
 *     "pages": 3
 *   }
 * }
 */
router.get('/suggestions', apiAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const user = await User.findById(req.user.id);
    
    const friends = await User.find({ _id: { $in: user.friends } });
    const friendsOfFriendsIds = new Set();
    
    friends.forEach(friend => {
      friend.friends.forEach(friendOfFriend => {
        const friendId = friendOfFriend.toString();
        
        if (
          friendId !== req.user.id && 
          !user.friends.some(f => f.toString() === friendId) &&
          !user.incomingFriendRequests.some(f => f.toString() === friendId) &&
          !user.outgoingFriendRequests.some(f => f.toString() === friendId)
        ) {
          friendsOfFriendsIds.add(friendId);
        }
      });
    });
    
    let suggestions = await User.find({
      _id: { $in: Array.from(friendsOfFriendsIds) }
    })
    .select('username email isOnline lastActive')
    .limit(limit)
    .skip(skip);
    
    if (suggestions.length < limit) {
      const remainingCount = limit - suggestions.length;
      const existingIds = new Set([
        ...suggestions.map(s => s._id.toString()),
        ...user.friends.map(f => f.toString()),
        ...user.incomingFriendRequests.map(f => f.toString()),
        ...user.outgoingFriendRequests.map(f => f.toString()),
        req.user.id
      ]);
      
      const randomUsers = await User.find({
        _id: { $nin: Array.from(existingIds) }
      })
      .select('username email isOnline lastActive')
      .limit(remainingCount);
      
      suggestions = [...suggestions, ...randomUsers];
    }
    
    const totalFriendsOfFriends = friendsOfFriendsIds.size;
    const totalUsers = await User.countDocuments({
      _id: { $ne: req.user.id },
      friends: { $ne: req.user.id },
      incomingFriendRequests: { $ne: req.user.id },
      outgoingFriendRequests: { $ne: req.user.id }
    });
    
    const totalSuggestions = Math.max(totalFriendsOfFriends, Math.min(totalUsers, 100));
    
    logger.debug('Friend suggestions retrieved', { 
      userId: req.user.id,
      count: suggestions.length,
      page,
      limit
    });
    
    res.json({
      suggestions,
      pagination: {
        total: totalSuggestions,
        page,
        limit,
        pages: Math.ceil(totalSuggestions / limit)
      }
    });
  } catch (error) {
    logger.error('Error retrieving friend suggestions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Get online friends for the authenticated user
 * @route GET /api/friends/online
 * @returns {Array} Array of online friend objects
 * @example
 * // Request
 * GET /api/friends/online
 * Authorization: Bearer <token>
 * 
 * // Response
 * [
 *   {
 *     "_id": "60d0fe4f5311236168a109ca",
 *     "username": "johndoe",
 *     "email": "john@example.com",
 *     "isOnline": true,
 *     "lastActive": "2023-07-15T10:30:45.123Z"
 *   }
 * ]
 */
router.get('/online', apiAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate({
        path: 'friends',
        match: { isOnline: true },
        select: 'username email isOnline lastActive'
      })
      .select('friends');
    
    logger.debug('Online friends retrieved', { userId: req.user.id });
    res.json(user.friends);
  } catch (error) {
    logger.error('Error retrieving online friends:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = { router }; 