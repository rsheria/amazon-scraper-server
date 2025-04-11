// Test script to debug the Thalia scraper
// Direct import of the scraper functions to avoid server initialization
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

// Copy the necessary functions from amazon-scraper-simple.js
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

async function scrapeThalia(url) {
  console.log(`Starting to scrape Thalia book data from: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();

    // Set a reasonable timeout
    await page.setDefaultNavigationTimeout(30000);
    
    // Set a viewport size
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('Navigating to URL...');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    // Wait for the content to load
    console.log('Waiting for page to load...');
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Handling cookie consent if it appears
    console.log('Checking for cookie consent...');
    try {
      const cookieConsentButton = await page.$('button[data-testid="uc-accept-all-button"]');
      if (cookieConsentButton) {
        console.log('Cookie consent found, clicking accept...');
        await cookieConsentButton.click();
        await page.waitForTimeout(1000); // Wait for the consent dialog to close
      }
    } catch (error) {
      console.log('No cookie consent found or error handling it:', error.message);
    }
    
    console.log('Extracting HTML content...');
    // Get the page content
    const content = await page.content();
    
    // Parse with cheerio
    const $ = cheerio.load(content);
    
    console.log('Parsing HTML with cheerio...');
    
    // Log the full HTML for debugging
    console.log('HTML snippet:', content.substring(0, 500) + '...');
    
    // Extract the book data
    const bookData = {
      title: $('h1.styled__TextElement-sc-d9k1bl-0').text().trim() || '',
      subtitle: $('div.styled__SubtitleWrapper-sc-d9k1bl-1').text().trim() || '',
      author: $('a.styled__Link-sc-12h77p5-0').first().text().trim() || '',
      series: '', // Not always present
      seriesNumber: '', // Not always present
      description: $('div[data-testid="detailsTab"] div.html4-styling').text().trim() || '',
      format: $('div.styled__Format-sc-1md0cja-2').text().trim() || '',
      price: $('div.styled__PriceWrapper-sc-1md0cja-4').text().trim() || '',
      isbn: '',
      ean: '',
      publisher: $('div.styled__PublisherContainer-sc-1md0cja-3').text().trim() || '',
      publicationDate: '',
      language: 'Deutsch', // Default language
      pageCount: '',
      fileSize: '',
      copyProtection: '',
      coverUrl: $('img.styled__Img-sc-j91dh-0').attr('src') || 'https://via.placeholder.com/150x225?text=No+Cover',
      categories: [],
    };
    
    // Log the extracted data
    console.log('Extracted raw book data:', bookData);
    
    // Extract series info if available
    const seriesText = $('a.styled__SeriesLink-sc-d9k1bl-2').text().trim();
    if (seriesText) {
      // Try to parse series and series number
      const seriesMatch = seriesText.match(/(.*?)\s*(\d+)/);
      if (seriesMatch) {
        bookData.series = seriesMatch[1].trim();
        bookData.seriesNumber = seriesMatch[2];
      } else {
        bookData.series = seriesText;
      }
    }
    
    // Extract more metadata
    $('span.styled__SpecTitle-sc-1md0cja-7').each((i, el) => {
      const label = $(el).text().trim();
      const value = $(el).next().text().trim();
      
      if (label.includes('ISBN')) {
        bookData.isbn = value;
      } else if (label.includes('EAN')) {
        bookData.ean = value;
      } else if (label.includes('Seitenzahl')) {
        bookData.pageCount = value;
      } else if (label.includes('Erscheinungsdatum')) {
        bookData.publicationDate = value;
      } else if (label.includes('Sprache')) {
        bookData.language = value;
      }
    });
    
    // Set default language code
    bookData.languageCode = 'de';
    
    // Validate the required fields and add validation warning if needed
    const requiredFields = ['title', 'author', 'description'];
    const missingFields = requiredFields.filter(field => !bookData[field]);
    
    if (missingFields.length > 0) {
      bookData.validationWarning = {
        missingFields: missingFields
      };
    }
    
    console.log('Final processed book data:', bookData);
    return bookData;
  } catch (error) {
    console.error('Error scraping Thalia:', error);
    throw error;
  } finally {
    // Close browser
    await browser.close();
  }
}

async function testThaliaScraper() {
  try {
    const url = 'https://www.thalia.de/shop/home/artikeldetails/A1072127596';
    console.log(`Testing Thalia scraper with URL: ${url}`);
    
    // Validate URL
    const isValid = isValidThaliaUrl(url);
    console.log(`URL valid: ${isValid}`);
    
    if (!isValid) {
      console.error('Invalid URL provided');
      return;
    }
    
    // Scrape data
    console.log('Starting scraping...');
    const data = await scrapeThalia(url);
    
    // Log results
    console.log('Scraping completed!');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error testing Thalia scraper:', error);
  }
}

// Run the test
testThaliaScraper();
