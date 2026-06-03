const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Store credentials
const CSTORE_USERNAME = process.env.CSTORE_USERNAME || 'fifthstreet';
const CSTORE_PASSWORD = process.env.CSTORE_PASSWORD || 'Volco@2604';
const CSTORE_URL = 'https://secure.cstorepro.com/EmagineNETCOSM';

let browser = null;
let page = null;
let isLoggedIn = false;

// Launch browser once and keep it alive
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    console.log('Browser launched');
  }
  return browser;
}

// Login to CStorePro
async function login() {
  try {
    const b = await getBrowser();
    page = await b.newPage();
    
    await page.goto(`${CSTORE_URL}/Login.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Fill in credentials
    await page.type('#txtUserName', CSTORE_USERNAME, { delay: 50 });
    await page.type('#txtPassword', CSTORE_PASSWORD, { delay: 50 });
    
    // Wait for Cloudflare to auto-pass
    await new Promise(r => setTimeout(r, 3000));
    
    // Click login
    await page.click('#btnLogin');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    
    isLoggedIn = true;
    console.log('Logged in successfully');
    return true;
  } catch (err) {
    console.error('Login failed:', err.message);
    isLoggedIn = false;
    return false;
  }
}

// Search for a product price
async function searchProduct(productName) {
  try {
    // Check if session is still valid
    const currentUrl = page ? page.url() : '';
    if (!isLoggedIn || currentUrl.includes('Login')) {
      console.log('Session expired, re-logging in...');
      await login();
    }

    // Go directly to Price Book Items
    await page.goto(
      `${CSTORE_URL}/Content/POSManagement/POSItemList.aspx`,
      { waitUntil: 'networkidle2', timeout: 30000 }
    );

    // Clear and type in search box
    await page.waitForSelector('input[placeholder*="Item"], input[id*="search"], input[id*="Search"], #txtSearch', 
      { timeout: 10000 });
    
    // Try multiple possible search field selectors
    const searchSelectors = [
      'input[placeholder*="Item Name"]',
      'input[id*="txtSearch"]', 
      'input[id*="search"]',
      '#txtItemName',
      'input[type="text"]'
    ];

    let searched = false;
    for (const selector of searchSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(productName, { delay: 50 });
          // Press Enter or find search button
          await page.keyboard.press('Enter');
          searched = true;
          break;
        }
      } catch (e) { continue; }
    }

    if (!searched) throw new Error('Could not find search box');

    await page.waitForTimeout(2000);

    // Extract results from table
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tr, .item-row, [class*="row"]');
      const items = [];
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const name = cells[1]?.innerText?.trim();
          // Look for price in cells
          let price = null;
          cells.forEach(cell => {
            const text = cell.innerText?.trim();
            if (text && text.match(/^\$[\d.]+/) ) {
              price = text;
            }
          });
          if (name && price) {
            items.push({ name, price });
          }
        }
      });
      return items;
    });

    return results;

  } catch (err) {
    console.error('Search error:', err.message);
    // Try re-login once
    isLoggedIn = false;
    await login();
    throw new Error('Search failed, please try again');
  }
}

// ==========================================
// VAPI WEBHOOK ENDPOINT
// This is what VAPI calls when customer asks for a price
// ==========================================
app.post('/vapi-tool', async (req, res) => {
  console.log('VAPI request:', JSON.stringify(req.body, null, 2));
  
  try {
    const toolCalls = req.body.message?.toolCalls || [];
    
    if (toolCalls.length === 0) {
      return res.json({ result: "I didn't receive a product name to search for." });
    }

    const toolCall = toolCalls[0];
    const productName = toolCall.function?.arguments?.product_name || '';

    if (!productName) {
      return res.json({
        results: [{ toolCallId: toolCall.id, result: "Please tell me the product name you're looking for." }]
      });
    }

    console.log(`Searching for: ${productName}`);
    
    const results = await searchProduct(productName);

    let responseText = '';

    if (results.length === 0) {
      // Try with just first word
      const firstWord = productName.split(' ')[0];
      const retryResults = await searchProduct(firstWord);
      
      if (retryResults.length === 0) {
        responseText = `I couldn't find ${productName} in our system. Could you describe it differently?`;
      } else if (retryResults.length === 1) {
        responseText = `${retryResults[0].name} is ${retryResults[0].price}.`;
      } else {
        responseText = `I found a few options: ` + 
          retryResults.slice(0, 3).map(r => `${r.name} is ${r.price}`).join(', ') + 
          `. Which one did you mean?`;
      }
    } else if (results.length === 1) {
      responseText = `${results[0].name} is ${results[0].price}.`;
    } else {
      responseText = `I found ${results.length} options: ` + 
        results.slice(0, 3).map(r => `${r.name} is ${r.price}`).join(', ') + 
        `. Which one were you looking for?`;
    }

    return res.json({
      results: [{ toolCallId: toolCall.id, result: responseText }]
    });

  } catch (err) {
    console.error('Error:', err.message);
    return res.json({
      results: [{ 
        toolCallId: req.body.message?.toolCalls?.[0]?.id || 'error',
        result: "I'm having trouble looking that up right now. Please call back in a moment." 
      }]
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Fifth St Food Mart Price Agent Running',
    loggedIn: isLoggedIn 
  });
});

// Start server and login immediately
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Logging into CStorePro...');
  await login();
});
