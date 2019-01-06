const { scrapeMuseum } = require('./scrape-hermitage');

const scrapeHermitage = async () => {
  await scrapeMuseum('peter');
  await scrapeMuseum('staff');
  await scrapeMuseum('kazan');
  await scrapeMuseum('main');
}

scrapeHermitage();
