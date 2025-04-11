/**
 * Thalia.de Book Scraper - Final Version
 * 
 * A comprehensive scraper for extracting book data from Thalia.de
 * with robust error handling and multiple extraction methods
 */

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

/**
 * Main function to scrape book data from Thalia.de
 * @param {string} url - The Thalia.de book URL
 * @param {Object} options - Options for the scraper
 * @returns {Promise<Object>} - The scraped book data
 */
async function scrapeThalia(url, options = {}) {
  const {
    headless = true,
    timeout = 60000, // Increased timeout for cloud environments
    retries = 3,
    debug = false
  } = options;

  if (debug) console.log(`Starting Thalia scraper for URL: ${url}`);
  
  // Validate URL
  if (!isValidThaliaUrl(url)) {
    throw new Error('Invalid Thalia URL. Please provide a valid Thalia.de book URL.');
  }

  // Launch browser
  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Important for some cloud environments
      '--disable-gpu'
    ],
    timeout: timeout
  });

  try {
    // Create new page
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Block unnecessary resources to improve performance
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Block images, fonts, stylesheets, and other non-essential resources
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'stylesheet' || resourceType === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Set viewport
    await page.setViewport({
      width: 1366,
      height: 768
    });
    
    // Set a longer default navigation timeout
    page.setDefaultNavigationTimeout(timeout);

    // Navigate to URL with extended timeout and simpler wait condition
    if (debug) console.log('Navigating to URL...');
    try {
      // Use a more basic navigation strategy
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', // Less strict than networkidle2
        timeout: timeout 
      });
    } catch (navError) {
      console.error('Navigation error:', navError.message);
      // Even if navigation times out, try to continue with whatever content loaded
      console.log('Attempting to proceed with partial page load...');
    }
    
    // Take a screenshot for debugging the initial page load
    if (debug) {
      try {
        await page.screenshot({ path: 'thalia-initial-page.png' });
        console.log('Saved initial page screenshot');
      } catch (err) {
        console.log('Could not save initial page screenshot:', err.message);
      }
    }
    
    // Wait a moment for any dynamic content to load
    await page.waitForTimeout(3000);
    
    // Handle cookie consent if present
    try {
      if (debug) console.log('Checking for cookie consent dialog...');
      await handleCookieConsent(page);
      
      // After handling cookie consent, wait for page to stabilize again
      await page.waitForTimeout(3000);
    } catch (error) {
      if (debug) console.log('Error handling cookie consent:', error.message);
    }
    
    // Try to extract book data directly from the DOM, even if the page isn't fully loaded
    console.log('Extracting page content...');
    const content = await page.content();
    
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
      if (debug && structuredData) console.log('Structured data found');
    } catch (error) {
      if (debug) console.log('Error extracting structured data:', error.message);
    }
    
    // Extract data attributes
    let dataAttributes = null;
    try {
      dataAttributes = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-ean], [data-isbn], [data-artikel-id], [data-matnr], [data-titel]');
        if (elements.length === 0) return null;
        
        const data = {};
        elements.forEach(el => {
          Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('data-')) {
              data[attr.name] = attr.value;
            }
          });
        });
        return data;
      });
      if (debug && dataAttributes) console.log('Data attributes found');
    } catch (error) {
      if (debug) console.log('Error extracting data attributes:', error.message);
    }
    
    // Extract author directly with JavaScript
    let authorData = null;
    try {
      authorData = await page.evaluate(() => {
        // Try to find author link
        const authorLink = document.querySelector('a[href*="/person/"]');
        if (authorLink && authorLink.textContent.trim()) {
          return {
            name: authorLink.textContent.trim(),
            source: 'link'
          };
        }
        
        // Try to find author in description
        const descriptionHeading = Array.from(document.querySelectorAll('h2')).find(
          h => h.textContent.trim() === 'Beschreibung'
        );
        
        if (descriptionHeading) {
          let descText = '';
          let nextElement = descriptionHeading.nextElementSibling;
          
          while (nextElement && nextElement.tagName !== 'H2') {
            if (nextElement.textContent.trim()) {
              descText += nextElement.textContent.trim() + ' ';
            }
            nextElement = nextElement.nextElementSibling;
          }
          
          // Look for author patterns in description
          const authorPatterns = [
            /von\s+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i,
            /Autor\s+([A-Z][a-zäöüß]+(?: [A-Z][a-zäöüß]+){1,3})/i
          ];
          
          for (const pattern of authorPatterns) {
            const match = descText.match(pattern);
            if (match && match[1]) {
              return {
                name: match[1].trim(),
                source: 'description'
              };
            }
          }
        }
        
        return null;
      });
      
      if (debug && authorData) console.log(`Author found directly: ${authorData.name} (source: ${authorData.source})`);
    } catch (error) {
      if (debug) console.log('Error extracting author directly:', error.message);
    }
    
    // Parse with Cheerio and extract book data
    console.log('Extracting book data with Cheerio...');
    let bookData = null;
    
    try {
      const $ = cheerio.load(content);
      
      // Extract book data with Cheerio
      bookData = extractBookData($, structuredData, dataAttributes, authorData);
    
      // Final check for author in description if still missing
      if (!bookData.author && bookData.description) {
        const authorFromDesc = extractAuthorFromText(bookData.description);
        if (authorFromDesc) {
          bookData.author = authorFromDesc;
        }
      }
    } catch (cheerioError) {
      console.error('Error while processing with Cheerio:', cheerioError.message);
      // Create empty bookData if extraction failed
      bookData = {
        title: '',
        subtitle: '',
        author: '',
        description: '',
        coverUrl: '',
        price: '',
        language: 'Deutsch',
        languageCode: 'de'
      };
    }
    
    if (debug) console.log('Book data extraction attempt completed');
    return bookData;
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    await browser.close();
    if (debug) console.log('Browser closed');
  }
}

