const { BufferJSON, WA_DEFAULT_EPHEMERAL, generateWAMessageFromContent, proto, generateWAMessageContent, generateWAMessage, prepareWAMessageMedia, areJidsSameUser, getContentType, downloadMediaMessage } = require("@whiskeysockets/baileys");
const fs = require("fs");
const util = require("util");
const path = require("path");
const chalk = require("chalk");
const sharp = require("sharp");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const apiKeyPool = require("./lib/apiKeyPool");
let setting = require("./key.json");
const historyManager = require("./lib/historyManager");
const axios = require("axios");

// Admin configuration - only this number can access admin features
const ADMIN_NUMBER = "+6285172196650";

// Function to ensure directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    console.log(`Created directory: ${directory}`);
  }
}

// Function to compress image to a maximum size of 1280x720
async function compressImage(buffer, mimetype) {
  try {
    console.log("Compressing image...");
    
    // Create a sharp instance from the buffer
    const image = sharp(buffer);
    
    // Get image metadata
    const metadata = await image.metadata();
    
    // Determine if resize is needed
    const needsResize = metadata.width > 1280 || metadata.height > 720;
    
    // Set up compression options
    let processedImage = image;
    
    if (needsResize) {
      // Resize the image while maintaining aspect ratio
      processedImage = processedImage.resize({
        width: Math.min(1280, metadata.width),
        height: Math.min(720, metadata.height),
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Determine output format based on mimetype
    let outputOptions = {};
    let outputFormat;
    
    if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
      outputFormat = 'jpeg';
      outputOptions = { quality: 80 };  // 80% quality for JPEG
    } else if (mimetype === 'image/png') {
      outputFormat = 'png';
      outputOptions = { compressionLevel: 8 }; // Higher compression for PNG
    } else if (mimetype === 'image/webp') {
      outputFormat = 'webp';
      outputOptions = { quality: 80 };
    } else {
      // Default to JPEG for other formats
      outputFormat = 'jpeg';
      outputOptions = { quality: 80 };
      mimetype = 'image/jpeg';
    }
    
    // Convert to the chosen format with options
    processedImage = processedImage[outputFormat](outputOptions);
    
    // Get the compressed buffer
    const compressedBuffer = await processedImage.toBuffer();
    
    console.log(`Image compressed: ${buffer.length} bytes → ${compressedBuffer.length} bytes (${Math.round(compressedBuffer.length / buffer.length * 100)}%)`);
    
    return {
      buffer: compressedBuffer,
      mimetype
    };
  } catch (error) {
    console.error("Error compressing image:", error);
    // Return original if compression fails
    return { buffer, mimetype };
  }
}

// Function to save image and return its ID
async function saveImageToFile(buffer, sender, mimetype) {
  // Compress the image first
  const compressed = await compressImage(buffer, mimetype);
  
  // Get user directory from historyManager
  const chatId = sender;
  const userDir = historyManager.getUserDirectory(chatId);
  
  // Create images subdirectory if it doesn't exist
  const imagesDir = path.join(userDir, 'images');
  ensureDirectoryExists(imagesDir);
  
  // Generate unique ID for the image
  const imageId = Date.now();
  const extension = compressed.mimetype.split('/')[1];
  const fileName = `${imageId}.${extension}`;
  const filePath = path.join(imagesDir, fileName);
  
  // Save image to file
  fs.writeFileSync(filePath, compressed.buffer);
  console.log(`Saved compressed image to ${filePath}`);
  
  return {
    id: imageId,
    path: filePath,
    mimetype: compressed.mimetype,
    buffer: compressed.buffer
  };
}

// Function to load image from file and convert to base64
function loadImageAsBase64(imageReference, chatId) {
  try {
    const parts = imageReference.split(':');
    if (parts.length !== 2) return null;
    
    const imageId = parts[1];
    // Get user directory from historyManager
    const userDir = historyManager.getUserDirectory(chatId);
    const imagesDir = path.join(userDir, 'images');
    
    // Check if images directory exists
    if (!fs.existsSync(imagesDir)) {
      console.error(`Images directory not found: ${imagesDir}`);
      return null;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(imagesDir);
    const imageFile = files.find(file => file.startsWith(imageId + '.'));
    
    if (!imageFile) {
      console.error(`Image file with ID ${imageId} not found in ${imagesDir}`);
      return null;
    }
    
    const filePath = path.join(imagesDir, imageFile);
    const buffer = fs.readFileSync(filePath);
    const mimetype = 'image/' + imageFile.split('.').pop();
    
    console.log(`Successfully loaded image from: ${filePath}`);
    
    return {
      data: buffer.toString('base64'),
      mimeType: mimetype
    };
  } catch (error) {
    console.error(`Error loading image: ${error.message}`);
    return null;
  }
}

// Function to load generated image from file and convert to base64
function loadGeneratedImageAsBase64(imageReference, chatId) {
  try {
    const parts = imageReference.split(':');
    if (parts.length !== 2) return null;
    
    const imageId = parts[1];
    // Get user directory for image_gen
    const userDir = historyManager.getUserDirectory(chatId, "image_gen");
    const imagesDir = path.join(userDir, 'generated');
    
    // Check if generated images directory exists
    if (!fs.existsSync(imagesDir)) {
      console.error(`Generated images directory not found: ${imagesDir}`);
      return null;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(imagesDir);
    const imageFile = files.find(file => file.startsWith(imageId + '.'));
    
    if (!imageFile) {
      console.error(`Generated image file with ID ${imageId} not found in ${imagesDir}`);
      return null;
    }
    
    const filePath = path.join(imagesDir, imageFile);
    const buffer = fs.readFileSync(filePath);
    const mimetype = 'image/' + imageFile.split('.').pop();
    
    console.log(`Successfully loaded generated image from: ${filePath}`);
    
    return {
      data: buffer.toString('base64'),
      mimeType: mimetype
    };
  } catch (error) {
    console.error(`Error loading generated image: ${error.message}`);
    return null;
  }
}

// Function to load system prompt from file
function loadSystemPrompt() {
  const systemPromptPath = path.join(process.cwd(), 'system.txt');
  
  try {
    if (fs.existsSync(systemPromptPath)) {
      const systemPrompt = fs.readFileSync(systemPromptPath, 'utf8');
      console.log("Loaded custom system prompt from system.txt");
      return systemPrompt;
    } else {
      // Default system prompt if file doesn't exist
      const defaultPrompt = "You are a friendly and helpful AI assistant named Veo. You provide concise, accurate, and helpful responses. You are polite and respectful. If you don't know the answer to something, you'll admit it rather than making up information. You should avoid controversial topics and follow ethical guidelines.";
      
      // Create the file with default prompt for future editing
      fs.writeFileSync(systemPromptPath, defaultPrompt);
      console.log("Created system.txt with default system prompt");
      
      return defaultPrompt;
    }
  } catch (error) {
    console.error("Error loading system prompt:", error);
    return "You are a friendly and helpful AI assistant named Veo. You provide concise, accurate, and helpful responses.";
  }
}

module.exports = sansekai = async (upsert, sock, store, message) => {
  try {
    let budy = (typeof message.text == 'string' ? message.text : '')
    // var prefix = /^[\\/!#.]/gi.test(body) ? body.match(/^[\\/!#.]/gi) : "/"
    var prefix = /^[\\/!#.]/gi.test(budy) ? budy.match(/^[\\/!#.]/gi) : "/";
    const isCmd = budy.startsWith(prefix);
    const command = budy.replace(prefix, "").trim().split(/ +/).shift().toLowerCase();
    const args = budy.trim().split(/ +/).slice(1);
    const pushname = message.pushName || "No Name";
    const botNumber = sock.user.id;
    const itsMe = message.sender == botNumber ? true : false;
    let text = (q = args.join(" "));
    const arg = budy.trim().substring(budy.indexOf(" ") + 1);
    const arg1 = arg.trim().substring(arg.indexOf(" ") + 1);
    const from = message.chat;

    // Check if sender is admin
    const isAdmin = message.sender.replace("@s.whatsapp.net", "") === ADMIN_NUMBER.replace("+", "");

    const color = (text, color) => {
      return !color ? chalk.green(text) : chalk.keyword(color)(text);
    };

    // Group
    const groupMetadata = message.isGroup ? await sock.groupMetadata(message.chat).catch((e) => {}) : "";
    const groupName = message.isGroup ? groupMetadata.subject : "";

    // Push Message To Console
    let argsLog = budy.length > 30 ? `${q.substring(0, 30)}...` : budy;

    if (isCmd && !message.isGroup) {
      console.log(chalk.black(chalk.bgWhite("[ LOGS ]")), color(argsLog, "turquoise"), chalk.magenta("From"), chalk.green(pushname), chalk.yellow(`[ ${message.sender.replace("@s.whatsapp.net", "")} ]`));
    } else if (isCmd && message.isGroup) {
      console.log(
        chalk.black(chalk.bgWhite("[ LOGS ]")),
        color(argsLog, "turquoise"),
        chalk.magenta("From"),
        chalk.green(pushname),
        chalk.yellow(`[ ${message.sender.replace("@s.whatsapp.net", "")} ]`),
        chalk.blueBright("IN"),
        chalk.green(groupName)
      );
    }

    if (isCmd) {
      switch (command) {
        case "help": case "menu": case "start": case "info":
          message.reply(`*✨ Veo AI Assistant ✨*

Veo adalah asisten AI Gen-Z yang cerdas dan seru by Vallian! 🌟

Gunakan ${prefix}a untuk bertanya apa saja atau analisis gambar 📸
Gunakan ${prefix}g untuk membuat gambar dengan AI 🎨
`)
          break;
        case "addkey":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            if (args.length < 2) {
              return message.reply(`Format: ${prefix}addkey [service] [apikey]`);
            }
            
            const serviceName = args[0].toLowerCase();
            const apiKey = args[1];
            
            if (apiKeyPool.addKey(serviceName, apiKey)) {
              message.reply(`✅ API key added successfully for ${serviceName}`);
            } else {
              message.reply(`❌ API key already exists for ${serviceName}`);
            }
          } catch (error) {
            console.error("Error adding API key:", error);
            message.reply("❌ Error while adding API key.");
          }
          break;
        case "removekey":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            if (args.length < 2) {
              return message.reply(`Format: ${prefix}removekey [service] [apikey]`);
            }
            
            const serviceName = args[0].toLowerCase();
            const apiKey = args[1];
            
            if (apiKeyPool.removeKey(serviceName, apiKey)) {
              message.reply(`✅ API key removed successfully from ${serviceName}`);
            } else {
              message.reply(`❌ API key not found for ${serviceName}`);
            }
          } catch (error) {
            console.error("Error removing API key:", error);
            message.reply("❌ Error while removing API key.");
          }
          break;
        case "listkeys":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            const allKeys = apiKeyPool.getAllKeys();
            let keyReport = "*API Key Summary*\n\n";
            
            for (const [service, keys] of Object.entries(allKeys)) {
              keyReport += `- ${service}: ${keys.length} key(s)\n`;
            }
            
            message.reply(keyReport);
          } catch (error) {
            console.error("Error listing API keys:", error);
            message.reply("❌ Error while retrieving API keys.");
          }
          break;
        case "clear": case "reset":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            // Clear chat history json
            const chatSuccess = historyManager.clearMessageHistory(message.chat);
            
            // Clear image generation history
            const imageGenSuccess = historyManager.clearMessageHistory(message.chat, "image_gen");
            
            // Clear images directories
            const userDir = historyManager.getUserDirectory(message.chat);
            let imagesCleared = 0;
            
            // Clear regular chat images
            const chatImagesDir = path.join(userDir, 'images');
            if (fs.existsSync(chatImagesDir)) {
              const files = fs.readdirSync(chatImagesDir);
              for (const file of files) {
                fs.unlinkSync(path.join(chatImagesDir, file));
                imagesCleared++;
              }
              console.log(`Cleared chat image directory: ${chatImagesDir}`);
            }
            
            // Clear generated images
            const imageGenDir = historyManager.getUserDirectory(message.chat, "image_gen");
            const generatedImagesDir = path.join(imageGenDir, 'generated');
            const uploadedImagesDir = path.join(imageGenDir, 'uploads');
            
            if (fs.existsSync(generatedImagesDir)) {
              const files = fs.readdirSync(generatedImagesDir);
              for (const file of files) {
                fs.unlinkSync(path.join(generatedImagesDir, file));
                imagesCleared++;
              }
              console.log(`Cleared generated image directory: ${generatedImagesDir}`);
            }
            
            // Clear uploaded images for image generation
            if (fs.existsSync(uploadedImagesDir)) {
              const files = fs.readdirSync(uploadedImagesDir);
              for (const file of files) {
                fs.unlinkSync(path.join(uploadedImagesDir, file));
                imagesCleared++;
              }
              console.log(`Cleared uploaded images directory: ${uploadedImagesDir}`);
            }
            
            if (chatSuccess || imageGenSuccess) {
              message.reply(`✅ Cleared: ${chatSuccess ? 'Chat history' : ''}${chatSuccess && imageGenSuccess ? ' and ' : ''}${imageGenSuccess ? 'Image generation history' : ''}${imagesCleared > 0 ? ` (${imagesCleared} images removed)` : ''}`);
            } else {
              message.reply("❌ No history found to clear.");
            }
          } catch (error) {
            console.error("Error clearing history:", error);
            message.reply("❌ Error while clearing chat history.");
          }
          break;
        case "clearg":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            // Clear only image generation history
            const imageGenSuccess = historyManager.clearMessageHistory(message.chat, "image_gen");
            
            // Clear generated images directory
            const imageGenDir = historyManager.getUserDirectory(message.chat, "image_gen");
            const generatedImagesDir = path.join(imageGenDir, 'generated');
            const uploadedImagesDir = path.join(imageGenDir, 'uploads');
            let imagesCleared = 0;
            
            // Clear generated images
            if (fs.existsSync(generatedImagesDir)) {
              const files = fs.readdirSync(generatedImagesDir);
              for (const file of files) {
                fs.unlinkSync(path.join(generatedImagesDir, file));
                imagesCleared++;
              }
              console.log(`Cleared generated image directory: ${generatedImagesDir}`);
            }
            
            // Clear uploaded images for generation
            if (fs.existsSync(uploadedImagesDir)) {
              const files = fs.readdirSync(uploadedImagesDir);
              for (const file of files) {
                fs.unlinkSync(path.join(uploadedImagesDir, file));
                imagesCleared++;
              }
              console.log(`Cleared uploaded images directory: ${uploadedImagesDir}`);
            }
            
            if (imageGenSuccess || imagesCleared > 0) {
              message.reply(`✅ Cleared image generation history${imagesCleared > 0 ? ` (${imagesCleared} images removed)` : ''}`);
            } else {
              message.reply("❌ No image generation history found to clear.");
            }
          } catch (error) {
            console.error("Error clearing image generation history:", error);
            message.reply("❌ Error while clearing image generation history.");
          }
          break;
        case "a": case "gemini": case "ai":
          try {
            // Check for image in the message
            const messageType = getContentType(message.message);
            const hasImage = messageType === 'imageMessage';
            const hasQuotedImage = message.quoted && getContentType(message.quoted.message) === 'imageMessage';
            
            // Send appropriate waiting message based on content type
            const thinkingMsg = await message.reply(hasImage || hasQuotedImage ? "Analyzing image..." : "Thinking...");
            let thinkingMsgKey = thinkingMsg.key;
            
            // Prepare data for retry mechanism
            let userMessageForHistory = "";
            let parts = [];
            let imageReference = "";
            let isRetrying = false;
            let retryCount = 0;
            const MAX_RETRIES = 10; // Maximum number of API keys to try
            let errorMessages = [];
            
            // Get chat history outside function scope so it's accessible to both functions
            const chatHistory = historyManager.getMessageHistory(message.chat);
            
            // Extract recent messages (last 30)
            const recentMessages = chatHistory.slice(-30);
            
            // Set safety settings to BLOCK_NONE for all categories
            const safetySettings = [
              {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "OFF",
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "OFF",
              },
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "OFF",
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "OFF",
              },
              {
                category: "HARM_CATEGORY_CIVIC_INTEGRITY", 
                threshold: "BLOCK_NONE",
              }
            ];
            
            // Process user input and prepare API request
            const prepareRequest = async () => {
              // Get API key from the pool
              const geminiApiKey = apiKeyPool.getKey("keygemini");
              
              if (!geminiApiKey) {
                throw new Error("No API key available for Google Gemini");
              }
              
              if (!text && !hasImage && !hasQuotedImage) {
                throw new Error("No content provided");
              }
              
              // Initialize Gemini AI with the selected API key
              const genAI = new GoogleGenerativeAI(geminiApiKey);
              
              // Reset parts array for each retry
              parts = [];
            
            // Process image if present
            if (hasImage || hasQuotedImage) {
              try {
                console.log("Processing image...");
                // Get the message that contains the image
                const imgMsg = hasQuotedImage ? message.quoted : message;
                
                // Download the media as buffer
                const buffer = await downloadMediaMessage(
                  imgMsg,
                  'buffer',
                  {},
                  { 
                    logger: console,
                    // For reupload if needed
                    reuploadRequest: sock.updateMediaMessage
                  }
                );
                
                // Get mimetype
                const mimetype = hasQuotedImage 
                  ? message.quoted.message.imageMessage.mimetype 
                  : message.message.imageMessage.mimetype;
                
                console.log("Image downloaded, saving to file...");
                
                // Save image to file and get reference (includes compression)
                const imageInfo = await saveImageToFile(buffer, message.sender, mimetype);
                imageReference = `[IMAGE ATTACHED:${imageInfo.id}]`;
                
                // Add compressed image to parts array for Gemini API
                parts.push({
                  inlineData: {
                    data: imageInfo.buffer.toString('base64'),
                    mimeType: imageInfo.mimetype
                  }
                });
                
                // If there's no text, use a default prompt
                if (!text) {
                  text = "Describe what you see in this image.";
                }
                
                console.log("Image processed successfully, reference:", imageReference);
              } catch (error) {
                console.error("Error processing image:", error);
                  throw new Error("Failed to process image: " + error.message);
              }
            }
            
            // Add text part
            parts.push({ text });
            
            // Save user message to history (include image reference if present)
              userMessageForHistory = imageReference ? `${imageReference} ${q}` : q;
              
              // Only save to history on first attempt, not on retries
              if (!isRetrying) {
            historyManager.saveMessageToHistory(message, 'user', userMessageForHistory);
              }
            
            // Get previous chat context and process for images
            let contextParts = [];
            
            if (recentMessages.length > 0) {
              // Process each message to extract and load referenced images
              const historyWithImages = [];
              
              // Add all previous images first
              for (const msg of recentMessages) {
                // Skip the current message we just added
                if (msg.content === userMessageForHistory && msg.role === 'user') continue;
                
                // Check if message contains image reference
                if (msg.content.includes('[IMAGE ATTACHED:')) {
                  // Extract image reference
                  const match = /\[IMAGE ATTACHED:([0-9]+)\]/.exec(msg.content);
                  if (match && match[1]) {
                    const imageId = match[1];
                    console.log(`Loading historical image with ID: ${imageId} from sender: ${msg.sender}`);
                    
                    // Try to load the image from storage
                    const imageData = loadImageAsBase64(`IMAGE ATTACHED:${imageId}`, msg.sender);
                    
                    if (imageData) {
                      console.log(`Successfully loaded historical image: ${imageId} and added to context`);
                      // Add image to context parts
                      contextParts.push({
                        inlineData: {
                          data: imageData.data,
                          mimeType: imageData.mimeType
                        }
                      });
                      
                      // Add formatted message with image placeholder
                      historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: [Image] ${msg.content.replace(/\[IMAGE ATTACHED:[0-9]+\]\s*/, '')}`);
                    } else {
                      console.error(`Failed to load historical image: ${imageId}`);
                      // Image not found, just add text with note
                      historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.replace(/\[IMAGE ATTACHED:[0-9]+\]/, '[Image]')}`);
                    }
                  } else {
                    // No valid image ID found
                    historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
                  }
                } else {
                  // Regular message without image
                  historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
                }
              }
              
              // Create context text with proper history
              const contextPrompt = `Previous conversation:\n${historyWithImages.join('\n')}\n\nUser's new message: ${text}`;
              
              // Add context as a text part
              contextParts.push({ text: contextPrompt });
            } else {
              // No history, just add current text
              contextParts.push({ text });
            }
            
            // Merge the context parts with our current parts
            // Current image always comes first if present
            const allParts = [...parts];
            
            // If we have image history, add them before text but after current image
            if (contextParts.length > 1) {
              // First part is current image (if exists), followed by historical images, then text at the end
              // If we have an image in current parts, keep it first
              if (parts.length > 1) {
                // Keep current image as first part
                allParts.pop(); // Remove text part
                // Add all context parts (images + text)
                allParts.push(...contextParts);
              } else {
                // No current image, so use all context parts as is
                allParts.splice(0, allParts.length, ...contextParts);
              }
            }
            
              console.log(`[Attempt ${retryCount + 1}] Sending to Gemini with API key`);
            
            const model = genAI.getGenerativeModel({ 
              model: "gemini-2.5-pro-exp-03-25",
              systemInstruction: {
                parts: [{ text: loadSystemPrompt() }],
                role: "system"
              },
                safetySettings: safetySettings,
              tools: [{
                googleSearch: {}
              }]
            });
              
              // Return model and parts to use for the API call
              return { model, allParts };
            };
            
            // Execute the API call with retry logic
            const executeWithRetry = async () => {
              while (retryCount < MAX_RETRIES) {
                try {
                  const { model, allParts } = await prepareRequest();
                  
                  // Create contents array for chat history
                  const contents = [];
                  
                  // Add messages from history with proper roles for Gemini API
                  if (recentMessages && recentMessages.length > 0) {
                    for (const msg of recentMessages) {
                      // Skip the current user message we just added to history
                      if (msg.content === userMessageForHistory && msg.role === 'user') continue;
                      
                      // Convert 'assistant' role to 'model' for Gemini API
                      const geminiRole = msg.role === 'assistant' ? 'model' : msg.role;
                      
                      // Add message with proper role
                      contents.push({
                        role: geminiRole,
                        parts: [{ text: msg.content }]
                      });
                    }
                  }
                  
                  // Add current user message with parts (may include images)
                  contents.push({
                    role: "user",
                    parts: allParts
                  });
                  
                  console.log(`Sending to Gemini with ${contents.length} messages in history`);
            
                  const result = await model.generateContent({
                    contents: contents,
                    generationConfig: {
                      responseModalities: ["TEXT"]
                    },
                    safetySettings: safetySettings
                  });
            
                  console.log("Received response from Gemini");
                  const response = await result.response;
                  const responseText = response.text();
                  
                  // Save AI response to history
                  historyManager.saveMessageToHistory(message, 'assistant', responseText);
                  
                  // Delete thinking message
                  await sock.sendMessage(message.chat, { delete: thinkingMsgKey });
                  
                  // Send actual response
                  await message.reply(responseText);
                  
                  // Exit the retry loop on success
                  return true;
                } catch (error) {
                  retryCount++;
                  console.error(`Attempt ${retryCount} failed:`, error);
                  errorMessages.push(error.message || "Unknown error");
                  
                  // If we've reached the limit, throw the error
                  if (retryCount >= MAX_RETRIES || retryCount >= apiKeyPool.getKeyCount("keygemini")) {
                    throw new Error("Maximum retry attempts reached");
                  }
                  
                  // Show retry message to user
                  isRetrying = true;
                  
                  // Update thinking message to show retry status
                  await sock.sendMessage(message.chat, { 
                    edit: thinkingMsgKey,
                    text: "ERROR, RETRYING... PLEASE WAIT" 
                  });
                  
                  // Short delay before retry
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            };
            
            // Start the execution with retry logic
            await executeWithRetry();
            
          } catch (error) {
            // Error handling - also delete thinking message on error
            try {
              // Try to delete the thinking message
              if (typeof thinkingMsgKey !== 'undefined') {
                await sock.sendMessage(message.chat, { delete: thinkingMsgKey });
              }
            } catch (deleteError) {
              console.error("Error deleting thinking message:", deleteError);
            }
            
            // Log errors to console
            console.error("Final error after retries:", error);
            console.error("Error messages:", errorMessages);
            
            // Show final error message to user
            message.reply("AI error, Hubungi Admin +6285172196650");
          }
          break;
        case "g": case "img": case "image":
          try {
            // Check for image in the message
            const messageType = getContentType(message.message);
            const hasImage = messageType === 'imageMessage';
            const hasQuotedImage = message.quoted && getContentType(message.quoted.message) === 'imageMessage';
            
            // Send waiting message
            const thinkingMsg = await message.reply("Generating image...");
            let thinkingMsgKey = thinkingMsg.key;
            
            // Prepare data for retry mechanism
            let retryCount = 0;
            const MAX_RETRIES = 10; // Maximum number of API keys to try
            let errorMessages = [];
            let isRetrying = false;
            let uploadedImageReference = ""; // Track uploaded image reference
            
            // Set safety settings with only supported categories for image generation
            const imgGenSafetySettings = [
              {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_CIVIC_INTEGRITY", 
                threshold: "BLOCK_NONE",
              }
            ];
            
            // Create separate directory for image generation history
            const userDir = historyManager.getUserDirectory(message.chat, "image_gen");
            const imagesDir = path.join(userDir, 'generated');
            const uploadedImagesDir = path.join(userDir, 'uploads');
            ensureDirectoryExists(imagesDir);
            ensureDirectoryExists(uploadedImagesDir);
            
            // Process uploaded image if present
            if (hasImage || hasQuotedImage) {
              try {
                console.log("Processing uploaded image for image generation...");
                // Get the message that contains the image
                const imgMsg = hasQuotedImage ? message.quoted : message;
                
                // Download the media as buffer
                const buffer = await downloadMediaMessage(
                  imgMsg,
                  'buffer',
                  {},
                  { 
                    logger: console,
                    // For reupload if needed
                    reuploadRequest: sock.updateMediaMessage
                  }
                );
                
                // Get mimetype
                const mimetype = hasQuotedImage 
                  ? message.quoted.message.imageMessage.mimetype 
                  : message.message.imageMessage.mimetype;
                
                console.log("Image downloaded, saving to file for image generation...");
                
                // Generate unique ID for the image
                const imageId = Date.now();
                const extension = mimetype.split('/')[1];
                const fileName = `${imageId}.${extension}`;
                const filePath = path.join(uploadedImagesDir, fileName);
                
                // Compress the image
                const compressed = await compressImage(buffer, mimetype);
                
                // Save image to file
                fs.writeFileSync(filePath, compressed.buffer);
                console.log(`Saved uploaded image for generation to ${filePath}`);
                
                // Set image reference
                uploadedImageReference = `[UPLOADED IMAGE:${imageId}]`;
                
                // If there's no text, use a default prompt
                if (!text) {
                  text = "Generate a new image based on this reference image.";
                }
              } catch (error) {
                console.error("Error processing uploaded image:", error);
                await sock.sendMessage(message.chat, { delete: thinkingMsgKey });
                return message.reply("Failed to process the uploaded image. Please try again.");
              }
            }
            
            // Save user prompt to history (including image reference)
            const userMessageForHistory = uploadedImageReference ? `${uploadedImageReference} ${q}` : q;
            if (!isRetrying) {
              historyManager.saveMessageToHistory(message, 'user', userMessageForHistory, "image_gen");
            }
            
            // Function to load uploaded image for image generation
            const loadUploadedImageForGeneration = (imageReference, chatId) => {
              try {
                // Parse the imageReference correctly
                let imageId;
                
                if (typeof imageReference === 'string') {
                  // If the reference is a complete tag like [UPLOADED IMAGE:12345]
                  if (imageReference.startsWith('[UPLOADED IMAGE:')) {
                    const match = /\[UPLOADED IMAGE:([0-9]+)\]/.exec(imageReference);
                    if (match && match[1]) {
                      imageId = match[1];
                    }
                  } 
                  // If it's already a parsed reference like "UPLOADED IMAGE:12345"
                  else if (imageReference.startsWith('UPLOADED IMAGE:')) {
                    imageId = imageReference.split(':')[1];
                  }
                  // If it's just the ID
                  else {
                    imageId = imageReference;
                  }
                }
                
                if (!imageId) {
                  console.error(`Invalid image reference format: ${imageReference}`);
                  return null;
                }
                
                console.log(`Looking for uploaded image with ID: ${imageId}`);
                
                const userDir = historyManager.getUserDirectory(chatId, "image_gen");
                const uploadsDir = path.join(userDir, 'uploads');
                
                if (!fs.existsSync(uploadsDir)) {
                  console.error(`Uploads directory not found: ${uploadsDir}`);
                  return null;
                }
                
                const files = fs.readdirSync(uploadsDir);
                const imageFile = files.find(file => file.startsWith(imageId + '.'));
                
                if (!imageFile) {
                  console.error(`Uploaded image file with ID ${imageId} not found in ${uploadsDir}`);
                  return null;
                }
                
                const filePath = path.join(uploadsDir, imageFile);
                const buffer = fs.readFileSync(filePath);
                const mimetype = 'image/' + imageFile.split('.').pop();
                
                console.log(`Successfully loaded uploaded image for generation from: ${filePath}`);
                
                return {
                  data: buffer.toString('base64'),
                  mimeType: mimetype
                };
              } catch (error) {
                console.error(`Error loading uploaded image for generation: ${error.message}`);
                return null;
              }
            };
            
            // Process user input and prepare API request
            const prepareImageGenRequest = async () => {
              if (!text && !uploadedImageReference) {
                throw new Error("Please provide a description or an image for generation");
              }
              
              // Get API key from the pool
              const geminiApiKey = apiKeyPool.getKey("keygemini");
              
              if (!geminiApiKey) {
                throw new Error("No API key available for Google Gemini");
              }
              
              // Initialize Gemini AI with the selected API key
              const genAI = new GoogleGenerativeAI(geminiApiKey);
              
              console.log(`[Attempt ${retryCount + 1}] Sending image generation request to Gemini`);
              
              // Prepare parts for the API request
              let parts = [];
              
              // Counter for context images (limit to 10)
              let contextImageCount = 0;
              const MAX_CONTEXT_IMAGES = 10;
              
              // Add uploaded image if present
              if (uploadedImageReference) {
                console.log(`Attempting to load uploaded image: ${uploadedImageReference}`);
                const uploadedImageData = loadUploadedImageForGeneration(uploadedImageReference, message.chat);
                if (uploadedImageData) {
                  console.log("Successfully loaded uploaded image for generation request");
                  parts.push({
                    inlineData: {
                      data: uploadedImageData.data,
                      mimeType: uploadedImageData.mimeType
                    }
                  });
                  contextImageCount++;
          } else {
                  console.error(`Failed to load uploaded image: ${uploadedImageReference}`);
                }
              }
              
              // Get previous chat context for image generation
              let promptWithContext = text;
              
              // Get previous chat history
              const chatHistory = historyManager.getMessageHistory(message.chat, "image_gen");
              
              // Extract recent messages (last 30)
              const recentMessages = chatHistory.slice(-30);
              
              if (recentMessages.length > 0) {
                // Process each message to extract any referenced images
                const historyWithImages = [];
                
                // Process each message in history
                for (const msg of recentMessages) {
                  // Skip the current message we just added
                  if (msg.content === userMessageForHistory && msg.role === 'user') continue;
                  
                  // Break if we've reached max context images
                  if (contextImageCount >= MAX_CONTEXT_IMAGES) {
                    console.log(`Reached maximum context images limit (${MAX_CONTEXT_IMAGES})`);
                    historyWithImages.push(`[Note: Some previous images are not included in context due to limit of ${MAX_CONTEXT_IMAGES} images]`);
                    break;
                  }
                  
                  // Check if message contains uploaded image reference
                  if (msg.content.includes('[UPLOADED IMAGE:')) {
                    // Extract image reference
                    const match = /\[UPLOADED IMAGE:([0-9]+)\]/.exec(msg.content);
                    if (match && match[1]) {
                      const imageId = match[1];
                      console.log(`Found historical uploaded image: ${imageId}`);
                      
                      // Try to load the uploaded image
                      const imageData = loadUploadedImageForGeneration(`UPLOADED IMAGE:${imageId}`, message.chat);
                      if (imageData) {
                        console.log(`Successfully loaded historical uploaded image: ${imageId}`);
                        // Add image to parts for context
                        parts.push({
                          inlineData: {
                            data: imageData.data,
                            mimeType: imageData.mimeType
                          }
                        });
                        contextImageCount++;
                      }
                      
                      historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: (Uploaded an image) ${msg.content.replace(/\[UPLOADED IMAGE:[0-9]+\]\s*/, '')}`);
                    } else {
                      historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.replace(/\[UPLOADED IMAGE:[0-9]+\]/, '(Uploaded an image)')}`);
                    }
                  }
                  // Check if assistant message contains generated image reference
                  else if (msg.role === 'assistant' && msg.content.includes('[GENERATED IMAGE:')) {
                    // Extract image reference and description
                    const match = /\[GENERATED IMAGE:([0-9]+)\](.*)/.exec(msg.content);
                    if (match && match[1]) {
                      const imageId = match[1];
                      const description = match[2] ? match[2].trim() : "an AI generated image";
                      console.log(`Found historical generated image: ${imageId}`);
                      
                      // Try to load the generated image
                      const imageData = loadGeneratedImageAsBase64(`GENERATED IMAGE:${imageId}`, message.chat);
                      if (imageData) {
                        console.log(`Successfully loaded historical generated image: ${imageId}`);
                        // Add image to parts for context
                        parts.push({
                          inlineData: {
                            data: imageData.data,
                            mimeType: imageData.mimeType
                          }
                        });
                        contextImageCount++;
                      }
                      
                      historyWithImages.push(`Assistant: (Generated an image: ${description})`);
                    } else {
                      historyWithImages.push(`Assistant: ${msg.content.replace(/\[GENERATED IMAGE:[0-9]+\]/, '(Generated an image)')}`);
                    }
                  } else {
                    // Regular message
                    historyWithImages.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
                  }
                }
                
                console.log(`Added ${contextImageCount} images to context (including current upload: ${uploadedImageReference ? 'yes' : 'no'})`);
                
                // Create context text with proper history
                promptWithContext = `Previous conversation:\n${historyWithImages.join('\n')}\n\n${uploadedImageReference ? "Please generate a new image based on this uploaded image and the description: " : "Please generate an image based on: "}${text}`;
              } else {
                promptWithContext = `${uploadedImageReference ? "Please generate a new image based on this uploaded image and the description: " : "Please generate an image based on: "}${text}`;
              }
              
              // Add text prompt
              parts.push({ text: promptWithContext });
              
              const model = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash-exp-image-generation",
                safetySettings: imgGenSafetySettings,
              });
              
              return { model, parts };
            };
            
            // Function to handle image generation and save the result
            const generateAndSaveImage = async (model, parts) => {
              // Create a streaming response for image generation
              console.log("Image generation request parameters:", {
                modelName: "gemini-2.0-flash-exp-image-generation",
                partsCount: parts.length,
                hasImage: parts.some(p => p.inlineData),
                promptLength: parts.find(p => p.text)?.text.length || 0
              });
              
              const result = await model.generateContent({
                contents: [{ role: "user", parts: parts }],
                generationConfig: {
                  responseModalities: ["image", "text"],
                  responseMimeType: "text/plain",
                },
                safetySettings: imgGenSafetySettings
              });
              
              const response = await result.response;
              console.log("Received image generation response:", JSON.stringify(response.candidates ? { candidatesCount: response.candidates.length } : "No candidates"));
              
              // Find the image part in the response
              let imagePart = null;
              let textResponse = "";
              
              // Check if we have a valid response structure
              if (!response.candidates || !response.candidates[0]) {
                throw new Error("Invalid response structure: No candidates in response");
              }
              
              const candidate = response.candidates[0];
              
              // Handle different response structures
              if (candidate.content) {
                if (candidate.content.parts) {
                  for (const part of candidate.content.parts) {
                    if (part.inlineData) {
                      imagePart = part.inlineData;
                    } else if (part.text) {
                      textResponse += part.text;
                    }
                  }
                } else if (candidate.content.inlineData) {
                  // Handle case where inlineData is directly on content
                  imagePart = candidate.content.inlineData;
                } else if (candidate.content.text) {
                  // Handle case where text is directly on content
                  textResponse = candidate.content.text;
                }
              } else if (candidate.text) {
                // Handle case where text is directly on candidate
                textResponse = candidate.text;
              } else if (candidate.parts) {
                // Handle case where parts is directly on candidate
                for (const part of candidate.parts) {
                  if (part.inlineData) {
                    imagePart = part.inlineData;
                  } else if (part.text) {
                    textResponse += part.text;
                  }
                }
              } else if (candidate.inlineData) {
                // Handle case where inlineData is directly on candidate
                imagePart = candidate.inlineData;
              } else {
                // Log the entire response for debugging
                console.error("Full response structure:", JSON.stringify(response));
                console.error("Candidate structure:", JSON.stringify(candidate));
                throw new Error("Unexpected response structure from image generation API");
              }
              
              if (!imagePart) {
                // Don't show any text to the user, just throw the error
                throw new Error("No image was generated in the response");
              }
              
              // Save the image to a file
              const imageId = Date.now();
              const fileExtension = imagePart.mimeType.split('/')[1] || 'jpg';
              const fileName = `${imageId}.${fileExtension}`;
              const filePath = path.join(imagesDir, fileName);
              
              // Convert base64 to buffer
              const imageBuffer = Buffer.from(imagePart.data, 'base64');
              
              // Save the image
              fs.writeFileSync(filePath, imageBuffer);
              console.log(`Generated image saved to: ${filePath}`);
              
              // Save response to history - use consistent format with [IMAGE ATTACHED:id] like the /a command
              // This makes it easier to handle both types of images in the future
              const historyResponse = textResponse ? 
                `[GENERATED IMAGE:${imageId}] ${textResponse}` : 
                `[GENERATED IMAGE:${imageId}]`;
              
              historyManager.saveMessageToHistory(message, 'assistant', historyResponse, "image_gen");
              
              return { imageBuffer, mimeType: imagePart.mimeType, textResponse, filePath, imageId };
            };
            
            // Execute the API call with retry logic
            const executeWithRetry = async () => {
              while (retryCount < MAX_RETRIES) {
                try {
                  const { model, parts } = await prepareImageGenRequest();
                  
                  // Generate and save the image
                  console.log("Calling image generation API...");
                  try {
                    const result = await generateAndSaveImage(model, parts);
                    
                    // If result is true, it means we've already handled sending a response to the user
                    // (like when we get text but no image)
                    if (result === true) {
                      return true;
                    }
                    
                    const { imageBuffer, mimeType, textResponse } = result;
                    
                    // Delete thinking message
                    await sock.sendMessage(message.chat, { delete: thinkingMsgKey });
                    
                    // Send the image without any text caption
                    await sock.sendMessage(message.chat, { 
                      image: imageBuffer,
                      caption: "Here's your generated image",
                      mimetype: mimeType
                    });
                    
                    // Exit the retry loop on success
                    return true;
                  } catch (genError) {
                    console.error(`Image generation error details:`, genError);
                    
                    // If the error is "No image was generated", this is likely due to NSFW content
                    if (genError.message.includes("No image was generated in the response")) {
                      // Delete thinking message
                      await sock.sendMessage(message.chat, { delete: thinkingMsgKey });
                      
                      // Send NSFW blocked message to user
                      await message.reply("NSFW DETECTED: BLOCKED. Image Generation Shutting Down, Contact Admin +6285172196650");
                      
                      // Exit the retry loop (don't retry for this error)
                      return true;
                    }
                    
                    // Re-throw other errors to be caught by the outer try/catch
                    throw new Error(`Image generation failed: ${genError.message}`);
                  }
                } catch (error) {
                  retryCount++;
                  console.error(`Image generation attempt ${retryCount} failed:`, error);
                  errorMessages.push(error.message || "Unknown error");
                  
                  // If we've reached the limit, throw the error
                  if (retryCount >= MAX_RETRIES || retryCount >= apiKeyPool.getKeyCount("keygemini")) {
                    throw new Error("Maximum retry attempts reached");
                  }
                  
                  // Show retry message to user
                  isRetrying = true;
                  
                  // Update thinking message to show retry status
                  await sock.sendMessage(message.chat, { 
                    edit: thinkingMsgKey,
                    text: "ERROR, RETRYING... PLEASE WAIT" 
                  });
                  
                  // Short delay before retry
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            };
            
            // Start the execution with retry logic
            await executeWithRetry();
            
          } catch (error) {
            // Error handling - also delete thinking message on error
            try {
              // Try to delete the thinking message
              if (typeof thinkingMsgKey !== 'undefined') {
                await sock.sendMessage(message.chat, { delete: thinkingMsgKey });
              }
            } catch (deleteError) {
              console.error("Error deleting thinking message:", deleteError);
            }
            
            // Log errors to console
            console.error("Final error after retries:", error);
            console.error("Error messages:", errorMessages);
            
            // Show final error message to user
            message.reply("Image generation failed. Hubungi Admin +6285172196650");
        }
          break;
        case "setpp":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            // Check if image is uploaded
            const hasImage = getContentType(message.message) === 'imageMessage';
            const hasQuotedImage = message.quoted && getContentType(message.quoted.message) === 'imageMessage';
            
            if (!hasImage && !hasQuotedImage) {
              return message.reply("Please upload an image with this command to set as profile picture.");
            }
            
            // Send waiting message
            const waitMsg = await message.reply("Changing profile picture...");
            
            // Get the message that contains the image
            const imgMsg = hasQuotedImage ? message.quoted : message;
            
            // Download the media as buffer
            const buffer = await downloadMediaMessage(
              imgMsg,
              'buffer',
              {},
              { 
                logger: console,
                reuploadRequest: sock.updateMediaMessage
              }
            );
            
            // Compress the image
            const compressed = await compressImage(buffer, 'image/jpeg');
            
            // Update profile picture
            await sock.updateProfilePicture(botNumber, { img: compressed.buffer });
            
            // Delete waiting message
            await sock.sendMessage(message.chat, { delete: waitMsg.key });
            
            // Confirm to the user
            message.reply("✅ Bot profile picture has been updated successfully.");
          } catch (error) {
            console.error("Error setting profile picture:", error);
            message.reply("❌ Error setting profile picture.");
          }
          break;
          
        case "setname":
          // Check if sender is admin
          if (!isAdmin) {
            return message.reply("⛔ Access denied. This command is only available for administrators.");
          }
          
          try {
            if (!text) {
              return message.reply(`Format: ${prefix}setname [new name]`);
            }
            
            // Send waiting message
            const waitMsg = await message.reply("Changing profile name...");
            
            // Update profile name
            await sock.updateProfileName(text);
            
            // Delete waiting message
            await sock.sendMessage(message.chat, { delete: waitMsg.key });
            
            // Confirm to the user
            message.reply(`✅ Bot name has been changed to "${text}".`);
          } catch (error) {
            console.error("Error setting profile name:", error);
            message.reply("❌ Error setting profile name.");
        }
          break;
        default: {
          if (isCmd && budy.toLowerCase() != undefined) {
            if (message.chat.endsWith("broadcast")) return;
            if (message.isBaileys) return;
            if (!budy.toLowerCase()) return;
            if (argsLog || (isCmd && !message.isGroup)) {
              // sock.sendReadReceipt(message.chat, message.sender, [message.key.id])
              console.log(chalk.black(chalk.bgRed("[ ERROR ]")), color("command", "turquoise"), color(`${prefix}${command}`, "turquoise"), color("tidak tersedia", "turquoise"));
            } else if (argsLog || (isCmd && message.isGroup)) {
              // sock.sendReadReceipt(message.chat, message.sender, [message.key.id])
              console.log(chalk.black(chalk.bgRed("[ ERROR ]")), color("command", "turquoise"), color(`${prefix}${command}`, "turquoise"), color("tidak tersedia", "turquoise"));
            }
          }
        }
      }
    }
  } catch (err) {
    // Log error to console but don't show details to user
    console.error("Error in main function:", err);
    message.reply("Terjadi kesalahan. Silakan coba lagi.");
  }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});
