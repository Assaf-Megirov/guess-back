const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const gameModule = require('../socket/gameSocket');
const lobbyModule = require('../socket/lobbyManager');
const chatModule = require('../socket/chatSocket');
const { socketAuth } = require("../middleware/auth");

const connectedUsers = new Map(); //{ userId: socketId }
const socketToUser = new Map(); //reverse map for lookup: { socketId: userId }
const gameInvites = new Map(); //{senderId: targetId}
const ONLINE_STATUS_INTERVAL = 0.50 * 60 * 60 * 1000; //how long before checking if the user is active (half an hour)

/**
 * Initializes Socket.io with the HTTP server and sets up authentication and event handlers
 * @param {Object} server - HTTP server instance
 * @returns {Object} Socket.io instance
 * 
 * @example
 * const server = http.createServer(app);
 * const io = initializeSocket(server);
 */
function initializeSocket(server) {
  const io = socketIo(server, {
    cors: {
      origin: '*', //TODO: lockdown in prod
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Use the auth middleware
  io.use(socketAuth);

  io.on('connection', (socket) => {
    logger.info(`New socket connection: ${socket.id} - User: ${socket.username} (${socket.userId})`);
    connectedUsers.set(socket.userId, socket.id);
    socketToUser.set(socket.id, socket.userId);
    broadcastStatusToFriends(socket.userId, true);
    
    /**
     * Handles client heartbeat ping and updates user's last active timestamp
     * @event ping
     * @example Client: socket.emit('ping');
     */
    socket.on('ping', () => {
      socket.emit('pong');
      updateUserLastActive(socket.userId);
    });
    
    /**
     * Handles manual status change from the client
     * @event status_change
     * @param {Object} data - Status change data
     * @param {boolean} data.isOnline - The new online status to set
     * @example Client: socket.emit('status_change', { isOnline: false });
     */
    socket.on('status_change', async (data) => {
      try {
        await User.findByIdAndUpdate(socket.userId, { 
          isOnline: data.isOnline,
          lastActive: Date.now()
        });
        
        broadcastStatusToFriends(socket.userId, data.isOnline);
      } catch (error) {
        logger.error('Error updating user status:', error);
      }
    });
    
    /**
     * Handles manual friend request acceptance and broadcasts to both users
     * to refresh their friend lists in real-time
     * @event manual_friend_accept
     * @param {Object} data - The user whose request was accepted
     * @param {string} data.userId - The ID of the user whose request was accepted
     * @param {string} data.username - The username of the user whose request was accepted
     */
    socket.on('manual_friend_accept', async (data) => {
      try {
        logger.info(`Manual friend accept: ${socket.username} (${socket.userId}) accepted request from ${data.username} (${data.userId})`);
        try {
          await User.findByIdAndUpdate(socket.userId, {
            $addToSet: { friends: data.userId }
          });
          await User.findByIdAndUpdate(data.userId, {
            $addToSet: { friends: socket.userId }
          });
          
          logger.debug(`Database updated for friendship: ${socket.username} <-> ${data.username}`);
        } catch (dbError) {
          logger.error('Error updating friends lists in database:', dbError);
        }
        
        sendFriendRequestAcceptedNotification(data.userId, {
          _id: socket.userId,
          username: socket.username
        });
        
        socket.emit('friend_request', {
          type: 'self_accepted_request',
          from: {
            userId: data.userId,
            username: data.username
          },
          timestamp: Date.now()
        });
        
        const otherUserSocketId = connectedUsers.get(data.userId);
        if (otherUserSocketId) {
          const io = getIO();
          logger.debug(`Sending friend_list_update to requester: ${data.username}`);
          io.to(otherUserSocketId).emit('friend_list_update');
        }
        
        logger.debug(`Sending friend_list_update to accepter: ${socket.username}`);
        socket.emit('friend_list_update');
        
      } catch (error) {
        logger.error('Error handling manual friend accept:', error);
      }
    });
    
    /**
     * Handles a request to force update the client's friend list
     * @event friend_list_update_request
     */
    socket.on('friend_list_update_request', () => {
      try {
        logger.debug(`Friend list update requested by user: ${socket.username} (${socket.userId})`);
        socket.emit('friend_list_update');
        broadcastStatusToFriends(socket.userId, true);
      } catch (error) {
        logger.error('Error handling friend list update request:', error);
      }
    });
    
    /**
     * Handles socket disconnection and updates user status after a delay
     * @event disconnect
     */
    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${socket.id} - User: ${socket.username} (${socket.userId})`);
      connectedUsers.delete(socket.userId);
      socketToUser.delete(socket.id);
      setTimeout(async () => { //the timeout is incase the disconnect is from a page refresh in which case the user will reconnect and will be found in the connectedUsers
        if (!connectedUsers.has(socket.userId)) {
          await User.findByIdAndUpdate(socket.userId, { 
            isOnline: false, 
            lastActive: Date.now() 
          });
          broadcastStatusToFriends(socket.userId, false);
        }
      }, 5000);
    });

    /**
     * Handles a request to get the latest status of all friends
     * @event request_friends_status
     */
    socket.on('request_friends_status', async () => {
      try {
        logger.debug(`Friend status update requested by user: ${socket.username} (${socket.userId})`);
        const user = await User.findById(socket.userId)
          .populate('friends', 'username isOnline lastActive')
          .select('friends');
        
        if (!user || !user.friends.length) {
          logger.debug(`No friends found for user: ${socket.username}`);
          return;
        }
        
        user.friends.forEach(friend => {
          socket.emit('friend_status_change', {
            userId: friend._id.toString(),
            username: friend.username,
            isOnline: friend.isOnline || false,
            timestamp: Date.now()
          });
        });
        
        logger.debug(`Friend statuses sent to user: ${socket.username} (${user.friends.length} friends)`);
      } catch (error) {
        logger.error('Error handling friend status update request:', error);
      }
    });

    socket.on("game_invite", (data) => {
      if(!connectedUsers.has(data.targetId)){
        socket.emit("game_invite_error", {mesage: "user is not online"});
      }
      gameInvites.set(socket.userId, data.targetId);
      const targetSocket = getSocketByUserId(data.targetId);
      targetSocket.emit("game_invite", {senderId: socket.userId, senderUsername: socket.username});
    });

    socket.on("game_invite_accept", async (data) => {
      const gameId = await gameModule.createGame([socket.userId, data.senderId]);
      socket.emit("game_init", {gameId: gameId, opponents: [{userId: data.senderId, username: getSocketByUserId(data.senderId).username}]});
      getSocketByUserId(data.senderId).emit("game_init", {gameId: gameId, opponents: [{userId: socket.userId, username: socket.username}]});
      //now we wait for them both to connect to the game namespace
    });
  });

  const gameNamespace = io.of('/game');
  gameModule.initializeGameSocket(gameNamespace, socketAuth)
  const lobbyNamespace = io.of('/lobby');
  lobbyModule.initializeLobbySocket(lobbyNamespace);
  const chatNamespace = io.of('/chat');
  chatModule.initializeChatSocket(chatNamespace, socketAuth);

  setInterval(checkInactiveUsers, ONLINE_STATUS_INTERVAL);
  return io;
}

/**
 * Updates a user's last active timestamp in the database
 * @param {string} userId - The ID of the user to update
 * @example
 * updateUserLastActive('60d0fe4f5311236168a109ca');
 */
async function updateUserLastActive(userId) {
  try {
    await User.findByIdAndUpdate(userId, { lastActive: Date.now() });
  } catch (error) {
    logger.error('Error updating user last active status:', error);
  }
}

/**
 * Broadcasts user status change to all of their online friends
 * @param {string} userId - The ID of the user whose status changed
 * @param {boolean} isOnline - The new online status
 * @example
 * broadcastStatusToFriends('60d0fe4f5311236168a109ca', true);
 */
async function broadcastStatusToFriends(userId, isOnline) {
  try {
    const user = await User.findById(userId)
      .select('username friends');
    
    if (!user) return;
    user.friends.forEach(friendId => {
      const friendSocketId = connectedUsers.get(friendId.toString());
      if (friendSocketId) {
        const io = getIO();
        io.to(friendSocketId).emit('friend_status_change', {
          userId: userId,
          username: user.username,
          isOnline: isOnline,
          timestamp: Date.now()
        });
      }
    });
  } catch (error) {
    logger.error('Error broadcasting status to friends:', error);
  }
}

/**
 * Checks for users who are marked as online but haven't been active recently
 * and updates their status to offline
 * @example
 * // Usually called on an interval
 * checkInactiveUsers();
 */
async function checkInactiveUsers() {
  try {
    const thresholdTime = Date.now() - (ONLINE_STATUS_INTERVAL * 2);
    
    const inactiveUsers = await User.find({
      isOnline: true,
      lastActive: { $lt: new Date(thresholdTime) }
    }).select('_id');
    for (const user of inactiveUsers) {
      const userId = user._id.toString();
      await User.findByIdAndUpdate(userId, { isOnline: false });
      broadcastStatusToFriends(userId, false);
      
      logger.debug(`Marked inactive user as offline: ${userId}`);
    }
  } catch (error) {
    logger.error('Error checking inactive users:', error);
  }
}

//singleton
let io;

/**
 * Initializes the Socket.io server (singleton pattern)
 * @param {Object} server - HTTP server instance
 * @returns {Object} Socket.io instance
 * @example
 * const server = http.createServer(app);
 * socketManager.initialize(server);
 */
function initialize(server) {
  if (!io) {
    io = initializeSocket(server);
  }
  return io;
}

/**
 * Returns the Socket.io instance
 * @returns {Object} Socket.io instance
 * @throws {Error} If Socket.io is not initialized
 * @example
 * const io = socketManager.getIO();
 * io.emit('broadcast', { message: 'Hello everyone!' });
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initialize() first.');
  }
  return io;
}

/**
 * Checks if a user is currently connected
 * @param {string} userId - The ID of the user to check
 * @returns {boolean} True if the user is connected, false otherwise
 * @example
 * if (isUserConnected('60d0fe4f5311236168a109ca')) {
 *   // User is online
 * }
 */
function isUserConnected(userId) {
  return connectedUsers.has(userId);
}

/**
 * Sends a friend request notification to a user in real-time
 * @param {string} toUserId - The ID of the user to send the notification to
 * @param {Object} fromUser - The user who sent the friend request
 * @param {string} fromUser._id - The ID of the user who sent the request
 * @param {string} fromUser.username - The username of the user who sent the request
 * @example
 * sendFriendRequestNotification('60d0fe4f5311236168a109ca', {
 *   _id: '60d0fe4f5311236168a109cb',
 *   username: 'johndoe'
 * });
 */
async function sendFriendRequestNotification(toUserId, fromUser) {
  try {
    const toSocketId = connectedUsers.get(toUserId);
    
    if (toSocketId) {
      const io = getIO();
      io.to(toSocketId).emit('friend_request', {
        type: 'new_request',
        from: {
          userId: fromUser._id,
          username: fromUser.username
        },
        timestamp: Date.now()
      });
      
      logger.debug(`Friend request notification sent to user ${toUserId}`);
    }
  } catch (error) {
    logger.error('Error sending friend request notification:', error);
  }
}

/**
 * Sends a notification when a friend request is accepted
 * @param {string} toUserId - The ID of the user to send the notification to
 * @param {Object} fromUser - The user who accepted the friend request
 * @param {string} fromUser._id - The ID of the user who accepted the request
 * @param {string} fromUser.username - The username of the user who accepted the request
 * @example
 * sendFriendRequestAcceptedNotification('60d0fe4f5311236168a109ca', {
 *   _id: '60d0fe4f5311236168a109cb',
 *   username: 'johndoe'
 * });
 */
async function sendFriendRequestAcceptedNotification(toUserId, fromUser) {
  try {
    const toSocketId = connectedUsers.get(toUserId);
    
    if (toSocketId) {
      const io = getIO();
      io.to(toSocketId).emit('friend_request', {
        type: 'request_accepted',
        from: {
          userId: fromUser._id,
          username: fromUser.username
        },
        timestamp: Date.now()
      });
      
      io.to(toSocketId).emit('friend_list_update');
      
      logger.debug(`Friend request accepted notification sent to user ${toUserId}`);
    }
  } catch (error) {
    logger.error('Error sending friend request accepted notification:', error);
  }
}

/**
 * Gets the socket ID for a connected user
 * @param {string} userId - The ID of the user
 * @returns {string|undefined} The socket ID if the user is connected, undefined otherwise
 * @example
 * const socketId = getSocketId('60d0fe4f5311236168a109ca');
 * if (socketId) {
 *   io.to(socketId).emit('privateMessage', { message: 'Hello!' });
 * }
 */
function getSocketId(userId) {
  return connectedUsers.get(userId);
}

/**
 * Gets the socket instance for a connected user
 * @param {string} userId - The ID of the user
 * @returns {Object|undefined} The socket instance if the user is connected, undefined otherwise
 * @example
 * const socket = getSocketByUserId('60d0fe4f5311236168a109ca');
 * if (socket) {
 *   socket.emit('privateMessage', { message: 'Hello!' });
 * }
 */
function getSocketByUserId(userId) {
  const socketId = connectedUsers.get(userId);
  if (socketId) {
    const io = getIO();
    return io.sockets.sockets.get(socketId);
  }
  return undefined;
}

module.exports = {
  initialize,
  getIO,
  isUserConnected,
  sendFriendRequestNotification,
  sendFriendRequestAcceptedNotification,
  broadcastStatusToFriends,
  getSocketId
};