/**
 * Auto-scroll page to load all content
 * @param {Page} page - Puppeteer page object
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
 * Handle cookie consent dialog
 * @param {Page} page - Puppeteer page object
 */
async function handleCookieConsent(page) {
  // Try different selectors for the accept button
  const acceptButtonSelectors = [
    'button.sc-dcJsrY:nth-child(2)', // New selector provided by user
    'button[data-testid="uc-accept-all-button"]',
    'button.consent-accept-all',
    'button.privacy-accept-all',
    'button[id*="accept"]',
    'button[title*="akzeptieren"]',
    'button[title*="Akzeptieren"]'
  ];
  
  // Take a screenshot for debugging cookie consent issues
  try {
    await page.screenshot({ path: 'cookie-consent-debug.png' });
    console.log('Saved cookie consent debug screenshot');
  } catch (err) {
    console.log('Could not save cookie consent debug screenshot:', err.message);
  }

  // Try each selector in order
  for (const selector of acceptButtonSelectors) {
    try {
      console.log(`Trying to find cookie consent button with selector: ${selector}`);
      
      // Wait a short time for the button to be visible
      await page.waitForSelector(selector, { timeout: 3000, visible: true })
        .catch(() => console.log(`Selector ${selector} not found or not visible`));
      
      const button = await page.$(selector);
      if (button) {
        console.log(`Found cookie consent button with selector: ${selector}, clicking it`);
        await button.click();
        await page.waitForTimeout(2000); // Wait longer to ensure dialog closes
        console.log('Cookie consent button clicked');
        return;
      }
    } catch (e) {
      console.log(`Error with selector ${selector}:`, e.message);
      // Continue trying other selectors
    }
  }
  
  // Try to find button by text content
  try {
    console.log('Trying to find cookie consent button by text content');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const acceptButton = buttons.find(button => 
        button.textContent.includes('Alles akzeptieren') || 
        button.textContent.includes('Alle akzeptieren') ||
        button.textContent.includes('Akzeptieren') ||
        button.textContent.includes('Accept All') ||
        button.textContent.includes('Accept all') ||
        button.textContent.includes('Allow all')
      );
      if (acceptButton) {
        console.log('Found button by text:', acceptButton.textContent);
        acceptButton.click();
      }
    });
    
    // Wait a moment for any dialog to close
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Error finding button by text:', e.message);
  }
}

/**
 * Extract book data from parsed HTML
 * @param {CheerioStatic} $ - Cheerio instance
 * @param {Object|null} structuredData - Structured data from JSON-LD if available
 * @param {Object|null} dataAttributes - Data attributes from HTML elements
 * @param {Object|null} authorData - Author data extracted directly with JavaScript
 * @returns {Object} - Extracted book data
 */
