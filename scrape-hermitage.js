const download = require('image-downloader');
const request = require('request-promise');
const cheerio = require('cheerio');
const mkdirp = require('mkdirp');
const fs = require('fs');

const ITEM_TYPES = ['.'];
const SCRAPE_DIR = 'static/';
const DB_HERMITAGE = 'http://test.hermitagemuseum.org:7111';

// UTILS
const getData = (url) => {
  return request({
    uri: url,
    transform: (body) => cheerio.load(body, {
      normalizeWhitespace: true,
      xmlMode: true
    })
  })
}

// PARSE DATA
const parseRoomNav = (src) => {
  const navs = src.split('/').pop().split('_');
  const room = parseInt(navs[2].slice(1));
  const floor = parseInt(navs[1].slice(1));

  return {room, floor};
}

const getItemMeta = (src) => {
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
      if(src.search(new RegExp(ITEM_TYPES.join('|'), 'i')) != -1)
        items.push(src);
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
  const $ = await getData(DB_HERMITAGE + src);
  const meta = getItemMeta(src);
  return {
    id: meta.id,
    type: meta.type,
    title: $('.content-title').text().replace('&nbsp;', ''),
    image: $('.image-popup').attr('href'),
    description: $('.cell-description').text(),
  }
}

const getRoom = async (src) => {
  const $ = await getData(DB_HERMITAGE + src);
  const nav = parseRoomNav(src);

  return {
    id: nav.room,
    floor: nav.floor,
    title: $('.content-title').text().replace('&nbsp;', ''),
    description: $('.popupScroller').text(),
  }
}

// SCRAPING
const scrapeImages = async (dirMuseum, items) => {
  const promises = [];
  console.log(items);
  items.forEach((item, i) => promises.push((async () => {
    const path = dirMuseum + '/items/' + item.id + '.jpg';
    await download.image({url: item.image, dest: path});
    console.log('Scraping image ' + i + ' is completed!');
    return path;
  })()));

  const pathes = await Promise.all(promises);
  console.log('Total images ' + pathes.length);
  return pathes;
}

const scrapeItems = async (dirMuseum, museumId) => {
  const $ = await getData(`http://hermitagemuseum.org/3d/html/pwoa/${museumId}/pano.xml`);
  const promises = [];

  $('hotspot[skinid="woa_info"]').each((i, $hotspot) => promises.push((async () => {
    const src = $hotspot.attribs.description;
    if(src.search(new RegExp(ITEM_TYPES.join('|'), 'i')) == -1) return;

    const item = await getItem(src);
    item.room = getRoomByHotspot($($hotspot));

    console.log('Scraping item ' + i + ' is completed!');
    return item;
  })()));


  let items = await Promise.all(promises);
  items = items.filter((item) => item != null);
  fs.writeFileSync(dirMuseum + '/items.json', JSON.stringify(items, null, 4));

  console.log('Total items ' + items.length)
  return items;
}

const scrapeRooms = async (dirMuseum, museumId) => {
  const $ = await getData(`http://hermitagemuseum.org/3d/html/pwoa/${museumId}/pano.xml`);
  const promises = [];

  $('panorama').each((i, $room) => promises.push((async () => {
    // get hotspots
    const hotspots = getHotspotsRoom($($room));
    if(!hotspots.items.length) return;

    // get room data
    const roomUrl = getRoomUrl($($room));
    const room = await getRoom(roomUrl);

    room.links = hotspots.links.map((node) => {
      const url = getRoomUrl($(`panorama[id="${node}"]`));
      return parseRoomNav(url).room;
    });
    room.items = hotspots.items.map((url) => parseInt(url.split('/').pop()));

    console.log('Scraping room ' + i + ' is completed!');
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

scrapeMuseum('peter');
