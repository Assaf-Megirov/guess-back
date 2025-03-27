// server.js
const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors');
const logger = require('./utils/logger');
const { router: authRoutes } = require('./routes/auth');
const { router: friendRoutes } = require('./routes/friends');
const http = require('http'); // Import HTTP to create the server
const socketManager = require('./socket/socketManager'); // Import the socket manager

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token', 'Authorization']
}));
app.use(express.json());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/wordguessinggame')
  .then(() => logger.info('MongoDB connected'))
  .catch(err => logger.error('MongoDB connection error:', err));

// Routes
app.use('/api', authRoutes);
app.use('/api/friends', friendRoutes);

// Create HTTP server and initialize socket manager
const server = http.createServer(app);
socketManager.initialize(server); // Initialize the socket manager with the server

// Start the server
server.listen(PORT, () => logger.info(`Server running on port ${PORT}`));