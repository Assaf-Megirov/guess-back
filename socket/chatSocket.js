const logger = require('../utils/logger');
const  Message  = require('../models/Message');
const  Chat  = require('../models/Chat');

function initializeChatSocket(chatNamespace, authMiddleware) {
    chatNamespace.use(authMiddleware);
    
    chatNamespace.on('connection', (socket) => {
        const userId = socket.userId;
        logger.info(`User ${userId} connected to chat`);
        
        socket.join(userId.toString());
        
        socket.on('send_message', async (data) => {
            try {
                const { friendId, message } = data;
                
                if (!friendId || !message || !message.trim()) {
                    socket.emit('error', { message: 'Invalid message data' });
                    return;
                }
                
                const newMessage = await Chat.sendMessage(userId, friendId, message.trim());
                await newMessage.populate('sender', 'username avatar');
                
                chatNamespace.to(friendId.toString()).emit('message_received', newMessage);
                socket.emit('message_sent', newMessage);
                
            } catch (error) {
                logger.error('Error sending message:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        socket.on('typing_start', (data) => {
            const { friendId } = data;
            chatNamespace.to(friendId.toString()).emit('friend_typing', { userId });
        });
        
        socket.on('typing_stop', (data) => {
            const { friendId } = data;
            chatNamespace.to(friendId.toString()).emit('friend_stopped_typing', { userId });
        });
        
        socket.on('mark_as_read', async (data) => {
            try {
                const { messageId } = data;
                const message = await Message.findById(messageId);
                
                if (message) {
                    await message.markAsRead(userId);
                    chatNamespace.to(message.sender.toString()).emit('message_read', {
                        messageId,
                        readBy: userId
                    });
                }
            } catch (error) {
                logger.error('Error marking message as read:', error);
            }
        });
        
        socket.on('disconnect', () => {
            logger.info(`User ${userId} disconnected from chat`);
        });
    });
}

module.exports = {
    initializeChatSocket
};