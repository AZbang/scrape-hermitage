# Scrape hermitage

### Start scrape
```bash
npm run scrape-hermitage  
```

### or from JS
```js
const { scrapeMuseum } = require('./scrape-hermitage');

const scrapeHermitage = async () => {
  // await scrapeMuseum('peter');
  // await scrapeMuseum('staff');
  // await scrapeMuseum('kazan');
  await scrapeMuseum('main');
}

scrapeHermitage();
```
