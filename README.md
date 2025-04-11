# Thalia Scraper Server

This server provides an API for scraping book data from Thalia.de. It's designed to replace the previous Amazon scraper implementation for the German Bookshelf application.

## Features

- Scrapes book data from Thalia.de URLs
- Extracts title, author, description, cover image URL, and other metadata
- Handles cookie consent dialogs automatically
- Robust error handling and data validation
- Works with the existing German Bookshelf frontend

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the server:
   ```
   npm start
   ```

## API Endpoints

### POST /api/scrape

Scrapes book data from a Thalia.de URL.

**Request Body:**
```json
{
  "url": "https://www.thalia.de/shop/home/artikeldetails/A1060691146"
}
```

**Response:**
```json
{
  "title": "Book Title",
  "author": "Author Name",
  "description": "Book description...",
  "coverUrl": "https://example.com/cover.jpg",
  "language": "German",
  "genre": "Fiction",
  "type": "ebook",
  "isbn": "9781234567890",
  "pageCount": 123,
  "publishedDate": "2023-01-01",
  "publisher": "Publisher Name"
}
```

## Implementation Details

The scraper uses Puppeteer for browser automation and Cheerio for HTML parsing. It navigates to the Thalia.de book page, handles any cookie consent dialogs, and extracts the relevant book data from the HTML.

## Error Handling

The server handles various error conditions including:
- Invalid URLs
- Network errors
- Missing data
- Cookie consent issues

Each error response includes a meaningful status code and error message.

## Deployment

This server can be deployed to platforms like Render, Heroku, or any other Node.js hosting service.

## Frontend Integration

The German Bookshelf frontend application can be configured to use this server by setting the `VITE_THALIA_SCRAPER_URL` environment variable to the server's URL.
