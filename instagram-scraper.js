const axios = require('axios');
const cheerio = require('cheerio');

// Get configuration from GitHub secrets
const CONFIG = {
  SCRAPINGBEE_API_KEY: process.env.SCRAPINGBEE_API_KEY,
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
  INSTAGRAM_POSTS: process.env.INSTAGRAM_POSTS ? process.env.INSTAGRAM_POSTS.split(',') : []
};

class InstagramScraper {
  constructor(apiKey, webhookUrl) {
    this.apiKey = apiKey;
    this.webhookUrl = webhookUrl;
    this.baseUrl = 'https://app.scrapingbee.com/api/v1/';
  }

  async scrapeComments(instagramPostUrl) {
    console.log(`🔍 Checking for new comments on: ${instagramPostUrl}`);
    
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          url: instagramPostUrl,
          render_js: 'true',
          premium_proxy: 'true',
          country_code: 'US',
          wait: 5000,
          wait_for: 'article',
          window_width: 1366,
          window_height: 768,
          custom_google: 'true'
        },
        timeout: 30000
      });

      return this.parseComments(response.data, instagramPostUrl);
      
    } catch (error) {
      console.error('❌ Error scraping:', error.message);
      return { success: false, error: error.message };
    }
  }

  parseComments(html, postUrl) {
    const $ = cheerio.load(html);
    const comments = [];
    const timestamp = Date.now();

    // Find Instagram comments in the HTML
    $('div[data-testid="comment"], article div[role="button"]').each((index, element) => {
      try {
        const $comment = $(element);
        
        // Get username
        const username = $comment.find('h3 a, div h3 a').first().text().trim();
        
        // Get comment text
        const commentText = $comment.find('span span, div span').last().text().trim();
        
        // Create unique ID
        const commentId = `${username}_${timestamp}_${index}`;
        
        if (username && commentText && commentText.length > 3) {
          comments.push({
            id: commentId,
            username: username,
            text: commentText,
            timestamp: timestamp,
            post_url: postUrl,
            source: 'scrapingbee'
          });
        }
      } catch (err) {
        console.log('⚠️ Could not parse a comment:', err.message);
      }
    });

    console.log(`✅ Found ${comments.length} comments`);
    return { success: true, comments: comments };
  }

  async sendToN8n(data) {
    if (!data.comments || data.comments.length === 0) {
      console.log('📭 No new comments to send');
      return;
    }

    try {
      const response = await axios.post(this.webhookUrl, {
        success: true,
        comments: data.comments,
        timestamp: new Date().toISOString(),
        scraper: 'scrapingbee-github'
      });
      
      console.log(`📤 Successfully sent ${data.comments.length} comments to n8n`);
      return response.data;
      
    } catch (error) {
      console.error('❌ Failed to send to n8n:', error.message);
      throw error;
    }
  }

  async scrapeAndSend(postUrl) {
    const result = await this.scrapeComments(postUrl);
    if (result.success) {
      await this.sendToN8n(result);
    }
    return result;
  }
}

// Main function that runs the scraper
async function runScraper() {
  console.log('🚀 Instagram Comment Scraper Starting...');
  
  // Check if we have all required configuration
  if (!CONFIG.SCRAPINGBEE_API_KEY) {
    console.error('❌ Missing ScrapingBee API key');
    process.exit(1);
  }
  
  if (!CONFIG.N8N_WEBHOOK_URL) {
    console.error('❌ Missing n8n webhook URL');
    process.exit(1);
  }
  
  if (!CONFIG.INSTAGRAM_POSTS.length) {
    console.error('❌ No Instagram posts configured');
    process.exit(1);
  }

  const scraper = new InstagramScraper(CONFIG.SCRAPINGBEE_API_KEY, CONFIG.N8N_WEBHOOK_URL);
  
  // Check each Instagram post
  for (const postUrl of CONFIG.INSTAGRAM_POSTS) {
    console.log(`\n🎯 Processing: ${postUrl}`);
    
    try {
      await scraper.scrapeAndSend(postUrl.trim());
      
      // Wait 3 seconds between posts to be nice to Instagram
      if (CONFIG.INSTAGRAM_POSTS.length > 1) {
        console.log('⏳ Waiting 3 seconds before next post...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
    } catch (error) {
      console.error(`❌ Failed to process ${postUrl}:`, error.message);
    }
  }
  
  console.log('\n✅ Scraper completed successfully!');
}

// Run the scraper (GitHub Actions will call this)
runScraper().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
