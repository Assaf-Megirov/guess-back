const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  fileUrl: {
    type: String,
  },
  fileName: {
    type: String,
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  edited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  }
}, {
  timestamps: true
});

messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ 'readBy.user': 1 });

messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(r => r.user.equals(userId));
  if (!existingRead) {
    this.readBy.push({
      user: userId,
      readAt: new Date()
    });
  }
  return this.save();
};

messageSchema.methods.editContent = function(newContent) {
  this.content = newContent;
  this.edited = true;
  this.editedAt = new Date();
  return this.save();
};

messageSchema.statics.getChatMessages = function(chatId, page = 1, limit = 50) {
    //check if the id is valid
    if(!chatId || !mongoose.Types.ObjectId.isValid(chatId)) return [];
    return this.find({ chatId })
        .populate('sender', '_id username avatar')
        .populate('readBy.user', '_id username')
        .sort({ createdAt: 1 })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean();
};

messageSchema.post('save', async function(doc) { //automatically updates the chat's lastMessage when a new message is created
  if (this.isNew) {
    await mongoose.model('Chat').findByIdAndUpdate(
      doc.chatId,
      {
        lastMessage: {
          content: doc.content,
          sender: doc.sender,
          timestamp: doc.createdAt
        },
        $inc: { messageCount: 1 }
      },
      { new: true }
    );
  }
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;