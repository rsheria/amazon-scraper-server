/**
 * Amazon Book Scraper for German Bookshelf Application
 * 
 * This script extracts book details from Amazon.de URLs including:
 * - Title
 * - Author(s)
 * - Description
 * - ISBN
 * - Publication date
 * - Publisher
 * - Page count
 * - Cover image URL
 * - Price
 * - Categories/genres
 * - Language
 */

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3333;

// Enable CORS for all routes
app.use(cors({
  origin: '*',  // Allow requests from any domain
  methods: ['GET', 'POST'],
  credentials: false
}));
app.use(express.json());

/**
 * Validates if the provided URL is a valid Amazon.de book URL
 * @param {string} url - The URL to validate
 * @returns {boolean} - Whether the URL is valid
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
 * @param {string} url - The Amazon URL
 * @returns {string|null} - The ASIN or null if not found
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
 * Adds random delay to avoid detection
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 * @returns {Promise<void>}
 */
async function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Fetches book data from Amazon.de
 * @param {string} url - The Amazon.de book URL
 * @returns {Promise<Object|null>} - The book data or null if failed
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
    // Launch browser with stealth mode to avoid detection
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36"'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });

    try {
      const page = await browser.newPage();
      
      // Set extra headers to mimic a real browser
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
      });
      
      // Set viewport to look like a desktop browser
      await page.setViewport({
        width: 1366,
        height: 768
      });

      // Navigate to the page with a random delay
      await randomDelay();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for important elements to load
      await page.waitForSelector('body', { timeout: 10000 });
      
      // Add a random delay to simulate human behavior
      await randomDelay();
      
      // Get the page HTML content
      const content = await page.content();
      
      // Parse the HTML with Cheerio
      const $ = cheerio.load(content);
      
      // Extract book data
      const bookData = extractBookData($, asin);
      
      // If we couldn't get the description, it might be in a separate tab
      if (!bookData.description) {
        try {
          // Look for the description tab and click it if it exists
          const descriptionTabSelector = '#detailBullets_feature_div, #bookDescription_feature_div';
          if (await page.$(descriptionTabSelector)) {
            await page.click(descriptionTabSelector);
            await page.waitForTimeout(1000); // Wait for content to load
            
            // Get updated content and extract description
            const updatedContent = await page.content();
            const updated$ = cheerio.load(updatedContent);
            bookData.description = extractDescription(updated$);
          }
        } catch (error) {
          console.error('Error getting description from tab:', error);
        }
      }
      
      return bookData;
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('Error fetching book data:', error);
    throw error;
  }
}

/**
 * Extracts book data from the parsed HTML
 * @param {CheerioStatic} $ - The Cheerio instance
 * @param {string} asin - The book ASIN
 * @returns {Object} - The extracted book data
 */
