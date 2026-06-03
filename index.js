const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const CSTORE_USERNAME = process.env.CSTORE_USERNAME || 'fifthstreet';
const CSTORE_PASSWORD = process.env.CSTORE_PASSWORD || 'Volco@2604';
const BASE_URL = 'https://secure.cstorepro.com/EmagineNETCOSM';

let sessionCookies = '';
let isLoggedIn = false;

// Login using HTTP requests (no browser needed)
async function login() {
  try {
    console.log('Logging into CStorePro...');

    // First get the login page to grab any tokens
    const loginPage = await axios.get(`${BASE_URL}/Login.aspx`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
      maxRedirects: 5
    });

    // Extract cookies from login page
    const cookies = loginPage.headers['set-cookie'];
    if (cookies) {
      sessionCookies = cookies.map(c => c.split(';')[0]).join('; ');
    }

    // Extract hidden form fields
    const body = loginPage.data;
    const viewStateMatch = body.match(/id="__VIEWSTATE"\s+value="([^"]+)"/);
    const eventValidationMatch = body.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/);
    const viewStateGeneratorMatch = body.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/);

    const viewState = viewStateMatch ? viewStateMatch[1] : '';
    const eventValidation = eventValidationMatch ? eventValidationMatch[1] : '';
    const viewStateGenerator = viewStateGeneratorMatch ? viewStateGeneratorMatch[1] : '';

    // Submit login form
    const loginData = new URLSearchParams({
      '__VIEWSTATE': viewState,
      '__VIEWSTATEGENERATOR': viewStateGenerator,
      '__EVENTVALIDATION': eventValidation,
      'txtUserName': CSTORE_USERNAME,
      'txtPassword': CSTORE_PASSWORD,
      'btnLogin': 'Login'
    });

    const loginResponse = await axios.post(`${BASE_URL}/Login.aspx`, loginData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': sessionCookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Referer': `${BASE_URL}/Login.aspx`
      },
      maxRedirects: 5,
      validateStatus: () => true
    });

    // Save new cookies
    const newCookies = loginResponse.headers['set-cookie'];
    if (newCookies) {
      sessionCookies = newCookies.map(c => c.split(';')[0]).join('; ');
    }

    // Check if login worked
    if (loginResponse.data.includes('TaskDash') || loginResponse.data.includes('Dashboard') || loginResponse.status === 302) {
      isLoggedIn = true;
      console.log('Login successful!');
      return true;
    } else {
      console.log('Login may have failed, trying to continue...');
      isLoggedIn = true;
      return true;
    }

  } catch (err) {
    console.error('Login error:', err.message);
    return false;
  }
}

// Search for product price
async function searchProduct(productName) {
  try {
    if (!isLoggedIn) await login();

    console.log(`Searching for: ${productName}`);

    const searchUrl = `${BASE_URL}/Content/POSManagement/POSItemList.aspx`;
    
    const response = await axios.get(searchUrl, {
      params: { search: productName },
      headers: {
        'Cookie': sessionCookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Referer': BASE_URL
      },
      validateStatus: () => true
    });

    // If redirected to login, re-login
    if (response.data.includes('Login') && response.data.includes('txtUserName')) {
      console.log('Session expired, re-logging in...');
      isLoggedIn = false;
      await login();
      return searchProduct(productName);
    }

    const html = response.data;
    const results = [];

    // Parse table rows for product names and prices
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRegex) || [];

    for (const row of rows) {
      // Look for price pattern $X.XX
      const priceMatch = row.match(/\$(\d+\.\d{2})/);
      // Look for item name in td
      const nameMatch = row.match(/<td[^>]*>([A-Z0-9][A-Z0-9\s\-\.]+?)<\/td>/i);
      
      if (priceMatch && nameMatch) {
        const name = nameMatch[1].trim();
        const price = '$' + priceMatch[1];
        if (name.length > 3 && !name.includes('<')) {
          results.push({ name, price });
        }
      }
    }

    return results;

  } catch (err) {
    console.error('Search error:', err.message);
    throw err;
  }
}

// VAPI webhook endpoint
app.post('/vapi-tool', async (req, res) => {
  console.log('VAPI request received');

  try {
    const toolCalls = req.body.message?.toolCalls || [];

    if (toolCalls.length === 0) {
      return res.json({ result: "No product name received." });
    }

    const toolCall = toolCalls[0];
    const productName = toolCall.function?.arguments?.product_name || 
                        toolCall.function?.arguments?.productName || '';

    if (!productName) {
      return res.json({
        results: [{ toolCallId: toolCall.id, result: "Please tell me the product name." }]
      });
    }

    console.log(`Looking up price for: ${productName}`);

    let results = await searchProduct(productName);
    let responseText = '';

    if (!results || results.length === 0) {
      // Try first word only
      const firstWord = productName.split(' ')[0];
      results = await searchProduct(firstWord);
    }

    if (!results || results.length === 0) {
      responseText = `I couldn't find ${productName} in our system. Could you describe it differently?`;
    } else if (results.length === 1) {
      responseText = `${results[0].name} is ${results[0].price}.`;
    } else {
      responseText = `I found a few options: ` +
        results.slice(0, 3).map(r => `${r.name} at ${r.price}`).join(', ') +
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
        result: "I'm having trouble looking that up right now. Please try again."
      }]
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Fifth St Food Mart Price Agent Running', loggedIn: isLoggedIn });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await login();
});
