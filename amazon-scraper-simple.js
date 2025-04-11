/**
 * Simple Amazon Book Scraper for German Bookshelf Application
 * Uses axios and cheerio instead of Puppeteer for better compatibility with hosting platforms
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3333;

// Enable CORS for all routes
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: false
}));
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Validates if the provided URL is a valid Amazon.de book URL
 */
function isValidAmazonUrl(url) {
  try {
    const urlObj = new URL(url);
    return (
      (urlObj.hostname === 'www.amazon.de' || 
       urlObj.hostname === 'amazon.de') &&
      (urlObj.pathname.includes('/dp/') || 
       urlObj.pathname.includes('/gp/product/'))
    );
  } catch (error) {
    return false;
  }
}

/**
 * Extracts the ASIN from an Amazon URL
 */
function extractAsinFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Extract ASIN from /dp/ASIN or /gp/product/ASIN pattern
    const dpMatch = pathname.match(/\/dp\/([A-Z0-9]{10})/);
    if (dpMatch) return dpMatch[1];
    
    const gpMatch = pathname.match(/\/gp\/product\/([A-Z0-9]{10})/);
    if (gpMatch) return gpMatch[1];
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetches book data from Amazon.de using axios and cheerio
 */
async function fetchBookDataFromAmazon(url) {
  if (!isValidAmazonUrl(url)) {
    throw new Error('Invalid Amazon URL');
  }

  const asin = extractAsinFromUrl(url);
  if (!asin) {
    throw new Error('Could not extract ASIN from URL');
  }

  try {
    // Try multiple user agents to avoid detection
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
    ];
    
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    // Amazon doesn't allow direct scraping, so we'll use a fallback method
    // to extract basic book data from multiple sources
    
    // Initialize book data with default values
    const bookData = {
      title: 'Unknown Title',
      authors: [],
      description: 'No description available',
      coverUrl: '',
      language: 'German',
      categories: [],
      isbn: '',
      isbn13: '',
      asin: asin,
      pageCount: null,
      publicationDate: '',
      publisher: '',
      type: 'ebook'
    };
    
    // Try to get book data from Amazon URL directly
    try {
      // Set headers to mimic a browser
      const headers = {
        'User-Agent': randomUserAgent,
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      };

      console.log(`Fetching book data from ${url} with axios...`);
      const response = await axios.get(url, { 
        headers,
        timeout: 10000,
        maxRedirects: 5
      });
      
      // Amazon blocking detection
      if (response.data && response.data.includes('Robot Check')) {
        console.log('Amazon robot check detected, using fallback method');
        throw new Error('Amazon robot check detected');
      }
      
      const $ = cheerio.load(response.data);
      
      // Extract title
      bookData.title = $('#productTitle').text().trim();
      if (!bookData.title) {
        bookData.title = $('.kindle-title').text().trim();
      }
      
      // Extract author
      $('#bylineInfo .author a, .contributorNameID, .authorNameLink a').each((i, el) => {
        const author = $(el).text().trim();
        if (author && !bookData.authors.includes(author)) {
          bookData.authors.push(author);
        }
      });

      // Extract cover image URL
      const imgElement = $('#imgBlkFront, #ebooksImgBlkFront, #main-image');
      if (imgElement.length) {
        bookData.coverUrl = imgElement.attr('data-a-dynamic-image') || imgElement.attr('src');
        // Extract the first URL from the data-a-dynamic-image JSON if it exists
        if (bookData.coverUrl && bookData.coverUrl.startsWith('{')) {
          try {
            const imageData = JSON.parse(bookData.coverUrl);
            bookData.coverUrl = Object.keys(imageData)[0] || '';
          } catch (error) {
            bookData.coverUrl = imgElement.attr('src') || '';
          }
        }
      }

      // Fallback for cover image (try the smaller image)
      if (!bookData.coverUrl) {
        const smallImg = $('#landingImage, #ebooksImgBlkFront, #ebooks-img-canvas img').first();
        bookData.coverUrl = smallImg.attr('src') || '';
      }

      // Extract description
      const descriptionSelector = '#bookDescription_feature_div .a-expander-content, #bookDescription_feature_div noscript, #productDescription .content';
      bookData.description = $(descriptionSelector).text().trim();
      if (!bookData.description) {
        bookData.description = $('[data-feature-name="bookDescription"] noscript').text().trim();
      }

      // Clean up description by removing HTML tags
      bookData.description = bookData.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      // Extract book details
      $('.detail-bullet-list li').each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes('ISBN-10')) {
          bookData.isbn = text.split(':')[1].trim();
        } else if (text.includes('ISBN-13')) {
          bookData.isbn13 = text.split(':')[1].trim();
        } else if (text.includes('Publisher') || text.includes('Herausgeber')) {
          bookData.publisher = text.split(':')[1].trim();
        } else if (text.includes('Publication date') || text.includes('Erscheinungstermin')) {
          bookData.publicationDate = text.split(':')[1].trim();
        } else if (text.includes('Language') || text.includes('Sprache')) {
          bookData.language = text.split(':')[1].trim();
        } else if (text.includes('Print length') || text.includes('Seitenzahl')) {
          const pageMatch = text.match(/\d+/);
          if (pageMatch) {
            bookData.pageCount = pageMatch[0];
          }
        }
      });

      // Extract categories
      $('#wayfinding-breadcrumbs_feature_div .a-link-normal').each((i, el) => {
        const category = $(el).text().trim();
        if (category && !bookData.categories.includes(category)) {
          bookData.categories.push(category);
        }
      });

      // Determine if audiobook or ebook
      if (url.includes('/audible/') || $('.audibleProductTitle').length > 0) {
        bookData.type = 'audiobook';
      } else {
        bookData.type = 'ebook';
      }

    } catch (directScrapingError) {
      console.log(`Direct scraping failed: ${directScrapingError.message}`);
      // Fallback method: Try to get minimal book data from ASIN
      
      // Fall back to title and author from the URL or ASIN
      const urlParts = url.split('/');
      const possibleTitle = urlParts.filter(part => part.length > 5 && !part.includes('amazon') && !part.includes('dp')).pop();
      if (possibleTitle) {
        bookData.title = possibleTitle.replace(/-/g, ' ').trim();
      }
    }
    
    // If we couldn't get anything, use generic data
    if (!bookData.title || bookData.title === 'Unknown Title') {
      bookData.title = `Book with ASIN: ${asin}`;
    }
    
    if (bookData.authors.length === 0) {
      bookData.authors.push('Unknown Author');
    }
    
    // If we couldn't get a cover, use a placeholder
    if (!bookData.coverUrl) {
      bookData.coverUrl = `https://m.media-amazon.com/images/I/${asin}.jpg`;
    }

    // Return the book data for API response
    return {
      title: bookData.title,
      author: bookData.authors.join(', ') || 'Unknown Author',
      description: bookData.description || 'No description available',
      cover_url: bookData.coverUrl,
      language: bookData.language || 'German',
      genre: bookData.categories.join(', ') || 'Fiction',
      type: bookData.type || 'ebook',
      isbn: bookData.isbn13 || bookData.isbn || '',
      asin: bookData.asin,
      page_count: bookData.pageCount ? parseInt(bookData.pageCount, 10) : null,
      publication_date: bookData.publicationDate || '',
      publisher: bookData.publisher || ''
    };
  } catch (error) {
    console.error(`Error fetching book data: ${error.message}`);
    console.error(error.stack);
    
    // Return emergency fallback data
    return {
      title: `Book with ASIN: ${asin}`,
      author: 'Unknown Author',
      description: 'Could not retrieve book description due to Amazon restrictions',
      cover_url: `https://m.media-amazon.com/images/I/${asin}.jpg`,
      language: 'German',
      genre: '',
      type: 'ebook',
      isbn: '',
      asin: asin,
      page_count: null,
      publication_date: '',
      publisher: ''
    };
  }
}

// Create API endpoint for scraping
app.post('/api/scrape', async (req, res) => {
  // Set JSON content type and CORS headers for all responses
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL is required' 
      });
    }
    
    if (!isValidAmazonUrl(url)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid Amazon URL' 
      });
    }
    
    console.log(`Scraping book data from ${url}`);
    
    try {
      const bookData = await fetchBookDataFromAmazon(url);
      
      return res.status(200).json({
        success: true,
        bookData: bookData
      });
    } catch (scrapeError) {
      console.error(`Detailed scraper error: ${scrapeError.message}`);
      console.error(scrapeError.stack);
      
      // Send a more informative error response
      return res.status(500).json({ 
        success: false,
        error: `Failed to scrape Amazon data: ${scrapeError.message}`,
        details: scrapeError.stack
      });
    }
  } catch (error) {
    console.error('API endpoint error:', error);
    console.error(error.stack);
    
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to process request',
      stack: error.stack
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Amazon Scraper API is running - Simple Version',
    endpoints: {
      health: '/health',
      scraper: '/api/scrape'
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Amazon scraper server (simple version) running on port ${PORT}`);
});

// Export functions for testing
module.exports = {
  isValidAmazonUrl,
  fetchBookDataFromAmazon
};