function extractBookData($, asin) {
  // Initialize book data object
  const bookData = {
    asin: asin,
    title: '',
    authors: [],
    description: '',
    isbn: '',
    isbn13: '',
    publicationDate: '',
    publisher: '',
    pageCount: '',
    coverUrl: '',
    price: '',
    categories: [],
    language: '',
    type: 'ebook' // Default to ebook, will be updated if found
  };

  // Extract title
  bookData.title = $('#productTitle').text().trim();
  if (!bookData.title) {
    bookData.title = $('.kindle-title').text().trim();
  }

  // Extract authors
  $('#bylineInfo .author a, .contributorNameID, .authorNameLink a').each((i, el) => {
    const author = $(el).text().trim();
    if (author && !bookData.authors.includes(author)) {
      bookData.authors.push(author);
    }
  });

  // Extract description
  bookData.description = extractDescription($);

  // Extract cover image URL
  const coverImg = $('#imgBlkFront, #ebooksImgBlkFront, #main-image');
  if (coverImg.length) {
    bookData.coverUrl = coverImg.attr('src') || coverImg.attr('data-a-dynamic-image');
    
    // If data-a-dynamic-image is a JSON string, parse it and get the first URL
    if (bookData.coverUrl && bookData.coverUrl.startsWith('{')) {
      try {
        const imageData = JSON.parse(bookData.coverUrl);
        bookData.coverUrl = Object.keys(imageData)[0];
      } catch (e) {
        console.error('Error parsing image data:', e);
      }
    }
  }

  // If we still don't have a valid cover URL, try additional selectors
  if (!bookData.coverUrl || bookData.coverUrl.includes('transparent-pixel')) {
    // Try additional image selectors
    const additionalSelectors = [
      '#landingImage',
      '#imgBlkFront',
      '#ebooksImgBlkFront',
      '#igImage',
      '.a-dynamic-image',
      '.frontImage',
      '#main-image'
    ];

    for (const selector of additionalSelectors) {
      const img = $(selector);
      if (img.length) {
        // Try various attributes where image URL might be stored
        const imgUrl = img.attr('src') || 
                       img.attr('data-a-dynamic-image') || 
                       img.attr('data-old-hires') || 
                       img.attr('data-srcset') ||
                       img.attr('srcset');
        
        if (imgUrl && imgUrl !== bookData.coverUrl) {
          // If it's a data-a-dynamic-image JSON string
          if (imgUrl.startsWith('{')) {
            try {
              const imageData = JSON.parse(imgUrl);
              // Get the highest resolution image from the JSON
              const urls = Object.keys(imageData);
              if (urls.length > 0) {
                // Sort by resolution and get the highest
                urls.sort((a, b) => {
                  const aRes = imageData[a];
                  const bRes = imageData[b];
                  return bRes[0] * bRes[1] - aRes[0] * aRes[1]; // Multiply width x height for area
                });
                bookData.coverUrl = urls[0];
                break;
              }
            } catch (e) {
              console.error('Error parsing image JSON:', e);
            }
          } else if (imgUrl.includes(',')) {
            // Handle srcset strings
            const srcSet = imgUrl.split(',');
            if (srcSet.length > 0) {
              // Try to get the highest resolution
              const highestRes = srcSet[srcSet.length - 1].trim().split(' ')[0];
              bookData.coverUrl = highestRes || srcSet[0].trim().split(' ')[0];
              break;
            }
          } else {
            bookData.coverUrl = imgUrl;
            break;
          }
        }
      }
    }
  }
  
  // If we still don't have an image, try the ASIN-based URL as final fallback
  if (!bookData.coverUrl || bookData.coverUrl.includes('transparent-pixel')) {
    // Generate Amazon image URL from ASIN
    bookData.coverUrl = `https://m.media-amazon.com/images/P/${asin}.jpg`;
  }

  // Extract price
  const priceElement = $('.kindle-price .a-color-price, #price, .a-price .a-offscreen');
  if (priceElement.length) {
    bookData.price = priceElement.first().text().trim();
  }

  // Extract book details from detail bullets
  extractFromDetailBullets($, bookData);
  
  // If detail bullets didn't have all info, try the book details section
  extractFromBookDetails($, bookData);
  
  // If we still don't have all info, try the technical details section
  extractFromTechnicalDetails($, bookData);

  // Determine if it's an audiobook
  if ($('#productTitle').text().toLowerCase().includes('hörbuch') || 
      $('.a-breadcrumb').text().toLowerCase().includes('hörbuch')) {
    bookData.type = 'audiobook';
  }

  return bookData;
}

/**
 * Extracts the book description
 * @param {CheerioStatic} $ - The Cheerio instance
 * @returns {string} - The book description
 */
function extractDescription($) {
  // Try different selectors for description
  const descriptionSelectors = [
    '#bookDescription_feature_div .a-expander-content',
    '#bookDescription_feature_div',
    '#productDescription',
    '#feature-bullets',
    '.book-description',
    '#editorialReviews',
    '#aboutEbooksSection'
  ];
  
  for (const selector of descriptionSelectors) {
    const element = $(selector);
    if (element.length) {
      return element.text().trim();
    }
  }
  
  return '';
}

/**
 * Extracts book details from the detail bullets section
 * @param {CheerioStatic} $ - The Cheerio instance
 * @param {Object} bookData - The book data object to update
 */
