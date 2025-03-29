const fs = require('fs');
const path = require('path');

// Create history directory if it doesn't exist
const HISTORY_DIR = path.join(process.cwd(), 'history');
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Ensure directory exists
 * @param {string} directory - The directory path to check and create if needed
 */
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

/**
 * Extract user ID from chat ID
 * @param {string} chatId - The chat ID (can be user or group)
 * @returns {string} - The sanitized user ID
 */
function getUserIdFromChatId(chatId) {
  // Extract user ID from chat ID
  const userId = chatId.includes('@') ? chatId.split('@')[0] : chatId;
  // Sanitize the userId to create a valid directory name
  return userId.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Get the user directory for a specific chat
 * @param {string} chatId - The chat ID (can be user or group)
 * @param {string} convType - Conversation type (defaults to "chat")
 * @returns {string} - The directory for the user's data
 */
function getUserDirectory(chatId, convType = "chat") {
  const sanitizedUserId = getUserIdFromChatId(chatId);
  const userDir = path.join(HISTORY_DIR, sanitizedUserId);
  
  // Create directory if it doesn't exist
  ensureDirectoryExists(userDir);
  
  // If a specific conversation type is provided, create a subfolder
  if (convType && convType !== "chat") {
    const typeDir = path.join(userDir, convType);
    ensureDirectoryExists(typeDir);
    return typeDir;
  }
  
  return userDir;
}

/**
 * Get the filename for a specific chat
 * @param {string} chatId - The chat ID (can be user or group)
 * @param {string} convType - Conversation type (defaults to "chat")
 * @returns {string} - The filename for the chat history
 */
function getHistoryFilename(chatId, convType = "chat") {
  const userDir = getUserDirectory(chatId, convType);
  return path.join(userDir, 'chat_history.json');
}

/**
 * Save a message to history
 * @param {object} message - The message object
 * @param {string} role - The role (user or assistant)
 * @param {string} content - The message content
 * @param {string} convType - Conversation type (defaults to "chat")
 */
function saveMessageToHistory(message, role, content, convType = "chat") {
  try {
    const chatId = message.chat;
    const filename = getHistoryFilename(chatId, convType);
    
    // Create or load existing history
    let history = [];
    if (fs.existsSync(filename)) {
      const fileContent = fs.readFileSync(filename, 'utf8');
      history = JSON.parse(fileContent);
    }
    
    // Add the new message
    history.push({
      timestamp: new Date().toISOString(),
      role,
      content,
      sender: message.sender
    });
    
    // Save the updated history
    fs.writeFileSync(filename, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error saving message to history:', error);
  }
}

/**
 * Get message history for a chat
 * @param {string} chatId - The chat ID
 * @param {string} convType - Conversation type (defaults to "chat")
 * @returns {Array} - The chat history
 */
function getMessageHistory(chatId, convType = "chat") {
  try {
    const filename = getHistoryFilename(chatId, convType);
    
    if (fs.existsSync(filename)) {
      const fileContent = fs.readFileSync(filename, 'utf8');
      return JSON.parse(fileContent);
    }
    
    // Only check old locations for default chat type
    if (convType === "chat") {
      // If not found in new location, check if it exists in old location (HISTORY directory)
      const oldDirectory = path.join(process.cwd(), 'HISTORY');
      if (fs.existsSync(oldDirectory)) {
        const sanitizedChatId = chatId.replace(/[^a-zA-Z0-9]/g, '_');
        const oldFilename = path.join(oldDirectory, `${sanitizedChatId}.json`);
        
        if (fs.existsSync(oldFilename)) {
          console.log(`Found history in old location: ${oldFilename}, will migrate`);
          const fileContent = fs.readFileSync(oldFilename, 'utf8');
          const history = JSON.parse(fileContent);
          
          // Migrate to new location
          const newUserDir = getUserDirectory(chatId);
          ensureDirectoryExists(newUserDir);
          fs.writeFileSync(filename, JSON.stringify(history, null, 2));
          
          // Delete old file after migration
          try {
            fs.unlinkSync(oldFilename);
            console.log(`Migrated and deleted old history file: ${oldFilename}`);
          } catch (e) {
            console.error(`Failed to delete old history file: ${e.message}`);
          }
          
          return history;
        }
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error retrieving message history:', error);
    return [];
  }
}

/**
 * Clear message history for a chat
 * @param {string} chatId - The chat ID
 * @param {string} convType - Conversation type (defaults to "chat")
 * @returns {boolean} - Success or failure
 */
function clearMessageHistory(chatId, convType = "chat") {
  try {
    const filename = getHistoryFilename(chatId, convType);
    
    if (fs.existsSync(filename)) {
      // Delete the file completely instead of just emptying it
      fs.unlinkSync(filename);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error clearing message history:', error);
    return false;
  }
}

/**
 * Get formatted history for AI context
 * @param {string} chatId - The chat ID
 * @param {number} maxMessages - Maximum number of messages to include
 * @param {string} convType - Conversation type (defaults to "chat")
 * @returns {string} - Formatted history for context
 */
function getFormattedHistoryForContext(chatId, maxMessages = 10, convType = "chat") {
  const history = getMessageHistory(chatId, convType);
  
  if (history.length === 0) {
    return '';
  }
  
  // Get the most recent messages up to maxMessages
  const recentMessages = history.slice(-maxMessages);
  
  // Format messages for context
  return recentMessages.map(msg => 
    `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
  ).join('\n');
}

module.exports = {
  saveMessageToHistory,
  getMessageHistory,
  clearMessageHistory,
  getFormattedHistoryForContext,
  getUserDirectory,
  getUserIdFromChatId
};