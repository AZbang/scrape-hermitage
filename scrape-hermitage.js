const download = require('image-downloader');
const request = require('request-promise');
const cheerio = require('cheerio');
const mkdirp = require('mkdirp');
const fs = require('fs');

const ITEM_TYPES = /.+/;
const MUSEUMS = {
  staff: 'http://hermitagemuseum.org/3d/html/pwoa/staff/pano.xml',
  peter: 'http://hermitagemuseum.org/3d/html/pwoa/peter/pano.xml',
  main: 'http://hermitagemuseum.org/3d/html/pwoaen/peter/pano.xml',
  kazan:  'http://hermitagemuseum.org/3d/html/pwoaen/kazan/pano.xml'
}
const SCRAPE_DIR = 'static/';
const DB_HERMITAGE = 'http://test.hermitagemuseum.org:7111';
const TIMEOUT = 10000;
const REQUEST_AWAIT = 3000;
const REQUEST_COUNTS = 20;

// UTILS
const getData = (url) => {
  return request({
    uri: url,
    timeout: TIMEOUT,
    transform: (body) => cheerio.load(body, {
      normalizeWhitespace: true,
      xmlMode: true
    })
  })
}

const timeout = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// PARSE DATA
const parseRoomNav = (src) => {
  src = src.replace(/\/+$/, '');

  const navs = src.split('/').pop().split('_');
  const room = parseInt(navs[2].slice(1));
  const floor = parseInt(navs[1].slice(1));

  return {room, floor};
}

const getItemMeta = (src) => {
  src = src.replace(/\/+$/, '');

  return {
    id: parseInt(src.split('/').pop()),
    type: src.split('/')[src.split('/').length-2]
  }
}

const getRoomUrl = ($room) => {
  return $room.find('userdata').attr('source');
}

const getHotspotsRoom = ($room) => {
  const items = [], links = [];
  $room.find('hotspot').each((i, point) => {
    if(point.attribs.skinid === 'woa_info') {
      const src = point.attribs.description;
      if(src.search(ITEM_TYPES) != -1) items.push(src);
    } else if(point.attribs.skinid === 'ht_node') {
      links.push(point.attribs.url.slice(1, -1));
    }
  });

  return {items, links};
}

const getRoomByHotspot = ($hotspot) => {
  return parseRoomNav($hotspot.parent().prev().attr('source')).room;
}

// LOAD DATA
const getItem = async (src) => {
  try {
    const $ = await getData(DB_HERMITAGE + src);
    if($('.error-message').text()) return null;
    else if(!$('.content-title').text()) throw Error();

    const meta = getItemMeta(src);
    const table = [];
    $('.field-value').each((i, value) => {
      table.push($(value).text());
    });

    return {
      id: meta.id,
      type: meta.type,
      title: $('.content-title').text().replace('&nbsp;', ''),
      image: $('.image-popup').attr('href'),
      description: $('.cell-description').text(),
      category: table[0],
      author: table[1],
      country: table[2],
      created: table[3]
    }
  } catch(e) {
    await timeout(TIMEOUT);
    const data = await getItem(src);
    return data;
  }
}

const getRoom = async (src) => {
  try {
    const $ = await getData(DB_HERMITAGE + src);
    if($('.error-message').text()) return null;
    else if(!$('.content-title').text()) throw Error();

    const nav = parseRoomNav(src);

    return {
      id: nav.room,
      floor: nav.floor,
      title: $('.content-title').text().replace('&nbsp;', ''),
      description: $('.popupScroller').text(),
    }
  } catch(e) {
    await timeout(TIMEOUT);
    const data = await getRoom(src);
    return data;
  }
}

const getImage = async (src, filename) => {
  try {
    await download.image({timeout: TIMEOUT, url: src, dest: filename});
    return filename;
  } catch(e) {
    await timeout(TIMEOUT);
    const data = await getImage(src, filename);
    return data;
  }
}

// SCRAPING
const scrapeImages = async (dirMuseum, items) => {
  const promises = [];
  let progress = 0;

  items = items.filter((item) => item.image != null);

  items.forEach((item, i) => promises.push((async () => {
    await timeout(REQUEST_AWAIT*Math.floor(i/REQUEST_COUNTS));

    const path = dirMuseum + '/items/' + item.id + '.jpg';
    await getImage(item.image, path);

    console.log(`SUCCESS IMAGE ${item.id} | PROGRESS: ${++progress}/${items.length}`);
    return path;
  })()));

  const pathes = await Promise.all(promises);
  console.log('Total images ' + pathes.length);
  return pathes;
}

const scrapeItems = async (dirMuseum, museumId) => {
  const $ = await getData(MUSEUMS[museumId]);
  const promises = [];
  const total = $('hotspot[skinid="woa_info"]').length;
  let progress = 0;

  $('hotspot[skinid="woa_info"]').each((i, $hotspot) => promises.push((async () => {
    await timeout(REQUEST_AWAIT*Math.floor(i/REQUEST_COUNTS));

    const src = $hotspot.attribs.description;
    if(src.search(ITEM_TYPES) == -1) return;

    const item = await getItem(src);
    if(!item) return;

    item.room = getRoomByHotspot($($hotspot));

    console.log(`SUCCESS ITEM ${item.id} | PROGRESS: ${++progress}/${total}`);
    return item;
  })()));


  let items = await Promise.all(promises);
  items = items.filter((item) => item != null);
  fs.writeFileSync(dirMuseum + '/items.json', JSON.stringify(items, null, 4));

  console.log('Total items ' + items.length)
  return items;
}

const scrapeRooms = async (dirMuseum, museumId) => {
  const $ = await getData(MUSEUMS[museumId]);
  const promises = [];
  const total = $('panorama').length;
  let progress = 0;

  $('panorama').each((i, $room) => promises.push((async () => {
    await timeout(REQUEST_AWAIT*Math.floor(i/REQUEST_COUNTS));

    // get hotspots
    const hotspots = getHotspotsRoom($($room));
    if(!hotspots.items.length) return;

    // get room data
    const roomUrl = getRoomUrl($($room));
    const room = await getRoom(roomUrl);
    if(!room) return;

    room.links = hotspots.links.map((node) => {
      const url = getRoomUrl($(`panorama[id="${node}"]`));
      return parseRoomNav(url).room;
    });
    room.items = hotspots.items.map((url) => parseInt(url.split('/').pop()));

    console.log(`SUCCESS ROOM ${room.id} | PROGRESS: ${++progress}/${total}`);
    return room;
  })()));

  let rooms = await Promise.all(promises);
  rooms = rooms.filter((room) => room != null);
  fs.writeFileSync(dirMuseum + '/rooms.json', JSON.stringify(rooms, null, 4));

  console.log('Total rooms ' + rooms.length);
  return rooms;
}

const scrapeMuseum = async (museumId) => {
  const dirMuseum = SCRAPE_DIR + 'hermitage_' + museumId;

  mkdirp.sync(dirMuseum);
  mkdirp.sync(dirMuseum + '/items');

  const rooms = await scrapeRooms(dirMuseum, museumId);
  const items = await scrapeItems(dirMuseum, museumId);
  await scrapeImages(dirMuseum, items);

  console.log('Scraping ' + museumId + ' hermitage building is completed!');
}

module.exports = {
  scrapeImages,
  scrapeItems,
  scrapeRooms,
  scrapeMuseum,
}
