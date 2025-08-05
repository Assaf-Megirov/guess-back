const mongoose = require('mongoose');
const Message = require('./Message');

// Chat Schema
const chatSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  name: {
    type: String,
    trim: true,
    default: null
  },
  lastMessage: {
    content: String,
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  messageCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

chatSchema.index({ participants: 1 });
chatSchema.index({ updatedAt: -1 });
chatSchema.index({ 'lastMessage.timestamp': -1 });

chatSchema.statics.findUserChats = function(userId) {
  return this.find({ participants: userId })
    .populate('participants', '_id username email avatar')
    .populate('lastMessage.sender', '_id username email avatar')
    .sort({ updatedAt: -1 });
};

chatSchema.statics.findChat = function(userId1, userId2) {
  return this.findOne({
    participants: { $all: [userId1, userId2] }
  })
  .populate('participants', '_id username email avatar')
  .populate('lastMessage.sender', '_id username email avatar');
};

chatSchema.statics.sendMessage = async function(userId, friendId, message) { //TODO: needs to change updatedAt of the Chat
    try {
      let chat = await this.findChat(userId, friendId);
      if (!chat) {
        chat = new this({ //create a new chat if none exists
          participants: [userId, friendId]
        });
        await chat.save();
      }
      
      const newMessage = new Message({
        chatId: chat._id,
        sender: userId,
        content: message
      });
      
      await newMessage.save();
      await chat.updateOne({ updatedAt: Date.now() });
      return newMessage;
      
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  };

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;