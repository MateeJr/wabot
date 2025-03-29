/**
 * API Key Pool Manager
 * Manages a pool of API keys and rotates through them to avoid rate limits
 */

const fs = require('fs');
const path = require('path');

class ApiKeyPool {
  constructor(keyFilePath) {
    this.keyFilePath = keyFilePath || path.join(process.cwd(), 'key.json');
    this.keys = {};
    this.currentKeyIndices = {};
    this.loadKeys();
  }

  loadKeys() {
    try {
      if (fs.existsSync(this.keyFilePath)) {
        const keyData = JSON.parse(fs.readFileSync(this.keyFilePath, 'utf8'));
        
        // Migrate existing single keys to arrays if needed
        for (const [service, value] of Object.entries(keyData)) {
          if (typeof value === 'string') {
            // Convert single key to array
            this.keys[service] = [value];
          } else if (Array.isArray(value)) {
            // Already an array
            this.keys[service] = value;
          }
        }
        
        // Initialize current key indices
        for (const service in this.keys) {
          this.currentKeyIndices[service] = 0;
        }
        
        console.log(`Loaded API key pool with ${Object.keys(this.keys).length} services`);
        for (const [service, keyArray] of Object.entries(this.keys)) {
          console.log(`  - ${service}: ${keyArray.length} key(s)`);
        }
      } else {
        console.log(`Key file not found: ${this.keyFilePath}`);
        this.keys = {};
      }
    } catch (error) {
      console.error(`Error loading API keys: ${error.message}`);
      this.keys = {};
    }
  }

  saveKeys() {
    try {
      fs.writeFileSync(this.keyFilePath, JSON.stringify(this.keys, null, 2));
      console.log(`Saved API keys to ${this.keyFilePath}`);
      return true;
    } catch (error) {
      console.error(`Error saving API keys: ${error.message}`);
      return false;
    }
  }

  getKey(service) {
    if (!this.keys[service] || this.keys[service].length === 0) {
      console.error(`No API keys available for ${service}`);
      return null;
    }

    // Get current index for this service
    const currentIndex = this.currentKeyIndices[service] || 0;
    
    // Get the key at the current index
    const key = this.keys[service][currentIndex];
    
    // Increment the index for next use (with wraparound)
    this.currentKeyIndices[service] = (currentIndex + 1) % this.keys[service].length;
    
    console.log(`Using ${service} API key ${currentIndex + 1}/${this.keys[service].length}`);
    
    return key;
  }

  addKey(service, key) {
    if (!this.keys[service]) {
      this.keys[service] = [];
    }
    
    // Don't add duplicate keys
    if (!this.keys[service].includes(key)) {
      this.keys[service].push(key);
      console.log(`Added new API key for ${service}`);
      this.saveKeys();
      return true;
    } else {
      console.log(`API key already exists for ${service}`);
      return false;
    }
  }

  removeKey(service, key) {
    if (!this.keys[service]) {
      return false;
    }
    
    const initialLength = this.keys[service].length;
    this.keys[service] = this.keys[service].filter(k => k !== key);
    
    if (this.keys[service].length < initialLength) {
      // Reset the current index if it's now out of bounds
      if (this.currentKeyIndices[service] >= this.keys[service].length) {
        this.currentKeyIndices[service] = 0;
      }
      
      console.log(`Removed API key from ${service}`);
      this.saveKeys();
      return true;
    }
    
    return false;
  }

  getKeyCount(service) {
    if (!this.keys[service]) {
      return 0;
    }
    return this.keys[service].length;
  }

  getAllKeys() {
    return this.keys;
  }
}

// Create singleton instance
const apiKeyPool = new ApiKeyPool();

module.exports = apiKeyPool; 