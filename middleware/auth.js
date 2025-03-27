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
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        logger.warn('Socket connection rejected - no token provided');
        return next(new Error('Authentication error: No token provided'));
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id;
      socket.username = decoded.username;
      await User.findByIdAndUpdate(socket.userId, { 
        isOnline: true, 
        lastActive: Date.now() 
      });
      
      logger.info(`User authenticated via socket: ${socket.username} (${socket.userId})`);
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