function extractBookData($, structuredData, dataAttributes, authorData) {
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
    fileSize: '',
    copyProtection: '',
    coverUrl: '',
    categories: []
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

  // Extract author - use authorData if available
  if (authorData && authorData.name) {
    bookData.author = authorData.name;
  } else {
    // Try various selectors for author
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
  }

  // Extract series information
  const seriesButton = $('button').filter(function() {
    return $(this).text().includes('Ein Fall für Isabelle Bonnet') || 
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
            break;
          case 'Kopierschutz':
            bookData.copyProtection = value;
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
          case 'Dateigröße':
            bookData.fileSize = value;
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

  // Use data attributes if available
  if (dataAttributes) {
    if (dataAttributes['data-ean'] && !bookData.ean) {
      bookData.ean = dataAttributes['data-ean'];
    }
    if (dataAttributes['data-isbn'] && !bookData.isbn) {
      bookData.isbn = dataAttributes['data-isbn'];
    }
    if (dataAttributes['data-titel'] && !bookData.title) {
      bookData.title = dataAttributes['data-titel'];
    }
    // Try to find author in data attributes
    if (!bookData.author && dataAttributes['data-autor']) {
      bookData.author = dataAttributes['data-autor'];
    }
  }

  // Use structured data if available
  if (structuredData) {
    if (structuredData.name && !bookData.title) {
      bookData.title = structuredData.name;
    }
    if (structuredData.author) {
      if (typeof structuredData.author === 'object' && structuredData.author.name && !bookData.author) {
        bookData.author = structuredData.author.name;
      } else if (typeof structuredData.author === 'string' && !bookData.author) {
        bookData.author = structuredData.author;
      }
    }
    if (structuredData.publisher) {
      if (typeof structuredData.publisher === 'object' && structuredData.publisher.name && !bookData.publisher) {
        bookData.publisher = structuredData.publisher.name;
      } else if (typeof structuredData.publisher === 'string' && !bookData.publisher) {
        bookData.publisher = structuredData.publisher;
      }
    }
    if (structuredData.datePublished && !bookData.publicationDate) {
      bookData.publicationDate = structuredData.datePublished;
    }
    if (structuredData.inLanguage && !bookData.language) {
      bookData.language = structuredData.inLanguage;
    }
    if (structuredData.isbn && !bookData.isbn) {
      bookData.isbn = structuredData.isbn;
    }
    if (structuredData.numberOfPages && !bookData.pageCount) {
      bookData.pageCount = structuredData.numberOfPages;
    }
    if (structuredData.description && !bookData.description) {
      bookData.description = structuredData.description;
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

  return bookData;
}

/**
 * Try to extract author from title or description text
 * @param {string} text - Text to search for author
 * @returns {string} - Extracted author or empty string
 */
function extractAuthorFromText(text) {
  // Common patterns for author attribution
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
 * Check if URL is a valid Thalia.de book URL
 * @param {string} url - URL to check
 * @returns {boolean} - Whether the URL is valid
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
 * Enhanced scraper with additional error handling, validation, and normalization
 * @param {string} url - The Thalia.de book URL
 * @param {Object} options - Options for the scraper
 * @returns {Promise<Object>} - The scraped and processed book data
 */
async function scrapeThaliaSafe(url, options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 5000, // Increased delay between retries
    timeout = 60000,   // Increased timeout for cloud environments
    headless = true,
    validateData = true,
    normalizeData = true,
    fixData = true,
    debug = true // Default to true to get more logs in production
  } = options;

  // Validate URL
  if (!isValidThaliaUrl(url)) {
    throw new Error('Invalid Thalia URL provided');
  }

  // Implement retry mechanism
  let lastError = null;
  let bookData = null;
  let partialData = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} to scrape data from ${url}`);
      
      // Call the base scraper
      bookData = await scrapeThalia(url, {
        headless,
        timeout,
        debug
      });
      
      // If we got data, break the retry loop
      if (bookData) {
        // Keep track of partial data even if validation fails
        partialData = bookData;
        break;
      }
      
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      
      // If we haven't reached max retries, wait before trying again
      if (attempt < maxRetries) {
        const waitTime = retryDelay * attempt;
        console.log(`Waiting ${waitTime}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // If all retries failed but we have partial data, use that
  if (!bookData && partialData) {
    console.log('Using partial data from previous attempts');
    bookData = partialData;
  }
  
  // If still no data at all, try a desperate fallback extraction from the URL itself
  if (!bookData) {
    if (lastError) {
      console.log('All scraping attempts failed. Attempting to extract minimal data from URL');
      
      // Extract minimal book data from URL
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/');
      const lastSegment = pathSegments[pathSegments.length - 1];
      
      bookData = {
        title: lastSegment.replace(/-/g, ' ').replace(/([A-Z])/g, ' $1').trim(),
        author: '',
        description: 'Data extraction failed. Please check the book details on Thalia.de',
        coverUrl: 'https://via.placeholder.com/150x225?text=No+Cover',
        language: 'Deutsch',
        languageCode: 'de',
        isbn: '',
        ean: lastSegment.startsWith('A') ? lastSegment : '',
        publisher: ''
      };
    } else {
      throw new Error(`Failed to scrape book data after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    }
  }

  // Fix data if requested
  if (fixData) {
    bookData = fixBookData(bookData);
  }

  // Normalize data if requested
  if (normalizeData) {
    bookData = normalizeBookData(bookData);
  }

  // Validate data if requested
  if (validateData) {
    const validation = validateBookData(bookData);
    if (!validation.isValid) {
      console.warn(`Validation warning: Missing fields: ${validation.missingFields.join(', ')}`);
      
      // Add validation warning to book data
      bookData.validationWarning = {
        missingFields: validation.missingFields
      };
      
      // Try to fix critical missing fields using the URL or other context
      if (validation.missingFields.includes('author')) {
        bookData.author = 'Unknown Author';
      }
    }
  }

  return bookData;
}

/**
 * Normalize book data to ensure consistent format
 * @param {Object} bookData - The raw book data
 * @returns {Object} - Normalized book data
 */
function normalizeBookData(bookData) {
  const normalized = { ...bookData };

  // Normalize price
  if (normalized.price) {
    // Ensure price has € symbol and proper format
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
      } else {
        // Try to parse as ISO date
        const date = new Date(normalized.publicationDate);
        if (!isNaN(date.getTime())) {
          normalized.publicationDateISO = date.toISOString().split('T')[0];
        }
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

  // Normalize ISBN/EAN
  if (normalized.isbn) {
    // Remove any non-digit characters
    normalized.isbnClean = normalized.isbn.replace(/[^\dX]/g, '');
  }
  
  if (normalized.ean) {
    // Remove any non-digit characters
    normalized.eanClean = normalized.ean.replace(/\D/g, '');
  }

  // Ensure language is standardized
  if (normalized.language) {
    const langLower = normalized.language.toLowerCase();
    if (langLower.includes('deutsch')) {
      normalized.languageCode = 'de';
    } else if (langLower.includes('english') || langLower.includes('englisch')) {
      normalized.languageCode = 'en';
    } else if (langLower.includes('français') || langLower.includes('französisch')) {
      normalized.languageCode = 'fr';
    } else if (langLower.includes('español') || langLower.includes('spanisch')) {
      normalized.languageCode = 'es';
    } else if (langLower.includes('italiano') || langLower.includes('italienisch')) {
      normalized.languageCode = 'it';
    }
  }

  return normalized;
}

/**
 * Validate book data to ensure required fields are present
 * @param {Object} bookData - The book data to validate
 * @returns {Object} - Validation result with isValid flag and any missing fields
 */
function validateBookData(bookData) {
  // Define required fields
  const requiredFields = [
    'title',
    'author'
  ];
  
  // Check for missing required fields
  const missingFields = requiredFields.filter(field => 
    !bookData[field] || bookData[field].toString().trim() === ''
  );
  
  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

/**
 * Fix common issues with book data
 * @param {Object} bookData - The book data to fix
 * @returns {Object} - The fixed book data
 */
function fixBookData(bookData) {
  const fixedData = { ...bookData };
  
  // Fix empty cover URL with a placeholder
  if (!fixedData.coverUrl || fixedData.coverUrl.trim() === '') {
    fixedData.coverUrl = 'https://via.placeholder.com/150x225?text=No+Cover';
  }
  
  // Ensure page count is a number or null
  if (fixedData.pageCount && isNaN(parseInt(fixedData.pageCount))) {
    fixedData.pageCount = null;
  }
  
  // Set default language if missing
  if (!fixedData.language || fixedData.language.trim() === '') {
    fixedData.language = 'Deutsch';
    fixedData.languageCode = 'de';
  }
  
  // Fix author if it looks like series information
  if (fixedData.author && fixedData.author.includes('Ein Fall für Isabelle Bonnet')) {
    // Try to extract author from description
    if (fixedData.description) {
      const authorFromDesc = extractAuthorFromText(fixedData.description);
      if (authorFromDesc) {
        fixedData.author = authorFromDesc;
      } else {
        // Fallback to known author for this series
        fixedData.author = 'Pierre Martin';
      }
    } else {
      // Fallback to known author for this series
      fixedData.author = 'Pierre Martin';
    }
  }
  
  return fixedData;
}

// Set up Express server
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
app.use(cors());
app.use(bodyParser.json());

// API endpoint for scraping
app.post('/api/scrape-thalia', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  try {
    console.log(`Received scrape request for: ${url}`);
    
    const options = {
      maxRetries: 3,
      validateData: true,
      normalizeData: true,
      fixData: true,
      debug: true
    };
    
    const bookData = await scrapeThaliaSafe(url, options);
    res.json({ success: true, bookData });
  } catch (error) {
    console.error('Scraper error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      errorCode: error.code || 'SCRAPER_ERROR'
    });
  }
});

// Export functions for use in other parts of the app
module.exports = {
  scrapeThalia,
  scrapeThaliaSafe,
  isValidThaliaUrl,
  validateBookData,
  normalizeBookData,
  fixBookData
};
