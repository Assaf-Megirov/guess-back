const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET || JWT_SECRET === null || JWT_SECRET === ''){
  throw new Error(`Couldnt load JWT_SECRET from env! loaded: ${JWT_SECRET}`)
}

const apiAuth = (req, res, next) => {
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      logger.warn('Unauthorized access attempt - No token provided');
      return res.status(401).json({ message: 'No token, authorization denied' });
    }
  
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      logger.warn('Unauthorized access attempt - Invalid token');
      res.status(401).json({ message: 'Token is not valid' });
    }
};

/**
 * Authentication middleware for Socket.io
 * @param {Object} socket - Socket.io socket instance
 * @param {Function} next - Callback function to proceed to the next middleware
 */
async function socketAuth(socket, next) {
    try {
      logger.debug('Socket authentication middleware triggered, auth data:', socket.handshake.auth);
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      const guestId = socket.handshake.auth.guestId || socket.handshake.query.guestId;
      if (!token && !guestId) {
        logger.warn('Socket connection rejected - no token or guestId provided');
        return next(new Error('Authentication error: No token or guestId provided'));
      }
      if(token){
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.id;
        socket.username = decoded.username;
        await User.findByIdAndUpdate(socket.userId, { 
          isOnline: true, 
          lastActive: Date.now() 
        });
        logger.info(`User authenticated via socket: ${socket.username} (${socket.userId})`);
      }
      const gameId = socket.handshake.auth.gameId;
      if (gameId) {
        socket.gameId = gameId;
        logger.info(`auth middleware added a gameId to the socket: ${gameId}`);
      }
      const gameCode = socket.handshake.auth.gameCode;
      if (gameCode) {
        socket.gameCode = gameCode;
        logger.info(`auth middleware added a gameCode to the socket: ${gameCode}`);
      }
      if (guestId) {
        socket.userId = guestId;
        logger.info(`Socket authenticated as guest: ${guestId}`);
      }
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
}

module.exports = {
    apiAuth,
    socketAuth,
    JWT_SECRET
};