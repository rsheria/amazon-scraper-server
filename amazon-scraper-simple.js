/**
 * Simple Amazon Book Scraper for German Bookshelf Application
 * Uses axios and cheerio instead of Puppeteer for better compatibility with hosting platforms
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');

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

/**
 * Validates if the provided URL is a valid Thalia.de book URL
 */
function isValidThaliaUrl(url) {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname.includes('thalia.de') &&
      (urlObj.pathname.includes('/artikeldetails/') || 
       urlObj.pathname.includes('/shop/home/artikeldetails/'))
    );
  } catch (error) {
    return false;
  }
}

/**
 * Handle cookie consent dialog
 */
async function handleCookieConsent(page) {
  // Try different selectors for the accept button
  const acceptButtonSelectors = [
    'button[data-testid="uc-accept-all-button"]',
    'button.consent-accept-all',
    'button.privacy-accept-all',
    'button[id*="accept"]',
    'button[title*="akzeptieren"]',
    'button[title*="Akzeptieren"]'
  ];
  
  for (const selector of acceptButtonSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        await page.waitForTimeout(1000);
        return;
      }
    } catch (e) {
      // Continue trying other selectors
    }
  }
  
  // Try to find button by text content
  try {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const acceptButton = buttons.find(button => 
        button.textContent.includes('Alles akzeptieren') || 
        button.textContent.includes('Alle akzeptieren') ||
        button.textContent.includes('Akzeptieren')
      );
      if (acceptButton) acceptButton.click();
    });
    
    // Wait a moment for any dialog to close
    await page.waitForTimeout(1000);
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Auto-scroll page to load all content
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  
  // Scroll back to top
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

/**
 * Extract author from text
 */
