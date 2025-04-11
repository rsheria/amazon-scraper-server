/**
 * Simple Amazon Book Scraper for German Bookshelf Application
 * Uses axios and cheerio instead of Puppeteer for better compatibility with hosting platforms
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(cors());
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
  console.log(`Scraping data from: ${url}`);
  
  // Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list'
    ]
  });

  try {
    // Create new page
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36');
    
    // Set viewport
    await page.setViewport({
      width: 1366,
      height: 768
    });

    // Navigate to URL
    console.log('Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Handle cookie consent if present
    try {
      console.log('Checking for cookie consent dialog...');
      await handleCookieConsent(page);
    } catch (error) {
      console.log('Error handling cookie consent:', error.message);
    }
    
    // Wait for content to load
    await page.waitForSelector('h1', { timeout: 30000 });
    
    // Scroll down to load more content
    await autoScroll(page);
    
    // Extract structured data if available
    let structuredData = null;
    try {
      structuredData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            if (data["@type"] === "Book" || data["@type"] === "Product") {
              return data;
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
        return null;
      });
      if (structuredData) console.log('Structured data found');
    } catch (error) {
      console.log('Error extracting structured data:', error.message);
    }
    
    // Get the HTML content
    const content = await page.content();
    
    // Parse with Cheerio
    const $ = cheerio.load(content);
    
    // Initialize book data object
    const bookData = {
      title: '',
      subtitle: '',
      author: '',
      series: '',
      seriesNumber: '',
      description: '',
      format: '',
      price: '',
      isbn: '',
      ean: '',
      publisher: '',
      publicationDate: '',
      language: '',
      pageCount: '',
      coverUrl: '',
      genre: 'Fiction', // Default genre
      type: 'ebook', // Default type
    };

    // Extract title
    const title = $('h1').first().text().trim();
    if (title) {
      // Check if title contains series information
      const titleParts = title.split('|');
      if (titleParts.length > 1) {
        bookData.title = titleParts[0].trim();
        bookData.subtitle = titleParts[1].trim();
      } else {
        bookData.title = title;
      }
    }

    // Extract author
    const authorSelectors = [
      'a[href*="/person/"]',
      'a[href*="/search?filterPERSON="]',
      '.author-name',
      'span[itemprop="author"]',
      'div.author'
    ];
    
    for (const selector of authorSelectors) {
      const authorElement = $(selector).first();
      if (authorElement.length && authorElement.text().trim()) {
        bookData.author = authorElement.text().trim();
        break;
      }
    }

    // Extract series information
    const seriesButton = $('button').filter(function() {
      return $(this).text().includes('Ein Fall für') || 
             $(this).text().includes('Band');
    });
    
    if (seriesButton.length) {
      const seriesText = seriesButton.text().trim();
      bookData.series = seriesText.replace(/Band \d+/, '').trim();
      
      // Extract series number
      const bandMatch = seriesText.match(/Band (\d+)/);
      if (bandMatch) {
        bookData.seriesNumber = bandMatch[1];
      }
    }

    // Extract price
    const priceElement = $('.price-display').first();
    if (priceElement.length) {
      bookData.price = priceElement.text().trim();
    } else {
      // Try alternative price selectors
      const priceText = $('div').filter(function() {
        return $(this).text().includes('€') && $(this).text().includes('inkl. MwSt');
      }).first().text().trim();
      
      if (priceText) {
        const priceMatch = priceText.match(/(\d+,\d+)\s*€/);
        if (priceMatch) {
          bookData.price = priceMatch[1] + ' €';
        }
      }
    }

    // Extract cover image URL
    const coverImg = $('img[src*="/cover/"]');
    if (coverImg.length) {
      bookData.coverUrl = coverImg.attr('src');
    }

    // Extract description
    const descriptionHeading = $('h2').filter(function() {
      return $(this).text().trim() === 'Beschreibung';
    });
    
    if (descriptionHeading.length) {
      // Get all text after the heading until the next heading
      let description = '';
      let nextElement = descriptionHeading.next();
      
      while (nextElement.length && !nextElement.is('h2')) {
        if (nextElement.text().trim()) {
          description += nextElement.text().trim() + '\n';
        }
        nextElement = nextElement.next();
      }
      
      bookData.description = description.trim();
    }

    // Extract details
    const detailsHeading = $('h2').filter(function() {
      return $(this).text().trim() === 'Details';
    });
    
    if (detailsHeading.length) {
      let currentElement = detailsHeading.next();
      let currentHeading = '';
      
      while (currentElement.length && !currentElement.is('h2')) {
        if (currentElement.is('h3')) {
          currentHeading = currentElement.text().trim();
        } else if (currentHeading && currentElement.text().trim()) {
          const value = currentElement.text().trim();
          
          switch (currentHeading) {
            case 'Format':
              bookData.format = value;
              // Adjust type based on format
              if (value.toLowerCase().includes('audio') || 
                  value.toLowerCase().includes('mp3')) {
                bookData.type = 'audiobook';
              }
              break;
            case 'Verlag':
              bookData.publisher = value;
              break;
            case 'Erscheinungsdatum':
              bookData.publicationDate = value;
              break;
            case 'Seitenzahl':
              bookData.pageCount = value;
              break;
            case 'Sprache':
              bookData.language = value;
              break;
            case 'EAN':
            case 'ISBN':
              bookData.ean = value;
              bookData.isbn = value;
              break;
          }
        }
        
        currentElement = currentElement.next();
      }
    }

    // Extract author from description if not found elsewhere
    if (!bookData.author && bookData.description) {
      // Look for common author patterns in the description
      const authorFromDesc = extractAuthorFromText(bookData.description);
      if (authorFromDesc) {
        bookData.author = authorFromDesc;
      }
    }

    // Normalize data
    return normalizeBookData(bookData);
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    await browser.close();
    console.log('Browser closed');
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
    
    if (isValidAmazonUrl(url)) {
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
    } else if (isValidThaliaUrl(url)) {
      try {
        const bookData = await scrapeThalia(url);
        
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
          error: `Failed to scrape Thalia data: ${scrapeError.message}`,
          details: scrapeError.stack
        });
      }
    } else {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid URL. Please provide a valid Amazon.de or Thalia.de book URL.' 
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
    message: 'Book Scraper API is running',
    endpoints: {
      health: '/health',
      scraper: '/api/scrape'
    }
  });
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
