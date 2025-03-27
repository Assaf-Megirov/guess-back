# Socket Manager Documentation

## Overview

The Socket Manager module provides real-time communication capabilities for the application using Socket.IO. It manages user connections, authentication, and various real-time events like user status changes, friend requests, and game interactions.

## Table of Contents

1. [Installation and Setup](#installation-and-setup)
2. [Authentication](#authentication)
3. [Connection Management](#connection-management)
4. [Events](#events)
   - [System Events](#system-events)
   - [Status Events](#status-events)
   - [Friend Management Events](#friend-management-events)
   - [Game Events](#game-events)
5. [API Reference](#api-reference)
6. [Examples](#examples)

## Installation and Setup

### Server-side Setup

Initialize the Socket Manager in your main server file:

```javascript
const http = require('http');
const express = require('express');
const socketManager = require('./path/to/socketManager');

const app = express();
const server = http.createServer(app);

// Initialize socket.io
socketManager.initialize(server);

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});
```

### Client-side Connection

Connect from the client with authentication:

```javascript
// Using the Socket.IO client library
const socket = io('http://your-server-url', {
  auth: {
    token: 'your_jwt_token'
  }
});

// Alternatively, you can connect with the token as a query parameter
const socket = io('http://your-server-url?token=your_jwt_token');
```

## Authentication

Authentication is handled using JSON Web Tokens (JWT). The Socket Manager verifies the token on connection and attaches the user information to the socket.

- The token must be provided either in the `auth.token` object or as a query parameter.
- If authentication fails, the connection is rejected.
- On successful authentication, the user's online status is updated in the database.

## Connection Management

The Socket Manager maintains two maps to track user connections:

- `connectedUsers`: Maps user IDs to socket IDs (`{ userId: socketId }`)
- `socketToUser`: Maps socket IDs to user IDs (`{ socketId: userId }`)

These maps are used to:
- Track which users are currently connected
- Send targeted messages to specific users
- Broadcast status changes to friends

## Events

### System Events

#### Connection

Triggered when a user successfully connects.

**Server Actions:**
- Adds the user to the connected users map
- Updates the user's online status in the database
- Broadcasts the user's online status to their friends

#### Disconnect

Triggered when a user disconnects.

**Server Actions:**
- Removes the user from the connected users map
- Updates the user's online status to offline (after a 5-second delay)
- Broadcasts the user's offline status to their friends

#### Ping/Pong

Simple heartbeat mechanism to keep connections alive.

**Client Emits:**
```javascript
socket.emit('ping');
```

**Server Responds:**
```javascript
socket.on('ping', () => {
  socket.emit('pong');
  // Updates the user's last active timestamp
});
```

### Status Events

#### Status Change

Manually change a user's online status.

**Client Emits:**
```javascript
socket.emit('status_change', { isOnline: false });
```

**Server Actions:**
- Updates the user's online status in the database
- Broadcasts the status change to the user's friends

#### Request Friends Status

Get the current status of all friends.

**Client Emits:**
```javascript
socket.emit('request_friends_status');
```

**Server Responds:**
For each friend, emits:
```javascript
// Emitted for each friend in the user's friends list
socket.emit('friend_status_change', {
  userId: 'friend_id',
  username: 'friend_username',
  isOnline: true/false,
  timestamp: Date.now()
});
```

#### Friend Status Change

Notifies a user when a friend's status changes.

**Client Listens:**
```javascript
socket.on('friend_status_change', (data) => {
  console.log(`${data.username} is now ${data.isOnline ? 'online' : 'offline'}`);
});
```

### Friend Management Events

#### Friend Request

Notifies a user of a new friend request or accepted request.

**Client Listens:**
```javascript
socket.on('friend_request', (data) => {
  if (data.type === 'new_request') {
    console.log(`New friend request from ${data.from.username}`);
  } else if (data.type === 'request_accepted') {
    console.log(`${data.from.username} accepted your friend request`);
  } else if (data.type === 'self_accepted_request') {
    console.log(`You accepted a friend request from ${data.from.username}`);
  }
});
```

#### Manual Friend Accept

Manually accept a friend request.

**Client Emits:**
```javascript
socket.emit('manual_friend_accept', {
  userId: 'requester_id',
  username: 'requester_username'
});
```

**Server Actions:**
- Updates both users' friends lists in the database
- Notifies both users about the accepted request
- Emits events to update both users' friend lists

#### Friend List Update Request

Force update the client's friend list.

**Client Emits:**
```javascript
socket.emit('friend_list_update_request');
```

**Server Responds:**
```javascript
socket.emit('friend_list_update');
```

### Game Events

#### Game Invite

Send a game invitation to a friend.

**Client Emits:**
```javascript
socket.emit('game_invite', {
  friendId: 'friend_user_id'
});
```

**Friend Receives:**
```javascript
socket.on('game_invitation', (data) => {
  console.log(`${data.from.username} invited you to play game ${data.gameId}`);
});
```

#### Game Word Submission

Submit a word in a word game.

**Client Emits:**
```javascript
socket.emit('game_word_submission', {
  gameId: 'game_id',
  word: 'submitted_word'
});
```

**Server Responds:**
```javascript
socket.emit('game_word_result', {
  valid: true/false,
  message: 'Result message',
  game: gameObject // Full game state
});
```

**Opponent Receives:**
```javascript
socket.on('game_updated', (data) => {
  console.log(`Game ${data.gameId} was updated: ${data.message}`);
  // data.game contains the updated game state
});
```

## API Reference

### Public Functions

#### `initialize(server)`

Initializes the Socket.IO server.

**Parameters:**
- `server` (Object): HTTP server instance

**Returns:**
- (Object): Socket.IO instance

**Example:**
```javascript
const server = http.createServer(app);
socketManager.initialize(server);
```

#### `getIO()`

Returns the Socket.IO instance.

**Returns:**
- (Object): Socket.IO instance

**Throws:**
- Error if Socket.IO is not initialized

**Example:**
```javascript
const io = socketManager.getIO();
io.emit('broadcast', { message: 'Hello everyone!' });
```

#### `isUserConnected(userId)`

Checks if a user is currently connected.

**Parameters:**
- `userId` (String): The ID of the user to check

**Returns:**
- (Boolean): True if the user is connected, false otherwise

**Example:**
```javascript
if (socketManager.isUserConnected('60d0fe4f5311236168a109ca')) {
  // User is online
}
```

#### `sendFriendRequestNotification(toUserId, fromUser)`

Sends a friend request notification to a user in real-time.

**Parameters:**
- `toUserId` (String): The ID of the user to send the notification to
- `fromUser` (Object): Object containing the requester's information
  - `_id` (String): The ID of the user who sent the request
  - `username` (String): The username of the user who sent the request

**Example:**
```javascript
socketManager.sendFriendRequestNotification('60d0fe4f5311236168a109ca', {
  _id: '60d0fe4f5311236168a109cb',
  username: 'johndoe'
});
```

#### `sendFriendRequestAcceptedNotification(toUserId, fromUser)`

Sends a notification when a friend request is accepted.

**Parameters:**
- `toUserId` (String): The ID of the user to send the notification to
- `fromUser` (Object): Object containing the accepter's information
  - `_id` (String): The ID of the user who accepted the request
  - `username` (String): The username of the user who accepted the request

**Example:**
```javascript
socketManager.sendFriendRequestAcceptedNotification('60d0fe4f5311236168a109ca', {
  _id: '60d0fe4f5311236168a109cb',
  username: 'johndoe'
});
```

#### `broadcastStatusToFriends(userId, isOnline)`

Broadcasts user status change to all of their online friends.

**Parameters:**
- `userId` (String): The ID of the user whose status changed
- `isOnline` (Boolean): The new online status

**Example:**
```javascript
socketManager.broadcastStatusToFriends('60d0fe4f5311236168a109ca', true);
```

#### `getSocketId(userId)`

Gets the socket ID for a connected user.

**Parameters:**
- `userId` (String): The ID of the user

**Returns:**
- (String|undefined): The socket ID if the user is connected, undefined otherwise

**Example:**
```javascript
const socketId = socketManager.getSocketId('60d0fe4f5311236168a109ca');
if (socketId) {
  const io = socketManager.getIO();
  io.to(socketId).emit('privateMessage', { message: 'Hello!' });
}
```

## Examples

### Complete Client Implementation Example

```javascript
// Client implementation using React with a custom hook
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const useSocket = (authToken) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendsStatus, setFriendsStatus] = useState({});
  
  useEffect(() => {
    if (!authToken) return;
    
    // Initialize socket connection
    const newSocket = io('http://your-server-url', {
      auth: { token: authToken }
    });
    
    // Connection events
    newSocket.on('connect', () => {
      setConnected(true);
      console.log('Connected to socket server');
      
      // Request initial friends status
      newSocket.emit('request_friends_status');
      
      // Start heartbeat ping
      const pingInterval = setInterval(() => {
        newSocket.emit('ping');
      }, 25000);
      
      return () => clearInterval(pingInterval);
    });
    
    newSocket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from socket server');
    });
    
    // Friend requests
    newSocket.on('friend_request', (data) => {
      if (data.type === 'new_request') {
        setFriendRequests(prev => [...prev, data]);
        // Show notification to user
      } else if (data.type === 'request_accepted') {
        // Show notification that a request was accepted
        // Refresh friends list
      }
    });
    
    // Friend status updates
    newSocket.on('friend_status_change', (data) => {
      setFriendsStatus(prev => ({
        ...prev,
        [data.userId]: {
          username: data.username,
          isOnline: data.isOnline,
          lastUpdated: data.timestamp
        }
      }));
    });
    
    // Friend list updates
    newSocket.on('friend_list_update', () => {
      // Trigger a fetch of the updated friends list from your API
    });
    
    // Game invitations
    newSocket.on('game_invitation', (data) => {
      // Show notification about game invitation
    });
    
    // Set socket in state for later use
    setSocket(newSocket);
    
    // Cleanup on unmount
    return () => {
      newSocket.disconnect();
    };
  }, [authToken]);
  
  // Functions that use the socket
  const acceptFriendRequest = (userId, username) => {
    if (socket && connected) {
      socket.emit('manual_friend_accept', { userId, username });
    }
  };
  
  const inviteFriendToGame = (friendId) => {
    if (socket && connected) {
      socket.emit('game_invite', { friendId });
    }
  };
  
  const submitWordInGame = (gameId, word) => {
    if (socket && connected) {
      socket.emit('game_word_submission', { gameId, word });
    }
  };
  
  return {
    socket,
    connected,
    friendRequests,
    friendsStatus,
    acceptFriendRequest,
    inviteFriendToGame,
    submitWordInGame
  };
};

export default useSocket;
```

### Server-side Integration Example

```javascript
// Example of integrating the socket manager with friend request functionality
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const socketManager = require('../socketManager');

// API endpoint for sending a friend request
router.post('/send-request', async (req, res) => {
  try {
    const { userId } = req.body;
    const requestingUser = req.user; // From auth middleware
    
    // Check if already friends
    const user = await User.findById(requestingUser.id);
    if (user.friends.includes(userId)) {
      return res.status(400).json({ message: 'Already friends with this user' });
    }
    
    // Add to friend requests in database
    await User.findByIdAndUpdate(userId, {
      $addToSet: { friendRequests: requestingUser.id }
    });
    
    // Send real-time notification
    socketManager.sendFriendRequestNotification(userId, {
      _id: requestingUser.id,
      username: requestingUser.username
    });
    
    res.status(200).json({ message: 'Friend request sent' });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
```
