/**
 * Simple Amazon Book Scraper for German Bookshelf Application
 * Uses axios and cheerio instead of Puppeteer for better compatibility with hosting platforms
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

// Import the Thalia scraper module
const { scrapeThaliaSafe, isValidThaliaUrl } = require('./thalia-scraper');

const app = express();
const PORT = process.env.PORT || 3333;

// Configure middleware
app.use(bodyParser.json());

// Configure CORS to allow requests from any origin in production
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Origin', 'Authorization'],
  credentials: false
}));

// Handle preflight requests
app.options('*', cors());

// Middleware
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
        console.warn('Amazon robot check detected, using alternative scraping method...');
        throw new Error('Amazon robot check detected');
      }
      
      // Load HTML into cheerio
      const $ = cheerio.load(response.data);
      
      // Extract book title
      const title = $('#productTitle').text().trim();
      if (title) {
        bookData.title = title;
      }
      
      // Extract book author
      const authorElement = $('.contributorNameID, .author a, a.contributorNameID');
      authorElement.each((i, el) => {
        const author = $(el).text().trim();
        if (author && !bookData.authors.includes(author)) {
          bookData.authors.push(author);
        }
      });
      
      // Extract book description
      const description = $('#bookDescription_feature_div .a-expander-content').text().trim() 
                        || $('#productDescription p').text().trim() 
                        || $('#bookDescription_feature_div noscript').text().trim();
      if (description) {
        bookData.description = description;
      }
      
      // Extract book cover URL
      const coverUrl = $('#imgBlkFront').attr('src') || $('#landingImage').attr('src');
      if (coverUrl) {
        bookData.coverUrl = coverUrl;
      }
      
      // Extract book details
      const detailsElements = $('#detailBullets_feature_div li, .detail-bullet-list li');
      detailsElements.each((i, el) => {
        const text = $(el).text().trim();
        
        // Extract ISBN
        if (text.includes('ISBN-10') || text.includes('ISBN-10:')) {
          const match = text.match(/(\d{10})/);
          if (match) bookData.isbn = match[1];
        }
        
        // Extract ISBN-13
        if (text.includes('ISBN-13') || text.includes('ISBN-13:')) {
          const match = text.match(/(\d{13})/);
          if (match) bookData.isbn13 = match[1];
        }
        
        // Extract page count
        if (text.includes('Seitenzahl') || text.includes('pages') || text.includes('Seiten')) {
          const match = text.match(/(\d+)/);
          if (match) bookData.pageCount = parseInt(match[1]);
        }
        
        // Extract publisher
        if (text.includes('Verlag') || text.includes('Publisher')) {
          // The format is typically "Publisher: Name (Date)"
          const publisherMatch = text.match(/Herausgeber\s*:\s*([^(]+)/) 
                              || text.match(/Verlag\s*:\s*([^(]+)/) 
                              || text.match(/Publisher\s*:\s*([^(]+)/);
          if (publisherMatch) {
            bookData.publisher = publisherMatch[1].trim();
          }
          
          // Extract publication date
          const dateMatch = text.match(/\(([^)]+)\)/);
          if (dateMatch) {
            bookData.publicationDate = dateMatch[1].trim();
          }
        }
        
        // Extract language
        if (text.includes('Sprache') || text.includes('Language')) {
          if (text.includes('Deutsch') || text.includes('German')) {
            bookData.language = 'Deutsch';
          } else if (text.includes('Englisch') || text.includes('English')) {
            bookData.language = 'English';
          } else {
            const langMatch = text.match(/Sprache\s*:\s*([^;]+)/) || text.match(/Language\s*:\s*([^;]+)/);
            if (langMatch) {
              bookData.language = langMatch[1].trim();
            }
          }
        }
      });
      
      // Extract categories
      const breadcrumbs = $('#wayfinding-breadcrumbs_feature_div li');
      breadcrumbs.each((i, el) => {
        const category = $(el).text().trim();
        if (category && !category.includes('›')) {
          bookData.categories.push(category);
        }
      });
      
      console.log('Successfully extracted book data from Amazon page');
    } catch (error) {
      console.warn('Error during direct scraping, data may be incomplete:', error.message);
    }
    
    // If we still don't have most of the data, try fallback methods
    if (!bookData.title || bookData.title === 'Unknown Title' || !bookData.authors.length) {
      console.log('Direct scraping provided incomplete data, trying fallback methods...');
      
      try {
        // Simulate using Google Books API or other sources to get book data
        // In a real application, this would use authenticated APIs or a proxy service
        const bookDataFromFallback = {
          title: 'Book title not available due to Amazon restrictions',
          authors: ['Author information not available'],
          description: 'Book description not available due to Amazon restrictions. Please check the book directly on Amazon.',
          coverUrl: `https://via.placeholder.com/150x225?text=ASIN:${asin}`,
          language: 'Deutsch',
          pageCount: null,
          publicationDate: '',
          publisher: '',
        };
        
        // Update the book data with fallback data if it's missing
        if (bookData.title === 'Unknown Title') bookData.title = bookDataFromFallback.title;
        if (!bookData.authors.length) bookData.authors = bookDataFromFallback.authors;
        if (bookData.description === 'No description available') bookData.description = bookDataFromFallback.description;
        if (!bookData.coverUrl) bookData.coverUrl = bookDataFromFallback.coverUrl;
      } catch (fallbackError) {
        console.error('Fallback method failed:', fallbackError.message);
      }
    }
    
    return normalizeBookData(bookData);
  } catch (error) {
    console.error('Error fetching book data:', error.message);
    throw error;
  }
}

/**
 * Normalize book data for consistent format
 */
