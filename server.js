const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const socketManager = require('./socket/socketManager');
const { router: authRoutes } = require('./routes/auth');
const { router: friendRoutes } = require('./routes/friends');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;
const HTTPS_PORT = process.env.HTTPS_PORT || 5443;
const test = fs.readFileSync('C:/Code/guess_v2/cert/test.txt', 'utf8');
logger.info(`Test file content: ${test} from C:/Code/guess_v2/cert/test.txt`);
logger.info(`SSL_KEY_PATH: ${process.env.SSL_KEY_PATH}`);
logger.info(`SSL_CERT_PATH: ${process.env.SSL_CERT_PATH}`);
let sslOptions;
try {
  sslOptions = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
  };
} catch (err) {
  logger.error(`Error reading SSL files: ${err.message}`);
  process.exit(1); // Exit the process if SSL files cannot be read
}
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token', 'Authorization']
}));
app.use(express.json());

mongoose.connect('mongodb://localhost:27017/wordguessinggame')
  .then(() => logger.info('MongoDB connected'))
  .catch(err => logger.error('MongoDB connection error:', err));

app.use('/api', authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/game', require('./routes/game'));

const httpsServer = https.createServer(sslOptions, app);
socketManager.initialize(httpsServer);
httpsServer.listen(HTTPS_PORT, () => logger.info(`HTTPS Server running on port ${HTTPS_PORT}`));


const httpServer = http.createServer((req, res) => {
  res.writeHead(301, { Location: `https://${req.headers.host.split(':')[0]}:${HTTPS_PORT}${req.url}` });
  res.end();
});
httpServer.listen(PORT, () => logger.info(`HTTP Server running on port ${PORT} (redirecting to HTTPS)`));