function extractFromDetailBullets($, bookData) {
  $('#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li').each((i, el) => {
    const text = $(el).text().trim();
    
    // ISBN
    if (text.includes('ISBN-10') || text.includes('ISBN10')) {
      bookData.isbn = text.split(':')[1]?.trim() || '';
    }
    
    // ISBN-13
    if (text.includes('ISBN-13') || text.includes('ISBN13')) {
      bookData.isbn13 = text.split(':')[1]?.trim() || '';
    }
    
    // Publisher
    if (text.includes('Verlag') || text.includes('Publisher')) {
      const parts = text.split(':');
      if (parts.length > 1) {
        bookData.publisher = parts[1].trim();
        
        // Publication date might be included with publisher
        const dateMatch = bookData.publisher.match(/\(([^)]+)\)/);
        if (dateMatch) {
          bookData.publicationDate = dateMatch[1].trim();
          bookData.publisher = bookData.publisher.replace(/\([^)]+\)/, '').trim();
        }
      }
    }
    
    // Publication date (if not already extracted)
    if ((text.includes('Erscheinungstermin') || text.includes('Publication date')) && !bookData.publicationDate) {
      bookData.publicationDate = text.split(':')[1]?.trim() || '';
    }
    
    // Language
    if (text.includes('Sprache') || text.includes('Language')) {
      bookData.language = text.split(':')[1]?.trim() || '';
    }
    
    // Page count
    if (text.includes('Seitenzahl') || text.includes('Print length') || text.includes('Page numbers')) {
      const pageText = text.split(':')[1]?.trim() || '';
      const pageMatch = pageText.match(/\d+/);
      if (pageMatch) {
        bookData.pageCount = pageMatch[0];
      }
    }
  });
}

/**
 * Extracts book details from the book details section
 * @param {CheerioStatic} $ - The Cheerio instance
 * @param {Object} bookData - The book data object to update
 */
function extractFromBookDetails($, bookData) {
  $('.detail-bullet-list span').each((i, el) => {
    const label = $(el).find('.a-text-bold').text().trim();
    const value = $(el).text().replace(label, '').trim();
    
    if (label.includes('ISBN-10')) {
      bookData.isbn = value;
    } else if (label.includes('ISBN-13')) {
      bookData.isbn13 = value;
    } else if (label.includes('Verlag') || label.includes('Publisher')) {
      bookData.publisher = value;
    } else if (label.includes('Erscheinungstermin') || label.includes('Publication date')) {
      bookData.publicationDate = value;
    } else if (label.includes('Sprache') || label.includes('Language')) {
      bookData.language = value;
    } else if (label.includes('Seitenzahl') || label.includes('Print length')) {
      const pageMatch = value.match(/\d+/);
      if (pageMatch) {
        bookData.pageCount = pageMatch[0];
      }
    }
  });
}

/**
 * Extracts book details from the technical details section
 * @param {CheerioStatic} $ - The Cheerio instance
 * @param {Object} bookData - The book data object to update
 */
function extractFromTechnicalDetails($, bookData) {
  $('.techDetalsCol .technicalData').each((i, el) => {
    const label = $(el).find('.label').text().trim();
    const value = $(el).find('.value').text().trim();
    
    if (label.includes('ISBN-10')) {
      bookData.isbn = value;
    } else if (label.includes('ISBN-13')) {
      bookData.isbn13 = value;
    } else if (label.includes('Verlag') || label.includes('Publisher')) {
      bookData.publisher = value;
    } else if (label.includes('Erscheinungstermin') || label.includes('Publication date')) {
      bookData.publicationDate = value;
    } else if (label.includes('Sprache') || label.includes('Language')) {
      bookData.language = value;
    } else if (label.includes('Seitenzahl') || label.includes('Print length')) {
      const pageMatch = value.match(/\d+/);
      if (pageMatch) {
        bookData.pageCount = pageMatch[0];
      }
    }
  });
  
  // Try to extract categories
  $('.zg_hrsr_ladder a').each((i, el) => {
    const category = $(el).text().trim();
    if (category && !bookData.categories.includes(category)) {
      bookData.categories.push(category);
    }
  });
}

/**
 * Converts Amazon book data to the application's book format
 * @param {Object} amazonData - The Amazon book data
 * @returns {Object} - The book data in the application's format
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
    
    console.log(`Scraping book data from ${url}`);
    
    const amazonData = await fetchBookDataFromAmazon(url);
    const bookData = amazonDataToBook(amazonData);
    
    return res.json({
      success: true,
      rawData: amazonData,
      bookData: bookData
    });
  } catch (error) {
    console.error('Scraper error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to scrape Amazon data' 
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
    message: 'Amazon Scraper API is running',
    endpoints: {
      health: '/health',
      scraper: '/api/scrape'
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Amazon scraper server running on port ${PORT}`);
});

// Export functions for testing
module.exports = {
  isValidAmazonUrl,
  fetchBookDataFromAmazon,
  amazonDataToBook
};