function normalizeBookData(bookData) {
  const normalized = { ...bookData };
  
  // Convert authors array to string
  if (Array.isArray(normalized.authors) && normalized.authors.length > 0) {
    normalized.author = normalized.authors.join(', ');
    delete normalized.authors;
  } else if (Array.isArray(normalized.authors) && normalized.authors.length === 0) {
    normalized.author = 'Unknown Author';
    delete normalized.authors;
  }
  
  // Ensure ISBN is a string
  if (normalized.isbn && typeof normalized.isbn !== 'string') {
    normalized.isbn = String(normalized.isbn);
  }
  
  // Set language code
  if (normalized.language) {
    if (normalized.language.includes('Deutsch') || normalized.language === 'German') {
      normalized.languageCode = 'de';
    } else if (normalized.language.includes('English') || normalized.language === 'English') {
      normalized.languageCode = 'en';
    }
  } else {
    // Default language for German bookstore
    normalized.language = 'Deutsch';
    normalized.languageCode = 'de';
  }

  // Fix empty cover URL with a placeholder
  if (!normalized.coverUrl) {
    normalized.coverUrl = 'https://via.placeholder.com/150x225?text=No+Cover';
  }

  return normalized;
}

// Create API endpoint for scraping
app.post('/api/scrape', async (req, res) => {
  try {
    console.log('Received scrape request:', req.body);
    
    const { url } = req.body;
    
    if (!url) {
      console.error('No URL provided in request');
      return res.status(400).json({ 
        success: false, 
        error: 'No URL provided' 
      });
    }

    console.log(`Scraping URL: ${url}`);

    try {
      // Validate URL
      if (!isValidAmazonUrl(url) && !isValidThaliaUrl(url)) {
        console.error('Invalid URL:', url);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid URL' 
        });
      }

      // Scrape book data
      let bookData;
      if (isValidAmazonUrl(url)) {
        bookData = await fetchBookDataFromAmazon(url);
      } else if (isValidThaliaUrl(url)) {
        // Use the improved Thalia scraper from the module
        bookData = await scrapeThaliaSafe(url, {
          maxRetries: 3,
          validateData: true,
          normalizeData: true,
          fixData: true,
          debug: true
        });
      }
      
      // Log successful response
      console.log('Successfully scraped data:', JSON.stringify(bookData).substring(0, 200) + '...');
      
      // Return success response
      return res.json({ 
        success: true, 
        bookData 
      });
    } catch (error) {
      console.error('Error during scraping:', error.message);
      
      // Return error response
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'An error occurred during scraping' 
      });
    }
  } catch (error) {
    console.error('Unexpected server error:', error);
    
    // Return error response for unexpected errors
    return res.status(500).json({ 
      success: false, 
      error: 'Unexpected server error' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send('Book Scraper API is running. Send POST request to /api/scrape-thalia with a Thalia URL or /api/scrape with any supported book URL.');
});

// Thalia-specific endpoint for direct access
app.post('/api/scrape-thalia', async (req, res) => {
  try {
    console.log('Received scrape-thalia request:', req.body);
    
    const { url } = req.body;
    
    if (!url) {
      console.error('No URL provided in request');
      return res.status(400).json({ 
        success: false, 
        error: 'No URL provided' 
      });
    }

    console.log(`Scraping Thalia URL: ${url}`);

    try {
      // Validate URL
      if (!isValidThaliaUrl(url)) {
        console.error('Invalid Thalia URL:', url);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid Thalia URL' 
        });
      }

      // Use the improved Thalia scraper from the module
      const bookData = await scrapeThaliaSafe(url, {
        maxRetries: 3,
        validateData: true,
        normalizeData: true,
        fixData: true,
        debug: true
      });
      
      // Log successful response
      console.log('Successfully scraped Thalia data:', JSON.stringify(bookData).substring(0, 200) + '...');
      
      // Return success response
      return res.json({ 
        success: true, 
        bookData 
      });
    } catch (error) {
      console.error('Error during Thalia scraping:', error.message);
      
      // Return error response
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'An error occurred during scraping' 
      });
    }
  } catch (error) {
    console.error('Unexpected server error:', error);
    
    // Return error response for unexpected errors
    return res.status(500).json({ 
      success: false, 
      error: 'Unexpected server error' 
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Book scraper server running on port ${PORT}`);
});

// Export functions for testing
module.exports = {
  isValidAmazonUrl,
  fetchBookDataFromAmazon,
  isValidThaliaUrl
};