function extractAuthorFromText(text) {
  // Common patterns for author attribution in German
  const patterns = [
    /von\s+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i,
    /by\s+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i,
    /autor[:\s]+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i,
    /author[:\s]+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i,
    /bestseller-autor\s+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return '';
}

/**
 * Scrape book data from Thalia URL
 */
async function scrapeThalia(url) {
  console.log(`Starting to scrape Thalia book data from: ${url}`);
  
  // Launch browser with appropriate options for production environment
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
  
  try {
    const page = await browser.newPage();
    
    // Set user agent to appear as a regular browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Increase timeout
    await page.setDefaultNavigationTimeout(60000);
    
    // Set a standard viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('Navigating to Thalia URL...');
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Handle cookie consent if present
    console.log('Checking for cookie consent...');
    try {
      const consentButtonSelector = 'button[data-testid="uc-accept-all-button"]';
      const consentExists = await page.$(consentButtonSelector);
      
      if (consentExists) {
        console.log('Cookie consent dialog found, accepting...');
        await page.click(consentButtonSelector);
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      console.log('No cookie consent found or error handling it:', error.message);
    }
    
    // Wait for main content to load
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'thalia-debug.png' });
    
    // Get the page HTML
    const html = await page.content();
    
    // Parse the HTML with cheerio
    const $ = cheerio.load(html);
    
    // Create a new book data object with all the fields we need
    let bookData = {
      title: '',
      subtitle: '',
      author: '',
      description: '',
      coverUrl: '',
      price: '',
      language: 'Deutsch',
      languageCode: 'de',
      isbn: '',
      ean: '',
      publisher: '',
      publicationDate: '',
      pageCount: '',
      categories: []
    };
    
    // Debug: Log some page elements to see what we're working with
    console.log('Page title:', $('title').text());
    
    // Extract the book title - try multiple possible selectors
    bookData.title = $('.styled__Title-sc-1l9uxq3-2, h1[data-testid="product-detail-headline"], h1.styled__TextElement-sc-d9k1bl-0, .c-bookTitle, .Typo-sc-1uo4pzl-0').first().text().trim();
    
    // Extract the book subtitle
    bookData.subtitle = $('.styled__Subtitle-sc-1l9uxq3-3, .styled__SubtitleWrapper-sc-d9k1bl-1, .c-bookSubtitle').first().text().trim();
    
    // Extract author(s)
    $('.product-author, .c-book__author, .elementLink, a[data-testid="authorLink"], [data-testid="product-authorLinks"] a, .contribAnchor, .styled__Link-sc-12h77p5-0').each(function() {
      const authorName = $(this).text().trim();
      if (authorName && !bookData.author.includes(authorName)) {
        if (bookData.author) bookData.author += ', ';
        bookData.author += authorName;
      }
    });
    
    // Extract description
    bookData.description = $('.text--html, .product-description-text, [data-testid="detailsTab"] .html4-styling, .c-book__description').text().trim();
    
    // Extract cover image
    const coverImage = $('img.product-image, img.styled__Img-sc-j91dh-0, .c-bookCover img, [data-testid="product-detail-image"]');
    if (coverImage.length) {
      bookData.coverUrl = coverImage.attr('src') || '';
    }
    
    if (!bookData.coverUrl) {
      bookData.coverUrl = 'https://via.placeholder.com/150x225?text=No+Cover';
    }
    
    // Extract price
    bookData.price = $('.c-bookPrice, .styled__PriceWrapper-sc-1md0cja-4, [data-testid="product-price"]').text().trim();
    
    // Extract other metadata
    $('.product-details-list li, .c-bookDetails li, .product-attributes tr, .styled__SpecTitle-sc-1md0cja-7').each(function() {
      let label = $(this).find('.label, .key, span:first-child').text().trim().toLowerCase() || $(this).text().trim().toLowerCase();
      let value = $(this).find('.value, .val, span:last-child').text().trim() || $(this).next().text().trim();
      
      if (label.includes('isbn') || value.match(/^(\d{10}|\d{13})$/)) {
        bookData.isbn = value.replace(/[^0-9]/g, '');
      } else if (label.includes('ean')) {
        bookData.ean = value.replace(/[^0-9]/g, '');
      } else if (label.includes('verlag') || label.includes('publisher')) {
        bookData.publisher = value;
      } else if (label.includes('erscheinungsdatum') || label.includes('erschienen')) {
        bookData.publicationDate = value;
      } else if (label.includes('seiten') || label.includes('seitenzahl')) {
        bookData.pageCount = value.replace(/[^0-9]/g, '');
      } else if (label.includes('sprache')) {
        bookData.language = value;
        
        // Set language code
        if (value.toLowerCase().includes('deutsch')) {
          bookData.languageCode = 'de';
        } else if (value.toLowerCase().includes('english') || value.toLowerCase().includes('englisch')) {
          bookData.languageCode = 'en';
        }
      }
    });
    
    // Extract categories and genres
    $('.breadcrumb-item, .breadcrumb a, .c-breadcrumb__item').each(function() {
      const category = $(this).text().trim();
      if (category && !['Home', 'Start', 'Thalia', ''].includes(category)) {
        bookData.categories.push(category);
      }
    });
    
    // Set a default genre if we have categories
    if (bookData.categories.length > 0 && bookData.categories[bookData.categories.length - 1]) {
      bookData.genre = bookData.categories[bookData.categories.length - 1];
    } else {
      bookData.genre = 'Fiction';  // Default genre
    }
    
    // Set a default book type
    bookData.type = 'ebook';  // Default to ebook
    if (bookData.title.toLowerCase().includes('hörbuch') || bookData.description.toLowerCase().includes('hörbuch')) {
      bookData.type = 'audiobook';
    }
    
    // Validate required fields
    const requiredFields = ['title', 'author', 'description'];
    const missingFields = requiredFields.filter(field => !bookData[field]);
    
    if (missingFields.length > 0) {
      bookData.validationWarning = {
        missingFields: missingFields
      };
      console.warn('Warning: Missing required fields:', missingFields);
    }
    
    console.log('Final extracted book data:', bookData);
    return bookData;
  } catch (error) {
    console.error('Error scraping Thalia book:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Normalize book data for consistent format
 */
function normalizeBookData(bookData) {
  const normalized = { ...bookData };

  // Normalize price
  if (normalized.price) {
    // Ensure price has € symbol
    if (!normalized.price.includes('€')) {
      normalized.price = `${normalized.price} €`;
    }
    // Extract numeric price value
    const priceMatch = normalized.price.match(/(\d+[,.]\d+)/);
    if (priceMatch) {
      normalized.priceValue = parseFloat(priceMatch[1].replace(',', '.'));
    }
  }

  // Normalize publication date
  if (normalized.publicationDate) {
    try {
      // Try to parse German date format (DD.MM.YYYY)
      const dateMatch = normalized.publicationDate.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (dateMatch) {
        const [_, day, month, year] = dateMatch;
        normalized.publicationDateISO = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    } catch (error) {
      // Keep original if parsing fails
    }
  }

  // Normalize page count
  if (normalized.pageCount) {
    const pageMatch = normalized.pageCount.match(/\d+/);
    if (pageMatch) {
      normalized.pageCountValue = parseInt(pageMatch[0], 10);
    }
  }

  // Ensure language is standardized
  if (normalized.language) {
    const langLower = normalized.language.toLowerCase();
    if (langLower.includes('deutsch')) {
      normalized.languageCode = 'de';
    } else if (langLower.includes('english') || langLower.includes('englisch')) {
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
      // Validate URL (imported from thaliaScraperUtils)
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
        bookData = await scrapeThalia(url);
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
  res.send('Thalia Scraper API is running. Send POST request to /api/scrape with a URL in the body.');
});

// Add an alias endpoint for compatibility
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

    console.log(`Scraping URL: ${url}`);

    try {
      // Validate URL
      if (!isValidThaliaUrl(url)) {
        console.error('Invalid Thalia URL:', url);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid Thalia URL' 
        });
      }

      // Scrape Thalia book data
      const bookData = await scrapeThalia(url);
      
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

// Start the server
app.listen(PORT, () => {
  console.log(`Book scraper server running on port ${PORT}`);
});

// Export functions for testing
module.exports = {
  isValidAmazonUrl,
  fetchBookDataFromAmazon,
  isValidThaliaUrl,
  scrapeThalia
};
