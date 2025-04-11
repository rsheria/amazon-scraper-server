/**
 * Simplified Amazon Book Scraper (no Puppeteer) for Render deployment
 * Uses Axios and Cheerio for lighter-weight scraping
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for all routes
app.use(cors({
  origin: '*',  // Allow requests from any domain
  methods: ['GET', 'POST'],
  credentials: false
}));
app.use(express.json());

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
 * Extracts basic book information from URL and generates image URL
 */
async function extractBasicBookInfo(url) {
  const asin = extractAsinFromUrl(url);
  if (!asin) {
    throw new Error('Could not extract ASIN from URL');
  }
  
  // Extract title from URL
  const decodedUrl = decodeURIComponent(url);
  let title = 'Unknown Title';
  const titleMatch = decodedUrl.match(/\/([^\/]+)\/dp\//);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Determine if it's an audiobook based on URL
  const isAudiobook = url.toLowerCase().includes('audible') || 
                     url.toLowerCase().includes('hörbuch');
  
  // Generate Amazon image URL
  const coverUrl = `https://m.media-amazon.com/images/P/${asin}.jpg`;
  
  return {
    asin,
    title,
    authors: ["Add author manually"],
    description: "Add description manually",
    coverUrl,
    language: "German",
    categories: [],
    type: isAudiobook ? 'audiobook' : 'ebook',
    isbn: '',
    isbn13: '',
    pageCount: '',
    publicationDate: '',
    publisher: ''
  };
}

/**
 * Converts book data to the application format
 */
function amazonDataToBook(amazonData) {
  return {
    title: amazonData.title || '',
    author: amazonData.authors.join(', ') || '',
    description: amazonData.description || '',
    isbn: amazonData.isbn13 || amazonData.isbn || '',
    publication_date: amazonData.publicationDate || '',
    publisher: amazonData.publisher || '',
    page_count: amazonData.pageCount ? parseInt(amazonData.pageCount, 10) : null,
    cover_url: amazonData.coverUrl || '',
    price: amazonData.price || '',
    categories: amazonData.categories.join(', ') || '',
    language: amazonData.language || 'German',
    type: amazonData.type || 'ebook',
    asin: amazonData.asin || ''
  };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Create API endpoint for scraping
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    if (!isValidAmazonUrl(url)) {
      return res.status(400).json({ error: 'Invalid Amazon URL' });
    }
    
    console.log(`Processing book data from ${url}`);
    
    // Extract basic info (no Puppeteer needed)
    const amazonData = await extractBasicBookInfo(url);
    const bookData = amazonDataToBook(amazonData);
    
    return res.json({
      success: true,
      rawData: amazonData,
      bookData: bookData
    });
  } catch (error) {
    console.error('Scraper error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to process Amazon data' 
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Amazon scraper server (simplified) running on port ${PORT}`);
});
