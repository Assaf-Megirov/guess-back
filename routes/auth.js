const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const { apiAuth, JWT_SECRET } = require('../middleware/auth');

/**
 * User Registration Route
 * @route POST /register
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
router.post('/register', async (req, res) => {
  try {
    logger.info('Registration request received', {
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      body: { ...req.body, password: '[REDACTED]' }
    });

    const { username, email, password } = req.body;
    const errors = {};
    
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      if (existingUser.email === email) {
        errors.email = ['This email is already registered'];
      }
      if (existingUser.username === username) {
        errors.username = ['This username is already taken'];
      }
    }
    if (password.length < 6) {
      errors.password = ['Password must be at least 6 characters long'];
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.email = ['Please enter a valid email address'];
    }

    if (username.length < 3) {
      errors.username = ['Username must be at least 3 characters long'];
    }

    if (Object.keys(errors).length > 0) {
      logger.warn('Registration validation failed', { 
        email, 
        username, 
        errors,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      return res.status(400).json({ errors });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const user = new User({
      username,
      email,
      password: hashedPassword,
      isOnline: true,
      lastActive: Date.now()
    });
    
    await user.save();
    
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    logger.info('User registered successfully', { userId: user._id, username });
    
    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
    
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ 
      errors: {
        general: ['An unexpected error occurred. Please try again.']
      }
    });
  }
});

/**
 * User Login Route
 * @route POST /login
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
  
    const user = await User.findOne({ email });
    if (!user) {
      logger.warn('Login attempt failed - User not found', { email });
      return res.status(400).json({ 
        errors: {
          email: ['No account found with this email address'],
          password: ['Invalid password']
        }
      });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn('Login attempt failed - Invalid password', { email });
      return res.status(400).json({ 
        errors: {
          password: ['Invalid password']
        }
      });
    }
    
    user.isOnline = true;
    user.lastActive = Date.now();
    await user.save();
    
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    logger.info('User logged in successfully', { userId: user._id, username: user.username });
    
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
    
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ 
      errors: {
        general: ['An unexpected error occurred. Please try again.']
      }
    });
  }
});

/**
 * Protected route for user profile
 * @route GET /user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
router.get('/user', apiAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    logger.debug('User profile retrieved', { userId: req.user.id });
    res.json(user);
  } catch (error) {
    logger.error('Error retrieving user profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Logout route
 * @route POST /logout
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
router.post('/logout', apiAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.isOnline = false;
    user.lastActive = Date.now();
    await user.save();
    logger.info('User logged out successfully', { userId: user._id, username: user.username });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = { router };
